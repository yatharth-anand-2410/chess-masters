from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional
from urllib.parse import quote_plus

import chess
import chess.engine

from services import (
    diagnostics,
    engine as engine_module,
    motifs,
    openings,
    psychology,
    resources,
    tablebase,
)

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
            candidates.append((move, True))

    if not candidates:
        player_best = [
            move for move in moves if move.color == player_color and move.quality == "best"
        ]
        candidates = [(move, False) for move in player_best[-2:]]

    return candidates[:MAX_STRENGTH_MOMENTS]


def _build_strength_moment(move, player_color: str, capitalizes: bool) -> Dict[str, object]:
    arrows: List[Dict[str, str]] = []
    if move.played_move:
        arrows.append(
            {
                "orig": move.played_move[:2],
                "dest": move.played_move[2:4],
                "color": "green",
            }
        )
    if capitalizes:
        note = (
            "Your opponent's previous move was a serious error, and you found "
            "the strongest reply."
        )
    elif move.pv_san:
        continuation = ", ".join(move.pv_san[:4])
        note = (
            f"You chose {move.san}, keeping your position on track. "
            f"A natural continuation is {continuation}."
        )
    else:
        note = f"You chose {move.san}, keeping your position on track."
    return {
        "move_number": move.move_number,
        "san": move.san,
        "color": move.color,
        "phase": move.phase,
        "quality": "strong",
        "capitalizes": capitalizes,
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
        "note": note,
        "highlight_squares": [],
        "arrows": arrows,
        "blindspot": None,
        "opening": None,
        "tablebase": None,
    }


def _build_moment(move, board_before, player_color, pool, analysis) -> Dict[str, object]:
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
        "note": None,
        "better_move_idea": None,
        "highlight_squares": [],
        "arrows": [],
        "blindspot": None,
        "resource_theme": "blunder",
        "opening": None,
        "tablebase": None,
    }

    primary = motifs.primary_motif(board_before, player_color)
    played = chess.Move.from_uci(move.played_move)
    blindspot = diagnostics.detect_intermezzo(pool, board_before, played)

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

    fallback_idea = _weakness_fallback_idea(moment)
    if fallback_idea:
        moment["better_move_idea"] = fallback_idea

    return moment


def _weakness_fallback_idea(moment: Dict[str, object]) -> Optional[str]:
    tablebase = moment.get("tablebase")
    if isinstance(tablebase, dict):
        changed = tablebase.get("outcome_changed")
        if isinstance(changed, dict) and changed.get("from") and changed.get("to"):
            return (
                "The stronger move keeps the theoretical result; this one turns "
                f"a {changed['from']} into a {changed['to']}."
            )
    if moment.get("motif_details"):
        return str(moment["motif_details"])
    opening = moment.get("opening")
    if isinstance(opening, dict):
        top_moves = opening.get("top_moves") or []
        if top_moves and isinstance(top_moves[0], dict):
            master = top_moves[0].get("san")
            if master:
                return f"Masters usually continue with {master} in this position."
    return None


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


def _fill_move_engine_details(pool: engine_module.EnginePool, move) -> None:
    """Populate best move and principal variation for a moment on demand.

    Needed when the analysis reused platform evaluations, which carry scores
    but no engine lines.
    """
    if move.best_move is not None or not move.fen_before:
        return
    board = chess.Board(move.fen_before)
    if board.is_game_over():
        return
    scored = pool.score(board)
    if scored.best is not None:
        move.best_move = scored.best.uci()
        move.best_move_san = engine_module.move_san(board, scored.best)
    move.pv = [candidate.uci() for candidate in scored.pv]
    move.pv_san = engine_module.moves_san(board, scored.pv)


def _fill_moment_engine_details(
    pool: engine_module.EnginePool,
    moves: List,
) -> None:
    if not moves:
        return
    if pool.size <= 1 or len(moves) == 1:
        for move in moves:
            _fill_move_engine_details(pool, move)
        return
    workers = min(4, len(moves))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        list(executor.map(lambda move: _fill_move_engine_details(pool, move), moves))


def _build_weakness_moments(
    moves: List,
    player_color: str,
    pool: engine_module.EnginePool,
    analysis,
) -> List[Dict[str, object]]:
    if not moves:
        return []
    if len(moves) == 1:
        return [
            _build_moment(
                moves[0], chess.Board(moves[0].fen_before), player_color, pool, analysis
            )
        ]
    workers = min(4, len(moves))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [
            executor.submit(
                _build_moment,
                move,
                chess.Board(move.fen_before),
                player_color,
                pool,
                analysis,
            )
            for move in moves
        ]
        return [future.result() for future in futures]


def build_insights(
    analysis,
    pool: Optional[engine_module.EnginePool] = None,
) -> Dict[str, object]:
    """Enrich the analysis with strength/weakness moments and backend-owned resources."""
    engine_data = analysis.as_engine_data()
    player_color = _resolve_player_color(analysis)
    weakness_moves = _weakness_moves(analysis)
    strength_candidates = _strength_moves(analysis)

    own_pool = pool is None
    active_pool = pool or engine_module.EnginePool.create()
    try:
        selected_moves = list(weakness_moves) + [
            move for move, _ in strength_candidates
        ]
        _fill_moment_engine_details(active_pool, selected_moves)
        weakness_moments = _build_weakness_moments(
            weakness_moves, player_color, active_pool, analysis
        )
    finally:
        if own_pool:
            active_pool.close()

    engine_data["player_color"] = player_color
    engine_data["player_name"] = analysis.player_name
    engine_data["strength_moments"] = [
        _build_strength_moment(move, player_color, capitalizes)
        for move, capitalizes in strength_candidates
    ]
    engine_data["weakness_moments"] = weakness_moments
    engine_data["resources"] = _build_resources(analysis, weakness_moments)
    engine_data["psychology"] = psychology.build_game_primitives(analysis)
    return engine_data