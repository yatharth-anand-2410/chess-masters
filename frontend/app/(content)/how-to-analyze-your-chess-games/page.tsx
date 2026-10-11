import type { Metadata } from "next";
import Link from "next/link";
import ArticleMeta from "../../../components/ArticleMeta";
import JsonLd from "../../../components/JsonLd";
import {
  articleSchema,
  breadcrumbSchema,
  faqPageSchema,
  schemaGraph,
  type FaqItem,
} from "../../../lib/schema";
import { CONTENT_PUBLISHED } from "../../../lib/site";

export const metadata: Metadata = {
  title: "How to Analyze Your Chess Games",
  description:
    "A five-step routine for analyzing your own chess games: guess the turning point first, run the engine, name the pattern, train it, and re-test it.",
  alternates: { canonical: "/how-to-analyze-your-chess-games", types: { "application/rss+xml": "/feed.xml" } },
  openGraph: {
    title: "How to Analyze Your Chess Games · Chessmasters",
    description:
      "A five-step review routine that turns your own games into lessons you actually keep.",
    url: "/how-to-analyze-your-chess-games",
  },
};

const PAGE_FAQS: FaqItem[] = [
  {
    question: "How many games should I analyze?",
    answer:
      "One or two deeply beat ten casually. Pick the games you felt unsure about — losses and draws usually teach more than wins — and give each one a real pass through the five steps.",
  },
  {
    question: "Should I analyze my wins too?",
    answer:
      "Occasionally. Wins are worth reviewing when they felt shaky — a won game with three blunders is more instructive than a clean loss, because you got away with mistakes you could repeat under pressure.",
  },
  {
    question: "How long should a review take?",
    answer:
      "Ten to twenty minutes per game is plenty if you follow the steps: a few minutes finding your turning point, a few on the engine truth, and most of the time on naming the pattern and training it.",
  },
];

const PAGE_SCHEMA = schemaGraph([
  articleSchema({
    headline: "How to Analyze Your Chess Games",
    description:
      "A five-step routine for reviewing your own games so mistakes become lessons and patterns become training.",
    path: "/how-to-analyze-your-chess-games",
    datePublished: CONTENT_PUBLISHED,
    dateModified: CONTENT_PUBLISHED,
  }),
  breadcrumbSchema([
    { name: "Home", path: "/" },
    {
      name: "How to Analyze Your Chess Games",
      path: "/how-to-analyze-your-chess-games",
    },
  ]),
  faqPageSchema(PAGE_FAQS),
]);

export default function HowToAnalyzePage() {
  return (
    <>
      <JsonLd data={PAGE_SCHEMA} />
      <h1>How to Analyze Your Chess Games</h1>
      <ArticleMeta />

      <p className="content-lede">
        Most players either skip game review entirely or skim an eval bar for a
        minute and close the tab. A review that changes your rating looks like
        this: find the turning point yourself first, check it against the
        engine, name the pattern, train that pattern, and re-test it in your
        next games. Five steps, ten to twenty minutes.
      </p>

      <h2>Step 1: Guess the turning point before you turn on the engine</h2>
      <p>
        Immediately after the game — while it is still in your head — decide
        where the game turned and why. Write it down in one line. This is active
        recall, and it is the step everyone skips because the engine is right
        there. If your guess is wrong, the gap between what you felt and what
        happened is itself the lesson: it tells you your internal evaluation is
        off, which is exactly what training should fix.
      </p>

      <h2>Step 2: Run the real analysis</h2>
      <p>
        Now check your guess. On{" "}
        <Link href="/lichess-game-analysis">Lichess</Link> this is free and
        unlimited; on Chess.com, Game Review gives you the eval graph and move
        labels. Compare your guessed turning point with the first big evaluation
        swing. Agreeing with the engine is less important than noticing where
        your feel diverged from the truth.
      </p>

      <h2>Step 3: Name the pattern, not the blunder</h2>
      <p>
        One-off blunders are noise. The signal is repetition: you hang pieces to
        knights on the third move of a combination, or under time pressure, or
        in a specific opening structure. Group your mistakes by theme — hanging
        pieces, pins you missed, forks you walked into, panic in equal
        endgames — and you will usually find that two or three motifs cause
        most of your losses. Our <Link href="/tactics">tactics map</Link> is
        organized around exactly those motifs.
      </p>

      <h2>Step 4: Spend the training time you just earned</h2>
      <p>
        A review that ends without training is entertainment. Take the motif you
        found and drill it for ten focused minutes: the matching Lichess puzzle
        theme, or a study on the structure that keeps hurting you. Resist the
        urge to start a new opening — the opening was rarely the reason the game
        was lost.
      </p>

      <h2>Step 5: Re-test and log</h2>
      <p>
        Over your next five games, watch for the motif you trained. When it
        appears and you handle it, that is the review paying off; when it
        appears and you don&apos;t, you know what to drill again. Keeping a
        one-line log per game (result, motif, one lesson) turns scattered
        reviews into a record of what is actually holding you back.
      </p>

      <h2>Where Chessmasters fits</h2>
      <p>
        Steps 2 through 4 are mechanical, and they are what Chessmasters
        automates: paste the finished game and the report tells you where it
        turned, names the patterns, and hands you the focus areas with training
        links. Your part — the guessing in step 1 and the training in step 4 —
        stays yours, which is the point. See{" "}
        <Link href="/sample-report">what a report looks like</Link> before you
        try it. The first analysis is free.
      </p>

      <h2>Frequently asked questions</h2>
      <dl className="faq-list">
        {PAGE_FAQS.map((faq) => (
          <div className="faq-item" key={faq.question}>
            <dt>
              <h3>{faq.question}</h3>
            </dt>
            <dd>
              <p>{faq.answer}</p>
            </dd>
          </div>
        ))}
      </dl>

      <div className="content-cta">
        <Link className="btn" href="/">
          Analyze a game free
        </Link>
        <Link className="btn btn-ghost" href="/tactics">
          Browse the tactics map
        </Link>
      </div>
    </>
  );
}
