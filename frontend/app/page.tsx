import type { Metadata } from "next";
import HomeDashboard from "../components/HomeDashboard";
import JsonLd from "../components/JsonLd";
import { FAQS } from "../lib/faqs";
import {
  faqPageSchema,
  schemaGraph,
  SOFTWARE_APPLICATION_SCHEMA,
} from "../lib/schema";
import { SITE_META_DESCRIPTION } from "../lib/site";

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
        data={schemaGraph([SOFTWARE_APPLICATION_SCHEMA, faqPageSchema(FAQS)])}
      />
      <HomeDashboard />
    </>
  );
}
