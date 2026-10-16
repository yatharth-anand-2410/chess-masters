import React from "react";
import type { ProgressReport } from "../../lib/api";
import EmptyPanel from "./EmptyPanel";
import { asArray, formatNumber, formatSigned } from "./progressUtils";
import { polygonPoints } from "./chartGeometry";

type Props = {
  report: ProgressReport;
};

const SIZE = 260;
const CX = SIZE / 2;
const CY = SIZE / 2;

function radarPoint(index: number, score: number, count: number) {
  const radiusMax = 84;
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  const clamped = Math.max(0, Math.min(100, score));
  const radius = radiusMax * (clamped / 100);
  return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
}

function ringPoints(radius: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
  });
}

/**
 * Psychology radar: dashed baseline ghost vs filled current profile, plus the
 * dimension-by-dimension comparison. Every vertex is a real backend score.
 */
export default function RadarOverlay({ report }: Props) {
  const metrics = asArray(report.radar);
  const count = metrics.length;
  const insufficient = report.insufficient === true;
  const hasRadar = count >= 3;

  return (
    <section className="progress-radar-section" aria-label="Psychology radar comparison">
      <div className="progress-section-head">
        <div>
          <h2 className="progress-section-title">Psychology Radar: Baseline vs Current</h2>
          <p className="progress-section-sub">
            Ghost outline is the window baseline; the filled shape is current form
          </p>
        </div>
        <div className="progress-radar-legend">
          <span className="is-baseline">--- Baseline</span>
          <span className="is-current">● Current</span>
        </div>
      </div>

      <div className="progress-radar-grid">
        <div className="progress-card progress-radar-card">
          {hasRadar ? (
            <div className="progress-radar-holder">
              <svg
                viewBox={`0 0 ${SIZE} ${SIZE}`}
                className="progress-radar-svg"
                role="img"
                aria-label="Radar chart comparing baseline and current psychology scores"
              >
                {/* Rings */}
                <polygon
                  points={polygonPoints(ringPoints(84, count))}
                  fill="none"
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth="1"
                />
                <polygon
                  points={polygonPoints(ringPoints(42, count))}
                  fill="none"
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth="1"
                />
                {/* Spokes */}
                {ringPoints(84, count).map((point, index) => (
                  <line
                    key={`spoke-${index}`}
                    x1={CX}
                    y1={CY}
                    x2={point.x}
                    y2={point.y}
                    stroke="rgba(255,255,255,0.1)"
                  />
                ))}
                {/* Baseline ghost */}
                <polygon
                  points={polygonPoints(
                    metrics.map((metric, index) => radarPoint(index, metric.baseline_score, count))
                  )}
                  fill="none"
                  stroke="rgba(255,255,255,0.35)"
                  strokeDasharray="3,3"
                  strokeWidth="1.5"
                />
                {/* Current form */}
                <polygon
                  points={polygonPoints(
                    metrics.map((metric, index) => radarPoint(index, metric.current_score, count))
                  )}
                  fill="rgba(6,182,212,0.2)"
                  stroke="var(--cyan)"
                  strokeWidth="2"
                />
                {metrics.map((metric, index) => {
                  const point = radarPoint(index, metric.current_score, count);
                  const tone =
                    metric.delta > 0
                      ? "var(--green-bright)"
                      : metric.delta < 0
                        ? "var(--red-bright)"
                        : "var(--text-muted)";
                  return (
                    <circle key={`dot-${metric.dimension}-${index}`} cx={point.x} cy={point.y} r="3.5" fill={tone} />
                  );
                })}
                {/* Dimension labels */}
                {metrics.map((metric, index) => {
                  const labelPoint = ringPoints(104, count)[index];
                  const anchor =
                    Math.abs(labelPoint.x - CX) < 10 ? "middle" : labelPoint.x < CX ? "end" : "start";
                  return (
                    <text
                      key={`label-${metric.dimension}-${index}`}
                      x={labelPoint.x}
                      y={labelPoint.y + 3}
                      fill="var(--text-muted)"
                      fontSize="9.5"
                      fontFamily="var(--font-mono)"
                      textAnchor={anchor}
                    >
                      {metric.dimension}
                    </text>
                  );
                })}
              </svg>
            </div>
          ) : (
            <EmptyPanel
              message={
                insufficient
                  ? "Analyze 4+ games to unlock this panel."
                  : "Not enough psychology dimensions to draw a radar yet."
              }
              hint="The radar needs at least 3 scored dimensions from the analyzed games."
            />
          )}
        </div>

        <div className="progress-card progress-radar-table-card">
          <h3 className="progress-card-title">Dimension Comparison</h3>
          {hasRadar ? (
            <div className="progress-dim-table" role="table" aria-label="Radar dimension comparison">
              <div className="progress-dim-row is-head" role="row">
                <span role="columnheader">Dimension</span>
                <span role="columnheader">Baseline</span>
                <span role="columnheader">Current</span>
                <span role="columnheader">Δ</span>
              </div>
              {metrics.map((metric, index) => {
                const tone = metric.delta > 0 ? "is-up" : metric.delta < 0 ? "is-down" : "is-flat";
                return (
                  <div className="progress-dim-row" role="row" key={`${metric.dimension}-${index}`}>
                    <span className="progress-dim-name" role="cell">
                      {metric.dimension}
                    </span>
                    <span className="progress-dim-score" role="cell">
                      {formatNumber(metric.baseline_score, 0)}
                    </span>
                    <span className="progress-dim-score is-current" role="cell">
                      {formatNumber(metric.current_score, 0)}
                    </span>
                    <span className={`progress-dim-delta ${tone}`} role="cell">
                      {formatSigned(metric.delta, 0)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="progress-inline-note">Dimension scores appear once enough games are analyzed.</p>
          )}
        </div>
      </div>
    </section>
  );
}
