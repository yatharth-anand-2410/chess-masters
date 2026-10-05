"use client";

import { useState } from "react";
import Link from "next/link";
import AccuracyChart from "./AccuracyChart";
import SectionInsightBoards from "./SectionInsightBoards";
import type { InsightsData } from "./insights";
import { externalGameUrl, type AnalysisSummary } from "../lib/api";

type GameAnalysisCardProps = {
  game: AnalysisSummary;
  index: number;
  batchId?: string;
};

function phaseAccuracyData(insights: InsightsData | null): string | undefined {
  const accuracies = insights?.phase_accuracies;
  if (!accuracies) {
    return undefined;
  }
  const values = [
    accuracies.opening ?? null,
    accuracies.middlegame ?? null,
    accuracies.endgame ?? null,
  ];
  if (values.every((value) => value === null)) {
    return undefined;
  }
  return JSON.stringify(values);
}

export default function GameAnalysisCard({
  game,
  index,
  batchId,
}: GameAnalysisCardProps) {
  const [showMoments, setShowMoments] = useState(false);
  const insights = (game.insights as InsightsData | null) ?? null;
  const platformLabel = game.platform === "lichess" ? "Lichess" : "Chess.com";
  const colorLabel =
    game.player_color === "white"
      ? "White"
      : game.player_color === "black"
        ? "Black"
        : "Unknown";
  const statistics = insights?.statistics;
  const accuracyData = phaseAccuracyData(insights);
  const weakness = insights?.weakness_moments ?? [];
  const strength = insights?.strength_moments ?? [];
  const hasMoments = weakness.length > 0 || strength.length > 0;
  const failed = game.status === "failed";

  return (
    <article className="game-card">
      <div className="game-card-header">
        <span className="game-card-index">Game {index + 1}</span>
        <span className="history-platform">{platformLabel}</span>
        <span className="game-card-title">
          {game.opening_name ?? game.game_id}
        </span>
        <span className="game-card-meta">
          Played as {colorLabel}
          {game.result ? ` · ${game.result}` : ""}
        </span>
      </div>

      {failed ? (
        <div className="error-banner">
          {game.error_message ?? "This game could not be analyzed."}
        </div>
      ) : (
        <>
          {accuracyData && <AccuracyChart data={accuracyData} />}

          {statistics && (
            <div className="game-card-counts">
              <span className="count-blunder">
                {statistics.blunder ?? 0} blunders
              </span>
              <span className="count-mistake">
                {statistics.mistake ?? 0} mistakes
              </span>
              <span className="count-inaccuracy">
                {statistics.inaccuracy ?? 0} inaccuracies
              </span>
            </div>
          )}

          {hasMoments && (
            <>
              <button
                type="button"
                className="game-card-toggle"
                onClick={() => setShowMoments((prev) => !prev)}
              >
                {showMoments
                  ? "Hide key moments"
                  : `Show key moments (${weakness.length + strength.length})`}
              </button>
              {showMoments && (
                <div className="game-card-moments">
                  {weakness.length > 0 && (
                    <div>
                      <h3>Weakness</h3>
                      <SectionInsightBoards moments={weakness} />
                    </div>
                  )}
                  {strength.length > 0 && (
                    <div>
                      <h3>Strength</h3>
                      <SectionInsightBoards moments={strength} />
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="game-card-links">
            <Link href={`/analysis/${game.id}`} className="game-link">
              Full game analysis →
            </Link>
            <a
              href={externalGameUrl(game)}
              target="_blank"
              rel="noreferrer"
              className="game-link"
            >
              Open on {platformLabel} ↗
            </a>
            {batchId && <span className="game-card-batch">Part of this report</span>}
          </div>
        </>
      )}
    </article>
  );
}
