"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthButton from "../../components/AuthButton";
import AnalysisHistory from "../../components/AnalysisHistory";
import { apiGet, type AnalysisSummary } from "../../lib/api";
import { createClient } from "../../lib/supabase-client";
import type { User } from "@supabase/supabase-js";

export default function HistoryPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);
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
        const list = await apiGet<AnalysisSummary[]>("/api/analyses", session.access_token);
        setAnalyses(list);
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
          Rookmark
        </Link>
        <div className="topbar-actions">
          <Link href="/" className="nav-link">
            New analysis
          </Link>
          <AuthButton user={user} onAuthChange={() => router.push("/")} />
        </div>
      </header>

      <div className="game-header">
        <h1 className="game-title">All analyses</h1>
        <p className="game-meta">
          {analyses.length > 0
            ? `${analyses.length} ${analyses.length === 1 ? "game" : "games"} analyzed`
            : "Every game you analyze lands here."}
        </p>
      </div>

      {error && <div className="error-banner">{error}</div>}
      <AnalysisHistory
        analyses={analyses}
        onOpen={(id) => router.push(`/analysis/${id}`)}
      />
    </main>
  );
}
