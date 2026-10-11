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

## Final pre-deploy measurement (11 October, after all fixes)

Re-audit through the tunnel after the date/byline/AI-discovery fixes:

**79/100** — and the two remaining failures are proven tunnel artifacts:

| Check | Result | Note |
| --- | --- | --- |
| G-DATES | ✅ pass (2/2) | Visible `<time datetime>` + WebPage schema dates |
| G-BYLINE | ✅ pass (2/2) | `rel="author"` byline + Person schema |
| G-INDEX | ❌ (tunnel) | Cloudflare injects `X-Robots-Tag: noindex` on quick tunnels; production (`server: Vercel`) has no such header |
| G-CANONICAL | ⚠️ (tunnel) | Canonical correctly points at `chessmasterss.in`, which differs from the tunnel host |
| signals | 3 → 6 | RSS alternate link live |
| ai_discovery | 1 → 2 | `summary.json` + `service.json` now match the expected schema |
| negative | −3 → −1 | Remaining point is substring counting of "chess" inside the brand name |

Realistic production score: **~86** (G-INDEX +5 and G-CANONICAL +2 flip to pass
when the canonical matches the serving host). Verify after deploy.

## Production result (11 October, deployed)

**89/100 — "excellent" band.** Deployed to https://www.chessmasterss.in via
`vercel --prod` (commit `d21fbcb`), verified against the live domain.

| Category | Baseline | Production |
| --- | --- | --- |
| robots.txt | 11 | **14 / 14** |
| llms.txt | 0 | **6 / 6** |
| Schema | 0 | 12 / 16 |
| Meta | 7 | 11 / 14 |
| Content | 8 | 12 / 12 |
| Signals | 3 | **6 / 6** |
| AI discovery | 0 | 2 / 6 |
| Brand & entity | 2 | 7 / 10 |
| Negative (density) | −3 | −1 |
| Google AI readiness | 15 / 20 | **20 / 20** |
| **Total** | **43** | **89** |

Remaining recommendations are known and accepted (documented below):
Wikipedia/Wikidata/Crunchbase `sameAs` (do not fake), "chess" substring
density inside the brand name, moderated UGC review panel, WebMCP.

IndexNow submission accepted (HTTP 202) for all 10 primary URLs.

## GSC ground truth — verified 12 October 2026

From the owner's Google Search Console (Domain property `chessmasterss.in`):

| Signal | Value | Meaning |
| --- | --- | --- |
| Total clicks (3 months) | **3** | Real Google traffic exists |
| Total impressions | **11** | Google serves the site in results |
| Average CTR | 27.3% | Consistent with #1–2 positions |
| Average position | **1.6** | Ranks top-2 when matched |
| Data window | Oct 5–9 | Site entered Google's index ~Oct 5 |
| Page Indexing report | "Processing data" | New property — report builds in 3–5 days |

**Interpretation:** the site is indexed and ranks ~#1.5 for the queries it
matches — but those queries are brand-name searches only (11 impressions in a
week is the founder/friends level of volume, not demand). Category queries
("best AI chess game analyzer") have real volume and remain unwon; that is
what the content layer and the outreach in `outreach-targets.md` are for.

**Sitemap status (12 Oct):** submitted, Status: Success, but **Last read: Oct 9
— Discovered pages: 7**. That is the OLD 7-URL sitemap; the new 14-URL sitemap
shipped Oct 11 and has not been re-read yet. Re-submitting the same sitemap URL
queues a fresh read (expect "Discovered pages: 14" within days).

GSC also exposes a **generative AI performance report** for the property
("Performance in generative AI features" card) — open it periodically; it is
Google's own reporting surface for AI Overviews / AI Mode appearances.

### How to read the Pages report when it populates (check after 2–3 days)

| Reason shown | Meaning | Action |
| --- | --- | --- |
| "Discovered — currently not indexed" | Normal for a new site; Google queued it | Wait; Request indexing; get links |
| "Crawled — currently not indexed" | Google saw it, judged it low-priority | More authority: mentions, listicles |
| "Excluded by noindex" | Real problem | Check metadata — report to me immediately |
| "Blocked by robots.txt" | Real problem | Check robots.ts on prod |
| "Blocked due to unauthorized request (401)" | Deployment protection | Check Vercel settings |
| "Alternate page with proper canonical" | Consolidation, fine | None |

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

