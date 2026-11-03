"""Regression tests for the multi-game request contract.

A Chess.com batch needs the player's handle at the **top level** of the
payload. When a client nests ``username`` inside each game object, Pydantic
drops it and every game fails during extraction with the misleading "None of
the games could be analyzed" summary. These tests pin the contract so that
mistake is rejected before any credit is spent.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main

SIGNED_IN_USER = {"id": "u-test", "email": "tester@example.com", "user_metadata": {}}


async def _signed_in_user() -> dict:
    return SIGNED_IN_USER


@pytest.fixture(autouse=True)
def _override_auth():
    main.app.dependency_overrides[main.get_current_user] = _signed_in_user
    yield
    main.app.dependency_overrides.clear()


def _chesscom_games() -> list[dict]:
    return [
        {"game_url": "https://www.chess.com/game/live/111111111"},
        {"game_url": "https://www.chess.com/game/live/222222222"},
    ]


def _post(payload: dict):
    client = TestClient(main.app, raise_server_exceptions=False)
    return client.post("/api/stream-batch-analysis", json=payload)


def test_chesscom_batch_without_username_is_rejected_before_charging():
    with (
        patch("main.db.consume_analysis_credits") as consume,
        patch("main.db.create_batch") as create_batch,
    ):
        response = _post({"platform": "chess.com", "games": _chesscom_games()})

    assert response.status_code == 400
    assert "Chess.com username is required" in response.json()["detail"]
    consume.assert_not_called()
    create_batch.assert_not_called()


def test_nested_username_does_not_satisfy_the_contract():
    """The coach page used to send username inside each game object."""
    games = [
        {**game, "username": "AmalAlam999"} for game in _chesscom_games()
    ]
    with (
        patch("main.db.consume_analysis_credits") as consume,
        patch("main.db.create_batch") as create_batch,
    ):
        response = _post({"platform": "chess.com", "games": games})

    assert response.status_code == 400
    assert "Chess.com username is required" in response.json()["detail"]
    consume.assert_not_called()
    create_batch.assert_not_called()


def test_chesscom_batch_with_top_level_username_proceeds():
    with (
        patch(
            "main.db.consume_analysis_credits",
            return_value={"allowed": True, "analyses_used": 2},
        ) as consume,
        patch("main.db.create_batch", return_value={"id": "batch-1"}),
        patch("main.db.update_batch"),
        patch("main.db.refund_analysis_credits"),
        patch("main.extractor.fetch_game", return_value=MagicMock()),
        patch.object(Request, "is_disconnected", new=AsyncMock(return_value=True)),
    ):
        with TestClient(main.app) as client:
            with client.stream(
                "POST",
                "/api/stream-batch-analysis",
                json={
                    "platform": "chess.com",
                    "username": "AmalAlam999",
                    "games": _chesscom_games(),
                },
            ) as response:
                body = "".join(response.iter_text())

    assert response.status_code == 200
    consume.assert_called_once_with("u-test", 2)
    assert "batch_started" in body


def test_lichess_batch_needs_no_username():
    with (
        patch(
            "main.db.consume_analysis_credits",
            return_value={"allowed": True, "analyses_used": 2},
        ) as consume,
        patch("main.db.create_batch", return_value={"id": "batch-2"}),
        patch("main.db.update_batch"),
        patch("main.db.refund_analysis_credits"),
        patch("main.extractor.fetch_game", return_value=MagicMock()),
        patch.object(Request, "is_disconnected", new=AsyncMock(return_value=True)),
    ):
        with TestClient(main.app) as client:
            with client.stream(
                "POST",
                "/api/stream-batch-analysis",
                json={
                    "platform": "lichess",
                    "games": [
                        {"game_url": "https://lichess.org/abc12345"},
                        {"game_url": "https://lichess.org/def67890"},
                    ],
                },
            ) as response:
                _ = "".join(response.iter_text())

    assert response.status_code == 200
    consume.assert_called_once_with("u-test", 2)
