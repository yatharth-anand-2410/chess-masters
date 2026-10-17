"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Topbar, GoogleIcon } from "../../components/ui/Topbar";
import { Pill } from "../../components/ui/Pill";
import { API_BASE } from "../../lib/api";
import { createClient } from "../../lib/supabase-client";
import type { User } from "@supabase/supabase-js";

/* ---------------------------------------------------------------------------
 * Billing surface for this workstream. `lib/api.ts` belongs to another
 * workstream, so the shapes consumed here are declared locally and stay
 * tolerant of older payloads (missing `plan_tier`, flat billing config).
 * ------------------------------------------------------------------------ */

type PlanId = "student" | "coach";
type PlanTier = "free" | PlanId;

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

type UsageSummary = {
  plan: "free" | "paid";
  /** "free" | "student" (Pro Student) | "coach" (Master Coach). */
  plan_tier?: PlanTier;
  current_period_end?: string | null;
};

type PlanConfig = {
  id?: string;
  label?: string;
  amount?: number;
  plan_id?: string | null;
  configured?: boolean;
};

type BillingConfig = {
  key_id?: string | null;
  currency?: string;
  plans?: {
    student?: PlanConfig;
    coach?: PlanConfig;
  };
};

type Invoice = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  paid_at: number | string | null;
  short_url: string | null;
};

type PlanFeature = {
  /** Bold lead word(s), e.g. **100** AI coaching reports per billing period. */
  lead?: string;
  text?: string;
};

type PlanCard = {
  id: PlanId;
  name: string;
  blurb: string;
  fallbackPrice: string;
  features: PlanFeature[];
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
const COACH_CONTACT_EMAIL = "info@chessmasterss.in";
const COACH_CONTACT_HREF = `mailto:${COACH_CONTACT_EMAIL}?subject=${encodeURIComponent(
  "Master Coach tier upgrade"
)}`;

/** Billing states where the stored subscription id must be reused, not re-created. */
const REUSE_SUBSCRIPTION_STATUSES = new Set(["created", "pending", "halted"]);

const TIER_NAME: Record<PlanId, string> = {
  student: "Pro Student Plan",
  coach: "Master Coach Plan",
};

const PLAN_CARDS: PlanCard[] = [
  {
    id: "student",
    name: "Pro Student",
    blurb: "For serious club players (800-2200 Elo).",
    fallbackPrice: "₹399",
    features: [
      { lead: "100", text: "AI coaching reports per billing period" },
      { lead: "Student Progress & Leaks", text: "(3-Pillar)" },
      { lead: "Full 6-Dimension Psychology", text: "Panel" },
      { lead: "Interactive Replay Drills" },
      { lead: "Opponent Scouting", text: "Dossiers" },
    ],
  },
  {
    id: "coach",
    name: "Master Coach",
    blurb: "For FIDE trainers & academy coaches.",
    fallbackPrice: "₹1,999",
    features: [
      { text: "Everything in Pro Student" },
      { lead: "Up to 25 linked student", text: "accounts" },
      { text: "Automated student blunder homework" },
      { text: "Lichess study chapter ingestion" },
      { text: "Priority 24/7 coaching support" },
    ],
  },
];

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

function formatDate(value: string | number | null | undefined): string {
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

/** Razorpay amounts arrive in paise; the showcase prints them without decimals. */
function formatPrice(amount: number): string {
  return `₹${(amount / 100).toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  })}`;
}

function errorDetail(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail) return detail;
  }
  return fallback;
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

/** `usage.plan_tier` is the source of truth; `usage.plan` backfills older payloads. */
function resolveTier(
  usage: UsageSummary | null,
  billing: BillingStatus | null
): PlanTier {
  if (usage?.plan_tier) return usage.plan_tier;
  if (usage) return usage.plan === "paid" ? "student" : "free";
  if (billing?.plan === "paid") return "student";
  return "free";
}

export default function SubscriptionPage() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [signInBusy, setSignInBusy] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<PlanId | null>(null);
  const [managing, setManaging] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async (accessToken: string) => {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const [statusResult, usageResult, invoiceResult] = await Promise.allSettled([
      fetch(`${API_BASE}/api/billing/status`, { headers }),
      fetch(`${API_BASE}/api/account/usage`, { headers }),
      fetch(`${API_BASE}/api/billing/invoices`, { headers }),
    ]);

    if (statusResult.status === "fulfilled" && statusResult.value.ok) {
      setBilling((await statusResult.value.json()) as BillingStatus);
    }
    if (usageResult.status === "fulfilled" && usageResult.value.ok) {
      setUsage((await usageResult.value.json()) as UsageSummary);
    }
    if (invoiceResult.status === "fulfilled" && invoiceResult.value.ok) {
      setInvoices((await invoiceResult.value.json()) as Invoice[]);
    }
  }, []);

  const loadConfig = useCallback(async (accessToken: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/billing/config`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (response.ok) setConfig((await response.json()) as BillingConfig);
    } catch {
      // The coach-tier "contact us" fallback stays in place when the config is unreachable.
    }
  }, []);

  const hydrateSession = useCallback(
    (accessToken: string, sessionUser: User | null) => {
      if (!accessToken) {
        setUser(null);
        setToken("");
        setBilling(null);
        setUsage(null);
        return;
      }
      setUser(sessionUser);
      setToken(accessToken);
      setEmail(sessionUser?.email ?? "");
      refresh(accessToken);
      loadConfig(accessToken);
    },
    [refresh, loadConfig]
  );

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      hydrateSession(data.session.access_token, data.session.user);
    });
  }, [hydrateSession]);

  const handleAuthChange = useCallback(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      hydrateSession(data.session?.access_token ?? "", data.session?.user ?? null);
    });
  }, [hydrateSession]);

  /** A signed-out visitor has decided to pay — this button must be live. */
  const handleGoogleSignIn = useCallback(async () => {
    setSignInBusy(true);
    try {
      const supabase = createClient();
      const origin = window.location.origin;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/subscription")}`,
        },
      });
      if (error) {
        setError(error.message);
      }
    } catch (signInError) {
      setError(
        signInError instanceof Error
          ? signInError.message
          : "Could not start Google sign-in."
      );
    } finally {
      setSignInBusy(false);
    }
  }, []);

  const openCheckout = async (plan: PlanId, existingId: string | null) => {
    let keyId: string | null;
    let subscriptionId: string;

    if (existingId) {
      const configResponse = await fetch(`${API_BASE}/api/billing/config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const configBody: unknown = await configResponse.json();
      if (!configResponse.ok) {
        throw new Error(errorDetail(configBody, "Could not open the payment window."));
      }
      keyId = (configBody as BillingConfig).key_id ?? null;
      subscriptionId = existingId;
    } else {
      const subscriptionResponse = await fetch(`${API_BASE}/api/billing/subscription`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ plan }),
      });
      const subscriptionBody: unknown = await subscriptionResponse.json();
      if (!subscriptionResponse.ok) {
        throw new Error(errorDetail(subscriptionBody, "Could not start checkout."));
      }
      const session = subscriptionBody as { key_id?: string | null; subscription_id?: string };
      keyId = session.key_id ?? null;
      subscriptionId = session.subscription_id ?? "";
    }

    if (!keyId) {
      throw new Error(
        `Razorpay is not configured on the server. Email ${COACH_CONTACT_EMAIL} to subscribe.`
      );
    }
    if (!subscriptionId) throw new Error("Could not start checkout.");

    await loadRazorpay();
    if (!window.Razorpay) throw new Error("The payment window is unavailable.");
    const checkout = new window.Razorpay({
      key: keyId,
      subscription_id: subscriptionId,
      name: "Chessmasters",
      description: `${PLAN_CARDS.find((card) => card.id === plan)?.name ?? "Chessmasters"} — monthly chess coaching`,
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
          const verifyBody: unknown = await verifyResponse.json();
          if (!verifyResponse.ok) {
            throw new Error(errorDetail(verifyBody, "Payment verification failed."));
          }
          setMessage("Payment authorized. Your plan is active.");
          await refresh(token);
        } catch (verifyError) {
          setError(
            verifyError instanceof Error ? verifyError.message : "Payment verification failed."
          );
        } finally {
          setBusy(false);
          setPendingPlan(null);
        }
      },
      modal: {
        ondismiss: () => {
          setBusy(false);
          setPendingPlan(null);
        },
      },
    });
    checkout.open();
  };

  const startCheckout = async (plan: PlanId) => {
    if (!token) {
      setError("Please sign in before subscribing.");
      return;
    }
    setBusy(true);
    setPendingPlan(plan);
    setError("");
    setMessage("");
    try {
      const currentStatus = billing?.status ?? "";
      const existingId = REUSE_SUBSCRIPTION_STATUSES.has(currentStatus)
        ? billing?.subscription?.razorpay_subscription_id ?? null
        : null;
      await openCheckout(plan, existingId);
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error ? checkoutError.message : "Could not start checkout."
      );
      setBusy(false);
      setPendingPlan(null);
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
      const body: unknown = await response.json();
      if (!response.ok) {
        throw new Error(errorDetail(body, "Could not update your subscription."));
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
  const needsPaymentFix = status === "pending" || status === "halted";
  const awaitingAuthorization = status === "created";
  const stillPaid = billing?.plan === "paid";

  const activeTier: PlanTier = resolveTier(usage, billing);
  const coachConfigured = config?.plans?.coach?.configured === true;
  const periodEnd = usage?.current_period_end ?? billing?.current_period_end ?? null;
  const periodEndLabel = formatDate(periodEnd);
  // Recovery states (paused, cancelled, failed payment) keep their controls on screen.
  const autoActionsRequired = isPaused || isCancelled || needsPaymentFix || awaitingAuthorization;
  const managePanelOpen = managing || autoActionsRequired;
  const currentPlanForCheckout: PlanId = activeTier === "coach" ? "coach" : "student";

  const priceFor = (card: PlanCard): string => {
    const amount = config?.plans?.[card.id]?.amount;
    return typeof amount === "number" && Number.isFinite(amount) && amount > 0
      ? formatPrice(amount)
      : card.fallbackPrice;
  };

  const renderPlanAction = (card: PlanCard, active: boolean): ReactNode => {
    if (active) {
      return (
        <button
          className="btn subscription-plan-btn"
          type="button"
          data-state="active"
          disabled
        >
          Renewed via Razorpay ✓
        </button>
      );
    }

    if (!token) {
      return (
        <>
          <button
            className="btn subscription-plan-btn"
            type="button"
            onClick={handleGoogleSignIn}
            disabled={signInBusy}
          >
            <GoogleIcon className="w-3.5 h-3.5 shrink-0" />
            {signInBusy ? "Connecting to Google..." : "Continue with Google to subscribe"}
          </button>
          <p className="subscription-plan-helper">
            14-day money-back guarantee · Secure checkout via Razorpay · Cancel anytime
          </p>
        </>
      );
    }

    if (card.id === "coach" && !coachConfigured) {
      return (
        <>
          <a className="btn btn-ghost subscription-plan-btn" href={COACH_CONTACT_HREF}>
            Contact us to upgrade
          </a>
          <p className="subscription-plan-helper">
            Coach tier checkout is not live yet — email {COACH_CONTACT_EMAIL} and we will set it up
            with you.
          </p>
        </>
      );
    }

    if (card.id === "student" && activeTier === "coach") {
      return (
        <button className="btn btn-ghost subscription-plan-btn" type="button" disabled>
          Included in Master Coach
        </button>
      );
    }

    return (
      <>
        <button
          className={`btn subscription-plan-btn ${card.id === "coach" ? "btn-ghost" : ""}`.trim()}
          type="button"
          onClick={() => startCheckout(card.id)}
          disabled={busy}
        >
          {pendingPlan === card.id
            ? "Opening checkout..."
            : card.id === "coach"
              ? "Upgrade to Coach Tier"
              : `Subscribe for ${priceFor(card)} / mo`}
        </button>
        {card.id === "student" && (
          <p className="subscription-plan-helper">
            14-day money-back guarantee · Secure checkout via Razorpay · Cancel anytime
          </p>
        )}
      </>
    );
  };

  const renderPlanCard = (card: PlanCard) => {
    const active = activeTier === card.id;
    // Pro Student is the featured tier; an active Master Coach mirrors the treatment.
    const featured = card.id === "student" || activeTier === "coach";
    const price = priceFor(card);

    return (
      <article
        key={card.id}
        className="subscription-plan-card"
        data-featured={featured ? "true" : "false"}
      >
        {active ? (
          <span className="subscription-plan-badge">Active Plan</span>
        ) : featured ? (
          <span className="subscription-plan-badge">Recommended</span>
        ) : null}

        <header className="subscription-plan-head">
          <h2 className="subscription-plan-name">{card.name}</h2>
          <p className="subscription-plan-blurb">{card.blurb}</p>
        </header>

        <div className="subscription-plan-price">
          {price}
          <span>/ mo</span>
        </div>

        <ul className="subscription-plan-features">
          {card.features.map((feature, index) => (
            <li key={`${card.id}-feature-${index}`}>
              <span className="subscription-plan-check" aria-hidden="true">
                ✓
              </span>
              <span>
                {feature.lead && <b>{feature.lead}</b>}
                {feature.lead && feature.text ? " " : ""}
                {feature.text}
              </span>
            </li>
          ))}
        </ul>

        <div className="subscription-plan-action">{renderPlanAction(card, active)}</div>
      </article>
    );
  };

  return (
    <main className="dashboard">
      <Topbar user={user} onAuthChange={handleAuthChange} />

      <header className="subscription-hero">
        <Pill tone="shell">Account &amp; Plans</Pill>
        <h1 className="subscription-title">Subscription &amp; Plan Management</h1>
        <p className="subscription-subtitle">
          Transparent chess improvement pricing. Powered by Razorpay with a 14-day money-back
          guarantee.
        </p>

        {activeTier !== "free" && (
          <div className="subscription-status-bar">
            <span className="subscription-status-text">
              Active Status: <b>{TIER_NAME[activeTier]}</b>
            </span>
            {periodEndLabel && (
              <span className="subscription-pill-green">
                {isCancelled || isPaused ? "Access until" : "Renews"} {periodEndLabel}
              </span>
            )}
            {!autoActionsRequired && (
              <button
                className="subscription-manage-trigger"
                type="button"
                onClick={() => setManaging((open) => !open)}
                aria-expanded={managePanelOpen}
              >
                {managing ? "Hide billing controls" : "Manage / Cancel"}
              </button>
            )}
          </div>
        )}
      </header>

      <div className="subscription-notices" role="status" aria-live="polite">
        {message && <p className="subscription-notice subscription-notice-ok">{message}</p>}
        {error && <div className="error-banner subscription-notice">{error}</div>}
      </div>

      {managePanelOpen && (
        <section className="subscription-manage-panel" aria-label="Billing controls">
          <div className="subscription-manage-head">
            <span className="subscription-manage-title">Billing controls</span>
            {billing && (
              <Pill tone={stillPaid ? "shell" : "neutral"} size="sm">
                {statusLabel(status)}
              </Pill>
            )}
          </div>

          {isActive && periodEndLabel && (
            <p className="subscription-manage-meta">
              Current period ends {periodEndLabel}. Pause or cancel and you keep access until then.
            </p>
          )}
          {isPaused && (
            <p className="subscription-manage-meta">
              Paused
              {periodEndLabel ? ` — access until ${periodEndLabel}` : ""}
              . Resume to keep your coaching history on this plan.
            </p>
          )}
          {isCancelled && (
            <p className="subscription-manage-meta">
              Cancelled
              {periodEndLabel ? ` — access until ${periodEndLabel}` : ""}
              . You can resubscribe at any time.
            </p>
          )}
          {needsPaymentFix && (
            <p className="subscription-manage-meta">
              Your last payment did not go through. Update your card to keep your plan.
            </p>
          )}
          {awaitingAuthorization && (
            <p className="subscription-manage-meta">
              This subscription is waiting for an authorization from your bank. Complete the
              mandate to activate it.
            </p>
          )}

          <div className="subscription-manage-actions">
            {isActive && (
              <>
                <button
                  className="btn btn-sm btn-ghost"
                  type="button"
                  onClick={() => runBillingAction("pause")}
                  disabled={busy}
                >
                  {busy ? "Updating..." : "Pause subscription"}
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  type="button"
                  onClick={() => runBillingAction("cancel")}
                  disabled={busy}
                >
                  Cancel at period end
                </button>
              </>
            )}

            {isPaused && (
              <>
                <button
                  className="btn btn-sm"
                  type="button"
                  onClick={() => runBillingAction("resume")}
                  disabled={busy}
                >
                  {busy ? "Updating..." : "Resume subscription"}
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  type="button"
                  onClick={() => runBillingAction("cancel")}
                  disabled={busy}
                >
                  Cancel instead
                </button>
              </>
            )}

            {isCancelled && (
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => startCheckout(currentPlanForCheckout)}
                disabled={busy || !token}
              >
                {pendingPlan ? "Opening checkout..." : "Resubscribe"}
              </button>
            )}

            {(needsPaymentFix || awaitingAuthorization) && (
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => startCheckout(currentPlanForCheckout)}
                disabled={busy || !token}
              >
                {pendingPlan
                  ? "Opening checkout..."
                  : awaitingAuthorization
                    ? "Complete authorization"
                    : "Update payment method"}
              </button>
            )}
          </div>
        </section>
      )}

      <section className="subscription-pricing-grid" aria-label="Available plans">
        {PLAN_CARDS.map(renderPlanCard)}
      </section>

      {invoices.length > 0 && (
        <section className="subscription-invoices">
          <h2>Invoices</h2>
          <ul className="subscription-invoice-list">
            {invoices.map((invoice) => (
              <li key={invoice.id} className="subscription-invoice-row">
                <span className="subscription-invoice-date">{formatDate(invoice.paid_at)}</span>
                <span className="subscription-invoice-amount">
                  {formatAmount(invoice.amount, invoice.currency)}
                </span>
                <span className="subscription-invoice-status">{invoice.status}</span>
                {invoice.short_url && (
                  <a href={invoice.short_url} target="_blank" rel="noreferrer">
                    View
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
