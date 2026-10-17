import type { Metadata } from "next";
import { DM_Mono, DM_Sans, Fraunces } from "next/font/google";
import "@lichess-org/chessground/assets/chessground.base.css";
import "@lichess-org/chessground/assets/chessground.brown.css";
import "@lichess-org/chessground/assets/chessground.cburnett.css";
import "./globals.css";
import "./styles/review.css";
import "./styles/progress.css";
import "./styles/students.css";
import "./styles/subscription.css";
import "./styles/studies.css";
import JsonLd from "../components/JsonLd";
import SiteFooter from "../components/SiteFooter";
import AICoachDrawer from "../components/AICoachDrawer";
import ManageStudentsModal from "../components/ManageStudentsModal";
import {
  ORGANIZATION_SCHEMA,
  schemaGraph,
  WEBSITE_SCHEMA,
} from "../lib/schema";
import { SITE_META_DESCRIPTION, SITE_NAME, SITE_URL } from "../lib/site";

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

const mono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} · AI Chess Game Analyzer`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_META_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: {
    types: { "application/rss+xml": "/feed.xml" },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
    },
  },
  openGraph: {
    siteName: SITE_NAME,
    type: "website",
    locale: "en",
    title: `${SITE_NAME} · AI Chess Game Analyzer`,
    description: SITE_META_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} · AI Chess Game Analyzer`,
    description: SITE_META_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} ${mono.variable}`}>
        <JsonLd data={schemaGraph([ORGANIZATION_SCHEMA, WEBSITE_SCHEMA])} />
        {children}
        <AICoachDrawer />
        <ManageStudentsModal />
        <SiteFooter />
      </body>
    </html>
  );
}
