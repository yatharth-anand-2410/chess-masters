import React from "react";
import type { ProgressReport } from "../../lib/api";
import EmptyPanel from "./EmptyPanel";
import {
  buildStrokePath,
  makeValueScale,
  xAt,
  type PlotPoint,
} from "./chartGeometry";
import { asArray, formatNumber } from "./progressUtils";

type Props = {
  accuracy: ProgressReport["accuracy"];
  acpl: ProgressReport["acpl"];
  insufficient: boolean;
};

const W = 520;
const H = 170;
const LEFT = 46;
const RIGHT = 500;
const TOP = 24;
const BOTTOM = 122;

function directionPill(direction: ProgressReport["acpl"]["direction"]) {
  if (direction === "sharpening") return { tone: "progress-pill-green", label: "Sharpening ✓" };
  if (direction === "decaying") return { tone: "progress-pill-red", label: "Decaying ⚠" };
  return { tone: "progress-pill-neutral", label: "Stable" };
}

/** Dual-axis accuracy (CAPS-style %) vs centipawn loss (ACPL) curve. */
export default function AccuracyAcplChart({ accuracy, acpl, insufficient }: Props) {
  const accuracySeries = asArray(accuracy?.series);
  const acplSeries = asArray(acpl?.series);
  const count = Math.max(accuracySeries.length, acplSeries.length);

  const accuracyValues: Array<number | null> = Array.from({ length: count }, (_, index) => {
    const value = accuracySeries[index]?.accuracy;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  });
  const acplValues: Array<number | null> = Array.from({ length: count }, (_, index) => {
    const value = acplSeries[index]?.acpl;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  });

  const brightness = accuracyValues.some((value) => value !== null);
  const loss = acplValues.some((value) => value !== null);
  const usable = count >= 2 && (brightness || loss);

  const accuracyScale = makeValueScale(accuracyValues, TOP, BOTTOM, 0.12);
  const acplScale = makeValueScale(acplValues, TOP, BOTTOM, 0.12);

  const accuracyPlot: Array<PlotPoint | null> = accuracyValues.map((value, index) =>
    value === null
      ? null
      : { x: xAt(index, count, LEFT, RIGHT), y: accuracyScale.toY(value), value }
  );
  const acplPlot: Array<PlotPoint | null> = acplValues.map((value, index) =>
    value === null ? null : { x: xAt(index, count, LEFT, RIGHT), y: acplScale.toY(value), value }
  );

  const accuracyLine = buildStrokePath(accuracyPlot);
  const acplLine = buildStrokePath(acplPlot);

  const lastAccuracy = [...accuracyPlot].reverse().find((point): point is PlotPoint => point !== null);
  const lastAcpl = [...acplPlot].reverse().find((point): point is PlotPoint => point !== null);

  const valueAtY = (scale: { min: number; max: number }, y: number) =>
    scale.max - ((y - TOP) / (BOTTOM - TOP)) * (scale.max - scale.min);

  const gridYs = [TOP + 6, (TOP + BOTTOM) / 2, BOTTOM - 6];
  const pill = directionPill(acpl?.direction ?? "stable");

  return (
    <div className="progress-card progress-chart-card">
      <div className="progress-chart-head">
        <div>
          <div className="progress-chart-title-row">
            <b>Accuracy &amp; Centipawn Loss</b>
            <span className={`progress-pill ${pill.tone}`}>{pill.label}</span>
          </div>
          <p className="progress-chart-sub">
            Accuracy (%) against average centipawn loss — lower ACPL is sharper
          </p>
        </div>
        <div className="progress-chart-legend">
          <span className="is-cyan">● Accuracy {formatNumber(accuracy?.current)}%</span>
          <span className="is-amber">● ACPL {formatNumber(acpl?.recent)}</span>
        </div>
      </div>

      {usable ? (
        <div className="progress-chart-holder">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="progress-chart-svg"
            role="img"
            aria-label="Accuracy and centipawn loss curves"
          >
            {gridYs.map((y, index) => (
              <g key={`grid-${index}`}>
                <line x1={LEFT} y1={y} x2={RIGHT} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                {brightness ? (
                  <text
                    x={LEFT - 6}
                    y={y + 3}
                    fill="var(--cyan)"
                    fontSize="9"
                    fontFamily="var(--font-mono)"
                    textAnchor="end"
                  >
                    {formatNumber(valueAtY(accuracyScale, y), 0)}%
                  </text>
                ) : null}
                {loss ? (
                  <text
                    x={RIGHT + 6}
                    y={y + 3}
                    fill="var(--warn)"
                    fontSize="9"
                    fontFamily="var(--font-mono)"
                    textAnchor="start"
                  >
                    {formatNumber(valueAtY(acplScale, y), 0)}
                  </text>
                ) : null}
              </g>
            ))}

            {accuracyLine ? (
              <path d={accuracyLine} fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            ) : null}
            {acplLine ? (
              <path
                d={acplLine}
                fill="none"
                stroke="var(--warn)"
                strokeWidth="2"
                strokeDasharray="4,3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}

            {lastAccuracy ? (
              <>
                <circle cx={lastAccuracy.x} cy={lastAccuracy.y} r="4" fill="var(--cyan)" />
                <text
                  x={lastAccuracy.x}
                  y={Math.max(TOP - 4, lastAccuracy.y - 9)}
                  fill="var(--cyan)"
                  fontSize="10"
                  fontFamily="var(--font-mono)"
                  fontWeight="700"
                  textAnchor="end"
                >
                  {formatNumber(lastAccuracy.value)}%
                </text>
              </>
            ) : null}
            {lastAcpl ? (
              <>
                <circle cx={lastAcpl.x} cy={lastAcpl.y} r="4" fill="var(--warn)" />
                <text
                  x={lastAcpl.x}
                  y={Math.min(BOTTOM + 14, lastAcpl.y + 16)}
                  fill="var(--warn)"
                  fontSize="10"
                  fontFamily="var(--font-mono)"
                  fontWeight="700"
                  textAnchor="end"
                >
                  {formatNumber(lastAcpl.value)}
                </text>
              </>
            ) : null}

            <text x={LEFT} y={BOTTOM + 20} fill="var(--text-muted)" fontSize="9" fontFamily="var(--font-mono)">
              Start
            </text>
            <text
              x={RIGHT}
              y={BOTTOM + 20}
              fill="var(--text-muted)"
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
              : "Needs at least 2 analyzed games with accuracy data."
          }
          hint="Accuracy and ACPL are captured per game; older analyses may not carry them."
        />
      )}
    </div>
  );
}
