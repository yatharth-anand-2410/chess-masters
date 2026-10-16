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
  title: "Chess.com Game Review Alternative",
  description:
    "An honest comparison of Chess.com Game Review, Lichess analysis, and Chessmasters: what each does well, what each costs, and which fits how you improve.",
  alternates: { canonical: "/chess-com-game-review-alternative", types: { "application/rss+xml": "/feed.xml" } },
  openGraph: {
    title: "Chess.com Game Review Alternative · Chessmasters",
    description:
      "Game Review gives you numbers inside Chess.com. Chessmasters gives you a coaching lesson from any Chess.com or Lichess game.",
    url: "/chess-com-game-review-alternative",
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
    question: "Can I get game review without a Chess.com membership?",
    answer:
      "Chess.com gives free accounts a limited number of Game Reviews per day and reserves deeper coaching for paid members. Lichess analysis is free and unlimited but engine-only. Chessmasters gives five free coaching reports, then ₹399 per month for 100.",
  },
  {
    question: "Is Chessmasters affiliated with Chess.com or Lichess?",
    answer:
      "No. Chessmasters is an independent tool that analyzes publicly available games from both platforms. It is not affiliated with, endorsed by, or sponsored by Chess.com or Lichess.",
  },
  {
    question: "Do I have to choose just one?",
    answer:
      "No, and most improving players don't. A common routine is Chess.com Game Review for the quick in-app pass, and Chessmasters when a game deserves a full lesson with named patterns and training links.",
  },
];

const PAGE_SCHEMA = schemaGraph([
  articleSchema({
    headline: "Chess.com Game Review Alternative",
    description:
      "Chess.com Game Review, Lichess analysis, and Chessmasters compared honestly: strengths, limits, pricing, and who each is for.",
    path: "/chess-com-game-review-alternative",
    datePublished: CONTENT_PUBLISHED,
    dateModified: CONTENT_PUBLISHED,
  }),
  breadcrumbSchema([
    { name: "Home", path: "/" },
    {
      name: "Chess.com Game Review Alternative",
      path: "/chess-com-game-review-alternative",
    },
  ]),
  faqPageSchema(PAGE_FAQS),
]);

export default function GameReviewAlternativePage() {
  return (
    <>
      <JsonLd data={PAGE_SCHEMA} />
      <h1>Chess.com Game Review Alternative</h1>
      <ArticleMeta />

      <p className="content-lede">
        Chess.com Game Review is polished, convenient, and free accounts get
        only a limited number of full reviews per day, with deeper coaching
        behind the membership. If you play more than a game or two a day, or you
        want your review to explain <em>why</em> a move failed instead of
        labeling it, the alternatives below are worth an honest look — including{" "}
        <Link href="/chess-game-analyzer">Chessmasters</Link>, the tool we make.
      </p>

      <h2>The short version</h2>
      <div className="compare-table-scroll">
        <table className="compare-table">
        <thead>
          <tr>
            <th>&nbsp;</th>
            <th>Chess.com Game Review</th>
            <th>Lichess analysis</th>
            <th>Chessmasters</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Cost</strong>
            </td>
            <td>Free tier is rate-limited; full coaching needs membership</td>
            <td>Free, unlimited</td>
            <td>5 free reports, then ₹399/month for 100</td>
          </tr>
          <tr>
            <td>
              <strong>Output</strong>
            </td>
            <td>Accuracy score, move labels, recap</td>
            <td>Engine evals, best moves, eval graph</td>
            <td>Coaching report in five sections with named patterns</td>
          </tr>
          <tr>
            <td>
              <strong>Explains why</strong>
            </td>
            <td>Partially; deeper explanations are paid</td>
            <td>No — you read the lines yourself</td>
            <td>Yes, tied to Stockfish data</td>
          </tr>
          <tr>
            <td>
              <strong>Next steps</strong>
            </td>
            <td>General puzzle library</td>
            <td>Opening explorer, studies, puzzle themes</td>
            <td>Focus areas with drills mapped to your game</td>
          </tr>
          <tr>
            <td>
              <strong>Platforms</strong>
            </td>
            <td>Chess.com games only</td>
            <td>Lichess games only</td>
            <td>Chess.com and Lichess</td>
          </tr>
        </tbody>
      </table>
      </div>

      <h2>Chess.com Game Review: what it does well</h2>
      <p>
        Zero friction is the superpower. Your games already live on Chess.com,
        and Game Review opens with one click: accuracy score, move
        classifications, an evaluation graph, and celebratory labels for
        brilliant moves. If you want a fast sanity check on the game you just
        played, nothing beats it.
      </p>
      <p>
        Its limits are worth knowing. Free accounts get a small number of full
        reviews per day, so reviewing a full session means waiting or paying.
        The feedback is classification-based — it tells you a move was a blunder
        and shows the better one, but it doesn&apos;t consistently explain the
        pattern behind the mistake or turn it into a training plan. And it only
        reviews Chess.com games.
      </p>

      <h2>Lichess analysis: what it does well</h2>
      <p>
        Lichess is one of the best things in chess: unlimited, free,
        open-source engine analysis with move annotations, an evaluation graph,
        opening detection, studies, and a world-class puzzle trainer. If you
        read engine output comfortably, it may be all the analysis you need.
      </p>
      <p>
        The catch is interpretation. On an engine-only review, the lesson
        depends on you: spotting that the same hanging-piece blunder appears at
        move 18 of four different losses, and knowing which puzzle theme to
        drill, is the work left to the player.
      </p>

      <h2>Chessmasters: what we do differently</h2>
      <p>
        We run Stockfish too — the difference is the layer on top. Chessmasters
        turns the engine&apos;s findings into a written lesson: what the turning
        point was, the named tactic involved, how the position changed, and the
        two or three patterns worth training afterward, each linked to real
        training material. It works for Chess.com <em>and</em> Lichess games,
        because you paste a URL rather than importing a history.
      </p>
      <p>
        We are also honest about what we are not: a small independent tool, not
        an all-in-one platform. We don&apos;t have an opening explorer, a game
        database, or social features, and we can&apos;t analyze an unfinished
        game. If you want a training dashboard with puzzles and opening
        drilling, Lichess plus its puzzle themes covers that ground well.
      </p>

      <h2>Which should you use?</h2>
      <ul>
        <li>
          <strong>You play on Chess.com and want a fast, free read:</strong> use
          Game Review.
        </li>
        <li>
          <strong>You are comfortable reading engine lines:</strong> Lichess
          analysis plus the puzzle trainer is genuinely enough.
        </li>
        <li>
          <strong>
            You want to know what the mistake was, why it happened, and what to
            study next:
          </strong>{" "}
          try Chessmasters — the first report is free.
        </li>
      </ul>
      <p>
        Most improving players end up using two of the three. That&apos;s fine.
        The point of a review is not the report; it is{" "}
        <Link href="/how-to-analyze-your-chess-games">
          what you do after reading it
        </Link>
        .
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
