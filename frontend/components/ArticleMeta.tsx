import Link from "next/link";
import { CONTENT_PUBLISHED_LABEL } from "../lib/site";

/**
 * Editorial byline + freshness stamp for content pages. Every page that uses
 * this must be reviewed by Parth Kaushik before publishing.
 */
export default function ArticleMeta({
  updated = CONTENT_PUBLISHED_LABEL,
  showReviewedBy = true,
}: {
  updated?: string;
  showReviewedBy?: boolean;
}) {
  return (
    <p className="article-meta">
      {showReviewedBy && (
        <>
          Reviewed by{" "}
          <Link href="/about">Parth Kaushik</Link>, FIDE Arena
          International Master (AIM).{" "}
        </>
      )}
      <span className="article-meta-updated">Last updated {updated}.</span>
    </p>
  );
}
