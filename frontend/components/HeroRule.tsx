"use client";

import React from "react";
import type { NextGameRule } from "./reportParsing";

type HeroRuleProps = {
  rule: NextGameRule | null;
  /** Report is still streaming and the rule may still arrive. */
  pending?: boolean;
  /** Anchor to the drill section, or null when the report has no drills. */
  drillAnchor?: string | null;
  /**
   * The concrete "why" paragraph behind the rule, assembled from the top
   * weakness moment. Omitted when the evidence is too thin.
   */
  why?: string | null;
};

/**
 * "Core Actionable Takeaway · The Next Game Rule" — the showcase's hero wedge.
 * A paper panel lifted by an accent rule on the left, carrying the one rule the
 * player should run in their next game plus the evidence it came from.
 */
export default function HeroRule({
  rule,
  pending = false,
  drillAnchor = null,
  why = null,
}: HeroRuleProps) {
  if (!rule) {
    if (!pending) {
      return null;
    }
    return (
      <section
        className="review-hero-wedge is-loading"
        aria-hidden="true"
      >
        <span className="review-hero-kicker">
          Core Actionable Takeaway · The Next Game Rule
        </span>
        <span className="review-hero-ghost is-wide" />
        <span className="review-hero-ghost is-narrow" />
      </section>
    );
  }

  return (
    <section className="review-hero-wedge" aria-labelledby="hero-rule-heading">
      <span className="review-hero-kicker">
        Core Actionable Takeaway · The Next Game Rule
      </span>
      <h2 className="review-hero-title" id="hero-rule-heading">
        &ldquo;{rule.rule}&rdquo;
      </h2>
      {why && <p className="review-hero-why">{why}</p>}
      <div className="review-hero-foot">
        <span className="review-hero-source">{rule.sourceLabel}</span>
        {drillAnchor && (
          <a className="review-hero-cta" href={`#${drillAnchor}`}>
            Practise this now ↓
          </a>
        )}
      </div>
    </section>
  );
}
