"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthButton from "../../components/AuthButton";
import {
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  type StudentSummary,
} from "../../lib/api";
import { createClient } from "../../lib/supabase-client";
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
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
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
      setUser(session?.user ?? null);
      if (!session) {
        router.replace("/");
        return;
      }
      setToken(session.access_token);
      try {
        const rows = await apiGet<StudentSummary[]>(
          "/api/coach/students",
          session.access_token
        );
        setStudents(rows);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load your students."
        );
      } finally {
        setLoading(false);
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

  const addStudent = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
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
        setError(
          err instanceof Error ? err.message : "Could not add this student."
        );
      } finally {
        setCreating(false);
      }
    },
    [chesscomUsername, creating, displayName, lichessUsername, notes, token]
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
      <header className="topbar">
        <Link href="/" className="wordmark">
          <span className="wordmark-glyph" aria-hidden="true">
            ♜
          </span>
          Chessmasters
        </Link>
        <div className="topbar-actions">
          <Link href="/" className="nav-link">
            My games
          </Link>
          <Link href="/history" className="nav-link">
            History
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
        <h1 className="game-title">Students</h1>
        <p className="game-meta">
          {students.length > 0
            ? `${students.length} ${
                students.length === 1 ? "student" : "students"
              } · analyze their games and share progress links`
            : "Create a profile for each student you coach."}
        </p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="section-head coach-section-head">
        <h2>Roster</h2>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setShowForm((current) => !current)}
        >
          {showForm ? "Close" : "+ Add student"}
        </button>
      </div>

      {showForm && (
        <form className="student-form" onSubmit={addStudent}>
          <label className="field">
            <span>Student name</span>
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="e.g. Aarav"
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
              placeholder="e.g. aaravm"
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
              placeholder="e.g. aarav-m"
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
          <div className="student-form-actions">
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
        <p className="history-empty">Loading your students...</p>
      ) : students.length === 0 ? (
        <div className="coach-empty">
          <p>
            No students yet. Add one with their Lichess or Chess.com username,
            then analyze their games and share the progress link.
          </p>
          {!showForm && (
            <button
              type="button"
              className="btn"
              onClick={() => setShowForm(true)}
            >
              + Add your first student
            </button>
          )}
        </div>
      ) : (
        <div className="student-grid">
          {students.map((student) => (
            <article key={student.id} className="student-card">
              <div className="student-card-head">
                <span className="student-avatar" aria-hidden="true">
                  {initial(student.display_name)}
                </span>
                <div className="student-card-title">
                  <h3 className="student-name">{student.display_name}</h3>
                  <p className="student-meta">{activityLabel(student)}</p>
                </div>
              </div>
              <div className="student-usernames">
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
                {!student.lichess_username && !student.chesscom_username && (
                  <span className="student-username student-username-none">
                    No usernames saved yet
                  </span>
                )}
              </div>
              <div className="student-card-actions">
                <Link
                  href={`/coach/students/${student.id}`}
                  className="btn btn-sm"
                >
                  Open
                </Link>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => archiveStudent(student)}
                  disabled={archivingId === student.id}
                >
                  {archivingId === student.id ? "Archiving..." : "Archive"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
