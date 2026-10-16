"""Offline tests for the request-path optimisations in services/db.py.

Three behaviours matter and are easy to regress:

* a verified token is reused for its TTL, so a page load does not pay a GoTrue
  round trip per request;
* invalid tokens are never cached;
* the list projections stay light — the rendered report body must never come
  along for the ride on a list read.

Everything is mocked; nothing here touches the network.
"""

from __future__ import annotations

import sys
import unittest.mock
from pathlib import Path
from typing import Any, Dict, List

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import db  # noqa: E402


def _response(payload: Any = None, status_code: int = 200, headers: Dict[str, str] | None = None):
    response = unittest.mock.MagicMock()
    response.status_code = status_code
    response.text = ""
    response.headers = headers or {}
    response.json.return_value = payload
    response.raise_for_status.return_value = None
    return response


@pytest.fixture(autouse=True)
def _configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    db.forget_token("token-a")
    db.forget_token("token-b")


def _misses() -> int:
    return len(db._auth_cache)


def test_verified_token_is_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: List[str] = []

    def fake_get(url: str, **kwargs: Any):
        calls.append(url)
        return _response({"id": "user-1", "email": "player@example.com"})

    monkeypatch.setattr(db, "_get", fake_get)
    first = db.get_user_from_token("token-a")
    second = db.get_user_from_token("token-a")
    third = db.get_user_from_token("token-b")

    assert first["id"] == "user-1"
    assert second == first
    assert third["id"] == "user-1"
    # One GoTrue call for token-a, one for token-b: 2, not 3.
    assert len(calls) == 2
    assert [_misses()][0] >= 1


def test_invalid_token_is_not_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: List[str] = []

    def fake_get(url: str, **kwargs: Any):
        calls.append(url)
        return _response({"error": "invalid"}, status_code=401)

    monkeypatch.setattr(db, "_get", fake_get)
    for _ in range(3):
        with pytest.raises(db.AuthError):
            db.get_user_from_token("token-expired")
    assert len(calls) == 3


def test_cache_ttl_zero_disables_caching(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(db, "AUTH_CACHE_TTL_SECONDS", 0.0)
    calls: List[str] = []

    def fake_get(url: str, **kwargs: Any):
        calls.append(url)
        return _response({"id": "user-1"})

    monkeypatch.setattr(db, "_get", fake_get)
    db.get_user_from_token("token-a")
    db.get_user_from_token("token-a")
    assert len(calls) == 2


def test_expired_cache_entry_is_refetched(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(db, "AUTH_CACHE_TTL_SECONDS", 0.01)
    calls: List[str] = []

    def fake_get(url: str, **kwargs: Any):
        calls.append(url)
        return _response({"id": "user-1"})

    monkeypatch.setattr(db, "_get", fake_get)
    db.get_user_from_token("token-a")
    # Force expiry without sleeping a whole TTL.
    for key, (expires_at, user) in list(db._auth_cache.items()):
        db._auth_cache[key] = (expires_at - 60.0, user)
    db.get_user_from_token("token-a")
    assert len(calls) == 2


def test_list_analyses_omits_the_report_body(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: Dict[str, Any] = {}

    def fake_get(url: str, params: Dict[str, str] | None = None, **kwargs: Any):
        seen.update(params or {})
        return _response([])

    monkeypatch.setattr(db, "_get", fake_get)
    db.list_analyses("user-1", limit=50)

    select = seen["select"]
    assert "report_markdown" not in select
    assert "insights" not in select
    assert "opening_name" in select
    assert "replay_available" in select


def test_list_analyses_can_ask_for_telemetry(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: Dict[str, Any] = {}

    def fake_get(url: str, params: Dict[str, str] | None = None, **kwargs: Any):
        seen.update(params or {})
        return _response([])

    monkeypatch.setattr(db, "_get", fake_get)
    db.list_analyses("user-1", limit=100, columns=db.ANALYSIS_TELEMETRY_COLUMNS)

    select = seen["select"]
    assert "insights" in select and "game_summary" in select
    assert "report_markdown" not in select


def test_list_batches_omits_the_report_body(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: Dict[str, Any] = {}

    def fake_get(url: str, params: Dict[str, str] | None = None, **kwargs: Any):
        seen.update(params or {})
        return _response([])

    monkeypatch.setattr(db, "_get", fake_get)
    db.list_batches("user-1")

    assert seen["select"] == db.BATCH_LIST_COLUMNS
    assert "report_markdown" not in seen["select"]


def test_lifetime_count_is_cached_until_a_game_completes(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: List[str] = []

    def fake_get(url: str, **kwargs: Any):
        calls.append(url)
        return _response([], headers={"Content-Range": "0-0/3"})

    monkeypatch.setattr(db, "_get", fake_get)
    db.forget_lifetime_count("user-count")

    assert db.count_completed_analyses("user-count") == 3
    assert db.count_completed_analyses("user-count") == 3
    assert len(calls) == 1, "the lifetime count was re-read inside its TTL"

    # A finished analysis must move the badge immediately.
    db.forget_lifetime_count("user-count")
    assert db.count_completed_analyses("user-count") == 3
    assert len(calls) == 2


def test_reads_reuse_one_session_and_writes_open_a_fresh_one(monkeypatch: pytest.MonkeyPatch) -> None:
    created: List[Any] = []

    class CountingSession(db.requests.Session):
        def __init__(self) -> None:  # noqa: D107
            super().__init__()
            created.append(self)

        def get(self, url: str, **kwargs: Any):  # type: ignore[override]
            return _response([])

        def post(self, url: str, **kwargs: Any):  # type: ignore[override]
            return _response([])

    monkeypatch.setattr(db.requests, "Session", CountingSession)
    # Start from a clean worker slot so the counts below are deterministic.
    db._local.session = None
    db._local.last_used = 0.0

    db._get("https://example.supabase.co/rest/v1/analyses")
    db._get("https://example.supabase.co/rest/v1/analyses")
    assert len(created) == 1, "consecutive reads must share one keep-alive session"

    db._post("https://example.supabase.co/rest/v1/analyses", json={})
    assert len(created) == 2, "a write must not inherit a possibly-stale connection"

    db._local.session = None
    db._local.last_used = 0.0
