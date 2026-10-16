"use client";

import { useEffect, useState } from "react";
import { type StudentSummary, type Usage } from "../../lib/api";
import { apiGetCached, CACHE_TTL } from "../../lib/api-cache";
import { createClient } from "../../lib/supabase-client";

export type StudySession = {
  /** False until the first session lookup settles. */
  ready: boolean;
  signedIn: boolean;
  /** Supabase access token; empty when signed out. */
  token: string;
  /** True only for the coach tier (`plan_tier === "coach"`) — the share gate. */
  isCoach: boolean;
  /** The coach's students, only loaded when `students: true` is requested. */
  students: StudentSummary[];
};

const INITIAL: StudySession = {
  ready: false,
  signedIn: false,
  token: "",
  isCoach: false,
  students: [],
};

/**
 * Read the current Supabase session and the account's plan tier.
 *
 * Tactics and studies are public: a signed-out visitor still gets the catalog
 * and the curated list (the backend simply personalises less). Sharing is
 * coach-only, so `isCoach` mirrors `GET /api/account/usage.plan_tier` instead of
 * guessing from `plan === "paid"` — a Pro Student must not see a dead share
 * button. Every failure is swallowed: being offline, or a deployment without
 * Supabase configured, never blocks the page.
 */
export function useStudySession(options?: { students?: boolean }): StudySession {
  const wantsStudents = options?.students === true;
  const [session, setSession] = useState<StudySession>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    let client: ReturnType<typeof createClient> | null = null;
    try {
      client = createClient();
    } catch {
      client = null;
    }
    if (!client) {
      setSession({ ...INITIAL, ready: true });
      return;
    }
    const supabase = client;

    async function load(accessToken: string) {
      // Usage and the roster are read by several surfaces; the cache keeps a
      // page load to a single request each instead of one per component.
      const usage = await apiGetCached<Usage>("/api/account/usage", accessToken, {
        ttlMs: CACHE_TTL.account,
      }).catch(() => null);
      const tier = usage?.plan_tier ?? (usage?.plan === "paid" ? "student" : "free");
      const isCoach = tier === "coach";
      let students: StudentSummary[] = [];
      if (isCoach && wantsStudents) {
        students = await apiGetCached<StudentSummary[]>("/api/coach/students", accessToken, {
          ttlMs: CACHE_TTL.account,
        }).catch(() => []);
      }
      if (cancelled) {
        return;
      }
      setSession({
        ready: true,
        signedIn: true,
        token: accessToken,
        isCoach,
        students,
      });
    }

    const applySession = (accessToken: string | undefined) => {
      if (!accessToken) {
        setSession({ ...INITIAL, ready: true });
        return;
      }
      void load(accessToken);
    };

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled) {
          applySession(data.session?.access_token);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSession({ ...INITIAL, ready: true });
        }
      });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!cancelled) {
          applySession(nextSession?.access_token);
        }
      }
    );

    const onAuthChanged = () => {
      supabase.auth
        .getSession()
        .then(({ data }) => {
          if (!cancelled) {
            applySession(data.session?.access_token);
          }
        })
        .catch(() => undefined);
    };
    window.addEventListener("cm_auth_changed", onAuthChanged);

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
      window.removeEventListener("cm_auth_changed", onAuthChanged);
    };
  }, [wantsStudents]);

  return session;
}
