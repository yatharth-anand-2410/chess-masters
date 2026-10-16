import type { ReactNode } from "react";

import DrillCard from "./DrillCard";
import { ClockIcon, ExternalLinkIcon } from "./ReportIcons";
import type {
  InsightsData,
  InsightMoment,
  PsychologyProfile,
  Resource,
} from "./insights";
import { isDrillable } from "./reportParsing";

const MAX_DRILLS = 4;

type DrillSectionProps = {
  moments: InsightMoment[];
  insights?: InsightsData | null;
  psychology?: PsychologyProfile | null;
  anchorId?: string;
  fallback?: ReactNode;
  /** Analysis the moments belong to; enables engine-backed validation. */
  analysisId?: string | null;
};

/** Name the clock level where the player blunders most often. */
function worstClockBucket(psychology?: PsychologyProfile | null): string | null {
  const buckets = (psychology?.time_pressure ?? []).filter(
    (bucket) => bucket.moves > 0 && bucket.blunders > 0
  );
  if (buckets.length === 0) {
    return null;
  }
  const worst = buckets.reduce((a, b) => (b.rate > a.rate ? b : a), buckets[0]);
  return worst.bucket;
}

/**
 * The showcase's replay drill arena plus the curated resources deck.
 *
 * Every drill is a position the player actually reached, so the section reads
 * as "fix what you just did" instead of "go study something". The arena is the
 * dark instrument on the paper canvas; the resources below it stay on paper.
 */
export default function DrillSection({
  moments,
  insights,
  psychology,
  anchorId = "drills",
  fallback,
  analysisId,
}: DrillSectionProps) {
  const drills = [...moments]
    .filter(isDrillable)
    .sort((a, b) => b.centipawn_loss - a.centipawn_loss)
    .slice(0, MAX_DRILLS);

  const drillMoves = new Set(
    drills.map((moment) => `${moment.move_number}${moment.san}`.toLowerCase())
  );

  const extras: Resource[] = (insights?.resources ?? []).filter((resource) => {
    if (!resource.source_move) {
      return true;
    }
    const candidate = resource.source_move.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return ![...drillMoves].some((move) => candidate.endsWith(move.replace(/[^a-z0-9]/gi, "")));
  });

  if (drills.length === 0 && extras.length === 0 && !fallback) {
    return null;
  }

  const clockBucket = worstClockBucket(psychology);
  const playAs =
    insights?.player_color === "black"
      ? "Black"
      : insights?.player_color === "white"
        ? "White"
        : null;
  const firstMove = drills[0]?.move_number;

  return (
    <section
      className="review-drill-section drill-section"
      id={anchorId}
      aria-label="Tactical drills"
    >
      {drills.length > 0 && (
        <div className="review-drill-arena">
          <header className="review-arena-head">
            <div>
              <b className="review-arena-kicker">
                ⚡ Replay drill arena
                {typeof firstMove === "number" ? ` · Move ${firstMove}` : ""}
              </b>
              <p className="review-arena-lede">
                Fix the exact mistake you just made on the board
              </p>
            </div>
            {playAs && <span className="review-arena-pill">Play as {playAs}</span>}
          </header>

          {clockBucket && (
            <p className="review-arena-clock">
              <ClockIcon className="review-arena-clock-icon" />
              Most of your blunders came with <strong>{clockBucket}</strong> left on
              the clock.
            </p>
          )}

          <div className="drill-grid review-drill-grid">
            {drills.map((moment, index) => (
              <DrillCard
                key={`${moment.move_number}-${moment.san}-${index}`}
                moment={moment}
                insights={insights}
                index={index}
                analysisId={analysisId}
              />
            ))}
          </div>
        </div>
      )}

      {extras.length > 0 && (
        <div className="review-resources">
          <div className="review-section-head">
            <h3>Curated Practice Resources</h3>
            <p>
              Direct Lichess training slugs mapped to the root causes in this game
            </p>
          </div>
          <div className="review-resources-grid">
            {extras.map((resource) => (
              <a
                key={resource.url}
                className="review-resource-item"
                href={resource.url}
                target="_blank"
                rel="noreferrer"
              >
                <div>
                  <b>{resource.title}</b>
                  {resource.source_move && (
                    <div className="review-resource-move">{resource.source_move}</div>
                  )}
                </div>
                <span className="review-resource-arrow" aria-hidden="true">
                  <ExternalLinkIcon className="review-resource-icon" />
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {fallback && (
        <details className="review-details">
          <summary>Read the coach&apos;s full notes</summary>
          <div className="review-details-body">{fallback}</div>
        </details>
      )}
    </section>
  );
}
