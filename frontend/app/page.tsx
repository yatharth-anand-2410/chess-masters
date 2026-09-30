"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import AnalyzerForm, { type AnalysisRequest } from "../components/AnalyzerForm";
import AnalysisStatus from "../components/AnalysisStatus";
import AnalysisHistory from "../components/AnalysisHistory";
import AuthButton from "../components/AuthButton";
import CoachingReport from "../components/CoachingReport";
import HeroBoard from "../components/HeroBoard";
import LimitReachedPrompt from "../components/LimitReachedPrompt";
import ReviewSection from "../components/ReviewSection";
import UpgradePrompt from "../components/UpgradePrompt";
import type { InsightsData } from "../components/insights";
import { API_BASE, apiGet, type AnalysisSummary, type Usage } from "../lib/api";
import { streamPost } from "../lib/stream";
import { createClient } from "../lib/supabase-client";

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
  const [loadingHistory, setLoadingHistory] = useState(false);

  const refreshUsage = useCallback(async (sessionToken: string) => {
    try {
      const data = await apiGet<Usage>("/api/account/usage", sessionToken);
      setUsage(data);
    } catch (err) {
      console.error("Failed to load usage:", err);
    }
  }, []);

  const refreshHistory = useCallback(async (sessionToken: string) => {
    setLoadingHistory(true);
    try {
      const list = await apiGet<AnalysisSummary[]>("/api/analyses", sessionToken);
      setAnalyses(list.slice(0, 5));
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
      }
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setToken(session?.access_token ?? "");
      if (session) {
        refreshHistory(session.access_token);
        refreshUsage(session.access_token);
      } else {
        setAnalyses([]);
        setMarkdown("");
        setInsights(null);
        setUsage(null);
      }
    });
    return () => subscription.subscription.unsubscribe();
  }, [refreshHistory, refreshUsage]);

  const startAnalysis = useCallback(
    async (request: AnalysisRequest) => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setError("Please sign in before analyzing a game.");
        return;
      }
      const token = session.access_token;

      setError("");
      setMarkdown("");
      setInsights(null);
      setStatus("Connecting...");
      setIsAnalyzing(true);

      const params = new URLSearchParams({
        platform: request.platform,
        game_url: request.gameUrl,
      });
      if (request.username) {
        params.set("username", request.username);
      }
      if (request.playerColor) {
        params.set("player_color", request.playerColor);
      }

      await streamPost(
        `${API_BASE}/api/stream-analysis`,
        token,
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
              } else {
                refreshUsage(token);
              }
              refreshHistory(token);
            } else if (eventName === "error") {
              setError(payload.message ?? "Analysis failed.");
              setStatus("");
              setIsAnalyzing(false);
            }
          },
          onError: (message, code, _feature) => {
            if (code === "upgrade_required") {
              refreshUsage(token);
              setStatus("");
              setIsAnalyzing(false);
              return;
            }
            if (code === "limit_reached") {
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
    [refreshHistory, refreshUsage]
  );

  const openAnalysis = useCallback((id: string) => {
    window.location.href = `/analysis/${id}`;
  }, []);

  const clearSessionState = useCallback(() => {
    setAnalyses([]);
    setMarkdown("");
    setInsights(null);
  }, []);

  const quotaExhausted = usage !== null && usage.analyses_remaining <= 0;

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
            Paste a Lichess or Chess.com game and get a coaching report built around the
            moves you actually played.
          </p>

          {!user ? (
            <div className="signin-card">
              <h2>Sign in to analyze a game</h2>
              <p>
                Your reports, engine notes, and follow-up questions stay with your
                account.
              </p>
              <AuthButton user={null} onAuthChange={clearSessionState} />
            </div>
          ) : (
            <>
              {quotaExhausted ? (
                usage?.plan === "paid" ? (
                  <LimitReachedPrompt periodEnd={usage.current_period_end} />
                ) : (
                  <UpgradePrompt feature="analysis" />
                )
              ) : (
                <AnalyzerForm disabled={isAnalyzing} onSubmit={startAnalysis} />
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

              {error && <div className="error-banner">{error}</div>}
            </>
          )}
        </div>

        <aside className="hero-visual" aria-hidden="true">
          <HeroBoard />
          <p className="hero-caption">Every game has a square worth fighting for.</p>
        </aside>
      </section>

      {user && markdown && <CoachingReport content={markdown} insights={insights} />}

      {user && (
        <section className="history-panel">
          <div className="section-head">
            <h2>Recent analyses</h2>
            {analyses.length > 0 && (
              <Link href="/history" className="nav-link">
                View all
              </Link>
            )}
          </div>
          {loadingHistory && !analyses.length ? (
            <p className="history-empty">Loading your games...</p>
          ) : (
            <AnalysisHistory analyses={analyses} onOpen={openAnalysis} />
          )}
        </section>
      )}

      <ReviewSection user={user} token={token} onAuthChange={clearSessionState} />
    </main>
  );
}
