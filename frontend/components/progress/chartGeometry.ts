/**
 * Tiny SVG chart geometry helpers shared by the progress telemetry charts.
 * Everything is computed from the real series values handed in by the backend —
 * no chart in this workstream ever invents data points.
 */

export type PlotPoint = { x: number; y: number; value: number };

const round2 = (value: number) => Math.round(value * 100) / 100;

export type ValueScale = {
  /** Padded data min / max (the range actually mapped onto the plot). */
  min: number;
  max: number;
  toY: (value: number) => number;
};

export function makeValueScale(
  values: Array<number | null | undefined>,
  top: number,
  bottom: number,
  paddingRatio = 0.08
): ValueScale {
  const finite = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  let min = finite.length ? Math.min(...finite) : 0;
  let max = finite.length ? Math.max(...finite) : 1;
  if (min === max) {
    const bump = Math.abs(min) * 0.05 || 1;
    min -= bump;
    max += bump;
  }
  const pad = (max - min) * paddingRatio;
  min -= pad;
  max += pad;
  const span = max - min || 1;
  return {
    min,
    max,
    toY: (value: number) => {
      const clamped = Math.max(min, Math.min(max, value));
      return top + ((max - clamped) / span) * (bottom - top);
    },
  };
}

export function xAt(index: number, count: number, left: number, right: number): number {
  if (count <= 1) return (left + right) / 2;
  return left + (index * (right - left)) / (count - 1);
}

/** Grid line values between min and max (ascending). */
export function gridValues(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || count < 2) return [];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, index) => min + step * index);
}

/**
 * "M/L" path across the points. `null` entries break the line into segments so
 * a missing game never draws a fake straight segment across the gap.
 */
export function buildStrokePath(points: Array<PlotPoint | null>): string {
  let path = "";
  let penDown = false;
  for (const point of points) {
    if (!point) {
      penDown = false;
      continue;
    }
    path += `${penDown ? "L" : "M"} ${round2(point.x)},${round2(point.y)} `;
    penDown = true;
  }
  return path.trim();
}

/** Closed area under a line. Only safe when the series has no gaps. */
export function buildAreaPath(points: Array<PlotPoint | null>, baseY: number): string {
  if (!points.length || points.some((point) => !point)) return "";
  const line = buildStrokePath(points);
  if (!line) return "";
  const first = points[0] as PlotPoint;
  const last = points[points.length - 1] as PlotPoint;
  return `${line} L ${round2(last.x)},${round2(baseY)} L ${round2(first.x)},${round2(baseY)} Z`;
}

export function polygonPoints(points: Array<{ x: number; y: number }>): string {
  return points.map((point) => `${round2(point.x)},${round2(point.y)}`).join(" ");
}

/** Heat colour used by the panic buckets and root-cause bars. */
export function severityColor(value: number): string {
  if (value >= 25) return "var(--red-bright)";
  if (value >= 12) return "var(--warn)";
  return "var(--teal-light)";
}
