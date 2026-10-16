"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import CoachingReport from "../../../components/CoachingReport";
import type { InsightsData } from "../../../components/insights";
import SharedItemView from "../../../components/studies/SharedItemView";
import {
  apiGet,
  type SharedBatchReport,
  type SharedItemPayload,
  type SharedReport,
  type SharedStudent,
} from "../../../lib/api";
import { warmBackend } from "../../../lib/backend-wake";

function formatDate(value?: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function platformLabel(platform: string): string {
  return platform === "lichess" ? "Lichess" : "Chess.com";
}

type FeedItem =
  | { kind: "game"; created_at: string; analysis: SharedStudent["analyses"][number] }
  | { kind: "batch"; created_at: string; batch: SharedStudent["batches"][number] };

function buildFeed(data: SharedStudent): FeedItem[] {
  const items: FeedItem[] = [
    ...data.analyses.map(
      (analysis): FeedItem => ({
        kind: "game",
        created_at: analysis.created_at,
        analysis,
      })
    ),
    ...data.batches.map(
      (batch): FeedItem => ({ kind: "batch", created_at: batch.created_at, batch })
    ),
  ];
  return items.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

/**
 * One token, three payloads.
 *
 * A student share keeps its report feed. A study or tactic share carries
 * `kind` + `item` and renders the shared content instead — title, subtitle, the
 * Lichess destination, the chapter/line list and the view counter. Legacy
 * tokens (captured before shares carried a kind) still return the student feed
 * shape, which is why nothing here requires `kind` to be present.
 */
type SharedTokenPayload = Partial<SharedStudent> & {
  kind?: "study" | "tactic" | "student";
  item?: SharedItemPayload | null;
};

/**
 * Public, read-only page behind an unguessable share token.
 *
 * Deliberately outside the app shell: no sign-in, no account context, no
 * internal ids. The only data on screen is what the coach chose to share —
 * single-game reports, multi-game reports, studies and tactic themes, never the
 * coach's private notes.
 */
export default function SharedStudentPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [payload, setPayload] = useState<SharedTokenPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [report, setReport] = useState<SharedReport | null>(null);
  const [batchReport, setBatchReport] = useState<SharedBatchReport | null>(null);
  const [reportLoadingId, setReportLoadingId] = useState("");
  const [reportError, setReportError] = useState("");

  useEffect(() => {
    warmBackend();
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    apiGet<SharedTokenPayload>(`/api/shared/${token}`)
      .then((result) => setPayload(result))
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "This share link is not active."
        )
      )
      .finally(() => setLoading(false));
  }, [token]);

  const sharedItem = useMemo<SharedItemPayload | null>(() => {
    if (!payload?.item) {
      return null;
    }
    if (payload.kind === "study" || payload.kind === "tactic" || payload.kind === undefined) {
      return payload.item;
    }
    return null;
  }, [payload]);

  /** The student feed, normalised so a payload without lists cannot crash it. */
  const studentFeed = useMemo<SharedStudent | null>(() => {
    if (!payload?.student) {
      return null;
    }
    return {
      student: payload.student,
      analyses: payload.analyses ?? [],
      batches: payload.batches ?? [],
    };
  }, [payload]);

  const openReport = useCallback(
    async (analysisId: string) => {
      if (!token || reportLoadingId) {
        return;
      }
      setReportLoadingId(analysisId);
      setReportError("");
      try {
        const result = await apiGet<SharedReport>(
          `/api/shared/${token}/analyses/${analysisId}`
        );
        setBatchReport(null);
        setReport(result);
      } catch (err) {
        setReportError(
          err instanceof Error ? err.message : "Could not load this report."
        );
      } finally {
        setReportLoadingId("");
      }
    },
    [reportLoadingId, token]
  );

  const openBatchReport = useCallback(
    async (batchId: string) => {
      if (!token || reportLoadingId) {
        return;
      }
      setReportLoadingId(batchId);
      setReportError("");
      try {
        const result = await apiGet<SharedBatchReport>(
          `/api/shared/${token}/batches/${batchId}`
        );
        setReport(null);
        setBatchReport(result);
      } catch (err) {
        setReportError(
          err instanceof Error ? err.message : "Could not load this report."
        );
      } finally {
        setReportLoadingId("");
      }
    },
    [reportLoadingId, token]
  );

  const closeReport = useCallback(() => {
    setReport(null);
    setBatchReport(null);
    setReportError("");
  }, []);

  if (loading) {
    return (
      <main className="dashboard shared-dashboard">
        <p className="history-empty">Loading shared reports...</p>
      </main>
    );
  }

  if (error || (!sharedItem && !studentFeed)) {
    return (
      <main className="dashboard shared-dashboard">
        <header className="topbar">
          <Link href="/" className="wordmark">
            <span className="wordmark-glyph" aria-hidden="true">
              ♜
            </span>
            Chessmasters
          </Link>
        </header>
        <div className="shared-dead">
          <h1>This link is not active</h1>
          <p>
            {error ||
              "The coach stopped sharing this page, or the link is incorrect."}
          </p>
          <Link href="/" className="btn btn-ghost">
            Go to Chessmasters
          </Link>
        </div>
      </main>
    );
  }

  if (sharedItem) {
    return (
      <main className="dashboard shared-dashboard">
        <header className="topbar">
          <Link href="/" className="wordmark">
            <span className="wordmark-glyph" aria-hidden="true">
              ♜
            </span>
            Chessmasters
          </Link>
          <div className="topbar-actions">
            <span className="shared-tag">
              {sharedItem.kind === "tactic"
                ? "Shared tactic theme"
                : "Shared study"}
            </span>
          </div>
        </header>

        <SharedItemView
          payload={sharedItem}
          footer={
            <p className="shared-footnote">
              Shared by a coach and readable without an account. Nothing on this
              page is editable, and no coach notes are shown beyond what was
              shared.
            </p>
          }
        />
      </main>
    );
  }

  const feed = buildFeed(studentFeed as SharedStudent);
  const studentName = studentFeed?.student.display_name ?? "Student";
  const openReportData = report ?? null;
  const openBatchData = batchReport ?? null;
  const openDate = openReportData?.analysis.created_at ?? openBatchData?.batch.created_at;

  return (
    <main className="dashboard shared-dashboard">
      <header className="topbar">
        <Link href="/" className="wordmark">
          <span className="wordmark-glyph" aria-hidden="true">
            ♜
          </span>
          Chessmasters
        </Link>
        <div className="topbar-actions">
          <span className="shared-tag">Shared coaching reports</span>
        </div>
      </header>

      {openReportData || openBatchData ? (
        <>
          <div className="game-header">
            <p className="game-meta">
              <button
                type="button"
                className="nav-link shared-back"
                onClick={closeReport}
              >
                ← All reports
              </button>
            </p>
            <h1 className="game-title">
              {openReportData
                ? openReportData.analysis.opening_name ??
                  openReportData.analysis.game_id
                : "Multi-game report"}
            </h1>
            <p className="game-meta">
              {studentName}
              {openReportData?.analysis.result
                ? ` · ${openReportData.analysis.result}`
                : ""}
              {openBatchData
                ? ` · ${openBatchData.batch.game_count} games`
                : ""}
              {openDate ? ` · analyzed ${formatDate(openDate)}` : ""}
            </p>
          </div>
          {reportError && <div className="error-banner">{reportError}</div>}
          {openReportData?.analysis.report_markdown ? (
            <CoachingReport
              content={openReportData.analysis.report_markdown}
              insights={(openReportData.analysis.insights as InsightsData) ?? null}
            />
          ) : openBatchData?.batch.report_markdown ? (
            <CoachingReport
              content={openBatchData.batch.report_markdown}
              insights={(openBatchData.batch.insights as InsightsData) ?? null}
            />
          ) : (
            <div className="error-banner">This report is not available.</div>
          )}
        </>
      ) : (
        <>
          <div className="game-header">
            <h1 className="game-title">{studentName}</h1>
            <p className="game-meta">
              {feed.length > 0
                ? `${feed.length} ${
                    feed.length === 1 ? "report" : "reports"
                  } shared by their coach`
                : "No reports have been shared yet."}
            </p>
          </div>

          {reportError && <div className="error-banner">{reportError}</div>}

          {feed.length > 0 && (
            <div className="history-list">
              {feed.map((item) =>
                item.kind === "batch" ? (
                  <div key={`batch-${item.batch.id}`} className="history-item">
                    <button
                      type="button"
                      className="history-item-open"
                      onClick={() => openBatchReport(item.batch.id)}
                      disabled={Boolean(reportLoadingId)}
                    >
                      <div className="history-item-main">
                        <span className="history-platform">
                          {platformLabel(item.batch.platform)}
                        </span>
                        <span className="history-batch-badge">Multi-game</span>
                        <span className="history-meta">
                          Overall report · {item.batch.game_count}{" "}
                          {item.batch.game_count === 1 ? "game" : "games"}
                        </span>
                      </div>
                      <div className="history-item-side">
                        <span className="history-date">
                          {formatDate(item.batch.created_at)}
                        </span>
                        <span className="history-game-link">
                          {reportLoadingId === item.batch.id
                            ? "Opening..."
                            : "Read →"}
                        </span>
                      </div>
                    </button>
                  </div>
                ) : (
                  <div key={item.analysis.id} className="history-item">
                    <button
                      type="button"
                      className="history-item-open"
                      onClick={() => openReport(item.analysis.id)}
                      disabled={Boolean(reportLoadingId)}
                    >
                      <div className="history-item-main">
                        <span className="history-platform">
                          {platformLabel(item.analysis.platform)}
                        </span>
                        <span className="history-meta">
                          {item.analysis.opening_name ?? item.analysis.game_id}
                        </span>
                      </div>
                      <div className="history-item-side">
                        {item.analysis.result && (
                          <span className="shared-result">
                            {item.analysis.result}
                          </span>
                        )}
                        <span className="history-date">
                          {formatDate(item.analysis.created_at)}
                        </span>
                        <span className="history-game-link">
                          {reportLoadingId === item.analysis.id
                            ? "Opening..."
                            : "Read →"}
                        </span>
                      </div>
                    </button>
                  </div>
                )
              )}
            </div>
          )}

          <p className="shared-footnote">
            Every report is generated from {studentName}&apos;s real games.
            Coach notes are private and never shown here.
          </p>
        </>
      )}
    </main>
  );
}
