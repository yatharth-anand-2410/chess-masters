"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  apiGet,
  apiPut,
  type Usage,
  type UserProfile,
  type UserRole,
} from "../lib/api";
import { createClient } from "../lib/supabase-client";
import { Topbar } from "./ui/Topbar";
import { Pill } from "./ui/Pill";
import {
  Crown,
  Users,
  BarChart3,
  Share2,
  Sparkles,
  ArrowRight,
  Eye,
  ShieldCheck,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";

type CoachGateProps = {
  children: React.ReactNode;
};

/**
 * Guards the /coach area for signed-in users.
 *
 * - No session: back to the analyzer (same contract as /history).
 * - No role chosen yet: one-tap onboarding.
 * - Role is "player": an explicit opt-in card, because the role is a default
 *   experience rather than a locked door — players become coaches all the time.
 * - Role is "coach" with inactive subscription: Coach Pro upgrade gate with
 *   features breakdown, direct subscribe button, and demo preview exploration.
 */
export default function CoachGate({ children }: CoachGateProps) {
  const router = useRouter();
  const [role, setRole] = useState<UserRole | null | "loading">("loading");
  const [user, setUser] = useState<User | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [isPaid, setIsPaid] = useState<boolean>(false);
  const [previewUnlocked, setPreviewUnlocked] = useState<boolean>(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session;
      const activeUser = session?.user ?? null;
      setUser(activeUser);

      if (!activeUser || !session) {
        router.replace("/");
        return;
      }

      if (session) {
        setToken(session.access_token);
        try {
          const [profile, usageData] = await Promise.all([
            apiGet<UserProfile>("/api/account/profile", session.access_token),
            apiGet<Usage>("/api/account/usage", session.access_token).catch(() => null),
          ]);

          if (profile.role === null) {
            router.replace("/onboarding");
            return;
          }
          setRole(profile.role);
          if (usageData) {
            setUsage(usageData);
            setIsPaid(usageData.plan === "paid");
          }
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Could not load your account."
          );
        }
      }
    });
  }, [router]);

  const enableCoachMode = useCallback(async () => {
    if (!token) {
      return;
    }
    setEnabling(true);
    setError("");
    try {
      await apiPut<UserProfile>("/api/account/profile", token, {
        role: "coach",
      });
      setRole("coach");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not enable coach mode."
      );
      setEnabling(false);
    }
  }, [token]);

  const switchToPlayer = useCallback(async () => {
    if (!token) return;
    try {
      await apiPut("/api/account/profile", token, { role: "player" });
      router.push("/");
    } catch {
      router.push("/");
    }
  }, [router, token]);

  if (error) {
    return (
      <main className="dashboard">
        <Topbar user={user} onAuthChange={() => router.push("/")} />
        <div className="max-w-xl mx-auto mt-8 px-4">
          <div className="error-banner">{error}</div>
          <Link href="/" className="btn btn-ghost mt-4">
            Back to the analyzer
          </Link>
        </div>
      </main>
    );
  }

  if (role === "loading") {
    return (
      <main className="dashboard">
        <Topbar user={user} onAuthChange={() => router.push("/")} />
        <div className="max-w-xl mx-auto mt-16 text-center">
          <p className="history-empty">Loading coach mode...</p>
        </div>
      </main>
    );
  }

  if (role === "player") {
    return (
      <main className="dashboard">
        <Topbar
          user={user}
          usage={usage}
          role={role}
          onAuthChange={() => router.push("/")}
          onToggleRole={enableCoachMode}
        />
        <div className="coach-gate">
          <h1 className="coach-gate-title">Coach mode is off for this account</h1>
          <p className="coach-gate-lede">
            Coach mode gives you a roster of student profiles, lets you analyze
            their games, and creates read-only progress links you can share with students and parents.
          </p>
          <button
            type="button"
            className="btn"
            onClick={enableCoachMode}
            disabled={enabling}
          >
            {enabling ? "Enabling..." : "Enable coach mode"}
          </button>
        </div>
      </main>
    );
  }

  // Active coach, but subscription is not active and demo preview has not been opened yet
  if (!isPaid && !previewUnlocked) {
    return (
      <main className="dashboard">
        <Topbar
          user={user}
          usage={usage}
          role={role}
          onAuthChange={() => router.push("/")}
          onToggleRole={switchToPlayer}
        />
        <div className="max-w-3xl mx-auto mt-6 px-4 pb-16">
          {/* Hero Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 mb-3">
              <Pill tone="shell" size="md" icon={<Crown size={13} className="text-[var(--gold-bright)]" />}>
                Coach Pro Tier Required
              </Pill>
            </div>
            <h1 className="font-serif text-3xl md:text-4xl font-bold tracking-tight text-[var(--text)] mb-3">
              Upgrade to Coach Pro
            </h1>
            <p className="text-base text-[var(--text-muted)] max-w-xl mx-auto leading-relaxed">
              Track student rosters, run 5-game batch audits, diagnose recurring tactical leaks, and share live progress portals with parents and students.
            </p>
          </div>

          {/* Plan & Pricing Highlight Card */}
          <div className="rounded-2xl bg-[var(--ink-2)] border border-[rgba(201,153,63,0.35)] shadow-xl p-6 md:p-8 mb-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-[rgba(201,153,63,0.15)] to-transparent pointer-events-none rounded-full blur-2xl" />

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-[var(--line-soft)]">
              <div>
                <div className="text-xs font-mono uppercase tracking-wider text-[var(--gold-bright)] font-semibold mb-1">
                  Coach Pro Membership
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-[var(--text)]">₹399</span>
                  <span className="text-sm text-[var(--text-muted)]">/ month</span>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Includes 100 game analyses/month · Unlimited student rosters · Cancel anytime
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <Link
                  href="/subscription"
                  className="btn inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-gradient-to-r from-[#c9993f] to-[#e2b65f] text-[#141712] font-bold shadow-lg hover:shadow-xl transition-all"
                >
                  <Crown size={16} />
                  <span>Upgrade to Coach Pro</span>
                  <ArrowRight size={15} />
                </Link>
                <button
                  type="button"
                  onClick={() => setPreviewUnlocked(true)}
                  className="btn btn-ghost inline-flex items-center justify-center gap-2 text-xs text-[var(--text-muted)] hover:text-[var(--text)] border border-[var(--line)] hover:border-[var(--line-strong)]"
                >
                  <Eye size={14} />
                  <span>Explore Demo Roster</span>
                </button>
              </div>
            </div>

            {/* Feature Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-6">
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-[var(--ink-3)]/60 border border-[var(--line-soft)]">
                <div className="w-8 h-8 rounded-lg bg-[rgba(201,153,63,0.15)] border border-[rgba(201,153,63,0.3)] flex items-center justify-center text-[var(--gold-bright)] shrink-0">
                  <Users size={16} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-[var(--text)]">Student Roster Management</div>
                  <div className="text-xs text-[var(--text-muted)] mt-0.5">
                    Link student Chess.com &amp; Lichess handles with private coaching notes and game archives.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-[var(--ink-3)]/60 border border-[var(--line-soft)]">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                  <BarChart3 size={16} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-[var(--text)]">5-Game Batch Audits</div>
                  <div className="text-xs text-[var(--text-muted)] mt-0.5">
                    Simultaneously scan multiple games on behalf of students to catch recurring tactical blindspots.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-[var(--ink-3)]/60 border border-[var(--line-soft)]">
                <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                  <Share2 size={16} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-[var(--text)]">Branded Shareable Portals</div>
                  <div className="text-xs text-[var(--text-muted)] mt-0.5">
                    Generate one-click read-only links for parents &amp; students with interactive eval curves.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-[var(--ink-3)]/60 border border-[var(--line-soft)]">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                  <Sparkles size={16} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-[var(--text)]">AI Coach Copilot &amp; Psychology</div>
                  <div className="text-xs text-[var(--text-muted)] mt-0.5">
                    Longitudinal rating trajectory, ACPL drift, clock panic curves, and AI coach Q&amp;A.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Trust badge */}
          <div className="flex items-center justify-center gap-6 text-xs text-[var(--text-muted)]">
            <div className="flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-emerald-400" />
              <span>Secure payments via Razorpay</span>
            </div>
            <span>·</span>
            <div>UPI AutoPay &amp; Cards accepted</div>
            <span>·</span>
            <div>Cancel anytime with 1 click</div>
          </div>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
