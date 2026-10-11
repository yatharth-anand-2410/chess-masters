import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing & Subscription",
  description:
    "Chessmasters pricing: 5 free game analyses, then ₹399 per month for 100 analyses per billing period with batch analysis and follow-up Q&A. Pause, resume, or cancel anytime.",
  alternates: { canonical: "/subscription", types: { "application/rss+xml": "/feed.xml" } },
  openGraph: {
    title: "Pricing & Subscription · Chessmasters",
    description:
      "5 free game analyses, then ₹399/month for 100 analyses per billing period. Pause, resume, or cancel anytime.",
    url: "/subscription",
  },
};

export default function SubscriptionLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
