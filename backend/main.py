from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import AsyncIterator, Deque, Dict, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from google import genai
from google.genai import errors as genai_errors
from pydantic import BaseModel

from services import (
    analyzer,
    batch_insights,
    billing,
    coach,
    copilot,
    db,
    draws,
    engine,
    extractor,
    progress,
    puzzles,
    recommendations,
    scouting,
    studies,
    telemetry,
)

from pathlib import Path

_backend_env = Path(__file__).resolve().parent / ".env"
if _backend_env.exists():
    load_dotenv(_backend_env)
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


@app.exception_handler(db.AuthError)
async def _auth_error_handler(_request: Request, exc: db.AuthError) -> JSONResponse:
    """Turn deployment gaps into readable setup errors.

    A missing migration or Supabase configuration is an operator problem, not
    an anonymous 500: the message (e.g. "run migration 0012...") is safe to
    show and tells whoever deployed exactly what to do.
    """
    logger.error("Database access failed: %s", exc)
    return JSONResponse(status_code=503, content={"detail": str(exc)})

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
        "coach": (
            "Coach mode, student rosters and share links are available with "
            "the Master Coach plan."
        ),
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

# Attempt-a-move validation runs Stockfish for every legal attempt, so signed-in
# players are throttled per account. The window is deliberately generous: a
# person drilling a position makes a handful of tries a minute, not hundreds.
ATTEMPT_RATE_LIMIT_CALLS = 30
ATTEMPT_RATE_LIMIT_WINDOW_SECONDS = 60.0

_attempt_call_times: Dict[str, Deque[float]] = {}


def _enforce_attempt_rate_limit(user_id: str) -> None:
    """Sliding-window throttle for drill validation, keyed per account.

    State lives in-process, so with multiple workers the effective limit is per
    worker; that is sufficient to stop a single client from hammering the board
    while keeping the implementation dependency-free.
    """
    now = time.monotonic()
    cutoff = now - ATTEMPT_RATE_LIMIT_WINDOW_SECONDS
    bucket = _attempt_call_times.setdefault(user_id, deque())
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= ATTEMPT_RATE_LIMIT_CALLS:
        raise HTTPException(
            status_code=429,
            detail="Too many move checks in a row. Please pause a moment and try again.",
        )
    bucket.append(now)


# Public share pages are unauthenticated, so they are throttled per IP. The
# window is generous (a parent reading reports makes a handful of calls) and
# exists to stop a token from being hammered.
SHARED_RATE_LIMIT_CALLS = 120
SHARED_RATE_LIMIT_WINDOW_SECONDS = 60.0

_shared_call_times: Dict[str, Deque[float]] = {}


def _enforce_shared_rate_limit(ip: str) -> None:
    key = ip or "unknown"
    now = time.monotonic()
    cutoff = now - SHARED_RATE_LIMIT_WINDOW_SECONDS
    bucket = _shared_call_times.setdefault(key, deque())
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= SHARED_RATE_LIMIT_CALLS:
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please try again in a minute.",
        )
    bucket.append(now)


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
    # The stored tier is what the subscription was bought on; a lapsed account
    # reports "free" so no surface offers a plan it no longer has. A paid row
    # without a stored tier is a pre-0015 row: the original ₹399 plan is the
    # Pro Student tier, which is also what the frontend falls back to.
    stored_tier = str(usage.get("plan_tier") or "").strip().lower()
    if not paid:
        plan_tier = db.PLAN_TIER_FREE
    elif stored_tier in {db.PLAN_TIER_STUDENT, db.PLAN_TIER_COACH}:
        plan_tier = stored_tier
    else:
        plan_tier = db.PLAN_TIER_STUDENT
    return {
        "plan": "paid" if paid else "free",
        "plan_tier": plan_tier,
        "analyses_used": used,
        "free_analysis_limit": free_limit,
        "paid_analysis_limit": paid_limit,
        "analyses_remaining": remaining,
        "qna_enabled": paid and remaining > 0,
        "subscription_status": status,
        "current_period_end": period_end,
    }


async def _usage_payload_with_count(usage: dict, user_id: str) -> dict:
    """Usage payload plus the lifetime analyzed-game count (unlock progress)."""
    payload = _usage_payload(usage)
    payload["total_games_analyzed"] = await asyncio.to_thread(
        db.count_completed_analyses, user_id
    )
    return payload


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


async def _require_student(user_id: str, student_id: str) -> Dict[str, object]:
    """Validate that the signed-in coach owns an active student profile.

    Runs *before* any credit is consumed, so a bad or borrowed id can never
    spend the caller's analyses.
    """
    student = await asyncio.to_thread(db.get_student, user_id, student_id)
    if not student or student.get("archived_at"):
        raise HTTPException(status_code=404, detail="Student not found.")
    return student


def _coach_error(exc: coach.CoachError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


async def _require_coach_tier(user_id: str) -> None:
    """Coach-only features need the Master Coach tier, not just any paid plan."""
    if not await asyncio.to_thread(db.is_coach_plan, user_id):
        raise HTTPException(status_code=402, detail=_upgrade_detail("coach"))


def _subscription_tier(subscription: Optional[dict]) -> str:
    """The tier a stored subscription was bought on.

    Rows created before the tier rollout (or without a plan tier in the
    Razorpay notes) default to Pro Student: the original single plan cost
    ₹399, which is now the student tier.
    """
    row = subscription or {}
    tier = str(row.get("plan_tier") or "").strip().lower()
    return tier if tier in billing.PLANS else billing.DEFAULT_PLAN


def _plan_activation(subscription: Optional[dict]) -> dict:
    """The usage fields a subscription row unlocks on the account."""
    plan = billing.PLANS[_subscription_tier(subscription)]
    return {"plan_tier": plan.id, "paid_analysis_limit": plan.paid_analysis_limit}


def _parse_share_token(token: str) -> str:
    """A share token is always a UUID; anything else is a dead link."""
    try:
        return str(uuid.UUID(token))
    except (AttributeError, TypeError, ValueError):
        raise HTTPException(status_code=404, detail="This share link is not active.")


async def _resolve_share_link(token: str) -> Dict[str, object]:
    parsed = _parse_share_token(token)
    row = await asyncio.to_thread(db.get_share_link, parsed)
    if not coach.is_share_usable(row):
        raise HTTPException(status_code=404, detail="This share link is not active.")
    return row


# --- Share items: study / tactic links a coach hands to a student ----------

SHARE_ITEM_KINDS = {"study", "tactic"}
SHARE_ITEM_KEY_MAX = 200
SHARE_ITEM_TITLE_MAX = 200
SHARE_ITEM_SUBTITLE_MAX = 300
SHARE_ITEM_URL_MAX = 500


def _clean_share_text(value: Optional[str], max_length: int) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        return None
    return text[:max_length]


def _require_share_text(value: Optional[str], max_length: int, field: str) -> str:
    text = _clean_share_text(value, max_length)
    if not text:
        raise HTTPException(status_code=400, detail=f"{field} is required.")
    return text


def _clean_share_url(value: Optional[str]) -> Optional[str]:
    """Keep the shared destination to an http(s) link or nothing at all."""
    text = _clean_share_text(value, SHARE_ITEM_URL_MAX)
    if text is None:
        return None
    if not re.match(r"^https?://", text, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="url must be an http(s) link.")
    return text


def _share_item_payload(
    item: Dict[str, object],
    student: Optional[Dict[str, object]] = None,
    view_count: Optional[int] = None,
) -> Dict[str, object]:
    """The public payload for one study/tactic share.

    Both shapes the frontend may read are present: the nested ``item`` object
    and the same fields flattened at the top level. ``student`` is the shared
    student (display name and handles only) or ``None`` for an open link.
    """
    kind = str(item.get("kind") or "study")
    count = int(
        view_count if view_count is not None else item.get("view_count") or 0
    )
    title = item.get("title")
    subtitle = item.get("subtitle")
    url = item.get("url")
    return {
        "kind": kind,
        "item": {
            "kind": kind,
            "item_key": item.get("item_key"),
            "title": title,
            "subtitle": subtitle,
            "url": url,
            "view_count": count,
        },
        "title": title,
        "subtitle": subtitle,
        "url": url,
        "view_count": count,
        "student": coach.student_public_payload(student) if student else None,
    }


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


class AnalysisRequest(BaseModel):
    platform: str
    game_url: str
    username: Optional[str] = None
    player_color: Optional[str] = None
    # Coach mode: run the analysis on behalf of one of the coach's students.
    student_id: Optional[str] = None


@app.post("/api/stream-analysis")
async def stream_analysis(
    payload: AnalysisRequest,
    request: Request,
    user: Optional[Dict[str, object]] = Depends(get_optional_user),
) -> StreamingResponse:
    user_id = str(user["id"]) if user else None
    student_id = (payload.student_id or "").strip() or None
    if student_id:
        if user_id is None:
            raise HTTPException(
                status_code=401,
                detail="Sign in to analyze games for a student.",
            )
        await _require_student(user_id, student_id)
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
                            "student_id": student_id,
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
                "verdict": telemetry.extract_verdict(report_markdown),
            }
            if user_id and analysis_id:
                game_summary = await asyncio.to_thread(
                    telemetry.build_game_summary,
                    analysis=analysis,
                    engine_data=engine_data,
                    player_color=game.player_color,
                    username=payload.username,
                    platform=game.platform,
                    pgn=game.pgn,
                )
                replay = await asyncio.to_thread(
                    telemetry.build_replay,
                    analysis=analysis,
                    engine_data=engine_data,
                    player_color=game.player_color,
                    pgn=game.pgn,
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
                        "report_markdown": report_markdown,
                        "insights": insights_payload,
                        "game_summary": game_summary,
                        "replay": replay,
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
                    "usage": (
                        await _usage_payload_with_count(usage, user_id)
                        if usage
                        else None
                    ),
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
    # Coach mode: run the whole batch on behalf of one of the coach's students.
    student_id: Optional[str] = None


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
    student_id = (payload.student_id or "").strip() or None
    if student_id:
        await _require_student(user_id, student_id)
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
        game_error_messages: list[str] = []
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
                    "student_id": student_id,
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
                            "student_id": student_id,
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

                    game_summary = await asyncio.to_thread(
                        telemetry.build_game_summary,
                        analysis=analysis,
                        engine_data=engine_data,
                        player_color=game.player_color,
                        username=payload.username,
                        platform=game.platform,
                        pgn=game.pgn,
                    )
                    replay = await asyncio.to_thread(
                        telemetry.build_replay,
                        analysis=analysis,
                        engine_data=engine_data,
                        player_color=game.player_color,
                        pgn=game.pgn,
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
                            "game_summary": game_summary,
                            "replay": replay,
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
                    game_error_messages.append(str(exc))
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
                    generic_message = "This game could not be analyzed."
                    game_error_messages.append(generic_message)
                    yield sse_event(
                        "game_error",
                        {
                            "index": index,
                            "message": generic_message,
                        },
                    )

            if not completed:
                message = (
                    "None of the games could be analyzed. "
                    "Check the links and try again."
                )
                if game_error_messages:
                    message = (
                        f"None of the games could be analyzed. "
                        f"{game_error_messages[0]}"
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
            aggregate["verdict"] = telemetry.extract_verdict(report_markdown)
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
                    "usage": await _usage_payload_with_count(usage, user_id),
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
    mine: bool = False,
    user: Dict[str, object] = Depends(get_current_user),
) -> list[dict]:
    return await asyncio.to_thread(
        db.list_analyses, str(user["id"]), 50, standalone, mine
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


@app.get("/api/analyses/{analysis_id}/replay")
async def get_analysis_replay(
    analysis_id: str,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    """Serve one game's stored move-by-move replay.

    The replay JSON is large, so it never rides along with the list or the
    report read; the row's ``replay_available`` flag tells the UI whether this
    call is worth making.
    """
    row = await asyncio.to_thread(
        db.get_analysis_replay, str(user["id"]), analysis_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    replay = row.get("replay")
    if isinstance(replay, str):
        try:
            replay = json.loads(replay)
        except ValueError:
            replay = None
    if not replay:
        raise HTTPException(
            status_code=404,
            detail=(
                "This game has no stored replay. Replays are captured for "
                "games analyzed after the replay rollout."
            ),
        )
    return {**replay, "analysis_id": analysis_id, "replay_available": True}


class AttemptRequest(BaseModel):
    fen: str
    played: str
    eval_before_pawns: Optional[float] = None


@app.post("/api/analyses/{analysis_id}/attempt")
async def evaluate_analysis_attempt(
    analysis_id: str,
    payload: AttemptRequest,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    """Grade a replay-your-mistake attempt with a real engine evaluation.

    Requires auth and ownership of the analysis: the drills live behind sign-in
    and this call spends CPU on Stockfish, so an anonymous or borrowed id must
    not reach it. The analysis row is only used to authorise the request; the
    position itself comes from the moment the client is already showing.
    """
    analysis = await asyncio.to_thread(db.get_analysis, str(user["id"]), analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found.")

    fen = payload.fen.strip()
    played = payload.played.strip()
    if not fen or not played:
        raise HTTPException(
            status_code=400, detail="Both fen and played are required."
        )

    _enforce_attempt_rate_limit(str(user["id"]))
    return await asyncio.to_thread(
        engine.evaluate_attempt,
        fen,
        played,
        eval_before_pawns=payload.eval_before_pawns,
    )


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
    try:
        rows = await asyncio.to_thread(db.list_reviews)
    except Exception as exc:
        logger.warning("Failed to list reviews from database: %s", exc)
        rows = []
    try:
        stats = await asyncio.to_thread(db.get_review_stats)
    except Exception as exc:
        logger.warning("Failed to get review stats from database: %s", exc)
        stats = {}
    try:
        mine = (
            await asyncio.to_thread(db.get_user_review, user_id) if user_id else None
        )
    except Exception as exc:
        logger.warning("Failed to get user review from database: %s", exc)
        mine = None
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
    return await _usage_payload_with_count(usage, str(user["id"]))


@app.post("/api/account/claim-guest-trial")
async def claim_guest_trial(
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    """Count the guest trial against the account once, after sign-in.

    Idempotent: repeat calls never deduct more than one credit.
    """
    await asyncio.to_thread(db.claim_guest_trial, str(user["id"]))
    usage = await asyncio.to_thread(db.get_usage, str(user["id"]))
    return await _usage_payload_with_count(usage, str(user["id"]))


# ---------------------------------------------------------------------------
# Coach mode: role choice, student rosters, and share links.
# ---------------------------------------------------------------------------


class ProfileRequest(BaseModel):
    role: str


@app.get("/api/account/profile")
async def get_account_profile(
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    row = await asyncio.to_thread(db.get_user_profile, str(user["id"]))
    return {"role": (row or {}).get("role")}


@app.put("/api/account/profile")
async def set_account_profile(
    payload: ProfileRequest,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    try:
        role = coach.validate_role(payload.role)
    except coach.CoachError as exc:
        raise _coach_error(exc) from exc
    row = await asyncio.to_thread(db.upsert_user_profile, str(user["id"]), role)
    return {"role": row.get("role", role)}


class StudentCreateRequest(BaseModel):
    display_name: str
    lichess_username: Optional[str] = None
    chesscom_username: Optional[str] = None
    notes: Optional[str] = None


class StudentUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    lichess_username: Optional[str] = None
    chesscom_username: Optional[str] = None
    notes: Optional[str] = None


@app.get("/api/coach/students")
async def list_coach_students(
    user: Dict[str, object] = Depends(get_current_user),
) -> list[dict]:
    user_id = str(user["id"])
    students = await asyncio.to_thread(db.list_students, user_id)
    student_ids = [str(row["id"]) for row in students if row.get("id")]
    activity = await asyncio.to_thread(db.list_student_activity, user_id, student_ids)
    return coach.roster_payload(students, activity)


@app.post("/api/coach/students")
async def create_coach_student(
    payload: StudentCreateRequest,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    user_id = str(user["id"])
    await _require_coach_tier(user_id)

    try:
        data = {
            "display_name": coach.clean_display_name(payload.display_name),
            "lichess_username": coach.clean_username(payload.lichess_username),
            "chesscom_username": coach.clean_username(payload.chesscom_username),
            "notes": coach.clean_notes(payload.notes),
        }
    except coach.CoachError as exc:
        raise _coach_error(exc) from exc
    row = await asyncio.to_thread(db.create_student, user_id, data)
    return coach.student_payload(row)


@app.get("/api/coach/students/{student_id}")
async def get_coach_student(
    student_id: str,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    user_id = str(user["id"])
    student = await asyncio.to_thread(db.get_student, user_id, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")
    analyses, batches, share_row = await asyncio.gather(
        asyncio.to_thread(db.list_analyses_by_student, user_id, student_id),
        asyncio.to_thread(db.list_batches_by_student, user_id, student_id),
        asyncio.to_thread(db.get_active_share_link, user_id, student_id),
    )
    return {
        "student": coach.student_payload(student),
        "analyses": analyses,
        "batches": batches,
        "share": coach.share_status(share_row),
    }


@app.get("/api/coach/students/{student_id}/progress", response_model=None)
async def coach_student_progress(
    student_id: str,
    speeds: Optional[str] = None,
    days: Optional[int] = None,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    """Longitudinal progress for one of the coach's students.

    ``speeds`` is a comma-separated speed filter and ``days`` a rolling window;
    both are optional and both are forwarded to the progress service.
    Ownership is validated before any data is read.
    """
    user_id = str(user["id"])
    await _require_student(user_id, student_id)
    try:
        return await asyncio.to_thread(
            progress.build_student_progress,
            student_id,
            coach_id=user_id,
            speeds=_parse_speeds(speeds),
            days=_parse_days(days),
        )
    except db.AuthError:
        # A deployment gap (for example the 0014 telemetry migration) is not a
        # 500: let the app-wide handler turn it into the setup hint.
        raise
    except Exception as exc:
        logger.exception(
            "Unexpected error building progress for student %s", student_id
        )
        raise HTTPException(
            status_code=500, detail=f"Failed to load student progress: {exc}"
        )


@app.patch("/api/coach/students/{student_id}")
async def update_coach_student(
    student_id: str,
    payload: StudentUpdateRequest,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    user_id = str(user["id"])
    student = await asyncio.to_thread(db.get_student, user_id, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")
    provided = payload.model_dump(exclude_unset=True)
    updates: Dict[str, object] = {}
    try:
        if "display_name" in provided:
            updates["display_name"] = coach.clean_display_name(provided["display_name"])
        if "lichess_username" in provided:
            updates["lichess_username"] = coach.clean_username(
                provided["lichess_username"]
            )
        if "chesscom_username" in provided:
            updates["chesscom_username"] = coach.clean_username(
                provided["chesscom_username"]
            )
        if "notes" in provided:
            updates["notes"] = coach.clean_notes(provided["notes"])
    except coach.CoachError as exc:
        raise _coach_error(exc) from exc
    if updates:
        await asyncio.to_thread(db.update_student, user_id, student_id, updates)
    return coach.student_payload({**student, **updates})


@app.delete("/api/coach/students/{student_id}")
async def archive_coach_student(
    student_id: str,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    """Archive (soft delete): analyses and share links survive.

    The roster hides archived students, but their history is never lost.
    """
    user_id = str(user["id"])
    student = await asyncio.to_thread(db.get_student, user_id, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")
    await asyncio.to_thread(
        db.update_student, user_id, student_id, {"archived_at": _now_value()}
    )
    return {"archived": True}


@app.post("/api/coach/students/{student_id}/share")
async def create_student_share(
    student_id: str,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    """Return the active share link, creating one if none exists.

    Revoking is the rotation mechanism: stop sharing, share again, and the new
    link carries a fresh token.
    """
    user_id = str(user["id"])
    await _require_coach_tier(user_id)

    student = await asyncio.to_thread(db.get_student, user_id, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")
    existing = await asyncio.to_thread(db.get_active_share_link, user_id, student_id)
    if existing:
        return coach.share_status(existing)
    row = await asyncio.to_thread(db.create_share_link, user_id, student_id)
    return coach.share_status(row)


@app.delete("/api/coach/students/{student_id}/share")
async def revoke_student_share(
    student_id: str,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    user_id = str(user["id"])
    student = await asyncio.to_thread(db.get_student, user_id, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")
    await asyncio.to_thread(db.revoke_share_links, user_id, student_id)
    return {"active": False}


# ---------------------------------------------------------------------------
# Share items: study / tactic homework that opens with no sign-in (/s/{token}).
# ---------------------------------------------------------------------------


class ShareItemRequest(BaseModel):
    kind: str
    item_key: str
    title: str
    subtitle: Optional[str] = None
    url: Optional[str] = None
    student_id: Optional[str] = None


@app.post("/api/share/items")
async def create_share_item_endpoint(
    payload: ShareItemRequest,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    """Create a no-sign-in link for one study or tactic theme.

    Coach-tier only: the link itself is public, but only Master Coach accounts
    hand homework out. The optional student keeps the link in that student's
    list while the URL stays the same for anyone who has it.
    """
    user_id = str(user["id"])
    await _require_coach_tier(user_id)

    kind = str(payload.kind or "").strip().lower()
    if kind not in SHARE_ITEM_KINDS:
        raise HTTPException(
            status_code=400,
            detail="kind must be 'study' or 'tactic'.",
        )
    item_key = _require_share_text(payload.item_key, SHARE_ITEM_KEY_MAX, "item_key")
    title = _require_share_text(payload.title, SHARE_ITEM_TITLE_MAX, "title")
    subtitle = _clean_share_text(payload.subtitle, SHARE_ITEM_SUBTITLE_MAX)
    url = _clean_share_url(payload.url)

    student_id = (payload.student_id or "").strip() or None
    if student_id:
        student = await asyncio.to_thread(db.get_student, user_id, student_id)
        if not student or student.get("archived_at"):
            raise HTTPException(status_code=404, detail="Student not found.")

    row = await asyncio.to_thread(
        db.create_share_item,
        user_id,
        {
            "student_id": student_id,
            "kind": kind,
            "item_key": item_key,
            "title": title,
            "subtitle": subtitle,
            "url": url,
        },
    )
    token = str(row.get("token") or "")
    if not token:
        raise HTTPException(
            status_code=503, detail="Could not create the share link. Please try again."
        )
    return {"token": token, "url_path": f"/s/{token}", "view_count": 0}


@app.get("/api/coach/students/{student_id}/shares")
async def list_student_shares(
    student_id: str,
    include_all: bool = Query(False, alias="all"),
    user: Dict[str, object] = Depends(get_current_user),
) -> list[dict]:
    """The coach's active share items for one student (``?all=true`` for every item).

    ``?all=true`` also returns the links that were created without a student —
    "anyone with the link" homework the coach may want to reuse.
    """
    user_id = str(user["id"])
    await _require_coach_tier(user_id)

    student = await asyncio.to_thread(db.get_student, user_id, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")
    rows = await asyncio.to_thread(
        db.list_share_items,
        user_id,
        None if include_all else student_id,
    )
    student_name = str(student.get("display_name") or "").strip() or None
    return [
        {
            "token": row.get("token"),
            "kind": row.get("kind"),
            "item_key": row.get("item_key"),
            "title": row.get("title"),
            "subtitle": row.get("subtitle"),
            "url": row.get("url"),
            "student_id": row.get("student_id"),
            "student_name": student_name if row.get("student_id") else None,
            "view_count": int(row.get("view_count") or 0),
            "created_at": row.get("created_at"),
            "revoked_at": row.get("revoked_at"),
        }
        for row in rows
    ]


@app.delete("/api/share/items/{token}")
async def revoke_share_item_endpoint(
    token: str,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    """Revoke one share item. Idempotent, and never reveals another coach's rows.

    Revoking stays available even when the subscription has lapsed: closing a
    link the coach no longer wants open must not require paying again.
    """
    user_id = str(user["id"])
    parsed = _parse_share_token(token)
    closed = await asyncio.to_thread(db.revoke_share_item, user_id, parsed)
    return {"token": parsed, "revoked": True, "already_revoked": not closed}


# ---------------------------------------------------------------------------
# Public share pages: no auth, unguessable token, read-only, rate limited.
# ---------------------------------------------------------------------------


@app.get("/api/shared/{token}")
async def shared_student(
    token: str,
    request: Request,
) -> dict:
    _enforce_shared_rate_limit(_client_ip(request))
    parsed = _parse_share_token(token)

    # Study / tactic shares live in their own table and win the lookup; a token
    # that is not there at all keeps the original student-report behaviour.
    try:
        item = await asyncio.to_thread(db.get_share_item, parsed)
    except db.AuthError as exc:
        # A deployment gap (0016_share_items.sql not run yet) must not take the
        # student-report portal down: log it and fall through to share_links.
        logger.warning("Share items unavailable, serving share links only: %s", exc)
        item = None
    if item is not None:
        if item.get("revoked_at"):
            raise HTTPException(
                status_code=404, detail="This share link is not active."
            )
        view_count: Optional[int] = None
        try:
            view_count = await asyncio.to_thread(db.touch_share_item, parsed)
        except Exception:
            logger.exception("Failed to record share item view")
        student_row: Optional[Dict[str, object]] = None
        item_student_id = str(item.get("student_id") or "").strip()
        if item_student_id:
            student_row = await asyncio.to_thread(
                db.get_student_by_id, item_student_id
            )
        return _share_item_payload(item, student_row, view_count)

    link = await _resolve_share_link(parsed)
    student_id = str(link["student_id"])
    student, analyses, batches = await asyncio.gather(
        asyncio.to_thread(db.get_student_by_id, student_id),
        asyncio.to_thread(db.list_public_analyses, student_id),
        asyncio.to_thread(db.list_public_batches, student_id),
    )
    if not student:
        raise HTTPException(status_code=404, detail="This share link is not active.")
    try:
        await asyncio.to_thread(db.touch_share_link, str(link["token"]))
    except Exception:
        logger.exception("Failed to record share link view")
    return {
        "student": coach.student_public_payload(student),
        "analyses": [coach.analysis_summary(row) for row in analyses],
        "batches": [coach.batch_summary(row) for row in batches],
    }


@app.get("/api/shared/{token}/analyses/{analysis_id}")
async def shared_report(
    token: str,
    analysis_id: str,
    request: Request,
) -> dict:
    _enforce_shared_rate_limit(_client_ip(request))
    link = await _resolve_share_link(token)
    student_id = str(link["student_id"])
    analysis = await asyncio.to_thread(
        db.get_analysis_for_student, student_id, analysis_id
    )
    if (
        not analysis
        or analysis.get("status") != "completed"
        or not analysis.get("report_markdown")
    ):
        raise HTTPException(status_code=404, detail="Report not found.")
    student = await asyncio.to_thread(db.get_student_by_id, student_id)
    return {
        "student": coach.student_public_payload(student or {}),
        "analysis": coach.analysis_public_payload(analysis),
    }


@app.get("/api/shared/{token}/batches/{batch_id}")
async def shared_batch_report(
    token: str,
    batch_id: str,
    request: Request,
) -> dict:
    _enforce_shared_rate_limit(_client_ip(request))
    link = await _resolve_share_link(token)
    student_id = str(link["student_id"])
    batch = await asyncio.to_thread(db.get_batch_for_student, student_id, batch_id)
    if (
        not batch
        or batch.get("status") != "completed"
        or not batch.get("report_markdown")
    ):
        raise HTTPException(status_code=404, detail="Report not found.")
    student = await asyncio.to_thread(db.get_student_by_id, student_id)
    return {
        "student": coach.student_public_payload(student or {}),
        "batch": coach.batch_public_payload(batch),
    }


class BillingVerifyRequest(BaseModel):
    razorpay_payment_id: str
    razorpay_subscription_id: str
    razorpay_signature: str


class SubscriptionRequest(BaseModel):
    plan: Optional[str] = None


@app.get("/api/billing/config")
async def billing_config(
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    """The client-safe checkout config: key id plus both tiers, never a secret."""
    return billing.public_config()


@app.post("/api/billing/subscription")
async def create_billing_subscription(
    payload: Optional[SubscriptionRequest] = None,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    """Start a Razorpay checkout for one tier (default: Pro Student)."""
    user_id = str(user["id"])
    try:
        plan_id = billing.resolve_plan_id(payload.plan if payload else None)
    except billing.UnknownPlanError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not billing.configured(plan_id):
        raise _billing_error(
            billing.BillingError(
                "Razorpay is not configured for the "
                f"{billing.PLANS[plan_id].label} plan on the server."
            )
        )

    existing = await asyncio.to_thread(db.get_current_subscription, user_id)
    if existing:
        if existing.get("status") in {"created", "pending"}:
            return {
                "subscription_id": existing["razorpay_subscription_id"],
                "key_id": billing.key_id(),
                "plan": _subscription_tier(existing),
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
            plan_id,
        )
        plan = billing.PLANS[plan_id]
        await asyncio.to_thread(
            db.create_subscription,
            user_id,
            {
                "razorpay_subscription_id": subscription["id"],
                "razorpay_plan_id": subscription.get("plan_id", ""),
                "status": subscription.get("status", "created"),
                "plan_tier": plan.id,
                "amount": plan.amount,
                "currency": billing.SUBSCRIPTION_CURRENCY,
            },
        )
    except billing.BillingError as exc:
        raise _billing_error(exc) from exc
    return {
        "subscription_id": subscription["id"],
        "key_id": billing.key_id(),
        "plan": plan_id,
    }


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
    activation = _plan_activation(subscription)
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
        None,
        **activation,
    )
    await asyncio.to_thread(db.reset_analysis_usage, str(user["id"]))
    return {"status": "authenticated", "plan": activation["plan_tier"]}


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
    activation = _plan_activation(subscription)
    await asyncio.to_thread(
        db.set_paid_access,
        str(user["id"]),
        db.is_paid_plan("paid", status, period_end),
        status,
        period_end,
        **activation,
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
    activation = _plan_activation(subscription)
    await asyncio.to_thread(
        db.set_paid_access,
        str(user["id"]),
        db.is_paid_plan("paid", status, period_end),
        status,
        period_end,
        **activation,
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

    # The tier travels in the Razorpay notes from the moment checkout starts,
    # which is the only tier signal available to events that arrive before the
    # local row was ever updated.
    notes = entity.get("notes") if isinstance(entity.get("notes"), dict) else {}
    noted_tier = str(notes.get("plan_tier") or "").strip().lower()
    tier = noted_tier if noted_tier in billing.PLANS else _subscription_tier(subscription)

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
    # Persist the tier when the row exists but predates the column value; the
    # key check keeps pre-0015 deployments from failing on an unknown column.
    if "plan_tier" in subscription and not str(subscription.get("plan_tier") or "").strip():
        updates["plan_tier"] = tier
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
            **_plan_activation({"plan_tier": tier}),
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


# =============================================================================
# Draw Classification & Eval Swings
# =============================================================================


@app.post("/api/draws/classify", response_model=draws.DrawClassificationResult)
async def classify_draw_endpoint(
    payload: draws.DrawClassifyRequest,
) -> draws.DrawClassificationResult:
    """Classify a draw into 4 tactical/psychological quadrants with swing analysis."""
    try:
        return await asyncio.to_thread(draws.classify_draw, payload)
    except Exception as exc:
        logger.exception("Error classifying draw")
        raise HTTPException(status_code=400, detail=f"Could not classify draw: {exc}")


# =============================================================================
# Lichess Studies Import
# =============================================================================


@app.get("/api/studies/import/{study_id}", response_model=studies.StudyImportResponse)
async def import_study_endpoint(study_id: str) -> studies.StudyImportResponse:
    """Import and parse a Lichess study with visual annotations and branches."""
    try:
        return await asyncio.to_thread(studies.import_lichess_study, study_id)
    except studies.StudyNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except (studies.StudyFetchError, studies.StudyParseError) as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as exc:
        logger.exception("Unexpected error importing Lichess study %s", study_id)
        raise HTTPException(status_code=500, detail=f"Internal error importing study: {exc}")


# =============================================================================
# Tactical Catalog & Curated Studies
# =============================================================================

# Personalization reads a bounded slice of the newest games: the catalog must
# stay fast, and the newest analyses are the ones that reflect the leaks.
TACTICS_SCAN_LIMIT = 25
CURATED_SCAN_LIMIT = 30


@app.get("/api/tactics")
async def tactics_catalog(
    user: Optional[Dict[str, object]] = Depends(get_optional_user),
) -> dict:
    """Every motif the analyzer can name, with its Lichess training links.

    Signed-out visitors get the plain catalog. A valid bearer token adds the
    real ``observed_count`` per theme, counted from the motifs stored in the
    caller's recent analyses; a database problem degrades to the plain catalog
    instead of failing this public page.
    """
    rows: Optional[list[dict]] = None
    if user and db.configured():
        try:
            rows = await asyncio.to_thread(
                db.list_analyses, str(user["id"]), TACTICS_SCAN_LIMIT
            )
        except Exception as exc:
            logger.warning("Tactics catalog: could not read recent analyses: %s", exc)
            rows = []
    return await asyncio.to_thread(puzzles.build_tactics_catalog, rows)


@app.get("/api/studies/curated")
async def curated_studies(
    student_id: Optional[str] = None,
    user: Optional[Dict[str, object]] = Depends(get_optional_user),
) -> list[dict]:
    """Studies derived from the real leaks of the analyzed games.

    Signed out there is nothing personal to derive, so the list is empty. A
    coach can pass ``student_id`` to personalize for one of their students
    (ownership is validated before any analysis is read).
    """
    if not user:
        return []
    user_id = str(user["id"])
    requested_student = (student_id or "").strip() or None
    if requested_student:
        student = await asyncio.to_thread(db.get_student, user_id, requested_student)
        if not student or student.get("archived_at"):
            raise HTTPException(status_code=404, detail="Student not found.")
    try:
        if requested_student:
            rows = await asyncio.to_thread(
                db.list_analyses_by_student,
                user_id,
                requested_student,
                CURATED_SCAN_LIMIT,
            )
        else:
            rows = await asyncio.to_thread(
                db.list_analyses, user_id, CURATED_SCAN_LIMIT
            )
        return await asyncio.to_thread(studies.build_curated_studies, rows)
    except db.AuthError:
        # A deployment gap is a setup hint, not a 500.
        raise
    except Exception as exc:
        logger.exception("Failed to build curated studies for user %s", user_id)
        raise HTTPException(
            status_code=500, detail=f"Failed to load curated studies: {exc}"
        )


# =============================================================================
# Opponent Scouting Dossier
# =============================================================================


@app.get("/api/scout/{username}", response_model=scouting.ScoutingDossier)
async def scout_opponent_endpoint(
    username: str,
    platform: Optional[str] = "lichess",
    max_games: Optional[int] = 50,
) -> scouting.ScoutingDossier:
    """Generate an opponent scouting dossier with repertoire tree and clock vulnerability."""
    cleaned = (username or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Opponent username is required.")
    limit = max(5, min(100, max_games or 50))
    try:
        return await asyncio.to_thread(
            scouting.generate_scouting_dossier,
            cleaned,
            platform=platform or "lichess",
            max_games=limit,
        )
    except Exception as exc:
        logger.exception("Unexpected error scouting opponent %s", username)
        raise HTTPException(status_code=500, detail=f"Failed to generate scouting dossier: {exc}")


# =============================================================================
# Longitudinal Student Progress & 3-Pillar Mastery
# =============================================================================

# Speed buckets accepted by the progress filters, mirroring SpeedBucket in
# frontend/lib/api.ts.
PROGRESS_SPEEDS = {
    telemetry.SPEED_BULLET,
    telemetry.SPEED_BLITZ,
    telemetry.SPEED_RAPID,
    telemetry.SPEED_CLASSICAL,
    telemetry.SPEED_CORRESPONDENCE,
}


def _parse_speeds(raw: Optional[str]) -> Optional[list[str]]:
    """Parse the `speeds` query value into a validated filter, or None.

    Unknown tokens (a typo, or a platform label like Chess.com's "daily") are
    dropped so the report degrades to "all games" instead of pretending the
    player has none.
    """
    if not raw:
        return None
    requested = [token.strip().lower() for token in raw.split(",")]
    speeds = [
        speed for speed in dict.fromkeys(requested) if speed in PROGRESS_SPEEDS
    ]
    return speeds or None


def _parse_days(raw: Optional[int]) -> Optional[int]:
    """A positive rolling window in days, or None for all time."""
    if raw is None or raw <= 0:
        return None
    return raw


@app.get("/api/progress", response_model=None)
async def get_own_progress(
    speeds: Optional[str] = None,
    days: Optional[int] = None,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    """Longitudinal progress for the signed-in player's own games.

    Built from the per-game telemetry captured since 0014_game_telemetry.sql;
    the progress service reports ``insufficient`` whenever fewer than four
    games match the filter. Its typed report is passed through unfiltered so
    every panel field the frontend codes against survives.
    """
    user_id = str(user["id"])
    try:
        return await asyncio.to_thread(
            progress.build_student_progress,
            user_id,
            coach_id=None,
            speeds=_parse_speeds(speeds),
            days=_parse_days(days),
        )
    except db.AuthError:
        # A deployment gap (for example the 0014 telemetry migration) is not a
        # 500: let the app-wide handler turn it into the setup hint.
        raise
    except Exception as exc:
        logger.exception("Unexpected error building progress for user %s", user_id)
        raise HTTPException(
            status_code=500, detail=f"Failed to load progress: {exc}"
        )


@app.get("/api/student/{student_id}/progress", response_model=progress.StudentProgressReport)
async def get_student_progress_endpoint(
    student_id: str,
    user: Optional[Dict[str, object]] = Depends(get_optional_user),
) -> progress.StudentProgressReport:
    """Generate longitudinal student progress with 3-pillar mastery and ACPL drift."""
    cleaned = (student_id or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Student ID is required.")
    coach_id = str(user["id"]) if user else None
    try:
        return await asyncio.to_thread(progress.build_student_progress, cleaned, coach_id=coach_id)
    except Exception as exc:
        logger.exception("Unexpected error building progress for student %s", student_id)
        raise HTTPException(status_code=500, detail=f"Failed to load student progress: {exc}")


# =============================================================================
# Context-Aware AI Coach Copilot Query
# =============================================================================


@app.post("/api/copilot/query", response_model=copilot.CopilotQueryResponse)
async def copilot_query_endpoint(
    payload: copilot.CopilotQueryRequest,
    user: Optional[Dict[str, object]] = Depends(get_optional_user),
) -> copilot.CopilotQueryResponse:
    """Context-aware AI coach query anchored to student data and blunder motifs."""
    query = payload.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    # Inject user_id if not explicitly provided
    if not payload.user_id and user:
        payload.user_id = str(user["id"])

    # Obtain Gemini client if configured, otherwise None (fallback handles gracefully)
    client: Optional[genai.Client] = None
    try:
        client = get_client()
    except Exception:
        pass

    try:
        return await copilot.answer_copilot_query(payload, client=client)
    except Exception as exc:
        logger.exception("Unexpected error in copilot query")
        raise HTTPException(status_code=500, detail=f"Copilot query failed: {exc}")

