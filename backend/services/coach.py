"""Coach mode domain logic: students, rosters, and share links.

Coach mode is a role on an ordinary account, not a separate identity system:
the coach signs in with Google and manages *student profiles* on the student's
behalf. Students never sign in. A share link is a read-only, revocable window
onto one student's analyses for a parent or student to open without an account.

This module owns the validation and payload shaping; raw Supabase access lives
in :mod:`services.db`.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

DISPLAY_NAME_MAX = 80
USERNAME_MAX = 60
NOTES_MAX = 4000

VALID_ROLES = {"player", "coach"}


class CoachError(Exception):
    """Raised when coach input is invalid."""


def validate_role(value: object) -> str:
    role = str(value or "").strip().lower()
    if role not in VALID_ROLES:
        raise CoachError("Role must be 'player' or 'coach'.")
    return role


def clean_display_name(value: object) -> str:
    name = str(value or "").strip()
    if not name:
        raise CoachError("A student name is required.")
    if len(name) > DISPLAY_NAME_MAX:
        raise CoachError(f"Student name must be at most {DISPLAY_NAME_MAX} characters.")
    return name


def clean_username(value: object) -> Optional[str]:
    """Normalize a platform username; empty means "not linked"."""
    if value is None:
        return None
    username = str(value).strip().lstrip("@")
    if not username:
        return None
    if len(username) > USERNAME_MAX:
        raise CoachError(f"Username must be at most {USERNAME_MAX} characters.")
    return username


def clean_notes(value: object) -> Optional[str]:
    """Coach notes are private: they never appear in any shared payload."""
    if value is None:
        return None
    notes = str(value).strip()
    if not notes:
        return None
    if len(notes) > NOTES_MAX:
        raise CoachError(f"Notes must be at most {NOTES_MAX} characters.")
    return notes


def student_payload(
    row: Dict[str, Any],
    analysis_count: int = 0,
    last_analysis_at: Optional[str] = None,
    last_result: Optional[str] = None,
) -> Dict[str, Any]:
    """Coach-facing student shape: includes notes, never share secrets."""
    return {
        "id": row.get("id"),
        "display_name": row.get("display_name"),
        "lichess_username": row.get("lichess_username"),
        "chesscom_username": row.get("chesscom_username"),
        "notes": row.get("notes"),
        "analysis_count": analysis_count,
        "last_analysis_at": last_analysis_at,
        "last_result": last_result,
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "archived_at": row.get("archived_at"),
    }


def student_public_payload(row: Dict[str, Any]) -> Dict[str, Any]:
    """Public (share-link) shape: no notes, no ids, no coach data."""
    return {
        "display_name": row.get("display_name"),
        "lichess_username": row.get("lichess_username"),
        "chesscom_username": row.get("chesscom_username"),
    }


def roster_payload(
    students: List[Dict[str, Any]],
    activity: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Attach per-student analysis counts and the most recent game.

    ``activity`` comes from ``db.list_student_activity`` (newest first), so the
    first row seen per student is the latest.
    """
    counts: Dict[str, int] = {}
    latest: Dict[str, Dict[str, Any]] = {}
    for entry in activity:
        student_id = str(entry.get("student_id") or "")
        if not student_id:
            continue
        counts[student_id] = counts.get(student_id, 0) + 1
        if student_id not in latest:
            latest[student_id] = entry
    payload: List[Dict[str, Any]] = []
    for row in students:
        student_id = str(row.get("id") or "")
        last = latest.get(student_id)
        payload.append(
            student_payload(
                row,
                analysis_count=counts.get(student_id, 0),
                last_analysis_at=last.get("created_at") if last else None,
                last_result=last.get("result") if last else None,
            )
        )
    return payload


def analysis_summary(row: Dict[str, Any]) -> Dict[str, Any]:
    """One analysis as shown on the public share page (list view)."""
    return {
        "id": row.get("id"),
        "platform": row.get("platform"),
        "game_id": row.get("game_id"),
        "game_url": row.get("game_url"),
        "player_color": row.get("player_color"),
        "opening_name": row.get("opening_name"),
        "eco": row.get("eco"),
        "result": row.get("result"),
        "created_at": row.get("created_at"),
    }


def analysis_public_payload(row: Dict[str, Any]) -> Dict[str, Any]:
    """One analysis with its report, for the public share page (report view)."""
    insights = row.get("insights")
    if isinstance(insights, str):
        try:
            insights = json.loads(insights)
        except ValueError:
            insights = {}
    return {
        **analysis_summary(row),
        "player_name": row.get("player_name"),
        "report_markdown": row.get("report_markdown"),
        "insights": insights,
    }


def batch_summary(row: Dict[str, Any]) -> Dict[str, Any]:
    """One multi-game report as shown on the public share page (list view)."""
    return {
        "id": row.get("id"),
        "platform": row.get("platform"),
        "game_count": int(row.get("game_count", 0) or 0),
        "created_at": row.get("created_at"),
    }


def batch_public_payload(row: Dict[str, Any]) -> Dict[str, Any]:
    """One multi-game report with its report, for the share page."""
    insights = row.get("insights")
    if isinstance(insights, str):
        try:
            insights = json.loads(insights)
        except ValueError:
            insights = {}
    return {
        **batch_summary(row),
        "report_markdown": row.get("report_markdown"),
        "insights": insights,
    }


def share_status(row: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Coach-facing share state, safe to render directly in the UI."""
    if not row or row.get("revoked_at"):
        return {"active": False}
    token = str(row.get("token") or "")
    return {
        "active": True,
        "token": token,
        "url_path": f"/s/{token}",
        "created_at": row.get("created_at"),
        "view_count": int(row.get("view_count", 0) or 0),
        "last_viewed_at": row.get("last_viewed_at"),
    }


def is_share_usable(row: Optional[Dict[str, Any]]) -> bool:
    """A token is usable only while it exists and has not been revoked."""
    return bool(row) and not row.get("revoked_at")
