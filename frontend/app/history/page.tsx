"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthButton from "../../components/AuthButton";
import AnalysisHistory from "../../components/AnalysisHistory";
import {
  apiGet,
  mergeHistoryEntries,
  type AnalysisSummary,
  type BatchSummary,
  type HistoryEntry,
} from "../../lib/api";
import { createClient } from "../../lib/supabase-client";
import type { User } from "@supabase/supabase-js";

export default function HistoryPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session;
      setUser(session?.user ?? null);
      if (!session) {
        router.push("/");
        return;
      }
      try {
        const [list, batchList] = await Promise.all([
          apiGet<AnalysisSummary[]>(
            "/api/analyses?standalone=true",
            session.access_token
          ),
          apiGet<BatchSummary[]>("/api/batches", session.access_token),
        ]);
        setEntries(mergeHistoryEntries(list, batchList));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load history.");
      }
    });
  }, [router]);

  return (
    <main className="dashboard">
      <header className="topbar">
        <Link href="/" className="wordmark">
          <span className="wordmark-glyph" aria-hidden="true">
            ♜
          </span>
          Chessmasters
        </Link>
        <div className="topbar-actions">
          <Link href="/" className="nav-link">
            New analysis
          </Link>
          <Link href="/subscription" className="nav-link">
            Subscription
          </Link>
          <AuthButton user={user} onAuthChange={() => router.push("/")} />
        </div>
      </header>

      <div className="game-header">
        <h1 className="game-title">All analyses</h1>
        <p className="game-meta">
          {entries.length > 0
            ? `${entries.length} ${entries.length === 1 ? "analysis" : "analyses"}`
            : "Every game you analyze lands here."}
        </p>
      </div>

      {error && <div className="error-banner">{error}</div>}
      <AnalysisHistory
        entries={entries}
        onOpen={(id) => router.push(`/analysis/${id}`)}
        onOpenBatch={(id) => router.push(`/batch/${id}`)}
      />
    </main>
  );
}
