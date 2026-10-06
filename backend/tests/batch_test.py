"""Offline unit tests for multi-game batch aggregation and gating helpers.

Run from the backend directory:
    ../.venv/bin/python -m tests.batch_test
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from main import MAX_BATCH_GAMES, _batch_limit_detail
from services import batch_insights


def _moment(move_number: int, cp: int, motif: str | None = None, theme: str | None = None):
    return {
        "move_number": move_number,
        "san": f"M{move_number}",
        "phase": "middlegame",
        "quality": "blunder",
        "centipawn_loss": cp,
        "motif": motif,
        "resource_theme": theme or "blunder",
        "fen_before": "8/8/8/8/8/8/8/8 w - - 0 1",
        "played_move": "e2e4",
        "best_move_san": "e2e3",
        "blindspot": {"explanation": "you missed the recapture"},
    }


def _psychology(accuracy: float, score: float) -> dict:
    return {
        "result": "1-0" if score == 1.0 else "0-1",
        "player_color": "white",
        "player_score": score,
        "overall_accuracy": accuracy,
        "phase_accuracies": {"opening": 85.0, "middlegame": 70.0, "endgame": 65.0},
        "peak_advantage_pawns": 2.0,
        "reached_winning_position": True,
        "converted_winning_position": score == 1.0,
        "blunder": 1,
        "mistake": 1,
        "inaccuracy": 2,
        "accuracy_after_blunder": accuracy - 4,
        "avg_move_seconds": 6.0,
        "fast_move_ratio": 0.3,
        "min_clock_seconds": 150.0,
        "time_trouble": False,
        "rushed_blunders": 0,
        "slow_blunders": 0,
        "blunders_with_clock": 1,
        "started_at": "2026-10-01T18:00:00",
        "time_control": "600+0",
    }


def _engine_data(
    phase_accuracies: dict,
    statistics: dict,
    weakness: list,
    strength: list,
    resources: list,
    psychology: dict | None = None,
):
    data = {
        "opening_name": "Italian Game",
        "eco": "C50",
        "result": "1-0",
        "player_color": "white",
        "phase_accuracies": phase_accuracies,
        "statistics": statistics,
        "weakness_moments": weakness,
        "strength_moments": strength,
        "resources": resources,
    }
    if psychology is not None:
        data["psychology"] = psychology
    return data


def _entry(analysis_id: str, label: str, engine_data: dict) -> dict:
    return {
        "analysis_id": analysis_id,
        "label": label,
        "game_id": f"game-{analysis_id}",
        "game_url": f"https://lichess.org/{analysis_id}",
        "platform": "lichess",
        "engine_data": engine_data,
    }


def _two_games() -> list:
    game_one = _entry(
        "a1",
        "Game 1",
        _engine_data(
            {"opening": 90.0, "middlegame": 70.0, "endgame": None},
            {"blunder": 2, "mistake": 1, "inaccuracy": 3},
            [_moment(12, 300, motif="fork")],
            [],
            [{"title": "Practice Forks", "url": "https://lichess.org/training/fork", "theme": "fork"}],
        ),
    )
    game_two = _entry(
        "b2",
        "Game 2",
        _engine_data(
            {"opening": 80.0, "middlegame": 60.0, "endgame": 75.0},
            {"blunder": 1, "mistake": 4, "inaccuracy": 1},
            [_moment(20, 500, motif="fork"), _moment(30, 120, theme="endgame")],
            [],
            [{"title": "Practice Forks", "url": "https://lichess.org/training/fork", "theme": "fork"}],
        ),
    )
    return [game_one, game_two]


def test_batch_tags_moments_with_game_labels():
    insights = batch_insights.build_batch_insights(_two_games())
    labels = {moment["game_label"] for moment in insights["weakness_moments"]}
    assert labels == {"Game 1", "Game 2"}
    assert all(moment["analysis_id"] for moment in insights["weakness_moments"])


def test_batch_totals_summed():
    insights = batch_insights.build_batch_insights(_two_games())
    assert insights["totals"] == {"blunder": 3, "mistake": 5, "inaccuracy": 4}


def test_batch_phase_averages_ignore_null_phases():
    insights = batch_insights.build_batch_insights(_two_games())
    assert insights["phase_accuracies"]["opening"] == 85.0
    assert insights["phase_accuracies"]["middlegame"] == 65.0
    assert insights["phase_accuracies"]["endgame"] == 75.0


def test_batch_weakness_sorted_and_capped():
    moments = [_moment(number, number * 10) for number in range(1, 9)]
    game = _entry(
        "c3",
        "Game 1",
        _engine_data(
            {"opening": None, "middlegame": 50.0, "endgame": None},
            {"blunder": 8, "mistake": 0, "inaccuracy": 0},
            moments,
            [],
            [],
        ),
    )
    insights = batch_insights.build_batch_insights([game])
    capped = insights["weakness_moments"]
    assert len(capped) == batch_insights.MAX_BATCH_WEAKNESS_MOMENTS
    losses = [moment["centipawn_loss"] for moment in capped]
    assert losses == sorted(losses, reverse=True)


def test_batch_resources_deduped():
    insights = batch_insights.build_batch_insights(_two_games())
    urls = [resource["url"] for resource in insights["resources"]]
    assert urls.count("https://lichess.org/training/fork") == 1
    assert insights["resources"][0]["game_label"] == "Game 1"


def test_batch_recurring_themes_counted():
    insights = batch_insights.build_batch_insights(_two_games())
    themes = {theme["theme"]: theme for theme in insights["recurring_themes"]}
    assert themes["fork"]["count"] == 2
    assert set(themes["fork"]["games"]) == {"Game 1", "Game 2"}


def test_prompt_payload_is_trimmed():
    insights = batch_insights.build_batch_insights(_two_games())
    payload = batch_insights.build_prompt_payload(insights)
    assert payload["game_count"] == 2
    assert payload["average_phase_accuracies"]["opening"] == 85.0
    first_moment = payload["games"][0]["key_moments"][0]
    assert "fen_before" not in first_moment
    assert first_moment["motif"] == "fork"
    assert first_moment["blindspot"] == "you missed the recapture"


def _three_games() -> list:
    games = _two_games()
    for entry, (accuracy, score) in zip(games, [(82.0, 1.0), (74.0, 0.0)]):
        entry["engine_data"]["psychology"] = _psychology(accuracy, score)
    games.append(
        _entry(
            "c3",
            "Game 3",
            _engine_data(
                {"opening": 70.0, "middlegame": 65.0, "endgame": 60.0},
                {"blunder": 2, "mistake": 2, "inaccuracy": 2},
                [_moment(15, 250, motif="pin")],
                [],
                [],
                psychology=_psychology(65.0, 0.0),
            ),
        )
    )
    return games


def test_batch_psychology_absent_without_data():
    insights = batch_insights.build_batch_insights(_two_games())
    assert "psychology" not in insights


def test_batch_psychology_requires_three_games():
    insights = batch_insights.build_batch_insights(_three_games()[:2])
    assert "psychology" not in insights


def test_batch_psychology_profile_in_payload():
    insights = batch_insights.build_batch_insights(_three_games())
    profile = insights["psychology"]
    assert profile["sample_size"] == 3
    assert profile["dimensions"]["consistency"] is not None
    payload = batch_insights.build_prompt_payload(insights)
    assert payload["psychology"]["sample_size"] == 3
    assert "type_scores" not in payload["psychology"]
    assert "dimensions" in payload["psychology"]


def test_batch_limit_detail_free_insufficient():
    detail = _batch_limit_detail(
        {"plan": "free", "remaining": 2, "analyses_used": 3}, 5
    )
    assert detail["code"] == "insufficient_credits"
    assert detail["required"] == 5
    assert detail["remaining"] == 2


def test_batch_limit_detail_free_exhausted():
    detail = _batch_limit_detail({"plan": "free", "remaining": 0}, 5)
    assert detail["code"] == "upgrade_required"


def test_batch_limit_detail_paid_insufficient():
    detail = _batch_limit_detail(
        {"plan": "paid", "remaining": 1, "paid_analysis_limit": 100}, 5
    )
    assert detail["code"] == "insufficient_credits"
    assert detail["remaining"] == 1


def test_batch_limit_detail_paid_exhausted():
    detail = _batch_limit_detail(
        {
            "plan": "paid",
            "remaining": 0,
            "paid_analysis_limit": 100,
            "current_period_end": "2026-10-30T00:00:00+00:00",
        },
        5,
    )
    assert detail["code"] == "limit_reached"


def test_max_batch_games_is_five():
    assert MAX_BATCH_GAMES == 5


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
