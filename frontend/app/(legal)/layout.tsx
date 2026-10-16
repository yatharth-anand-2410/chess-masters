import React from "react";
import { Topbar } from "../../components/ui/Topbar";

export default function LegalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {/* Full-width app chrome: the reading column below stays narrow. */}
      <Topbar />
      <main className="dashboard legal-dashboard">
        <article className="legal-page">{children}</article>
      </main>
    </>
  );
}
