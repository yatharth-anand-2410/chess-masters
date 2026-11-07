"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Trophy, Sparkles, ArrowRight, CheckCircle2, AlertTriangle, Target } from "lucide-react";
import CriticalPositionBoard from "./CriticalPositionBoard";
import { cn } from "../lib/utils";

type FeaturedSampleReport = {
  id: string;
  eventBadge: string;
  title: string;
  players: string;
  result: string;
  opening: string;
  accuracyWhite: string;
  accuracyBlack: string;
  criticalFen: string;
  criticalOrientation: "white" | "black";
  criticalMoveLabel: string;
  arrows: Array<{ orig: string; dest: string; color: string }>;
  verdict: string;
  strength: string;
  weakness: string;
  overview: string;
  focusRule: { dont: string; do: string };
  resources: Array<{ label: string; href: string }>;
};

const FEATURED_REPORTS: FeaturedSampleReport[] = [
  {
    id: "gukesh-ding-wcc",
    eventBadge: "World Championship Finale · Game 14",
    title: "Gukesh D vs. Ding Liren",
    players: "Ding Liren (2728) vs. Gukesh D (2783)",
    result: "0–1 · Gukesh wins World Title",
    opening: "A08 King's Indian Attack · Reversed Grunfeld",
    accuracyWhite: "88.4%",
    accuracyBlack: "96.2%",
    criticalFen: "8/4k3/5p2/4p1p1/5P2/3r1B2/1R4PP/5K2 w - - 0 55",
    criticalOrientation: "black",
    criticalMoveLabel: "55. Rf2?? — Fatal Bishop Alignment on f3",
    arrows: [
      { orig: "b2", dest: "f2", color: "red" },
      { orig: "d3", dest: "f3", color: "green" },
    ],
    verdict:
      "At move 55 in a dead-drawn rook-and-bishop endgame, 55.Rf2?? walked into a forced rook exchange on f2 because the bishop on f3 stood on an unguarded liquidation square.",
    strength:
      "Relentless endgame persistence: Black kept pose and pawn tension alive across 54 moves without forcing premature simplifications, forcing White to solve practical problems on every turn.",
    weakness:
      "For White, 55.Rf2?? overlooked that after 55...Rxf3+! 56.gxf3, the Bishop on f3 was the sole piece preventing a winning King-and-Pawn race.",
    overview:
      "A tense championship finale where White held a solid blockade for four hours until endgame fatigue triggered a single geometry blindspot on the f-file.",
    focusRule: {
      dont: "Offer a rook trade when your minor piece stands on the recapture square.",
      do: "Calculate the resulting King-and-Pawn race before allowing any endgame liquidation.",
    },
    resources: [
      { label: "Lichess Drill: Endgame Liquidation", href: "https://lichess.org/training/endgame" },
      { label: "Lichess Drill: Deflection & Removal", href: "https://lichess.org/training/deflection" },
    ],
  },
  {
    id: "carlsen-nepo-g6",
    eventBadge: "World Championship · Longest Game (136 Moves)",
    title: "Magnus Carlsen vs. Ian Nepomniachtchi",
    players: "Magnus Carlsen (2855) vs. Ian Nepomniachtchi (2782)",
    result: "1–0 · Marathon Endgame Grind",
    opening: "D02 Queen's Pawn Game · Symmetrical Catalan",
    accuracyWhite: "94.7%",
    accuracyBlack: "91.8%",
    criticalFen: "8/8/4k1p1/3p1p2/3P1P2/2N1K1P1/7q/3R4 w - - 4 130",
    criticalOrientation: "white",
    criticalMoveLabel: "130. Qe6+ — Knight + Rook Fortress Breakthrough",
    arrows: [
      { orig: "c3", dest: "e2", color: "green" },
      { orig: "d1", dest: "d3", color: "green" },
    ],
    verdict:
      "White coordinated Rook, Knight, and passed pawns to weave a shelter against perpetual check while inching the e- and f-pawns up the board under extreme clock pressure.",
    strength:
      "Masterclass in multi-piece coordination: White used the Knight and King as an active shield against Queen checks rather than retreating passively.",
    weakness:
      "Black missed the final tablebase drawing setup by allowing White's King to cross the 6th rank with shelter.",
    overview:
      "An unbalanced Queen vs. two Rooks middlegame transformed into a 7-piece tablebase test where practical stamina decided the championship momentum.",
    focusRule: {
      dont: "Give random single-piece checks when defending against connected passed pawns.",
      do: "Anchor your checking piece on long diagonals that restrict the enemy King's shelter squares.",
    },
    resources: [
      { label: "Lichess Drill: Defensive Shielding", href: "https://lichess.org/training/defensiveMove" },
      { label: "Lichess Drill: Endgame Technique", href: "https://lichess.org/training/endgame" },
    ],
  },
  {
    id: "morphy-opera-1858",
    eventBadge: "Immortal Classical Masterpiece · Paris 1858",
    title: "Paul Morphy vs. Duke of Brunswick",
    players: "Paul Morphy vs. Duke of Brunswick & Count Isouard",
    result: "1–0 · 17.Rd8# Opera Mate",
    opening: "C41 Philidor Defense",
    accuracyWhite: "98.9%",
    accuracyBlack: "68.5%",
    criticalFen: "4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 1 16",
    criticalOrientation: "white",
    criticalMoveLabel: "16. Qb8+!! — Queen Sacrifice Deflects the Knight",
    arrows: [
      { orig: "b3", dest: "b8", color: "green" },
      { orig: "d1", dest: "d8", color: "green" },
    ],
    verdict:
      "Black grabbed a b2 pawn at move 9 while uncastled, allowing White to stack every piece on open central files and finish with 16.Qb8+!! Nxb8 17.Rd8#.",
    strength:
      "Every White move developed a new piece with tempo, castling long to bring the d1-rook immediately into the attack against the pinned d7-knight.",
    weakness:
      "9...b5? chased material while the f8-bishop and h8-rook were still asleep and the e8-king had no escape squares.",
    overview:
      "The textbook illustration of how a lead in development and an absolute pin convert into a forced mating net.",
    focusRule: {
      dont: "Grab flank pawns while your King is still uncastled in an open center.",
      do: "Complete kingside development before launching secondary pawn captures.",
    },
    resources: [
      { label: "Lichess Drill: Pin Exploitation", href: "https://lichess.org/training/pin" },
      { label: "Lichess Drill: Deflection Sacrifices", href: "https://lichess.org/training/deflection" },
    ],
  },
];

export default function SampleReportsFeed() {
  const [activeId, setActiveId] = useState<string>(FEATURED_REPORTS[0].id);
  const current =
    FEATURED_REPORTS.find((r) => r.id === activeId) ?? FEATURED_REPORTS[0];

  return (
    <section
      id="sample-reports-feed"
      className="landing-section"
      aria-labelledby="featured-reports-title"
    >
      <div className="rounded-2xl bg-[var(--surface-glass)] backdrop-blur-xl border border-[var(--gold)]/45 p-6 sm:p-10 shadow-[0_30px_70px_-30px_rgba(201,153,63,0.35)]">
        <div className="flex flex-wrap items-baseline justify-between gap-4 pb-5 border-b border-[var(--line)]">
          <div>
            <h2
              id="featured-reports-title"
              className="text-2xl sm:text-3xl font-serif font-bold text-[var(--text)] m-0"
            >
              Sample Championship Reports
            </h2>
            <p className="text-sm text-[var(--text-muted)] mt-1.5 mb-0 max-w-xl">
              Explore how Chessmasters translates iconic championship turning points into plain-English lessons.
            </p>
          </div>

          <Link
            href="/sample-report"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--gold-bright)] hover:underline"
          >
            <span>Full annotated report</span>
            <ArrowRight size={14} />
          </Link>
        </div>

        {/* Clean Match Switcher Pills */}
        <div
          className="flex flex-wrap gap-2 my-5"
          role="tablist"
          aria-label="Featured game reports"
        >
          {FEATURED_REPORTS.map((report) => {
            const active = report.id === current.id;
            return (
              <button
                key={report.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveId(report.id)}
                className={cn(
                  "px-4 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer border",
                  active
                    ? "bg-[var(--gold)] text-[#141712] border-[var(--gold)] font-bold"
                    : "bg-[#060a0d] text-[var(--text-muted)] border-[var(--line)] hover:text-[var(--text)]"
                )}
              >
                {report.title}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start pt-2">
          {/* Left: Critical Position Board */}
          <div className="lg:col-span-5 flex flex-col gap-3">
            <div className="text-xs font-mono text-[var(--gold-bright)]">
              {current.criticalMoveLabel}
            </div>

            <div className="rounded-xl overflow-hidden border border-[var(--line)] bg-[#060a0d] p-2.5 flex justify-center">
              <div className="w-full max-w-[300px]">
                <CriticalPositionBoard
                  fen={current.criticalFen}
                  orientation={current.criticalOrientation}
                  arrows={current.arrows}
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-[var(--text-muted)] px-1">
              <span>{current.opening}</span>
              <span className="font-mono text-[var(--text)]">
                Accuracy: {current.accuracyWhite} / {current.accuracyBlack}
              </span>
            </div>
          </div>

          {/* Right: Clean Typographic Report Sections (Hairline Divided, No Nested Boxes) */}
          <div className="lg:col-span-7 divide-y divide-[var(--line)]">
            <div className="pb-3.5">
              <div className="text-xs font-semibold text-[var(--gold-bright)] mb-1">
                Verdict
              </div>
              <p className="text-sm text-[var(--text)] leading-relaxed m-0">
                {current.verdict}
              </p>
            </div>

            <div className="py-3.5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-semibold text-emerald-400 mb-1">
                  Strength
                </div>
                <p className="text-xs sm:text-sm text-[var(--text-muted)] leading-relaxed m-0">
                  {current.strength}
                </p>
              </div>
              <div>
                <div className="text-xs font-semibold text-rose-400 mb-1">
                  Weakness
                </div>
                <p className="text-xs sm:text-sm text-[var(--text-muted)] leading-relaxed m-0">
                  {current.weakness}
                </p>
              </div>
            </div>

            <div className="py-3.5">
              <div className="text-xs font-semibold text-[var(--text)] mb-1.5">
                Next-Game Rule
              </div>
              <p className="text-xs sm:text-sm text-rose-300 m-0">
                <strong>Don&apos;t:</strong> {current.focusRule.dont}
              </p>
              <p className="text-xs sm:text-sm text-emerald-300 mt-1 mb-0">
                <strong>Do:</strong> {current.focusRule.do}
              </p>
            </div>

            <div className="pt-3.5 flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--text-muted)]">Practice:</span>
              {current.resources.map((res) => (
                <a
                  key={res.href}
                  href={res.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-[var(--gold-bright)] hover:underline"
                >
                  {res.label} ↗
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
