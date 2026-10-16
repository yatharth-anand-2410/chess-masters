import React from "react";
import type { ProgressReport } from "../../lib/api";
import EmptyPanel from "./EmptyPanel";
import { buildStrokePath, makeValueScale, xAt, type PlotPoint } from "./chartGeometry";
import { asArray, formatNumber } from "./progressUtils";

type Props = {
  phases: ProgressReport["phases"];
  insufficient: boolean;
  gamesUsed: number;
};

const W = 520;
const H = 165;
const LEFT = 46;
const RIGHT = 500;
const TOP = 22;
const BOTTOM = 118;

const PHASE_SERIES = [
  { key: "opening" as const, label: "Opening", color: "var(--gold-bright)" },
  { key: "middlegame" as const, label: "Middlegame", color: "var(--teal-light)" },
  { key: "endgame" as const, label: "Endgame", color: "#a855f7" },
];

/** Phase-by-phase accuracy trend: opening vs middlegame vs endgame. */
export default function PhaseAccuracyChart({ phases, insufficient, gamesUsed }: Props) {
  const series = asArray(phases?.series);
  const count = series.length;

  const valuesByPhase = PHASE_SERIES.map(({ key }) =>
    series.map((point) => {
      const value = point?.[key];
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    })
  );
  const allValues = valuesByPhase.flat();
  const hasAny = allValues.some((value) => value !== null);
  const usable = count >= 2 && hasAny;

  const scale = makeValueScale(allValues, TOP, BOTTOM, 0.12);
  const plots = valuesByPhase.map((values) =>
    values.map((value, index) =>
      value === null ? null : { x: xAt(index, count, LEFT, RIGHT), y: scale.toY(value), value }
    )
  );

  return (
    <div className="progress-card progress-chart-card">
      <div className="progress-chart-head">
        <div>
          <div className="progress-chart-title-row">
            <b>Game Phase Accuracy Breakdown</b>
            {phases?.best_phase ? (
              <span className="progress-pill progress-pill-gold">Best: {phases.best_phase}</span>
            ) : null}
            {phases?.lagging_phase ? (
              <span className="progress-pill progress-pill-red">Lagging: {phases.lagging_phase}</span>
            ) : null}
          </div>
          <p className="progress-chart-sub">
            Tracking tactical accuracy across opening, middlegame and endgame
          </p>
        </div>
        <div className="progress-chart-legend">
          {PHASE_SERIES.map(({ key, label, color }) => {
            const current = phases?.[key]?.current;
            return (
              <span key={key} style={{ color }}>
                ● {label} ({formatNumber(current)}%)
              </span>
            );
          })}
        </div>
      </div>

      {usable ? (
        <div className="progress-chart-holder">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="progress-chart-svg"
            role="img"
            aria-label="Phase-by-phase accuracy chart"
          >
            {[TOP, (TOP + BOTTOM) / 2, BOTTOM].map((y, index) => (
              <g key={`grid-${index}`}>
                <line x1={LEFT} y1={y} x2={RIGHT} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                <text
                  x={LEFT - 6}
                  y={y + 3}
                  fill="var(--text-muted)"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                  textAnchor="end"
                >
                  {formatNumber(scale.max - ((y - TOP) / (BOTTOM - TOP)) * (scale.max - scale.min), 0)}%
                </text>
              </g>
            ))}

            {plots.map((plot, index) => {
              const path = buildStrokePath(plot);
              const color = PHASE_SERIES[index].color;
              const last = [...plot].reverse().find((point): point is PlotPoint => point !== null);
              return (
                <g key={PHASE_SERIES[index].key}>
                  {path ? (
                    <path
                      d={path}
                      fill="none"
                      stroke={color}
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}
                  {last ? <circle cx={last.x} cy={last.y} r="3.5" fill={color} /> : null}
                </g>
              );
            })}

            <text x={LEFT} y={BOTTOM + 22} fill="var(--text-muted)" fontSize="9" fontFamily="var(--font-mono)">
              Start (game 1)
            </text>
            <text
              x={RIGHT}
              y={BOTTOM + 22}
              fill="var(--text-muted)"
              fontSize="9"
              fontFamily="var(--font-mono)"
              textAnchor="end"
            >
              Latest ({gamesUsed} {gamesUsed === 1 ? "game" : "games"})
            </text>
          </svg>
        </div>
      ) : (
        <EmptyPanel
          message={
            insufficient
              ? "Analyze 4+ games to unlock this panel."
              : "Needs at least 2 analyzed games with phase accuracies."
          }
          hint="Phase accuracies are captured per game; older analyses may not carry them."
        />
      )}
    </div>
  );
}
