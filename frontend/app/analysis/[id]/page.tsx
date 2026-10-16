"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Topbar } from "../../../components/ui/Topbar";
import AnalysisThread, { type ThreadMessage } from "../../../components/AnalysisThread";
import CoachingReport from "../../../components/CoachingReport";
import LockedPsychologyPreview from "../../../components/LockedPsychologyPreview";
import SectionInsightBoards from "../../../components/SectionInsightBoards";
import GameHeader from "../../../components/review/GameHeader";
import BoardInstrument from "../../../components/review/BoardInstrument";
import { PSYCHOLOGY_MIN_GAMES } from "../../../components/AnalyzerForm";
import type { InsightsData } from "../../../components/insights";
import { isDrillable } from "../../../components/reportParsing";
import { apiGet, externalGameUrl } from "../../../lib/api";
import { apiGetCached, CACHE_TTL } from "../../../lib/api-cache";
import type { GameSummary, Usage } from "../../../lib/api";
import { warmBackend } from "../../../lib/backend-wake";
import { createClient } from "../../../lib/supabase-client";
import LimitReachedPrompt from "../../../components/LimitReachedPrompt";
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
    username?: string | null;
    opening_name?: string | null;
    eco?: string | null;
    result?: string | null;
    status: string;
    report_markdown?: string | null;
    /** Stored PGN — the fallback source when no replay is served. */
    pgn?: string | null;
    insights?: InsightsData | null;
    game_summary?: GameSummary | null;
    batch_id?: string | null;
    created_at: string;
    error_message?: string | null;
    student?: { display_name?: string | null } | null;
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

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
    warmBackend();
  }, []);

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
        // Both reads are independent; the report should not wait on the usage
        // pill, and a usage failure must not hide a perfectly good report.
        const [result, usageResult] = await Promise.all([
          apiGet<AnalysisDetail>(`/api/analyses/${analysisId}`, session.access_token),
          apiGetCached<Usage>("/api/account/usage", session.access_token, {
            ttlMs: CACHE_TTL.account,
          }).catch(() => null),
        ]);
        setDetail(result);
        if (usageResult) {
          setUsage(usageResult);
        }
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
  const summary = analysis.game_summary ?? null;
  const platformLabel = analysis.platform === "lichess" ? "Lichess" : "Chess.com";
  const colorLabel = analysis.player_color === "white" ? "White" : "Black";
  const gamesAnalyzed = usage?.total_games_analyzed ?? 0;
  const psychologyLocked =
    usage !== null && gamesAnalyzed < PSYCHOLOGY_MIN_GAMES;
  const hasDrills = (insights?.weakness_moments ?? []).some(isDrillable);

  const speedLabel =
    summary?.speed && summary.speed !== "unknown" ? capitalise(summary.speed) : null;
  const pill =
    [speedLabel, summary?.time_control, platformLabel].filter(Boolean).join(" · ") ||
    platformLabel;

  const headerNode = (
    <GameHeader
      pill={pill}
      title={analysis.opening_name ?? `Game ${analysis.game_id}`}
      showDrills={hasDrills}
      gameId={analysis.game_id}
      externalUrl={externalGameUrl(analysis)}
      externalLabel={`Open on ${platformLabel}`}
      meta={
        <>
          Played as {colorLabel}
          {analysis.result ? `, ${analysis.result}` : ""}
          {analysis.eco ? ` · ${analysis.eco}` : ""}
          {analysis.student?.display_name
            ? ` · For ${analysis.student.display_name}`
            : ""}
          {`, analysed ${formatDate(analysis.created_at)}`}
        </>
      }
    />
  );

  return (
    <main className="dashboard analysis-dashboard">
      <Topbar
        user={user}
        usage={usage}
        onAuthChange={() => router.push("/")}
      />

      <div className="review-workspace">
        <BoardInstrument
          analysisId={analysisId}
          token={token}
          pgn={analysis.pgn ?? null}
          playerColor={analysis.player_color}
          playerName={analysis.player_name ?? analysis.username ?? null}
          playerElo={summary?.player_elo ?? null}
          opponentName={summary?.opponent_name ?? null}
          opponentElo={summary?.opponent_elo ?? null}
          timeControl={summary?.time_control ?? null}
          moments={insights?.weakness_moments ?? []}
        />

        <div className="review-canvas-column">
          {analysis.report_markdown ? (
            <CoachingReport
              content={analysis.report_markdown}
              insights={insights}
              psychologyLocked={psychologyLocked}
              gamesAnalyzed={gamesAnalyzed}
              analysisId={analysisId}
              header={headerNode}
              gameAccuracy={summary?.accuracy ?? null}
            />
          ) : insights &&
            ((insights.weakness_moments?.length ?? 0) > 0 ||
              (insights.strength_moments?.length ?? 0) > 0) ? (
            <section className="report review-canvas" data-surface="paper">
              <div className="review-canvas-header">{headerNode}</div>
              <div className="report-section review-narrative">
                <h2>Engine review</h2>
                <p>
                  This game was analyzed as part of a multi-game report, so it has
                  no separate written report. Here are the key moments the engine
                  found in this game.
                </p>
                {analysis.batch_id && (
                  <p>
                    <Link
                      className="game-link"
                      href={`/batch/${analysis.batch_id}`}
                    >
                      Open the overall multi-game report →
                    </Link>
                  </p>
                )}
              </div>
              {(insights.weakness_moments?.length ?? 0) > 0 && (
                <div className="report-section review-moments-section">
                  <div className="review-section-head">
                    <h3>Key Game Moments</h3>
                    <p>Weakness — the positions the engine flagged</p>
                  </div>
                  <SectionInsightBoards moments={insights.weakness_moments} />
                </div>
              )}
              {(insights.strength_moments?.length ?? 0) > 0 && (
                <div className="report-section review-moments-section">
                  <div className="review-section-head">
                    <h3>Strength</h3>
                    <p>The moves that worked</p>
                  </div>
                  <SectionInsightBoards moments={insights.strength_moments} />
                </div>
              )}
              {psychologyLocked && (
                <div className="report-section">
                  <LockedPsychologyPreview gamesAnalyzed={gamesAnalyzed} />
                </div>
              )}
            </section>
          ) : (
            <div className="error-banner">
              {analysis.error_message ?? "This analysis has no report."}
            </div>
          )}

          {token && (
            <aside className="analysis-thread-column review-thread">
              <h2>Ask about this game</h2>
              {usage && !usage.qna_enabled ? (
                usage.plan === "paid" ? (
                  <LimitReachedPrompt periodEnd={usage.current_period_end} />
                ) : (
                  <UpgradePrompt feature="qna" />
                )
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
      </div>
    </main>
  );
}
