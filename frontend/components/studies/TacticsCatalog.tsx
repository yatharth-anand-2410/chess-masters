"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  apiGet,
  type LibraryStudy,
  type StudyGroup,
  type StudyLibrary,
  type TacticsCatalog,
  type TacticTheme,
} from "../../lib/api";
import ShareMenu from "./ShareMenu";
import { useStudySession } from "./useStudySession";

/**
 * The live tactical catalog (`GET /api/tactics`).
 *
 * Renders exactly what the product ships — every theme from
 * `backend/data/puzzle_catalog.json` and every Lichess link it carries — with
 * the primary drill as a gold button and the remaining theme links as compact
 * mono links, so a theme's full link set is reachable without inventing any.
 *
 * Signed-out visitors get the same catalog without the `observed_count` chip
 * (the server only computes it for a user's own games) and without sharing.
 * A signed-in caller also gets the coach's study library, which is private and
 * therefore never part of the public payload.
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

  const themes = catalog?.themes ?? [];
  const totalLinks =
    catalog?.total_links ??
    themes.reduce((sum, theme) => sum + (theme.links?.length ?? 0), 0);
  const library = catalog?.library;
  const hasLibrary = Boolean(library && library.total_studies > 0);

  return (
    <>
      {hasLibrary && library && <StudyLibrary library={library} />}

      <section className="studies-catalog" aria-labelledby="tactics-catalog-title">
        <div className="studies-section-head">
          <div>
            <h2 className="studies-section-title" id="tactics-catalog-title">
              {hasLibrary
                ? "The motifs the analyzer names in your games"
                : "Tactical training curriculum · thematic directory"}
            </h2>
            <p className="studies-section-sub">
              {hasLibrary
                ? "The patterns the engine can name, each linked to its Lichess puzzle theme — the vocabulary the study library above is filed against."
                : "Every motif the analyzer can name in your games, each linked to its Lichess puzzle theme."}
            </p>
          </div>
          {themes.length > 0 && catalog && (
            <span className="studies-count-pill">
              {themes.length} Core Motifs · {totalLinks} Lichess drills
            </span>
          )}
        </div>

        {loading && (
          <div className="studies-tactics-grid" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((key) => (
              <div className="studies-tactic-card studies-skeleton" key={key} />
            ))}
          </div>
        )}

        {!loading && failed && (
          <p className="studies-inline-note">
            The live drill catalog is unavailable right now — the motif directory
            below still covers the core patterns.
          </p>
        )}

        {!loading && !failed && themes.length === 0 && (
          <p className="studies-inline-note">
            No training themes are configured yet. Browse the Lichess puzzle
            themes directory in the meantime.
          </p>
        )}

        {themes.length > 0 && (
          <div className="studies-tactics-grid">
            {themes.map((theme) => (
              <TacticCard
                key={theme.key}
                theme={theme}
                shareToken={session.isCoach ? session.token : ""}
                students={session.students.map((student) => ({
                  id: student.id,
                  display_name: student.display_name,
                }))}
              />
            ))}
          </div>
        )}
      </section>
    </>
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
function StudyLibrary({ library }: { library: StudyLibrary }) {
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
            {library.configured
              ? "Every study the coach has filed, read live from Lichess — filter by the theme you are working on."
              : "The library is listed from the curation file; the live Lichess index is not reachable from this deployment."}
          </p>
        </div>
        <span className="studies-count-pill">
          {library.total_studies} Studies · {groups.length} Themes
          {locked > 0 ? ` · ${unlocked} open on your plan` : ""}
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

      {locked > 0 && (
        <p className="studies-inline-note">
          Your plan opens {unlocked} of these {studies.length} studies. The rest
          unlock with a paid plan —{" "}
          <Link href="/subscription">see the plans</Link>.
        </p>
      )}

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
}: {
  study: LibraryStudy;
  group?: StudyGroup;
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
          <span className="studies-library-lock" title="Available with a paid plan">
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
        {study.indexed ? "" : " · not in the live index"}
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
            Unlock with a plan ➔
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
      </div>
    </article>
  );
}

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

function TacticCard({
  theme,
  shareToken,
  students,
}: {
  theme: TacticTheme;
  shareToken: string;
  students: Array<{ id: string; display_name: string }>;
}) {
  const links = theme.links ?? [];
  const primary = links[0];
  const secondary = links.slice(1);
  const observed = theme.observed_count ?? 0;
  const study = theme.study;
  // `label` is authoritative; the key is a truthful fallback when a backend
  // build predates the label field ("hangingPiece" → "Hanging Piece").
  const label = theme.label || humaniseTheme(theme.key);
  const aliases = (theme.motif_aliases ?? [])
    .filter((alias) => alias && alias !== theme.key)
    .slice(0, 3);

  return (
    <article className="studies-tactic-card">
      <header className="studies-tactic-top">
        <b className="studies-tactic-name">{label}</b>
        {observed > 0 && (
          <span className="studies-observed-chip" title="Motif found in your analyzed games">
            observed in your games ×{observed}
          </span>
        )}
      </header>

      {theme.description ? (
        <p className="studies-tactic-desc">{theme.description}</p>
      ) : null}

      {aliases.length > 0 && (
        <p className="studies-tactic-aliases">
          detected as{" "}
          {aliases.map((alias, index) => (
            <span key={alias}>
              {index > 0 && ", "}
              <code>{alias}</code>
            </span>
          ))}
        </p>
      )}

      {study ? (
        <p className="studies-tactic-study">
          <span className="studies-tactic-study-label">
            {study.locked ? "🔒 Library study" : "Library study"}
          </span>{" "}
          {study.locked ? (
            study.title
          ) : (
            <Link
              className="studies-tactic-study-link"
              href={`/study/${encodeURIComponent(study.id)}?motif=${encodeURIComponent(theme.key)}`}
            >
              {study.title} ➔
            </Link>
          )}
        </p>
      ) : null}

      <div className="studies-tactic-links">
        {secondary.length > 0 && (
          <span className="studies-tactic-links-label">Also trains</span>
        )}
        {secondary.map((link) => (
          <a
            key={`${link.theme}-${link.url}`}
            className="studies-tactic-chip-link"
            href={link.url}
            target="_blank"
            rel="noopener"
          >
            {humaniseTheme(link.theme)} ↗
          </a>
        ))}
      </div>

      <div className="studies-card-actions">
        {primary ? (
          <a
            className="btn btn-sm studies-card-primary"
            href={primary.url}
            target="_blank"
            rel="noopener"
          >
            Practice on Lichess ➔
          </a>
        ) : null}
        {shareToken ? (
          <ShareMenu
            kind="tactic"
            itemKey={theme.key}
            title={label}
            subtitle={theme.description}
            url={primary?.url ?? null}
            token={shareToken}
            students={students}
          />
        ) : null}
      </div>
    </article>
  );
}

/** `backRankMate` → `Back Rank Mate` — the catalog's Lichess slugs are camelCase. */
function humaniseTheme(theme: string): string {
  return theme
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
