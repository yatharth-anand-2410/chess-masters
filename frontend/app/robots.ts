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
 * Crawlers we explicitly welcome, so no CDN or future edge rule can silently
 * drop them:
 * - Retrieval bots feed live answers (ChatGPT search, Claude search, Perplexity).
 * - Training bots are allowed too; this is a public marketing site whose goal
 *   is to be known and cited by AI systems.
 * - Googlebot and Applebot are the classic search crawlers behind Google AI
 *   features and Apple's assistant surfaces.
 */
const WELCOME_CRAWLERS = [
  "Googlebot",
  "Applebot",
  "Bingbot",
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
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
      ...WELCOME_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow: PRIVATE_PATHS,
      })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
