"use client";

import { useMemo } from "react";

import type { AnalysisSummary } from "../../lib/api";
import type { InsightsData } from "../insights";

type BatchInstrumentProps = {
  games: AnalysisSummary[];
  gameCount: number;
  platformLabel?: string | null;
};

type PhaseAverages = {
  opening: number | null;
  middlegame: number | null;
  endgame: number | null;
  gamesWithPhases: number;
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * The batch page's own instrument: session telemetry gathered from the games
 * that already finished. Every number is an average of stored per-game data —
 * when the games carry too little, the panel says so instead of guessing.
 */
export default function BatchInstrument({
  games,
  gameCount,
  platformLabel,
}: BatchInstrumentProps) {
  const telemetry = useMemo(() => {
    const phases: { opening: number[]; middlegame: number[]; endgame: number[] } = {
      opening: [],
      middlegame: [],
      endgame: [],
    };
    const quality = { blunder: 0, mistake: 0, inaccuracy: 0 };
    let qualitySeen = false;
    let completed = 0;

    for (const game of games) {
      if (game.status !== "completed") {
        continue;
      }
      completed += 1;
      const insights = (game.insights as InsightsData | null) ?? null;
      const phaseData =
        game.game_summary?.phase_accuracies ?? insights?.phase_accuracies ?? null;
      const opening = finite(phaseData?.opening);
      const middlegame = finite(phaseData?.middlegame);
      const endgame = finite(phaseData?.endgame);
      if (opening !== null) {
        phases.opening.push(opening);
      }
      if (middlegame !== null) {
        phases.middlegame.push(middlegame);
      }
      if (endgame !== null) {
        phases.endgame.push(endgame);
      }

      const stats =
        insights?.statistics ?? game.game_summary?.quality ?? null;
      if (stats) {
        qualitySeen = true;
        quality.blunder += stats.blunder ?? 0;
        quality.mistake += stats.mistake ?? 0;
        quality.inaccuracy += stats.inaccuracy ?? 0;
      }
    }

    const averages: PhaseAverages = {
      opening: average(phases.opening),
      middlegame: average(phases.middlegame),
      endgame: average(phases.endgame),
      gamesWithPhases: Math.max(
        phases.opening.length,
        phases.middlegame.length,
        phases.endgame.length
      ),
    };

    return { averages, quality, qualitySeen, completed };
  }, [games]);

  const { averages, quality, qualitySeen, completed } = telemetry;
  const hasPhases =
    averages.opening !== null ||
    averages.middlegame !== null ||
    averages.endgame !== null;

  const phaseRow = (label: string, value: number | null) => (
    <div className="review-batch-phase" key={label}>
      <span className="review-batch-phase-label">{label}</span>
      <span className="review-batch-phase-track">
        {value !== null && (
          <span
            className="review-batch-phase-fill"
            style={{ width: `${Math.max(0, Math.min(100, value)).toFixed(0)}%` }}
          />
        )}
      </span>
      <span className="review-batch-phase-value">
        {value !== null ? `${Math.round(value)}%` : "–"}
      </span>
    </div>
  );

  return (
    <aside className="review-instrument review-batch-instrument" aria-label="Session telemetry">
      <div className="review-batch-head">
        <span className="review-instrument-kicker">Session telemetry</span>
        <b className="review-batch-title">
          {completed} of {gameCount} games analysed
        </b>
        {platformLabel && <span className="review-batch-platform">{platformLabel}</span>}
      </div>

      {hasPhases ? (
        <div className="review-batch-block">
          <span className="review-batch-block-title">
            Average accuracy by phase
            {averages.gamesWithPhases > 0
              ? ` · ${averages.gamesWithPhases} ${averages.gamesWithPhases === 1 ? "game" : "games"}`
              : ""}
          </span>
          {phaseRow("Opening", averages.opening)}
          {phaseRow("Middlegame", averages.middlegame)}
          {phaseRow("Endgame", averages.endgame)}
        </div>
      ) : (
        <p className="review-batch-empty">
          No phase accuracy is stored for these games yet.
        </p>
      )}

      {qualitySeen && (
        <div className="review-batch-block">
          <span className="review-batch-block-title">Engine flags across the session</span>
          <div className="review-batch-chips">
            <span className="review-batch-chip is-alert">{quality.blunder} blunders</span>
            <span className="review-batch-chip is-caution">{quality.mistake} mistakes</span>
            <span className="review-batch-chip">{quality.inaccuracy} inaccuracies</span>
          </div>
        </div>
      )}
    </aside>
  );
}
