"use client";

import Link from "next/link";
import type { PracticePlanItem } from "../../lib/api";

type PracticePlanProps = {
  plan: PracticePlanItem[] | undefined;
  /** Shown in the heading, e.g. "your" or "Aarav's". */
  playerName?: string;
  insufficient?: boolean;
  gamesUsed?: number;
};

/**
 * The practical half of the progress report: what to do next.
 *
 * The panels above explain *why* the rating moved; this section answers the
 * question a player actually asks — "so what do I practise?". Every row is a
 * leak the report already counted, joined with the studies the coach wrote for
 * it, so the first row is the one worth their next hour. A leak the library has
 * not covered yet keeps its Lichess drill link and says so, which tells the
 * coach what to write next instead of hiding the gap.
 */
export default function PracticePlan({
  plan,
  playerName,
  insufficient,
  gamesUsed,
}: PracticePlanProps) {
  const items = plan ?? [];
  const possessive = playerName ? `${playerName}'s` : "your";

  return (
    <section className="progress-practice" aria-labelledby="practice-plan-title">
      <div className="progress-practice-head">
        <div>
          <h2 className="progress-practice-title" id="practice-plan-title">
            Practice plan
          </h2>
          <p className="progress-practice-sub">
            The leaks this report measured, each paired with the study that
            answers it — {possessive} own library, not a generic course.
          </p>
        </div>
        {items.length > 0 && (
          <span className="progress-practice-pill">
            {items.length} {items.length === 1 ? "theme" : "themes"} to work on
          </span>
        )}
      </div>

      {insufficient ? (
        <p className="progress-practice-note">
          The plan builds once {gamesUsed != null ? gamesUsed : "enough"} more
          games are analysed — it is derived from leaks this report measured,
          and there is not enough telemetry yet to rank them.
        </p>
      ) : items.length === 0 ? (
        <p className="progress-practice-note">
          No recurring leaks were found in these games, so there is nothing to
          prescribe yet. Analyse more games and this fills in.
        </p>
      ) : (
        <ol className="progress-practice-list">
          {items.map((item, index) => (
            <PracticeRow key={item.theme} item={item} rank={index + 1} />
          ))}
        </ol>
      )}
    </section>
  );
}

function PracticeRow({ item, rank }: { item: PracticePlanItem; rank: number }) {
  const errors = item.observed_count;
  const covered = item.study_count > 0;

  return (
    <li
      className={`progress-practice-row${covered ? "" : " is-uncovered"}`}
    >
      <span className="progress-practice-rank" aria-hidden="true">
        {String(rank).padStart(2, "0")}
      </span>

      <div className="progress-practice-body">
        <div className="progress-practice-row-head">
          <b className="progress-practice-name">{item.label}</b>
          <span className="progress-practice-count">
            {errors} {errors === 1 ? "error" : "errors"} in these games
          </span>
        </div>

        {item.description ? (
          <p className="progress-practice-desc">{item.description}</p>
        ) : null}

        {covered ? (
          <div className="progress-practice-studies">
            {item.studies.map((study) =>
              study.locked ? (
                <span
                  key={study.id}
                  className="progress-practice-study is-locked"
                  title="Available with a paid plan"
                >
                  🔒 {study.title}
                </span>
              ) : (
                <Link
                  key={study.id}
                  className="progress-practice-study"
                  href={`/study/${encodeURIComponent(study.id)}?motif=${encodeURIComponent(item.theme)}`}
                >
                  {study.title} ➔
                </Link>
              )
            )}
            {item.study_count > item.studies.length ? (
              <Link className="progress-practice-more" href="/tactics">
                +{item.study_count - item.studies.length} more in the library
              </Link>
            ) : null}
          </div>
        ) : (
          <p className="progress-practice-gap">
            The library has no study for this yet
            {item.training_url ? (
              <>
                {" — "}
                <a
                  className="studies-card-link"
                  href={item.training_url}
                  target="_blank"
                  rel="noopener"
                >
                  drill {item.label} on Lichess ↗
                </a>
              </>
            ) : (
              "."
            )}
          </p>
        )}
      </div>
    </li>
  );
}
