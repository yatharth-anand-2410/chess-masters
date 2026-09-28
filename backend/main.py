from __future__ import annotations

import asyncio
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

from services import analyzer, db, engine, extractor, recommendations

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
    plan = usage.get("plan", "free")
    used = int(usage.get("analyses_used", 0))
    limit = int(usage.get("free_analysis_limit", db.FREE_ANALYSIS_LIMIT))
    remaining = None if plan == "paid" else max(0, limit - used)
    return {
        "plan": plan,
        "analyses_used": used,
        "free_analysis_limit": limit,
        "analyses_remaining": remaining,
        "qna_enabled": plan == "paid",
    }


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
    if usage.get("plan") != "paid":
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