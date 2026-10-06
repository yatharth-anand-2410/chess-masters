"use client";

import type { PsychologyDimension, PsychologyTag } from "./insights";

const SIZE = 260;
const CENTER = SIZE / 2;
const RADIUS = 82;
const LABEL_RADIUS = 105;
const RINGS = [0.25, 0.5, 0.75, 1];

export function tagForScore(score: number): PsychologyTag {
  if (score >= 70) {
    return "strong";
  }
  if (score >= 40) {
    return "develop";
  }
  return "weak";
}

function polar(index: number, count: number, radius: number) {
  const angle = (-90 + (360 / count) * index) * (Math.PI / 180);
  return {
    x: CENTER + Math.cos(angle) * radius,
    y: CENTER + Math.sin(angle) * radius,
  };
}

function polygon(count: number, radius: number): string {
  return Array.from({ length: count }, (_, index) => {
    const point = polar(index, count, radius);
    return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }).join(" ");
}

type PsychologyRadarProps = {
  dimensions: PsychologyDimension[];
};

export default function PsychologyRadar({
  dimensions,
}: PsychologyRadarProps) {
  const count = dimensions.length;
  if (count < 3) {
    return null;
  }
  const angles = dimensions.map((_, index) => (-90 + (360 / count) * index) * (Math.PI / 180));
  const shape = dimensions.map((dimension, index) => {
    const fraction = Math.max(0, Math.min(100, dimension.score)) / 100;
    return polar(index, count, RADIUS * fraction);
  });
  const summary = dimensions
    .map((dimension) => `${dimension.label} ${dimension.score} out of 100`)
    .join(", ");

  return (
    <svg
      className="psych-radar"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`Mental profile radar: ${summary}`}
    >
      {RINGS.map((ring) => (
        <polygon
          key={ring}
          className="psych-radar-ring"
          points={polygon(count, RADIUS * ring)}
        />
      ))}
      <polygon
        className="psych-radar-threshold"
        points={polygon(count, RADIUS * 0.7)}
      />
      {dimensions.map((dimension, index) => {
        const axis = polar(index, count, RADIUS);
        return (
          <line
            key={`spoke-${dimension.key ?? dimension.label}`}
            className="psych-radar-spoke"
            x1={CENTER}
            y1={CENTER}
            x2={axis.x}
            y2={axis.y}
          />
        );
      })}
      <polygon
        className="psych-radar-shape"
        points={shape.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")}
      />
      {shape.map((point, index) => (
        <circle
          key={`dot-${dimensions[index].key ?? dimensions[index].label}`}
          className={`psych-radar-dot tag-${dimensions[index].tag ?? tagForScore(dimensions[index].score)}`}
          cx={point.x}
          cy={point.y}
          r={4}
        />
      ))}
      {dimensions.map((dimension, index) => {
        const label = polar(index, count, LABEL_RADIUS);
        const cos = Math.cos(angles[index]);
        const anchor = cos > 0.35 ? "start" : cos < -0.35 ? "end" : "middle";
        return (
          <text
            key={`label-${dimension.key ?? dimension.label}`}
            className="psych-radar-label"
            x={label.x}
            y={label.y}
            textAnchor={anchor}
            dominantBaseline="middle"
          >
            {dimension.short_label ?? dimension.label}
          </text>
        );
      })}
    </svg>
  );
}
