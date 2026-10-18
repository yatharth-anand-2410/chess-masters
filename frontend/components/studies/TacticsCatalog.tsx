"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  apiGet,
  type LibraryStudy,
  type StudyGroup,
  type StudyLibrary,
  type TacticsCatalog,
} from "../../lib/api";
import AuthButton from "../AuthButton";
import ShareMenu from "./ShareMenu";
import { useStudySession } from "./useStudySession";

/**
 * The study library on `/tactics` — the page's live section.
 *
 * It is the coach's own Lichess studies (`GET /api/tactics` → `library`),
 * filterable by theme, and it is private: signed-out visitors get nothing from
 * this component and read the page's own motif definitions instead. The server
 * never puts a library in a public payload, so there is nothing here to hide.
 */
export default function TacticsCatalog() {
  const session = useStudySession({ students: true });
  const [catalog, setCatalog] = useState<TacticsCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!session.ready) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    // Public: the catalog and a locked library preview come back without a
    // token, and a token swaps the preview for the caller's real library.
    apiGet<TacticsCatalog>("/api/tactics", session.token || undefined)
      .then((data) => {
        if (cancelled) {
          return;
        }
        setCatalog(data);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) {
          setCatalog(null);
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session.ready, session.token]);

  if (!session.ready) {
    return null;
  }

  if (loading) {
    return (
      <div className="studies-library-grid" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((key) => (
          <div className="studies-library-card studies-skeleton" key={key} />
        ))}
      </div>
    );
  }

  if (failed) {
    return (
      <p className="studies-inline-note">
        The study library is unavailable right now
        {session.signedIn ? " for your account" : ""}. Try again in a moment.
      </p>
    );
  }

  const library = catalog?.library;
  if (!library || library.total_studies === 0) {
    return session.signedIn && session.isCoach ? (
      <p className="studies-inline-note">
        No studies are listed for this deployment
        {library && !library.configured
          ? " — it has no Lichess token, so only public studies would be readable."
          : "."}{" "}
        Set <code>LICHESS_TOKEN</code> and <code>LICHESS_STUDY_OWNER</code>, then
        run <code>scripts/sync_study_library.py</code>.
      </p>
    ) : null;
  }

  return (
    <StudyLibrary
      library={library}
      preview={Boolean(library.preview)}
      shareToken={session.isCoach ? session.token : ""}
      students={session.students.map((student) => ({
        id: student.id,
        display_name: student.display_name,
      }))}
    />
  );
}

/**
 * The whole study library, filterable.
 *
 * This is the point of the library: every study the coach has filed, not just
 * the handful of motifs the analyzer happens to name. The filters are the
 * vocabulary — search by study name, narrow to one theme or coaching group,
 * and (on a free plan) hide the studies the plan has not unlocked.
 */
function StudyLibrary({
  library,
  preview,
  shareToken,
  students,
}: {
  library: StudyLibrary;
  /** True for the signed-out teaser: the catalogue shows, nothing opens. */
  preview: boolean;
  shareToken: string;
  students: Array<{ id: string; display_name: string }>;
}) {
  const studies = useMemo(() => library.studies ?? [], [library.studies]);
  const groups = library.groups ?? [];
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [onlyOpen, setOnlyOpen] = useState(false);

  const locked = studies.filter((study) => study.locked).length;
  const unlocked = studies.length - locked;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return studies.filter((study) => {
      if (group !== "all" && study.group !== group) {
        return false;
      }
      if (onlyOpen && study.locked) {
        return false;
      }
      if (needle) {
        const haystack = `${study.title} ${study.group_label}`.toLowerCase();
        if (!haystack.includes(needle)) {
          return false;
        }
      }
      return true;
    });
  }, [studies, query, group, onlyOpen]);

  const indexChecked = Boolean(library.index_checked);
  const activeGroup = groups.find((entry) => entry.key === group);
  const filtering = query.trim() !== "" || group !== "all" || onlyOpen;
  const groupByKey = useMemo(
    () => new Map(groups.map((entry) => [entry.key, entry])),
    [groups]
  );

  return (
    <section
      className="studies-catalog studies-library"
      aria-labelledby="library-title"
    >
      <div className="studies-section-head">
        <div>
          <h2 className="studies-section-title" id="library-title">
            The study library · {library.owner ?? "curated"} on Lichess
          </h2>
          <p className="studies-section-sub">
            {preview
              ? "Every study the coach has filed, read live from Lichess — sign in to open them and filter by the theme you are working on."
              : library.configured
                ? "Every study the coach has filed, read live from Lichess — filter by the theme you are working on."
                : "The library is listed from the curation file; the live Lichess index is not reachable from this deployment."}
          </p>
        </div>
        <span className="studies-count-pill">
          {library.total_studies} Studies · {groups.length} Themes
          {preview
            ? ` · ${unlocked} open to try`
            : locked > 0
              ? ` · ${unlocked} open on your plan`
              : ""}
        </span>
      </div>

      <div className="studies-library-filters" role="search">
        <label className="studies-library-search">
          <span className="sr-only">Search studies by name</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search studies…"
            aria-label="Search studies by name"
          />
        </label>

        <label className="studies-library-select">
          <span className="sr-only">Filter by theme</span>
          <select
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            aria-label="Filter by theme"
          >
            <option value="all">Every theme ({groups.length})</option>
            {groups.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label} ({entry.count})
                {entry.observed_count ? ` · yours ×${entry.observed_count}` : ""}
              </option>
            ))}
          </select>
        </label>

        {locked > 0 && (
          <label className="studies-library-toggle">
            <input
              type="checkbox"
              checked={onlyOpen}
              onChange={(event) => setOnlyOpen(event.target.checked)}
            />
            <span>Only what my plan opens</span>
          </label>
        )}

        <span className="studies-library-result" aria-live="polite">
          {filtered.length} {filtered.length === 1 ? "study" : "studies"}
          {filtering ? " match" : ""}
        </span>

        {filtering && (
          <button
            type="button"
            className="studies-btn-quiet studies-library-clear"
            onClick={() => {
              setQuery("");
              setGroup("all");
              setOnlyOpen(false);
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {preview ? (
        <div className="studies-library-unlock">
          <LockIcon />
          <div>
            <b className="studies-library-unlock-title">
              {unlocked > 0
                ? `${unlocked} of these ${studies.length} studies are open`
                : `${studies.length} studies, locked`}
            </b>
            <p className="studies-library-unlock-text">
              Read and drill {unlocked > 0 ? "those" : "them"} without an account.
              Sign in with Google to open the rest — a free account includes{" "}
              {library.free_limit}{" "}
              {library.free_limit === 1 ? "study" : "studies"} chosen from your
              own analysed games, and a paid plan opens the whole library.
            </p>
          </div>
          <AuthButton user={null} onAuthChange={() => undefined} />
        </div>
      ) : locked > 0 ? (
        <p className="studies-inline-note">
          Your plan opens {unlocked} of these {studies.length} studies. The rest
          unlock with a paid plan —{" "}
          <Link href="/subscription">see the plans</Link>.
        </p>
      ) : null}

      {activeGroup && (
        <div className="studies-library-active">
          <b className="studies-library-active-name">{activeGroup.label}</b>
          {activeGroup.description ? (
            <span className="studies-library-active-desc">
              {activeGroup.description}
            </span>
          ) : null}
          {activeGroup.training_url ? (
            <a
              className="studies-card-link"
              href={activeGroup.training_url}
              target="_blank"
              rel="noopener"
            >
              Lichess puzzle theme ↗
            </a>
          ) : (
            <span className="studies-library-active-note">
              A coaching theme from the library itself — Lichess has no puzzle
              theme with this name.
            </span>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="studies-inline-note">
          No study matches that filter.{" "}
          {onlyOpen && locked > 0
            ? "Try turning off “only what my plan opens” to see the rest of the library."
            : "Try a different word or theme."}
        </p>
      ) : (
        <div className="studies-library-grid">
          {filtered.map((study) => (
            <LibraryStudyCard
              key={study.id}
              study={study}
              group={groupByKey.get(study.group)}
              preview={preview}
              indexChecked={indexChecked}
              shareToken={shareToken}
              students={students}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * One study, described as fully as the payload allows.
 *
 * Everything here comes from the library response: the theme it teaches and
 * that theme's own one-line definition, how often the caller's games hit that
 * theme, whether it is a Lichess puzzle theme or a coaching-only group, and the
 * study's last-updated date. Chapter counts are deliberately absent — Lichess
 * does not report them without reading each study in full, and a guess would be
 * worse than no number.
 */
function LibraryStudyCard({
  study,
  group,
  preview,
  indexChecked,
  shareToken,
  students,
}: {
  study: LibraryStudy;
  group?: StudyGroup;
  preview: boolean;
  /** True when the payload actually consulted the Lichess index. */
  indexChecked: boolean;
  shareToken: string;
  students: Array<{ id: string; display_name: string }>;
}) {
  const openHref = `/study/${encodeURIComponent(study.id)}${
    study.group ? `?motif=${encodeURIComponent(study.group)}` : ""
  }`;
  const observed = group?.observed_count ?? 0;

  return (
    <article className={`studies-library-card${study.locked ? " is-locked" : ""}`}>
      <header className="studies-library-card-top">
        <b className="studies-library-card-title">{study.title}</b>
        {study.locked ? (
          <span
            className="studies-library-lock"
            title={preview ? "Sign in to open the library" : "Available with a paid plan"}
          >
            🔒
          </span>
        ) : observed > 0 ? (
          <span
            className="studies-observed-chip"
            title="This theme appears in your analyzed games"
          >
            yours ×{observed}
          </span>
        ) : null}
      </header>

      <p className="studies-library-card-meta">
        {study.group_label}
        {group
          ? group.kind === "lichess"
            ? " · Lichess puzzle theme"
            : group.kind === "unfiled"
              ? " · not filed yet"
              : " · coaching theme"
          : ""}
        {study.updated_at ? ` · updated ${formatDate(study.updated_at)}` : ""}
        {indexChecked && !study.indexed ? " · not in the live index" : ""}
      </p>

      {group?.description ? (
        <p className="studies-library-card-desc">{group.description}</p>
      ) : null}

      {group?.training_url ? (
        <a
          className="studies-tactic-chip-link studies-library-card-chip"
          href={group.training_url}
          target="_blank"
          rel="noopener"
        >
          Drill {group.label} on Lichess ↗
        </a>
      ) : group ? (
        <span className="studies-library-card-note">
          Lichess has no puzzle theme with this name — it is taught here and
          nowhere else.
        </span>
      ) : null}

      <div className="studies-card-actions">
        {study.locked ? (
          <Link className="btn btn-sm studies-card-primary" href="/subscription">
            {preview ? "Sign in to open ➔" : "Unlock with a plan ➔"}
          </Link>
        ) : (
          <Link className="btn btn-sm studies-card-primary" href={openHref}>
            Open study ➔
          </Link>
        )}
        <a
          className="studies-card-link"
          href={study.source_url}
          target="_blank"
          rel="noopener"
        >
          Lichess ↗
        </a>
        {shareToken && !study.locked ? (
          <ShareMenu
            kind="study"
            itemKey={study.id}
            title={study.title}
            subtitle={`${study.group_label} — from the study library`}
            url={study.source_url}
            token={shareToken}
            students={students}
            label="Assign"
          />
        ) : null}
      </div>
    </article>
  );
}


function LockIcon() {
  return (
    <svg
      className="studies-library-unlock-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="10.5" width="16" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <circle cx="12" cy="15.25" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** A Lichess timestamp (ms) as a short date; empty when it is unusable. */
function formatDate(epochMs: number): string {
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
