# Stitch Site Blueprint — Chessmasters
> Project Constitution & Multi-Page Architecture Specification (`stitch::site-md`)

---

## 1. Core Identity
- **Project Name:** Chessmasters
- **Stitch Project ID:** `stitch-chessmasters-prod-2026`
- **Mission:** Democratize grandmaster post-game chess pedagogy by combining real-time Stockfish 17 evaluation with AI cognitive psychology, explaining *why* club players stumble and coaching them to long-term mastery.
- **Target Audience:** Competitive club players (800–2200 Elo) seeking deep actionable lessons over raw spreadsheet numbers, and FIDE chess coaches managing student cohorts.
- **Voice:** Calm, authoritative, encouraging, intellectually rigorous, and tactilely refined.

---

## 2. Visual Language & Vibe
- **Primary Vibe:** **Quiet Mastery** (Tactile 19th-century tournament parchment + 2026 Linear/Raycast obsidian developer tool chrome).
- **Secondary Vibe:** **Cockpit Dense** (Tabular monospace telemetry, zero-wasted space, real-time board scrubbers, and high-contrast accessible accents).
- **Tertiary Vibe:** **Human-Centric Pedagogy** (Fraunces optical display serif, deep editorial focus areas, and psychological insight radars).

---

## 3. Architecture & Route Structure

```
frontend/
├── app/
│   ├── page.tsx                                  # Route: / (Hero Live Analyzer)
│   ├── analysis/[id]/page.tsx                    # Route: /analysis/[id] (Dual-Pane Workspace)
│   ├── progress/page.tsx                         # Route: /progress (Student Progress & Leaks)
│   ├── study/[id]/page.tsx                       # Route: /study/[id] (Curated Lichess Studies)
│   ├── scout/[username]/page.tsx                 # Route: /scout/[username] (Opponent Dossier)
│   ├── coach/page.tsx                            # Route: /coach (Coach Cohort Cockpit)
│   ├── onboarding/page.tsx                       # Route: /onboarding (10-Game Diagnostic)
│   ├── history/page.tsx                          # Route: /history (Player Game Archive)
│   ├── batch/[id]/page.tsx                       # Route: /batch/[id] (Multi-Game Batch Queue)
│   ├── subscription/page.tsx                     # Route: /subscription (Pricing & Plans)
│   ├── upgrade/page.tsx                          # Route: /upgrade (Redirect to /subscription)
│   ├── (content)/
│   │   ├── about/page.tsx                        # Route: /about (Founders & Pedagogy)
│   │   ├── faq/page.tsx                          # Route: /faq (Knowledge Base)
│   │   ├── tactics/page.tsx                      # Route: /tactics (Tactical Curriculum)
│   │   ├── sample-report/page.tsx                # Route: /sample-report (Master Sample Report)
│   │   ├── chess-game-analyzer/page.tsx          # Route: /chess-game-analyzer (SEO Guide)
│   │   ├── chess-com-game-review-alternative/    # Route: /chess-com-game-review-alternative
│   │   ├── lichess-game-analysis/                # Route: /lichess-game-analysis
│   │   └── how-to-analyze-your-chess-games/      # Route: /how-to-analyze-your-chess-games
│   └── (legal)/
│       ├── contact/page.tsx                      # Route: /contact (Direct Coach Support)
│       ├── terms/page.tsx                        # Route: /terms (Terms & Conditions)
│       ├── privacy/page.tsx                      # Route: /privacy (Privacy Policy)
│       └── refund/page.tsx                       # Route: /refund (Refund & Cancellation)
└── design-ideas/
    └── full-design-showcase.html                 # Interactive 18-Screen Production Prototype
```

---

## 4. Live Sitemap & Page Manifest

| Status | Route | Surface Type | Description |
|---|---|---|---|
| `[x]` | `/` | Home Analyzer | Modern hero with PGN/Lichess/Chess.com input, auto-color detection, sample loaders |
| `[x]` | `/analysis/[id]` | Flagship Workspace | Sticky 480px board instrument + 780px+ parchment editorial canvas + slide-over `⌘K` drawer |
| `[x]` | `/student` | Student Time Series | Longitudinal Elo, CAPS2 accuracy, 6-dimension psychology spider, clock panic curve |
| `[x]` | `/study/[id]` | Lichess Study | Multi-chapter navigation, `%csl` circles, `%cal` attack arrows, interactive chapter quiz |
| `[x]` | `/scout/[username]` | Opponent Dossier | Opening repertoire Trie, <30s panic threshold, tactical blindspot hotspots |
| `[x]` | `/coach` | Coach Cockpit | Cohort student roster, leak detection table, automated blunder homework generator |
| `[x]` | `/onboarding` | Diagnostic Audit | 10-game batch intake, TLI (Tactical Leak Index), TTV (Time Trouble), OSS (Opening Stability) |
| `[x]` | `/history` | Game History | Card library with win/loss indicators, accuracy badges, and instant re-analyze |
| `[x]` | `/batch/[id]` | Batch Queue | Multi-game parallel engine processing with aggregate leak matrix |
| `[x]` | `/about` | About & Pedagogy | Parth Kaushik AIM & Yatharth Anand founder dossiers, grandmaster principles |
| `[x]` | `/faq` | Knowledge Base | Searchable accordion covering engine depth, CAPS2 algorithm, coach subscriptions |
| `[x]` | `/tactics` | Tactics Curriculum | 8 deep tactical motifs with interactive FEN diagrams and Lichess drill slugs |
| `[x]` | `/subscription` | Pricing & Plans | Free vs Pro vs Coach tiers, monthly/annual toggle, Razorpay integration details |
| `[x]` | `/contact` | Contact & Advisory | Split inquiry form with 24h SLA badge, bug reporting, and office hours booking |
| `[x]` | `/terms` | Terms of Service | Production terms, AI generated disclaimer, fair use guidelines |
| `[x]` | `/privacy` | Privacy Policy | Engine telemetry privacy, GDPR/CCPA compliance, fair-play data handling |
| `[x]` | `/refund` | Refund Policy | 14-day money back guarantee, instant subscription cancellation flow |
| `[x]` | `/sample-report` | Sample Report | Full annotated walkthrough of Kasparov vs Deep Blue Game 6 |

---

## 5. Development Roadmap Backlog

### High Priority
- [x] Dual-Pane Analysis Workspace with 480px sticky board instrument and 780px+ parchment editorial column.
- [x] Contextual slide-over Q&A drawer (`⌘K`) anchored to specific move plies.
- [x] Full interactive 18-page browser showcase in `design-ideas/full-design-showcase.html`.
- [x] WCAG AAA contrast hardening (eliminating all gold-on-paper contrast regressions).

### Medium Priority
- [ ] Connect Next.js App Router routes (`/student`, `/study/[id]`, `/scout/[username]`) to the frontend navigation.
- [ ] Implement backend `DrawClassifier` for the 4-quadrant draw diagnosis (`backend/services/draws.py`).
- [ ] Implement backend `LichessStudyParser` with `%csl` and `%cal` arrow extraction (`backend/services/studies.py`).
- [ ] Implement backend `OpponentScoutingService` with opening repertoire Trie (`backend/services/scouting.py`).
- [ ] Implement backend `OnboardingDiagnosticService` with TLI, TTV, OSS formulas (`backend/services/onboarding_diagnostic.py`).

### Low Priority
- [ ] Sound synthesis effects for piece captures, checks, and blunder alerts in Next.js production.
- [ ] PWA offline game caching for tournament halls with unstable connectivity.
