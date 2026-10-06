"""Offline regression tests for the player-color resolution logic.

Run from the backend directory:
    ../.venv/bin/python -m tests.smoke_test
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import extractor


def test_lichess_url_color():
    game_id, color, needs_resolve = extractor.extract_lichess_game_meta(
        "https://lichess.org/abc12345/black"
    )
    assert game_id == "abc12345"
    assert color == "black"
    assert needs_resolve is False


def test_lichess_plain_url_no_color():
    game_id, color, needs_resolve = extractor.extract_lichess_game_meta(
        "https://lichess.org/abc12345"
    )
    assert game_id == "abc12345"
    assert color is None
    assert needs_resolve is False


def test_lichess_mangled_url():
    game_id, color, needs_resolve = extractor.extract_lichess_game_meta(
        "https://lichess.org/dVix3Oe8o7Oo"
    )
    assert game_id == "dVix3Oe8"
    assert color is None
    assert needs_resolve is True


def test_lichess_invalid_url():
    try:
        extractor.extract_lichess_game_meta("https://example.com/nope")
        raise AssertionError("expected InvalidGameUrlError")
    except extractor.InvalidGameUrlError:
        pass


def test_lichess_url_with_query():
    game_id, color, needs_resolve = extractor.extract_lichess_game_meta(
        "https://lichess.org/abc12345?move=5"
    )
    assert game_id == "abc12345"
    assert color is None
    assert needs_resolve is False


def test_lichess_color_with_fragment():
    game_id, color, needs_resolve = extractor.extract_lichess_game_meta(
        "https://lichess.org/abc12345/white#12"
    )
    assert game_id == "abc12345"
    assert color == "white"
    assert needs_resolve is False


def test_lichess_export_url():
    game_id, color, needs_resolve = extractor.extract_lichess_game_meta(
        "https://lichess.org/game/export/abc12345?evals=true&clocks=false"
    )
    assert game_id == "abc12345"
    assert color is None
    assert needs_resolve is False


def test_lichess_reserved_path():
    try:
        extractor.extract_lichess_game_meta("https://lichess.org/analysis/standard")
        raise AssertionError("expected InvalidGameUrlError")
    except extractor.InvalidGameUrlError:
        pass


def test_chesscom_id_extraction():
    game_id = extractor.extract_chesscom_game_id(
        "https://www.chess.com/game/live/123456789"
    )
    assert game_id == "123456789"


def test_chesscom_id_with_query_params():
    game_id = extractor.extract_chesscom_game_id(
        "https://www.chess.com/game/live/172596743794?username=botevenik&move=1"
    )
    assert game_id == "172596743794"


def test_chesscom_daily_url():
    game_id = extractor.extract_chesscom_game_id(
        "https://www.chess.com/game/daily/123456789?move=10"
    )
    assert game_id == "123456789"


def test_chesscom_analysis_url():
    game_id = extractor.extract_chesscom_game_id(
        "https://www.chess.com/analysis/game/live/123456789?tab=analysis"
    )
    assert game_id == "123456789"


def test_player_color_for_game():
    game = {
        "white": {"username": "Fabicrazy"},
        "black": {"username": "AmosMalusi"},
    }
    assert extractor._player_color_for_game(game, "fabicrazy") == "white"
    assert extractor._player_color_for_game(game, "AMOSMALUSI") == "black"
    assert extractor._player_color_for_game(game, "other") == "unknown"


def test_fetch_game_requires_lichess_color():
    try:
        extractor.fetch_game("lichess", "https://lichess.org/abc12345")
        raise AssertionError("expected InvalidGameUrlError for missing color")
    except extractor.InvalidGameUrlError:
        pass


def test_fetch_game_explicit_color_wins():
    try:
        extractor.fetch_game(
            "lichess", "https://lichess.org/abc12345", player_color="white"
        )
    except extractor.GameNotFoundError:
        pass


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
        except Exception as exc:  # network failures during live tests
            failures += 1
            print(f"FAIL {name}: {type(exc).__name__}: {exc}")
    if failures:
        print(f"\n{failures}/{len(tests)} tests failed")
        sys.exit(1)
    print(f"\nAll {len(tests)} tests passed")


if __name__ == "__main__":
    main()