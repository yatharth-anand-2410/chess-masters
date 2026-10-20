import type { Metadata } from "next";
import HomeDashboard from "../components/HomeDashboard";
import JsonLd from "../components/JsonLd";
import { FAQS } from "../lib/faqs";
import {
  faqPageSchema,
  schemaGraph,
  SOFTWARE_APPLICATION_SCHEMA,
  webPageSchema,
} from "../lib/schema";
import {
  CONTENT_PUBLISHED,
  SITE_META_DESCRIPTION,
} from "../lib/site";

/**
 * Homepage title. Leads with the category head term so "AI Chess Game Analyzer"
 * carries full exact-match weight in the first ~30 characters of the SERP
 * snippet, keeping the brand attached at the end for entity attribution.
 * `absolute` deliberately opts this one page out of the root layout's
 * `%s · Chessmasters` template, so every other route's title is untouched.
 */
const HOME_TITLE = "AI Chess Game Analyzer for Chess.com & Lichess · Chessmasters";

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  alternates: { canonical: "/", types: { "application/rss+xml": "/feed.xml" } },
  openGraph: {
    title: HOME_TITLE,
    description: SITE_META_DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description: SITE_META_DESCRIPTION,
  },
};

export default function HomePage() {
  return (
    <>
      <JsonLd
        data={schemaGraph([
          webPageSchema({
            name: HOME_TITLE,
            path: "/",
            description: SITE_META_DESCRIPTION,
            datePublished: CONTENT_PUBLISHED,
            dateModified: CONTENT_PUBLISHED,
          }),
          SOFTWARE_APPLICATION_SCHEMA,
          faqPageSchema(FAQS),
        ])}
      />
      <HomeDashboard />
    </>
  );
}
