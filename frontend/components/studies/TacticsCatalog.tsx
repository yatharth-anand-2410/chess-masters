"use client";

import { useEffect, useState } from "react";
import { apiGet, type TacticsCatalog, type TacticTheme } from "../../lib/api";
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
    </section>
  );
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
