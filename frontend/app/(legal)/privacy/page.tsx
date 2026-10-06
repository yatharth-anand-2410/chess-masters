import type { Metadata } from "next";
import { CONTACT_EMAIL, SITE_NAME } from "../../../lib/site";

export const metadata: Metadata = {
  title: `Privacy Policy · ${SITE_NAME}`,
  description: "What Chessmasters stores, why, and what we never do with your data.",
};

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="legal-updated">Last updated: October 6, 2026</p>
      <p>
        {SITE_NAME} turns your finished chess games into coaching reports. This
        page explains, in plain English, what we store and why.
      </p>

      <h2>Data collection and usage</h2>
      <p>
        When you sign in with Google, we only collect your email address and
        basic profile information to create your account and save your chess
        reports. We do not sell your personal data to third parties. Your chess
        game links and analysis data are stored securely so you can review them
        later. You can request to delete your account and data at any time by
        contacting us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>Payments</h2>
      <p>
        Payments are processed by Razorpay. We never see or store your card
        details; Razorpay handles your payment information under its own privacy
        policy.
      </p>

      <h2>Lichess &amp; Chess.com integration</h2>
      <p>
        We use the public Lichess and Chess.com APIs to fetch the game data you
        ask us to analyze. By using this tool, you also agree to the Lichess
        Terms of Service. Puzzle links redirect directly to Lichess.org.
      </p>

      <h2>Authentication &amp; storage</h2>
      <p>
        Sign-in and data storage are provided by Supabase, which stores your
        data securely on our behalf.
      </p>

      <h2>Deleting your data</h2>
      <p>
        You can ask us to delete your account and analyses at any time by
        emailing <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>Changes</h2>
      <p>If this policy changes, we will update this page.</p>
    </>
  );
}
