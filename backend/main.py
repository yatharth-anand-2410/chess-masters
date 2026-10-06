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

from services import (
    analyzer,
    batch_insights,
    billing,
    db,
    engine,
    extractor,
    recommendations,
)

load_dotenv()

logger = logging.getLogger("uvicorn.error")

app = FastAPI(title="AI Chess Game Analyzer")


def _allowed_origins() -> list[str]:
    origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://chessmasterss.in",
        "https://www.chessmasterss.in",
    ]
    extra = os.environ.get("FRONTEND_ORIGIN", "")
    if extra:
        for origin in extra.split(","):
            origin = origin.strip().rstrip("/")
            if origin and origin not in origins:
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


def _client_ip(request: Request) -> str:
    """Best-effort client IP for guest rate limiting behind a proxy."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    if request.client and request.client.host:
        return request.client.host
    return ""


def _parse_datetime_value(value: object) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _upgrade_detail(feature: str) -> dict[str, str]:
    messages = {
        "analysis": "Your five free analyses have been used.",
        "qna": "Q&A coaching is available with a paid plan.",
    }
    return {
        "code": "upgrade_required",
        "message": messages.get(feature, "This feature requires a paid plan."),
        "feature": feature,
    }


def _limit_reached_detail(
    feature: str,
    period_end: object = None,
    limit: int = db.PAID_ANALYSIS_LIMIT,
) -> dict:
    reset = _parse_datetime_value(period_end)
    message = f"You've used all {limit} analyses for this billing period."
    if reset is not None:
        message = (
            f"{message} Your quota resets on "
            f"{reset.strftime('%B')} {reset.day}, {reset.year}."
        )
    return {
        "code": "limit_reached",
        "message": message,
        "feature": feature,
        "limit": limit,
    }


MAX_BATCH_GAMES = 5


def _batch_limit_detail(usage: dict, required: int) -> dict:
    """Explain why a batch cannot be covered by the account's credits."""
    plan = usage.get("plan", "free")
    remaining = int(usage.get("remaining", 0))
    if plan == "paid":
        if remaining <= 0:
            return _limit_reached_detail(
                "analysis",
                usage.get("current_period_end"),
                int(usage.get("paid_analysis_limit", db.PAID_ANALYSIS_LIMIT)),
            )
        return {
            "code": "insufficient_credits",
            "message": (
                f"This batch needs {required} analyses, but only {remaining} "
                "remain in your billing period."
            ),
            "feature": "analysis",
            "required": required,
            "remaining": remaining,
        }
    if remaining <= 0:
        return _upgrade_detail("analysis")
    return {
        "code": "insufficient_credits",
        "message": (
            f"This batch needs {required} analyses, but you have only "
            f"{remaining} free analyses left."
        ),
        "feature": "analysis",
        "required": required,
        "remaining": remaining,
    }


def _usage_payload(usage: dict) -> dict:
    raw_plan = usage.get("plan", "free")
    status = usage.get("subscription_status", "inactive")
    period_end = usage.get("current_period_end")
    paid = db.is_paid_plan(raw_plan, status, period_end)
    used = int(usage.get("analyses_used", 0))
    free_limit = int(usage.get("free_analysis_limit", db.FREE_ANALYSIS_LIMIT))
    paid_limit = int(usage.get("paid_analysis_limit", db.PAID_ANALYSIS_LIMIT))
    if paid:
        limit = paid_limit
        period_end_value = _parse_datetime_value(period_end)
        usage_period_end_value = _parse_datetime_value(usage.get("usage_period_end"))
        # A renewal advanced the billing period; the stored count belongs to
        # the previous period, so report it as a fresh start.
        if period_end_value is not None and (
            usage_period_end_value is None
            or usage_period_end_value < period_end_value
        ):
            used = 0
    else:
        limit = free_limit
    remaining = max(0, limit - used)
    return {
        "plan": "paid" if paid else "free",
        "analyses_used": used,
        "free_analysis_limit": free_limit,
        "paid_analysis_limit": paid_limit,
        "analyses_remaining": remaining,
        "qna_enabled": paid and remaining > 0,
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


async def get_optional_user(request: Request) -> Optional[Dict[str, object]]:
    """Resolve the caller when a valid token is present, else return None.

    Public read endpoints use this so signed-out visitors can still browse
    community content without a 401.
    """
    authorization = request.headers.get("Authorization", "")
    token = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not token:
        return None
    try:
        user = db.get_user_from_token(token)
    except db.AuthError:
        return None
    return {"id": user["id"], "email": user.get("email"), "user_metadata": user.get("user_metadata")}


def analyze_game(
    game: extractor.GameData,
    pool: engine.EnginePool,
) -> engine.AnalysisResult:
    analyzer_engine = engine.StockfishAnalyzer()
    move_times = {
        (entry.color, entry.move_number): (entry.seconds_spent, entry.clock_remaining)
        for entry in game.player_move_times
    }
    return analyzer_engine.analyze_game(
        game.pgn,
        player_color=game.player_color,
        player_name=game.player_name,
        started_at=game.started_at,
        time_control=game.time_control,
        move_times=move_times or None,
        server_evals=game.server_evals,
        pool=pool,
    )


async def _refund_analysis_credits(user_id: str, count: int) -> None:
    """Give back credits for analyses that failed before producing a report."""
    if count <= 0:
        return
    try:
        await asyncio.to_thread(db.refund_analysis_credits, user_id, count)
    except Exception:
        logger.exception("Failed to refund %s analysis credit(s)", count)


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
    request: Request,
    user: Optional[Dict[str, object]] = Depends(get_optional_user),
) -> StreamingResponse:
    user_id = str(user["id"]) if user else None
    usage: Optional[dict] = None
    if user_id:
        usage = await asyncio.to_thread(db.consume_analysis_credit, user_id)
        if not usage.get("allowed", False):
            if usage.get("limit_reached"):
                raise HTTPException(
                    status_code=402,
                    detail=_limit_reached_detail(
                        "analysis",
                        usage.get("current_period_end"),
                        int(usage.get("paid_analysis_limit", db.PAID_ANALYSIS_LIMIT)),
                    ),
                )
            raise HTTPException(status_code=402, detail=_upgrade_detail("analysis"))

    async def event_generator() -> AsyncIterator[str]:
        analysis_id: Optional[str] = None
        pool: Optional[engine.EnginePool] = None
        create_task: Optional[asyncio.Task] = None
        try:
            yield sse_event("status_update", {"message": "Extracting game PGN..."})
            game = await asyncio.to_thread(
                extractor.fetch_game,
                payload.platform,
                payload.game_url,
                payload.username,
                payload.player_color,
            )

            if user_id is None:
                guest_usage = await asyncio.to_thread(
                    db.consume_guest_analysis, _client_ip(request)
                )
                if not guest_usage.get("allowed", False):
                    yield sse_event(
                        "error",
                        {
                            "code": "guest_limit",
                            "message": (
                                "You've used your free guest analysis. Sign in with "
                                "Google to unlock your 4 remaining free analyses."
                            ),
                        },
                    )
                    return

            if user_id:
                create_task = asyncio.create_task(
                    asyncio.to_thread(
                        db.create_analysis,
                        user_id,
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
                )

            yield sse_event(
                "status_update",
                {"message": "Running Stockfish engine evaluation..."},
            )
            pool = await asyncio.to_thread(engine.EnginePool.create)
            analysis = await asyncio.to_thread(analyze_game, game, pool)

            if create_task is not None:
                analysis_row = await create_task
                analysis_id = str(analysis_row["id"])

            yield sse_event(
                "status_update",
                {"message": "Detecting motifs and building recommendations..."},
            )
            engine_data = await asyncio.to_thread(
                recommendations.build_insights, analysis, pool
            )

            description_task = asyncio.create_task(
                analyzer.describe_moments(get_client(), engine_data)
            )

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

            descriptions = await description_task
            analyzer.merge_moment_descriptions(engine_data, descriptions)
            insights_payload = {
                "strength_moments": engine_data.get("strength_moments", []),
                "weakness_moments": engine_data.get("weakness_moments", []),
                "resources": engine_data.get("resources", []),
                "player_color": engine_data.get("player_color"),
                "player_name": engine_data.get("player_name"),
            }
            if user_id and analysis_id:
                await asyncio.to_thread(
                    db.update_analysis,
                    user_id,
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
                    "usage": _usage_payload(usage) if usage else None,
                },
            )
        except (extractor.ExtractionError, engine.EngineError) as exc:
            logger.error("Analysis failed: %s", exc)
            if user_id and analysis_id:
                await asyncio.to_thread(
                    db.update_analysis,
                    user_id,
                    analysis_id,
                    {"status": "failed", "error_message": str(exc)},
                )
            if user_id:
                await _refund_analysis_credits(user_id, 1)
            yield sse_event("error", {"message": str(exc)})
        except genai_errors.APIError as exc:
            message = str(getattr(exc, "message", exc))
            if "quota" in message.lower() or "resource_exhausted" in message.lower():
                message = "AI service quota exceeded. Please try again later."
            logger.error("Gemini API error: %s", message)
            if user_id and analysis_id:
                await asyncio.to_thread(
                    db.update_analysis,
                    user_id,
                    analysis_id,
                    {"status": "failed", "error_message": message},
                )
            if user_id:
                await _refund_analysis_credits(user_id, 1)
            yield sse_event("error", {"message": message})
        except Exception as exc:
            logger.exception("Unexpected error during analysis")
            if user_id and analysis_id:
                await asyncio.to_thread(
                    db.update_analysis,
                    user_id,
                    analysis_id,
                    {"status": "failed", "error_message": str(exc)},
                )
            if user_id:
                await _refund_analysis_credits(user_id, 1)
            yield sse_event(
                "error",
                {"message": "An unexpected error occurred during analysis."},
            )
        finally:
            if create_task is not None:
                if not create_task.done():
                    create_task.cancel()
                elif not create_task.cancelled():
                    create_task.exception()
            if pool is not None:
                await asyncio.to_thread(pool.close)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


class BatchGameInput(BaseModel):
    game_url: str
    player_color: Optional[str] = None


class BatchAnalysisRequest(BaseModel):
    platform: str
    games: list[BatchGameInput]
    username: Optional[str] = None


@app.post("/api/stream-batch-analysis")
async def stream_batch_analysis(
    payload: BatchAnalysisRequest,
    user: Dict[str, object] = Depends(get_current_user),
) -> StreamingResponse:
    games = [game for game in payload.games if game.game_url.strip()]
    if len(games) < 2:
        raise HTTPException(
            status_code=400,
            detail="Select at least two games for a multi-game analysis.",
        )
    if len(games) > MAX_BATCH_GAMES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"A multi-game analysis can include at most {MAX_BATCH_GAMES} games."
            ),
        )

    user_id = str(user["id"])
    usage = await asyncio.to_thread(db.consume_analysis_credits, user_id, len(games))
    if not usage.get("allowed", False):
        raise HTTPException(
            status_code=402,
            detail=_batch_limit_detail(usage, len(games)),
        )

    async def event_generator() -> AsyncIterator[str]:
        batch_id: Optional[str] = None
        completed: list[dict[str, object]] = []
        credits_refunded = 0
        pool: Optional[engine.EnginePool] = None
        extract_tasks: list[asyncio.Task] = []
        try:
            batch_row = await asyncio.to_thread(
                db.create_batch,
                user_id,
                {
                    "platform": payload.platform,
                    "username": payload.username,
                    "game_count": len(games),
                    "status": "processing",
                },
            )
            batch_id = str(batch_row["id"])
            client = get_client()
            pool = await asyncio.to_thread(engine.EnginePool.create)
            extract_tasks = [
                asyncio.create_task(
                    asyncio.to_thread(
                        extractor.fetch_game,
                        payload.platform,
                        game_input.game_url,
                        payload.username,
                        game_input.player_color,
                    )
                )
                for game_input in games
            ]
            yield sse_event(
                "batch_started",
                {
                    "batch_id": batch_id,
                    "total": len(games),
                    "games": [{"game_url": game.game_url} for game in games],
                },
            )

            for index, game_input in enumerate(games):
                label = f"Game {index + 1}"
                analysis_id: Optional[str] = None
                try:
                    yield sse_event(
                        "game_status",
                        {
                            "index": index,
                            "message": f"Extracting PGN for {label}...",
                        },
                    )
                    game = await extract_tasks[index]

                    analysis_row = await asyncio.to_thread(
                        db.create_analysis,
                        user_id,
                        {
                            "platform": game.platform,
                            "game_url": game_input.game_url,
                            "game_id": game.game_id,
                            "username": payload.username,
                            "player_color": game.player_color,
                            "player_name": game.player_name,
                            "batch_id": batch_id,
                            "status": "processing",
                        },
                    )
                    analysis_id = str(analysis_row["id"])

                    yield sse_event(
                        "game_status",
                        {
                            "index": index,
                            "analysis_id": analysis_id,
                            "message": f"Running Stockfish on {label}...",
                        },
                    )
                    analysis = await asyncio.to_thread(analyze_game, game, pool)

                    yield sse_event(
                        "game_status",
                        {
                            "index": index,
                            "analysis_id": analysis_id,
                            "message": f"Detecting motifs for {label}...",
                        },
                    )
                    engine_data = await asyncio.to_thread(
                        recommendations.build_insights, analysis, pool
                    )

                    await asyncio.to_thread(
                        db.update_analysis,
                        user_id,
                        analysis_id,
                        {
                            "pgn": game.pgn,
                            "opening_name": analysis.opening_name,
                            "eco": analysis.eco,
                            "result": analysis.result,
                            "insights": engine_data,
                            "status": "completed",
                            "completed_at": _now_value(),
                        },
                    )

                    description_task = asyncio.create_task(
                        analyzer.describe_moments(client, engine_data)
                    )
                    completed.append(
                        {
                            "analysis_id": analysis_id,
                            "label": label,
                            "game_id": game.game_id,
                            "game_url": game_input.game_url,
                            "platform": game.platform,
                            "engine_data": engine_data,
                            "description_task": description_task,
                        }
                    )
                    yield sse_event(
                        "game_done",
                        {
                            "index": index,
                            "analysis_id": analysis_id,
                            "game_id": game.game_id,
                            "opening_name": analysis.opening_name,
                            "result": analysis.result,
                        },
                    )
                except (extractor.ExtractionError, engine.EngineError) as exc:
                    logger.error("Batch game %s failed: %s", index + 1, exc)
                    if analysis_id:
                        await asyncio.to_thread(
                            db.update_analysis,
                            user_id,
                            analysis_id,
                            {"status": "failed", "error_message": str(exc)},
                        )
                    await _refund_analysis_credits(user_id, 1)
                    credits_refunded += 1
                    yield sse_event(
                        "game_error", {"index": index, "message": str(exc)}
                    )
                except Exception as exc:
                    logger.exception(
                        "Unexpected error in batch game %s", index + 1
                    )
                    if analysis_id:
                        await asyncio.to_thread(
                            db.update_analysis,
                            user_id,
                            analysis_id,
                            {"status": "failed", "error_message": str(exc)},
                        )
                    await _refund_analysis_credits(user_id, 1)
                    credits_refunded += 1
                    yield sse_event(
                        "game_error",
                        {
                            "index": index,
                            "message": "This game could not be analyzed.",
                        },
                    )

            if not completed:
                message = (
                    "None of the games could be analyzed. "
                    "Check the links and try again."
                )
                await asyncio.to_thread(
                    db.update_batch,
                    user_id,
                    batch_id,
                    {"status": "failed", "error_message": message},
                )
                yield sse_event("error", {"message": message})
                return

            yield sse_event(
                "batch_status",
                {"message": "Reviewing the key positions in each game..."},
            )
            description_results = await asyncio.gather(
                *(entry["description_task"] for entry in completed)
            )
            for entry, descriptions in zip(completed, description_results):
                analyzer.merge_moment_descriptions(entry["engine_data"], descriptions)
                await asyncio.to_thread(
                    db.update_analysis,
                    user_id,
                    entry["analysis_id"],
                    {"insights": entry["engine_data"]},
                )

            yield sse_event(
                "batch_status",
                {"message": "Reading the patterns across your games..."},
            )
            aggregate = await asyncio.to_thread(
                batch_insights.build_batch_insights, completed
            )
            yield sse_event(
                "batch_status",
                {"message": "AI generating your overall coaching report..."},
            )
            prompt_payload = await asyncio.to_thread(
                batch_insights.build_prompt_payload, aggregate
            )

            report_parts: list[str] = []
            async for chunk in analyzer.stream_batch_coaching_report(
                get_client(), prompt_payload
            ):
                report_parts.append(chunk)
                yield sse_event("content_chunk", {"text": chunk})

            report_markdown = "".join(report_parts)
            await asyncio.to_thread(
                db.update_batch,
                user_id,
                batch_id,
                {
                    "report_markdown": report_markdown,
                    "insights": aggregate,
                    "status": "completed",
                    "completed_at": _now_value(),
                },
            )

            yield sse_event("insights", aggregate)
            yield sse_event(
                "done",
                {
                    "message": "Analysis complete",
                    "batch_id": batch_id,
                    "usage": _usage_payload(usage),
                },
            )
        except genai_errors.APIError as exc:
            message = str(getattr(exc, "message", exc))
            if "quota" in message.lower() or "resource_exhausted" in message.lower():
                message = "AI service quota exceeded. Please try again later."
            logger.error("Gemini API error (batch): %s", message)
            if batch_id:
                await asyncio.to_thread(
                    db.update_batch,
                    user_id,
                    batch_id,
                    {"status": "failed", "error_message": message},
                )
            await _refund_analysis_credits(
                user_id, len(games) - len(completed) - credits_refunded
            )
            yield sse_event("error", {"message": message})
        except Exception as exc:
            logger.exception("Unexpected error during batch analysis")
            if batch_id:
                await asyncio.to_thread(
                    db.update_batch,
                    user_id,
                    batch_id,
                    {"status": "failed", "error_message": str(exc)},
                )
            await _refund_analysis_credits(
                user_id, len(games) - len(completed) - credits_refunded
            )
            yield sse_event(
                "error",
                {"message": "An unexpected error occurred during analysis."},
            )
        finally:
            for task in extract_tasks:
                if not task.done():
                    task.cancel()
            for entry in completed:
                description_task = entry.get("description_task")
                if isinstance(description_task, asyncio.Task) and not description_task.done():
                    description_task.cancel()
            if pool is not None:
                await asyncio.to_thread(pool.close)

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
    standalone: bool = False,
    user: Dict[str, object] = Depends(get_current_user),
) -> list[dict]:
    return await asyncio.to_thread(
        db.list_analyses, str(user["id"]), 50, standalone
    )


@app.get("/api/batches")
async def list_batches(
    user: Dict[str, object] = Depends(get_current_user),
) -> list[dict]:
    return await asyncio.to_thread(db.list_batches, str(user["id"]))


@app.get("/api/batches/{batch_id}")
async def get_batch(
    batch_id: str,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    batch = await asyncio.to_thread(db.get_batch, str(user["id"]), batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch analysis not found.")
    if isinstance(batch.get("insights"), str):
        try:
            batch["insights"] = json.loads(batch["insights"])
        except ValueError:
            batch["insights"] = {}
    games = await asyncio.to_thread(
        db.list_analyses_by_batch, str(user["id"]), batch_id
    )
    for game in games:
        if isinstance(game.get("insights"), str):
            try:
                game["insights"] = json.loads(game["insights"])
            except ValueError:
                game["insights"] = {}
    return {"batch": batch, "games": games}


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


REVIEW_COMMENT_MAX_LENGTH = 500
TOP_REVIEWS_LIMIT = 10


class ReviewRequest(BaseModel):
    rating: int
    comment: Optional[str] = None


def _validate_review(rating: int, comment: Optional[str]) -> Optional[str]:
    if rating < 1 or rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5.")
    cleaned = (comment or "").strip()
    if len(cleaned) > REVIEW_COMMENT_MAX_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Comment must be at most {REVIEW_COMMENT_MAX_LENGTH} characters.",
        )
    return cleaned or None


def _review_display_name(user: Dict[str, object]) -> str:
    metadata = user.get("user_metadata")
    if isinstance(metadata, dict):
        name = metadata.get("full_name") or metadata.get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()[:80]
    return "Anonymous player"


def _public_review(row: Dict[str, object], user_id: Optional[str]) -> Dict[str, object]:
    return {
        "id": row.get("id"),
        "rating": row.get("rating"),
        "comment": row.get("comment"),
        "display_name": row.get("display_name") or "Anonymous player",
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "is_mine": bool(user_id) and row.get("user_id") == user_id,
    }


def _review_summary(stats: Dict[str, object]) -> Dict[str, object]:
    count = int(stats.get("review_count") or 0)
    average = stats.get("average_rating")
    return {
        "average": round(float(average), 2) if average is not None else None,
        "count": count,
    }


@app.get("/api/reviews")
async def list_reviews(
    user: Optional[Dict[str, object]] = Depends(get_optional_user),
) -> dict:
    user_id = str(user["id"]) if user else None
    rows = await asyncio.to_thread(db.list_reviews)
    stats = await asyncio.to_thread(db.get_review_stats)
    mine = (
        await asyncio.to_thread(db.get_user_review, user_id) if user_id else None
    )
    comments = [
        _public_review(row, user_id)
        for row in rows
        if str(row.get("comment") or "").strip()
    ][:TOP_REVIEWS_LIMIT]
    return {
        "summary": _review_summary(stats),
        "reviews": comments,
        "mine": _public_review(mine, user_id) if mine else None,
    }


@app.post("/api/reviews")
async def submit_review(
    payload: ReviewRequest,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    comment = _validate_review(payload.rating, payload.comment)
    user_id = str(user["id"])
    row = await asyncio.to_thread(
        db.upsert_review,
        user_id,
        payload.rating,
        comment,
        _review_display_name(user),
    )
    stats = await asyncio.to_thread(db.get_review_stats)
    return {
        "review": _public_review(row, user_id),
        "summary": _review_summary(stats),
    }


@app.get("/api/account/usage")
async def account_usage(
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    usage = await asyncio.to_thread(db.get_usage, str(user["id"]))
    return _usage_payload(usage)


@app.post("/api/account/claim-guest-trial")
async def claim_guest_trial(
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    """Count the guest trial against the account once, after sign-in.

    Idempotent: repeat calls never deduct more than one credit.
    """
    await asyncio.to_thread(db.claim_guest_trial, str(user["id"]))
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
    await asyncio.to_thread(db.reset_analysis_usage, str(user["id"]))
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
    usage_payload = _usage_payload(usage)
    if not usage_payload["qna_enabled"]:
        if usage_payload["plan"] == "paid":
            raise HTTPException(
                status_code=402,
                detail=_limit_reached_detail(
                    "qna",
                    usage_payload.get("current_period_end"),
                    usage_payload["paid_analysis_limit"],
                ),
            )
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
