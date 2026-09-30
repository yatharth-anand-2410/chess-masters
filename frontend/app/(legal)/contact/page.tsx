import type { Metadata } from "next";
import { CONTACT_EMAIL, SITE_NAME } from "../../../lib/site";

export const metadata: Metadata = {
  title: `Contact · ${SITE_NAME}`,
  description: "Contact the Chessmasters team for support, billing, or feedback.",
};

export default function ContactPage() {
  return (
    <>
      <h1>Contact us</h1>
      <p className="legal-updated">We usually reply within 2 business days.</p>
      <p>
        The fastest way to reach us is by email. Whether it is a billing question,
        a bug report, or feedback on your coaching report, we read everything.
      </p>
      <p>
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
      <h2>What to include</h2>
      <ul>
        <li>Billing or subscription questions: the email you signed in with.</li>
        <li>Bug reports: the game URL you were analyzing and what went wrong.</li>
        <li>Data requests: tell us if you want your account and analyses deleted.</li>
      </ul>
    </>
  );
}
