import Link from "next/link";

export default function UpgradePage() {
  return (
    <main className="dashboard">
      <div className="upgrade-prompt upgrade-hero">
        <h1>Unlock More Coaching</h1>
        <p>Paid plans will include:</p>
        <ul>
          <li>Unlimited game analyses</li>
          <li>Q&A with your chess coach</li>
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