export const SITE_NAME = "Chessmasters";
export const SITE_URL = "https://www.chessmasterss.in";
export const CONTACT_EMAIL = "info@chessmasterss.in";

/** Canonical one-sentence descriptor used across the site, metadata, and schema. */
export const SITE_DESCRIPTION =
  "Chessmasters is an AI chess game analyzer that turns your Chess.com and Lichess games into plain-English coaching reports covering Strengths, Weaknesses, Game Overview, Focus Areas, and Resources.";

/**
 * Short marketing description used for meta tags, OpenGraph, and schema.
 * Kept under ~155 characters so Google does not truncate the snippet; leads
 * with the category head term and carries the real differentiator (coaching
 * logic designed with a FIDE Arena International Master).
 */
export const SITE_META_DESCRIPTION =
  "AI chess game analyzer for Chess.com and Lichess. Plain-English coaching reports designed with a FIDE Arena International Master (2300+ peak rating).";

export const SITE_TAGLINE = "AI Chess Game Analyzer";

/** Stable schema.org node identifiers. */
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const PRODUCT_ID = `${SITE_URL}/#software-application`;

/** Third-party references that describe the Chessmasters entity. */
export const ORG_SAME_AS = [
  "https://www.producthunt.com/products/chess-masterss",
  "https://www.nicheloom.com/launches/45694/",
  "https://caimpare.ai/tool/78319",
];

export type FounderProfile = {
  name: string;
  jobTitle: string;
  description: string;
  sameAs?: string[];
};

export const FOUNDERS: FounderProfile[] = [
  {
    name: "Parth Kaushik",
    jobTitle: "Co-Founder & Chess Pedagogy",
    description:
      "FIDE Arena International Master (AIM) with a 2300+ peak rating on Chess.com and a competitive chess instructor. He designed the coaching logic that powers Chessmasters reports.",
    sameAs: [
      "https://www.chess.com/member/botevenik",
      "https://www.linkedin.com/in/parth-kaushik-835b631a5/",
      "https://lichess.org/@/MentalCarlsen",
    ],
  },
  {
    name: "Yatharth Anand",
    jobTitle: "Co-Founder & Lead Architect",
    description:
      "Engineer behind the Chessmasters backend, integrating real-time Stockfish evaluation with the AI report pipeline.",
  },
];

/** Product facts reused by schema, llms.txt, and content pages. Keep in sync with PRODUCT.md. */
export const PRODUCT_FACTS = {
  freeAnalyses: 5,
  proPriceInr: 399,
  proAnalysesPerPeriod: 100,
  batchLimit: 5,
  supportedPlatforms: ["Chess.com", "Lichess"],
  reportSections: [
    "Strength",
    "Weakness",
    "Game Overview",
    "Focus Areas",
    "Resources",
  ],
} as const;

/** Content review dates for editorial pages. */
export const CONTENT_PUBLISHED = "2026-10-11";
export const CONTENT_PUBLISHED_LABEL = "11 October 2026";
