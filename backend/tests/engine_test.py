"""Engine-path regression tests.

The eval-reuse tests run offline. The full-engine comparison test runs only
when a Stockfish binary is available.

Run from the backend directory:
    ../.venv/bin/python -m tests.engine_test
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import engine, extractor

EVAL_PGN = """[Event "Annotated"]
[White "A"]
[Black "B"]
[Result "*"]

1. e4 { [%eval 0.35] } e5 { [%eval 0.12] } 2. Nf3 { [%eval 0.41] } Nc6 { [%eval 0.18] } *
"""

PLAIN_PGN = (
    EVAL_PGN.replace(" { [%eval 0.35] }", "")
    .replace(" { [%eval 0.12] }", "")
    .replace(" { [%eval 0.41] }", "")
    .replace(" { [%eval 0.18] }", "")
)


def test_parse_server_evals():
    evals = extractor.parse_server_evals(EVAL_PGN)
    assert [evaluation.ply for evaluation in evals] == [1, 2, 3, 4]
    assert [evaluation.cp for evaluation in evals] == [35, 12, 41, 18]
    assert all(evaluation.mate is None for evaluation in evals)


def test_parse_server_evals_mate():
    pgn = '[Event "m"]\n\n1. e4 { [%eval #3] } e5 { [%eval #-2] } *'
    evals = extractor.parse_server_evals(pgn)
    assert evals[0].cp is None and evals[0].mate == 3
    assert evals[1].cp is None and evals[1].mate == -2


def test_parse_server_evals_empty():
    assert extractor.parse_server_evals(PLAIN_PGN) == ()


def test_eval_reuse_needs_no_engine():
    """A fully annotated game must be graded without ever spawning Stockfish."""
    evals = extractor.parse_server_evals(EVAL_PGN)
    analyzer = engine.StockfishAnalyzer(
        depth=1, engine_path="definitely-not-a-real-binary"
    )
    pool = engine.EnginePool("definitely-not-a-real-binary")
    try:
        result = analyzer.analyze_game(
            extractor.clean_pgn(EVAL_PGN),
            player_color="white",
            server_evals=evals,
            pool=pool,
        )
    finally:
        pool.close()

    assert result.server_evals_used is True
    assert result.eval_curve_pawns == [0.0, 0.35, 0.12, 0.41, 0.18]
    assert all(move.best_move is None for move in result.moves)
    assert result.statistics == {"blunder": 0, "mistake": 0, "inaccuracy": 0}


def test_partial_evals_fall_back_to_engine():
    if not os.environ.get("STOCKFISH_PATH") and not shutil.which("stockfish"):
        print("SKIP (no stockfish binary)")
        return
    evals = extractor.parse_server_evals(EVAL_PGN)[:1]
    analyzer = engine.StockfishAnalyzer(depth=2, time_limit=0.5)
    result = analyzer.analyze_game(
        extractor.clean_pgn(EVAL_PGN),
        player_color="white",
        server_evals=evals,
    )
    assert result.server_evals_used is False
    assert any(move.best_move is not None for move in result.moves)


def test_eval_reuse_matches_full_engine():
    if not os.environ.get("STOCKFISH_PATH") and not shutil.which("stockfish"):
        print("SKIP (no stockfish binary)")
        return
    analyzer = engine.StockfishAnalyzer(depth=8, time_limit=0)
    full = analyzer.analyze_game(PLAIN_PGN, player_color="white")
    evals = tuple(
        extractor.ServerEval(ply=index + 1, cp=cp, mate=None)
        for index, cp in enumerate(
            round(pawns * 100) for pawns in full.eval_curve_pawns[1:]
        )
    )
    reuse = analyzer.analyze_game(PLAIN_PGN, player_color="white", server_evals=evals)

    assert reuse.server_evals_used is True
    # Position 0 has no server annotation, so it is pinned to the standard 0.00
    # start evaluation; every annotated position must match the engine exactly.
    assert reuse.eval_curve_pawns[0] == 0.0
    assert reuse.eval_curve_pawns[1:] == full.eval_curve_pawns[1:]
    assert [move.quality for move in reuse.moves] == [
        move.quality for move in full.moves
    ]


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
