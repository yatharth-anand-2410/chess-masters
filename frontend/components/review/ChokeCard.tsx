"use client";

import type { InsightsData, InsightMoment } from "../insights";
import { formatClockSeconds, signedMoveLabel } from "../reportParsing";

export type ChokeEvidence = {
  badge: string;
  text: string;
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Resolve the stored result into the player's own outcome. */
function playerOutcome(
  result: string | null | undefined,
  playerColor: string | null | undefined
): "win" | "loss" | "draw" | null {
  if (!result) {
    return null;
  }
  const normalized = result.trim();
  if (normalized === "1/2-1/2" || normalized === "½-½") {
    return "draw";
  }
  if (normalized !== "1-0" && normalized !== "0-1") {
    return null;
  }
  const whiteWon = normalized === "1-0";
  const playerIsWhite = playerColor !== "black";
  return whiteWon === playerIsWhite ? "win" : "loss";
}

function formatPawns(value: number): string {
  const sign = value > 0 ? "+" : "−";
  return `${sign}${Math.abs(value).toFixed(1)}`;
}

function bestLabel(moment: InsightMoment): string | null {
  const best = moment.best_move_san?.trim();
  if (!best) {
    return null;
  }
  const separator = moment.color === "black" ? "..." : ".";
  return `${moment.move_number}${separator}${best}`;
}

/**
 * Choke verification from real evidence only.
 *
 * Order of proof: the player was demonstrably winning before their own move and
 * then did not win; failing that, a single move that swung the evaluation by
 * more than two pawns. Returns null when no moment carries the evidence, which
 * hides the card entirely instead of printing a template verdict.
 */
export function deriveChokeEvidence(
  insights?: InsightsData | null
): ChokeEvidence | null {
  const moments = [...(insights?.weakness_moments ?? [])].filter(
    (moment) => finite(moment.centipawn_loss) !== null
  );
  if (moments.length === 0) {
    return null;
  }

  const playerColor = insights?.player_color === "black" ? "black" : "white";
  const sign = playerColor === "black" ? -1 : 1;
  const outcome = playerOutcome(insights?.result, playerColor);

  const winning = moments
    .map((moment) => ({
      moment,
      edge: finite(moment.eval_before_pawns),
    }))
    .filter(
      (entry): entry is { moment: InsightMoment; edge: number } =>
        entry.edge !== null && sign * entry.edge >= 2
    )
    .sort((a, b) => sign * b.edge - sign * a.edge)[0];

  if (winning) {
    const { moment, edge } = winning;
    const inFavour = sign * edge;
    const clock = formatClockSeconds(
      moment.player_clock_remaining ?? moment.clock_remaining
    );
    const better = bestLabel(moment);
    const parts = [
      `The evaluation reached ${formatPawns(inFavour)} in your favour at move ${moment.move_number}.`,
      `You played ${signedMoveLabel(moment)}${clock ? ` with ${clock} left on the clock` : ""}.`,
    ];
    if (better) {
      parts.push(`The engine's pick was ${better}.`);
    }
    return {
      badge:
        outcome === "loss" || outcome === "draw" ? "MISSED_WIN_CHOKE" : "MISSED_WIN",
      text: parts.join(" "),
    };
  }

  const swing = moments
    .map((moment) => ({
      moment,
      loss: finite(moment.centipawn_loss) ?? 0,
    }))
    .filter((entry) => entry.loss >= 200)
    .sort((a, b) => b.loss - a.loss)[0];

  if (!swing) {
    return null;
  }

  const { moment, loss } = swing;
  const clock = formatClockSeconds(
    moment.player_clock_remaining ?? moment.clock_remaining
  );
  const better = bestLabel(moment);
  const parts = [
    `On move ${moment.move_number} you played ${signedMoveLabel(moment)}${clock ? ` with ${clock} on the clock` : ""}.`,
    `The evaluation swung ${(loss / 100).toFixed(1)} pawns on that single move.`,
  ];
  if (better) {
    parts.push(`The engine's pick was ${better}.`);
  }
  return { badge: "CRITICAL_EVAL_SWING", text: parts.join(" ") };
}

type ChokeCardProps = {
  insights?: InsightsData | null;
};

/** The showcase's choke-verification strip, rendered only with real evidence. */
export default function ChokeCard({ insights }: ChokeCardProps) {
  const evidence = deriveChokeEvidence(insights);
  if (!evidence) {
    return null;
  }
  return (
    <section className="review-choke" aria-label="Critical choke verification">
      <div className="review-choke-head">
        <b className="review-choke-title">Critical Choke Verification Engine:</b>
        <span className="review-choke-badge">{evidence.badge}</span>
      </div>
      <p className="review-choke-text">{evidence.text}</p>
    </section>
  );
}
