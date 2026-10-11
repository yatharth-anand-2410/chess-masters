import Link from "next/link";
import { FAQS } from "../lib/faqs";
import { CONTENT_PUBLISHED_LABEL } from "../lib/site";

/**
 * Question-and-answer block. Rendered on the homepage and on /faq.
 * Answers are plain text so search and AI engines can extract them directly.
 */
export default function FaqSection({
  items = FAQS,
  showMoreLink = true,
  showMeta = false,
}: {
  items?: { question: string; answer: string }[];
  showMoreLink?: boolean;
  showMeta?: boolean;
}) {
  return (
    <section className="faq-panel" aria-labelledby="faq-title">
      <div className="section-head">
        <h2 id="faq-title">Frequently asked questions</h2>
      </div>
      {showMeta && (
        <p className="article-meta faq-meta">
          Reviewed by <Link href="/about">Parth Kaushik</Link>, FIDE Arena
          International Master (AIM).{" "}
          <span className="article-meta-updated">
            Last updated {CONTENT_PUBLISHED_LABEL}.
          </span>
        </p>
      )}
      <dl className="faq-list">
        {items.map((item) => (
          <div className="faq-item" key={item.question}>
            <dt>
              <h3>{item.question}</h3>
            </dt>
            <dd>
              <p>{item.answer}</p>
            </dd>
          </div>
        ))}
      </dl>
      {showMoreLink && (
        <p className="faq-more">
          Still have questions? <Link href="/faq">Read the full FAQ</Link> or{" "}
          <Link href="/contact">contact us</Link>.
        </p>
      )}
    </section>
  );
}
