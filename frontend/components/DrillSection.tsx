import type { ReactNode } from "react";

import DrillCard from "./DrillCard";
import { ClockIcon, ExternalLinkIcon, SwordsIcon } from "./ReportIcons";
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
 * Resources rebuilt as replayable challenges rather than a list of links.
 *
 * Every drill is a position the player actually reached, so the section reads
 * as "fix what you just did" instead of "go study something".
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

  if (drills.length === 0 && extras.length === 0) {
    return fallback ? <>{fallback}</> : null;
  }

  const clockBucket = worstClockBucket(psychology);

  return (
    <section className="drill-section" id={anchorId} aria-label="Tactical drills">
      {drills.length > 0 && (
        <>
          <header className="drill-section-head">
            <h3 className="drill-section-title">
              <SwordsIcon className="drill-section-icon" />
              Replay your mistakes
            </h3>
            <p className="drill-section-lede">
              These are your own positions. Find the move you missed.
            </p>
          </header>

          {clockBucket && (
            <p className="drill-clock">
              <ClockIcon className="drill-clock-icon" />
              Most of your blunders came with <strong>{clockBucket}</strong> left on the clock.
            </p>
          )}

          <div className="drill-grid">
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
        </>
      )}

      {extras.length > 0 && (
        <div className="drill-extras">
          <h4 className="drill-extras-title">Also worth studying</h4>
          <ul className="drill-extras-list">
            {extras.map((resource) => (
              <li key={resource.url}>
                <a
                  className="drill-extras-link"
                  href={resource.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="drill-extras-label">{resource.title}</span>
                  {resource.source_move && (
                    <span className="drill-extras-move">{resource.source_move}</span>
                  )}
                  <ExternalLinkIcon className="drill-extras-icon" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {fallback && (
        <details className="report-details">
          <summary className="report-details-summary">
            Read the coach&apos;s full notes
          </summary>
          <div className="report-details-body">{fallback}</div>
        </details>
      )}
    </section>
  );
}
