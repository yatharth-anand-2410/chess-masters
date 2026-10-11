# SEO & GEO operations

This folder tracks the search and AI-visibility work for **Chessmasters**
(https://www.chessmasterss.in). It is documentation, not code — the code
changes live in `frontend/`.

## What is here

| File | Purpose |
| --- | --- |
| `geo-baseline-2026-10-11.md` | The measured starting point (GEO score 43/100) and how to re-run the audit. |
| `prompt-panel.md` | The monthly AI-visibility prompt panel: fixed prompts, fixed engines, recorded results. |
| `off-page-playbook.md` | Reddit, YouTube, listings, outreach, name normalization — the compounding work. |
| `outreach-targets.md` | The 40-tool AI-answer analysis and the exact listicles/threads to get into. |
| `vercel-abuse-report.md` | Draft complaint about the unrelated `chessmasterss.vercel.app` site. |

## Cadence

- **Monthly:** re-run the GEO audit (command in the baseline doc) and fill in a
  new column in the prompt panel. Check the squatter doesn't surface for brand
  queries.
- **Quarterly:** refresh content pages (Claude's citation preference skews to
  pages updated within ~6 months), re-verify competitor claims in the
  comparison page.
- **After every deploy that changes pages:** run `node scripts/indexnow.mjs`
  so Bing's index (ChatGPT's retrieval source) picks the changes up.
  First submit the sitemap once manually in Bing Webmaster Tools.

## Tooling (already installed on the primary workstation)

- `uvx --from geo-optimizer-skill geo audit --url <URL>` — GEO/SEO audit with
  score, per-category breakdown, and fix list. Also available as an MCP server
  (`geo-optimizer`) in Claude Code, and as `geo fix`, `geo llms`, `geo schema`.
- `geoskills` CLI + the geo-skills Agent Skills (`geo-*`, `seo-audit`,
  `schema-markup`, `ai-seo`, ...) in Claude Code and OpenCode.

## Ground rules

1. **No fabricated proof.** No invented reviews, ratings, testimonials, or
   benchmarks in schema or copy. `aggregateRating` schema stays out until real
   reviews exist at volume.
2. **Parth reviews every content page** before it publishes. The byline is
   his real name and credential. ✅ Verified 11 October 2026 — the seven
   content pages shipped as reviewed.
3. **Facts live in one place.** Product facts (pricing, limits, supported
   platforms, section names) live in `frontend/lib/site.ts` and
   `frontend/lib/faqs.ts` — update those before editing pages.

## Verified entity references (schema `sameAs`)

- Product Hunt: https://www.producthunt.com/products/chess-masterss
- Nicheloom: https://www.nicheloom.com/launches/45694/
- cAImpare: https://caimpare.ai/tool/78319
