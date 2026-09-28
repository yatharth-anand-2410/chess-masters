"""Supabase persistence + token verification.

The backend authenticates the caller by validating their access token against
the GoTrue endpoint, then uses the service-role secret to read/write the
user's own rows. Ownership is always enforced with ``user_id`` filters.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import requests

TIMEOUT = 12

FREE_ANALYSIS_LIMIT = 2


class AuthError(Exception):
    """Raised when a bearer token is invalid, expired, or missing."""


def _config() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    return url, key


def configured() -> bool:
    url, key = _config()
    return bool(url and key)


def _service_headers() -> Dict[str, str]:
    _url, key = _config()
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _user_headers(token: str) -> Dict[str, str]:
    _url, key = _config()
    return {
        "apikey": key,
        "Authorization": f"Bearer {token}",
    }


def get_user_from_token(token: str) -> Dict[str, Any]:
    url, _key = _config()
    if not token:
        raise AuthError("Missing authentication token.")
    if not configured():
        raise AuthError("Supabase is not configured on the server.")
    try:
        response = requests.get(
            f"{url}/auth/v1/user",
            headers=_user_headers(token),
            timeout=TIMEOUT,
        )
    except requests.RequestException as exc:
        raise AuthError(f"Could not reach the auth service: {exc}") from exc
    if response.status_code != 200:
        raise AuthError("Invalid or expired authentication token.")
    user = response.json()
    if not user.get("id"):
        raise AuthError("Invalid authentication token.")
    return user


def create_analysis(user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    url, _key = _config()
    payload = {"user_id": user_id, **data}
    response = requests.post(
        f"{url}/rest/v1/analyses",
        json=payload,
        headers={**_service_headers(), "Prefer": "return=representation"},
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else {}


def update_analysis(user_id: str, analysis_id: str, updates: Dict[str, Any]) -> None:
    url, _key = _config()
    response = requests.patch(
        f"{url}/rest/v1/analyses",
        params={"id": f"eq.{analysis_id}", "user_id": f"eq.{user_id}"},
        json=updates,
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()


def get_analysis(user_id: str, analysis_id: str) -> Optional[Dict[str, Any]]:
    url, _key = _config()
    response = requests.get(
        f"{url}/rest/v1/analyses",
        params={
            "select": "*",
            "id": f"eq.{analysis_id}",
            "user_id": f"eq.{user_id}",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else None


def list_analyses(user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    url, _key = _config()
    response = requests.get(
        f"{url}/rest/v1/analyses",
        params={
            "select": "*",
            "user_id": f"eq.{user_id}",
            "order": "created_at.desc",
            "limit": str(limit),
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    return response.json()


def add_message(user_id: str, analysis_id: str, role: str, content: str) -> Dict[str, Any]:
    url, _key = _config()
    payload = {
        "user_id": user_id,
        "analysis_id": analysis_id,
        "role": role,
        "content": content,
    }
    response = requests.post(
        f"{url}/rest/v1/analysis_messages",
        json=payload,
        headers={**_service_headers(), "Prefer": "return=representation"},
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else {}


def list_messages(analysis_id: str) -> List[Dict[str, Any]]:
    url, _key = _config()
    response = requests.get(
        f"{url}/rest/v1/analysis_messages",
        params={
            "select": "*",
            "analysis_id": f"eq.{analysis_id}",
            "order": "created_at.asc",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    return response.json()


def get_usage(user_id: str) -> Dict[str, Any]:
    url, _key = _config()
    if not configured():
        raise AuthError("Supabase is not configured on the server.")
    response = requests.get(
        f"{url}/rest/v1/account_usage",
        params={"select": "*", "user_id": f"eq.{user_id}"},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    if not rows:
        return {
            "plan": "free",
            "analyses_used": 0,
            "free_analysis_limit": FREE_ANALYSIS_LIMIT,
        }
    row = rows[0]
    return {
        "plan": row.get("plan", "free"),
        "analyses_used": row.get("analyses_used", 0),
        "free_analysis_limit": row.get("free_analysis_limit", FREE_ANALYSIS_LIMIT),
    }


def consume_analysis_credit(user_id: str) -> Dict[str, Any]:
    """Atomically consume one free analysis credit via the SQL function.

    Returns the jsonb payload from ``consume_analysis_credit``, e.g.
    ``{"allowed": true, "plan": "free", "analyses_used": 1, "free_analysis_limit": 2}``.
    The caller decides how to respond when ``allowed`` is false.
    """
    url, _key = _config()
    if not configured():
        raise AuthError("Supabase is not configured on the server.")
    response = requests.post(
        f"{url}/rest/v1/rpc/consume_analysis_credit",
        json={"p_user_id": user_id},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    if response.status_code == 404:
        raise AuthError(
            "Quota function is not deployed. Run migration 0002_account_usage.sql "
            "in the Supabase SQL Editor."
        )
    response.raise_for_status()
    return response.json()