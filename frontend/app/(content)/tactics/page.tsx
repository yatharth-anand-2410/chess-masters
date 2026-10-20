import type { Metadata } from "next";
import Link from "next/link";
import ArticleMeta from "../../../components/ArticleMeta";
import JsonLd from "../../../components/JsonLd";
import TacticsCatalog from "../../../components/studies/TacticsCatalog";
import {
  articleSchema,
  breadcrumbSchema,
  faqPageSchema,
  schemaGraph,
  type FaqItem,
} from "../../../lib/schema";
import { CONTENT_PUBLISHED } from "../../../lib/site";

export const metadata: Metadata = {
  title: "Chess Tactics Map: Fork, Pin, Skewer, Deflection & More",
  description:
    "The tactical motifs that decide club games — fork, pin, skewer, discovered attack, deflection, attraction, clearance, hanging piece, trapped piece, zugzwang — and how the analyzer names the one behind each turning point in your own games.",
  alternates: { canonical: "/tactics", types: { "application/rss+xml": "/feed.xml" } },
  openGraph: {
    title: "Chess Tactics Map · Chessmasters",
    description:
      "Ten tactical patterns that decide most club games, each with a Lichess training link.",
    url: "/tactics",
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
    question: "Which tactic should I train first?",
    answer:
      "Whichever you keep missing. If you don't know yet, hang a piece a few times in training and start there — hanging pieces and knight forks decide more games under 1500 than any fancy combination.",
  },
  {
    question: "How does Chessmasters decide which motif I missed?",
    answer:
      "Each blunder is evaluated by Stockfish and then classified; the report names the motif involved — pin, deflection, clearance, and so on — and links the matching training theme so you can drill exactly what you missed.",
  },
];

type Tactic = {
  name: string;
  slug: string;
  definition: string;
};

const TACTICS: Tactic[] = [
  {
    name: "Fork",
    slug: "fork",
    definition:
      "One piece attacks two or more enemy pieces at once. Knight forks are the classic, and the royal fork (king and queen) is the most common way club games end suddenly.",
  },
  {
    name: "Pin",
    slug: "pin",
    definition:
      "A piece cannot move (or only moves at a cost) because something more valuable stands behind it. Absolute pins run to the king; relative pins run to the queen or a rook.",
  },
  {
    name: "Skewer",
    slug: "skewer",
    definition:
      "A pin in reverse: attack the valuable piece so it must move, then capture the piece exposed behind it. Skewers usually win material along a line, not by checkmate.",
  },
  {
    name: "Discovered attack",
    slug: "discoveredAttack",
    definition:
      "Moving one of your pieces unleashes the attack of another behind it. With check involved, the moving piece is essentially a free move to grab material — discovered checks are the sharpest form.",
  },
  {
    name: "Deflection",
    slug: "deflection",
    definition:
      "Force a defending piece away from its duty — the defender of a mate square, or the guard of a crucial pawn — usually with a sacrifice that cannot be declined.",
  },
  {
    name: "Attraction",
    slug: "attraction",
    definition:
      "The mirror of deflection: lure an enemy piece onto a square where it becomes a target, often by sacrificing on that very square so the recapture is forced.",
  },
  {
    name: "Clearance",
    slug: "clearance",
    definition:
      "Move or sacrifice a piece out of a square or line so the piece behind it can do the work. Many mating combinations are just clearance with a dramatic first move.",
  },
  {
    name: "Hanging piece",
    slug: "hangingPiece",
    definition:
      "An undefended piece you can simply take. It sounds trivial, but at club level the most common decisive mistake is still leaving a piece loose under pressure.",
  },
  {
    name: "Trapped piece",
    slug: "trappedPiece",
    definition:
      "A piece with no safe square. You capture it not by force but by closing escape routes — usually with a pawn move or a quiet bishop retreat rather than a check.",
  },
  {
    name: "Zugzwang",
    slug: "zugzwang",
    definition:
      "A position where the obligation to move loses: every move makes things worse. Rare in the middlegame, decisive in pawn endgames, where king opposition decides games.",
  },
];

const PAGE_SCHEMA = schemaGraph([
  articleSchema({
    headline:
      "Chess Tactics Map: Fork, Pin, Skewer, Deflection and More",
    description:
      "Ten tactical motifs that decide club games, each with a definition and a Lichess training link.",
    path: "/tactics",
    datePublished: CONTENT_PUBLISHED,
    dateModified: CONTENT_PUBLISHED,
  }),
  breadcrumbSchema([
    { name: "Home", path: "/" },
    { name: "Chess tactics", path: "/tactics" },
  ]),
  faqPageSchema(PAGE_FAQS),
]);

export default function TacticsPage() {
  return (
    <>
      <JsonLd data={PAGE_SCHEMA} />
      <h1>Chess tactics map</h1>
      <ArticleMeta />

      <p className="content-lede">
        A small set of tactical patterns decides most club games — the fork, the
        pin, the skewer, deflection, the loose piece left hanging. Working on the
        two or three you personally keep missing improves results faster than
        opening theory, and Chessmasters names the pattern behind each turning
        point in your own games when you{" "}
        <Link href="/chess-game-analyzer">analyze a game</Link>.
      </p>

      <TacticsCatalog />

      <h2>10 Core Tactical Motifs in Club Chess</h2>
      <div className="tactics-grid">
        {TACTICS.map((tactic) => (
          <div className="tactics-card" key={tactic.name}>
            <h3>{tactic.name}</h3>
            <p>{tactic.definition}</p>
            <p>
              <a
                href={`https://lichess.org/training/${tactic.slug}`}
                target="_blank"
                rel="noopener"
              >
                Train {tactic.name.toLowerCase()} on Lichess →
              </a>
            </p>
          </div>
        ))}
      </div>

      <h2>From motif to habit</h2>
      <p>
        Recognizing a motif in a puzzle and spotting it in your own game are
        different skills, and the bridge between them is review: seeing the
        pattern in a position you actually played is what makes it findable in a
        position you actually have. That is why every{" "}
        <Link href="/chess-game-analyzer">Chessmasters report</Link> names the
        motif behind each turning point instead of stopping at the evaluation
        number, and why each focus area points straight at the theme that
        answers it. For the review routine that puts this into practice, see{" "}
        <Link href="/how-to-analyze-your-chess-games">
          how to analyze your chess games
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
          Find the motifs in your games
        </Link>
        <Link className="btn btn-ghost" href="/sample-report">
          See a sample report
        </Link>
      </div>
    </>
  );
}
