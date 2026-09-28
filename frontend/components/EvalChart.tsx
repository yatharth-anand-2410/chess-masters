"use client";

import { useMemo } from "react";

type EvalChartProps = {
  data?: string;
};

const WIDTH = 640;
const HEIGHT = 200;
const PAD = 12;
const DISPLAY_CAP_PAWNS = 10;

function parseEval(data?: string): number[] {
  if (!data) {
    return [];
  }
  try {
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) {
      return parsed
        .map(Number)
        .filter((value) => Number.isFinite(value))
        .map((value) =>
          Math.max(-DISPLAY_CAP_PAWNS, Math.min(DISPLAY_CAP_PAWNS, value))
        );
    }
  } catch {
    return [];
  }
  return [];
}

export default function EvalChart({ data }: EvalChartProps) {
  const values = useMemo(() => parseEval(data), [data]);

  if (values.length === 0) {
    return null;
  }

  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const stepX = (WIDTH - PAD * 2) / Math.max(values.length - 1, 1);

  const points = values.map((value, index) => ({
    x: PAD + index * stepX,
    y: PAD + ((max - value) / range) * (HEIGHT - PAD * 2),
  }));

  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const zeroY = PAD + (max / range) * (HEIGHT - PAD * 2);

  return (
    <div className="eval-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Evaluation chart">
        <line
          x1={PAD}
          y1={zeroY}
          x2={WIDTH - PAD}
          y2={zeroY}
          className="eval-zero"
        />
        <polyline points={polyline} className="eval-line" fill="none" />
      </svg>
    </div>
  );
}