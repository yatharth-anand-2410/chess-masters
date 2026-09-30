"""Offline unit tests for quota/payment gating helpers in main.py.

Run from the backend directory:
    ../.venv/bin/python -m tests.quota_test
"""

from __future__ import annotations

import os
import sys
import unittest.mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from main import _allowed_origins, _limit_reached_detail, _upgrade_detail, _usage_payload
from services import db


def test_upgrade_detail_analysis():
    detail = _upgrade_detail("analysis")
    assert detail["code"] == "upgrade_required"
    assert detail["feature"] == "analysis"
    assert "two free analyses" in detail["message"]


def test_upgrade_detail_qna():
    detail = _upgrade_detail("qna")
    assert detail["code"] == "upgrade_required"
    assert detail["feature"] == "qna"
    assert "paid plan" in detail["message"].lower()


def test_upgrade_detail_unknown_feature():
    detail = _upgrade_detail("something")
    assert detail["code"] == "upgrade_required"
    assert detail["feature"] == "something"


def test_limit_reached_detail_with_period_end():
    detail = _limit_reached_detail("analysis", "2026-10-30T00:00:00+00:00")
    assert detail["code"] == "limit_reached"
    assert detail["feature"] == "analysis"
    assert detail["limit"] == 100
    assert "100 analyses" in detail["message"]
    assert "October 30, 2026" in detail["message"]


def test_limit_reached_detail_without_period_end():
    detail = _limit_reached_detail("qna")
    assert detail["code"] == "limit_reached"
    assert detail["feature"] == "qna"
    assert "100 analyses" in detail["message"]
    assert "resets on" not in detail["message"]


def test_usage_payload_free():
    payload = _usage_payload({"plan": "free", "analyses_used": 1, "free_analysis_limit": 2})
    assert payload["analyses_remaining"] == 1
    assert payload["qna_enabled"] is False


def test_usage_payload_free_exhausted():
    payload = _usage_payload({"plan": "free", "analyses_used": 2, "free_analysis_limit": 2})
    assert payload["analyses_remaining"] == 0
    assert payload["qna_enabled"] is False


def test_usage_payload_paid():
    payload = _usage_payload({"plan": "paid", "analyses_used": 7, "free_analysis_limit": 2})
    assert payload["analyses_remaining"] == 93
    assert payload["paid_analysis_limit"] == 100
    assert payload["qna_enabled"] is True


def test_usage_payload_paid_active():
    payload = _usage_payload(
        {
            "plan": "paid",
            "analyses_used": 7,
            "free_analysis_limit": 2,
            "subscription_status": "active",
        }
    )
    assert payload["plan"] == "paid"
    assert payload["analyses_remaining"] == 93
    assert payload["qna_enabled"] is True


def test_usage_payload_paid_at_limit():
    payload = _usage_payload(
        {
            "plan": "paid",
            "analyses_used": 100,
            "paid_analysis_limit": 100,
            "subscription_status": "active",
        }
    )
    assert payload["plan"] == "paid"
    assert payload["analyses_remaining"] == 0
    assert payload["qna_enabled"] is False


def test_usage_payload_paid_new_period_resets_count():
    payload = _usage_payload(
        {
            "plan": "paid",
            "analyses_used": 100,
            "paid_analysis_limit": 100,
            "subscription_status": "active",
            "current_period_end": "2026-11-30T00:00:00+00:00",
            "usage_period_end": "2026-10-30T00:00:00+00:00",
        }
    )
    assert payload["analyses_used"] == 0
    assert payload["analyses_remaining"] == 100
    assert payload["qna_enabled"] is True


def test_usage_payload_paid_same_period_keeps_count():
    payload = _usage_payload(
        {
            "plan": "paid",
            "analyses_used": 40,
            "paid_analysis_limit": 100,
            "subscription_status": "active",
            "current_period_end": "2026-10-30T00:00:00+00:00",
            "usage_period_end": "2026-10-30T00:00:00+00:00",
        }
    )
    assert payload["analyses_used"] == 40
    assert payload["analyses_remaining"] == 60


def test_usage_payload_paused_with_future_period_is_paid():
    future = "2999-01-01T00:00:00+00:00"
    payload = _usage_payload(
        {
            "plan": "paid",
            "analyses_used": 7,
            "free_analysis_limit": 2,
            "subscription_status": "paused",
            "current_period_end": future,
        }
    )
    assert payload["plan"] == "paid"
    assert payload["qna_enabled"] is True


def test_usage_payload_paused_with_past_period_is_free():
    past = "2000-01-01T00:00:00+00:00"
    payload = _usage_payload(
        {
            "plan": "paid",
            "analyses_used": 1,
            "free_analysis_limit": 2,
            "subscription_status": "paused",
            "current_period_end": past,
        }
    )
    assert payload["plan"] == "free"
    assert payload["qna_enabled"] is False
    assert payload["analyses_remaining"] == 1


def test_usage_payload_cancelled_with_future_period_is_paid():
    future = "2999-01-01T00:00:00+00:00"
    payload = _usage_payload(
        {
            "plan": "paid",
            "analyses_used": 3,
            "free_analysis_limit": 2,
            "subscription_status": "cancelled",
            "current_period_end": future,
        }
    )
    assert payload["plan"] == "paid"
    assert payload["qna_enabled"] is True


def test_usage_payload_cancelled_with_past_period_is_free():
    past = "2000-01-01T00:00:00+00:00"
    payload = _usage_payload(
        {
            "plan": "paid",
            "analyses_used": 1,
            "free_analysis_limit": 2,
            "subscription_status": "cancelled",
            "current_period_end": past,
        }
    )
    assert payload["plan"] == "free"
    assert payload["qna_enabled"] is False


def test_usage_payload_halted_is_free():
    payload = _usage_payload(
        {
            "plan": "paid",
            "analyses_used": 2,
            "free_analysis_limit": 2,
            "subscription_status": "halted",
        }
    )
    assert payload["plan"] == "free"
    assert payload["qna_enabled"] is False


def test_is_paid_plan_direct():
    assert db.is_paid_plan("paid", "authenticated") is True
    assert db.is_paid_plan("paid", "active") is True
    assert db.is_paid_plan("paid", "paused", "2999-01-01T00:00:00Z") is True
    assert db.is_paid_plan("paid", "paused", "2000-01-01T00:00:00Z") is False
    assert db.is_paid_plan("paid", "paused") is False
    assert db.is_paid_plan("paid", "cancelled", "2999-01-01T00:00:00Z") is True
    assert db.is_paid_plan("paid", "cancelled", "2000-01-01T00:00:00Z") is False
    assert db.is_paid_plan("paid", "cancelled") is False
    assert db.is_paid_plan("free", "active") is False


def test_allowed_origins_defaults():
    with unittest.mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("FRONTEND_ORIGIN", None)
        origins = _allowed_origins()
    assert "http://localhost:3000" in origins


def test_allowed_origins_includes_extra():
    with unittest.mock.patch.dict(os.environ, {"FRONTEND_ORIGIN": "https://app.example.com/"}):
        origins = _allowed_origins()
    assert "https://app.example.com" in origins


def test_allowed_origins_multiple():
    with unittest.mock.patch.dict(
        os.environ, {"FRONTEND_ORIGIN": "https://a.example.com, https://b.example.com/"}
    ):
        origins = _allowed_origins()
    assert "https://a.example.com" in origins
    assert "https://b.example.com" in origins


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