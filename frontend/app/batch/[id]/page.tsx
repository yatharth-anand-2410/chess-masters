"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AuthButton from "../../../components/AuthButton";
import CoachingReport from "../../../components/CoachingReport";
import GameAnalysisCard from "../../../components/GameAnalysisCard";
import type { InsightsData } from "../../../components/insights";
import { apiGet, type BatchDetail } from "../../../lib/api";
import { createClient } from "../../../lib/supabase-client";
import type { User } from "@supabase/supabase-js";

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

export default function BatchDetailPage() {
  const params = useParams<{ id: string }>();
  const batchId = params.id;
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [detail, setDetail] = useState<BatchDetail | null>(null);
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
      try {
        const result = await apiGet<BatchDetail>(
          `/api/batches/${batchId}`,
          session.access_token
        );
        setDetail(result);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load batch analysis."
        );
      }
    });
  }, [batchId, router]);

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
        <p className="history-empty">Loading multi-game report...</p>
      </main>
    );
  }

  const batch = detail.batch;
  const insights = (batch.insights as InsightsData | null) ?? null;
  const platformLabel = batch.platform === "lichess" ? "Lichess" : "Chess.com";
  const completed = detail.games.filter(
    (game) => game.status === "completed"
  ).length;

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
        <h1 className="game-title">Multi-game report</h1>
        <p className="game-meta">
          {completed} of {batch.game_count} games analyzed
          {`, ${formatDate(batch.created_at)}`}
        </p>
      </div>

      {batch.report_markdown ? (
        <CoachingReport content={batch.report_markdown} insights={insights} />
      ) : (
        <div className="error-banner">
          {batch.error_message ?? "This multi-game report has no report."}
        </div>
      )}

      <section className="batch-games">
        <div className="section-head">
          <h2>Game-by-game analysis</h2>
        </div>
        {detail.games.map((game, index) => (
          <GameAnalysisCard
            key={game.id}
            game={game}
            index={index}
            batchId={batch.id}
          />
        ))}
      </section>
    </main>
  );
}
