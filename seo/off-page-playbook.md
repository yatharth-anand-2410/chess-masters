# Off-page playbook (Phase 4 — the compounding work)

Where AI visibility actually comes from: brand mentions correlate **0.664**
with AI citation; backlinks correlate 0.218 (Ahrefs, 75k brands). Owned pages
are ~29% of citations; YouTube ~24% and rising; Reddit ~18% and falling;
Wikipedia ~10%. Plan accordingly.

## 1. Canonical descriptor (use everywhere, verbatim)

> Chessmasters is an AI chess game analyzer for Chess.com and Lichess that
> turns a finished game into a plain-English coaching report.

Directory listings, social bios, outreach emails, and video descriptions
should all carry this sentence. Consistent naming is what lets engines attach
your entity to the term.

**Fix outstanding inconsistencies:**
- [ ] Nicheloom listing says "Chess Masterss" — request a rename to
      "Chessmasters".
- [ ] Check any other directory that wrote a variant name.

## 2. Reddit (4–6 expert replies/month)

Where: r/chess, r/chessbeginners, r/lichess, r/ChessPuzzles.

Rules that keep this working:
- Disclose affiliation when mentioning Chessmasters ("I build Chessmasters,
  so take this with that in mind").
- Answer the question first, in full; mention the tool only when it is the
  honest recommendation.
- Never drop bare links. No burner accounts — models (and moderators) discount
  promotional patterns, and Reddit's anti-spam systems remove them anyway.

Good thread archetypes to search weekly: "how do I stop blundering",
"game review explained nothing", "how to analyze my games", "is DecodeChess
worth it", "best way to review lichess games".

## 3. YouTube (3–5 videos, transcripts on)

YouTube is the strongest single correlate of AI visibility measured so far and
Gemini's highest-weight source. Even a small channel with transcripts creates
a citable surface.

Video ideas:
1. "How I analyze my Chess.com games in 60 seconds" — screen recording of a
   real game → report → what changed in the next game.
2. "Chess.com Game Review vs an AI coaching report — the difference" — same
   game, both outputs, honest verdict.
3. "The 5-step chess game review routine" — companion to the guide page.
4. "Reading your first Chessmasters report" — walkthrough, section by section.
5. "Fork, pin, skewer: the 3 tactics that decide 1200 games".

Requirements: spoken transcript on (auto is fine), title = the query, first
line of the description = the canonical descriptor.

## 4. Product Hunt launch

One well-prepared launch produces a durable, cited page. Checklist:
- [ ] Founder account with history, not a fresh one.
- [ ] Gallery: 4–5 images (report screenshot, before/after, psychological
      profile, pricing).
- [ ] First comment: who it is for, what it is not, pricing honestly.
- [ ] Launch Tuesday–Thursday; rally the existing user base by email.
- [ ] Follow-up: reply to every comment for 24h.

## 5. Listings and directories (one afternoon)

Priority (these get cited or linked):
- [ ] AlternativeTo — list as an alternative to: DecodeChess, Chess.com Game
      Review, Aimchess, Lichess Analysis. Use the canonical descriptor.
- [ ] SaaSHub, AI tool directories (Futurepedia, Toolify, etc.) — only the
      ones that take a product description and link out.
- [ ] LinkedIn company page (also becomes a `sameAs` target).
- [ ] Update `ORG_SAME_AS` in `frontend/lib/site.ts` with every new official
      profile (LinkedIn, YouTube, Product Hunt, X).

## 6. Listicle outreach (the highest-leverage GEO activity)

The sites that already rank and get cited for your category:
Chessiro, MyChessPlan, CheckmateX, AuditChess, ImproveMyChess, Chessigma,
Chessbrain. Pitch a free review + the India pricing angle + the AIM coaching
story.

Email template (short, specific, no marketing language):

> Subject: Chessmasters — free access for your chess tool comparison
>
> Hi {name} — I read your {article title} and it's one of the few comparisons
> that's honest about free-tier limits.
>
> I built Chessmasters: an AI game analyzer that turns Chess.com/Lichess games
> into a plain-English coaching report (Stockfish enrichment + coaching logic
> designed with a FIDE Arena International Master). Free account if you want to
> test it: {link}. Happy to answer anything, including where it's weaker than
> the tools you list.

## 7. Monitoring

- Monthly: run the prompt panel (`prompt-panel.md`) and check whether the
  `chessmasterss.vercel.app` squatter appears for brand queries.
- Watch Google Search Console for branded impressions — the leading indicator
  that entity recognition is forming.
