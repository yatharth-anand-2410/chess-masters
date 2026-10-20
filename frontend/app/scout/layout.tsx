import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Opponent Scouting Dossiers & Repertoire Prep · Chessmasters",
  description:
    "Generate comprehensive tactical and psychological scouting reports for any Chess.com or Lichess opponent. Uncover time trouble habits, opening traps, and tilt triggers.",
  alternates: { canonical: "/scout", types: { "application/rss+xml": "/feed.xml" } },
  openGraph: {
    title: "Opponent Scouting Dossiers & Repertoire Prep · Chessmasters",
    description:
      "Deep tactical scouting dossiers on Chess.com and Lichess opponents: openings, blunder tendencies, and time trouble vulnerabilities.",
    url: "/scout",
  },
};

export default function ScoutLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
