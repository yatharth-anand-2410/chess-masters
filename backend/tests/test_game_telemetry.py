"""Unit tests for the per-game telemetry capture (services.telemetry).

These cover the pure builders only: no Stockfish, no database. FENs, headers,
and evaluations are real values produced by python-chess from a toy game.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import List, Optional

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import chess

from services import engine, telemetry

TOY_PGN = """[Event "Rated blitz game"]
[Site "https://lichess.org/abcd1234"]
[Date "2026.10.15"]
[White "Student"]
[Black "Opponent"]
[WhiteElo "1480"]
[BlackElo "1520"]
[TimeControl "300+3"]
[Result "1-0"]

1. e4 e5 1-0
"""


def _board_after(*sans: str) -> str:
    """FEN of the position after playing ``sans`` from the start position."""
    board = chess.Board()
    for san in sans:
        board.push(board.parse_san(san))
    return board.fen()


def _uci(*sans: str) -> str:
    """UCI form of the last move when ``sans`` are played from the start."""
    board = chess.Board()
    last: Optional[chess.Move] = None
    for san in sans:
        last = board.parse_san(san)
        board.push(last)
    return last.uci() if last is not None else ""


_START_FEN = chess.Board().fen()
_E4_UCI = _uci("e4")
_AFTER_E4 = _board_after("e4")
_E5_UCI = _uci("e4", "e5")
_AFTER_E5 = _board_after("e4", "e5")


def _move(
    move_number: int,
    san: str,
    color: str,
    fen_before: str,
    played_move: str,
    *,
    quality: str = engine.QUALITY_GOOD,
    eval_after_cp: int = 20,
    centipawn_loss: int = 0,
    seconds_spent: Optional[float] = None,
    clock_remaining: Optional[float] = None,
) -> engine.MoveInfo:
    return engine.MoveInfo(
        move_number=move_number,
        san=san,
        color=color,
        phase=engine.PHASE_OPENING,
        fen_before=fen_before,
        played_move=played_move,
        best_move=None,
        best_move_san=None,
        pv=[],
        pv_san=[],
        eval_before_cp=0,
        eval_after_cp=eval_after_cp,
        centipawn_loss=centipawn_loss,
        quality=quality,
        seconds_spent=seconds_spent,
        clock_remaining=clock_remaining,
    )


def _two_move_analysis() -> engine.AnalysisResult:
    moves: List[engine.MoveInfo] = [
        _move(
            1,
            "e4",
            "white",
            _START_FEN,
            _E4_UCI,
            eval_after_cp=30,
            seconds_spent=4.5,
            clock_remaining=295.5,
        ),
        _move(
            1,
            "e5",
            "black",
            _AFTER_E4,
            _E5_UCI,
            quality=engine.QUALITY_INACCURACY,
            eval_after_cp=15,
            centipawn_loss=60,
            seconds_spent=90.0,
            clock_remaining=210.0,
        ),
    ]
    return engine.AnalysisResult(
        player_color="white",
        player_name="Student",
        result="1-0",
        opening_name="King's Pawn Game",
        eco="C20",
        eval_curve_pawns=[0.0, 0.3, 0.15],
        moves=moves,
        statistics={
            engine.QUALITY_BLUNDER: 0,
            engine.QUALITY_MISTAKE: 0,
            engine.QUALITY_INACCURACY: 1,
        },
        phase_accuracies={"opening": 92.5, "middlegame": None, "endgame": None},
        overall_accuracy=91.0,
        time_control="300+3",
    )


@pytest.mark.parametrize(
    ("time_control", "expected"),
    [
        ("300+3", telemetry.SPEED_BLITZ),
        ("600", telemetry.SPEED_RAPID),
        ("1800+0", telemetry.SPEED_CLASSICAL),
        ("60+0", telemetry.SPEED_BULLET),
        ("1/259200", telemetry.SPEED_CORRESPONDENCE),
        (None, telemetry.SPEED_UNKNOWN),
        ("garbage", telemetry.SPEED_UNKNOWN),
        ("180+2", telemetry.SPEED_BLITZ),
        ("900+10", telemetry.SPEED_RAPID),
        ("1/86400", telemetry.SPEED_CORRESPONDENCE),
        ("", telemetry.SPEED_UNKNOWN),
        ("-", telemetry.SPEED_UNKNOWN),
        ("300+abc", telemetry.SPEED_UNKNOWN),
    ],
)
def test_derive_speed(time_control: Optional[str], expected: str) -> None:
    assert telemetry.derive_speed(time_control) == expected


def test_build_replay_uses_the_position_after_each_move() -> None:
    replay = telemetry.build_replay(
        analysis=_two_move_analysis(),
        engine_data={},
        player_color="white",
        pgn=TOY_PGN,
    )

    moves = replay["moves"]
    assert [move["ply"] for move in moves] == [1, 2]
    assert moves[0]["san"] == "e4"
    assert moves[0]["fen"] == _AFTER_E4
    assert moves[1]["fen"] == _AFTER_E5
    assert moves[0]["quality"] == engine.QUALITY_GOOD
    assert moves[1]["quality"] == engine.QUALITY_INACCURACY
    assert moves[1]["eval_after_pawns"] == 0.15
    assert moves[1]["seconds_spent"] == 90.0
    assert moves[1]["clock_remaining"] == 210.0

    assert replay["eval_curve_pawns"] == [0.0, 0.3, 0.15]
    assert replay["players"] == {
        "white": {"name": "Student", "elo": 1480},
        "black": {"name": "Opponent", "elo": 1520},
    }
    assert replay["player_color"] == "white"
    assert replay["time_control"] == "300+3"
    assert replay["speed"] == telemetry.SPEED_BLITZ
    assert replay["result"] == "1-0"
    assert replay["opening_name"] == "King's Pawn Game"


def test_build_replay_falls_back_to_the_next_position() -> None:
    analysis = _two_move_analysis()
    analysis.moves[0].played_move = "not-a-move"

    replay = telemetry.build_replay(
        analysis=analysis,
        engine_data={},
        player_color="white",
        pgn=TOY_PGN,
    )

    assert replay["moves"][0]["fen"] == _AFTER_E4


def test_build_replay_never_fabricates_a_position() -> None:
    analysis = _two_move_analysis()
    analysis.moves[1].played_move = "not-a-move"

    replay = telemetry.build_replay(
        analysis=analysis,
        engine_data={},
        player_color="white",
        pgn=TOY_PGN,
    )

    # The final move has no next position to borrow and cannot be pushed.
    assert replay["moves"][1]["fen"] is None


def test_build_game_summary_reads_headers_and_engine_evidence() -> None:
    summary = telemetry.build_game_summary(
        analysis=_two_move_analysis(),
        engine_data={"psychology": {"blunder": 0, "min_clock_seconds": 210.0}},
        player_color="white",
        username="student-lichess",
        platform="lichess",
        pgn=TOY_PGN,
    )

    assert summary["speed"] == telemetry.SPEED_BLITZ
    assert summary["time_control"] == "300+3"
    assert summary["username"] == "student-lichess"
    assert summary["platform"] == "lichess"
    assert summary["player_elo"] == 1480
    assert summary["opponent_name"] == "Opponent"
    assert summary["opponent_elo"] == 1520
    assert summary["accuracy"] == 91.0
    assert summary["phase_accuracies"] == {
        "opening": 92.5,
        "middlegame": None,
        "endgame": None,
    }
    assert summary["quality"] == {"blunder": 0, "mistake": 0, "inaccuracy": 1}
    assert summary["psychology"] == {"blunder": 0, "min_clock_seconds": 210.0}


def test_build_game_summary_never_invents_missing_values() -> None:
    analysis = _two_move_analysis()
    analysis.time_control = None
    analysis.player_name = None

    summary = telemetry.build_game_summary(
        analysis=analysis,
        engine_data={},
        player_color="black",
        username=None,
        platform="chess.com",
        pgn=None,
    )

    assert summary["speed"] == telemetry.SPEED_UNKNOWN
    assert summary["time_control"] is None
    assert summary["username"] is None
    assert summary["player_elo"] is None
    assert summary["opponent_name"] is None
    assert summary["opponent_elo"] is None
    assert isinstance(summary["psychology"], dict)


def test_extract_verdict_reads_the_first_sentence() -> None:
    report = (
        "## Strength\n"
        "- You found the knight fork.\n\n"
        "## Verdict\n"
        "**You were winning until move 28** — clock panic threw the game away. "
        "The rook lift on move 20 was the last clean chance.\n\n"
        "## Game Overview\n"
        "- An even game until the endgame.\n"
    )

    verdict = telemetry.extract_verdict(report)

    assert verdict == {
        "line": (
            "You were winning until move 28 — clock panic threw the game away."
        ),
        "detail": "The rook lift on move 20 was the last clean chance.",
        "source": "report",
    }


def test_extract_verdict_strips_bullet_and_emphasis() -> None:
    report = (
        "## Verdict\n"
        "- *The clock beat you in a drawn position.*\n"
        "## Focus Areas\n"
        "- Don't: rush. Do: breathe.\n"
    )

    verdict = telemetry.extract_verdict(report)

    assert verdict is not None
    assert verdict["line"] == "The clock beat you in a drawn position."
    assert verdict["detail"] is None


def test_extract_verdict_ignores_reports_without_the_section() -> None:
    assert telemetry.extract_verdict("## Strength\n- Fine game.\n") is None
    assert telemetry.extract_verdict("") is None


def test_extract_verdict_rejects_an_empty_or_fragmentary_section() -> None:
    assert telemetry.extract_verdict("## Verdict\n\n## Strength\n- Fine.\n") is None
    assert telemetry.extract_verdict("## Verdict\nToo short.\n") is None
