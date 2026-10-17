"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  Plus,
  Users,
  ExternalLink,
  Trash2,
  Share2,
  Check,
  TrendingUp,
  Search,
  Sparkles,
  Play,
} from "lucide-react";
import { createClient } from "../lib/supabase-client";
import {
  apiPost,
  apiDelete,
  type StudentSummary,
  type Usage,
} from "../lib/api";
import { apiGetCached, CACHE_TTL } from "../lib/api-cache";
import { Button } from "./ui/Button";

export type ManageStudentsModalProps = {
  isOpen?: boolean;
  onClose?: () => void;
  onStudentSelected?: (student: StudentSummary) => void;
  onStudentsChanged?: () => void;
};

export default function ManageStudentsModal({
  isOpen: controlledIsOpen,
  onClose: controlledOnClose,
  onStudentSelected,
  onStudentsChanged,
}: ManageStudentsModalProps) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledIsOpen !== undefined;
  const open = isControlled ? controlledIsOpen : internalOpen;

  const [token, setToken] = useState("");
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [showAddForm, setShowAddForm] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [lichessUsername, setLichessUsername] = useState("");
  const [chesscomUsername, setChesscomUsername] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const handleClose = useCallback(() => {
    if (isControlled && controlledOnClose) {
      controlledOnClose();
    } else {
      setInternalOpen(false);
    }
  }, [isControlled, controlledOnClose]);

  /** The roster, the progress page and the Dock all listen for this. */
  const notifyStudentsChanged = useCallback(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("cm_students_changed"));
    }
  }, []);

  // Listen for global "open-manage-students" event
  useEffect(() => {
    const handleOpen = () => setInternalOpen(true);
    window.addEventListener("open-manage-students", handleOpen);
    return () => window.removeEventListener("open-manage-students", handleOpen);
  }, []);

  // Fetch token and students
  const loadStudents = useCallback(async (authToken?: string) => {
    const currentToken = authToken || token;
    if (!currentToken) return;
    setLoading(true);
    setError(null);
    try {
      const list = await apiGetCached<StudentSummary[]>("/api/coach/students", currentToken, {
        ttlMs: CACHE_TTL.account,
        force: true,
      });
      setStudents(list || []);
      if (onStudentsChanged) onStudentsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load students roster.");
    } finally {
      setLoading(false);
    }
  }, [token, onStudentsChanged]);

  useEffect(() => {
    if (open) {
      const supabase = createClient();
      supabase.auth.getSession().then(({ data }) => {
        const sessionToken = data.session?.access_token || "";
        setToken(sessionToken);
        if (sessionToken) {
          loadStudents(sessionToken);
        }
      });
    }
  }, [open, loadStudents]);

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || !token) return;
    setSubmitting(true);
    setError(null);
    try {
      const newStudent = await apiPost<StudentSummary>("/api/coach/students", token, {
        display_name: displayName.trim(),
        lichess_username: lichessUsername.trim() || null,
        chesscom_username: chesscomUsername.trim() || null,
        notes: notes.trim() || null,
      });
      setDisplayName("");
      setLichessUsername("");
      setChesscomUsername("");
      setNotes("");
      setShowAddForm(false);
      await loadStudents(token);
      notifyStudentsChanged();
      if (onStudentSelected) {
        onStudentSelected(newStudent);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create student profile.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchiveStudent = async (studentId: string, name: string) => {
    if (!confirm(`Are you sure you want to archive student "${name}"?`)) return;
    if (!token) return;
    try {
      await apiDelete(`/api/coach/students/${studentId}`, token);
      await loadStudents(token);
      notifyStudentsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive student.");
    }
  };

  const handleShareLink = async (studentId: string) => {
    if (!token) return;
    try {
      const res = await apiPost<{ share: { token: string; url_path: string } }>(
        `/api/coach/students/${studentId}/share`,
        token
      );
      if (res?.share?.url_path) {
        const fullUrl = `${window.location.origin}${res.share.url_path}`;
        await navigator.clipboard.writeText(fullUrl);
        setCopiedId(studentId);
        setTimeout(() => setCopiedId(null), 2500);
      }
    } catch (err) {
      alert("Could not generate share link: " + (err instanceof Error ? err.message : "Error"));
    }
  };

  const filteredStudents = students.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.display_name.toLowerCase().includes(q) ||
      (s.chesscom_username && s.chesscom_username.toLowerCase().includes(q)) ||
      (s.lichess_username && s.lichess_username.toLowerCase().includes(q))
    );
  });

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Manage students"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/75 backdrop-blur-xs"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-[var(--ink-1)] border border-[var(--line)] shadow-2xl overflow-hidden z-10 text-[var(--text)]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)] bg-[var(--ink-2)]/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[var(--gold)]/15 border border-[var(--gold)]/30 flex items-center justify-center text-[var(--gold-bright)]">
                  <Users size={16} />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[var(--text)] font-serif">
                    Student Profiles
                  </h2>
                  <p className="text-xs text-[var(--text-muted)]">
                    Master Coach roster — attach a student to a review, open
                    their progress, and copy their share link
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!showAddForm && (
                  <button
                    type="button"
                    onClick={() => setShowAddForm(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--gold)]/20 hover:bg-[var(--gold)]/30 text-[var(--gold-bright)] border border-[var(--gold)]/40 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <Plus size={13} />
                    <span>Add Student</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleClose}
                  className="p-1.5 rounded-lg hover:bg-[var(--ink-3)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Error banner */}
            {error && (
              <div className="px-6 py-2.5 bg-rose-500/10 border-b border-rose-500/20 text-rose-300 text-xs">
                {error}
              </div>
            )}

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Add Student Form */}
              <AnimatePresence>
                {showAddForm && (
                  <motion.form
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    onSubmit={handleCreateStudent}
                    className="p-4 rounded-xl bg-[var(--ink-2)] border border-[var(--gold)]/30 space-y-3 mb-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[var(--gold-bright)] flex items-center gap-1.5">
                        <Sparkles size={13} />
                        New Student Profile
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowAddForm(false)}
                        className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text)]"
                      >
                        Cancel
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                          Student Name *
                        </label>
                        <input
                          type="text"
                          required
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="e.g. Aarav Sharma"
                          className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--ink-3)] border border-[var(--line)] focus:border-[var(--gold)] focus:outline-hidden text-[var(--text)]"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                          Chess.com Username
                        </label>
                        <input
                          type="text"
                          value={chesscomUsername}
                          onChange={(e) => setChesscomUsername(e.target.value)}
                          placeholder="e.g. AaravChess2026"
                          className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--ink-3)] border border-[var(--line)] focus:border-[var(--gold)] focus:outline-hidden text-[var(--text)]"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                          Lichess Username
                        </label>
                        <input
                          type="text"
                          value={lichessUsername}
                          onChange={(e) => setLichessUsername(e.target.value)}
                          placeholder="e.g. Aarav_Lichess"
                          className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--ink-3)] border border-[var(--line)] focus:border-[var(--gold)] focus:outline-hidden text-[var(--text)]"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                          Coach Notes (Private)
                        </label>
                        <input
                          type="text"
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="e.g. Focus on sub-30s clock panic and pins"
                          className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--ink-3)] border border-[var(--line)] focus:border-[var(--gold)] focus:outline-hidden text-[var(--text)]"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowAddForm(false)}
                        className="px-3 py-1 text-xs rounded-lg border border-[var(--line)] text-[var(--text-muted)] hover:bg-[var(--ink-3)]"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={submitting || !displayName.trim()}
                        className="px-3.5 py-1 text-xs font-semibold rounded-lg bg-[var(--gold-bright)] text-[#141712] hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
                      >
                        {submitting ? "Saving..." : "Create Profile"}
                      </button>
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>

              {/* Search & Filter Bar */}
              {students.length > 2 && (
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-2.5 text-[var(--text-muted)]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search student roster..."
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg bg-[var(--ink-2)] border border-[var(--line)] focus:border-[var(--gold)]/40 focus:outline-hidden text-[var(--text)] placeholder-[var(--text-muted)]"
                  />
                </div>
              )}

              {/* Roster List */}
              {loading ? (
                <div className="py-12 text-center text-xs text-[var(--text-muted)]">
                  Loading coach student roster...
                </div>
              ) : filteredStudents.length === 0 ? (
                <div className="py-10 text-center rounded-xl bg-[var(--ink-2)]/40 border border-dashed border-[var(--line)] p-6">
                  <Users size={28} className="mx-auto text-[var(--text-muted)] mb-2" />
                  <p className="text-sm font-semibold text-[var(--text)]">No student profiles found</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1 max-w-sm mx-auto">
                    Create your first student profile to track their progress, analyze games on their behalf, and share private dossiers.
                  </p>
                  {!showAddForm && (
                    <button
                      type="button"
                      onClick={() => setShowAddForm(true)}
                      className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--gold)]/20 hover:bg-[var(--gold)]/30 text-[var(--gold-bright)] border border-[var(--gold)]/40 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <Plus size={13} />
                      <span>Add First Student</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredStudents.map((student) => (
                    <div
                      key={student.id}
                      className="p-3.5 rounded-xl bg-[var(--ink-2)] border border-[var(--line)] hover:border-[var(--line-strong)] transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-[var(--text)]">
                            {student.display_name}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--ink-3)] text-[var(--text-muted)] border border-[var(--line)]">
                            {student.analysis_count} {student.analysis_count === 1 ? "game" : "games"}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] font-mono">
                          {student.chesscom_username && (
                            <span>Chess.com: @{student.chesscom_username}</span>
                          )}
                          {student.lichess_username && (
                            <span>Lichess: @{student.lichess_username}</span>
                          )}
                          {!student.chesscom_username && !student.lichess_username && (
                            <span className="italic text-[var(--text-muted)]">No platform handle linked</span>
                          )}
                        </div>

                        {student.notes && (
                          <p className="text-[11px] text-[var(--text-muted)] line-clamp-1 italic">
                            &quot;{student.notes}&quot;
                          </p>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                        {/* Select for Analysis / Review */}
                        {onStudentSelected && (
                          <button
                            type="button"
                            onClick={() => {
                              onStudentSelected(student);
                              handleClose();
                            }}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-[var(--gold)]/15 hover:bg-[var(--gold)]/25 text-[var(--gold-bright)] border border-[var(--gold)]/30 transition-colors cursor-pointer"
                          >
                            Attach to Review
                          </button>
                        )}

                        {/* Analyze a game for this student (dossier #analyze) */}
                        <button
                          type="button"
                          onClick={() => {
                            handleClose();
                            router.push(`/coach/students/${student.id}#analyze`);
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-[var(--gold-bright)] hover:opacity-90 text-[#141712] transition-opacity cursor-pointer"
                          title="Analyze a game for this student"
                        >
                          <Play size={13} />
                          <span>Analyze</span>
                        </button>

                        {/* View Progress */}
                        <button
                          type="button"
                          onClick={() => {
                            handleClose();
                            router.push(`/progress?student=${student.id}`);
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--ink-3)] border border-[var(--line)] transition-colors cursor-pointer"
                          title="View Student Progress & Leaks"
                        >
                          <TrendingUp size={14} />
                          <span>View Progress</span>
                        </button>

                        {/* Copy Share Link */}
                        <button
                          type="button"
                          onClick={() => handleShareLink(student.id)}
                          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--ink-3)] border border-[var(--line)] transition-colors cursor-pointer"
                          title="Copy Shareable Link for Student/Parent"
                        >
                          {copiedId === student.id ? (
                            <Check size={14} className="text-emerald-400" />
                          ) : (
                            <Share2 size={14} />
                          )}
                        </button>

                        {/* Archive */}
                        <button
                          type="button"
                          onClick={() => handleArchiveStudent(student.id, student.display_name)}
                          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-rose-400 hover:bg-rose-500/10 border border-[var(--line)] transition-colors cursor-pointer"
                          title="Archive Student"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-[var(--line)] bg-[var(--ink-2)]/30 flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span>{students.length} active students in roster</span>
              <button
                type="button"
                onClick={handleClose}
                className="px-3 py-1 rounded-lg hover:bg-[var(--ink-3)] text-[var(--text)] cursor-pointer"
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
