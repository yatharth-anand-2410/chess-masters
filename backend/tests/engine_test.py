"""Engine-path regression tests.

The eval-reuse tests run offline. The full-engine comparison test runs only
when a Stockfish binary is available.

Run from the backend directory:
    ../.venv/bin/python -m tests.engine_test
"""

from __future__ import annotations

import math
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


def test_analyze_game_rejects_non_pgn_body():
    """An HTML body must surface as EngineError, never as an IndexError."""
    analyzer = engine.StockfishAnalyzer(
        depth=1, engine_path="definitely-not-a-real-binary"
    )
    html = '<!DOCTYPE html><html lang="en-GB"><body>Not found</body></html>'
    try:
        analyzer.analyze_game(html, player_color="white")
        raise AssertionError("expected EngineError for a non-PGN body")
    except engine.EngineError as exc:
        assert "PGN" in str(exc)


def test_analyze_game_wraps_parser_index_error():
    """python-chess raises IndexError on some HTML bodies; wrap it, never leak."""
    analyzer = engine.StockfishAnalyzer(
        depth=1, engine_path="definitely-not-a-real-binary"
    )

    def broken_read_game(*args, **kwargs):
        raise IndexError("list index out of range")

    original = engine.chess.pgn.read_game
    try:
        engine.chess.pgn.read_game = broken_read_game
        try:
            analyzer.analyze_game("1. e4 e5 *", player_color="white")
            raise AssertionError("expected EngineError for a parser IndexError")
        except engine.EngineError as exc:
            assert str(exc) == "Could not parse the game PGN."
    finally:
        engine.chess.pgn.read_game = original


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


# --- Lichess-aligned move grading and game accuracy -------------------------
#
# Source: lila modules/tree/src/main/Advice.scala (winning-chance judgements,
# mate rules) and modules/analyse/src/main/AccuracyPercent.scala.


def _grade(before_cp: int, after_cp: int, color: str = "white") -> str:
    return engine._quality_for_move(before_cp, after_cp, color)


def test_small_slip_while_winning_is_not_a_blunder():
    # +8 -> +5.5 is a 250cp swing, but the game is still won.
    assert _grade(800, 550) not in (engine.QUALITY_MISTAKE, engine.QUALITY_BLUNDER)


def test_throwing_an_equal_position_is_a_blunder():
    assert _grade(100, -200) == engine.QUALITY_BLUNDER


def test_grading_is_from_the_movers_point_of_view():
    # Black moves from -1 (good for Black) to +2: a blunder for Black.
    assert _grade(-100, 200, "black") == engine.QUALITY_BLUNDER
    # The same numbers for White are an improvement.
    assert _grade(-100, 200, "white") in (engine.QUALITY_BEST, engine.QUALITY_GOOD)


def test_walking_into_a_forced_mate_is_a_blunder():
    assert _grade(50, -engine.MATE_SCORE + 3) == engine.QUALITY_BLUNDER


def test_walking_into_mate_when_already_lost_is_only_an_inaccuracy():
    assert _grade(-1200, -engine.MATE_SCORE + 3) == engine.QUALITY_INACCURACY


def test_letting_a_forced_mate_slip_while_still_crushing_is_an_inaccuracy():
    assert _grade(engine.MATE_SCORE - 2, 1500) == engine.QUALITY_INACCURACY


def test_letting_a_forced_mate_slip_into_equality_is_a_blunder():
    assert _grade(engine.MATE_SCORE - 2, 0) == engine.QUALITY_BLUNDER


def test_delaying_a_forced_mate_is_not_judged():
    assert _grade(engine.MATE_SCORE - 2, engine.MATE_SCORE - 4) in (
        engine.QUALITY_BEST,
        engine.QUALITY_GOOD,
    )


def _moves_from_curve(curve_cp: list[int]) -> list:
    moves = []
    for index in range(len(curve_cp) - 1):
        color = "white" if index % 2 == 0 else "black"
        moves.append(
            engine.MoveInfo(
                move_number=index // 2 + 1,
                san="x",
                color=color,
                phase=engine.PHASE_MIDDLEGAME,
                fen_before="",
                played_move="",
                best_move=None,
                best_move_san=None,
                pv=[],
                pv_san=[],
                eval_before_cp=curve_cp[index],
                eval_after_cp=curve_cp[index + 1],
                centipawn_loss=0,
                quality=engine.QUALITY_BEST,
            )
        )
    return moves


def test_perfect_game_scores_100():
    moves = _moves_from_curve([20] * 41)
    assert engine.StockfishAnalyzer._compute_overall_accuracy(moves, "white") == 100.0


def test_one_blunder_costs_more_than_an_arithmetic_mean_would():
    # 40 moves at a steady +0.2, then White hangs a piece on move 21.
    curve = [20] * 21 + [-300] * 20
    moves = _moves_from_curve(curve)
    white = [m for m in moves if m.color == "white"]
    arithmetic = sum(engine._move_accuracy(m) for m in white) / len(white)
    accuracy = engine.StockfishAnalyzer._compute_overall_accuracy(moves, "white")
    assert accuracy is not None
    assert accuracy < arithmetic - 5


def test_per_move_accuracy_matches_lichess_formula():
    # 0 -> -300cp for White: win% 50 -> ~25; lila gives raw + 1 bonus.
    move = _moves_from_curve([0, -300])[0]
    win_before = 50.0
    win_after = 50 + 50 * (2 / (1 + math.exp(0.00368208 * 300)) - 1)
    expected = 103.1668100711649 * math.exp(-0.04354415386753951 * (win_before - win_after)) - 3.166924740191411 + 1
    assert abs(engine._move_accuracy(move) - expected) < 1e-6


def test_quality_counts_are_the_players_own_moves():
    # White plays well; Black blunders twice.
    curve = [0, 0, 300, 300, 700, 700]
    moves = _moves_from_curve(curve)
    for move in moves:
        move.quality = engine._quality_for_move(
            move.eval_before_cp, move.eval_after_cp, move.color
        )
    white = engine._quality_counts(moves, "white")
    black = engine._quality_counts(moves, "black")
    assert white[engine.QUALITY_BLUNDER] == 0
    assert black[engine.QUALITY_BLUNDER] == 2
    # Unknown colour: count everything rather than guess.
    assert engine._quality_counts(moves, None)[engine.QUALITY_BLUNDER] == 2
