"""Razorpay subscription operations and signature verification."""

from __future__ import annotations

import hashlib
import hmac
import os
from typing import Any, Dict

import requests

RAZORPAY_API = "https://api.razorpay.com/v1"
TIMEOUT = 12
SUBSCRIPTION_AMOUNT = 39900
SUBSCRIPTION_CURRENCY = "INR"
SUBSCRIPTION_TOTAL_COUNT = int(os.environ.get("RAZORPAY_TOTAL_COUNT", "120"))


class BillingError(Exception):
    """Raised when Razorpay is unavailable or returns an invalid response."""


class ResumeNotAllowedError(BillingError):
    """Raised when Razorpay refuses to resume a customer-paused subscription."""


def _config() -> tuple[str, str, str]:
    return (
        os.environ.get("RAZORPAY_KEY_ID", ""),
        os.environ.get("RAZORPAY_KEY_SECRET", ""),
        os.environ.get("RAZORPAY_PLAN_ID", ""),
    )


def configured() -> bool:
    key_id, key_secret, plan_id = _config()
    return bool(key_id and key_secret and plan_id)


def _request(method: str, path: str, **kwargs: Any) -> Dict[str, Any]:
    key_id, key_secret, _plan_id = _config()
    if not key_id or not key_secret:
        raise BillingError("Razorpay is not configured on the server.")
    try:
        response = requests.request(
            method,
            f"{RAZORPAY_API}{path}",
            auth=(key_id, key_secret),
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


def create_subscription(user_id: str, email: str | None) -> Dict[str, Any]:
    _key_id, _key_secret, plan_id = _config()
    if not plan_id:
        raise BillingError("RAZORPAY_PLAN_ID is not configured on the server.")
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
    key_id, _key_secret, plan_id = _config()
    if not key_id or not plan_id:
        raise BillingError("Razorpay is not configured on the server.")
    return {
        "key_id": key_id,
        "plan_id": plan_id,
        "amount": SUBSCRIPTION_AMOUNT,
        "currency": SUBSCRIPTION_CURRENCY,
    }
