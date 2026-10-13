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
    QUALITY_MISTAKE,
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


def test_post_error_rush_flags_fast_reply():
    moves = [
        _move(1, "white", QUALITY_BEST, seconds=10, clock=590),
        _move(1, "black", QUALITY_BEST),
        _move(2, "white", QUALITY_BLUNDER, seconds=2, clock=580),
        _move(2, "black", QUALITY_GOOD),
        _move(3, "white", QUALITY_GOOD, seconds=1, clock=579),
    ]
    signals = psychology.post_error_rush_signals(_analysis(moves, color="white"))
    signal = signals[("white", 2)]
    assert signal["post_error_rush"] is True
    assert signal["next_move_san"] == "M3"
    assert signal["next_move_seconds_spent"] == 1


def test_post_error_rush_ignores_calm_reply():
    moves = [
        _move(1, "white", QUALITY_BLUNDER, seconds=2, clock=580),
        _move(1, "black", QUALITY_GOOD),
        _move(2, "white", QUALITY_GOOD, seconds=12, clock=568),
    ]
    signals = psychology.post_error_rush_signals(_analysis(moves, color="white"))
    assert signals[("white", 1)]["post_error_rush"] is False


def test_post_error_rush_flags_threshold_boundary():
    moves = [
        _move(1, "white", QUALITY_MISTAKE, seconds=4, clock=580),
        _move(1, "black", QUALITY_GOOD),
        _move(2, "white", QUALITY_GOOD, seconds=psychology.RUSHED_MOVE_SECONDS, clock=575),
    ]
    signals = psychology.post_error_rush_signals(_analysis(moves, color="white"))
    assert signals[("white", 1)]["post_error_rush"] is True


def test_post_error_rush_without_clock_is_silent():
    moves = [
        _move(1, "white", QUALITY_BLUNDER),
        _move(1, "black", QUALITY_GOOD),
        _move(2, "white", QUALITY_GOOD),
    ]
    signals = psychology.post_error_rush_signals(
        _analysis(moves, color="white", time_control=None)
    )
    assert signals == {}


def test_post_error_rush_skips_unanswered_error():
    moves = [
        _move(1, "white", QUALITY_GOOD, seconds=8, clock=590),
        _move(1, "black", QUALITY_GOOD),
        _move(2, "white", QUALITY_BLUNDER, seconds=2, clock=580),
    ]
    signals = psychology.post_error_rush_signals(_analysis(moves, color="white"))
    assert signals == {}


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
    assert "patterns" not in payload
    assert "dimensions" in payload
    assert "leaks" in payload
    for dimension in payload["dimensions"].values():
        assert "evidence" in dimension
        assert "key" not in dimension


def test_patterns_conversion_counts_and_context():
    profile = psychology.build_batch_profile(_three_games())
    assert profile is not None
    patterns = {pattern["key"]: pattern for pattern in profile["patterns"]}
    conversion = patterns["winning_position_conversion"]
    assert conversion["label"] == "Converting winning positions"
    assert conversion["opportunities"] == 3
    assert conversion["occurrences"] == 1
    assert conversion["occurrences_kind"] == "converted"
    assert conversion["games"] == 3
    assert conversion["contributing_games"] == 3
    assert conversion["rate"] == round(1 / 3, 2)
    assert "winning position" in conversion["evidence"].lower()


def test_patterns_games_is_sample_context():
    games = [
        _game("Game 1", _primitives(80.0, 1.0)),
        _game("Game 2", _primitives(70.0, 0.0)),
        _game("Game 3", _primitives(75.0, 1.0)),
        _game("Game 4", _primitives(72.0, 0.5)),
        _game("Game 5", _primitives(68.0, 1.0)),
    ]
    for game in games[3:]:
        game["psychology"]["reached_winning_position"] = False
        game["psychology"]["converted_winning_position"] = False
    profile = psychology.build_batch_profile(games)
    patterns = {pattern["key"]: pattern for pattern in profile["patterns"]}
    conversion = patterns["winning_position_conversion"]
    assert conversion["opportunities"] == 3
    assert conversion["games"] == 5
    assert conversion["contributing_games"] == 3


def test_patterns_conversion_omitted_when_never_winning():
    games = _three_games(
        reached_winning_position=False,
        converted_winning_position=False,
    )
    profile = psychology.build_batch_profile(games)
    assert profile is not None
    keys = [pattern["key"] for pattern in profile["patterns"]]
    assert "winning_position_conversion" not in keys
    assert all(pattern["opportunities"] > 0 for pattern in profile["patterns"])
    assert all(pattern["rate"] is not None for pattern in profile["patterns"])


def test_patterns_omitted_below_min_opportunities():
    games = [
        _game("Game 1", _primitives(80.0, 1.0)),
        _game("Game 2", _primitives(70.0, 0.0)),
        _game("Game 3", _primitives(75.0, 1.0)),
    ]
    for game in games[1:]:
        game["psychology"]["reached_winning_position"] = False
        game["psychology"]["converted_winning_position"] = False
    assert psychology.MIN_PATTERN_OPPORTUNITIES == 2
    profile = psychology.build_batch_profile(games)
    assert profile is not None
    keys = [pattern["key"] for pattern in profile["patterns"]]
    assert "winning_position_conversion" not in keys


def test_patterns_require_three_games():
    two = [
        _game("Game 1", _primitives(80.0, 1.0)),
        _game("Game 2", _primitives(70.0, 0.0)),
    ]
    assert psychology.build_batch_profile(two) is None


def test_patterns_survive_missing_clock_data():
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
    keys = [pattern["key"] for pattern in profile["patterns"]]
    assert "winning_position_conversion" in keys
    assert "time_trouble_frequency" not in keys
    assert not any(key.startswith("blunders_") for key in keys)


def test_patterns_salvage_and_clock_buckets():
    games = [
        _game("Game 1", _primitives(70.0, 0.5, was_losing=True, comeback=True)),
        _game("Game 2", _primitives(65.0, 0.0, was_losing=True, comeback=False)),
        _game("Game 3", _primitives(75.0, 1.0, was_losing=True, comeback=True)),
    ]
    profile = psychology.build_batch_profile(games)
    patterns = {pattern["key"]: pattern for pattern in profile["patterns"]}
    salvage = patterns["losing_position_salvage"]
    assert salvage["opportunities"] == 3
    assert salvage["occurrences"] == 2
    assert salvage["occurrences_kind"] == "rescued"
    assert salvage["rate"] == round(2 / 3, 2)
    bucket = patterns["blunders_2_to_5_minutes"]
    assert bucket["opportunities"] == 18
    assert bucket["occurrences"] == 3
    assert bucket["games"] == 3
    assert bucket["contributing_games"] == 3
    assert bucket["rate"] == round(3 / 18, 2)


def test_patterns_omit_thin_clock_bucket():
    games = _three_games(
        clock_pressure={"2-5m": {"moves": 2, "blunders": 1}},
    )
    profile = psychology.build_batch_profile(games)
    assert psychology.MIN_CLOCK_BUCKET_MOVES == 10
    keys = [pattern["key"] for pattern in profile["patterns"]]
    assert "blunders_2_to_5_minutes" not in keys


def test_patterns_post_blunder_drop_detected():
    games = [
        _game("Game 1", _primitives(85.0, 1.0)),
        _game("Game 2", _primitives(60.0, 0.0)),
        _game("Game 3", _primitives(78.0, 0.5)),
    ]
    # Each game is compared against its own average: two clear drops, one trivial.
    for game, drop in zip(games, (15.0, 10.0, 4.0)):
        entry = game["psychology"]
        entry["accuracy_after_blunder"] = entry["overall_accuracy"] - drop
    profile = psychology.build_batch_profile(games)
    assert profile is not None
    patterns = {pattern["key"]: pattern for pattern in profile["patterns"]}
    tilt = patterns["post_blunder_accuracy_drop"]
    assert tilt["opportunities"] == 3
    assert tilt["occurrences"] == 2
    assert tilt["occurrences_kind"] == "games with a post-blunder drop"
    assert tilt["games"] == 3
    assert tilt["contributing_games"] == 3
    assert tilt["rate"] == round(2 / 3, 2)
    assert "below that game's average" in tilt["evidence"]
    assert "tilt" not in tilt["evidence"].lower()


def test_patterns_post_blunder_drop_threshold_boundary():
    games = _three_games()
    for game in games:
        entry = game["psychology"]
        entry["accuracy_after_blunder"] = (
            entry["overall_accuracy"] - psychology.TILT_DROP_ACCURACY_POINTS
        )
    profile = psychology.build_batch_profile(games)
    assert psychology.TILT_DROP_ACCURACY_POINTS == 8.0
    patterns = {pattern["key"]: pattern for pattern in profile["patterns"]}
    tilt = patterns["post_blunder_accuracy_drop"]
    assert tilt["opportunities"] == 3
    assert tilt["occurrences"] == 3
    assert tilt["rate"] == 1.0


def test_patterns_post_blunder_drop_omitted_when_trivial():
    # _primitives defaults accuracy_after_blunder to accuracy - 5, under the bar.
    profile = psychology.build_batch_profile(_three_games())
    assert profile is not None
    keys = [pattern["key"] for pattern in profile["patterns"]]
    assert "post_blunder_accuracy_drop" not in keys


def test_patterns_post_blunder_drop_omitted_without_blunders():
    games = _three_games(accuracy_after_blunder=None)
    profile = psychology.build_batch_profile(games)
    assert profile is not None
    keys = [pattern["key"] for pattern in profile["patterns"]]
    assert "post_blunder_accuracy_drop" not in keys
    assert all(pattern["opportunities"] > 0 for pattern in profile["patterns"])


def test_patterns_post_blunder_drop_respects_sample_gates():
    two = [
        _game("Game 1", _primitives(80.0, 1.0)),
        _game("Game 2", _primitives(70.0, 0.0)),
    ]
    for game in two:
        entry = game["psychology"]
        entry["accuracy_after_blunder"] = entry["overall_accuracy"] - 20.0
    assert psychology.build_batch_profile(two) is None

    three = two + [_game("Game 3", _primitives(75.0, 1.0))]
    three[1]["psychology"]["accuracy_after_blunder"] = None
    three[2]["psychology"]["accuracy_after_blunder"] = None
    profile = psychology.build_batch_profile(three)
    assert profile is not None
    # Only one game supplies an opportunity: under MIN_PATTERN_OPPORTUNITIES.
    keys = [pattern["key"] for pattern in profile["patterns"]]
    assert psychology.MIN_PATTERN_OPPORTUNITIES == 2
    assert "post_blunder_accuracy_drop" not in keys


def test_patterns_post_blunder_drop_handles_missing_accuracy():
    games = _three_games(
        accuracy_after_blunder=None,
        avg_move_seconds=None,
        blunders_with_clock=None,
        clock_pressure={},
        time_trouble=None,
    )
    games[0]["psychology"]["accuracy_after_blunder"] = 40.0
    games[0]["psychology"]["overall_accuracy"] = None
    profile = psychology.build_batch_profile(games)
    assert profile is not None
    keys = [pattern["key"] for pattern in profile["patterns"]]
    assert "post_blunder_accuracy_drop" not in keys


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
