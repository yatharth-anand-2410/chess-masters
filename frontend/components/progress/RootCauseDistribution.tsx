import React from "react";
import type { ProgressReport } from "../../lib/api";
import EmptyPanel from "./EmptyPanel";
import { asArray, formatNumber, pluralize } from "./progressUtils";

type Props = {
  rootCauses: ProgressReport["root_causes"];
  insufficient: boolean;
  gamesUsed: number;
};

const BAR_COLORS = [
  "var(--red-bright)",
  "var(--warn)",
  "var(--gold-bright)",
  "var(--cyan)",
  "var(--teal-light)",
];

/** Blunder root-cause distribution as horizontal bars (real counts + shares). */
export default function RootCauseDistribution({ rootCauses, insufficient, gamesUsed }: Props) {
  const causes = asArray(rootCauses);
  const totalBlunders = causes.reduce((sum, cause) => sum + (cause.count || 0), 0);

  return (
    <section className="progress-card progress-rootcause-card" aria-label="Blunder root cause distribution">
      <div className="progress-section-head">
        <div>
          <h2 className="progress-section-title">Blunder Root Cause Distribution</h2>
          <p className="progress-section-sub">
            {causes.length > 0
              ? `Categorising ${totalBlunders} ${pluralize(totalBlunders, "blunder")} across ${gamesUsed} analysed ${pluralize(gamesUsed, "game")}`
              : "How the blunders in this window break down by motif"}
          </p>
        </div>
      </div>

      {causes.length > 0 ? (
        <div className="progress-rootcause-list">
          {causes.map((cause, index) => {
            const color = BAR_COLORS[index % BAR_COLORS.length];
            const width = Math.max(1, Math.min(100, cause.percentage || 0));
            return (
              <div className="progress-rootcause-row" key={`${cause.category}-${index}`}>
                <div className="progress-rootcause-head">
                  <span className="progress-rootcause-name">
                    {cause.category}
                    {cause.primary_motif ? (
                      <span className="progress-rootcause-motif"> · {cause.primary_motif}</span>
                    ) : null}
                  </span>
                  <span className="progress-rootcause-count" style={{ color }}>
                    {formatNumber(cause.count ?? null, 0)} {pluralize(cause.count ?? 0, "blunder")} (
                    {formatNumber(cause.percentage ?? null, 0)}%)
                  </span>
                </div>
                <div className="progress-bar-track">
                  <div className="progress-bar-fill" style={{ width: `${width}%`, background: color }} />
                </div>
                {cause.description ? (
                  <p className="progress-rootcause-desc">{cause.description}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyPanel
          message={
            insufficient
              ? "Analyze 4+ games to unlock this panel."
              : "No blunders were categorised in this window."
          }
          hint="Root causes are classified from the engine-graded blunders in each analyzed game."
        />
      )}
    </section>
  );
}
