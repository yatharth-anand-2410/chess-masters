"use client";

import dynamic from "next/dynamic";

// Purely decorative, so it loads after the page and stays out of the server
// HTML (no stray board coordinates in the page text).
const ScrollChessBackground = dynamic(
  () => import("./ScrollChessBackground"),
  { ssr: false }
);

/**
 * One board behind the whole site. It is mounted once in the root layout so it
 * keeps its place while people move between pages. Every page shows it at the
 * same strength as the landing page (the "hero" vignette keeps text legible).
 */
export default function SiteBackground() {
  return <ScrollChessBackground intensity="hero" />;
}
