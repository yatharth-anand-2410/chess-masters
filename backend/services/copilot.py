"""Context-Aware AI Coach Copilot Service.

Provides intelligent, personalized chess coaching responses anchored to:
1. Student longitudinal progress data (3-Pillar mastery leaks, ACPL drift, persona).
2. Live or analyzed game context (specific blunder moments, evaluations, openings).
3. Board FEN and tactical motif detection (pins, forks, skewers, back-rank weaknesses).
4. Concrete psychological guidance (time trouble panic, tilt prevention, advantage conversion).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import chess
from google import genai
from google.genai import errors, types
from pydantic import BaseModel, Field

from services import db, motifs, progress

logger = logging.getLogger("uvicorn.error")

DEFAULT_MODEL = "gemini-3.1-flash-lite"

COPILOT_SYSTEM_INSTRUCTION = """You are the Senior AI Chess Coach on Chessmasters, calibrated with Parth's psychological chess pedagogy.
Your communication philosophy is Quiet Mastery: direct, tactile, non-condescending, authoritative, and deeply grounded in real chess telemetry.

Core Rules:
1. Ground your advice in the provided student context, blunder motifs, clock profile, and board position. Never offer vague, generic platitudes.
2. If tactical motifs are detected (such as pins, forks, or back-rank weakness), explain the exact geometric relationship and how the student should calculate it.
3. If psychological or clock patterns are mentioned (e.g., sub-30s clock panic, premature queen trades, or tilt after a blunder), provide concrete behavioral rules ("Do" and "Don't").
4. Keep explanations concise, practical, and punchy. Maximum 2 to 4 focused paragraphs with actionable bullet points.
5. Do not invent non-existent moves or hallucinate engine numbers. Speak in chess concepts: king safety, piece coordination, tension preservation, flight squares.
"""


# --- Pydantic Models ---


class CopilotQueryRequest(BaseModel):
    query: str = Field(..., description="Student or coach query string")
    student_id: Optional[str] = Field(None, description="Student profile ID for longitudinal context")
    user_id: Optional[str] = Field(None, description="Authenticated user ID")
    analysis_id: Optional[str] = Field(None, description="Analysis ID for game-specific anchoring")
    fen: Optional[str] = Field(None, description="Current FEN board string")
    player_color: Optional[str] = Field("white", description="Perspective: 'white' or 'black'")
    motifs: Optional[List[str]] = Field(None, description="Pre-identified motifs")
    recent_context: Optional[Dict[str, Any]] = Field(None, description="Additional context parameters")


class CopilotQueryResponse(BaseModel):
    answer: str = Field(..., description="Authoritative coaching advice")
    motifs_detected: List[str] = Field(default_factory=list, description="Tactical motifs detected in context")
    suggested_actions: List[str] = Field(default_factory=list, description="Concrete next actions or drills")
    anchored_facts: List[str] = Field(default_factory=list, description="Anchored facts cited from user data")
    source: str = Field(..., description="'gemini-coach' or 'heuristic-engine'")
    timestamp: str = Field(..., description="Response generation timestamp")


# --- Heuristic Fallback Generator ---


def _generate_heuristic_answer(
    query: str,
    anchored_facts: List[str],
    detected_motifs: List[str],
    student_report: Optional[progress.StudentProgressReport] = None,
) -> Tuple[str, List[str]]:
    """Produce an expert, domain-grounded response when the AI service is unavailable."""
    q_lower = query.lower()
    answer_parts: List[str] = []
    actions: List[str] = []

    # Opening Inquiry
    if any(k in q_lower for k in ("opening", "repertoire", "e4", "d4", "sicilian", "najdorf")):
        answer_parts.append(
            "When refining your opening repertoire, prioritize structural understanding over rote engine memorization. "
            "Your telemetry shows high stability when you stake out early central territory, but vigilance is required during the transition to the middlegame."
        )
        actions.extend([
            "Review your central pawn break timing (...d5 or ...c5).",
            "Ensure kingside castling is executed before move 12.",
        ])

    # Time Trouble or Blitz Clock Panic
    elif any(k in q_lower for k in ("time", "clock", "blitz", "panic", "rush", "speed")):
        answer_parts.append(
            "Your telemetry highlights severe accuracy decay when your clock drops below 30 seconds. "
            "Under clock pressure, the instinct to blitz moves must be replaced with mechanical discipline: take a full breath, scan your king's flight squares, and play for clean piece coordination rather than desperation swindles."
        )
        actions.extend([
            "Implement a mandatory 3-second pause on every move once your clock reaches < 30s.",
            "Pre-emptively create an escape square ('luft': h3/h6) during move 18-25.",
        ])

    # Blunders & Tactical Leaks
    elif any(k in q_lower for k in ("blunder", "leak", "tactic", "pin", "fork", "mistake", "improve")):
        motifs_str = ", ".join(detected_motifs) if detected_motifs else "pins and deflection"
        answer_parts.append(
            f"Your historical blunder analysis indicates recurring vulnerabilities around {motifs_str}. "
            "Tactical leaks rarely happen in a vacuum; they typically occur when your pieces lose mutual defense or your king lacks flight squares."
        )
        actions.extend([
            "Practice thematic pin-breaking exercises in our tactical curriculum.",
            "Verify all hanging pieces and uncoordinated knights before pushing flank pawns.",
        ])

    # Endgame & Liquidation
    elif any(k in q_lower for k in ("endgame", "trade", "queen", "convert", "winning", "draw")):
        answer_parts.append(
            "Converting advantages requires ruthless liquidation discipline. "
            "Avoid trading queens reflexively unless you have calculated that the resulting king-and-pawn or rook endgame is mathematically won. "
            "Keep pieces active to restrict opponent counterplay."
        )
        actions.extend([
            "Trade active attacking pieces when ahead, but keep pieces on the board if opponent's king is exposed.",
            "Calculate king activity pathways before initiating major piece simplifications.",
        ])

    # Default Holistic Coaching Query
    else:
        answer_parts.append(
            "To sustain rating growth, ground your training in systematic leak elimination rather than playing high volumes of blitz games. "
            "Focus on converting advantages with calm patience and tightening your defensive composure during complex tactical complications."
        )
        actions.extend([
            "Review your last 3 losses focusing strictly on the single move where the evaluation dropped.",
            "Run 10 minutes of targeted replay drills on positions where pins were overlooked.",
        ])

    if student_report:
        persona = student_report.persona
        telemetry_parts: List[str] = []
        if persona.archetype:
            telemetry_parts.append(f"You are playing as a *{persona.archetype}*.")
        if persona.next_milestone:
            telemetry_parts.append(
                f"Your next strategic milestone: {persona.next_milestone}"
            )
        if telemetry_parts:
            answer_parts.append(
                "\n\n**Current Cohort Telemetry:** " + " ".join(telemetry_parts)
            )

    return "\n\n".join(answer_parts), actions


# --- Core Query Processor ---


async def answer_copilot_query(
    request: CopilotQueryRequest,
    client: Optional[genai.Client] = None,
) -> CopilotQueryResponse:
    """Handle a context-aware coach copilot question."""
    anchored_facts: List[str] = []
    detected_motifs: List[str] = request.motifs or []
    suggested_actions: List[str] = []
    student_report: Optional[progress.StudentProgressReport] = None

    # 1. Inspect FEN if provided
    if request.fen:
        try:
            board = chess.Board(request.fen)
            turn_color = chess.WHITE if request.player_color == "white" else chess.BLACK
            # Detect motifs for both sides (tactics available to player & threats by opponent)
            motif_hits = motifs.detect_motifs(board, turn_color) + motifs.detect_motifs(board, not turn_color)
            for hit in motif_hits:
                code = str(hit.get("theme") or hit.get("motif") or "")
                if code and code not in detected_motifs:
                    detected_motifs.append(code)
            anchored_facts.append(f"Position FEN evaluated with {len(motif_hits)} active tactical motifs detected.")
        except Exception as exc:
            logger.debug("Could not parse FEN '%s': %s", request.fen, exc)

    # 2. Inspect Student Progress if student_id provided
    if request.student_id:
        try:
            student_report = progress.build_student_progress(request.student_id, coach_id=request.user_id)
            rating = student_report.elo.current
            if rating > 0:
                anchored_facts.append(
                    f"Student: {student_report.student_name} ({rating:.0f} Elo)"
                )
            else:
                anchored_facts.append(
                    f"Student: {student_report.student_name} "
                    "(no rated games in the analyzed set)"
                )
            if student_report.persona.archetype:
                anchored_facts.append(f"Persona: {student_report.persona.archetype}")
            # Add the top leak: a pillar when the window is rich enough, else
            # the largest root cause the engine still measured.
            if student_report.pillars.needs_work:
                top_leak = student_report.pillars.needs_work[0]
                anchored_facts.append(f"Primary Leak: {top_leak.title} ({top_leak.metric})")
            elif student_report.root_causes:
                cause = student_report.root_causes[0]
                anchored_facts.append(
                    f"Primary Leak: {cause.category} "
                    f"({cause.percentage}% of the recorded key errors)"
                )
        except Exception as exc:
            logger.debug("Could not load student progress for %s: %s", request.student_id, exc)

    # 3. Inspect Specific Analysis if analysis_id provided
    if request.analysis_id and request.user_id and db.configured():
        try:
            analysis_row = db.get_analysis(request.user_id, request.analysis_id)
            if analysis_row:
                opening = analysis_row.get("opening_name") or "Unknown Opening"
                res = analysis_row.get("result") or "*"
                anchored_facts.append(f"Game Opening: {opening} · Result: {res}")
        except Exception as exc:
            logger.debug("Could not fetch analysis %s: %s", request.analysis_id, exc)

    # 4. Attempt Gemini AI Coach Generation
    ai_answer: Optional[str] = None
    source = "heuristic-engine"

    if client is not None:
        try:
            prompt_context = {
                "user_query": request.query,
                "player_color": request.player_color,
                "anchored_facts": anchored_facts,
                "detected_motifs": detected_motifs,
                "persona": student_report.persona.archetype if student_report else None,
            }
            model_name = os.environ.get("GEMINI_MODEL", DEFAULT_MODEL)
            response = await client.aio.models.generate_content(
                model=model_name,
                contents=json.dumps(prompt_context),
                config=types.GenerateContentConfig(
                    system_instruction=COPILOT_SYSTEM_INSTRUCTION,
                    temperature=0.3,
                ),
            )
            if response and response.text:
                ai_answer = response.text.strip()
                source = "gemini-coach"
                suggested_actions = [
                    "Complete a 5-minute replay drill targeting your highest-frequency leak.",
                    "Review tactical candidate moves before committing to piece trades.",
                ]
        except (errors.APIError, Exception) as exc:
            logger.warning("Gemini copilot query failed, falling back to heuristic coach: %s", exc)

    # 5. Fallback to Heuristic Engine if AI answer is empty
    if not ai_answer:
        ai_answer, fallback_actions = _generate_heuristic_answer(
            query=request.query,
            anchored_facts=anchored_facts,
            detected_motifs=detected_motifs,
            student_report=student_report,
        )
        if not suggested_actions:
            suggested_actions = fallback_actions

    return CopilotQueryResponse(
        answer=ai_answer,
        motifs_detected=detected_motifs,
        suggested_actions=suggested_actions,
        anchored_facts=anchored_facts,
        source=source,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
