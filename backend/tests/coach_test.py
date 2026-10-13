"""Offline unit tests for coach mode: roles, student payloads, share links.

Run from the backend directory:
    ../.venv/bin/python -m tests.coach_test
"""

from __future__ import annotations

import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import coach

import main as main_module
from fastapi import HTTPException


# ---------------------------------------------------------------------------
# Role + student input validation
# ---------------------------------------------------------------------------


def test_role_accepts_known_values():
    assert coach.validate_role("player") == "player"
    assert coach.validate_role(" Coach ") == "coach"


def test_role_rejects_unknown_values():
    for value in ("", "admin", None, 42):
        try:
            coach.validate_role(value)
        except coach.CoachError:
            continue
        raise AssertionError(f"Expected CoachError for {value!r}")


def test_display_name_is_trimmed_and_required():
    assert coach.clean_display_name("  Aarav  ") == "Aarav"
    try:
        coach.clean_display_name("   ")
    except coach.CoachError:
        pass
    else:
        raise AssertionError("Empty display name must be rejected")


def test_display_name_length_capped():
    long_name = "x" * (coach.DISPLAY_NAME_MAX + 1)
    try:
        coach.clean_display_name(long_name)
    except coach.CoachError:
        pass
    else:
        raise AssertionError("Overlong display name must be rejected")


def test_username_strips_at_prefix_and_empties():
    assert coach.clean_username("  @AaravM ") == "AaravM"
    assert coach.clean_username("") is None
    assert coach.clean_username(None) is None
    assert coach.clean_username("   ") is None


def test_notes_capped():
    too_long = "n" * (coach.NOTES_MAX + 1)
    try:
        coach.clean_notes(too_long)
    except coach.CoachError:
        pass
    else:
        raise AssertionError("Overlong notes must be rejected")
    assert coach.clean_notes("  hello  ") == "hello"
    assert coach.clean_notes("") is None


# ---------------------------------------------------------------------------
# Payload shaping
# ---------------------------------------------------------------------------


def _student_row(**overrides):
    row = {
        "id": "student-1",
        "coach_id": "coach-1",
        "display_name": "Aarav",
        "lichess_username": "aaravm",
        "chesscom_username": None,
        "notes": "struggles with back-rank",
        "created_at": "2026-10-01T00:00:00+00:00",
        "updated_at": "2026-10-01T00:00:00+00:00",
        "archived_at": None,
    }
    row.update(overrides)
    return row


def test_public_payload_never_leaks_notes_or_ids():
    payload = coach.student_public_payload(_student_row())
    assert payload["display_name"] == "Aarav"
    assert payload["lichess_username"] == "aaravm"
    assert "notes" not in payload
    assert "id" not in payload
    assert "coach_id" not in payload


def test_coach_payload_keeps_private_fields():
    payload = coach.student_payload(_student_row(), analysis_count=3)
    assert payload["notes"] == "struggles with back-rank"
    assert payload["analysis_count"] == 3
    assert "coach_id" not in payload


def test_roster_counts_and_latest_activity():
    students = [
        _student_row(id="s1", display_name="Aarav"),
        _student_row(id="s2", display_name="Sara"),
    ]
    activity = [
        {"student_id": "s1", "created_at": "2026-10-10T10:00:00+00:00", "result": "1-0"},
        {"student_id": "s1", "created_at": "2026-10-05T10:00:00+00:00", "result": "0-1"},
        {"student_id": "s2", "created_at": "2026-10-09T10:00:00+00:00", "result": "1/2-1/2"},
    ]
    payload = coach.roster_payload(students, activity)
    by_id = {row["id"]: row for row in payload}
    assert by_id["s1"]["analysis_count"] == 2
    assert by_id["s1"]["last_analysis_at"] == "2026-10-10T10:00:00+00:00"
    assert by_id["s1"]["last_result"] == "1-0"
    assert by_id["s2"]["analysis_count"] == 1


def test_roster_without_activity_defaults_to_zero():
    payload = coach.roster_payload([_student_row()], [])
    assert payload[0]["analysis_count"] == 0
    assert payload[0]["last_analysis_at"] is None


def test_roster_ignores_activity_for_unknown_students():
    payload = coach.roster_payload(
        [_student_row(id="s1")],
        [{"student_id": "other", "created_at": "2026-10-10T10:00:00+00:00"}],
    )
    assert payload[0]["analysis_count"] == 0


# ---------------------------------------------------------------------------
# Share links
# ---------------------------------------------------------------------------


def test_share_status_inactive_when_missing_or_revoked():
    assert coach.share_status(None) == {"active": False}
    revoked = {"token": str(uuid.uuid4()), "revoked_at": "2026-10-01T00:00:00+00:00"}
    assert coach.share_status(revoked) == {"active": False}


def test_share_status_active_shape():
    token = str(uuid.uuid4())
    status = coach.share_status(
        {"token": token, "revoked_at": None, "view_count": "3", "created_at": "x"}
    )
    assert status["active"] is True
    assert status["url_path"] == f"/s/{token}"
    assert status["view_count"] == 3


def test_is_share_usable():
    assert coach.is_share_usable({"token": "t", "revoked_at": None}) is True
    assert coach.is_share_usable({"token": "t", "revoked_at": "2026-01-01"}) is False
    assert coach.is_share_usable(None) is False


def test_public_analysis_summary_has_no_report():
    row = {
        "id": "a1",
        "platform": "lichess",
        "game_id": "abc12345",
        "game_url": "https://lichess.org/abc12345",
        "opening_name": "Italian Game",
        "report_markdown": "SECRET REPORT",
        "insights": {"strength_moments": []},
    }
    summary = coach.analysis_summary(row)
    assert summary["opening_name"] == "Italian Game"
    assert "report_markdown" not in summary
    assert "insights" not in summary


def test_public_analysis_payload_parses_string_insights():
    row = {
        "id": "a1",
        "platform": "lichess",
        "game_id": "abc12345",
        "game_url": "https://lichess.org/abc12345",
        "report_markdown": "# Report",
        "insights": '{"strength_moments": []}',
    }
    payload = coach.analysis_public_payload(row)
    assert payload["report_markdown"] == "# Report"
    assert payload["insights"] == {"strength_moments": []}


def test_batch_summary_has_no_report():
    summary = coach.batch_summary(
        {
            "id": "b1",
            "platform": "lichess",
            "game_count": "3",
            "created_at": "2026-10-13T13:49:28+00:00",
            "report_markdown": "SECRET",
            "insights": {"totals": {}},
        }
    )
    assert summary == {
        "id": "b1",
        "platform": "lichess",
        "game_count": 3,
        "created_at": "2026-10-13T13:49:28+00:00",
    }


def test_batch_public_payload_parses_string_insights():
    payload = coach.batch_public_payload(
        {
            "id": "b1",
            "platform": "lichess",
            "game_count": 3,
            "report_markdown": "# Multi-game report",
            "insights": '{"totals": {"blunder": 4}}',
        }
    )
    assert payload["report_markdown"] == "# Multi-game report"
    assert payload["insights"] == {"totals": {"blunder": 4}}


# ---------------------------------------------------------------------------
# Public endpoint helpers (main.py)
# ---------------------------------------------------------------------------


def test_share_token_parser_accepts_uuid():
    token = uuid.uuid4()
    assert main_module._parse_share_token(str(token)) == str(token)


def test_share_token_parser_rejects_garbage():
    for value in ("not-a-token", "", "1;drop table"):
        try:
            main_module._parse_share_token(value)
        except HTTPException as exc:
            assert exc.status_code == 404
        else:
            raise AssertionError(f"Expected 404 for {value!r}")


def test_shared_rate_limit_trips_after_budget():
    main_module._shared_call_times.clear()
    original = main_module.SHARED_RATE_LIMIT_CALLS
    main_module.SHARED_RATE_LIMIT_CALLS = 3
    try:
        for _ in range(3):
            main_module._enforce_shared_rate_limit("1.2.3.4")
        try:
            main_module._enforce_shared_rate_limit("1.2.3.4")
        except HTTPException as exc:
            assert exc.status_code == 429
        else:
            raise AssertionError("Expected 429 after exhausting the budget")
    finally:
        main_module.SHARED_RATE_LIMIT_CALLS = original
        main_module._shared_call_times.clear()


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
