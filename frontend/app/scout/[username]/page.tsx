"use client";

import { use, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/ui/Topbar";
import { Pill } from "@/components/ui/Pill";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

interface ScoutDossierProps {
  params: Promise<{ username: string }>;
}

export default function ScoutPlayerDossier({ params }: ScoutDossierProps) {
  const { username } = use(params);
  const decodedUsername = decodeURIComponent(username);
  const [selectedPhase, setSelectedPhase] = useState<"opening" | "middlegame" | "endgame">("opening");

  return (
    <div className="min-h-screen bg-[var(--ink-1)] text-[var(--text)] flex flex-col">
      <Topbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
        {/* Breadcrumb & Navigation */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--line)]">
          <div className="flex items-center gap-3">
            <Link
              href="/scout"
              className="text-xs font-mono text-[var(--text-muted)] hover:text-[var(--text)] flex items-center gap-1"
            >
              ← Opponent Scout
            </Link>
            <span className="text-[var(--line-strong)]">/</span>
            <span className="text-xs font-mono text-[var(--gold-bright)]">{decodedUsername}</span>
          </div>

          <div className="flex items-center gap-2">
            <Pill tone="alert" size="sm">Audited from 48 Recent Games</Pill>
            <Button variant="ghost" size="sm" onClick={() => window.print()}>
              Export Dossier PDF
            </Button>
          </div>
        </div>

        {/* Player Profile Dossier Card */}
        <div className="p-6 rounded-2xl bg-[var(--ink-2)] border border-[var(--line)] flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-[var(--ink-3)] border border-[var(--line-strong)] flex items-center justify-center font-display text-2xl font-bold text-[var(--gold-bright)]">
              {decodedUsername.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-display font-bold text-[var(--text)]">{decodedUsername}</h1>
                <Pill tone="shell" size="sm">FIDE Candidate</Pill>
              </div>
              <div className="text-xs font-mono text-[var(--gold-bright)] mt-1">
                Blitz 2482 · Rapid 2410 · Classical 2390
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Style Archetype: Aggressive Tactical Punisher · Clock Vulnerable
              </p>
            </div>
          </div>

          <div className="flex gap-4 border-t md:border-t-0 md:border-l border-[var(--line)] pt-4 md:pt-0 md:pl-6">
            <div>
              <span className="text-[0.7rem] font-mono text-[var(--text-muted)]">WIN RATE</span>
              <div className="text-xl font-bold font-mono text-[var(--green)]">62.4%</div>
              <span className="text-[0.7rem] text-[var(--text-muted)]">30W / 12L / 6D</span>
            </div>
            <div>
              <span className="text-[0.7rem] font-mono text-[var(--text-muted)]">TIME TROUBLE BLUNDERS</span>
              <div className="text-xl font-bold font-mono text-[var(--red)]">42%</div>
              <span className="text-[0.7rem] text-[var(--text-muted)]">under 30s remaining</span>
            </div>
            <div>
              <span className="text-[0.7rem] font-mono text-[var(--text-muted)]">AVG CENTIPAWN LOSS</span>
              <div className="text-xl font-bold font-mono text-[var(--cyan)]">26.8</div>
              <span className="text-[0.7rem] text-[var(--text-muted)]">Sharp calculator</span>
            </div>
          </div>
        </div>

        {/* 3 Key Vulnerability Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card surface="shell" pad="md" className="border-l-4 border-l-[var(--red)]">
            <Pill tone="alert" size="sm" className="mb-2">LEAK 1: CLOCK PANIC</Pill>
            <h3 className="font-display font-bold text-base text-[var(--text)]">Sub-30s Time Pressure</h3>
            <p className="text-xs text-[var(--text-muted)] mt-1.5 leading-relaxed">
              Blunder rate jumps 4.1x when remaining time falls under 30 seconds. In 7 of their last 12 losses, blundered with &lt;18s on the clock.
            </p>
            <div className="mt-3 p-2 bg-[var(--ink-3)] rounded text-xs font-mono text-[var(--gold-bright)]">
              Plan: Keep positions complex to run down their clock.
            </div>
          </Card>

          <Card surface="shell" pad="md" className="border-l-4 border-l-[var(--amber)]">
            <Pill tone="caution" size="sm" className="mb-2">LEAK 2: TACTICAL BLINDSPOT</Pill>
            <h3 className="font-display font-bold text-base text-[var(--text)]">Back-Rank Deflection Traps</h3>
            <p className="text-xs text-[var(--text-muted)] mt-1.5 leading-relaxed">
              Consistently overlooks deflection queen sacrifices when their rook is pinned on the open d-file or e-file.
            </p>
            <div className="mt-3 p-2 bg-[var(--ink-3)] rounded text-xs font-mono text-[var(--gold-bright)]">
              Plan: Target their back rank with overloaded rooks.
            </div>
          </Card>

          <Card surface="shell" pad="md" className="border-l-4 border-l-[var(--teal)]">
            <Pill tone="positive" size="sm" className="mb-2">LEAK 3: ENDGAME TECHNIQUE</Pill>
            <h3 className="font-display font-bold text-base text-[var(--text)]">Passive King in Rook Endings</h3>
            <p className="text-xs text-[var(--text-muted)] mt-1.5 leading-relaxed">
              Drops +1.5 pawn evaluations in equal rook endgames by tucking the King passively instead of creating Lucena bridges.
            </p>
            <div className="mt-3 p-2 bg-[var(--ink-3)] rounded text-xs font-mono text-[var(--gold-bright)]">
              Plan: Trade down into rook endgames when holding equality.
            </div>
          </Card>
        </div>

        {/* Opening Repertoire Trie Analysis */}
        <Card surface="shell" pad="md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--line)]">
            <div>
              <h2 className="font-display font-bold text-lg text-[var(--text)]">
                Opening Repertoire Tree & Win Rates
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Exact lines played by {decodedUsername} across White and Black
              </p>
            </div>
            <div className="flex gap-2">
              <Pill tone="shell" size="sm">White: 1. e4 (78% freq)</Pill>
              <Pill tone="neutral" size="sm">Black: 1... c5 Najdorf (64% freq)</Pill>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            {/* White Repertoire */}
            <div className="p-4 rounded-xl bg-[var(--ink-3)] border border-[var(--line)]">
              <div className="flex items-center justify-between mb-3">
                <strong className="text-sm font-display text-[var(--gold-bright)]">
                  As White (Primary Weapon: 1. e4)
                </strong>
                <span className="text-xs font-mono text-[var(--green)]">68% Win Rate</span>
              </div>
              <ul className="text-xs space-y-2.5">
                <li className="flex justify-between items-center pb-2 border-b border-[var(--line)]">
                  <span>vs 1...c5 (Open Sicilian / English Attack)</span>
                  <span className="font-mono text-[var(--green)]">74% win (18 games)</span>
                </li>
                <li className="flex justify-between items-center pb-2 border-b border-[var(--line)]">
                  <span>vs 1...e5 (Ruy Lopez Berlin Defense)</span>
                  <span className="font-mono text-[var(--red)]">45% win (Leak!)</span>
                </li>
                <li className="flex justify-between items-center">
                  <span>vs 1...e6 (French Winawer)</span>
                  <span className="font-mono text-[var(--green)]">70% win (10 games)</span>
                </li>
              </ul>
              <div className="mt-4 p-2 bg-[var(--ink-2)] rounded text-[0.75rem] text-[var(--text-muted)]">
                <b>Coach Recommendation:</b> Play the Berlin Defense against their 1.e4. Their win rate drops below 50% against solid knight endgames.
              </div>
            </div>

            {/* Black Repertoire */}
            <div className="p-4 rounded-xl bg-[var(--ink-3)] border border-[var(--line)]">
              <div className="flex items-center justify-between mb-3">
                <strong className="text-sm font-display text-[var(--cyan)]">
                  As Black (Primary Weapon: Sicilian Najdorf)
                </strong>
                <span className="text-xs font-mono text-[var(--green)]">56% Win Rate</span>
              </div>
              <ul className="text-xs space-y-2.5">
                <li className="flex justify-between items-center pb-2 border-b border-[var(--line)]">
                  <span>vs 1. e4 (Najdorf 6. Be3 / 6. Bg5)</span>
                  <span className="font-mono text-[var(--green)]">58% win (24 games)</span>
                </li>
                <li className="flex justify-between items-center pb-2 border-b border-[var(--line)]">
                  <span>vs 1. d4 (King&apos;s Indian Defense)</span>
                  <span className="font-mono text-[var(--amber)]">50% win (8 games)</span>
                </li>
                <li className="flex justify-between items-center">
                  <span>vs 1. c4 / 1. Nf3 (English Symmetrical)</span>
                  <span className="font-mono text-[var(--green)]">60% win (5 games)</span>
                </li>
              </ul>
              <div className="mt-4 p-2 bg-[var(--ink-2)] rounded text-[0.75rem] text-[var(--text-muted)]">
                <b>Coach Recommendation:</b> Avoid sharp Bg5 Sicilian complications where they excel. Steer into positional Moscow or Rossolimo lines.
              </div>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
