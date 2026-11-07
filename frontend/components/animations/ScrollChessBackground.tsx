"use client";

import React from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { cn } from "../../lib/utils";

export type ScrollChessSceneId =
  | "hero"
  | "overview"
  | "faq"
  | "samples"
  | "pricing";

export interface ScrollChessBackgroundProps {
  activeSection?: ScrollChessSceneId | number | string;
  activeScene?: number;
  scrollProgress?: number;
  previewMode?: boolean;
  onSceneChange?: (sceneIndex: number, sceneId: ScrollChessSceneId) => void;
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

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;

function squareToCoords(square: string): { col: number; row: number } {
  const fileCode = square.charCodeAt(0) - 97;
  const rankNum = Number.parseInt(square[1] ?? "1", 10);
  return {
    col: Math.max(0, Math.min(7, fileCode)),
    row: Math.max(0, Math.min(7, 8 - rankNum)),
  };
}

function squareToSvgPoint(square: string): { x: number; y: number } {
  const { col, row } = squareToCoords(square);
  return {
    x: col * 12.5 + 6.25,
    y: row * 12.5 + 6.25,
  };
}

const BOARD_PIECES: BoardPiece[] = [
  // White
  { id: "w-k", color: "w", role: "k", square: "g1" },
  { id: "w-q", color: "w", role: "q", square: "d2" },
  { id: "w-r1", color: "w", role: "r", square: "d1" },
  { id: "w-r2", color: "w", role: "r", square: "f1" },
  { id: "w-b-dark", color: "w", role: "b", square: "g5" },
  { id: "w-b-light", color: "w", role: "b", square: "c4" },
  { id: "w-n1", color: "w", role: "n", square: "c3" },
  { id: "w-n2", color: "w", role: "n", square: "d4" },
  { id: "w-pa", color: "w", role: "p", square: "a2" },
  { id: "w-pb", color: "w", role: "p", square: "b2" },
  { id: "w-pc", color: "w", role: "p", square: "c2" },
  { id: "w-pe", color: "w", role: "p", square: "e4" },
  { id: "w-pf", color: "w", role: "p", square: "f2" },
  { id: "w-pg", color: "w", role: "p", square: "g2" },
  { id: "w-ph", color: "w", role: "p", square: "h2" },
  // Black
  { id: "b-k", color: "b", role: "k", square: "g8" },
  { id: "b-q", color: "b", role: "q", square: "d8" },
  { id: "b-r1", color: "b", role: "r", square: "a8" },
  { id: "b-r2", color: "b", role: "r", square: "f8" },
  { id: "b-b-light", color: "b", role: "b", square: "e6" },
  { id: "b-b-dark", color: "b", role: "b", square: "e7" },
  { id: "b-n1", color: "b", role: "n", square: "d7" },
  { id: "b-n2", color: "b", role: "n", square: "f6" },
  { id: "b-pa", color: "b", role: "p", square: "a6" },
  { id: "b-pb", color: "b", role: "p", square: "b5" },
  { id: "b-pd", color: "b", role: "p", square: "d6" },
  { id: "b-pe", color: "b", role: "p", square: "e5" },
  { id: "b-pf", color: "b", role: "p", square: "f7" },
  { id: "b-pg", color: "b", role: "p", square: "g7" },
  { id: "b-ph", color: "b", role: "p", square: "h6" },
];

const HIGHLIGHT_SQUARES = new Set(["c3", "d5", "f5", "f6", "g5", "e6"]);

const VECTORS = [
  { from: "c3", to: "d5", color: "#e2b65f", dashed: false },
  { from: "d4", to: "f5", color: "#22c55e", dashed: false },
  { from: "g5", to: "d8", color: "#06b6d4", dashed: true },
  { from: "c4", to: "e6", color: "#e2b65f", dashed: true },
];

function EtchedChessPiece({
  role,
  color,
}: {
  role: PieceRole;
  color: PieceColor;
}) {
  const isWhite = color === "w";
  const fill = isWhite ? "rgba(244, 238, 226, 0.42)" : "rgba(10, 15, 19, 0.92)";
  const stroke = isWhite ? "rgba(226, 182, 95, 0.92)" : "rgba(180, 196, 204, 0.68)";

  return (
    <svg
      viewBox="0 0 45 45"
      className="w-[78%] h-[78%] select-none pointer-events-none"
      aria-hidden="true"
    >
      {role === "p" && (
        <g fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round">
          <path d="M 22.5,9 C 19.5,9 17,11.5 17,14.5 C 17,16.8 18.4,18.7 20.4,19.5 C 17.5,21.2 15.5,24.5 15.5,29 L 29.5,29 C 29.5,24.5 27.5,21.2 24.6,19.5 C 26.6,18.7 28,16.8 28,14.5 C 28,11.5 25.5,9 22.5,9 z" />
          <path d="M 12.5,33.5 L 32.5,33.5 L 31,29.5 L 14,29.5 L 12.5,33.5 z" />
          <path d="M 11,36.5 L 34,36.5" strokeWidth="2.2" />
        </g>
      )}
      {role === "r" && (
        <g fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 11,36 L 34,36 L 32.5,32 L 12.5,32 L 11,36 z" />
          <path d="M 14.5,32 L 16,17.5 L 29,17.5 L 30.5,32 L 14.5,32 z" />
          <path d="M 13,17.5 L 32,17.5 L 32,11 L 29,11 L 29,13.5 L 26,13.5 L 26,11 L 19,11 L 19,13.5 L 16,13.5 L 16,11 L 13,11 L 13,17.5 z" />
        </g>
      )}
      {role === "n" && (
        <g fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18" />
          <path d="M 24,18 C 24.38,20.91 18.45,25.37 16,27 C 13,29 13.18,31.34 11,31 C 9.958,30.06 12.41,27.96 11,28 C 10,28 11.19,29.23 10,30 C 9,30 5.997,31 6,26 C 6,24 12,14 12,14 C 12,14 13.89,12.1 14,10.5 C 13.27,9.506 13.5,8.5 13.5,7.5 C 14.5,6.5 16.5,10 16.5,10 L 18.5,10 C 18.5,10 19.28,8.008 21,7 C 22,7 22,10 22,10" />
        </g>
      )}
      {role === "b" && (
        <g fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="22.5" cy="8.5" r="2.2" />
          <path d="M 15,32 C 17.5,34.5 27.5,34.5 30,32 C 30.5,30.5 30,30 30,30 C 30,27.5 27.5,26 27.5,26 C 33,24.5 33.5,14.5 22.5,10.5 C 11.5,14.5 12,24.5 17.5,26 C 17.5,26 15,27.5 15,30 C 15,30 14.5,30.5 15,32 z" />
          <path d="M 11.5,36 L 33.5,36" strokeWidth="2.2" />
        </g>
      )}
      {role === "q" && (
        <g fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 9,26 C 17.5,24.5 30,24.5 36,26 L 38.5,13.5 L 31,25 L 30.7,10.9 L 25.5,24.5 L 22.5,10 L 19.5,24.5 L 14.3,10.9 L 14,25 L 6.5,13.5 L 9,26 z" />
          <path d="M 9,26 C 9,28 10.5,28 11.5,30 C 12.5,31.5 12.5,31 12,33.5 C 10.5,34.5 11,36 11,36 C 9.5,37.5 11,38.5 11,38.5 C 17.5,39.5 27.5,39.5 34,38.5 C 34,38.5 35.5,37.5 34,36 C 34,36 34.5,34.5 33,33.5 C 32.5,31 32.5,31.5 33.5,30 C 34.5,28 36,28 36,26 C 27.5,24.5 17.5,24.5 9,26 z" />
        </g>
      )}
      {role === "k" && (
        <g fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 22.5,11.63 L 22.5,6" />
          <path d="M 20,8 L 25,8" />
          <path d="M 22.5,25 C 22.5,25 27,17.5 25.5,14.5 C 25.5,14.5 24.5,12 22.5,12 C 20.5,12 19.5,14.5 19.5,14.5 C 18,17.5 22.5,25 22.5,25" />
          <path d="M 11.5,37 C 17,40.5 27,40.5 32.5,37 L 32.5,30 C 32.5,30 41.5,25.5 38.5,19.5 C 34.5,13 25,16 22.5,23.5 L 22.5,27 L 22.5,23.5 C 19,16 9.5,13 6.5,19.5 C 3.5,25.5 11.5,29.5 11.5,29.5 L 11.5,37 z" />
        </g>
      )}
    </svg>
  );
}

/**
 * Full-stage, GPU-composited scroll-driven 3D chessboard background.
 * Centered at 1140px width so it fills both left and right sides of the Hero
 * and remains clearly visible around and between every section as you scroll.
 */
export function ScrollChessBackground({
  className,
}: ScrollChessBackgroundProps) {
  const prefersReducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();

  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 70,
    damping: 26,
    mass: 0.45,
    restDelta: 0.0005,
  });

  // Centered in Hero (0% X offset) and large enough (scale 1.06 -> 1.24) to frame both left & right sides
  const scale = useTransform(
    smoothProgress,
    [0, 0.25, 0.5, 0.75, 1],
    prefersReducedMotion ? [1.05, 1.05, 1.05, 1.05, 1.05] : [1.06, 1.22, 1.15, 1.25, 1.08]
  );
  const rotateX = useTransform(
    smoothProgress,
    [0, 0.25, 0.5, 0.75, 1],
    prefersReducedMotion ? [20, 20, 20, 20, 20] : [22, 14, 24, 16, 20]
  );
  const rotateZ = useTransform(
    smoothProgress,
    [0, 0.25, 0.5, 0.75, 1],
    prefersReducedMotion ? [-6, -6, -6, -6, -6] : [-6, 5, -7, 4, 0]
  );
  const translateX = useTransform(
    smoothProgress,
    [0, 0.25, 0.5, 0.75, 1],
    prefersReducedMotion ? ["0%", "0%", "0%", "0%", "0%"] : ["0%", "6%", "-6%", "5%", "0%"]
  );
  const translateY = useTransform(
    smoothProgress,
    [0, 0.25, 0.5, 0.75, 1],
    prefersReducedMotion ? ["0%", "0%", "0%", "0%", "0%"] : ["0%", "-4%", "4%", "-3%", "0%"]
  );

  // 3 Scroll-driven tactical piece combinations across the page:
  // 1) White Knight c3 (25%, 62.5%) -> d5 (37.5%, 37.5%)
  const n1Left = useTransform(smoothProgress, [0.05, 0.25], ["25%", "37.5%"]);
  const n1Top = useTransform(smoothProgress, [0.05, 0.25], ["62.5%", "37.5%"]);

  // 2) White Knight d4 (37.5%, 50%) -> f5 (62.5%, 37.5%)
  const n2Left = useTransform(smoothProgress, [0.3, 0.52], ["37.5%", "62.5%"]);
  const n2Top = useTransform(smoothProgress, [0.3, 0.52], ["50%", "37.5%"]);

  // 3) White Bishop c4 (25%, 50%) -> e6 (50%, 25%)
  const bLightLeft = useTransform(smoothProgress, [0.58, 0.82], ["25%", "50%"]);
  const bLightTop = useTransform(smoothProgress, [0.58, 0.82], ["50%", "25%"]);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none fixed inset-0 z-0 overflow-hidden select-none",
        className
      )}
    >
      {/* Ambient Radial Gold Glow */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(1200px 720px at 50% 45%, rgba(201, 153, 63, 0.12), rgba(6, 182, 212, 0.05) 50%, transparent 82%)",
        }}
      />

      {/* Content-column vignette: keeps hero and section text legible over the board */}
      <div
        className="absolute inset-0 z-[1]"
        style={{
          background:
            "radial-gradient(ellipse 620px 100% at 50% 50%, rgba(6, 10, 12, 0.82), rgba(6, 10, 12, 0.45) 70%, transparent 100%)",
        }}
      />

      {/* Full-Stage 3D Chessboard (1140px max width so both left and right sides are filled) */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ perspective: "1500px" }}
      >
        <motion.div
          style={{
            scale,
            rotateX,
            rotateZ,
            x: translateX,
            y: translateY,
            transformStyle: "preserve-3d",
            willChange: "transform",
          }}
          className="relative w-[min(114vw,1140px)] aspect-square opacity-45"
        >
          <div className="relative w-full h-full rounded-[22px] p-3.5 bg-[#090e12]/90 border border-[rgba(226,182,95,0.38)] shadow-[0_40px_110px_rgba(0,0,0,0.92)]">
            <div className="relative w-full h-full rounded-[14px] overflow-hidden grid grid-cols-8 grid-rows-8 border border-[rgba(226,182,95,0.24)]">
              {RANKS.map((rank, rowIdx) =>
                FILES.map((file, colIdx) => {
                  const sq = `${file}${rank}`;
                  const isLight = (rowIdx + colIdx) % 2 === 0;
                  const isHighlighted = HIGHLIGHT_SQUARES.has(sq);

                  return (
                    <div
                      key={sq}
                      className="relative"
                      style={{
                        backgroundColor: isHighlighted
                          ? "rgba(201, 153, 63, 0.30)"
                          : isLight
                            ? "#1b272e"
                            : "#0e1519",
                        boxShadow: isHighlighted
                          ? "inset 0 0 0 1.5px rgba(226, 182, 95, 0.65)"
                          : "inset 0 0 0 0.5px rgba(255, 255, 255, 0.04)",
                      }}
                    >
                      {colIdx === 0 && (
                        <span className="absolute top-1 left-1.5 font-mono text-[0.62rem] text-[var(--gold)]/60">
                          {rank}
                        </span>
                      )}
                      {rowIdx === 7 && (
                        <span className="absolute bottom-1 right-1.5 font-mono text-[0.62rem] text-[var(--gold)]/60">
                          {file}
                        </span>
                      )}
                    </div>
                  );
                })
              )}

              {/* Tactical SVG Vectors */}
              <svg
                viewBox="0 0 100 100"
                className="absolute inset-0 w-full h-full z-20 pointer-events-none"
              >
                <defs>
                  <marker
                    id="scroll-arrow-gold"
                    viewBox="0 0 10 10"
                    refX="7"
                    refY="5"
                    markerWidth="4.2"
                    markerHeight="4.2"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="rgba(226, 182, 95, 0.85)" />
                  </marker>
                  <marker
                    id="scroll-arrow-cyan"
                    viewBox="0 0 10 10"
                    refX="7"
                    refY="5"
                    markerWidth="4.2"
                    markerHeight="4.2"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="rgba(6, 182, 212, 0.78)" />
                  </marker>
                </defs>

                {VECTORS.map((vec, i) => {
                  const start = squareToSvgPoint(vec.from);
                  const end = squareToSvgPoint(vec.to);
                  const isCyan = vec.color.includes("06b6d4");
                  return (
                    <g key={i}>
                      <line
                        x1={start.x}
                        y1={start.y}
                        x2={end.x}
                        y2={end.y}
                        stroke={isCyan ? "rgba(6, 182, 212, 0.68)" : "rgba(226, 182, 95, 0.75)"}
                        strokeWidth={vec.dashed ? "1.2" : "1.65"}
                        strokeDasharray={vec.dashed ? "2.4 2" : undefined}
                        strokeLinecap="round"
                        markerEnd={
                          isCyan ? "url(#scroll-arrow-cyan)" : "url(#scroll-arrow-gold)"
                        }
                      />
                      <circle
                        cx={end.x}
                        cy={end.y}
                        r="2.6"
                        fill="none"
                        stroke={isCyan ? "rgba(6, 182, 212, 0.68)" : "rgba(226, 182, 95, 0.75)"}
                        strokeWidth="0.85"
                      />
                    </g>
                  );
                })}
              </svg>

              {/* Pieces Layer with 3 Scroll-Animated Tactical Pieces */}
              <div className="absolute inset-0 z-10 pointer-events-none">
                {BOARD_PIECES.map((piece) => {
                  const { col, row } = squareToCoords(piece.square);

                  if (!prefersReducedMotion && piece.id === "w-n1") {
                    return (
                      <motion.div
                        key={piece.id}
                        style={{
                          left: n1Left,
                          top: n1Top,
                          width: "12.5%",
                          height: "12.5%",
                          willChange: "left, top",
                        }}
                        className="absolute flex items-center justify-center"
                      >
                        <EtchedChessPiece role={piece.role} color={piece.color} />
                      </motion.div>
                    );
                  }

                  if (!prefersReducedMotion && piece.id === "w-n2") {
                    return (
                      <motion.div
                        key={piece.id}
                        style={{
                          left: n2Left,
                          top: n2Top,
                          width: "12.5%",
                          height: "12.5%",
                          willChange: "left, top",
                        }}
                        className="absolute flex items-center justify-center"
                      >
                        <EtchedChessPiece role={piece.role} color={piece.color} />
                      </motion.div>
                    );
                  }

                  if (!prefersReducedMotion && piece.id === "w-b-light") {
                    return (
                      <motion.div
                        key={piece.id}
                        style={{
                          left: bLightLeft,
                          top: bLightTop,
                          width: "12.5%",
                          height: "12.5%",
                          willChange: "left, top",
                        }}
                        className="absolute flex items-center justify-center"
                      >
                        <EtchedChessPiece role={piece.role} color={piece.color} />
                      </motion.div>
                    );
                  }

                  return (
                    <div
                      key={piece.id}
                      style={{
                        left: `${col * 12.5}%`,
                        top: `${row * 12.5}%`,
                        width: "12.5%",
                        height: "12.5%",
                      }}
                      className="absolute flex items-center justify-center"
                    >
                      <EtchedChessPiece role={piece.role} color={piece.color} />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Narrow Center-Column Text Protection Mask + Outer Edge Frame (Leaves Left & Right Board Wings Bright & Visible) */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 36% 26% at 50% 18%, rgba(8, 12, 14, 0.72) 0%, transparent 100%), radial-gradient(circle at 50% 50%, transparent 55%, rgba(8, 12, 14, 0.88) 100%)",
        }}
      />
    </div>
  );
}

export default ScrollChessBackground;
