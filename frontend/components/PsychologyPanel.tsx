"use client";

import PsychologyRadar, { tagForScore } from "./PsychologyRadar";
import type {
  PlayerTypeScores,
  PsychologyDimension,
  PsychologyFormPoint,
  PsychologyPressureBucket,
  PsychologyProfile,
  PsychologySpeedBucket,
} from "./insights";

const DIMENSION_ORDER = [
  "consistency",
  "time_management",
  "composure",
  "tilt",
  "conversion",
  "fighting_spirit",
];

const TYPE_ORDER: Array<{ key: keyof PlayerTypeScores; label: string }> = [
  { key: "activist", label: "Activist" },
  { key: "pragmatist", label: "Pragmatist" },
  { key: "theorist", label: "Theorist" },
  { key: "reflector", label: "Reflector" },
];

const TAG_LABELS: Record<string, string> = {
  strong: "Strong",
  develop: "Developing",
  weak: "Weak spot",
};

function resolveTag(dimension: PsychologyDimension): string {
  return dimension.tag ?? tagForScore(dimension.score);
}

function collectDimensions(profile: PsychologyProfile): PsychologyDimension[] {
  const raw = profile.dimensions ?? {};
  const order = profile.dimension_order?.length
    ? profile.dimension_order
    : DIMENSION_ORDER;
  const seen = new Set<string>();
  const dimensions: PsychologyDimension[] = [];
  const push = (key: string) => {
    const dimension = raw[key];
    if (!dimension || typeof dimension.score !== "number" || seen.has(key)) {
      return;
    }
    seen.add(key);
    dimensions.push({ ...dimension, key: dimension.key ?? key });
  };
  order.forEach(push);
  Object.keys(raw).forEach(push);
  return dimensions;
}

function confidenceLabel(confidence?: string | null): string {
  return confidence === "medium" ? "clear lean" : "early lean";
}

function resultClass(score?: number | null): string {
  if (score === 1) {
    return "win";
  }
  if (score === 0) {
    return "loss";
  }
  if (score === 0.5) {
    return "draw";
  }
  return "none";
}

function FormChart({ points }: { points: PsychologyFormPoint[] }) {
  if (points.length < 2) {
    return null;
  }
  const width = 560;
  const height = 170;
  const padX = 30;
  const padTop = 26;
  const padBottom = 30;
  const values = points.map((point) => point.accuracy);
  const min = Math.min(...values) - 4;
  const max = Math.max(...values) + 4;
  const span = Math.max(1, max - min);
  const xAt = (index: number) =>
    padX + (index * (width - padX * 2)) / (points.length - 1);
  const yAt = (value: number) =>
    padTop + (1 - (value - min) / span) * (height - padTop - padBottom);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;

  return (
    <svg
      className="psych-form-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Per-game accuracy from ${Math.min(
        ...values
      ).toFixed(0)} to ${Math.max(...values).toFixed(0)}`}
    >
      <line
        className="psych-form-avg"
        x1={padX}
        y1={yAt(average)}
        x2={width - padX}
        y2={yAt(average)}
      />
      <polyline
        className="psych-form-line"
        points={points
          .map(
            (point, index) =>
              `${xAt(index).toFixed(1)},${yAt(point.accuracy).toFixed(1)}`
          )
          .join(" ")}
      />
      {points.map((point, index) => (
        <g key={`${point.label ?? "game"}-${index}`}>
          {point.after_loss && (
            <polygon
              className="psych-form-tilt"
              points={`${xAt(index)},${yAt(point.accuracy) - 12} ${
                xAt(index) - 5
              },${yAt(point.accuracy) - 21} ${xAt(index) + 5},${
                yAt(point.accuracy) - 21
              }`}
            />
          )}
          <circle
            className={`psych-form-dot result-${resultClass(point.score)}`}
            cx={xAt(index)}
            cy={yAt(point.accuracy)}
            r={4.5}
          />
          <text
            className="psych-form-value"
            x={xAt(index)}
            y={yAt(point.accuracy) + 19}
            textAnchor="middle"
          >
            {Math.round(point.accuracy)}
          </text>
          <text
            className="psych-form-label"
            x={xAt(index)}
            y={height - 6}
            textAnchor="middle"
          >
            {(point.label ?? "").replace("Game ", "G")}
          </text>
        </g>
      ))}
    </svg>
  );
}

function TimePressure({ buckets }: { buckets: PsychologyPressureBucket[] }) {
  if (buckets.length === 0) {
    return null;
  }
  const worst = buckets.reduce(
    (current, bucket) => (bucket.rate > current.rate ? bucket : current),
    buckets[0]
  );
  const maxRate = Math.max(...buckets.map((bucket) => bucket.rate), 0.01);
  return (
    <div className="psych-pressure">
      {buckets.map((bucket) => (
        <div
          key={bucket.bucket}
          className={`psych-pressure-row${
            bucket.bucket === worst.bucket ? " is-worst" : ""
          }`}
        >
          <span className="psych-pressure-label">{bucket.bucket}</span>
          <span className="psych-pressure-track">
            <span
              className="psych-pressure-fill"
              style={{ width: `${(bucket.rate / maxRate) * 100}%` }}
            />
          </span>
          <span className="psych-pressure-meta">
            {bucket.blunders}/{bucket.moves} blunders
          </span>
        </div>
      ))}
      <p className="psych-note">
        Blunders per move at each remaining-clock level.
      </p>
    </div>
  );
}

function SpeedProfile({ buckets }: { buckets: PsychologySpeedBucket[] }) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.moves, 0);
  if (total === 0) {
    return null;
  }
  return (
    <div className="psych-speed">
      <div className="psych-speed-track">
        {buckets.map((bucket, index) => (
          <span
            key={bucket.bucket}
            className={`psych-speed-seg seg-${index}`}
            style={{ width: `${(bucket.moves / total) * 100}%` }}
            title={`${bucket.bucket}: ${bucket.moves} moves`}
          />
        ))}
      </div>
      <div className="psych-speed-legend">
        {buckets.map((bucket, index) => (
          <span key={bucket.bucket} className="psych-speed-legend-item">
            <span className={`psych-speed-swatch seg-${index}`} />
            {bucket.bucket} &middot; {Math.round((bucket.moves / total) * 100)}%
          </span>
        ))}
      </div>
      <p className="psych-note">How long you think before most moves.</p>
    </div>
  );
}

type PsychologyPanelProps = {
  profile?: PsychologyProfile | null;
};

export default function PsychologyPanel({ profile }: PsychologyPanelProps) {
  if (!profile) {
    return null;
  }
  const dimensions = collectDimensions(profile);
  const typeScores = profile.type_scores ?? {};
  const leaks = profile.leaks ?? [];
  const form = profile.form ?? [];
  const pressure = profile.time_pressure ?? [];
  const speed = profile.speed_profile ?? [];
  const tags = TYPE_ORDER.map((entry) => ({
    ...entry,
    score: typeScores[entry.key] ?? 0,
  }));

  return (
    <div className="psych-card">
      <div className="psych-head">
        <span className="psych-kicker">Mental profile</span>
        {profile.player_type_label && (
          <span className="psych-type">{profile.player_type_label}</span>
        )}
        <span className="psych-confidence">
          {confidenceLabel(profile.player_type_confidence)} &middot; from{" "}
          {profile.sample_size} games
        </span>
      </div>

      {profile.headline && <p className="psych-headline">{profile.headline}</p>}

      {dimensions.length > 0 && (
        <div className="psych-grid">
          {dimensions.length >= 3 && (
            <div className="psych-radar-wrap">
              <PsychologyRadar dimensions={dimensions} />
            </div>
          )}
          <ul className="psych-table">
            {dimensions.map((dimension) => {
              const tag = resolveTag(dimension);
              return (
                <li key={dimension.key} className="psych-row">
                  <span className="psych-row-head">
                    <span className="psych-row-label">{dimension.label}</span>
                    <span className={`psych-tag tag-${tag}`}>
                      {TAG_LABELS[tag] ?? tag}
                    </span>
                    <span className="psych-row-score">{dimension.score}</span>
                  </span>
                  <span className="psych-row-evidence">{dimension.evidence}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {tags.some((tag) => tag.score > 0) && (
        <div className="psych-section">
          <h3 className="psych-section-title">Playing style</h3>
          <div className="psych-spectrum">
            {tags.map((tag) => (
              <div
                key={tag.key}
                className={`psych-spectrum-row${
                  profile.player_type === tag.key ? " is-leaning" : ""
                }`}
              >
                <span className="psych-spectrum-label">{tag.label}</span>
                <span className="psych-spectrum-track">
                  <span
                    className="psych-spectrum-fill"
                    style={{ width: `${Math.min(100, tag.score)}%` }}
                  />
                </span>
                <span className="psych-spectrum-score">{tag.score}</span>
              </div>
            ))}
          </div>
          {profile.type_evidence && profile.type_evidence.length > 0 && (
            <p className="psych-note">{profile.type_evidence.join(" ")}</p>
          )}
        </div>
      )}

      {form.length >= 2 && (
        <div className="psych-section">
          <h3 className="psych-section-title">Form across the session</h3>
          <FormChart points={form} />
        </div>
      )}

      {(pressure.length > 0 || speed.length > 0) && (
        <div className="psych-section">
          <h3 className="psych-section-title">Under the clock</h3>
          <div className="psych-clock-grid">
            <TimePressure buckets={pressure} />
            <SpeedProfile buckets={speed} />
          </div>
        </div>
      )}

      {leaks.length > 0 && (
        <div className="psych-section">
          <h3 className="psych-section-title">What to fix first</h3>
          <div className="psych-leaks">
            {leaks.map((leak) => (
              <div key={leak.key ?? leak.label} className="psych-leak">
                <div className="psych-leak-head">
                  <span className="psych-leak-label">{leak.label}</span>
                  <span className={`psych-leak-severity sev-${leak.severity}`}>
                    {leak.severity === "high" ? "High impact" : "Medium impact"}
                  </span>
                </div>
                <p className="psych-leak-evidence">{leak.evidence}</p>
                <p className="psych-leak-fix">
                  <span className="psych-leak-fix-label">Fix protocol</span>
                  {leak.fix}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {profile.caveats && profile.caveats.length > 0 && (
        <p className="psych-caveats">{profile.caveats.join(" ")}</p>
      )}
    </div>
  );
}
