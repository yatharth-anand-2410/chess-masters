"""Offline unit tests for review validation/serialization helpers in main.py.

Run from the backend directory:
    ../.venv/bin/python -m tests.reviews_test
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import HTTPException

from main import (
    REVIEW_COMMENT_MAX_LENGTH,
    _public_review,
    _review_display_name,
    _review_summary,
    _validate_review,
)


def test_validate_review_accepts_valid_rating():
    assert _validate_review(5, "Great coaching") == "Great coaching"
    assert _validate_review(1, None) is None


def test_validate_review_trims_and_empties_comment():
    assert _validate_review(3, "   ") is None
    assert _validate_review(3, "  solid report  ") == "solid report"


def test_validate_review_rejects_out_of_range_rating():
    for rating in (0, 6, -1):
        try:
            _validate_review(rating, None)
            raise AssertionError(f"expected 400 for rating {rating}")
        except HTTPException as exc:
            assert exc.status_code == 400


def test_validate_review_rejects_long_comment():
    try:
        _validate_review(4, "x" * (REVIEW_COMMENT_MAX_LENGTH + 1))
        raise AssertionError("expected 400 for long comment")
    except HTTPException as exc:
        assert exc.status_code == 400


def test_validate_review_allows_max_length_comment():
    comment = "x" * REVIEW_COMMENT_MAX_LENGTH
    assert _validate_review(4, comment) == comment


def test_review_summary_empty():
    summary = _review_summary({"review_count": 0, "average_rating": None})
    assert summary["count"] == 0
    assert summary["average"] is None


def test_review_summary_rounds_average():
    summary = _review_summary({"review_count": 3, "average_rating": 4.666})
    assert summary["count"] == 3
    assert summary["average"] == 4.67


def test_public_review_marks_own_review():
    row = {"id": "r1", "user_id": "u1", "rating": 5, "comment": "nice"}
    mine = _public_review(row, "u1")
    other = _public_review(row, "u2")
    anonymous = _public_review(row, None)
    assert mine["is_mine"] is True
    assert other["is_mine"] is False
    assert anonymous["is_mine"] is False


def test_public_review_fallback_display_name():
    row = {"id": "r1", "user_id": "u1", "rating": 4, "display_name": None}
    assert _public_review(row, None)["display_name"] == "Anonymous player"


def test_review_display_name_prefers_full_name():
    user = {"user_metadata": {"full_name": "  Magnus C  ", "name": "Magnus"}}
    assert _review_display_name(user) == "Magnus C"


def test_review_display_name_uses_name_fallback():
    user = {"user_metadata": {"name": "Hikaru"}}
    assert _review_display_name(user) == "Hikaru"


def test_review_display_name_defaults_anonymous():
    assert _review_display_name({}) == "Anonymous player"
    assert _review_display_name({"user_metadata": {"full_name": "   "}}) == (
        "Anonymous player"
    )
    assert _review_display_name({"user_metadata": None}) == "Anonymous player"


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
