"""Offline regression tests for the failure paths of /api/stream-analysis.

A failed analysis must never cost the player anything and must never leave a
row stuck in "processing":

* a guest whose analysis fails gets the free trial back;
* a signed-in player whose engine run fails after the history row was created
  sees that row marked "failed" (and gets the credit back).

Run from the backend directory:
    ../.venv/bin/python -m pytest -q tests/stream_failure_test.py
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

SIGNED_IN_USER = {"id": "u-test", "email": "tester@example.com", "user_metadata": {}}


def _override_user(user):
    async def _dependency():
        return user

    return _dependency


@patch.object(Request, "is_disconnected", new=AsyncMock(return_value=False))
@patch("main.extractor.fetch_game", return_value=MagicMock())
class StreamFailureTest(unittest.TestCase):
    def setUp(self) -> None:
        main.app.dependency_overrides.clear()

    def tearDown(self) -> None:
        main.app.dependency_overrides.clear()

    def _stream(self) -> str:
        client = TestClient(main.app)
        with client.stream("POST", "/api/stream-analysis", json=ANALYSIS_PAYLOAD) as response:
            return "".join(response.iter_text())

    def test_guest_engine_failure_returns_the_trial(self, _fetch) -> None:
        main.app.dependency_overrides[main.get_optional_user] = _override_user(None)
        with (
            patch("main.db.consume_guest_analysis", return_value={"allowed": True}),
            patch("main.db.release_guest_analysis", create=True) as release,
            patch.object(main.engine.EnginePool, "create", return_value=MagicMock()),
            patch(
                "main.analyze_game",
                side_effect=main.engine.EngineError("Stockfish crashed."),
            ),
        ):
            body = self._stream()

        self.assertIn("event: error", body)
        release.assert_called_once()

    def test_guest_refused_trial_is_not_released(self, _fetch) -> None:
        """A guest who had no trial left must not get one back by failing."""
        main.app.dependency_overrides[main.get_optional_user] = _override_user(None)
        with (
            patch("main.db.consume_guest_analysis", return_value={"allowed": False}),
            patch("main.db.release_guest_analysis", create=True) as release,
        ):
            body = self._stream()

        self.assertIn("guest_limit", body)
        release.assert_not_called()

    def test_engine_failure_marks_created_row_failed(self, _fetch) -> None:
        main.app.dependency_overrides[main.get_optional_user] = _override_user(
            SIGNED_IN_USER
        )
        with (
            patch("main.db.consume_analysis_credit", return_value={"allowed": True}),
            patch("main.db.add_linked_account"),
            patch("main.db.create_analysis", return_value={"id": "analysis-1"}),
            patch("main.db.refund_analysis_credits") as refund,
            patch("main.db.update_analysis") as update_analysis,
            patch.object(main.engine.EnginePool, "create", return_value=MagicMock()),
            patch(
                "main.analyze_game",
                side_effect=main.engine.EngineError("Stockfish crashed."),
            ),
        ):
            body = self._stream()

        self.assertIn("event: error", body)
        refund.assert_called_once_with("u-test", 1)
        failed_writes = [
            call
            for call in update_analysis.call_args_list
            if call.args[1] == "analysis-1" and call.args[2].get("status") == "failed"
        ]
        self.assertEqual(
            len(failed_writes), 1, f"expected one failed write, got {update_analysis.call_args_list}"
        )


if __name__ == "__main__":
    unittest.main()
