"use client";

/**
 * DEV-ONLY harness for the redesigned report components.
 *
 * Purpose: review HeroRule, FocusAreasBoard, DrillSection and DrillCard with
 * realistic data, without signing in, without an existing analysis, and without
 * touching production Supabase.
 *
 * Safe to delete. It 404s in production builds, and every drill position below
 * was verified legal with chess.js (played move, best move and FEN all checked).
 */

import { useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import CoachingReport from "../../components/CoachingReport";
import type { InsightsData, InsightMoment } from "../../components/insights";

if (process.env.NODE_ENV === "production") {
  // Keep this out of shipped builds even if the file is forgotten.
  notFound();
}

/* -------------------------------------------------------------------------- */
/* Verified drill fixtures (all moves checked with chess.js)                   */
/* -------------------------------------------------------------------------- */

const BACKRANK: InsightMoment = {
  move_number: 34,
  san: "Rc1",
  color: "white",
  player_color: "white",
  phase: "endgame",
  quality: "blunder",
  centipawn_loss: 900,
  // Clock evidence exactly as the backend emits it on a moment
  // (recommendations.py::_attach_clock_context). This is the only fixture that
  // carries a post-error rush, so it is what makes the rush marker
  // regression-testable — without it the display has no test coverage.
  seconds_spent: 2.4,
  clock_remaining: 18,
  post_error_rush: true,
  next_move: { san: "Kg7", seconds_spent: 1.0 },
  fen_before: "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 34",
  played_move: "a1c1",
  best_move_san: "Ra8#",
  motif: "Back-rank mate",
  resource_theme: "backRankMate",
  note: "You shuffled the rook off the open file and the mate never came.",
  mechanism:
    "With under twenty seconds on your clock the urge to move the nearest piece wins out over a last look at the back rank.",
  better_move_idea: "The back rank is undefended, so the rook belongs on the eighth.",
  arrows: [
    { orig: "a1", dest: "c1", color: "red" },
    { orig: "a1", dest: "a8", color: "green" },
  ],
  highlight_squares: ["a1", "a8"],
};

const FORK: InsightMoment = {
  move_number: 27,
  san: "Ne7",
  color: "white",
  player_color: "white",
  phase: "middlegame",
  quality: "mistake",
  centipawn_loss: 340,
  // Clock present but no rush: the calm case, which must NOT show the marker.
  seconds_spent: 41.0,
  clock_remaining: 132,
  fen_before: "r3k2r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3K2R w KQkq - 0 27",
  played_move: "d5e7",
  best_move_san: "Nxc7+",
  motif: "Fork",
  resource_theme: "fork",
  note: "You walked the knight to e7, where it no longer eyes the king on e8 or the rook on a8, so the royal fork on c7 simply slipped away.",
  mechanism:
    "Trading a slow developing move for tempo feels safe, so the brain settles on the knight's nearest square instead of scanning every enemy piece for a fork.",
  better_move_idea: "One knight move hits both the king and the rook — a royal fork.",
  arrows: [
    { orig: "d5", dest: "e7", color: "red" },
    { orig: "d5", dest: "c7", color: "green" },
  ],
  highlight_squares: ["d5", "c7"],
};

const BLACK_FORK: InsightMoment = {
  move_number: 27,
  san: "Ne2",
  color: "black",
  player_color: "black",
  phase: "middlegame",
  quality: "blunder",
  // The FORK fixture rotated 180°: same pieces, same clock story, Black to move
  // instead of White. It exists because Black to move is the case that was
  // silently broken — chessground never read the side to move from the FEN, so
  // every attempt on a black-to-move drill was filed as a premove and graded
  // nothing. Do not delete it: it is the interactive regression fixture.
  //
  // Verified with Stockfish depth 18: 27...Nxc2+ (the royal fork) is +7.73 for
  // Black, while 27...Ne2 drops the knight to Kxe2 and leaves the position level
  // at 0.00, so the loss is 773cp.
  centipawn_loss: 773,
  seconds_spent: 12.0,
  clock_remaining: 74,
  fen_before: "r3k2r/ppp2ppp/8/8/3n4/8/PPP2PPP/R3K2R b KQkq - 0 27",
  played_move: "d4e2",
  best_move_san: "Nxc2+",
  motif: "Fork",
  resource_theme: "fork",
  note: "You moved the knight next to the king on e1, where the king simply took it. The fork on c2 was the whole point of the position.",
  mechanism:
    "A knight hopping forward looks like pressure, so the brain plays the nearest square to the enemy king without checking whether anything defends it.",
  better_move_idea: "One knight move hits both the king on e1 and the rook on a1 — a royal fork.",
  arrows: [
    { orig: "d4", dest: "e2", color: "red" },
    { orig: "d4", dest: "c2", color: "green" },
  ],
  highlight_squares: ["d4", "c2"],
};

const HANGING: InsightMoment = {
  move_number: 5,
  san: "Ng5",
  color: "white",
  player_color: "white",
  phase: "opening",
  quality: "blunder",
  // Verified with Stockfish depth 16. The FEN used to omit Black's g8 knight,
  // which made the position +7.65 for White and made every claim on this card
  // false. With the knight restored the position is +0.15 and best is d3;
  // 5.Ng5 drops to -6.62 because 5...Qxg5 simply wins the knight (nothing
  // defends g5: the h-pawn is still on h2), so the real loss is 677cp.
  centipawn_loss: 677,
  // Duration only, no clock: must render the duration and nothing else, so the
  // "show only when reliable" rule is exercised rather than assumed.
  seconds_spent: 6.0,
  fen_before: "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 6 5",
  played_move: "f3g5",
  best_move_san: "d3",
  motif: "Hanging piece",
  resource_theme: "hangingPiece",
  note: "You put the knight on g5 where nothing defends it, and the queen took it straight off.",
  mechanism:
    "A knight jumping forward looks like progress, so the brain skips the two-second question of what actually defends the square it lands on.",
  better_move_idea: "d3 keeps the centre solid and the knight defended. g5 was a square with no support at all.",
  arrows: [
    { orig: "f3", dest: "g5", color: "red" },
    { orig: "d2", dest: "d3", color: "green" },
  ],
  highlight_squares: ["g5", "d3"],
};

const STRENGTH: InsightMoment = {
  move_number: 34,
  san: "Ra8#",
  color: "white",
  player_color: "white",
  phase: "endgame",
  quality: "strong",
  centipawn_loss: 0,
  // No clock fields on purpose: a game with no clock data must render neither a
  // duration nor a clock — no placeholder, no zero.
  //
  // This board deliberately mirrors the BACKRANK weakness fixture: the same
  // position, where the player found the mate instead of shuffling the rook to
  // c1. Verified with Stockfish — Ra8 is mate because the king on g8 is walled
  // in by its own f7/g7/h7 pawns. The previous FEN (r4rk1/...) had White a
  // knight down and evaluated -6.18, so "won you the exchange" was false:
  // Nxf6+ simply trades knights there.
  fen_before: "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 34",
  played_move: "a1a8",
  best_move_san: null,
  note: "You saw the back rank was undefended and put the rook on the eighth.",
  arrows: [{ orig: "a1", dest: "a8", color: "green" }],
  highlight_squares: ["a8"],
};

/** A moment with no stored solution: must fall back to a plain card, no crash. */
const UNSOLVABLE: InsightMoment = {
  move_number: 2,
  san: "h3",
  color: "white",
  player_color: "white",
  phase: "opening",
  // Verified with Stockfish: the position is +0.40 with Nf3 best, and 2.h3
  // costs only 42cp — so this is an inaccuracy, not the 180cp mistake the
  // fixture previously claimed.
  quality: "inaccuracy",
  centipawn_loss: 42,
  fen_before: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2",
  played_move: "h2h3",
  best_move_san: null,
  motif: null,
  note: "A quiet move that does not address the position.",
  arrows: [],
  highlight_squares: [],
};

/* -------------------------------------------------------------------------- */
/* Scenario data                                                              */
/* -------------------------------------------------------------------------- */

const RESOURCES = [
  {
    title: "Practice Forks",
    url: "https://lichess.org/training/fork",
    theme: "fork",
    source_move: "27. Nxc7+",
  },
  {
    title: "Work on Back-Rank Mates",
    url: "https://lichess.org/training/backRankMate",
    theme: "backRankMate",
    source_move: "34. Rc1",
  },
  {
    title: "Study the Italian Game",
    url: "https://lichess.org/study/search?q=Italian%20Game",
    theme: "opening_study",
    source_move: null,
  },
];

const PSYCHOLOGY: NonNullable<InsightsData["psychology"]> = {
  sample_size: 12,
  headline: "Your play holds up technically but wobbles once the clock gets short.",
  player_type: "reflector",
  player_type_label: "Reflector",
  player_type_confidence: "medium",
  type_scores: { activist: 40, pragmatist: 55, theorist: 62, reflector: 71 },
  dimension_order: [
    "consistency",
    "composure",
    "tilt",
    "time_management",
    "conversion",
    "fighting_spirit",
  ],
  dimensions: {
    consistency: {
      label: "Consistency",
      score: 62,
      tag: "develop",
      evidence: "Accuracy swings between games rather than within them.",
    },
    composure: {
      label: "Composure",
      score: 48,
      tag: "weak",
      evidence: "Errors cluster in the five moves after you lose material.",
    },
    tilt: {
      label: "Tilt resistance",
      score: 41,
      tag: "weak",
      evidence: "The game right after a loss is measurably weaker than average.",
    },
    time_management: {
      label: "Time management",
      score: 55,
      tag: "develop",
      evidence: "You spend more than half your clock before move 15.",
    },
    conversion: {
      label: "Converting advantages",
      score: 70,
      tag: "strong",
      evidence: "You convert most positions where you are up a clean pawn.",
    },
    fighting_spirit: {
      label: "Fighting spirit",
      score: 66,
      tag: "develop",
      evidence: "You keep playing in worse positions instead of resigning early.",
    },
  },
  leaks: [
    {
      key: "tilt",
      label: "Tilt",
      score: 41,
      tag: "weak",
      severity: "high",
      evidence: "After a loss your next game averaged 14 accuracy points lower.",
      fix: "Stand up and walk away for sixty seconds after any loss before queueing again.",
    },
    {
      key: "time",
      label: "Time management",
      score: 55,
      tag: "develop",
      severity: "medium",
      evidence: "Most blunders arrive below three minutes remaining.",
      fix: "Spend two seconds checking every capture before you move.",
    },
  ],
  form: [
    { label: "Game 1", accuracy: 82, score: 1, after_loss: false },
    { label: "Game 2", accuracy: 61, score: 0, after_loss: true },
    { label: "Game 3", accuracy: 74, score: 0.5, after_loss: false },
    { label: "Game 4", accuracy: 55, score: 0, after_loss: true },
  ],
  time_pressure: [
    { bucket: "10+ min", moves: 120, blunders: 3, rate: 0.025 },
    { bucket: "3-10 min", moves: 86, blunders: 6, rate: 0.07 },
    { bucket: "1-3 min", moves: 54, blunders: 11, rate: 0.2 },
    { bucket: "Under 1 min", moves: 38, blunders: 12, rate: 0.32 },
  ],
  speed_profile: [
    { bucket: "Under 1s", moves: 96 },
    { bucket: "1-3s", moves: 118 },
    { bucket: "3-10s", moves: 61 },
    { bucket: "10s+", moves: 23 },
  ],
  type_evidence: ["You review your games more than most players at this level."],
  caveats: ["These patterns come from a small sample and may not be stable."],
};

const NEW_REPORT = `## Strength

- You saw the back rank was undefended and finished the job on the spot.
- Your clock discipline held through the middlegame, so the ending was played with time to think.

## Weakness

- You traded off both rooks and left your king on a bare back rank, and the mate arrived from nowhere.
- On move 27 you moved the knight to a square where it did nothing while a royal fork sat on the board.

## Game Overview

- You came out of the opening comfortably and then let the initiative drift.
- The turning point was 27.Ne7, where a royal fork was available.
- You kept fighting and generated chances right to the end.

<AccuracyChart data="[78, 64, 41]" />

## Next Game Rule

Check for a forcing move before you commit to a quiet one.

## Focus Areas

- Don't: Play quiet developing moves when a forcing move exists. Do: Look for checks and captures first.
- Don't: Leave your king on a bare back rank. Do: Give it an escape square before the rooks come off.
- Keep studying rook endgames so the technique becomes automatic.

## Resources

- practice forks
- work on back-rank mates
`;

const LEGACY_REPORT = `## Weakness

- You traded off both rooks and left your king on a bare back rank.
- On move 27 you moved the knight to a square where it did nothing.

## Game Overview

- You came out of the opening comfortably and then let the initiative drift.

<AccuracyChart data="[78, 64, 41]" />

## Focus Areas

- Control the Center: In the opening, prioritize moves like ...d5. Fighting for the center early prevents your opponent from pushing you around and gives your pieces more room to develop.
- Identify Forcing Moves: Look for checks, captures, and threats before making a move. You missed several tactical opportunities because you moved pieces to squares where they could be easily kicked away.
- Piece Coordination: Focus on developing your minor pieces to active, central squares rather than playing them to the edge of the board.

## Resources

- practice forks
- work on back-rank mates
`;

const MINIMAL_REPORT = `## Game Overview

- A short game where nothing much happened.

## Focus Areas

- Keep studying the Sicilian Najdorf.

## Resources

- practice forks
`;

type ScenarioKey = "new" | "legacy" | "minimal";

const SCENARIOS: Record<
  ScenarioKey,
  { label: string; blurb: string; content: string; insights: InsightsData }
> = {
  new: {
    label: "New report (full)",
    blurb:
      "Post-prompt-change shape: dedicated rule section, tier A Do/Don't pairs, psychology, and four solvable drills — including a Black-to-move position, which is the case the interactive board used to swallow silently.",
    content: NEW_REPORT,
    insights: {
      strength_moments: [STRENGTH],
      weakness_moments: [BACKRANK, BLACK_FORK, FORK, HANGING, UNSOLVABLE],
      resources: RESOURCES,
      player_color: "white",
      player_name: "you",
      opening_name: "Italian Game",
      eco: "C50",
      result: "0-1",
      phase_accuracies: { opening: 78, middlegame: 64, endgame: 41 },
      statistics: { blunder: 2, mistake: 1, inaccuracy: 1 },
      psychology: PSYCHOLOGY,
    },
  },
  legacy: {
    label: "Legacy report (tier B/C)",
    blurb:
      "The real shape of the reports already in your database: \"Concept: explanation\" bullets. These render as labelled concept cards, with the hero falling back to the psychology fix protocol. Verified against 10 real stored reports — 25 of 27 Focus Areas bullets parse this way.",
    content: LEGACY_REPORT,
    insights: {
      strength_moments: [STRENGTH],
      weakness_moments: [FORK, HANGING],
      resources: RESOURCES,
      player_color: "white",
      opening_name: "Italian Game",
      phase_accuracies: { opening: 78, middlegame: 64, endgame: 41 },
      psychology: PSYCHOLOGY,
    },
  },
  minimal: {
    label: "Minimal / broken parse",
    blurb:
      "One unsplittable bullet, no psychology and no solvable drills. Tests the tier C fallback and that nothing silently disappears.",
    content: MINIMAL_REPORT,
    insights: {
      strength_moments: [],
      weakness_moments: [],
      resources: [],
      player_color: "white",
      psychology: null,
    },
  },
};

export default function DevPreviewPage() {
  const [scenario, setScenario] = useState<ScenarioKey>("new");
  const active = SCENARIOS[scenario];

  return (
    <main className="dashboard analysis-dashboard">
      <header className="topbar">
        <span className="wordmark">
          <span className="wordmark-glyph" aria-hidden="true">
            ♜
          </span>
          Chessmasters
          <span className="chip" style={{ marginLeft: "0.75rem" }}>
            Dev preview
          </span>
        </span>
        <div className="topbar-actions">
          <Link className="nav-link" href="/">
            Back to app
          </Link>
        </div>
      </header>

      <section
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          alignItems: "center",
          padding: "1.25rem 0 0",
        }}
      >
        {(Object.keys(SCENARIOS) as ScenarioKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className={`toggle${scenario === key ? " active" : ""}`}
            onClick={() => setScenario(key)}
          >
            {SCENARIOS[key].label}
          </button>
        ))}
      </section>

      <p className="game-meta" style={{ marginTop: "0.9rem", maxWidth: "78ch" }}>
        {active.blurb}
      </p>

      <div className="analysis-workspace">
        <div className="analysis-report-column">
          <CoachingReport
            key={scenario}
            content={active.content}
            insights={active.insights}
            gamesAnalyzed={12}
          />
        </div>
      </div>
    </main>
  );
}
