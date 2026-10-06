"""Offline unit tests for chess psychology primitives and batch profile.

Run from the backend directory:
    ../.venv/bin/python -m tests.psychology_test
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import psychology
from services.engine import (
    QUALITY_BEST,
    QUALITY_BLUNDER,
    QUALITY_GOOD,
    AnalysisResult,
    MoveInfo,
)


def _move(
    move_number: int,
    color: str,
    quality: str,
    seconds: float | None = None,
    clock: float | None = None,
    eval_before: int = 20,
    eval_after: int = 20,
) -> MoveInfo:
    return MoveInfo(
        move_number=move_number,
        san=f"M{move_number}",
        color=color,
        phase="middlegame",
        fen_before="8/8/8/8/8/8/8/8 w - - 0 1",
        played_move="e2e4",
        best_move=None,
        best_move_san=None,
        pv=[],
        pv_san=[],
        eval_before_cp=eval_before,
        eval_after_cp=eval_after,
        centipawn_loss=max(0, eval_before - eval_after),
        quality=quality,
        seconds_spent=seconds,
        clock_remaining=clock,
    )


def _analysis(
    moves: list,
    result: str = "1-0",
    color: str = "white",
    overall_accuracy: float | None = 80.0,
    eval_curve: list | None = None,
    time_control: str | None = "600+0",
    started_at: str | None = "2026-10-01T18:00:00",
    termination: str | None = None,
) -> AnalysisResult:
    return AnalysisResult(
        player_color=color,
        player_name=None,
        result=result,
        opening_name="Italian Game",
        eco="C50",
        eval_curve_pawns=eval_curve if eval_curve is not None else [0.2, 1.0, 0.5],
        moves=moves,
        statistics={"blunder": 1, "mistake": 0, "inaccuracy": 0},
        phase_accuracies={"opening": 90.0, "middlegame": 75.0, "endgame": None},
        overall_accuracy=overall_accuracy,
        started_at=started_at,
        time_control=time_control,
        termination=termination,
        ended_in_checkmate=False,
    )


def _primitives(
    accuracy: float,
    score: float | None,
    blunder: int = 1,
    started_at: str | None = None,
    was_losing: bool = False,
    comeback: bool | None = None,
    color: str = "white",
    flag_loss: bool | None = False,
) -> dict:
    return {
        "result": None,
        "player_color": color,
        "player_score": score,
        "overall_accuracy": accuracy,
        "phase_accuracies": {"opening": 85.0, "middlegame": 75.0, "endgame": 70.0},
        "peak_advantage_pawns": 2.0,
        "trough_advantage_pawns": -2.0 if was_losing else -0.4,
        "reached_winning_position": True,
        "converted_winning_position": score == 1.0,
        "was_losing": was_losing,
        "comeback": comeback,
        "blunder": blunder,
        "mistake": 1,
        "inaccuracy": 2,
        "accuracy_after_blunder": accuracy - 5,
        "avg_move_seconds": 6.0,
        "fast_move_ratio": 0.4,
        "min_clock_seconds": 120.0,
        "time_trouble": False,
        "flag_loss": flag_loss,
        "rushed_blunders": 0,
        "slow_blunders": 0,
        "blunders_with_clock": blunder,
        "clock_pressure": {"2-5m": {"moves": 6, "blunders": 1}},
        "speed_profile": {"<2s": 1, "2-5s": 2, "5-15s": 3, "15-60s": 1},
        "started_at": started_at,
        "time_control": "600+0",
    }


def _game(
    label: str,
    primitives: dict,
    opening: str = "Italian Game",
    strength_moments: list | None = None,
) -> dict:
    return {
        "label": label,
        "opening_name": opening,
        "psychology": primitives,
        "strength_moments": strength_moments or [],
        "phase_accuracies": {"opening": 85.0, "middlegame": 75.0, "endgame": 70.0},
    }


def _three_games(**overrides) -> list:
    games = [
        _game("Game 1", _primitives(85.0, 1.0)),
        _game("Game 2", _primitives(60.0, 0.0)),
        _game("Game 3", _primitives(78.0, 0.5)),
    ]
    for game in games:
        game["psychology"].update(overrides)
    return games


def test_game_primitives_conversion_and_clocks():
    moves = [
        _move(1, "white", QUALITY_BEST, seconds=10, clock=590),
        _move(2, "black", QUALITY_BEST),
        _move(2, "white", QUALITY_BLUNDER, seconds=2, clock=20, eval_after=-300),
        _move(3, "black", QUALITY_GOOD),
        _move(3, "white", QUALITY_GOOD, seconds=1, clock=18),
        _move(4, "black", QUALITY_GOOD),
        _move(4, "white", QUALITY_GOOD, seconds=1, clock=16),
    ]
    primitives = psychology.build_game_primitives(
        _analysis(moves, eval_curve=[0.2, 2.5, 1.0])
    )
    assert primitives["reached_winning_position"] is True
    assert primitives["converted_winning_position"] is True
    assert primitives["trough_advantage_pawns"] == 0.2
    assert primitives["rushed_blunders"] == 1
    assert primitives["slow_blunders"] == 0
    assert primitives["blunders_with_clock"] == 1
    assert primitives["min_clock_seconds"] == 16
    assert primitives["accuracy_after_blunder"] is not None
    assert primitives["clock_pressure"]["<30s"] == {"moves": 3, "blunders": 1}
    assert sum(primitives["speed_profile"].values()) == 4


def test_game_primitives_no_clock_data_degrades():
    moves = [
        _move(1, "white", QUALITY_BEST),
        _move(2, "white", QUALITY_BLUNDER),
    ]
    primitives = psychology.build_game_primitives(_analysis(moves, time_control=None))
    assert primitives["avg_move_seconds"] is None
    assert primitives["rushed_blunders"] is None
    assert primitives["time_trouble"] is None
    assert primitives["clock_pressure"] == {}
    assert primitives["speed_profile"] == {}


def test_game_primitives_flag_loss_and_comeback():
    moves = [_move(1, "white", QUALITY_GOOD, seconds=5, clock=100)]
    lost = psychology.build_game_primitives(
        _analysis(
            moves,
            result="1-0",
            color="black",
            eval_curve=[0.2, 3.0],
            termination="Time forfeit",
        )
    )
    assert lost["player_score"] == 0.0
    assert lost["was_losing"] is True
    assert lost["comeback"] is False
    assert lost["flag_loss"] is True


def test_profile_requires_three_games():
    two = [
        _game("Game 1", _primitives(80.0, 1.0)),
        _game("Game 2", _primitives(70.0, 0.0)),
    ]
    assert psychology.build_batch_profile(two) is None
    three = two + [_game("Game 3", _primitives(75.0, 1.0))]
    assert psychology.build_batch_profile(three) is not None


def test_profile_dimension_shape_and_tags():
    profile = psychology.build_batch_profile(_three_games())
    assert profile is not None
    consistency = profile["dimensions"]["consistency"]
    assert consistency["key"] == "consistency"
    assert consistency["tag"] in ("strong", "develop", "weak")
    conversion = profile["dimensions"]["conversion"]
    assert conversion["score"] == int(round((1 / 3) * 100))
    assert conversion["tag"] == "weak"
    assert "headline" in profile and profile["headline"]
    assert isinstance(profile["leaks"], list)


def test_leaks_ranked_with_fix_protocols():
    games = _three_games()
    for game in games:
        game["psychology"]["rushed_blunders"] = game["psychology"]["blunder"]
        game["psychology"]["time_trouble"] = True
    profile = psychology.build_batch_profile(games)
    leaks = profile["leaks"]
    assert leaks
    scores = [leak["score"] for leak in leaks]
    assert scores == sorted(scores)
    assert leaks[0]["key"] in psychology.FIX_PROTOCOLS
    for leak in leaks:
        assert leak["fix"]
        assert leak["severity"] in ("high", "medium")
        assert len(leaks) <= psychology.MAX_LEAKS


def test_profile_handles_missing_clocks():
    games = _three_games(
        avg_move_seconds=None,
        blunders_with_clock=None,
        rushed_blunders=None,
        time_trouble=None,
        clock_pressure={},
        speed_profile={},
    )
    profile = psychology.build_batch_profile(games)
    assert profile is not None
    assert profile["dimensions"]["time_management"] is None
    assert profile["time_pressure"] == []
    assert any("Clock data" in caveat for caveat in profile["caveats"])


def test_tilt_evidence_after_losses():
    games = [
        _game("Game 1", _primitives(85.0, 1.0, started_at="2026-10-01T18:00:00")),
        _game("Game 2", _primitives(85.0, 0.0, started_at="2026-10-01T18:30:00")),
        _game("Game 3", _primitives(60.0, 1.0, started_at="2026-10-01T19:00:00")),
        _game("Game 4", _primitives(84.0, 0.0, started_at="2026-10-01T19:30:00")),
    ]
    profile = psychology.build_batch_profile(games)
    assert profile is not None
    assert profile["dimensions"]["tilt"] is not None
    assert "tilt" in profile["dimensions"]["tilt"]["evidence"].lower()
    assert any("tilt" in item.lower() for item in profile["evidence"])


def test_form_marks_games_after_losses():
    games = [
        _game("Game 1", _primitives(85.0, 1.0)),
        _game("Game 2", _primitives(60.0, 0.0)),
        _game("Game 3", _primitives(78.0, 0.5)),
    ]
    profile = psychology.build_batch_profile(games)
    form = profile["form"]
    assert [point["label"] for point in form] == ["Game 1", "Game 2", "Game 3"]
    assert form[0]["after_loss"] is False
    assert form[2]["after_loss"] is True
    assert form[1]["score"] == 0.0


def test_fighting_spirit_and_time_pressure_aggregation():
    games = [
        _game("Game 1", _primitives(70.0, 0.5, was_losing=True, comeback=True)),
        _game("Game 2", _primitives(65.0, 0.0, was_losing=True, comeback=False)),
        _game("Game 3", _primitives(75.0, 1.0, was_losing=False)),
    ]
    profile = psychology.build_batch_profile(games)
    spirit = profile["dimensions"]["fighting_spirit"]
    assert spirit is not None
    assert spirit["score"] == 50
    pressure = profile["time_pressure"]
    assert pressure and pressure[0]["bucket"] == "2-5m"
    assert pressure[0]["blunders"] == 3


def test_capitalization_and_color_evidence():
    moments = [{"capitalizes": True}, {"capitalizes": False}]
    games = [
        _game("Game 1", _primitives(80.0, 1.0, color="white"), strength_moments=moments),
        _game("Game 2", _primitives(70.0, 0.0, color="black")),
        _game("Game 3", _primitives(75.0, 1.0, color="white")),
    ]
    profile = psychology.build_batch_profile(games)
    joined = " ".join(profile["evidence"])
    assert "punished an opponent error" in joined
    assert "better with White" in joined


def test_headline_mentions_type_and_gap():
    games = _three_games()
    for game in games:
        game["psychology"]["rushed_blunders"] = game["psychology"]["blunder"]
        game["psychology"]["time_trouble"] = True
    profile = psychology.build_batch_profile(games)
    headline = profile["headline"]
    assert "time management" in headline.lower()
    assert any(short in headline for short in psychology.PLAYER_TYPE_SHORT.values())


def test_prompt_payload_is_trimmed():
    profile = psychology.build_batch_profile(_three_games())
    payload = psychology.build_prompt_payload(profile)
    assert payload["sample_size"] == 3
    assert payload["headline"]
    assert "type_scores" not in payload
    assert "form" not in payload
    assert "time_pressure" not in payload
    assert "dimensions" in payload
    assert "leaks" in payload
    for dimension in payload["dimensions"].values():
        assert "evidence" in dimension
        assert "key" not in dimension


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
