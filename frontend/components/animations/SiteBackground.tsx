"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

// Purely decorative, so it loads after the page and stays out of the server
// HTML (no stray board coordinates in the page text).
const ScrollChessBackground = dynamic(
  () => import("./ScrollChessBackground"),
  { ssr: false }
);

/**
 * One board behind the whole site. It is mounted once in the root layout so it
 * keeps its place while people move between pages. The landing page gets the
 * full-strength version; every other page gets a quiet one so text stays
 * readable.
 */
export default function SiteBackground() {
  const pathname = usePathname();
  return (
    <ScrollChessBackground intensity={pathname === "/" ? "hero" : "ambient"} />
  );
}
