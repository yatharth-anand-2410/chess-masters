"use client";

import { useEffect, useState } from "react";
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
      <header className="header">
        <div className="header-row">
          <div>
            <h1>My Analyses</h1>
            <p>All games you have analyzed.</p>
          </div>
          <div className="header-actions">
            <button type="button" className="btn btn-ghost" onClick={() => router.push("/")}>
              Back
            </button>
            <AuthButton
              user={user}
              onAuthChange={() => router.push("/")}
            />
          </div>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}
      <AnalysisHistory
        analyses={analyses}
        onOpen={(id) => router.push(`/analysis/${id}`)}
      />
    </main>
  );
}