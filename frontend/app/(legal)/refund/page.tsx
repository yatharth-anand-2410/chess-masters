import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, SITE_NAME } from "../../../lib/site";

export const metadata: Metadata = {
  title: `Refund & Cancellation Policy · ${SITE_NAME}`,
  description: "Chessmasters refund and cancellation policy.",
};

export default function RefundPage() {
  return (
    <>
      <h1>Refund &amp; Cancellation Policy</h1>
      <p className="legal-updated">Last updated: September 30, 2026</p>

      <h2>Refunds</h2>
      <p>
        <strong>
          All purchases are final. No refunds will be processed.
        </strong>
      </p>
      <p>
        {SITE_NAME} is a digital service that gives you immediate access to AI
        coaching reports, so we do not offer refunds for any period of a
        subscription.
      </p>

      <h2>Cancellation</h2>
      <ul>
        <li>
          You can cancel at any time from the{" "}
          <Link href="/subscription">Subscription page</Link>.
        </li>
        <li>
          When you cancel, your plan stays active until the end of the current
          billing period, and you will not be charged again.
        </li>
        <li>You can also pause your subscription instead of cancelling.</li>
      </ul>

      <h2>Failed or duplicate payments</h2>
      <p>
        If you were charged in error, for example a duplicate charge, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> within 7 days of
        the charge and we will review it.
      </p>

      <h2>Contact</h2>
      <p>
        Billing questions? Email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </>
  );
}
