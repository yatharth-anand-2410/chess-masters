"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AnalyzerForm, {
  type AnalysisRequest,
  type BatchAnalysisRequest,
} from "../../../../components/AnalyzerForm";
import AnalysisHistory from "../../../../components/AnalysisHistory";
import AnalysisStatus from "../../../../components/AnalysisStatus";
import AuthButton from "../../../../components/AuthButton";
import BatchProgress, {
  type BatchGameProgress,
} from "../../../../components/BatchProgress";
import CoachingReport from "../../../../components/CoachingReport";
import type { InsightsData } from "../../../../components/insights";
import {
  API_BASE,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  mergeHistoryEntries,
  shareUrl,
  type HistoryEntry,
  type ShareStatus,
  type StudentDetail,
} from "../../../../lib/api";
import { streamPost } from "../../../../lib/stream";
import { createClient } from "../../../../lib/supabase-client";
import type { User } from "@supabase/supabase-js";

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

export default function CoachStudentPage() {
  const params = useParams<{ id: string }>();
  const studentId = params.id;
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Streaming state (same event contract as the home analyzer).
  const [status, setStatus] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [streamError, setStreamError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [batchGames, setBatchGames] = useState<BatchGameProgress[]>([]);
  const pendingChunks = useRef("");
  const flushHandle = useRef<number | null>(null);

  // Notes autosave.
  const [notes, setNotes] = useState("");
  const [notesStatus, setNotesStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const savedNotes = useRef<string | null>(null);

  // Share controls.
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const flushStreamContent = useCallback(() => {
    if (flushHandle.current !== null) {
      window.cancelAnimationFrame(flushHandle.current);
      flushHandle.current = null;
    }
    const chunk = pendingChunks.current;
    pendingChunks.current = "";
    if (chunk) {
      setMarkdown((prev) => prev + chunk);
    }
  }, []);

  const scheduleStreamFlush = useCallback(() => {
    if (flushHandle.current !== null) {
      return;
    }
    flushHandle.current = window.requestAnimationFrame(() => {
      flushHandle.current = null;
      flushStreamContent();
    });
  }, [flushStreamContent]);

  useEffect(() => {
    return () => {
      if (flushHandle.current !== null) {
        window.cancelAnimationFrame(flushHandle.current);
      }
    };
  }, []);

  const loadDetail = useCallback(
    async (sessionToken: string) => {
      try {
        const result = await apiGet<StudentDetail>(
          `/api/coach/students/${studentId}`,
          sessionToken
        );
        setDetail(result);
        if (savedNotes.current === null) {
          savedNotes.current = result.student.notes ?? "";
          setNotes(result.student.notes ?? "");
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load this student."
        );
      } finally {
        setLoading(false);
      }
    },
    [studentId]
  );

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      setUser(session?.user ?? null);
      if (!session) {
        router.replace("/");
        return;
      }
      setToken(session.access_token);
      loadDetail(session.access_token);
    });
  }, [loadDetail, router]);

  // Debounced notes autosave; the initial load sets `savedNotes` first so the
  // untouched value is never written back.
  useEffect(() => {
    if (!token || !studentId || savedNotes.current === null) {
      return;
    }
    if (notes === savedNotes.current) {
      return;
    }
    setNotesStatus("saving");
    const handle = window.setTimeout(async () => {
      try {
        await apiPatch(`/api/coach/students/${studentId}`, token, { notes });
        savedNotes.current = notes;
        setNotesStatus("saved");
        window.setTimeout(
          () => setNotesStatus((current) => (current === "saved" ? "idle" : current)),
          1600
        );
      } catch {
        setNotesStatus("error");
      }
    }, 900);
    return () => window.clearTimeout(handle);
  }, [notes, studentId, token]);

  const resetStream = useCallback(() => {
    if (flushHandle.current !== null) {
      window.cancelAnimationFrame(flushHandle.current);
      flushHandle.current = null;
    }
    pendingChunks.current = "";
    setStatus("");
    setStreamError("");
    setMarkdown("");
    setInsights(null);
    setBatchGames([]);
  }, []);

  const startAnalysis = useCallback(
    async (request: AnalysisRequest) => {
      if (!token) {
        return;
      }
      resetStream();
      setStatus("Connecting...");
      setIsAnalyzing(true);
      await streamPost(
        `${API_BASE}/api/stream-analysis`,
        token,
        {
          platform: request.platform,
          game_url: request.gameUrl,
          username: request.username,
          player_color: request.playerColor,
          student_id: studentId,
        },
        {
          onEvent: (eventName, data) => {
            const payload = data as {
              message?: string;
              text?: string;
            };
            if (eventName === "status_update" && payload.message) {
              setStatus(payload.message);
            } else if (eventName === "content_chunk" && payload.text) {
              pendingChunks.current += payload.text;
              scheduleStreamFlush();
            } else if (eventName === "insights") {
              setInsights(payload as unknown as InsightsData);
            } else if (eventName === "done") {
              flushStreamContent();
              setStatus("Analysis complete");
              setIsAnalyzing(false);
              loadDetail(token);
            } else if (eventName === "error") {
              flushStreamContent();
              setStreamError(payload.message ?? "Analysis failed.");
              setStatus("");
              setIsAnalyzing(false);
            }
          },
          onError: (message) => {
            setStreamError(message);
            setStatus("");
            setIsAnalyzing(false);
          },
        }
      );
    },
    [flushStreamContent, loadDetail, resetStream, scheduleStreamFlush, studentId, token]
  );

  const startBatchAnalysis = useCallback(
    async (request: BatchAnalysisRequest) => {
      if (!token) {
        return;
      }
      resetStream();
      setBatchGames(
        request.games.map((game) => ({
          gameUrl: game.gameUrl,
          state: "pending" as const,
        }))
      );
      setStatus("Connecting...");
      setIsAnalyzing(true);
      await streamPost(
        `${API_BASE}/api/stream-batch-analysis`,
        token,
        {
          platform: request.platform,
          username: request.username,
          games: request.games.map((game) => ({
            game_url: game.gameUrl,
            player_color: game.playerColor,
          })),
          student_id: studentId,
        },
        {
          onEvent: (eventName, data) => {
            const payload = data as {
              message?: string;
              text?: string;
              index?: number;
              analysis_id?: string;
              opening_name?: string | null;
              result?: string | null;
            };
            if (eventName === "status_update" && payload.message) {
              setStatus(payload.message);
            } else if (eventName === "batch_started") {
              setStatus("Analyzing the games...");
            } else if (
              eventName === "game_status" &&
              typeof payload.index === "number"
            ) {
              const index = payload.index;
              setBatchGames((prev) =>
                prev.map((game, position) =>
                  position === index
                    ? { ...game, state: "active", message: payload.message }
                    : game
                )
              );
            } else if (
              eventName === "game_done" &&
              typeof payload.index === "number"
            ) {
              const index = payload.index;
              setBatchGames((prev) =>
                prev.map((game, position) =>
                  position === index
                    ? {
                        ...game,
                        state: "done",
                        openingName: payload.opening_name ?? null,
                        result: payload.result ?? null,
                      }
                    : game
                )
              );
            } else if (
              eventName === "game_error" &&
              typeof payload.index === "number"
            ) {
              const index = payload.index;
              setBatchGames((prev) =>
                prev.map((game, position) =>
                  position === index
                    ? {
                        ...game,
                        state: "failed",
                        message:
                          payload.message ?? "This game could not be analyzed.",
                      }
                    : game
                )
              );
            } else if (eventName === "batch_status") {
              setStatus(payload.message ?? "AI generating the overall report...");
            } else if (eventName === "content_chunk" && payload.text) {
              pendingChunks.current += payload.text;
              scheduleStreamFlush();
            } else if (eventName === "insights") {
              setInsights(payload as unknown as InsightsData);
            } else if (eventName === "done") {
              flushStreamContent();
              setStatus("Analysis complete");
              setIsAnalyzing(false);
              loadDetail(token);
            } else if (eventName === "error") {
              flushStreamContent();
              setStreamError(payload.message ?? "Analysis failed.");
              setStatus("");
              setIsAnalyzing(false);
            }
          },
          onError: (message) => {
            setStreamError(message);
            setStatus("");
            setIsAnalyzing(false);
          },
        }
      );
    },
    [flushStreamContent, loadDetail, resetStream, scheduleStreamFlush, studentId, token]
  );

  const copyShareLink = useCallback(async (share: ShareStatus) => {
    if (!share.url_path) {
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl(share.url_path));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied: the link is visible in the input.
    }
  }, []);

  const enableShare = useCallback(async () => {
    if (!token || shareBusy) {
      return;
    }
    setShareBusy(true);
    try {
      const share = await apiPost<ShareStatus>(
        `/api/coach/students/${studentId}/share`,
        token,
        {}
      );
      setDetail((prev) => (prev ? { ...prev, share } : prev));
      await copyShareLink(share);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create the share link."
      );
    } finally {
      setShareBusy(false);
    }
  }, [copyShareLink, shareBusy, studentId, token]);

  const stopShare = useCallback(async () => {
    if (!token || shareBusy) {
      return;
    }
    setShareBusy(true);
    try {
      await apiDelete(`/api/coach/students/${studentId}/share`, token);
      setDetail((prev) => (prev ? { ...prev, share: { active: false } } : prev));
      setCopied(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not stop sharing."
      );
    } finally {
      setShareBusy(false);
    }
  }, [shareBusy, studentId, token]);

  const switchToPlayer = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      return;
    }
    try {
      await apiPut("/api/account/profile", session.access_token, {
        role: "player",
      });
      router.push("/");
    } catch (err) {
      console.error("Failed to switch role:", err);
    }
  }, [router]);

  if (loading) {
    return (
      <main className="dashboard">
        <p className="history-empty">Loading student...</p>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="dashboard">
        <div className="error-banner">{error || "Student not found."}</div>
        <Link href="/coach" className="btn btn-ghost">
          Back to students
        </Link>
      </main>
    );
  }

  const student = detail.student;
  const entries: HistoryEntry[] = mergeHistoryEntries(
    detail.analyses,
    detail.batches
  );
  const linkValue =
    origin && detail.share.url_path
      ? `${origin}${detail.share.url_path}`
      : detail.share.url_path ?? "";

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
          <Link href="/coach" className="nav-link">
            All students
          </Link>
          <Link href="/" className="nav-link">
            My games
          </Link>
          <AuthButton
            user={user}
            onAuthChange={() => router.push("/")}
            role="coach"
            onToggleRole={switchToPlayer}
          />
        </div>
      </header>

      <div className="game-header">
        <p className="game-meta">
          <Link href="/coach" className="nav-link">
            ← All students
          </Link>
        </p>
        <h1 className="game-title">{student.display_name}</h1>
        <p className="game-meta">
          {student.lichess_username || student.chesscom_username ? (
            <>
              {student.lichess_username && (
                <span className="student-username">
                  Lichess · {student.lichess_username}
                </span>
              )}
              {student.chesscom_username && (
                <span className="student-username">
                  Chess.com · {student.chesscom_username}
                </span>
              )}
            </>
          ) : (
            "No usernames saved yet"
          )}
        </p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <section className="share-panel" aria-label="Share link">
        <div className="share-head">
          <h2>Share link</h2>
          <span className="share-hint">
            {detail.share.active
              ? `${detail.share.view_count ?? 0} views${
                  detail.share.last_viewed_at
                    ? ` · last ${formatDate(detail.share.last_viewed_at)}`
                    : ""
                }`
              : "Off"}
          </span>
        </div>
        {detail.share.active ? (
          <>
            <div className="share-row">
              <input
                className="share-link-input"
                readOnly
                value={linkValue}
                onFocus={(event) => event.target.select()}
                aria-label="Share link"
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => copyShareLink(detail.share)}
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={stopShare}
                disabled={shareBusy}
              >
                Stop sharing
              </button>
            </div>
            <p className="share-note">
              Anyone with this link can read {student.display_name}&apos;s
              reports. Your notes stay private.
            </p>
          </>
        ) : (
          <>
            <p className="share-note">
              Create a read-only link so a parent or student can see the reports
              — no account needed.
            </p>
            <button
              type="button"
              className="btn btn-sm"
              onClick={enableShare}
              disabled={shareBusy}
            >
              {shareBusy ? "Creating..." : "Create share link"}
            </button>
          </>
        )}
      </section>

      <section className="student-analyze-card">
        <div className="section-head coach-section-head">
          <h2>Analyze a game for {student.display_name}</h2>
        </div>
        <AnalyzerForm
          disabled={isAnalyzing}
          defaultUsername={student.chesscom_username ?? ""}
          studentId={student.id}
          onSubmit={startAnalysis}
          onSubmitBatch={startBatchAnalysis}
        />
        <div className="status-slot">
          <AnalysisStatus status={status} isAnalyzing={isAnalyzing} />
        </div>
        {batchGames.length > 0 && <BatchProgress games={batchGames} />}
        {streamError && <div className="error-banner">{streamError}</div>}
      </section>

      {(isAnalyzing || markdown) && (
        <CoachingReport
          content={markdown}
          insights={insights}
          pending={isAnalyzing}
        />
      )}

      <section className="notes-card">
        <div className="section-head coach-section-head">
          <h2>Coach notes</h2>
          <span className="notes-status" aria-live="polite">
            {notesStatus === "saving" && "Saving..."}
            {notesStatus === "saved" && "Saved"}
            {notesStatus === "error" && "Could not save — try again"}
            {notesStatus === "idle" && "Private to you"}
          </span>
        </div>
        <label className="field">
          <span className="sr-only">Coach notes about {student.display_name}</span>
          <textarea
            className="field-textarea"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What is this student working on? What did you cover in the last lesson?"
            rows={5}
          />
        </label>
      </section>

      <section className="history-panel">
        <div className="section-head">
          <h2>Analyses ({entries.length})</h2>
        </div>
        {entries.length === 0 ? (
          <p className="history-empty">
            No analyses yet. Paste one of {student.display_name}&apos;s game
            links above and it will appear here.
          </p>
        ) : (
          <AnalysisHistory
            entries={entries}
            onOpen={(id) => router.push(`/analysis/${id}`)}
            onOpenBatch={(id) => router.push(`/batch/${id}`)}
          />
        )}
      </section>
    </main>
  );
}
