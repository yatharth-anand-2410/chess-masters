import type { ReactNode } from "react";

import {
  BulbIcon,
  CheckIcon,
  ClockIcon,
  PawnIcon,
  ShieldIcon,
  SwordsIcon,
  XIcon,
} from "./ReportIcons";
import type { FocusPair } from "./reportParsing";

/** Pick the icon that actually describes the habit, rather than a random glyph. */
function iconFor(value: string) {
  const text = value.toLowerCase();
  if (/\b(clock|time|rush|hurry|seconds|minutes|think|slow)\b/.test(text)) {
    return ClockIcon;
  }
  if (/\b(pawn|structure|isolated|doubled|backward|passed)\b/.test(text)) {
    return PawnIcon;
  }
  if (/\b(defend|defence|defense|prophylaxis|safe|safety|guard|protect|king)\b/.test(text)) {
    return ShieldIcon;
  }
  if (/\b(attack|tactic|fork|pin|skewer|capture|threat|forcing|check|sacrifice)\b/.test(text)) {
    return SwordsIcon;
  }
  return BulbIcon;
}

type FocusAreasBoardProps = {
  pairs: FocusPair[];
  /** Original coach prose, kept reachable so a parse never hides content. */
  fallback?: ReactNode;
};

/**
 * Focus Areas as a contrastive Do / Don't list.
 *
 * A binary split is scannable before it is read: the reader sees what to stop
 * and what to start without parsing a paragraph. Rows degrade to a neutral
 * card when a bullet cannot be split cleanly.
 */
export default function FocusAreasBoard({ pairs, fallback }: FocusAreasBoardProps) {
  if (pairs.length === 0) {
    return fallback ? <>{fallback}</> : null;
  }

  return (
    <section className="focus-board" aria-label="Focus areas">
      {pairs.map((pair, index) => {
        const isPrimary = index === 0;
        const rowClass = `focus-row${isPrimary ? " is-primary" : ""}`;

        if (pair.kind === "raw") {
          const RawIcon = iconFor(pair.raw);
          return (
            <article className={`${rowClass} focus-row-raw`} key={pair.raw}>
              <span className="focus-rank" aria-hidden="true">
                {index + 1}
              </span>
              <div className="focus-cell">
                <span className="focus-tag focus-tag-do">
                  <RawIcon className="focus-icon" />
                  Work on
                </span>
                <p className="focus-text">{pair.raw}</p>
              </div>
            </article>
          );
        }

        if (pair.kind === "labelled") {
          // The shape the coach already writes: a concept, then the tip.
          const LabelIcon = iconFor(`${pair.label} ${pair.detail}`);
          return (
            <article className={`${rowClass} focus-row-raw`} key={`${pair.label}-${pair.detail}`}>
              <span className="focus-rank" aria-hidden="true">
                {index + 1}
              </span>
              <div className="focus-cell focus-cell-labelled">
                <span className="focus-label">
                  <LabelIcon className="focus-label-icon" />
                  {pair.label}
                </span>
                <p className="focus-text">{pair.detail}</p>
              </div>
            </article>
          );
        }

        const DoIcon = iconFor(pair.doText);
        return (
          <article className={rowClass} key={`${pair.dontText}-${pair.doText}`}>
            <span className="focus-rank" aria-hidden="true">
              {index + 1}
            </span>
            <div className="focus-pair">
              <div className="focus-cell focus-dont">
                <span className="focus-tag focus-tag-dont">
                  <XIcon className="focus-icon" />
                  Don&apos;t
                </span>
                <p className="focus-text">{pair.dontText}</p>
              </div>
              <div className="focus-cell focus-do">
                <span className="focus-tag focus-tag-do">
                  <DoIcon className="focus-icon" />
                  Do
                </span>
                <p className="focus-text">{pair.doText}</p>
              </div>
            </div>
          </article>
        );
      })}

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
