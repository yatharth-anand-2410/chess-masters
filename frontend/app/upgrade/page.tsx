import Link from "next/link";

export default function UpgradePage() {
  return (
    <main className="dashboard">
      <header className="topbar">
        <Link href="/" className="wordmark">
          <span className="wordmark-glyph" aria-hidden="true">
            ♜
          </span>
          Rookmark
        </Link>
        <div className="topbar-actions">
          <Link href="/" className="nav-link">
            Back to dashboard
          </Link>
        </div>
      </header>

      <div className="upgrade-prompt upgrade-hero">
        <h1>Unlock more coaching</h1>
        <p>Paid plans will include:</p>
        <ul>
          <li>Unlimited game analyses</li>
          <li>Q&amp;A with your chess coach</li>
          <li>Additional coaching features</li>
        </ul>
        <p className="upgrade-note">Payments are being added shortly.</p>
        <Link className="btn" href="/">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
