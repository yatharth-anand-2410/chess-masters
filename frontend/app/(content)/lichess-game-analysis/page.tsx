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
  title: "How to Analyze a Lichess Game",
  description:
    "How to analyze a Lichess game properly: request computer analysis, read the eval graph, find the turning points, and turn the numbers into lessons.",
  alternates: { canonical: "/lichess-game-analysis", types: { "application/rss+xml": "/feed.xml" } },
  openGraph: {
    title: "How to Analyze a Lichess Game · Chessmasters",
    description:
      "From eval bar to lesson: a practical routine for reviewing your Lichess games.",
    url: "/lichess-game-analysis",
  },
};

const PAGE_FAQS: FaqItem[] = [
  {
    question: "Is Lichess computer analysis free?",
    answer:
      "Yes. Requesting computer analysis on a Lichess game is free and unlimited, and it includes full Stockfish evaluation, accuracy scores, and move annotations.",
  },
  {
    question: "How do I turn on computer analysis on Lichess?",
    answer:
      "Open a finished game in the analysis board and use the computer analysis toggle, or request analysis from the game page. The evaluation graph, accuracy, and move classifications appear once the engine finishes.",
  },
  {
    question: "Can Chessmasters analyze my Lichess games?",
    answer:
      "Yes. Paste the game URL on the homepage and Chessmasters fetches the game directly — no account linking, no PGN export, and the first report is free.",
  },
];

const PAGE_SCHEMA = schemaGraph([
  articleSchema({
    headline: "How to Analyze a Lichess Game",
    description:
      "A practical routine for analyzing Lichess games: engine analysis, turning points, and turning eval swings into training.",
    path: "/lichess-game-analysis",
    datePublished: CONTENT_PUBLISHED,
    dateModified: CONTENT_PUBLISHED,
  }),
  breadcrumbSchema([
    { name: "Home", path: "/" },
    { name: "How to Analyze a Lichess Game", path: "/lichess-game-analysis" },
  ]),
  faqPageSchema(PAGE_FAQS),
]);

export default function LichessGameAnalysisPage() {
  return (
    <>
      <JsonLd data={PAGE_SCHEMA} />
      <h1>How to Analyze a Lichess Game</h1>
      <ArticleMeta />

      <p className="content-lede">
        Lichess gives you free, unlimited computer analysis — full Stockfish
        evaluation, accuracy scores, and a move-by-move eval graph. What it
        doesn&apos;t give you is the interpretation. This guide covers the
        routine: run the analysis, find the turning points, and turn the numbers
        into named lessons and training.
      </p>

      <h2>Step 1: Run the computer analysis</h2>
      <p>
        Open the finished game and request computer analysis. When it finishes,
        you have three views of the same story: the evaluation graph (how the
        game swung), accuracy scores (how clean each side played), and move
        annotations (where the mistakes were). Read the graph first — the story
        of the game is in its two or three biggest cliffs.
      </p>

      <h2>Step 2: Find the turning points, not every mistake</h2>
      <p>
        A game usually contains a dozen errors and one or two moments that
        decided it. The first cliff in the graph — not the last one — is usually
        where the game turned, because everything after it is consequence. Find
        that position, then look at two things: the move you played, and the
        engine&apos;s suggestion. Before reading any lines, ask yourself what the
        better move accomplishes that yours didn&apos;t.
      </p>

      <h2>Step 3: Translate the eval swing into words</h2>
      <p>
        An evaluation drop of two pawns is not a lesson; the lesson is the
        motif. Ask what feature of the position your move ignored: a pin on a
        knight that was defending the center? A fork of king and queen? A loose
        piece? Naming the pattern is what makes it retrievable in your next
        game. Our <Link href="/tactics">tactics map</Link> walks through the
        common motifs with training links for each.
      </p>

      <h2>Step 4: Convert the lesson into training</h2>
      <p>
        Lichess is unusually good in this step — once you know the theme, you
        can drill it directly with puzzle themes and studies. Ten focused
        minutes on the motif that cost you the game does more than an hour of
        random puzzles. The trick is deciding which theme deserves the ten
        minutes, which is exactly the judgment call that engine output leaves to
        you.
      </p>

      <h2>Step 5: The URL shortcut</h2>
      <p>
        If you would rather skip steps 1–3, Chessmasters does them for you. You
        paste the Lichess game URL, and Stockfish enrichment plus the AI
        coaching layer produce a written report: where the game turned, which
        pattern decided it, and the two or three focus areas worth training —
        with the training material linked. It covers both{" "}
        <Link href="/chess-com-game-review-alternative">
          Lichess and Chess.com games
        </Link>
        , and the first report is free.
      </p>
      <p className="content-note">
        To be clear: Lichess analysis is excellent and free, and you never need
        another tool to see engine truth. Chessmasters is for the interpretation
        layer — reading the why in plain English instead of centipawns.
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
          Analyze a Lichess game free
        </Link>
        <Link
          className="btn btn-ghost"
          href="/how-to-analyze-your-chess-games"
        >
          The 5-step review routine
        </Link>
      </div>
    </>
  );
}
