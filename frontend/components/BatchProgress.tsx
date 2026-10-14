"use client";

import React from "react";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { Pill } from "./ui/Pill";

export type BatchGameState = "pending" | "active" | "done" | "failed";

export type BatchGameProgress = {
  gameUrl: string;
  state: BatchGameState;
  message?: string;
  analysisId?: string;
  openingName?: string | null;
  result?: string | null;
};

type BatchProgressProps = {
  games: BatchGameProgress[];
};

function stateLabel(state: BatchGameState): string {
  switch (state) {
    case "pending":
      return "Waiting";
    case "active":
      return "Analyzing";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    default:
      return state;
  }
}

const stateToneMap: Record<BatchGameState, "positive" | "shell" | "alert" | "neutral"> = {
  done: "positive",
  active: "shell",
  failed: "alert",
  pending: "neutral",
};

export default function BatchProgress({ games }: BatchProgressProps) {
  if (games.length === 0) {
    return null;
  }
  const done = games.filter((game) => game.state === "done").length;
  const failed = games.filter((game) => game.state === "failed").length;

  return (
    <div className="batch-progress p-4 rounded-[var(--radius-card)] bg-[var(--ink-2)] border border-[var(--line-soft)]">
      <div className="batch-progress-head flex items-center justify-between pb-2 mb-2 border-b border-[var(--line-soft)] text-xs font-mono">
        <span className="text-[var(--text)]">
          {done + failed} of {games.length} games processed
        </span>
        {failed > 0 && (
          <Pill tone="alert" size="sm">{failed} failed</Pill>
        )}
      </div>
      <ul className="batch-progress-list flex flex-col gap-2">
        {games.map((game, index) => {
          const tone = stateToneMap[game.state] ?? "neutral";
          return (
            <motion.li
              key={`${game.gameUrl}-${index}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="batch-progress-item flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[var(--ink-3)] border border-[var(--line-soft)]"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="batch-progress-index font-mono text-xs text-[var(--text-muted)] w-4 text-center shrink-0" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="batch-progress-body flex flex-col min-w-0">
                  <span className="batch-progress-url text-xs font-medium text-[var(--text)] truncate">
                    {game.openingName ?? game.gameUrl}
                  </span>
                  <span className="batch-progress-message text-[0.7rem] text-[var(--text-muted)] truncate font-mono">
                    {game.state === "done" && game.result
                      ? `Result ${game.result}`
                      : game.message ?? stateLabel(game.state)}
                  </span>
                </div>
              </div>
              <div className="shrink-0">
                <Pill
                  tone={tone}
                  size="sm"
                  icon={game.state === "active" ? <Loader2 size={10} className="animate-spin" /> : undefined}
                >
                  {stateLabel(game.state)}
                </Pill>
              </div>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
