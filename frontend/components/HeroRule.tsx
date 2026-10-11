import { ChevronDownIcon, TargetIcon } from "./ReportIcons";
import type { NextGameRule } from "./reportParsing";

type HeroRuleProps = {
  rule: NextGameRule | null;
  /** Report is still streaming and the rule may still arrive. */
  pending?: boolean;
  /** Anchor to the drill section, or null when the report has no drills. */
  drillAnchor?: string | null;
};

/**
 * The single most important element on the report: one rule for the next game.
 *
 * It deliberately inverts the cream report surface with a deep ink panel,
 * making it the highest-contrast object on screen so the eye lands here first.
 */
export default function HeroRule({
  rule,
  pending = false,
  drillAnchor = null,
}: HeroRuleProps) {
  if (!rule) {
    if (!pending) {
      return null;
    }
    return (
      <aside className="hero-rule hero-rule-loading" aria-hidden="true">
        <span className="hero-rule-mark">
          <TargetIcon className="hero-rule-icon" />
        </span>
        <div className="hero-rule-body">
          <span className="hero-rule-kicker">Next game rule</span>
          <span className="hero-rule-ghost hero-rule-ghost-wide" />
          <span className="hero-rule-ghost hero-rule-ghost-narrow" />
        </div>
      </aside>
    );
  }

  return (
    <aside className="hero-rule" aria-labelledby="hero-rule-heading">
      <span className="hero-rule-mark" aria-hidden="true">
        <TargetIcon className="hero-rule-icon" />
      </span>
      <div className="hero-rule-body">
        <h2 className="hero-rule-kicker" id="hero-rule-heading">
          Next game rule
        </h2>
        <p className="hero-rule-text" key={rule.rule}>
          {rule.rule}
        </p>
        <div className="hero-rule-foot">
          <span className="hero-rule-source">{rule.sourceLabel}</span>
          {drillAnchor && (
            <a className="hero-rule-cta" href={`#${drillAnchor}`}>
              Practise this now
              <ChevronDownIcon className="hero-rule-cta-icon" />
            </a>
          )}
        </div>
      </div>
    </aside>
  );
}
