import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

/** Pages that require authentication or create duplicate content. */
const PRIVATE_PATHS = [
  "/auth/",
  "/history",
  "/analysis/",
  "/batch/",
  "/upgrade",
  "/dev-preview",
];

/**
 * AI crawlers we explicitly welcome:
 * - Retrieval bots feed live answers (ChatGPT search, Claude search, Perplexity).
 * - Training bots are allowed too; this is a public marketing site whose goal
 *   is to be known and cited by AI systems.
 */
const AI_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Bingbot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
      ...AI_AGENTS.map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow: PRIVATE_PATHS,
      })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
