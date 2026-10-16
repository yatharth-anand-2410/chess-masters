import React from "react";
import type { ProgressMovementItem, ProgressReport } from "../../lib/api";
import EmptyPanel from "./EmptyPanel";
import { asArray, formatMetricValue, pluralize } from "./progressUtils";

type Props = {
  report: ProgressReport;
};

function deltaModel(item: ProgressMovementItem) {
  const improved = item.higher_is_better ? item.delta > 0 : item.delta < 0;
  const worsened = item.higher_is_better ? item.delta < 0 : item.delta > 0;
  const magnitude = formatMetricValue(Math.abs(item.delta), item.unit);
  const text = item.delta > 0 ? `+${magnitude}` : item.delta < 0 ? `-${magnitude}` : magnitude;
  return {
    improved,
    worsened,
    text,
    arrow: improved ? "↑" : worsened ? "↓" : "→",
    tone: improved ? "is-up" : worsened ? "is-down" : "is-flat",
  };
}

/**
 * Transparent before/after movement matrix built from the real `movement`
 * items of the report. Items the backend flagged as insufficient are skipped
 * and called out instead of being drawn with fake numbers.
 */
export default function MovementMatrix({ report }: Props) {
  const allItems = asArray(report.movement);
  const items = allItems.filter((item) => !item.insufficient);
  const skipped = allItems.filter((item) => item.insufficient);
  const gamesUsed = typeof report.games_used === "number" ? report.games_used : 0;
  const name = (report.student_name || "this player").trim();

  return (
    <section className="progress-matrix-card" aria-label="Transparent before and after movement matrix">
      <div className="progress-section-head">
        <div>
          <h2 className="progress-section-title">Transparent Movement &amp; Culmination</h2>
          <p className="progress-section-sub">
            Tracking exactly how {name} moved from the window baseline to current form
          </p>
        </div>
        <span className="progress-pill progress-pill-gold">
          {gamesUsed} {pluralize(gamesUsed, "game")} benchmark
        </span>
      </div>

      {items.length > 0 ? (
        <div className="progress-matrix-grid">
          {items.map((item) => {
            const delta = deltaModel(item);
            return (
              <div key={item.key} className="progress-matrix-item">
                <span className="progress-matrix-label">{item.label}</span>
                <div className="progress-matrix-val">
                  <span>{formatMetricValue(item.before, item.unit)}</span>
                  <span className="progress-matrix-arrow" aria-hidden="true">
                    ➔
                  </span>
                  <span>{formatMetricValue(item.after, item.unit)}</span>
                </div>
                <span className={`progress-matrix-delta ${delta.tone}`}>
                  {delta.text} {delta.arrow}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyPanel
          message={
            report.insufficient
              ? "Analyze 4+ games to unlock this panel."
              : "No comparable movement metrics in this window yet."
          }
          hint={
            report.insufficient
              ? "Before/after deltas need at least 4 analyzed games in the selected filters."
              : null
          }
        />
      )}

      {skipped.length > 0 ? (
        <p className="progress-inline-note">
          Needs 4+ games for: {skipped.map((item) => item.label).join(", ")}.
        </p>
      ) : null}
    </section>
  );
}
