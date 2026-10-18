"use client";

import { useEffect, useState } from "react";
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
    <section className="studies-catalog" aria-labelledby="tactics-catalog-title">
      <div className="studies-section-head">
        <div>
          <h2 className="studies-section-title" id="tactics-catalog-title">
            Tactical training curriculum · thematic directory
          </h2>
          <p className="studies-section-sub">
            Every motif the analyzer can name in your games, each linked to its
            Lichess puzzle theme.
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

      {hasLibrary && library && <StudyLibraryBlock library={library} />}
    </section>
  );
}

/**
 * The coach's own curated studies, grouped by what they teach.
 *
 * This is the tactics half of the library: every study the coach has filed
 * against a motif or one of their own groups, with the locked ones shown as
 * locked rather than hidden — a free account should see what the library
 * holds, and exactly what its tier opens.
 */
function StudyLibraryBlock({ library }: { library: StudyLibrary }) {
  const studies = library.studies ?? [];
  const groups = library.groups ?? [];
  const [openGroup, setOpenGroup] = useState<string>("");

  if (studies.length === 0) {
    return null;
  }

  const unlocked = studies.filter((study) => !study.locked).length;
  const locked = studies.length - unlocked;
  const byGroup = new Map<string, LibraryStudy[]>();
  for (const study of studies) {
    const list = byGroup.get(study.group);
    if (list) {
      list.push(study);
    } else {
      byGroup.set(study.group, [study]);
    }
  }

  const activeGroup: StudyGroup | undefined =
    groups.find((group) => group.key === openGroup) ?? groups[0];
  const activeStudies = activeGroup ? byGroup.get(activeGroup.key) ?? [] : [];

  return (
    <section className="studies-catalog studies-library" aria-labelledby="library-title">
      <div className="studies-section-head">
        <div>
          <h2 className="studies-section-title" id="library-title">
            The study library · {library.owner ?? "curated"} on Lichess
          </h2>
          <p className="studies-section-sub">
            {library.configured
              ? "Every study filed against a motif or a coaching theme, read live from Lichess."
              : "The library is listed from the curation file; the live Lichess index is not reachable from this deployment."}
          </p>
        </div>
        <span className="studies-count-pill">
          {library.total_studies} Studies · {groups.length} Themes
          {locked > 0 ? ` · ${unlocked} open on your plan` : ""}
        </span>
      </div>

      {locked > 0 && (
        <p className="studies-inline-note">
          Your plan opens {unlocked} of these {studies.length} studies. The rest
          unlock with a paid plan —{" "}
          <Link href="/subscription">see the plans</Link>.
        </p>
      )}

      {groups.length > 0 && (
        <div className="studies-library-chips">
          {groups.map((group) => (
            <button
              key={group.key}
              type="button"
              className={`studies-library-chip${
                activeGroup?.key === group.key ? " is-active" : ""
              }`}
              onClick={() => setOpenGroup(group.key)}
            >
              {group.label}
              <span className="studies-library-chip-count">{group.count}</span>
              {typeof group.observed_count === "number" && group.observed_count > 0 && (
                <span className="studies-observed-chip">
                  yours ×{group.observed_count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {activeGroup && (
        <>
          {activeGroup.description ? (
            <p className="studies-library-desc">{activeGroup.description}</p>
          ) : null}
          <div className="studies-library-grid">
            {activeStudies.map((study) => (
              <LibraryStudyCard key={study.id} study={study} />
            ))}
          </div>
          {activeGroup.training_url ? (
            <p className="studies-library-note">
              Matches the Lichess puzzle theme{" "}
              <a
                className="studies-card-link"
                href={activeGroup.training_url}
                target="_blank"
                rel="noopener"
              >
                {activeGroup.label} ↗
              </a>
            </p>
          ) : (
            <p className="studies-library-note">
              A coaching theme from the library itself — Lichess has no puzzle
              theme with this name.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function LibraryStudyCard({ study }: { study: LibraryStudy }) {
  const openHref = `/study/${encodeURIComponent(study.id)}${
    study.group ? `?motif=${encodeURIComponent(study.group)}` : ""
  }`;

  return (
    <article
      className={`studies-library-card${study.locked ? " is-locked" : ""}`}
    >
      <header className="studies-library-card-top">
        <b className="studies-library-card-title">{study.title}</b>
        {study.locked ? (
          <span className="studies-library-lock" title="Available with a paid plan">
            🔒
          </span>
        ) : null}
      </header>
      <p className="studies-library-card-meta">
        {study.group_label}
        {study.updated_at ? ` · updated ${formatDate(study.updated_at)}` : ""}
        {study.indexed ? "" : " · not in the live index"}
      </p>
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
