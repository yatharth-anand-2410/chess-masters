import Link from "next/link";
import { SITE_NAME } from "../../lib/site";

export default function ContentLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="dashboard legal-dashboard content-dashboard">
      <header className="topbar flex items-center justify-between gap-4 flex-wrap">
        <Link href="/" className="wordmark inline-flex items-baseline gap-2 font-serif text-xl font-semibold text-[var(--text)]">
          <span className="wordmark-glyph text-[var(--gold)]" aria-hidden="true">
            ♜
          </span>
          {SITE_NAME}
        </Link>
        <div className="topbar-actions flex items-center gap-3 text-xs sm:text-sm font-medium flex-wrap">
          <Link href="/" className="nav-link text-[var(--text-muted)] hover:text-white transition-colors">
            Analyze a game
          </Link>
          <Link href="/faq" className="nav-link text-[var(--text-muted)] hover:text-white transition-colors">
            FAQ
          </Link>
          <Link href="/subscription" className="nav-link text-[var(--text-muted)] hover:text-white transition-colors">
            Pricing
          </Link>
        </div>
      </header>
      <article className="legal-page content-page">{children}</article>
    </main>
  );
}
