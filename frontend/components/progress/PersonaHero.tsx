import React from "react";
import { ExternalLink } from "lucide-react";
import type { ProgressReport } from "../../lib/api";
import {
  accountChipModel,
  asArray,
  formatNumber,
  formatSigned,
  initialsFromName,
  pluralize,
} from "./progressUtils";

type Props = {
  report: ProgressReport;
  /** Fallback label when the backend does not echo a name (coach profile name). */
  fallbackName?: string | null;
};

/**
 * Persona hero: name, archetype, tracked platform accounts, rating evolution
 * and the honest game counts behind every number on the page.
 */
export default function PersonaHero({ report, fallbackName }: Props) {
  const persona = report.persona ?? ({} as ProgressReport["persona"]);
  const identity = report.identity;
  const elo = report.elo;

  const name = (report.student_name || fallbackName || "Player").trim();
  const accounts = asArray(identity?.accounts).map((account, index) =>
    accountChipModel(account, index)
  );
  const gamesUsed = typeof report.games_used === "number" ? report.games_used : identity?.filtered_games ?? 0;
  const totalGames = typeof identity?.total_games === "number" ? identity.total_games : gamesUsed;
  const netGain = typeof elo?.net_gain === "number" ? elo.net_gain : null;
  const hasRating = typeof elo?.current === "number" && elo.current > 0;

  return (
    <section className="progress-hero" aria-label="Player persona">
      <div className="progress-hero-left">
        <div className="progress-hero-avatar" aria-hidden="true">
          {initialsFromName(name)}
        </div>
        <div className="progress-hero-id">
          <div className="progress-hero-name-row">
            <h2 className="progress-hero-name">{name}</h2>
            {persona.archetype ? (
              <span className="progress-pill progress-pill-gold">{persona.archetype}</span>
            ) : null}
            {persona.strength_badge ? (
              <span className="progress-pill progress-pill-green">✓ {persona.strength_badge}</span>
            ) : null}
            {persona.vulnerability_badge ? (
              <span className="progress-pill progress-pill-red">⚠ {persona.vulnerability_badge}</span>
            ) : null}
          </div>

          {persona.next_milestone ? (
            <div className="progress-hero-milestone">
              Next milestone: <b>{persona.next_milestone}</b>
            </div>
          ) : null}

          {persona.summary_verdict ? (
            <p className="progress-hero-verdict">&ldquo;{persona.summary_verdict}&rdquo;</p>
          ) : null}

          {accounts.length > 0 ? (
            <div className="progress-accounts" aria-label="Tracked accounts">
              <span className="progress-accounts-label">Tracked accounts</span>
              {accounts.map((account) => {
                const title =
                  account.games !== null
                    ? `${account.games} ${pluralize(account.games, "analyzed game")}`
                    : "Analyzed account";
                const body = (
                  <>
                    <span className="progress-account-platform">{account.platformLabel}</span>
                    <span className="progress-account-handle">{account.handle}</span>
                    {account.rating !== null ? (
                      <span className="progress-account-rating">{formatNumber(account.rating, 0)}</span>
                    ) : null}
                    {account.url ? (
                      <ExternalLink size={11} className="progress-account-ext" aria-hidden="true" />
                    ) : null}
                  </>
                );
                return account.url ? (
                  <a
                    key={account.key}
                    className={`progress-account-chip is-${account.tone}`}
                    href={account.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${title} · opens ${account.platformLabel} profile`}
                  >
                    {body}
                  </a>
                ) : (
                  <span
                    key={account.key}
                    className={`progress-account-chip is-${account.tone}`}
                    title={title}
                  >
                    {body}
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div className="progress-hero-right">
        <span className="progress-hero-eyebrow">RATING EVOLUTION</span>
        {hasRating ? (
          <div className="progress-hero-rating">
            <span className="progress-hero-rating-value">{formatNumber(elo.current, 0)}</span>
            {netGain !== null && netGain !== 0 ? (
              <span className={`progress-hero-rating-delta ${netGain > 0 ? "is-up" : "is-down"}`}>
                {formatSigned(netGain, 0)} Elo
              </span>
            ) : null}
          </div>
        ) : (
          <div className="progress-hero-rating is-empty">No rated games yet</div>
        )}
        <div className="progress-hero-games">
          {gamesUsed > 0
            ? `From ${gamesUsed} ${pluralize(gamesUsed, "analyzed game")} in this window`
            : "No games match the current filter"}
        </div>
        {totalGames > gamesUsed ? (
          <div className="progress-hero-games is-muted">
            {totalGames} {pluralize(totalGames, "game")} tracked all-time
          </div>
        ) : null}
        {elo?.status ? <div className="progress-hero-status">{elo.status}</div> : null}
      </div>
    </section>
  );
}
