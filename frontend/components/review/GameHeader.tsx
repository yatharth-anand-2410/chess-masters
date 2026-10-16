"use client";

import type { ReactNode } from "react";

/** Open the shared AI coach drawer from anywhere in the review surface. */
export function openCoachDrawer(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent("open-ai-coach-drawer"));
}

type GameHeaderProps = {
  /** Platform / speed pill, e.g. "Blitz 5+3 · Lichess". */
  pill?: string | null;
  title: string;
  /** Meta line rendered under the title. */
  meta?: ReactNode;
  /** Game id rendered as `<code>` at the end of the meta line. */
  gameId?: string | null;
  /** Render the `Jump to Drills ▾` anchor (only when the report has drills). */
  showDrills?: boolean;
  /** External link back to the original game. */
  externalUrl?: string | null;
  externalLabel?: string | null;
};

/**
 * The paper-canvas header from the showcase: platform pill, personalized
 * title, meta line and the two canvas actions.
 */
export default function GameHeader({
  pill,
  title,
  meta,
  gameId,
  showDrills = false,
  externalUrl,
  externalLabel,
}: GameHeaderProps) {
  return (
    <header className="review-game-header">
      <div className="review-game-header-main">
        {pill && <span className="review-pill-paper">{pill}</span>}
        <h1 className="review-game-header-title">{title}</h1>
        {(meta || gameId) && (
          <p className="review-game-header-meta">
            {meta}
            {meta && gameId ? " · " : null}
            {gameId ? (
              <>
                Game ID: <code>{gameId}</code>
              </>
            ) : null}
          </p>
        )}
      </div>

      <div className="review-game-header-actions">
        {showDrills && (
          <a className="review-btn-paper" href="#drills">
            Jump to Drills ▾
          </a>
        )}
        {externalUrl && (
          <a
            className="review-btn-outline"
            href={externalUrl}
            target="_blank"
            rel="noreferrer"
          >
            {externalLabel ?? "Open game"} ↗
          </a>
        )}
        <button type="button" className="review-btn-outline" onClick={openCoachDrawer}>
          Ask Coach ⌘K
        </button>
      </div>
    </header>
  );
}
