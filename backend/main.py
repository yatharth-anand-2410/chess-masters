from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import AsyncIterator, Dict, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import errors as genai_errors
from pydantic import BaseModel

from services import analyzer, billing, db, engine, extractor, recommendations

load_dotenv()

logger = logging.getLogger("uvicorn.error")

app = FastAPI(title="AI Chess Game Analyzer")


def _allowed_origins() -> list[str]:
    origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    extra = os.environ.get("FRONTEND_ORIGIN", "")
    if extra:
        for origin in extra.split(","):
            origin = origin.strip().rstrip("/")
            if origin:
                origins.append(origin)
    return origins


app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_client: Optional[genai.Client] = None


def get_client() -> genai.Client:
    global _client
    if _client is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise extractor.ExtractionError(
                "GEMINI_API_KEY is not set. Add it to backend/.env and restart the server."
            )
        _client = genai.Client(api_key=api_key)
    return _client


def sse_event(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _now_value() -> str:
    return datetime.now(timezone.utc).isoformat()


def _upgrade_detail(feature: str) -> dict[str, str]:
    messages = {
        "analysis": "Your two free analyses have been used.",
        "qna": "Q&A coaching is available with a paid plan.",
    }
    return {
        "code": "upgrade_required",
        "message": messages.get(feature, "This feature requires a paid plan."),
        "feature": feature,
    }


def _usage_payload(usage: dict) -> dict:
    raw_plan = usage.get("plan", "free")
    status = usage.get("subscription_status", "inactive")
    period_end = usage.get("current_period_end")
    paid = db.is_paid_plan(raw_plan, status, period_end)
    used = int(usage.get("analyses_used", 0))
    limit = int(usage.get("free_analysis_limit", db.FREE_ANALYSIS_LIMIT))
    remaining = None if paid else max(0, limit - used)
    return {
        "plan": "paid" if paid else "free",
        "analyses_used": used,
        "free_analysis_limit": limit,
        "analyses_remaining": remaining,
        "qna_enabled": paid,
        "subscription_status": status,
        "current_period_end": period_end,
    }


def _unix_to_iso(value: object) -> Optional[str]:
    if not value:
        return None
    try:
        return datetime.fromtimestamp(int(value), timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def _billing_error(exc: billing.BillingError) -> HTTPException:
    return HTTPException(status_code=503, detail=str(exc))


async def get_current_user(request: Request) -> Dict[str, object]:
    authorization = request.headers.get("Authorization", "")
    token = authorization.removeprefix("Bearer ").strip() if authorization else ""
    try:
        user = db.get_user_from_token(token)
    except db.AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return {"id": user["id"], "email": user.get("email"), "user_metadata": user.get("user_metadata")}


def analyze_game(game: extractor.GameData) -> engine.AnalysisResult:
    analyzer_engine = engine.StockfishAnalyzer()
    return analyzer_engine.analyze_game(
        game.pgn,
        player_color=game.player_color,
        player_name=game.player_name,
    )


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


class AnalysisRequest(BaseModel):
    platform: str
    game_url: str
    username: Optional[str] = None
    player_color: Optional[str] = None


@app.post("/api/stream-analysis")
async def stream_analysis(
    payload: AnalysisRequest,
    user: Dict[str, object] = Depends(get_current_user),
) -> StreamingResponse:
    usage = await asyncio.to_thread(db.consume_analysis_credit, str(user["id"]))
    if not usage.get("allowed", False):
        raise HTTPException(status_code=402, detail=_upgrade_detail("analysis"))

    async def event_generator() -> AsyncIterator[str]:
        analysis_id: Optional[str] = None
        try:
            yield sse_event("status_update", {"message": "Extracting game PGN..."})
            game = await asyncio.to_thread(
                extractor.fetch_game,
                payload.platform,
                payload.game_url,
                payload.username,
                payload.player_color,
            )

            analysis_row = await asyncio.to_thread(
                db.create_analysis,
                str(user["id"]),
                {
                    "platform": game.platform,
                    "game_url": payload.game_url,
                    "game_id": game.game_id,
                    "username": payload.username,
                    "player_color": game.player_color,
                    "player_name": game.player_name,
                    "status": "processing",
                },
            )
            analysis_id = str(analysis_row["id"])

            yield sse_event(
                "status_update",
                {"message": "Running Stockfish engine evaluation..."},
            )
            analysis = await asyncio.to_thread(analyze_game, game)
            engine_data = await asyncio.to_thread(recommendations.build_insights, analysis)

            yield sse_event(
                "status_update",
                {"message": "Detecting motifs and building recommendations..."},
            )
            insights_payload = {
                "strength_moments": engine_data.get("strength_moments", []),
                "weakness_moments": engine_data.get("weakness_moments", []),
                "resources": engine_data.get("resources", []),
                "player_color": engine_data.get("player_color"),
                "player_name": engine_data.get("player_name"),
            }

            yield sse_event(
                "status_update",
                {"message": "AI generating coaching report..."},
            )
            report_parts: list[str] = []
            async for chunk in analyzer.stream_coaching_report(
                get_client(), game, engine_data
            ):
                report_parts.append(chunk)
                yield sse_event("content_chunk", {"text": chunk})

            report_markdown = "".join(report_parts)
            await asyncio.to_thread(
                db.update_analysis,
                str(user["id"]),
                analysis_id,
                {
                    "pgn": game.pgn,
                    "opening_name": analysis.opening_name,
                    "eco": analysis.eco,
                    "result": analysis.result,
                    "report_markdown": report_markdown,
                    "insights": insights_payload,
                    "status": "completed",
                    "completed_at": _now_value(),
                },
            )

            yield sse_event("insights", insights_payload)
            yield sse_event(
                "done",
                {
                    "message": "Analysis complete",
                    "analysis_id": analysis_id,
                    "usage": _usage_payload(usage),
                },
            )
        except (extractor.ExtractionError, engine.EngineError) as exc:
            logger.error("Analysis failed: %s", exc)
            if analysis_id:
                await asyncio.to_thread(
                    db.update_analysis,
                    str(user["id"]),
                    analysis_id,
                    {"status": "failed", "error_message": str(exc)},
                )
            yield sse_event("error", {"message": str(exc)})
        except genai_errors.APIError as exc:
            message = str(getattr(exc, "message", exc))
            if "quota" in message.lower() or "resource_exhausted" in message.lower():
                message = "AI service quota exceeded. Please try again later."
            logger.error("Gemini API error: %s", message)
            if analysis_id:
                await asyncio.to_thread(
                    db.update_analysis,
                    str(user["id"]),
                    analysis_id,
                    {"status": "failed", "error_message": message},
                )
            yield sse_event("error", {"message": message})
        except Exception as exc:
            logger.exception("Unexpected error during analysis")
            if analysis_id:
                await asyncio.to_thread(
                    db.update_analysis,
                    str(user["id"]),
                    analysis_id,
                    {"status": "failed", "error_message": str(exc)},
                )
            yield sse_event(
                "error",
                {"message": "An unexpected error occurred during analysis."},
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/analyses")
async def list_analyses(
    user: Dict[str, object] = Depends(get_current_user),
) -> list[dict]:
    return await asyncio.to_thread(db.list_analyses, str(user["id"]))


@app.get("/api/analyses/{analysis_id}")
async def get_analysis(
    analysis_id: str,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    analysis = await asyncio.to_thread(db.get_analysis, str(user["id"]), analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    messages = await asyncio.to_thread(db.list_messages, analysis_id)
    if analysis.get("insights") and isinstance(analysis["insights"], str):
        try:
            analysis["insights"] = json.loads(analysis["insights"])
        except ValueError:
            analysis["insights"] = {}
    return {"analysis": analysis, "messages": messages}


@app.get("/api/account/usage")
async def account_usage(
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    usage = await asyncio.to_thread(db.get_usage, str(user["id"]))
    return _usage_payload(usage)


class BillingVerifyRequest(BaseModel):
    razorpay_payment_id: str
    razorpay_subscription_id: str
    razorpay_signature: str


@app.get("/api/billing/config")
async def billing_config(
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    try:
        return billing.public_config()
    except billing.BillingError as exc:
        raise _billing_error(exc) from exc


@app.post("/api/billing/subscription")
async def create_billing_subscription(
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    user_id = str(user["id"])
    existing = await asyncio.to_thread(db.get_current_subscription, user_id)
    if existing:
        if existing.get("status") in {"created", "pending"}:
            return {
                "subscription_id": existing["razorpay_subscription_id"],
                **billing.public_config(),
            }
        if existing.get("status") == "paused":
            raise HTTPException(
                status_code=409,
                detail="Your subscription is paused. Resume it instead of subscribing again.",
            )
        raise HTTPException(status_code=409, detail="You already have an active subscription.")
    try:
        subscription = await asyncio.to_thread(
            billing.create_subscription,
            user_id,
            str(user.get("email") or "") or None,
        )
        await asyncio.to_thread(
            db.create_subscription,
            user_id,
            {
                "razorpay_subscription_id": subscription["id"],
                "razorpay_plan_id": subscription.get("plan_id", ""),
                "status": subscription.get("status", "created"),
                "amount": billing.SUBSCRIPTION_AMOUNT,
                "currency": billing.SUBSCRIPTION_CURRENCY,
            },
        )
        return {
            "subscription_id": subscription["id"],
            **billing.public_config(),
        }
    except billing.BillingError as exc:
        raise _billing_error(exc) from exc


@app.post("/api/billing/verify")
async def verify_billing_subscription(
    payload: BillingVerifyRequest,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    subscription = await asyncio.to_thread(
        db.get_subscription, str(user["id"]), payload.razorpay_subscription_id
    )
    if not subscription:
        raise HTTPException(status_code=404, detail="Subscription not found.")
    if not billing.verify_checkout_signature(
        payload.razorpay_payment_id,
        payload.razorpay_subscription_id,
        payload.razorpay_signature,
    ):
        raise HTTPException(status_code=400, detail="Invalid Razorpay payment signature.")
    await asyncio.to_thread(
        db.update_subscription,
        payload.razorpay_subscription_id,
        {"status": "authenticated"},
    )
    await asyncio.to_thread(
        db.set_paid_access,
        str(user["id"]),
        True,
        "authenticated",
    )
    return {"status": "authenticated"}


@app.get("/api/billing/status")
async def billing_status(user: Dict[str, object] = Depends(get_current_user)) -> dict:
    usage = await asyncio.to_thread(db.get_usage, str(user["id"]))
    subscription = await asyncio.to_thread(db.get_latest_subscription, str(user["id"]))
    return {
        "plan": usage.get("plan", "free"),
        "status": usage.get("subscription_status", "inactive"),
        "current_period_end": usage.get("current_period_end"),
        "subscription": subscription,
    }


@app.get("/api/billing/invoices")
async def billing_invoices(
    user: Dict[str, object] = Depends(get_current_user),
) -> list[dict]:
    stored = await asyncio.to_thread(db.list_invoices_db, str(user["id"]))
    if stored:
        return stored
    subscription = await asyncio.to_thread(db.get_latest_subscription, str(user["id"]))
    if not subscription:
        return []
    try:
        return await asyncio.to_thread(
            billing.list_invoices,
            subscription["razorpay_subscription_id"],
        )
    except billing.BillingError:
        return []


@app.post("/api/billing/pause")
async def pause_billing_subscription(
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    subscription = await asyncio.to_thread(db.get_current_subscription, str(user["id"]))
    if not subscription:
        raise HTTPException(status_code=404, detail="No subscription found.")
    if subscription.get("status") != "active":
        raise HTTPException(
            status_code=409, detail="Only active subscriptions can be paused."
        )
    try:
        result = await asyncio.to_thread(
            billing.pause_subscription,
            subscription["razorpay_subscription_id"],
        )
    except billing.BillingError as exc:
        raise _billing_error(exc) from exc
    status = result.get("status", "paused")
    period_end = _unix_to_iso(result.get("current_end")) or subscription.get("current_end")
    await asyncio.to_thread(
        db.update_subscription,
        subscription["razorpay_subscription_id"],
        {"status": status, "paused_at": _now_value()},
    )
    await asyncio.to_thread(
        db.set_paid_access,
        str(user["id"]),
        db.is_paid_plan("paid", status, period_end),
        status,
        period_end,
    )
    return {"status": status}


@app.post("/api/billing/resume")
async def resume_billing_subscription(
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    subscription = await asyncio.to_thread(db.get_current_subscription, str(user["id"]))
    if not subscription:
        raise HTTPException(status_code=404, detail="No subscription found.")
    if subscription.get("status") != "paused":
        raise HTTPException(
            status_code=409, detail="Only paused subscriptions can be resumed."
        )
    try:
        result = await asyncio.to_thread(
            billing.resume_subscription,
            subscription["razorpay_subscription_id"],
        )
    except billing.ResumeNotAllowedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except billing.BillingError as exc:
        raise _billing_error(exc) from exc
    status = result.get("status", "active")
    period_end = _unix_to_iso(result.get("current_end")) or subscription.get("current_end")
    await asyncio.to_thread(
        db.update_subscription,
        subscription["razorpay_subscription_id"],
        {"status": status},
    )
    await asyncio.to_thread(
        db.set_paid_access,
        str(user["id"]),
        db.is_paid_plan("paid", status, period_end),
        status,
        period_end,
    )
    return {"status": status}


@app.post("/api/billing/cancel")
async def cancel_billing_subscription(
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    subscription = await asyncio.to_thread(db.get_current_subscription, str(user["id"]))
    if not subscription or subscription.get("status") in {"created", "pending"}:
        raise HTTPException(status_code=404, detail="No active subscription found.")
    try:
        result = await asyncio.to_thread(
            billing.cancel_subscription,
            subscription["razorpay_subscription_id"],
        )
    except billing.BillingError as exc:
        raise _billing_error(exc) from exc
    await asyncio.to_thread(
        db.update_subscription,
        subscription["razorpay_subscription_id"],
        {"status": result.get("status", "cancelled")},
    )
    return {"status": result.get("status", "cancelled")}


@app.post("/api/billing/webhook")
async def razorpay_webhook(request: Request) -> dict:
    raw_body = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")
    if not billing.verify_webhook_signature(raw_body, signature):
        raise HTTPException(status_code=400, detail="Invalid webhook signature.")
    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid webhook payload.") from exc

    event_type = str(payload.get("event", ""))
    event_id = request.headers.get("X-Razorpay-Event-Id", "")
    if not event_id:
        event_id = hashlib.sha256(raw_body).hexdigest()
    accepted = await asyncio.to_thread(db.record_webhook_event, event_id, event_type, payload)
    if not accepted:
        return {"status": "duplicate"}

    if event_type.startswith("invoice."):
        return await _handle_invoice_event(event_type, payload)

    entity = payload.get("payload", {}).get("subscription", {}).get("entity", {})
    subscription_id = entity.get("id")
    if not subscription_id:
        return {"status": "ignored"}
    subscription = await asyncio.to_thread(db.get_subscription_by_razorpay_id, subscription_id)
    if not subscription:
        logger.warning("Ignoring webhook for unknown subscription %s", subscription_id)
        return {"status": "ignored"}

    status = str(entity.get("status", "unknown"))
    period_end = entity.get("current_end")
    updates = {"status": status}
    if period_end:
        updates["current_end"] = datetime.fromtimestamp(
            int(period_end), timezone.utc
        ).isoformat()
    if entity.get("customer_id"):
        updates["razorpay_customer_id"] = entity["customer_id"]
    if status == "paused":
        updates["paused_at"] = _now_value()
    await asyncio.to_thread(db.update_subscription, subscription_id, updates)

    # Creation/pending events can arrive after an authorization event; they do
    # not represent a loss of access and must not downgrade a paid account.
    if status not in {"created", "pending"}:
        candidate_plan = (
            "paid" if status in {"authenticated", "active", "paused", "cancelled"} else "free"
        )
        paid = db.is_paid_plan(candidate_plan, status, updates.get("current_end"))
        await asyncio.to_thread(
            db.set_paid_access,
            subscription["user_id"],
            paid,
            status,
            updates.get("current_end"),
        )
    return {"status": "processed"}


async def _handle_invoice_event(event_type: str, payload: dict) -> dict:
    invoice = payload.get("payload", {}).get("invoice", {}).get("entity", {})
    payment = payload.get("payload", {}).get("payment", {}).get("entity", {})
    if event_type != "invoice.paid" or not invoice.get("id"):
        return {"status": "ignored"}
    # The invoice carries the subscription id for subscription invoices; the
    # customer id is only a fallback (it can be null for some payment methods).
    subscription = None
    if invoice.get("subscription_id"):
        subscription = await asyncio.to_thread(
            db.get_subscription_by_razorpay_id, invoice["subscription_id"]
        )
    if not subscription:
        customer_id = invoice.get("customer_id") or payment.get("customer_id")
        subscription = (
            await asyncio.to_thread(db.get_subscription_by_customer_id, customer_id)
            if customer_id
            else None
        )
    if not subscription:
        logger.warning(
            "Ignoring invoice webhook without matching subscription (sub=%s customer=%s)",
            invoice.get("subscription_id"),
            invoice.get("customer_id"),
        )
        return {"status": "ignored"}
    recorded = await asyncio.to_thread(
        db.record_invoice,
        subscription["user_id"],
        {
            "razorpay_subscription_id": subscription["razorpay_subscription_id"],
            "razorpay_invoice_id": invoice["id"],
            "invoice_number": invoice.get("invoice_number"),
            "amount": int(invoice.get("amount", 0)),
            "currency": invoice.get("currency", "INR"),
            "status": invoice.get("status", "paid"),
            "payment_method": payment.get("method"),
            "fee": payment.get("fee"),
            "tax": payment.get("tax"),
            "paid_at": _unix_to_iso(invoice.get("paid_at")),
            "billing_start": _unix_to_iso(invoice.get("billing_start")),
            "billing_end": _unix_to_iso(invoice.get("billing_end")),
            "short_url": invoice.get("short_url"),
            "payload": payload,
        },
    )
    return {"status": "processed" if recorded else "duplicate"}


class MessageRequest(BaseModel):
    content: str


@app.post("/api/analyses/{analysis_id}/messages/stream")
async def stream_message(
    analysis_id: str,
    payload: MessageRequest,
    user: Dict[str, object] = Depends(get_current_user),
) -> StreamingResponse:
    question = payload.content.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Message content is required.")

    analysis = await asyncio.to_thread(db.get_analysis, str(user["id"]), analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found.")

    usage = await asyncio.to_thread(db.get_usage, str(user["id"]))
    if not _usage_payload(usage)["qna_enabled"]:
        raise HTTPException(status_code=402, detail=_upgrade_detail("qna"))

    messages = await asyncio.to_thread(db.list_messages, analysis_id)

    async def event_generator() -> AsyncIterator[str]:
        assistant_parts: list[str] = []
        try:
            await asyncio.to_thread(
                db.add_message, str(user["id"]), analysis_id, "user", question
            )
            async for chunk in analyzer.stream_question_answer(
                get_client(), analysis, messages, question
            ):
                assistant_parts.append(chunk)
                yield sse_event("content_chunk", {"text": chunk})
            answer = "".join(assistant_parts)
            await asyncio.to_thread(
                db.add_message, str(user["id"]), analysis_id, "assistant", answer
            )
            yield sse_event("done", {"message": "Reply complete"})
        except genai_errors.APIError as exc:
            message = str(getattr(exc, "message", exc))
            if "quota" in message.lower() or "resource_exhausted" in message.lower():
                message = "AI service quota exceeded. Please try again later."
            logger.error("Gemini API error (Q&A): %s", message)
            yield sse_event("error", {"message": message})
        except Exception as exc:
            logger.exception("Unexpected error during Q&A")
            yield sse_event(
                "error",
                {"message": "An unexpected error occurred while answering."},
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
