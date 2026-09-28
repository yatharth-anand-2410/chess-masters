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

from main import _allowed_origins, _upgrade_detail, _usage_payload


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
    assert payload["analyses_remaining"] is None
    assert payload["qna_enabled"] is True


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