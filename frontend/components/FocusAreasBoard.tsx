import type { ReactNode } from "react";

import type { FocusPair } from "./reportParsing";

type FocusAreasBoardProps = {
  pairs: FocusPair[];
  /** Original coach prose, kept reachable so a parse never hides content. */
  fallback?: ReactNode;
};

/**
 * Focus Areas as the showcase's Do / Don't action cards.
 *
 * Each card is a ranked habit: what to stop on the left, what to start on the
 * right. Bullets that cannot be split cleanly degrade into a single "Work on"
 * card rather than losing their text.
 */
export default function FocusAreasBoard({ pairs, fallback }: FocusAreasBoardProps) {
  if (pairs.length === 0) {
    return fallback ? <>{fallback}</> : null;
  }

  return (
    <section className="review-focus-grid" aria-label="Focus areas">
      {pairs.map((pair, index) => {
        if (pair.kind === "pair") {
          return (
            <article className="review-focus-card" key={`${pair.dontText}-${pair.doText}`}>
              <span className="review-focus-rank" aria-hidden="true">
                {index + 1}
              </span>
              <div className="review-focus-dont">
                <b>Don&apos;t:</b> {pair.dontText}
              </div>
              <div className="review-focus-do">
                <b>Do:</b> {pair.doText}
              </div>
            </article>
          );
        }

        const label = pair.kind === "labelled" ? pair.label : "Work on";
        const detail = pair.kind === "labelled" ? pair.detail : pair.raw;
        return (
          <article className="review-focus-card is-single" key={`${label}-${detail}`}>
            <span className="review-focus-rank" aria-hidden="true">
              {index + 1}
            </span>
            <div className="review-focus-do">
              <b>{label}:</b> {detail}
            </div>
          </article>
        );
      })}

      {fallback && (
        <details className="review-details">
          <summary>Read the coach&apos;s full notes</summary>
          <div className="review-details-body">{fallback}</div>
        </details>
      )}
    </section>
  );
}
