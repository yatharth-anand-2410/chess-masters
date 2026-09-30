import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import "@lichess-org/chessground/assets/chessground.base.css";
import "@lichess-org/chessground/assets/chessground.brown.css";
import "@lichess-org/chessground/assets/chessground.cburnett.css";
import "./globals.css";
import SiteFooter from "../components/SiteFooter";
import { SITE_NAME } from "../lib/site";

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
  title: `${SITE_NAME} · AI Chess Game Analyzer`,
  description:
    "Paste a Lichess or Chess.com game and get an AI coaching report written around the moves you played.",
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
