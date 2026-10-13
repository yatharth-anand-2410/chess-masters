"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiGet, apiPut, type UserProfile, type UserRole } from "../../lib/api";
import { createClient } from "../../lib/supabase-client";

/**
 * One-time role choice after the first sign-in.
 *
 * The role picks the default experience — player (the analyzer, unchanged) or
 * coach (a student roster with share links). It is deliberately one tap and
 * changeable later, so nobody is stuck with a wrong answer.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<UserRole | null>(null);
  const [error, setError] = useState("");

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
        if (profile.role) {
          // The choice was already made; never ask twice.
          router.replace(profile.role === "coach" ? "/coach" : "/");
          return;
        }
      } catch {
        // If the lookup fails the choice call below will surface the error.
      }
      setReady(true);
    });
  }, [router]);

  const choose = useCallback(
    async (role: UserRole) => {
      if (!token || busy) {
        return;
      }
      setBusy(role);
      setError("");
      try {
        await apiPut<UserProfile>("/api/account/profile", token, { role });
        router.replace(role === "coach" ? "/coach" : "/");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not save your choice."
        );
        setBusy(null);
      }
    },
    [busy, router, token]
  );

  return (
    <main className="dashboard onboarding-dashboard">
      <header className="topbar">
        <Link href="/" className="wordmark">
          <span className="wordmark-glyph" aria-hidden="true">
            ♜
          </span>
          Chessmasters
        </Link>
      </header>

      <div className="onboarding-wrap">
        <h1 className="onboarding-title">How will you use Chessmasters?</h1>
        <p className="onboarding-lede">
          This picks your default view. You can switch at any time from the
          account menu.
        </p>

        {error && <div className="error-banner">{error}</div>}

        <div className="onboarding-grid">
          <button
            type="button"
            className="onboarding-card"
            onClick={() => choose("player")}
            disabled={!ready || busy !== null}
          >
            <span className="onboarding-card-kicker">Player</span>
            <span className="onboarding-card-title">
              I want to analyze my own games
            </span>
            <span className="onboarding-card-body">
              Paste a Lichess or Chess.com game and get a plain-English coaching
              report. Exactly what you see today.
            </span>
            <span className="onboarding-card-cta">
              {busy === "player" ? "Setting up..." : "Continue as a player"}
            </span>
          </button>

          <button
            type="button"
            className="onboarding-card"
            onClick={() => choose("coach")}
            disabled={!ready || busy !== null}
          >
            <span className="onboarding-card-kicker">Coach</span>
            <span className="onboarding-card-title">I coach students</span>
            <span className="onboarding-card-body">
              Create student profiles, analyze their games, keep private notes,
              and share read-only progress links with students and parents.
            </span>
            <span className="onboarding-card-cta">
              {busy === "coach" ? "Setting up..." : "Set up my roster"}
            </span>
          </button>
        </div>
      </div>
    </main>
  );
}
