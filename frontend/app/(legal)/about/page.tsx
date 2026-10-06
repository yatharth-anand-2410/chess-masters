import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAME } from "../../../lib/site";

export const metadata: Metadata = {
  title: `About · ${SITE_NAME}`,
  description:
    "Meet the competitive chess team behind Chessmasters: a FIDE Arena International Master (AIM) with a 2300+ peak rating and the engineer who built the AI analysis engine.",
};

export default function AboutPage() {
  return (
    <>
      <h1>About {SITE_NAME}</h1>
      <p className="legal-updated">
        Built by competitive players who wanted post-game feedback to feel like a
        lesson, not a spreadsheet.
      </p>
      <p>
        Chessmasters is an AI chess game analyzer for Chess.com and Lichess. Every
        report is designed alongside a FIDE Arena International Master (AIM) and a
        2300+ peak rated Chess.com instructor, so the advice reads the way a strong
        human coach would explain it.
      </p>

      <h2>Meet the Team</h2>

      <h3>Parth Kaushik &ndash; Co-Founder &amp; Chess Pedagogy</h3>
      <p>
        Parth holds the FIDE Arena International Master (AIM) title and a peak
        rating of 2300+ on Chess.com, and is a competitive chess instructor who has
        coached students globally. He designed the coaching logic that powers
        Chessmasters, with one goal: the AI should not just spit out optimal lines,
        but identify the human psychological and tactical patterns &mdash; like
        &ldquo;hope chess&rdquo; or ignoring pins &mdash; that hold club players
        back.
      </p>

      <h3>Yatharth Anand &ndash; Co-Founder &amp; Lead Architect</h3>
      <p>
        Yatharth engineered the backend infrastructure that integrates real-time
        Stockfish evaluation with advanced AI language models. His focus is a
        lightning-fast, minimal dashboard that gets out of your way and lets you
        focus entirely on your chess improvement.
      </p>

      <h2>Our Philosophy</h2>
      <ul>
        <li>
          <strong>Context over calculation:</strong> finding a missed forced mate is
          great, but understanding why you allowed your opponent&apos;s counter-attack
          in the Sicilian is how you actually gain Elo.
        </li>
        <li>
          <strong>Actionable focus areas:</strong> we don&apos;t just point out
          blunders &mdash; we give you the exact tactical themes (like deflection or
          zugzwang) you need to study next.
        </li>
        <li>
          <strong>Accessible excellence:</strong> elite-level game analysis
          shouldn&apos;t be locked behind massive paywalls or require a grandmaster
          budget. We are democratizing the post-game review.
        </li>
      </ul>

      <p className="about-tagline">
        Your next lesson is hiding in your last game.
      </p>
      <p className="about-cta">
        <Link className="btn" href="/">
          Analyze a Game Now
        </Link>
      </p>
    </>
  );
}
