from __future__ import annotations

from typing import Dict, List, Optional

import chess

PIECE_VALUE = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
    chess.KING: 0,
}

MOTIF_LABELS: Dict[str, str] = {
    "fork": "Fork",
    "pin": "Pin",
    "skewer": "Skewer",
    "hangingPiece": "Hanging piece",
    "discoveredAttack": "Discovered attack",
    "promotion": "Promotion threat",
    "backRank": "Back-rank weakness",
    "vulnerableKing": "Vulnerable king",
}

MOTIF_PRIORITY: Dict[str, int] = {
    "fork": 8,
    "skewer": 7,
    "pin": 6,
    "hangingPiece": 5,
    "discoveredAttack": 4,
    "promotion": 3,
    "vulnerableKing": 2,
    "backRank": 1,
}


def _to_color(side: object) -> chess.Color:
    if side is True or side is False:
        return side
    return chess.WHITE if str(side).lower() == "white" else chess.BLACK


def detect_motifs(board: chess.Board, side: chess.Color) -> List[Dict[str, object]]:
    """Detect tactics available to ``side`` in the given position."""
    side = _to_color(side)
    detected: List[Dict[str, object]] = []
    detectors = (
        _detect_fork,
        _detect_skewer,
        _detect_pin,
        _detect_hanging_piece,
        _detect_discovered_attack,
        _detect_promotion,
        _detect_vulnerable_king,
        _detect_back_rank,
    )
    for detector in detectors:
        result = detector(board, side)
        if result:
            detected.append(result)
    return sorted(detected, key=lambda item: MOTIF_PRIORITY.get(item["theme"], 0), reverse=True)


def primary_motif(board: chess.Board, side: chess.Color) -> Optional[Dict[str, object]]:
    motifs = detect_motifs(board, side)
    return motifs[0] if motifs else None


def _square_names(board: chess.Board, squares: List[int]) -> List[str]:
    return [chess.square_name(sq) for sq in squares]


def _detect_fork(board: chess.Board, side: chess.Color) -> Optional[Dict[str, object]]:
    opponent = not side
    for square, piece in board.piece_map().items():
        if piece.color != side or piece.piece_type == chess.KING:
            continue
        attacked = board.attacks(square)
        targets = [
            sq
            for sq in attacked
            if board.piece_at(sq)
            and board.piece_at(sq).color == opponent
            and board.piece_at(sq).piece_type != chess.KING
        ]
        values = sorted(
            (PIECE_VALUE[board.piece_at(sq).piece_type] for sq in targets),
            reverse=True,
        )
        if len(values) >= 2 and values[0] + values[1] >= 5:
            return {
                "theme": "fork",
                "label": MOTIF_LABELS["fork"],
                "details": (
                    f"{piece.symbol().upper()} on {chess.square_name(square)} attacks "
                    f"{', '.join(_square_names(board, targets[:3]))} simultaneously."
                ),
                "highlight_squares": [chess.square_name(square)]
                + _square_names(board, targets[:2]),
                "arrows": [
                    {"orig": chess.square_name(square), "dest": chess.square_name(t), "color": "green"}
                    for t in targets[:2]
                ],
            }
    return None


def _ray_targets(board: chess.Board, square: int, direction: tuple[int, int]) -> List[int]:
    targets: List[int] = []
    file = chess.square_file(square)
    rank = chess.square_rank(square)
    while True:
        file += direction[0]
        rank += direction[1]
        if not (0 <= file < 8 and 0 <= rank < 8):
            break
        target = chess.square(file, rank)
        targets.append(target)
        if board.piece_at(target):
            break
    return targets


def _sliding_squares(board: chess.Board, color: chess.Color) -> chess.SquareSet:
    squares = chess.SquareSet()
    for piece_type in (chess.ROOK, chess.BISHOP, chess.QUEEN):
        squares |= board.pieces(piece_type, color)
    return squares


def _detect_skewer(board: chess.Board, side: chess.Color) -> Optional[Dict[str, object]]:
    opponent = not side
    sliding = {chess.ROOK, chess.BISHOP, chess.QUEEN}
    directions = {
        chess.ROOK: [(1, 0), (-1, 0), (0, 1), (0, -1)],
        chess.BISHOP: [(1, 1), (1, -1), (-1, 1), (-1, -1)],
        chess.QUEEN: [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)],
    }
    for square in _sliding_squares(board, side):
        piece = board.piece_at(square)
        for direction in directions[piece.piece_type]:
            ray = _ray_targets(board, square, direction)
            if len(ray) < 2:
                continue
            first = ray[0]
            second = ray[1]
            first_piece = board.piece_at(first)
            second_piece = board.piece_at(second)
            if (
                first_piece
                and second_piece
                and first_piece.color == opponent
                and second_piece.color == opponent
                and first_piece.piece_type != chess.KING
                and PIECE_VALUE[first_piece.piece_type] > PIECE_VALUE[second_piece.piece_type]
                and PIECE_VALUE[first_piece.piece_type] >= 5
            ):
                return {
                    "theme": "skewer",
                    "label": MOTIF_LABELS["skewer"],
                    "details": (
                        f"{piece.symbol().upper()} on {chess.square_name(square)} skewers "
                        f"{first_piece.symbol().upper()} on {chess.square_name(first)} against "
                        f"{second_piece.symbol().upper()} on {chess.square_name(second)}."
                    ),
                    "highlight_squares": [
                        chess.square_name(square),
                        chess.square_name(first),
                        chess.square_name(second),
                    ],
                    "arrows": [
                        {"orig": chess.square_name(square), "dest": chess.square_name(first), "color": "green"}
                    ],
                }
    return None


def _detect_pin(board: chess.Board, side: chess.Color) -> Optional[Dict[str, object]]:
    opponent = not side
    for square in board.piece_map():
        piece = board.piece_at(square)
        if piece.color != opponent or piece.piece_type == chess.KING:
            continue
        if board.is_pinned(opponent, square):
            attackers = board.attackers(side, square)
            if attackers or PIECE_VALUE[piece.piece_type] >= 3:
                return {
                    "theme": "pin",
                    "label": MOTIF_LABELS["pin"],
                    "details": (
                        f"Opponent's {piece.symbol().upper()} on {chess.square_name(square)} "
                        f"is pinned and cannot move without exposing a more valuable piece."
                    ),
                    "highlight_squares": [chess.square_name(square)],
                }
    return None


def _detect_hanging_piece(board: chess.Board, side: chess.Color) -> Optional[Dict[str, object]]:
    opponent = not side
    for square in board.piece_map():
        piece = board.piece_at(square)
        if (
            piece.color != opponent
            or piece.piece_type == chess.KING
            or PIECE_VALUE[piece.piece_type] < 3
        ):
            continue
        attackers = board.attackers(side, square)
        defenders = board.attackers(opponent, square)
        if attackers and not defenders:
            attacker_square = next(iter(attackers))
            return {
                "theme": "hangingPiece",
                "label": MOTIF_LABELS["hangingPiece"],
                "details": (
                    f"Opponent's {piece.symbol().upper()} on {chess.square_name(square)} is "
                    f"undefended and capturable."
                ),
                "highlight_squares": [chess.square_name(square)],
                "arrows": [
                    {"orig": chess.square_name(attacker_square), "dest": chess.square_name(square), "color": "green"}
                ],
            }
    return None


def _detect_discovered_attack(board: chess.Board, side: chess.Color) -> Optional[Dict[str, object]]:
    opponent = not side
    sliding = {chess.ROOK, chess.BISHOP, chess.QUEEN}
    for blocker_square, blocker in board.piece_map().items():
        if blocker.color != side or blocker.piece_type == chess.KING:
            continue
        probe = board.copy()
        probe.remove_piece_at(blocker_square)
        for attacker_square in _sliding_squares(probe, side):
            attacked = probe.attacks(attacker_square)
            for target_square in attacked:
                target = probe.piece_at(target_square)
                if (
                    target
                    and target.color == opponent
                    and PIECE_VALUE[target.piece_type] >= 5
                ):
                    return {
                        "theme": "discoveredAttack",
                        "label": MOTIF_LABELS["discoveredAttack"],
                        "details": (
                            f"Moving {blocker.symbol().upper()} from {chess.square_name(blocker_square)} "
                            f"uncovers an attack by the piece behind it on "
                            f"{target.symbol().upper()} at {chess.square_name(target_square)}."
                        ),
                        "highlight_squares": [
                            chess.square_name(blocker_square),
                            chess.square_name(target_square),
                        ],
                        "arrows": [
                            {"orig": chess.square_name(attacker_square), "dest": chess.square_name(target_square), "color": "green"}
                        ],
                    }
    return None


def _detect_promotion(board: chess.Board, side: chess.Color) -> Optional[Dict[str, object]]:
    promo_rank = 6 if side == chess.WHITE else 1
    for square in board.pieces(chess.PAWN, side):
        if chess.square_rank(square) == promo_rank:
            direction = 1 if side == chess.WHITE else -1
            dest = chess.square(chess.square_file(square), chess.square_rank(square) + direction)
            return {
                "theme": "promotion",
                "label": MOTIF_LABELS["promotion"],
                "details": (
                    f"A pawn on {chess.square_name(square)} is one step from promotion."
                ),
                "highlight_squares": [chess.square_name(square), chess.square_name(dest)],
                "arrows": [
                    {"orig": chess.square_name(square), "dest": chess.square_name(dest), "color": "green"}
                ],
            }
    return None


def _detect_vulnerable_king(board: chess.Board, side: chess.Color) -> Optional[Dict[str, object]]:
    opponent = not side
    king_square = board.king(opponent)
    if king_square is None:
        return None
    adjacent = list(board.attacks(king_square))
    friendly_nearby = sum(
        1
        for sq in adjacent
        if board.piece_at(sq) and board.piece_at(sq).color == opponent
    )
    king_rank = chess.square_rank(king_square)
    king_file = chess.square_file(king_square)
    on_back_rank = king_rank in (0, 7)
    in_center = 2 <= king_file <= 5 and 2 <= king_rank <= 5
    home_center = on_back_rank and 3 <= king_file <= 4
    castled = on_back_rank and king_file in (1, 2, 6, 7)

    if castled:
        return None
    if home_center and friendly_nearby >= 3:
        return None
    if (in_center or home_center) and friendly_nearby <= 2:
        return {
            "theme": "vulnerableKing",
            "label": MOTIF_LABELS["vulnerableKing"],
            "details": (
                f"Opponent's king on {chess.square_name(king_square)} is exposed with only "
                f"{friendly_nearby} friendly piece(s) nearby"
                + (", sitting in the center" if in_center else "")
                + "."
            ),
            "highlight_squares": [chess.square_name(king_square)],
        }
    return None


def _detect_back_rank(board: chess.Board, side: chess.Color) -> Optional[Dict[str, object]]:
    opponent = not side
    king_square = board.king(opponent)
    if king_square is None:
        return None
    back_rank = 7 if opponent == chess.WHITE else 0
    if chess.square_rank(king_square) != back_rank:
        return None
    escape_squares = [
        sq
        for sq in board.attacks(king_square)
        if chess.square_rank(sq) == back_rank
        and board.piece_at(sq) is None
        and not board.attackers(side, sq)
    ]
    if not escape_squares:
        return {
            "theme": "backRank",
            "label": MOTIF_LABELS["backRank"],
            "details": (
                f"Opponent's king on {chess.square_name(king_square)} is trapped on the back rank."
            ),
            "highlight_squares": [chess.square_name(king_square)],
        }
    return None