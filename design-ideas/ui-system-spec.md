# Chessmasters — UI System Specification ("Calm Density")

**Status:** specification for implementation. No application code is changed by this document.
**Owner surface:** `frontend/` (Next.js 15 App Router, React 19, TypeScript, FastAPI backend).
**Visual direction:** *calm density* — the incumbent world (ink shell, gold accent, parchment report) is **retained and raised**, not replaced. No new palette, no new fonts.

**Reference implementation of the direction:** `design-ideas/2026-preview.html` (static mockup, 961 lines). Where this spec and the preview agree, the preview is the visual source of truth. Where they disagree, this spec records the disagreement in §9.

**Evidence base for this spec (all read before writing):**

| Read | Size / count |
| --- | --- |
| `frontend/app/globals.css` | 4,123 lines, 360 distinct class selectors, 31 distinct custom-property definitions, 8 `@media` blocks at 4 conditions (960 / 720 / 560 / prefers-reduced-motion) |
| `frontend/components/*.tsx` | 37 files (35 `.tsx` + `insights.ts` + `reportParsing.ts`) |
| `frontend/app/**/page.tsx` | **19** files (the brief says 18 — see §9.1) |
| `frontend/app/**/layout.tsx` | 5 files |
| `design-ideas/2026-preview.html` | 961 lines |
| `seo/geo-baseline-2026-10-11.md` | GSC ground truth |

---

## 1. Purpose, scope, and WHAT IS NOT IN SCOPE

### 1.1 Purpose

`globals.css` has accumulated ~360 one-off class selectors that encode the same six ideas (button, pill, card, field, section head, variants) about thirty times each. Repetition is not the real problem; the real problems are:

1. **A contrast failure that is expressible in the current token layer.** `--ink-muted: #5f6a62` measures **4.33:1 on `--paper-2`** — under WCAG AA. Nothing in the CSS prevents a future author from painting gold (`#c9993f`, **2.20:1 on `--paper`**) onto parchment.
2. **Two dated visual habits** that a 2026 reader reads as generated UI: 12 uppercase eyebrow labels and 14 coloured `border-left: 3px` accent cards.
3. **A dated interaction pattern:** a 360px sticky chat column (`AnalysisThread`) instead of inline, anchored Q&A.
4. **One dishonest elevation habit:** hairline border *and* wide diffuse blur used together, almost everywhere.

This spec fixes those four things inside the existing visual world and makes the unsafe states **unrepresentable** rather than merely discouraged.

### 1.2 Scope

- Token layer: semantic tokens, contrast contracts, and the exact replacements for the failing values.
- Six primitives, their variant APIs, and an explicit migration mapping from existing class names.
- A per-surface component table for **all 19 route files**.
- Layout and responsive rules at the four existing breakpoints, plus a **real** mobile navigation treatment for the app topbar and the content-site nav.
- Accessibility requirements: focus visibility, reduced motion, contrast, and one specific `aria-hidden` bug.
- Tailwind v4 adoption as an **additive** layer with the five known gotchas documented.
- A migration order across routes, ranked by traffic × risk, with the 7 content pages last.

### 1.3 WHAT IS NOT IN SCOPE

| Not in scope | Why |
| --- | --- |
| A new palette, new fonts, or a restyle of the brand | Decision 1 — the world is retained. `#0b1113` shell, `#c9993f` / `#e2b65f` gold, `#f3ecdc` parchment, Fraunces + DM Sans all stay. |
| Rewriting `globals.css` into Tailwind utilities | Decision 7 — additive. Legacy CSS keeps working during migration; deleting it is a later, separate phase. |
| Changing the report's content, section names, or the Gemini prompt | Backend/AI concern. The five report sections (Strength, Weakness, Game Overview, Focus Areas, Resources) are unchanged. |
| Changing the backend contract beyond one nullable column | The only backend change this spec authorises is `analysis_messages.anchor_ref` (nullable). |
| New product features | Nothing here invents capability. The inline Q&A already exists as `AnalysisThread`; it is being re-homed, not extended. |
| The static board renderer in `2026-preview.html` (`.board`, `.sq`, `.pc`, `13.8cqw`, SVG arrows) | The live app uses `@lichess-org/chessground` (`HeroBoard`, `CriticalPositionBoard`, `DrillBoard`, `.cg-wrap`). The preview's board is a mockup-only substitute. Do **not** port `cqw` sizing onto chessground. |
| Rewriting class names inside AI-generated markdown | `CoachingReport` renders markdown-produced HTML via `react-markdown`; those nodes have no `className` to substitute. The report keeps **semantic global CSS**, not utilities. See §6.3 and §8.5. |
| The `dev-preview` scenario *content* | It is a QA harness for `CoachingReport` (`SCENARIOS` object). Only its chrome and indexing change. |

---

## 2. The three modes, with every route classified

| Mode | Definition | Routes |
| --- | --- | --- |
| **Persuade** | The visitor decides and acts. Marketing surface. | 1 |
| **Operate** | The visitor completes a task. The app. | 6 |
| **Read** | The visitor understands something. | 12 |

### 2.1 Route classification

| # | Route (`frontend/app/…`) | Mode | One-line intent | Auth | Indexable today |
| --- | --- | --- | --- | --- | --- |
| 1 | `page.tsx` → `/` | **Persuade** | Paste a game, see the product, decide | no | yes (`robots: index` in root layout) |
| 2 | `analysis/[id]/page.tsx` → `/analysis/[id]` | **Operate** | Read one saved report; ask about moves | yes (redirects to `/`) | no metadata → inherits indexable |
| 3 | `batch/[id]/page.tsx` → `/batch/[id]` | **Operate** | Read a multi-game report + per-game cards | yes (redirects to `/`) | no metadata → inherits indexable |
| 4 | `history/page.tsx` → `/history` | **Operate** | Find a past analysis | yes (redirects to `/`) | no (`layout.tsx` sets `noindex, nofollow`) |
| 5 | `subscription/page.tsx` → `/subscription` | **Operate** | Choose / manage the plan | no | yes (canonical `/subscription`) |
| 6 | `upgrade/page.tsx` → `/upgrade` | **Operate** | Redirect stub → `/subscription` | no | no (`noindex`) |
| 7 | `dev-preview/page.tsx` → `/dev-preview` | **Operate** (internal) | Flip `CoachingReport` scenarios for QA | no | **yes — a defect; must be `noindex`** (§7.5) |
| 8 | `(content)/chess-com-game-review-alternative` | **Read** | Comparison content | no | yes |
| 9 | `(content)/chess-game-analyzer` | **Read** | Category head page | no | yes |
| 10 | `(content)/faq` | **Read** | FAQ | no | yes |
| 11 | `(content)/how-to-analyze-your-chess-games` | **Read** | Guide | no | yes |
| 12 | `(content)/lichess-game-analysis` | **Read** | Platform content | no | yes |
| 13 | `(content)/sample-report` | **Read** | Illustrate the output | no | yes |
| 14 | `(content)/tactics` | **Read** | Tactics hub | no | yes |
| 15 | `(legal)/about` | **Read** | Who wrote this | no | yes |
| 16 | `(legal)/contact` | **Read** | How to reach us | no | yes |
| 17 | `(legal)/privacy` | **Read** | Privacy policy | no | yes |
| 18 | `(legal)/refund` | **Read** | Refund & cancellation policy | no | yes |
| 19 | `(legal)/terms` | **Read** | Terms & conditions | no | yes |

### 2.2 Layout composition

| Layout | Wraps | Provides |
| --- | --- | --- |
| `app/layout.tsx` | everything | `<html lang="en">`, `Fraunces`/`DM_Sans` via `next/font` as CSS vars `--font-display` / `--font-body`, `<JsonLd>`, `<SiteFooter>` |
| `(content)/layout.tsx` | routes 8–14 | `.dashboard.legal-dashboard.content-dashboard` + `.topbar` with **Analyze a game · FAQ · Pricing** + `.legal-page.content-page` |
| `(legal)/layout.tsx` | routes 15–19 | `.dashboard.legal-dashboard` + `.topbar` with a single nav link **Back to the analyzer** + `.legal-page` |
| `history/layout.tsx` | route 4 | `metadata` only (`noindex, nofollow`) |
| `subscription/layout.tsx` | route 5 | `metadata` only (title, description, canonical, OG) |

**Mode consequence:** the two shells (app vs content/legal) are the only place the **topbar** lives. There are **four distinct topbars in the codebase** (root `HomeDashboard`, `analysis`, `batch`, `history`, plus `dev-preview`, plus two layout topbars) — every one is a hand-rolled `.topbar` + `.topbar-actions`. The mobile-nav work in §6.2 therefore has a single implementation target: one `<Topbar>` primitive-adjacent component, not seven copies.

---

## 3. Token reference table

Values are read from `frontend/app/globals.css` lines 1–28 and 3177–3183. Contrast ratios marked **(measured)** were computed in this session from the hex values using the WCAG 2.1 relative-luminance formula; ratios attributed to source comments are marked **(in-file)**.

### 3.1 The token count discrepancy

`globals.css` defines **31** distinct custom properties (26 in `:root` at lines 1–28, 5 more in the second `:root` at 3177–3183). The brief and `2026-preview.html` both say **34**. There is no 34th, 33rd or 32nd definition in the file. Treat "34" as stale and the table below as authoritative. See §9.2.

### 3.2 Shell tokens (dark surfaces: `--ink`, `--ink-2`, `--ink-3`)

| Token | Value | Intended surface | Contrast (measured) | Legal use |
| --- | --- | --- | --- | --- |
| `--ink` | `#0c1214` | page ground | — | surface |
| `--ink-2` | `#131c1f` | raised card / panel | — | surface |
| `--ink-3` | `#1b262a` | inset control / nested chip | — | surface, **never** for small alert text (see `--red`) |
| `--line` | `#29373b` | borders on shell | — | 1px hairline |
| `--line-soft` | `#1f2b2f` | dividers on shell | — | 1px hairline |
| `--text` | `#ece6d8` | body on shell | 15.17:1 on `--ink`, 13.91:1 on `--ink-2` (measured) | text |
| `--text-muted` | `#8b9c9c` | secondary on shell | 6.59:1 on `--ink`, 6.04:1 on `--ink-2`, 5.40:1 on `--ink-3` (measured) | text |
| `--gold` | `#c9993f` | **shell accent** | 7.29:1 on `--ink`, 6.68:1 on `--ink-2` (measured) | text **on shell only**; fill |
| `--gold-bright` | `#e2b65f` | shell hover / focus | 9.97:1 on `--ink`, 9.14:1 on `--ink-2` (measured) | text on shell; focus ring on shell |
| `--green` | `#6fa383` | positive mark on shell | 5.97:1 on `--ink-2` (measured) | text on shell; fill |
| `--red` | `#c96a5a` | negative mark on shell | 4.69:1 on `--ink-2` (measured) — **4.19:1 on `--ink-3` → FAILS AA** | text on `--ink`/`--ink-2`; **not on `--ink-3`** |
| `--amber` | `#d3a24a` | caution mark on shell | 7.45:1 on `--ink-2` (measured) | text on shell; fill |
| `--teal-light` | `#57a496` | assistant mark on shell | 5.27:1 on `--ink-3` (measured) | text on shell; **being retired** (see §3.5) |
| `--input-bg` | `#0e1619` | input ground | — | surface |
| `--input-line` | `#3b4d51` | input border | — | 1px hairline |

### 3.3 Paper tokens (light surfaces: `--paper`, `--paper-2`)

| Token | Value | Intended surface | Contrast (measured) | Legal use |
| --- | --- | --- | --- | --- |
| `--paper` | `#f3ecdc` | report ground | — | surface |
| `--paper-2` | `#e9e1cd` | nested card on paper | — | surface |
| `--paper-line` | `#d6cbb1` | borders on paper | — | 1px hairline |
| `--ink-text` | `#202725` | body on paper | 12.95:1 on `--paper`, 11.69:1 on `--paper-2` (measured) | text |
| `--ink-muted` | `#5f6a62` | secondary on paper | 4.79:1 on `--paper` ✓ / **4.33:1 on `--paper-2` ✗ FAILS AA** (measured; the in-file comment at line 3171 independently says 4.33 FAIL) | **being replaced** — see 3.4 |
| `--bronze` | `#8a6420` | links/secondary accent on paper | 4.55:1 on `--paper` (measured) | text on paper, at 4.55 it is a bare pass — prefer `--bronze-deep` |
| `--bronze-deep` | `#7d5a1c` | stronger bronze | 5.32:1 on `--paper` (measured) | text on paper |
| `--teal` / `--do` | `#2f6b62` | **paper accent** | 5.25:1 on `--paper`, 4.74:1 on `--paper-2` (measured; in-file comment says 5.25 / 4.74) | text on paper; fill; focus ring on paper |
| `--dont` | `#a94f42` | paper negative | 4.59:1 on `--paper` (measured; in-file says 4.59) | text on paper |
| `--dont-deep` | `#9c4739` | paper negative on `--paper-2` | 4.78:1 on `--paper-2` (measured; in-file says 4.78) | text on `--paper-2` |
| `--ink-muted-2` | `#57615a` | tertiary on paper | 4.94:1 on `--paper-2` (measured) | text on paper — **keep** |
| `--gold` on paper | `#c9993f` | — | **2.20:1 on `--paper`, 1.99:1 on `--paper-2` (measured; in-file says 2.20 FAIL)** | **FORBIDDEN as text or as a focus ring.** Fill only. |

### 3.4 Required token changes (the failure fixes)

| # | Change | From | To | Effect (measured) |
| --- | --- | --- | --- | --- |
| T1 | Paper secondary text | `--ink-muted` `#5f6a62` | **`--paper-muted` `#4d5a53`** | 4.33 → **5.55:1** on `--paper-2` ✓; 4.79 → **6.15:1** on `--paper` ✓ |
| T2 | Paper accent (links, positive, focus) | implicit gold / `--bronze` | **`--accent: var(--teal)` `#2f6b62`** | 2.20 → **5.25:1** on `--paper` ✓ |
| T3 | Paper negative | `--dont` `#a94f42` (4.59 on paper, 4.42 on paper-2) | **`--alert: var(--oxblood)` `#7d3527`** | **7.40:1** on `--paper`, **6.69:1** on `--paper-2` ✓ (measured — see §9.3) |
| T4 | Rename for symmetry | `--ink-text` | **`--paper-text`** (same value `#202725`) | 12.95:1, unchanged |
| T5 | Shell-only accent alias | `--gold` used ad hoc | **`--shell-accent: var(--gold-bright)`** | 9.97:1 on `--ink` ✓ |
| T6 | Hairline aliases | ad-hoc `1px solid …` | **`--hair: 1px solid var(--paper-line)`**, **`--hair-shell: 1px solid var(--line-soft)`** | encodes the one-elevation rule |
| T7 | Alert on `--ink-3` | `--red` as small text | Use `--red` only on `--ink`/`--ink-2`, or lighten to `#e08a7c` on `--ink-3` | 4.19 → ≥4.5 |
| T8 | Retire `--teal-light` | `#57a496` used by `.thread-message.role-assistant` | Fold into `--teal` on paper / `--green` on shell | removes a near-duplicate |

`--ink-muted-2`, `--line`, `--line-soft`, `--paper-line`, `--radius-card`, `--radius-control`, `--input-bg`, `--input-line`, `--font-display`, `--font-body` are **unchanged**.

### 3.5 The semantic layer that makes the unsafe pairing unrepresentable

The single rule, encoded:

```css
:root{
  /* surface-scoped accents — the ONLY way to reach an accent */
  --accent:       var(--teal);        /* paper 5.25:1  */
  --alert:        var(--oxblood);     /* paper 7.40:1  */
  --shell-accent: var(--gold-bright); /* shell 9.97:1  */
  --hair:         1px solid var(--paper-line);
  --hair-shell:   1px solid var(--line-soft);
}
```

Enforcement, in three layers (belt, braces, and a test):

1. **Naming.** There is no token called `--gold-on-paper`, so the pairing has no name to be written.
2. **Context.** `Pill tone="shell"` and any `--shell-accent` consumer may only render inside a shell `Card`/page context. A Pill rendered inside a paper `Card` resolves `tone="shell"` to `accent` instead (compile-time in `cva`, so the wrong class string is never emitted). `2026-preview.html` line 491 (`pill pill-shell` inside the shell topbar) and line 502 (`pill pill-shell` above the parchment, i.e. on shell) are correct; a `pill-shell` inside `.report` would not be.
3. **Test.** A CI check greps the built CSS for `#c9993f` (or `--gold`) inside any selector that also matches a paper surface (`.report`, `.card[data-surface="paper"]`, `--paper`). Any hit fails the build. Cheap, and it cannot drift.

`globals.css` already contains a hand-written version of this contract in a comment at lines 3161–3175. That comment becomes the token file's docblock; the *mechanism* replaces the prose.

---

## 4. The six primitives

Exactly six. Anything that is not one of these six is either an existing bespoke block (chessboard, radar, chart) or a **composition** of these six.

All variants are `cva`-style: a variant name maps to a **static class string**, never to string interpolation (Tailwind v4 cannot see constructed names — §8.5).

### 4.0 `cn()` and the variant helper

```ts
// signature only
cn(...inputs: ClassValue[]): string
// clsx semantics + tailwind-merge, with the repo's custom scales registered
// so `pill` tones and `size-*` conflict-resolution works.
```

Rules for `cn()` / `cva` in this repo:

- Variant output must be a **literal map**, e.g. `{ primary: "bg-gold text-[#181c16] border-transparent", … }`. Never `` `bg-${tone}` ``.
- Class strings are ordered variant → size → user `className` last, so a consumer can always override.
- `cn()` never receives a conditionally-built fragment like `` `status-${entry.status}` `` — that is replaced by a lookup (see §8.5 for the four real call sites).

---

### 4.1 `Button`

**Replaces:** `.btn`, `.btn-ghost`, `.toggle` (+`.active`), `.drill-btn`, `.drill-btn-primary`, `.drill-btn-ghost`, `.star-button`, `.color-chip`, `.paste-button`, `.add-game`, `.game-card-toggle`, `.game-row-remove`, `.guest-modal-close`, `.drill-collapse`, `.about-cta .btn`.

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `variant` | `"primary" \| "ghost" \| "quiet" \| "toggle" \| "danger"` | `"primary"` | the five sanctioned variants |
| `size` | `"md" \| "sm"` | `"md"` | `sm` covers `.drill-btn` (0.42rem) and `.paste-button` |
| `pressed` | `boolean` | — | **required when `variant="toggle"`**; renders `aria-pressed` |
| `href` | `string` | — | when set, renders an anchor (`next/link` internally) with identical styling |
| `busy` | `boolean` | `false` | disables + `aria-busy`, label swap ("Analyzing…") |
| `iconStart` / `iconEnd` | `ReactNode` | — | replaces the dozen `*-icon` classes |
| `full` | `boolean` | `false` | `align-self:stretch` for form submits |
| `type` | `"button" \| "submit"` | `"button"` | safety: default is not `submit` |

**Surface behaviour (this is a rule, not a variant):** inside a paper surface the primary fill is **ink**, not gold — `2026-preview.html` lines 168–170. A gold fill on parchment is warm-on-warm and reads as a foreign slab. The primitive detects paper context (`data-surface="paper"` on the nearest `Card`) and swaps the fill.

| Legacy class | → | Usage |
| --- | --- | --- |
| `.btn` | `Button variant="primary"` | `AuthButton`, `UpgradePrompt`, `LimitReachedPrompt`, content CTAs |
| `.btn-ghost` | `Button variant="ghost"` | "Open full multi-game report", "View subscription" |
| `.toggle` / `.toggle.active` | `Button variant="toggle" pressed={…}` | `AnalyzerForm` platform switch, `dev-preview` scenario tabs |
| `.color-chip` / `.color-chip.active` | `Button variant="toggle" size="sm"` in a `role="group"` | W/B colour picker |
| `.drill-btn-primary` | `Button variant="primary"` (paper context → ink fill) | `DrillCard` "Attempt move" |
| `.drill-btn-ghost` | `Button variant="ghost"` | `DrillCard` secondary action |
| `.star-button` | `Button variant="toggle" size="sm" iconStart={<Star/>}` inside a `role="radiogroup"` | `ReviewSection` — see §7.6 for the `aria-pressed` fix |
| `.paste-button` | `Button variant="ghost" size="sm"` | `AnalyzerForm` "Paste" |
| `.add-game` | `Button variant="quiet"` | `AnalyzerForm` "+ Add another game" |
| `.game-card-toggle` | `Button variant="quiet"` | `GameAnalysisCard` disclosure |
| `.game-row-remove` | `Button variant="danger" size="sm" iconStart={<Trash/>}` | keeps `aria-label="Remove game N"` |
| `.drill-collapse` | `Button variant="ghost" size="sm"` | `DrillCard` collapse |

### 4.2 `Pill`

**Replaces:** `.chip`, `.quota-pill`, `.insight-badge`, `.drill-pill`, `.drill-pill-theme`, `.drill-pill-stakes`, `.status-badge`, `.history-status`, `.plan-pill`, `.history-platform`, `.history-batch-badge`, `.game-card-index`, `.insight-game`, `.insight-phase`, `.psych-type`, `.psych-tag`, `.psych-unlock-badge`, `.psych-leak-severity`, `.review-mine-badge`.

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `tone` | `"shell" \| "neutral" \| "accent" \| "alert" \| "positive" \| "caution"` | `"neutral"` | **semantic, not colour names** |
| `dot` | `boolean` | `false` | leading 6px dot (preview `.dot`) |
| `icon` | `ReactNode` | — | replaces `*-pill-icon` |
| `mono` | `boolean` | `true` | pills are set in the tabular/mono voice (preview `--font-mono`) |
| `as` | `"span" \| "a" \| "button"` | `"span"` | |

Tone → token resolution (**the whole point of the primitive**):

| Tone | On shell | On paper | Meaning |
| --- | --- | --- | --- |
| `shell` | `--shell-accent` + gold border | **downgrades to `accent`** (gold is illegal on paper) | brand/status chip |
| `neutral` | `--text-muted` | `--paper-muted` | metadata |
| `accent` | `--teal-light` | `--accent` (teal) | positive/informational |
| `alert` | `--red` (never on `--ink-3`) | `--alert` (oxblood) | cost / blunder / error |
| `positive` | `--green` | `--do` (teal) | solved, completed |
| `caution` | `--amber` | `--bronze-deep` | inaccuracy, medium severity |

| Legacy class | → | Tone |
| --- | --- | --- |
| `.chip` | `Pill` | `shell` (platform label) |
| `.quota-pill` | `Pill` | `neutral` |
| `.insight-badge` (+ `.quality-*` colour) | `Pill` | blunder→`alert`, mistake→`caution`, inaccuracy→`caution`, strong→`positive` |
| `.drill-pill` / `.drill-pill-theme` | `Pill` | `neutral` / `accent` |
| `.drill-pill-stakes.stakes-severe|high` | `Pill` | `alert` |
| `.drill-pill-stakes.stakes-moderate|low` | `Pill` | `caution` / `neutral` |
| `.status-badge` / `.status-badge.done` | `Pill` | `neutral` / `positive` |
| `.history-status.status-{completed,processing,failed}` | `Pill` | `positive` / `caution` / `alert` (**static map**, §8.5) |
| `.plan-pill.plan-paid` / `.plan-free` | `Pill` | `shell` / `neutral` |
| `.history-platform`, `.insight-phase` | `Pill` | `neutral` |
| `.history-batch-badge`, `.game-card-index`, `.review-mine-badge` | `Pill` | `shell` |
| `.insight-game` | `Pill` | `neutral` |
| `.psych-type` | `Pill` | `accent` |
| `.psych-tag.tag-{strong,develop,weak}` | `Pill` | `positive` / `caution` / `alert` |
| `.psych-unlock-badge` | `Pill` | `positive` |
| `.psych-leak-severity.sev-{high,medium}` | `Pill` | `alert` / `caution` |

**Every one of these loses its `text-transform: uppercase`** (the 12 removals, §5.1). The Pill keeps its tone through `mono` + border + colour, not through shouting.

### 4.3 `Card`

**Replaces (mandated four):** `.review-card`, `.insight-card`, `.psych-card`, `.drill-card`.
**Also reasonably absorbed (same shape, listed for completeness):** `.mindset-callout`, `.pedigree-card`, `.game-card`, `.tactics-card`, `.report-block`, `.signin-card`, `.analyzer-form`, `.thread`, `.batch-progress`, `.upgrade-prompt`, `.focus-row`.

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `surface` | `"shell" \| "paper" \| "empty"` | `"shell"` | `empty` = dashed hairline (`.history-empty`, `.psych-unlock`) |
| `as` | element tag | `"div"` | `article` for narrated content |
| `pad` | `"none" \| "sm" \| "md"` | `"md"` | |
| `accent` | `never` | — | **there is deliberately no `accent` prop** |

**The elevation rule, enforced here:** a `Card` renders exactly one of
`border: var(--hair-shell)` (shell) or `border: var(--hair)` (paper). **No `box-shadow` is emitted by any Card.** The only element in the entire system permitted a diffuse shadow is the parchment report itself (`.report`, `box-shadow: 0 34px 60px -50px #000` in the preview / `0 34px 60px -48px rgba(0,0,0,1)` live). "1px border + wide diffuse shadow" together is the generated-UI tell and is now unreachable through the primitive.

Consequence to clean up: `.mindset-callout` (line 215), `.analyzer-form` (397), `.pedigree-card` (3024), `.hero-rule` (3213), `.guest-modal` (3101), `.drill-card.is-open` (3579) all currently carry wide blurs and must lose them on adoption.

The **14 coloured 3px sidebars** (§5.2) die here: because `Card` has no accent prop and no `border-left-color`, a coloured left edge is not expressible.

### 4.4 `Field`

**Replaces:** `.field` (AnalyzerForm username + game URL), `.game-row-field` / `.game-row input`, `.thread-composer` input, `.qa-compose` input (preview), `.review-form textarea`.

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `label` | `string` | — | rendered in a real `<label htmlFor>` |
| `id` | `string` | **required** | `AnalyzerForm` currently uses implicit labels and raw `aria-label`s; a required `id` forces explicit association |
| `hint` | `string` | — | `aria-describedby` |
| `error` | `string` | — | sets `aria-invalid` + `role="alert"` on the message, and `aria-describedby` to it |
| `variant` | `"stacked" \| "inline"` | `"stacked"` | `inline` = `Field` + `Button`, the `.qa-compose` row |
| `disabled`, `required` | `boolean` | `false` | |

Focus styling is part of the primitive and is **surface-aware**: on shell, `border-color: var(--gold)` + `0 0 0 3px rgba(201,153,63,.18)` (current `.field input:focus`, line 470); on paper, `border-color: var(--accent)` + `0 0 0 3px rgba(47,107,98,.14)` (preview line 378). A gold focus ring on parchment is the same 2.20:1 mistake as gold text.

The two hard-coded colours in current code — `.field input:hover { border-color:#4d6267 }` (line 462) and `.thread-composer input::placeholder { color:#5d6b6d }` (line 2096) — are folded into the primitive as `--input-line` hover and `--text-muted`.

### 4.5 `SectionHead`

**Replaces:** `.section-head` only (FaqSection, HomeDashboard `history-panel`, ReviewSection, `batch/[id]`, and the new document-level Q&A heading).

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `title` | `ReactNode` | **required** | |
| `as` | `"h2" \| "h3"` | `"h2"` | keeps the heading outline honest |
| `id` | `string` | — | for `aria-labelledby` |
| `aside` | `ReactNode` | — | right-aligned quiet note ("2 positions · your clock explains one") — preview line 163 |
| `hairline` | `boolean` | `true` | the bottom rule |
| `action` | `ReactNode` | — | e.g. "View all" `Button variant="quiet"` |

**Important boundary:** a `SectionHead` is a *document* divider (heading + hairline + aside). The Card-level header rows are **not** `SectionHead` and must not borrow its hairline: `.insight-card-header`, `.psych-head`, `.drill-head`, `.drill-section-head`, `.game-card-header`, `.review-form-head`, `.moment-head` are flex rows inside a Card. They lose their uppercase/colour treatments and get hierarchy from **Fraunces numerals + size + weight** (preview `.moment-rank` line 343, `.drill-head .rank` line 410). This is the single most common mis-migration risk in this codebase; §9.6 tracks it.

### 4.6 Migration mapping summary (the mandated → mapping, plus extras)

| Existing class group | Primitive | Notes |
| --- | --- | --- |
| `.btn`, `.btn-ghost`, `.toggle`, `.drill-btn`, `.star-button` | **Button** | mandated |
| `.chip`, `.quota-pill`, `.insight-badge`, `.drill-pill`, `.status-badge`, `.history-status` | **Pill** | mandated |
| `.review-card`, `.insight-card`, `.psych-card`, `.drill-card` | **Card** | mandated |
| `.field`, `.thread-composer`, `.qa-compose` | **Field** | |
| `.section-head` | **SectionHead** | |
| `.color-chip`, `.paste-button`, `.add-game`, `.game-card-toggle`, `.game-row-remove`, `.drill-collapse`, `.guest-modal-close` | **Button** | variants |
| `.plan-pill`, `.game-card-index`, `.history-platform`, `.history-batch-badge`, `.insight-game`, `.insight-phase`, `.psych-type`, `.psych-tag`, `.psych-unlock-badge`, `.psych-leak-severity`, `.review-mine-badge`, `.drill-pill-stakes` | **Pill** | tones |
| `.mindset-callout`, `.pedigree-card`, `.game-card`, `.tactics-card`, `.report-block`, `.signin-card`, `.thread`, `.batch-progress`, `.upgrade-prompt`, `.focus-row` | **Card** | extension of the mandated set |
| `.section-boards`, `.section-boards-skeleton`, `.drill-grid`, `.review-list`, `.tactics-grid`, `.history-list`, `.psych-leaks`, `.psych-clock-grid`, `.evidence` | *(no primitive)* | layout grids — keep the grid, swap children |

---

## 5. The two habits being removed

### 5.1 The 12 uppercase eyebrow labels (all removed)

Each is `text-transform: uppercase` + wide `letter-spacing`. Verified owners by line number:

| # | Line | Selector | Replacement hierarchy device |
| --- | --- | --- | --- |
| 1 | 234 | `.mindset-kicker` | Fraunces sentence-case lead, or a `Pill tone="shell"` |
| 2 | 837 | `.psych-kicker` | Card title weight |
| 3 | 986 | `.psych-tag` | `Pill` tone |
| 4 | 1019 | `.psych-section-title` | `SectionHead as="h3"` |
| 5 | 1289 | `.psych-leak-severity` | `Pill` tone (`alert`/`caution`) |
| 6 | 1325 | `.psych-leak-fix-label` | bold run-in label, sentence case |
| 7 | 2743 | `.psych-unlock-badge` | `Pill tone="positive"` |
| 8 | 3252 | `.hero-rule .hero-rule-kicker` | Fraunces rule text already carries it; kicker becomes `--paper-muted` sentence case |
| 9 | 3429 | `.focus-tag` | mono `tag-do` / `tag-dont` / `tag-work` (preview lines 390–393) |
| 10 | 3673 | `.drill-flag` | `Pill tone="positive"` |
| 11 | 3905 | `.drill-extras-title` | `SectionHead as="h3"` |
| 12 | 4095 | `.report-block-tag` | `Pill tone="accent"` |

*(`.invoice-status { text-transform: capitalize }`, line 2262, is not uppercase and is untouched.)*

### 5.2 The 14 coloured `border-left: 3px` accent cards (all removed)

| # | Line | Selector | Becomes |
| --- | --- | --- | --- |
| 1 | 617 | `.report blockquote` | blockquote hairline-top + Fraunces italic |
| 2 | 799 | `.insight-skeleton-card` | Card, hairline all round |
| 3 | 820 | `.psych-card` | `Card surface="paper"` |
| 4 | 1265 | `.psych-leak` | `Card surface="paper"` + `Pill tone="alert"` |
| 5 | 1412 | `.insight-card` (+ `.quality-*` overrides 1417–1430) | `Card surface="paper"` + `Pill` tone |
| 6 | 2049 | `.thread-message.role-user` | inline Q&A block (preview `.qa-q`) |
| 7 | 2053 | `.thread-message.role-assistant` | inline Q&A block (preview `.qa-a`) |
| 8 | 2114 | `.upgrade-prompt` | `Card surface="shell"` |
| 9 | 2786 | `.batch-progress-item` (+ `state-*` overrides 2790–2800) | `Card surface="shell"` + `Pill` |
| 10 | 3386 | `.focus-row-raw .focus-cell` | focus pair, mono `tag` |
| 11 | 3413 | `.focus-cell.focus-dont` | preview `.tag-dont` (oxblood text) |
| 12 | 3418 | `.focus-cell.focus-do` | preview `.tag-do` (teal text) |
| 13 | 3572 | `.drill-card` (+ `status-*` overrides 3577–3592) | `Card surface="paper"` + `Pill` |
| 14 | 3888 | `.drill-skeleton` | Card, hairline all round |

---

## 6. Layout & responsive rules

### 6.1 The four existing breakpoints

`globals.css` has 8 `@media` blocks across exactly four conditions:

| Condition | Occurrences | Lines | What it does today |
| --- | --- | --- | --- |
| `max-width: 960px` | 1 | 2451 | `.hero` → 1 column; `.analysis-workspace` → 1 column; thread column unsticks |
| `max-width: 720px` | 3 | 293, 1398, 3453 | `.mindset-callout` stacks; `.psych-grid` 1 col; `.focus-pair` 1 col |
| `max-width: 560px` | 3 | 2476, 2992, 3326 | padding, `.acc-bar-group` columns, `.history-item` stacks, `.report` padding, `.hero-board` ring, `.game-row` wraps, `.hero-rule` stacks |
| `prefers-reduced-motion: reduce` | 1 | 2516 | global kill-switch on animation/transition duration |

Tailwind v4 mapping — override v4's default breakpoints in `@theme` so conditional utilities speak the repo's language:

```css
@theme {
  --breakpoint-sm: 560px;   /* phone            */
  --breakpoint-md: 720px;   /* large phone / sm tablet */
  --breakpoint-lg: 960px;   /* tablet → stack   */
}
```

Two content-width caps are also part of the layout contract, not one-offs: `.content-dashboard`/`.legal-dashboard` = `min(860px, 100%)`, `.content-page`/`.legal-page` = `max-width: 720px`.

### 6.2 Mobile navigation — the 390px finding

**Verified finding.** At 390px the topbar does not fit. `.topbar` has `flex-wrap: wrap` (line 80) but its child `.topbar-actions` (line 102) is a non-wrapping `display:flex` with `gap: 1.1rem`, and `.quota-pill` sets `white-space: nowrap` (line 3014). The observed result: the quota pill broke mid-word and a nav item overflowed the viewport. `2026-preview.html` line 831 independently records the same finding.

**A `flex-wrap` is explicitly not the fix.** The fix is a real menu. Two shells, two treatments:

#### A. App topbar — `HomeDashboard`, `analysis/[id]`, `batch/[id]`, `history`, `subscription`, `dev-preview`

Specify **one** `<Topbar>` component that all six import (they are currently six copies of the same JSX). Below `--breakpoint-sm` (560px):

| At ≤560px the topbar renders | Detail |
| --- | --- |
| Wordmark | unchanged, left |
| **Menu button** | `Button variant="ghost" size="sm" iconStart={<Menu/>}` with `aria-expanded`, `aria-controls="topbar-menu"`, `aria-haspopup="true"` |
| Sign-in / account | stays **outside** the menu — it is the primary action; it becomes an icon-only `Button` with `aria-label="Sign in"` rather than the current full-label `.btn` |
| `#topbar-menu` panel | a `Card surface="shell"` region containing, in order: the quota as `Pill tone="neutral"` ("2 / 5 left"), then History, Subscription, and (signed in) the account name + Sign out |
| Behaviour | `Escape` closes and returns focus to the menu button; click-outside closes; the panel is in the DOM only when open (no `sr-only` ghost nav) |

The quota **must not** be a `white-space: nowrap` control competing for the same row as nav links. On mobile it lives inside the menu; on ≥561px it may return inline as today.

#### B. Content-site nav — `(content)/layout.tsx` (3 links: Analyze a game, FAQ, Pricing) and `(legal)/layout.tsx` (1 link)

- **Legal (1 link):** no change. It fits. Keep inline.
- **Content (3 links):** below `--breakpoint-sm`, the three links collapse into a **single `Menu` disclosure** (`Button variant="ghost"`, same `aria-expanded`/`aria-controls` contract), listing Analyze a game / FAQ / Pricing / Sample report. This is a *deliberate* row, not a wrap — the preview's compromise (`2026-preview.html` line 452: `.nav{width:100%;margin-left:0}` at 620px) is a wrapping sub-row and is **superseded** by this spec, because three links in a second row push the article below the fold on a phone while still not being a menu.

Shared rules for both: the disclosure is keyboard-operable, the toggle is ≥24×24 CSS px (WCAG 2.5.8), and the panel traps nothing (it is not a modal).

### 6.3 Report reading measure

| Element | Today | Spec |
| --- | --- | --- |
| `.report p` | `max-width: 68ch` (line 591) | **66ch** — matches the preview (line 295) and keeps lines from going long once the report is full-width at ≥960px |
| Markdown list/table | unconstrained inside `.report` | inherit the 66ch cap on lists; tables stay full-width of the report padding |
| Inline Q&A answer (new) | — | `max-width: 64ch` (preview `.qa-a`, line 364) so an answer reads as a quotation inside the 66ch column |
| `.hero-lede` | `46ch` (line 199) | keep |
| `.mindset-lede` | `68ch` (line 251) | keep (it is shell, one-shot marketing copy) |
| `.pedigree-body` | `72ch` (line 3050) | tighten to **66ch** for one consistent prose cap |
| `.psych-locked-text` | `46ch` (line 1392) | keep |

**Structural requirement:** the report's measure must be a property of the *report column*, not of each `<p>`. `react-markdown` emits bare `<p>`; if the cap lives on `p` only, any block the model emits without a `p` (a table, a `div`, an `<EvalChart>`) escapes it. Move the cap to `.report .report-section > *` and delete the per-`p` rule.

### 6.4 Column model change (`analysis/[id]`)

Today: `.analysis-workspace { grid-template-columns: minmax(0,1fr) 360px }` (line 1933) with `.analysis-thread-column { position: sticky; top:1.25rem; max-height: calc(100vh - 2.5rem) }` (1946–1952). That 360px sticky column is the dated pattern.

Target: **single column.** The report keeps its measure; the thread column, `.analysis-thread-column`, and its `@media (max-width:960px)` overrides (2462–2473) are deleted. Q&A renders inline (§7.3 / §9.5). `dev-preview` also renders `.analysis-workspace` but only ever uses `.analysis-report-column` — its grid wrapper becomes a no-op and should be dropped.

### 6.5 Hero alignment (delete the JS)

`HomeDashboard.tsx` (now lines ~92–146) are ~55 lines of `useLayoutEffect` + `getBoundingClientRect` + `ResizeObserver` + an `animationend` listener purely to translate `.hero-visual-inner` so the board centres against the form. The preview's `.hero` (lines 193–196) is a plain grid with `align-items: center`, which does the same thing with zero JS and no reflow jank. Spec: delete the effect, delete the `ref`, let the grid centre the column. This is a behavioural simplification inside scope (it removes code, adds none).

---

## 7. Accessibility requirements

### 7.1 Focus visibility

Current global rule (line 60): `:focus-visible { outline: 2px solid var(--gold-bright); outline-offset: 2px }`.

| Surface | Ring | Ratio | Verdict |
| --- | --- | --- | --- |
| Shell | `--gold-bright` `#e2b65f` | 9.97:1 on `--ink` | ✓ keep |
| **Paper** | `--gold-bright` | **≈2.0:1 on `--paper`** | ✗ **fails WCAG 2.4.11 (Focus Appearance)** |

`2026-preview.html` line 73 repeats the bug: a global `:focus-visible` gold ring is wrong for the parchment report. Requirement: the ring is **surface-scoped** — `--shell-accent` on shell, `--accent` (teal, 5.25:1) on paper. Implemented at the token layer, not by per-component rules.

Also audit the two `outline: none` sites: `.field input:focus` (470) and `.thread-composer input:focus` (2099) remove the outline in favour of `border-color` + `box-shadow`. That is acceptable **only** while the replacement ring is ≥3:1 against the adjacent background — which is true for the gold ring on shell and false for any gold ring on paper. The `Field` primitive (which replaces both) must carry the paper-safe ring.

### 7.2 Reduced motion

`globals.css` already ships a **global kill-switch** (line 2516):

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
```

This is correct for `spin`, `pulse`, `rise`, and the hover transitions. It is **not sufficient** for the signature motion, and it must not be relied on to hide a correctness bug:

**The signature motion** is the brass rule drawing across the "next game rule" card — preview `.next-rule::before` (lines 303–309): a `linear-gradient(90deg, var(--bronze), rgba(125,90,29,.15))`, `transform-origin: left center`, `animation: draw-rule .8s … both`.

**Rest-at-true-value principle (normative).** An animated element must **render its real value** when the animation never runs. The preview gets this right in two places and the rule generalises:

- `.next-rule::before` animates `scaleX(0) → scaleX(1)`; the element's static `width: 100%` is the true state, so `animation: none` (preview line 462) leaves a fully drawn rule. ✓
- `.meter i` (preview lines 332–337) sets `width: var(--v)` as its **resting** value and uses `transform: scaleX()` only to draw it. Preview comment, verbatim: *"Resting state is the REAL value; the animation only draws it. If the animation never runs, an accuracy meter must never read as 0."*

The counter-example that must not be reproduced: animating `width: 0 → 71%`. With `animation-duration: 0.001ms` forced by the global kill-switch, a width animation lands at its end state by luck; if it were ever changed to `animation-fill-mode: none` or the animation were removed, the meter would silently read **0%**. So: **every meter, bar, and rule animates `transform`/`opacity` from a true resting value; none animates a layout or `width` property.**

Adoption requirements:
1. `2026-preview.html` line 462 disables `.next-rule::before` and `.meter i` animations under reduced motion — keep that, and add the same for the streaming caret (`.stream::after`, preview line 463).
2. `globals.css` line 3186 sets `html { scroll-behavior: smooth }` **unconditionally**. This violates the spirit of reduced motion and is missed by the existing kill-switch (it targets `animation-*`/`transition-*`, not `scroll-behavior`). Gate it: `@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth } }`.
3. The `.hero-rule-cta` "Practise this now" links to `#drills`; with smooth scroll gated, ensure the anchor still lands (it will) and that `scroll-margin-top: 1.5rem` on `.drill-section` (line 3504) survives.

### 7.3 Inline AI, not a chat panel (accessibility contract)

`AnalysisThread.tsx` today is a `<div className="thread">` with `.thread-messages`, a `.thread-empty` prompt, per-message `.thread-message.role-{user|assistant}` (each with a coloured 3px left border at lines 2049/2053), a `.thread-typing` live region, and a `.thread-composer` form. It sits in `analysis/[id]` inside `.analysis-thread-column`.

Rebuild requirements:

| Aspect | Requirement |
| --- | --- |
| Anchor | Q&A expands **in place**, at the move/time it is about (`anchor_ref`), following preview `.qa` (lines 361–382). The trigger is `Button variant="quiet"` labelled "Ask about 34. Rc1" (preview `.ask`). |
| Null anchor | Messages with `anchor_ref = null` render in a **document-level "Coach conversation"** section at the end of the report (preview's closing composer, lines 719–727). **No existing message may disappear** — this is a hard migration invariant. |
| Streaming | The caret is decorative: preview `.stream::after` is `aria-hidden="true"` (line 598). The answer region is `role="status"`/`aria-live="polite"` like today's `.thread-typing`. |
| Expanded panel | The preview's collapsed trigger expands a panel with **its own** composer (lines 622–627). The panel is a disclosure, not a dialog: no focus trap, no `aria-modal`. The trigger keeps `aria-expanded`. |
| Composer labelling | Preview gives each input a contextual `aria-label` ("Ask about 27. Ne7", line 624). Keep that; `placeholder` is not a label. |
| Upgrade states | `AnalysisThread` already branches to `UpgradePrompt feature="qna"` / `LimitReachedPrompt`; those branches survive, re-homed into the document-level section. Guest users hit `GuestQnaPrompt` on `/` (a `.upgrade-prompt`) — the inline trigger must not appear for guests without a sign-in path. |

### 7.4 The `aria-hidden` bug in `HomeDashboard.tsx`

**Verified.** `HomeDashboard.tsx` line 657 (line 651 when first read; the file grew to 751 lines mid-session when `AnalyzerGuide` was added — see §11.2 R13):

```tsx
<aside className="hero-visual" aria-hidden="true">
  <div className="hero-visual-inner" ref={visualInnerRef}>
    <HeroBoard />
    <p className="hero-caption">Every game has a square worth fighting for.</p>
  </div>
</aside>
```

`aria-hidden="true"` is on the **wrapper**, so it removes from the accessibility tree not just the decorative `<HeroBoard />` (correct — a chessboard with no accessible name is noise) but also `.hero-caption`, a real sentence of brand copy ("Every game has a square worth fighting for.") that sighted users read. Screen-reader users never receive it.

Fix: `aria-hidden` belongs on the **board only**, not the column. `2026-preview.html` (lines 775–781) already has the correct shape — the `<aside class="hero-visual">` is not hidden and the board inside it is the only decorative node. Requirement:

- Remove `aria-hidden="true"` from `.hero-visual`.
- Put `aria-hidden="true"` on the `HeroBoard` wrapper (`.hero-board`) or mark the board container `role="img"` with an informative label — the board is decorative *hero* imagery, so `aria-hidden` is preferred.
- `.hero-caption` stays visible to AT.
- Apply the same audit to the other decorative wrappers: `.mindset-emblem` (`aria-hidden`, correct — decorative), `.mindset-pip`s (decorative, correct), `.wordmark-glyph` "♜" (`aria-hidden`, correct).

### 7.5 Contrast (summary of what must hold)

- **Never** `--gold`/`--gold-bright` as text or focus ring on `--paper`/`--paper-2` (2.20 / 1.99:1). Enforced by §3.5.
- Paper secondary text uses `--paper-muted` `#4d5a53` (≥5.55:1 on both paper surfaces).
- `--red` `#c96a5a` must not be used as small text on `--ink-3` (4.19:1). Affected selector today: `.state-failed .batch-progress-state` (line 2849) inside `.batch-progress-item { background: var(--ink-3) }` (2784). Either lighten on `--ink-3` or move the pill to a lighter shell.
- Non-text contrast (3:1) for UI boundaries: `--line` `#29373b` on `--ink` and `--paper-line` `#d6cbb1` on `--paper` both clear 3:1 as borders; the `--input-line` `#3b4d51` input border is the intended 3:1 boundary and must not be lightened.

### 7.6 One further a11y note found while reading: the star rating

`ReviewSection.tsx` line 161 sets `aria-pressed={value <= rating}` on each of five `Button`s — so with a 4-star rating, stars 1–4 are all announced "pressed". That is a toggle-group semantic, not a rating. The `Button variant="toggle"` migration is the moment to change it to a **radio group** (`role="radiogroup"` + `role="radio"` + `aria-checked`, or one native `<input type="range">`). Out of the visual scope, in the correctness scope.

---

## 8. Tailwind v4, additive, and the five gotchas that will bite

Adoption is **additive**: `@import "tailwindcss";` becomes the first line of `globals.css`; the existing 31 tokens are mapped into `@theme inline`; the legacy CSS stays and keeps working during migration. There is currently **no** `tailwind`/`postcss` config in `frontend/` — `globals.css` begins at `:root {` — so this is genuinely greenfield.

```css
@import "tailwindcss";

@theme inline {
  /* the 31 existing tokens, re-exported under Tailwind's namespaces */
  --color-ink: var(--ink);
  --color-paper: var(--paper);
  --color-accent: var(--accent);
  --color-alert: var(--alert);
  --color-shell-accent: var(--shell-accent);
  /* …one line per token… */
  --radius-card: var(--radius-card);
  --radius-control: var(--radius-control);
  --breakpoint-sm: 560px;
  --breakpoint-md: 720px;
  --breakpoint-lg: 960px;
}
```

### 8.1 `border-color` defaults to `currentColor`

v4 changed the default `border-color` to `currentColor`. This repo has **many 1px borders** (`.topbar` 82, `.field input` 453, `.hero-board` 340, `.game-card` 2882, every `Card`…). A bare `border` utility therefore inherits the text colour and silently paints a wrong-coloured, usually heavy, edge. Mitigation: keep a preflight base of `* { border-color: var(--line-soft) }` (or the surface-appropriate hairline) inside `@layer base`, and have `Card` always emit an explicit `border-[color:…]`. Do not rely on the utility default anywhere.

### 8.2 `next/font` variable collision

`app/layout.tsx` defines `--font-display` (Fraunces) and `--font-body` (DM Sans) via `next/font`. Tailwind v4's `--font-*` namespace generates `font-*` utilities from the same names, so `@theme inline { --font-display: var(--font-display) }` is a **self-reference** and resolves to nothing.

**Resolution (spec):** rename the `next/font` variables to `--font-fraunces` and `--font-dm-sans`, then bridge once:

```css
@theme inline {
  --font-display: var(--font-fraunces);  /* font-display utility */
  --font-body:    var(--font-dm-sans);   /* font-body utility    */
  --font-mono:    var(--font-dm-mono);   /* new: the preview's tabular voice */
}
```

`--font-mono` is new and matches the preview's `DM Mono` usage (pills, meters, ranks, move notation). It is **not** a new font family for brand expression — the preview already ships it in the same world. If DM Mono is judged out of scope, substitute `ui-monospace` and drop the import; but the preview leans on it for `.pill`, `.meter-label b`, `.moment-move`, `.tag`, so a decision is required (§9.8).

### 8.3 Browser baseline (no polyfill)

v4 requires Safari 16.4+/Chrome 111+/Firefox 128+. There is no polyfill path. Impact on this repo: `@theme inline` is fine, but any `oklch()`, `color-mix()`, `@property`, or nesting the primitives use must meet that baseline. Also note `body:has(.legal-dashboard)` (lines 2271–2277) — `:has()` is inside the same baseline, so it survives, but it is worth replacing with a layout-set variable because it is a fragile selector (it changes the *footer width* based on a class on a sibling `main`).

### 8.4 CSS ordering differs between `next dev` and `next build`

**Do not validate the token layer in `next dev`.** The report's parchment styles and the shell's gold styles are both single-class in places; when Tailwind's layered output lands in a different order under `next build`, a utility can beat a legacy rule (or vice-versa) and flip a colour. Acceptance gate: `npm run build` then visually diff `/`, `/analysis/[id]` with a real report, `/subscription`, and `/dev-preview` against the preview. Treat dev-only colour parity as unverified.

### 8.5 v4 cannot see dynamically constructed class names

This matters **today**, because the repo constructs class names in four real places:

| File | Construction | Fix |
| --- | --- | --- |
| `AnalysisHistory.tsx` | `` `history-status status-${entry.status}` `` | map to `Pill tone` via a literal record |
| `DrillCard.tsx` | `` `drill-card${open ? " is-open" : ""} status-${status}` `` | `Card` + `Pill`, literal tone record |
| `SectionInsightBoards.tsx` | `` `insight-card quality-${moment.quality}` `` + `` `insight-card-body … no-board/board-only` `` | `Card` + `Pill tone`, literal record |
| `PsychologyPanel.tsx` / `PsychologyRadar.tsx` | `` `psych-tag tag-${tag}` ``, `` `psych-speed-seg seg-${index}` ``, `` `psych-radar-dot tag-${…}` `` | literal maps |
| `BatchProgress.tsx` | `` `batch-progress-item state-${game.state}` `` | literal map |
| `AnalysisThread.tsx` | `` `thread-message role-${message.role}` `` | literal map |
| `FocusAreasBoard.tsx` | `` `focus-row${isPrimary ? " is-primary" : ""} focus-row-raw` `` | `cva` |
| `AnalyzerForm.tsx` | `` `psych-unlock${psychologyUnlocked ? " unlocked" : ""}` `` | `cva` |

Rule: **variants resolve to static strings.** A dynamic suffix may only name a `data-*` attribute, never a class.

While enumerating those, four class names were found that **do not exist in `globals.css`** and therefore render unstyled today — fix them in the same pass rather than porting dead markup:

| Class referenced | Referenced in | Present in `globals.css`? |
| --- | --- | --- |
| `.insight-card-body`, `.insight-card-text`, `.insight-board`, `.no-board`, `.board-only` | `SectionInsightBoards.tsx` | **no — 0 occurrences** |
| `.batch-progress-count` | `BatchProgress.tsx` | **no** |
| `.faq-meta` | `FaqSection.tsx` | **no** |
| `.site-footer-explore` | `SiteFooter.tsx` | **no** |

---

## 9. Per-surface component table — all 19 routes

Column key: **Mode** · **Entry files** · **Current markup (verified in the file)** · **Primitives it becomes**.

### 9.1 Persuade

| Route | Entry | Current markup (verified) | Becomes |
| --- | --- | --- | --- |
| `/` | `app/page.tsx` → `components/HomeDashboard.tsx` (751 lines) + `AnalyzerGuide.tsx` | `.dashboard`; `.topbar` + `.wordmark` + `.wordmark-glyph` + `.topbar-actions` + `.quota-pill` + `.nav-link`×2 + `AuthButton` (`user-menu`, `user-name`, `btn btn-ghost`, `btn`); `.hero` (grid 1.05fr/.85fr) + `.hero-copy` (`hero-title`, `hero-lede`, `guest-note`, `quota-panel`, `status-slot`, `error-banner`) + `AnalyzerForm`; `<aside class="hero-visual" aria-hidden="true">` → `HeroBoard` + `.hero-caption` **(the a11y bug, line 657)**; `AnalyzerGuide` (two `.faq-panel` blocks, `.section-head`×2, `.pedigree-body`, `.faq-list`/`.faq-item`, `.faq-more`); `.mindset-callout` (`mindset-kicker` uppercase, `mindset-title`, `mindset-lede`, `mindset-emblem`, `mindset-pip`×3); `BatchProgress`; `CoachingReport`; `GuestQnaPrompt`; `.batch-report-link`; `.history-panel` + `.section-head` + `AnalysisHistory`; `CoachingPedigree` (`pedigree-card`, `pedigree-badge`, `pedigree-metrics`); `FaqSection`; `ReviewSection`; `GuestSignInPrompt` | **SectionHead** (.section-head ×3: history + AnalyzerGuide ×2) · **Pill** (.quota-pill) · **Card** (.mindset-callout, .pedigree-card, .analyzer-form, .signin-card) · **Button** (.btn, .btn-ghost, .toggle, .star-button) · **Field** (AnalyzerForm) · **Pill** (.status-badge via AnalysisStatus) · **Topbar** (§6.2A) · remove `.mindset-kicker` uppercase · **remove ~55 lines of `useLayoutEffect`** (§6.5) · **fix `aria-hidden`** (§7.4) · `AnalyzerGuide` prose/`faq-panel` blocks keep semantic CSS (SEO text, §10.1 spirit) |

### 9.2 Operate

| Route | Entry | Current markup (verified) | Becomes |
| --- | --- | --- | --- |
| `/analysis/[id]` | `app/analysis/[id]/page.tsx` (241) + `CoachingReport`, `SectionInsightBoards`, `LockedPsychologyPreview`, `AnalysisThread` | `.dashboard.analysis-dashboard`; `.topbar` (chip-free, 3 `.nav-link` + `.quota-pill`); `.game-header` + `.chip` + `.game-title` + `.game-meta` + `.game-link`; `.analysis-workspace` (grid `1fr 360px`); `.analysis-report-column` → `CoachingReport` **or** a `.report` with `.report-section` ×N + `SectionInsightBoards` + `LockedPsychologyPreview`; `.analysis-thread-column` (sticky) + `<h2>Ask about this game</h2>` + `AnalysisThread` (`thread`, `thread-messages`, `thread-empty`, `thread-message role-*`, `thread-author`, `thread-content`, `thread-typing`, `thread-composer`, `btn`) | **Card** (paper) for the report sections · **Pill** (.chip, .insight-*, .drill-*) · **SectionHead** for report section headings · **single column** (§6.4, delete `.analysis-thread-column`) · **inline Q&A** at each moment + document-level "Coach conversation" (§7.3) · `Button variant="quiet"` triggers · **Topbar** (§6.2A) |
| `/batch/[id]` | `app/batch/[id]/page.tsx` (150) + `GameAnalysisCard` | `.dashboard.analysis-dashboard`; `.topbar` (3 `.nav-link`); `.game-header` + `.chip` + `.game-title` + `.game-meta`; `CoachingReport`; `.batch-games` + `.section-head` + `GameAnalysisCard`×N (`.game-card`, `.game-card-header`, `.game-card-index`, `.history-platform`, `.game-card-title`, `.game-card-meta`, `.error-banner`, `.game-card-counts` + `.count-*`, `.game-card-toggle`, `.game-card-moments`, `.game-card-links`, `.game-link`, `.game-card-batch`); `AccuracyChart` (`.accuracy-chart`, `.acc-bar-*`) | **Card** (.game-card, .tactics-card-shaped) · **Pill** (.chip, .game-card-index, .history-platform) · **SectionHead** (.section-head) · **Button** (.game-card-toggle) · **Topbar** · `AccuracyChart` = **`transform`-animated meter** per §7.2 (currently `.acc-bar-fill { transition: width }`, line 772 — convert) |
| `/history` | `app/history/page.tsx` (85) + `AnalysisHistory` | `.dashboard`; `.topbar` (2 `.nav-link`); `.game-header` + `.game-title` + `.game-meta`; `.error-banner`; `AnalysisHistory` (`.history-empty`, `.history-list`, `.history-item`, `.history-item-open`, `.history-item-main`, `.history-platform`, `.history-batch-badge`, `.history-meta`, `.history-item-side`, `.history-date`, `` `history-status status-${…}` ``); `layout.tsx` = metadata `noindex` | **Pill** (.history-platform, .history-batch-badge, .history-status → literal tone map) · **Card surface="empty"** (.history-empty) · **Button** (.history-item-open row) · **Topbar** · **naturally the first migration target** (noindex, low traffic) |
| `/subscription` | `app/subscription/page.tsx` (436); `layout.tsx` metadata + canonical | `.dashboard`; `.topbar` (1 `.nav-link`); `.upgrade-hero` + `.upgrade-price`; `.plan-status` + `.plan-pill.plan-*`; `.billing-message`, `.billing-meta`; `.subscription-cta`; `.invoice-block` + `.invoice-list` + `.invoice-row` + `.invoice-status`; `.btn`, `.btn-ghost`; `.error-banner` | **Pill** (.plan-pill → shell/neutral) · **Card** (.upgrade-hero) · **Button** (.btn/.btn-ghost) · **SectionHead** (.invoice-block h2) · **Topbar** |
| `/upgrade` | `app/upgrade/page.tsx` (11) | **No markup.** `redirect("/subscription")`, `metadata.robots = noindex` | **Nothing to migrate.** Classify Operate, but exclude from the surface table's work. Record it so the 19-count is honest. |
| `/dev-preview` | `app/dev-preview/page.tsx` (430) | `.dashboard.analysis-dashboard`; `.topbar` + `<span class="wordmark">` (not a link) + `.chip` with **inline style** `marginLeft:"0.75rem"`; `.nav-link`; `.toggle` scenario buttons; `.game-meta` with **inline style**; `.analysis-workspace` + `.analysis-report-column` → `CoachingReport` per `SCENARIOS` | **Pill** (.chip) · **Button variant="toggle"** (scenario switch) · **Topbar** · remove inline styles · **add `metadata.robots = noindex`** (§11.1 #6 defect) · drop the pointless `.analysis-workspace` grid |

### 9.3 Read — content (7)

All seven share `(content)/layout.tsx` → `.dashboard.legal-dashboard.content-dashboard`, `.topbar` + `.nav-link`×3, `.legal-page.content-page`. Per-page classes below are the *only* per-page differences.

| Route | Per-page markup (verified) | Becomes |
| --- | --- | --- |
| `/chess-com-game-review-alternative` | `.content-lede`, `.compare-table`, `.content-cta` (`.btn` + `.btn-ghost`), `.faq-list`/`.faq-item` | `Button`×2, `SectionHead` (via FaqSection), `.compare-table` restyled with hairline rows (not primitives) |
| `/chess-game-analyzer` | `.content-lede`, `.content-cta`, `.faq-list`/`.faq-item` | `Button`×2, `SectionHead` |
| `/faq` | `.content-lede`, `.content-cta`, plus `FaqSection` client-side | `Button`×2, `SectionHead` |
| `/how-to-analyze-your-chess-games` | `.content-lede`, `.content-cta`, `.faq-list`/`.faq-item` | `Button`×2, `SectionHead` |
| `/lichess-game-analysis` | `.content-lede`, `.content-note` (`border-left:2px solid var(--gold)` — note: 2px, gold, on the **shell**, legal there but a habit), `.content-cta`, `.faq-list`/`.faq-item` | `Button`×2, `SectionHead`; `.content-note` → `Card surface="shell"` or a hairline aside |
| `/sample-report` | `.content-lede`, `.report-block` (`.report-block-tag` uppercase), `.content-cta`, `.faq-list`/`.faq-item` | `Card`, `Pill tone="accent"` (replaces the uppercase tag), `Button`×2 |
| `/tactics` | `.content-lede`, `.tactics-grid` + `.tactics-card`×N, `.content-cta`, `.faq-list`/`.faq-item` | `Card` (.tactics-card), `Button`×2, `SectionHead` |

### 9.4 Read — legal (5)

All five share `(legal)/layout.tsx` → `.dashboard.legal-dashboard`, `.topbar` + 1 `.nav-link`, `.legal-page`.

| Route | Per-page markup (verified) | Becomes |
| --- | --- | --- |
| `/about` | `.about-tagline` (`--gold-bright` — on shell, legal), `.about-cta` + `.btn`, `.legal-updated` | `Button`; tagline is shell text (keep gold) |
| `/contact` | `.legal-updated` only | nothing to migrate |
| `/privacy` | `.legal-updated` only | nothing |
| `/refund` | `.legal-updated` only | nothing |
| `/terms` | `.legal-updated` only | nothing |

The `.legal-page` typography (h1 clamp `1.9–2.5rem`, h2 1.25rem, Fraunces) stays — these pages are already calm, and they are indexed, so they get **class-name substitution only** (§10).

### 9.5 Cross-cutting component map (what each of the 37 components becomes)

| Component | Current classes | Primitive(s) |
| --- | --- | --- |
| `AnalyzerForm` | `.analyzer-form`, `.platform-toggle`, `.field`, `.game-rows*`, `.paste-button`, `.color-chip`, `.add-game`, `.game-rows-hint`, `.psych-unlock`, `.psych-unlock-badge`, `.btn` | Card, Field, Button(toggle/ghost/quiet), Pill |
| `AuthButton` | `.user-menu`, `.user-name`, `.btn`, `.btn-ghost` | Button |
| `AnalysisStatus` | `.status-badge`, `.status-mark`, `.spinner` | Pill |
| `AnalysisHistory` | `.history-*`, `` `history-status status-${…}` `` | Pill, Card(empty), Button |
| `BatchProgress` | `.batch-progress*`, `.state-*`, `.spinner` | Card, Pill |
| `CoachingReport` | `.report`, `.report-section`, `.report-skeleton*`, `.section-boards-skeleton`, `.insight-skeleton-card`, `.drill-grid`, `.drill-skeleton` | **report stays semantic CSS** (§1.3); skeletons reuse Card |
| `CoachingPedigree` | `.pedigree-*` | Card, Pill, SectionHead |
| `FocusAreasBoard` | `.focus-*`, `.report-details*` | Card, mono `tag-do/dont/work` |
| `SectionInsightBoards` | `.insight-card`, `` `quality-${…}` ``, `.insight-*` + **5 dead classes** | Card, Pill (+ delete dead classes) |
| `DrillSection` | `.drill-section`, `.drill-section-head`, `.drill-clock`, `.drill-grid`, `.drill-extras*`, `.report-details*` | SectionHead, Card, Pill |
| `DrillCard` | `.drill-card`, `` `status-${…}` ``, `.drill-head`, `.drill-pill*`, `.drill-btn*`, `.drill-result*`, `.drill-collapse` | Card, Pill, Button |
| `DrillBoard` / `CriticalPositionBoard` / `HeroBoard` | `.drill-board`, `.critical-board`, `.hero-board`, `.sr-only` | bespoke (chessground) — untouched except elevation/no-shadow |
| `PsychologyPanel` | ~40 `.psych-*` | Card, Pill, SectionHead, **keep the SVG charts** |
| `PsychologyRadar` | `.psych-radar*` | bespoke SVG |
| `LockedPsychologyPreview` | `.psych-locked*` | Card + overlay (blur is a *content* lock, not elevation — keep) |
| `AccuracyChart` / `EvalChart` | `.accuracy-chart`, `.acc-*`, `.eval-*` | bespoke SVG; convert the width transition to transform (§7.2) |
| `ReviewSection` | `.review-*`, `.stars`, `.star-*`, `.btn`, `.btn-ghost` | Button (radiogroup fix), Card, Field(textarea), SectionHead, Pill |
| `UpgradePrompt` / `LimitReachedPrompt` / `GuestQnaPrompt` | `.upgrade-prompt`, `.upgrade-note`, `.upgrade-subtext`, `.btn`, `.btn-ghost` | Card, Button |
| `GuestSignInPrompt` | `.guest-modal-backdrop`, `.guest-modal`, `.guest-modal-close` | Card, Button (dialog is bespoke; keep `role="dialog"` + `aria-modal`) |
| `FaqSection` | `.faq-panel`, `.section-head`, `.article-meta faq-meta`, `.faq-list`, `.faq-item`, `.faq-more` | SectionHead, Pill (article-meta is prose) |
| `SiteFooter` | `.site-footer*`, `.wordmark-glyph`, `.site-footer-explore` (dead) | SectionHead-ish nav groups; delete dead class |
| `AnalyzerGuide` | `.faq-panel`, `.section-head`, `.pedigree-body`, `.faq-list`, `.faq-item`, `.faq-more` | SectionHead; **prose stays semantic CSS** (search/AI-readable copy, §10.1 spirit) |
| `ArticleMeta` | `.article-meta`, `.article-meta-updated` | prose — untouched |
| `ResourceLinks` | `.resource-links`, `.resource-link`, `.resource-title`, `.resource-move` | Card / list rows |
| `GameAnalysisCard` | `.game-card*`, `.game-link`, `.count-*`, `.history-platform` | Card, Pill, Button, SectionHead |
| `HeroRule` | `.hero-rule*` | **this is the signature-motion surface** (§7.2) |
| `ReportIcons` / `JsonLd` | none | untouched |

---

## 10. Migration ordering across the routes (traffic × risk)

### 10.1 The explicit rule about the content pages

The 7 content pages are **indexed and ranking at brand-position ~1.6** (measured in `seo/geo-baseline-2026-10-11.md`: average position **1.6**, CTR 27.3%, over 3 clicks / 11 impressions in the Oct 5–9 window). They are the only organic search asset the site has. Therefore:

> **The 7 `(content)` route files are migrated LAST, and only if the change is provably markup-clean** — i.e. a `className` substitution that preserves element type, nesting, text, and heading order, with no wrapper added or removed. Any change that alters the DOM shape (a new `Card` wrapper, a heading level, a different element for a CTA) does **not** ship to a content page in this programme. Guard: capture the rendered HTML before and after, diff it, and require the diff to be `class` attributes only.

The rationale for *last* rather than *never* is that these pages already use the calmest markup in the repo (plain `<h1>/<h2>`, `.content-lede`, `.content-cta`, tables, FAQ `<dl>`), so there is very little to gain — the 12 uppercase and 14 sidebars live almost entirely in the report and psychology surfaces, not here. The only content-page wins are `.report-block-tag` (sample-report), `.tactics-card`, and `.compare-table` borders.

### 10.2 Order

| Phase | Routes | Traffic | SEO risk | Change risk | Why here |
| --- | --- | --- | --- | --- | --- |
| **0 — token layer only** | all (no markup) | — | none | low | T1–T6 in §3.4 are invisible value swaps except `--ink-muted`→`--paper-muted`, which fixes a live AA failure. Ship alone so any regression is attributable. Verify with `next build` (§8.4). |
| **1 — primitives + `cn()` scaffolding** | none rendered | — | none | low | Build the six primitives, `cva` maps, the CSS-gold-on-paper CI check. Nothing imports them yet. |
| **2 — `dev-preview`** | 1 | internal | none once `noindex` added | low | A harness that renders `CoachingReport` in isolation. Add `robots: noindex` **first** (§11.1 #6), then use it as the visual acceptance gate for every later phase against `2026-preview.html`. |
| **3 — `history`** | 1 | low (auth-only) | none (`noindex`) | low | Fewest components (2), no report internals, exercises Button/Pill/Card/empty-Card. |
| **4 — `analysis/[id]` + `batch/[id]`** | 2 | auth-only, deep-link | low (no metadata → should be `noindex` too; add it) | **high** | Where the inline-Q&A rebuild (§7.3) lands, plus `.analysis-workspace` deletion and `anchor_ref`. Do the backend `anchor_ref` migration and the null-anchor fallback in the same change so no message ever disappears. |
| **5 — `(legal)` ×5** | 5 | low | medium (indexed) | low | Nearly empty pages; the work is the shared `(legal)/layout.tsx` topbar + `.legal-page` typography only. One layout change covers five routes. Because the pages are thin, keep it class-only. |
| **6 — `subscription` + `upgrade`** | 2 | revenue-critical | medium (canonical `/subscription`) | medium | Operate surface, but it *earns*. Do it before the landing page so the Plan/Pill/Invoice primitives are proven, and review the rendered page against preview before merging. `upgrade` is a redirect stub. |
| **7 — `/` (`HomeDashboard`)** | 1 | **highest** | **high** (indexed, brand-match) | **high** | Largest single change: hero grid (delete the `useLayoutEffect`), the `aria-hidden` fix, the mobile topbar, the form, the pedigree, the FAQ, the reviews. It touches the most components, so it goes after the primitives are proven — but *before* the content pages, because the content pages are the stricter rule (§10.1). |
| **8 — `(content)` ×7 — LAST** | 7 | **the organic asset** | **highest** | low if class-only | Per §10.1. Only `.report-block-tag`, `.tactics-card`, `.compare-table`, `.content-note`, and `FaqSection`'s `SectionHead` change. Diff-and-require-class-only. |

**Ordering principle, stated once:** risk is `SEO exposure × markup churn`. `dev-preview` is free (no SEO, high churn tolerated because it is a harness). The auth-gated Operate pages are free (no SEO, high churn forced by the Q&A rebuild). The content pages are expensive (high SEO, and they do not need the churn). `/` sits between: high churn, indexed, but it is the product and the `aria-hidden` bug is a real defect, so it ships before the content pages and after the primitives are proven.

---

## 11. Open questions and risks

### 11.1 Facts I could not reconcile with the brief (verify before implementing)

| # | Issue | What I measured | Risk |
| --- | --- | --- | --- |
| **1** | **18 vs 19 routes** | The brief lists **19** routes and says "18 routes". `find frontend/app -name page.tsx` returns **19**. The brief's own mode definitions cover 18 (`Persuade` 1 + `Operate` 5 + `Read` 12). The uncounted route is **`/dev-preview`**. | Low, but the per-surface table must not be silently short by one. This spec covers all 19 and flags `/upgrade` (a redirect stub) as having no markup to migrate. |
| **2** | **"34 CSS custom properties"** | `globals.css` defines **31** distinct custom properties (26 in `:root` lines 1–28 + 5 at 3177–3183). The preview also says "34". | Low. Use 31. If the "34" came from an uncounted set, it is not in this file. |
| **3** | **`--paper-muted` is named as existing** | The brief says "`--ink-muted` / `--paper-muted` #5f6a62". There is no `--paper-muted` in `globals.css`; the only token with value `#5f6a62` is **`--ink-muted`**. `--paper-muted` is *introduced by the preview* with the new value `#4d5a53`. | Low, and actually convenient: the rename and the value fix land together (§3.4 T1). |
| **4** | **Oxblood contrast** | The brief and preview both say oxblood `#7d3527` is **4.6:1** on parchment. I measured **7.40:1** on `--paper` and **6.69:1** on `--paper-2`. The value 4.6:1 actually matches the *current* `--dont` `#a94f42` (measured 4.59:1). | Low (both pass), but do not write "4.6:1" into a client-facing doc — it is wrong by ~3×. Use 7.40:1. |
| **5** | **Preview token drift, labelled "identical"** | `2026-preview.html` line 35 says "Identical to the live app's 34 variables". It is not: preview `--bronze: #7d5a1d` vs live `--bronze: #8a6420`; preview drops `--ink-muted-2` `#57615a`, `--teal-light`, `--do`, `--dont`, `--dont-deep`; preview adds `--oxblood`, `--paper-text`, `--paper-muted`, `--font-mono`. | **Medium.** The `--bronze` change silently shifts every bronze on paper (`.report a`, `.resource-link`, `.report-details-summary`, `.focus-rank`). Decide explicitly: adopt `#7d5a1c` (live `--bronze-deep`) as the single paper bronze, or keep `#8a6420` (4.55:1 — a bare pass). |
| **6** | **Page-level `dev-preview` is indexable** | `app/dev-preview/page.tsx` has **no** `metadata` export, so it inherits the root layout's `robots: { index: true, follow: true }`. `history` and `upgrade` correctly set `noindex`; `dev-preview` does not. | **Medium.** A QA harness with fake reports is currently a crawlable URL. Fix before phase 2. |
| **7** | **Dead classes rendering unstyled** | `.insight-card-body`, `.insight-card-text`, `.insight-board`, `.no-board`, `.board-only` (`SectionInsightBoards.tsx`), `.batch-progress-count` (`BatchProgress.tsx`), `.faq-meta` (`FaqSection.tsx`), `.site-footer-explore` (`SiteFooter.tsx`) have **0 occurrences** in `globals.css`. | Medium for `.insight-card-body`/`.insight-board` — the insight cards' internal layout is currently unconstrained, which is plausibly part of why the report feels dense/unruly on `/analysis/[id]`. Decide the intended layout as part of the `Card` migration instead of porting the dead names. |
| **8** | **`--font-mono` / DM Mono** | The preview relies on a mono voice for pills, meters, ranks, move notation, `.cp`; the live app has no mono token and `lib/site.ts` / `app/layout.tsx` load only Fraunces + DM Sans. | **Medium, needs a decision.** Adding DM Mono is a font addition, which the brief's "no new fonts" forbids at the brand level. Options: (a) treat mono as a utility voice, not brand expression, and add it; (b) substitute `ui-monospace`; (c) drop the mono treatments and use Fraunces numerals for rank/score (the brief does say "Fraunces serif numerals" carry hierarchy). **(c) is the on-brief choice** and keeps the pill/rank hierarchy within the two existing fonts. |

### 11.2 Risks

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | **The `anchor_ref` rebuild loses existing Q&A.** `analysis_messages` (migration `0001_init.sql` line 28) has no `anchor_ref` today; every existing row is effectively "null anchor". | Make `anchor_ref` nullable with no backfill, and make the document-level "Coach conversation" section the **default** render. An anchored panel is additive. Test with a pre-existing analysis that has messages. |
| R2 | **Chessground vs the preview's board.** The preview's `.board`/`.pc`/`13.8cqw` hand-rolled renderer is *not* the live board (`.cg-wrap`, `@lichess-org/chessground`). Porting `.pc{font-size:13.8cqw}` or `.arrows` onto chessground will fight its own CSS. | Take only the *colour* decisions from the preview's board (`.a-played` oxblood, `.a-best` teal on paper; `--red`/`--green` on shell; `.board-wrap.paper` = hairline ring, no 7px ink frame) and leave the rendering to chessground. The 7px ink frame removal (`.hero-board` `box-shadow: 0 0 0 8px var(--ink-2)`, line 342) is a legitimate one-elevation fix. |
| R3 | **Dev/build CSS-order divergence flips a colour.** | Gate on `npm run build` (§8.4). Never sign off a colour change from `next dev`. |
| R4 | **`Card` without the elevation rule gets re-added by habit.** The next person to add "a bit of polish" adds a blur. | The CI grep in §3.5 can be extended: fail if any selector matching a `Card` surface has a `box-shadow` with a blur > 8px. Document the one-exception (`.report`). |
| R5 | **`SectionHead` over-applied** to Card header rows (`.insight-card-header`, `.drill-head`, `.moment-head`, `.psych-head`, `.game-card-header`), reintroducing a hairline under every card and making the report *busier*, not calmer. | §4.5's explicit boundary. Reviewers should reject any `SectionHead` inside a `Card`. |
| R6 | **Gold creeps back onto paper** via a one-off, because it looks right in `next dev` on a warm monitor. | §3.5 layer 2 (tone downgrade) + layer 3 (CI grep). Also note the existing `.acc-bar-fill { background: linear-gradient(90deg, var(--teal), var(--gold)) }` (line 770) and `.psych-spectrum-fill` (1064) already run gold across parchment as a *fill* — fills are legal, but they must not be mistaken for precedent for gold *text*. |
| R7 | **`--red` on `--ink-3` small text** (4.19:1) survives because it is "close enough". | §7.5. Fix `.state-failed .batch-progress-state`. |
| R8 | **The global reduced-motion kill-switch masks a width-animated meter.** Today `.acc-bar-fill` transitions `width` (line 772) and `.report-skeleton-line` is a width. | §7.2: convert meters to `transform` from a true resting value. Verify by disabling the animation entirely and confirming the number still reads correctly. |
| R9 | **Mobile nav "fixed" by another wrap.** The observed 390px break becomes a wrapped second row and looks solved in a screenshot. | §6.2 is explicit: a disclosure menu, not a wrap. The disclosure is keyboard-operable with `aria-expanded`/`aria-controls`. |
| R10 | **Traffic premise is thin.** Brand-position 1.6 sits on **3 clicks / 11 impressions**. `seo/geo-baseline-2026-10-11.md` also notes `chessmasterss.vercel.app` is indexed as a different, unrelated chess site, and `seo/vercel-abuse-report.md` indicates third-party traffic stats did not show the domain. | The §10.1 rule (content pages last, class-only) is still correct — it is cheap insurance. But do not justify the whole programme as "protect our traffic"; it is protecting a small, newly-indexed position (site entered the index ~Oct 5). The real reason to leave content markup alone is that it has the least to gain. |
| R11 | **Tailwind v4's lower browser baseline** silently drops users on Safari <16.4 / Chrome <111 / Firefox <128, with no polyfill. | Accepted trade-off of decision 7. Confirm no `color-mix()`/`oklch()`/`@property` is required by the primitives. |
| R12 | **`body:has(.legal-dashboard)` footer-width selectors** (lines 2271–2277) depend on a class on a sibling of `<footer>`. | Replace with a CSS variable set by each layout (`--shell-width`) or a `data-` attribute on `<body>`. `:has()` works in the baseline but the coupling is fragile and will surprise the next layout change. |
| R13 | **The codebase moved while this spec was being written.** `HomeDashboard.tsx` grew from 743 → 751 lines mid-session (an `AnalyzerGuide` import + render was inserted at line 665, and a new `components/AnalyzerGuide.tsx` appeared). All load-bearing claims were re-verified against the current file (the `aria-hidden` bug is now line 657; `useLayoutEffect`/`getBoundingClientRect` at 93/111 still present). | **Treat every line number in this spec as a locator, not a fact.** Re-grep by selector/symbol before editing. Nothing in the spec's conclusions changed — the aria-hidden defect, the JS hero alignment, `.mindset-kicker`, `.quota-pill` and `.section-head` all survive the edit. |

### 11.3 Open questions for the product owner

1. **Status pill renaming.** `.status-badge` is both an *analysis progress* indicator (with `pulse`) and a *done* indicator. Does the Pill keep a `pulse` tone-specific animation, or does progress move to a spinner + text only (calmer, and reduced-motion-safe by construction)?
2. **`--bronze` reconciliation** (§11.1 #5): one paper bronze at `#7d5a1c`, or keep `#8a6420`?
3. **DM Mono** (§11.1 #8): add the mono voice, or carry numerals in Fraunces?
4. **`/dev-preview` in production.** `noindex` it, or gate it behind a feature flag / auth so it can never be discovered? It renders fake reports attributed to real-looking games.
5. **Do legal pages keep indexability** during their phase-5 touch? `(legal)` sets no `robots`, so they inherit `index, follow`. If the intent is that only content pages earn indexation, that is a separate decision.
6. **`.psych-locked-preview` blur** (`filter: blur(10px)`, line 1343) is a *paywall* affordance, not elevation. Confirm it stays exempt from the one-elevation rule (this spec assumes yes, since it is a content lock, not a surface treatment).

---

## Appendix A — Verified inventories

**The 12 uppercase removals** — lines 234, 837, 986, 1019, 1289, 1325, 2743, 3252, 3429, 3673, 3905, 4095.
**The 14 `border-left: 3px` removals** — lines 617, 799, 820, 1265, 1412, 2049, 2053, 2114, 2786, 3386, 3413, 3418, 3572, 3888.
**The 31 custom properties** — `--ink, --ink-2, --ink-3, --line, --line-soft, --text, --text-muted, --gold, --gold-bright, --green, --red, --amber, --teal-light, --paper, --paper-2, --paper-line, --ink-text, --ink-muted, --bronze, --teal, --radius-card, --radius-control, --input-bg, --input-line, --font-display, --font-body` (lines 1–28) and `--do, --dont, --dont-deep, --bronze-deep, --ink-muted-2` (lines 3177–3183).

## Appendix B — Measured contrast values used in this spec

| Pair | Ratio | Grade |
| --- | --- | --- |
| `#202725` on `#f3ecdc` | 12.95:1 | AAA |
| `#202725` on `#e9e1cd` | 11.69:1 | AAA |
| `#5f6a62` on `#f3ecdc` | 4.79:1 | AA |
| `#5f6a62` on `#e9e1cd` | **4.33:1** | **fails AA** |
| `#4d5a53` on `#f3ecdc` | 6.15:1 | AA |
| `#4d5a53` on `#e9e1cd` | 5.55:1 | AA |
| `#c9993f` on `#f3ecdc` | **2.20:1** | **fails** |
| `#c9993f` on `#0c1214` | 7.29:1 | AAA |
| `#e2b65f` on `#0c1214` | 9.97:1 | AAA |
| `#2f6b62` on `#f3ecdc` | 5.25:1 | AA |
| `#2f6b62` on `#e9e1cd` | 4.74:1 | AA |
| `#7d3527` on `#f3ecdc` | 7.40:1 | AAA |
| `#7d3527` on `#e9e1cd` | 6.69:1 | AA |
| `#a94f42` on `#f3ecdc` | 4.59:1 | AA |
| `#9c4739` on `#e9e1cd` | 4.78:1 | AA |
| `#57615a` on `#e9e1cd` | 4.94:1 | AA |
| `#8b9c9c` on `#0c1214` | 6.59:1 | AA |
| `#c96a5a` on `#131c1f` | 4.69:1 | AA |
| `#c96a5a` on `#1b262a` | **4.19:1** | **fails AA** |
| `#6fa383` on `#f3ecdc` | 2.46:1 | fails (fill only) |
| `#d3a24a` on `#f3ecdc` | 1.97:1 | fails (fill only) |

## Appendix C — What could not be verified

- The `dev-preview` route's runtime behaviour (it needs `SCENARIOS` content I did not fully read; only its chrome and the absence of `metadata` were confirmed).
- Whether `analysis_messages` rows exist in production; only the schema (`0001_init.sql`) and the endpoint (`backend/main.py:1346`, `POST /api/analyses/{id}/messages/stream`) were read, plus the two PostgREST calls at `backend/services/db.py:285,298`.
- The 436-line `subscription/page.tsx` was read via its class usages and structure, not line-by-line; its primitive mapping may miss a bespoke block.
- No browser was run. The 390px finding is carried from the brief and independently corroborated by `2026-preview.html` line 831, but was **not** re-observed in a viewport in this session.
