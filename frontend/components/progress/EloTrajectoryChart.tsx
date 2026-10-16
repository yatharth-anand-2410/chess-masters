import React from "react";
import type { ProgressReport, ProgressSeriesPoint } from "../../lib/api";
import EmptyPanel from "./EmptyPanel";
import {
  buildAreaPath,
  buildStrokePath,
  gridValues,
  makeValueScale,
  xAt,
  type PlotPoint,
} from "./chartGeometry";
import { asArray, formatDateLabel, formatNumber, formatSigned } from "./progressUtils";

type Props = {
  elo: ProgressReport["elo"];
  insufficient: boolean;
};

const W = 520;
const H = 170;
const LEFT = 48;
const RIGHT = 504;
const TOP = 18;
const BOTTOM = 132;

function resultColor(result: ProgressSeriesPoint["result"]): string {
  if (result === "win") return "var(--green-bright)";
  if (result === "loss") return "var(--red-bright)";
  return "var(--text-muted)";
}

/** Ratings are never 0 in chess — a 0 means "not captured", so it is not plotted. */
function ratingLabel(value: number | null | undefined): string {
  return typeof value === "number" && value > 0 ? formatNumber(value, 0) : "—";
}

/** Real-rating Elo trajectory with a gold area fill and per-game result dots. */
export default function EloTrajectoryChart({ elo, insufficient }: Props) {
  const points = asArray(elo?.series).filter(
    (point): point is ProgressSeriesPoint & { rating: number } =>
      typeof point?.rating === "number" && Number.isFinite(point.rating) && point.rating > 0
  );
  const usable = points.length >= 2;
  const scale = makeValueScale(
    points.map((point) => point.rating),
    TOP,
    BOTTOM
  );
  const plot: PlotPoint[] = points.map((point, index) => ({
    x: xAt(index, points.length, LEFT, RIGHT),
    y: scale.toY(point.rating),
    value: point.rating,
  }));
  const line = buildStrokePath(plot);
  const area = buildAreaPath(plot, BOTTOM);
  const grid = gridValues(scale.min, scale.max, 4);
  const netGain = typeof elo?.net_gain === "number" ? elo.net_gain : null;
  const latest = plot.length ? plot[plot.length - 1] : null;

  return (
    <div className="progress-card progress-chart-card">
      <div className="progress-chart-head">
        <div>
          <div className="progress-chart-title-row">
            <b>Elo Rating Trajectory</b>
            {netGain !== null && netGain !== 0 ? (
              <span className={`progress-pill ${netGain > 0 ? "progress-pill-green" : "progress-pill-red"}`}>
                {formatSigned(netGain, 0)} Net Elo
              </span>
            ) : null}
          </div>
          <p className="progress-chart-sub">
            {elo?.status ? elo.status : "Rating movement across the filtered games"}
          </p>
        </div>
        <div className="progress-chart-legend">
          <span className="is-muted">● Baseline {ratingLabel(elo?.starting)}</span>
          <span className="is-gold">● Current {ratingLabel(elo?.current)}</span>
          <span className="is-cyan">● Peak {ratingLabel(elo?.peak)}</span>
        </div>
      </div>

      {usable ? (
        <div className="progress-chart-holder">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="progress-chart-svg"
            role="img"
            aria-label="Elo rating trajectory"
          >
            <defs>
              <linearGradient id="progressEloGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#c9993f" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#c9993f" stopOpacity="0" />
              </linearGradient>
            </defs>

            {grid.map((value, index) => {
              const y = scale.toY(value);
              return (
                <g key={`grid-${index}`}>
                  <line
                    x1={LEFT}
                    y1={y}
                    x2={RIGHT}
                    y2={y}
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth="1"
                  />
                  <text
                    x={LEFT - 6}
                    y={y + 3}
                    fill="var(--text-muted)"
                    fontSize="9"
                    fontFamily="var(--font-mono)"
                    textAnchor="end"
                  >
                    {formatNumber(value, 0)}
                  </text>
                </g>
              );
            })}

            <line x1={LEFT} y1={TOP - 4} x2={LEFT} y2={BOTTOM} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
            <line x1={LEFT} y1={BOTTOM} x2={RIGHT} y2={BOTTOM} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />

            {area ? <path d={area} fill="url(#progressEloGrad)" /> : null}
            <path
              d={line}
              fill="none"
              stroke="var(--gold-bright)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {plot.map((point, index) => (
              <circle
                key={`dot-${index}`}
                cx={point.x}
                cy={point.y}
                r="3.5"
                fill={resultColor(points[index]?.result ?? null)}
              />
            ))}
            {latest ? (
              <circle cx={latest.x} cy={latest.y} r="4.5" fill="var(--gold-bright)" stroke="#fff" strokeWidth="1.5" />
            ) : null}

            <text
              x={LEFT}
              y={BOTTOM + 20}
              fill="var(--text-muted)"
              fontSize="9"
              fontFamily="var(--font-mono)"
              textAnchor="start"
            >
              {formatDateLabel(points[0]?.date) || "Game 1"}
            </text>
            {points.length > 4 ? (
              <text
                x={xAt(Math.floor(points.length / 2), points.length, LEFT, RIGHT)}
                y={BOTTOM + 20}
                fill="var(--text-muted)"
                fontSize="9"
                fontFamily="var(--font-mono)"
                textAnchor="middle"
              >
                {formatDateLabel(points[Math.floor(points.length / 2)]?.date)}
              </text>
            ) : null}
            <text
              x={RIGHT}
              y={BOTTOM + 20}
              fill="var(--gold-bright)"
              fontSize="9"
              fontFamily="var(--font-mono)"
              textAnchor="end"
            >
              Latest
            </text>
          </svg>
        </div>
      ) : (
        <EmptyPanel
          message={
            insufficient
              ? "Analyze 4+ games to unlock this panel."
              : "Needs at least 2 rated games in this window."
          }
          hint="The trajectory plots the player rating captured in each analyzed game."
        />
      )}
    </div>
  );
}
