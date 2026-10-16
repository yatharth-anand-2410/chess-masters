import React from "react";

type Props = {
  /** Honest empty-state headline. Defaults to the contract wording. */
  message?: string;
  hint?: string | null;
  compact?: boolean;
};

/**
 * The single honest empty state used by every progress panel.
 * It never implies data exists — it says exactly what is missing.
 */
export default function EmptyPanel({
  message = "Analyze 4+ games to unlock this panel.",
  hint,
  compact = false,
}: Props) {
  return (
    <div className={`progress-empty${compact ? " is-compact" : ""}`} role="status">
      <span className="progress-empty-icon" aria-hidden="true">
        ◌
      </span>
      <div className="progress-empty-body">
        <p className="progress-empty-title">{message}</p>
        {hint ? <p className="progress-empty-hint">{hint}</p> : null}
      </div>
    </div>
  );
}
