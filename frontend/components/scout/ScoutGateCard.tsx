"use client";

import Link from "next/link";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";

export type ScoutGateState = "loading" | "signed-out" | "locked" | "unlocked";

/**
 * Opponent scouting is a paid feature, so both scout routes share one locked
 * state instead of rendering the tool (or fabricated sample numbers) to users
 * who cannot use it yet.
 */
export default function ScoutGateCard({ gate }: { gate: ScoutGateState }) {
  if (gate === "loading") {
    return (
      <Card surface="shell" pad="md" className="w-full max-w-lg mt-8 text-left">
        <span className="text-xs font-mono text-[var(--text-muted)]">
          Checking your plan…
        </span>
      </Card>
    );
  }

  return (
    <Card surface="shell" pad="lg" className="w-full max-w-lg mt-8 text-left">
      <span className="studies-count-pill">Pro feature</span>
      <h2 className="font-display text-xl font-semibold mt-3">
        {gate === "locked"
          ? "Opponent scouting is part of Pro"
          : "Sign in to unlock opponent scouting"}
      </h2>
      <p className="text-sm text-[var(--text-muted)] mt-2">
        {gate === "locked"
          ? "Scouting dossiers — opening repertoire trees, time-trouble habits and leak hotspots for any opponent — are included with the Pro Student plan."
          : "Scouting dossiers are included with the Pro Student plan. Sign in to check your plan or subscribe."}
      </p>
      <ul className="scout-gate-list mt-4">
        <li>Opening repertoire tree with win rates</li>
        <li>Time-trouble panic profile (under 30s)</li>
        <li>Recurring tactical leak hotspots</li>
      </ul>
      <div className="flex flex-wrap items-center gap-3 mt-5">
        <Button variant="primary" href="/subscription">
          {gate === "locked" ? "Upgrade to Pro ➔" : "Sign in & subscribe ➔"}
        </Button>
        <Link
          className="text-xs text-[var(--text-muted)] hover:text-[var(--gold-bright)] underline"
          href="/"
        >
          Analyze a game instead
        </Link>
      </div>
    </Card>
  );
}
