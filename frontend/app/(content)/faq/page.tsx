import type { Metadata } from "next";
import Link from "next/link";
import ArticleMeta from "../../../components/ArticleMeta";
import FaqSection from "../../../components/FaqSection";
import JsonLd from "../../../components/JsonLd";
import { FAQS } from "../../../lib/faqs";
import {
  breadcrumbSchema,
  faqPageSchema,
  schemaGraph,
  type FaqItem,
} from "../../../lib/schema";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Answers about Chessmasters: the free plan, supported platforms, what each report contains, how long analyses take, and how billing works.",
  alternates: { canonical: "/faq", types: { "application/rss+xml": "/feed.xml" } },
  openGraph: {
    title: "Chessmasters FAQ",
    description:
      "The free plan, supported platforms, report contents, and how analyses work.",
    url: "/faq",
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

const EXTRA_FAQS: FaqItem[] = [
  {
    question: "Which games can I analyze?",
    answer:
      "Finished standard chess games played on Chess.com or Lichess. The game must be publicly visible, which covers virtually every rated or casual game on both platforms.",
  },
  {
    question: "Can I analyze a game I lost?",
    answer:
      "Yes — and losses are usually the most instructive. The report focuses on repeating patterns rather than the single result, so a loss usually generates better focus areas than a win.",
  },
  {
    question: "How do I cancel, pause, or resume my subscription?",
    answer:
      "Everything is managed from the subscription page: pause, resume, and cancel are supported directly, and the refund policy explains what happens to unused analyses.",
  },
  {
    question: "Is Chessmasters affiliated with Chess.com or Lichess?",
    answer:
      "No. Chessmasters is an independent tool built by chess enthusiasts. It is not affiliated with, endorsed by, or sponsored by Chess.com, Lichess.org, or the Stockfish project.",
  },
];

const ALL_FAQS = [...FAQS, ...EXTRA_FAQS];

const PAGE_SCHEMA = schemaGraph([
  breadcrumbSchema([
    { name: "Home", path: "/" },
    { name: "FAQ", path: "/faq" },
  ]),
  faqPageSchema(ALL_FAQS),
]);

export default function FaqPage() {
  return (
    <>
      <JsonLd data={PAGE_SCHEMA} />
      <h1>Frequently asked questions</h1>
      <ArticleMeta showReviewedBy={false} />
      <p className="content-lede">
        Everything about how Chessmasters works: the free plan, supported
        platforms, what each report contains, and how billing works. If your
        question is not here, <Link href="/contact">contact us</Link> — we read
        everything.
      </p>
      <FaqSection items={ALL_FAQS} showMoreLink={false} />
      <div className="content-cta">
        <Link className="btn" href="/">
          Analyze a game free
        </Link>
        <Link className="btn btn-ghost" href="/subscription">
          See pricing
        </Link>
      </div>
    </>
  );
}
