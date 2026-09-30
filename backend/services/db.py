"""Supabase persistence + token verification.

The backend authenticates the caller by validating their access token against
the GoTrue endpoint, then uses the service-role secret to read/write the
user's own rows. Ownership is always enforced with ``user_id`` filters.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

TIMEOUT = 12

FREE_ANALYSIS_LIMIT = 2

KNOWN_NON_PAID_STATUSES = {"pending", "halted", "cancelled", "completed", "expired"}


def _period_end_in_future(value: Any) -> bool:
    if not value:
        return False
    if isinstance(value, datetime):
        end = value
    else:
        try:
            end = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return False
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    return end > datetime.now(timezone.utc)


def is_paid_plan(plan: str, status: str, period_end: Any = None) -> bool:
    """Option B gating: paused or period-end-cancelled plans keep access until
    the paid period ends."""
    if plan != "paid":
        return False
    if status in {"authenticated", "active"}:
        return True
    if status in {"paused", "cancelled"}:
        return _period_end_in_future(period_end)
    return status not in KNOWN_NON_PAID_STATUSES


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


def upsert_review(
    user_id: str,
    rating: int,
    comment: Optional[str],
    display_name: Optional[str],
) -> Dict[str, Any]:
    url, _key = _config()
    response = requests.post(
        f"{url}/rest/v1/reviews",
        params={"on_conflict": "user_id"},
        json={
            "user_id": user_id,
            "rating": rating,
            "comment": comment,
            "display_name": display_name,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        headers={
            **_service_headers(),
            "Prefer": "resolution=merge-duplicates,return=representation",
        },
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else {}


def list_reviews(limit: int = 200) -> List[Dict[str, Any]]:
    url, _key = _config()
    response = requests.get(
        f"{url}/rest/v1/reviews",
        params={
            "select": "id,user_id,rating,comment,display_name,created_at,updated_at",
            "order": "rating.desc,created_at.desc",
            "limit": str(limit),
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    return response.json()


def get_user_review(user_id: str) -> Optional[Dict[str, Any]]:
    url, _key = _config()
    response = requests.get(
        f"{url}/rest/v1/reviews",
        params={"select": "*", "user_id": f"eq.{user_id}", "limit": "1"},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else None


def get_review_stats() -> Dict[str, Any]:
    url, _key = _config()
    response = requests.get(
        f"{url}/rest/v1/review_stats",
        params={"select": "*"},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    if not rows:
        return {"review_count": 0, "average_rating": None}
    return rows[0]


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
            "subscription_status": "inactive",
            "current_period_end": None,
        }
    row = rows[0]
    return {
        "plan": row.get("plan", "free"),
        "analyses_used": row.get("analyses_used", 0),
        "free_analysis_limit": row.get("free_analysis_limit", FREE_ANALYSIS_LIMIT),
        "subscription_status": row.get("subscription_status", "inactive"),
        "current_period_end": row.get("current_period_end"),
    }


def get_current_subscription(user_id: str) -> Optional[Dict[str, Any]]:
    url, _key = _config()
    response = requests.get(
        f"{url}/rest/v1/billing_subscriptions",
        params={
            "select": "*",
            "user_id": f"eq.{user_id}",
            "status": "in.(created,pending,authenticated,active,paused)",
            "order": "created_at.desc",
            "limit": "1",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else None


def get_subscription_by_customer_id(customer_id: str) -> Optional[Dict[str, Any]]:
    url, _key = _config()
    response = requests.get(
        f"{url}/rest/v1/billing_subscriptions",
        params={
            "select": "*",
            "razorpay_customer_id": f"eq.{customer_id}",
            "order": "created_at.desc",
            "limit": "1",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else None


def create_subscription(user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    url, _key = _config()
    response = requests.post(
        f"{url}/rest/v1/billing_subscriptions",
        json={"user_id": user_id, **data},
        headers={**_service_headers(), "Prefer": "return=representation"},
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else {}


def get_subscription(user_id: str, subscription_id: str) -> Optional[Dict[str, Any]]:
    url, _key = _config()
    response = requests.get(
        f"{url}/rest/v1/billing_subscriptions",
        params={
            "select": "*",
            "user_id": f"eq.{user_id}",
            "razorpay_subscription_id": f"eq.{subscription_id}",
            "limit": "1",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else None


def get_subscription_by_razorpay_id(subscription_id: str) -> Optional[Dict[str, Any]]:
    url, _key = _config()
    response = requests.get(
        f"{url}/rest/v1/billing_subscriptions",
        params={"select": "*", "razorpay_subscription_id": f"eq.{subscription_id}", "limit": "1"},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else None


def get_latest_subscription(user_id: str) -> Optional[Dict[str, Any]]:
    url, _key = _config()
    response = requests.get(
        f"{url}/rest/v1/billing_subscriptions",
        params={
            "select": "*",
            "user_id": f"eq.{user_id}",
            "order": "created_at.desc",
            "limit": "1",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else None


def update_subscription(subscription_id: str, updates: Dict[str, Any]) -> None:
    url, _key = _config()
    response = requests.patch(
        f"{url}/rest/v1/billing_subscriptions",
        params={"razorpay_subscription_id": f"eq.{subscription_id}"},
        json=updates,
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()


def set_paid_access(user_id: str, paid: bool, status: str, period_end: Any = None) -> None:
    url, _key = _config()
    response = requests.post(
        f"{url}/rest/v1/account_usage",
        params={"on_conflict": "user_id"},
        json={
            "user_id": user_id,
            "plan": "paid" if paid else "free",
            "subscription_status": status,
            "current_period_end": period_end,
        },
        headers={**_service_headers(), "Prefer": "resolution=merge-duplicates"},
        timeout=TIMEOUT,
    )
    response.raise_for_status()


def record_invoice(user_id: str, data: Dict[str, Any]) -> bool:
    url, _key = _config()
    response = requests.post(
        f"{url}/rest/v1/billing_invoices",
        json={"user_id": user_id, **data},
        headers={**_service_headers(), "Prefer": "return=minimal"},
        timeout=TIMEOUT,
    )
    if response.status_code == 409:
        return False
    response.raise_for_status()
    return True


def list_invoices_db(user_id: str, limit: int = 12) -> List[Dict[str, Any]]:
    url, _key = _config()
    response = requests.get(
        f"{url}/rest/v1/billing_invoices",
        params={
            "select": "razorpay_invoice_id,status,amount,currency,paid_at,short_url",
            "user_id": f"eq.{user_id}",
            "order": "created_at.desc",
            "limit": str(limit),
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    return [
        {
            "id": row.get("razorpay_invoice_id"),
            "status": row.get("status"),
            "amount": row.get("amount"),
            "currency": row.get("currency"),
            "paid_at": row.get("paid_at"),
            "short_url": row.get("short_url"),
        }
        for row in response.json()
    ]


def record_webhook_event(event_id: str, event_type: str, payload: Dict[str, Any]) -> bool:
    url, _key = _config()
    response = requests.post(
        f"{url}/rest/v1/billing_webhook_events",
        json={"razorpay_event_id": event_id, "event_type": event_type, "payload": payload},
        headers={**_service_headers(), "Prefer": "return=minimal"},
        timeout=TIMEOUT,
    )
    if response.status_code == 409:
        return False
    response.raise_for_status()
    return True


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
