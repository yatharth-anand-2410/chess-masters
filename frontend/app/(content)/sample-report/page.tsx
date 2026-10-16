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
  title: "What a Chessmasters Report Looks Like",
  description:
    "An annotated walkthrough of the five report sections — Strength, Weakness, Game Overview, Focus Areas, Resources — using the 1858 Opera Game as the example.",
  alternates: { canonical: "/sample-report", types: { "application/rss+xml": "/feed.xml" } },
  openGraph: {
    title: "What a Chessmasters Report Looks Like · Chessmasters",
    description:
      "The five-section report structure, walked through with the Opera Game.",
    url: "/sample-report",
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
    question: "Is this a real Chessmasters report?",
    answer:
      "It is an annotated walkthrough of the report structure. Every Chessmasters report follows the same five sections, and this page shows what each contains, using a public historical game so the chess itself can be checked by anyone.",
  },
  {
    question: "Which game is used in the walkthrough?",
    answer:
      "Morphy–Duke of Brunswick and Count Isouard, Paris 1858, known as the Opera Game. It is one of the most analyzed games in chess history, which makes it a good fixture for showing how a report talks about a game.",
  },
  {
    question: "Can Chessmasters analyze historical games?",
    answer:
      "No. Chessmasters analyzes finished, publicly available games from Chess.com and Lichess. You paste a game URL, or your Chess.com username and the game URL, and the report is generated for that game.",
  },
];

const PAGE_SCHEMA = schemaGraph([
  articleSchema({
    headline: "What a Chessmasters Report Looks Like",
    description:
      "An annotated walkthrough of the five report sections using the Opera Game: Strength, Weakness, Game Overview, Focus Areas, and Resources.",
    path: "/sample-report",
    datePublished: CONTENT_PUBLISHED,
    dateModified: CONTENT_PUBLISHED,
  }),
  breadcrumbSchema([
    { name: "Home", path: "/" },
    { name: "Sample report", path: "/sample-report" },
  ]),
  faqPageSchema(PAGE_FAQS),
]);

export default function SampleReportPage() {
  return (
    <>
      <JsonLd data={PAGE_SCHEMA} />
      <h1>What a Chessmasters report looks like</h1>
      <ArticleMeta />

      <p className="content-lede">
        Every Chessmasters report follows the same five sections —{" "}
        <strong>Strength</strong>, <strong>Weakness</strong>,{" "}
        <strong>Game Overview</strong>, <strong>Focus Areas</strong>, and{" "}
        <strong>Resources</strong> — so that games are comparable and patterns
        are visible across them. This page walks through the structure using the
        Opera Game (Morphy–Duke of Brunswick, Paris 1858), whose story is public
        and instantly verifiable. Your own reports are generated from your own
        games.
      </p>

      <div className="report-block">
        <span className="report-block-tag">Section 1 · Strength</span>
        <h3>What you did well — named, so you keep doing it</h3>
        <p>
          In a report on White in the Opera Game, this section would lead with
          development and initiative: every piece came out with tempo, castling
          long connected the rooks, and the pressure never stopped. It would
          name the specific skill — converting a pin into permanent pressure —
          because a compliment you can act on is worth more than an accuracy
          score.
        </p>
      </div>

      <div className="report-block">
        <span className="report-block-tag">Section 2 · Weakness</span>
        <h3>The turning points, with the motif behind each one</h3>
        <p>
          For the losing side, the report would start at 9…b5, a pawn grab
          played while the bishop on g5 pinned the knight to the queen. It would
          show the punishment beginning with 10.Nxb5, then trace the two
          sacrifices that followed — 13.Rxd7 removing a defender, and 16.Qb8+!
          deflecting the knight before 17.Rd8# — and name the lesson: pieces
          that are pinned cannot defend, and defenders can be removed or
          deflected.
        </p>
      </div>

      <div className="report-block">
        <span className="report-block-tag">Section 3 · Game Overview</span>
        <h3>How the game actually flowed, opening to result</h3>
        <p>
          The overview reads like a short story with an evaluation under it: the
          Philidor Defence gave Black a solid structure; the pin on f6
          restricted the defence; one greedy pawn move opened the floodgates;
          and from move ten the attack played itself. Key moments are linked to
          board diagrams, and the evaluation chart shows the exact move where
          the assessment tipped — the same view you get from an engine, but
          narrated.
        </p>
      </div>

      <div className="report-block">
        <span className="report-block-tag">Section 4 · Focus Areas</span>
        <h3>Two or three things worth training next — not ten</h3>
        <p>
          Reports deliberately keep this list short. In this game&apos;s case it
          would be: spot pins before committing to a capture; punish a king that
          stays in the centre; and prefer development over material while your
          pieces are still at home. Each focus area is a phrase you could say
          out loud in your next game — that is the test we hold these lines to.
        </p>
      </div>

      <div className="report-block">
        <span className="report-block-tag">Section 5 · Resources</span>
        <h3>Where to train each focus area, with links</h3>
        <p>
          Every focus area maps to real training material: the pin and
          deflection themes on Lichess&apos;s puzzle trainer, and study search
          links for the motifs. A report that ends with a to-do list you can
          start in the next five minutes is the whole point — see the{" "}
          <Link href="/tactics">tactics map</Link> for the full set of motifs
          Chessmasters recognizes.
        </p>
      </div>

      <h2>What your own report adds</h2>
      <p>
        The Opera Game is famous, but its lessons are the same kind your games
        contain: a pin you didn&apos;t see, a defender you didn&apos;t remove, a
        king that was never punished — or one that was, by you. Because your
        report is built from Stockfish evaluation of <em>your</em> moves, the
        difference is that the patterns repeat across your games. After three
        analyses, Chessmasters also builds your AI Psychological Profile: Tilt
        Resistance, Composure, and Playing Style, measured from the blunders you
        actually make under pressure.
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
          Analyze your game free
        </Link>
        <Link className="btn btn-ghost" href="/chess-game-analyzer">
          How the analyzer works
        </Link>
      </div>
    </>
  );
}
