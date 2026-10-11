import Link from "next/link";
import { SITE_NAME } from "../../lib/site";

export default function ContentLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="dashboard legal-dashboard content-dashboard">
      <header className="topbar">
        <Link href="/" className="wordmark">
          <span className="wordmark-glyph" aria-hidden="true">
            ♜
          </span>
          {SITE_NAME}
        </Link>
        <div className="topbar-actions">
          <Link href="/" className="nav-link">
            Analyze a game
          </Link>
          <Link href="/faq" className="nav-link">
            FAQ
          </Link>
          <Link href="/subscription" className="nav-link">
            Pricing
          </Link>
        </div>
      </header>
      <article className="legal-page content-page">{children}</article>
    </main>
  );
}
