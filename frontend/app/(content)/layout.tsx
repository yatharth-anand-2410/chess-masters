import React from "react";
import { Topbar } from "../../components/ui/Topbar";

export default function ContentLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {/* Full-width app chrome: the reading column below stays narrow. */}
      <Topbar />
      <main className="dashboard legal-dashboard content-dashboard">
        <article className="legal-page content-page">{children}</article>
      </main>
    </>
  );
}
