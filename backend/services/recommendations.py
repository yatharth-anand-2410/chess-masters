from __future__ import annotations

from typing import Dict, List, Optional
from urllib.parse import quote_plus

import chess
import chess.engine

from services import diagnostics, motifs, openings, resources, tablebase

MAX_WEAKNESS_MOMENTS = 4
MIN_CENTIPAWN_LOSS = 60
MAX_DECISIVE_EVAL_CP = 600
MAX_STRENGTH_MOMENTS = 3

TABLEBASE_RESULT = {
    "win": "win",
    "loss": "loss",
    "draw": "draw",
}

PHASE_FALLBACK_THEMES = {
    "opening": "opening",
    "middlegame": "middlegame",
    "endgame": "endgame",
}


def _resolve_player_color(analysis) -> str:
    color = analysis.player_color
    if color not in ("white", "black"):
        raise ValueError(
            "Could not determine which color the player played. "
            "Please select White or Black."
        )
    return color


def _player_perspective(category: str, side_to_move: chess.Color, player_color: chess.Color) -> str:
    if category not in TABLEBASE_RESULT:
        return category
    if category == "draw":
        return "draw"
    if side_to_move == player_color:
        return category
    return "win" if category == "loss" else "loss"


def _clamp_eval(eval_cp: int) -> int:
    return max(-MAX_DECISIVE_EVAL_CP, min(MAX_DECISIVE_EVAL_CP, eval_cp))


def _weakness_moves(analysis) -> List:
    player_color = _resolve_player_color(analysis)
    player_moves = [
        move
        for move in analysis.moves
        if move.color == player_color
        and move.quality in ("blunder", "mistake", "inaccuracy")
        and move.centipawn_loss >= MIN_CENTIPAWN_LOSS
        and abs(move.eval_before_cp) <= MAX_DECISIVE_EVAL_CP
    ]
    player_moves.sort(key=lambda move: move.centipawn_loss, reverse=True)
    return player_moves[:MAX_WEAKNESS_MOMENTS]


def _strength_moves(analysis) -> List:
    player_color = _resolve_player_color(analysis)
    moves = analysis.moves
    candidates: List = []
    for index, move in enumerate(moves):
        if move.color != player_color or move.quality not in ("best", "good"):
            continue
        previous = moves[index - 1] if index > 0 else None
        capitalizes = (
            previous is not None
            and previous.color != player_color
            and previous.centipawn_loss >= 150
        )
        if capitalizes:
            candidates.append(move)

    if not candidates:
        player_best = [
            move for move in moves if move.color == player_color and move.quality == "best"
        ]
        candidates = player_best[-2:]

    return candidates[:MAX_STRENGTH_MOMENTS]


def _build_strength_moment(move, player_color: str) -> Dict[str, object]:
    arrows: List[Dict[str, str]] = []
    if move.played_move:
        arrows.append(
            {
                "orig": move.played_move[:2],
                "dest": move.played_move[2:4],
                "color": "green",
            }
        )
    return {
        "move_number": move.move_number,
        "san": move.san,
        "color": move.color,
        "phase": move.phase,
        "quality": "strong",
        "centipawn_loss": 0,
        "fen_before": move.fen_before,
        "played_move": move.played_move,
        "player_color": player_color,
        "eval_before_pawns": round(move.eval_before_cp / 100, 2),
        "eval_after_pawns": round(move.eval_after_cp / 100, 2),
        "best_move_san": None,
        "best_move": None,
        "pv_san": [],
        "motif": None,
        "motif_details": None,
        "highlight_squares": [],
        "arrows": arrows,
        "blindspot": None,
        "opening": None,
        "tablebase": None,
    }


def _build_moment(move, board_before, player_color, engine, analysis) -> Dict[str, object]:
    moment: Dict[str, object] = {
        "move_number": move.move_number,
        "san": move.san,
        "color": move.color,
        "phase": move.phase,
        "quality": move.quality,
        "centipawn_loss": move.centipawn_loss,
        "fen_before": move.fen_before,
        "played_move": move.played_move,
        "player_color": player_color,
        "eval_before_pawns": round(move.eval_before_cp / 100, 2),
        "eval_after_pawns": round(move.eval_after_cp / 100, 2),
        "best_move_san": move.best_move_san,
        "best_move": move.best_move,
        "pv_san": move.pv_san,
        "motif": None,
        "motif_details": None,
        "highlight_squares": [],
        "arrows": [],
        "blindspot": None,
        "resource_theme": "blunder",
        "opening": None,
        "tablebase": None,
    }

    primary = motifs.primary_motif(board_before, player_color)
    played = chess.Move.from_uci(move.played_move)
    blindspot = diagnostics.detect_intermezzo(engine, board_before, played)

    theme = None
    if blindspot:
        theme = blindspot.get("theme", "intermezzo")
        moment["blindspot"] = blindspot
    elif primary:
        theme = primary.get("theme")
        moment["motif"] = primary.get("label")
        moment["motif_details"] = primary.get("details")
        moment["highlight_squares"] = primary.get("highlight_squares", [])
        moment["arrows"] = list(primary.get("arrows", []))

    moment["resource_theme"] = theme or PHASE_FALLBACK_THEMES.get(move.phase, "blunder")

    arrows: List[Dict[str, str]] = list(moment["arrows"])
    if move.played_move:
        arrows.append(
            {
                "orig": move.played_move[:2],
                "dest": move.played_move[2:4],
                "color": "red",
            }
        )
    if move.best_move and move.best_move != move.played_move:
        arrows.append(
            {
                "orig": move.best_move[:2],
                "dest": move.best_move[2:4],
                "color": "green",
            }
        )
    moment["arrows"] = arrows

    if move.phase == "opening":
        moment["opening"] = openings.opening_insight(
            move.fen_before,
            opening_name=analysis.opening_name,
            eco=analysis.eco,
        )

    if move.phase == "endgame":
        tb_before = tablebase.tablebase_insight(move.fen_before)
        if tb_before:
            moment["tablebase"] = tb_before
            after_board = board_before.copy()
            after_board.push(played)
            tb_after = tablebase.tablebase_insight(after_board.fen())
            if tb_after:
                before_result = _player_perspective(
                    tb_before.get("category", ""),
                    board_before.turn,
                    player_color,
                )
                after_result = _player_perspective(
                    tb_after.get("category", ""),
                    after_board.turn,
                    player_color,
                )
                if before_result != after_result and before_result in TABLEBASE_RESULT:
                    moment["tablebase"]["outcome_changed"] = {
                        "from": before_result,
                        "to": after_result,
                    }

    return moment


def _build_resources(analysis, weakness_moments: List[Dict[str, object]]) -> List[Dict[str, object]]:
    resources_out: List[Dict[str, object]] = []
    seen: set = set()

    for moment in weakness_moments:
        theme = moment.get("resource_theme", "blunder")
        move_label = f"{moment['move_number']}. {moment['san']}"
        link = resources.exercise_link(theme)
        if link and link["url"] not in seen:
            seen.add(link["url"])
            resources_out.append(
                {
                    "title": link["title"],
                    "url": link["url"],
                    "theme": link["theme"],
                    "source_move": move_label,
                }
            )
        if theme == "opening":
            fen_url = resources.opening_analysis_url(moment["fen_before"])
            if fen_url not in seen:
                seen.add(fen_url)
                resources_out.append(
                    {
                        "title": "Analyze this critical opening position",
                        "url": fen_url,
                        "theme": "analysis",
                        "source_move": move_label,
                    }
                )

    if analysis.opening_name:
        url = f"https://lichess.org/study/search?q={quote_plus(analysis.opening_name)}"
        if url not in seen:
            resources_out.append(
                {
                    "title": f"Study the {analysis.opening_name}",
                    "url": url,
                    "theme": "opening_study",
                    "source_move": None,
                }
            )

    return resources_out


def build_insights(analysis) -> Dict[str, object]:
    """Enrich the analysis with strength/weakness moments and backend-owned resources."""
    engine_data = analysis.as_engine_data()
    player_color = _resolve_player_color(analysis)
    weakness_moments: List[Dict[str, object]] = []

    engine = None
    try:
        from services import engine as engine_module

        engine = chess.engine.SimpleEngine.popen_uci(engine_module.StockfishAnalyzer().engine_path)
        for move in _weakness_moves(analysis):
            board_before = chess.Board(move.fen_before)
            weakness_moments.append(_build_moment(move, board_before, player_color, engine, analysis))
    finally:
        if engine is not None:
            engine.quit()

    engine_data["player_color"] = player_color
    engine_data["player_name"] = analysis.player_name
    engine_data["strength_moments"] = [
        _build_strength_moment(move, player_color) for move in _strength_moves(analysis)
    ]
    engine_data["weakness_moments"] = weakness_moments
    engine_data["resources"] = _build_resources(analysis, weakness_moments)
    return engine_data