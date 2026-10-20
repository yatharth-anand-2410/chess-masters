"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Topbar } from "./ui/Topbar";
import AnalyzerForm, {
  MAX_BATCH_GAMES,
  type AnalysisRequest,
  type BatchAnalysisRequest,
} from "./AnalyzerForm";
import AnalysisStatus from "./AnalysisStatus";
import AnalysisHistory from "./AnalysisHistory";
import AuthButton from "./AuthButton";
import BatchProgress, {
  type BatchGameProgress,
} from "./BatchProgress";
import CoachingReport from "./CoachingReport";
import GuestQnaPrompt from "./GuestQnaPrompt";
import GuestSignInPrompt from "./GuestSignInPrompt";
import HeroBoard from "./HeroBoard";
import LimitReachedPrompt from "./LimitReachedPrompt";
import ReviewSection from "./ReviewSection";
import FaqSection from "./FaqSection";
import UpgradePrompt from "./UpgradePrompt";
import type { InsightsData } from "./insights";
import { initAnalytics, trackEvent } from "../lib/analytics";
import { warmBackend } from "../lib/backend-wake";
import { CONTENT_PUBLISHED, CONTENT_PUBLISHED_LABEL, PRODUCT_FACTS } from "../lib/site";
import { FAQS } from "../lib/faqs";
import { Check } from "lucide-react";
import {
  API_BASE,
  apiPost,
  apiPut,
  mergeHistoryEntries,
  type AnalysisSummary,
  type BatchSummary,
  type StudentSummary,
  type Usage,
  type UserProfile,
  type UserRole,
} from "../lib/api";
import { streamPost } from "../lib/stream";
import { apiGetCached, invalidateApiCache, writeApiCache, CACHE_TTL } from "../lib/api-cache";
import { createClient } from "../lib/supabase-client";

const GUEST_TRIAL_KEY = "cm_guest_trial";

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [status, setStatus] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [error, setError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [batchGames, setBatchGames] = useState<BatchGameProgress[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [guestUsed, setGuestUsed] = useState(false);
  const [guestLimitHit, setGuestLimitHit] = useState(false);
  const [coachStudents, setCoachStudents] = useState<StudentSummary[]>([]);
  const [attachedStudentId, setAttachedStudentId] = useState<string>("");
  const pendingChunks = useRef("");
  const flushHandle = useRef<number | null>(null);
  const reportRef = useRef<HTMLDivElement | null>(null);
  const hasScrolledToReport = useRef(false);
  /** The last submitted request, kept so a failed run can be retried as-is. */
  const retryableRef = useRef<
    | { kind: "single"; request: AnalysisRequest }
    | { kind: "batch"; request: BatchAnalysisRequest }
    | null
  >(null);

  const flushStreamContent = useCallback(() => {
    if (flushHandle.current !== null) {
      window.cancelAnimationFrame(flushHandle.current);
      flushHandle.current = null;
    }
    const chunk = pendingChunks.current;
    pendingChunks.current = "";
    if (chunk) {
      setMarkdown((prev) => prev + chunk);
    }
  }, []);

  const scheduleStreamFlush = useCallback(() => {
    if (flushHandle.current !== null) {
      return;
    }
    flushHandle.current = window.requestAnimationFrame(() => {
      flushHandle.current = null;
      flushStreamContent();
    });
  }, [flushStreamContent]);

  /**
   * The report is the peak of the experience, so the first streamed chunk
   * brings it into view once per run. The automatic reveal jumps instantly —
   * a long smooth scroll races the streaming layout. The manual "View report"
   * button scrolls smoothly instead.
   */
  const scrollToReport = useCallback((behavior: ScrollBehavior = "smooth") => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    reportRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : behavior,
      block: "start",
    });
  }, []);

  const revealReport = useCallback(() => {
    if (hasScrolledToReport.current) {
      return;
    }
    hasScrolledToReport.current = true;
    // "instant" deliberately bypasses the global `html { scroll-behavior:
    // smooth }` — the reveal must land immediately so the streaming report
    // is in view while it grows. The manual button scrolls smoothly instead.
    scrollToReport("instant");
  }, [scrollToReport]);

  const dismissStatus = useCallback(() => setStatus(""), []);

  useEffect(() => {
    return () => {
      if (flushHandle.current !== null) {
        window.cancelAnimationFrame(flushHandle.current);
      }
    };
  }, []);

  // Repeat visits: fire the session-start event once per tab (idempotent).
  useEffect(() => {
    initAnalytics();
  }, []);


  const refreshUsage = useCallback(async (sessionToken: string, options?: { force?: boolean }) => {
    try {
      const data = await apiGetCached<Usage>("/api/account/usage", sessionToken, {
        ttlMs: CACHE_TTL.account,
        force: options?.force ?? false,
      });
      setUsage(data);
    } catch (err) {
      console.error("Failed to load usage:", err);
    }
  }, []);

  const refreshCoachStudents = useCallback(
    async (sessionToken: string, options?: { force?: boolean }) => {
      try {
        const list = await apiGetCached<StudentSummary[]>("/api/coach/students", sessionToken, {
          ttlMs: CACHE_TTL.account,
          force: options?.force ?? false,
        });
        setCoachStudents(list || []);
      } catch {
        // not a coach or offline
      }
    },
    []
  );

  /**
   * The role decides the default experience. A first-time account has no role
   * yet, so it is routed to the one-tap onboarding choice. Failures are
   * swallowed: being offline must not lock a player out of the analyzer.
   */
  const loadProfile = useCallback(
    async (sessionToken: string) => {
      try {
        const data = await apiGetCached<UserProfile>(
          "/api/account/profile",
          sessionToken,
          { ttlMs: CACHE_TTL.account }
        );
        setProfile(data);
        if (data.role === null) {
          router.replace("/onboarding");
        }
      } catch (err) {
        console.error("Failed to load profile:", err);
      }
    },
    [router]
  );

  const toggleRole = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      return;
    }
    const nextRole: UserRole = profile?.role === "coach" ? "player" : "coach";
    try {
      await apiPut<UserProfile>("/api/account/profile", session.access_token, {
        role: nextRole,
      });
      setProfile({ role: nextRole });
      if (nextRole === "coach") {
        router.push("/coach");
      }
    } catch (err) {
      console.error("Failed to switch role:", err);
    }
  }, [profile, router]);

  const claimGuestTrial = useCallback(async (sessionToken: string) => {
    let pending = false;
    try {
      pending = window.localStorage.getItem(GUEST_TRIAL_KEY) === "1";
    } catch {
      pending = false;
    }
    if (!pending) {
      return;
    }
    try {
      const current = await apiGetCached<Usage>("/api/account/usage", sessionToken, {
        ttlMs: CACHE_TTL.account,
      });
      if (current.plan === "paid" || current.analyses_used > 0) {
        window.localStorage.removeItem(GUEST_TRIAL_KEY);
        return;
      }
      const updated = await apiPost<Usage>(
        "/api/account/claim-guest-trial",
        sessionToken,
        {}
      );
      window.localStorage.removeItem(GUEST_TRIAL_KEY);
      writeApiCache("/api/account/usage", sessionToken, updated);
      setUsage(updated);
    } catch (err) {
      console.error("Failed to claim guest trial:", err);
    }
  }, []);

  useEffect(() => {
    try {
      setGuestUsed(window.localStorage.getItem(GUEST_TRIAL_KEY) === "1");
    } catch {
      setGuestUsed(false);
    }
  }, []);

  const refreshHistory = useCallback(
    async (sessionToken: string, options?: { force?: boolean }) => {
      setLoadingHistory(true);
      try {
        const [list, batchList] = await Promise.all([
          apiGetCached<AnalysisSummary[]>(
            "/api/analyses?standalone=true&mine=true",
            sessionToken,
            { ttlMs: CACHE_TTL.data, force: options?.force ?? false }
          ),
          apiGetCached<BatchSummary[]>("/api/batches", sessionToken, {
            ttlMs: CACHE_TTL.data,
            force: options?.force ?? false,
          }),
        ]);
        setAnalyses(list);
        setBatches(batchList);
      } catch (err) {
        console.error("Failed to load history:", err);
      } finally {
        setLoadingHistory(false);
      }
    },
    []
  );

  /**
   * Wake the deployed backend as early as possible: on the free tier it takes
   * ~20s to boot after idling, and starting that now means it is almost always
   * up before the player finishes pasting a link.
   */
  useEffect(() => {
    warmBackend();
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const syncSession = (sessionUser?: User | null) => {
      setUser(sessionUser ?? null);
    };

    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      syncSession(session?.user);
      setToken(session?.access_token ?? "");
      if (session) {
        refreshHistory(session.access_token);
        refreshUsage(session.access_token);
        refreshCoachStudents(session.access_token);
        loadProfile(session.access_token);
        claimGuestTrial(session.access_token);
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      syncSession(session?.user);
      setToken(session?.access_token ?? "");
      if (session) {
        refreshHistory(session.access_token);
        refreshUsage(session.access_token);
        refreshCoachStudents(session.access_token);
        loadProfile(session.access_token);
        claimGuestTrial(session.access_token);
      } else {
        setAnalyses([]);
        setBatches([]);
        setMarkdown("");
        setInsights(null);
        setUsage(null);
        setProfile(null);
        setBatchGames([]);
        setBatchId(null);
        setAnalysisId(null);
      }
    });

    const handleAuthChange = () => {
      supabase.auth.getSession().then(({ data }) => {
        syncSession(data.session?.user);
        if (data.session?.access_token) {
          refreshCoachStudents(data.session.access_token);
        }
      });
    };
    window.addEventListener("cm_auth_changed", handleAuthChange);
    window.addEventListener("cm_students_changed", handleAuthChange);
    window.addEventListener("storage", handleAuthChange);

    return () => {
      subscription.subscription.unsubscribe();
      window.removeEventListener("cm_auth_changed", handleAuthChange);
      window.removeEventListener("cm_students_changed", handleAuthChange);
      window.removeEventListener("storage", handleAuthChange);
    };
  }, [claimGuestTrial, loadProfile, refreshHistory, refreshUsage, refreshCoachStudents]);

  const resetAnalysisState = useCallback(() => {
    if (flushHandle.current !== null) {
      window.cancelAnimationFrame(flushHandle.current);
      flushHandle.current = null;
    }
    pendingChunks.current = "";
    hasScrolledToReport.current = false;
    setError("");
    setMarkdown("");
    setInsights(null);
    setBatchGames([]);
    setBatchId(null);
    setAnalysisId(null);
  }, []);

  // Elapsed-time readout while an analysis runs.
  useEffect(() => {
    if (!isAnalyzing) {
      setElapsedSeconds(0);
      return;
    }
    setElapsedSeconds(0);
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isAnalyzing]);

  /** Stop the running analysis; the backend refunds the credit and marks it cancelled. */
  const handleCancelAnalysis = useCallback(() => {
    if (!isAnalyzing) {
      return;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    retryableRef.current = null;
    resetAnalysisState();
    setIsAnalyzing(false);
    setStatus(
      token
        ? "Cancelled — your analysis credit was returned."
        : "Cancelled — no analysis was saved."
    );
    trackEvent("analysis_cancelled", { signedIn: Boolean(token) });
  }, [isAnalyzing, resetAnalysisState, token]);

  const startAnalysis = useCallback(
    async (request: AnalysisRequest) => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token ?? "";
      if (!accessToken && guestUsed) {
        setGuestLimitHit(true);
        return;
      }

      resetAnalysisState();
      retryableRef.current = { kind: "single", request };
      setStatus("Connecting...");
      setIsAnalyzing(true);

      const startedAt = Date.now();
      const controller = new AbortController();
      abortRef.current = controller;
      let completionTracked = false;
      const trackCompletion = (success: boolean) => {
        if (completionTracked) {
          return;
        }
        completionTracked = true;
        trackEvent("analysis_complete", {
          platform: request.platform,
          isBatch: false,
          gameCount: 1,
          success,
          durationMs: Date.now() - startedAt,
          signedIn: Boolean(accessToken),
        });
      };

      await streamPost(
        `${API_BASE}/api/stream-analysis`,
        accessToken,
        {
          platform: request.platform,
          game_url: request.gameUrl,
          username: request.username,
          player_color: request.playerColor,
          student_id: request.studentId,
        },
        {
          onEvent: (eventName, data) => {
            const payload = data as {
              message?: string;
              text?: string;
              analysis_id?: string;
              usage?: Usage;
              code?: string;
            };
            if (eventName === "status_update" && payload.message) {
              setStatus(payload.message);
            } else if (eventName === "content_chunk" && payload.text) {
              pendingChunks.current += payload.text;
              scheduleStreamFlush();
              revealReport();
            } else if (eventName === "insights") {
              setInsights(payload as unknown as InsightsData);
            } else if (eventName === "done") {
              flushStreamContent();
              retryableRef.current = null;
              setStatus("Analysis complete");
              setIsAnalyzing(false);
              trackCompletion(true);
              if (payload.analysis_id) {
                setAnalysisId(payload.analysis_id);
              }
              if (payload.usage) {
                setUsage(payload.usage);
              }
              if (accessToken) {
                invalidateApiCache("/api/progress");
                refreshUsage(accessToken, { force: true });
                refreshHistory(accessToken, { force: true });
              } else {
                try {
                  window.localStorage.setItem(GUEST_TRIAL_KEY, "1");
                } catch {
                  // ignore storage errors
                }
                setGuestUsed(true);
              }
            } else if (eventName === "error") {
              flushStreamContent();
              if (payload.code === "guest_limit") {
                trackEvent("analysis_blocked", {
                  code: "guest_limit",
                  isBatch: false,
                  signedIn: Boolean(accessToken),
                });
                retryableRef.current = null;
                setGuestLimitHit(true);
                setStatus("");
                setIsAnalyzing(false);
                return;
              }
              trackCompletion(false);
              setError(payload.message ?? "Analysis failed.");
              setStatus("");
              setIsAnalyzing(false);
              if (accessToken) {
                refreshUsage(accessToken, { force: true });
              }
            }
          },
          onError: (message, code, _feature) => {
            if (code === "guest_limit") {
              trackEvent("analysis_blocked", {
                code: "guest_limit",
                isBatch: false,
                signedIn: Boolean(accessToken),
              });
              retryableRef.current = null;
              setGuestLimitHit(true);
              setStatus("");
              setIsAnalyzing(false);
              return;
            }
            if (code === "upgrade_required") {
              trackEvent("analysis_blocked", {
                code: "upgrade_required",
                isBatch: false,
                signedIn: Boolean(accessToken),
              });
              retryableRef.current = null;
              if (accessToken) {
                refreshUsage(accessToken, { force: true });
              }
              setStatus("");
              setIsAnalyzing(false);
              return;
            }
            if (code === "limit_reached" || code === "insufficient_credits") {
              trackEvent("analysis_blocked", {
                code,
                isBatch: false,
                signedIn: Boolean(accessToken),
              });
              retryableRef.current = null;
              setError(message);
              if (accessToken) {
                refreshUsage(accessToken, { force: true });
              }
              setStatus("");
              setIsAnalyzing(false);
              return;
            }
            trackCompletion(false);
            setError(message);
            setStatus("");
            setIsAnalyzing(false);
          },
        },
        { signal: controller.signal }
      );
    },
    [flushStreamContent, guestUsed, refreshHistory, refreshUsage, resetAnalysisState, revealReport, scheduleStreamFlush]
  );

  const startBatchAnalysis = useCallback(
    async (request: BatchAnalysisRequest) => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setError("Please sign in before analyzing games.");
        return;
      }
      const token = session.access_token;

      resetAnalysisState();
      retryableRef.current = { kind: "batch", request };
      setBatchGames(
        request.games.map((game) => ({
          gameUrl: game.gameUrl,
          state: "pending" as const,
        }))
      );
      setStatus("Connecting...");
      setIsAnalyzing(true);

      const startedAt = Date.now();
      const controller = new AbortController();
      abortRef.current = controller;
      let completionTracked = false;
      const trackCompletion = (success: boolean) => {
        if (completionTracked) {
          return;
        }
        completionTracked = true;
        trackEvent("analysis_complete", {
          platform: request.platform,
          isBatch: true,
          gameCount: request.games.length,
          success,
          durationMs: Date.now() - startedAt,
          signedIn: Boolean(token),
        });
      };

      await streamPost(
        `${API_BASE}/api/stream-batch-analysis`,
        token,
        {
          platform: request.platform,
          username: request.username,
          games: request.games.map((game) => ({
            game_url: game.gameUrl,
            player_color: game.playerColor,
          })),
          student_id: request.studentId,
        },
        {
          onEvent: (eventName, data) => {
            const payload = data as {
              message?: string;
              text?: string;
              index?: number;
              batch_id?: string;
              usage?: Usage;
              games?: { game_url: string }[];
              analysis_id?: string;
              opening_name?: string | null;
              result?: string | null;
            };
            if (eventName === "status_update" && payload.message) {
              // The transport emits this while a sleeping free-tier backend boots.
              setStatus(payload.message);
            } else if (eventName === "batch_started") {
              if (payload.games) {
                setBatchGames(
                  payload.games.map((game) => ({
                    gameUrl: game.game_url,
                    state: "pending" as const,
                  }))
                );
              }
              setStatus("Analyzing your games...");
            } else if (
              eventName === "game_status" &&
              typeof payload.index === "number"
            ) {
              const index = payload.index;
              setBatchGames((prev) =>
                prev.map((game, position) =>
                  position === index
                    ? {
                        ...game,
                        state: "active",
                        message: payload.message,
                        analysisId: payload.analysis_id ?? game.analysisId,
                      }
                    : game
                )
              );
              setStatus(payload.message ?? "Analyzing your games...");
            } else if (
              eventName === "game_done" &&
              typeof payload.index === "number"
            ) {
              const index = payload.index;
              setBatchGames((prev) =>
                prev.map((game, position) =>
                  position === index
                    ? {
                        ...game,
                        state: "done",
                        analysisId: payload.analysis_id ?? game.analysisId,
                        openingName: payload.opening_name ?? null,
                        result: payload.result ?? null,
                      }
                    : game
                )
              );
            } else if (
              eventName === "game_error" &&
              typeof payload.index === "number"
            ) {
              const index = payload.index;
              setBatchGames((prev) =>
                prev.map((game, position) =>
                  position === index
                    ? {
                        ...game,
                        state: "failed",
                        message:
                          payload.message ?? "This game could not be analyzed.",
                      }
                    : game
                )
              );
            } else if (eventName === "batch_status") {
              setStatus(
                payload.message ?? "AI generating your overall report..."
              );
            } else if (eventName === "content_chunk" && payload.text) {
              pendingChunks.current += payload.text;
              scheduleStreamFlush();
              revealReport();
            } else if (eventName === "insights") {
              setInsights(payload as unknown as InsightsData);
            } else if (eventName === "done") {
              flushStreamContent();
              retryableRef.current = null;
              setStatus("Analysis complete");
              setIsAnalyzing(false);
              trackCompletion(true);
              if (payload.batch_id) {
                setBatchId(payload.batch_id);
              }
              if (payload.usage) {
                setUsage(payload.usage);
              }
              // A finished analysis changes the credit count, the history list
              // and every derived report: drop those entries instead of letting
              // the cache serve the pre-analysis view back to the user.
              invalidateApiCache("/api/progress");
              refreshUsage(token, { force: true });
              refreshHistory(token, { force: true });
            } else if (eventName === "error") {
              flushStreamContent();
              trackCompletion(false);
              setError(payload.message ?? "Analysis failed.");
              setStatus("");
              setIsAnalyzing(false);
              refreshUsage(token, { force: true });
            }
          },
          onError: (message, code, _feature) => {
            if (code === "upgrade_required") {
              trackEvent("analysis_blocked", {
                code: "upgrade_required",
                isBatch: true,
                signedIn: Boolean(token),
              });
              retryableRef.current = null;
              refreshUsage(token, { force: true });
              setStatus("");
              setIsAnalyzing(false);
              return;
            }
            if (code === "limit_reached" || code === "insufficient_credits") {
              trackEvent("analysis_blocked", {
                code,
                isBatch: true,
                signedIn: Boolean(token),
              });
              retryableRef.current = null;
              setError(message);
              refreshUsage(token, { force: true });
              setStatus("");
              setIsAnalyzing(false);
              return;
            }
            trackCompletion(false);
            setError(message);
            setStatus("");
            setIsAnalyzing(false);
          },
        },
        { signal: controller.signal }
      );
    },
    [flushStreamContent, refreshHistory, refreshUsage, resetAnalysisState, revealReport, scheduleStreamFlush]
  );

  const openAnalysis = useCallback((id: string) => {
    window.location.href = `/analysis/${id}`;
  }, []);

  const openBatch = useCallback((id: string) => {
    window.location.href = `/batch/${id}`;
  }, []);

  /** Re-run the failed submission exactly as it was entered — nothing is lost. */
  const handleRetryAnalysis = useCallback(() => {
    const pending = retryableRef.current;
    retryableRef.current = null;
    if (!pending) {
      return;
    }
    if (pending.kind === "single") {
      void startAnalysis(pending.request);
    } else {
      void startBatchAnalysis(pending.request);
    }
  }, [startAnalysis, startBatchAnalysis]);

  const clearSessionState = useCallback(() => {
    setAnalyses([]);
    setBatches([]);
    setMarkdown("");
    setInsights(null);
    setBatchGames([]);
    setBatchId(null);
    setAnalysisId(null);
  }, []);

  const recentEntries = useMemo(
    () => mergeHistoryEntries(analyses, batches, 5),
    [analyses, batches]
  );

  const quotaExhausted = usage !== null && usage.analyses_remaining <= 0;
  const batchGameLimit = usage
    ? Math.min(MAX_BATCH_GAMES, usage.analyses_remaining)
    : MAX_BATCH_GAMES;
  const firstWeakness = insights?.weakness_moments?.[0] ?? null;
  const guestBlunderLabel = firstWeakness
    ? `${firstWeakness.move_number}. ${firstWeakness.san}`
    : null;

  return (
    <main className="dashboard">
      <Topbar
        user={user}
        usage={usage}
        role={profile?.role ?? null}
        showUsagePill={false}
        onAuthChange={clearSessionState}
        onToggleRole={profile ? toggleRole : undefined}
      />

      <section className="hero">
        <div className="hero-copy">
          <h1 className="hero-title">Your AI chess game analyzer</h1>
          <p className="hero-subtitle">
            Turn a finished game into your next lesson.
          </p>
          <p className="hero-lede">
            Paste a Lichess or Chess.com game and get a plain-English coaching
            report: what you did well, the moves that cost you, and the one rule
            to carry into your next game.
          </p>

          {user && quotaExhausted ? (
            usage?.plan === "paid" ? (
              <LimitReachedPrompt periodEnd={usage.current_period_end} />
            ) : (
              <UpgradePrompt feature="analysis" />
            )
          ) : (
            <>
              {/* Coach Mode: Attach to Student (Pro Plan Only) */}
              {user && usage?.plan === "paid" && (
                <div className="mb-3.5 p-3 rounded-xl bg-[var(--ink-2)] border border-[var(--gold)]/30 flex flex-wrap items-center justify-between gap-2.5 shadow-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[var(--gold-bright)] flex items-center gap-1.5">
                      <span className="text-sm">👤</span>
                      <span>Attach to Student:</span>
                    </span>
                    <select
                      value={attachedStudentId}
                      onChange={(e) => setAttachedStudentId(e.target.value)}
                      className="px-2.5 py-1 text-xs rounded-lg bg-[var(--ink-3)] border border-[var(--line)] text-[var(--text)] focus:outline-hidden focus:border-[var(--gold)] cursor-pointer"
                      aria-label="Attach analysis to student profile"
                    >
                      <option value="">Personal Analysis (No student attached)</option>
                      {coachStudents.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.display_name} {s.chesscom_username ? `(@${s.chesscom_username})` : s.lichess_username ? `(@${s.lichess_username})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window !== "undefined") {
                        window.dispatchEvent(new CustomEvent("open-manage-students"));
                      }
                    }}
                    className="inline-flex items-center gap-1 text-xs text-[var(--gold-bright)] hover:underline font-semibold cursor-pointer"
                  >
                    <span>+ Manage Students</span>
                  </button>
                </div>
              )}

              <AnalyzerForm
                disabled={isAnalyzing}
                maxGames={user ? batchGameLimit : 1}
                remainingCredits={user ? usage?.analyses_remaining ?? null : null}
                defaultUsername={
                  attachedStudentId
                    ? coachStudents.find((s) => s.id === attachedStudentId)?.chesscom_username || undefined
                    : undefined
                }
                studentId={attachedStudentId || undefined}
                onSubmit={startAnalysis}
                onSubmitBatch={user ? startBatchAnalysis : undefined}
              />
            </>
          )}

          {!user && (
            <p className="guest-note">
              First analysis is free, no account needed. Sign in afterward to save
              your report and unlock 4 more free game analyses.
            </p>
          )}

          {usage && (
            <div className="quota-panel">
              {usage.plan === "paid" ? (
                <span>
                  Pro Student plan: {usage.analyses_used} of {usage.paid_analysis_limit}{" "}
                  analyses used this billing period
                  {usage.analyses_remaining > 0
                    ? `, ${usage.analyses_remaining} remaining`
                    : ""}
                  .
                </span>
              ) : (
                <span>
                  Free plan: {usage.analyses_used} of {usage.free_analysis_limit}{" "}
                  analyses used
                  {usage.analyses_remaining > 0
                    ? `, ${usage.analyses_remaining} remaining`
                    : ""}
                  .
                </span>
              )}
            </div>
          )}

          <div className="status-slot">
            <AnalysisStatus
              status={status}
              isAnalyzing={isAnalyzing}
              elapsedSeconds={elapsedSeconds}
              onCancel={isAnalyzing ? handleCancelAnalysis : undefined}
              onDismiss={dismissStatus}
              onViewReport={scrollToReport}
            />
          </div>

          {batchGames.length > 0 && <BatchProgress games={batchGames} />}

          {error && (
            <div className="error-banner" role="alert">
              <span className="error-banner-text">{error}</span>
              {retryableRef.current && (
                <button
                  type="button"
                  className="btn-retry"
                  onClick={handleRetryAnalysis}
                >
                  Try again
                </button>
              )}
              <span className="error-credit-note">
                {token
                  ? "Your credit wasn't spent — failed analyses don't count toward your limit."
                  : "This run didn't use your free analysis."}
              </span>
            </div>
          )}
        </div>

        <aside className="hero-visual">
          <div className="hero-visual-inner">
            <div aria-hidden="true" className="w-full flex justify-center">
              <HeroBoard />
            </div>
            <p className="hero-caption">Every game has a square worth fighting for.</p>
          </div>
        </aside>
      </section>

      {/* The report is the product: it renders immediately below the form, so a
          submitted game is visible without scrolling past the marketing bands.
          The first streamed chunk scrolls it into view (see revealReport). */}
      {(isAnalyzing || markdown) && (
        <div className="report-anchor" ref={reportRef}>
          <CoachingReport
            content={markdown}
            insights={insights}
            pending={isAnalyzing}
            analysisId={analysisId}
          />
        </div>
      )}

      {markdown && !user && <GuestQnaPrompt moveLabel={guestBlunderLabel} />}

      {user && batchId && (
        <div className="batch-report-link">
          <Link href={`/batch/${batchId}`} className="btn btn-ghost">
            Open full multi-game report
          </Link>
        </div>
      )}

      {user && (
        <section className="history-panel">
          <div className="section-head">
            <h2>Recent analyses</h2>
            {recentEntries.length > 0 && (
              <Link href="/history" className="nav-link">
                View all
              </Link>
            )}
          </div>
          {loadingHistory && recentEntries.length === 0 ? (
            <p className="history-empty">Loading your games...</p>
          ) : (
            <AnalysisHistory
              entries={recentEntries}
              onOpen={openAnalysis}
              onOpenBatch={openBatch}
            />
          )}
        </section>
      )}

      <section className="trust-strip" aria-label="About Chessmasters">
        <span className="trust-strip-item">
          <Check size={13} strokeWidth={3} aria-hidden="true" />
          Stockfish-checked · logic designed by{" "}
          <Link href="/about" rel="author" className="byline-author font-medium text-cream hover:underline">
            Parth Kaushik
          </Link>{" "}
          (FIDE AIM)
        </span>
        <span className="trust-strip-dot" aria-hidden="true">·</span>
        <span className="trust-strip-item">
          Updated{" "}
          <time dateTime={CONTENT_PUBLISHED}>
            {CONTENT_PUBLISHED_LABEL}
          </time>
        </span>
        <span className="trust-strip-dot" aria-hidden="true">·</span>
        <span className="trust-strip-item">Psychology profile after 3 games</span>
        <span className="trust-strip-dot" aria-hidden="true">·</span>
        <span className="trust-strip-item">
          Pro: &#8377;{PRODUCT_FACTS.proPriceInr}/month ·{" "}
          {PRODUCT_FACTS.proAnalysesPerPeriod} analyses
        </span>
        <span className="trust-strip-dot" aria-hidden="true">·</span>
        <span className="trust-strip-item">
          <Link href="/faq">Read the FAQ</Link>
        </span>
      </section>

      <ReviewSection user={user} token={token} onAuthChange={clearSessionState} />

      <section className="homepage-about-panel" aria-labelledby="about-chessmasters-title">
        <div className="section-head">
          <h2 id="about-chessmasters-title">What is Chessmasters?</h2>
        </div>
        <p className="homepage-about-lede">
          Chessmasters is an AI chess game analyzer for Chess.com and Lichess players.
          It evaluates finished games with Stockfish to pinpoint tactical blunders and centipawn loss swings,
          then translates the raw engine evaluations into plain-English coaching reports covering Strengths,
          Weaknesses, Game Overview, Focus Areas, and curated Lichess study drills.
        </p>
      </section>

      <section className="explainer-video-panel my-8" aria-labelledby="video-explainer-title">
        <div className="section-head mb-4">
          <h2 id="video-explainer-title" className="text-xl font-bold text-cream">Watch: How Chessmasters Analyzes Your Game</h2>
        </div>
        <div className="explainer-video-container max-w-3xl mx-auto rounded-xl overflow-hidden border border-border/40 shadow-2xl bg-ink-2">
          <video
            controls
            preload="metadata"
            poster="/videos/chessmasters-explainer.poster.jpg"
            className="w-full aspect-video rounded-xl"
          >
            <source src="/videos/chessmasters-explainer.mp4" type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        </div>
      </section>

      <FaqSection items={FAQS} showMeta={false} showTitle={true} showMoreLink={true} />

      {guestLimitHit && (
        <GuestSignInPrompt onClose={() => setGuestLimitHit(false)} />
      )}
    </main>
  );
}
