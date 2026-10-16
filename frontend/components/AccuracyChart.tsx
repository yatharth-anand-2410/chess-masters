"use client";

import React, { useMemo } from "react";
import PhaseMatrix from "./review/PhaseMatrix";

type AccuracyChartProps = {
  data?: string;
};

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

/**
 * The `<AccuracyChart data="[opening, middlegame, endgame]">` tag the reports
 * embed. It renders the same phase matrix as the real `insights` data so an
 * older report that only carried the tag still gets the showcase layout.
 */
export default function AccuracyChart({ data }: AccuracyChartProps) {
  const values = useMemo(() => parseAccuracy(data), [data]);

  if (values.length === 0) {
    return null;
  }

  return (
    <PhaseMatrix
      variant="bars"
      opening={values[0] ?? null}
      middlegame={values[1] ?? null}
      endgame={values[2] ?? null}
    />
  );
}
