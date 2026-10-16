import type { Metadata } from "next";

export const metadata: Metadata = {
  // One token can carry a student report feed, a study or a tactic theme, so
  // the title stays kind-agnostic. The portal is never indexed.
  title: "Shared chess resource",
  robots: { index: false, follow: false },
};

export default function SharedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
