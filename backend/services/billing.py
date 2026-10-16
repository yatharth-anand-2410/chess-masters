"""Razorpay subscription operations and signature verification.

Two tiers are sold from one Razorpay account:

* ``student`` — Pro Student, ₹399/month, Razorpay plan id from
  ``RAZORPAY_PLAN_ID`` (the original single plan).
* ``coach`` — Master Coach, ₹1,999/month, Razorpay plan id from
  ``RAZORPAY_COACH_PLAN_ID``.

Amounts are kept in paise — Razorpay's own unit, and the unit the checkout page
divides by 100 before showing a price. The tier a subscription was created for
is written into the Razorpay ``notes`` (``plan_tier``) so the webhook can
activate the right quota even when it has to look the row up by customer id.
"""

from __future__ import annotations

import hashlib
import hmac
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional

import requests

RAZORPAY_API = "https://api.razorpay.com/v1"
TIMEOUT = 12
SUBSCRIPTION_CURRENCY = "INR"
SUBSCRIPTION_TOTAL_COUNT = int(os.environ.get("RAZORPAY_TOTAL_COUNT", "120"))

DEFAULT_PLAN = "student"


@dataclass(frozen=True)
class Plan:
    """One sellable tier: price, Razorpay plan id source and monthly quota."""

    id: str
    label: str
    #: Price in whole rupees, for human-facing copy.
    amount_inr: int
    #: Price in paise, Razorpay's unit (also what /api/billing/config returns).
    amount: int
    #: Environment variable holding the Razorpay plan id.
    env_var: str
    #: Analyses a billing period includes on this tier.
    paid_analysis_limit: int


#: The plan registry. Order is the order the checkout page renders.
PLANS: Dict[str, Plan] = {
    "student": Plan(
        id="student",
        label="Pro Student",
        amount_inr=399,
        amount=39900,
        env_var="RAZORPAY_PLAN_ID",
        paid_analysis_limit=100,
    ),
    "coach": Plan(
        id="coach",
        label="Master Coach",
        amount_inr=1999,
        amount=199900,
        env_var="RAZORPAY_COACH_PLAN_ID",
        paid_analysis_limit=500,
    ),
}

PLAN_IDS = tuple(PLANS)

# Backwards compatibility: the original single ₹399 plan is now Pro Student.
SUBSCRIPTION_AMOUNT = PLANS[DEFAULT_PLAN].amount


class BillingError(Exception):
    """Raised when Razorpay is unavailable or returns an invalid response."""


class ResumeNotAllowedError(BillingError):
    """Raised when Razorpay refuses to resume a customer-paused subscription."""


class UnknownPlanError(BillingError):
    """Raised when a caller asks for a tier that is not sold."""


def _config() -> tuple[str, str, str]:
    """(key id, key secret, student plan id) — the original single plan."""
    return (
        os.environ.get("RAZORPAY_KEY_ID", ""),
        os.environ.get("RAZORPAY_KEY_SECRET", ""),
        os.environ.get(PLANS[DEFAULT_PLAN].env_var, ""),
    )


def plan_for(plan_id: str) -> Plan:
    """Look one tier up, rejecting anything that is not sold."""
    plan = PLANS.get(str(plan_id or "").strip().lower())
    if plan is None:
        raise UnknownPlanError(
            f"Unknown plan '{plan_id}'. Choose one of: {', '.join(PLAN_IDS)}."
        )
    return plan


def resolve_plan_id(raw: Optional[str]) -> str:
    """Normalise an API-supplied plan, defaulting to :data:`DEFAULT_PLAN`."""
    text = str(raw or "").strip().lower()
    return plan_for(text or DEFAULT_PLAN).id


def plan_amount(plan_id: str = DEFAULT_PLAN) -> int:
    """The tier's price in paise (Razorpay's unit)."""
    return plan_for(plan_id).amount


def razorpay_plan_id(plan_id: str = DEFAULT_PLAN) -> str:
    """The configured Razorpay plan id for a tier, or ``""``."""
    return os.environ.get(plan_for(plan_id).env_var, "").strip()


def key_id() -> Optional[str]:
    """The public Razorpay key id. Never the secret."""
    return os.environ.get("RAZORPAY_KEY_ID", "").strip() or None


def configured(plan_id: str = DEFAULT_PLAN) -> bool:
    """True when this deployment can sell ``plan_id`` (default: student)."""
    try:
        plan = plan_for(plan_id)
    except UnknownPlanError:
        return False
    public_key, secret, _student_plan = _config()
    return bool(public_key and secret and razorpay_plan_id(plan.id))


def _request(method: str, path: str, **kwargs: Any) -> Dict[str, Any]:
    public_key, secret, _plan_id = _config()
    if not public_key or not secret:
        raise BillingError("Razorpay is not configured on the server.")
    try:
        response = requests.request(
            method,
            f"{RAZORPAY_API}{path}",
            auth=(public_key, secret),
            timeout=TIMEOUT,
            **kwargs,
        )
    except requests.RequestException as exc:
        raise BillingError(f"Could not reach Razorpay: {exc}") from exc
    if not response.ok:
        try:
            detail = response.json().get("error", {}).get("description")
        except ValueError:
            detail = None
        raise BillingError(detail or "Razorpay returned an error.")
    return response.json()


def create_subscription(
    user_id: str,
    email: str | None,
    plan: str = DEFAULT_PLAN,
) -> Dict[str, Any]:
    """Create a Razorpay subscription for ``plan`` (default: student).

    The tier rides along in the Razorpay notes so every webhook can tell which
    quota the payment unlocks.
    """
    selected = plan_for(plan)
    plan_id = razorpay_plan_id(selected.id)
    if not plan_id:
        raise BillingError(f"{selected.env_var} is not configured on the server.")
    return _request(
        "POST",
        "/subscriptions",
        json={
            "plan_id": plan_id,
            "quantity": 1,
            "total_count": SUBSCRIPTION_TOTAL_COUNT,
            "customer_notify": True,
            "notes": {
                "supabase_user_id": user_id,
                "product": "chess-analyzer-pro",
                "plan_tier": selected.id,
                "plan_amount": selected.amount,
                "email": email or "",
            },
        },
    )


def cancel_subscription(subscription_id: str) -> Dict[str, Any]:
    return _request("POST", f"/subscriptions/{subscription_id}/cancel", json={"cancel_at_cycle_end": 1})


def pause_subscription(subscription_id: str) -> Dict[str, Any]:
    try:
        return _request(
            "POST", f"/subscriptions/{subscription_id}/pause", json={"pause_at": "now"}
        )
    except BillingError as exc:
        if "feature is not enabled" in str(exc).lower():
            raise BillingError(
                "Pause/resume is not enabled on the Razorpay account. "
                "Enable it in the dashboard or contact Razorpay support."
            ) from exc
        raise


def resume_subscription(subscription_id: str) -> Dict[str, Any]:
    try:
        return _request(
            "POST", f"/subscriptions/{subscription_id}/resume", json={"resume_at": "now"}
        )
    except BillingError as exc:
        message = str(exc).lower()
        if "cannot be resumed" in message or "paused by your customer" in message:
            raise ResumeNotAllowedError(
                "This subscription was paused from your UPI app. "
                "Resume it from the same UPI app."
            ) from exc
        if "feature is not enabled" in message:
            raise BillingError(
                "Pause/resume is not enabled on the Razorpay account. "
                "Enable it in the dashboard or contact Razorpay support."
            ) from exc
        raise


def list_invoices(subscription_id: str, count: int = 10) -> list[Dict[str, Any]]:
    result = _request(
        "GET",
        "/invoices",
        params={"subscription_id": subscription_id, "count": count},
    )
    return [
        {
            "id": item.get("id"),
            "status": item.get("status"),
            "amount": item.get("amount", 0),
            "currency": item.get("currency", "INR"),
            "paid_at": item.get("paid_at"),
            "short_url": item.get("short_url"),
        }
        for item in result.get("items", [])
    ]


def verify_checkout_signature(
    payment_id: str,
    subscription_id: str,
    signature: str,
) -> bool:
    _key_id, key_secret, _plan_id = _config()
    expected = hmac.new(
        key_secret.encode(),
        f"{payment_id}|{subscription_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    return bool(key_secret) and hmac.compare_digest(expected, signature)


def verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
    webhook_secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
    expected = hmac.new(webhook_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return bool(webhook_secret) and hmac.compare_digest(expected, signature)


def public_config() -> Dict[str, Any]:
    """The client-safe billing config — the key id, never the key secret.

    Returned in the shape of ``BillingConfig`` in ``frontend/lib/api.ts``.
    A tier that has no Razorpay plan id configured reports
    ``configured: false`` so the checkout page can fall back to "contact us"
    instead of opening a broken payment window.
    """
    plans: Dict[str, Dict[str, Any]] = {}
    for plan in PLANS.values():
        plans[plan.id] = {
            "id": plan.id,
            "label": plan.label,
            "amount": plan.amount,
            "amount_inr": plan.amount_inr,
            "plan_id": razorpay_plan_id(plan.id) or None,
            "configured": configured(plan.id),
        }
    return {
        "key_id": key_id(),
        "currency": SUBSCRIPTION_CURRENCY,
        "plans": plans,
    }
