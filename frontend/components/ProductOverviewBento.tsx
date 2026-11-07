"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Plus, Minus } from "lucide-react";
import { FAQS } from "../lib/faqs";
import { CONTENT_PUBLISHED, CONTENT_PUBLISHED_LABEL } from "../lib/site";
import { cn } from "../lib/utils";

const PILLARS = [
  {
    title: "Plain-English 5-Section Report",
    detail:
      "Stockfish evaluations translated into Strength, Weakness, Game Overview, Do / Don't Focus Rules, and Lichess drills.",
  },
  {
    title: "6-Dimension Chess Psychology",
    detail:
      "Unlocks after 3 games to measure clock panic under 30 seconds, tilt resistance, and advantage conversion.",
  },
  {
    title: "Multi-Game Session Batching",
    detail:
      "Import your Lichess or Chess.com profile and batch-analyze your last 5, 10, or 20 games to uncover recurring leaks.",
  },
];

export default function ProductOverviewBento() {
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  return (
    <section
      id="product-overview"
      className="homepage-about-panel landing-section"
      aria-labelledby="about-chessmasters-title"
    >
      {/* Minimalist Split Overview + 60s Video */}
      <div className="rounded-2xl bg-[#0a1014]/90 backdrop-blur-xl border border-[var(--line)] p-6 sm:p-9 shadow-2xl">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7">
            <h2
              id="about-chessmasters-title"
              className="text-2xl sm:text-3xl font-serif font-bold text-[var(--text)] tracking-tight m-0"
            >
              What is Chessmasters?
            </h2>
            <p className="homepage-about-lede text-sm sm:text-base text-[var(--text-muted)] leading-relaxed mt-3 mb-0">
              Paste a finished Chess.com or Lichess game. Stockfish finds the blunders, and you get a
              plain-English coaching report with Lichess drills for what to fix.
            </p>

            {/* Clean Typographic Pillars (No Nested Cards) */}
            <div className="mt-6 divide-y divide-[var(--line)] border-t border-b border-[var(--line)]">
              {PILLARS.map((pillar) => (
                <div key={pillar.title} className="py-3.5">
                  <h3 className="text-sm font-semibold text-[var(--text)] m-0">
                    {pillar.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-[var(--text-muted)] leading-relaxed mt-1 mb-0">
                    {pillar.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Right: 60s Walkthrough Video */}
          <div
            className="lg:col-span-5 explainer-video-panel flex flex-col gap-3"
            aria-labelledby="video-explainer-title"
          >
            <h3
              id="video-explainer-title"
              className="text-base font-serif font-semibold text-[var(--text)] m-0"
            >
              Watch the 60-second walkthrough
            </h3>
            <div className="explainer-video-container rounded-xl overflow-hidden border border-[var(--line)] bg-[#06090b] shadow-lg">
              <video
                controls
                preload="metadata"
                poster="/videos/chessmasters-explainer.poster.jpg"
                className="explainer-video-player w-full aspect-video object-cover"
              >
                <source src="/videos/chessmasters-explainer.mp4" type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            </div>
            <p className="text-xs text-[var(--text-muted)] m-0">
              Single-game reports, interactive drills, and psychology insights.
            </p>
            <p className="text-xs text-[var(--text-muted)] m-0">
              Coaching pedagogy by{" "}
              <Link
                href="/about"
                rel="author"
                className="text-[var(--gold-bright)] font-semibold hover:underline"
              >
                Parth Kaushik
              </Link>{" "}
              (FIDE AIM, 2300+ peak). Updated{" "}
              <time dateTime={CONTENT_PUBLISHED}>{CONTENT_PUBLISHED_LABEL}</time>.
            </p>
          </div>
        </div>
      </div>

      {/* Single-Column Hairline Accordion for Canonical FAQs (Zero Box Clutter, 100% SEO/GEO Preserved) */}
      <div className="w-full mt-16 px-2 sm:px-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4 border-b border-[var(--line)]">
          <h2 className="text-xl sm:text-2xl font-serif font-bold text-[var(--text)] m-0">
            Common Questions
          </h2>
          <Link
            href="/faq"
            className="text-xs font-medium text-[var(--gold-bright)] hover:underline"
          >
            Read full FAQ →
          </Link>
        </div>

        <dl className="faq-list divide-y divide-[var(--line)] m-0">
          {FAQS.map((item, idx) => {
            const isOpen = openFaqIndex === idx;
            return (
              <div key={item.question} className="faq-item py-4">
                <dt>
                  <button
                    type="button"
                    onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                    aria-expanded={isOpen}
                    className="w-full flex items-center justify-between gap-4 text-left cursor-pointer bg-transparent border-0 p-0 text-[var(--text)] group"
                  >
                    <h3 className="text-sm sm:text-base font-medium text-[var(--text)] group-hover:text-[var(--gold-bright)] transition-colors m-0">
                      {item.question}
                    </h3>
                    <span className="text-[var(--gold-bright)] shrink-0">
                      {isOpen ? <Minus size={16} /> : <Plus size={16} />}
                    </span>
                  </button>
                </dt>
                <dd
                  className={cn(
                    "m-0 overflow-hidden transition-all duration-200",
                    isOpen ? "max-h-64 opacity-100 pt-2.5" : "max-h-0 opacity-0 pointer-events-none"
                  )}
                >
                  <p className="text-xs sm:text-sm text-[var(--text-muted)] leading-relaxed m-0 pr-6">
                    {item.answer}
                  </p>
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}
