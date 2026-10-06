from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import AsyncIterator, Dict, List

from google import genai
from google.genai import errors, types

from services import extractor

logger = logging.getLogger("uvicorn.error")

DEFAULT_MODEL = "gemini-3.1-flash-lite"
MAX_STREAM_RETRIES = 3
RETRY_BASE_DELAY_SECONDS = 2

SYSTEM_INSTRUCTION = f"""You are an experienced, practical chess coach teaching a beginner-to-intermediate student (Elo 800-1800). Write like a human coach giving a lesson — not like a Stockfish report.

You are given the PGN, the student's color, phase accuracies, and structured engine evidence (critical_moments with motifs, blind spots, opening names, puzzles, and tablebase verdicts). Use that evidence to coach the student in plain, human chess language.

Return your report in Markdown with these sections in order:
## Strength (only when strength_moments is not empty)
## Weakness (only when weakness_moments is not empty)
## Game Overview
## Focus Areas
## Resources

Output rules:
- Begin immediately with the first section heading. No preamble, planning, or commentary before it, and nothing after the report.
- Address the student as "you/your".
- Include Strength only when strength_moments contains at least one moment, and Weakness only when weakness_moments contains at least one moment. If a list is empty, omit that section entirely — never invent, pad, or stretch a minor inaccuracy into a weakness. Game Overview, Focus Areas, and Resources are always required.
- Each included section must be a bulleted list using "- " markers. Never write long paragraphs. Use 1-4 concise bullets per section.
- Do NOT dump engine numbers. Avoid raw centipawn figures, evaluation decimals, and lists of engine-optimal moves. When quantifying, stay qualitative ("a serious blunder", "a small inaccuracy", "this gave your opponent a clear advantage").
- Speak in chess concepts: piece activity, center control, king safety, hanging pieces, forcing moves (checks, captures, threats), converting advantages.

Coaching guidance:
- Pick the 1-2 most important lessons of the game instead of cataloging every engine-detected mistake. Related mistakes usually share one root cause — group them (for example, several opening inaccuracies often mean the same thing: "you played too passively and gave up the center").
- When there are no recorded weaknesses, use Focus Areas to reinforce the strengths you found and suggest how to keep building on them.
- In Focus Areas, describe a concept the student can actually work on and give one concrete, human tip. Do not tell them to memorize engine moves. Instead of "play 2...d5", say "Black should fight for the center with ...d5 rather than a passive ...g6".
- When you mention the engine's preferred move, frame it as the underlying idea ("you missed a forcing idea that wins material"), not as a move to reproduce.
- Do not repeat the same move or example in more than one section. Each key moment appears once, in its most relevant place.
- The Game Overview should tell the story of the game and why the result happened, not recite numbers.

Charts and resources:
- The engine data contains the student's phase_accuracies for opening, middlegame, and endgame (null means no moves were played in that phase). At the end of the Game Overview section you MUST include this custom component (double-quoted attribute, self-closing), using null for phases with no moves:
<AccuracyChart data="[opening, middlegame, endgame]" />
- In Resources, recommend 2-4 items by describing the concept or theme (for example: "practice forks", "study the Indian Defense opening", "work on intermediate moves / zwischenzugs"). Do NOT include any URLs, hyperlinks, or link markup in the report — the practice links are rendered separately by the app.
- Never output a "Detailed Insights" section, heading, or any engine data tables.
- If a critical_moment includes opening statistics, you may mention once what masters usually play; keep it light.
- If a critical_moment includes a tablebase verdict, mention the theoretical result (win/draw/loss) in one short sentence."""


BATCH_SYSTEM_INSTRUCTION = f"""You are an experienced, practical chess coach teaching a beginner-to-intermediate student (Elo 800-1800). The student has submitted several games from a recent session and you are writing one combined lesson.

You are given per-game engine evidence (openings, results, player color, phase accuracies, quality counts, and critical moments with motifs) plus aggregate totals and recurring themes. Each game is labeled "Game 1", "Game 2", and so on.

Return your report in Markdown with these sections in order:
## Strength (only when at least one game has recorded strengths)
## Weakness (only when at least one game has recorded key_moments)
## Games Overview
## Psychology (only when the payload contains a psychology profile)
## Focus Areas
## Resources

Output rules:
- Begin immediately with the first section heading. No preamble, planning, or commentary before it, and nothing after the report.
- Address the student as "you/your".
- Include Strength only when at least one game has recorded strengths, and Weakness only when at least one game has recorded weaknesses (key_moments). If no game has that evidence, omit the section entirely — never invent, pad, or stretch a minor inaccuracy into a weakness. Include Psychology only when the payload contains a psychology profile; otherwise omit it entirely. Games Overview, Focus Areas, and Resources are always required.
- A game whose key_moments list is empty has no recorded weakness: never claim or imply a weakness in that game. Likewise, a game with an empty strengths list has no recorded strength.
- Each included section must be a bulleted list using "- " markers. Never write long paragraphs. Use 1-4 concise bullets per section.
- Do NOT dump engine numbers. Avoid raw centipawn figures, evaluation decimals, and lists of engine-optimal moves. When quantifying, stay qualitative ("a serious blunder", "a small inaccuracy", "this gave your opponent a clear advantage").
- Speak in chess concepts: piece activity, center control, king safety, hanging pieces, forcing moves (checks, captures, threats), converting advantages.
- Respect each game's player_color; only ever attribute that player's moves to the student.

Psychology guidance:
- The profile contains a one-line headline, dimension scores with rubric tags (strong/develop/weak), ranked leaks with evidence, and a fix protocol per leak. The app renders the metrics and charts separately, so do NOT repeat the headline, the dimension scores, or the leak evidence verbatim.
- Write the Psychology section as the coach's interpretation: 2-4 bullets. Open with the mental-game headline in your own words (one sentence). Then cover the top 1-3 leaks in severity order, and for each one express the concrete habit from its fix protocol in your own words.
- Ground every claim in the supplied profile and, when possible, cite the specific games or moves from the rest of the payload.
- Never diagnose or make clinical claims about the student's personality or mental health. Frame everything as patterns across the submitted games, not fixed traits, and never state more confidence than the profile's confidence and caveats allow.
- Do not repeat a move or example already used in another section, and do not tell the student to memorize moves.

Coaching guidance:
- This is one lesson across several games: find the recurring patterns. In Weakness, group related mistakes by root cause and cite the specific games and moves where they appeared (for example: "In Game 2 you left your king in the center with 12...Ke7, and the same habit cost you in Game 4").
- When no game has recorded weaknesses, use Focus Areas to reinforce the strengths you found and suggest how to keep building on them.
- In Games Overview, write exactly one bullet per game: the story of that game, the result, and one specific turning-point moment. End the section with the AccuracyChart component described below.
- In Focus Areas, describe 2-3 concepts the student can actually work on and give one concrete, human tip each. Do not tell them to memorize engine moves; describe the idea instead.
- Do not repeat the same move or example in more than one section. Each key moment appears once, in its most relevant place.

Charts and resources:
- The aggregate data contains average_phase_accuracies for opening, middlegame, and endgame (null means no moves were played in that phase across the games). At the end of the Games Overview section you MUST include this custom component (double-quoted attribute, self-closing), using null for phases with no moves:
<AccuracyChart data="[opening, middlegame, endgame]" />
- In Resources, recommend 2-4 items by describing the concept or theme (for example: "practice forks", "study the Indian Defense opening", "work on intermediate moves / zwischenzugs"). Do NOT include any URLs, hyperlinks, or link markup in the report — the practice links are rendered separately by the app.
- Never output a "Detailed Insights" section, heading, or any engine data tables."""


def _model_name() -> str:
    return os.environ.get("GEMINI_MODEL", DEFAULT_MODEL)


def _build_contents(game: extractor.GameData, engine_data: Dict[str, object]) -> str:
    player_label = engine_data.get("player_color", "unknown (assume White)")
    player_name = engine_data.get("player_name")
    identity = (
        f"Player color: {player_label}"
        + (f"\nPlayer name: {player_name}" if player_name else "")
        + "\n\nAnalyze ONLY this player's decisions. Never attribute the opponent's moves to them."
    )
    return (
        "Analyze this chess game.\n\n"
        f"PGN:\n{game.pgn}\n\n"
        f"{identity}\n\n"
        f"Engine data (JSON):\n{json.dumps(engine_data)}\n"
    )


def _is_retryable(error: errors.APIError) -> bool:
    return error.code in (429, 503)


async def _open_stream(
    client: genai.Client,
    contents: str,
    system_instruction: str = SYSTEM_INSTRUCTION,
) -> AsyncIterator[str]:
    attempt = 0
    while True:
        try:
            response = await client.aio.models.generate_content_stream(
                model=_model_name(),
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction
                ),
            )
            return response
        except errors.APIError as exc:
            if not _is_retryable(exc) or attempt >= MAX_STREAM_RETRIES:
                raise
            attempt += 1
            await asyncio.sleep(RETRY_BASE_DELAY_SECONDS**attempt)


async def stream_coaching_report(
    client: genai.Client,
    game: extractor.GameData,
    engine_data: Dict[str, object],
) -> AsyncIterator[str]:
    stream = await _open_stream(client, _build_contents(game, engine_data))
    async for chunk in stream:
        if chunk.text:
            yield chunk.text


MOMENT_COACH_SYSTEM_INSTRUCTION = """You are an experienced chess coach writing the short note that appears next to a key position board in a student's game report (Elo 800-1800).

For every moment you receive, write:
- description: 1-3 sentences explaining what is happening in this position and why the student's played move worked (kind "strength") or what went wrong with it (kind "weakness"). Name the concrete pieces, squares, files, and threats involved.
- better_idea: for kind "weakness" only, 1-2 sentences explaining what the stronger move accomplishes, the follow-up idea, or the threat it prevents.

Rules:
- Write in plain, human chess language addressed to the student ("you/your").
- Ground every sentence in the supplied evidence: the position, the played move, the stronger move, the continuation, detected motifs, blind spots, opening knowledge, and tablebase verdicts.
- Never mention the engine, evaluations, centipawns, or "the best move". Never justify a move by saying the engine prefers it; explain the chess idea behind it.
- Never use filler like "this was a strong move" or "you matched the engine". Explain the chess reason.
- If the evidence is thin, describe the concrete features of the position: material, king safety, development, pawn structure, open lines, hanging pieces, and both sides' plans.
- Return exactly one entry per moment id you were given, using the same id."""

MOMENT_DESCRIPTION_SCHEMA = {
    "type": "object",
    "properties": {
        "moments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "description": {"type": "string"},
                    "better_idea": {"type": "string"},
                },
                "required": ["id", "description"],
            },
        }
    },
    "required": ["moments"],
}


def _move_label(moment: Dict[str, object]) -> str:
    dots = "..." if moment.get("color") == "black" else "."
    return f"{moment.get('move_number')}{dots} {moment.get('san')}"


def _moment_evidence(
    moment_id: str,
    kind: str,
    moment: Dict[str, object],
) -> Dict[str, object]:
    evidence: Dict[str, object] = {
        "id": moment_id,
        "kind": kind,
        "move": _move_label(moment),
        "phase": moment.get("phase"),
        "quality": moment.get("quality"),
        "fen_before": moment.get("fen_before"),
        "played_move_san": moment.get("san"),
        "stronger_move_san": moment.get("best_move_san"),
        "continuation_san": (moment.get("pv_san") or [])[:6],
        "eval_before_pawns": moment.get("eval_before_pawns"),
        "eval_after_pawns": moment.get("eval_after_pawns"),
    }
    motif = moment.get("motif")
    if motif:
        evidence["motif"] = motif
        evidence["motif_details"] = moment.get("motif_details")
    blindspot = moment.get("blindspot")
    if isinstance(blindspot, dict) and blindspot.get("explanation"):
        evidence["blindspot"] = blindspot.get("explanation")
    opening = moment.get("opening")
    if isinstance(opening, dict):
        evidence["opening"] = opening.get("name")
        top_moves = opening.get("top_moves") or []
        if top_moves and isinstance(top_moves[0], dict):
            evidence["master_move_san"] = top_moves[0].get("san")
    tablebase = moment.get("tablebase")
    if isinstance(tablebase, dict):
        evidence["tablebase"] = {
            "category": tablebase.get("category"),
            "dtm": tablebase.get("dtm"),
            "outcome_changed": tablebase.get("outcome_changed"),
        }
    return evidence


def _build_moment_payload(engine_data: Dict[str, object]) -> Dict[str, object]:
    moments: List[Dict[str, object]] = []
    for kind, key in (("strength", "strength_moments"), ("weakness", "weakness_moments")):
        entries = engine_data.get(key)
        if not isinstance(entries, list):
            continue
        for index, moment in enumerate(entries):
            if isinstance(moment, dict):
                moments.append(_moment_evidence(f"{kind}-{index}", kind, moment))
    return {
        "player_color": engine_data.get("player_color"),
        "moments": moments,
    }


async def describe_moments(
    client: genai.Client,
    engine_data: Dict[str, object],
) -> Dict[str, Dict[str, str]]:
    """Ask Gemini for a human explanation of each strength/weakness position.

    Returns a mapping of moment id (for example "weakness-0") to generated text.
    Failures are swallowed so the analysis still renders with rule-based notes.
    """
    payload = _build_moment_payload(engine_data)
    if not payload["moments"]:
        return {}

    attempt = 0
    while True:
        try:
            response = await client.aio.models.generate_content(
                model=_model_name(),
                contents=json.dumps(payload),
                config=types.GenerateContentConfig(
                    system_instruction=MOMENT_COACH_SYSTEM_INSTRUCTION,
                    response_mime_type="application/json",
                    response_schema=MOMENT_DESCRIPTION_SCHEMA,
                ),
            )
            break
        except errors.APIError as exc:
            if not _is_retryable(exc) or attempt >= MAX_STREAM_RETRIES:
                logger.warning("Moment description request failed: %s", exc)
                return {}
            attempt += 1
            await asyncio.sleep(RETRY_BASE_DELAY_SECONDS**attempt)
        except Exception:
            logger.exception("Unexpected error generating moment descriptions")
            return {}

    try:
        data = json.loads(response.text or "{}")
    except (TypeError, ValueError):
        logger.warning("Moment description response was not valid JSON")
        return {}

    descriptions: Dict[str, Dict[str, str]] = {}
    for entry in data.get("moments") or []:
        if not isinstance(entry, dict):
            continue
        moment_id = entry.get("id")
        if not isinstance(moment_id, str) or not moment_id:
            continue
        descriptions[moment_id] = {
            "description": str(entry.get("description") or "").strip(),
            "better_idea": str(entry.get("better_idea") or "").strip(),
        }
    return descriptions


def merge_moment_descriptions(
    engine_data: Dict[str, object],
    descriptions: Dict[str, Dict[str, str]],
) -> None:
    """Attach generated descriptions to the moments stored in engine data."""
    if not descriptions:
        return
    for kind, key in (("strength", "strength_moments"), ("weakness", "weakness_moments")):
        entries = engine_data.get(key)
        if not isinstance(entries, list):
            continue
        for index, moment in enumerate(entries):
            if not isinstance(moment, dict):
                continue
            entry = descriptions.get(f"{kind}-{index}")
            if not entry:
                continue
            description = entry.get("description")
            if description:
                moment["note"] = description
            better_idea = entry.get("better_idea")
            if kind == "weakness" and better_idea:
                moment["better_move_idea"] = better_idea


def _build_batch_contents(batch: Dict[str, object]) -> str:
    return (
        "Analyze this batch of chess games as one coaching session.\n\n"
        "The student's color can differ between games; each game lists its own "
        "player_color and only that player's decisions belong to the student.\n\n"
        f"Batch engine data (JSON):\n{json.dumps(batch)}\n"
    )


async def stream_batch_coaching_report(
    client: genai.Client,
    batch: Dict[str, object],
) -> AsyncIterator[str]:
    stream = await _open_stream(
        client,
        _build_batch_contents(batch),
        system_instruction=BATCH_SYSTEM_INSTRUCTION,
    )
    async for chunk in stream:
        if chunk.text:
            yield chunk.text


QA_SYSTEM_INSTRUCTION = """You are a practical chess coach answering a student's questions about their analyzed game.

You are given: the game PGN, the player's color, the coaching report, the structured engine insights, and the conversation so far.

Rules:
- Answer ONLY about the analyzed game and the supplied engine evidence.
- Explain concepts in plain, human chess language (piece activity, center control, king safety, forcing moves).
- Reference exact moves (SAN) when relevant.
- Never invent engine lines, evaluations, or resources.
- If the question is not supported by the game or evidence, say so honestly.
- Keep answers concise and coaching-oriented (2-6 sentences unless the question needs more).
- Never output URLs or links."""


def _build_qa_contents(
    analysis: Dict[str, object],
    messages: List[Dict[str, object]],
    question: str,
) -> str:
    report = analysis.get("report_markdown") or (
        "(this game was part of a multi-game report and has no separate written "
        "report; rely on the engine insights below)"
    )
    context_parts = [
        f"Player color: {analysis.get('player_color')}",
        f"Player name: {analysis.get('player_name')}",
        f"PGN:\n{analysis.get('pgn')}",
        f"Coaching report:\n{report}",
        f"Engine insights (JSON):\n{json.dumps(analysis.get('insights') or {})}",
    ]
    transcript = "\n".join(
        f"{'Student' if message.get('role') == 'user' else 'Coach'}: {message.get('content')}"
        for message in messages[-6:]
    )
    return (
        "\n\n".join(context_parts)
        + "\n\nConversation so far:\n"
        + (transcript if transcript else "(none)")
        + f"\n\nStudent's question: {question}\n"
    )


async def stream_question_answer(
    client: genai.Client,
    analysis: Dict[str, object],
    messages: List[Dict[str, object]],
    question: str,
) -> AsyncIterator[str]:
    contents = _build_qa_contents(analysis, messages, question)
    attempt = 0
    while True:
        try:
            response = await client.aio.models.generate_content_stream(
                model=_model_name(),
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=QA_SYSTEM_INSTRUCTION
                ),
            )
            break
        except errors.APIError as exc:
            if not _is_retryable(exc) or attempt >= MAX_STREAM_RETRIES:
                raise
            attempt += 1
            await asyncio.sleep(RETRY_BASE_DELAY_SECONDS**attempt)

    async for chunk in response:
        if chunk.text:
            yield chunk.text