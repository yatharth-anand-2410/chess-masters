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
import BatchProgress, {
  type BatchGameProgress,
} from "../../../../components/BatchProgress";
import CoachingReport from "../../../../components/CoachingReport";
import type { InsightsData } from "../../../../components/insights";
import { Topbar } from "../../../../components/ui/Topbar";
import { Pill } from "../../../../components/ui/Pill";
import {
  Crown,
  ArrowRight,
  X,
  Check,
  Share2,
  Lock,
  Activity,
  Copy,
} from "lucide-react";
import {
  API_BASE,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  isUpgradeError,
  mergeHistoryEntries,
  shareUrl,
  type HistoryEntry,
  type ShareStatus,
  type SharedItem,
  type StudentDetail,
  type Usage,
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
  const [usage, setUsage] = useState<Usage | null>(null);
  const [hasCoachTier, setHasCoachTier] = useState(false);
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

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

  // Shared study / tactic links for this student (GET .../shares).
  const [shares, setShares] = useState<SharedItem[]>([]);
  const [sharesState, setSharesState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [copiedToken, setCopiedToken] = useState("");

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
        const [result, usageData] = await Promise.all([
          apiGet<StudentDetail>(`/api/coach/students/${studentId}`, sessionToken),
          apiGet<Usage>("/api/account/usage", sessionToken).catch(() => null),
        ]);
        setDetail(result);
        if (usageData) {
          setUsage(usageData);
          // plan_tier is the source of truth; older payloads fall back to plan.
          const tier =
            usageData.plan_tier ??
            (usageData.plan === "paid" ? "coach" : "free");
          setHasCoachTier(tier === "coach");
        }
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

  /** Shared study / tactic links. Owned by the shares workstream: absent or
   *  empty is a normal state, not an error. */
  const loadShares = useCallback(
    async (sessionToken: string) => {
      try {
        const rows = await apiGet<SharedItem[]>(
          `/api/coach/students/${studentId}/shares`,
          sessionToken
        );
        setShares(Array.isArray(rows) ? rows : []);
        setSharesState("ready");
      } catch {
        setShares([]);
        setSharesState("unavailable");
      }
    },
    [studentId]
  );

  const copyItemLink = useCallback(async (shareToken: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl(`/s/${shareToken}`));
      setCopiedToken(shareToken);
      window.setTimeout(
        () => setCopiedToken((current) => (current === shareToken ? "" : current)),
        2200
      );
    } catch {
      // Clipboard writes can fail without HTTPS / user activation.
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      const activeUser = session?.user ?? null;
      setUser(activeUser);

      if (!activeUser || !session) {
        router.replace("/");
        return;
      }

      setToken(session.access_token);
      loadDetail(session.access_token);
      loadShares(session.access_token);
    });
  }, [loadDetail, loadShares, router]);

  // "Analyze game" on the roster deep-links to /coach/students/<id>#analyze —
  // client-side navigation does not scroll to the hash on its own.
  useEffect(() => {
    if (loading || !detail || typeof window === "undefined") {
      return;
    }
    if (window.location.hash !== "#analyze") {
      return;
    }
    const handle = window.requestAnimationFrame(() => {
      document
        .getElementById("analyze")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(handle);
  }, [detail, loading]);

  // Debounced notes autosave
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
      if (!hasCoachTier) {
        setShowUpgradeModal(true);
        return;
      }
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
            if (message.toLowerCase().includes("upgrade")) {
              setShowUpgradeModal(true);
            }
          },
        }
      );
    },
    [flushStreamContent, hasCoachTier, loadDetail, resetStream, scheduleStreamFlush, studentId, token]
  );

  const startBatchAnalysis = useCallback(
    async (request: BatchAnalysisRequest) => {
      if (!hasCoachTier) {
        setShowUpgradeModal(true);
        return;
      }
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
          games: request.games.map((g) => ({
            game_url: g.gameUrl,
            username: request.username || undefined,
            player_color: g.playerColor || undefined,
          })),
          student_id: studentId,
        },
        {
          onEvent: (eventName, data) => {
            const payload = data as {
              message?: string;
              text?: string;
              game_url?: string;
              state?: BatchGameProgress["state"];
              insights?: InsightsData;
            };
            if (eventName === "batch_progress" && payload.game_url && payload.state) {
              setBatchGames((current) =>
                current.map((item) =>
                  item.gameUrl === payload.game_url
                    ? { ...item, state: payload.state! }
                    : item
                )
              );
            } else if (eventName === "status_update" && payload.message) {
              setStatus(payload.message);
            } else if (eventName === "content_chunk" && payload.text) {
              pendingChunks.current += payload.text;
              scheduleStreamFlush();
            } else if (eventName === "insights" && payload.insights) {
              setInsights(payload.insights);
            } else if (eventName === "done") {
              flushStreamContent();
              setStatus("Batch analysis complete");
              setIsAnalyzing(false);
              loadDetail(token);
            } else if (eventName === "error") {
              flushStreamContent();
              setStreamError(payload.message ?? "Batch analysis failed.");
              setStatus("");
              setIsAnalyzing(false);
            }
          },
          onError: (message) => {
            setStreamError(message);
            setStatus("");
            setIsAnalyzing(false);
            if (message.toLowerCase().includes("upgrade")) {
              setShowUpgradeModal(true);
            }
          },
        }
      );
    },
    [flushStreamContent, hasCoachTier, loadDetail, resetStream, scheduleStreamFlush, studentId, token]
  );

  const copyShareLink = useCallback(async (share: ShareStatus) => {
    if (!share.url_path) {
      return;
    }
    const full = shareUrl(share.url_path);
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      // Clipboard write can fail without HTTPS/user activation
    }
  }, []);

  const enableShare = useCallback(async () => {
    if (!hasCoachTier) {
      setShowUpgradeModal(true);
      return;
    }
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
      if (isUpgradeError(err) || (err instanceof Error && err.message.toLowerCase().includes("upgrade"))) {
        setShowUpgradeModal(true);
      } else {
        setError(
          err instanceof Error ? err.message : "Could not create the share link."
        );
      }
    } finally {
      setShareBusy(false);
    }
  }, [copyShareLink, hasCoachTier, shareBusy, studentId, token]);

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
        <Topbar user={user} onAuthChange={() => router.push("/")} />
        <div className="max-w-xl mx-auto mt-16 text-center">
          <p className="history-empty">Loading student dossier...</p>
        </div>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="dashboard">
        <Topbar user={user} onAuthChange={() => router.push("/")} />
        <div className="max-w-xl mx-auto mt-8 px-4">
          <div className="error-banner">{error || "Student not found."}</div>
          <Link href="/coach" className="btn btn-ghost mt-4">
            Back to students
          </Link>
        </div>
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
      <Topbar
        user={user}
        usage={usage}
        role="coach"
        onAuthChange={() => router.push("/")}
        onToggleRole={switchToPlayer}
      />

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Upgrade Banner for accounts without the Master Coach tier */}
        {!hasCoachTier && (
          <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-[var(--ink-2)] via-[rgba(201,153,63,0.12)] to-[var(--ink-2)] border border-[rgba(201,153,63,0.35)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[rgba(201,153,63,0.15)] border border-[rgba(201,153,63,0.4)] flex items-center justify-center text-[var(--gold-bright)] shrink-0">
                <Crown size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-[var(--text)]">Master Coach Preview</span>
                  <Pill tone="caution" size="sm">
                    {usage?.plan_tier === "student" ? "Student plan" : "Free tier"}
                  </Pill>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Upgrade to the Master Coach tier (&#8377;1,999/mo) to analyze games on behalf of {student.display_name} and generate shareable links.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link
                href="/subscription"
                className="students-btn-gold whitespace-nowrap"
              >
                <Crown size={14} />
                <span>Upgrade to Coach Tier</span>
                <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        )}

        <div className="game-header mb-6">
          <p className="game-meta mb-2">
            <Link href="/coach" className="nav-link inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--gold-bright)]">
              ← All students
            </Link>
          </p>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <h1 className="game-title text-2xl font-bold font-serif m-0">{student.display_name}</h1>
                {hasCoachTier ? (
                  <Pill tone="shell" size="sm" icon={<Crown size={12} className="text-[var(--gold-bright)]" />}>
                    Master Coach
                  </Pill>
                ) : (
                  <Pill tone="neutral" size="sm">
                    Preview Dossier
                  </Pill>
                )}
              </div>
              <p className="game-meta text-xs text-[var(--text-muted)] m-0">
                {student.lichess_username || student.chesscom_username ? (
                  <span className="flex items-center gap-2 flex-wrap">
                    {student.lichess_username && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-[var(--ink-2)] text-[var(--teal-light)] border border-[rgba(87,164,150,0.25)]">
                        Lichess · {student.lichess_username}
                      </span>
                    )}
                    {student.chesscom_username && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-[var(--ink-2)] text-[var(--green)] border border-[rgba(111,163,131,0.25)]">
                        Chess.com · {student.chesscom_username}
                      </span>
                    )}
                  </span>
                ) : (
                  "No usernames saved yet"
                )}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href={`/progress?student=${encodeURIComponent(studentId)}`}
                className="btn btn-sm inline-flex items-center gap-1.5"
              >
                <Activity size={14} />
                <span>View progress</span>
                <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        </div>

        {error && <div className="error-banner mb-6">{error}</div>}

        {/* Share Link Management */}
        <section className="share-panel mb-6 p-5 rounded-xl bg-[var(--ink-2)] border border-[var(--line)] shadow-sm" aria-label="Share link">
          <div className="share-head flex items-center justify-between mb-2">
            <h2 className="text-base font-semibold text-[var(--text)] m-0">Student Share Portal</h2>
            <span className="share-hint text-xs text-[var(--text-muted)] font-mono">
              {notesStatus === "saving" && "Saving notes..."}
              {notesStatus === "saved" && "Notes saved"}
              {notesStatus === "error" && "Could not save notes"}
            </span>
          </div>

          {detail.share.active && linkValue ? (
            <>
              <div className="share-row flex items-center gap-2 flex-wrap mt-2">
                <input
                  type="text"
                  readOnly
                  value={linkValue}
                  className="share-input flex-1 min-w-[200px] text-xs font-mono px-3 py-2 rounded-lg bg-[var(--ink-3)] border border-[var(--line)] text-[var(--text)]"
                  aria-label="Student progress share link"
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => copyShareLink(detail.share)}
                >
                  {copied ? "Copied" : "Copy link"}
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
              <p className="share-note text-xs text-[var(--text-muted)] mt-2">
                Anyone with this link can read {student.display_name}&apos;s
                reports. Your private notes stay hidden.
              </p>
            </>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-2">
              <p className="share-note text-xs text-[var(--text-muted)] m-0">
                Create a read-only portal so a parent or student can see reports and eval trends — no account required.
              </p>
              <button
                type="button"
                className="btn btn-sm inline-flex items-center gap-1.5 shrink-0"
                onClick={enableShare}
                disabled={shareBusy}
              >
                {!hasCoachTier && <Lock size={13} className="text-[var(--gold-bright)]" />}
                <span>{shareBusy ? "Creating..." : "Create share link"}</span>
              </button>
            </div>
          )}
        </section>

        {/* Shared studies / tactics for this student (coach-tier share items) */}
        <section className="students-shares mb-6" aria-label="Shared links">
          <div className="students-shares-head">
            <h2 className="students-shares-title">
              <Share2 size={14} className="inline-block mr-1.5 align-[-2px]" />
              Shared links
            </h2>
            <span className="students-shares-note">
              {sharesState === "loading"
                ? "Loading…"
                : sharesState === "unavailable"
                  ? "Unavailable right now"
                  : `${shares.length} ${
                      shares.length === 1 ? "item" : "items"
                    } shared with ${student.display_name}`}
            </span>
          </div>

          {sharesState === "loading" ? (
            <p className="students-shares-empty">Loading shared links…</p>
          ) : sharesState === "unavailable" ? (
            <p className="students-shares-empty">
              Shared links could not be loaded right now — existing{" "}
              <span className="students-mono">/s/…</span> links keep working.
            </p>
          ) : shares.length === 0 ? (
            <p className="students-shares-empty">
              No shared studies or tactics yet. Assign homework by sharing an
              item from the studies page — it will show up here with its view
              count.
            </p>
          ) : (
            <ul className="students-shares-list">
              {shares.map((item) => (
                <li
                  key={item.token}
                  className="students-shares-item"
                  title={item.subtitle ?? undefined}
                >
                  <div className="students-shares-main">
                    <span className="students-shares-name">{item.title}</span>
                    <span className="students-shares-sub">
                      {item.kind === "study" ? "Study" : "Tactic"} ·{" "}
                      {item.view_count}{" "}
                      {item.view_count === 1 ? "view" : "views"}
                      {item.created_at
                        ? ` · shared ${formatDate(item.created_at)}`
                        : ""}
                    </span>
                  </div>
                  <div className="students-shares-side">
                    <a
                      href={`/s/${item.token}`}
                      target="_blank"
                      rel="noreferrer"
                      className="students-btn-ghost"
                    >
                      Open
                    </a>
                    <button
                      type="button"
                      className="students-btn-ghost"
                      onClick={() => copyItemLink(item.token)}
                    >
                      {copiedToken === item.token ? (
                        <Check size={13} className="text-[var(--green-bright)]" />
                      ) : (
                        <Copy size={13} />
                      )}
                      <span>
                        {copiedToken === item.token ? "Copied" : "Copy"}
                      </span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Private Coaching Notes */}
        <section className="mb-6 p-5 rounded-xl bg-[var(--ink-2)] border border-[var(--line)] shadow-sm">
          <h2 className="text-base font-semibold text-[var(--text)] mb-2">Private Coach Notes</h2>
          <textarea
            className="field-textarea w-full text-xs p-3 rounded-lg bg-[var(--ink-3)] border border-[var(--line)] text-[var(--text)] focus:border-[var(--gold)] focus:outline-hidden"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Document tactical blindspots, opening homework, or tournament goals for this student..."
            rows={3}
          />
        </section>

        {/* Analyze Games for Student — the roster's "Analyze game" action lands here */}
        <section
          id="analyze"
          className="student-analyze-card students-analyze-card mb-8 p-5 rounded-xl bg-[var(--ink-2)] border border-[var(--line)] shadow-sm"
        >
          <div className="section-head coach-section-head mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--text)] m-0">
              Analyze a game for {student.display_name}
            </h2>
            {!hasCoachTier && (
              <Pill tone="caution" size="sm">
                Master Coach required
              </Pill>
            )}
          </div>
          <AnalyzerForm
            disabled={isAnalyzing}
            defaultUsername={student.chesscom_username ?? ""}
            studentId={student.id}
            onSubmit={startAnalysis}
            onSubmitBatch={startBatchAnalysis}
          />
          <div className="status-slot mt-3">
            <AnalysisStatus status={status} isAnalyzing={isAnalyzing} />
          </div>
          {batchGames.length > 0 && <BatchProgress games={batchGames} />}
          {streamError && <div className="error-banner mt-3">{streamError}</div>}
        </section>

        {(isAnalyzing || markdown) && (
          <div className="mb-8">
            <CoachingReport
              content={markdown}
              insights={insights}
              pending={isAnalyzing}
            />
          </div>
        )}

        <section className="history-panel p-5 rounded-xl bg-[var(--ink-2)] border border-[var(--line)] shadow-sm">
          <div className="section-head mb-4">
            <h2 className="text-base font-semibold text-[var(--text)] m-0">Student Game History</h2>
          </div>
          <AnalysisHistory entries={entries} />
        </section>
      </div>

      {/* Master Coach upgrade modal */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-lg rounded-2xl bg-[var(--ink-2)] border border-[rgba(201,153,63,0.4)] shadow-2xl p-6 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowUpgradeModal(false)}
              className="absolute top-4 right-4 text-[var(--text-muted)] hover:text-[var(--text)] p-1 rounded-lg hover:bg-[var(--ink-3)] transition-colors"
              aria-label="Close modal"
            >
              <X size={18} />
            </button>

            <div className="inline-flex items-center gap-2 mb-3">
              <Pill tone="shell" size="sm" icon={<Crown size={12} className="text-[var(--gold-bright)]" />}>
                Master Coach tier
              </Pill>
            </div>

            <h2 className="text-xl font-bold font-serif text-[var(--text)] mb-2">
              Upgrade to Coach Tier
            </h2>

            <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-4">
              To analyze live games on behalf of {student.display_name}, run 5-game batch audits, and share private web links with parents, upgrade to the Master Coach tier.
            </p>

            <div className="p-3.5 rounded-xl bg-[var(--ink-3)]/70 border border-[var(--line-soft)] mb-5">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs font-mono font-semibold text-[var(--gold-bright)]">Master Coach</span>
                <span className="text-sm font-bold text-[var(--text)]">&#8377;1,999 / mo</span>
              </div>
              <ul className="text-xs text-[var(--text-muted)] space-y-1.5">
                <li className="flex items-center gap-2">
                  <Check size={13} className="text-emerald-400 shrink-0" />
                  <span>Unlimited live student profiles &amp; notes</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check size={13} className="text-emerald-400 shrink-0" />
                  <span>Game analyses on behalf of every student</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check size={13} className="text-emerald-400 shrink-0" />
                  <span>5-game batch audits on behalf of students</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check size={13} className="text-emerald-400 shrink-0" />
                  <span>Branded shareable progress links for parents</span>
                </li>
              </ul>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/subscription"
                className="students-btn-gold flex-1 py-2.5 justify-center text-sm"
              >
                <Crown size={15} />
                <span>Upgrade to Coach Tier</span>
              </Link>
              <button
                type="button"
                onClick={() => setShowUpgradeModal(false)}
                className="btn btn-ghost text-xs text-[var(--text-muted)]"
              >
                Continue Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
