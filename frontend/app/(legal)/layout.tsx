import Link from "next/link";
import { SITE_NAME } from "../../lib/site";

export default function LegalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="dashboard legal-dashboard">
      <header className="topbar">
        <Link href="/" className="wordmark">
          <span className="wordmark-glyph" aria-hidden="true">
            ♜
          </span>
          {SITE_NAME}
        </Link>
        <div className="topbar-actions">
          <Link href="/" className="nav-link">
            Back to the analyzer
          </Link>
        </div>
      </header>
      <article className="legal-page">{children}</article>
    </main>
  );
}
