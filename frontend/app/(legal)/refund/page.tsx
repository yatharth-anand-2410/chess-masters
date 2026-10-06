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
      <p className="legal-updated">Last updated: October 6, 2026</p>

      <h2>Refunds &amp; cancellations</h2>
      <p>
        Since our AI incurs server costs for every game analyzed, we do not
        offer refunds once a game pack has been partially or fully used. If you
        accidentally purchase a pack and have not analyzed any paid games yet,
        please contact us within 7 days for a full refund.
      </p>
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
