import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Subscription & Plan Management",
  description:
    "Chessmasters plans: Pro Student at ₹399/month for serious club players and Master Coach at ₹1,999/month for FIDE trainers, each billed via Razorpay with a 14-day money-back guarantee. Pause, resume, or cancel anytime.",
  alternates: { canonical: "/subscription", types: { "application/rss+xml": "/feed.xml" } },
  openGraph: {
    title: "Subscription & Plan Management · Chessmasters",
    description:
      "Pro Student ₹399/month and Master Coach ₹1,999/month, billed via Razorpay with a 14-day money-back guarantee. Pause, resume, or cancel anytime.",
    url: "/subscription",
  },
};

export default function SubscriptionLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
