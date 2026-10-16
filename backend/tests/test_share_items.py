"""Tests for share items, the public item payload, the tactics catalog and
curated studies.

Run from the backend directory::

    python -m pytest tests/test_share_items.py -q

Everything runs offline: Supabase and Razorpay are stubbed, so the tests
assert the exact rows the helper layer would send and the exact JSON the
frontend reads.
"""

from __future__ import annotations

import sys
import uuid
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main as main_module  # noqa: E402
from main import app, get_current_user, get_optional_user  # noqa: E402
from services import db, puzzles, studies  # noqa: E402

client = TestClient(app)


@pytest.fixture
def as_user():
    """Sign TestClient requests in as ``coach-1`` (coach tier by default)."""

    def _install(user_id: str = "coach-1", email: str | None = "coach@example.com"):
        identity = {"id": user_id, "email": email, "user_metadata": None}
        app.dependency_overrides[get_current_user] = lambda: identity
        app.dependency_overrides[get_optional_user] = lambda: identity

    yield _install
    app.dependency_overrides.clear()


@pytest.fixture
def coach_tier(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(db, "is_coach_plan", lambda user_id: True)


@pytest.fixture
def anonymous():
    app.dependency_overrides[get_optional_user] = lambda: None
    yield
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def no_rate_limit(monkeypatch: pytest.MonkeyPatch):
    """The public share endpoint is per-IP throttled; tests hit it repeatedly."""
    monkeypatch.setattr(main_module, "_enforce_shared_rate_limit", lambda ip: None)


def _fake_response(payload: Any, status_code: int = 200, text: str = "") -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.text = text
    response.json.return_value = payload
    return response


def _share_item_row(**overrides: Any) -> Dict[str, Any]:
    row: Dict[str, Any] = {
        "token": str(uuid.uuid4()),
        "coach_id": "coach-1",
        "student_id": None,
        "kind": "study",
        "item_key": "curated-pin",
        "title": "Practice Pins",
        "subtitle": "Fixes your move 24 blunder vs Hikaru",
        "url": "https://lichess.org/training/pin",
        "view_count": 3,
        "last_viewed_at": None,
        "revoked_at": None,
        "created_at": "2026-10-15T10:00:00+00:00",
    }
    row.update(overrides)
    return row


# ---------------------------------------------------------------------------
# db helpers: the exact PostgREST traffic
# ---------------------------------------------------------------------------


def test_create_share_item_posts_the_row(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    sent: Dict[str, Any] = {}

    def fake_post(url: str, json=None, headers=None, timeout=None):
        sent.update({"url": url, "json": json})
        return _fake_response([{"token": "tok-1", **json}])

    monkeypatch.setattr(db, "_post", fake_post)
    row = db.create_share_item(
        "coach-1",
        {
            "student_id": "student-1",
            "kind": "tactic",
            "item_key": "pin",
            "title": "Pin",
            "subtitle": None,
            "url": "https://lichess.org/training/pin",
        },
    )
    assert row["token"] == "tok-1"
    assert sent["url"].endswith("/rest/v1/share_items")
    assert sent["json"]["coach_id"] == "coach-1"
    assert sent["json"]["kind"] == "tactic"
    assert sent["json"]["student_id"] == "student-1"


def test_list_share_items_filters(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    seen: List[Dict[str, Any]] = []

    def fake_get(url: str, params=None, headers=None, timeout=None):
        seen.append(dict(params))
        return _fake_response([])

    monkeypatch.setattr(db, "_get", fake_get)

    db.list_share_items("coach-1", "student-9")
    assert seen[-1]["student_id"] == "eq.student-9"
    assert seen[-1]["revoked_at"] == "is.null"
    assert "coach_id" in seen[-1] and seen[-1]["coach_id"] == "eq.coach-1"

    db.list_share_items("coach-1")
    assert "student_id" not in seen[-1]
    assert seen[-1]["revoked_at"] == "is.null"

    db.list_share_items("coach-1", None, include_revoked=True)
    assert "revoked_at" not in seen[-1]


def test_get_share_item_returns_none_for_unknown_tokens(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(
        db, "_get", lambda *args, **kwargs: _fake_response([])
    )
    assert db.get_share_item(str(uuid.uuid4())) is None


def test_revoke_share_item_reports_whether_it_closed(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    seen: Dict[str, Any] = {}

    def fake_patch(url: str, params=None, json=None, headers=None, timeout=None):
        seen.update({"params": dict(params), "json": dict(json)})
        return _fake_response([{"token": "tok-1"}])

    monkeypatch.setattr(db, "_patch", fake_patch)
    assert db.revoke_share_item("coach-1", "tok-1") is True
    assert seen["params"]["coach_id"] == "eq.coach-1"
    assert seen["params"]["revoked_at"] == "is.null"
    assert seen["json"]["revoked_at"]

    # Already-revoked (or another coach's) row: nothing matches, still fine.
    monkeypatch.setattr(
        db, "_patch", lambda *args, **kwargs: _fake_response([])
    )
    assert db.revoke_share_item("coach-1", "tok-1") is False


def test_touch_share_item_increments(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    token = str(uuid.uuid4())
    row = _share_item_row(token=token, view_count=3)
    patched: Dict[str, Any] = {}

    monkeypatch.setattr(
        db,
        "get_share_item",
        lambda value: row if value == token else None,
    )

    def fake_patch(url: str, params=None, json=None, headers=None, timeout=None):
        patched.update({"params": dict(params), "json": dict(json)})
        return _fake_response([])

    monkeypatch.setattr(db, "_patch", fake_patch)
    assert db.touch_share_item(token) == 4
    assert patched["json"]["view_count"] == 4
    assert patched["json"]["last_viewed_at"]
    assert db.touch_share_item("missing") is None


def test_missing_share_items_table_reads_as_a_setup_hint(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(
        db, "_get", lambda *args, **kwargs: _fake_response({}, status_code=404)
    )
    with pytest.raises(db.AuthError) as excinfo:
        db.get_share_item(str(uuid.uuid4()))
    assert "0016_share_items.sql" in str(excinfo.value)


# ---------------------------------------------------------------------------
# Payload shaping
# ---------------------------------------------------------------------------


def test_share_item_payload_has_nested_and_flat_shapes():
    token = str(uuid.uuid4())
    row = _share_item_row(token=token, view_count=2)
    payload = main_module._share_item_payload(
        row,
        {"id": "student-1", "display_name": "Aarav", "notes": "private!"},
        view_count=3,
    )
    assert payload["kind"] == "study"
    assert payload["title"] == row["title"]
    assert payload["subtitle"] == row["subtitle"]
    assert payload["url"] == row["url"]
    assert payload["view_count"] == 3
    assert payload["item"] == {
        "kind": "study",
        "item_key": row["item_key"],
        "title": row["title"],
        "subtitle": row["subtitle"],
        "url": row["url"],
        "view_count": 3,
    }
    assert payload["student"]["display_name"] == "Aarav"
    assert "notes" not in payload["student"]
    assert "token" not in payload


def test_share_item_payload_without_a_student():
    payload = main_module._share_item_payload(_share_item_row(), None)
    assert payload["student"] is None
    assert payload["view_count"] == 3  # falls back to the stored count


# ---------------------------------------------------------------------------
# Share item endpoints
# ---------------------------------------------------------------------------


def test_create_share_item_requires_the_coach_tier(as_user, monkeypatch):
    as_user()
    monkeypatch.setattr(db, "is_coach_plan", lambda user_id: False)
    response = client.post(
        "/api/share/items",
        headers={"Authorization": "Bearer t"},
        json={"kind": "study", "item_key": "curated-pin", "title": "Practice Pins"},
    )
    assert response.status_code == 402
    detail = response.json()["detail"]
    assert detail["code"] == "upgrade_required"
    assert detail["feature"] == "coach"


def test_create_share_item_validates_input(as_user, coach_tier):
    as_user()
    base = {"kind": "study", "item_key": "curated-pin", "title": "Practice Pins"}

    bad_kind = client.post(
        "/api/share/items",
        headers={"Authorization": "Bearer t"},
        json={**base, "kind": "podcast"},
    )
    assert bad_kind.status_code == 400
    assert "kind" in bad_kind.json()["detail"]

    no_title = client.post(
        "/api/share/items",
        headers={"Authorization": "Bearer t"},
        json={**base, "title": "   "},
    )
    assert no_title.status_code == 400
    assert "title" in no_title.json()["detail"]

    no_key = client.post(
        "/api/share/items",
        headers={"Authorization": "Bearer t"},
        json={**base, "item_key": ""},
    )
    assert no_key.status_code == 400
    assert "item_key" in no_key.json()["detail"]

    bad_url = client.post(
        "/api/share/items",
        headers={"Authorization": "Bearer t"},
        json={**base, "url": "javascript:alert(1)"},
    )
    assert bad_url.status_code == 400
    assert "http" in bad_url.json()["detail"]


def test_create_share_item_returns_the_link(as_user, coach_tier, monkeypatch):
    as_user()
    token = str(uuid.uuid4())
    stored: Dict[str, Any] = {}

    def fake_create(coach_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        stored.update({"coach_id": coach_id, **data})
        return {"token": token, **data}

    monkeypatch.setattr(db, "create_share_item", fake_create)
    response = client.post(
        "/api/share/items",
        headers={"Authorization": "Bearer t"},
        json={
            "kind": "tactic",
            "item_key": "pin",
            "title": "  Pin  ",
            "subtitle": "Fixes your move 24 blunder",
            "url": "https://lichess.org/training/pin",
        },
    )
    assert response.status_code == 200
    assert response.json() == {
        "token": token,
        "url_path": f"/s/{token}",
        "view_count": 0,
    }
    assert stored["coach_id"] == "coach-1"
    assert stored["student_id"] is None
    assert stored["title"] == "Pin"  # trimmed
    assert stored["kind"] == "tactic"


def test_create_share_item_checks_the_student(as_user, coach_tier, monkeypatch):
    as_user()
    monkeypatch.setattr(db, "get_student", lambda coach_id, student_id: None)
    response = client.post(
        "/api/share/items",
        headers={"Authorization": "Bearer t"},
        json={
            "kind": "study",
            "item_key": "curated-pin",
            "title": "Practice Pins",
            "student_id": "someone-elses-student",
        },
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Student not found."


def test_list_student_shares_shape(as_user, coach_tier, monkeypatch):
    as_user()
    rows = [
        _share_item_row(student_id="student-1", kind="tactic", title="Pin"),
        _share_item_row(student_id=None, title="Opening basics"),
    ]
    seen: Dict[str, Any] = {}

    def fake_list(coach_id: str, student_id=None, include_revoked: bool = False):
        seen.update({"coach_id": coach_id, "student_id": student_id})
        return rows

    monkeypatch.setattr(
        db,
        "get_student",
        lambda coach_id, student_id: {"id": student_id, "display_name": "Aarav"},
    )
    monkeypatch.setattr(db, "list_share_items", fake_list)

    response = client.get(
        "/api/coach/students/student-1/shares",
        headers={"Authorization": "Bearer t"},
    )
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list) and len(body) == 2
    assert seen == {"coach_id": "coach-1", "student_id": "student-1"}
    assert body[0]["student_name"] == "Aarav"
    assert body[1]["student_name"] is None  # no student attached
    assert set(body[0]) == {
        "token",
        "kind",
        "item_key",
        "title",
        "subtitle",
        "url",
        "student_id",
        "student_name",
        "view_count",
        "created_at",
        "revoked_at",
    }

    client.get(
        "/api/coach/students/student-1/shares?all=true",
        headers={"Authorization": "Bearer t"},
    )
    assert seen["student_id"] is None


def test_list_student_shares_requires_the_coach_tier(as_user, monkeypatch):
    as_user()
    monkeypatch.setattr(db, "is_coach_plan", lambda user_id: False)
    response = client.get(
        "/api/coach/students/student-1/shares",
        headers={"Authorization": "Bearer t"},
    )
    assert response.status_code == 402
    assert response.json()["detail"]["feature"] == "coach"


def test_revoke_share_item_is_idempotent(as_user, monkeypatch):
    as_user()
    token = str(uuid.uuid4())
    calls: List[tuple[str, str]] = []
    monkeypatch.setattr(
        db,
        "revoke_share_item",
        lambda coach_id, value: calls.append((coach_id, value)) or True,
    )

    first = client.delete(
        f"/api/share/items/{token}", headers={"Authorization": "Bearer t"}
    )
    assert first.status_code == 200
    assert first.json() == {"token": token, "revoked": True, "already_revoked": False}
    assert calls == [("coach-1", token)]

    # Revocation stays available without the coach tier — closing a link must
    # never require paying again.
    monkeypatch.setattr(db, "is_coach_plan", lambda user_id: False)
    monkeypatch.setattr(
        db,
        "revoke_share_item",
        lambda coach_id, value: calls.append((coach_id, value)) or False,
    )
    second = client.delete(
        f"/api/share/items/{token}", headers={"Authorization": "Bearer t"}
    )
    assert second.status_code == 200
    assert second.json()["already_revoked"] is True


def test_revoke_share_item_rejects_garbage_tokens(as_user):
    as_user()
    response = client.delete(
        "/api/share/items/not-a-token", headers={"Authorization": "Bearer t"}
    )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/shared/{token}
# ---------------------------------------------------------------------------


def test_shared_item_payload_and_view_count(monkeypatch):
    token = str(uuid.uuid4())
    row = _share_item_row(
        token=token,
        student_id="student-1",
        view_count=4,
        kind="tactic",
        subtitle="Pins cost you points",
    )
    monkeypatch.setattr(db, "get_share_item", lambda value: row if value == token else None)
    monkeypatch.setattr(db, "touch_share_item", lambda value: 5)
    monkeypatch.setattr(
        db,
        "get_student_by_id",
        lambda student_id: {"id": student_id, "display_name": "Aarav", "notes": "x"},
    )

    response = client.get(f"/api/shared/{token}")
    assert response.status_code == 200
    body = response.json()
    assert body["kind"] == "tactic"
    assert body["view_count"] == 5
    assert body["item"]["view_count"] == 5
    assert body["item"]["kind"] == "tactic"
    assert body["title"] == row["title"]
    assert body["subtitle"] == "Pins cost you points"
    assert body["url"] == "https://lichess.org/training/pin"
    assert body["student"]["display_name"] == "Aarav"
    assert "notes" not in body["student"]


def test_shared_item_counts_the_view_even_when_the_bump_fails(monkeypatch):
    token = str(uuid.uuid4())
    monkeypatch.setattr(db, "get_share_item", lambda value: _share_item_row(token=token))

    def explode(value: str) -> int:
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(db, "touch_share_item", explode)
    response = client.get(f"/api/shared/{token}")
    assert response.status_code == 200
    assert response.json()["view_count"] == 3  # the stored count, not a guess


def test_shared_revoked_item_is_dead(monkeypatch):
    token = str(uuid.uuid4())
    monkeypatch.setattr(
        db,
        "get_share_item",
        lambda value: _share_item_row(token=token, revoked_at="2026-10-16T00:00:00Z"),
    )
    monkeypatch.setattr(
        db, "touch_share_item", lambda value: pytest.fail("revoked item was counted")
    )
    response = client.get(f"/api/shared/{token}")
    assert response.status_code == 404
    assert response.json()["detail"] == "This share link is not active."


def test_shared_token_falls_back_to_the_student_feed(monkeypatch):
    token = str(uuid.uuid4())
    monkeypatch.setattr(db, "get_share_item", lambda value: None)
    monkeypatch.setattr(
        db,
        "get_share_link",
        lambda value: {
            "token": token,
            "student_id": "student-1",
            "revoked_at": None,
        },
    )
    monkeypatch.setattr(
        db,
        "get_student_by_id",
        lambda student_id: {"id": student_id, "display_name": "Aarav"},
    )
    monkeypatch.setattr(
        db,
        "list_public_analyses",
        lambda student_id, limit=100: [
            {
                "id": "analysis-1",
                "platform": "lichess",
                "opening_name": "Italian Game",
                "created_at": "2026-10-01T00:00:00+00:00",
                "report_markdown": "SECRET",
            }
        ],
    )
    monkeypatch.setattr(db, "list_public_batches", lambda student_id, limit=100: [])
    touched: List[str] = []
    monkeypatch.setattr(db, "touch_share_link", lambda value: touched.append(value))

    response = client.get(f"/api/shared/{token}")
    assert response.status_code == 200
    body = response.json()
    assert body["student"]["display_name"] == "Aarav"
    assert len(body["analyses"]) == 1
    assert "report_markdown" not in body["analyses"][0]
    assert body["batches"] == []
    assert "item" not in body
    assert touched == [token]


def test_shared_unknown_token_is_still_a_dead_link(monkeypatch):
    token = str(uuid.uuid4())
    monkeypatch.setattr(db, "get_share_item", lambda value: None)
    monkeypatch.setattr(db, "get_share_link", lambda value: None)
    response = client.get(f"/api/shared/{token}")
    assert response.status_code == 404


def test_shared_items_deployment_gap_keeps_the_portal_alive(monkeypatch):
    """0016 not deployed yet: the student-report path still answers."""
    token = str(uuid.uuid4())

    def missing_table(value: str):
        raise db.AuthError(
            "Share items are not deployed. Run migration 0016_share_items.sql "
            "in the Supabase SQL Editor."
        )

    monkeypatch.setattr(db, "get_share_item", missing_table)
    monkeypatch.setattr(
        db,
        "get_share_link",
        lambda value: {"token": token, "student_id": "student-1", "revoked_at": None},
    )
    monkeypatch.setattr(
        db,
        "get_student_by_id",
        lambda student_id: {"id": student_id, "display_name": "Aarav"},
    )
    monkeypatch.setattr(db, "list_public_analyses", lambda student_id, limit=100: [])
    monkeypatch.setattr(db, "list_public_batches", lambda student_id, limit=100: [])
    monkeypatch.setattr(db, "touch_share_link", lambda value: None)

    response = client.get(f"/api/shared/{token}")
    assert response.status_code == 200
    assert response.json()["student"]["display_name"] == "Aarav"


def test_create_share_item_survives_an_empty_row(as_user, coach_tier, monkeypatch):
    as_user()
    monkeypatch.setattr(db, "create_share_item", lambda coach_id, data: {})
    response = client.post(
        "/api/share/items",
        headers={"Authorization": "Bearer t"},
        json={"kind": "study", "item_key": "curated-pin", "title": "Practice Pins"},
    )
    assert response.status_code == 503


def test_list_student_shares_needs_a_real_student(as_user, coach_tier, monkeypatch):
    as_user()
    monkeypatch.setattr(db, "get_student", lambda coach_id, student_id: None)
    response = client.get(
        "/api/coach/students/someone-else/shares",
        headers={"Authorization": "Bearer t"},
    )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/tactics
# ---------------------------------------------------------------------------


def test_catalog_has_every_theme_labelled_and_linked():
    catalog = puzzles.build_tactics_catalog()
    themes = {theme["key"]: theme for theme in catalog["themes"]}

    assert len(themes) == 12
    assert catalog["total_links"] == sum(
        len(theme["links"]) for theme in catalog["themes"]
    )
    assert themes["hangingPiece"]["label"] == "Hanging Piece"
    assert themes["backRank"]["label"] == "Back-Rank Weakness"
    for key, theme in themes.items():
        assert theme["label"], key
        assert theme["description"], key
        assert key in theme["motif_aliases"], key
        assert theme["links"] and all(
            link["url"].startswith("https://lichess.org/training/")
            for link in theme["links"]
        ), key
        # The public catalog never invents an observed count.
        assert "observed_count" not in theme


def test_catalog_aliases_come_from_the_motif_and_resource_knowledge():
    themes = {theme["key"]: theme for theme in puzzles.build_tactics_catalog()["themes"]}
    assert "Pin" in themes["pin"]["motif_aliases"]  # motifs.MOTIF_LABELS
    assert "backRankMate" in themes["backRank"]["motif_aliases"]  # resources.ALIASES
    assert "exposedKing" in themes["vulnerableKing"]["motif_aliases"]


def test_theme_for_motif_resolves_stored_labels():
    assert puzzles.theme_for_motif("Pin") == "pin"
    assert puzzles.theme_for_motif("Hanging piece") == "hangingPiece"
    assert puzzles.theme_for_motif("backRank") == "backRank"
    assert puzzles.theme_for_motif("hangingPiece") == "hangingPiece"
    assert puzzles.theme_for_motif("middlegame") is None
    assert puzzles.theme_for_motif("") is None
    assert puzzles.theme_for_motif(None) is None


def test_catalog_observed_counts_are_real(monkeypatch):
    rows = [
        {
            "insights": {
                "weakness_moments": [
                    {"motif": "Pin", "resource_theme": "pin"},
                    {"motif": "Fork", "resource_theme": "fork"},
                    {"motif": None, "resource_theme": "pin"},
                    {"motif": None, "resource_theme": "middlegame"},
                ]
            }
        },
        {"insights": {"weakness_moments": [{"motif": "Hanging piece"}]}},
        {"insights": None},
    ]
    catalog = puzzles.build_tactics_catalog(rows)
    counts = {theme["key"]: theme["observed_count"] for theme in catalog["themes"]}
    assert counts["pin"] == 2
    assert counts["fork"] == 1
    assert counts["hangingPiece"] == 1
    assert counts["deflection"] == 0
    assert sum(counts.values()) == 4  # the phase fallback is not a motif


def test_tactics_endpoint_signed_out(anonymous, monkeypatch):
    monkeypatch.setattr(
        db, "list_analyses", lambda *args, **kwargs: pytest.fail("no reads signed out")
    )
    response = client.get("/api/tactics")
    assert response.status_code == 200
    body = response.json()
    assert len(body["themes"]) == 12
    assert all("observed_count" not in theme for theme in body["themes"])


def test_tactics_endpoint_personalizes_for_a_signed_in_user(as_user, monkeypatch):
    as_user()
    monkeypatch.setattr(db, "configured", lambda: True)
    calls: Dict[str, Any] = {}

    def fake_list(user_id: str, limit: int = 50, **kwargs):
        calls.update({"user_id": user_id, "limit": limit})
        return [
            {"insights": {"weakness_moments": [{"motif": "Pin"}, {"motif": "Pin"}]}}
        ]

    monkeypatch.setattr(db, "list_analyses", fake_list)
    response = client.get("/api/tactics", headers={"Authorization": "Bearer t"})
    assert response.status_code == 200
    themes = {theme["key"]: theme for theme in response.json()["themes"]}
    assert themes["pin"]["observed_count"] == 2
    assert themes["fork"]["observed_count"] == 0
    assert calls == {"user_id": "coach-1", "limit": main_module.TACTICS_SCAN_LIMIT}


def test_tactics_endpoint_degrades_when_the_database_fails(as_user, monkeypatch):
    as_user()
    monkeypatch.setattr(db, "configured", lambda: True)

    def explode(user_id: str, limit: int = 50, **kwargs):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(db, "list_analyses", explode)
    response = client.get("/api/tactics", headers={"Authorization": "Bearer t"})
    assert response.status_code == 200
    assert len(response.json()["themes"]) == 12


# ---------------------------------------------------------------------------
# GET /api/studies/curated
# ---------------------------------------------------------------------------


def _analysis_row(
    *,
    analysis_id: str = "analysis-1",
    game_id: str = "abcd1234",
    opponent: str | None = "Hikaru",
    moments: List[Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    return {
        "id": analysis_id,
        "game_id": game_id,
        "status": "completed",
        "insights": {"weakness_moments": moments if moments is not None else []},
        "game_summary": {"opponent_name": opponent},
    }


def test_curated_studies_are_empty_without_evidence():
    assert studies.build_curated_studies([]) == []
    assert (
        studies.build_curated_studies(
            [_analysis_row(moments=[{"motif": None, "resource_theme": "middlegame"}])]
        )
        == []
    )


def test_curated_studies_quote_the_real_moment():
    rows = [
        _analysis_row(
            moments=[
                {
                    "move_number": 24,
                    "quality": "blunder",
                    "centipawn_loss": 250,
                    "motif": "Pin",
                    "resource_theme": "pin",
                },
                {
                    "move_number": 12,
                    "quality": "mistake",
                    "centipawn_loss": 120,
                    "motif": "Pin",
                    "resource_theme": "pin",
                },
                {
                    "move_number": 30,
                    "quality": "blunder",
                    "centipawn_loss": 400,
                    "motif": "Fork",
                    "resource_theme": "fork",
                },
            ]
        )
    ]
    curated = studies.build_curated_studies(rows)

    assert [study["motif"] for study in curated] == ["pin", "fork"]
    pin = curated[0]
    assert pin["id"] == "curated-pin"
    assert pin["title"] == "Practice Pins"
    assert pin["source_url"] == "https://lichess.org/training/pin"
    assert pin["chapters"] is None
    assert pin["fixes"] == "Fixes your move 24 blunder vs Hikaru"
    assert pin["game_id"] == "abcd1234"
    assert pin["move_number"] == 24
    assert "Fixes your move 24 blunder vs Hikaru" in pin["reason"]
    assert "2 of the 3 recorded key errors are pin patterns" in pin["reason"]

    fork = curated[1]
    assert fork["fixes"] == "Fixes your move 30 blunder vs Hikaru"
    assert "1 of the 3 recorded key errors are fork patterns" in fork["reason"]


def test_curated_studies_prefer_the_worst_moment_and_fall_back_without_quality():
    rows = [
        _analysis_row(
            moments=[
                {
                    "move_number": 9,
                    "quality": "inaccuracy",
                    "centipawn_loss": 90,
                    "motif": "Skewer",
                },
                {
                    "move_number": 40,
                    "quality": "blunder",
                    "centipawn_loss": 500,
                    "motif": "Skewer",
                },
            ]
        ),
        _analysis_row(
            analysis_id="analysis-2",
            game_id=None,
            opponent=None,
            moments=[
                {
                    "move_number": None,
                    "quality": None,
                    "centipawn_loss": 200,
                    "motif": "Skewer",
                }
            ],
        ),
    ]
    curated = studies.build_curated_studies(rows)
    assert len(curated) == 1
    skewer = curated[0]
    assert skewer["move_number"] == 40
    assert skewer["game_id"] == "abcd1234"
    assert skewer["fixes"] == "Fixes your move 40 blunder vs Hikaru"

    # A moment without a move number or quality has no quotable fix sentence.
    without_quality = studies.build_curated_studies(
        [_analysis_row(moments=[{"motif": "Skewer", "centipawn_loss": 200}])]
    )
    assert without_quality[0]["fixes"] is None
    assert without_quality[0]["reason"] == "1 recorded key errors are skewer patterns."


def test_curated_studies_are_capped_and_ordered_by_count():
    moments: List[Dict[str, Any]] = []
    for index in range(8):
        moments.append(
            {
                "move_number": index + 1,
                "quality": "blunder",
                "centipawn_loss": 300 - index,
                "motif": "Pin",
            }
        )
    for motif in ("Fork", "Skewer", "Deflection"):
        moments.append({"move_number": 20, "quality": "mistake", "motif": motif})
    curated = studies.build_curated_studies([_analysis_row(moments=moments)], limit=2)
    assert [study["motif"] for study in curated] == ["pin", "deflection"]
    assert curated[0]["reason"].startswith("Fixes your move 1 blunder")


def test_curated_studies_endpoint_is_empty_signed_out(anonymous, monkeypatch):
    monkeypatch.setattr(
        db, "list_analyses", lambda *args, **kwargs: pytest.fail("no reads signed out")
    )
    response = client.get("/api/studies/curated")
    assert response.status_code == 200
    assert response.json() == []


def test_curated_studies_endpoint_personalizes(as_user, monkeypatch):
    as_user()
    calls: Dict[str, Any] = {}

    def fake_list(user_id: str, limit: int = 50, **kwargs):
        calls.update({"user_id": user_id, "limit": limit})
        return [
            _analysis_row(
                moments=[
                    {
                        "move_number": 28,
                        "quality": "blunder",
                        "centipawn_loss": 300,
                        "motif": "Fork",
                    }
                ]
            )
        ]

    monkeypatch.setattr(db, "list_analyses", fake_list)
    response = client.get("/api/studies/curated", headers={"Authorization": "Bearer t"})
    assert response.status_code == 200
    body = response.json()
    assert body[0]["motif"] == "fork"
    assert body[0]["fixes"] == "Fixes your move 28 blunder vs Hikaru"
    assert calls["limit"] == main_module.CURATED_SCAN_LIMIT


def test_curated_studies_endpoint_for_a_coach_student(as_user, monkeypatch):
    as_user()
    calls: Dict[str, Any] = {}
    monkeypatch.setattr(
        db,
        "get_student",
        lambda coach_id, student_id: {"id": student_id, "display_name": "Aarav"},
    )
    monkeypatch.setattr(
        db,
        "list_analyses_by_student",
        lambda coach_id, student_id, limit=100: calls.update(
            {"coach_id": coach_id, "student_id": student_id, "limit": limit}
        )
        or [],
    )
    monkeypatch.setattr(
        db, "list_analyses", lambda *args, **kwargs: pytest.fail("own games read")
    )

    empty = client.get(
        "/api/studies/curated?student_id=student-1",
        headers={"Authorization": "Bearer t"},
    )
    assert empty.status_code == 200
    assert empty.json() == []
    assert calls == {
        "coach_id": "coach-1",
        "student_id": "student-1",
        "limit": main_module.CURATED_SCAN_LIMIT,
    }

    monkeypatch.setattr(db, "get_student", lambda coach_id, student_id: None)
    missing = client.get(
        "/api/studies/curated?student_id=someone-else",
        headers={"Authorization": "Bearer t"},
    )
    assert missing.status_code == 404
