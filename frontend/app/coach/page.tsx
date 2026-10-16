"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  apiDelete,
  apiPost,
  apiPut,
  isUpgradeError,
  type StudentSummary,
  type Usage,
} from "../../lib/api";
import { apiGetCached, CACHE_TTL } from "../../lib/api-cache";
import { createClient } from "../../lib/supabase-client";
import { Topbar } from "../../components/ui/Topbar";
import { Pill } from "../../components/ui/Pill";
import {
  Crown,
  ArrowRight,
  X,
  Check,
  Users,
  Lock,
  Activity,
  Play,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";

/**
 * Roster row. Everything the backend roster payload carries lives on
 * ``StudentSummary``; the extra keys below are the optional enrichment slots the
 * roster may grow (rating / leak / homework). When they are absent we render an
 * honest "—" instead of inventing a number.
 */
type RosterStudent = StudentSummary & {
  latest_rating?: number | null;
  rating?: number | null;
  primary_leak?: string | null;
  tactical_leak?: string | null;
  leak_severity?: "critical" | "warning" | string | null;
  homework_status?: string | null;
};

type HomeworkPill = {
  label: string;
  tone: "green" | "red" | "amber" | "muted";
  hint: string;
};

const MASTER_COACH_PRICE = "₹1,999";

function formatDate(value?: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function daysSince(value?: string | null): number | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const diff = Date.now() - date.getTime();
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}

function activityLabel(student: RosterStudent): string {
  if (!student.analysis_count) {
    return "No analyses yet";
  }
  const count = `${student.analysis_count} ${
    student.analysis_count === 1 ? "analysis" : "analyses"
  }`;
  const last = formatDate(student.last_analysis_at);
  return last ? `${count} · last ${last}` : count;
}

/** Real rating only — never a computed or borrowed number. */
function ratingOf(student: RosterStudent): number | null {
  const candidate = student.latest_rating ?? student.rating ?? null;
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : null;
}

function leakOf(student: RosterStudent): string | null {
  const leak = (student.primary_leak ?? student.tactical_leak ?? "").trim();
  return leak || null;
}

function leakTone(student: RosterStudent): "critical" | "warning" | "info" {
  const severity = (student.leak_severity ?? "").toLowerCase();
  if (severity === "warning" || severity === "amber") {
    return "warning";
  }
  if (severity === "info" || severity === "muted") {
    return "info";
  }
  return "critical";
}

/**
 * Homework status: use the real field when the roster carries it, otherwise
 * derive it from the last analysed game (the only real signal we hold) and say so.
 */
function homeworkOf(student: RosterStudent): HomeworkPill {
  const raw = (student.homework_status ?? "").trim().toLowerCase();
  if (raw === "completed" || raw === "complete" || raw === "done") {
    return {
      label: "Completed",
      tone: "green",
      hint: "Homework marked completed for this student.",
    };
  }
  if (raw === "pending") {
    return {
      label: "Pending",
      tone: "red",
      hint: "Homework assigned, not completed yet.",
    };
  }
  if (raw === "assigned") {
    return {
      label: "Assigned",
      tone: "amber",
      hint: "Homework assigned, waiting on the student.",
    };
  }

  if (!student.analysis_count) {
    return {
      label: "Not started",
      tone: "muted",
      hint: "No game analysed yet — homework starts after the first report.",
    };
  }

  const days = daysSince(student.last_analysis_at);
  if (days !== null && days <= 7) {
    return {
      label: "Up to date",
      tone: "green",
      hint:
        days === 0
          ? "Latest game analysed today — derived from the roster activity, not an assignment."
          : `Latest game analysed ${days} ${days === 1 ? "day" : "days"} ago — derived from the roster activity, not an assignment.`,
    };
  }

  return {
    label: "Needs review",
    tone: "red",
    hint:
      days === null
        ? "No recent game on record — review the student's progress and set homework."
        : `No new game in ${days} days — review the student's progress and set homework.`,
  };
}

function progressHref(studentId: string): string {
  return `/progress?student=${encodeURIComponent(studentId)}`;
}

function analyzeHref(studentId: string): string {
  return `/coach/students/${encodeURIComponent(studentId)}#analyze`;
}

export default function CoachRosterPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [hasCoachTier, setHasCoachTier] = useState(false);
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [lichessUsername, setLichessUsername] = useState("");
  const [chesscomUsername, setChesscomUsername] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [archivingId, setArchivingId] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session;
      const activeUser = session?.user ?? null;
      setUser(activeUser);

      if (!activeUser) {
        router.replace("/");
        return;
      }

      if (session) {
        setToken(session.access_token);
        try {
          const [rows, usageData] = await Promise.all([
            apiGetCached<RosterStudent[]>("/api/coach/students", session.access_token, {
              ttlMs: CACHE_TTL.account,
            }),
            apiGetCached<Usage>("/api/account/usage", session.access_token, {
              ttlMs: CACHE_TTL.account,
            }).catch(() => null),
          ]);
          setStudents(rows);
          if (usageData) {
            setUsage(usageData);
            // plan_tier is the source of truth; older payloads fall back to plan.
            const tier =
              usageData.plan_tier ??
              (usageData.plan === "paid" ? "coach" : "free");
            setHasCoachTier(tier === "coach");
          }
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Failed to load your students."
          );
        } finally {
          setLoading(false);
        }
      }
    });
  }, [router]);

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

  const notifyStudentsChanged = useCallback(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("cm_students_changed"));
    }
  }, []);

  const handleOpenAddStudent = useCallback(() => {
    if (!hasCoachTier) {
      setShowUpgradeModal(true);
      return;
    }
    setShowForm((prev) => !prev);
  }, [hasCoachTier]);

  const addStudent = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!hasCoachTier) {
        setShowUpgradeModal(true);
        return;
      }
      if (!token || creating) {
        return;
      }
      setCreating(true);
      setError("");
      try {
        const created = await apiPost<StudentSummary>(
          "/api/coach/students",
          token,
          {
            display_name: displayName,
            lichess_username: lichessUsername,
            chesscom_username: chesscomUsername,
            notes,
          }
        );
        setStudents((current) => [created, ...current]);
        setDisplayName("");
        setLichessUsername("");
        setChesscomUsername("");
        setNotes("");
        setShowForm(false);
        notifyStudentsChanged();
      } catch (err) {
        if (
          isUpgradeError(err) ||
          (err instanceof Error && err.message.toLowerCase().includes("upgrade"))
        ) {
          setShowUpgradeModal(true);
        } else {
          setError(
            err instanceof Error ? err.message : "Could not add this student."
          );
        }
      } finally {
        setCreating(false);
      }
    },
    [
      chesscomUsername,
      creating,
      displayName,
      hasCoachTier,
      lichessUsername,
      notes,
      notifyStudentsChanged,
      token,
    ]
  );

  const archiveStudent = useCallback(
    async (student: RosterStudent) => {
      if (!token || archivingId) {
        return;
      }
      const confirmed = window.confirm(
        `Archive ${student.display_name}? Their reports stay available on any ` +
          "share link, but the profile leaves your roster."
      );
      if (!confirmed) {
        return;
      }
      setArchivingId(student.id);
      setError("");
      try {
        await apiDelete(`/api/coach/students/${student.id}`, token);
        setStudents((current) =>
          current.filter((row) => row.id !== student.id)
        );
        notifyStudentsChanged();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not archive this student."
        );
      } finally {
        setArchivingId("");
      }
    },
    [archivingId, notifyStudentsChanged, token]
  );

  const totalAnalyses = useMemo(
    () =>
      students.reduce(
        (sum, student) => sum + (student.analysis_count || 0),
        0
      ),
    [students]
  );

  const openStudent = useCallback(
    (studentId: string) => {
      router.push(progressHref(studentId));
    },
    [router]
  );

  const studentCount = students.length;

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
        {/* Preview banner for coaches without the Master Coach tier */}
        {!hasCoachTier && (
          <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-[var(--ink-2)] via-[rgba(201,153,63,0.12)] to-[var(--ink-2)] border border-[rgba(201,153,63,0.35)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[rgba(201,153,63,0.15)] border border-[rgba(201,153,63,0.4)] flex items-center justify-center text-[var(--gold-bright)] shrink-0">
                <Crown size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-[var(--text)]">
                    Master Coach Preview
                  </span>
                  <Pill tone="caution" size="sm">
                    {usage?.plan_tier === "student" ? "Student plan" : "Free tier"}
                  </Pill>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {usage?.plan_tier === "student"
                    ? "Your Student plan covers your own games. The roster, dossiers and share links need the Master Coach tier."
                    : "You are previewing the roster. The Master Coach tier unlocks live students, dossiers and share links."}
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

        {error && <div className="error-banner mb-6">{error}</div>}

        {showForm && hasCoachTier && (
          <form
            className="student-form mb-6 p-5 rounded-xl bg-[var(--ink-2)] border border-[var(--line)] shadow-sm"
            onSubmit={addStudent}
          >
            <h3 className="text-base font-semibold text-[var(--text)] mb-3">
              Add new student profile
            </h3>
            <label className="field">
              <span>Student name</span>
              <input
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="e.g. Alex Chen"
                required
                disabled={creating}
              />
            </label>
            <label className="field">
              <span>Lichess username (optional)</span>
              <input
                type="text"
                value={lichessUsername}
                onChange={(event) => setLichessUsername(event.target.value)}
                placeholder="e.g. alex_chess"
                disabled={creating}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>Chess.com username (optional)</span>
              <input
                type="text"
                value={chesscomUsername}
                onChange={(event) => setChesscomUsername(event.target.value)}
                placeholder="e.g. aarav-2145"
                disabled={creating}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>Private notes (optional)</span>
              <textarea
                className="field-textarea"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="What is this student working on?"
                rows={3}
                disabled={creating}
              />
            </label>
            <div className="student-form-actions mt-4 flex items-center gap-2">
              <button type="submit" className="btn" disabled={creating}>
                {creating ? "Adding..." : "Add student"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowForm(false)}
                disabled={creating}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <section className="students-panel" aria-labelledby="students-roster-title">
          <div className="students-panel-head">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1
                  id="students-roster-title"
                  className="students-panel-title"
                >
                  Students
                </h1>
                {hasCoachTier ? (
                  <Pill
                    tone="shell"
                    size="sm"
                    icon={
                      <Crown
                        size={12}
                        className="text-[var(--gold-bright)]"
                      />
                    }
                  >
                    Master Coach
                  </Pill>
                ) : (
                  <Pill tone="neutral" size="sm">
                    Preview mode
                  </Pill>
                )}
              </div>
              <p className="students-panel-sub">
                {loading
                  ? "Loading roster…"
                  : `Managing ${studentCount} active ${
                      studentCount === 1 ? "student" : "students"
                    }`}
              </p>
            </div>

            <button
              type="button"
              className="students-btn-gold"
              onClick={handleOpenAddStudent}
            >
              {!hasCoachTier && (
                <Lock size={13} className="text-[#141712]" />
              )}
              <span>{showForm ? "Close form" : "+ Add student"}</span>
            </button>
          </div>

          {loading ? (
            <p className="students-note">Loading your students…</p>
          ) : students.length === 0 ? (
            <div className="students-note text-center">
              <Users
                size={26}
                className="mx-auto mb-2 text-[var(--text-muted)]"
              />
              <p className="text-sm text-[var(--text)] font-semibold m-0">
                No students yet
              </p>
              <p className="text-xs max-w-md mx-auto mt-1 mb-4">
                Add a student with their Lichess or Chess.com username, analyze
                their games, then open their progress matrix and share link.
              </p>
              <div className="flex justify-center">
                <button
                  type="button"
                  className="students-btn-gold"
                  onClick={handleOpenAddStudent}
                >
                  + Add your first student
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="students-table-wrap">
                <table className="students-table">
                  <thead>
                    <tr>
                      <th scope="col">STUDENT</th>
                      <th scope="col">RATING</th>
                      <th scope="col">PRIMARY TACTICAL LEAK</th>
                      <th scope="col">HOMEWORK STATUS</th>
                      <th scope="col" className="students-th-actions">
                        ACTIONS
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((student) => {
                      const rating = ratingOf(student);
                      const leak = leakOf(student);
                      const homework = homeworkOf(student);
                      const gamesLabel = student.analysis_count
                        ? `${student.analysis_count} ${
                            student.analysis_count === 1 ? "game" : "games"
                          } analysed`
                        : "no analysed games yet";
                      const lastResultLabel = student.last_result
                        ? `last ${student.last_result}`
                        : "";
                      const leakCell = leak ? (
                        <span
                          className={`students-pill ${
                            leakTone(student) === "warning"
                              ? "students-pill-amber"
                              : leakTone(student) === "info"
                                ? "students-pill-muted"
                                : "students-pill-red"
                          } students-pill-wrap`}
                          title="Primary tactical leak from this student's analysed games."
                        >
                          {leak}
                        </span>
                      ) : student.analysis_count === 0 ? (
                        <span className="students-pill students-pill-muted students-pill-wrap">
                          No games analysed yet
                        </span>
                      ) : student.analysis_count < 4 ? (
                        <span className="students-pill students-pill-amber students-pill-wrap">
                          Needs 4+ analysed games
                        </span>
                      ) : (
                        <span
                          className="students-leak-unknown"
                          title="Open this student's progress matrix to compute their primary leak."
                        >
                          —
                        </span>
                      );

                      return (
                        <tr
                          key={student.id}
                          className="students-row"
                          title={`Open ${student.display_name}'s progress`}
                          onClick={(event) => {
                            if (
                              (event.target as HTMLElement).closest(
                                "a, button"
                              )
                            ) {
                              return;
                            }
                            openStudent(student.id);
                          }}
                        >
                          <td
                            className="students-cell-student"
                            data-label=""
                          >
                            <Link
                              href={progressHref(student.id)}
                              className="students-name"
                            >
                              {student.display_name}
                            </Link>
                            <div className="students-handles">
                              {student.lichess_username && (
                                <span className="students-handle students-handle-lichess">
                                  lichess · {student.lichess_username}
                                </span>
                              )}
                              {student.chesscom_username && (
                                <span className="students-handle students-handle-chesscom">
                                  chess.com · {student.chesscom_username}
                                </span>
                              )}
                              {!student.lichess_username &&
                                !student.chesscom_username && (
                                  <span className="students-handle students-handle-none">
                                    No username linked yet
                                  </span>
                                )}
                            </div>
                            <span className="students-cell-sub">
                              {activityLabel(student)}
                            </span>
                          </td>

                          <td data-label="Rating">
                            {rating !== null ? (
                              <span className="students-rating">
                                {rating}
                              </span>
                            ) : (
                              <span
                                className="students-rating students-rating-missing"
                                title="No rating captured yet — ratings appear after a rated game is analysed."
                              >
                                —
                              </span>
                            )}
                            <span className="students-cell-sub">
                              {gamesLabel}
                              {lastResultLabel ? ` · ${lastResultLabel}` : ""}
                            </span>
                          </td>

                          <td data-label="Primary tactical leak">
                            {leakCell}
                          </td>

                          <td data-label="Homework status">
                            <span
                              className={`students-pill students-pill-${homework.tone}`}
                              title={homework.hint}
                            >
                              {homework.label}
                            </span>
                          </td>

                          <td data-label="" className="students-cell-actions">
                            <div className="students-actions">
                              <Link
                                href={analyzeHref(student.id)}
                                className="students-btn-gold"
                                title={`Analyze a game for ${student.display_name}`}
                              >
                                <Play size={13} />
                                <span>Analyze game</span>
                              </Link>
                              <Link
                                href={progressHref(student.id)}
                                className="students-btn-ghost"
                                title={`Open ${student.display_name}'s progress`}
                              >
                                <Activity size={13} />
                                <span>Open progress</span>
                              </Link>
                              {hasCoachTier && (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm text-xs text-[var(--text-muted)] hover:text-red-400"
                                  onClick={() => archiveStudent(student)}
                                  disabled={archivingId === student.id}
                                >
                                  {archivingId === student.id
                                    ? "Archiving..."
                                    : "Archive"}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="students-table-foot">
                <span className="students-mono">
                  {totalAnalyses}{" "}
                  {totalAnalyses === 1 ? "analysis" : "analyses"}
                </span>{" "}
                across {studentCount}{" "}
                {studentCount === 1 ? "student" : "students"} · a dash means the
                value is not captured yet: ratings come from analysed rated
                games, leaks need 4+ analysed games, and homework status is
                derived from the last analysed game until assignments are
                tracked.
              </div>
            </>
          )}
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
              <Pill
                tone="shell"
                size="sm"
                icon={
                  <Crown size={12} className="text-[var(--gold-bright)]" />
                }
              >
                Master Coach tier
              </Pill>
            </div>

            <h2 className="text-xl font-bold font-serif text-[var(--text)] mb-2">
              Upgrade to Coach Tier
            </h2>

            <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-4">
              The roster, student dossiers, batch audits and private share links
              are part of the Master Coach tier. Add live Chess.com or Lichess
              students and analyze their games on their behalf.
            </p>

            <div className="p-3.5 rounded-xl bg-[var(--ink-3)]/70 border border-[var(--line-soft)] mb-5">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs font-mono font-semibold text-[var(--gold-bright)]">
                  Master Coach
                </span>
                <span className="text-sm font-bold text-[var(--text)]">
                  {MASTER_COACH_PRICE} / mo
                </span>
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
                  <span>5-game batch audits per student</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check size={13} className="text-emerald-400 shrink-0" />
                  <span>Branded share links for students &amp; parents</span>
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
                Continue preview
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
