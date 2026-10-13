"""Regression tests for engine-backed drill attempt validation.

The threshold, move-replay, terminal-score and graceful-degradation tests run
offline. The tests that need a real evaluation run only when a Stockfish binary
is available.

Run from the backend directory:
    ../.venv/bin/python -m tests.attempt_test
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import chess

from services import engine

START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
BACKRANK_FEN = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"
FOOLS_MATE_FEN = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3"
STALEMATE_FEN = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"

# The FEN the frontend shows before the player's mistake in the dev-preview
# back-rank drill; the stored pre-mistake evaluation is a large White edge.
BACKRANK_EVAL_BEFORE = 30.0


def _has_stockfish() -> bool:
    return bool(os.environ.get("STOCKFISH_PATH") or shutil.which("stockfish"))


def _pool(depth: int = 10, time_limit: float = 0.2) -> engine.EnginePool:
    return engine.EnginePool.create(depth=depth, time_limit=time_limit)


class _ExplodingPool:
    """Stands in for an engine that dies mid-request."""

    size = 1

    def score(self, board: chess.Board):  # noqa: ANN001 - test stub
        raise RuntimeError("engine vanished")


# --------------------------------------------------------------------------- #
# Pure logic: no Stockfish required.                                          #
# --------------------------------------------------------------------------- #


def test_attempt_eval_pawns_pins_mates():
    assert engine._attempt_eval_pawns(35) == 0.35
    assert engine._attempt_eval_pawns(engine.MATE_SCORE) == 1000.0
    assert engine._attempt_eval_pawns(-engine.MATE_SCORE) == -1000.0
    # Two different mating distances must compare equal.
    assert engine._attempt_eval_pawns(engine.MATE_SCORE - 1) == engine._attempt_eval_pawns(
        engine.MATE_SCORE - 7
    )


def test_threshold_boundary_best_move_is_inclusive():
    assert engine.is_attempt_reasonable(engine.ATTEMPT_BEST_MOVE_TOLERANCE_PAWNS, None)
    assert not engine.is_attempt_reasonable(
        engine.ATTEMPT_BEST_MOVE_TOLERANCE_PAWNS + 0.0001, None
    )


def test_threshold_boundary_retention_is_inclusive():
    far = engine.ATTEMPT_BEST_MOVE_TOLERANCE_PAWNS + 5.0
    assert engine.is_attempt_reasonable(far, engine.ATTEMPT_EVAL_RETENTION_TOLERANCE_PAWNS)
    assert not engine.is_attempt_reasonable(
        far, engine.ATTEMPT_EVAL_RETENTION_TOLERANCE_PAWNS + 0.0001
    )


def test_retention_without_anchor_falls_back_to_best_only():
    assert engine.is_attempt_reasonable(0.4, None)
    assert not engine.is_attempt_reasonable(0.6, None)


def test_custom_tolerances_are_honoured():
    assert engine.is_attempt_reasonable(0.9, None, best_tolerance=1.0)
    assert not engine.is_attempt_reasonable(0.9, None, best_tolerance=0.5)


def test_parse_attempt_move_accepts_san_and_uci():
    board = chess.Board(START_FEN)
    assert engine._parse_attempt_move(board, "e4") == chess.Move.from_uci("e2e4")
    assert engine._parse_attempt_move(board, "e2e4") == chess.Move.from_uci("e2e4")
    assert engine._parse_attempt_move(board, "e5") is None


def test_illegal_move_rejected_without_crashing():
    out = engine.evaluate_attempt(START_FEN, "e5")
    assert out["reasonable"] is False
    assert out["validated"] is False
    assert out["reason"] == engine.ATTEMPT_REASON_ILLEGAL


def test_empty_and_garbage_moves_rejected():
    assert engine.evaluate_attempt(START_FEN, "")["validated"] is False
    assert engine.evaluate_attempt(START_FEN, "not-a-move")["validated"] is False


def test_malformed_fen_handled():
    out = engine.evaluate_attempt("clearly-not-a-fen", "e4")
    assert out["validated"] is False
    assert out["reasonable"] is False
    assert out["reason"] == engine.ATTEMPT_REASON_BAD_POSITION


def test_terminal_positions_make_every_move_illegal():
    mate = chess.Board(FOOLS_MATE_FEN)
    assert mate.is_checkmate()
    stale = chess.Board(STALEMATE_FEN)
    assert stale.is_stalemate()
    for fen in (FOOLS_MATE_FEN, STALEMATE_FEN):
        out = engine.evaluate_attempt(fen, "Kg1")
        assert out["validated"] is False
        assert out["reasonable"] is False
        assert out["reason"] == engine.ATTEMPT_REASON_ILLEGAL


def test_terminal_score_signs():
    mate = chess.Board(FOOLS_MATE_FEN)
    assert engine._terminal_score(mate) == -engine.MATE_SCORE
    stale = chess.Board(STALEMATE_FEN)
    assert engine._terminal_score(stale) == 0


def test_engine_failure_degrades_without_rejecting():
    out = engine.evaluate_attempt(BACKRANK_FEN, "Ra8#", pool=_ExplodingPool())
    assert out["validated"] is False
    assert out["reason"] == engine.ATTEMPT_REASON_UNAVAILABLE


def test_missing_binary_degrades_without_rejecting():
    pool = engine.EnginePool("definitely-not-a-real-binary")
    try:
        out = engine.evaluate_attempt(START_FEN, "e4", pool=pool)
    finally:
        pool.close()
    assert out["validated"] is False
    assert out["reason"] == engine.ATTEMPT_REASON_UNAVAILABLE


# --------------------------------------------------------------------------- #
# Engine-backed: skipped when no Stockfish binary is present.                 #
# --------------------------------------------------------------------------- #


def test_engine_best_move_is_accepted():
    if not _has_stockfish():
        print("SKIP (no stockfish binary)")
        return
    pool = _pool()
    try:
        board = chess.Board(START_FEN)
        best = pool.score(board).best
        assert best is not None
        out = engine.evaluate_attempt(START_FEN, best.uci(), pool=pool)
    finally:
        pool.close()
    assert out["validated"] is True
    assert out["reasonable"] is True


def test_reasonable_alternative_is_accepted():
    if not _has_stockfish():
        print("SKIP (no stockfish binary)")
        return
    pool = _pool()
    try:
        # 1.d4 is not necessarily the top move but is well within tolerance.
        out = engine.evaluate_attempt(START_FEN, "d4", pool=pool)
    finally:
        pool.close()
    assert out["validated"] is True
    assert out["reasonable"] is True


def test_eval_retention_accepts_a_move_far_from_best():
    """Criterion B alone: a move is kept because it holds the prior evaluation."""
    if not _has_stockfish():
        print("SKIP (no stockfish binary)")
        return
    pool = _pool()
    try:
        # A known weak move that the engine rates well below the best move...
        probe = engine.evaluate_attempt(BACKRANK_FEN, "Rc1", pool=pool)
        assert probe["validated"] is True
        # ...is accepted once we claim the player already stood that badly.
        out = engine.evaluate_attempt(
            BACKRANK_FEN,
            "Rc1",
            eval_before_pawns=probe["played_eval_pawns"],
            pool=pool,
        )
    finally:
        pool.close()
    assert out["delta_from_best"] > engine.ATTEMPT_BEST_MOVE_TOLERANCE_PAWNS
    assert out["delta_from_before"] <= engine.ATTEMPT_EVAL_RETENTION_TOLERANCE_PAWNS
    assert out["reasonable"] is True


def test_losing_move_is_rejected():
    if not _has_stockfish():
        print("SKIP (no stockfish binary)")
        return
    pool = _pool()
    try:
        out = engine.evaluate_attempt(
            BACKRANK_FEN, "Rc1", eval_before_pawns=BACKRANK_EVAL_BEFORE, pool=pool
        )
    finally:
        pool.close()
    assert out["validated"] is True
    assert out["reasonable"] is False
    assert out["reason"] == engine.ATTEMPT_REASON_TOO_WEAK


def test_mating_move_scores_as_pinned_mate():
    if not _has_stockfish():
        print("SKIP (no stockfish binary)")
        return
    pool = _pool()
    try:
        out = engine.evaluate_attempt(BACKRANK_FEN, "Ra8#", pool=pool)
    finally:
        pool.close()
    assert out["validated"] is True
    assert out["reasonable"] is True
    assert out["played_eval_pawns"] == 1000.0


def main() -> None:
    tests = [
        name
        for name, value in sorted(globals().items())
        if name.startswith("test_") and callable(value)
    ]
    failures = 0
    for name in tests:
        try:
            globals()[name]()
            print(f"PASS {name}")
        except AssertionError as exc:
            failures += 1
            print(f"FAIL {name}: {exc}")
        except Exception as exc:
            failures += 1
            print(f"FAIL {name}: {type(exc).__name__}: {exc}")
    if failures:
        print(f"\n{failures}/{len(tests)} tests failed")
        sys.exit(1)
    print(f"\nAll {len(tests)} tests passed")


if __name__ == "__main__":
    main()
