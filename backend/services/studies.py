"""Lichess Study Fetcher and Chapter Parser.

Imports public Lichess studies via their study ID or full URL, and parses each
chapter into a structured hierarchical tree including:
- PGN annotations and NAG glyphs (!, ?, !!, etc.)
- Visual board circles (`[%csl Gc4,Re5]`)
- Directional board arrows (`[%cal Gc1g5,Re1e8]`)
- Text comments with markup cleanly separated
- Full branching variations and sub-variations
"""

from __future__ import annotations

import io
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

import chess
import chess.pgn
import requests
from pydantic import BaseModel, Field

from services import http

LICHESS_STUDY_URL = "https://lichess.org/study/{study_id}.pgn"
STUDY_ID_REGEX = re.compile(r"([a-zA-Z0-9]{8})")

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
    """The study does not exist or is marked private on Lichess."""


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


class StudyImportResponse(BaseModel):
    study_id: str = Field(..., description="8-character Lichess study ID")
    study_title: str = Field(..., description="Title of the study")
    source_url: str = Field(..., description="Direct Lichess study URL")
    chapter_count: int = Field(..., description="Number of chapters imported")
    chapters: List[StudyChapter] = Field(default_factory=list, description="Parsed study chapters")
    total_annotations: int = Field(0, description="Total arrows, circles, and comments parsed")


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


def fetch_lichess_study_pgn(study_id: str) -> str:
    """Fetch raw multi-chapter PGN export from Lichess public API."""
    url = LICHESS_STUDY_URL.format(study_id=study_id)
    try:
        response = http.get(url, timeout=20.0, allow_redirects=True)
    except requests.RequestException as exc:
        raise StudyFetchError(f"Could not connect to Lichess: {exc}") from exc

    if response.status_code == 404 or "/signup" in response.url:
        raise StudyNotFoundError(f"Lichess study '{study_id}' was not found or is marked private.")
    if response.status_code != 200:
        raise StudyFetchError(f"Lichess study export returned status {response.status_code}.")

    text = response.text.strip()
    if not text:
        raise StudyNotFoundError(f"Study '{study_id}' contains no public chapters or content.")

    return text


def parse_study_pgn(pgn_text: str, study_id: str) -> StudyImportResponse:
    """Parse raw multi-chapter PGN string into a structured StudyImportResponse."""
    pgn_io = io.StringIO(pgn_text)
    chapters: List[StudyChapter] = []
    study_title: Optional[str] = None
    total_annotations = 0
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

        orientation = game.headers.get("Orientation", "white").lower()
        if orientation not in ("white", "black"):
            orientation = "white"

        initial_fen = game.headers.get("FEN", chess.STARTING_FEN)
        board = chess.Board(initial_fen)

        moves_tree: List[StudyMoveNode] = []
        for top_var in game.variations:
            parsed_node = _parse_variation_node(top_var, ply=1, board=board)
            moves_tree.append(parsed_node)

        # Count annotations and main line plies
        main_moves_count = 0
        curr: Optional[StudyMoveNode] = moves_tree[0] if moves_tree else None
        while curr:
            main_moves_count += 1
            if curr.comment:
                total_annotations += 1
            total_annotations += len(curr.circles) + len(curr.arrows)
            curr = curr.variations[0] if curr.variations else None

        chapters.append(
            StudyChapter(
                id=str(chapter_index),
                title=title,
                orientation=orientation,
                initial_fen=initial_fen,
                moves_tree=moves_tree,
                total_moves=main_moves_count,
                tags=dict(game.headers),
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
    )


def import_lichess_study(study_id_or_url: str) -> StudyImportResponse:
    """High-level function to extract study ID, fetch PGN, and parse all chapters."""
    study_id = extract_study_id(study_id_or_url)
    pgn_text = fetch_lichess_study_pgn(study_id)
    return parse_study_pgn(pgn_text, study_id)
