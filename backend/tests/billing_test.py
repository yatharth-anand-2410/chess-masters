"""Offline tests for Razorpay signature helpers.

Run from the backend directory:
    ../.venv/bin/python -m tests.billing_test
"""

from __future__ import annotations

import hashlib
import hmac
import os
import sys
import unittest.mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import billing


def test_checkout_signature():
    secret = "checkout-secret"
    payment_id = "pay_test"
    subscription_id = "sub_test"
    signature = hmac.new(
        secret.encode(),
        f"{payment_id}|{subscription_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    old = os.environ.get("RAZORPAY_KEY_SECRET")
    os.environ["RAZORPAY_KEY_SECRET"] = secret
    try:
        assert billing.verify_checkout_signature(payment_id, subscription_id, signature)
        assert not billing.verify_checkout_signature(payment_id, subscription_id, "bad")
    finally:
        if old is None:
            os.environ.pop("RAZORPAY_KEY_SECRET", None)
        else:
            os.environ["RAZORPAY_KEY_SECRET"] = old


def test_webhook_signature():
    secret = "webhook-secret"
    body = b'{"event":"subscription.activated"}'
    signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    old = os.environ.get("RAZORPAY_WEBHOOK_SECRET")
    os.environ["RAZORPAY_WEBHOOK_SECRET"] = secret
    try:
        assert billing.verify_webhook_signature(body, signature)
        assert not billing.verify_webhook_signature(body, "bad")
    finally:
        if old is None:
            os.environ.pop("RAZORPAY_WEBHOOK_SECRET", None)
        else:
            os.environ["RAZORPAY_WEBHOOK_SECRET"] = old


def test_subscription_amount():
    assert billing.SUBSCRIPTION_AMOUNT == 39900
    assert billing.SUBSCRIPTION_CURRENCY == "INR"


def test_pause_and_resume_requests():
    with unittest.mock.patch.object(billing, "_request", return_value={"status": "paused"}) as request:
        billing.pause_subscription("sub_test")
    request.assert_called_once_with(
        "POST", "/subscriptions/sub_test/pause", json={"pause_at": "now"}
    )

    with unittest.mock.patch.object(billing, "_request", return_value={"status": "active"}) as request:
        billing.resume_subscription("sub_test")
    request.assert_called_once_with(
        "POST", "/subscriptions/sub_test/resume", json={"resume_at": "now"}
    )


def test_resume_customer_paused_maps_to_friendly_error():
    with unittest.mock.patch.object(
        billing,
        "_request",
        side_effect=billing.BillingError("This subscription cannot be resumed at this time."),
    ):
        try:
            billing.resume_subscription("sub_test")
        except billing.ResumeNotAllowedError as exc:
            assert "UPI app" in str(exc)
        else:
            raise AssertionError("Expected ResumeNotAllowedError")


def test_pause_feature_disabled_maps_to_friendly_error():
    with unittest.mock.patch.object(
        billing,
        "_request",
        side_effect=billing.BillingError("pause is not allowed, feature is not enabled."),
    ):
        try:
            billing.pause_subscription("sub_test")
        except billing.BillingError as exc:
            assert "not enabled" in str(exc)
        else:
            raise AssertionError("Expected BillingError")


def test_list_invoices_mapping():
    fake_response = {
        "items": [
            {
                "id": "inv_test",
                "status": "paid",
                "amount": 39900,
                "currency": "INR",
                "paid_at": 1773461489,
                "short_url": "https://rzp.io/i/test",
            }
        ]
    }
    with unittest.mock.patch.object(billing, "_request", return_value=fake_response) as request:
        invoices = billing.list_invoices("sub_test")
    request.assert_called_once()
    assert invoices == [
        {
            "id": "inv_test",
            "status": "paid",
            "amount": 39900,
            "currency": "INR",
            "paid_at": 1773461489,
            "short_url": "https://rzp.io/i/test",
        }
    ]


if __name__ == "__main__":
    for name in sorted(globals()):
        if name.startswith("test_"):
            globals()[name]()
            print(f"PASS {name}")
