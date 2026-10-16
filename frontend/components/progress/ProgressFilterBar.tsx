import React from "react";
import type { SpeedBucket } from "../../lib/api";
import { SPEED_OPTIONS, pluralize } from "./progressUtils";

type Props = {
  speeds: SpeedBucket[];
  days: number | null;
  matchedGames: number | null;
  totalGames: number | null;
  onSpeedsChange: (next: SpeedBucket[]) => void;
  onDaysChange: (next: number | null) => void;
};

const WINDOW_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
  { value: null, label: "All" },
];

/**
 * Filter bar: game-type chips (All / Bullet / Blitz / Rapid / Classical) and a
 * window selector. Active chips use the showcase gold fill; the selection is
 * reflected in the URL by the page and drives the refetch.
 */
export default function ProgressFilterBar({
  speeds,
  days,
  matchedGames,
  totalGames,
  onSpeedsChange,
  onDaysChange,
}: Props) {
  const allActive = speeds.length === 0;

  const toggleSpeed = (speed: SpeedBucket) => {
    const active = speeds.includes(speed);
    const next = active ? speeds.filter((item) => item !== speed) : [...speeds, speed];
    onSpeedsChange(next);
  };

  return (
    <div className="progress-filterbar" role="group" aria-label="Progress filters">
      <div className="progress-filter-group">
        <span className="progress-filter-label">Game type</span>
        <div className="progress-chips">
          <button
            type="button"
            aria-pressed={allActive}
            className={`progress-chip${allActive ? " is-active" : ""}`}
            onClick={() => onSpeedsChange([])}
          >
            All
          </button>
          {SPEED_OPTIONS.map((option) => {
            const active = speeds.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                className={`progress-chip${active ? " is-active" : ""}`}
                onClick={() => toggleSpeed(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="progress-filter-group">
        <span className="progress-filter-label">Window</span>
        <div className="progress-chips">
          {WINDOW_OPTIONS.map((option) => {
            const active = days === option.value;
            return (
              <button
                key={option.label}
                type="button"
                aria-pressed={active}
                className={`progress-chip${active ? " is-active" : ""}`}
                onClick={() => onDaysChange(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {typeof matchedGames === "number" && typeof totalGames === "number" ? (
        <span className="progress-filter-meta">
          {matchedGames} of {totalGames} tracked {pluralize(totalGames, "game")} match
        </span>
      ) : null}
    </div>
  );
}
