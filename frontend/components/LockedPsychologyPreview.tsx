"use client";

import { PSYCHOLOGY_MIN_GAMES } from "./AnalyzerForm";
import PsychologyPanel from "./PsychologyPanel";
import type { PsychologyProfile } from "./insights";

const PREVIEW_PROFILE: PsychologyProfile = {
  sample_size: 3,
  headline:
    "Pragmatist profile — time management is the gap; composure is your edge.",
  player_type: "pragmatist",
  player_type_label: "Pragmatist — concrete, practical decisions",
  player_type_confidence: "medium",
  type_scores: {
    activist: 48,
    pragmatist: 64,
    theorist: 55,
    reflector: 52,
  },
  dimension_order: [
    "consistency",
    "time_management",
    "composure",
    "tilt",
    "conversion",
    "fighting_spirit",
  ],
  dimensions: {
    consistency: {
      key: "consistency",
      label: "Consistency",
      short_label: "Consistency",
      score: 62,
      tag: "develop",
      evidence:
        "Your accuracy stayed within a steady band across the games in this sample.",
    },
    time_management: {
      key: "time_management",
      label: "Time management",
      short_label: "Time",
      score: 48,
      tag: "develop",
      evidence:
        "Most of your clocked blunders came on moves played with under five seconds spent.",
    },
    composure: {
      key: "composure",
      label: "Composure",
      short_label: "Composure",
      score: 74,
      tag: "strong",
      evidence:
        "You steady yourself after your own mistakes — the moves that follow hold your usual accuracy.",
    },
    tilt: {
      key: "tilt",
      label: "Tilt resistance",
      short_label: "Tilt",
      score: 72,
      tag: "strong",
      evidence: "Your results don't swing much from game to game.",
    },
    conversion: {
      key: "conversion",
      label: "Converting advantages",
      short_label: "Conversion",
      score: 58,
      tag: "develop",
      evidence:
        "You reached a clearly winning position in two games and closed out one.",
    },
    fighting_spirit: {
      key: "fighting_spirit",
      label: "Fighting spirit",
      short_label: "Fighting spirit",
      score: 66,
      tag: "develop",
      evidence:
        "You fell to a clearly worse position once and salvaged a draw from it.",
    },
  },
  leaks: [
    {
      key: "time_management",
      label: "Time management",
      score: 48,
      tag: "develop",
      severity: "medium",
      evidence:
        "Most of your clocked blunders came on moves played with under five seconds spent.",
      fix: "On any move where you have under five seconds, run a one-second scan for checks, captures and threats before you commit.",
    },
    {
      key: "conversion",
      label: "Converting advantages",
      score: 58,
      tag: "develop",
      severity: "medium",
      evidence:
        "You reached a clearly winning position in two games and closed out one.",
      fix: "When you are clearly winning, slow down and trade pieces rather than pawns; check for stalemate and back-rank tricks before every push.",
    },
  ],
  form: [
    { label: "Game 1", accuracy: 71.2, score: 1, after_loss: false },
    { label: "Game 2", accuracy: 58.4, score: 0, after_loss: false },
    { label: "Game 3", accuracy: 66.9, score: 0.5, after_loss: true },
  ],
  time_pressure: [
    { bucket: "<30s", moves: 14, blunders: 2, rate: 0.14 },
    { bucket: "30-60s", moves: 22, blunders: 1, rate: 0.05 },
    { bucket: "1-2m", moves: 26, blunders: 0, rate: 0 },
  ],
  speed_profile: [
    { bucket: "2-5s", moves: 18 },
    { bucket: "5-15s", moves: 32 },
    { bucket: "15-60s", moves: 12 },
  ],
  caveats: [
    "With only a few games these are early signals, not settled habits.",
    "This is a pattern read from this sample, not a fixed profile.",
  ],
};

type LockedPsychologyPreviewProps = {
  gamesAnalyzed: number;
};

function LockIcon() {
  return (
    <svg
      className="psych-locked-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="10.5" width="16" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <circle cx="12" cy="15.25" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function LockedPsychologyPreview({
  gamesAnalyzed,
}: LockedPsychologyPreviewProps) {
  const remaining = Math.max(PSYCHOLOGY_MIN_GAMES - gamesAnalyzed, 1);

  return (
    <div className="psych-locked">
      <div className="psych-locked-preview" aria-hidden="true">
        <PsychologyPanel profile={PREVIEW_PROFILE} />
      </div>
      <div className="psych-locked-overlay" role="status">
        <LockIcon />
        <p className="psych-locked-title">AI Psychological Profiling Locked</p>
        <p className="psych-locked-text">
          Analyze {remaining} more {remaining === 1 ? "game" : "games"} to
          unlock your Mental Profile and Tilt Resistance.
        </p>
      </div>
    </div>
  );
}
