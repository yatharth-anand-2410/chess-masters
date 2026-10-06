from __future__ import annotations

import io
import math
import os
import queue
import shutil
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import TYPE_CHECKING, Dict, List, Optional, Sequence, Tuple

import chess
import chess.engine
import chess.pgn

if TYPE_CHECKING:
    from services import extractor

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

DEFAULT_DEPTH = 12
DEFAULT_TIME_LIMIT_SECONDS = 0.2
DEFAULT_WORKERS = 1
ENGINE_HASH_MB = 16
DEFAULT_EVAL_REUSE_COVERAGE = 0.9


class EngineError(Exception):
    """Base error for engine analysis failures."""


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


def resolve_engine_path(engine_path: Optional[str] = None) -> str:
    path = engine_path or os.environ.get("STOCKFISH_PATH") or shutil.which("stockfish")
    if not path:
        raise EngineError(
            "Stockfish binary not found. Install it (e.g. `brew install stockfish`) "
            "or set the STOCKFISH_PATH environment variable."
        )
    return path


@dataclass
class PositionScore:
    cp: int
    best: Optional[chess.Move]
    pv: List[chess.Move]


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
    seconds_spent: Optional[float] = None
    clock_remaining: Optional[float] = None

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
            "seconds_spent": self.seconds_spent,
            "clock_remaining": self.clock_remaining,
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
    overall_accuracy: Optional[float] = None
    started_at: Optional[str] = None
    time_control: Optional[str] = None
    termination: Optional[str] = None
    ended_in_checkmate: Optional[bool] = None
    server_evals_used: bool = False

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
            "overall_accuracy": self.overall_accuracy,
            "started_at": self.started_at,
            "time_control": self.time_control,
            "termination": self.termination,
            "ended_in_checkmate": self.ended_in_checkmate,
        }


def _score_from_info(info: chess.engine.InfoDict) -> PositionScore:
    score = info.get("score")
    cp = 0
    if score is not None:
        cp_value = score.white().score(mate_score=MATE_SCORE)
        cp = int(cp_value) if cp_value is not None else 0
    pv = list(info.get("pv", []))
    best = pv[0] if pv else None
    return PositionScore(cp=cp, best=best, pv=pv)


def _terminal_score(board: chess.Board) -> int:
    if board.is_checkmate():
        return -MATE_SCORE if board.turn == chess.WHITE else MATE_SCORE
    return 0


class EnginePool:
    """A lazily started, thread-safe pool of Stockfish processes.

    Engines are only spawned once an ``analyse`` call actually needs one, so an
    analysis that can be answered entirely from server-provided evaluations
    never pays the process startup cost.
    """

    def __init__(
        self,
        engine_path: str,
        size: int = DEFAULT_WORKERS,
        depth: int = DEFAULT_DEPTH,
        time_limit: Optional[float] = DEFAULT_TIME_LIMIT_SECONDS,
    ) -> None:
        self.engine_path = engine_path
        self.size = max(1, int(size))
        self.depth = max(1, int(depth))
        self.time_limit = time_limit
        self._lock = threading.Lock()
        self._engines: List[chess.engine.SimpleEngine] = []
        self._available: "queue.Queue[chess.engine.SimpleEngine]" = queue.Queue()
        self._opened = False

    @classmethod
    def create(
        cls,
        engine_path: Optional[str] = None,
        size: Optional[int] = None,
        depth: Optional[int] = None,
        time_limit: Optional[float] = None,
    ) -> "EnginePool":
        return cls(
            resolve_engine_path(engine_path),
            size=size if size is not None else _env_int("STOCKFISH_WORKERS", DEFAULT_WORKERS),
            depth=depth if depth is not None else _env_int("STOCKFISH_DEPTH", DEFAULT_DEPTH),
            time_limit=(
                time_limit
                if time_limit is not None
                else _env_float("STOCKFISH_TIME", DEFAULT_TIME_LIMIT_SECONDS)
            ),
        )

    def _ensure_opened(self) -> None:
        if self._opened:
            return
        with self._lock:
            if self._opened:
                return
            engines: List[chess.engine.SimpleEngine] = []
            try:
                for _ in range(self.size):
                    engine = chess.engine.SimpleEngine.popen_uci(self.engine_path)
                    try:
                        engine.configure({"Threads": 1, "Hash": ENGINE_HASH_MB})
                    except chess.engine.EngineError:
                        pass
                    engines.append(engine)
            except Exception:
                for engine in engines:
                    engine.quit()
                raise
            self._engines = engines
            for engine in engines:
                self._available.put(engine)
            self._opened = True

    def limit(self) -> chess.engine.Limit:
        return chess.engine.Limit(depth=self.depth, time=self.time_limit or None)

    def analyse(
        self,
        board: chess.Board,
        limit: Optional[chess.engine.Limit] = None,
    ) -> chess.engine.InfoDict:
        self._ensure_opened()
        engine = self._available.get()
        try:
            return engine.analyse(board, limit or self.limit())
        finally:
            self._available.put(engine)

    def score(self, board: chess.Board) -> PositionScore:
        if board.is_game_over():
            return PositionScore(cp=_terminal_score(board), best=None, pv=[])
        return _score_from_info(self.analyse(board))

    def score_many(self, boards: Sequence[chess.Board]) -> List[PositionScore]:
        if not boards:
            return []
        if self.size <= 1 or len(boards) == 1:
            return [self.score(board) for board in boards]
        workers = min(self.size, len(boards))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            return list(executor.map(self.score, boards))

    def close(self) -> None:
        engines = self._engines
        self._engines = []
        self._opened = False
        for engine in engines:
            try:
                engine.quit()
            except Exception:
                pass


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


def _server_eval_score(evaluation: "extractor.ServerEval") -> PositionScore:
    if evaluation.mate is not None:
        cp = MATE_SCORE if evaluation.mate > 0 else -MATE_SCORE
    else:
        cp = int(evaluation.cp or 0)
    return PositionScore(cp=cp, best=None, pv=[])


class StockfishAnalyzer:
    def __init__(
        self,
        depth: Optional[int] = None,
        engine_path: Optional[str] = None,
        workers: Optional[int] = None,
        time_limit: Optional[float] = None,
    ) -> None:
        self.depth = depth if depth is not None else _env_int("STOCKFISH_DEPTH", DEFAULT_DEPTH)
        self.time_limit = (
            time_limit
            if time_limit is not None
            else _env_float("STOCKFISH_TIME", DEFAULT_TIME_LIMIT_SECONDS)
        )
        self.workers = workers if workers is not None else DEFAULT_WORKERS
        self.engine_path = resolve_engine_path(engine_path)

    def analyze_game(
        self,
        pgn: str,
        player_color: Optional[str] = None,
        player_name: Optional[str] = None,
        started_at: Optional[str] = None,
        time_control: Optional[str] = None,
        move_times: Optional[Dict[tuple, tuple]] = None,
        server_evals: Optional[Sequence["extractor.ServerEval"]] = None,
        pool: Optional[EnginePool] = None,
    ) -> AnalysisResult:
        game = chess.pgn.read_game(io.StringIO(pgn))
        if game is None:
            raise EngineError("Could not parse the game PGN.")

        mainline = list(game.mainline())
        if not mainline:
            raise EngineError("The game PGN contains no moves.")

        positions: List[chess.Board] = [game.board()]
        for node in mainline:
            board = positions[-1].copy()
            board.push(node.move)
            positions.append(board)

        endgame_start_ply: Optional[int] = None
        for index, board in enumerate(positions[1:], start=1):
            if endgame_start_ply is None and not (
                board.pieces(chess.QUEEN, chess.WHITE)
                or board.pieces(chess.QUEEN, chess.BLACK)
            ):
                endgame_start_ply = index

        own_pool = pool is None
        active_pool = pool or EnginePool.create(
            engine_path=self.engine_path,
            size=self.workers,
            depth=self.depth,
            time_limit=self.time_limit,
        )
        try:
            scores, server_evals_used = self._position_scores(
                positions, server_evals, active_pool
            )
        finally:
            if own_pool:
                active_pool.close()

        moves: List[MoveInfo] = []
        statistics = {
            QUALITY_BLUNDER: 0,
            QUALITY_MISTAKE: 0,
            QUALITY_INACCURACY: 0,
        }
        eval_curve_cp = [score.cp for score in scores]

        for index, node in enumerate(mainline, start=1):
            board_before = positions[index - 1]
            move = node.move
            color = "white" if board_before.turn == chess.WHITE else "black"
            san = board_before.san(move)
            before = scores[index - 1]
            after = scores[index]

            loss = _centipawn_loss(before.cp, after.cp, color)
            quality = _quality_for_loss(loss)
            if quality in statistics:
                statistics[quality] += 1

            move_number = (index + 1) // 2
            timed = (move_times or {}).get((color, move_number))
            seconds_spent = timed[0] if timed else None
            clock_remaining = timed[1] if timed else None

            moves.append(
                MoveInfo(
                    move_number=move_number,
                    san=san,
                    color=color,
                    phase=_phase_for_ply(index, endgame_start_ply),
                    fen_before=board_before.fen(),
                    played_move=move.uci(),
                    best_move=before.best.uci() if before.best else None,
                    best_move_san=(
                        move_san(board_before, before.best) if before.best else None
                    ),
                    pv=[candidate.uci() for candidate in before.pv],
                    pv_san=moves_san(board_before, before.pv),
                    eval_before_cp=before.cp,
                    eval_after_cp=after.cp,
                    centipawn_loss=loss,
                    quality=quality,
                    seconds_spent=seconds_spent,
                    clock_remaining=clock_remaining,
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
            overall_accuracy=self._compute_overall_accuracy(moves, player_color),
            started_at=started_at,
            time_control=time_control,
            termination=game.headers.get("Termination"),
            ended_in_checkmate=positions[-1].is_checkmate(),
            server_evals_used=server_evals_used,
        )

    def _position_scores(
        self,
        positions: List[chess.Board],
        server_evals: Optional[Sequence["extractor.ServerEval"]],
        pool: EnginePool,
    ) -> Tuple[List[PositionScore], bool]:
        """Score every position, reusing platform evals when they cover the game."""
        count = len(positions)
        known: List[Optional[PositionScore]] = [None] * count
        server_evals_used = False

        if server_evals and _env_bool("STOCKFISH_EVAL_REUSE", True):
            plies_with_eval = 0
            for evaluation in server_evals:
                if 0 < evaluation.ply < count:
                    known[evaluation.ply] = _server_eval_score(evaluation)
                    plies_with_eval += 1
            coverage = _env_float(
                "STOCKFISH_EVAL_REUSE_COVERAGE", DEFAULT_EVAL_REUSE_COVERAGE
            )
            needed = max(1, math.ceil((count - 1) * coverage))
            if plies_with_eval >= needed:
                server_evals_used = True
                known[0] = PositionScore(cp=0, best=None, pv=[])
            else:
                known = [None] * count

        missing_indexes: List[int] = []
        missing_boards: List[chess.Board] = []
        for index, board in enumerate(positions):
            if known[index] is not None:
                continue
            if board.is_game_over():
                known[index] = PositionScore(
                    cp=_terminal_score(board), best=None, pv=[]
                )
                continue
            missing_indexes.append(index)
            missing_boards.append(board)

        if missing_boards:
            for index, score in zip(missing_indexes, pool.score_many(missing_boards)):
                known[index] = score

        return [score if score is not None else PositionScore(0, None, []) for score in known], server_evals_used

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
    def _compute_overall_accuracy(
        moves: List[MoveInfo],
        player_color: Optional[str],
    ) -> Optional[float]:
        if player_color not in ("white", "black"):
            return None
        player_moves = [move for move in moves if move.color == player_color]
        if not player_moves:
            return None
        total = sum(_move_accuracy(move) for move in player_moves)
        return round(total / len(player_moves), 1)

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


def move_san(board: chess.Board, move: chess.Move) -> Optional[str]:
    try:
        candidate = board.copy()
        if move not in candidate.legal_moves:
            return None
        return candidate.san(move)
    except ValueError:
        return None


def moves_san(board: chess.Board, moves: List[chess.Move], limit: int = 6) -> List[str]:
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
