"use client";

export type PhaseMatrixValues = {
  opening?: number | null;
  middlegame?: number | null;
  endgame?: number | null;
};

type PhaseMatrixProps = PhaseMatrixValues & {
  /** Stored game accuracy, rendered as the "Game Overall" pill when present. */
  overall?: number | null;
  /**
   * `box` is the full showcase card (used for the real `insights` data);
   * `bars` is the bare matrix embedded through the `<AccuracyChart>` tag.
   */
  variant?: "box" | "bars";
};

const PHASES: Array<{ key: keyof PhaseMatrixValues; label: string }> = [
  { key: "opening", label: "Opening" },
  { key: "middlegame", label: "Middlegame" },
  { key: "endgame", label: "Endgame" },
];

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Bar colour by band, mirroring the showcase's green / accent / alert rows. */
function toneFor(value: number): "strong" | "ok" | "weak" {
  if (value >= 80) {
    return "strong";
  }
  if (value >= 65) {
    return "ok";
  }
  return "weak";
}

/**
 * Phase-by-phase accuracy, exactly the showcase's matrix. Values are the stored
 * per-phase accuracies; the pill shows the game's overall accuracy when the
 * caller has it and otherwise the honest mean of the phases present.
 */
export default function PhaseMatrix({
  opening,
  middlegame,
  endgame,
  overall,
  variant = "box",
}: PhaseMatrixProps) {
  const values = { opening, middlegame, endgame };
  const rows = PHASES.map((phase) => ({
    label: phase.label,
    value: finite(values[phase.key]),
  }));
  const present = rows.filter(
    (row): row is { label: string; value: number } => row.value !== null
  );
  if (present.length === 0) {
    return null;
  }

  const storedOverall = finite(overall);
  const phaseAverage =
    present.reduce((sum, row) => sum + row.value, 0) / present.length;
  const pill =
    storedOverall !== null
      ? `Game Overall: ${Math.round(storedOverall)}%`
      : present.length === rows.length
        ? `Phase average: ${Math.round(phaseAverage)}%`
        : null;

  const bars = (
    <div className="review-phase-rows">
      {rows.map((row) => (
        <div className="review-phase-row" key={row.label}>
          <span className="review-phase-label">{row.label}</span>
          <span className="review-phase-track">
            {row.value !== null && (
              <span
                className={`review-phase-fill is-${toneFor(row.value)}`}
                style={{ width: `${Math.max(0, Math.min(100, row.value)).toFixed(0)}%` }}
              />
            )}
          </span>
          <span
            className={`review-phase-value${
              row.value !== null && toneFor(row.value) === "weak" ? " is-weak" : ""
            }`}
          >
            {row.value !== null ? `${Math.round(row.value)}%` : "–"}
          </span>
        </div>
      ))}
      {variant === "bars" && pill && (
        <div className="review-phase-pill-row">
          <span className="review-pill-paper">{pill}</span>
        </div>
      )}
    </div>
  );

  if (variant === "bars") {
    return bars;
  }

  return (
    <section className="review-phase-box" aria-label="Phase accuracy matrix">
      <div className="review-phase-head">
        <div>
          <b className="review-phase-title">Phase-by-Phase Accuracy Matrix</b>
          <p className="review-phase-lede">Your accuracy by game stage</p>
        </div>
        {pill && <span className="review-pill-paper">{pill}</span>}
      </div>
      {bars}
    </section>
  );
}
