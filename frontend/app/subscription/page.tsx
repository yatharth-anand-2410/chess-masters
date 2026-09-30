"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AuthButton from "../../components/AuthButton";
import { API_BASE } from "../../lib/api";
import { createClient } from "../../lib/supabase-client";
import type { User } from "@supabase/supabase-js";

type SubscriptionRecord = {
  razorpay_subscription_id: string;
  status: string;
  current_end: string | null;
};

type BillingStatus = {
  plan: "free" | "paid";
  status: string;
  current_period_end: string | null;
  subscription: SubscriptionRecord | null;
};

type Invoice = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  paid_at: number | string | null;
  short_url: string | null;
};

type RazorpayCheckout = {
  open: () => void;
};

type RazorpayConstructor = new (options: {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  prefill: { email?: string };
  theme: { color: string };
  subscription_card_change?: boolean;
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_subscription_id: string;
    razorpay_signature: string;
  }) => void;
  modal: { ondismiss: () => void };
}) => RazorpayCheckout;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = RAZORPAY_SCRIPT;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load the payment window."));
    document.body.appendChild(script);
  });
}

function formatDate(value: string | number | null): string {
  if (!value) return "";
  const date =
    typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

function statusLabel(status: string): string {
  switch (status) {
    case "active":
    case "authenticated":
      return "Active";
    case "paused":
      return "Paused";
    case "pending":
      return "Payment retrying";
    case "halted":
      return "Payment failed";
    case "cancelled":
      return "Cancelled";
    case "completed":
      return "Completed";
    case "created":
      return "Awaiting authorization";
    case "inactive":
      return "Free plan";
    default:
      return status;
  }
}

export default function SubscriptionPage() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async (accessToken: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/billing/status`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (response.ok) setBilling(await response.json());
    } catch {
      // Checkout actions surface a clearer error when the API is unavailable.
    }
    try {
      const response = await fetch(`${API_BASE}/api/billing/invoices`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (response.ok) setInvoices(await response.json());
    } catch {
      // Invoices are supplementary; ignore failures here.
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      setUser(data.session.user);
      setToken(data.session.access_token);
      setEmail(data.session.user.email ?? "");
      refresh(data.session.access_token);
    });
  }, [refresh]);

  const openCheckout = async (existingId: string | null) => {
    let keyId: string;
    let subscriptionId: string;

    if (existingId) {
      const configResponse = await fetch(`${API_BASE}/api/billing/config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const configBody = await configResponse.json();
      if (!configResponse.ok) {
        throw new Error(configBody.detail ?? "Could not open the payment window.");
      }
      keyId = configBody.key_id;
      subscriptionId = existingId;
    } else {
      const subscriptionResponse = await fetch(`${API_BASE}/api/billing/subscription`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const subscriptionBody = await subscriptionResponse.json();
      if (!subscriptionResponse.ok) {
        throw new Error(subscriptionBody.detail ?? "Could not start checkout.");
      }
      keyId = subscriptionBody.key_id;
      subscriptionId = subscriptionBody.subscription_id;
    }

    await loadRazorpay();
    if (!window.Razorpay) throw new Error("The payment window is unavailable.");
    const checkout = new window.Razorpay({
      key: keyId,
      subscription_id: subscriptionId,
      name: "Chessmasters",
      description: "Monthly chess coaching plan",
      prefill: { email },
      theme: { color: "#c9993f" },
      subscription_card_change: Boolean(existingId),
      handler: async (response) => {
        try {
          const verifyResponse = await fetch(`${API_BASE}/api/billing/verify`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(response),
          });
          const verifyBody = await verifyResponse.json();
          if (!verifyResponse.ok) {
            throw new Error(verifyBody.detail ?? "Payment verification failed.");
          }
          setMessage("Payment authorized. Your paid plan is active.");
          await refresh(token);
        } catch (verifyError) {
          setError(
            verifyError instanceof Error ? verifyError.message : "Payment verification failed."
          );
        } finally {
          setBusy(false);
        }
      },
      modal: { ondismiss: () => setBusy(false) },
    });
    checkout.open();
  };

  const startCheckout = async () => {
    if (!token) {
      setError("Please sign in before subscribing.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const currentStatus = billing?.status ?? "";
      const existingId =
        currentStatus === "pending" || currentStatus === "halted"
          ? billing?.subscription?.razorpay_subscription_id ?? null
          : null;
      await openCheckout(existingId);
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error ? checkoutError.message : "Could not start checkout."
      );
      setBusy(false);
    }
  };

  const runBillingAction = async (action: "pause" | "resume" | "cancel") => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${API_BASE}/api/billing/${action}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.detail ?? "Could not update your subscription.");
      }
      const messages = {
        pause: "Your subscription is paused. You keep access until the current period ends.",
        resume: "Welcome back! Your subscription is active again.",
        cancel: "Your subscription will end at the close of the current billing period.",
      } as const;
      setMessage(messages[action]);
      await refresh(token);
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Could not update your subscription."
      );
    } finally {
      setBusy(false);
    }
  };

  const status = billing?.status ?? "";
  const isActive = status === "active" || status === "authenticated";
  const isPaused = status === "paused";
  const isCancelled = status === "cancelled";
  const stillPaid = billing?.plan === "paid";
  const needsPaymentFix = status === "pending" || status === "halted";

  return (
    <main className="dashboard">
      <header className="topbar">
        <Link href="/" className="wordmark">
          <span className="wordmark-glyph" aria-hidden="true">
            ♜
          </span>
          Chessmasters
        </Link>
        <div className="topbar-actions">
          <Link href="/" className="nav-link">
            Analyze
          </Link>
          <Link href="/history" className="nav-link">
            History
          </Link>
          <AuthButton user={user} onAuthChange={() => setUser(null)} />
        </div>
      </header>

      <div className="upgrade-prompt upgrade-hero">
        <h1>
          {isActive || isPaused || isCancelled ? "Your subscription" : "Unlock more coaching"}
        </h1>

        {billing && (
          <p className="plan-status">
            <span className={`plan-pill plan-${stillPaid ? "paid" : "free"}`}>
              {statusLabel(status)}
            </span>
          </p>
        )}

        <p className="upgrade-price">
          ₹399 <span>/ month</span>
        </p>
        <p>Pay securely by card or UPI AutoPay. Cancel anytime.</p>
        <ul>
          <li>100 game analyses per month</li>
          <li>Q&amp;A with your chess coach</li>
          <li>Additional coaching features</li>
        </ul>

        <div className="subscription-cta">
          {!billing || (!isActive && !isPaused && !isCancelled && !needsPaymentFix) ? (
            <button className="btn" type="button" onClick={startCheckout} disabled={busy || !token}>
              {busy ? "Opening checkout..." : "Subscribe"}
            </button>
          ) : null}

          {isCancelled && (
            <>
              <p className="billing-meta">
                Cancelled
                {billing?.current_period_end
                  ? ` — access until ${formatDate(billing.current_period_end)}`
                  : ""}
                .
              </p>
              <button className="btn" type="button" onClick={startCheckout} disabled={busy || !token}>
                {busy ? "Opening checkout..." : "Resubscribe"}
              </button>
            </>
          )}

          {isPaused && (
            <>
              <p className="billing-meta">
                Paused
                {billing?.current_period_end
                  ? ` — access until ${formatDate(billing.current_period_end)}`
                  : ""}
                .
              </p>
              <button
                className="btn"
                type="button"
                onClick={() => runBillingAction("resume")}
                disabled={busy}
              >
                {busy ? "Updating..." : "Resume subscription"}
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => runBillingAction("cancel")}
                disabled={busy}
              >
                Cancel instead
              </button>
            </>
          )}

          {needsPaymentFix && (
            <>
              <p className="billing-message">
                Your last payment did not go through. Update your card to keep your plan.
              </p>
              <button className="btn" type="button" onClick={startCheckout} disabled={busy}>
                {busy ? "Opening checkout..." : "Update payment method"}
              </button>
            </>
          )}

          {isActive && (
            <>
              {billing?.current_period_end && (
                <p className="billing-meta">
                  Current period ends {formatDate(billing.current_period_end)}.
                </p>
              )}
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => runBillingAction("pause")}
                disabled={busy}
              >
                {busy ? "Updating..." : "Pause subscription"}
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => runBillingAction("cancel")}
                disabled={busy}
              >
                Cancel at period end
              </button>
            </>
          )}

          {message && <p className="billing-message">{message}</p>}
          {error && <div className="error-banner">{error}</div>}
        </div>

        {invoices.length > 0 && (
          <div className="invoice-block">
            <h2>Invoices</h2>
            <ul className="invoice-list">
              {invoices.map((invoice) => (
                <li key={invoice.id} className="invoice-row">
                  <span>{formatDate(invoice.paid_at)}</span>
                  <span>{formatAmount(invoice.amount, invoice.currency)}</span>
                  <span className="invoice-status">{invoice.status}</span>
                  {invoice.short_url && (
                    <a href={invoice.short_url} target="_blank" rel="noreferrer">
                      View
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}
