"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  isUpgradeError,
  type StudentSummary,
  type Usage,
} from "../../lib/api";
import { createClient } from "../../lib/supabase-client";
import { Topbar } from "../../components/ui/Topbar";
import { Pill } from "../../components/ui/Pill";
import { Crown, ArrowRight, X, Sparkles, Check, Users, ShieldCheck, Lock } from "lucide-react";
import type { User } from "@supabase/supabase-js";

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

function activityLabel(student: StudentSummary): string {
  if (!student.analysis_count) {
    return "No analyses yet";
  }
  const count = `${student.analysis_count} ${
    student.analysis_count === 1 ? "analysis" : "analyses"
  }`;
  const last = formatDate(student.last_analysis_at);
  return last ? `${count} · last ${last}` : count;
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export default function CoachRosterPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [isPaid, setIsPaid] = useState(false);
  const [students, setStudents] = useState<StudentSummary[]>([]);
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
            apiGet<StudentSummary[]>("/api/coach/students", session.access_token),
            apiGet<Usage>("/api/account/usage", session.access_token).catch(() => null),
          ]);
          setStudents(rows);
          if (usageData) {
            setUsage(usageData);
            setIsPaid(usageData.plan === "paid");
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

  const handleOpenAddStudent = useCallback(() => {
    if (!isPaid) {
      setShowUpgradeModal(true);
      return;
    }
    setShowForm((prev) => !prev);
  }, [isPaid]);

  const addStudent = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!isPaid) {
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
      } catch (err) {
        if (isUpgradeError(err) || (err instanceof Error && err.message.toLowerCase().includes("upgrade"))) {
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
    [chesscomUsername, creating, displayName, isPaid, lichessUsername, notes, token]
  );

  const archiveStudent = useCallback(
    async (student: StudentSummary) => {
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
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not archive this student."
        );
      } finally {
        setArchivingId("");
      }
    },
    [archivingId, token]
  );

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
        {/* Upgrade Banner for Free / Preview Accounts */}
        {!isPaid && (
          <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-[var(--ink-2)] via-[rgba(201,153,63,0.12)] to-[var(--ink-2)] border border-[rgba(201,153,63,0.35)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[rgba(201,153,63,0.15)] border border-[rgba(201,153,63,0.4)] flex items-center justify-center text-[var(--gold-bright)] shrink-0">
                <Crown size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-[var(--text)]">Coach Pro Preview</span>
                  <Pill tone="caution" size="sm">Free Tier</Pill>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  You are previewing with sample student profiles. Upgrade to Coach Pro to add live students and share dossiers.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link
                href="/subscription"
                className="btn btn-sm inline-flex items-center gap-1.5 whitespace-nowrap bg-gradient-to-r from-[#c9993f] to-[#e2b65f] text-[#141712] font-semibold shadow-sm hover:shadow transition-all"
              >
                <Crown size={14} />
                <span>Upgrade for ₹399/mo</span>
                <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        )}

        <div className="game-header mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <h1 className="game-title text-2xl font-bold font-serif m-0">Student Roster</h1>
                {isPaid ? (
                  <Pill tone="shell" size="sm" icon={<Crown size={12} className="text-[var(--gold-bright)]" />}>
                    Coach Pro Active
                  </Pill>
                ) : (
                  <Pill tone="neutral" size="sm">
                    Preview Mode
                  </Pill>
                )}
              </div>
              <p className="game-meta text-xs text-[var(--text-muted)] m-0">
                {students.length > 0
                  ? `${students.length} ${
                      students.length === 1 ? "student" : "students"
                    } · analyze their games and share progress links`
                  : "Create a profile for each student you coach."}
              </p>
            </div>

            <button
              type="button"
              className="btn btn-sm inline-flex items-center gap-1.5"
              onClick={handleOpenAddStudent}
            >
              {!isPaid && <Lock size={13} className="text-[var(--gold-bright)]" />}
              <span>{showForm ? "Close form" : "+ Add student"}</span>
            </button>
          </div>
        </div>

        {error && <div className="error-banner mb-6">{error}</div>}

        {showForm && isPaid && (
          <form className="student-form mb-8 p-5 rounded-xl bg-[var(--ink-2)] border border-[var(--line)] shadow-sm" onSubmit={addStudent}>
            <h3 className="text-base font-semibold text-[var(--text)] mb-3">Add New Student Profile</h3>
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

        {loading ? (
          <p className="history-empty text-center py-12 text-sm text-[var(--text-muted)]">Loading your students...</p>
        ) : students.length === 0 ? (
          <div className="coach-empty p-8 rounded-xl bg-[var(--ink-2)] border border-dashed border-[var(--line)] text-center">
            <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto mb-4">
              No students yet. Add one with their Lichess or Chess.com username,
              then analyze their games and share the progress link.
            </p>
            <button
              type="button"
              className="btn"
              onClick={handleOpenAddStudent}
            >
              + Add your first student
            </button>
          </div>
        ) : (
          <div className="student-grid grid grid-cols-1 md:grid-cols-2 gap-4">
            {students.map((student) => (
              <article key={student.id} className="student-card p-5 rounded-xl bg-[var(--ink-2)] border border-[var(--line)] shadow-sm hover:border-[var(--line-strong)] transition-all">
                <div className="student-card-head flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <span className="student-avatar w-10 h-10 rounded-full bg-[var(--gold)]/20 border border-[var(--gold)]/40 text-[var(--gold-bright)] font-bold text-sm flex items-center justify-center shrink-0">
                      {initial(student.display_name)}
                    </span>
                    <div>
                      <h3 className="student-name text-base font-semibold text-[var(--text)] m-0">{student.display_name}</h3>
                      <p className="student-meta text-xs text-[var(--text-muted)] mt-0.5">{activityLabel(student)}</p>
                    </div>
                  </div>
                  {!isPaid && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[var(--ink-3)] text-[var(--text-muted)] border border-[var(--line-soft)]">
                      Sample
                    </span>
                  )}
                </div>

                {student.notes && (
                  <p className="text-xs text-[var(--text-muted)] line-clamp-2 italic mb-3">
                    &ldquo;{student.notes}&rdquo;
                  </p>
                )}

                <div className="student-usernames flex flex-wrap gap-1.5 mb-4">
                  {student.lichess_username && (
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-[var(--ink-3)] text-[var(--teal-light)] border border-[rgba(87,164,150,0.25)]">
                      Lichess · {student.lichess_username}
                    </span>
                  )}
                  {student.chesscom_username && (
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-[var(--ink-3)] text-[var(--green)] border border-[rgba(111,163,131,0.25)]">
                      Chess.com · {student.chesscom_username}
                    </span>
                  )}
                  {!student.lichess_username && !student.chesscom_username && (
                    <span className="student-username student-username-none text-xs text-[var(--text-muted)]">
                      No usernames saved yet
                    </span>
                  )}
                </div>

                <div className="student-card-actions flex items-center gap-2 pt-3 border-t border-[var(--line-soft)]">
                  <Link
                    href={`/coach/students/${student.id}`}
                    className="btn btn-sm inline-flex items-center gap-1.5"
                  >
                    <span>Open dossier</span>
                    <ArrowRight size={13} />
                  </Link>
                  {isPaid && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm text-xs text-[var(--text-muted)] hover:text-red-400"
                      onClick={() => archiveStudent(student)}
                      disabled={archivingId === student.id}
                    >
                      {archivingId === student.id ? "Archiving..." : "Archive"}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* Subscription Upgrade Modal */}
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
                Coach Pro Subscription
              </Pill>
            </div>

            <h2 className="text-xl font-bold font-serif text-[var(--text)] mb-2">
              Upgrade to Add Live Students
            </h2>

            <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-4">
              You are currently viewing the free preview roster. To connect live Chess.com or Lichess student accounts, batch analyze their games, and share private dossiers, upgrade to Coach Pro.
            </p>

            <div className="p-3.5 rounded-xl bg-[var(--ink-3)]/70 border border-[var(--line-soft)] mb-5">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs font-mono font-semibold text-[var(--gold-bright)]">Coach Pro Plan</span>
                <span className="text-sm font-bold text-[var(--text)]">₹399 / mo</span>
              </div>
              <ul className="text-xs text-[var(--text-muted)] space-y-1.5">
                <li className="flex items-center gap-2">
                  <Check size={13} className="text-emerald-400 shrink-0" />
                  <span>Unlimited live student profiles &amp; notes</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check size={13} className="text-emerald-400 shrink-0" />
                  <span>100 AI game analyses per month</span>
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
                className="btn flex-1 inline-flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-[#c9993f] to-[#e2b65f] text-[#141712] font-bold shadow-md hover:shadow-lg transition-all"
              >
                <Crown size={15} />
                <span>Upgrade to Pro (₹399/mo)</span>
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
