"""Per-game telemetry captured at analysis time (migration 0014).

Two JSON payloads are built here and stored on the analysis row:

* ``game_summary`` — the compact ``GameSummary`` the history and progress
  surfaces aggregate without opening a full report.
* ``replay`` — the move-by-move ``AnalysisReplay`` the review page replays.

Everything is derived from real engine evidence and the game's PGN headers.
When a value is unavailable it stays ``None`` instead of being estimated, and
rows analyzed before this rollout simply carry no telemetry.
"""

from __future__ import annotations

import io
import math
import re
from typing import Any, Dict, List, Mapping, Optional

import chess
import chess.pgn

from services import engine, psychology

# Speed buckets. These strings cross the API boundary as ``SpeedBucket`` in
# frontend/lib/api.ts and index ``game_summary->>'speed'``, so they are fixed.
SPEED_BULLET = "bullet"
SPEED_BLITZ = "blitz"
SPEED_RAPID = "rapid"
SPEED_CLASSICAL = "classical"
SPEED_CORRESPONDENCE = "correspondence"
SPEED_UNKNOWN = "unknown"

# Bucket boundaries follow Lichess: bullet < 3 min, blitz < 10 min,
# rapid < 30 min, classical at or above 30 min.
BULLET_MAX_SECONDS = 180.0
BLITZ_MAX_SECONDS = 600.0
RAPID_MAX_SECONDS = 1800.0

# A "+N" increment buys about N seconds on every other move, which is the same
# 40x weighting Lichess uses when it names a time control's speed.
INCREMENT_SECONDS_WEIGHT = 40.0

# "days/per-move" notation ("1/86400", "1/259200") is correspondence chess.
# One day per move is the threshold.
CORRESPONDENCE_MIN_SECONDS = 86400.0

_DAYS_PER_MOVE = re.compile(r"^(\d+)\s*/\s*(\d+(?:\.\d+)?)$")

# --- Verdict extraction ------------------------------------------------------

VERDICT_MIN_LENGTH = 15
_VERDICT_HEADING = re.compile(
    r"^[ \t]*#{1,6}[ \t]*Verdict[ \t]*:?[ \t]*$", re.IGNORECASE | re.MULTILINE
)
_ANY_HEADING = re.compile(r"^[ \t]*#{1,6}[ \t]+\S", re.MULTILINE)
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
_LIST_MARKER = re.compile(r"^[ \t]*(?:[-*\u2022]+|\d+[.)])[ \t]+")
_EMPHASIS = re.compile(r"(?<![\w])[*_]+|[*_]+(?![\w])")


def derive_speed(time_control: Optional[str]) -> str:
    """Map a Lichess/Chess.com time control onto a speed bucket.

    ``"300+3"`` is read as base seconds + increment seconds and scored as
    ``base + 40 * increment``. ``"1/259200"`` is the days-per-move
    correspondence notation. Anything that cannot be read honestly is
    ``"unknown"``.
    """
    if time_control is None:
        return SPEED_UNKNOWN
    text = str(time_control).strip()
    if not text or text in {"-", "?"}:
        return SPEED_UNKNOWN

    days_per_move = _DAYS_PER_MOVE.match(text)
    if days_per_move is not None:
        per_move = float(days_per_move.group(2))
        if per_move >= CORRESPONDENCE_MIN_SECONDS:
            return SPEED_CORRESPONDENCE
        return SPEED_UNKNOWN

    base_text, _, increment_text = text.partition("+")
    base = _seconds(base_text)
    if base is None:
        return SPEED_UNKNOWN
    increment = _seconds(increment_text) if increment_text else 0.0
    if increment is None:
        return SPEED_UNKNOWN

    estimated = base + INCREMENT_SECONDS_WEIGHT * increment
    if estimated < BULLET_MAX_SECONDS:
        return SPEED_BULLET
    if estimated < BLITZ_MAX_SECONDS:
        return SPEED_BLITZ
    if estimated < RAPID_MAX_SECONDS:
        return SPEED_RAPID
    return SPEED_CLASSICAL


def build_game_summary(
    *,
    analysis: engine.AnalysisResult,
    engine_data: Mapping[str, Any],
    player_color: Optional[str],
    username: Optional[str],
    platform: Optional[str],
    pgn: Optional[str] = None,
) -> Dict[str, object]:
    """Build the compact ``GameSummary`` stored on the analysis row.

    Ratings and the opponent's name come from the PGN headers for the
    student's color. Every header-derived field is ``None`` when the header is
    missing, so the progress surfaces can exclude the game instead of trusting
    a made-up rating. ``pgn`` is optional because the existing engine result
    does not carry headers.
    """
    headers = _pgn_headers(pgn)
    color = _resolve_color(analysis.player_color, player_color)
    time_control = analysis.time_control or _header(headers, "TimeControl")
    statistics = analysis.statistics or {}
    phase_accuracies = analysis.phase_accuracies or {}

    return {
        "speed": derive_speed(time_control),
        "time_control": time_control,
        "username": _clean(username) or _clean(analysis.player_name),
        "platform": _clean(platform),
        "player_elo": _elo(headers.get("WhiteElo" if color == "white" else "BlackElo")),
        "opponent_name": _clean(
            headers.get("Black" if color == "white" else "White")
        ),
        "opponent_elo": _elo(
            headers.get("BlackElo" if color == "white" else "WhiteElo")
        ),
        "accuracy": analysis.overall_accuracy,
        "phase_accuracies": {
            phase: phase_accuracies.get(phase) for phase in engine.PHASES
        },
        "quality": {
            "blunder": _count(statistics, engine.QUALITY_BLUNDER),
            "mistake": _count(statistics, engine.QUALITY_MISTAKE),
            "inaccuracy": _count(statistics, engine.QUALITY_INACCURACY),
        },
        "psychology": _psychology(analysis, engine_data),
    }


def build_replay(
    *,
    analysis: engine.AnalysisResult,
    engine_data: Mapping[str, Any],
    player_color: Optional[str],
    pgn: Optional[str] = None,
) -> Dict[str, object]:
    """Build the move-by-move ``AnalysisReplay`` stored on the analysis row.

    ``ply`` is the move's mainline index (1-based) and each move carries the FEN
    of the position AFTER it: rebuilt by pushing the played move onto
    ``fen_before``, or taken from the next move's ``fen_before`` when the move
    itself cannot be pushed. A FEN that cannot be determined is ``None`` rather
    than the pre-move position.
    """
    headers = _pgn_headers(pgn)
    time_control = analysis.time_control or _header(headers, "TimeControl")
    moves: List[Dict[str, object]] = []
    move_count = len(analysis.moves)

    for position, move in enumerate(analysis.moves, start=1):
        fen_after = _fen_after(move)
        if fen_after is None and position < move_count:
            fen_after = _clean(analysis.moves[position].fen_before)
        moves.append(
            {
                "ply": position,
                "san": move.san,
                "color": move.color,
                "fen": fen_after,
                "quality": move.quality,
                "eval_after_pawns": round(move.eval_after_cp / 100, 2),
                "seconds_spent": move.seconds_spent,
                "clock_remaining": move.clock_remaining,
            }
        )

    return {
        "moves": moves,
        "eval_curve_pawns": list(analysis.eval_curve_pawns),
        "players": {
            "white": {
                "name": _clean(headers.get("White")),
                "elo": _elo(headers.get("WhiteElo")),
            },
            "black": {
                "name": _clean(headers.get("Black")),
                "elo": _elo(headers.get("BlackElo")),
            },
        },
        "player_color": _resolve_color(analysis.player_color, player_color),
        "time_control": time_control,
        "speed": derive_speed(time_control),
        "result": analysis.result or _clean(engine_data.get("result")),
        "opening_name": analysis.opening_name
        or _clean(engine_data.get("opening_name")),
    }


def extract_verdict(report_markdown: str) -> Optional[Dict[str, str]]:
    """Pull the report's ``## Verdict`` one-liner out of the Markdown.

    Returns ``{"line", "detail", "source"}`` where ``detail`` is whatever
    follows the first sentence, or ``None`` when the section is missing (older
    reports), empty, or shorter than a real sentence — the UI then falls back
    instead of showing a fragment.
    """
    if not report_markdown:
        return None
    heading = _VERDICT_HEADING.search(report_markdown)
    if heading is None:
        return None

    remainder = report_markdown[heading.end() :]
    next_heading = _ANY_HEADING.search(remainder)
    if next_heading is not None:
        remainder = remainder[: next_heading.start()]

    text = _plain_text(remainder)
    if not text:
        return None
    line, detail = _first_sentence(text)
    if len(line) < VERDICT_MIN_LENGTH:
        return None
    return {"line": line, "detail": detail, "source": "report"}


def _seconds(value: str) -> Optional[float]:
    text = value.strip()
    if not text:
        return None
    try:
        parsed = float(text)
    except ValueError:
        return None
    if not math.isfinite(parsed) or parsed < 0:
        return None
    return parsed


def _count(statistics: Mapping[str, object], quality: str) -> int:
    return int(statistics.get(quality, 0) or 0)


def _pgn_headers(pgn: Optional[str]) -> Dict[str, str]:
    """Read the PGN headers; the move list is irrelevant here."""
    if not pgn:
        return {}
    try:
        game = chess.pgn.read_game(io.StringIO(pgn))
    except Exception:
        return {}
    if game is None:
        return {}
    return {key: value for key, value in game.headers.items()}


def _header(headers: Mapping[str, str], key: str) -> Optional[str]:
    return _clean(headers.get(key))


def _clean(value: Optional[object]) -> Optional[str]:
    text = str(value).strip() if value is not None else ""
    if not text or text == "?":
        return None
    return text


def _elo(value: Optional[object]) -> Optional[int]:
    text = _clean(value)
    if text is None:
        return None
    try:
        rating = int(float(text))
    except ValueError:
        return None
    return rating if rating > 0 else None


def _resolve_color(
    analysis_color: Optional[str], requested_color: Optional[str]
) -> str:
    """The student's color, assuming White when the game does not say.

    The engine makes the same assumption when it cannot tell the colors apart,
    so header lookups stay consistent with the report.
    """
    for candidate in (analysis_color, requested_color):
        if candidate in ("white", "black"):
            return candidate
    return "white"


def _fen_after(move: engine.MoveInfo) -> Optional[str]:
    try:
        board = chess.Board(move.fen_before)
        played = chess.Move.from_uci(move.played_move)
    except (ValueError, TypeError):
        return None
    if played not in board.legal_moves:
        return None
    board.push(played)
    return board.fen()


def _psychology(
    analysis: engine.AnalysisResult, engine_data: Mapping[str, Any]
) -> Optional[Dict[str, object]]:
    """The compact per-game primitives, rebuilt when the caller has none."""
    stored = engine_data.get("psychology")
    if isinstance(stored, dict):
        return stored
    try:
        return psychology.build_game_primitives(analysis)
    except Exception:
        return None


def _plain_text(text: str) -> str:
    """Flatten one Markdown fragment into a single clean line of prose."""
    cleaned = _LIST_MARKER.sub("", text.strip())
    cleaned = cleaned.replace("**", "").replace("__", "")
    cleaned = _EMPHASIS.sub("", cleaned)
    cleaned = cleaned.replace("`", "")
    return re.sub(r"\s+", " ", cleaned).strip()


def _first_sentence(text: str) -> tuple[str, Optional[str]]:
    parts = _SENTENCE_SPLIT.split(text, maxsplit=1)
    line = parts[0].strip()
    detail = parts[1].strip() if len(parts) > 1 else ""
    return line, detail or None
