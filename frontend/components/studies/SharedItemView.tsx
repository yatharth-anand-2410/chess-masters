"use client";

import type { SharedItemPayload } from "../../lib/api";
import { Pill } from "../ui/Pill";
import { circleLabels } from "./studyTypes";

export type SharedItemViewProps = {
  payload: SharedItemPayload;
  /** Rendered under the Lichess button (portal adds its own footnote). */
  footer?: React.ReactNode;
};

const KIND_LABEL: Record<SharedItemPayload["kind"], string> = {
  study: "Shared study",
  tactic: "Shared tactic",
  student: "Shared student",
};

/**
 * Read-only renderer for `SharedItemPayload` (kind = study | tactic).
 *
 * Only what the coach's share carries is shown: title, subtitle, the Lichess
 * destination, chapter/line lists and the view counter. Chapter notes come from
 * the payload verbatim — when a chapter has none, the move line stands in, so
 * nothing on this page can look like an invented coach note.
 */
export default function SharedItemView({ payload, footer }: SharedItemViewProps) {
  const chapters = Array.isArray(payload.chapters) ? payload.chapters : [];
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  const circles = circleLabels(payload.circles);
  const views = typeof payload.view_count === "number" ? payload.view_count : null;

  return (
    <article className="studies-shared-item">
      <header className="studies-shared-head">
        <div className="studies-shared-tags">
          <Pill tone="shell" size="sm">
            {KIND_LABEL[payload.kind] ?? "Shared item"}
          </Pill>
          {views !== null && (
            <span className="studies-shared-views">
              {views} {views === 1 ? "view" : "views"}
            </span>
          )}
        </div>

        <h1 className="studies-shared-title">{payload.title ?? "Shared item"}</h1>
        {payload.subtitle ? (
          <p className="studies-shared-sub">{payload.subtitle}</p>
        ) : null}

        {payload.url ? (
          <div className="studies-shared-actions">
            <a
              className="btn btn-sm studies-card-primary"
              href={payload.url}
              target="_blank"
              rel="noopener"
            >
              Practice on Lichess ↗
            </a>
          </div>
        ) : null}
      </header>

      {circles.length > 0 && (
        <p className="studies-shared-circles">
          <span className="studies-shared-label">Board markers</span>
          {circles.map((circle) => (
            <code key={circle}>{circle}</code>
          ))}
        </p>
      )}

      {chapters.length > 0 && (
        <section className="studies-shared-section" aria-labelledby="shared-chapters">
          <h2 className="studies-shared-h2" id="shared-chapters">
            Chapters
            <span className="studies-shared-count">{chapters.length}</span>
          </h2>
          <ol className="studies-shared-list">
            {chapters.map((chapter, index) => (
              <li className="studies-shared-chapter" key={`${chapter.title}-${index}`}>
                <span className="studies-shared-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <b className="studies-shared-chapter-title">{chapter.title}</b>
                  {chapter.moves ? (
                    <p className="studies-shared-moves">{chapter.moves}</p>
                  ) : null}
                  {chapter.coach_note ? (
                    <p className="studies-shared-note">{chapter.coach_note}</p>
                  ) : !chapter.moves ? (
                    <p className="studies-shared-note studies-shared-note-muted">
                      No annotation was shared for this chapter.
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {lines.length > 0 && (
        <section className="studies-shared-section" aria-labelledby="shared-lines">
          <h2 className="studies-shared-h2" id="shared-lines">
            Lines
            <span className="studies-shared-count">{lines.length}</span>
          </h2>
          <ol className="studies-shared-list">
            {lines.map((line, index) => (
              <li className="studies-shared-line" key={`${line.moves}-${index}`}>
                <p className="studies-shared-moves">{line.moves}</p>
                {line.coach_commentary ? (
                  <p className="studies-shared-note">{line.coach_commentary}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      )}

      {chapters.length === 0 && lines.length === 0 && (
        <p className="studies-shared-note studies-shared-note-muted">
          {payload.kind === "tactic"
            ? "Drill this motif on Lichess — the link above opens the matching puzzle theme."
            : "This share carries no chapter list, only the study link above."}
        </p>
      )}

      {footer}
    </article>
  );
}
