"use client";

/**
 * DEV-ONLY harness for the redesigned report components.
 *
 * Purpose: review the showcase review surface — BoardInstrument, verdict,
 * psychology card, hero wedge, phase matrix, choke card, focus cards, moment
 * mini-boards, drill arena and resources — with realistic data, without
 * signing in, without an existing analysis, and without touching production
 * Supabase.
 *
 * Safe to delete. It 404s in production builds. The instrument fixtures replay
 * real games through chess.js; the eval curve and move qualities attached to
 * the synthetic fixture are DEMO values used only to exercise the UI states and
 * are labelled as such on the page.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Chess } from "chess.js";

import CoachingReport from "../../components/CoachingReport";
import GameAnalysisCard from "../../components/GameAnalysisCard";
import GameHeader from "../../components/review/GameHeader";
import BoardInstrument from "../../components/review/BoardInstrument";
import BatchInstrument from "../../components/review/BatchInstrument";
import type { InsightsData, InsightMoment } from "../../components/insights";
import type { AnalysisReplay, AnalysisSummary } from "../../lib/api";

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
  centipawn_loss: 677,
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
  headline:
    "Your play holds up technically but wobbles once the clock gets short.",
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
      key: "time_management",
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

const NEW_REPORT = `## Verdict

- You were winning the endgame until one rook shuffle on move 34 threw it away.

## Strength

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

/** A `## Verdict` section with no structured payload — the parse path. */
const VERDICT_SECTION_REPORT = `## Verdict

- The middlegame was level until move 27, where a royal fork was left on the table.

${LEGACY_REPORT}`;

const BATCH_REPORT = `## Verdict

- Both wins came from the same Najdorf structure; both losses came after the clock dropped below a minute.

## Psychology

- This paragraph is what the old pipeline wrote; the structured card above must replace it without duplication.

## Weakness

- The back rank stayed bare in three of the four games.

## Strength

- Your opening play held up across the whole session.

## Game Overview

- Session accuracy held steady at 68% until the last game, which collapsed in time trouble.

## Next Game Rule

Give the king an escape square before trading heavy pieces.

## Focus Areas

- Don't: Trade rooks while your back rank is open. Do: Play h6 or g6 first.
- Identify Forcing Moves: Look for checks, captures, and threats before making a move.

## Resources

- practice forks
- work on back-rank mates
`;

/* -------------------------------------------------------------------------- */
/* Instrument fixture: the Evergreen Game, replayed with chess.js              */
/* -------------------------------------------------------------------------- */

const DEMO_PGN =
  "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. b4 Bxb4 5. c3 Ba5 6. d4 exd4 7. O-O d3 8. Qb3 Qf6 9. e5 Qg6 10. Re1 Nge7 11. Ba3 b5 12. Qxb5 Rb8 13. Qa4 Bb6 14. Nbd2 Bb7 15. Ne4 Qf5 16. Bxd3 Qh5 17. Nf6+ gxf6 18. exf6 Rg8 19. Rad1 Qxf3 20. Rxe7+ Nxe7 21. Qxd7+ Kxd7 22. Bf5+ Ke8 23. Bd7+ Kf8 24. Bxe7#";

/**
 * DEMO qualities and eval curve (white's perspective, in pawns). Only these
 * synthetic values exist to exercise the badge, blunder square and curve
 * states on this dev page; the moves themselves are the real game.
 */
const DEMO_QUALITIES: Record<number, string> = {
  34: "mistake",
  38: "blunder",
  40: "mistake",
  44: "inaccuracy",
  47: "brilliant",
};

function demoCurve(total: number): number[] {
  return Array.from({ length: total }, (_, index) => {
    const ply = index + 1;
    if (ply >= 39) {
      return 5.8 + (ply - 39) * 0.25;
    }
    if (ply >= 34) {
      return 0.6 + (ply - 34) * 0.5;
    }
    return Number((0.25 + 0.35 * Math.sin(ply / 2.6)).toFixed(2));
  });
}

function buildDemoReplay(): AnalysisReplay | null {
  try {
    const chess = new Chess();
    chess.loadPgn(DEMO_PGN);
    const history = chess.history({ verbose: true });
    const curve = demoCurve(history.length);
    return {
      analysis_id: "dev-preview",
      moves: history.map((move, index) => ({
        ply: index + 1,
        san: move.san,
        color: move.color === "b" ? "black" : "white",
        fen: move.after,
        quality: DEMO_QUALITIES[index + 1] ?? "good",
        eval_after_pawns: curve[index],
        seconds_spent: 6 + ((index * 7) % 23),
        clock_remaining: 600 - index * 11,
      })),
      eval_curve_pawns: curve,
      players: {
        white: { name: "Adolf Anderssen", elo: 2610 },
        black: { name: "You (Student)", elo: 2145 },
      },
      player_color: "black",
      time_control: "Classical 60+0",
      speed: "classical",
      result: "1-0",
      opening_name: "Evans Gambit",
    };
  } catch {
    return null;
  }
}

const BATCH_GAMES: AnalysisSummary[] = [
  {
    id: "demo-game-1",
    platform: "lichess",
    game_id: "xK8g2YqM",
    game_url: "https://lichess.org/xK8g2YqM",
    player_color: "black",
    opening_name: "Sicilian Defense, Najdorf",
    result: "0-1",
    status: "completed",
    created_at: new Date().toISOString(),
    game_summary: {
      speed: "blitz",
      time_control: "5+3",
      player_elo: 2145,
      accuracy: 76,
      phase_accuracies: { opening: 88, middlegame: 74, endgame: 52 },
      quality: { blunder: 3, mistake: 2, inaccuracy: 4 },
    },
    insights: {
      strength_moments: [STRENGTH],
      weakness_moments: [BACKRANK, FORK],
      resources: RESOURCES,
      player_color: "black",
      phase_accuracies: { opening: 88, middlegame: 74, endgame: 52 },
      statistics: { blunder: 3, mistake: 2, inaccuracy: 4 },
    },
  } as AnalysisSummary,
  {
    id: "demo-game-2",
    platform: "lichess",
    game_id: "bQ4mZ1Tp",
    game_url: "https://lichess.org/bQ4mZ1Tp",
    player_color: "black",
    opening_name: "Queen's Gambit Declined",
    result: "1-0",
    status: "completed",
    created_at: new Date().toISOString(),
    game_summary: {
      speed: "blitz",
      time_control: "5+3",
      player_elo: 2145,
      accuracy: 69,
      phase_accuracies: { opening: 81, middlegame: 66, endgame: 60 },
      quality: { blunder: 4, mistake: 3, inaccuracy: 2 },
    },
    insights: {
      strength_moments: [STRENGTH],
      weakness_moments: [HANGING, BLACK_FORK],
      resources: RESOURCES,
      player_color: "black",
      phase_accuracies: { opening: 81, middlegame: 66, endgame: 60 },
      statistics: { blunder: 4, mistake: 3, inaccuracy: 2 },
    },
  } as AnalysisSummary,
  {
    id: "demo-game-3",
    platform: "lichess",
    game_id: "cR9vL2Wk",
    game_url: "https://lichess.org/cR9vL2Wk",
    player_color: "black",
    opening_name: "Caro-Kann Defense",
    result: "0-1",
    status: "completed",
    created_at: new Date().toISOString(),
    game_summary: {
      speed: "blitz",
      time_control: "5+3",
      player_elo: 2145,
      accuracy: 84,
      phase_accuracies: { opening: 90, middlegame: 84, endgame: 75 },
      quality: { blunder: 1, mistake: 1, inaccuracy: 1 },
    },
    insights: {
      strength_moments: [STRENGTH],
      weakness_moments: [UNSOLVABLE],
      resources: RESOURCES,
      player_color: "black",
      phase_accuracies: { opening: 90, middlegame: 84, endgame: 75 },
      statistics: { blunder: 1, mistake: 1, inaccuracy: 1 },
    },
  } as AnalysisSummary,
];

type ScenarioKey = "new" | "legacy" | "verdict-section" | "minimal" | "batch";

type Scenario = {
  label: string;
  blurb: string;
  content: string;
  insights: InsightsData;
  instrument: "replay" | "pgn" | "batch" | "none";
  header: { pill: string; title: string; meta: string; gameId?: string };
  gameAccuracy?: number | null;
};

const SCENARIOS: Record<ScenarioKey, Scenario> = {
  new: {
    label: "New report + replay instrument",
    blurb:
      "Post-prompt-change shape: structured verdict, dedicated rule section, tier A Do/Don't pairs, psychology, choke evidence and four solvable drills. The left instrument is replay-backed with a DEMO eval curve and move qualities labelled on this page; the game itself is Anderssen's Evergreen Game, replayed with chess.js.",
    content: NEW_REPORT,
    instrument: "replay",
    header: {
      pill: "Blitz 5+3 · Lichess",
      title: "Tactical Collapse Under Time Panic",
      meta: "Played as Black, 0-1 · analysed today",
      gameId: "xK8g2YqM",
    },
    gameAccuracy: 76,
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
      verdict: {
        line: "You were winning the endgame until one rook shuffle on move 34 threw it away.",
        detail:
          "34. Rc1 came with 0:18 left on the clock; the back rank was undefended the whole time.",
      },
    },
  },
  legacy: {
    label: "Legacy report (PGN fallback instrument)",
    blurb:
      "The real shape of the reports already in your database: no structured verdict, \"Concept: explanation\" Focus Areas bullets, and an instrument built from the stored PGN — no eval curve, no quality badges, hidden honestly.",
    content: LEGACY_REPORT,
    instrument: "pgn",
    header: {
      pill: "Rapid 10+0 · Chess.com",
      title: "Italian Game",
      meta: "Played as White, 1-0 · analysed last week",
      gameId: "900100200",
    },
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
  "verdict-section": {
    label: "Verdict parsed from markdown",
    blurb:
      "No `insights.verdict`, but the report opens with a `## Verdict` section. The line is lifted above the rule card and the raw section is not repeated in the body.",
    content: VERDICT_SECTION_REPORT,
    instrument: "pgn",
    header: {
      pill: "Blitz 3+2 · Lichess",
      title: "Sicilian Defense",
      meta: "Played as White, 1/2-1/2 · analysed last month",
      gameId: "vQ7mZ2Lp",
    },
    insights: {
      strength_moments: [],
      weakness_moments: [FORK],
      resources: RESOURCES,
      player_color: "white",
      phase_accuracies: { opening: 70, middlegame: 58, endgame: 44 },
    },
  },
  minimal: {
    label: "Minimal / broken parse",
    blurb:
      "One unsplittable bullet, no psychology and no solvable drills. Tests the tier C fallback, the missing-instrument state and that nothing silently disappears.",
    content: MINIMAL_REPORT,
    instrument: "none",
    header: {
      pill: "Bullet 1+0 · Lichess",
      title: "Game dQ2mX8kF",
      meta: "Played as White, 0-1 · analysed today",
      gameId: "dQ2mX8kF",
    },
    insights: {
      strength_moments: [],
      weakness_moments: [],
      resources: [],
      player_color: "white",
      psychology: null,
    },
  },
  batch: {
    label: "Batch / multi-game report",
    blurb:
      "The batch shell: session telemetry instrument, a batch report whose raw `## Psychology` section must NOT render twice, and the Games Overview cards below the canvas.",
    content: BATCH_REPORT,
    instrument: "batch",
    header: {
      pill: "Lichess session · 4 games",
      title: "Multi-game report",
      meta: "3 of 4 games analysed · today",
    },
    insights: {
      strength_moments: [STRENGTH],
      weakness_moments: [BACKRANK, BLACK_FORK, FORK],
      resources: RESOURCES,
      player_color: "black",
      phase_accuracies: { opening: 86, middlegame: 74, endgame: 62 },
      psychology: PSYCHOLOGY,
      verdict: {
        line: "Both wins came from the same Najdorf structure; both losses came after the clock dropped below a minute.",
        detail: null,
      },
    },
  },
};

export default function DevPreviewPage() {
  const [scenario, setScenario] = useState<ScenarioKey>("new");
  const active = SCENARIOS[scenario];
  const demoReplay = useMemo(() => buildDemoReplay(), []);

  const header = (
    <GameHeader
      pill={active.header.pill}
      title={active.header.title}
      meta={active.header.meta}
      gameId={active.header.gameId}
      showDrills
    />
  );

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

      <div
        className={`review-workspace${active.instrument === "none" ? " is-solo" : ""}`}
      >
        {active.instrument === "replay" && (
          <BoardInstrument
            replay={demoReplay}
            playerColor={demoReplay?.player_color ?? "black"}
            moments={active.insights.weakness_moments}
            timeControl={demoReplay?.time_control ?? null}
          />
        )}
        {active.instrument === "pgn" && (
          <BoardInstrument
            pgn={DEMO_PGN}
            playerColor="white"
            playerName="You (Student)"
            playerElo={2145}
            opponentName="Grandmaster_Opponent"
            opponentElo={2482}
            moments={active.insights.weakness_moments}
            timeControl="Rapid 10+0"
          />
        )}
        {active.instrument === "batch" && (
          <BatchInstrument
            games={BATCH_GAMES}
            gameCount={4}
            platformLabel="Lichess"
          />
        )}

        <div className="review-canvas-column">
          <CoachingReport
            key={scenario}
            content={active.content}
            insights={active.insights}
            gamesAnalyzed={12}
            header={header}
            gameAccuracy={active.gameAccuracy ?? null}
          />

          {active.instrument === "batch" && (
            <section className="review-games-overview">
              <div className="review-section-head">
                <h2>Games Overview</h2>
                <p>One card per game in this session</p>
              </div>
              <div className="review-games-grid">
                {BATCH_GAMES.map((game, index) => (
                  <GameAnalysisCard key={game.id} game={game} index={index} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
