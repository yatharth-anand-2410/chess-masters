"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/ui/Topbar";
import { Pill } from "@/components/ui/Pill";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import ScoutGateCard, { type ScoutGateState } from "@/components/scout/ScoutGateCard";
import {
  apiGet,
  scoutOpponent,
  type OpponentScoutDossier,
  type ScoutOpeningNode,
  type Usage,
} from "@/lib/api";
import { createClient } from "@/lib/supabase-client";

interface ScoutDossierProps {
  params: Promise<{ username: string }>;
}

type DossierState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; dossier: OpponentScoutDossier }
  | { kind: "error"; message: string };

const PHASE_LABELS: Record<string, string> = {
  opening: "Opening",
  middlegame: "Middlegame",
  endgame: "Endgame",
};

function platformFromQuery(): "lichess" | "chesscom" {
  if (typeof window === "undefined") {
    return "lichess";
  }
  const value = new URLSearchParams(window.location.search).get("platform");
  return value === "chesscom" ? "chesscom" : "lichess";
}

function winRateTone(rate: number): string {
  if (rate >= 60) return "text-[var(--green-bright)]";
  if (rate >= 45) return "text-[var(--amber)]";
  return "text-[var(--red-bright)]";
}

export default function ScoutPlayerDossier({ params }: ScoutDossierProps) {
  const { username } = use(params);
  const decodedUsername = decodeURIComponent(username);

  const [gate, setGate] = useState<ScoutGateState>("loading");
  const [dossier, setDossier] = useState<DossierState>({ kind: "idle" });
  const [platform, setPlatform] = useState<"lichess" | "chesscom">("lichess");

  // Paid plan required — the tool is hidden until the account is subscribed.
  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          if (!cancelled) setGate("signed-out");
          return;
        }
        const usage = await apiGet<Usage>("/api/account/usage", token).catch(() => null);
        if (!cancelled) setGate(usage?.plan === "paid" ? "unlocked" : "locked");
      } catch {
        if (!cancelled) setGate("signed-out");
      }
    };
    void resolve();
    const handler = () => void resolve();
    window.addEventListener("cm_auth_changed", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("cm_auth_changed", handler);
    };
  }, []);

  const selectedPlatform = useCallback(() => platformFromQuery(), []);

  useEffect(() => {
    if (gate !== "unlocked") {
      return;
    }
    const platformValue = selectedPlatform();
    setPlatform(platformValue);
    let cancelled = false;
    setDossier({ kind: "loading" });
    scoutOpponent(decodedUsername, platformValue)
      .then((data) => {
        if (!cancelled) setDossier({ kind: "ready", dossier: data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Could not build the dossier.";
        setDossier({ kind: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [gate, decodedUsername, selectedPlatform]);

  return (
    <div className="min-h-screen bg-[var(--ink-1)] text-[var(--text)] flex flex-col">
      <Topbar />

      {gate !== "unlocked" ? (
        <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-12 flex flex-col items-center justify-center text-center">
          <Pill tone="shell" size="sm" className="mb-3">
            🔍 OPPONENT SCOUTING
          </Pill>
          <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">
            {decodedUsername}
          </h1>
          <ScoutGateCard gate={gate} />
        </main>
      ) : (
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--line)]">
            <div className="flex items-center gap-3">
              <Link
                href="/scout"
                className="text-xs font-mono text-[var(--text-muted)] hover:text-[var(--text)] flex items-center gap-1"
              >
                ← Opponent Scout
              </Link>
              <span className="text-[var(--line-strong)]">/</span>
              <span className="text-xs font-mono text-[var(--gold-bright)]">
                {decodedUsername}
              </span>
              <Pill tone="shell" size="sm">
                {platform === "chesscom" ? "Chess.com" : "Lichess"}
              </Pill>
            </div>
            <div className="flex items-center gap-2">
              {dossier.kind === "ready" && (
                <Pill tone="neutral" size="sm">
                  Audited from {dossier.dossier.games_analyzed} recent games
                </Pill>
              )}
              <Button variant="ghost" size="sm" onClick={() => window.print()}>
                Export Dossier PDF
              </Button>
            </div>
          </div>

          {dossier.kind === "loading" && (
            <Card surface="shell" pad="lg">
              <p className="text-xs font-mono text-[var(--text-muted)]">
                Rebuilding {decodedUsername}&apos;s recent games and engine verdicts…
              </p>
            </Card>
          )}

          {dossier.kind === "error" && (
            <Card surface="shell" pad="lg" className="text-left">
              <h2 className="font-display text-lg font-semibold">
                No dossier for “{decodedUsername}”
              </h2>
              <p className="text-sm text-[var(--text-muted)] mt-2 max-w-2xl">
                {dossier.message} Scouting needs recent public games on the
                selected platform — check the spelling, switch the platform, or
                pick a player with rated games in the last few months.
              </p>
              <div className="flex flex-wrap items-center gap-3 mt-4">
                <Button variant="ghost" size="sm" href="/scout">
                  Try another player
                </Button>
              </div>
            </Card>
          )}

          {dossier.kind === "ready" && <DossierBody dossier={dossier.dossier} />}
        </main>
      )}
    </div>
  );
}

function DossierBody({ dossier }: { dossier: OpponentScoutDossier }) {
  const timeTrouble = dossier.time_trouble;
  const phases = Object.entries(dossier.phase_blunders ?? {});

  return (
    <>
      {/* Player profile */}
      <div className="p-6 rounded-2xl bg-[var(--ink-2)] border border-[var(--line)] flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl bg-[var(--ink-3)] border border-[var(--line-strong)] flex items-center justify-center font-display text-2xl font-bold text-[var(--gold-bright)]">
            {dossier.username.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-display font-bold text-[var(--text)]">
                {dossier.username}
              </h1>
              <Pill tone="shell" size="sm">
                {dossier.danger_level} danger
              </Pill>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Style archetype: {dossier.archetype}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 border-t md:border-t-0 md:border-l border-[var(--line)] pt-4 md:pt-0 md:pl-6">
          <div>
            <span className="text-[0.7rem] font-mono text-[var(--text-muted)]">
              WIN RATE
            </span>
            <div className={`text-xl font-bold font-mono ${winRateTone(dossier.overall_win_rate)}`}>
              {dossier.overall_win_rate.toFixed(1)}%
            </div>
            <span className="text-[0.7rem] text-[var(--text-muted)]">
              across {dossier.games_analyzed} games
            </span>
          </div>
          <div>
            <span className="text-[0.7rem] font-mono text-[var(--text-muted)]">
              COLOUR SPLIT
            </span>
            <div className="text-xl font-bold font-mono text-[var(--text)]">
              {dossier.white_games_count}W / {dossier.black_games_count}B
            </div>
            <span className="text-[0.7rem] text-[var(--text-muted)]">
              white / black games
            </span>
          </div>
          <div>
            <span className="text-[0.7rem] font-mono text-[var(--text-muted)]">
              CLOCK VULNERABILITY
            </span>
            <div className="text-xl font-bold font-mono text-[var(--red-bright)]">
              {timeTrouble.vulnerability_multiplier.toFixed(1)}×
            </div>
            <span className="text-[0.7rem] text-[var(--text-muted)]">
              more blunders under 30s
            </span>
          </div>
        </div>
      </div>

      {/* Tactical blindspots */}
      {dossier.tactical_blindspots.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {dossier.tactical_blindspots.slice(0, 3).map((blindspot, index) => (
            <Card
              key={blindspot.motif}
              surface="shell"
              pad="md"
              className={`border-l-4 ${
                index === 0
                  ? "border-l-[var(--red)]"
                  : index === 1
                    ? "border-l-[var(--amber)]"
                    : "border-l-[var(--teal)]"
              }`}
            >
              <Pill tone={index === 0 ? "alert" : index === 1 ? "caution" : "positive"} size="sm" className="mb-2">
                LEAK {index + 1}: {blindspot.motif_label.toUpperCase()}
              </Pill>
              <h3 className="font-display font-bold text-base text-[var(--text)]">
                {blindspot.occurrences} blunders
                <span className="text-[var(--text-muted)] font-normal">
                  {" "}
                  · {blindspot.percentage_of_blunders.toFixed(0)}% of their errors
                </span>
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-1.5 leading-relaxed">
                {blindspot.description}
              </p>
            </Card>
          ))}
        </div>
      )}

      {/* Clock pressure + phase blunder rates */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card surface="shell" pad="md">
          <h2 className="font-display font-bold text-lg text-[var(--text)]">
            Time-Trouble Profile
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">{timeTrouble.verdict}</p>

          <ul className="mt-4 space-y-3 text-xs">
            <li className="flex items-center justify-between gap-3 pb-3 border-b border-[var(--line)]">
              <span>Blunder rate under 30s</span>
              <span className="font-mono text-[var(--red-bright)]">
                {timeTrouble.blunder_rate_under_30s.toFixed(1)}% ({timeTrouble.blunders_under_30s}/
                {timeTrouble.moves_under_30s} moves)
              </span>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span>Blunder rate with normal clock</span>
              <span className="font-mono text-[var(--green-bright)]">
                {timeTrouble.blunder_rate_normal.toFixed(1)}% ({timeTrouble.blunders_normal}/
                {timeTrouble.moves_normal} moves)
              </span>
            </li>
          </ul>

          <div className="mt-4 p-3 rounded bg-[var(--ink-3)] text-xs text-[var(--gold-bright)]">
            <b>Anti-prep plan:</b> {timeTrouble.tactical_recommendation}
          </div>
        </Card>

        <Card surface="shell" pad="md">
          <h2 className="font-display font-bold text-lg text-[var(--text)]">
            Phase-by-Phase Leaks
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Engine verdicts across every analysed move.
          </p>
          {phases.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] mt-4">
              No phase telemetry was available for these games.
            </p>
          ) : (
            <ul className="mt-4 space-y-3 text-xs">
              {phases.map(([key, phase]) => (
                <li
                  key={key}
                  className="flex items-center justify-between gap-3 pb-3 border-b border-[var(--line)] last:border-b-0 last:pb-0"
                >
                  <span>{PHASE_LABELS[key] ?? key}</span>
                  <span className="font-mono">
                    <span className={phase.blunder_rate_percent > 8 ? "text-[var(--red-bright)]" : "text-[var(--text)]"}>
                      {phase.blunder_rate_percent.toFixed(1)}% blunders
                    </span>
                    <span className="text-[var(--text-muted)]"> · {phase.acpl.toFixed(1)} ACPL</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Repertoire */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RepertoireCard
          title="As White"
          nodes={dossier.white_repertoire_tree}
          accent="text-[var(--gold-bright)]"
        />
        <RepertoireCard
          title="As Black"
          nodes={dossier.black_repertoire_tree}
          accent="text-[var(--cyan)]"
        />
      </div>

      {/* Anti-prep recommendations */}
      {dossier.anti_prep_recommendations.length > 0 && (
        <Card surface="shell" pad="md">
          <h2 className="font-display font-bold text-lg text-[var(--text)]">
            Anti-Prep Recommendations
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-[var(--text-muted)]">
            {dossier.anti_prep_recommendations.map((tip) => (
              <li key={tip} className="flex gap-2">
                <span className="text-[var(--gold-bright)]" aria-hidden="true">
                  ▸
                </span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function RepertoireCard({
  title,
  nodes,
  accent,
}: {
  title: string;
  nodes: ScoutOpeningNode[];
  accent: string;
}) {
  return (
    <Card surface="shell" pad="md">
      <h2 className={`font-display font-bold text-lg ${accent}`}>{title}</h2>
      <p className="text-xs text-[var(--text-muted)] mt-1">
        Most-played first moves with the opponent&apos;s own win rate in those lines.
      </p>
      {nodes.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] mt-4">
          Not enough games on this colour to build a repertoire.
        </p>
      ) : (
        <ul className="mt-4 space-y-3 text-xs">
          {nodes.slice(0, 6).map((node) => (
            <li
              key={`${node.san}-${node.move_number}`}
              className="flex items-center justify-between gap-3 pb-3 border-b border-[var(--line)] last:border-b-0 last:pb-0"
            >
              <span>
                <span className="font-mono text-[var(--text)]">{node.san}</span>
                {node.opening_name ? (
                  <span className="text-[var(--text-muted)]"> · {node.opening_name}</span>
                ) : null}
              </span>
              <span className="font-mono whitespace-nowrap">
                <span className={winRateTone(node.win_rate)}>
                  {node.win_rate.toFixed(0)}% win
                </span>
                <span className="text-[var(--text-muted)]">
                  {" "}
                  ({node.games_count} games · {node.frequency_percent.toFixed(0)}% freq)
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
