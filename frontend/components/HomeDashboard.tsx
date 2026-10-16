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
import AnalyzerGuide from "./AnalyzerGuide";
import AuthButton from "./AuthButton";
import BatchProgress, {
  type BatchGameProgress,
} from "./BatchProgress";
import CoachingReport from "./CoachingReport";
import CoachingPedigree from "./CoachingPedigree";
import FaqSection from "./FaqSection";
import GuestQnaPrompt from "./GuestQnaPrompt";
import GuestSignInPrompt from "./GuestSignInPrompt";
import HeroBoard from "./HeroBoard";
import LimitReachedPrompt from "./LimitReachedPrompt";
import ReviewSection from "./ReviewSection";
import UpgradePrompt from "./UpgradePrompt";
import type { InsightsData } from "./insights";
import { initAnalytics, trackEvent } from "../lib/analytics";
import { warmBackend } from "../lib/backend-wake";
import {
  API_BASE,
  apiGet,
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
import { createClient } from "../lib/supabase-client";

const GUEST_TRIAL_KEY = "cm_guest_trial";

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [status, setStatus] = useState("");
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


  const refreshUsage = useCallback(async (sessionToken: string) => {
    try {
      const data = await apiGet<Usage>("/api/account/usage", sessionToken);
      setUsage(data);
    } catch (err) {
      console.error("Failed to load usage:", err);
    }
  }, []);

  const refreshCoachStudents = useCallback(async (sessionToken: string) => {
    try {
      const list = await apiGet<StudentSummary[]>("/api/coach/students", sessionToken);
      setCoachStudents(list || []);
    } catch {
      // not a coach or offline
    }
  }, []);

  /**
   * The role decides the default experience. A first-time account has no role
   * yet, so it is routed to the one-tap onboarding choice. Failures are
   * swallowed: being offline must not lock a player out of the analyzer.
   */
  const loadProfile = useCallback(
    async (sessionToken: string) => {
      try {
        const data = await apiGet<UserProfile>(
          "/api/account/profile",
          sessionToken
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
      const current = await apiGet<Usage>("/api/account/usage", sessionToken);
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

  const refreshHistory = useCallback(async (sessionToken: string) => {
    setLoadingHistory(true);
    try {
      const [list, batchList] = await Promise.all([
        apiGet<AnalysisSummary[]>(
          "/api/analyses?standalone=true&mine=true",
          sessionToken
        ),
        apiGet<BatchSummary[]>("/api/batches", sessionToken),
      ]);
      setAnalyses(list);
      setBatches(batchList);
    } catch (err) {
      console.error("Failed to load history:", err);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

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
    setError("");
    setMarkdown("");
    setInsights(null);
    setBatchGames([]);
    setBatchId(null);
    setAnalysisId(null);
  }, []);

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
      setStatus("Connecting...");
      setIsAnalyzing(true);

      const startedAt = Date.now();
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
            } else if (eventName === "insights") {
              setInsights(payload as unknown as InsightsData);
            } else if (eventName === "done") {
              flushStreamContent();
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
                refreshUsage(accessToken);
                refreshHistory(accessToken);
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
                refreshUsage(accessToken);
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
              if (accessToken) {
                refreshUsage(accessToken);
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
              setError(message);
              if (accessToken) {
                refreshUsage(accessToken);
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
        }
      );
    },
    [flushStreamContent, guestUsed, refreshHistory, refreshUsage, resetAnalysisState, scheduleStreamFlush]
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
      setBatchGames(
        request.games.map((game) => ({
          gameUrl: game.gameUrl,
          state: "pending" as const,
        }))
      );
      setStatus("Connecting...");
      setIsAnalyzing(true);

      const startedAt = Date.now();
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
            } else if (eventName === "insights") {
              setInsights(payload as unknown as InsightsData);
            } else if (eventName === "done") {
              flushStreamContent();
              setStatus("Analysis complete");
              setIsAnalyzing(false);
              trackCompletion(true);
              if (payload.batch_id) {
                setBatchId(payload.batch_id);
              }
              if (payload.usage) {
                setUsage(payload.usage);
              }
              refreshUsage(token);
              refreshHistory(token);
            } else if (eventName === "error") {
              flushStreamContent();
              trackCompletion(false);
              setError(payload.message ?? "Analysis failed.");
              setStatus("");
              setIsAnalyzing(false);
              refreshUsage(token);
            }
          },
          onError: (message, code, _feature) => {
            if (code === "upgrade_required") {
              trackEvent("analysis_blocked", {
                code: "upgrade_required",
                isBatch: true,
                signedIn: Boolean(token),
              });
              refreshUsage(token);
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
              setError(message);
              refreshUsage(token);
              setStatus("");
              setIsAnalyzing(false);
              return;
            }
            trackCompletion(false);
            setError(message);
            setStatus("");
            setIsAnalyzing(false);
          },
        }
      );
    },
    [flushStreamContent, refreshHistory, refreshUsage, resetAnalysisState, scheduleStreamFlush]
  );

  const openAnalysis = useCallback((id: string) => {
    window.location.href = `/analysis/${id}`;
  }, []);

  const openBatch = useCallback((id: string) => {
    window.location.href = `/batch/${id}`;
  }, []);

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
                  Paid plan: {usage.analyses_used} of {usage.paid_analysis_limit}{" "}
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
            <AnalysisStatus status={status} isAnalyzing={isAnalyzing} />
          </div>

          {batchGames.length > 0 && <BatchProgress games={batchGames} />}

          {error && <div className="error-banner">{error}</div>}
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
          The guide and the unlock band follow it instead of blocking it. */}
      {(isAnalyzing || markdown) && (
        <CoachingReport
          content={markdown}
          insights={insights}
          pending={isAnalyzing}
          analysisId={analysisId}
        />
      )}

      <AnalyzerGuide />

      <section className="mindset-callout" aria-labelledby="mindset-title">
        <div className="mindset-copy">
          <p className="mindset-kicker">Progressive unlock</p>
          <h2 className="mindset-title" id="mindset-title">
            Stockfish fixes your moves. We fix your mindset.
          </h2>
          <p className="mindset-lede">
            Play 3 games to unlock your AI Psychological Profile. Discover your
            Tilt Resistance, Composure, and unique Playing Style based on your
            actual blunders.
          </p>
        </div>
        <div className="mindset-emblem" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="4" y="10.5" width="16" height="9.5" rx="2" />
            <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
            <circle cx="12" cy="15.25" r="1.1" fill="currentColor" stroke="none" />
          </svg>
          <span className="mindset-pips">
            <span className="mindset-pip" />
            <span className="mindset-pip" />
            <span className="mindset-pip" />
          </span>
        </div>
      </section>

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

      <CoachingPedigree />

      <FaqSection showMeta />

      <ReviewSection user={user} token={token} onAuthChange={clearSessionState} />

      {guestLimitHit && (
        <GuestSignInPrompt onClose={() => setGuestLimitHit(false)} />
      )}
    </main>
  );
}
