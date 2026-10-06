# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing codebase answers this: Next.js 15 (App Router) + TypeScript frontend, FastAPI + python-chess + google-genai backend, Supabase auth, Razorpay billing. This document was written during a UI exploration task; no new stack decision is implied.

## Users

Beginner-to-intermediate online chess players, roughly 800–1800 Elo, who play on Lichess or Chess.com and want narrative positional feedback in plain language instead of raw engine numbers. They typically review after a completed game, on desktop or phone, and are motivated to improve but not yet fluent in engine output.

## Product Purpose

Paste a finished game (Lichess URL, or Chess.com username + URL) and receive a streamed, AI-written coaching report covering Strength, Weakness, Game Overview, Focus Areas, and Resources. Success means the player understands their game and knows exactly what to train next; commercial success means converting free users to the paid plan. (Assumed: no other success metric was stated.)

## Positioning

Coaching, not engine output: the report is written as a narrative lesson with named tactical motifs, board-diagrammed key moments, and deep links into specific Lichess training/study material — a mechanism raw engine analysis and generic game review do not match. The report is Engine-enriched (Stockfish centipawn loss, blunders) before Gemini writes it.

## Operating Context

- Two fetch paths: Lichess 8-char game ID → `GET lichess.org/game/export/{id}?evals=true`; Chess.com username + URL → archive scan over the last 3 months.
- Real-time delivery over SSE: `status_update`, `content_chunk`, `insights`, `done`, `error`; batch adds `batch_started`, `game_status`, `game_done`, `game_error`, `batch_status`.
- Batch: up to 5 games per submission, 1 credit per game.
- Users read reports on screen; key moments include embedded chessboards with arrows/highlights; paid users can ask follow-up questions per analysis.
- Public star-review system provides social proof.

## Capabilities and Constraints

- Free plan: 5 analyses total. Paid: ₹399/month via Razorpay, 100 analyses per billing period, Q&A coaching enabled. Pause/resume/cancel and invoices supported.
- Auth: Google OAuth via Supabase only; analysis, history, and batch pages are signed-in only.
- Report content contract: markdown with the five canonical sections; custom inline tags `<EvalChart .../>` and `<AccuracyChart .../>`; Lichess resources restricted to real training slugs or study-search URLs.
- Terminology: the product name is "Chessmasters"; report sections use the exact headings above.
- Legal: terms/privacy/refund/contact pages exist; refunds are stated as final; footer states no affiliation with Lichess or Chess.com.
- Undecided: whether the PRD's Silman book-recommendation feature should be surfaced in UI (built backend-agnostic, never shipped); phone parity requirements beyond responsive web.

## Brand Commitments

- Name "Chessmasters" with wordmark displayed in Fraunces.
- Current visual identity (dark ink/gold/parchment) is the incumbent world; a 2026-10 design exploration is evaluating replacement directions, so no binding commitment beyond the name and price points.
- Voice: instructive and direct, addressed to the player ("your game"), never hypey.

## Evidence on Hand

- Real product mechanics, pricing, limits, and section names from `Product Requirements Document.md`, `Chess Analyzer Architecture.md`, `Lichess Routing Logic.md`, and the implemented frontend.
- No real user testimonials, logos, press, or performance benchmarks exist; marketing surfaces must not fabricate them. Sample review content in design mockups must be labeled as placeholder.
- No screenshot or imagery assets exist; visual mockups are authored from scratch.

## Product Principles

1. The report is the product: the coaching document must feel worth reading, not just generated.
2. Plain language beats engine numbers; every number shown must serve a lesson.
3. Show the evidence: board diagrams, motifs, and named moves ground every claim.
4. Real-time is a feature: the stream should make 10–15 seconds of analysis feel like work happening, not a spinner.
5. Trust is the business: honest limits, honest pricing, no fabricated proof.

## Accessibility & Inclusion

No product-specific standard established beyond baseline web practice (semantic markup, focus-visible, reduced-motion support already present in the incumbent UI).
