"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Topbar } from "@/components/ui/Topbar";
import { Pill } from "@/components/ui/Pill";
import AuthButton from "@/components/AuthButton";
import ShareMenu from "@/components/studies/ShareMenu";
import SharedItemView from "@/components/studies/SharedItemView";
import StudyChapterExplorer from "@/components/studies/StudyChapterExplorer";
import type { StudyImport } from "@/components/studies/studyTypes";
import { useStudySession } from "@/components/studies/useStudySession";
import { apiGet, importStudy, isUpgradeError, type SharedItemPayload } from "@/lib/api";
import { warmBackend } from "@/lib/backend-wake";

type SharedTokenResponse = {
  kind?: string;
  item?: SharedItemPayload | null;
  student?: unknown;
};

type Mode = "loading" | "shared" | "study" | "missing" | "locked" | "signin";

/**
 * One route, two sources.
 *
 * `/study/{id}` is reachable as (a) a curated/imported Lichess study, rendered
 * from `GET /api/studies/import/{study_id}`, and (b) the in-app view of a shared
 * study or tactic, rendered from `GET /api/shared/{id}`. Both requests are
 * issued together — the shared payload wins when it exists — so a share link
 * and a study id resolve on the same page without a guess about id shape.
 */
export default function StudyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const session = useStudySession({ students: true });

  const [mode, setMode] = useState<Mode>("loading");
  const [shared, setShared] = useState<SharedItemPayload | null>(null);
  const [study, setStudy] = useState<StudyImport | null>(null);
  const [externalUrl, setExternalUrl] = useState("");
  const [motif, setMotif] = useState("");
  const [studentShare, setStudentShare] = useState(false);
  const [lockedMessage, setLockedMessage] = useState("");

  // A curated card can hand its Lichess URL over, which keeps the fallback link
  // honest even when the id itself is not a Lichess study id.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const query = new URLSearchParams(window.location.search);
    const candidate = query.get("url");
    if (candidate && /^https?:\/\//i.test(candidate)) {
      setExternalUrl(candidate);
    }
    const motifParam = query.get("motif");
    if (motifParam) {
      setMotif(motifParam);
    }
  }, []);

  useEffect(() => {
    // The study read is authenticated, so wait until the session has settled;
    // the shared-item read stays anonymous and instant for share links.
    if (!id || !session.ready) {
      return;
    }
    warmBackend();
    let cancelled = false;
    const encoded = encodeURIComponent(id);

    (async () => {
      const sharedPromise = apiGet<SharedTokenResponse>(
        `/api/shared/${encoded}`
      ).catch(() => null);
      const studyPromise = session.token
        ? importStudy<StudyImport>(id, session.token).then(
            (value) => ({ status: "ok" as const, value }),
            (error: unknown) => ({ status: "error" as const, error })
          )
        : Promise.resolve({ status: "anonymous" as const });

      const [sharedResult, studyResult] = await Promise.all([
        sharedPromise,
        studyPromise,
      ]);
      if (cancelled) {
        return;
      }

      const item = sharedResult?.item ?? null;
      const sharedKind = sharedResult?.kind;
      if (item && (sharedKind === "study" || sharedKind === "tactic")) {
        setShared(item);
        setMode("shared");
        return;
      }

      // A student report token can be pasted into this route by mistake; point
      // at the portal that renders reports instead of a dead end.
      const isStudentShare =
        sharedKind === "student" || (Boolean(sharedResult?.student) && !item);
      if (isStudentShare) {
        setStudentShare(true);
      }

      if (studyResult.status === "ok") {
        setStudy(studyResult.value);
        setMode("study");
        return;
      }
      if (studyResult.status === "error") {
        const error = studyResult.error;
        if (isUpgradeError(error)) {
          setLockedMessage(error.message);
          setMode("locked");
          return;
        }
        if (error instanceof Error && /sign in/i.test(error.message)) {
          setMode("signin");
          return;
        }
      }
      if (studyResult.status === "anonymous") {
        setMode("signin");
        return;
      }

      setMode("missing");
    })();

    return () => {
      cancelled = true;
    };
  }, [id, session.ready, session.token]);

  const students = session.students.map((student) => ({
    id: student.id,
    display_name: student.display_name,
  }));

  return (
    <div className="min-h-screen bg-[var(--ink-1)] text-[var(--text)] flex flex-col">
      <Topbar />

      <main className="flex-1 w-full max-w-[var(--shell-max)] mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
        <nav className="studies-breadcrumb" aria-label="Breadcrumb">
          <Link href="/studies">← All Studies</Link>
          <span aria-hidden="true">/</span>
          <span>
            {mode === "shared" && shared
              ? `Shared ${shared.kind}`
              : mode === "study"
                ? "Lichess study"
                : "Study"}
          </span>
        </nav>

        {mode === "loading" && (
          <p className="studies-inline-note">Loading study…</p>
        )}

        {mode === "signin" && (
          <section className="studies-empty studies-empty-block">
            <h1 className="studies-empty-title">Sign in to open this study</h1>
            <p className="studies-empty-body">
              Curated studies are private Lichess studies shared with the
              students who work on them. Sign in and this page renders the
              study with its board, chapters and drills.
            </p>
            <div className="studies-empty-actions">
              <AuthButton user={null} onAuthChange={() => undefined} />
              <Link className="studies-card-link" href="/tactics">
                Browse the tactic directory
              </Link>
            </div>
          </section>
        )}

        {mode === "locked" && (
          <section className="studies-empty studies-empty-block">
            <h1 className="studies-empty-title">This study is part of the library</h1>
            <p className="studies-empty-body">
              {lockedMessage ||
                "The full curated study library is available with a paid plan."}
            </p>
            <div className="studies-empty-actions">
              <Link className="btn btn-sm studies-card-primary" href="/subscription">
                See the plans ➔
              </Link>
              <Link className="studies-card-link" href="/studies">
                Back to your curriculum
              </Link>
            </div>
          </section>
        )}

        {mode === "missing" && (
          <section className="studies-empty studies-empty-block">
            <h1 className="studies-empty-title">
              {studentShare
                ? "This link holds shared coaching reports"
                : "This study is not available"}
            </h1>
            <p className="studies-empty-body">
              {studentShare
                ? "The token in this URL belongs to a student report feed, which the share portal renders."
                : "The study could not be read — it may be private on Lichess, or the link is out of date. Studies built from your own games are on the curriculum page."}
            </p>
            <div className="studies-empty-actions">
              {externalUrl ? (
                <a
                  className="btn btn-sm studies-card-primary"
                  href={externalUrl}
                  target="_blank"
                  rel="noopener"
                >
                  Open on Lichess ↗
                </a>
              ) : null}
              {studentShare ? (
                <Link
                  className="btn btn-sm studies-card-primary"
                  href={`/s/${encodeURIComponent(id)}`}
                >
                  Open the shared reports ➔
                </Link>
              ) : null}
              <Link className="studies-card-link" href="/studies">
                Back to studies
              </Link>
            </div>
          </section>
        )}

        {mode === "shared" && shared && (
          <SharedItemView
            payload={{ ...shared, view_count: shared.view_count ?? undefined }}
            footer={
              <p className="studies-shared-foot">
                Shared by a coach · opens without sign-in.
              </p>
            }
          />
        )}

        {mode === "study" && study && (
          <>
            <header className="studies-detail-head">
              <div>
                <h1 className="studies-detail-title">{study.study_title}</h1>
                <div className="studies-detail-meta">
                  <Pill tone="shell" size="sm">
                    Lichess study {study.study_id}
                  </Pill>
                  <span className="studies-mono-chip">
                    {study.chapter_count}{" "}
                    {study.chapter_count === 1 ? "chapter" : "chapters"}
                  </span>
                  {typeof study.total_annotations === "number" && (
                    <span className="studies-mono-chip">
                      {study.total_annotations} annotations
                    </span>
                  )}
                </div>
              </div>

              <div className="studies-detail-actions">
                {study.source_url ? (
                  <a
                    className="btn btn-sm btn-ghost"
                    href={study.source_url}
                    target="_blank"
                    rel="noopener"
                  >
                    Open in Lichess ↗
                  </a>
                ) : null}
                {session.isCoach ? (
                  <ShareMenu
                    kind="study"
                    itemKey={study.study_id}
                    title={study.study_title}
                    subtitle={`${study.chapter_count} chapters from Lichess`}
                    url={study.source_url}
                    token={session.token}
                    students={students}
                  />
                ) : null}
              </div>
            </header>

            <StudyChapterExplorer study={study} motif={motif || null} />
          </>
        )}
      </main>
    </div>
  );
}
