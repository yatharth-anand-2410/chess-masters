"""Tests for the two subscription tiers and the coach gate (0015).

Run from the backend directory::

    python -m pytest tests/test_billing_tiers.py -q

Everything runs offline: Razorpay and Supabase are stubbed, so the tests
assert the payloads the real clients would send/receive.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from main import (  # noqa: E402
    _plan_activation,
    _subscription_tier,
    _usage_payload,
    app,
    get_current_user,
    get_optional_user,
)
from services import billing, db  # noqa: E402

client = TestClient(app)

PLAN_ENV = {
    "RAZORPAY_KEY_ID": "rzp_test_public_key",
    "RAZORPAY_KEY_SECRET": "rzp_test_secret",
    "RAZORPAY_PLAN_ID": "plan_student_399",
    "RAZORPAY_COACH_PLAN_ID": "plan_coach_1999",
}


@pytest.fixture
def as_user():
    """Sign TestClient requests in as ``user-1``."""

    def _install(user_id: str = "user-1", email: str | None = "coach@example.com"):
        identity = {"id": user_id, "email": email, "user_metadata": None}
        app.dependency_overrides[get_current_user] = lambda: identity
        app.dependency_overrides[get_optional_user] = lambda: identity

    yield _install
    app.dependency_overrides.clear()


@pytest.fixture
def signed_out():
    app.dependency_overrides[get_optional_user] = lambda: None
    yield
    app.dependency_overrides.clear()


def _plan_env(monkeypatch: pytest.MonkeyPatch, **overrides: str) -> None:
    for key, value in {**PLAN_ENV, **overrides}.items():
        monkeypatch.setenv(key, value)


# ---------------------------------------------------------------------------
# Plan registry
# ---------------------------------------------------------------------------


def test_plan_registry_has_both_tiers():
    assert set(billing.PLANS) == {"student", "coach"}
    assert billing.PLAN_IDS == ("student", "coach")

    student = billing.PLANS["student"]
    assert (student.label, student.amount, student.amount_inr) == (
        "Pro Student",
        39900,
        399,
    )
    assert student.env_var == "RAZORPAY_PLAN_ID"
    assert student.paid_analysis_limit == 100

    coach = billing.PLANS["coach"]
    assert (coach.label, coach.amount, coach.amount_inr) == (
        "Master Coach",
        199900,
        1999,
    )
    assert coach.env_var == "RAZORPAY_COACH_PLAN_ID"
    assert coach.paid_analysis_limit == 500

    # Legacy constant: the original single plan was ₹399.
    assert billing.SUBSCRIPTION_AMOUNT == 39900


def test_configured_is_per_plan(monkeypatch: pytest.MonkeyPatch):
    _plan_env(monkeypatch, RAZORPAY_COACH_PLAN_ID="")
    assert billing.configured() is True  # no-arg keeps its student meaning
    assert billing.configured("student") is True
    assert billing.configured("coach") is False
    assert billing.configured("platinum") is False

    _plan_env(monkeypatch)
    assert billing.configured("coach") is True


def test_configured_requires_the_key_pair(monkeypatch: pytest.MonkeyPatch):
    _plan_env(monkeypatch, RAZORPAY_KEY_SECRET="")
    assert billing.configured("student") is False
    assert billing.configured("coach") is False


def test_plan_amount_and_resolution(monkeypatch: pytest.MonkeyPatch):
    _plan_env(monkeypatch)
    assert billing.plan_amount() == 39900
    assert billing.plan_amount("coach") == 199900
    assert billing.razorpay_plan_id("coach") == "plan_coach_1999"
    assert billing.resolve_plan_id(None) == "student"
    assert billing.resolve_plan_id("") == "student"
    assert billing.resolve_plan_id(" Coach ") == "coach"
    with pytest.raises(billing.UnknownPlanError):
        billing.plan_amount("platinum")


def test_create_subscription_carries_the_plan_tier(monkeypatch: pytest.MonkeyPatch):
    _plan_env(monkeypatch)
    calls: Dict[str, Any] = {}

    def fake_request(method: str, path: str, **kwargs: Any) -> Dict[str, Any]:
        calls.update({"method": method, "path": path, "kwargs": kwargs})
        return {"id": "sub_coach", "plan_id": "plan_coach_1999", "status": "created"}

    monkeypatch.setattr(billing, "_request", fake_request)
    result = billing.create_subscription("user-1", "coach@example.com", "coach")

    assert result["id"] == "sub_coach"
    body = calls["kwargs"]["json"]
    assert body["plan_id"] == "plan_coach_1999"
    assert body["notes"]["plan_tier"] == "coach"
    assert body["notes"]["supabase_user_id"] == "user-1"
    assert body["notes"]["plan_amount"] == 199900


def test_create_subscription_defaults_to_student(monkeypatch: pytest.MonkeyPatch):
    _plan_env(monkeypatch)
    calls: Dict[str, Any] = {}
    monkeypatch.setattr(
        billing,
        "_request",
        lambda method, path, **kwargs: calls.update(kwargs) or {"id": "sub_1"},
    )
    billing.create_subscription("user-1", None)
    assert calls["json"]["plan_id"] == "plan_student_399"
    assert calls["json"]["notes"]["plan_tier"] == "student"


def test_create_subscription_requires_the_plan_id(monkeypatch: pytest.MonkeyPatch):
    _plan_env(monkeypatch, RAZORPAY_COACH_PLAN_ID="")
    with pytest.raises(billing.BillingError) as excinfo:
        billing.create_subscription("user-1", None, "coach")
    assert "RAZORPAY_COACH_PLAN_ID" in str(excinfo.value)


def test_public_config_shape_and_no_secret(monkeypatch: pytest.MonkeyPatch):
    _plan_env(monkeypatch)
    config = billing.public_config()

    assert config["key_id"] == "rzp_test_public_key"
    assert config["currency"] == "INR"
    assert set(config["plans"]) == {"student", "coach"}

    student = config["plans"]["student"]
    assert student == {
        "id": "student",
        "label": "Pro Student",
        "amount": 39900,
        "amount_inr": 399,
        "plan_id": "plan_student_399",
        "configured": True,
    }
    coach = config["plans"]["coach"]
    assert coach["id"] == "coach"
    assert coach["label"] == "Master Coach"
    assert coach["amount"] == 199900
    assert coach["plan_id"] == "plan_coach_1999"
    assert coach["configured"] is True

    # The key secret must never appear anywhere in the payload.
    assert "rzp_test_secret" not in json.dumps(config)


def test_public_config_marks_a_missing_coach_plan(monkeypatch: pytest.MonkeyPatch):
    _plan_env(monkeypatch, RAZORPAY_COACH_PLAN_ID="")
    config = billing.public_config()
    assert config["plans"]["student"]["configured"] is True
    assert config["plans"]["coach"]["configured"] is False
    assert config["plans"]["coach"]["plan_id"] is None


def test_public_config_without_razorpay_still_answers(monkeypatch: pytest.MonkeyPatch):
    for key in PLAN_ENV:
        monkeypatch.delenv(key, raising=False)
    config = billing.public_config()
    assert config["key_id"] is None
    assert config["plans"]["student"]["configured"] is False
    assert config["plans"]["coach"]["configured"] is False


def test_billing_config_endpoint(as_user, monkeypatch: pytest.MonkeyPatch):
    _plan_env(monkeypatch)
    as_user()
    response = client.get("/api/billing/config", headers={"Authorization": "Bearer t"})
    assert response.status_code == 200
    body = response.json()
    assert body["currency"] == "INR"
    assert body["plans"]["student"]["label"] == "Pro Student"
    assert body["plans"]["coach"]["amount"] == 199900
    assert "secret" not in json.dumps(body)


# ---------------------------------------------------------------------------
# POST /api/billing/subscription
# ---------------------------------------------------------------------------


def _stub_checkout(monkeypatch: pytest.MonkeyPatch) -> Dict[str, Any]:
    """Record the stored subscription row and the tier Razorpay was asked for."""
    recorded: Dict[str, Any] = {"calls": []}

    def fake_create(user_id: str, email: str | None, plan: str) -> Dict[str, Any]:
        recorded["create"] = {"user_id": user_id, "email": email, "plan": plan}
        return {"id": "sub_created", "plan_id": "plan_for_" + plan, "status": "created"}

    def fake_store(user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        recorded["stored"] = {"user_id": user_id, **data}
        return {"id": "row-1", **data}

    monkeypatch.setattr(billing, "create_subscription", fake_create)
    monkeypatch.setattr(db, "create_subscription", fake_store)
    monkeypatch.setattr(db, "get_current_subscription", lambda user_id: None)
    return recorded


def test_subscription_endpoint_defaults_to_student(as_user, monkeypatch):
    _plan_env(monkeypatch)
    recorded = _stub_checkout(monkeypatch)
    as_user()
    response = client.post(
        "/api/billing/subscription",
        headers={"Authorization": "Bearer t"},
        json={},
    )
    assert response.status_code == 200
    body = response.json()
    assert body == {
        "subscription_id": "sub_created",
        "key_id": "rzp_test_public_key",
        "plan": "student",
    }
    assert recorded["create"]["plan"] == "student"
    assert recorded["stored"]["plan_tier"] == "student"
    assert recorded["stored"]["amount"] == 39900
    assert recorded["stored"]["currency"] == "INR"


def test_subscription_endpoint_accepts_the_coach_plan(as_user, monkeypatch):
    _plan_env(monkeypatch)
    recorded = _stub_checkout(monkeypatch)
    as_user()
    response = client.post(
        "/api/billing/subscription",
        headers={"Authorization": "Bearer t"},
        json={"plan": "coach"},
    )
    assert response.status_code == 200
    assert response.json()["plan"] == "coach"
    assert recorded["create"]["plan"] == "coach"
    assert recorded["stored"]["plan_tier"] == "coach"
    assert recorded["stored"]["amount"] == 199900


def test_subscription_endpoint_rejects_an_unknown_plan(as_user, monkeypatch):
    _plan_env(monkeypatch)
    as_user()
    response = client.post(
        "/api/billing/subscription",
        headers={"Authorization": "Bearer t"},
        json={"plan": "platinum"},
    )
    assert response.status_code == 400
    assert "platinum" in response.json()["detail"]


def test_subscription_endpoint_without_razorpay_is_a_setup_error(
    as_user, monkeypatch: pytest.MonkeyPatch
):
    for key in PLAN_ENV:
        monkeypatch.delenv(key, raising=False)
    as_user()
    response = client.post(
        "/api/billing/subscription",
        headers={"Authorization": "Bearer t"},
        json={"plan": "coach"},
    )
    assert response.status_code == 503
    assert "Master Coach" in response.json()["detail"]


def test_subscription_endpoint_reuses_a_pending_subscription(as_user, monkeypatch):
    _plan_env(monkeypatch)
    monkeypatch.setattr(
        db,
        "get_current_subscription",
        lambda user_id: {
            "razorpay_subscription_id": "sub_pending",
            "status": "created",
            "plan_tier": "coach",
        },
    )
    as_user()
    response = client.post(
        "/api/billing/subscription",
        headers={"Authorization": "Bearer t"},
        json={"plan": "coach"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "subscription_id": "sub_pending",
        "key_id": "rzp_test_public_key",
        "plan": "coach",
    }


# ---------------------------------------------------------------------------
# Activation: verify + webhook
# ---------------------------------------------------------------------------


def test_subscription_tier_and_activation_defaults():
    assert _subscription_tier(None) == "student"
    assert _subscription_tier({}) == "student"
    assert _subscription_tier({"plan_tier": " Coach "}) == "coach"
    assert _subscription_tier({"plan_tier": "platinum"}) == "student"
    assert _plan_activation({"plan_tier": "coach"}) == {
        "plan_tier": "coach",
        "paid_analysis_limit": 500,
    }
    assert _plan_activation({"plan_tier": None}) == {
        "plan_tier": "student",
        "paid_analysis_limit": 100,
    }


def test_verify_activates_the_subscription_tier(as_user, monkeypatch):
    _plan_env(monkeypatch)
    as_user()
    monkeypatch.setattr(
        db,
        "get_subscription",
        lambda user_id, subscription_id: {
            "razorpay_subscription_id": subscription_id,
            "user_id": user_id,
            "status": "created",
            "plan_tier": "coach",
        },
    )
    monkeypatch.setattr(billing, "verify_checkout_signature", lambda *args: True)
    updates: Dict[str, Any] = {}
    monkeypatch.setattr(
        db, "update_subscription", lambda sid, payload: updates.update({sid: payload})
    )
    access: Dict[str, Any] = {}

    def fake_set_paid(user_id: str, paid: bool, status: str, period_end=None, **kw):
        access.update(
            {
                "user_id": user_id,
                "paid": paid,
                "status": status,
                "period_end": period_end,
                **kw,
            }
        )

    monkeypatch.setattr(db, "set_paid_access", fake_set_paid)
    monkeypatch.setattr(db, "reset_analysis_usage", lambda user_id: None)

    response = client.post(
        "/api/billing/verify",
        headers={"Authorization": "Bearer t"},
        json={
            "razorpay_payment_id": "pay_1",
            "razorpay_subscription_id": "sub_1",
            "razorpay_signature": "sig",
        },
    )
    assert response.status_code == 200
    assert response.json() == {"status": "authenticated", "plan": "coach"}
    assert updates["sub_1"] == {"status": "authenticated"}
    assert access["paid"] is True
    assert access["plan_tier"] == "coach"
    assert access["paid_analysis_limit"] == 500


def test_verify_defaults_a_legacy_subscription_to_student(as_user, monkeypatch):
    _plan_env(monkeypatch)
    as_user()
    monkeypatch.setattr(
        db,
        "get_subscription",
        lambda user_id, subscription_id: {
            "razorpay_subscription_id": subscription_id,
            "user_id": user_id,
            "status": "created",
        },
    )
    monkeypatch.setattr(billing, "verify_checkout_signature", lambda *args: True)
    monkeypatch.setattr(db, "update_subscription", lambda sid, payload: None)
    access: Dict[str, Any] = {}
    monkeypatch.setattr(
        db,
        "set_paid_access",
        lambda user_id, paid, status, period_end=None, **kw: access.update(kw),
    )
    monkeypatch.setattr(db, "reset_analysis_usage", lambda user_id: None)

    response = client.post(
        "/api/billing/verify",
        headers={"Authorization": "Bearer t"},
        json={
            "razorpay_payment_id": "pay_1",
            "razorpay_subscription_id": "sub_1",
            "razorpay_signature": "sig",
        },
    )
    assert response.status_code == 200
    assert response.json()["plan"] == "student"
    assert access == {"plan_tier": "student", "paid_analysis_limit": 100}


def test_webhook_reads_the_tier_from_the_notes(monkeypatch: pytest.MonkeyPatch):
    payload = {
        "event": "subscription.activated",
        "payload": {
            "subscription": {
                "entity": {
                    "id": "sub_coach",
                    "status": "active",
                    "current_end": 4102444800,
                    "notes": {"plan_tier": "coach"},
                }
            }
        },
    }
    monkeypatch.setattr(billing, "verify_webhook_signature", lambda *args: True)
    monkeypatch.setattr(db, "record_webhook_event", lambda *args: True)
    monkeypatch.setattr(
        db,
        "get_subscription_by_razorpay_id",
        lambda sid: {
            "user_id": "user-1",
            "razorpay_subscription_id": sid,
            "status": "created",
            "plan_tier": "student",
        },
    )
    updates: Dict[str, Any] = {}
    monkeypatch.setattr(
        db, "update_subscription", lambda sid, data: updates.update(data)
    )
    access: Dict[str, Any] = {}
    monkeypatch.setattr(
        db,
        "set_paid_access",
        lambda user_id, paid, status, period_end=None, **kw: access.update(kw),
    )

    # The signature check is stubbed, so the raw body only has to be JSON.
    response = client.post(
        "/api/billing/webhook",
        content=json.dumps(payload),
        headers={"X-Razorpay-Signature": "sig", "X-Razorpay-Event-Id": "evt_1"},
    )
    assert response.status_code == 200
    assert response.json() == {"status": "processed"}
    assert access["plan_tier"] == "coach"
    assert access["paid_analysis_limit"] == 500
    assert updates["status"] == "active"


def test_set_paid_access_payload_keeps_the_tier_history(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    sent: Dict[str, Any] = {}

    def fake_post(url: str, params=None, json=None, headers=None, timeout=None):
        sent.update(json or {})
        response = MagicMock()
        response.status_code = 201
        response.text = ""
        return response

    monkeypatch.setattr(db, "_post", fake_post)
    db.set_paid_access(
        "user-1", True, "authenticated", None, plan_tier="coach", paid_analysis_limit=500
    )
    assert sent["plan"] == "paid"
    assert sent["plan_tier"] == "coach"
    assert sent["paid_analysis_limit"] == 500

    sent.clear()
    db.set_paid_access("user-1", False, "cancelled", "2026-01-01T00:00:00Z")
    assert "plan_tier" not in sent
    assert sent["plan"] == "free"
    assert sent["subscription_status"] == "cancelled"


# ---------------------------------------------------------------------------
# Usage payload + coach gate
# ---------------------------------------------------------------------------


def test_usage_payload_reports_the_stored_tier():
    coach = _usage_payload(
        {
            "plan": "paid",
            "plan_tier": "coach",
            "subscription_status": "active",
            "analyses_used": 7,
            "paid_analysis_limit": 500,
        }
    )
    assert coach["plan_tier"] == "coach"
    assert coach["paid_analysis_limit"] == 500
    assert coach["analyses_remaining"] == 493

    student = _usage_payload(
        {
            "plan": "paid",
            "plan_tier": "student",
            "subscription_status": "authenticated",
            "analyses_used": 7,
        }
    )
    assert student["plan_tier"] == "student"


def test_usage_payload_downgrades_a_lapsed_tier():
    lapsed = _usage_payload(
        {
            "plan": "paid",
            "plan_tier": "coach",
            "subscription_status": "cancelled",
            "current_period_end": "2000-01-01T00:00:00+00:00",
        }
    )
    assert lapsed["plan"] == "free"
    assert lapsed["plan_tier"] == "free"

    # A paid account whose tier was never recorded (pre-0015 row) is the
    # original ₹399 plan, i.e. Pro Student — never the coach tier.
    legacy = _usage_payload(
        {"plan": "paid", "subscription_status": "active", "analyses_used": 1}
    )
    assert legacy["plan"] == "paid"
    assert legacy["plan_tier"] == "student"

    free = _usage_payload({"plan": "free", "analyses_used": 1})
    assert free["plan_tier"] == "free"

    # An unknown stored value is not a tier either.
    unknown = _usage_payload(
        {
            "plan": "paid",
            "plan_tier": "platinum",
            "subscription_status": "active",
            "analyses_used": 1,
        }
    )
    assert unknown["plan_tier"] == "student"


def test_usage_payload_ignores_a_stored_tier_on_a_free_account():
    free_with_tier = _usage_payload(
        {"plan": "free", "plan_tier": "coach", "subscription_status": "inactive"}
    )
    assert free_with_tier["plan"] == "free"
    assert free_with_tier["plan_tier"] == "free"


def test_usage_payload_keeps_coach_access_until_the_period_ends():
    paused = _usage_payload(
        {
            "plan": "paid",
            "plan_tier": "coach",
            "subscription_status": "paused",
            "current_period_end": "2999-01-01T00:00:00+00:00",
        }
    )
    assert paused["plan"] == "paid"
    assert paused["plan_tier"] == "coach"


@pytest.mark.parametrize(
    "usage,expected",
    [
        ({"plan": "paid", "plan_tier": "coach", "subscription_status": "active"}, True),
        (
            {"plan": "paid", "plan_tier": "coach", "subscription_status": "authenticated"},
            True,
        ),
        (
            {
                "plan": "paid",
                "plan_tier": "coach",
                "subscription_status": "paused",
                "current_period_end": "2999-01-01T00:00:00Z",
            },
            True,
        ),
        (
            {
                "plan": "paid",
                "plan_tier": "coach",
                "subscription_status": "cancelled",
                "current_period_end": "2000-01-01T00:00:00Z",
            },
            False,
        ),
        ({"plan": "paid", "plan_tier": "student", "subscription_status": "active"}, False),
        ({"plan": "paid", "subscription_status": "active"}, False),
        ({"plan": "free", "plan_tier": "coach", "subscription_status": "inactive"}, False),
    ],
)
def test_is_coach_plan(monkeypatch, usage: Dict[str, Any], expected: bool):
    monkeypatch.setattr(db, "get_usage", lambda user_id: dict(usage))
    assert db.is_coach_plan("user-1") is expected


def test_usage_endpoint_returns_plan_tier(as_user, monkeypatch):
    _plan_env(monkeypatch)
    as_user()
    monkeypatch.setattr(
        db,
        "get_usage",
        lambda user_id: {
            "plan": "paid",
            "plan_tier": "coach",
            "subscription_status": "active",
            "analyses_used": 3,
            "paid_analysis_limit": 500,
        },
    )
    monkeypatch.setattr(db, "count_completed_analyses", lambda user_id: 12)
    response = client.get("/api/account/usage", headers={"Authorization": "Bearer t"})
    assert response.status_code == 200
    body = response.json()
    assert body["plan_tier"] == "coach"
    assert body["plan"] == "paid"
    assert body["total_games_analyzed"] == 12


def test_coach_endpoints_require_the_coach_tier(as_user, monkeypatch):
    _plan_env(monkeypatch)
    as_user()
    monkeypatch.setattr(db, "is_coach_plan", lambda user_id: False)

    response = client.post(
        "/api/coach/students",
        headers={"Authorization": "Bearer t"},
        json={"display_name": "Aarav"},
    )
    assert response.status_code == 402
    detail = response.json()["detail"]
    assert detail["code"] == "upgrade_required"
    assert detail["feature"] == "coach"
    assert "Master Coach" in detail["message"]

    share = client.post(
        "/api/coach/students/student-1/share",
        headers={"Authorization": "Bearer t"},
    )
    assert share.status_code == 402
    assert share.json()["detail"]["feature"] == "coach"


def test_coach_student_creation_works_for_the_coach_tier(as_user, monkeypatch):
    _plan_env(monkeypatch)
    as_user()
    monkeypatch.setattr(db, "is_coach_plan", lambda user_id: True)
    created: Dict[str, Any] = {}

    def fake_create_student(coach_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        created.update({"coach_id": coach_id, **data})
        return {"id": "student-1", "coach_id": coach_id, "archived_at": None, **data}

    monkeypatch.setattr(db, "create_student", fake_create_student)
    response = client.post(
        "/api/coach/students",
        headers={"Authorization": "Bearer t"},
        json={"display_name": "Aarav"},
    )
    assert response.status_code == 200
    assert created["display_name"] == "Aarav"
    assert response.json()["display_name"] == "Aarav"
