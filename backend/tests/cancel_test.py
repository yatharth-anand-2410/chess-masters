"""Offline regression tests for the player-cancel path of the SSE endpoints.

A player who cancels mid-analysis must get their credit back and History must
show "cancelled" instead of a stuck "processing" row. These tests drive the
real endpoints with mocked I/O and a faked client disconnect.

Run from the backend directory:
    ../.venv/bin/python -m tests.cancel_test
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from starlette.requests import Request

import main

ANALYSIS_PAYLOAD = {
    "platform": "lichess",
    "game_url": "https://lichess.org/abc12345",
    "player_color": "white",
}

BATCH_PAYLOAD = {
    "platform": "lichess",
    "games": [
        {"game_url": "https://lichess.org/abc12345", "player_color": "white"},
        {"game_url": "https://lichess.org/def67890", "player_color": "black"},
    ],
}

SIGNED_IN_USER = {"id": "u-test", "email": "tester@example.com", "user_metadata": {}}


def _override_user(user):
    async def _dependency():
        return user

    return _dependency


class CancelAnalysisTest(unittest.TestCase):
    def setUp(self) -> None:
        main.app.dependency_overrides.clear()

    def tearDown(self) -> None:
        main.app.dependency_overrides.clear()

    def _stream(self, path: str, payload: dict) -> str:
        client = TestClient(main.app)
        with client.stream("POST", path, json=payload) as response:
            return "".join(response.iter_text())

    @patch.object(Request, "is_disconnected", new=AsyncMock(return_value=True))
    @patch("main.extractor.fetch_game", return_value=MagicMock())
    def test_guest_cancel_before_charge_consumes_nothing(self, _disconnected) -> None:
        """Disconnect during extraction happens before the guest trial is charged."""
        main.app.dependency_overrides[main.get_optional_user] = _override_user(None)
        with patch("main.db.consume_guest_analysis") as consume_guest:
            body = self._stream("/api/stream-analysis", ANALYSIS_PAYLOAD)

        consume_guest.assert_not_called()
        self.assertNotIn("event: error", body)

    @patch.object(Request, "is_disconnected", new=AsyncMock(return_value=True))
    @patch("main.extractor.fetch_game", return_value=MagicMock())
    def test_signed_in_cancel_refunds_credit_and_writes_no_row(self, _disconnected) -> None:
        main.app.dependency_overrides[main.get_optional_user] = _override_user(
            SIGNED_IN_USER
        )
        with (
            patch("main.db.consume_analysis_credit", return_value={"allowed": True}),
            patch("main.db.refund_analysis_credits") as refund,
            patch("main.db.create_analysis") as create_analysis,
            patch("main.db.update_analysis") as update_analysis,
        ):
            body = self._stream("/api/stream-analysis", ANALYSIS_PAYLOAD)

        refund.assert_called_once_with("u-test", 1)
        create_analysis.assert_not_called()
        update_analysis.assert_not_called()
        self.assertNotIn("event: error", body)

    @patch("main.extractor.fetch_game", return_value=MagicMock())
    def test_mid_stream_cancel_marks_row_cancelled(self, _fetch_game) -> None:
        """Disconnect after the engine finishes: refund + status="cancelled"."""
        main.app.dependency_overrides[main.get_optional_user] = _override_user(
            SIGNED_IN_USER
        )
        disconnect_calls = {"count": 0}

        async def disconnect_after_engine(_self) -> bool:
            disconnect_calls["count"] += 1
            # First check (right after extraction): still connected.
            # Second check (after the engine): the player cancelled.
            return disconnect_calls["count"] >= 2

        with (
            patch.object(
                Request, "is_disconnected", new=disconnect_after_engine
            ),
            patch("main.db.consume_analysis_credit", return_value={"allowed": True}),
            patch("main.db.create_analysis", return_value={"id": "analysis-1"}),
            patch("main.db.refund_analysis_credits") as refund,
            patch("main.db.update_analysis") as update_analysis,
            patch.object(main.engine.EnginePool, "create", return_value=MagicMock()),
            patch("main.analyze_game", return_value=MagicMock()),
            patch("main.recommendations.build_insights", return_value=MagicMock()),
        ):
            body = self._stream("/api/stream-analysis", ANALYSIS_PAYLOAD)

        refund.assert_called_once_with("u-test", 1)
        cancelled_write = next(
            (
                call
                for call in update_analysis.call_args_list
                if call.args[2].get("status") == "cancelled"
            ),
            None,
        )
        self.assertIsNotNone(
            cancelled_write, f"expected a cancelled write, got {update_analysis.call_args_list}"
        )
        self.assertNotIn("event: done", body)


class CancelBatchTest(unittest.TestCase):
    def setUp(self) -> None:
        main.app.dependency_overrides.clear()

    def tearDown(self) -> None:
        main.app.dependency_overrides.clear()

    def _stream(self, path: str, payload: dict) -> str:
        client = TestClient(main.app)
        with client.stream("POST", path, json=payload) as response:
            return "".join(response.iter_text())

    @patch.object(Request, "is_disconnected", new=AsyncMock(return_value=True))
    @patch("main.extractor.fetch_game", return_value=MagicMock())
    def test_batch_cancel_refunds_unfinished_games(self, _disconnected) -> None:
        main.app.dependency_overrides[main.get_current_user] = _override_user(
            SIGNED_IN_USER
        )
        with (
            patch(
                "main.db.consume_analysis_credits",
                return_value={"allowed": True},
            ),
            patch("main.db.create_batch", return_value={"id": "batch-1"}),
            patch("main.db.refund_analysis_credits") as refund,
            patch("main.db.update_batch") as update_batch,
        ):
            body = self._stream("/api/stream-batch-analysis", BATCH_PAYLOAD)

        refund.assert_called_once_with("u-test", 2)
        cancelled_write = next(
            (
                call
                for call in update_batch.call_args_list
                if call.args[2].get("status") == "cancelled"
            ),
            None,
        )
        self.assertIsNotNone(cancelled_write)
        self.assertNotIn("event: done", body)


if __name__ == "__main__":
    unittest.main()
