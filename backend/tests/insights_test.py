"""Offline unit tests for per-position moment descriptions.

Run from the backend directory:
    ../.venv/bin/python -m tests.insights_test
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import analyzer, batch_insights, recommendations


def _strength_moment() -> dict:
    return {
        "move_number": 25,
        "san": "Kd1",
        "color": "white",
        "phase": "middlegame",
        "quality": "strong",
        "fen_before": "8/8/8/8/8/8/8/8 w - - 0 1",
        "pv_san": ["Kd1", "Rxd1+", "Kxd1"],
        "eval_before_pawns": -3.0,
        "eval_after_pawns": -3.1,
    }


def _weakness_moment() -> dict:
    return {
        "move_number": 6,
        "san": "Ne4",
        "color": "white",
        "phase": "opening",
        "quality": "blunder",
        "fen_before": "8/8/8/8/8/8/8/8 w - - 0 1",
        "best_move_san": "Bg5",
        "pv_san": ["Bg5", "Be7", "Bh4"],
        "eval_before_pawns": 0.2,
        "eval_after_pawns": -1.5,
        "motif": None,
        "motif_details": None,
        "blindspot": None,
        "opening": {
            "name": "Italian Game",
            "top_moves": [{"san": "Bg5", "games": 120}],
        },
        "tablebase": None,
    }


def _engine_data() -> dict:
    return {
        "player_color": "white",
        "strength_moments": [_strength_moment()],
        "weakness_moments": [_weakness_moment()],
    }


class _FakeResponse:
    text = '{"moments": [{"id": "strength-0", "description": "Good king move."}]}'


class _FakeModels:
    async def generate_content(self, **kwargs):
        assert kwargs["config"].response_mime_type == "application/json"
        assert kwargs["config"].response_schema is not None
        return _FakeResponse()


class _FakeAio:
    models = _FakeModels()


class _FakeClient:
    aio = _FakeAio()


def test_payload_ids_and_kinds():
    payload = analyzer._build_moment_payload(_engine_data())
    ids = [moment["id"] for moment in payload["moments"]]
    assert ids == ["strength-0", "weakness-0"]
    assert payload["moments"][0]["kind"] == "strength"
    assert payload["moments"][1]["kind"] == "weakness"


def test_payload_includes_evidence():
    payload = analyzer._build_moment_payload(_engine_data())
    weakness = payload["moments"][1]
    assert weakness["move"] == "6. Ne4"
    assert weakness["stronger_move_san"] == "Bg5"
    assert weakness["continuation_san"] == ["Bg5", "Be7", "Bh4"]
    assert weakness["opening"] == "Italian Game"
    assert weakness["master_move_san"] == "Bg5"


def test_describe_moments_parses_response():
    descriptions = asyncio.run(
        analyzer.describe_moments(_FakeClient(), _engine_data())
    )
    assert descriptions["strength-0"]["description"] == "Good king move."
    assert descriptions["strength-0"]["better_idea"] == ""


def test_describe_moments_without_moments_skips_call():
    descriptions = asyncio.run(
        analyzer.describe_moments(_FakeClient(), {"strength_moments": []})
    )
    assert descriptions == {}


def test_merge_sets_note_and_better_idea():
    engine_data = _engine_data()
    analyzer.merge_moment_descriptions(
        engine_data,
        {
            "strength-0": {
                "description": "Your king walks out of the pin.",
                "better_idea": "",
            },
            "weakness-0": {
                "description": "Ne4 lets Black trade your active knight.",
                "better_idea": "Bg5 pins the knight and keeps the initiative.",
            },
        },
    )
    assert engine_data["strength_moments"][0]["note"] == (
        "Your king walks out of the pin."
    )
    assert engine_data["weakness_moments"][0]["note"] == (
        "Ne4 lets Black trade your active knight."
    )
    assert engine_data["weakness_moments"][0]["better_move_idea"] == (
        "Bg5 pins the knight and keeps the initiative."
    )
    assert "better_move_idea" not in engine_data["strength_moments"][0]


def test_merge_ignores_unknown_and_empty():
    engine_data = _engine_data()
    engine_data["weakness_moments"][0]["note"] = "keep me"
    analyzer.merge_moment_descriptions(engine_data, {"weakness-9": {"description": "x"}})
    assert engine_data["weakness_moments"][0]["note"] == "keep me"
    analyzer.merge_moment_descriptions(engine_data, {})
    assert engine_data["strength_moments"][0].get("note") is None


def test_weakness_fallback_idea_prefers_motif():
    moment = {"motif_details": "The knight on e4 attacks two pieces."}
    assert recommendations._weakness_fallback_idea(moment) == (
        "The knight on e4 attacks two pieces."
    )


def test_weakness_fallback_idea_tablebase():
    moment = {"tablebase": {"outcome_changed": {"from": "draw", "to": "loss"}}}
    idea = recommendations._weakness_fallback_idea(moment)
    assert "draw" in idea and "loss" in idea


def test_weakness_fallback_idea_masters():
    moment = {"opening": {"top_moves": [{"san": "Bg5"}]}}
    assert recommendations._weakness_fallback_idea(moment) == (
        "Masters usually continue with Bg5 in this position."
    )


def test_weakness_fallback_idea_none():
    assert recommendations._weakness_fallback_idea({}) is None


def test_trim_moment_keeps_better_idea():
    trimmed = batch_insights._trim_moment(
        {
            "move_number": 6,
            "san": "Ne4",
            "phase": "opening",
            "quality": "blunder",
            "centipawn_loss": 250,
            "note": "You gave up the bishop pair.",
            "better_move_idea": "Bg5 keeps the tension.",
        }
    )
    assert trimmed["note"] == "You gave up the bishop pair."
    assert trimmed["better_move_idea"] == "Bg5 keeps the tension."


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
