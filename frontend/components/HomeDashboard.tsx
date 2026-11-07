"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Topbar } from "./ui/Topbar";
import AnalyzerForm, {
  MAX_BATCH_GAMES,
  MAX_PAID_BATCH_GAMES,
  type AnalysisRequest,
  type BatchAnalysisRequest,
} from "./AnalyzerForm";
import AnalysisStatus from "./AnalysisStatus";
import AnalysisHistory from "./AnalysisHistory";
import BatchProgress, {
  type BatchGameProgress,
} from "./BatchProgress";
import CoachingReport from "./CoachingReport";
import GuestQnaPrompt from "./GuestQnaPrompt";
import GuestSignInPrompt from "./GuestSignInPrompt";
import LimitReachedPrompt from "./LimitReachedPrompt";
import ReviewSection from "./ReviewSection";
import UpgradePrompt from "./UpgradePrompt";
import ProductOverviewBento from "./ProductOverviewBento";
import SampleReportsFeed from "./SampleReportsFeed";
import LandingPricingSection from "./LandingPricingSection";
import ScrollChessBackground from "./animations/ScrollChessBackground";
import type { InsightsData } from "./insights";
import { initAnalytics, trackEvent } from "../lib/analytics";
import { warmBackend } from "../lib/backend-wake";
import { CONTENT_PUBLISHED, CONTENT_PUBLISHED_LABEL } from "../lib/site";
import { Check, Sparkles } from "lucide-react";
import {
  API_BASE,
  apiDelete,
  apiPost,
  apiPut,
  mergeHistoryEntries,
  type AnalysisSummary,
  type BatchSummary,
  type LinkedAccount,
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
  const [showScrollBoardPreview, setShowScrollBoardPreview] = useState(false);
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
      const updated = await apiPut<UserProfile>("/api/account/profile", session.access_token, {
        role: nextRole,
      });
      setProfile((prev) => ({
        role: updated.role ?? nextRole,
        linked_accounts: updated.linked_accounts ?? prev?.linked_accounts ?? [],
      }));
      if (nextRole === "coach") {
        router.push("/coach");
      }
    } catch (err) {
      console.error("Failed to switch role:", err);
    }
  }, [profile, router]);

  const handleAddLinkedAccount = useCallback(
    async (platform: "lichess" | "chess.com", username: string) => {
      if (!token) return;
      try {
        const res = await apiPost<{ linked_accounts: LinkedAccount[] }>(
          "/api/account/profile/accounts",
          token,
          { platform, username }
        );
        invalidateApiCache("/api/account/profile");
        setProfile((prev) => ({
          role: prev?.role ?? "player",
          linked_accounts: res.linked_accounts,
        }));
      } catch (err) {
        console.error("Failed to bind profile:", err);
      }
    },
    [token]
  );

  const handleRemoveLinkedAccount = useCallback(
    async (platform: "lichess" | "chess.com", username: string) => {
      if (!token) return;
      try {
        const params = new URLSearchParams({ platform, username });
        const res = await apiDelete<{ linked_accounts: LinkedAccount[] }>(
          `/api/account/profile/accounts?${params.toString()}`,
          token
        );
        invalidateApiCache("/api/account/profile");
        setProfile((prev) => ({
          role: prev?.role ?? "player",
          linked_accounts: res.linked_accounts,
        }));
      } catch (err) {
        console.error("Failed to remove linked profile:", err);
      }
    },
    [token]
  );

  const handleLinkedAccountsUpdated = useCallback((accounts: LinkedAccount[]) => {
    invalidateApiCache("/api/account/profile");
    setProfile((prev) => ({
      role: prev?.role ?? "player",
      linked_accounts: accounts,
    }));
  }, []);

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

      let accumulatedMarkdown = "";
      let latestInsights: InsightsData | null = null;

      await streamPost(
        `${API_BASE}/api/stream-analysis`,
        accessToken,
        {
          platform: request.platform,
          game_url: request.gameUrl,
          username: request.username,
          player_color: request.playerColor,
          pgn: request.pgn,
          fen: request.fen,
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
              accumulatedMarkdown += payload.text;
              setStatus("Generating your coaching report...");
            } else if (eventName === "insights") {
              latestInsights = payload as unknown as InsightsData;
              setInsights(latestInsights);
            } else if (eventName === "done") {
              retryableRef.current = null;
              setStatus("Redirecting to your report...");
              trackCompletion(true);
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
              if (payload.analysis_id) {
                setAnalysisId(payload.analysis_id);
                router.push(`/analysis/${payload.analysis_id}`);
                return;
              }
              // Guest user: store report in sessionStorage and redirect to /analysis/guest
              try {
                window.sessionStorage.setItem(
                  "cm_guest_report",
                  JSON.stringify({
                    analysis: {
                      id: "guest",
                      platform:
                        request.platform === "chess.com" ? "chess.com" : "lichess",
                      game_id: "guest",
                      game_url: request.gameUrl || "",
                      player_color:
                        latestInsights?.player_color ||
                        request.playerColor ||
                        "white",
                      player_name:
                        latestInsights?.player_name ||
                        request.username ||
                        null,
                      username: request.username || null,
                      opening_name: "Your Analyzed Game",
                      eco: null,
                      result: null,
                      status: "completed",
                      report_markdown: accumulatedMarkdown,
                      pgn: request.pgn || null,
                      insights: latestInsights,
                      game_summary: null,
                      batch_id: null,
                      created_at: new Date().toISOString(),
                    },
                    messages: [],
                  })
                );
              } catch {
                // ignore sessionStorage errors
              }
              router.push("/analysis/guest");
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
              setStatus("Generating your multi-game coaching report...");
            } else if (eventName === "insights") {
              setInsights(payload as unknown as InsightsData);
            } else if (eventName === "done") {
              retryableRef.current = null;
              setStatus("Redirecting to your multi-game report...");
              trackCompletion(true);
              if (payload.usage) {
                setUsage(payload.usage);
              }
              invalidateApiCache("/api/progress");
              refreshUsage(token, { force: true });
              refreshHistory(token, { force: true });
              if (payload.batch_id) {
                setBatchId(payload.batch_id);
                router.push(`/batch/${payload.batch_id}`);
                return;
              }
              setIsAnalyzing(false);
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
  const isPaidPlan = usage?.plan === "paid";
  const maxBatchAllowed = isPaidPlan ? MAX_PAID_BATCH_GAMES : MAX_BATCH_GAMES;
  const batchGameLimit = usage
    ? Math.min(maxBatchAllowed, usage.analyses_remaining)
    : MAX_BATCH_GAMES;
  const firstWeakness = insights?.weakness_moments?.[0] ?? null;
  const guestBlunderLabel = firstWeakness
    ? `${firstWeakness.move_number}. ${firstWeakness.san}`
    : null;

  return (
    <main id="top" className="dashboard relative">
      <ScrollChessBackground />

      <Topbar
        user={user}
        usage={usage}
        role={profile?.role ?? null}
        showUsagePill={false}
        onAuthChange={clearSessionState}
        onToggleRole={profile ? toggleRole : undefined}
      />

      <section className="hero hero-single relative z-10">
        <div className="hero-copy w-full">
          <h1 className="hero-title">Your AI chess game analyzer</h1>
          <p className="hero-lede">
            Pick a game from your Lichess or Chess.com account, paste a game link,
            or drop a PGN / FEN position to get a plain-English coaching report.
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
                isPaidPlan={isPaidPlan}
                remainingCredits={user ? usage?.analyses_remaining ?? null : null}
                defaultUsername={
                  attachedStudentId
                    ? coachStudents.find((s) => s.id === attachedStudentId)?.chesscom_username || undefined
                    : undefined
                }
                studentId={attachedStudentId || undefined}
                token={token || undefined}
                linkedAccounts={profile?.linked_accounts ?? []}
                onAddLinkedAccount={user ? handleAddLinkedAccount : undefined}
                onRemoveLinkedAccount={user ? handleRemoveLinkedAccount : undefined}
                onLinkedAccountsUpdated={user ? handleLinkedAccountsUpdated : undefined}
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
      </section>

      {user && (
        <section className="history-panel relative z-10">
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

      <section
        className="trust-strip relative z-10 rounded-2xl bg-[#0a1014]/92 backdrop-blur-md border border-[var(--line)] shadow-lg"
        aria-label="About Chessmasters"
      >
        <span className="trust-strip-item">
          <Check size={13} strokeWidth={3} aria-hidden="true" />
          Stockfish-checked, logic designed by{" "}
          <Link href="/about" rel="author" className="byline-author font-medium text-cream hover:underline">
            Parth Kaushik
          </Link>{" "}
          (FIDE AIM)
        </span>
        <span className="trust-strip-item">
          Updated{" "}
          <time dateTime={CONTENT_PUBLISHED}>
            {CONTENT_PUBLISHED_LABEL}
          </time>
        </span>
      </section>

      {/* Unified Product Overview Bento Grid (includes canonical What is Chessmasters + Video + FAQ items) */}
      <ProductOverviewBento />

      {/* Featured Championship & Grandmaster Sample Reports Feed */}
      <SampleReportsFeed />

      {/* Community Reviews */}
      <ReviewSection user={user} token={token} onAuthChange={clearSessionState} />

      {/* AI-SaaS Style Pricing Section at Bottom */}
      <LandingPricingSection currentPlan={usage?.plan ?? null} />

      {guestLimitHit && (
        <GuestSignInPrompt onClose={() => setGuestLimitHit(false)} />
      )}
    </main>
  );
}
