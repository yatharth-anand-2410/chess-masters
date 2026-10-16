"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/ui/Topbar";
import { Pill } from "@/components/ui/Pill";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function ScoutHubPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [platform, setPlatform] = useState<"lichess" | "chesscom">("lichess");

  const handleScout = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    router.push(`/scout/${encodeURIComponent(username.trim())}?platform=${platform}`);
  };

  return (
    <div className="min-h-screen bg-[var(--ink-1)] text-[var(--text)] flex flex-col">
      <Topbar />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-12 flex flex-col items-center justify-center text-center">
        <Pill tone="shell" size="sm" className="mb-3">
          🔍 TOURNAMENT PREPARATION
        </Pill>
        <h1 className="text-3xl sm:text-4xl font-display font-bold tracking-tight">
          Opponent Scouting Dossier
        </h1>
        <p className="text-sm sm:text-base text-[var(--text-muted)] mt-2 max-w-xl">
          Enter any Lichess or Chess.com username to uncover their opening repertoire tree, time trouble panic habits (&lt;30s), and recurring tactical leak hotspots.
        </p>

        {/* Search Form */}
        <Card surface="shell" pad="md" className="w-full max-w-lg mt-8 text-left">
          <form onSubmit={handleScout} className="flex flex-col gap-4">
            <div className="flex gap-2 p-1 bg-[var(--ink-3)] rounded-lg border border-[var(--line)]">
              <button
                type="button"
                onClick={() => setPlatform("lichess")}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                  platform === "lichess"
                    ? "bg-[var(--gold)] text-[#121b1e] font-semibold"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                Lichess.org
              </button>
              <button
                type="button"
                onClick={() => setPlatform("chesscom")}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                  platform === "chesscom"
                    ? "bg-[var(--gold)] text-[#121b1e] font-semibold"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                Chess.com
              </button>
            </div>

            <div>
              <label className="block text-xs font-mono text-[var(--text-muted)] mb-1.5">
                TARGET PLAYER USERNAME
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. MagnusCarlsen, DanielNaroditsky, Hikaru"
                className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--ink-3)] border border-[var(--line)] text-sm text-[var(--text)] focus:border-[var(--gold)] focus:outline-none transition-colors"
                required
              />
            </div>

            <Button type="submit" variant="primary" full>
              Generate Scouting Dossier ➔
            </Button>
          </form>

          {/* Quick presets */}
          <div className="mt-4 pt-4 border-t border-[var(--line)] flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>Sample Dossiers:</span>
            <div className="flex gap-2">
              <button
                onClick={() => router.push("/scout/Grandmaster_Opponent?platform=lichess")}
                className="hover:text-[var(--gold-bright)] underline"
              >
                GM_Opponent (2482)
              </button>
              <span>·</span>
              <button
                onClick={() => router.push("/scout/TacticalTiger?platform=chesscom")}
                className="hover:text-[var(--gold-bright)] underline"
              >
                TacticalTiger (2180)
              </button>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
