"use client";

import { useMemo } from "react";

type AccuracyChartProps = {
  data?: string;
};

const PHASE_LABELS = ["Opening", "Middlegame", "Endgame"];

function parseAccuracy(data?: string): (number | null)[] {
  if (!data) {
    return [];
  }
  try {
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) {
      return parsed.map((value) => {
        if (value === null || value === undefined || value === "") {
          return null;
        }
        const num = Number(value);
        return Number.isFinite(num) ? Math.max(0, Math.min(100, num)) : null;
      });
    }
  } catch {
    return [];
  }
  return [];
}

export default function AccuracyChart({ data }: AccuracyChartProps) {
  const values = useMemo(() => parseAccuracy(data), [data]);

  if (values.length === 0) {
    return null;
  }

  return (
    <div className="accuracy-chart" role="img" aria-label="Phase accuracy bar chart">
      {PHASE_LABELS.map((label, index) => {
        const value = values[index] ?? null;
        const isNull = value === null;
        return (
          <div className="acc-bar-group" key={label}>
            <span className="acc-value">{isNull ? "N/A" : Math.round(value)}</span>
            <div className="acc-bar-track">
              {!isNull && (
                <div className="acc-bar-fill" style={{ width: `${value}%` }} />
              )}
            </div>
            <span className="acc-label">{label}</span>
          </div>
        );
      })}
    </div>
  );
}