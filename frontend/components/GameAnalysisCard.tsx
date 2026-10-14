"use client";

import React, { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import AccuracyChart from "./AccuracyChart";
import SectionInsightBoards from "./SectionInsightBoards";
import type { InsightsData } from "./insights";
import { externalGameUrl, type AnalysisSummary } from "../lib/api";
import { Pill } from "./ui/Pill";
import { Button } from "./ui/Button";

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
      <div className="game-card-header flex items-center gap-2 flex-wrap">
        <Pill tone="shell" size="sm">Game {index + 1}</Pill>
        <Pill tone="neutral" size="sm">{platformLabel}</Pill>
        <span className="game-card-title font-medium text-[var(--text)]">
          {game.opening_name ?? game.game_id}
        </span>
        <span className="game-card-meta text-xs text-[var(--text-muted)]">
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
            <div className="game-card-counts flex items-center gap-2 flex-wrap text-xs font-mono my-2">
              <Pill tone="alert" size="sm">
                {statistics.blunder ?? 0} blunders
              </Pill>
              <Pill tone="caution" size="sm">
                {statistics.mistake ?? 0} mistakes
              </Pill>
              <Pill tone="neutral" size="sm">
                {statistics.inaccuracy ?? 0} inaccuracies
              </Pill>
            </div>
          )}

          {hasMoments && (
            <div className="my-2">
              <Button
                variant="quiet"
                size="sm"
                onClick={() => setShowMoments((prev) => !prev)}
              >
                {showMoments
                  ? "Hide key moments"
                  : `Show key moments (${weakness.length + strength.length})`}
              </Button>

              <AnimatePresence>
                {showMoments && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25 }}
                    className="game-card-moments overflow-hidden mt-2"
                  >
                    {weakness.length > 0 && (
                      <div className="mb-3">
                        <h3 className="text-sm font-semibold mb-1 text-[var(--paper-text)]">Weakness</h3>
                        <SectionInsightBoards moments={weakness} />
                      </div>
                    )}
                    {strength.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold mb-1 text-[var(--paper-text)]">Strength</h3>
                        <SectionInsightBoards moments={strength} />
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          <div className="game-card-links flex items-center gap-3 text-xs mt-3">
            <Link href={`/analysis/${game.id}`} className="game-link text-[var(--gold)] hover:underline">
              Full game analysis →
            </Link>
            <a
              href={externalGameUrl(game)}
              target="_blank"
              rel="noreferrer"
              className="game-link text-[var(--text-muted)] hover:text-white"
            >
              Open on {platformLabel} ↗
            </a>
            {batchId && <span className="game-card-batch text-[var(--text-muted)] font-mono text-[0.7rem]">Part of this report</span>}
          </div>
        </>
      )}
    </article>
  );
}
