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
  SITE_NAME,
} from "../lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/", types: { "application/rss+xml": "/feed.xml" } },
  openGraph: {
    title: "Chessmasters · AI Chess Game Analyzer",
    description: SITE_META_DESCRIPTION,
    url: "/",
  },
};

export default function HomePage() {
  return (
    <>
      <JsonLd
        data={schemaGraph([
          webPageSchema({
            name: `${SITE_NAME} · AI Chess Game Analyzer`,
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
