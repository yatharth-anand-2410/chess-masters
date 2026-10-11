# GEO baseline — 11 October 2026

Measured against the live site (https://www.chessmasterss.in) with:

```bash
uvx --from geo-optimizer-skill geo audit --url https://www.chessmasterss.in --format text
```

## Score at baseline

**GEO Score: 43 / 100** (band: "foundation" — core elements missing).

| Category | Score | What was missing |
| --- | --- | --- |
| robots.txt | 11 / 18 | AI citation bots not explicitly named |
| llms.txt | 0 / 18 | No `/llms.txt` |
| Schema JSON-LD | 0 / 16 | Zero structured data |
| Meta tags | 7 / 14 | No canonical, no Open Graph |
| Content | 8 / 12 | 278-word homepage; "chess" at 4.7% density (−3 penalty) |
| Signals | 3 / 6 | No RSS, no dates |
| Brand & entity | 2 / 10 | No entity signals (`sameAs`, founders, contact) |
| AI discovery | 0 / 6 | No `ai.txt` or `/ai/*.json` |
| Google AI search | 15 / 20 | No canonical, no publication date, no byline |

Other measured facts at baseline:

- Google Search Console verified (`google287a78b5a11df75d.html` in `/public`).
- Every route inherited the root `<title>`; `/subscription` and `/upgrade`
  were public with 101 words and duplicate metadata.
- No content layer at all: no guides, no comparison page, no FAQ, no sample
  report, no tactics material.
- `chessmasterss.vercel.app` is indexed as a **different, unrelated chess
  site** (see `vercel-abuse-report.md`).

## What shipped to address it (Phase 2 + 3, same date)

- Per-route canonical URLs, Open Graph/Twitter metadata, generated OG image,
  RSS feed (`/feed.xml`), and a title template.
- JSON-LD: Organization (founders with `sameAs`, contactPoint), WebSite,
  SoftwareApplication (offers), Article, BreadcrumbList, FAQPage, Person.
- `robots.ts` with explicit allows for retrieval and training bots
  (OAI-SearchBot, ChatGPT-User, Claude-*, Perplexity*, GPTBot, Bingbot, ...).
- `app/sitemap.ts` replacing the stale hand-written `public/sitemap.xml`.
- `/llms.txt`, `/llms-full.txt`, `/ai/summary.json`, `/ai/faq.json`,
  `/ai/service.json`, `/.well-known/ai.txt`.
- Content layer: `/chess-game-analyzer`,
  `/chess-com-game-review-alternative`, `/lichess-game-analysis`,
  `/how-to-analyze-your-chess-games`, `/sample-report`, `/tactics`, `/faq` —
  each with a byline (Parth Kaushik, FIDE AIM), dates, FAQ schema, and
  internal linking.
- Homepage FAQ (10 Q&A pairs) so the landing page is no longer thin.
- IndexNow key deployed; `scripts/indexnow.mjs` submits URLs to Bing after
  deploys.

## How to re-measure

```bash
uvx --from geo-optimizer-skill geo audit --url https://www.chessmasterss.in --format text
```

Record the score and the breakdown in this file each month (append a dated
section), and compare against the prompt panel results.

## Verification notes (11 October 2026)

A re-audit through a temporary public tunnel (Cloudflare quick tunnels block
localhost) showed **72/100** with several readings that are known tunnel
artifacts, not site problems:

- `G-INDEX: noindex` and `G-CANONICAL: conflicting signals` — Cloudflare
  injects `X-Robots-Tag: noindex` on quick tunnels. The real HTML contains
  `<meta name="robots" content="index, follow">`. **Re-run the audit against
  production after deploying — this is the authoritative measurement.**
- `llms.txt` scored full marks (6/6).

Real items addressed after that audit:

- Added a visible "Reviewed by Parth Kaushik, AIM · Last updated" line to the
  homepage FAQ (fixes the G-DATES / G-BYLINE / author-signal checks).
- Reduced keyword density on the homepage (FAQ copy now avoids repeating
  "game" in every answer).

Known, unfixable-now items (do not fake them):

- Organization `sameAs` currently points to the Nicheloom and cAImpare
  listings. Add Wikipedia/Wikidata/Crunchbase/LinkedIn only when they genuinely
  exist (see `off-page-playbook.md`).
- `ai/service.json` may not satisfy the auditor's key expectations; it is a
  non-standard endpoint we publish anyway for agent consumers.
- Reviews are user-generated but render no links, so the UGC injection surface
  is text-only; keep the existing moderation in place.

**Target: 85+ within two weeks of the fixes being deployed.**

