"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiGet, apiPut, type UserProfile, type UserRole } from "../lib/api";
import { createClient } from "../lib/supabase-client";

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
 */
export default function CoachGate({ children }: CoachGateProps) {
  const router = useRouter();
  const [role, setRole] = useState<UserRole | null | "loading">("loading");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session;
      if (!session) {
        router.replace("/");
        return;
      }
      setToken(session.access_token);
      try {
        const profile = await apiGet<UserProfile>(
          "/api/account/profile",
          session.access_token
        );
        if (profile.role === null) {
          router.replace("/onboarding");
          return;
        }
        setRole(profile.role);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not load your account."
        );
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

  if (error) {
    return (
      <main className="dashboard">
        <div className="error-banner">{error}</div>
        <Link href="/" className="btn btn-ghost">
          Back to the analyzer
        </Link>
      </main>
    );
  }

  if (role === "loading") {
    return (
      <main className="dashboard">
        <p className="history-empty">Loading coach mode...</p>
      </main>
    );
  }

  if (role === "player") {
    return (
      <main className="dashboard">
        <header className="topbar">
          <Link href="/" className="wordmark">
            <span className="wordmark-glyph" aria-hidden="true">
              ♜
            </span>
            Chessmasters
          </Link>
        </header>
        <div className="coach-gate">
          <h1 className="coach-gate-title">Coach mode is off for this account</h1>
          <p className="coach-gate-lede">
            Coach mode gives you a roster of student profiles, lets you analyze
            their games, and creates read-only progress links you can share.
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

  return <>{children}</>;
}
