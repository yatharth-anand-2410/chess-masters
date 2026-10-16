import Link from "next/link";
import { CONTACT_EMAIL, SITE_NAME } from "../lib/site";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-row">
          <p className="site-footer-brand">
            <span className="wordmark-glyph" aria-hidden="true">
              ♜
            </span>
            {SITE_NAME}
          </p>
          <nav className="site-footer-links" aria-label="Legal">
            <Link href="/about">About</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/terms">Terms &amp; Conditions</Link>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/refund">Refund &amp; Cancellation Policy</Link>
          </nav>
        </div>
        <nav
          className="site-footer-links site-footer-explore"
          aria-label="Guides and resources"
        >
          <Link href="/chess-game-analyzer">AI Chess Game Analyzer</Link>
          <Link href="/chess-com-game-review-alternative">
            Chess.com Game Review alternative
          </Link>
          <Link href="/lichess-game-analysis">Lichess game analysis</Link>
          <Link href="/how-to-analyze-your-chess-games">
            How to analyze your games
          </Link>
          <Link href="/sample-report">Sample report</Link>
          <Link href="/tactics">Chess tactics</Link>
          <Link href="/faq">FAQ</Link>
        </nav>
        <p className="site-footer-note">
          Questions? Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. ©{" "}
          {new Date().getFullYear()} {SITE_NAME}.
        </p>
        <div className="site-footer-badges">
          <a
            href="https://tools.cafe"
            target="_blank"
            rel="noopener"
            aria-label="Featured on tools.cafe"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://tools.cafe/b/light.svg"
              alt="Featured on tools.cafe"
              width={256}
              height={80}
            />
          </a>
          <a
            href="https://www.producthunt.com/products/chess-masterss/reviews/new?utm_source=badge-product_review&utm_medium=badge"
            target="_blank"
            rel="noopener"
            aria-label="Chessmasters on Product Hunt — leave a review"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="site-footer-badge-ph"
              src="https://api.producthunt.com/widgets/embed-image/v1/product_review.svg?product_id=1337951&theme=light"
              alt="Chessmasters on Product Hunt — leave a review"
              width={250}
              height={54}
            />
          </a>
        </div>
        <p className="site-footer-note site-footer-disclaimer">
          {SITE_NAME} is an independent analysis tool built by chess enthusiasts.
          We are not affiliated with, endorsed by, or sponsored by Chess.com,
          Lichess.org, or the Stockfish project. All trademarks are the property
          of their respective owners.
        </p>
      </div>
    </footer>
  );
}
