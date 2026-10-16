import Link from "next/link";
import { Topbar } from "@/components/ui/Topbar";
import { Pill } from "@/components/ui/Pill";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

interface CuratedStudy {
  id: string;
  title: string;
  subtitle: string;
  blunderOrigin: string;
  chaptersCount: number;
  difficulty: string;
  theme: string;
  acplReduction: string;
  fenPreview: string;
}

const SAMPLE_STUDIES: CuratedStudy[] = [
  {
    id: "deflection-najdorf-842",
    title: "Deflection & Decoy Traps in the Najdorf",
    subtitle: "Eliminate game-losing queen sacrifices and back-rank deflection oversights",
    blunderOrigin: "Directly linked to Game #842 Move 28 blunder (28...Re8??)",
    chaptersCount: 4,
    difficulty: "Advanced (2100+)",
    theme: "Tactical Defense",
    acplReduction: "-18.4 ACPL in Blitz",
    fenPreview: "r1b1r1k1/pp2qpbp/2p3p1/8/3QP3/1P4P1/PB3PBP/3RR1K1 w - - 3 20",
  },
  {
    id: "lucena-rook-endgames",
    title: "The Lucena Bridge & Rook Ending Conversion",
    subtitle: "Master the building of the bridge and avoid stalemate traps when up a pawn",
    blunderOrigin: "Triggered by Endgame Leak: 4 missed conversions in last 10 games",
    chaptersCount: 5,
    difficulty: "Intermediate to Master",
    theme: "Endgame Technique",
    acplReduction: "+22% Conversion Rate",
    fenPreview: "8/5k2/8/3R4/4P3/8/5K2/r7 w - - 0 45",
  },
  {
    id: "pinned-f-pawn-luft",
    title: "King Luft & Pinned F-Pawn Blindspots",
    subtitle: "Create proactive escape squares before launching central heavy piece operations",
    blunderOrigin: "Identified in Cognitive Psychology: Sub-30s tunnel vision",
    chaptersCount: 3,
    difficulty: "All Levels",
    theme: "Prophylaxis",
    acplReduction: "-84% Pin Blunders",
    fenPreview: "r4rk1/1pp2ppp/p1np1n2/4p3/4P3/1NN1BP2/PPP3PP/R2QKB1R w KQ - 0 12",
  },
];

export default function StudiesPage() {
  return (
    <div className="min-h-screen bg-[var(--ink-1)] text-[var(--text)] flex flex-col">
      <Topbar />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
        {/* Header Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-[var(--line)]">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[var(--gold-bright)] font-mono text-sm">📚 CURRICULUM</span>
              <Pill tone="shell" size="sm">Tailored to Student Leaks</Pill>
            </div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-[var(--text)]">
              Curated Lichess Studies & Drills
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-1 max-w-2xl">
              Every study in your curriculum is generated directly from tactical oversights and endgame leaks identified in your analyzed games.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" href="https://lichess.org/study" target="_blank">
              Browse All Lichess Studies ↗
            </Button>
          </div>
        </div>

        {/* Studies Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
          {SAMPLE_STUDIES.map((study) => (
            <Card
              key={study.id}
              surface="shell"
              pad="md"
              className="flex flex-col justify-between hover:border-[var(--line-strong)] transition-all group"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <Pill tone="alert" size="sm">{study.theme}</Pill>
                  <span className="text-xs font-mono text-[var(--gold-bright)]">
                    {study.chaptersCount} Chapters
                  </span>
                </div>

                <h3 className="font-display font-semibold text-lg text-[var(--text)] group-hover:text-[var(--gold-bright)] transition-colors">
                  {study.title}
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-1.5 leading-relaxed">
                  {study.subtitle}
                </p>

                <div className="mt-4 p-2.5 rounded bg-[var(--ink-3)] border border-[var(--line)] text-xs">
                  <div className="text-[var(--gold-bright)] font-mono font-medium">
                    ⚡ Why Assigned:
                  </div>
                  <div className="text-[var(--text-muted)] mt-0.5">
                    {study.blunderOrigin}
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-[var(--line)] flex items-center justify-between">
                <div className="text-xs font-mono text-[var(--green)]">
                  {study.acplReduction}
                </div>
                <Button variant="primary" size="sm" href={`/study/${study.id}`}>
                  Open Study ➔
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
