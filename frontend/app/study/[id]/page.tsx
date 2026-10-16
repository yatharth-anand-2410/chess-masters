"use client";

import { useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/ui/Topbar";
import { Pill } from "@/components/ui/Pill";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

interface Chapter {
  id: string;
  number: number;
  title: string;
  fen: string;
  coachNote: string;
  bestMove: string;
  drillPrompt: string;
  arrows: string[];
  circles: string[];
}

const CHAPTERS: Chapter[] = [
  {
    id: "chap-1",
    number: 1,
    title: "The Deflection Principle & Queen Sacs",
    fen: "r1b1r1k1/pp2qpbp/2p3p1/8/3QP3/1P4P1/PB3PBP/3RR1K1 w - - 3 20",
    coachNote:
      "When the opponent's back-rank piece is overloaded, a deflection tactic removes the only defender of a mate or promotion square. White sacrifices the Queen with 29. Qxf7+! to drag the Black King into a back-rank pin.",
    bestMove: "29. Qxf7+!",
    drillPrompt: "Find the deflection sacrifice that forces checkmate in 2 moves.",
    arrows: ["d4f7", "f7g8"],
    circles: ["f7", "e8"],
  },
  {
    id: "chap-2",
    number: 2,
    title: "Avoiding the Trap (Black's Prophylaxis)",
    fen: "r1b1r1k1/pp2qpbp/2p3p1/8/3QP3/1P4P1/PB3PBP/3RR1K1 b - - 2 19",
    coachNote:
      "In Game #842, Black played 28...Re8?? under 14 seconds on the clock. The correct prophylactic move is 28...Kh8! or 28...h6, creating an escape window ('Luft') before activating heavy pieces.",
    bestMove: "28...Kh8!",
    drillPrompt: "Black to move: neutralise White's battery without walking into deflection.",
    arrows: ["g8h8"],
    circles: ["h8", "h7"],
  },
  {
    id: "chap-3",
    number: 3,
    title: "The Back-Rank Clearance Overload",
    fen: "3r2k1/1p3ppp/p7/8/3B4/1P4P1/5P1P/3R2K1 w - - 1 28",
    coachNote:
      "Rooks on open files must maintain mutual protection. If one rook is tied down to defending a pinned minor piece, the back rank becomes porous.",
    bestMove: "29. Rd2!",
    drillPrompt: "Reinforce the pin safely without losing control of the d-file.",
    arrows: ["d1d2", "d4c3"],
    circles: ["d4"],
  },
];

export default function StudyDetailPage() {
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const [drillSolved, setDrillSolved] = useState(false);
  const currentChapter = CHAPTERS[activeChapterIndex];

  return (
    <div className="min-h-screen bg-[var(--ink-1)] text-[var(--text)] flex flex-col">
      <Topbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
        {/* Navigation & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--line)]">
          <div className="flex items-center gap-3">
            <Link
              href="/studies"
              className="text-xs font-mono text-[var(--text-muted)] hover:text-[var(--text)] flex items-center gap-1"
            >
              ← All Studies
            </Link>
            <span className="text-[var(--line-strong)]">/</span>
            <span className="text-xs font-mono text-[var(--gold-bright)]">Study #842</span>
          </div>

          <div className="flex items-center gap-2">
            <Pill tone="alert" size="sm">Fixes Game #842 Blunder</Pill>
            <Pill tone="positive" size="sm">Mastered by 88% of Students</Pill>
            <Button
              variant="ghost"
              size="sm"
              href="https://lichess.org/study/search?q=Najdorf+Deflection"
              target="_blank"
            >
              Export to Lichess ↗
            </Button>
          </div>
        </div>

        {/* Study Split View: Chapter Tree + Interactive Board & Coaching Commentary */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 items-start">
          {/* Left Column: Chapter Tree (4 cols) */}
          <aside className="lg:col-span-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-base text-[var(--text)]">
                Study Chapters
              </h2>
              <span className="text-xs font-mono text-[var(--text-muted)]">
                {activeChapterIndex + 1} of {CHAPTERS.length}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {CHAPTERS.map((chap, idx) => {
                const isActive = idx === activeChapterIndex;
                return (
                  <button
                    key={chap.id}
                    onClick={() => {
                      setActiveChapterIndex(idx);
                      setDrillSolved(false);
                    }}
                    className={`text-left p-3 rounded-lg border transition-all ${
                      isActive
                        ? "bg-[var(--ink-3)] border-[var(--gold)] text-[var(--text)] shadow-sm"
                        : "bg-[var(--ink-2)] border-[var(--line)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--line-strong)]"
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-mono mb-1">
                      <span className={isActive ? "text-[var(--gold-bright)]" : "text-[var(--text-muted)]"}>
                        Chapter {chap.number}
                      </span>
                      {isActive && <span className="text-[var(--gold-bright)]">● Active</span>}
                    </div>
                    <div className="font-medium text-sm text-[var(--text)]">{chap.title}</div>
                  </button>
                );
              })}
            </div>

            {/* Coach Homework Box */}
            <Card surface="shell" pad="sm" className="mt-4 border-dashed border-[var(--gold)]/30">
              <div className="text-xs font-mono text-[var(--gold-bright)] font-semibold mb-1">
                ♟ Coach Yatharth&apos;s Assignment
              </div>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                Complete all 3 chapters and execute the 28...Kh8! defense move without exceeding 5 seconds.
              </p>
            </Card>
          </aside>

          {/* Right Column: Board & Commentary (8 cols) */}
          <section className="lg:col-span-8 flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              {/* Board Mockup with %csl and %cal markers */}
              <div className="bg-[var(--ink-2)] p-4 rounded-xl border border-[var(--line)] flex flex-col items-center">
                <div className="relative w-full max-w-[340px] aspect-square rounded-lg overflow-hidden border border-[var(--line)] shadow-lg bg-[#b58863]">
                  {/* Chessboard visual representation */}
                  <div className="w-full h-full grid grid-cols-8 grid-rows-8">
                    {Array.from({ length: 64 }).map((_, i) => {
                      const row = Math.floor(i / 8);
                      const col = i % 8;
                      const isLight = (row + col) % 2 === 0;
                      return (
                        <div
                          key={i}
                          className={`w-full h-full flex items-center justify-center text-sm font-semibold select-none ${
                            isLight ? "bg-[#f0d9b5] text-[#b58863]" : "bg-[#b58863] text-[#f0d9b5]"
                          }`}
                        >
                          {/* Sample pieces on key squares */}
                          {row === 1 && col === 4 && <span className="text-2xl text-black">♚</span>}
                          {row === 2 && col === 3 && <span className="text-2xl text-white">♕</span>}
                          {row === 7 && col === 3 && <span className="text-2xl text-white">♖</span>}
                          {row === 7 && col === 4 && <span className="text-2xl text-red-600 animate-pulse">♜</span>}
                        </div>
                      );
                    })}
                  </div>

                  {/* SVG Attack Vector Overlay (%cal and %csl) */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100">
                    {/* Circle on blundered square */}
                    <circle cx="56.25" cy="93.75" r="5" fill="rgba(220, 38, 38, 0.4)" stroke="#ef4444" strokeWidth="1" />
                    {/* Attack vector arrow */}
                    <line x1="43.75" y1="31.25" x2="56.25" y2="18.75" stroke="#e2b65f" strokeWidth="2" strokeLinecap="round" />
                    <polygon points="56.25,18.75 51,20 54,23" fill="#e2b65f" />
                  </svg>
                </div>

                <div className="w-full flex items-center justify-between text-xs font-mono text-[var(--text-muted)] mt-3">
                  <span>FEN: Najdorf Tactical Position</span>
                  <span className="text-[var(--gold-bright)]">White to Move (+4.8)</span>
                </div>
              </div>

              {/* Coach Commentary & Interactive Drill */}
              <div className="flex flex-col gap-4">
                <Card surface="paper" pad="md">
                  <span className="text-xs font-mono font-bold text-[var(--accent)] uppercase tracking-wide">
                    Coach Breakdown
                  </span>
                  <h3 className="font-display font-bold text-lg text-[var(--paper-text)] mt-1">
                    {currentChapter.title}
                  </h3>
                  <p className="text-sm text-[var(--paper-muted)] leading-relaxed mt-2">
                    {currentChapter.coachNote}
                  </p>
                </Card>

                {/* Interactive Drill Arena */}
                <Card surface="shell" pad="md" className="border-[var(--line-strong)]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-mono text-[var(--gold-bright)] uppercase font-semibold">
                      Interactive Drill Arena
                    </span>
                    <Pill tone={drillSolved ? "positive" : "caution"} size="sm">
                      {drillSolved ? "Passed ✓" : "Your Turn"}
                    </Pill>
                  </div>

                  <p className="text-xs text-[var(--text)] mb-3">{currentChapter.drillPrompt}</p>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={drillSolved ? "primary" : "ghost"}
                      size="sm"
                      onClick={() => setDrillSolved(true)}
                    >
                      Play: {currentChapter.bestMove}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => alert("Incorrect move: walks into deflection back-rank mate.")}
                    >
                      Alternative: 29. Be3?
                    </Button>
                  </div>

                  {drillSolved && (
                    <div className="mt-3 p-2.5 rounded bg-[rgba(111,163,131,0.12)] border border-[rgba(111,163,131,0.3)] text-xs text-[var(--green)]">
                      ✓ <b>Excellent!</b> You found the deflection move. In rapid games, always verify whether an undefended back rank creates this exact mate motif.
                    </div>
                  )}
                </Card>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
