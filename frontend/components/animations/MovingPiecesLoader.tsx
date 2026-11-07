"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Brain,
  Check,
  Compass,
  Cpu,
  FileText,
  Flame,
  Loader2,
  ShieldAlert,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";

export type PipelineStage = 1 | 2 | 3;

export interface MovingPiecesLoaderProps {
  /** Current analysis pipeline stage: 1 = Fetch PGN, 2 = Stockfish Engine, 3 = AI Master Lesson */
  stage?: PipelineStage;
  /** Live status text streamed from the backend SSE pipeline */
  statusText?: string;
  /** Alias for statusText for drop-in compatibility with AnalysisStatus */
  status?: string;
  /** Elapsed seconds since analysis started */
  elapsedSeconds?: number;
  /** Optional cancel callback while analysis is in flight */
  onCancel?: () => void;
  /** Compact layout variant for tighter containers */
  compact?: boolean;
  /** Additional container class names */
  className?: string;
}

type PieceColor = "w" | "b";
type PieceRole = "k" | "q" | "r" | "b" | "n" | "p";

interface BoardPiece {
  id: string;
  color: PieceColor;
  role: PieceRole;
  square: string;
}

interface TacticalVector {
  from: string;
  to: string;
  tone: "gold" | "cyan" | "crimson";
  dashed?: boolean;
}

interface SequenceFrame {
  plyLabel: string;
  san: string;
  evalLabel: string;
  /** White fill percentage in the vertical eval bar (0 - 100) */
  evalWhitePct: number;
  motifBadge: string;
  stageCallouts: Record<PipelineStage, string>;
  fromSquare: string;
  toSquare: string;
  checkSquare?: string;
  pinnedSquare?: string;
  capturedPieceId?: string;
  vectors: TacticalVector[];
  pieces: BoardPiece[];
}

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;

/**
 * Converts algebraic square ("e4") to 0-indexed board grid coordinates:
 * col = 0..7 (a..h), row = 0..7 (rank 8..rank 1)
 */
function squareToCoords(square: string): { col: number; row: number } {
  const fileCode = square.charCodeAt(0) - 97;
  const rankNum = Number.parseInt(square[1] ?? "1", 10);
  return {
    col: Math.max(0, Math.min(7, fileCode)),
    row: Math.max(0, Math.min(7, 8 - rankNum)),
  };
}

/**
 * Converts algebraic square ("e4") to SVG center coordinates in a 100x100 viewBox
 */
function squareToSvgPoint(square: string): { x: number; y: number } {
  const { col, row } = squareToCoords(square);
  return {
    x: col * 12.5 + 6.25,
    y: row * 12.5 + 6.25,
  };
}

/**
 * Base position of Paul Morphy vs. Duke Karl / Count Isouard (Paris Opera House, 1858)
 * right after 12...Rd8, before 13.Rxd7!
 */
const OPERA_BASE_PIECES: BoardPiece[] = [
  // White pieces
  { id: "w-kc1", color: "w", role: "k", square: "c1" },
  { id: "w-qb3", color: "w", role: "q", square: "b3" },
  { id: "w-rd1", color: "w", role: "r", square: "d1" },
  { id: "w-rh1", color: "w", role: "r", square: "h1" },
  { id: "w-bb5", color: "w", role: "b", square: "b5" },
  { id: "w-bg5", color: "w", role: "b", square: "g5" },
  { id: "w-pa2", color: "w", role: "p", square: "a2" },
  { id: "w-pb2", color: "w", role: "p", square: "b2" },
  { id: "w-pc2", color: "w", role: "p", square: "c2" },
  { id: "w-pe4", color: "w", role: "p", square: "e4" },
  { id: "w-pf2", color: "w", role: "p", square: "f2" },
  { id: "w-pg2", color: "w", role: "p", square: "g2" },
  { id: "w-ph2", color: "w", role: "p", square: "h2" },
  // Black pieces
  { id: "b-ke8", color: "b", role: "k", square: "e8" },
  { id: "b-qe7", color: "b", role: "q", square: "e7" },
  { id: "b-rd8", color: "b", role: "r", square: "d8" },
  { id: "b-rh8", color: "b", role: "r", square: "h8" },
  { id: "b-bf8", color: "b", role: "b", square: "f8" },
  { id: "b-nd7", color: "b", role: "n", square: "d7" },
  { id: "b-nf6", color: "b", role: "n", square: "f6" },
  { id: "b-pa7", color: "b", role: "p", square: "a7" },
  { id: "b-pe5", color: "b", role: "p", square: "e5" },
  { id: "b-pf7", color: "b", role: "p", square: "f7" },
  { id: "b-pg7", color: "b", role: "p", square: "g7" },
  { id: "b-ph7", color: "b", role: "p", square: "h7" },
];

function applyMove(
  pieces: BoardPiece[],
  movePieceId: string,
  toSquare: string,
  capturedPieceId?: string
): BoardPiece[] {
  return pieces
    .filter((p) => p.id !== capturedPieceId)
    .map((p) => (p.id === movePieceId ? { ...p, square: toSquare } : p));
}

const FRAME_0_PIECES = OPERA_BASE_PIECES;
const FRAME_1_PIECES = applyMove(FRAME_0_PIECES, "w-rd1", "d7", "b-nd7"); // 13. Rxd7
const FRAME_2_PIECES = applyMove(FRAME_1_PIECES, "b-rd8", "d7", "w-rd1"); // 13... Rxd7
const FRAME_3_PIECES = applyMove(FRAME_2_PIECES, "w-rh1", "d1"); // 14. Rd1
const FRAME_4_PIECES = applyMove(FRAME_3_PIECES, "b-qe7", "e6"); // 14... Qe6
const FRAME_5_PIECES = applyMove(FRAME_4_PIECES, "w-bb5", "d7", "b-rd8"); // 15. Bxd7+
const FRAME_6_PIECES = applyMove(FRAME_5_PIECES, "b-nf6", "d7", "w-bb5"); // 15... Nxd7
const FRAME_7_PIECES = applyMove(FRAME_6_PIECES, "w-qb3", "b8"); // 16. Qb8+!
const FRAME_8_PIECES = applyMove(FRAME_7_PIECES, "b-nf6", "b8", "w-qb3"); // 16... Nxb8
const FRAME_9_PIECES = applyMove(FRAME_8_PIECES, "w-rh1", "d8"); // 17. Rd8#

/**
 * The Immortal Opera Game sequence (13.Rxd7 through 17.Rd8#)
 * with stage-aware callouts for Stage 1 (Fetch PGN), Stage 2 (Stockfish), Stage 3 (AI Master Lesson).
 */
const OPERA_SEQUENCE: SequenceFrame[] = [
  {
    plyLabel: "12... Rd8",
    san: "12... Rd8",
    evalLabel: "+3.2",
    evalWhitePct: 74,
    motifBadge: "Absolute Pin on d7",
    stageCallouts: {
      1: "Parsing PGN move tree & reconstructing critical positions...",
      2: "Pin detected: Black's d7 Knight is pinned to King e8.",
      3: "Identifying lead-deficit punishment & open-file control...",
    },
    fromSquare: "a8",
    toSquare: "d8",
    pinnedSquare: "d7",
    vectors: [
      { from: "b5", to: "e8", tone: "gold", dashed: true },
      { from: "d1", to: "d7", tone: "cyan" },
    ],
    pieces: FRAME_0_PIECES,
  },
  {
    plyLabel: "13. Rxd7!",
    san: "13. Rxd7!",
    evalLabel: "+4.6",
    evalWhitePct: 81,
    motifBadge: "Exchange Sacrifice",
    stageCallouts: {
      1: "Indexing capture sequence & time-control transitions...",
      2: "Calculating sacrifice: 13.Rxd7! eliminates the d7 guard.",
      3: "Lesson note: Trade material when the opponent's king is stranded.",
    },
    fromSquare: "d1",
    toSquare: "d7",
    pinnedSquare: "d7",
    capturedPieceId: "b-nd7",
    vectors: [
      { from: "d1", to: "d7", tone: "gold" },
      { from: "b5", to: "e8", tone: "cyan", dashed: true },
    ],
    pieces: FRAME_1_PIECES,
  },
  {
    plyLabel: "13... Rxd7",
    san: "13... Rxd7",
    evalLabel: "+4.8",
    evalWhitePct: 82,
    motifBadge: "Pinned Recapture",
    stageCallouts: {
      1: "Mapping defender exchanges along the open d-file...",
      2: "Pin detected: Black's Rook on d7 is now immobilized by Bb5.",
      3: "Translating engine refutation into plain-English principles...",
    },
    fromSquare: "d8",
    toSquare: "d7",
    pinnedSquare: "d7",
    capturedPieceId: "w-rd1",
    vectors: [
      { from: "b5", to: "e8", tone: "gold", dashed: true },
      { from: "h1", to: "d1", tone: "cyan" },
    ],
    pieces: FRAME_2_PIECES,
  },
  {
    plyLabel: "14. Rd1",
    san: "14. Rd1",
    evalLabel: "+5.9",
    evalWhitePct: 86,
    motifBadge: "Pile Up on the Pinned Piece",
    stageCallouts: {
      1: "Verifying rook battery alignment on the d-file...",
      2: "Double attack vector: Rd1 + Bb5 overload the pinned d7 Rook.",
      3: "Synthesizing coaching lesson: Bring every reserve piece to the party.",
    },
    fromSquare: "h1",
    toSquare: "d1",
    pinnedSquare: "d7",
    vectors: [
      { from: "d1", to: "d7", tone: "gold" },
      { from: "b5", to: "d7", tone: "gold" },
      { from: "g5", to: "f6", tone: "cyan", dashed: true },
    ],
    pieces: FRAME_3_PIECES,
  },
  {
    plyLabel: "14... Qe6",
    san: "14... Qe6",
    evalLabel: "+6.4",
    evalWhitePct: 88,
    motifBadge: "Unpin Attempt",
    stageCallouts: {
      1: "Scanning defensive candidate moves & queen trade offers...",
      2: "Stockfish depth 22: 14...Qe6 fails to relieve the back-rank pressure.",
      3: "Highlighting why trading queens when attacking lets the defender off...",
    },
    fromSquare: "e7",
    toSquare: "e6",
    vectors: [
      { from: "e6", to: "b3", tone: "crimson", dashed: true },
      { from: "b5", to: "d7", tone: "gold" },
    ],
    pieces: FRAME_4_PIECES,
  },
  {
    plyLabel: "15. Bxd7+",
    san: "15. Bxd7+",
    evalLabel: "+9.1",
    evalWhitePct: 92,
    motifBadge: "Forcing Check",
    stageCallouts: {
      1: "Recording forcing check sequence in critical moment log...",
      2: "Calculating forcing line: 15.Bxd7+ strips Black's last file blocker.",
      3: "Building interactive drill for forcing checks before quiet moves...",
    },
    fromSquare: "b5",
    toSquare: "d7",
    checkSquare: "e8",
    capturedPieceId: "b-rd8",
    vectors: [
      { from: "b5", to: "d7", tone: "gold" },
      { from: "d7", to: "e8", tone: "crimson" },
    ],
    pieces: FRAME_5_PIECES,
  },
  {
    plyLabel: "15... Nxd7",
    san: "15... Nxd7",
    evalLabel: "#2",
    evalWhitePct: 95,
    motifBadge: "Overworked Defender",
    stageCallouts: {
      1: "Tagging tactical theme: Deflection & Back-Rank Mate...",
      2: "Mate in 2 detected: Knight on d7 is the sole defender of d8.",
      3: "Linking weakness to curated Lichess deflection & mate studies...",
    },
    fromSquare: "f6",
    toSquare: "d7",
    vectors: [
      { from: "b3", to: "b8", tone: "gold" },
      { from: "d1", to: "d8", tone: "cyan", dashed: true },
    ],
    pieces: FRAME_6_PIECES,
  },
  {
    plyLabel: "16. Qb8+!!",
    san: "16. Qb8+!!",
    evalLabel: "#1",
    evalWhitePct: 98,
    motifBadge: "Brilliant Queen Sacrifice",
    stageCallouts: {
      1: "Extracting sacrificial climax 16.Qb8+!! from game record...",
      2: "Calculating sacrifice: 16.Qb8+!! forces 16...Nxb8, vacating d7.",
      3: "Synthesizing coaching lesson: How deflection shatters defensive glue.",
    },
    fromSquare: "b3",
    toSquare: "b8",
    checkSquare: "e8",
    vectors: [
      { from: "b3", to: "b8", tone: "gold" },
      { from: "b8", to: "e8", tone: "crimson" },
      { from: "d7", to: "b8", tone: "cyan", dashed: true },
    ],
    pieces: FRAME_7_PIECES,
  },
  {
    plyLabel: "16... Nxb8",
    san: "16... Nxb8",
    evalLabel: "#1",
    evalWhitePct: 99,
    motifBadge: "Defender Deflected",
    stageCallouts: {
      1: "Verifying forced reply 16...Nxb8 on back rank...",
      2: "Deflection complete: d8 square is now wide open for Rd1.",
      3: "Preparing Focus Area board & step-by-step tactical breakdown...",
    },
    fromSquare: "d7",
    toSquare: "b8",
    capturedPieceId: "w-qb3",
    vectors: [
      { from: "d1", to: "d8", tone: "gold" },
      { from: "g5", to: "d8", tone: "cyan", dashed: true },
    ],
    pieces: FRAME_8_PIECES,
  },
  {
    plyLabel: "17. Rd8#",
    san: "17. Rd8#",
    evalLabel: "1-0",
    evalWhitePct: 100,
    motifBadge: "Opera Mate · 1-0",
    stageCallouts: {
      1: "PGN structure verified — passing game to coaching engine...",
      2: "Checkmate verified: 17.Rd8# supported by Bishop on g5.",
      3: "Synthesizing coaching lesson: Finalizing your personalized report...",
    },
    fromSquare: "d1",
    toSquare: "d8",
    checkSquare: "e8",
    vectors: [
      { from: "d1", to: "d8", tone: "gold" },
      { from: "g5", to: "d8", tone: "gold", dashed: true },
      { from: "d8", to: "e8", tone: "crimson" },
    ],
    pieces: FRAME_9_PIECES,
  },
];

/**
 * Infers pipeline stage (1, 2, or 3) from status text when `stage` prop is not explicitly provided.
 */
function resolveStage(stageProp?: PipelineStage, rawStatus?: string): PipelineStage {
  if (stageProp === 1 || stageProp === 2 || stageProp === 3) {
    return stageProp;
  }
  const s = (rawStatus || "").toLowerCase();
  if (
    s.includes("ai") ||
    s.includes("generat") ||
    s.includes("writing") ||
    s.includes("report") ||
    s.includes("synthes") ||
    s.includes("coach") ||
    s.includes("lesson")
  ) {
    return 3;
  }
  if (
    s.includes("analyz") ||
    s.includes("engine") ||
    s.includes("eval") ||
    s.includes("stockfish") ||
    s.includes("blunder") ||
    s.includes("calculat") ||
    s.includes("depth")
  ) {
    return 2;
  }
  return 1;
}

/**
 * High-craft Staunton SVG chess piece renderer with tournament contrast & subtle bevel shadow.
 */
function ChessPieceGlyph({
  role,
  color,
}: {
  role: PieceRole;
  color: PieceColor;
}) {
  const isWhite = color === "w";
  const fill = isWhite ? "#fbf6ec" : "#181410";
  const stroke = isWhite ? "#231c14" : "#e2b65f";
  const innerStroke = isWhite ? "#3a2e21" : "#c9993f";

  return (
    <svg
      viewBox="0 0 45 45"
      className="w-[82%] h-[82%] select-none pointer-events-none"
      style={{
        filter: isWhite
          ? "drop-shadow(0 2px 3px rgba(12, 18, 20, 0.68))"
          : "drop-shadow(0 2px 3px rgba(0, 0, 0, 0.78))",
      }}
      aria-hidden="true"
    >
      {role === "p" && (
        <g fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round">
          <path d="M 22.5,9 C 19.5,9 17,11.5 17,14.5 C 17,16.8 18.4,18.7 20.4,19.5 C 17.5,21.2 15.5,24.5 15.5,29 L 29.5,29 C 29.5,24.5 27.5,21.2 24.6,19.5 C 26.6,18.7 28,16.8 28,14.5 C 28,11.5 25.5,9 22.5,9 z" />
          <path d="M 12.5,33.5 L 32.5,33.5 L 31,29.5 L 14,29.5 L 12.5,33.5 z" />
          <path d="M 11,36.5 L 34,36.5" strokeWidth="2.4" />
        </g>
      )}

      {role === "r" && (
        <g
          fill={fill}
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M 11,36 L 34,36 L 32.5,32 L 12.5,32 L 11,36 z" />
          <path d="M 14.5,32 L 16,17.5 L 29,17.5 L 30.5,32 L 14.5,32 z" />
          <path d="M 13,17.5 L 32,17.5 L 32,11 L 29,11 L 29,13.5 L 26,13.5 L 26,11 L 19,11 L 19,13.5 L 16,13.5 L 16,11 L 13,11 L 13,17.5 z" />
          <line x1="16" y1="21" x2="29" y2="21" stroke={innerStroke} strokeWidth="1.3" />
        </g>
      )}

      {role === "n" && (
        <g
          fill={fill}
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18" />
          <path d="M 24,18 C 24.38,20.91 18.45,25.37 16,27 C 13,29 13.18,31.34 11,31 C 9.958,30.06 12.41,27.96 11,28 C 10,28 11.19,29.23 10,30 C 9,30 5.997,31 6,26 C 6,24 12,14 12,14 C 12,14 13.89,12.1 14,10.5 C 13.27,9.506 13.5,8.5 13.5,7.5 C 14.5,6.5 16.5,10 16.5,10 L 18.5,10 C 18.5,10 19.28,8.008 21,7 C 22,7 22,10 22,10" />
          <circle cx="15.5" cy="14.5" r="1.2" fill={innerStroke} stroke="none" />
        </g>
      )}

      {role === "b" && (
        <g
          fill={fill}
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="22.5" cy="8.5" r="2.2" />
          <path d="M 15,32 C 17.5,34.5 27.5,34.5 30,32 C 30.5,30.5 30,30 30,30 C 30,27.5 27.5,26 27.5,26 C 33,24.5 33.5,14.5 22.5,10.5 C 11.5,14.5 12,24.5 17.5,26 C 17.5,26 15,27.5 15,30 C 15,30 14.5,30.5 15,32 z" />
          <path d="M 11.5,36 L 33.5,36" strokeWidth="2.4" />
          <path d="M 20,16.5 L 25,16.5 M 22.5,14 L 22.5,19" stroke={innerStroke} strokeWidth="1.5" />
        </g>
      )}

      {role === "q" && (
        <g
          fill={fill}
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M 9,26 C 17.5,24.5 30,24.5 36,26 L 38.5,13.5 L 31,25 L 30.7,10.9 L 25.5,24.5 L 22.5,10 L 19.5,24.5 L 14.3,10.9 L 14,25 L 6.5,13.5 L 9,26 z" />
          <path d="M 9,26 C 9,28 10.5,28 11.5,30 C 12.5,31.5 12.5,31 12,33.5 C 10.5,34.5 11,36 11,36 C 9.5,37.5 11,38.5 11,38.5 C 17.5,39.5 27.5,39.5 34,38.5 C 34,38.5 35.5,37.5 34,36 C 34,36 34.5,34.5 33,33.5 C 32.5,31 32.5,31.5 33.5,30 C 34.5,28 36,28 36,26 C 27.5,24.5 17.5,24.5 9,26 z" />
          <circle cx="6" cy="12" r="1.6" />
          <circle cx="14" cy="9" r="1.6" />
          <circle cx="22.5" cy="8" r="1.6" />
          <circle cx="31" cy="9" r="1.6" />
          <circle cx="39" cy="12" r="1.6" />
        </g>
      )}

      {role === "k" && (
        <g
          fill={fill}
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M 22.5,11.63 L 22.5,6" />
          <path d="M 20,8 L 25,8" />
          <path d="M 22.5,25 C 22.5,25 27,17.5 25.5,14.5 C 25.5,14.5 24.5,12 22.5,12 C 20.5,12 19.5,14.5 19.5,14.5 C 18,17.5 22.5,25 22.5,25" />
          <path d="M 11.5,37 C 17,40.5 27,40.5 32.5,37 L 32.5,30 C 32.5,30 41.5,25.5 38.5,19.5 C 34.5,13 25,16 22.5,23.5 L 22.5,27 L 22.5,23.5 C 19,16 9.5,13 6.5,19.5 C 3.5,25.5 11.5,29.5 11.5,29.5 L 11.5,37 z" />
          <path d="M 11.5,30 C 17,27 27,27 32.5,30" stroke={innerStroke} strokeWidth="1.4" />
          <path d="M 11.5,33.5 C 17,30.5 27,30.5 32.5,33.5" stroke={innerStroke} strokeWidth="1.4" />
        </g>
      )}
    </svg>
  );
}

const PIPELINE_STEPS: {
  id: PipelineStage;
  label: string;
  sublabel: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}[] = [
  {
    id: 1,
    label: "Fetch PGN",
    sublabel: "Move tree & clocks",
    icon: FileText,
  },
  {
    id: 2,
    label: "Stockfish Engine",
    sublabel: "Centipawn & tactics",
    icon: Brain,
  },
  {
    id: 3,
    label: "AI Master Lesson",
    sublabel: "Plain-English report",
    icon: Sparkles,
  },
];

export function MovingPiecesLoader({
  stage: stageProp,
  statusText,
  status,
  elapsedSeconds = 0,
  onCancel,
  compact = false,
  className,
}: MovingPiecesLoaderProps) {
  const prefersReducedMotion = useReducedMotion();
  const [frameIndex, setFrameIndex] = useState(0);

  const effectiveStatus = statusText ?? status ?? "";
  const activeStage = useMemo(
    () => resolveStage(stageProp, effectiveStatus),
    [stageProp, effectiveStatus]
  );

  // Advance through the tactical Opera Game sacrifice sequence smoothly
  useEffect(() => {
    if (prefersReducedMotion) {
      return;
    }
    const intervalMs = activeStage === 2 ? 1550 : 1850;
    const timer = window.setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % OPERA_SEQUENCE.length);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [activeStage, prefersReducedMotion]);

  const frame = OPERA_SEQUENCE[frameIndex] ?? OPERA_SEQUENCE[0];
  const stageCallout = frame.stageCallouts[activeStage];

  const elapsedLabel =
    elapsedSeconds >= 60
      ? `${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`
      : `${elapsedSeconds}s`;

  const capturedCoords = useMemo(() => {
    if (!frame.capturedPieceId) {
      return null;
    }
    return squareToCoords(frame.toSquare);
  }, [frame.capturedPieceId, frame.toSquare]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Analyzing chess game: Stage ${activeStage} of 3`}
      className={cn(
        "relative w-full overflow-hidden rounded-[var(--radius-card,12px)] border border-[var(--line,rgba(255,255,255,0.08))] bg-[var(--ink-2,#0f1518)] text-[var(--text,#f0f4f5)] shadow-[0_20px_50px_rgba(0,0,0,0.55)]",
        compact ? "p-3.5 sm:p-4" : "p-4 sm:p-6",
        className
      )}
    >
      {/* Subtle ambient gold & cyan tournament radial glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-56 w-[85%] rounded-full opacity-30 blur-3xl"
        style={{
          background:
            activeStage === 2
              ? "radial-gradient(circle, rgba(6,182,212,0.28) 0%, rgba(201,153,63,0.18) 55%, transparent 75%)"
              : "radial-gradient(circle, rgba(226,182,95,0.28) 0%, rgba(201,153,63,0.12) 55%, transparent 75%)",
        }}
      />

      {/* Top Pipeline Stepper Header */}
      <div className="relative z-10 flex flex-col gap-3 pb-4 border-b border-[var(--line-soft,rgba(255,255,255,0.05))]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-[var(--gold-bright,#e2b65f)] shadow-[0_0_10px_#e2b65f] animate-pulse" />
            <span className="font-mono text-[0.7rem] tracking-wider uppercase text-[var(--gold-bright,#e2b65f)]">
              Live Tactical Telemetry · Stage {activeStage}/3
            </span>
          </div>

          <div className="flex items-center gap-2.5 font-mono text-xs text-[var(--text-muted,#8fa0a8)]">
            <span className="px-2 py-0.5 rounded bg-[var(--ink-3,#151f24)] border border-[var(--line,rgba(255,255,255,0.08))] text-[var(--text,#f0f4f5)]">
              Morphy · Paris 1858
            </span>
            {elapsedSeconds > 0 && (
              <span className="tabular-nums text-[var(--text-muted,#8fa0a8)]">
                {elapsedLabel}
              </span>
            )}
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-[var(--radius-control,8px)] border border-[var(--line-strong,rgba(255,255,255,0.16))] text-[var(--text-muted,#8fa0a8)] hover:text-[var(--text,#f0f4f5)] hover:border-[rgba(239,68,68,0.55)] hover:bg-[rgba(239,68,68,0.1)] transition-colors cursor-pointer"
              >
                <X size={12} aria-hidden="true" />
                <span>Cancel</span>
              </button>
            )}
          </div>
        </div>

        {/* 3-Stage Pipeline Track */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          {PIPELINE_STEPS.map((step) => {
            const isDone = activeStage > step.id;
            const isActive = activeStage === step.id;
            const StepIcon = step.icon;

            return (
              <div
                key={step.id}
                className={cn(
                  "relative flex items-center gap-2.5 rounded-[var(--radius-control,8px)] px-2.5 py-2 border transition-all duration-300",
                  isDone &&
                    "bg-[rgba(111,163,131,0.1)] border-[rgba(111,163,131,0.4)]",
                  isActive &&
                    "bg-[rgba(201,153,63,0.13)] border-[var(--gold,#c9993f)] shadow-[0_0_20px_rgba(201,153,63,0.14)]",
                  !isDone &&
                    !isActive &&
                    "bg-[var(--ink-3,#151f24)]/60 border-[var(--line-soft,rgba(255,255,255,0.05))] opacity-65"
                )}
              >
                <div
                  className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-mono text-xs transition-colors",
                    isDone && "bg-[var(--green,#6fa383)] text-[#080c0e]",
                    isActive &&
                      "bg-[var(--gold,#c9993f)] text-[#080c0e] ring-4 ring-[rgba(226,182,95,0.2)]",
                    !isDone &&
                      !isActive &&
                      "bg-[var(--ink-2,#0f1518)] text-[var(--text-muted,#8fa0a8)] border border-[var(--line,rgba(255,255,255,0.08))]"
                  )}
                >
                  {isDone ? (
                    <Check size={14} strokeWidth={3} />
                  ) : isActive ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <StepIcon size={13} />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "text-xs font-semibold truncate",
                      isDone && "text-[var(--text,#f0f4f5)]",
                      isActive && "text-[var(--gold-bright,#e2b65f)]",
                      !isDone && !isActive && "text-[var(--text-muted,#8fa0a8)]"
                    )}
                  >
                    {step.label}
                  </div>
                  <div className="hidden sm:block text-[0.68rem] text-[var(--text-muted,#8fa0a8)] truncate">
                    {step.sublabel}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Stage: Classical 8x8 Board + Eval Bar + Tactical Telemetry Panel */}
      <div
        className={cn(
          "relative z-10 mt-4 grid items-center gap-4 sm:gap-6",
          compact
            ? "grid-cols-1 md:grid-cols-[220px_1fr]"
            : "grid-cols-1 md:grid-cols-[268px_1fr]"
        )}
      >
        {/* Left: Eval Bar + 8x8 Classical Tournament Chessboard */}
        <div className="flex items-stretch justify-center gap-2.5 mx-auto w-full max-w-[280px]">
          {/* Vertical Stockfish Evaluation Bar */}
          <div
            aria-hidden="true"
            className="w-4 rounded-[6px] bg-[#1b2226] border border-[var(--line-strong,rgba(255,255,255,0.16))] relative overflow-hidden flex flex-col justify-end shrink-0 shadow-inner"
          >
            <motion.div
              className="w-full rounded-b-[5px]"
              style={{
                background:
                  "linear-gradient(180deg, #e2b65f 0%, #fbf6ec 28%, #e0d0b0 100%)",
              }}
              animate={{ height: `${frame.evalWhitePct}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />
            <span className="absolute top-1.5 inset-x-0 text-center font-mono text-[0.54rem] font-bold tracking-tighter text-[#fbf6ec] drop-shadow">
              SF
            </span>
            <span className="absolute bottom-1.5 inset-x-0 text-center font-mono text-[0.54rem] font-bold tracking-tighter text-[#181410]">
              {frame.evalLabel}
            </span>
          </div>

          {/* 8x8 Chessboard in Dark Ink Frame */}
          <div className="relative flex-1 aspect-square rounded-[10px] p-1.5 bg-[#0a0f12] border border-[rgba(201,153,63,0.38)] shadow-[0_14px_34px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.08)]">
            <div className="relative w-full h-full rounded-[6px] overflow-hidden grid grid-cols-8 grid-rows-8">
              {/* 64 Classical Tournament Wood Squares */}
              {RANKS.map((rank, rowIdx) =>
                FILES.map((file, colIdx) => {
                  const sq = `${file}${rank}`;
                  const isLight = (rowIdx + colIdx) % 2 === 0;
                  const isFrom = frame.fromSquare === sq;
                  const isTo = frame.toSquare === sq;
                  const isCheck = frame.checkSquare === sq;
                  const isPinned = frame.pinnedSquare === sq;

                  return (
                    <div
                      key={sq}
                      className="relative select-none"
                      style={{
                        backgroundColor: isLight
                          ? "var(--sq-light, #e0d0b0)"
                          : "var(--sq-dark, #8c6a46)",
                      }}
                    >
                      {/* Origin / Destination Gold Highlight */}
                      {(isFrom || isTo) && (
                        <motion.div
                          layoutId={isTo ? "loader-to-hl" : undefined}
                          className="absolute inset-0"
                          style={{
                            backgroundColor: isTo
                              ? "rgba(226, 182, 95, 0.58)"
                              : "rgba(201, 153, 63, 0.36)",
                            boxShadow: isTo
                              ? "inset 0 0 0 1.5px rgba(226, 182, 95, 0.9)"
                              : "none",
                          }}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.25 }}
                        />
                      )}

                      {/* Pinned Piece Telemetry Ring */}
                      {isPinned && (
                        <motion.div
                          className="absolute inset-[10%] rounded-full border-2 border-dashed border-[#06b6d4] pointer-events-none"
                          animate={{ rotate: 360 }}
                          transition={{
                            duration: 8,
                            repeat: Number.POSITIVE_INFINITY,
                            ease: "linear",
                          }}
                        />
                      )}

                      {/* Check / Mate Crimson Glow */}
                      {isCheck && (
                        <motion.div
                          className="absolute inset-0 pointer-events-none"
                          style={{
                            background:
                              "radial-gradient(circle, rgba(239,68,68,0.72) 0%, rgba(239,68,68,0.28) 68%, transparent 100%)",
                          }}
                          animate={{ opacity: [0.65, 1, 0.65] }}
                          transition={{
                            duration: 1.1,
                            repeat: Number.POSITIVE_INFINITY,
                          }}
                        />
                      )}

                      {/* File & Rank Edge Coordinates */}
                      {colIdx === 0 && (
                        <span
                          className="absolute top-0.5 left-1 font-mono text-[0.52rem] font-bold leading-none opacity-80"
                          style={{
                            color: isLight ? "#8c6a46" : "#e0d0b0",
                          }}
                        >
                          {rank}
                        </span>
                      )}
                      {rowIdx === 7 && (
                        <span
                          className="absolute bottom-0.5 right-1 font-mono text-[0.52rem] font-bold leading-none opacity-80"
                          style={{
                            color: isLight ? "#8c6a46" : "#e0d0b0",
                          }}
                        >
                          {file}
                        </span>
                      )}
                    </div>
                  );
                })
              )}

              {/* Capture Burst Ring */}
              <AnimatePresence mode="popLayout">
                {capturedCoords && (
                  <motion.div
                    key={`burst-${frame.plyLabel}`}
                    className="pointer-events-none absolute z-10 rounded-full border-2 border-[var(--gold-bright,#e2b65f)]"
                    style={{
                      width: "12.5%",
                      height: "12.5%",
                      left: `${capturedCoords.col * 12.5}%`,
                      top: `${capturedCoords.row * 12.5}%`,
                    }}
                    initial={{ scale: 0.4, opacity: 0.95 }}
                    animate={{ scale: 1.65, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.55, ease: "easeOut" }}
                  />
                )}
              </AnimatePresence>

              {/* Evaluation Pulse Vectors (SVG Tactical Overlay) */}
              <svg
                viewBox="0 0 100 100"
                className="pointer-events-none absolute inset-0 w-full h-full z-20"
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="loader-arrow-gold"
                    viewBox="0 0 10 10"
                    refX="7"
                    refY="5"
                    markerWidth="4.2"
                    markerHeight="4.2"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#e2b65f" />
                  </marker>
                  <marker
                    id="loader-arrow-cyan"
                    viewBox="0 0 10 10"
                    refX="7"
                    refY="5"
                    markerWidth="4.2"
                    markerHeight="4.2"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#06b6d4" />
                  </marker>
                  <marker
                    id="loader-arrow-crimson"
                    viewBox="0 0 10 10"
                    refX="7"
                    refY="5"
                    markerWidth="4.2"
                    markerHeight="4.2"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#ef4444" />
                  </marker>
                </defs>

                {frame.vectors.map((vec, idx) => {
                  const start = squareToSvgPoint(vec.from);
                  const end = squareToSvgPoint(vec.to);
                  const strokeColor =
                    vec.tone === "gold"
                      ? "#e2b65f"
                      : vec.tone === "cyan"
                        ? "#06b6d4"
                        : "#ef4444";
                  const markerId =
                    vec.tone === "gold"
                      ? "url(#loader-arrow-gold)"
                      : vec.tone === "cyan"
                        ? "url(#loader-arrow-cyan)"
                        : "url(#loader-arrow-crimson)";

                  return (
                    <g key={`${frame.plyLabel}-${vec.from}-${vec.to}-${idx}`}>
                      <motion.line
                        x1={start.x}
                        y1={start.y}
                        x2={end.x}
                        y2={end.y}
                        stroke={strokeColor}
                        strokeWidth={vec.dashed ? "1.35" : "1.85"}
                        strokeDasharray={vec.dashed ? "2.6 2.2" : undefined}
                        strokeLinecap="round"
                        markerEnd={markerId}
                        initial={{ opacity: 0, pathLength: 0.2 }}
                        animate={{ opacity: 0.92, pathLength: 1 }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                      />
                      <motion.circle
                        cx={end.x}
                        cy={end.y}
                        r="3.6"
                        fill="none"
                        stroke={strokeColor}
                        strokeWidth="0.8"
                        initial={{ scale: 0.6, opacity: 0.85 }}
                        animate={{ scale: 1.45, opacity: 0 }}
                        transition={{
                          duration: 1.2,
                          repeat: Number.POSITIVE_INFINITY,
                          ease: "easeOut",
                        }}
                      />
                    </g>
                  );
                })}
              </svg>

              {/* Animated Chess Pieces Layer */}
              <div className="pointer-events-none absolute inset-0 z-10">
                <AnimatePresence initial={false}>
                  {frame.pieces.map((piece) => {
                    const { col, row } = squareToCoords(piece.square);
                    const isMovingPiece = piece.square === frame.toSquare;

                    return (
                      <motion.div
                        key={piece.id}
                        initial={{ opacity: 0, scale: 0.6 }}
                        animate={{
                          left: `${col * 12.5}%`,
                          top: `${row * 12.5}%`,
                          opacity: 1,
                          scale: isMovingPiece ? [1, 1.14, 1] : 1,
                        }}
                        exit={{
                          opacity: 0,
                          scale: 0.25,
                          transition: { duration: 0.2 },
                        }}
                        transition={{
                          type: "spring",
                          stiffness: 250,
                          damping: 25,
                          mass: 0.85,
                        }}
                        style={{
                          width: "12.5%",
                          height: "12.5%",
                          zIndex: isMovingPiece ? 15 : 10,
                        }}
                        className="absolute flex items-center justify-center"
                      >
                        <ChessPieceGlyph
                          role={piece.role}
                          color={piece.color}
                        />
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Tactical Motif Callouts & Stage-Synced Coaching Telemetry */}
        <div className="flex flex-col justify-between gap-3.5 min-w-0">
          {/* Move Badge + Motif Pill */}
          <div className="flex flex-wrap items-center gap-2">
            <AnimatePresence mode="wait">
              <motion.span
                key={frame.san}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-control,8px)] bg-[rgba(226,182,95,0.16)] border border-[var(--gold,#c9993f)] font-mono text-xs font-bold text-[var(--gold-bright,#e2b65f)]"
              >
                <Flame size={13} className="shrink-0" />
                <span>{frame.san}</span>
              </motion.span>
            </AnimatePresence>

            <AnimatePresence mode="wait">
              <motion.span
                key={frame.motifBadge}
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.22 }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-control,8px)] bg-[var(--ink-3,#151f24)] border border-[var(--line-strong,rgba(255,255,255,0.16))] text-xs font-medium text-[var(--text,#f0f4f5)]"
              >
                <Target
                  size={12}
                  className="text-[var(--cyan,#06b6d4)] shrink-0"
                />
                <span>{frame.motifBadge}</span>
              </motion.span>
            </AnimatePresence>

            <span className="ml-auto font-mono text-xs font-bold px-2 py-0.5 rounded bg-[var(--ink-3,#151f24)] border border-[var(--line,rgba(255,255,255,0.08))] text-[var(--gold-bright,#e2b65f)]">
              Eval {frame.evalLabel}
            </span>
          </div>

          {/* Primary Tactical Callout Card */}
          <div className="rounded-[var(--radius-control,8px)] bg-[var(--ink-3,#151f24)] border border-[var(--line,rgba(255,255,255,0.08))] p-3.5 shadow-inner">
            <div className="flex items-center gap-2 text-[0.7rem] font-mono uppercase tracking-wider text-[var(--text-muted,#8fa0a8)] mb-1.5">
              {activeStage === 1 && (
                <>
                  <Compass
                    size={13}
                    className="text-[var(--gold-bright,#e2b65f)]"
                  />
                  <span>PGN Ingestion & Move Tree Validation</span>
                </>
              )}
              {activeStage === 2 && (
                <>
                  <Cpu size={13} className="text-[var(--cyan,#06b6d4)]" />
                  <span>Stockfish Tactical Scanner · Multi-PV</span>
                </>
              )}
              {activeStage === 3 && (
                <>
                  <Sparkles
                    size={13}
                    className="text-[var(--gold-bright,#e2b65f)]"
                  />
                  <span>FIDE AIM Coaching Synthesis</span>
                </>
              )}
            </div>

            <AnimatePresence mode="wait">
              <motion.p
                key={`${activeStage}-${frame.plyLabel}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.24 }}
                className="text-sm sm:text-[0.94rem] font-medium leading-snug text-[var(--text,#f0f4f5)]"
              >
                {stageCallout}
              </motion.p>
            </AnimatePresence>

            {/* Backend Live SSE Status Stream Line */}
            {effectiveStatus && (
              <div className="mt-2.5 pt-2 border-t border-[var(--line-soft,rgba(255,255,255,0.05))] flex items-center gap-2 font-mono text-xs text-[var(--gold-bright,#e2b65f)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold-bright,#e2b65f)] animate-ping shrink-0" />
                <span className="truncate">{effectiveStatus}</span>
              </div>
            )}
          </div>

          {/* Opera Game Notation Scrubber Strip */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[0.68rem] font-mono text-[var(--text-muted,#8fa0a8)]">
              <span className="inline-flex items-center gap-1">
                <ShieldAlert size={11} className="text-[var(--gold,#c9993f)]" />
                <span>Opera Game Sacrifice Sequence</span>
              </span>
              <span>
                Step {frameIndex + 1}/{OPERA_SEQUENCE.length}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              {OPERA_SEQUENCE.map((stepFrame, idx) => {
                const isCurrent = idx === frameIndex;
                const isPast = idx < frameIndex;
                return (
                  <button
                    key={stepFrame.plyLabel}
                    type="button"
                    onClick={() => setFrameIndex(idx)}
                    aria-label={`Jump to move ${stepFrame.plyLabel}`}
                    className={cn(
                      "px-1.5 py-0.5 rounded font-mono text-[0.66rem] transition-all cursor-pointer border",
                      isCurrent &&
                        "bg-[var(--gold,#c9993f)] text-[#080c0e] border-[var(--gold-bright,#e2b65f)] font-bold shadow-xs",
                      isPast &&
                        "bg-[var(--ink-3,#151f24)] text-[var(--text,#f0f4f5)] border-[var(--line,rgba(255,255,255,0.08))]",
                      !isCurrent &&
                        !isPast &&
                        "bg-transparent text-[var(--text-muted,#8fa0a8)] border-transparent hover:border-[var(--line-soft,rgba(255,255,255,0.05))]"
                    )}
                  >
                    {stepFrame.plyLabel}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MovingPiecesLoader;
