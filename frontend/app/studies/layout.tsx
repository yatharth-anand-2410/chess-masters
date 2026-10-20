import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Curated Chess Studies & Master Training Library · Chessmasters",
  description:
    "Master curated Lichess studies tailored to your recurring weaknesses. Drill tactics, master openings, and build practical endgame habits with Arena International Master curricula.",
  alternates: { canonical: "/studies", types: { "application/rss+xml": "/feed.xml" } },
  openGraph: {
    title: "Curated Chess Studies & Master Training Library · Chessmasters",
    description:
      "Target your tactical leaks with curated Lichess studies and interactive drills designed by FIDE Arena International Master Parth Kaushik.",
    url: "/studies",
  },
};

export default function StudiesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
