import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import "@lichess-org/chessground/assets/chessground.base.css";
import "@lichess-org/chessground/assets/chessground.brown.css";
import "@lichess-org/chessground/assets/chessground.cburnett.css";
import "./globals.css";
import SiteFooter from "../components/SiteFooter";
import { SITE_NAME, SITE_URL } from "../lib/site";

const display = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

const body = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${SITE_NAME} · AI Chess Game Analyzer`,
  description:
    "The smart AI chess game analyzer for Chess.com and Lichess. Get instant, plain-English coaching reports, uncover hidden tactical blunders, and master your opening repertoire in minutes.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable}`}>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
