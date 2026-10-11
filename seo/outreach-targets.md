# Why AI answer engines list 40 competitors and not us — and the fix

Observed 12 October 2026: asking an AI answer engine (Perplexity-style, with
source badges) for "best AI chess game analyzer" and then "next 10" produced
**40 tools in a row — with Chessmasters in none of them.** The site had been
live with all GEO fixes for about one day.

## What that output actually proves

It is **not** a technical failure. It is a **source-layer** result. The 40
tools split into three groups, each backed by a specific citation source:

| Group | Examples from the list | Why they appear |
| --- | --- | --- |
| **Listicle-backed tools** | Audit Chess, Chessigma, Chessiro, DecodeChess, Aimchess, Chessify, ChessGrader, Chess It Up, WintrChess, Matal, VariChess, NexoChess | They are named in "best chess analysis tools" articles that the engine retrieves and cites. |
| **The publishers themselves** | Chessvia, Audit Chess, Chessiro, PlaySquareOne, ChessDock | They *write* the comparison content the engine quotes. Their own articles are the sources. |
| **Reference/desktop staples** | Lichess, Chess.com, Stockfish, ChessBase, Fritz, Lucas Chess, SCID, PyChess, Banksia… | Permanent reference entities, cited from Wikipedia/GitHub/official sites. |

The encouraging part: **small, brand-new tools get listed too** (Chess It Up,
VariChess, NexoChess, ChessGrader — none of them giants). You do not need
scale to enter the pool. You need to appear in the *sources the engine reads*:
comparison articles, Reddit threads, and directory/GitHub surfaces. Right now
Chessmasters appears in exactly none of them (only a cAImpare profile and a
niche Peerlist post exist).

Timeline context: the pages were deployed ~24h before the test. Search engines
have not even recrawled them yet. Nothing in an AI answer today *can* come from
a site that isn't indexed yet.

## The fix — in priority order

### 1. Force indexing (this week, only the owner can)

- Google Search Console → URL Inspection → **Request indexing** for all 9 URLs.
- Bing Webmaster Tools → submit sitemap + **Submit URLs** (ChatGPT/Perplexity
  retrieval pipelines lean on Bing).
- Re-check GSC "Pages" report after 48–72h; new pages should move to Indexed.

### 2. Listicle outreach (the highest-leverage GEO work — starts now)

Every tool in the 40-item answer is listable because a list *names* it. Pitch
the sites below. Target list from the actual citation patterns observed:

| # | Publisher | Article to get into | Angle |
| --- | --- | --- | --- |
| 1 | Chessvia | `chessvia.ai/blog/chess-com-alternative`, `best-chess-analysis-site` | The plain-English bucket they already argue for — we do it with an AIM coach |
| 2 | Audit Chess | `auditchess.com/features/game-review` (they compare tools themselves) | "Recurring weakness detection" is their pitch — ours comes with psychological profile |
| 3 | Chessiro | `chessiro.com/blog/best-chess-analysis-tools` | Honest comparison piece — offer the ₹399 India pricing story as a category angle |
| 4 | MyChessPlan | `mychessplan.com/…decodechess-review` pattern — they review tools | Offer a review key; the "tilt/composure profile" is genuinely new for them |
| 5 | Improve my Chess | `improvemychess.co/learn/best-ai-chess-coaches-2026` | They segment by rating band — we target 800–1800 with both platforms supported |
| 6 | CheckmateX | their review blog | We work on Lichess **and** Chess.com from a URL — they note gaps in competitors |
| 7 | PlaySquareOne | `playsquareone.com/guides/game-review-vs-coach` | Their exact thesis: review vs coach — we are a concrete third option |
| 8 | ChessDock | `chessdock.com/learn/chess-com-game-review-vs-chessdock` | Same comparison genre — ask to be included as a non-competitor alternative |

**Email template** (one at a time, personalized first line, no marketing voice):

> Subject: Chessmasters — free access for your {article title}
>
> Hi {name} — I read your {article title}. {One specific thing that was fair /
> useful about it, e.g. "you're one of the few who's honest about Chess.com's
> free-tier review limits."}
>
> I built Chessmasters: an AI analyzer that turns a Chess.com/Lichess game into
> a plain-English coaching report — Stockfish enrichment, five structured
> sections, and the tactical motif named behind each turning point. Coaching
> logic is designed with a FIDE Arena International Master, and after three
> games it builds a tilt/composure profile of the player.
>
> Free account if you want to test it for a minute: {link}. Happy to answer
> anything — including where it's weaker than the tools you already list.

**Cadence:** 2 per week. A single inclusion in a published comparison is worth
more than any on-site change at this point — this is the 0.664 lever.

### 3. Reddit (Perplexity's #1 source class)

Perplexity pulls ~47% of top-10 sources from Reddit. The engine already cites
threads like `r/chessbeginners` "chess.com review feature alternatives". Join
those exact conversations honestly:

- Disclose you build Chessmasters when relevant; answer the question first.
- Best thread archetypes: "alternatives to game review", "how do I find
  recurring mistakes", "is DecodeChess worth it", "best way to review lichess".
- 4–6 substantive replies/month, no link-dropping.

### 4. Directories + Product Hunt (entity footprint)

- Fix the PH name/tagline (still "Chess Masterss … loose").
- AlternativeTo listing (as alternative to: DecodeChess, Chess.com Game Review,
  Aimchess) — AlternativeTo pages are citation-prone.
- SaaSHub + 2–3 AI-tool directories. Each listing is another source an engine
  can pull from.

### 5. Keep the on-site engine running

The seven content pages are live and machine-readable (GEO 89/100). They will
begin to rank for long-tail queries once crawled — and *our own comparison
pages* are exactly the content type the engines cite. They need 4–8 weeks.

## Re-test schedule

| When | What to check | Expected |
| --- | --- | --- |
| +3 days | GSC Pages report | New URLs moving to Indexed |
| +2 weeks | Brand prompt: "Chessmasters" in the same engine | Domain/listing appears |
| +4 weeks | "best AI chess game analyzer" | Occasional listing if 2+ listicles landed |
| +8–12 weeks | The full 12-prompt panel | Consistent mention on brand + some category prompts |
