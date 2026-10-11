import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your analyses",
  robots: { index: false, follow: false },
};

export default function HistoryLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
