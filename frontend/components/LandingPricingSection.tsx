"use client";

import React from "react";
import Link from "next/link";
import { Check, Crown, Sparkles, Users, ShieldCheck, ArrowRight } from "lucide-react";
import { PRODUCT_FACTS } from "../lib/site";

type TierSpec = {
  id: "free" | "student" | "coach";
  name: string;
  badge?: string;
  price: string;
  cadence: string;
  description: string;
  highlighted?: boolean;
  ctaLabel: string;
  ctaHref: string;
  features: Array<{ bold?: string; text: string }>;
};

const TIERS: TierSpec[] = [
  {
    id: "free",
    name: "Starter",
    badge: "No Card Required",
    price: "₹0",
    cadence: "forever",
    description: "Try instant AI chess coaching on your recent games.",
    ctaLabel: "Analyze Free Above",
    ctaHref: "#top",
    features: [
      { bold: "1 instant guest analysis", text: "(no sign-in needed)" },
      { bold: "5 total free analyses", text: "after Google sign-in" },
      { bold: "5-Section Coaching Report", text: "(Strength, Weakness, Overview, Focus, Drills)" },
      { text: "Stockfish blunder & centipawn swing detection" },
      { text: "Lichess profile, Chess.com, PGN & FEN support" },
    ],
  },
  {
    id: "student",
    name: "Pro Student",
    badge: "Most Popular",
    price: `₹${PRODUCT_FACTS.proPriceInr}`,
    cadence: "/ month",
    description: "For club & tournament players (800–2200 Elo) serious about rating growth.",
    highlighted: true,
    ctaLabel: "Upgrade to Pro Student",
    ctaHref: "/subscription",
    features: [
      { bold: `${PRODUCT_FACTS.proAnalysesPerPeriod} AI coaching reports`, text: "per billing period" },
      { bold: "Batch analyze up to 20 games", text: "(Last 5, Last 10, Last 20 presets)" },
      { bold: "3-Pillar Student Progress", text: "& Recurring Leaks dashboard" },
      { bold: "Full 6-Dimension Psychology", text: "Radar (Tilt, Clock Panic, Style)" },
      { bold: "Interactive Mistake Replay", text: "Drills & Curated Lichess Studies" },
      { bold: "Opponent Scouting Dossiers", text: "(Opening Trie & Clock Leaks)" },
      { text: "Follow-up AI Coach Q&A on any move" },
    ],
  },
  {
    id: "coach",
    name: "Master Coach",
    badge: "For Trainers & Academies",
    price: "₹1,999",
    cadence: "/ month",
    description: "For FIDE instructors and academies managing multiple students.",
    ctaLabel: "Explore Master Coach",
    ctaHref: "/subscription",
    features: [
      { bold: "Everything in Pro Student", text: "included" },
      { bold: "Up to 25 linked student", text: "profiles & handle mappings" },
      { bold: "1-Click Student Attachment", text: "for single & multi-game batches" },
      { bold: "Shareable Read-Only Links", text: "for students & parents (no login needed)" },
      { bold: "Automated Blunder Homework", text: "& Lichess study chapter ingestion" },
      { text: "Priority 24/7 academy support" },
    ],
  },
];

export default function LandingPricingSection({
  currentPlan,
}: {
  currentPlan?: "free" | "paid" | null;
}) {
  return (
    <section
      id="pricing"
      className="landing-section"
      aria-labelledby="landing-pricing-title"
    >
      <div className="text-center w-full mb-8 px-2">
        <h2
          id="landing-pricing-title"
          className="text-2xl sm:text-4xl font-serif font-bold text-[var(--text)] tracking-tight m-0"
        >
          Built for Every Stage of Your Chess Journey
        </h2>
        <p className="text-sm sm:text-base text-[var(--text-muted)] mt-2 mb-0">
          Start free with 5 full game reports. Upgrade to Pro Student or Master Coach when
          you are ready for deep session batches, psychology telemetry, and student rosters.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
        {TIERS.map((tier) => {
          const isProActive = currentPlan === "paid" && tier.id === "student";
          return (
            <article
              key={tier.id}
              className={`relative rounded-2xl p-6 flex flex-col justify-between transition-all backdrop-blur-md ${
                tier.highlighted
                  ? "bg-[#0e161a]/96 border-2 border-[var(--gold)] shadow-[0_24px_48px_-24px_rgba(201,153,63,0.3)]"
                  : "bg-[#0c1317]/95 border border-[var(--line)] hover:border-[var(--line-strong)]"
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h3 className="text-lg font-serif font-bold text-[var(--text)] flex items-center gap-2">
                    {tier.id === "coach" && <Users size={16} className="text-[var(--gold-bright)]" />}
                    {tier.id === "student" && <Sparkles size={16} className="text-[var(--gold-bright)]" />}
                    <span>{tier.name}</span>
                  </h3>
                  {tier.badge && (
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold ${
                        tier.highlighted
                          ? "bg-[var(--gold)] text-[#141712]"
                          : "bg-[var(--ink-3)] text-[var(--text-muted)] border border-[var(--line)]"
                      }`}
                    >
                      {tier.badge}
                    </span>
                  )}
                </div>

                <p className="text-xs text-[var(--text-muted)] min-h-[2.25rem] m-0">
                  {tier.description}
                </p>

                <div className="my-5 pb-5 border-b border-[var(--line-soft)] flex items-baseline gap-1.5">
                  <span className="text-3xl sm:text-4xl font-serif font-bold text-[var(--text)]">
                    {tier.price}
                  </span>
                  <span className="text-xs font-mono text-[var(--text-muted)]">
                    {tier.cadence}
                  </span>
                </div>

                <ul className="space-y-2.5 text-xs sm:text-sm text-[var(--text)] list-none p-0 m-0">
                  {tier.features.map((feat, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className="w-4 h-4 rounded-full bg-[var(--gold)]/20 text-[var(--gold-bright)] flex items-center justify-center shrink-0 mt-0.5">
                        <Check size={11} strokeWidth={3} />
                      </span>
                      <span className="text-[var(--text-muted)] leading-snug">
                        {feat.bold && (
                          <strong className="text-[var(--text)] font-semibold">
                            {feat.bold}{" "}
                          </strong>
                        )}
                        {feat.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-6 pt-4">
                {isProActive ? (
                  <Link
                    href="/subscription"
                    className="w-full py-2.5 px-4 rounded-[var(--radius-control)] bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 font-semibold text-xs flex items-center justify-center gap-1.5"
                  >
                    <Check size={14} />
                    <span>Active Plan · Manage Billing</span>
                  </Link>
                ) : (
                  <Link
                    href={tier.ctaHref}
                    className={`w-full py-2.5 px-4 rounded-[var(--radius-control)] font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                      tier.highlighted
                        ? "bg-[var(--gold)] hover:bg-[var(--gold-bright)] text-[#141712] shadow-md"
                        : "bg-[var(--ink-3)] hover:bg-[var(--ink-4)] text-[var(--text)] border border-[var(--line)] hover:border-[var(--gold)]/50"
                    }`}
                  >
                    <span>{tier.ctaLabel}</span>
                    <ArrowRight size={13} />
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck size={14} className="text-[var(--gold-bright)]" />
          14-day money-back guarantee
        </span>
        <span>·</span>
        <span>Secure recurring checkout via Razorpay</span>
        <span>·</span>
        <span>Pause or cancel anytime in 1 click</span>
      </div>
    </section>
  );
}
