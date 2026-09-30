"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AuthButton from "../../../components/AuthButton";
import AnalysisThread, { type ThreadMessage } from "../../../components/AnalysisThread";
import CoachingReport from "../../../components/CoachingReport";
import type { InsightsData } from "../../../components/insights";
import { apiGet, externalGameUrl } from "../../../lib/api";
import type { Usage } from "../../../lib/api";
import { createClient } from "../../../lib/supabase-client";
import UpgradePrompt from "../../../components/UpgradePrompt";
import type { User } from "@supabase/supabase-js";

type AnalysisDetail = {
  analysis: {
    id: string;
    platform: string;
    game_id: string;
    game_url: string;
    player_color: string;
    player_name?: string | null;
    opening_name?: string | null;
    result?: string | null;
    status: string;
    report_markdown?: string | null;
    insights?: InsightsData | null;
    created_at: string;
    error_message?: string | null;
  };
  messages: ThreadMessage[];
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AnalysisDetailPage() {
  const params = useParams<{ id: string }>();
  const analysisId = params.id;
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");
  const [detail, setDetail] = useState<AnalysisDetail | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session;
      setUser(session?.user ?? null);
      if (!session) {
        router.push("/");
        return;
      }
      setToken(session.access_token);
      try {
        const result = await apiGet<AnalysisDetail>(
          `/api/analyses/${analysisId}`,
          session.access_token
        );
        setDetail(result);
        const usageResult = await apiGet<Usage>(
          "/api/account/usage",
          session.access_token
        );
        setUsage(usageResult);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load analysis.");
      }
    });
  }, [analysisId, router]);

  if (error) {
    return (
      <main className="dashboard">
        <div className="error-banner">{error}</div>
        <button type="button" className="btn" onClick={() => router.push("/")}>
          Back to home
        </button>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="dashboard">
        <p className="history-empty">Loading analysis...</p>
      </main>
    );
  }

  const analysis = detail.analysis;
  const insights = analysis.insights ?? null;
  const platformLabel = analysis.platform === "lichess" ? "Lichess" : "Chess.com";
  const colorLabel = analysis.player_color === "white" ? "White" : "Black";

  return (
    <main className="dashboard analysis-dashboard">
      <header className="topbar">
        <Link href="/" className="wordmark">
          <span className="wordmark-glyph" aria-hidden="true">
            ♜
          </span>
          Chessmasters
        </Link>
        <div className="topbar-actions">
          <Link href="/" className="nav-link">
            New analysis
          </Link>
          <Link href="/history" className="nav-link">
            History
          </Link>
          <Link href="/subscription" className="nav-link">
            Subscription
          </Link>
          <AuthButton user={user} onAuthChange={() => router.push("/")} />
        </div>
      </header>

      <div className="game-header">
        <span className="chip">{platformLabel}</span>
        <h1 className="game-title">{analysis.opening_name ?? analysis.game_id}</h1>
        <p className="game-meta">
          Played as {colorLabel}
          {analysis.result ? `, ${analysis.result}` : ""}
          {`, analyzed ${formatDate(analysis.created_at)}`}
        </p>
        <a
          href={externalGameUrl(analysis)}
          target="_blank"
          rel="noreferrer"
          className="game-link"
        >
          Open on {platformLabel} ↗
        </a>
      </div>

      <div className="analysis-workspace">
        <div className="analysis-report-column">
          {analysis.report_markdown ? (
            <CoachingReport content={analysis.report_markdown} insights={insights} />
          ) : (
            <div className="error-banner">
              {analysis.error_message ?? "This analysis has no report."}
            </div>
          )}
        </div>

        {token && (
          <aside className="analysis-thread-column">
            <h2>Ask about this game</h2>
            {usage && !usage.qna_enabled ? (
              <UpgradePrompt feature="qna" />
            ) : (
              <AnalysisThread
                analysisId={analysisId}
                token={token}
                initialMessages={detail.messages}
              />
            )}
          </aside>
        )}
      </div>
    </main>
  );
}
