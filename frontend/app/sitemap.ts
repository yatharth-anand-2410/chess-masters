import type { MetadataRoute } from "next";
import { CONTENT_PUBLISHED, SITE_URL } from "../lib/site";

type RouteEntry = {
  path: string;
  changeFrequency: "weekly" | "monthly" | "yearly";
  priority: number;
};

const ROUTES: RouteEntry[] = [
  { path: "/", changeFrequency: "weekly", priority: 1.0 },
  { path: "/chess-game-analyzer", changeFrequency: "monthly", priority: 0.9 },
  {
    path: "/chess-com-game-review-alternative",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  { path: "/lichess-game-analysis", changeFrequency: "monthly", priority: 0.8 },
  {
    path: "/how-to-analyze-your-chess-games",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  { path: "/sample-report", changeFrequency: "monthly", priority: 0.8 },
  { path: "/tactics", changeFrequency: "monthly", priority: 0.7 },
  { path: "/faq", changeFrequency: "monthly", priority: 0.7 },
  { path: "/subscription", changeFrequency: "weekly", priority: 0.7 },
  { path: "/about", changeFrequency: "monthly", priority: 0.6 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.4 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/refund", changeFrequency: "yearly", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path === "/" ? "" : route.path}`,
    lastModified: CONTENT_PUBLISHED,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
