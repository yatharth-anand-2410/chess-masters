# Stitch Design System — Chessmasters Pro Workspace
> Canonical Source of Truth generated via Google Stitch Semantic Design Specification (`stitch::taste-design`)

---

## 1. Visual Atmosphere & Philosophy

- **Density Rating:** `8.5 / 10` (Cockpit Dense for Analysis & Scout; `5.0 / 10` Balanced Editorial for About, Guides, & Legal).
- **Variance Rating:** `6.0 / 10` (Offset Asymmetric — Sticky 480px board instrument on the left, expansive 780px+ parchment editorial narrative on the right).
- **Motion Philosophy:** `6.5 / 10` (Spring physics: `stiffness: 110, damping: 22`. Perpetual micro-motion on live clocks, eval bar fill, and blunder retry pulses).
- **Aesthetic Identity:** **Quiet Mastery**. A tactile marriage of classical 19th-century tournament chess materiality (heavy cream parchment, woodgrain, brass clock weights) with modern 2026 developer tools (Linear / Raycast obsidian chrome, tabular monospace telemetry, keyboard-first navigation).

---

## 2. Calibrated Color Palette

Chessmasters enforces a strict **Dual-World Spatial Contrast Contract**:

### A. The Ink World (Application Shell, Header, Cockpit, Scouting)
Used for the overarching application frame, topbar, side drawers, chart dark backgrounds, and tactical radars.
- `--ink-0` (`#040708`): Deep space baseline.
- `--ink-1` (`#080c0e`): Primary shell canvas.
- `--ink-2` (`#0f1518`): Raised card background, input surfaces.
- `--ink-3` (`#151f24`): Elevated popovers, command pills, active states.
- `--text` (`#f0f4f5`): Crisp primary text (Contrast ratio `16.2:1` on `#080c0e`).
- `--text-muted` (`#899ca4`): Secondary annotations and clock markers (`5.8:1`).
- `--line` (`rgba(255, 255, 255, 0.08)`): Hairline structural divider.
- `--line-strong` (`rgba(255, 255, 255, 0.16)`): Focus rings and active borders.
- `--gold` (`#c9993f`): Brass tournament medal accent.
- `--gold-bright` (`#e2b65f`): Primary active badge and accent text on ink (`7.1:1`).

### B. The Paper World (Coaching Report & Editorial Canvas)
Used exclusively for the deep psychological narrative, game reviews, and study reading surfaces.
- `--paper` (`#f4eee2`): Heavy vintage cream tournament score-sheet paper.
- `--paper-2` (`#eae3d2`): Recessed diagram backdrops and quote wells.
- `--paper-inset` (`#ded6c1`): Inset metric chips and timeline troughs.
- `--paper-text` (`#1c1712`): Pitch-black foundry ink (`13.8:1` on `#f4eee2`).
- `--paper-muted` (`#5a5247`): Secondary coaching annotations (`6.1:1` on `#f4eee2`).
- `--paper-line` (`rgba(28, 23, 18, 0.12)`): Tactile paper scoreline dividers.

### C. Semantic Functional Accents
- **Teal / Accent on Paper (`--accent: #2f6b62`):** Primary interactive buttons and insights on parchment (`5.3:1` WCAG AAA).
- **Blunder / Oxblood (`--alert: #7d3527`):** Critical tactical errors and choke indicators (`7.4:1` on paper, `#ef4444` on ink).
- **Brilliant / Emerald (`--win: #15803d` on paper, `#22c55e` on ink):** Best moves, winning fortress holds, rating gains.
- **Inaccuracy / Amber (`--warn: #b45309` on paper, `#f59e0b` on ink):** Minor imprecisions and time-pressure warnings.
- **Cyan / Engine Telemetry (`#06b6d4`):** Stockfish multi-PV evaluations and arrow vectors.

### Banned Color Patterns (Anti-Slop Directives)
- ❌ **NO AI Purple/Blue Neon:** Absolutely zero `#8b5cf6` or `#3b82f6` glowing buttons or neon hero glows.
- ❌ **NO Pure Black (`#000000`):** Use obsidian charcoal `#080c0e`.
- ❌ **NO Gold on Paper:** Gold text (`#c9993f`/`#e2b65f`) on `#f4eee2` fails WCAG AA (measures `2.2:1`). On paper, accents downgrade to `#2f6b62` (Teal) or `#7d3527` (Oxblood).

---

## 3. Typographic Architecture

1. **Brand & Display Typography (`--font-display`):**
   - Font: `Fraunces` (Google Fonts variable optical serif).
   - Usage: Page titles, game verdicts, founder pull-quotes, hero numbers.
   - Weights: `600 SemiBold`, `700 Bold`, `800 ExtraBold` with optical size `opsz 144` and soft soft-curve serif axis.
2. **Interface & Narrative Body (`--font-body`):**
   - Font: `DM Sans` / `Geist Sans`.
   - Usage: Coaching report prose, navigation items, form inputs, tooltips.
   - Max Line Length: `68 characters` for optimal reading comprehension.
3. **Telemetry & Clock Numerals (`--font-mono`):**
   - Font: `DM Mono` / `JetBrains Mono`.
   - Feature Settings: `tnum` (tabular numerals), `zero` (slashed zero).
   - Usage: Centipawn evaluations (`+1.4`, `-3.2`), move times (`0:14`), FEN strings, rating deltas (`+18 Elo`), CAPS2 accuracy (`89.4%`).

---

## 4. Master Multi-Screen Directory & Hierarchy

| Route | Page Name | Mode | Surface Aesthetic | Key Components |
|---|---|---|---|---|
| `/` | Live Game Analyzer | Operate | Asymmetric Dual Canvas | Live URL/PGN Input, Auto-Color Detector, Hero Board, Instant Sample Loader |
| `/analysis/[id]` | Flagship Coaching Workspace | Operate | Dual-Pane (Sticky Board + Parchment) | Next Game Rule, Phase-by-Phase Accuracy Matrix, Draw & Choke Diagnosis, Focus Areas (Do/Don't), Strength & Weakness Mini-boards, Replay Drill Arena, Curated Lichess Resources, Full 6-Dimension Psychology Panel |
| `/progress` | Student Progress & Leaks | Operate | Cockpit Dense Dashboard | Student Persona Profile, 3-Pillar Mastery Evolution (What Improved / What Improving / What Needs Work), Multi-Metric Series, Tilt Markers |
| `/study/[id]` | Curated Lichess Studies | Read | Split Chapter & Board | Curated directly from analyzed blunders, Multi-chapter Tree, %csl circles / %cal arrows, Coach Annotations, Interactive Drill Challenge |
| `/scout/[username]` | Opponent Scouting Dossier | Operate | Tactical Threat Radar | Opening Repertoire Trie, Time Trouble Vulnerability <30s, Tactical Blindspot Hotspots |
| `/coach` | Coach Cohort Cockpit | Operate | Data-Dense Master Grid | Student Roster, Leak Matrix, Automated Homework Assignment, Progress Alerts |
| `/onboarding` | 10-Game Diagnostic Diagnostic | Onboard | Card Progression | Instant Account Batch Audit, TLI (Tactical Leak Index), TTV (Time Trouble Vulnerability), OSS (Opening Stability Score) |
| `/history` | Player Analysis Archive | Operate | Visual Tile Feed | Game Cards, Win/Loss Badges, Accuracy Caps, One-Click Re-Analyze |
| `/batch/[id]` | Multi-Game Batch Queue | Operate | Batch Processing Monitor | Concurrent Engine Progress, Aggregate Cohort Metrics, Cross-Game Leaks |
| `/subscription` | Pricing & Subscription Plans | Persuade | Tier Comparison Grid | Active Plan Status, Free vs Pro vs Coach Tiers, Monthly/Annual Razorpay Toggle, 14-Day Guarantee |
| `/faq` | Knowledge Base & FAQ | Read | Searchable Accordion | 12 Categorized Inquiries, Deep Drill Explanations, Engine Telemetry FAQ |
| `/tactics` | Tactical Curriculum Directory | Read | Interactive Catalog | 8 Tactical Themes (Deflection, Pins, Forks, Skewers, etc.) with Live FEN Diagrams & Deep Drill Slugs |
| `/subscription` | Pricing & Subscription Plans | Persuade | Tier Comparison Grid | Free vs Pro vs Coach Tiers, Monthly/Annual Razorpay Toggle, FAQ & Guarantee Badge |
| `/contact` | Contact & Coach Advisory | Operate | Split Inquiry Card | Direct Founder Email, 24h SLA Badge, Inquiry Classification, Office Hours Booking |
| `/terms` | Terms & Conditions | Read | Clean Legal Document | Acceptable Use, AI Advisory Disclaimer, Razorpay Billing Details |
| `/privacy` | Privacy Policy | Read | Clean Legal Document | Zero-Telemetry Engine Guarantee, Data Retention, Fair Play Compliance |
| `/refund` | Refund & Cancellation Policy | Read | Clean Legal Document | 14-Day Money-Back Guarantee, Instant Cancellation Policy |
| `/sample-report` | Grandmaster Sample Analysis | Read | Full Annotated Walkthrough | Complete Benchmark Report for Kasparov vs Deep Blue Game 6 |

---

## 5. Component Specifications & Contracts

### 5.1 Dual-Pane Layout Geometry
```
+----------------------------------------------------------------------------------------------------+
| 52px Obsidian Topbar: Brand | Review | Time Series | Studies | Scout | Coach | About | FAQ | ⌘K   |
+------------------------------------------------+---------------------------------------------------+
| 480px Sticky Left Board Instrument             | 780px+ Parchment Editorial Workspace               |
| - Responsive 460px Chessground Board           | - Next Game Rule (Hero Brass Wedge)               |
| - Centipawn Evaluation Bar (-10 to +10)        | - CAPS2 Accuracy Matrix (Player vs Opponent)      |
| - Continuous Spline Eval Curve with Scrubbing  | - Draw Diagnosis Engine (Choke / Fortress Hold)   |
| - Move-Time Waterfall (aimchess-style)         | - Strength & Weakness Mini-Board Cards            |
| - Move Badges: !! | ! | ⭐ | ?! | ? | ??      | - Interactive Blunder Retry Drill Box             |
| - Keyboard navigation: [←] Prev [→] Next       | - 6-Dimension Psychology Panel                    |
| - Flip Board & Auto-Color Toggle               | - Curated Lichess Training Slugs                  |
+------------------------------------------------+---------------------------------------------------+
| Contextual Slide-Over Drawer (Right 400px, ⌘K): Anchored Move Q&A + Stockfish 17 Depth-22 Lines    |
+----------------------------------------------------------------------------------------------------+
```

### 5.2 Micro-Interactions & Audio
- **Audio Feedback:** Web Audio API synthesizer for piece move tick (`440Hz`), capture thud (`220Hz`), check chime (`880Hz`), and brilliant trumpet flourish (`587Hz -> 880Hz`).
- **Interactive Scrubber:** Dragging across the eval curve updates the board ply seamlessly in `<16ms` with zero layout shift.
- **Blunder Retry Drill:** Dynamic feedback state on wrong move (board shake + "Try deflection on e1") vs correct move (confetti flash + brilliant chime).

---

## 6. Anti-Patterns & Strict Bans
1. **NO cramped Tri-Pane Layout:** A 3-column layout shrinks narrative cards to <380px, causing illegible text and broken diagrams. Dual-Pane + Slide-over Drawer is mandatory.
2. **NO Missing Widget Regression:** Existing widgets (`HeroRule`, `AccuracyChart`, `SectionInsightBoards`, `DrillSection`, `PsychologyPanel`) must NEVER be stripped.
3. **NO Unlinked Navigation:** Every single app page must be reachable from the topbar, footer, and command palette (`⌘K`).
