import React from "react";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { asArray } from "./progressUtils";

type Props = {
  rules: string[] | null | undefined;
  playerName?: string | null;
};

/** Focus rules (the "next game" rules) plus the closing footer CTA. */
export default function FocusRules({ rules, playerName }: Props) {
  const list = asArray(rules);

  return (
    <section className="progress-card progress-focus-card" aria-label="Focus rules and next steps">
      <div className="progress-section-head">
        <div>
          <h2 className="progress-section-title">Focus Rules for the Next Game</h2>
          <p className="progress-section-sub">
            {list.length > 0
              ? `Apply these while playing${playerName ? ` — ${playerName}` : ""}`
              : "Rules appear once enough games are analyzed"}
          </p>
        </div>
        <Sparkles size={18} className="progress-focus-icon" aria-hidden="true" />
      </div>

      {list.length > 0 ? (
        <ol className="progress-focus-list">
          {list.map((rule, index) => (
            <li className="progress-focus-item" key={`${index}-${rule.slice(0, 24)}`}>
              <span className="progress-focus-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="progress-focus-text">{rule}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="progress-inline-note">
          Analyze 4+ games to unlock this panel — focus rules are derived from your real leaks.
        </p>
      )}

      <div className="progress-footer-cta">
        <div>
          <div className="progress-footer-title">Keep the loop going</div>
          <p className="progress-footer-sub">
            Analyze the next game and this dashboard updates from your newest results.
          </p>
        </div>
        <div className="progress-footer-actions">
          <Link className="progress-cta-button is-primary" href="/">
            Analyze another game
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
          <Link className="progress-cta-button" href="/studies">
            Open curated studies
          </Link>
        </div>
      </div>
    </section>
  );
}
