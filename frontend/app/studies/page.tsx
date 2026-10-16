"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/ui/Topbar";
import { Pill } from "@/components/ui/Pill";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import ShareMenu from "@/components/studies/ShareMenu";
import { useStudySession } from "@/components/studies/useStudySession";
import { type CuratedStudy } from "@/lib/api";
import { apiGetCached, CACHE_TTL } from "@/lib/api-cache";
import { warmBackend } from "@/lib/backend-wake";

type LoadState = "loading" | "ready" | "unavailable";

/**
 * The personalized curriculum.
 *
 * `GET /api/studies/curated` is the only source: every card is derived from the
 * leaks in real analyzed games, and the sentence a student reads is the
 * backend's own `reason` — never a template written here. A coach can pass
 * `?student_id=` (or pick from the roster) to see the student's list instead of
 * their own.
 */
export default function StudiesPage() {
  const session = useStudySession({ students: true });
  const [studentId, setStudentId] = useState("");
  const [studies, setStudies] = useState<CuratedStudy[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    warmBackend();
  }, []);

  // Deep link from a coach roster: /studies?student_id=… preselects the student.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const requested = new URLSearchParams(window.location.search).get("student_id");
    if (requested) {
      setStudentId(requested);
    }
  }, []);

  useEffect(() => {
    if (!session.ready) {
      return;
    }
    let cancelled = false;
    setLoadState("loading");
    const query = studentId ? `?student_id=${encodeURIComponent(studentId)}` : "";
    apiGetCached<CuratedStudy[]>(
      `/api/studies/curated${query}`,
      session.token || undefined,
      { ttlMs: CACHE_TTL.data }
    )
      .then((list) => {
        if (cancelled) {
          return;
        }
        setStudies(Array.isArray(list) ? list : []);
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        // 401 (no personal list without a session) and 404 (endpoint not
        // deployed) both land here: show the honest empty state, not an error
        // page, because the curriculum is a bonus surface.
        setStudies([]);
        setLoadState("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [session.ready, session.token, studentId]);

  const selectedStudent = session.students.find(
    (student) => student.id === studentId
  );

  const openHref = useCallback((study: CuratedStudy) => {
    const query = new URLSearchParams();
    if (study.source_url) {
      query.set("url", study.source_url);
    }
    if (study.motif) {
      query.set("motif", study.motif);
    }
    const suffix = query.toString();
    return `/study/${encodeURIComponent(study.id)}${suffix ? `?${suffix}` : ""}`;
  }, []);

  const coachOptions = session.students.map((student) => ({
    id: student.id,
    display_name: student.display_name,
  }));

  const loading = loadState === "loading";

  return (
    <div className="min-h-screen bg-[var(--ink-1)] text-[var(--text)] flex flex-col">
      <Topbar />

      <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 py-8">
        <div className="studies-head-row">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="studies-eyebrow">♞ Curriculum</span>
              <Pill tone="shell" size="sm">
                {selectedStudent
                  ? `For ${selectedStudent.display_name}`
                  : session.signedIn
                    ? "Tailored to your leaks"
                    : "Personalized from analyzed games"}
              </Pill>
            </div>
            <h1 className="studies-page-title">
              Curated Lichess Studies &amp; Drills
            </h1>
            <p className="studies-page-sub">
              {session.signedIn
                ? "Every study below is derived from tactical leaks identified in your analysed games — the assigned reason quotes the game and the move that produced it."
                : "Each study is derived from tactical leaks identified in a player's analysed games — the assigned reason quotes the game and the move that produced it."}
            </p>
          </div>

          <div className="studies-head-actions">
            {session.isCoach && coachOptions.length > 0 && (
              <label className="studies-student-picker">
                <span>Personalise for</span>
                <select
                  value={studentId}
                  onChange={(event) => setStudentId(event.target.value)}
                >
                  <option value="">My own games</option>
                  {coachOptions.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.display_name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button
              variant="ghost"
              size="sm"
              href="https://lichess.org/study"
              target="_blank"
            >
              Browse All Lichess Studies ↗
            </Button>
          </div>
        </div>

        <div className="studies-count-row">
          <span className="studies-count-pill">
            {loading
              ? "Loading…"
              : `${studies.length} ${studies.length === 1 ? "Curated Study" : "Curated Studies"}`}
          </span>
          <span className="studies-count-note">
            Personalized from real games · no template drills
          </span>
        </div>

        {loading && (
          <div className="studies-grid" aria-hidden="true">
            {[0, 1, 2].map((key) => (
              <Card
                key={key}
                surface="shell"
                pad="md"
                className="studies-card studies-skeleton"
              />
            ))}
          </div>
        )}

        {!loading && studies.length === 0 && <StudiesEmpty signedIn={session.signedIn} />}

        {!loading && studies.length > 0 && (
          <div className="studies-grid">
            {studies.map((study) => (
              <Card
                key={study.id}
                surface="shell"
                pad="md"
                className="studies-card"
              >
                <div className="studies-card-top">
                  <div className="studies-card-pills">
                    {study.fixes ? (
                      <Pill tone="alert" size="sm">
                        {study.fixes}
                      </Pill>
                    ) : null}
                    {study.motif ? (
                      <Pill tone="accent" size="sm">
                        {study.motif}
                      </Pill>
                    ) : null}
                  </div>
                  {typeof study.chapters === "number" && (
                    <span className="studies-chapters">
                      {study.chapters}{" "}
                      {study.chapters === 1 ? "Chapter" : "Chapters"}
                    </span>
                  )}
                </div>

                <h2 className="studies-card-title">{study.title}</h2>
                <p className="studies-card-reason">{study.reason}</p>

                {typeof study.move_number === "number" && study.game_id ? (
                  <p className="studies-card-origin">
                    move {study.move_number} · game {study.game_id}
                  </p>
                ) : null}

                <div className="studies-card-actions">
                  <Link className="btn btn-sm studies-card-primary" href={openHref(study)}>
                    Open Study ➔
                  </Link>
                  {study.source_url ? (
                    <a
                      className="studies-card-link"
                      href={study.source_url}
                      target="_blank"
                      rel="noopener"
                    >
                      Lichess Study ↗
                    </a>
                  ) : null}
                  {session.isCoach ? (
                    <ShareMenu
                      kind="study"
                      itemKey={study.id}
                      title={study.title}
                      subtitle={study.reason}
                      url={study.source_url}
                      token={session.token}
                      students={coachOptions}
                      defaultStudentId={studentId || null}
                      label="Share with student"
                    />
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function StudiesEmpty({ signedIn }: { signedIn: boolean }) {
  return (
    <Card surface="empty" pad="lg" className="studies-empty">
      <span className="studies-empty-glyph" aria-hidden="true">
        ♟
      </span>
      <h2 className="studies-empty-title">
        Analyze 3+ games to unlock personalized studies
      </h2>
      <p className="studies-empty-body">
        {signedIn
          ? "Your curriculum is built from the tactical leaks in your own games — a game has to be analysed before a study can be assigned to it."
          : "Curated studies are generated from a player's own analysed games. Sign in, analyse three or more games, and this page fills with the exact motifs that cost you points."}
      </p>
      <div className="studies-empty-actions">
        <Link className="btn btn-sm studies-card-primary" href="/">
          Analyze a game ➔
        </Link>
        <Link className="studies-card-link" href="/sample-report">
          See a sample report
        </Link>
      </div>
      <p className="studies-empty-foot">
        Meanwhile, the{" "}
        <Link href="/tactics">tactical training directory</Link> covers every
        motif the analyzer can name.
      </p>
    </Card>
  );
}
