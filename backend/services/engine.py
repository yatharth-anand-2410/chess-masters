from __future__ import annotations

import io
import math
import os
import shutil
from dataclasses import dataclass
from typing import Dict, List, Optional

import chess
import chess.engine
import chess.pgn

MATE_SCORE = 100000
BLUNDER_THRESHOLD_CP = 200
MISTAKE_THRESHOLD_CP = 100
INACCURACY_THRESHOLD_CP = 50

QUALITY_BEST = "best"
QUALITY_GOOD = "good"
QUALITY_INACCURACY = "inaccuracy"
QUALITY_MISTAKE = "mistake"
QUALITY_BLUNDER = "blunder"

PHASE_OPENING = "opening"
PHASE_MIDDLEGAME = "middlegame"
PHASE_ENDGAME = "endgame"
PHASES = (PHASE_OPENING, PHASE_MIDDLEGAME, PHASE_ENDGAME)

OPENING_MOVE_LIMIT = 10

# Chess.com-style accuracy curve constants.
ACCURACY_A = 103.1668
ACCURACY_B = 3.1669
ACCURACY_K = 0.04354
EVAL_LOGISTIC_K = 0.00368208
EVAL_CLAMP_CP = 600


class EngineError(Exception):
    """Base error for engine analysis failures."""


@dataclass
class MoveInfo:
    move_number: int
    san: str
    color: str
    phase: str
    fen_before: str
    played_move: str
    best_move: Optional[str]
    best_move_san: Optional[str]
    pv: List[str]
    pv_san: List[str]
    eval_before_cp: int
    eval_after_cp: int
    centipawn_loss: int
    quality: str

    def to_dict(self) -> Dict[str, object]:
        return {
            "move_number": self.move_number,
            "san": self.san,
            "color": self.color,
            "phase": self.phase,
            "fen_before": self.fen_before,
            "played_move": self.played_move,
            "best_move": self.best_move,
            "best_move_san": self.best_move_san,
            "pv": self.pv,
            "pv_san": self.pv_san,
            "eval_before_pawns": round(self.eval_before_cp / 100, 2),
            "eval_after_pawns": round(self.eval_after_cp / 100, 2),
            "centipawn_loss": self.centipawn_loss,
            "quality": self.quality,
        }


@dataclass
class AnalysisResult:
    player_color: Optional[str]
    player_name: Optional[str]
    result: Optional[str]
    opening_name: Optional[str]
    eco: Optional[str]
    eval_curve_pawns: List[float]
    moves: List[MoveInfo]
    statistics: Dict[str, int]
    phase_accuracies: Dict[str, Optional[float]]

    def key_moments(self) -> List[Dict[str, object]]:
        return [
            move.to_dict()
            for move in self.moves
            if move.quality in (QUALITY_INACCURACY, QUALITY_MISTAKE, QUALITY_BLUNDER)
        ]

    def as_engine_data(self) -> Dict[str, object]:
        return {
            "player_color": self.player_color or "unknown (assume White)",
            "player_name": self.player_name,
            "result": self.result,
            "opening_name": self.opening_name,
            "eco": self.eco,
            "eval_curve_pawns": self.eval_curve_pawns,
            "key_moments": self.key_moments(),
            "statistics": self.statistics,
            "phase_accuracies": self.phase_accuracies,
        }


def _quality_for_loss(loss_cp: int) -> str:
    if loss_cp > BLUNDER_THRESHOLD_CP:
        return QUALITY_BLUNDER
    if loss_cp > MISTAKE_THRESHOLD_CP:
        return QUALITY_MISTAKE
    if loss_cp > INACCURACY_THRESHOLD_CP:
        return QUALITY_INACCURACY
    if loss_cp > 20:
        return QUALITY_GOOD
    return QUALITY_BEST


def _phase_for_ply(ply: int, endgame_start_ply: Optional[int]) -> str:
    if endgame_start_ply is not None and ply >= endgame_start_ply:
        return PHASE_ENDGAME
    if ply <= OPENING_MOVE_LIMIT * 2:
        return PHASE_OPENING
    return PHASE_MIDDLEGAME


def _win_percentage(eval_cp_mover: float) -> float:
    return 50 + 50 * (2 / (1 + math.exp(-EVAL_LOGISTIC_K * eval_cp_mover)) - 1)


def _clamp_eval(eval_cp: int) -> int:
    return max(-EVAL_CLAMP_CP, min(EVAL_CLAMP_CP, eval_cp))


def _centipawn_loss(eval_before_cp: int, eval_after_cp: int, color: str) -> int:
    before = _clamp_eval(eval_before_cp)
    after = _clamp_eval(eval_after_cp)
    loss = (before - after) if color == "white" else (after - before)
    return max(0, loss)


def _move_accuracy(move: MoveInfo) -> float:
    eval_before_mover = (
        move.eval_before_cp if move.color == "white" else -move.eval_before_cp
    )
    eval_after_mover = (
        move.eval_after_cp if move.color == "white" else -move.eval_after_cp
    )
    win_diff = _win_percentage(eval_before_mover) - _win_percentage(eval_after_mover)
    accuracy = ACCURACY_A * math.exp(-ACCURACY_K * win_diff) - ACCURACY_B
    return max(0.0, min(100.0, accuracy))


class StockfishAnalyzer:
    def __init__(self, depth: int = 12, engine_path: Optional[str] = None) -> None:
        self.depth = depth
        self.engine_path = (
            engine_path
            or os.environ.get("STOCKFISH_PATH")
            or shutil.which("stockfish")
        )
        if not self.engine_path:
            raise EngineError(
                "Stockfish binary not found. Install it (e.g. `brew install stockfish`) "
                "or set the STOCKFISH_PATH environment variable."
            )

    def analyze_game(
        self,
        pgn: str,
        player_color: Optional[str] = None,
        player_name: Optional[str] = None,
    ) -> AnalysisResult:
        game = chess.pgn.read_game(io.StringIO(pgn))
        if game is None:
            raise EngineError("Could not parse the game PGN.")

        board = game.board()
        mainline = list(game.mainline())
        if not mainline:
            raise EngineError("The game PGN contains no moves.")

        moves: List[MoveInfo] = []
        eval_curve_cp: List[int] = []
        statistics = {
            QUALITY_BLUNDER: 0,
            QUALITY_MISTAKE: 0,
            QUALITY_INACCURACY: 0,
        }
        endgame_start_ply: Optional[int] = None

        with chess.engine.SimpleEngine.popen_uci(self.engine_path) as engine:
            current_eval, current_best, current_pv = self._score_position(engine, board)
            eval_curve_cp.append(current_eval)

            for index, node in enumerate(mainline, start=1):
                move = node.move
                color = "white" if board.turn == chess.WHITE else "black"
                san = board.san(move)
                eval_before = current_eval
                fen_before = board.fen()
                best_move = current_best
                best_move_san = _move_san(board, current_best) if current_best else None
                pv = current_pv
                pv_san = _moves_san(board, current_pv)

                board.push(move)
                has_queens = bool(
                    board.pieces(chess.QUEEN, chess.WHITE)
                    or board.pieces(chess.QUEEN, chess.BLACK)
                )
                if not has_queens and endgame_start_ply is None:
                    endgame_start_ply = index
                current_eval, current_best, current_pv = self._score_position(engine, board)
                eval_curve_cp.append(current_eval)

                loss = _centipawn_loss(eval_before, current_eval, color)
                quality = _quality_for_loss(loss)
                if quality in statistics:
                    statistics[quality] += 1

                moves.append(
                    MoveInfo(
                        move_number=(index + 1) // 2,
                        san=san,
                        color=color,
                        phase=_phase_for_ply(index, endgame_start_ply),
                        fen_before=fen_before,
                        played_move=move.uci(),
                        best_move=best_move.uci() if best_move else None,
                        best_move_san=best_move_san,
                        pv=[m.uci() for m in pv],
                        pv_san=pv_san,
                        eval_before_cp=eval_before,
                        eval_after_cp=current_eval,
                        centipawn_loss=loss,
                        quality=quality,
                    )
                )

        return AnalysisResult(
            player_color=player_color,
            player_name=player_name,
            result=game.headers.get("Result"),
            opening_name=self._opening_name(game),
            eco=game.headers.get("ECO"),
            eval_curve_pawns=[round(cp / 100, 2) for cp in eval_curve_cp],
            moves=moves,
            statistics=statistics,
            phase_accuracies=self._compute_phase_accuracies(moves, player_color),
        )

    @staticmethod
    def _opening_name(game: chess.pgn.Game) -> Optional[str]:
        opening_name = game.headers.get("Opening")
        if opening_name:
            return opening_name
        eco_url = game.headers.get("ECOUrl", "")
        slug = eco_url.rstrip("/").split("/")[-1]
        if not slug:
            return None
        name_part = slug.split("-with-")[0]
        return name_part.replace("-", " ").title() if name_part else None

    @staticmethod
    def _compute_phase_accuracies(
        moves: List[MoveInfo],
        player_color: Optional[str],
    ) -> Dict[str, Optional[float]]:
        if player_color not in ("white", "black"):
            return {phase: None for phase in PHASES}
        player_moves = [move for move in moves if move.color == player_color]
        accuracies: Dict[str, Optional[float]] = {}
        for phase in PHASES:
            phase_moves = [move for move in player_moves if move.phase == phase]
            if not phase_moves:
                accuracies[phase] = None
                continue
            total = sum(_move_accuracy(move) for move in phase_moves)
            accuracies[phase] = round(total / len(phase_moves), 1)
        return accuracies

    def _score_position(
        self,
        engine: chess.engine.SimpleEngine,
        board: chess.Board,
    ) -> tuple[int, Optional[chess.Move], List[chess.Move]]:
        if board.is_game_over():
            return self._terminal_score(board), None, []
        info = engine.analyse(board, chess.engine.Limit(depth=self.depth))
        score = info.get("score")
        cp = 0
        if score is not None:
            cp_value = score.white().score(mate_score=MATE_SCORE)
            cp = int(cp_value) if cp_value is not None else 0
        pv = list(info.get("pv", []))
        best = pv[0] if pv else None
        return cp, best, pv

    @staticmethod
    def _terminal_score(board: chess.Board) -> int:
        if board.is_checkmate():
            return -MATE_SCORE if board.turn == chess.WHITE else MATE_SCORE
        return 0


def _move_san(board: chess.Board, move: chess.Move) -> Optional[str]:
    try:
        candidate = board.copy()
        if move not in candidate.legal_moves:
            return None
        return candidate.san(move)
    except ValueError:
        return None


def _moves_san(board: chess.Board, moves: List[chess.Move], limit: int = 6) -> List[str]:
    candidate = board.copy()
    sans: List[str] = []
    for move in moves[:limit]:
        try:
            if move not in candidate.legal_moves:
                break
            sans.append(candidate.san(move))
            candidate.push(move)
        except (ValueError, IndexError):
            break
    return sans