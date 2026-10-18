"""Regression tests for the player-color resolution logic.

Run from the backend directory:
    ../.venv/bin/python -m pytest tests/smoke_test.py -q

Most of this file is offline. The three tests whose names end in ``_live`` make
real requests to lichess.org, so they are opt-in: the rest of the suite refuses
outbound HTTP (see conftest.py), and these skip unless ``LIVE_TESTS=1`` is set::

    LIVE_TESTS=1 python -m pytest tests/smoke_test.py -q
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import extractor

LIVE_TESTS = os.environ.get("LIVE_TESTS", "").strip() not in {"", "0", "false"}


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


def test_lichess_share_url_truncates_to_first_eight():
    """Lichess itself parses the first eight characters, so URLs like the
    user's https://lichess.org/dVix3Oe8o7Oo must resolve to game dVix3Oe8."""
    game_id, color, needs_resolve = extractor.extract_lichess_game_meta(
        "https://lichess.org/dVix3Oe8o7Oo"
    )
    assert game_id == "dVix3Oe8"
    assert color is None
    # The trailing characters mean the colour must be looked up by redirect.
    assert needs_resolve is True


def test_lichess_twelve_char_id_resolves_to_prefix():
    game_id, color, needs_resolve = extractor.extract_lichess_game_meta(
        "https://lichess.org/BqiwV3t9TXqV"
    )
    assert game_id == "BqiwV3t9"
    assert color is None
    assert needs_resolve is True


def test_lichess_eight_char_id_still_works():
    game_id, color, needs_resolve = extractor.extract_lichess_game_meta(
        "https://lichess.org/zR8HRccT"
    )
    assert game_id == "zR8HRccT"
    assert len(game_id) == 8
    assert color is None
    assert needs_resolve is False


def test_lichess_invalid_url():
    try:
        extractor.extract_lichess_game_meta("https://example.com/nope")
        raise AssertionError("expected InvalidGameUrlError")
    except extractor.InvalidGameUrlError:
        pass


def test_lichess_malformed_id_rejected():
    """A path with no eight-character run is still rejected."""
    try:
        extractor.extract_lichess_game_meta("https://lichess.org/abc12")
        raise AssertionError("expected InvalidGameUrlError")
    except extractor.InvalidGameUrlError as exc:
        assert "8-character" in str(exc)


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


class _FakeResponse:
    def __init__(self, status_code, text="", headers=None, payload=None):
        self.status_code = status_code
        self.text = text
        self.headers = headers or {}
        self._payload = payload

    def json(self):
        if self._payload is None:
            raise ValueError("this fake response carries no JSON payload")
        return self._payload


def test_lichess_html_response_is_not_a_pgn():
    """Lichess serves its HTML error page with a 200, so status is not enough."""
    original_get = extractor._get

    try:
        extractor._get = lambda url, params=None, allow_redirects=True: _FakeResponse(
            200, '<!DOCTYPE html><html lang="en-GB"><body>Not found</body></html>'
        )
        try:
            extractor.fetch_lichess_pgn("dVix3Oe8")
            raise AssertionError("expected ExtractionError for an HTML body")
        except extractor.ExtractionError as exc:
            assert "could not be found on Lichess" in str(exc)
    finally:
        extractor._get = original_get


def test_lichess_signup_redirect_names_the_real_cause():
    """A 303 to /signup is Lichess refusing an unrated/anonymous game, not a
    missing game; the message must say so."""
    original_get = extractor._get

    try:
        extractor._get = lambda url, params=None, allow_redirects=True: _FakeResponse(
            303, headers={"Location": "/signup"}
        )
        try:
            extractor.fetch_lichess_pgn("dVix3Oe8")
            raise AssertionError("expected GameNotSharedError for a /signup redirect")
        except extractor.GameNotSharedError as exc:
            assert "would not share that game" in str(exc)
            assert "Casual and unrated" in str(exc)
    finally:
        extractor._get = original_get


def test_lichess_casual_recovery_uses_player_game_list():
    """A refused casual game is recovered from a player's public game list.

    Step 1 (``/api/game/{id}``) names the non-anonymous player; step 2
    (``/api/games/user/{name}``) returns their games, and the matching
    ``[Site ...]`` block is returned with its ``%clk`` comments intact.
    """
    original_get = extractor._get
    original_cache = extractor._USER_GAMES_CACHE
    try:
        extractor._USER_GAMES_CACHE = {}
        user_pgn = (
            '[Event "Rated blitz game"]\n[Site "https://lichess.org/OTHERGAM"]\n'
            '[White "someone"]\n[Black "mentalcarlsen"]\n\n1. e4 e5 *\n\n'
            '[Event "Casual blitz game"]\n[Site "https://lichess.org/dVix3Oe8"]\n'
            '[White "Anonymous"]\n[Black "mentalcarlsen"]\n[TimeControl "180+0"]\n\n'
            '1. e4 { [%clk 0:03:00] } e5 { [%clk 0:02:58] } *'
        )

        def fake_get(url, params=None, allow_redirects=True):
            if "/api/game/" in url:
                return _FakeResponse(
                    200,
                    payload={
                        "players": {
                            "white": {"userId": None},
                            "black": {"userId": "mentalcarlsen"},
                        }
                    },
                )
            if "/api/games/user/" in url:
                assert params["clocks"] == "true"
                assert params["evals"] == "true"
                return _FakeResponse(200, text=user_pgn)
            return _FakeResponse(303, headers={"Location": "/signup"})

        extractor._get = fake_get
        pgn = extractor.fetch_lichess_pgn("dVix3Oe8")
        assert '[Site "https://lichess.org/dVix3Oe8"]' in pgn
        assert "OTHERGAM" not in pgn
        assert "%clk" in pgn
        times = extractor.parse_player_move_times(pgn, "black")
        assert times, "recovered PGN has no clock-bearing player moves"
    finally:
        extractor._get = original_get
        extractor._USER_GAMES_CACHE = original_cache


def test_lichess_casual_recovery_memoizes_user_game_list():
    """The large per-user game list is fetched once per process, not per game."""
    original_get = extractor._get
    original_cache = extractor._USER_GAMES_CACHE
    user_fetches = []
    try:
        extractor._USER_GAMES_CACHE = {}
        user_pgn = (
            '[Event "Casual game"]\n[Site "https://lichess.org/dVix3Oe8"]\n'
            '[White "Anonymous"]\n[Black "mentalcarlsen"]\n\n'
            '1. e4 { [%clk 0:03:00] } *'
        )

        def fake_get(url, params=None, allow_redirects=True):
            if "/api/game/" in url:
                return _FakeResponse(
                    200,
                    payload={
                        "players": {
                            "white": {"userId": None},
                            "black": {"userId": "mentalcarlsen"},
                        }
                    },
                )
            if "/api/games/user/" in url:
                user_fetches.append(url)
                return _FakeResponse(200, text=user_pgn)
            return _FakeResponse(303, headers={"Location": "/signup"})

        extractor._get = fake_get
        extractor.fetch_lichess_pgn("dVix3Oe8")
        extractor.fetch_lichess_pgn("dVix3Oe8")
        assert len(user_fetches) == 1
    finally:
        extractor._get = original_get
        extractor._USER_GAMES_CACHE = original_cache


def test_lichess_both_players_anonymous_raises_game_not_shared():
    """No fallback is possible when neither player has an account, so the
    honest 'would not share that game' message must still be raised."""
    original_get = extractor._get
    try:

        def fake_get(url, params=None, allow_redirects=True):
            if "/api/game/" in url:
                return _FakeResponse(
                    200,
                    payload={
                        "players": {
                            "white": {"userId": None},
                            "black": {"userId": None},
                        }
                    },
                )
            return _FakeResponse(303, headers={"Location": "/signup"})

        extractor._get = fake_get
        try:
            extractor.fetch_lichess_pgn("dVix3Oe8")
            raise AssertionError("expected GameNotSharedError when no player is named")
        except extractor.GameNotSharedError as exc:
            assert "would not share that game" in str(exc)
            assert "Casual and unrated" in str(exc)
    finally:
        extractor._get = original_get


LIVE_CASUAL_GAME_ID = "dVix3Oe8"
LIVE_RATED_GAME_ID = "zR8HRccT"


def _lichess_reachable() -> bool:
    """True when the live Lichess API answers; network tests skip otherwise."""
    try:
        extractor._get(f"https://lichess.org/api/game/{LIVE_RATED_GAME_ID}")
        return True
    except extractor.ExtractionError:
        return False


@pytest.mark.skipif(
    not LIVE_TESTS, reason="live lichess.org call; set LIVE_TESTS=1"
)
def test_lichess_casual_game_recovered_live():
    """Live: a real casual game refused by the export endpoint is recovered."""
    if not _lichess_reachable():
        print("SKIP (Lichess unreachable)")
        return
    pgn = extractor.fetch_lichess_pgn(LIVE_CASUAL_GAME_ID)
    assert pgn.startswith("[Event")
    assert f'[Site "https://lichess.org/{LIVE_CASUAL_GAME_ID}"' in pgn
    assert "%clk" in pgn
    times = extractor.parse_player_move_times(pgn, "black")
    assert times, "recovered live PGN has no clock-bearing player moves"


@pytest.mark.skipif(
    not LIVE_TESTS, reason="live lichess.org call; set LIVE_TESTS=1"
)
def test_lichess_rated_game_still_uses_export_live():
    """Live: a rated game still takes the fast export path unchanged."""
    if not _lichess_reachable():
        print("SKIP (Lichess unreachable)")
        return
    pgn = extractor.fetch_lichess_pgn(LIVE_RATED_GAME_ID)
    assert pgn.startswith("[Event")
    assert "%clk" in pgn


def test_lichess_other_redirect_raises_cleanly():
    original_get = extractor._get

    try:
        extractor._get = lambda url, params=None, allow_redirects=True: _FakeResponse(
            302, headers={"Location": "/somewhere-else"}
        )
        try:
            extractor.fetch_lichess_pgn("dVix3Oe8")
            raise AssertionError("expected GameNotFoundError for a stray redirect")
        except extractor.ExtractionError:
            pass
    finally:
        extractor._get = original_get


def test_lichess_valid_pgn_response_accepted():
    original_get = extractor._get

    try:
        extractor._get = lambda url, params=None, allow_redirects=True: _FakeResponse(
            200, '[Event "Test"]\n[White "A"]\n[Black "B"]\n\n1. e4 e5 *'
        )
        pgn = extractor.fetch_lichess_pgn("zR8HRccT")
        assert pgn.startswith("[Event")
    finally:
        extractor._get = original_get


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


def test_chesscom_game_url_matches_exact_segment():
    stored = "https://www.chess.com/game/live/172596743794"
    assert extractor._chesscom_game_url_matches(stored, "172596743794") is True
    assert extractor._chesscom_game_url_matches(stored + "/", "172596743794") is True
    # A shorter id that merely suffixes the real one must not match a game.
    assert extractor._chesscom_game_url_matches(stored, "596743794") is False


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


@pytest.mark.skipif(
    not LIVE_TESTS, reason="live lichess.org call; set LIVE_TESTS=1"
)
def test_fetch_game_explicit_color_wins():
    try:
        extractor.fetch_game(
            "lichess", "https://lichess.org/abc12345", player_color="white"
        )
    except extractor.GameNotFoundError:
        pass


def test_chesscom_immutable_month_cache():
    original_fetch = extractor._fetch_chesscom_month
    original_cache = extractor._MONTH_CACHE
    calls = []
    try:
        extractor._MONTH_CACHE = {}

        def fake_fetch(month_url):
            calls.append(month_url)
            return ([{"url": f"{month_url}/game/1"}], None)

        extractor._fetch_chesscom_month = fake_fetch
        url = "https://api.chess.com/pub/player/x/games/2026/09"
        first, first_error = extractor._get_chesscom_month(url, immutable=True)
        second, second_error = extractor._get_chesscom_month(url, immutable=True)
        assert first == second and first_error is None and second_error is None
        assert len(calls) == 1

        current = "https://api.chess.com/pub/player/x/games/2026/10"
        extractor._get_chesscom_month(current, immutable=False)
        extractor._get_chesscom_month(current, immutable=False)
        assert len(calls) == 3
    finally:
        extractor._fetch_chesscom_month = original_fetch
        extractor._MONTH_CACHE = original_cache


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