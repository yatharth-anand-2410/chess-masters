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

type CoachTier = "free" | "student" | "coach";

/**
 * The roster is a Coach-tier surface: a Student subscription (which only covers
 * the subscriber's own games) never unlocks it.
 */
function coachTierOf(usage: Usage | null): CoachTier {
  if (!usage) {
    return "free";
  }
  if (usage.plan_tier) {
    return usage.plan_tier;
  }
  // Older usage payloads have no plan_tier yet: any active paid plan was coach.
  return usage.plan === "paid" ? "coach" : "free";
}

/**
 * Guards the /coach area for signed-in users.
 *
 * - No session: back to the analyzer (same contract as /history).
 * - No role chosen yet: one-tap onboarding.
 * - Role is "player": an explicit opt-in card, because the role is a default
 *   experience rather than a locked door — players become coaches all the time.
 * - Coach without the Master Coach tier: paywall with the ₹1,999 plan, a direct
 *   link to /subscription, and an "Explore Demo Roster" preview path.
 */
export default function CoachGate({ children }: CoachGateProps) {
  const router = useRouter();
  const [role, setRole] = useState<UserRole | null | "loading">("loading");
  const [user, setUser] = useState<User | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
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

  const tier = coachTierOf(usage);

  // Active coach without the Master Coach tier and without the demo preview.
  if (tier !== "coach" && !previewUnlocked) {
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
          <div className="students-gate-hero">
            <div className="inline-flex items-center gap-2 mb-3">
              <Pill
                tone="shell"
                size="md"
                icon={<Crown size={13} className="text-[var(--gold-bright)]" />}
              >
                Master Coach tier required
              </Pill>
            </div>
            <h1 className="students-gate-title">Upgrade to Coach Tier</h1>
            <p className="students-gate-lede">
              Track student rosters, run 5-game batch audits, diagnose recurring
              tactical leaks, and share live progress portals with parents and
              students.
            </p>
            {tier === "student" && (
              <p className="students-gate-lede mt-3">
                Your Student plan covers your own games — the roster, dossiers
                and share links belong to the Master Coach tier.
              </p>
            )}
          </div>

          <section className="students-gate-card">
            <div className="students-gate-plan">
              <div>
                <div className="students-gate-eyebrow">
                  Master Coach membership
                </div>
                <div className="students-gate-price">
                  <strong>₹1,999</strong>
                  <span>/ month</span>
                </div>
                <p className="students-gate-price-note">
                  Games analyzed on behalf of every student · unlimited roster ·
                  branded share links · cancel anytime
                </p>
              </div>

              <div className="students-gate-cta">
                <Link
                  href="/subscription"
                  className="students-btn-gold py-2.5 px-4 text-sm"
                >
                  <Crown size={16} />
                  <span>Upgrade to Coach Tier</span>
                  <ArrowRight size={15} />
                </Link>
                <button
                  type="button"
                  onClick={() => setPreviewUnlocked(true)}
                  className="students-btn-ghost py-2.5 px-4 text-sm"
                >
                  <Eye size={14} />
                  <span>Explore Demo Roster</span>
                </button>
              </div>
            </div>

            <div className="students-gate-features">
              <div className="students-gate-feature">
                <div className="students-gate-feature-icon">
                  <Users size={16} />
                </div>
                <div>
                  <div className="students-gate-feature-title">
                    Student roster management
                  </div>
                  <div className="students-gate-feature-copy">
                    Link student Chess.com &amp; Lichess handles with private
                    coaching notes and game archives.
                  </div>
                </div>
              </div>

              <div className="students-gate-feature">
                <div className="students-gate-feature-icon">
                  <BarChart3 size={16} />
                </div>
                <div>
                  <div className="students-gate-feature-title">
                    5-game batch audits
                  </div>
                  <div className="students-gate-feature-copy">
                    Scan multiple games on behalf of a student to catch recurring
                    tactical blindspots.
                  </div>
                </div>
              </div>

              <div className="students-gate-feature">
                <div className="students-gate-feature-icon">
                  <Share2 size={16} />
                </div>
                <div>
                  <div className="students-gate-feature-title">
                    Branded shareable portals
                  </div>
                  <div className="students-gate-feature-copy">
                    One-click read-only links for parents &amp; students with
                    interactive eval curves.
                  </div>
                </div>
              </div>

              <div className="students-gate-feature">
                <div className="students-gate-feature-icon">
                  <Sparkles size={16} />
                </div>
                <div>
                  <div className="students-gate-feature-title">
                    Progress matrix &amp; shared homework
                  </div>
                  <div className="students-gate-feature-copy">
                    Longitudinal rating trajectory, ACPL drift, clock panic
                    curves, and study links you assign.
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="students-gate-foot">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-[var(--green-bright)]" />
              Secure payments via Razorpay
            </span>
            <span>·</span>
            <span>UPI AutoPay &amp; cards accepted</span>
            <span>·</span>
            <span>Cancel anytime with 1 click</span>
          </div>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
