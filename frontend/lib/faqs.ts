import type { FaqItem } from "./schema";

/**
 * Canonical FAQ content. Rendered on the homepage and on /faq, and mirrored
 * in FAQPage schema. Keep answers factual and in sync with PRODUCT.md.
 */
export const FAQS: FaqItem[] = [
  {
    question: "What is Chessmasters?",
    answer:
      "Chessmasters is an AI chess game analyzer for Chess.com and Lichess. Paste a finished game and you receive a plain-English coaching report with five sections: Strength, Weakness, Game Overview, Focus Areas, and Resources.",
  },
  {
    question: "Is Chessmasters free?",
    answer:
      "The first analysis is free and does not require an account. Signing in unlocks four more free analyses, five in total. After that, the Pro plan is ₹399 per month and includes 100 analyses per billing period.",
  },
  {
    question: "Does it work with both Chess.com and Lichess?",
    answer:
      "Yes. For Lichess, paste the URL and Chessmasters fetches it directly. For Chess.com, enter your username and the URL and it finds it in the public archive of the last three months.",
  },
  {
    question: "How is this different from Chess.com Game Review or raw engine analysis?",
    answer:
      "Engine tools tell you which move lost centipawns. Chessmasters runs Stockfish first, then explains what happened as a lesson: the named tactical motif you missed, why the position changed, and exactly what to train next, with drills linked to Lichess training material.",
  },
  {
    question: "What is included in each report?",
    answer:
      "Every report covers Strength, Weakness, Game Overview, Focus Areas, and Resources. Key moments are shown on interactive boards, and evaluation and accuracy charts visualize how the advantage swung. Pro users can also ask follow-up questions about their play.",
  },
  {
    question: "How long does an analysis take?",
    answer:
      "The report streams in real time and typically finishes in about 10 to 15 seconds.",
  },
  {
    question: "Do I need to install anything or connect my account?",
    answer:
      "No. Chessmasters analyzes your public play on Chess.com and Lichess. You never share a password — the URL is enough, plus your Chess.com username.",
  },
  {
    question: "How many can I analyze at once?",
    answer:
      "You can submit a batch of up to five at once. Each one uses one analysis credit.",
  },
  {
    question: "What is the AI Psychological Profile?",
    answer:
      "After three analyses, Chessmasters builds a profile of how you play under pressure — Tilt Resistance, Composure, and your Playing Style — based on the blunders in your own play rather than a generic quiz.",
  },
  {
    question: "Who designs the coaching in the reports?",
    answer:
      "The coaching logic is designed with FIDE Arena International Master (AIM) Parth Kaushik, a competitive instructor with a 2300+ peak Chess.com rating, so the advice reads the way a strong human coach would explain it.",
  },
];
