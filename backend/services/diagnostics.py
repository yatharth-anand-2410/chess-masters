from __future__ import annotations

from typing import Dict, List, Optional

import chess
import chess.engine

DIAGNOSTIC_DEPTH = 16


def detect_intermezzo(
    engine: chess.engine.SimpleEngine,
    board_before: chess.Board,
    played_move: chess.Move,
) -> Optional[Dict[str, object]]:
    """Detect the classic calculation blind spot: the player captures expecting a
    recapture, but the opponent answers with an intermediate forcing move instead.

    Returns a structured description of the blind spot, or None when the natural
    recapture was played or no recapture tension existed.
    """
    analysis_board = board_before.copy()
    if played_move not in analysis_board.legal_moves:
        return None

    was_capture = analysis_board.is_capture(played_move)
    analysis_board.push(played_move)

    expected_recaptures: List[chess.Move] = []
    if was_capture:
        captured_square = played_move.to_square
        if analysis_board.is_en_passant(played_move):
            captured_square = chess.square(
                chess.square_file(played_move.to_square),
                chess.square_rank(played_move.from_square),
            )
        expected_recaptures = [
            move
            for move in analysis_board.legal_moves
            if move.to_square == captured_square
            and analysis_board.is_capture(move)
        ]

    if not expected_recaptures:
        return None

    info = engine.analyse(
        analysis_board,
        chess.engine.Limit(depth=DIAGNOSTIC_DEPTH),
    )
    pv = list(info.get("pv", []))
    if not pv:
        return None

    first_response = pv[0]
    if first_response in expected_recaptures:
        return None

    is_check = analysis_board.gives_check(first_response)
    is_capture = analysis_board.is_capture(first_response)
    is_promotion = first_response.promotion is not None
    is_forcing = is_check or is_capture or is_promotion

    if not is_forcing:
        return None

    expected_san = analysis_board.san(expected_recaptures[0])
    actual_san = analysis_board.san(first_response)
    confidence = "high" if (is_check or is_capture or is_promotion) else "medium"

    return {
        "type": "intermediate_move",
        "theme": "intermezzo",
        "expected_recapture": expected_san,
        "actual_move": actual_san,
        "is_check": is_check,
        "confidence": confidence,
        "explanation": (
            f"You played a capture expecting the natural recapture {expected_san}, "
            f"but the opponent answered with the intermediate forcing move {actual_san}."
        ),
    }