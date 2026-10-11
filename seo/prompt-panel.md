# AI visibility prompt panel

Run this on the **first working day of each month**. Fixed prompts, fixed
engines, recorded results — the point is trends, not single readings.

## Engines

1. ChatGPT (with search/browsing enabled)
2. Claude (with web search)
3. Google: AI Overviews / AI Mode (ask in Google as a logged-in user; note
   whether an AI answer appeared)
4. Perplexity (optional but cheap to add)

## Prompts

Ask each prompt fresh (new chat) in each engine. Record: **Mentioned?**
(yes/no), **Cited URL(s)** if any, **Position** (how early in the answer),
**Notes** (sentiment, which competitors surfaced).

| # | Prompt | Intent |
| --- | --- | --- |
| 1 | best AI chess game analyzer | Category head term |
| 2 | how to analyze my chess.com games | Problem-aware |
| 3 | chess.com game review alternative | Competitor switching |
| 4 | free chess game analysis online | Free-tool intent |
| 5 | AI chess coach for club players | Positioning |
| 6 | how to analyze a lichess game | Platform-specific |
| 7 | tools to improve at chess under 1500 | Segment |
| 8 | chess game analysis tool india | Geography + price |
| 9 | chessmasters | Brand check |
| 10 | chessmasters ai chess analyzer | Brand + descriptor |
| 11 | best way to review chess games | Methodology |
| 12 | AI tools that explain chess blunders | Differentiator |

## Pre-run check — 2026-10-12 (one day after deploy)

Tested from the dev environment the day after the production deploy:

| Test | Result |
| --- | --- |
| Googlebot UA → new pages | ✅ 200, content server-rendered, no noindex |
| GSC verification file | ✅ live |
| non-www → www | ✅ consolidates to www, canonical matches |
| Search backend: brand query | ❌ domain not surfacing yet (listings + squatter do) |
| Search backend: category queries | ❌ absent (competitors: Chessvia, playsquareone, chessdock) |
| `site:` query | ❌ nothing yet |
| Google AI grounded queries | ⚠️ untestable — API key has no Search-grounding quota (production model itself healthy) |
| ChatGPT / Claude / Perplexity | ⚠️ untestable from dev env (no API keys) |

**Interpretation:** no technical blocker. One day after deploy, absence from
search and AI answers is expected — indexing takes days–weeks and citations
follow authority, which is zero until the off-page work happens. Re-test
brand terms in ~2 weeks; category terms are a 3–6 month horizon.

Manual checks the owner can run any time: `site:chessmasterss.in` in Google,
and the 12 prompts in the panel above asked directly in ChatGPT and Claude.

## Monthly record

Copy this block per month.

### 2026-11 (first run — expected sparse, the content shipped mid-October)

| Prompt | ChatGPT | Claude | Google AI | Perplexity | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |
| 7 | | | | | |
| 8 | | | | | |
| 9 | | | | | |
| 10 | | | | | |
| 11 | | | | | |
| 12 | | | | | |

## How to read results

- Citation sets swing ~50% month over month across engines; react to
  **direction over 2–3 months**, not single dips.
- If a prompt never mentions Chessmasters but consistently cites listicles
  ("best chess analysis tools"), that is an outreach target — see
  `off-page-playbook.md`.
- Brand prompts (9, 10) are the canary for the `vercel.app` squatter problem.
