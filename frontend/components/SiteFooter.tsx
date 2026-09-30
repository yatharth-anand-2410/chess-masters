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
            <Link href="/contact">Contact</Link>
            <Link href="/terms">Terms &amp; Conditions</Link>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/refund">Refund &amp; Cancellation Policy</Link>
          </nav>
        </div>
        <p className="site-footer-note">
          Questions? Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. ©{" "}
          {new Date().getFullYear()} {SITE_NAME}. Not affiliated with Lichess or
          Chess.com.
        </p>
      </div>
    </footer>
  );
}
