"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import AnalyzerForm, {
  MAX_BATCH_GAMES,
  type AnalysisRequest,
  type BatchAnalysisRequest,
} from "../components/AnalyzerForm";
import AnalysisStatus from "../components/AnalysisStatus";
import AnalysisHistory from "../components/AnalysisHistory";
import AuthButton from "../components/AuthButton";
import BatchProgress, {
  type BatchGameProgress,
} from "../components/BatchProgress";
import CoachingReport from "../components/CoachingReport";
import CoachingPedigree from "../components/CoachingPedigree";
import GuestQnaPrompt from "../components/GuestQnaPrompt";
import GuestSignInPrompt from "../components/GuestSignInPrompt";
import HeroBoard from "../components/HeroBoard";
import LimitReachedPrompt from "../components/LimitReachedPrompt";
import ReviewSection from "../components/ReviewSection";
import UpgradePrompt from "../components/UpgradePrompt";
import type { InsightsData } from "../components/insights";
import {
  API_BASE,
  apiGet,
  apiPost,
  mergeHistoryEntries,
  type AnalysisSummary,
  type BatchSummary,
  type Usage,
} from "../lib/api";
import { streamPost } from "../lib/stream";
import { createClient } from "../lib/supabase-client";

const GUEST_TRIAL_KEY = "cm_guest_trial";

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");
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
  const [guestUsed, setGuestUsed] = useState(false);
  const [guestLimitHit, setGuestLimitHit] = useState(false);

  const refreshUsage = useCallback(async (sessionToken: string) => {
    try {
      const data = await apiGet<Usage>("/api/account/usage", sessionToken);
      setUsage(data);
    } catch (err) {
      console.error("Failed to load usage:", err);
    }
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
          "/api/analyses?standalone=true",
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

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      setUser(session?.user ?? null);
      setToken(session?.access_token ?? "");
      if (session) {
        refreshHistory(session.access_token);
        refreshUsage(session.access_token);
        claimGuestTrial(session.access_token);
      }
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setToken(session?.access_token ?? "");
      if (session) {
        refreshHistory(session.access_token);
        refreshUsage(session.access_token);
        claimGuestTrial(session.access_token);
      } else {
        setAnalyses([]);
        setBatches([]);
        setMarkdown("");
        setInsights(null);
        setUsage(null);
        setBatchGames([]);
        setBatchId(null);
      }
    });
    return () => subscription.subscription.unsubscribe();
  }, [claimGuestTrial, refreshHistory, refreshUsage]);

  const resetAnalysisState = useCallback(() => {
    setError("");
    setMarkdown("");
    setInsights(null);
    setBatchGames([]);
    setBatchId(null);
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

      await streamPost(
        `${API_BASE}/api/stream-analysis`,
        accessToken,
        {
          platform: request.platform,
          game_url: request.gameUrl,
          username: request.username,
          player_color: request.playerColor,
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
              setMarkdown((prev) => prev + (payload.text ?? ""));
            } else if (eventName === "insights") {
              setInsights(payload as unknown as InsightsData);
            } else if (eventName === "done") {
              setStatus("Analysis complete");
              setIsAnalyzing(false);
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
              if (payload.code === "guest_limit") {
                setGuestLimitHit(true);
                setStatus("");
                setIsAnalyzing(false);
                return;
              }
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
              setGuestLimitHit(true);
              setStatus("");
              setIsAnalyzing(false);
              return;
            }
            if (code === "upgrade_required") {
              if (accessToken) {
                refreshUsage(accessToken);
              }
              setStatus("");
              setIsAnalyzing(false);
              return;
            }
            if (code === "limit_reached" || code === "insufficient_credits") {
              setError(message);
              if (accessToken) {
                refreshUsage(accessToken);
              }
              setStatus("");
              setIsAnalyzing(false);
              return;
            }
            setError(message);
            setStatus("");
            setIsAnalyzing(false);
          },
        }
      );
    },
    [guestUsed, refreshHistory, refreshUsage, resetAnalysisState]
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
            if (eventName === "batch_started") {
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
              setMarkdown((prev) => prev + (payload.text ?? ""));
            } else if (eventName === "insights") {
              setInsights(payload as unknown as InsightsData);
            } else if (eventName === "done") {
              setStatus("Analysis complete");
              setIsAnalyzing(false);
              if (payload.batch_id) {
                setBatchId(payload.batch_id);
              }
              if (payload.usage) {
                setUsage(payload.usage);
              }
              refreshUsage(token);
              refreshHistory(token);
            } else if (eventName === "error") {
              setError(payload.message ?? "Analysis failed.");
              setStatus("");
              setIsAnalyzing(false);
              refreshUsage(token);
            }
          },
          onError: (message, code, _feature) => {
            if (code === "upgrade_required") {
              refreshUsage(token);
              setStatus("");
              setIsAnalyzing(false);
              return;
            }
            if (code === "limit_reached" || code === "insufficient_credits") {
              setError(message);
              refreshUsage(token);
              setStatus("");
              setIsAnalyzing(false);
              return;
            }
            setError(message);
            setStatus("");
            setIsAnalyzing(false);
          },
        }
      );
    },
    [refreshHistory, refreshUsage, resetAnalysisState]
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
      <header className="topbar">
        <Link href="/" className="wordmark">
          <span className="wordmark-glyph" aria-hidden="true">
            ♜
          </span>
          Chessmasters
        </Link>
        <div className="topbar-actions">
          {user && (
            <>
              {usage?.plan === "free" && (
                <span className="quota-pill">
                  Free Analyses: {usage.analyses_remaining}/
                  {usage.free_analysis_limit}
                </span>
              )}
              <Link href="/history" className="nav-link">
                History
              </Link>
              <Link href="/subscription" className="nav-link">
                Subscription
              </Link>
            </>
          )}
          <AuthButton user={user} onAuthChange={clearSessionState} />
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <h1 className="hero-title">Turn a finished game into your next lesson.</h1>
          <p className="hero-lede">
            The smart AI chess game analyzer for Chess.com and Lichess. Get
            instant, plain-English coaching reports, uncover hidden tactical
            blunders, and master your opening repertoire in minutes.
          </p>

          {user && quotaExhausted ? (
            usage?.plan === "paid" ? (
              <LimitReachedPrompt periodEnd={usage.current_period_end} />
            ) : (
              <UpgradePrompt feature="analysis" />
            )
          ) : (
            <AnalyzerForm
              disabled={isAnalyzing}
              maxGames={user ? batchGameLimit : 1}
              onSubmit={startAnalysis}
              onSubmitBatch={user ? startBatchAnalysis : undefined}
            />
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

          <AnalysisStatus status={status} isAnalyzing={isAnalyzing} />

          {batchGames.length > 0 && <BatchProgress games={batchGames} />}

          {error && <div className="error-banner">{error}</div>}
        </div>

        <aside className="hero-visual" aria-hidden="true">
          <HeroBoard />
          <p className="hero-caption">Every game has a square worth fighting for.</p>
        </aside>
      </section>

      {markdown && <CoachingReport content={markdown} insights={insights} />}

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

      <ReviewSection user={user} token={token} onAuthChange={clearSessionState} />

      {guestLimitHit && (
        <GuestSignInPrompt onClose={() => setGuestLimitHit(false)} />
      )}
    </main>
  );
}
