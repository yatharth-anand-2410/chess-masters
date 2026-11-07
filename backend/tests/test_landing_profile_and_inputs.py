"""Offline unit tests for profile game fetching, linked accounts, and raw PGN/FEN inputs."""

from __future__ import annotations

import sys
import unittest.mock
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main as main_module
from services import db, extractor


SAMPLE_LICHESS_MULTI_PGN = """[Event "Rated Blitz game"]
[Site "https://lichess.org/AbCd1234"]
[Date "2026.10.20"]
[White "MentalCarlsen"]
[Black "OpponentOne"]
[Result "1-0"]
[UTCDate "2026.10.20"]
[UTCTime "14:20:00"]
[WhiteElo "2150"]
[BlackElo "2110"]
[TimeControl "180+2"]
[ECO "B90"]
[Opening "Sicilian Defense: Najdorf Variation"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 1-0

[Event "Rated Rapid game"]
[Site "https://lichess.org/EfGh5678"]
[Date "2026.10.19"]
[White "OpponentTwo"]
[Black "MentalCarlsen"]
[Result "1-0"]
[UTCDate "2026.10.19"]
[UTCTime "11:00:00"]
[WhiteElo "2200"]
[BlackElo "2145"]
[TimeControl "600+0"]
[ECO "C50"]
[Opening "Italian Game"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 1-0
"""


def test_build_game_from_raw_pgn_detects_player_color_by_username() -> None:
    game = extractor.build_game_from_raw_pgn(
        SAMPLE_LICHESS_MULTI_PGN.split("\n\n[Event")[0],
        username="MentalCarlsen",
    )
    assert game.platform == "pgn"
    assert game.player_color == "white"
    assert game.player_name == "MentalCarlsen"
    assert "1. e4 c5" in game.pgn


def test_build_game_from_raw_pgn_rejects_empty() -> None:
    with pytest.raises(extractor.InvalidGameUrlError):
        extractor.build_game_from_raw_pgn("   ")


def test_build_game_from_fen_validates_and_reads_turn() -> None:
    najdorf_fen = "rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6"
    game = extractor.build_game_from_fen(najdorf_fen)
    assert game.platform == "fen"
    assert game.player_color == "white"
    assert game.pgn == najdorf_fen


def test_build_game_from_fen_rejects_invalid_fen() -> None:
    with pytest.raises(extractor.InvalidGameUrlError):
        extractor.build_game_from_fen("not-a-valid-fen-string")


def test_fetch_profile_recent_games_lichess_and_filter(monkeypatch: pytest.MonkeyPatch) -> None:
    resp = unittest.mock.MagicMock()
    resp.status_code = 200
    resp.text = SAMPLE_LICHESS_MULTI_PGN
    monkeypatch.setattr(extractor, "_get", lambda *args, **kwargs: resp)

    all_games = extractor.fetch_profile_recent_games("lichess", "MentalCarlsen", max_games=10, time_control="all")
    assert len(all_games) == 2
    assert all_games[0]["game_id"] == "AbCd1234"
    assert all_games[0]["player_color"] == "white"
    assert all_games[0]["result"] == "win"
    assert all_games[0]["time_class"] == "blitz"
    assert all_games[1]["game_id"] == "EfGh5678"
    assert all_games[1]["player_color"] == "black"
    assert all_games[1]["result"] == "loss"
    assert all_games[1]["time_class"] == "rapid"

    blitz_only = extractor.fetch_profile_recent_games("lichess", "MentalCarlsen", max_games=10, time_control="blitz")
    assert len(blitz_only) == 1
    assert blitz_only[0]["game_id"] == "AbCd1234"


def test_normalize_and_manage_linked_accounts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(db, "configured", lambda: False)
    db._fallback_linked_accounts.clear()

    accounts = db.add_linked_account("user-123", "lichess", "@MentalCarlsen")
    assert len(accounts) == 1
    assert accounts[0]["platform"] == "lichess"
    assert accounts[0]["username"] == "MentalCarlsen"

    # Duplicate case-insensitive add does not duplicate
    accounts = db.add_linked_account("user-123", "lichess", "mentalcarlsen")
    assert len(accounts) == 1

    # Add Chess.com handle
    accounts = db.add_linked_account("user-123", "chess.com", "botevenik")
    assert len(accounts) == 2

    # Remove Lichess handle
    accounts = db.remove_linked_account("user-123", "lichess", "MentalCarlsen")
    assert len(accounts) == 1
    assert accounts[0]["platform"] == "chess.com"
    assert accounts[0]["username"] == "botevenik"


def test_extract_single_game_dispatches_fen_and_pgn() -> None:
    fen_req = main_module.AnalysisRequest(
        platform="fen",
        fen="rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    )
    fen_game = main_module._extract_single_game(fen_req)
    assert fen_game.platform == "fen"
    assert fen_game.player_color == "black"

    pgn_req = main_module.AnalysisRequest(
        platform="pgn",
        pgn="1. e4 e5 2. Nf3 Nc6 3. Bb5 a6",
        player_color="white",
    )
    pgn_game = main_module._extract_single_game(pgn_req)
    assert pgn_game.platform == "pgn"
    assert pgn_game.player_color == "white"


def test_paid_batch_limit_is_twenty() -> None:
    assert main_module.MAX_BATCH_GAMES == 5
    assert main_module.MAX_PAID_BATCH_GAMES == 20
