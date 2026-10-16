"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Share2, Check, Copy, ExternalLink, Trash2 } from "lucide-react";
import {
  API_BASE,
  shareUrl,
  type ShareItemStatus,
  type SharedItem,
} from "../../lib/api";

export type ShareMenuStudent = {
  id: string;
  display_name: string;
};

export type ShareMenuProps = {
  /** What is being handed to the student. The backend stores it verbatim. */
  kind: "study" | "tactic";
  /** Stable key (study id or tactic theme key). */
  itemKey: string;
  title: string;
  subtitle?: string | null;
  /** Lichess destination the student lands on from the share page. */
  url?: string | null;
  /** Coach's Supabase access token. */
  token: string;
  /** Coach's students — renders the optional "for student" selector. */
  students?: ShareMenuStudent[];
  /** Pre-selected student (e.g. the student whose page the coach is viewing). */
  defaultStudentId?: string | null;
  /** Trigger label; defaults to "Share". */
  label?: string;
  className?: string;
};

type FailureTone = "upgrade" | "signin" | "unavailable" | "error";

type Failure = {
  tone: FailureTone;
  message: string;
};

type ShareState =
  | { status: "idle" }
  | { status: "creating" }
  | { status: "ready"; share: ShareItemStatus }
  | { status: "failed"; failure: Failure };

function failureForStatus(status: number, detail: string | null): Failure {
  if (status === 401 || status === 403) {
    if (status === 403 && detail) {
      return { tone: "upgrade", message: detail };
    }
    return {
      tone: "signin",
      message: "Sign in with your coach account to create share links.",
    };
  }
  if (status === 402) {
    return {
      tone: "upgrade",
      message: detail ?? "Sharing is part of the Master Coach plan.",
    };
  }
  if (status === 404) {
    return {
      tone: "unavailable",
      message:
        "Sharing is not enabled on this deployment yet. The study link below still works.",
    };
  }
  return {
    tone: "error",
    message: detail ?? `Could not create the share link (${status}).`,
  };
}

async function readDetail(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") {
      const detail = (body as { detail?: unknown }).detail;
      if (typeof detail === "string") {
        return detail;
      }
      if (detail && typeof detail === "object") {
        const message = (detail as { message?: unknown }).message;
        if (typeof message === "string") {
          return message;
        }
      }
    }
  } catch {
    // Non-JSON error bodies are fine: the status code carries the meaning.
  }
  return null;
}

/**
 * Create / revoke a no-sign-in share link for one study or tactic.
 *
 * Deliberately not routed through `apiPost`: the empty-state copy depends on
 * the HTTP status (402/403 = plan tier, 404 = backend not deployed), which the
 * shared API helper folds into a generic Error message.
 */
export default function ShareMenu({
  kind,
  itemKey,
  title,
  subtitle,
  url,
  token,
  students,
  defaultStudentId,
  label = "Share",
  className,
}: ShareMenuProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ShareState>({ status: "idle" });
  const [studentId, setStudentId] = useState(defaultStudentId ?? "");
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [history, setHistory] = useState<SharedItem[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setStudentId(defaultStudentId ?? "");
  }, [defaultStudentId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  /** The coach's existing links for the selected student, when the API exists. */
  useEffect(() => {
    if (!open || !studentId || !token) {
      return;
    }
    let cancelled = false;
    apiListStudentShares(token, studentId)
      .then((items) => {
        if (!cancelled) {
          setHistory(items);
          setHistoryFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHistory(null);
          setHistoryFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, studentId, token, state]);

  const createLink = useCallback(async () => {
    if (!token || state.status === "creating") {
      return;
    }
    setState({ status: "creating" });
    setCopied(false);
    try {
      const response = await fetch(`${API_BASE}/api/share/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          kind,
          item_key: itemKey,
          title,
          subtitle: subtitle ?? undefined,
          url: url ?? undefined,
          student_id: studentId || undefined,
        }),
      });
      if (!response.ok) {
        const detail = await readDetail(response);
        setState({
          status: "failed",
          failure: failureForStatus(response.status, detail),
        });
        return;
      }
      const share = (await response.json()) as ShareItemStatus;
      setState({ status: "ready", share });
    } catch {
      setState({
        status: "failed",
        failure: {
          tone: "error",
          message:
            "Could not reach the server. Check your connection and try again.",
        },
      });
    }
  }, [itemKey, kind, studentId, state.status, subtitle, title, token, url]);

  const revoke = useCallback(
    async (shareToken: string, fromHistory: boolean) => {
      if (!token || revoking) {
        return;
      }
      setRevoking(true);
      try {
        const response = await fetch(
          `${API_BASE}/api/share/items/${encodeURIComponent(shareToken)}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (!response.ok && response.status !== 404) {
          const detail = await readDetail(response);
          setState({
            status: "failed",
            failure: failureForStatus(response.status, detail),
          });
          return;
        }
        if (fromHistory) {
          setHistory((items) =>
            (items ?? []).filter((item) => item.token !== shareToken)
          );
        } else {
          setState({ status: "idle" });
          setCopied(false);
        }
      } catch {
        setState({
          status: "failed",
          failure: {
            tone: "error",
            message: "Could not revoke the link. Check your connection.",
          },
        });
      } finally {
        setRevoking(false);
      }
    },
    [revoking, token]
  );

  const copyLink = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl(path));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      // Clipboard can fail without HTTPS / user activation — the URL stays on
      // screen and selectable in that case.
    }
  }, []);

  const share = state.status === "ready" ? state.share : null;
  const failure = state.status === "failed" ? state.failure : null;
  const studentOptions = students ?? [];

  return (
    <div className={`studies-share ${className ?? ""}`} ref={rootRef}>
      <button
        type="button"
        className="studies-share-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <Share2 aria-hidden="true" size={14} />
        {label}
      </button>

      {open && (
        <div className="studies-share-panel" role="dialog" aria-label={`Share ${title}`}>
          <p className="studies-share-title">{title}</p>
          <p className="studies-share-sub">
            Creates a link that opens without sign-in. Tactic themes and studies
            share the same portal.
          </p>

          {studentOptions.length > 0 && (
            <label className="studies-share-field">
              <span>For student</span>
              <select
                value={studentId}
                onChange={(event) => setStudentId(event.target.value)}
              >
                <option value="">Anyone with the link</option>
                {studentOptions.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.display_name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {share ? (
            <div className="studies-share-result">
              <code className="studies-share-link">{shareUrl(share.url_path)}</code>
              <div className="studies-share-actions">
                <button
                  type="button"
                  className="studies-share-action"
                  onClick={() => copyLink(share.url_path)}
                >
                  {copied ? (
                    <Check aria-hidden="true" size={13} />
                  ) : (
                    <Copy aria-hidden="true" size={13} />
                  )}
                  {copied ? "Copied" : "Copy link"}
                </button>
                <a
                  className="studies-share-action"
                  href={share.url_path}
                  target="_blank"
                  rel="noopener"
                >
                  <ExternalLink aria-hidden="true" size={13} />
                  Open
                </a>
                <button
                  type="button"
                  className="studies-share-action studies-share-revoke"
                  onClick={() => revoke(share.token, false)}
                  disabled={revoking}
                >
                  <Trash2 aria-hidden="true" size={13} />
                  {revoking ? "Revoking…" : "Revoke"}
                </button>
              </div>
              <p className="studies-share-views">
                {share.view_count} {share.view_count === 1 ? "view" : "views"}
              </p>
            </div>
          ) : (
            <button
              type="button"
              className="studies-share-create"
              onClick={createLink}
              disabled={state.status === "creating" || !token}
            >
              {state.status === "creating" ? "Creating link…" : "Create share link"}
            </button>
          )}

          {failure && (
            <p className={`studies-share-note studies-share-note-${failure.tone}`}>
              {failure.message}
              {failure.tone === "upgrade" && (
                <>
                  {" "}
                  <Link href="/subscription">See coach plans →</Link>
                </>
              )}
            </p>
          )}

          {url && (
            <a
              className="studies-share-source"
              href={url}
              target="_blank"
              rel="noopener"
            >
              Lichess destination ↗
            </a>
          )}

          {studentId && history && history.length > 0 && (
            <div className="studies-share-history">
              <span className="studies-share-history-label">
                Already shared with this student
              </span>
              {history.slice(0, 4).map((item) => (
                <div className="studies-share-history-item" key={item.token}>
                  <span className="studies-share-history-title">{item.title}</span>
                  <span className="studies-share-history-views">
                    {item.view_count}×
                  </span>
                  <button
                    type="button"
                    className="studies-share-action studies-share-revoke"
                    onClick={() => revoke(item.token, true)}
                    disabled={revoking}
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}

          {studentId && historyFailed && (
            <p className="studies-share-note">
              Existing links for this student could not be listed here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

async function apiListStudentShares(
  token: string,
  studentId: string
): Promise<SharedItem[]> {
  const response = await fetch(
    `${API_BASE}/api/coach/students/${encodeURIComponent(studentId)}/shares`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  const body: unknown = await response.json();
  if (Array.isArray(body)) {
    return body as SharedItem[];
  }
  // The route may wrap the list; accept either envelope without inventing rows.
  if (body && typeof body === "object") {
    for (const key of ["items", "shares"] as const) {
      const value = (body as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        return value as SharedItem[];
      }
    }
  }
  return [];
}
