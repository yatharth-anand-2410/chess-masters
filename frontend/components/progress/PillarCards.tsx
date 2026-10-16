import React from "react";
import type { ProgressReport, ProgressPillarItem } from "../../lib/api";
import { asArray } from "./progressUtils";

type PillarKey = "improved" | "improving" | "needs_work";

type PillarGroup = {
  key: PillarKey;
  tone: string;
  icon: string;
  title: string;
  subtitle: string;
};

const PILLAR_GROUPS: PillarGroup[] = [
  {
    key: "improved",
    tone: "improved",
    icon: "✓",
    title: "What Has Improved",
    subtitle: "Mastered — converted into instinct",
  },
  {
    key: "improving",
    tone: "improving",
    icon: "⚡",
    title: "What Is Improving",
    subtitle: "Habits showing positive statistical drift",
  },
  {
    key: "needs_work",
    tone: "needs-work",
    icon: "⚠",
    title: "What Still Needs Work",
    subtitle: "Critical leaks costing you the most rating",
  },
];

type Props = {
  report: ProgressReport;
};

function PillarItems({
  items,
  tone,
  insufficient,
}: {
  items: ProgressPillarItem[];
  tone: PillarKey;
  insufficient: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="progress-pillar-empty">
        {insufficient
          ? "Analyze 4+ games to unlock this panel."
          : "Nothing detected in this window yet."}
      </div>
    );
  }
  return (
    <div className="progress-pillar-items">
      {items.map((item, index) => (
        <div
          key={`${tone}-${item.title}-${index}`}
          className={`progress-pillar-item${tone === "needs_work" ? " is-leak" : ""}`}
        >
          <div className="progress-pillar-item-head">
            <b>{item.title}</b>
            {item.metric ? <span className="progress-pillar-metric">{item.metric}</span> : null}
          </div>
          {item.detail ? <p className="progress-pillar-detail">{item.detail}</p> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * 3-pillar mastery tracker: What Has Improved / What Is Improving /
 * What Still Needs Work. Rendered immediately after the persona hero.
 */
export default function PillarCards({ report }: Props) {
  const pillars = report.pillars ?? ({} as ProgressReport["pillars"]);
  const insufficient = report.insufficient === true;

  return (
    <section className="progress-pillars-section" aria-label="3-pillar mastery tracker">
      <div className="progress-section-head">
        <div>
          <h2 className="progress-section-title">3-Pillar Mastery Tracker</h2>
          <p className="progress-section-sub">
            Categorised from the games in the current filter window
          </p>
        </div>
        <span className="progress-pill progress-pill-neutral">
          {typeof report.games_used === "number" ? `${report.games_used} games` : "—"}
        </span>
      </div>

      <div className="progress-three-pillar-grid">
        {PILLAR_GROUPS.map((group) => {
          const items = asArray(pillars[group.key]);
          return (
            <div key={group.key} className={`progress-pillar-card ${group.tone}`}>
              <div className={`progress-pillar-title tone-${group.tone}`}>
                <span aria-hidden="true">{group.icon}</span>
                <span>{group.title}</span>
              </div>
              <p className="progress-pillar-subtitle">{group.subtitle}</p>
              <PillarItems items={items} tone={group.key} insufficient={insufficient} />
            </div>
          );
        })}
      </div>

      {insufficient ? (
        <p className="progress-inline-note">
          Needs 4+ analyzed games in this window for a stable pillar classification.
        </p>
      ) : null}
    </section>
  );
}
