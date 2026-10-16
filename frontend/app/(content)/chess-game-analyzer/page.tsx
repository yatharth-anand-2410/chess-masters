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
  title: "AI Chess Game Analyzer for Chess.com & Lichess",
  description:
    "Paste a finished Chess.com or Lichess game and get a plain-English AI coaching report: strengths, weaknesses, key moments, focus areas, and training resources.",
  alternates: { canonical: "/chess-game-analyzer", types: { "application/rss+xml": "/feed.xml" } },
  openGraph: {
    title: "AI Chess Game Analyzer for Chess.com & Lichess · Chessmasters",
    description:
      "Plain-English AI coaching reports for your Chess.com and Lichess games: what went right, what went wrong, and what to train next.",
    url: "/chess-game-analyzer",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Chessmasters — AI chess game analyzer for Chess.com and Lichess",
      },
    ],
  },
};

const PAGE_FAQS: FaqItem[] = [
  {
    question: "Is the chess game analyzer free to try?",
    answer:
      "Yes. Your first analysis is free and needs no account. Creating an account unlocks four more free analyses, five in total, before you need the Pro plan.",
  },
  {
    question: "Can I analyze any finished game?",
    answer:
      "Chessmasters analyzes standard chess games played on Chess.com or Lichess. The game must be finished and publicly visible, which covers virtually every rated or casual game on both platforms.",
  },
  {
    question: "Does the analyzer give engine lines or coaching?",
    answer:
      "Both, in that order. Stockfish evaluation runs first to find the centipawn swings and blunders, then the report explains the turning points as chess lessons: the named tactic you missed, why the position changed, and what to study next.",
  },
  {
    question: "Does it work on mobile?",
    answer:
      "Yes. Chessmasters runs in the browser on desktop and mobile, and reports are readable on a phone even though the analysis itself runs in the cloud.",
  },
];

const PAGE_SCHEMA = schemaGraph([
  articleSchema({
    headline: "AI Chess Game Analyzer for Chess.com and Lichess",
    description:
      "How Chessmasters turns a finished Chess.com or Lichess game into a plain-English coaching report.",
    path: "/chess-game-analyzer",
    datePublished: CONTENT_PUBLISHED,
    dateModified: CONTENT_PUBLISHED,
  }),
  breadcrumbSchema([
    { name: "Home", path: "/" },
    { name: "AI Chess Game Analyzer", path: "/chess-game-analyzer" },
  ]),
  faqPageSchema(PAGE_FAQS),
]);

export default function ChessGameAnalyzerPage() {
  return (
    <>
      <JsonLd data={PAGE_SCHEMA} />
      <h1>AI Chess Game Analyzer for Chess.com and Lichess</h1>
      <ArticleMeta />

      <p className="content-lede">
        Chessmasters is an AI chess game analyzer that turns a finished game
        into a plain-English coaching report. You paste a Lichess game URL, or
        your Chess.com username plus the game URL, and within seconds you get a
        report covering your <strong>Strength</strong>, your{" "}
        <strong>Weakness</strong>, a <strong>Game Overview</strong>, your{" "}
        <strong>Focus Areas</strong>, and the <strong>Resources</strong> to
        train them. The first analysis is free.
      </p>

      <h2>How the analysis works</h2>
      <p>
        Every report is built in three steps, and the first two are deliberately
        invisible while you watch the report stream in:
      </p>
      <ul>
        <li>
          <strong>The game is fetched.</strong> For Lichess, the game ID in the
          URL is enough. For Chess.com, Chessmasters searches the public game
          archive for your username and finds the matching game.
        </li>
        <li>
          <strong>Stockfish enriches it.</strong> Every move is evaluated. The
          engine locates centipawn swings, blunders, and the exact moments the
          game turned. Nothing in the report is guessed — each claim is tied to
          an evaluation.
        </li>
        <li>
          <strong>The coaching report is written.</strong> The engine data, the
          opening played, and your results are turned into a narrative lesson
          with named tactical motifs, board diagrams, and links to specific
          training material.
        </li>
      </ul>

      <h2>What is in the report</h2>
      <p>
        Reports follow the same five-section structure every time, so you can
        compare games and track patterns: <strong>Strength</strong> (what you
        did well and should keep doing), <strong>Weakness</strong> (the decisive
        mistakes and the patterns behind them),{" "}
        <strong>Game Overview</strong> (how the game flowed, opening to result),{" "}
        <strong>Focus Areas</strong> (the two or three things worth training
        next), and <strong>Resources</strong> (drills and study material mapped
        to those focus areas).
      </p>
      <p>
        Key moments are shown on interactive boards with the move highlighted,
        and evaluation and accuracy charts show how the game swung.{" "}
        <Link href="/sample-report">See a sample report walkthrough</Link> to
        see what each section looks like.
      </p>

      <h2>What makes it different from an engine review</h2>
      <p>
        An engine tells you that a move lost 2.4 pawns. Chessmasters tells you
        that you missed a deflection, that the deflection mattered because your
        opponent&apos;s queen was overworked, and that the fix is ten minutes on
        the deflection motif. The coaching logic is designed together with
        FIDE Arena International Master (AIM) Parth Kaushik, so the advice reads
        the way a strong human coach would explain your game — not the way an
        evaluation graph displays it.
      </p>
      <p>
        Two things follow from that. First, every focus area links to real
        training material, so a report ends with something to do rather than a
        number to feel bad about. Second, after three analyzed games,
        Chessmasters builds an AI Psychological Profile of your play under
        pressure — Tilt Resistance, Composure, and your Playing Style — based on
        the blunders in your own games rather than a generic quiz.
      </p>

      <h2>Who it is for</h2>
      <p>
        Chessmasters is built for players roughly 800–1800 Elo who want to
        understand their games in words. If you already read engine lines
        fluently and prefer raw output, Lichess analysis alone will serve you
        well — we say so in our{" "}
        <Link href="/chess-com-game-review-alternative">
          honest comparison of the alternatives
        </Link>
        . If you finish a game, feel that something went wrong around move 20,
        and want to know <em>what</em> and <em>why</em>, this is the tool.
      </p>

      <h2>Pricing</h2>
      <p>
        The first analysis is free without an account, and signing in unlocks
        four more free analyses. After that, Pro is ₹399 per month with 100
        analyses per billing period, batch analysis of up to five games at once,
        and follow-up questions on any report. You can pause, resume, or cancel
        from the <Link href="/subscription">subscription page</Link>.
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
        <Link className="btn btn-ghost" href="/sample-report">
          See a sample report
        </Link>
      </div>
    </>
  );
}
