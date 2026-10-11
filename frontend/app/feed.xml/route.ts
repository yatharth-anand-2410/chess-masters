import {
  CONTENT_PUBLISHED,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "../../lib/site";

// Static RSS feed of editorial pages: a discovery surface for feed readers
// and a freshness signal for crawlers.
export const dynamic = "force-static";

const PAGES = [
  {
    path: "/chess-game-analyzer",
    title: "AI Chess Game Analyzer for Chess.com and Lichess",
    description:
      "What Chessmasters analyzes, how the report is built, and what a coaching report contains.",
  },
  {
    path: "/chess-com-game-review-alternative",
    title: "Chess.com Game Review Alternative",
    description:
      "An honest comparison of Chess.com Game Review, Lichess analysis, and Chessmasters.",
  },
  {
    path: "/lichess-game-analysis",
    title: "How to Analyze a Lichess Game",
    description:
      "Turning Lichess game evaluations into a coaching lesson with Chessmasters.",
  },
  {
    path: "/how-to-analyze-your-chess-games",
    title: "How to Analyze Your Chess Games",
    description:
      "A five-step process for reviewing your own games so mistakes become lessons.",
  },
  {
    path: "/sample-report",
    title: "What a Chessmasters Report Looks Like",
    description:
      "An annotated walkthrough of the five report sections, using the 1858 Opera Game.",
  },
  {
    path: "/tactics",
    title: "Chess Tactics Map",
    description:
      "Fork, pin, skewer, discovered attack, deflection, and zugzwang — with training links.",
  },
  {
    path: "/faq",
    title: "Chessmasters FAQ",
    description:
      "Free plan, supported platforms, report contents, and how analyses work.",
  },
];

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export async function GET() {
  const items = PAGES.map(
    (page) => `    <item>
      <title>${escapeXml(page.title)}</title>
      <link>${SITE_URL}${page.path}</link>
      <guid isPermaLink="true">${SITE_URL}${page.path}</guid>
      <description>${escapeXml(page.description)}</description>
      <pubDate>${new Date(`${CONTENT_PUBLISHED}T09:00:00Z`).toUTCString()}</pubDate>
    </item>`
  ).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${SITE_NAME} · AI Chess Game Analyzer</title>
    <link>${SITE_URL}</link>
    <description>${escapeXml(SITE_DESCRIPTION)}</description>
    <language>en</language>
    <lastBuildDate>${new Date(`${CONTENT_PUBLISHED}T09:00:00Z`).toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
