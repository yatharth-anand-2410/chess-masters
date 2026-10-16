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

function capitalise(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** Compact type name for the header badge: the key first, the long label second. */
function playerTypeName(profile: PsychologyProfile): string | null {
  if (profile.player_type) {
    return capitalise(profile.player_type);
  }
  const label = profile.player_type_label?.split("—")[0]?.trim();
  return label || null;
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
  const height = 150;
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
      className="review-form-svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Per-game accuracy from ${Math.min(
        ...values
      ).toFixed(0)} to ${Math.max(...values).toFixed(0)}`}
    >
      <line
        className="review-form-avg"
        x1={padX}
        y1={yAt(average)}
        x2={width - padX}
        y2={yAt(average)}
      />
      <polyline
        className="review-form-line"
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
              className="review-form-tilt"
              points={`${xAt(index)},${yAt(point.accuracy) - 12} ${
                xAt(index) - 5
              },${yAt(point.accuracy) - 21} ${xAt(index) + 5},${
                yAt(point.accuracy) - 21
              }`}
            />
          )}
          <circle
            className={`review-form-dot is-${resultClass(point.score)}`}
            cx={xAt(index)}
            cy={yAt(point.accuracy)}
            r={4.5}
          />
          <text
            className="review-form-value"
            x={xAt(index)}
            y={yAt(point.accuracy) + 19}
            textAnchor="middle"
          >
            {Math.round(point.accuracy)}
          </text>
          <text
            className="review-form-label"
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
    <div className="review-pressure">
      {buckets.map((bucket) => (
        <div
          key={bucket.bucket}
          className={`review-pressure-row${
            bucket.bucket === worst.bucket ? " is-worst" : ""
          }`}
        >
          <span className="review-pressure-label">{bucket.bucket}</span>
          <span className="review-pressure-track">
            <span
              className="review-pressure-fill"
              style={{ width: `${(bucket.rate / maxRate) * 100}%` }}
            />
          </span>
          <span className="review-pressure-meta">
            {bucket.blunders}/{bucket.moves} blunders
          </span>
        </div>
      ))}
      <p className="review-psych-note">
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
    <div className="review-speed">
      <div className="review-speed-track">
        {buckets.map((bucket, index) => (
          <span
            key={bucket.bucket}
            className={`review-speed-seg seg-${index}`}
            style={{ width: `${(bucket.moves / total) * 100}%` }}
            title={`${bucket.bucket}: ${bucket.moves} moves`}
          />
        ))}
      </div>
      <div className="review-speed-legend">
        {buckets.map((bucket, index) => (
          <span key={bucket.bucket} className="review-speed-legend-item">
            <span className={`review-speed-swatch seg-${index}`} />
            {bucket.bucket} · {Math.round((bucket.moves / total) * 100)}%
          </span>
        ))}
      </div>
      <p className="review-psych-note">How long you think before most moves.</p>
    </div>
  );
}

type PsychologyPanelProps = {
  profile?: PsychologyProfile | null;
};

/**
 * The cognitive psychology card from the showcase.
 *
 * Content is unchanged from the stored profile — dimension scores, evidence,
 * form, clock buckets and think-time distribution — but the fix protocol now
 * sits on the dimension row it belongs to instead of a separate list, and the
 * whole card is restyled as the showcase's `psych-card-shell`.
 */
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

  const leakKey = (key?: string | null, label?: string | null) =>
    (key ?? label ?? "").trim().toLowerCase();
  const leaksByKey = new Map<string, (typeof leaks)[number]>();
  for (const leak of leaks) {
    leaksByKey.set(leakKey(leak.key, leak.label), leak);
  }
  const usedLeakKeys = new Set<string>();
  const dimensionRows = dimensions.map((dimension) => {
    const match = leaksByKey.get(leakKey(dimension.key, dimension.label)) ?? null;
    if (match) {
      usedLeakKeys.add(leakKey(match.key, match.label));
    }
    return {
      dimension,
      tag: resolveTag(dimension),
      fix: match?.fix ?? null,
    };
  });
  const remainingLeaks = leaks.filter(
    (leak) => !usedLeakKeys.has(leakKey(leak.key, leak.label))
  );
  const hasTiltMarker = form.some((point) => point.after_loss);

  return (
    <section className="review-psych">
      <div className="review-psych-head">
        <div>
          <span className="review-psych-kicker">
            🧠 Cognitive psychology verdict (lead analysis)
          </span>
          <h3 className="review-psych-title">Mental Toughness &amp; Cognitive Biases</h3>
        </div>
        <span
          className="review-psych-badge"
          title={profile.player_type_label ?? undefined}
        >
          {playerTypeName(profile) ?? "Player type"} ·{" "}
          {confidenceLabel(profile.player_type_confidence)} · from{" "}
          {profile.sample_size} games
        </span>
      </div>

      {profile.headline && (
        <p className="review-psych-diagnosis">
          <b>Coach psychological diagnosis:</b> {profile.headline}
        </p>
      )}

      {dimensions.length > 0 && (
        <div className="review-psych-radar-layout">
          {dimensions.length >= 3 && (
            <div className="review-psych-radar-wrap">
              <PsychologyRadar dimensions={dimensions} />
            </div>
          )}
          <ul className="review-psych-table">
            {dimensionRows.map(({ dimension, tag, fix }) => (
              <li key={dimension.key} className="review-psych-row">
                <div className="review-psych-row-top">
                  <b className="review-psych-row-label">{dimension.label}</b>
                  <span className={`review-psych-tag is-${tag}`}>
                    {TAG_LABELS[tag] ?? tag} · {dimension.score}
                  </span>
                </div>
                <p className="review-psych-row-evidence">{dimension.evidence}</p>
                {fix && (
                  <p className="review-psych-row-fix">
                    <b>Protocol:</b> {fix}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {form.length >= 2 && (
        <div className="review-form-box">
          <div className="review-form-head">
            <b>Per-game accuracy form timeline</b>
            <div className="review-form-legend">
              <span className="is-win">● Win</span>
              <span className="is-loss">● Loss</span>
              {hasTiltMarker && <span className="is-tilt">▲ Tilt (post-loss game)</span>}
            </div>
          </div>
          <FormChart points={form} />
        </div>
      )}

      {(pressure.length > 0 || speed.length > 0) && (
        <div className="review-pressure-grid">
          {pressure.length > 0 && (
            <div className="review-pressure-card">
              <b className="review-pressure-title">Blunder frequency by clock level</b>
              <TimePressure buckets={pressure} />
            </div>
          )}
          {speed.length > 0 && (
            <div className="review-pressure-card">
              <b className="review-pressure-title">Move think-time distribution</b>
              <SpeedProfile buckets={speed} />
            </div>
          )}
        </div>
      )}

      {tags.some((tag) => tag.score > 0) && (
        <div className="review-psych-block">
          <h4 className="review-psych-block-title">Playing style</h4>
          <div className="review-spectrum">
            {tags.map((tag) => (
              <div
                key={tag.key}
                className={`review-spectrum-row${
                  profile.player_type === tag.key ? " is-leaning" : ""
                }`}
              >
                <span className="review-spectrum-label">{tag.label}</span>
                <span className="review-spectrum-track">
                  <span
                    className="review-spectrum-fill"
                    style={{ width: `${Math.min(100, tag.score)}%` }}
                  />
                </span>
                <span className="review-spectrum-score">{tag.score}</span>
              </div>
            ))}
          </div>
          {profile.type_evidence && profile.type_evidence.length > 0 && (
            <p className="review-psych-note">{profile.type_evidence.join(" ")}</p>
          )}
        </div>
      )}

      {remainingLeaks.length > 0 && (
        <div className="review-psych-block">
          <h4 className="review-psych-block-title">What to fix first</h4>
          <div className="review-psych-leaks">
            {remainingLeaks.map((leak) => (
              <div key={leakKey(leak.key, leak.label)} className="review-psych-leak">
                <div className="review-psych-leak-head">
                  <span className="review-psych-leak-label">{leak.label}</span>
                  <span className={`review-psych-tag is-${leak.severity === "high" ? "weak" : "develop"}`}>
                    {leak.severity === "high" ? "High impact" : "Medium impact"}
                  </span>
                </div>
                <p className="review-psych-row-evidence">{leak.evidence}</p>
                <p className="review-psych-row-fix">
                  <b>Fix protocol:</b> {leak.fix}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {profile.caveats && profile.caveats.length > 0 && (
        <p className="review-psych-caveats">{profile.caveats.join(" ")}</p>
      )}
    </section>
  );
}
