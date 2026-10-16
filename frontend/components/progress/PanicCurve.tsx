import React from "react";
import type { ProgressReport } from "../../lib/api";
import EmptyPanel from "./EmptyPanel";
import { gridValues, severityColor } from "./chartGeometry";
import { asArray, formatNumber, pluralize } from "./progressUtils";

type Props = {
  panic: ProgressReport["panic"];
  insufficient: boolean;
  gamesUsed: number;
};

const W = 520;
const H = 172;
const LEFT = 40;
const RIGHT = 504;
const TOP = 22;
const BOTTOM = 126;

/** Blunder frequency per remaining-clock bucket — the "panic curve". */
export default function PanicCurve({ panic, insufficient, gamesUsed }: Props) {
  const buckets = asArray(panic);
  const usable = buckets.length > 0;
  const maxPercentage = Math.max(1, ...buckets.map((bucket) => bucket.percentage || 0));
  const scaleMax = maxPercentage * 1.18;

  const toY = (percentage: number) =>
    BOTTOM - (Math.max(0, Math.min(scaleMax, percentage)) / scaleMax) * (BOTTOM - TOP);

  const slot = buckets.length ? (RIGHT - LEFT) / buckets.length : RIGHT - LEFT;
  const barWidth = Math.min(56, slot * 0.56);
  const worst = buckets.find((bucket) => bucket.worst) ?? null;
  const worstIndex = worst ? buckets.indexOf(worst) : -1;
  const totalBlunders = buckets.reduce((sum, bucket) => sum + (bucket.blunders || 0), 0);
  const grid = gridValues(0, maxPercentage, 3);

  return (
    <div className="progress-card progress-chart-card">
      <div className="progress-chart-head">
        <div>
          <div className="progress-chart-title-row">
            <b>Blunder Frequency by Clock Level</b>
            {worst ? (
              <span className="progress-pill progress-pill-red">Danger zone: {worst.bucket}</span>
            ) : null}
          </div>
          <p className="progress-chart-sub">
            {usable
              ? `${totalBlunders} ${pluralize(totalBlunders, "blunder")} distributed across remaining-time buckets in this window`
              : "Blunder share per remaining-clock bucket"}
          </p>
        </div>
        <div className="progress-chart-legend">
          <span className="is-muted">● {gamesUsed} {pluralize(gamesUsed, "game")} analysed</span>
        </div>
      </div>

      {usable ? (
        <div className="progress-chart-holder">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="progress-chart-svg"
            role="img"
            aria-label="Blunder frequency by clock level"
          >
            {worstIndex >= 0 ? (
              <rect
                x={LEFT + slot * worstIndex + 2}
                y={TOP - 6}
                width={Math.max(0, slot - 4)}
                height={BOTTOM - TOP + 12}
                rx="4"
                fill="rgba(125,53,39,0.15)"
              />
            ) : null}

            {grid.map((value, index) => {
              const y = toY(value);
              return (
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
                    {formatNumber(value, 0)}%
                  </text>
                </g>
              );
            })}

            {buckets.map((bucket, index) => {
              const percentage = Math.max(0, bucket.percentage || 0);
              const y = toY(percentage);
              const height = Math.max(2, BOTTOM - y);
              const x = LEFT + slot * index + (slot - barWidth) / 2;
              const color = bucket.worst ? "var(--red-bright)" : severityColor(percentage);
              return (
                <g key={`${bucket.bucket}-${index}`}>
                  <rect x={x} y={y} width={barWidth} height={height} rx="3" fill={color} opacity="0.9" />
                  <text
                    x={x + barWidth / 2}
                    y={y - 6}
                    fill={color}
                    fontSize="10"
                    fontFamily="var(--font-mono)"
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    {formatNumber(percentage)}%
                  </text>
                  <text
                    x={x + barWidth / 2}
                    y={BOTTOM + 16}
                    fill="var(--text-muted)"
                    fontSize="9"
                    fontFamily="var(--font-mono)"
                    textAnchor="middle"
                  >
                    {bucket.bucket}
                  </text>
                  <text
                    x={x + barWidth / 2}
                    y={BOTTOM + 28}
                    fill="var(--text-muted)"
                    fontSize="8.5"
                    fontFamily="var(--font-mono)"
                    textAnchor="middle"
                    opacity="0.75"
                  >
                    {typeof bucket.blunders === "number" && typeof bucket.games === "number"
                      ? `${bucket.blunders}/${bucket.games} games`
                      : ""}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <EmptyPanel
          message={
            insufficient
              ? "Analyze 4+ games to unlock this panel."
              : "No clock-level blunder data in this window yet."
          }
          hint="Clock buckets need games with move times captured by the analyzer."
        />
      )}
    </div>
  );
}
