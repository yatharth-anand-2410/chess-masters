"""Lichess Study Fetcher and Chapter Parser.

Imports Lichess studies via their study ID or full URL, and parses each chapter
into a structured hierarchical tree including:
- PGN annotations and NAG glyphs (!, ?, !!, etc.)
- Visual board circles (`[%csl Gc4,Re5]`)
- Directional board arrows (`[%cal Gc1g5,Re1e8]`)
- Text comments with markup cleanly separated
- The chapter-root comment: a chapter that stores only a position and a lesson
- Full branching variations and sub-variations

Private and unlisted studies need a Lichess OAuth token with the ``study:read``
scope in ``LICHESS_TOKEN``; the token's account must own (or be a member of)
the study. Without a token only public, non-unlisted studies are readable.
Nothing here is persisted: parsed studies live in a small bounded in-memory
cache, so the index costs no storage.
"""

from __future__ import annotations

import io
import json
import os
import re
import threading
import time
from collections import OrderedDict
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

import chess
import chess.pgn
import requests
from pydantic import BaseModel, Field

from services import http, puzzles

#: Documented export route. The legacy ``/study/{id}.pgn`` web route sends the
#: same bytes, but only this one is part of the public API contract.
LICHESS_STUDY_URL = "https://lichess.org/api/study/{study_id}.pgn"
#: Metadata for every study of an account, private and unlisted included when
#: authenticated. This is the whole index: one request.
LICHESS_STUDY_LIST_URL = "https://lichess.org/api/study/by/{username}"
STUDY_ID_REGEX = re.compile(r"([a-zA-Z0-9]{8})")

#: A parsed study is reused for this long. Study content changes on the author's
#: schedule, not per request, and re-parsing a 60-chapter PGN on every open is
#: pure waste.
STUDY_CACHE_TTL_SECONDS = float(os.environ.get("STUDY_CACHE_TTL_SECONDS", "600"))
STUDY_CACHE_MAX_ENTRIES = max(1, int(os.environ.get("STUDY_CACHE_MAX_ENTRIES", "32")))
#: The study index is one cheap request; a short TTL keeps new studies appearing
#: quickly without hitting Lichess on every page load.
STUDY_INDEX_TTL_SECONDS = float(os.environ.get("STUDY_INDEX_TTL_SECONDS", "300"))

CSL_REGEX = re.compile(r"\[%csl\s+([^\]]+)\]")
CAL_REGEX = re.compile(r"\[%cal\s+([^\]]+)\]")
EVAL_REGEX = re.compile(r"\[%eval\s+([^\]]+)\]")
CLK_REGEX = re.compile(r"\[%clk\s+([^\]]+)\]")

COLOR_MAP: Dict[str, str] = {
    "G": "green",
    "R": "red",
    "Y": "yellow",
    "B": "blue",
}

NAG_GLYPHS: Dict[int, str] = {
    1: "!",
    2: "?",
    3: "!!",
    4: "??",
    5: "!?",
    6: "?!",
    7: "□",
    10: "=",
    13: "∞",
    14: "⩲",
    15: "⩱",
    16: "±",
    17: "∓",
    18: "+-",
    19: "-+",
}


class StudyError(Exception):
    """Base error for study import failures."""


class StudyNotFoundError(StudyError):
    """The study does not exist, is empty, or the link is out of date."""


class StudyPrivateError(StudyError):
    """Lichess refused the read: the study is private and this deployment has
    no usable ``LICHESS_TOKEN`` (or the token's account has no access)."""


class StudyFetchError(StudyError):
    """Network or HTTP communication failure while fetching study."""


class StudyParseError(StudyError):
    """The study PGN could not be parsed."""


# --- Pydantic Models ---


class CircleAnnotation(BaseModel):
    color: str = Field(..., description="Circle color: green, red, yellow, or blue")
    square: str = Field(..., description="Square coordinate, e.g. 'c4', 'e5'")


class ArrowAnnotation(BaseModel):
    color: str = Field(..., description="Arrow color: green, red, yellow, or blue")
    from_square: str = Field(..., description="Origin square, e.g. 'c1'")
    to_square: str = Field(..., description="Destination square, e.g. 'g5'")


class StudyMoveNode(BaseModel):
    san: str = Field(..., description="Standard algebraic notation (e.g. 'Nf3')")
    uci: str = Field(..., description="UCI move format (e.g. 'g1f3')")
    ply: int = Field(..., description="Half-move number (1-based)")
    fen: str = Field(..., description="FEN position after the move")
    comment: Optional[str] = Field(None, description="Cleaned narrative comment")
    circles: List[CircleAnnotation] = Field(default_factory=list, description="Visual board circles (%csl)")
    arrows: List[ArrowAnnotation] = Field(default_factory=list, description="Visual board arrows (%cal)")
    nags: List[int] = Field(default_factory=list, description="Numeric Annotation Glyphs")
    glyphs: List[str] = Field(default_factory=list, description="Human-readable glyph symbols (e.g. '!', '??')")
    engine_eval: Optional[str] = Field(None, description="Associated %eval tag if present")
    variations: List[StudyMoveNode] = Field(default_factory=list, description="Sub-variations and alternative moves")


class StudyChapter(BaseModel):
    id: str = Field(..., description="Chapter identifier or index")
    title: str = Field(..., description="Chapter title")
    orientation: str = Field("white", description="Board orientation: 'white' or 'black'")
    initial_fen: str = Field(..., description="Starting FEN of the chapter")
    moves_tree: List[StudyMoveNode] = Field(default_factory=list, description="Root branches and main line")
    total_moves: int = Field(0, description="Total plies along the main line")
    tags: Dict[str, str] = Field(default_factory=dict, description="Chapter PGN headers")
    #: Most of a coach's library is positions, not puzzles: a chapter that
    #: stores no moves still carries a lesson on its starting position.
    initial_comment: Optional[str] = Field(
        None, description="Lesson text written on the chapter's starting position"
    )
    initial_circles: List[CircleAnnotation] = Field(
        default_factory=list, description="Board circles drawn on the starting position (%csl)"
    )
    initial_arrows: List[ArrowAnnotation] = Field(
        default_factory=list, description="Board arrows drawn on the starting position (%cal)"
    )
    chapter_url: Optional[str] = Field(
        None, description="Deep link to this single chapter on Lichess"
    )


class StudyImportResponse(BaseModel):
    study_id: str = Field(..., description="8-character Lichess study ID")
    study_title: str = Field(..., description="Title of the study")
    source_url: str = Field(..., description="Direct Lichess study URL")
    chapter_count: int = Field(..., description="Number of chapters imported")
    chapters: List[StudyChapter] = Field(default_factory=list, description="Parsed study chapters")
    total_annotations: int = Field(0, description="Total arrows, circles, and comments parsed")
    annotator: Optional[str] = Field(
        None, description="The Lichess account the study belongs to"
    )
    position_only_chapters: int = Field(
        0, description="Chapters that store a position and no moves"
    )
    source: str = Field(
        "lichess", description="Where this payload came from: 'lichess' or 'cache'"
    )


# --- Parsing Functions ---


def extract_study_id(url_or_id: str) -> str:
    """Extract an 8-character study ID from a URL or bare identifier string."""
    cleaned = url_or_id.strip()
    if not cleaned:
        raise StudyNotFoundError("Empty study ID or URL provided.")

    if "lichess.org" in cleaned:
        path = urlsplit(cleaned).path.strip("/")
        parts = path.split("/")
        # format: /study/{study_id} or /study/{study_id}/{chapter_id}
        for i, part in enumerate(parts):
            if part == "study" and (i + 1) < len(parts):
                candidate = parts[i + 1]
                match = STUDY_ID_REGEX.search(candidate)
                if match:
                    return match.group(1)

    match = STUDY_ID_REGEX.search(cleaned)
    if match:
        return match.group(1)

    raise StudyNotFoundError(f"Could not extract a valid 8-character Lichess study ID from '{url_or_id}'.")


def parse_visual_annotations(comment: str) -> Tuple[str, List[CircleAnnotation], List[ArrowAnnotation], Optional[str]]:
    """Extract %csl circles, %cal arrows, and %eval from comment, returning clean comment."""
    if not comment:
        return "", [], [], None

    circles: List[CircleAnnotation] = []
    arrows: List[ArrowAnnotation] = []
    eval_val: Optional[str] = None

    # Parse %csl Gc4,Re5
    for csl_match in CSL_REGEX.finditer(comment):
        raw_items = csl_match.group(1).split(",")
        for item in raw_items:
            item = item.strip()
            if len(item) == 3:
                color_code = item[0].upper()
                square = item[1:].lower()
                color_name = COLOR_MAP.get(color_code, "green")
                circles.append(CircleAnnotation(color=color_name, square=square))

    # Parse %cal Gc1g5,Re1e8
    for cal_match in CAL_REGEX.finditer(comment):
        raw_items = cal_match.group(1).split(",")
        for item in raw_items:
            item = item.strip()
            if len(item) == 5:
                color_code = item[0].upper()
                from_sq = item[1:3].lower()
                to_sq = item[3:5].lower()
                color_name = COLOR_MAP.get(color_code, "green")
                arrows.append(ArrowAnnotation(color=color_name, from_square=from_sq, to_square=to_sq))

    # Parse %eval
    eval_match = EVAL_REGEX.search(comment)
    if eval_match:
        eval_val = eval_match.group(1).strip()

    # Clean out markup tags from comment
    clean = CSL_REGEX.sub("", comment)
    clean = CAL_REGEX.sub("", clean)
    clean = EVAL_REGEX.sub("", clean)
    clean = CLK_REGEX.sub("", clean)
    clean = re.sub(r"\s+", " ", clean).strip()

    return clean, circles, arrows, eval_val


def _parse_variation_node(node: chess.pgn.GameNode, ply: int, board: chess.Board) -> StudyMoveNode:
    """Recursively parse a chess PGN node and its sub-variations into a StudyMoveNode."""
    san = node.san()
    move = node.move
    uci = move.uci() if move else ""

    board_copy = board.copy()
    if move:
        board_copy.push(move)
    fen_after = board_copy.fen()

    raw_comment = node.comment or ""
    clean_comment, circles, arrows, eval_val = parse_visual_annotations(raw_comment)

    # NAGs
    nags = list(node.nags)
    glyphs = [NAG_GLYPHS[nag] for nag in nags if nag in NAG_GLYPHS]

    # Sub-variations: node.variations contains child continuations
    child_nodes: List[StudyMoveNode] = []
    for var in node.variations:
        child_nodes.append(_parse_variation_node(var, ply + 1, board_copy))

    return StudyMoveNode(
        san=san,
        uci=uci,
        ply=ply,
        fen=fen_after,
        comment=clean_comment or None,
        circles=circles,
        arrows=arrows,
        nags=nags,
        glyphs=glyphs,
        engine_eval=eval_val,
        variations=child_nodes,
    )


def lichess_token() -> str:
    """The deployment's Lichess OAuth token, or ``""`` when none is set."""
    return (os.environ.get("LICHESS_TOKEN") or "").strip()


def lichess_configured() -> bool:
    """True when this deployment can read private and unlisted studies."""
    return bool(lichess_token())


def _lichess_headers() -> Dict[str, str]:
    token = lichess_token()
    return {"Authorization": f"Bearer {token}"} if token else {}


def fetch_lichess_study_pgn(study_id: str) -> str:
    """Fetch the multi-chapter PGN export from the Lichess study API.

    Private and unlisted chapters are only returned to an authenticated reader,
    so the token decides whether this sees the whole study or a 401.
    """
    url = LICHESS_STUDY_URL.format(study_id=study_id)
    try:
        response = http.get(
            url, headers=_lichess_headers(), timeout=20.0, allow_redirects=True
        )
    except requests.RequestException as exc:
        raise StudyFetchError(f"Could not connect to Lichess: {exc}") from exc

    if response.status_code in (401, 403):
        raise StudyPrivateError(
            f"Lichess refused study '{study_id}': it is private and this request "
            "carried no token with access to it."
        )
    if response.status_code == 404 or "/signup" in response.url:
        raise StudyNotFoundError(
            f"Lichess study '{study_id}' was not found, holds no chapters, or "
            "the link is out of date."
        )
    if response.status_code != 200:
        raise StudyFetchError(
            f"Lichess study export returned status {response.status_code}."
        )

    text = response.text.strip()
    if not text:
        raise StudyNotFoundError(f"Study '{study_id}' holds no chapters yet.")

    return text


# ---------------------------------------------------------------------------
# In-memory caches: the index and parsed studies cost no storage
# ---------------------------------------------------------------------------

_study_cache: "OrderedDict[str, Tuple[float, StudyImportResponse]]" = OrderedDict()
_study_cache_lock = threading.Lock()

_owner_index_cache: "OrderedDict[str, Tuple[float, List[Dict[str, Any]]]]" = (
    OrderedDict()
)
_owner_index_lock = threading.Lock()


def _study_cache_get(study_id: str) -> Optional[StudyImportResponse]:
    if STUDY_CACHE_TTL_SECONDS <= 0:
        return None
    now = time.monotonic()
    with _study_cache_lock:
        entry = _study_cache.get(study_id)
        if entry is None:
            return None
        expires_at, payload = entry
        if expires_at <= now:
            _study_cache.pop(study_id, None)
            return None
        _study_cache.move_to_end(study_id)
        return payload


def _study_cache_put(study_id: str, payload: StudyImportResponse) -> None:
    if STUDY_CACHE_TTL_SECONDS <= 0:
        return
    with _study_cache_lock:
        _study_cache[study_id] = (
            time.monotonic() + STUDY_CACHE_TTL_SECONDS,
            payload,
        )
        _study_cache.move_to_end(study_id)
        while len(_study_cache) > STUDY_CACHE_MAX_ENTRIES:
            _study_cache.popitem(last=False)


def clear_caches() -> None:
    """Drop the index and every parsed study. Tests and the refresh use this."""
    with _study_cache_lock:
        _study_cache.clear()
    with _owner_index_lock:
        _owner_index_cache.clear()


def cache_info() -> Dict[str, int]:
    with _study_cache_lock, _owner_index_lock:
        return {
            "studies": len(_study_cache),
            "indexes": len(_owner_index_cache),
        }


def list_owner_studies(username: str, *, use_cache: bool = True) -> List[Dict[str, Any]]:
    """Every study of ``username``: the whole index, in one request.

    Returns ``[]`` (rather than raising) when Lichess is unreachable or the
    account has no studies, because the library degrades to the curation
    overlay in that case. Raises :class:`StudyPrivateError` only when Lichess
    answers 401/403, which means the token is missing, expired, or belongs to
    another account.
    """
    cleaned = (username or "").strip()
    if not cleaned:
        return []

    now = time.monotonic()
    if use_cache and STUDY_INDEX_TTL_SECONDS > 0:
        with _owner_index_lock:
            entry = _owner_index_cache.get(cleaned)
            if entry is not None:
                expires_at, rows = entry
                if expires_at > now:
                    _owner_index_cache.move_to_end(cleaned)
                    return rows
                _owner_index_cache.pop(cleaned, None)

    url = LICHESS_STUDY_LIST_URL.format(username=cleaned)
    try:
        response = http.get(
            url, headers=_lichess_headers(), timeout=20.0, allow_redirects=True
        )
    except requests.RequestException as exc:
        raise StudyFetchError(f"Could not connect to Lichess: {exc}") from exc

    if response.status_code in (401, 403):
        raise StudyPrivateError(
            f"Lichess refused the study list for '{cleaned}': no token with "
            "access to that account is configured for this deployment."
        )
    if response.status_code == 404:
        return []
    if response.status_code != 200:
        raise StudyFetchError(
            f"Lichess study list returned status {response.status_code}."
        )

    rows: List[Dict[str, Any]] = []
    for line in (response.text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if not isinstance(entry, dict):
            continue
        study_id = str(entry.get("id") or "").strip()
        if not study_id:
            continue
        rows.append(
            {
                "id": study_id,
                "name": str(entry.get("name") or "").strip(),
                "created_at": entry.get("createdAt"),
                "updated_at": entry.get("updatedAt"),
            }
        )

    rows.sort(key=lambda row: int(row.get("updated_at") or 0), reverse=True)
    if use_cache and STUDY_INDEX_TTL_SECONDS > 0:
        with _owner_index_lock:
            _owner_index_cache[cleaned] = (
                time.monotonic() + STUDY_INDEX_TTL_SECONDS,
                rows,
            )
            _owner_index_cache.move_to_end(cleaned)
    return rows


def parse_study_pgn(pgn_text: str, study_id: str) -> StudyImportResponse:
    """Parse raw multi-chapter PGN string into a structured StudyImportResponse."""
    pgn_io = io.StringIO(pgn_text)
    chapters: List[StudyChapter] = []
    study_title: Optional[str] = None
    annotator: Optional[str] = None
    total_annotations = 0
    position_only = 0
    chapter_index = 1

    while True:
        try:
            game = chess.pgn.read_game(pgn_io)
        except Exception as exc:
            raise StudyParseError(f"Error parsing chapter {chapter_index}: {exc}") from exc

        if game is None:
            break

        title = game.headers.get("Event", f"Chapter {chapter_index}")
        if study_title is None:
            # First chapter's Event or StudyName header often names the study
            study_title = game.headers.get("StudyName") or title
        if annotator is None:
            annotator = game.headers.get("Annotator")

        orientation = game.headers.get("Orientation", "white").lower()
        if orientation not in ("white", "black"):
            orientation = "white"

        initial_fen = game.headers.get("FEN", chess.STARTING_FEN)
        board = chess.Board(initial_fen)

        moves_tree: List[StudyMoveNode] = []
        for top_var in game.variations:
            parsed_node = _parse_variation_node(top_var, ply=1, board=board)
            moves_tree.append(parsed_node)

        # The chapter's own lesson text lives on the starting position: a
        # position-only chapter has no move to hang it on, and dropping it
        # would throw away the coaching.
        initial_comment, initial_circles, initial_arrows, _ = parse_visual_annotations(
            game.comment or ""
        )

        # Count annotations and main line plies
        main_moves_count = 0
        curr: Optional[StudyMoveNode] = moves_tree[0] if moves_tree else None
        while curr:
            main_moves_count += 1
            if curr.comment:
                total_annotations += 1
            total_annotations += len(curr.circles) + len(curr.arrows)
            curr = curr.variations[0] if curr.variations else None
        if initial_comment:
            total_annotations += 1
        total_annotations += len(initial_circles) + len(initial_arrows)
        if not moves_tree:
            position_only += 1

        chapters.append(
            StudyChapter(
                id=str(chapter_index),
                title=title,
                orientation=orientation,
                initial_fen=initial_fen,
                moves_tree=moves_tree,
                total_moves=main_moves_count,
                tags=dict(game.headers),
                initial_comment=initial_comment or None,
                initial_circles=initial_circles,
                initial_arrows=initial_arrows,
                chapter_url=_chapter_url(game.headers.get("ChapterURL"), study_id, chapter_index),
            )
        )
        chapter_index += 1

    if not chapters:
        raise StudyParseError("No valid PGN chapters could be decoded from the study.")

    return StudyImportResponse(
        study_id=study_id,
        study_title=study_title or f"Lichess Study {study_id}",
        source_url=f"https://lichess.org/study/{study_id}",
        chapter_count=len(chapters),
        chapters=chapters,
        total_annotations=total_annotations,
        annotator=_clean_annotator(annotator),
        position_only_chapters=position_only,
    )


def _chapter_url(raw: Optional[str], study_id: str, index: int) -> Optional[str]:
    """The chapter's own Lichess deep link, from the export's ``ChapterURL``."""
    value = str(raw or "").strip()
    if value.startswith("http://") or value.startswith("https://"):
        return value
    # Older exports carry no ChapterURL; the study link still works.
    return f"https://lichess.org/study/{study_id}" if index == 1 else None


def _clean_annotator(raw: Optional[str]) -> Optional[str]:
    """``https://lichess.org/@/MentalCarlsen`` → ``MentalCarlsen``."""
    value = str(raw or "").strip()
    if not value:
        return None
    if "/@/" in value:
        return value.rsplit("/@/", 1)[1].strip("/") or None
    return value or None


def import_lichess_study(
    study_id_or_url: str, *, use_cache: bool = True
) -> StudyImportResponse:
    """Extract the study ID, fetch the PGN and parse every chapter.

    Parsed studies are served from a bounded in-memory cache for
    :data:`STUDY_CACHE_TTL_SECONDS`; pass ``use_cache=False`` to force a read
    straight from Lichess.
    """
    study_id = extract_study_id(study_id_or_url)
    if use_cache:
        cached = _study_cache_get(study_id)
        if cached is not None:
            return cached.model_copy(update={"source": "cache"})
    pgn_text = fetch_lichess_study_pgn(study_id)
    parsed = parse_study_pgn(pgn_text, study_id)
    _study_cache_put(study_id, parsed)
    return parsed


# ---------------------------------------------------------------------------
# Curated studies: the real leaks of analyzed games, mapped to Lichess drills
# ---------------------------------------------------------------------------

#: How many studies a curriculum shows at most.
MAX_CURATED_STUDIES = 6


def _as_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _moment_move_number(moment: Dict[str, Any]) -> Optional[int]:
    value = moment.get("move_number")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = int(value)
    return number if number > 0 else None


def _moment_loss(moment: Dict[str, Any]) -> float:
    value = moment.get("centipawn_loss")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.0
    return float(value)


def build_curated_studies(
    rows: List[Dict[str, Any]],
    limit: int = MAX_CURATED_STUDIES,
) -> List[Dict[str, Any]]:
    """Derive one study per recurring motif from the stored analyses.

    Every card is built from a real ``insights.weakness_moments`` entry: the
    reason quotes the move, the quality and the opponent of the strongest
    recorded error, and the motif count is the number of moments the engine
    actually tagged. A motif with no Lichess destination is dropped rather than
    rendered as a dead card; an empty (or unenriched) history returns ``[]``.
    """
    groups: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        moments = _as_dict(row.get("insights")).get("weakness_moments")
        if not isinstance(moments, list):
            continue
        summary = _as_dict(row.get("game_summary"))
        opponent = str(summary.get("opponent_name") or "").strip() or None
        analysis_id = str(row.get("id") or "").strip() or None
        platform_game_id = str(row.get("game_id") or "").strip() or None
        for moment in moments:
            if not isinstance(moment, dict):
                continue
            theme = puzzles.theme_for_motif(
                moment.get("motif") or moment.get("resource_theme")
            )
            if not theme:
                continue
            entry = groups.setdefault(theme, {"count": 0, "best": None})
            entry["count"] += 1
            candidate = {
                "move_number": _moment_move_number(moment),
                "quality": str(moment.get("quality") or "").strip().lower() or None,
                "opponent": opponent,
                "game_id": platform_game_id or analysis_id,
                "loss": _moment_loss(moment),
            }
            best = entry["best"]
            if best is None or candidate["loss"] > best["loss"]:
                entry["best"] = candidate

    total_errors = sum(int(entry["count"]) for entry in groups.values())
    ordered = sorted(
        groups.items(), key=lambda item: (-int(item[1]["count"]), item[0])
    )

    studies: List[Dict[str, Any]] = []
    for theme, entry in ordered[: max(0, limit)]:
        link = puzzles.primary_link(theme)
        if link is None or not link.get("url"):
            continue
        count = int(entry["count"])
        label = puzzles.theme_label(theme)
        if total_errors > count:
            evidence = (
                f"{count} of the {total_errors} recorded key errors are "
                f"{label.lower()} patterns"
            )
        else:
            evidence = f"{count} recorded key errors are {label.lower()} patterns"

        best = entry["best"] or {}
        fixes: Optional[str] = None
        if best.get("quality") and best.get("move_number"):
            opponent = (
                f" vs {best['opponent']}" if best.get("opponent") else ""
            )
            fixes = (
                f"Fixes your move {best['move_number']} "
                f"{best['quality']}{opponent}"
            )

        reason = (
            f"{fixes} — {evidence}."
            if fixes
            else f"{evidence[:1].upper()}{evidence[1:]}."
        )
        studies.append(
            {
                "id": f"curated-{theme}",
                "title": puzzles.theme_title(theme),
                "reason": reason,
                "source_url": str(link["url"]),
                "chapters": None,
                "motif": theme,
                "fixes": fixes,
                "game_id": best.get("game_id"),
                "move_number": best.get("move_number"),
            }
        )
    return studies
