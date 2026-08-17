# Bito Chess — complete app & codebase context

> A single-file reference describing everything Bito Chess is and does: the product,
> every feature, the architecture, the accounts and payment stack, the data model,
> every source file, the build and deploy pipelines, and the conventions the codebase
> follows.
>
> Written to be dropped into a Claude Project (or handed to a developer) as standing
> context. Generated from the repository state on branch
> `claude/app-docs-technical-overview-smdjtq`, at commit `40660dd`
> ("Connect the price to the payment" — the v0.24 buy-flow round).
>
> **This supersedes the earlier "Obertura — complete app & codebase context".** The
> product was renamed to **Bito Chess**; the GitHub repository is still `obertura`,
> and every internal identifier (localStorage prefixes, the IndexedDB database name,
> folder names) deliberately keeps the old codename. See §1.1.

---

## Table of contents

1. [What Bito Chess is](#1-what-bito-chess-is)
2. [Project status, versioning and history](#2-project-status-versioning-and-history)
3. [Tech stack, hard constraints and philosophy](#3-tech-stack-hard-constraints-and-philosophy)
4. [The two hosting targets](#4-the-two-hosting-targets)
5. [Repository layout — every file](#5-repository-layout--every-file)
6. [Build, scripts and deployment](#6-build-scripts-and-deployment)
7. [The server: the Cloudflare Worker](#7-the-server-the-cloudflare-worker)
8. [Accounts: Supabase auth](#8-accounts-supabase-auth)
9. [Account sync: the cross-device copy](#9-account-sync-the-cross-device-copy)
10. [The pro plan: entitlement and the free tier](#10-the-pro-plan-entitlement-and-the-free-tier)
11. [The buy flow: Stripe](#11-the-buy-flow-stripe)
12. [App shell, navigation and back handling](#12-app-shell-navigation-and-back-handling)
13. [Data model](#13-data-model)
14. [Storage layer](#14-storage-layer)
15. [The chess engines and analysis stack](#15-the-chess-engines-and-analysis-stack)
16. [Opening knowledge: naming, book, library, explorer stats](#16-opening-knowledge-naming-book-library-explorer-stats)
17. [Spaced repetition: the scheduler and line priority](#17-spaced-repetition-the-scheduler-and-line-priority)
18. [The board builder / game analyser](#18-the-board-builder--game-analyser)
19. [Train tab — the four training modes](#19-train-tab--the-four-training-modes)
20. [The daily challenge](#20-the-daily-challenge)
21. [My Lines tab](#21-my-lines-tab)
22. [Explore tab](#22-explore-tab)
23. [My games tab](#23-my-games-tab)
24. [Statistics tab](#24-statistics-tab)
25. [Settings](#25-settings)
26. [Game import, accounts and scouting](#26-game-import-accounts-and-scouting)
27. [First run: the guest-first onboarding](#27-first-run-the-guest-first-onboarding)
28. [Gate, survey, feedback, support](#28-gate-survey-feedback-support)
29. [Backup, Google Drive, publishing](#29-backup-google-drive-publishing)
30. [The landing page](#30-the-landing-page)
31. [Design system, theming and appearance](#31-design-system-theming-and-appearance)
32. [Preference reference (localStorage keys)](#32-preference-reference-localstorage-keys)
33. [Self-tests and runtime verification](#33-self-tests-and-runtime-verification)
34. [Third-party services and offline behaviour](#34-third-party-services-and-offline-behaviour)
35. [Known limits and deliberately deferred work](#35-known-limits-and-deliberately-deferred-work)
36. [Working conventions](#36-working-conventions)

---

## 1. What Bito Chess is

Bito Chess is a **chess-openings trainer**, built as an installable PWA and optimised
for a phone. Its pitch: *"Improve your next move — build your repertoire, train
smarter, and play with confidence."*

It began as a focused clone of Lotus (openings only) for one user — Marçal, a
designer/WordPress developer who directs the work but does not write code — and has
grown into a broad training app with a public website, guest-first onboarding,
optional accounts, cross-device sync and a one-time paid unlock.

- **Public app:** `https://bitochess.com/app/`
- **Public landing page:** `https://bitochess.com/`
- **Internal beta channel:** `https://marxal.github.io/obertura` (behind a beta code)
- **Repository:** `Marxal/obertura`

### The core loop

1. **Build** a repertoire — by hand on the board, from a bundled opening library, from
   starter packs, from opening traps, from Lichess studies, from your own imported
   games, from engine suggestions, or from scouting an opponent.
2. **Train** it — walk a line once to confirm it, then drill it. An SM-2 spaced
   repetition scheduler tracks every *move you play* and brings back what you miss.
3. **Widen out** — rated Lichess puzzles, mistake-retry drills over your own games,
   endgame puzzles and classic endgames played out against Stockfish/tablebase.
4. **Measure** — a Statistics screen of streaks, memory rings, win rates by opening,
   rating charts and per-opening trends.

### What changed with the move to a public product

The app used to be private: a beta-code gate, no accounts, no money, GitHub Pages
only. It is now two builds from one repository:

| | **Public (Cloudflare)** | **Internal (GitHub Pages)** |
|---|---|---|
| URL | `bitochess.com` (page) + `/app/` (trainer) | `marxal.github.io/obertura` |
| Beta gate | **skipped** | **kept**, unchanged |
| Supabase env vars | set → accounts, sync, entitlement all live | absent → all of it is inert |
| Free-tier cap | enforced | **not** enforced (fully entitled) |
| Server code | the Cloudflare Worker (`/api/*`) | none |

The rule everywhere: **if `isSupabaseConfigured` is false, every account/sync/payment
code path returns early and the build behaves exactly as it did before any of this
existed.** That is why the internal channel is untouched by the commercial work.

### 1.1 The rename (Obertura → Bito Chess)

The public product name is **Bito Chess**. `obertura` survives as an internal
codename, deliberately and permanently:

- The GitHub repository is still `Marxal/obertura`, and the GitHub Pages build still
  serves at `/obertura/`.
- The IndexedDB database is still named `obertura`.
- Every localStorage key is still prefixed `obertura.` / `obertura-` (this is what
  the "erase everything" sweep and the backup filter match on).
- The backup file format string is still `'obertura-backup'`.
- The DOM/CSS ids and class names are unchanged.
- Custom events are `obertura:syncchange`, `obertura:entitlementchange`.

What *did* change: `package.json` name (`bito-chess`), `__APP_NAME__` (`'Bito
Chess'`), the `<title>`, the header wordmark (`bito chess`), README, ROADMAP and the
landing page. **Do not "finish" the rename** by touching storage keys or the DB name —
that would orphan every existing user's data.

### Non-goals (still protected)

No server for user data (the one Worker exists purely to receive a payment webhook).
No paid services without explicit approval. No service worker / offline mode yet.
IndexedDB on the device remains the single source of truth for every read.

---

## 2. Project status, versioning and history

`ROADMAP.md` is the authoritative, phase-by-phase log (≈1,530 lines). `CLAUDE.md` is
the project guide (behavioural rules for the AI, stack decisions, hard constraints).

### Versioning scheme

The project ran an internal `v1.x` scheme, then renumbered to a **public `v0.x` beta
scheme**. Old git tags `v1.0`–`v1.3` are left intact; new rounds are numbered `v0.x`.
Conceptual mapping: v1.0→v0.1, v1.1→v0.2, v1.2→v0.2, v1.3→v0.3.

`package.json` version is still `0.4.0`, and **`v0.4` is the standing rollback tag** —
every round since has used it as its restore point.

### Round-by-round history (condensed from ROADMAP.md)

| Round | Theme | Status |
|---|---|---|
| v1.0 | Board on phone → builder → SM-2 training → Stockfish → explanations → Chess.com import | ✅ |
| v1.1 | Design-token theming, tab bar, Today dashboard, offline opening DB, backup/restore, Settings | ✅ |
| v1.2 | Foundations audit, four-tab restructure, Explore tab, trimmings | ✅ |
| v1.3 | Visual language (felt green, four themes), builder truth, Train hub, Statistics, onboarding | ✅ |
| v0.4 | Beta polish: onboarding, Explore vs Statistics split, unified builder, ~3× larger opening library, traps, landing page | ✅ (tag `v0.4`) |
| v0.5 | Card polish, PWA shell fixes, Train redesign, **daily challenge**, Statistics overhaul, forgotten-moves carousel | ✅ |
| v0.6 | **Google Drive cloud backup** + `PUBLISHING.md` | ✅ |
| v0.7 | **Mistake retry**: Train 2×2 grid, the mistake scan, the retry drill | ✅ |
| v0.8 | General fixes: instant retry answers, engine circuit breakers, **full backup (format v2)** | ✅ |
| v0.9 | Retry analysis & organisation, daily puzzle ladder, stats carousels | ✅ |
| v0.10 | **End game module**: endgame puzzles + classic endgames vs tablebase | ✅ |
| v0.11 | **Learn** surfaces: YouTube video cards, one shared API key | ✅ |
| v0.12 | Statistics & fixes: your site rating + charts, one shared chart engine | ✅ |
| v0.13 | **Circle-graph statistics**: donut engine, move memory ring, sliding carousels | ✅ |
| v0.14 | Memory-join fixes (`familyKey`), "Engine always on" pref | ✅ |
| v0.15 | Faster/deeper reviews: cloud miss-streak cutoff, opt-in chess-api.com deep tier | ✅ |
| v0.16 | **Engine un-sticking** (4 hang fixes), **Lichess studies in Packs**, scannable Packs layout | ✅ |
| **v0.17** | **Free tier: the training cap** — `entitlement.ts`, 10 lines in training, DB-enforced `entitled` | ✅ |
| **v0.18** | **Sync stops re-uploading the game library** — two columns, fingerprints, flush on close | ✅ |
| **v0.19** | **The guest-first first run** — picker replaces intro+wizard, guests are first-class | ✅ |
| **v0.20** | **The first-user round** — Get-started checklist, inline import, guest import cap | ✅ |
| **v0.21** | **The onboarding flow round** — coach-marks walkthrough, training locked to 3 lines (five passes) | ✅ |
| **v0.22** | **The builder tab round** — Explore/Library/My lines/Line info/Engine, one move strip, line priority | ✅ |
| **v0.23** | **The landing page round** — rebuilt on the app's tokens, playable hero board, buy button | ✅ |
| **v0.24** | **The buy flow actually sells** — Lemon Squeezy checkout, four unlock signals, €9 everywhere | ✅ |
| **v0.5** | **Stripe migration** — direct Stripe Checkout, EUR + SEK from Stripe, you as merchant of record | ✅ |
| v1.4 / Later | Parked: 4th theme, map transpositions, true per-line sync, deeper engine adaptation, offline SW | 💤 |

Rounds v0.17 onward each carry a branch name and `Restore point: v0.4` in the roadmap.

---

## 3. Tech stack, hard constraints and philosophy

### Stack

| Layer | Choice |
|---|---|
| Build tool | **Vite 5**, base `/obertura/` or `/app/` (see §4) |
| Language | **TypeScript 5.4**, `strict: true`, `noEmit` (tsc is a type-check gate; Vite bundles) |
| Framework | **None** — vanilla TS with direct DOM construction |
| Board UI | **chessground 9** (Lichess's board) |
| Chess rules / SAN / PGN | **chess.js 1.3** |
| Engine | **stockfish 18 lite (single-threaded WASM)**, in a Web Worker |
| OAuth (Lichess) | `@bity/oauth2-auth-code-pkce` |
| Accounts / sync | **`@supabase/supabase-js` 2.x** (auth + one Postgres table) |
| Payments | **Stripe Checkout** (hosted, redirect), direct merchant · EUR + SEK |
| Server | **One Cloudflare Worker** (`worker/`), for the purchase webhook only |
| Local storage | **IndexedDB** (repertoire, games, opponents) + **localStorage** (prefs, stats, streaks, logs) |
| Hosting | **Cloudflare Workers + static assets** (public) and **GitHub Pages** (internal) |
| Fonts | Google Fonts *Chakra Petch* — wordmark only |

**Five runtime dependencies** (`@bity/oauth2-auth-code-pkce`, `@supabase/supabase-js`,
`chess.js`, `chessground`, `stockfish`) and **two dev dependencies** (typescript,
vite). No CSS framework, no icon package (icons are inlined SVG in `src/icons.ts`), no
chart library (charts are hand-rolled inline SVG in `src/stats-charts.ts`), no test
framework (self-tests are plain functions returning result arrays).

Rough size: **177 TypeScript modules** (~54,500 lines) + **17,000 lines of CSS** in one
file + 10 bundled JSON data files (~3.2 MB, all lazy except the openings map).

### Hard constraints

- **No backend for user data.** Every gameplay network call goes to a free, public,
  CORS-enabled third-party API, anonymously where possible. Supabase holds a *copy*
  of the device's data, never the working data. The Worker holds nothing.
- **IndexedDB is the source of truth for every read.** Sync and backup are one-way
  copies out (and an explicit, user-confirmed restore in).
- **Must install as a PWA on Android** (manifest + add-to-home-screen).
- **Online-only is fine.** A service worker / offline mode is explicitly deferred.
- **Keep files small and focused** — this keeps context/token cost low for AI work.
- **Never reach for a paid service without flagging it first.**
- **Secrets never enter the bundle.** Anything `VITE_`-prefixed is public by
  definition; the service-role key and the webhook signing secret are Worker secrets.

### Code philosophy visible throughout

- **Pure cores, self-tested.** Anything that can be logic-without-DOM is split into a
  pure module with a matching `*.selftest.ts` (scheduler, winprob, review grading,
  accuracy, stats, analysis, scout, traps, puzzles, puzzle-alt, mistake-scan,
  endgame-*, study-*, struggle, sync-core, import-tier, onboarding-lines).
- **Fail soft, always.** Every network client returns `null` on any failure and the UI
  degrades to a link/offline state rather than showing an error. **The one deliberate
  exception is the payment webhook**, which fails *loudly* — see §11.
- **Long explanatory header comments.** Nearly every file opens with a multi-paragraph
  comment explaining *why* the module exists and what the tricky parts are. These are
  the best documentation in the repo and should be maintained.
- **No migrations.** Old data loads as-is; new optional fields are simply absent on
  old records (`Line.priority`, `Line.timesTrained`, `MoveNode.noteAskedAtLapses`).

---

## 4. The two hosting targets

One repository and one build script produce two differently-shaped outputs, selected
by the `DEPLOY_TARGET` environment variable read in `vite.config.ts`:

| `DEPLOY_TARGET` | base | app output | landing page | gate |
|---|---|---|---|---|
| `github` (default, or unset) | `/obertura/` | `dist/` root | copied to `dist/docs/` by the GitHub Action | **shown** |
| `cloudflare` | `/app/` | `dist/app/` | `docs/` copied to the `dist/` **root** by a Vite plugin | **skipped** |

`vite.config.ts` also defines three compile-time constants:

```ts
__APP_NAME__     = 'Bito Chess'
__APP_VERSION__  = <package.json version>
__DEPLOY_TARGET__ = 'github' | 'cloudflare'
```

`__DEPLOY_TARGET__` is what lets the *app* know which channel it is — `gate.ts` reads
it and returns immediately on the Cloudflare build, so a stranger landing on
bitochess.com never meets an access-code wall (`src/gate.ts`, `maybeShowGate`).

`public/manifest.webmanifest` is shared unchanged: its `start_url: "."` is relative
and resolves correctly under either base.

Set `DEPLOY_TARGET=cloudflare` (plus `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`)
in the Cloudflare project. No other configuration differs between the two.

---

## 5. Repository layout — every file

```
/                          root
├── CLAUDE.md              project guide for Claude Code (behaviour + stack + constraints)
├── ROADMAP.md             phase-by-phase log of every round (the source of truth)
├── README.md              public readme (features, stack, licences, deploy)
├── APP-CONTEXT.md         ← this file
├── AUDIT.md               v1.2 read-only code audit + what was fixed
├── BACKNAV-DIAGNOSIS.md   v1.3 investigation into the dead back gesture in training
├── BETA-ACCESS.md         owner notes: rotating the beta access codes
├── DRIVE-SETUP.md         click-by-click Google OAuth client-ID setup
├── SUPABASE-SYNC.md       the one-time Supabase table + RLS + grants setup (SQL)
├── LEMONSQUEEZY-SETUP.md  the buy flow's dashboard half (secrets, webhook, redirect)
├── PUBLISHING.md          store/monetization options analysis + Play checklist
├── Obertura_Style_Guide.html  standalone visual style guide
├── index.html             the app shell (header, views, tab bar, pre-paint theme script)
├── vite.config.ts         base/outDir per target + __APP_NAME__/__APP_VERSION__/__DEPLOY_TARGET__
├── wrangler.jsonc         the Cloudflare Worker config (assets binding, run_worker_first)
├── tsconfig.json          ES2020, strict, bundler resolution, resolveJsonModule
├── package.json           deps + the npm scripts
├── .env.example           VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY template
├── .github/workflows/
│   ├── deploy.yml                build → copy /docs → upload → Pages
│   └── supabase-keepalive.yml    a 3-day REST ping so the free project never pauses
├── .claude/skills/verify/SKILL.md  repo skill: build + drive the app headlessly
├── worker/
│   ├── index.ts                  the Worker entry: routes /api/*, else static assets
│   ├── stripe-env.ts             shared secrets, clients, JWT verify, responses
│   ├── stripe-prices.ts          GET  active one-time prices, per currency
│   ├── stripe-checkout.ts        POST verified JWT + price → a Checkout session
│   └── stripe-webhook.ts         signature check → Supabase `entitled = true`
├── docs/                  the public landing page
│   ├── index.html              ~98 KB hand-written standalone page
│   ├── LANDING-COPY.md         the copy's source of truth (mirror by hand)
│   ├── app-icon.png, shot-*.png
├── public/
│   ├── manifest.webmanifest
│   ├── icons/             192 / 512 / 512-maskable / master
│   ├── boards/            blue-marble.jpg, newspaper.svg, olive.jpg, purple-diag.png, wood4.jpg
│   └── engine/            (gitignored) stockfish.js + stockfish.wasm, copied at build
├── scripts/               offline data generators + tooling (see §6)
└── src/                   the app (177 TS modules, 10 JSON data files, one CSS file)
```

### `src/` by area

#### App shell & navigation
| File | Lines | Role |
|---|---|---|
| `main.ts` | 4618 | The router and the builder/analyser controller. Owns `showView`, the chessground instance, the builder carousel, the save flow, the leave guards, the FAB, the desktop sidebar, the guided first line, the boot sequence. |
| `back-nav.ts` | | Android back-gesture trapping: one spare history entry, a dismissible-layer stack (`pushBack`) plus a view-level fallback (`setViewBack`). |
| `theme.ts` | | Five theme choices → `<html data-theme>`; migrates pre-v1.3 values. |
| `appearance.ts` | | Board colour (9 options), piece set (10 sets, lazily imported CSS), coordinates toggle. |
| `style.css` | 17015 | The whole design system: tokens, four themes, every component, the desktop layouts. |
| `icons.ts` | | Inlined Lucide-style SVG icons + move-class colours/labels/board badges. |
| `fab.ts` | | Floating action button + speed-dial, rebuilt on every open. |
| `toast.ts`, `dialog.ts`, `empty-state.ts`, `load-error.ts` | | Shared UI primitives (`showDialog` now supports a numbered `steps` list). |
| `settings-lightbox.ts` | | Settings as a centred lightbox at desktop width (never a view — see §12). |
| `confetti.ts`, `count-up.ts`, `pixel-pawn.ts` | | Celebration/motion helpers (all honour `prefers-reduced-motion`). |

#### Accounts, sync, money
| File | Lines | Role |
|---|---|---|
| `supabase.ts` | 71 | The one shared Supabase client. PKCE, `detectSessionInUrl: false`, `storageKey: 'obertura.supabase.auth'`. Exports `isSupabaseConfigured`. |
| `auth.ts` | 309 | Sign-up / sign-in (password + Google) / sign-out, the OAuth return-leg capture, `getAuthUser`/`onAuthChange`, friendly error mapping. |
| `account-ui.ts` | 383 | The Settings "Account" group and the shared auth form (`buildAuthForm`), plus the live sync caption. |
| `repertoire-sync.ts` | 490 | The debounced two-column push, the sign-in reconcile, the pending/failed flags, `SYNC_CHANGE_EVENT`. |
| `sync-core.ts` | 124 | The pure half: state precedence, two-column reassembly, content fingerprints. Self-tested under Node. |
| `entitlement.ts` | 295 | The free tier: `FREE_TRAINING_LINES`, the coaching caps, `isEntitled()`, `requestTrainingSlot()`, the upsell dialogs. |
| `entitlement-cache.ts` | 70 | The offline mirror of the server's last answer, keyed by user id. Never a grant. |
| `checkout.ts` | 300 | The buy flow: POST for a session, the redirect, the four unlock signals, the poll, `checkForPurchase()`. |
| `pricing.ts` | 300 | Dynamic prices from Stripe: locale → currency, the three fallback layers, `formatPrice()`, `sellablePrice()`. |
| `import-tier.ts` | 71 | The pure guest-import rules (`FREE_GUEST_IMPORT = 100`, which chips are padlocked). |

#### Data & storage
| File | Role |
|---|---|
| `types.ts` | The `Line` interface + `LinePriority`. |
| `tree.ts` | The live move tree: `MoveNode`, cursor, `single` vs `variations` mode, serialise/load. |
| `storage.ts` | IndexedDB wrapper (3 stores), backup export/parse/restore, `exportCore`, two change notifiers, reset progress, erase everything. |
| `prefs.ts` | Device-local training/view prefs. |
| `streak.ts` | Daily streak, per-day review log, reviewed-today counter. |
| `daily-recap.ts` | Per-day daily-challenge results log + the recap maths behind the completion popup. |
| `forgotten-moves.ts` | Per-move miss tally by day/week/all-time. |
| `puzzle-log.ts`, `puzzle-rating.ts`, `puzzle-repeat.ts` | Puzzle history, Elo rating (scoped), repeat ladder. |
| `endgame-progress.ts` | Classic-endgame solve records. |
| `brilliant-log.ts` | Resurface ladder for the brilliant-moves exercise. |
| `video-lib.ts` | Hidden / favourite / seen YouTube shelves. |

#### Chess logic & analysis
| File | Role |
|---|---|
| `engine.ts` | The eval stack: Lichess cloud client (+ circuit breaker, health), the Stockfish `Engine` class with watchdog/boot/recovery, `analysePosition`, `resolveUci`, `gameOverResult`. |
| `remote-engine.ts` | Opt-in chess-api.com depth-18 tier with its own breaker. |
| `winprob.ts` | Pure move classification (`MoveClass`, thresholds, `cpToWin`). |
| `review.ts` | Game Review orchestrator: per-node grading, cloud→remote→local tiering, cache, miss-streak cutoff, abort, progress. |
| `move-facts.ts` | SEE-based board facts (forced? recapture? sacrifice? free capture?). |
| `accuracy.ts` | Lichess accuracy model (volatility-weighted + harmonic mean). |
| `book-check.ts`, `book-tree.ts`, `book-lines.ts` | "Is this book?", the SAN trie, and opening seeds for sparring. |
| `openings.ts` | Offline opening naming by EPD key; `isOutOfBook`. |
| `explorer-stats.ts`, `lichess-explorer.ts`, `explorer-resolve.ts` | Bundled W/D/L stats, the live Lichess explorer, and the one resolver that layers them. |
| `lichess-tablebase.ts` | 7-piece tablebase ground truth for endgames. |
| `scheduler.ts` | SM-2 + due/bucket/confidence helpers + `PRIORITY_SPACING`. |
| `session.ts` | The training-session queue. |
| `individual.ts` | Which single positions to drill (due ∪ weak, from move 3+). |
| `struggle.ts` | Chronic-miss policy (threshold, snooze, counting). Pure + self-tested. |
| `notation.ts` | SAN vs figurine formatting, applied everywhere via `formatMove`. |
| `card-position.ts`, `board-mini.ts`, `board-brushes.ts`, `promotion.ts` | Position-card scaffold, SVG miniatures, collision-proof arrow brushes, promotion picker. |

#### Screens
`train-screen.ts` (2359), `lines-screen.ts` (947), `explore-screen.ts` (1839),
`my-games-screen.ts` (435), `progress-screen.ts` (1669, Statistics),
`settings-screen.ts` (1424), `puzzles-screen.ts` (788), `mistakes-screen.ts` (596),
`endgame-screen.ts` (711).

#### Builder panels (new in v0.22)
`builder-panels.ts` (Library + My lines), `explore-panel.ts` (the three curated
moves), `engine-panel.ts` (the Engine tab), `line-info.ts` (priority + line stats),
`eval-panel.ts` (the shared eval bar, used docked and in sparring).

#### Overlays / runners
`drill.ts` (line + positions + timed drills), `pretraining.ts`, `fix-it.ts`,
`puzzle-run.ts`, `mistake-run.ts`, `brilliant-run.ts`, `endgame-playout.ts`,
`spar.ts`, `explore.ts` (line explorer), `library.ts`, `library-explorer.ts`,
`board-explorer.ts`, `repertoire-map.ts`, `line-peek.ts`, `position-peek.ts`,
`note-sheet.ts`, `struggle-nudge.ts`.

#### Import & scouting
`import-core.ts`, `import-games.ts`, `import-panel.ts`, `import-inline.ts`,
`import-progress.ts`, `import-last.ts`, `import-tier.ts`, `builder-import.ts`,
`chesscom.ts`, `lichess.ts`, `lichess-auth.ts`, `manual-game.ts`, `auto-refresh.ts`,
`scout.ts`, `move-stats.ts`, `wdl-bar.ts`.

#### Content & catalogues
`starter-packs.json` + `onboarding-starter.ts`, `traps.json` + `traps.ts` +
`traps-screen.ts`, `study-index.json` + `study-catalog.ts` + `study-browser.ts` +
`study-import.ts` + `study-sheet.ts`, `endgames.json` + `endgame-catalog.ts`,
`puzzle-themes.ts`, `puzzle-openings.json`, `content-curated.json` +
`content-explore.ts` + `content-ui.ts` + `youtube.ts`, `video-lib.ts`,
`onboarding-lines.json` + `onboarding-lines.ts`.

#### Statistics & analysis reporting
`stats.ts`, `stats-charts.ts`, `stats-ui.ts`, `analysis.ts`, `progress.ts`,
`rating-stats.ts`, `line-analysis.ts`, `line-groups.ts`, `filters.ts`,
`forgotten-section.ts`.

#### Onboarding & meta
`onboarding-picker.ts` (the first screen), `onboarding-lines.ts` (the eight curated
lines), `onboarding-tour.ts` (coach-marks), `onboarding-signup.ts` (the post-win
ask + `?auth=` handling), `onboarding-starter.ts` (starter packs + picker sheet),
`first-steps.ts` (the Get-started checklist), `gate.ts` (beta code + install prompt),
`survey.ts`, `feedback.ts`, `support.ts`, `about.ts`, `backup.ts`, `drive-backup.ts`,
`selftest-panel.ts`, `avatar.ts`, `sound.ts`.

#### Bundled data (all lazy-loaded except `openings-data.json`)
| File | Size | Contents |
|---|---|---|
| `openings-data.json` | 1.3 MB | `{ epd: "Opening Name" }` — ~every named opening position |
| `openings-library.json` | 1.7 MB | `[{ eco, name, moves[] }]` — ~3,700 named openings as SAN lines |
| `starter-packs.json` | 64 KB | Six curated repertoire packs with annotated lines + plans |
| `study-index.json` | 60 KB | ~250 most-liked Lichess studies per opening family |
| `traps.json` | 12 KB | Curated opening traps (bait + idea + SAN/UCI) |
| `endgames.json` | 8 KB | Classic-endgame catalogue (FEN, goal, category, level, idea) |
| `explorer-stats.json` | 4 KB | Bundled W/D/L per EPD (currently `{}` — regenerate with the script) |
| `puzzle-openings.json` | 4 KB | Lichess opening "angle" keys that have puzzle sets |
| `content-curated.json` | 4 KB | Hand-pinned YouTube videos per opening family |
| `onboarding-lines.json` | 4 KB | The eight curated first-run lines |

---

## 6. Build, scripts and deployment

### npm scripts

```jsonc
"dev":                  "node scripts/copy-engine.mjs && vite"
"build":                "node scripts/copy-engine.mjs && tsc && vite build"
"selftest":             "node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/run-selftests.ts"
"preview":              "vite preview"
"probe-sync-limit":     "node scripts/probe-sync-limit.mjs"      // measures Supabase's REST body limit
"generate-icons":       "node scripts/generate-icons.mjs"
"build-openings":       "node scripts/build-openings.mjs"        // lichess-org/chess-openings (CC0) → openings-data + openings-library
"build-explorer-stats": "node scripts/build-explorer-stats.mjs"  // Lichess explorer → explorer-stats.json
"build-starter-packs":  "node scripts/build-starter-packs.mjs"   // assembles the six packs from scripts/starter-packs/*.mjs
"build-study-index":    "node scripts/build-study-index.mjs"      // most-liked studies per family; probes PGN export, drops locked studies
"build-traps":          "node scripts/build-traps.mjs"
"build-traps-lichess":  "node scripts/build-traps-from-lichess.mjs"
"build-puzzle-openings":"node scripts/build-puzzle-openings.mjs"  // probes which angles Lichess has puzzles for
```

`scripts/copy-engine.mjs` copies `stockfish-18-lite-single.{js,wasm}` from
`node_modules/stockfish/bin` into `public/engine/` (gitignored). `scripts/ts-resolve.mjs`
and `scripts/register-ts.mjs` let Node run the TS self-tests with extensionless imports.

### Deploying the public build (Cloudflare)

It is a **Worker**, not a Pages project. `wrangler.jsonc`:

```jsonc
{
  "name": "bitochess",
  "compatibility_date": "2026-08-08",
  "compatibility_flags": ["nodejs_compat"],   // @supabase/supabase-js needs Node built-ins
  "main": "./worker/index.ts",
  "assets": {
    "directory": "./dist",                    // DEPLOY_TARGET=cloudflare output
    "binding": "ASSETS",
    "run_worker_first": ["/api/*"]            // only /api/* reaches the Worker
  }
}
```

Deploy with `npx wrangler deploy` after `DEPLOY_TARGET=cloudflare npm run build`.
`wrangler.jsonc` also exists to stop Cloudflare's build system auto-detecting Vite and
trying to wire in its Vite plugin (which needs Vite 6+).

Environment in the Cloudflare dashboard:

- **Plain variables (public, baked into the bundle):** `DEPLOY_TARGET=cloudflare`,
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- **Secrets (never in the bundle):** `LEMONSQUEEZY_WEBHOOK_SECRET`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` (see §11 for why the last one has a
  `VITE_SUPABASE_URL` fallback).

### Deploying the internal build (GitHub Pages)

`.github/workflows/deploy.yml`, on push to `main` or manual dispatch: checkout → Node
20 with npm cache → `npm ci` → generate icons → `npm run build` → `cp -r docs dist/docs`
→ PATCH the Pages API to force `build_type: workflow` (so Jekyll never overwrites the
deploy) → `configure-pages` → upload `dist` → `deploy-pages`.

Result: the app at `…/obertura/` and the landing page at `…/obertura/docs/`.

### `.github/workflows/supabase-keepalive.yml`

Supabase pauses a free project after ~7 days of inactivity, and only a dashboard click
revives it. This workflow runs every 3 days (`12 5 */3 * *`) and any time you press
Run, and asks the REST API for one row of `profiles` with `Range: 0-0`. Row-level
security means the anon key sees nothing — **the query itself is the heartbeat**. It
retries three times with backoff, warns loudly on 401/403/404 (reached, but the query
isn't the intended one) and fails on anything else. Needs repository secrets
`SUPABASE_URL` and `SUPABASE_ANON_KEY` (the public one — never `service_role`).

### Cache strategy without a service worker

`index.html` sends `Cache-Control: no-cache, no-store, must-revalidate` plus `Pragma`
and `Expires` meta tags, so every open re-fetches the shell, which always points at
the newest hashed Vite bundles. Tapping the "bito chess" wordmark in the header reloads
the app — the quick way to pull a fresh deploy (phone-only gesture; a desktop click is
ignored, since the sidebar carries identity there).

---

## 7. The server: the Cloudflare Worker

`worker/index.ts` is **the only server-side code in the project** — about 70 lines,
half of them comments.

### Why there is no `functions/` folder

`functions/api/foo.ts` → `/api/foo` is a Cloudflare **Pages** feature. This project is
a **Worker** (`wrangler deploy`, not `wrangler pages deploy`), and Workers have no
file-based routing, so a `functions/` folder here would simply never run. Routing is
therefore done by hand in `index.ts` — six lines, and the entire cost of not being a
Pages project.

### How a request flows

```
request
  ├─ GET  /api/stripe/prices   → handleStripePrices()
  ├─ POST /api/stripe/checkout → handleStripeCheckout()
  ├─ POST /api/stripe/webhook  → handleStripeWebhook()
  ├─ /api or /api/*            → plain 404 text
  └─ anything else             → env.ASSETS.fetch(request)   (static dist/)
```

`run_worker_first: ["/api/*"]` inverts Cloudflare's default assets-first behaviour for
`/api/*` only. Everything else — the landing page at `/`, the trainer at `/app/`,
every script and image — is served straight from static assets exactly as it was
before any server code existed; the Worker only sees those on an asset miss.

The `/api/*` 404 is deliberate: without it, a typo'd webhook URL would fall through to
the landing page's HTML **with a 200**, which Stripe would read as a successful delivery.

`Env` extends `StripeEnv`, so the secrets are declared in exactly one place — next to
the code that reads them (`worker/stripe-env.ts`). The `ASSETS` binding is typed by hand (four lines)
rather than pulling in `@cloudflare/workers-types`.

---

## 8. Accounts: Supabase auth

### The client (`src/supabase.ts`)

One shared client, created once at import. Configuration that matters:

```ts
persistSession: true        // survives PWA relaunches
autoRefreshToken: true
flowType: 'pkce'            // NOT the library default (implicit), which returns
                            // tokens in the URL fragment — address bar + history
detectSessionInUrl: false   // auth.ts claims the ?code= itself; see below
storageKey: 'obertura.supabase.auth'   // so the "erase everything" sweep clears it
```

`isSupabaseConfigured` is `Boolean(url && anonKey)` from `import.meta.env`. When
unconfigured, the client is still created against a reserved placeholder host
(`https://placeholder.example.invalid`) so `createClient`'s URL validation passes and
importing the module can never throw at boot; nothing ever calls it, because every
consumer checks the flag first.

**The anon key is public by design.** Vite inlines it into the bundle. The protection
is row-level security in Postgres, never the secrecy of that string.

### The OAuth return leg (`src/auth.ts`)

Both Supabase's PKCE flow *and* the Lichess connect flow come back to the app as
`?code=…` on the same redirect URL. If supabase-js were left to auto-detect
(`detectSessionInUrl: true`) it would swallow Lichess's code and strip it before the
Lichess library ever saw it.

So `auth.ts` claims the code itself, at module load (synchronously, before boot reads
the URL), and only when **two** things agree:

1. `obertura.supabase.oauthPending` was stamped in localStorage immediately before
   redirecting to Google, and is less than 10 minutes old, **and**
2. the URL has **no `state` parameter** — Supabase doesn't send one; the Lichess
   library always does.

It then reads `code`, `sb_flow_id` and any `error_description`, strips those keys off
the URL with `history.replaceState`, and hands them to `initAuth()` which calls
`exchangeCodeForSession`. (`flowId` is carried explicitly because
`exchangeCodeForSession` normally finds the PKCE verifier by reading `sb_flow_id` off
the *live* URL — which we've already cleaned. It's belt-and-braces today, and
future-proofs a deprecated fallback path.)

### The API surface

```ts
initAuth(): Promise<void>            // once at boot, only when configured
getAuthUser(): User | null           // synchronous snapshot — the UI is built sync
isSignedIn(): boolean
onAuthChange(fn): () => void         // subscribe; returns an unsubscribe
authRedirectUrl(): string            // location.origin + BASE_URL — must match the allow-list
signUpWithPassword(email, password): Promise<AuthResult>
signInWithPassword(email, password): Promise<AuthResult>
signInWithGoogle(): Promise<AuthResult>     // leaves the app; returns only on failure
signOut(): Promise<AuthResult>
friendlyAuthError(err): string
```

`AuthResult` is `{ ok, needsEmailConfirmation?, message? }` — nothing throws, and
nothing raw ever reaches the user. `friendlyAuthError` maps Supabase's developer-facing
codes (`invalid_credentials`, `email_not_confirmed`, `user_already_exists`,
`weak_password`, `over_email_send_rate_limit`, `validation_failed`, `same_password`)
plus a set of message regexes onto sentences that say what to do next, and falls back
to a calm generic line.

Email sign-up that returns no session means Supabase wants the address confirmed
first; the UI shows a **dialog** (not a toast) telling the user to open the link.

### The Account UI (`src/account-ui.ts`)

Built **only** when `isSupabaseConfigured` — on the internal build the section does
not exist at all (not a disabled row, not a placeholder). It is a normal Settings
accordion (`group()`), but it re-renders only its own body on auth changes so the
accordion doesn't snap shut the instant you sign in. Only the newest instance listens
(each rebuild retires the previous subscription).

- **Signed out:** the group is highlighted (`section--acc-highlight`) and forced open.
  A Sign in / Sign up two-way switch above one shared form: email + password with
  proper `autocomplete` (`username` / `new-password` / `current-password`, so phone
  password managers offer to fill and save), a submit button, an "or" divider, and
  **Continue with Google** with the four-colour G inlined (fixed brand colours in
  every theme, deliberately).
- **Signed in:** the email, a **plan pill** (`Full access` / `Free — 10 lines in
  training`), the live **sync caption**, an explanatory note, and Sign out.

`buildAuthForm({ initialMode, blurb })` is exported so the sign-up sheet
(`onboarding-signup.ts`) and the buy flow reuse the exact same form rather than a
second implementation.

The sync caption is `aria-live="polite"`, listens to `SYNC_CHANGE_EVENT`, detaches
itself once the row leaves the DOM, and reads: *"Sync failed — will retry."* /
*"Pending — your latest changes go up in a moment."* / *"Synced 12 minutes ago."* /
*"Nothing synced yet."*

---

## 9. Account sync: the cross-device copy

`src/repertoire-sync.ts` (network side) + `src/sync-core.ts` (pure side, self-tested).
The full owner-facing write-up is `SUPABASE-SYNC.md`.

### The table

One row per user in `public.profiles`:

| column | type | holds |
|---|---|---|
| `id` | `uuid` | the auth user's id (primary key, `references auth.users on delete cascade`) |
| `repertoire` | `jsonb` | **the lines *and* the localStorage snapshot** (see the naming note) |
| `repertoire_updated_at` | `timestamptz` | when that half was last pushed |
| `games` | `jsonb` | the imported games, with their analyses and scans |
| `games_updated_at` | `timestamptz` | when the games were last pushed |
| `entitled` | `boolean` | has this account paid? gates the free-tier caps |
| `entitled_at` | `timestamptz` | when the webhook (or a human) granted it — a record only |
| `created_at` | `timestamptz` | default `now()` |

**`repertoire` is badly named and it is staying that way.** It was drafted when lines
were the only thing that synced; it now carries the lines *plus* the app-state
snapshot (statistics, streaks, puzzle ratings, endgame progress, preferences).
Renaming it would be a migration for no visible gain.

### Why games are a separate column

Measured on a synthetic heavy user: a bare imported game is ~1.3 KB, one carrying a
saved analysis is ~18 KB, and the app-state snapshot is ~127 KB. So the
lines-and-settings half is 0.2–1.3 MB while a thousand games with analyses is 3–20 MB.
When it was one column, editing a single move re-uploaded every game you own — over
mobile data, rewriting the whole TOASTed value in Postgres each time. Split in two, an
edit sends the small half and games go up only when games actually change (an import,
a saved analysis, a scan). Neither half is sent at all when its **content fingerprint**
matches what was last pushed.

The migration is additive: a row written before the split carries its games inside
`repertoire`, and `combineRemote()` keeps reading them from there until the next push
moves them across. When both are present the column wins.

### Security model

Row-level security is what makes shipping the anon key safe:

```sql
alter table public.profiles enable row level security;
create policy "own profile: read"   ... using (auth.uid() = id);
create policy "own profile: insert" ... with check (auth.uid() = id);
create policy "own profile: update" ... using (auth.uid() = id) with check (auth.uid() = id);
```

**RLS alone is not enough for `entitled`.** The update policy is row-scoped, not
column-scoped, so on its own a signed-in user could flip their own flag from the
browser with the public key. Postgres **column privileges** are the real fix:

```sql
revoke update on public.profiles from anon, authenticated;
grant update (repertoire, repertoire_updated_at, games, games_updated_at)
  on public.profiles to authenticated;
grant insert (id, repertoire, repertoire_updated_at, games, games_updated_at)
  on public.profiles to authenticated;
```

`service_role` is not named there, so it keeps UPDATE on `entitled` and bypasses RLS
entirely — which is exactly why the webhook needs that key and the browser can never
write the flag. Whole SQL block is safe to re-run (every statement is
`if not exists`, drop-then-create, or a restated grant).

There is deliberately **no delete policy**: the app never deletes a row, and removing
the account removes the row via `on delete cascade`.

### The state machine (`sync-core.ts`)

```ts
type SyncState = 'off' | 'never' | 'synced' | 'pending' | 'failed';

syncStateFrom({ configured, userId, claimedAccount, failed, pending, lastSync })
```

Precedence is the whole point and is self-tested: `off` (unconfigured or signed out) →
`failed` → `pending` → `never` (claimed account ≠ this user, or no successful push
yet) → `synced`. A first sign-in that couldn't reach Supabase must *say* it failed,
not look like it hasn't got round to it; and a claimed account with no push yet must
never claim a copy exists.

`fingerprint(text)` is two independent rolling hashes (FNV-1a and djb2, both with
`Math.imul` so the multiply doesn't lose precision past 2^53) plus the length, so a
false match — the one outcome that would matter, since it would skip a real push —
needs a simultaneous collision in both (~2^-64). Not a security hash and doesn't need
to be. `coreFingerprintOf` deliberately hashes only `{ lines, local }` — including
`exportedAt` would restamp every payload and defeat the skip entirely.

### The push

- Both halves share **one 30-second debounce** and **one upsert** (two columns of the
  same row), so an editing burst is one request.
- `onLinesChanged` sets `coreDirty`; `onGamesChanged` sets `gamesDirty` (before v0.18
  only the first existed, so a 300-game import never reached the account unless you
  happened to touch a line afterwards).
- Flags are claimed at the start of a push, so an edit landing mid-flight re-dirties
  and gets its own push rather than being swallowed.
- On failure the flags are put back, `markFailed()` runs, and the chain does **not**
  retry immediately — the next edit, the next launch or the next flush picks it up at
  a human pace instead of spinning against a dead network.
- `pagehide` **and** `visibilitychange→hidden` both flush, because neither is reliable
  alone on a phone (Android usually kills a PWA without firing `pagehide`).
  Best-effort: the pending flag survives in localStorage, and the fingerprint check
  makes the next launch's retry free if the push did land.

### The sign-in reconcile

**Look before you ever upload.** On a first sign-in with an account this device hasn't
claimed:

1. `fetchRemoteBackup()` reads both columns, reassembles them with `combineRemote()`
   and validates with the very same `parseBackup()` a hand-picked file goes through
   (including reviving each move's `review.due` back into a real `Date`).
2. If the account holds real data (lines **or** games — a snapshot-only row doesn't
   count, since `local` is never empty in practice), `openImportChooser()` asks the
   same **merge vs replace** question a manual backup import asks.
3. After the restore, the remote fingerprints are remembered, the account is claimed,
   and a push runs — which after a `replace` sends nothing at all (both halves match),
   and after a `merge` sends the now-ahead local copy.
4. If the copy carried extras (games / localStorage), the app reloads after 1.2 s,
   because several modules cache their localStorage state in memory at boot.
5. **Cancelling leaves the account unclaimed** — nothing syncs, the caption says so,
   and the next launch asks again. An answer is never assumed.

If the account is empty, the phone's data seeds it (both halves dirty, push).

Failure at step 1 marks failed and claims nothing: **an unreachable Supabase can never
destroy a copy.**

### Signing out and erasing

`forgetAccount()` clears the claim, the pending/failed flags, the last-sync stamp and
both fingerprints. The remote row is untouched; signing back in runs the same
fetch-first flow.

`eraseAllData()` deliberately does **not** fire either notifier, and the Settings
sweep clears the sync keys *and* the Supabase session — so there is nothing to push
and no session to push with. An erase can never clobber the account's copy.

### Known limitation, stated plainly

**Last-write-wins, not real sync.** Each half goes up as one value, so editing on two
devices inside the same window means one silently overwrites the other; there is no
per-line merge and no way to tell "deleted" from "hasn't arrived yet". Google Drive
backup has the same ceiling. Fixing it properly needs per-line `updatedAt` plus
deletion tombstones — parked in `PUBLISHING.md`.

Also unmeasured: Supabase publishes no REST request-body limit (the real one comes
from the gateway in front of it). `npm run probe-sync-limit <url> <anon-key>` sends
increasing bodies from a desktop and reports where they bounce; it writes nothing,
because RLS rejects every probe by design.

---

## 10. The pro plan: entitlement and the free tier

`src/entitlement.ts` owns the whole policy. `src/entitlement-cache.ts` is its offline
mirror.

### The headline cap

```ts
export const FREE_TRAINING_LINES = 10;   // lines enrolled in TRAINING at once
export const PRO_PRICE = '€9';           // one-time, not a subscription
```

**Exactly one thing is capped: how many lines are in the training rotation at once.**
Everything else is wide open — building and saving lines is unlimited, and so are the
library, packs, traps, studies, puzzles, endgames, the engine, sparring, the analyser,
statistics and sync. A free user can keep five hundred lines in My Lines; they train
ten at a time and rotate which ten whenever they like.

### Who is entitled

| Situation | Result |
|---|---|
| Supabase not configured (internal GitHub Pages build) | **fully entitled**, no cap |
| Signed in, `profiles.entitled = true` | no cap |
| Signed in, anything else | capped |
| Signed out (a guest) | capped — via the *same* code path |

That last row is deliberate and permanent: a guest gets exactly the free tier a free
signed-in user gets, so **signing in only ever adds sync and can never look like it
took a restriction away.**

### The coaching caps (the three heaviest game-derived features)

These read your imported games and burn the app's heaviest resources (cloud eval
calls, tablebase probes, local engine time). A free account gets a real, always-fresh
taste of each rather than an empty tab or an untouched full history:

```ts
FREE_MISTAKE_GAME_WINDOW = 50   // Mistake Retry looks at the 50 most recent games
FREE_MISTAKE_SPOTS       = 10   // rolling top-10 UNFIXED spots (fixing one frees a slot)
FREE_ENDGAME_GAME_WINDOW = 50
FREE_ENDGAME_SPOTS       = 3    // rolling top-3 UNPLAYED positions
FREE_SCOUT_OPPONENTS     = 1    // vs MAX_OPPONENTS = 10 entitled
TRAINING_COUNT_VISIBLE_FROM = 7 // the Train hub shows "7 of 10" from here up
```

Fixed/played items are never hidden — only the *unfixed/unplayed* list is capped.
Scouting a new opponent at the cap offers to **replace** the existing one (as long as
there is exactly one to replace) rather than refusing; a grandfathered user holding
more gets the ordinary "delete one to make room" refusal. **Nothing is ever
auto-deleted.**

Guests also import fewer games at a time: `FREE_GUEST_IMPORT = 100` (`import-tier.ts`,
pure and self-tested). The 500 and All chips still show, **padlocked**, and open the
sign-up sheet; signing up unlocks them *in place*, against the scan already in hand.

### Nothing is ever auto-paused

Existing users may sit well over the cap (early testers have dozens enrolled) and
every one of those lines stays enrolled and scheduled. Only the **ON** direction of an
enrolment is guarded. Pausing always works and frees a slot immediately, because the
count is read live from storage on every check — no cache to invalidate.

### The API

```ts
isEntitled(): boolean                       // synchronous, network-free
canEnrolAnother(inTrainingCount): boolean   // the pure rule
countInTraining(): Promise<number>
freeTrainingSlots(): Promise<number>        // Infinity when entitled
requestTrainingSlot(): Promise<boolean>     // THE gate; shows the upsell itself on false
showTrainingCapDialog() / showGoProDialog()
buildCapNotice(message): HTMLElement        // inline "Showing your 10 most recent mistakes · Unlock full access"
showBulkCapToast(enrolled, total)
refreshEntitlement(): Promise<void>
initEntitlement(): void                     // once at boot, BEFORE initAuth
entitlementLabel(): string
ENTITLEMENT_CHANGE_EVENT = 'obertura:entitlementchange'
```

Every one of the enrolment points funnels through `requestTrainingSlot()`: the
builder's Line-info toggle, the My Lines switch, the Train hub switch, the Statistics
screen's Drill, and onboarding's one-at-a-time adds. A single deliberate add over the
cap gets the **upsell dialog**; a **bulk** add (a starter pack, "add all") enrols what
fits, saves the rest to My Lines unenrolled, and says so with a quiet toast — no price
tag in the first minute.

### How the flag is read, and why it can't be forged

`profiles.entitled` is fetched **once per sign-in** and held in a module-level
snapshot, so the dozens of cap checks the UI makes never touch the network.

- A **failed** fetch changes nothing — offline, Supabase down, RLS misconfigured, the
  column not added yet: the previous answer stands, which is what keeps a paid user
  working on a plane.
- A **successful** fetch always overwrites, including `true → false`. The server is
  the only authority.
- `entitlement-cache.ts` mirrors the last server answer to `localStorage` under
  `obertura.entitled`, **keyed by user id**, so a second account on a shared device
  can't inherit the first one's access. Sign-out clears it.
- That key is **excluded from backups** (`backupLocalKey` in `storage.ts`) — and the
  sync payload reuses the same `BackupFile` shape, so without that exclusion an
  entitled user's copy would grant full access to any phone that restored it.
- The database revokes UPDATE on the column from `anon` and `authenticated` (§9), so
  the browser can't write it at all.

`initEntitlement()` must run **before** `initAuth()`, so the first auth notification
(the stored session being picked up) isn't missed — the same ordering requirement
`initAccountSync()` has, for the same reason.

### Repainting when the flag flips

The cap furniture is drawn at render time (the Train hub counter, the cap notices, the
Go-pro CTA in Settings), so `main.ts` listens for `ENTITLEMENT_CHANGE_EVENT` and
re-renders the current view. **The builder is exempt** — it holds unsaved work in the
DOM, and it shows no cap furniture anyway. The event only fires on a genuine change,
so this is not a render loop.

---

## 11. The buy flow: Stripe

Owner-facing setup guide: `STRIPE-SETUP.md`. Code: `src/checkout.ts` + `src/pricing.ts`
(app half) and `worker/stripe-*.ts` (server half). This replaced Lemon Squeezy in the
Stripe migration; the product did **not** change — it is still a one-time unlock, not a
subscription.

**What changed off-code, and it matters:** Lemon Squeezy was the *merchant of record*,
so they were legally the seller and handled VAT for every buyer's country. Direct Stripe
makes **you** the seller. EU VAT (the OSS scheme) is now yours. Stripe Tax would automate
it at 0.5% a transaction and is deliberately **off**; prices are VAT-inclusive.
`docs/terms.html` and `docs/privacy.html` say all of this.

### The shape of it

```
phone: "Unlock full access"            landing page: "Unlock full access"
      │                                       │
      │ no account? sign-up sheet,            │ no account? → /app/?auth=signup&buy=1
      │ then straight on                      │ (the app finishes the job)
      ▼                                       ▼
  POST /api/stripe/checkout  ──(carries the Supabase ACCESS TOKEN, not a user id)
      │                        the Worker VERIFIES it and takes id + email from it
      ▼
  Stripe Checkout on checkout.stripe.com    card · Apple Pay · Google Pay
      │  payment succeeds
      ├──────────────────────────────► browser returns to /app/?purchased=1
      ▼                                      │  the app starts polling
  Stripe sends a signed webhook               │
      ▼                                      │
  bitochess.com/api/stripe/webhook  ← worker/index.ts
      │  verifies the signature, reads metadata.user_id
      ▼                                      │
  Supabase: profiles.entitled = true, entitled_at = now
      ▼                                      ▼
  the app polls profiles.entitled for ~20s after a checkout → cap lifted
```

### Three endpoints (`worker/index.ts` routes them by hand)

| endpoint | what it does |
|---|---|
| `GET /api/stripe/prices` | active one-time prices, per currency. Soft-fails to `{"prices":[]}`. |
| `POST /api/stripe/checkout` | verifies the JWT, validates the price, returns a session `url`. |
| `POST /api/stripe/webhook` | verifies the signature, writes `entitled`. **Fails loudly.** |

**Not Supabase Edge Functions**, though the migration spec asked for them: this repo has
no `supabase/` directory, no CLI and no migration history, and the server already lived
in a Worker. Three endpoints don't justify a second deploy target and a second secret
store. Same reasoning as the "why no `functions/` folder" note in `worker/index.ts`.

**No CORS headers anywhere**, deliberately: every caller is a page this same Worker
serves, so all three calls are same-origin. Adding permissive CORS would only make the
checkout endpoint reachable from places with no business calling it.

**The Stripe SDK on Workers.** `stripe` ships a separate build selected by the `workerd`
export condition, initialised with `WebPlatformFunctions` — fetch instead of `node:http`,
WebCrypto instead of `node:crypto`. Nothing to configure, but one thing to remember:
webhook signatures **must** use `constructEventAsync()`, because WebCrypto is async. The
synchronous `constructEvent()` throws an error saying exactly that. `apiVersion` is
deliberately left unset so the SDK's pinned version and its TypeScript types can never
drift apart.

### Dynamic pricing (`src/pricing.ts`)

**EUR and SEK**, two Price objects with amounts set by hand in Stripe (€9, and a round
99 kr — not a converted amount; a Swede should see a number that looks deliberate in
Swedish). Currency is picked from `navigator.languages`: `sv`, `sv-*` or any `-SE` region
gets kronor, everyone else euros. Not from an IP address — that would be a third-party
request the privacy policy rules out, and wrong for anyone travelling.

**The paywall is built synchronously, so it cannot wait for a fetch.** Three layers:
the quote fetched this session → the last quote in localStorage (`obertura.pricing`) →
`FALLBACK_AMOUNTS`. Layers 1 and 2 carry the Stripe **price id**, which is what the buy
button needs; layer 3 does not, which is exactly what makes a fallback unsellable. So
`openProSheet()` paints immediately with whatever is in hand and takes an
`onPriceChange` subscription to swap in the real number if the fetch lands a moment
later. `primePricing()` runs at boot so the id is usually there before anyone taps.

`obertura.pricing` is excluded from backups (`backupLocalKey()` in `storage.ts`),
alongside the entitlement cache: a synced Swedish price on a Spanish phone would be
wrong for no gain.

### App half (`src/checkout.ts`)

**Why a redirect now, and why that's fine.** The Lemon Squeezy overlay existed because
sending an installed PWA to another origin is awkward — the journey back often lands in
a *second* copy of the app in a browser tab, next to the installed one still showing the
old capped state. Stripe's hosted Checkout is a redirect, so the return journey is
*handled* rather than avoided — and the machinery for that already existed and is
unchanged. Two things are genuinely better: **no third-party script** in the app at all
(lemon.js was one), and **wallets work** with no domain verification. Stripe's embedded
Checkout would restore the overlay feel at the cost of `js.stripe.com` inside the app,
Apple Pay domain verification, and an iframe to keep alive across the PWA lifecycle —
not worth it for a €9 sale whose return path is already built.

**An account is required, and it's the one place in the app where that's true.** The
webhook matches a payment to a Supabase user id and has no way to reach a guest. So
`openCheckout()` opens the sign-up sheet with a `lead` explaining *why* ("your unlock is
tied to your account, so it follows you to any phone you sign in on") and an
`onSignedIn` that continues straight to the checkout — the user asked to buy, not to
fill in a form.

Every failure before the redirect is a **toast and nothing charged**: no price id
("check your connection"), no session token ("sign in again to buy"), a 401, a timeout,
or a URL that isn't Stripe's. `isStripeCheckoutUrl()` checks the hostname before
`location.href` — the URL comes from our own Worker, so it's belt-and-braces, but that
line is exactly where an open redirect would live.

**Four ways to notice the unlock landed.** Paying doesn't unlock anything by itself —
the webhook does, a second or two later. Reading the flag once would land inside that gap
about half the time and tell a paying customer they hadn't paid. So the app **polls** on
a front-loaded backoff (`[0, 1500, 3000, 5000, 8000, 12000, 20000]` ms), started by
whichever of these fires first:

1. `?purchased=1` on the URL (`handlePurchaseReturn()`, read and stripped at boot) —
   Stripe's `success_url`, the normal path,
2. **the app regaining focus** (`visibilitychange` + `focus`) — armed *before* leaving,
   so a checkout abandoned with the back gesture is still noticed,
3. a checkout started in this session, noticed on the way back,
4. **Settings → "Already paid? Check again"** (`checkForPurchase()`) — the manual
   backstop, and the only one that *always* answers, in either direction.

A poll that finds nothing is silent (an abandoned checkout must not produce an error).
Success shows a **dialog**, not a toast: *"You're in — full access is on your account
… Thank you. Genuinely."*

**Import direction matters.** `checkout.ts` imports `entitlement.ts` normally;
`entitlement.ts` reaches back only through a dynamic `import()` inside a button
handler. Both sides only touch each other from inside functions, so a cycle would work
today — right up until someone adds a module-scope read and gets an `undefined` that
only appears in the built bundle. `pricing.ts` is safe to import statically from either,
because it depends only on `supabase.ts`.

### Checkout endpoint (`worker/stripe-checkout.ts`)

**The account id comes from the token, never from the body.** This is the whole security
model: the session's `metadata.user_id` decides whose `entitled` gets flipped, so a
`user_id` field in the request body would be a stranger's account one curl away. It is
read out of a Supabase-validated JWT (`verifyUser()`) and nowhere else. `getUser(jwt)`
asks Supabase to validate rather than decoding locally — a Worker holding the project's
signing secret is a Worker that can mint sessions. The email for `customer_email` comes
from the same verified source, which is why the app sends nothing but a price id.

**The price is validated too.** It arrives from a browser, and a browser can name any of
the account's price ids — an archived launch-discount price, a €0 comp. So it's retrieved
and must be active, one-time, and (when `STRIPE_PRODUCT_ID` is set) attached to the right
product. Note the ordering: **auth is checked first**, so an unauthenticated caller can't
probe which price ids are valid.

Session options worth knowing: `mode: 'payment'` (not `subscription`),
`customer_creation: 'always'` (Stripe's default for one-off payments is *not* to make a
Customer, and without one there's no `stripe_customer_id` to store),
`billing_address_collection: 'auto'` (as little as the payment method demands — a full
address form is a conversion drop on a €9 sale), and `payment_intent_data.metadata`
carrying the same user id, because a charge inherits its intent's metadata and that is
the *only* thing that makes a refund traceable back to an account.

`success_url` / `cancel_url` are built from the **request's own origin**, so a test
purchase can never land on production and vice versa. Nothing to configure in the Stripe
dashboard.

### Server half (`worker/stripe-webhook.ts`)

**This file deliberately fails loudly, and that is the whole point.** Everywhere else
the rule is fail-soft. A webhook has no user watching it: swallow an error and return
200, and Stripe marks the delivery succeeded, stops retrying, and a customer who really
did pay is silently left on the free tier. So every verification failure and every
processing error returns a non-200, which is the signal to retry *and* shows the endpoint
as failing in the dashboard where it can be noticed. Stripe retries with backoff for up
to three days, so a Supabase outage or a missing secret resolves itself once fixed.
**Do not "fix" this to fail soft.**

The one thing that *does* return 200 is a properly signed event we simply don't act on.

Signature verification: `Stripe-Signature` is a timestamp plus an HMAC-SHA256 of
`timestamp.rawBody`. The body is read as **text** and handed to Stripe's own verifier —
parse-then-reserialise would change the bytes and break the hash. The verifier also
enforces a timestamp tolerance, which is what stops a captured delivery being replayed.

**No event-id ledger, on purpose.** Every write is idempotent — an upsert of the same
flags to the same row — so processing one event twice produces exactly the state
processing it once does. Stripe retries and occasionally double-delivers; both are
harmless.

Events acted on:

| event | what happens |
|---|---|
| `checkout.session.completed` | the ordinary grant. Skipped when `payment_status === 'unpaid'`. |
| `checkout.session.async_payment_succeeded` | the delayed grant. Some methods complete the session first and confirm the money days later; **without this such a customer pays and is never entitled.** |
| `charge.refunded` | back to the free tier, which is what the terms promise. **Full refunds only** — a partial refund must not take away what somebody still mostly paid for. |
| `customer.subscription.*` | answered explicitly with a log line, not silently ignored, so the day a subscription *is* introduced the log says where the work goes. |

The user id comes from `metadata.user_id` or `client_reference_id`, checked against a
UUID regex before it goes near Postgres — Stripe metadata is a free-text store, so it's
untrusted input even though the signature proves who sent it. The grant is an **upsert**
on `id` (a user can pay before their first sync created their row, and an `update` would
quietly match zero rows); the revoke is an `update`, because if there's no row there is
nothing to take away. `entitled_at` is left alone by a refund — it records when access
was granted, and a refund doesn't unhappen that.

Status codes: `200 ok` / `200 revoked` / `200 pending` / `200 ignored`, `401 bad
signature`, `405 method not allowed`, `422 no user id`, `500 not configured`, `500 write
failed`. `STRIPE-SETUP.md` has the full table with what each one means to fix.

**The bug worth remembering (from the Lemon Squeezy era, and still guarded):** the Worker
read `SUPABASE_URL`, but the Cloudflare project only had `VITE_SUPABASE_URL`. Every
delivery would have answered `500 not configured` while the dashboard looked perfectly
set up. Both the URL and the anon key now read `NAME || VITE_NAME` — same strings, same
project.

### Where the price lives

Four copies, and only one of them charges anybody:

| where | what it is |
|---|---|
| **Stripe** | the real one. It takes the money. |
| `src/pricing.ts` → `FALLBACK_AMOUNTS` | the app's offline fallback |
| `docs/index.html` → `.tier__price` | the landing page's no-JS fallback, **overwritten from Stripe on load** |
| `docs/index.html` → JSON-LD `offers` + `<meta name="description">` | static, EUR, for search engines |

Change the Stripe price and both the app and the landing page follow within ten minutes
(`PRICE_TTL_MS`). **If they ever disagree with Stripe, Stripe is right and they are the
bug.**

---

## 12. App shell, navigation and back handling

### The shell (`index.html`)

- A **pre-paint inline script** reads `obertura-theme` and `obertura.boardColour` from
  localStorage and sets `data-theme` / `data-board` on `<html>` before first paint, so
  there is no flash of the wrong theme. It mirrors `theme.ts` including the pre-v1.3
  migration — **keep the two in sync**.
- A **boot splash** (`#app-splash`, the app icon) covers the first paint and is removed
  by `hideAppSplashWhenReady()` once `getAllLines()` resolves (3 s safety net). It sits
  *below* the overlay tier, so a first-run screen is never invisible underneath it.
- **Header**: back arrow (full screens) / wordmark `bito chess` / settings-avatar
  button / Save button (builder only).
- **Views** are sibling `<div>`s toggled with `hidden`: `view-builder`, `view-lines`,
  `view-explore`, `view-games`, `view-train`, `view-progress`, `view-settings`.
- **Two navs**: `#bottom-nav` (the phone tab bar — Train · My Lines · Explore · My
  games · Statistics) and `#side-nav` (the desktop sidebar, built by `main.ts`).

### The builder's markup

`#view-builder` holds `#board-wrap` (the board), `#builder-sheet` (the draggable
panel: slide tabs, the single move strip `#move-list-strip`, then the carousel with
`#slide-explore`, `#slide-line`, `#slide-library`, `#slide-games`, `#slide-engine`),
and `#builder-dock` (`#builder-eval` + `#builder-bar`: flip · engine │ watch · ◀ · ▶).

### Routing (`main.ts`)

```ts
type ViewName = 'train' | 'lines' | 'explore' | 'games' | 'progress' | 'builder' | 'settings';
```

`showView(view)` is the single entry point. It:

- resumes or discards a **suspended training session** (a drill that handed off to the
  analyser — landing on Train resumes it, anywhere else discards it),
- remembers `returnView` when entering a `BACK_VIEWS` full screen (`builder`,
  `settings`),
- toggles view visibility, swaps the primary nav for the back arrow, hides the FAB,
- renders the destination screen with its dependency object,
- for the builder: restores the carousel slide (**by name**, not index), applies
  `pendingEngineOn` / "Engine always on", resets the sheet to `default`, and re-lays
  out after a frame.

`train` is both the start view and the back-navigation root.

### Desktop layout (`DESKTOP_NAV_BREAKPOINT = 960`)

At or above 960 px a **left sidebar** (`#side-nav`) replaces the bottom tab bar, built
from `SIDE_NAV_ITEMS` (the same five views, order and icons). The sidebar carries the
app's identity there, so the header sheds its wordmark-reload gesture. The breakpoint
is mirrored in `style.css` (as `$desktop-nav`) in several places — **keep every copy in
sync**; the CSS comments say so at each site.

The builder becomes a **two-column grid** at that width: the board on the left, the
sheet as a static right-hand column. All the sheet-dragging machinery is skipped
(`isDesktop()` short-circuits it), and dragging a desktop *window* across the
breakpoint re-syncs the paged strip and clears inline heights.

**Settings is a lightbox on desktop** (`settings-lightbox.ts`), not a view: it never
touches `showView`/`currentView`, so the `BACK_VIEWS` + `returnView` bookkeeping is
left alone, the sidebar stays visible behind it, and closing lands back on whichever
tab was already showing — by construction, not by tracking. It renders the exact same
`renderSettingsScreen()`; only the container differs. Dismisses via the ×, backdrop,
Escape or `pushBack`.

### Back handling (`back-nav.ts`)

Android PWAs boot with one history entry, so a back press closes the app. The fix keeps
exactly one spare "buffer" entry armed. A press consumes it, fires `popstate`, and the
handler performs **one** step of in-app back before re-arming. Two kinds of back, in
order:

1. **Dismissible layers** — every sheet, dialog, overlay, drill, coach-mark and
   explorer registers itself with `pushBack(close)` and gets a remover back.
2. **View-level fallback** — `setViewBack(fn)` in `main.ts`: full screens return to
   `returnView`; any other tab returns to Train; Train with nothing open lets the press
   through so the app closes.

The builder additionally arms **its own** back layer while it is on screen
(`armBuilderBack`), so the unsaved-work guard fires on a gesture exactly as on the back
arrow. `BACKNAV-DIAGNOSIS.md` documents the historical z-index bug where the guard
dialog rendered *under* the drill overlay.

---

## 13. Data model

### `Line` (`src/types.ts`) — one saved opening line

```ts
type LinePriority = 'high' | 'standard' | 'low';

interface Line {
  id: string;                       // crypto.randomUUID()
  name: string;                     // manual title, else the auto-detected opening
  tags: string[];                   // free tags + "vs <opponent>" prep tags
  colour: 'white' | 'black';        // which repertoire it belongs to
  openingName: string | null;       // auto-detected from the bundled DB
  confidence: number;               // 0–5, derived from reps (see scheduler)
  lastTrained: string | null;       // ISO
  inTraining: boolean;              // enrolled in the SM-2 rotation
  tree: MoveNode;                   // the serialised root node
  createdAt?: number;
  priority?: LinePriority;          // absent = 'standard'; read via linePriority()
  timesTrained?: number;            // full start-to-finish runs; the recall denominator
}
```

`priority` and `timesTrained` are both **optional and only counted from the release
that added them** — older lines fall back to a default and an estimate respectively
(`scheduler.linePriority`, `stats.lineTrainingCount`). No migration.

### `MoveNode` (`src/tree.ts`) — one ply in a tree

```ts
interface MoveNode {
  id: string;                 // 'root' | 'n1', 'n2', …
  san: string; uci: string; fen: string;
  children: MoveNode[];       // children[0] is the main line
  note?: string;              // manual per-move reminder
  noteAskedAtLapses?: number; // the chronic-miss snooze stamp (struggle.ts)
  annotation?: '!!' | '!' | '!?' | '?!' | '?' | '??';
  missedThisSession?: boolean;
  classification?: MoveClass; // game-review grade for the move INTO this node
  cpLoss?: number;            // centipawns behind best
  evalCp?: number;            // eval after this move, WHITE perspective
  review?: { ease; interval; reps; lapses; due };  // SM-2 block
}
```

**Tree modes** (`setTreeMode`):
- `single` — the **builder**. A deviating move *replaces* the continuation, so a line
  is always one path and `serialise()` stores exactly one line.
- `variations` — the **analyser**. A deviating move is *appended* as a sibling, keeping
  the game's main line as `children[0]`.

Old lines saved before the single-path rule may carry dead sibling branches; every
reader walks `children[0]`, and the first divergent edit truncates them away. There is
deliberately **no migration**.

### `ImportedGame` (`src/import-core.ts`) — the compact stored game

```ts
interface ImportedGame {
  id, url, endTime;                    // endTime = unix seconds
  platform?: 'chesscom' | 'lichess';   // absent for manually-added games
  timeClass: 'bullet'|'blitz'|'rapid'|'daily'; timeControl; rated;
  colour: 'white' | 'black';           // which side YOU played
  result: 'win' | 'loss' | 'draw';     // YOUR perspective
  opponent; opponentRating?; myRating?;
  eco: string | null; opening: string | null;
  sans: string[]; ucis: string[]; plyCount: number;
  tags?: string[];                     // user tags, saved by "Save game"
  analysis?: GameAnalysis;             // { tree, engine, reviewedAt }
  retry?: GameRetry;                   // mistake-scan spots + engine top-3
  endgame?: GameEndgame;               // endgame-scan result
}
```

Re-imports **never** overwrite a stored game (that used to wipe saved analysis, tags
and scan data) — the stored copy always wins.

### `Opponent` (`src/scout.ts`)

```ts
interface Opponent {
  id; name; platform; username;
  gamesAnalysed; refreshedAt; avatarUrl?;
  games: ImportedGame[];   // from THEIR perspective
  whiteTree: MoveNode;     // precomputed frequency map of their White games
  blackTree: MoveNode;     // …and their Black games
}
```

`MAX_OPPONENTS = 10` (entitled) / `FREE_SCOUT_OPPONENTS = 1` (free). Maps open at
`MAP_START_PLIES` (10) and "Go deeper" steps `MAP_STEP_PLIES` (10) up to
`MAP_MAX_PLIES` (60).

### `BackupFile` (`src/storage.ts`) — format v2

```ts
{ format: 'obertura-backup', version: 2, exportedAt,
  lines: Line[], games?: ImportedGame[], local?: Record<string,string> }
```

`local` is a snapshot of every `obertura*` localStorage key plus `engineEnabled` /
`sparEngineEnabled`, **excluding** `obertura.drive.*`, `obertura.sync.*`,
`obertura.entitled` and `obertura.lichessReturnTo`. v1 files (lines only) still
restore. **Scouted opponents are deliberately excluded** — pure re-fetchable cache and
by far the bulkiest data.

`exportCore()` is the same shape minus `games` (a valid `BackupFile` in its own right,
since `games` is optional). It never opens the games store at all — reading megabytes
out just to throw them away would defeat the whole point of the split.

---

## 14. Storage layer

`src/storage.ts` wraps IndexedDB requests in Promises. Database `obertura`,
**version 3**:

| Store | Key | Indexes | Contents |
|---|---|---|---|
| `lines` | `id` | — | Every saved `Line` |
| `games` | `id` | `endTime` | Every `ImportedGame` |
| `opponents` | `id` | — | Every scouted `Opponent` (self-contained) |

Notable behaviours:

- The **connection promise** is cached (not the `IDBDatabase`), so a reload rebuilds it
  cleanly.
- `onblocked` rejects with *"Another tab has Bito Chess open. Close it and reload."* —
  without this a version bump would hang every data screen on "Loading…" forever.
- **Two change notifiers**: `onLinesChanged` fires after every repertoire write and
  `onGamesChanged` after every games write. Drive auto-backup and the account sync both
  subscribe. `eraseAllData` deliberately notifies **neither**, so an erase can't
  auto-upload an empty repertoire over the cloud copy.
- `resetAllProgress()` strips every `review` block and resets confidence/lastTrained,
  keeping the lines themselves ("forget my scores", not "delete my work").
- `eraseAllData()` clears all three stores in one transaction; the Settings dialog adds
  the two-step confirm, the "back up first" offer, and the localStorage wipe (which
  also takes the Supabase session and the sync claim).
- Multi-write helpers issue all `put`s synchronously and await the *transaction*
  (`txnDone`) rather than individual requests, so IndexedDB can't auto-commit early.
- `parseBackup()` is the single validator for files, Drive **and** Supabase — including
  reviving each move's `review.due` back into a real `Date`. `restoreBackup(backup,
  'merge' | 'replace')`; `backupHasExtras()` tells the caller whether a reload is needed.

Every data screen wraps its load in try/catch and renders `load-error.ts` (a message +
Retry) instead of hanging.

---

## 15. The chess engines and analysis stack

### Three eval tiers, in order

1. **Lichess cloud eval** (`https://lichess.org/api/cloud-eval`) — a *cache of already
   analysed positions*, which in practice means opening theory (roughly the first 8–15
   moves). Free, anonymous; uses the Lichess OAuth token when connected for higher rate
   limits (`setCloudAuthToken`, wired once in `main.ts`).
2. **chess-api.com** (`remote-engine.ts`) — a free public Stockfish service, depth 18,
   CORS-enabled. **Opt-in only** (Settings → "Deeper reviews online", default OFF)
   because it ships positions from your games to a third party.
3. **Local Stockfish 18 lite WASM** in a Web Worker — the floor. Depth 12 with a hard
   **1.5 s per-position budget** for reviews.

### Circuit breakers and cutoffs

- **Cloud breaker**: three consecutive failures, or one 429, pauses all cloud calls for
  a cooldown (90 s after a rate limit). `cloudHealth()` returns
  `'untested' | 'ok' | 'limited' | 'down'`; the scan overlay shows it live
  (green/amber/red), and the docked eval bar swaps its source badge for a tappable
  "Lichess off" retry.
- **Cloud fetch timeout**: 2.5 s.
- **Miss-streak cutoff**: after `CLOUD_MISS_STREAK = 3` consecutive misses the line has
  left book, so the rest of the game skips the cloud entirely. Used by both `review.ts`
  and `mistake-scan.ts`. A hit resets the counter.
- **Remote breaker**: 60 s after repeated failures, 90 s after a rate limit.

### The `Engine` class (`engine.ts`)

A hardened wrapper around the Stockfish worker. It exists because "Analyzing… forever"
was a real, repeated bug. Its defences:

- `gen` counter — an `evaluate()` that awaited the cloud bails on resume if superseded,
  so it can't fire `go` for an old position and wedge the search.
- `currentFen` vs `searchFen` — results are stamped with the position actually being
  searched, so stale output carries the old FEN and is filtered by the caller's
  `result.fen === live fen` guard (fixes "arrows stuck a move behind").
- `awaitedBestmoves` — a superseded search's `bestmove` (its reply to `stop`) must not
  clear the watchdog guarding the *live* search; the counter re-arms instead.
- **Search watchdog** — re-armed on each `info`, cleared on the final `bestmove`. If it
  fires, the worker is rebuilt and the search re-issued.
- **Boot deadline** — a worker that never says `readyok` (stalled WASM, crashed compile)
  gets its own 20 s deadline; otherwise it holds `pendingFen` hostage with no watchdog.
- **Deferred recovery** — a rebuild landing inside the debounce window is deferred, not
  dropped; dropping it stranded a dead worker every later evaluation queued behind.
- **Capped rebuild attempts**, refunded when real search output arrives (not on
  `readyok`, which a worker that handshakes fine but wedges on `go` could exploit).
- Finished positions return `gameOverResult(fen)` — "Checkmate" / "Draw" instead of
  analysing a position with no moves.
- `MultiPV 3`; on/off persists under `engineEnabled` (spar uses `sparEngineEnabled`).

There is also a **separate review worker** — the one game review uses — which is
serialised and shared; `explore-panel.ts` and `puzzle-alt.ts` borrow it so they can
answer without the user's live engine toggle being on.

### Move classification (`winprob.ts` — pure, self-tested)

Grades are computed on **expected points (win%)**, not raw centipawns, so a 100 cp swing
near equality costs far more than the same swing in a won game.

```
cpToWin(cp) = 1 / (1 + e^(-0.00368208·cp))     // Lichess's fit
```

`MoveClass = brilliant | great | best | excellent | good | book | inaccuracy | mistake | blunder`

| Class | Rule (win-probability drop vs the best move) |
|---|---|
| `book` | in the bundled library **and** loss < 0.10 (a book move that blunders here is still a blunder) |
| `brilliant` | engine's #1 **and** a genuine SEE material sacrifice, not forced, win-after ≥ 0.45, win-before ≤ 0.90 |
| `great` | engine's #1 **and** ≥ 0.12 ahead of the 2nd best, excluding only-moves, trivial recaptures and free captures |
| `best` | engine's #1 |
| `excellent` | drop < 0.02 |
| `good` | drop < 0.05 |
| `inaccuracy` | drop < 0.10 |
| `mistake` | drop < 0.20 |
| `blunder` | ≥ 0.20 |

The `onlyMove` / `trivialRecapture` / `freeCapture` / `sacrifice` facts come from
`move-facts.ts`, a static exchange evaluation confined to the move's destination square
(chess.js only generates legal moves, so pins and checks are respected for free).

### The reviewer (`review.ts`)

`reviewLine(nodes, opts)` walks the mainline, calls `gradeNode` per move, and writes
`classification`, `cpLoss` and `evalCp` (flipped to White's perspective for the graph).
Features: a shared eval cache (a move's child FEN is usually the next move's parent FEN,
roughly halving requests), `skipGraded` for incremental live analysis, an `AbortSignal`
that also cancels the local engine, a 120 ms pace between network positions, and a
`ReviewSummary.engine` of `'lichess' | 'remote' | 'local' | 'mixed' | 'none'` powering
the "analysed with…" tag. `gradeNode` is exported separately so **live analysis** can
grade one freshly-played move without re-walking the line.

### Accuracy (`accuracy.ts`)

Implements Lichess's published model per move, then aggregates per colour as the average
of a **volatility-weighted mean** (sharp phases weigh more) and a **harmonic mean** (one
blunder can't hide behind many easy moves). Pure arithmetic over the reviewer's stored
evals — no network, no chess.js.

---

## 16. Opening knowledge: naming, book, library, explorer stats

### Naming (`openings.ts`)

`openings-data.json` maps **EPD keys** (the first four FEN fields — board, side to move,
castling, en-passant) to opening names, generated by `scripts/build-openings.mjs` from
the CC0 `lichess-org/chess-openings` dataset. A lookup is a plain object access:
instant, offline, no API and no token.

- `nameForFen(fen)` — exact match.
- `nameForPath(fens)` — the **deepest** named position along a path (this is what the
  builder title shows and what Save auto-fills).
- `openingForPath(fens)` — name plus the ply it was reached at.
- `isOutOfBook(fens)` with `BOOK_GAP_TOLERANCE = 3` — the spar screen's "out of book"
  banner.

**Naming is for display only** — move grading is entirely `engine.ts` + `winprob.ts`.

### The book (`book-tree.ts`, `book-check.ts`, `library.ts`)

`openings-library.json` holds ~3,700 `{ eco, name, moves[] }` entries (~1.7 MB, lazily
imported so it never lands on the initial bundle). `buildBook()` turns them into a SAN
trie where each node knows its `children`, a `count` of named openings at or below it,
and `name`/`eco` when an opening ends exactly there.

`isBookMove(sanPath, childFen)` returns true when the whole sequence stays inside the
library **or** the resulting position is itself a named opening (catching
transpositions).

The **Library** overlay (`library.ts`) browses it two ways — a searchable stacked list
grouped by family, or a collapsible visual tree of ~150 family nodes — plus a detail
view with a board, the move sequence, and "Open in builder" (asks White or Black).
`library-explorer.ts` is the playable board version, embedded as a third view mode.

### Real-game statistics

- `explorer-stats.json` — a bundled, offline W/D/L table keyed by EPD, generated by
  `scripts/build-explorer-stats.mjs`. Currently empty (`{}`); regenerate to populate.
- `lichess-explorer.ts` — the live, anonymous Lichess opening explorer, two databases
  (`lichess` = every rated game; `masters` = OTB titled games). Choice persists under
  `obertura.explorerDb`.
- **`explorer-resolve.ts`** is the one place that layers them, so the Library slide and
  the Explore slide can't disagree. The rule: bundled is the floor; live only ever
  *replaces* it when it actually arrives with something. A live fetch that couldn't be
  reached reports `liveFailed: true` so the caller can say so — a silent degrade to
  bundled data must never look like "this position is unexplored". A `stillHere()`
  callback is checked after the await, so a caller whose board moved on gets
  `moves: null` rather than stats for the previous position.

---

## 17. Spaced repetition: the scheduler and line priority

`src/scheduler.ts` — pure logic, zero DOM, fully self-tested.

Each `MoveNode.review` block holds `{ ease, interval, reps, lapses, due }`:

- `ease` — how fast the gap grows. Starts at `DEFAULT_EASE = 2.5`, floor `MIN_EASE = 1.3`.
- `interval` — whole days until next due.
- `reps` — consecutive clean recalls (reset to 0 on a miss).
- `lapses` — lifetime misses (only grows).
- `due` — the `Date` it next wants training.

### The algorithm

Classic SM-2 simplified for a binary drill. `qualityFromMisses(n)`: 0 misses → 5,
1 miss → 2, 2+ → 0.

```
quality >= 3:  interval = reps===0 ? 1 : reps===1 ? 6 : round(interval * ease); reps++
quality <  3:  reps = 0; interval = 1; lapses++
ease += 0.1 - (5-q)·(0.08 + (5-q)·0.02)   // clamped at MIN_EASE
due = now + interval * spacing days
```

### Line priority (new in v0.22)

The scheduler knows how *well* you remember a move; it has no way of knowing how much
that move **matters**. The main line you get in half your games and a sideline kept for
completeness look identical to SM-2. Priority is the one thing only the user can supply:

```ts
PRIORITY_SPACING = { high: 0.6, standard: 1, low: 1.7 }
PRIORITY_RANK    = { high: 0, standard: 1, low: 2 }
DEFAULT_PRIORITY = 'standard'
```

It multiplies **the wait between reviews**, not the stored interval — so it cannot
compound across reps, and the Learning/Solid buckets keep meaning "how well is this
known?". `dueLines()` sorts high-priority lines first, keeping input order within a
band. Read it via `linePriority(line)`, never `line.priority` directly.

### What gets scheduled

Only **the user's own moves** — `userMoveNodes(tree, colour)` filters the mainline by
parity (White = even plies, Black = odd). Opponent replies are auto-played and never
tested. A move with no `review` block counts as due, so a never-trained line is always
a due line.

### Derived signals

| Helper | Meaning |
|---|---|
| `lineIsDue` / `dueLines` | any due user-move (priority-ordered) |
| `nextDue(line)` | soonest due across the line's user-moves |
| `lineBucket` | `due` \| `learning` \| `solid` — `solid` requires every move's interval ≥ `SETTLED_INTERVAL_DAYS = 21` |
| `lineConfidence` | 0–5: average of `min(5, reps)` across user-moves, rounded |
| `lineMissCount` | total lapses — the "weakest" signal |
| `recentlyAddedLines` / `weakestLines` | the session-picker orderings |
| `describeDue` | "New" / "Due now" / "Due tomorrow" / "Due in N days" |

### Chronic misses (`struggle.ts`, `struggle-nudge.ts`)

SM-2 reschedules a missed move for tomorrow, but nothing ever changes *why* you forget
it, so the loop never closes. Once a move has been missed `STRUGGLE_LAPSES = 6` times,
training offers to let you write a note; from then on the note surfaces every time you
slip, next to a **Fix it** drill. Dismissing snoozes it for `ASK_AGAIN_AFTER = 4` more
misses (so asks land at 6, 10, 14 …), stamped on the node as `noteAskedAtLapses`.

The nudge itself is deliberately **not a dialog**: a quiet box that slides in *below*
the board, never covering it, never stealing focus, never opening the keyboard on its
own. Two states — collapsed (one line + "Write a note") and writing (a focused
textarea). Dismiss by flicking it sideways or with the ×.

---

## 18. The board builder / game analyser

One screen (`#view-builder`), two modes, both driven by `main.ts`.

| | **Builder** (`builderMode = 'builder'`) | **Analyser** (`'analyser'`) |
|---|---|---|
| Subject | A repertoire `Line` | An `ImportedGame` |
| Tree mode | `single` (edits truncate) | `variations` (deviations become branches) |
| Save button | "Save line" / "Save changes" | "Save game" (greys out until *your* edits exist) |
| Tab order | Explore · Library · My lines · Line info · Engine | **Game** · Library · My lines · Line info · Engine (no Explore) |
| Extra actions | rename, training toggle + priority, delete line | "Analyse game", "Save line" (extract current path), delete game |
| Title row | opening name + colour pip | hidden — "vs <opponent> (rating) · date" + platform link |

### Layout

```
┌─────────────────────────────┐
│ board-wrap  (fixed square)  │   ← chessground; tap here (in full) to collapse the sheet
├─────────────────────────────┤
│ builder-sheet               │   ← draggable Google-Maps-style panel
│  ├ slide tabs               │   Explore/Game · Library · My lines · Line info · Engine
│  ├ move strip               │   ONE horizontally-scrolling strip, on every tab
│  └ builder-carousel         │   horizontally paged slides
├─────────────────────────────┤
│ builder-dock                │
│  ├ builder-eval (animated)  │   ← the docked quick eval bar
│  └ builder-bar              │   Flip · Engine │ Watch · ◀ · ▶
└─────────────────────────────┘
```

**The sheet** snaps between `default` (board fully visible) and `full` (~15 % of the
board peeking, `SHEET_PEEK = 0.15`). Its *height* changes; the board stays put behind
it. It can be dragged by the tab strip (vertical swipes only — taps and horizontal
scroll pass through) or by over-scrolling the slide content. **The grabber handle was
removed** in v0.22: it advertised something the panel already does when you swipe it,
and those pixels come off the board. At desktop width none of this runs (§12).

**The eval dock** animates its own height and hands the sheet its final layout in the
same beat (`animateEvalDock`), so the whole dock grows/shrinks smoothly.

### The five tabs (rebuilt in v0.22)

Slides are addressed **by name** (`BuilderSlideId = 'explore' | 'library' | 'mylines' |
'line' | 'engine'`), not by index, so the analyser can put its **Game** tab first and
drop Explore without any of the scroll-position→index maths knowing about it.

**Learn and Scouting are gone as builder tabs.** Learn lives in the Explore *tab* of
the app; scouting came back as My lines' third section, **My opponents**, because it
answers the same question from the other side of the board.

#### 0 · Explore (`explore-panel.ts`) — three curated moves

Library answers "what is playable here" exhaustively, which is the right tool once you
know what you're looking for and the wrong one when you don't. Explore asks a narrower
question and answers it in three. Priority order, each card carrying the badge and the
number that earned it:

1. **Your games** — a move you have actually played (or actually faced) in an imported
   game. Nothing beats this: a repertoire is for the positions you really get.
2. **The library** — the most popular continuation among masters or Lichess players,
   from `explorer-resolve.ts`.
3. **The engine** — for a position the first two have run out on. It runs **with the
   engine toggle off**: cloud first, then the shared review worker for a short shallow
   search. "Turn the engine on first" is not an answer to the question the slide exists
   to ask.

The top of the panel is a row of **three tiles** (the move + a provenance mark) that
play the move on tap; everything below is the argument for them. The header frames it:
*"Possible answers for 3.♝b5"* on your move, *"Prepare for the reply to 3.♝b5"* on
theirs.

#### 1 · Library (`builder-panels.ts`)

What the bundled book plays next from here — move, opening reached, count of named
openings down that branch — plus W/D/L bars and deeper online continuations from
`explorer-resolve.ts` once the book runs out. Carries the **Connect Lichess** control
and the explorer-database choice.

#### 2 · My lines (`builder-panels.ts`)

Three stacked sections, all answering "what happens from here?" from a different
source: **My saved lines** (your repertoire), **My games** (what you actually played,
with W/D/L via `wdl-bar.ts`), and **My opponents** (scouted opponents' continuations,
with `move-stats.ts` counts and a repeatable "Go deeper"). Each has a "Show tree" link
into `repertoire-map.ts` / `board-explorer.ts`.

#### 3 · Line info (`line-info.ts`)

- The **training toggle**, live from the first move and **on by default**. On an
  unsaved line it states an intent — *"Train after saving"* — and the save honours it,
  routing straight into the enrolment path where the free-tier cap and the confirm run
  live. (This replaced the old post-save *"Start training this line?"* modal, which
  asked something already answered two taps earlier.)
- The **priority** control: High / Standard / Low, each with a plain sentence saying
  what it does ("Comes round about 40% sooner than usual. For the lines you actually
  get.").
- Four figures built from the same `stats.ts` the Statistics screen uses, so they can
  never disagree with it: **faced in games, recalled, full runs, reviews**.
- The **three most-missed moves** (`TOP_FAILED = 3`), each tappable to put the board on
  the position before it.
- The full wrapping move list (the only place it still lives), title/tags/note controls
  and delete.

#### 4 · Engine (`engine-panel.ts`)

**It owns the engine while it's showing**: landing here switches Stockfish on and hides
the docked quick engine (which is the same bar and the same three moves in miniature —
two copies of one answer on one screen, one of them costing the board its pixels).
Leave the tab and the dock comes back.

So the tab has **no controls at all** — no power button (the engine is already on), no
source-and-depth readout (a fact about the answer, not the answer), no depth slider.
What's left is the evaluation and the three strongest lines, with **every move
tappable to play the line out** (`PV_PLIES = 8`). Each variation is **one row that
scrolls sideways**: wrapping made a long mating line three rows tall and made the row
a moving target for a thumb as depth climbed.

### The move strip

Before v0.22 the move list was copied into the foot of every list panel — the same
information three times on one screen, none of it visible from another tab. Now it is a
**single horizontally-scrolling strip under the tab bar, on every tab**, at the smallest
height it can be (`#move-list-strip`); the full wrapping list survives only on Line
info. PGN-style: the main line inline, sibling branches as parenthesised `(…)`
variations, recursively. Each move span carries its classification colour tint (no
glyph — icons made the strip read too far apart), its annotation chip, and a note dot.
The active move is kept centred by adjusting the strip's own `scrollLeft` (not
`scrollIntoView`, which dragged the carousel back to another tab).

### Board overlays

`refreshBoardShapes()` paints **one** `setAutoShapes` pass combining:

1. the active move's grade badge (a `customSvg` disc above the piece) plus a square
   wash below the piece via chessground custom highlights,
2. the engine's top-3 candidate arrows (`eng1`/`eng2`/`eng3` brushes, decreasing
   opacity), only when the result's FEN matches the live position, and
3. the guided-line cue arrow during onboarding (`guidedCueUci`).

Doing these in separate calls made the last one wipe the others.

### The docked quick engine

The dock's engine icon is the single on/off switch. On → the eval bar slides open with
the top-3 moves and arrows, **and live analysis is switched on** so moves you play get
graded (it never bulk-analyses an existing game — that's the Game tab's "Analyse
game"). The bar dropped its `cloud · d38` provenance tag in v0.22 and puts the move and
its eval on one line instead of two: it's the app's most space-constrained row, and
provenance is now the Engine tab's story. The unreachable-Lichess warning *stays*,
because that's actionable. Starts OFF each session unless Settings → "Engine always on"
is set, or a hand-off requested it (`pendingEngineOn`).

### Save flow

`saveCurrentLine()` →

- **Editing an existing, dirty line?** → "Update this line" / "Save as new line" / Cancel.
- **1. Partial save** — the cursor sits before the line's end → "Save up to this move" /
  "Save the whole line" / Cancel.
- **2. End-on-move** — the line ends on the opponent's move → "Trim last move" / "Keep
  as is" / Cancel. (You drill *your* moves, so a line should finish on one.)
- **3. Long line** — more than `LONG_LINE_PLIES = 40` plies → "Save anyway" / "Go back
  to edit".
- Then persist, toast, and — if the Line info toggle said so — run the enrolment path
  (cap check → confirm run or instant enrol, per `confirmRunBeforeTraining`).

### Dirty tracking and the leave guard

`builderSnapshot()` fingerprints `{ name, tags, colour, tree }` with `stripDerived()`
removing `classification` and `evalCp` — those are re-computed, not authored, so an
auto-review can never make a game read as "dirty". Comparing a fingerprint (rather than
tracking a flag across every mutation) means it can't drift out of sync.

`guardBuilderLeave(proceed)` fires on the back arrow, any tab tap, the settings icon and
the system back gesture: **Save** (persists then continues) / **Discard** / **Keep
editing**.

### Session hand-off

The mistake drill's "Analyse" and the puzzle's "Analyse position" **suspend** their
overlay and open the game/puzzle in the analyser at the drilled position. The header's
Save is replaced by a **"Back to train"** chip and the title is blanked. Tapping it (or
the builder's back arrow, which lands on Train) resumes the session exactly where it
was; navigating anywhere else discards it cleanly so a hidden overlay can't leak.

---

## 19. Train tab — the four training modes

The Train screen is a **2×2 grid** of chunky mode tabs, each with an icon tile and its
own accent colour that washes the pane background (`--train-accent`):

| Tab | Icon | Accent | Pane |
|---|---|---|---|
| **Openings** | pawn | app green | `train-screen.ts` |
| **Puzzles** | puzzle piece | `#c4741d` warm orange | `puzzles-screen.ts` |
| **Middle game** (mistake retry) | swords | `#a3492e` ember | `mistakes-screen.ts` |
| **End game** | flag | `#33677a` deep teal | `endgame-screen.ts` |

Above the tabs sits either the **Get-started panel** (`first-steps.ts`) or the **daily
challenge card** — see §20 and §27.

### 19.1 Openings (`train-screen.ts`, `drill.ts`, `session.ts`)

**Training is locked until `TRAINING_UNLOCK_LINES = 3` saved lines.** A session built
from one line shows you the thing you just learned and declares you finished, which
teaches the wrong lesson about the loop. Every Practise mode greys out below three with
the count still to go, the due hero stays away, and the confirm run stops promising a
review tomorrow that won't come. It's deliberately the same number the Get-started bar
counts to, so the panel and the lock tell one story. (The old full-page first-run gate
is gone — the hub always renders now.)

**The hub**, top to bottom:

1. A compact two-stat hero (due / reviewed / rounds) — hidden entirely when nothing is
   due or training is locked.
2. **Practise** — the mode cards. All four grey out together when the rotation is
   empty, with a reason distinguishing "nothing saved" from "nothing enrolled":
   - **Time attack** (leads) — 1 / 3 / 5-minute countdowns over single positions, each
     with its own personal best. `MODE_ACCENT.timed` gold.
   - **Review missed moves** — single moves you've missed (terracotta).
   - **Drill new lines** — full runs, newest first (green).
   - **Target weak areas** — full runs, most-lapsed first (plum).
   - **Prep** — opponent-tagged lines, only shown when any exist (teal).
3. **Lines in training** — a collapsible card (always loads collapsed) with the shared
   two-row filter bar; grouped views carry a per-branch pause control. On the free tier
   it shows **"7 of 10 lines in training"** from `TRAINING_COUNT_VISIBLE_FROM` upward,
   so the ceiling is visible before it's hit. Entitled users see no counter at all.
4. **Forgotten moves** (`forgotten-section.ts`) — two views behind one segmented
   control:
   - **Moves** — the individual moves you keep missing, worst first. Each row is a
     position miniature, the move, and a green/red bar of recalled-vs-missed. Tapping
     opens `position-peek.ts`.
   - **Lines** — the same question one level up: how much of each line still sticks.
     Tapping opens `line-peek.ts` — the whole line steppable, with per-move miss counts.

   Both read the per-move SM-2 blocks (`lapses`, `reps`); nothing new is recorded. The
   percentage shown is **recall**, not accuracy (the scheduler keeps no lifetime attempt
   count), always next to how many times the line was actually trained so the figure has
   a denominator you can judge.

**The drill runtime** (`drill.ts`) serves three shapes through one runner:

- `startDrill(line)` — walk a whole line: auto-play the opponent, quiz every user move
  in order, board stays continuous.
- `startPositionsDrill(positions)` — a stream of single positions; correct → jump on.
  Optionally animates the opponent's previous move in (`playPrelude`).
- `startTimedDrill(positions, { timedMs })` — a countdown; correct scores, wrong flashes
  and skips immediately, the pool reshuffles until the clock expires.

Key `DrillOptions`: `watchFirstMs` (auto-play the line once before asking),
`beforeWatch(start, skip)` (a hook that holds the moves at the start position until the
user says go — this is what lets the trainer explain itself on the trainer, §27),
`wrongMoveMode` (`gentle` for pre-training vs `full` = flash → snap back → retries →
draw the arrow → require the correct replay), `checkAlternative` (the engine checks
whether a "wrong" move is actually a good alternative before penalising it), `onExplore`
(opens the line explorer at the position after the played move, drill intact
underneath), `nextScriptedUci` (the guided first line's cue), `confirmAbandon`,
`sessionProgress`, and the in-session controls `onPauseLine` / `onEditLine` /
`onNoteEdit`.

Retries before the arrow is revealed: `getRetriesBeforeReveal()` — 0 / 1 (default) / 2.

**Notes no longer stop the watch.** A note popping up mid-replay used to hold the next
move for up to 3.5 s, turning a ten-second watch into a stop-start minute. Notes now
show where they teach: on a miss, and on the note control.

**Sessions** run in **rounds** so progress banks mid-sitting. Finish screens are playful
(pixel pawn, confetti) and list the **openings reviewed** with correct/incorrect counts.

**Pre-training** (`pretraining.ts`) — with `confirmRunBeforeTraining` ON (default),
adding a line first plays it through once, then has you play it; a clean run enrols it.
OFF enrols instantly (`enrolLineDirectly`).

**Fix it** (`fix-it.ts`) — the playful repeat drill: load the board → animate the
opponent's move in → you play the move → celebrate → fade the board and show the move in
big written notation → fade back. **Three reps**, then "now play the full line" chains
into the full line when the move belongs to one.

### 19.2 Puzzles (`puzzles-screen.ts`, `puzzle-run.ts`, `puzzles.ts`)

Lichess puzzles, fetched **anonymously** from
`GET /api/puzzle/next?angle=&difficulty=&color=`. (Adding the Bearer token makes it a
non-simple CORS request Lichess's puzzle endpoint won't preflight from a browser, so the
fetch throws — repeat-avoidance is handled locally instead via `puzzle-log`'s seen-id
ring.) The **dashboard** (`/api/puzzle/dashboard/{days}`) does need the token.

Three modes:

- **Daily Rated Mix** — the flagship, fronted by a "today" hero. Mixed puzzles from your
  repertoire *and* your games, a 10-puzzle run. **The only rated mode.** Runs
  easy → medium → hard (one Lichess difficulty band below / at / above your rating's
  band).
- **Time Attack** — 3 / 5 / 10 min, 3-mistake cap, ramping difficulty. Two sources
  ("From My Openings" and "Satisfying Traps" = the Lichess `opening` theme), each with
  per-length records. Casual.
- **Practice by theme** — an accordion over `puzzle-themes.ts` (Lichess theme ids:
  mateInX, the named mating patterns, tactical motifs, length and goal buckets). Its
  first accordion is **"Your openings"** with two tabs: *Based on my repertoire* /
  *Based on my games*.

Openings resolve to Lichess "angle" keys; only angles present in `puzzle-openings.json`
are offered so a run never starves.

**Alternate moves** (`puzzle-alt.ts`, new) — Lichess ships a single `solution[]`, and
some positions have a second move that is genuinely just as good (an equally fast mate,
or another move that simply doesn't blunder). On the **first** non-solution move the
local engine is asked, shallow and time-capped, whether it's equivalent: `ALT_DEPTH =
12`, `ALT_MOVETIME_MS = 700`, `ALT_MULTI_PV = 3`, `ALT_WALL_MS = 1500` hard wall-clock
cap (the review worker is shared and serialised), `ALT_TOLERANCE_CP = 30`. A mate needs
no engine — it can never be worse. **Conservative by design**: anything unverifiable
(engine missing, too shallow to rank both, timeout, an unreadable promotion) falls back
to "wrong", i.e. exactly the old behaviour. The comparison is pure and self-tested.

**Rating** (`puzzle-rating.ts`) — plain Elo against the puzzle's own Lichess rating. You
"win" by solving on the first try with no hint. It carries a `scope`, so **endgame
puzzles ride a separate ladder** from openings puzzles.

**Repeats** (`puzzle-repeat.ts`) — spaced-repetition-lite that deliberately brings
puzzles *back*: a miss queues the puzzle due immediately; a clean solve pushes it out
along 1 → 3 → 7 → 14 days, then it graduates. The whole puzzle is stored so a repeat
replays without re-fetching.

After a puzzle, a discrete **"Analyse position"** opens the game + solution in the
analyser at the puzzle position, with the "Back to train" hand-off.

### 19.3 Middle game / Mistake retry (`mistakes-screen.ts`, `mistake-scan.ts`, `mistake-run.ts`)

**The scan** — a user-triggered "Analyse my games" pass (newest first, cancellable,
resumable; every finished game is saved). For each unscanned game it replays the moves,
builds a cheap eval trail (cloud first at MultiPV 1, shallow local Stockfish on a miss),
then re-verifies candidates at the analyser's depth and stores the engine's **top-3
continuations** on the game record so the drill can judge instantly with no engine call.

Four categories:

| Category | Meaning |
|---|---|
| `opening-blunder` | you blundered in the opening and lost the game |
| `punish-opening` | the opponent erred in the opening and you let them off |
| `missed-win` | you stood clearly winning (~+2.5) and gave it away |
| `blunder` | a game-losing blunder from a roughly equal position |

Tuning constants (all exported from `mistake-scan.ts`): `OPENING_MAX_PLY = 24`,
`WIN_DROP_BLUNDER = 0.20`, `WIN_DROP_PUNISH = 0.10`, `LOSING_CP = -150`,
`WINNING_CP = 250`, `HELD_CP = 100`, `EDGE_CP = 150`, `NEUTRAL_CP = 50`,
`EQUALISH_CP = 150`, `OPP_GIFT_CP = 100`, `MAX_SPOTS_PER_GAME = 3`,
`SCAN_DETECT_DEPTH = 8`, `SCAN_VERIFY_DEPTH = 12`, `GOOD_ALT_CP = 30`,
`MIN_GAME_PLIES = 10`, `SCAN_MAX_PLIES = 80`, `CLOUD_MISS_STREAK = 3`.

`seedCacheFromAnalyses()` primes the scan's eval cache from games already reviewed in
the analyser, so analysed games (and openings they share) scan far faster.

**Free tier**: the scan only considers the `FREE_MISTAKE_GAME_WINDOW = 50` most recent
games and keeps a rolling top `FREE_MISTAKE_SPOTS = 10` unfixed spots
(`capMistakeGamesForTier`), with a `buildCapNotice` line saying so. Fixing one frees a
slot; a newer import can push the window forward. Fixed spots are never hidden.

**The drill** — sessions of 5. The position as you had it, your actual move as a **red
arrow** (with a discrete per-position eye toggle to hide it) and a one-line story:
*"You played ♞f6 ?? here and blundered."* Answers are judged **instantly** against the
stored top-3 (any of the three counts; a non-#1 gets *"Good move ✓ — even stronger:
♞f3"* with the #1 drawn as an orange arrow). Two post-answer actions only: **Analyse**
(hands off to the analyser, suspending the session) and **Next position**. Badge +
confetti on a clean find; results rows are tappable to pop the position up.

The pane also carries a **latest-mistakes carousel** (four icon-only category tabs, the
newest unfixed spot per category, "Fix it" drills exactly that position).

**Brilliant moves** (`brilliant.ts`, `brilliant-run.ts`, `brilliant-log.ts`) is the
mirror image: it reads the brilliant (!!) and great (!) moves *you* played straight off
a game's saved analysis — no engine, no network. Judging is instant and local. A game
containing your own brilliant move is auto-tagged `brilliant`. Clean re-finds are
suppressed along a 2 → 5 → 12 → 30-day ladder.

### 19.4 End game (`endgame-screen.ts`)

Three pillars:

1. **Endgame puzzles** — rated Lichess puzzles filtered to endgame themes (`endgame`,
   `rookEndgame`, `pawnEndgame`, `queenEndgame`, `bishopEndgame`/`knightEndgame`),
   reusing the whole puzzle engine but on their **own rating ladder**. A wide "all
   endgames" button plus piece-symbol shortcuts.
2. **Classic endgames** (`endgame-catalog.ts` + `endgames.json` + `endgame-playout.ts`)
   — a curated list of fundamentals grouped by category (`mates`, `pawn`, `rook`,
   `queen`, `minor`) and level (`essential`, `intermediate`, `advanced`), each ≤7 pieces.
   You play it out against the engine, and the **Lichess 7-piece tablebase is the
   ground-truth judge**: it reads the position's true result up front (your target),
   *refuses* any move that throws it, and feeds the engine the tablebase-optimal defence
   so the technique is really tested. Progress is ticked per position with a best time.
3. **From your games** (`endgame-scan.ts`) — endgames you actually reached. The scan
   finds the first endgame position (`SCAN_MAX_PIECES = 10`) on *your* move, then asks a
   judge what result was available: ≤7 pieces → tablebase (exact); 8–10 → the local
   engine with conservative thresholds, falling back to the first ≤7-piece position and
   the tablebase when unclear. Only positions you could have **won or drawn** are kept.
   **Free tier**: `FREE_ENDGAME_GAME_WINDOW = 50` games, a rolling top
   `FREE_ENDGAME_SPOTS = 3` unplayed positions, with a cap notice.

Everything **fails soft**: the tablebase host is blocked by the build/preview container
and can be offline on a phone, so when unreachable you simply play it out and the final
result is judged locally.

---

## 20. The daily challenge

`src/daily-challenge.ts` — the dynamic card at the top of Train (it yields its slot to
the Get-started panel below `TRAINING_UNLOCK_LINES` saved lines, then takes it back).
Device-local state (localStorage), reset each calendar day, mirroring `streak.ts`.

Five configurable tasks (`DailyTaskId`), configured in Settings → Daily challenge:

| Task | What it runs |
|---|---|
| `lines` | N lines to remember (due-first, topped up) |
| `positions` | N single due positions |
| `puzzles` | N rated puzzles (Daily Rated Mix engine), easy → medium → hard |
| `endgames` | N rated endgame puzzles |
| `mistakes` | N mixed mistake spots (only once spots exist) |

`DAILY_COUNT_RANGE = { min: 0, stepMax: 3, max: 20, default: 3 }`. **There is no
separate on/off switch — 0 *is* off.** The Settings row offers Off/1/2/3 as one-tap
presets so it fits one line on a phone, plus a **Custom** field capped at 20 so nobody
can type 50.

`activeDailyTasks(config, avail)` filters by what's actually runnable now. Every task's
success screen leads with **"Next task →"** (resolved at click time, and only offered
when another active task would still be open), so the whole daily runs in one sitting;
"Close session" sits beneath. Once everything's done the card shrinks to a quiet
"done — keep training ✓" line. The streak sits alongside.

### The completion popup

`src/daily-celebration.ts` (UI) + `src/daily-recap.ts` (state + maths).

Every task hands back a `TaskOutcome { right, wrong }` when it finishes; `markXDone`
files it in a rolling per-day log (`obertura.dailyChallenge.log`, 180 days,
`{ r, w, t, d }`). Its own log rather than `streak.ts` / `puzzle-log.ts`, so today is
compared against a day of the *same shape* — the challenge, not everything you happened
to do that day. Cleared by "Reset progress".

When the last active task lands, `celebrateDaily` (main.ts) stamps the day
(`markDayComplete` — returns `true` only on the first stamp, so a replayed task can't
pop it twice), builds the recap and hands it to `showWhenClear`, which waits on a
MutationObserver until the finishing task's own `.pt-overlay` results screen is gone.
Centred at every width (like the Full Access popup); backdrop, back gesture, Escape and
the button all dismiss it.

The everyday face shows today's accuracy with a delta chip, two bars (today vs
**yesterday** — or the last logged day, labelled "Last time", when yesterday is
missing), one line of encouragement, and three overall figures: day streak (flagged
"BEST YET" when it matches the longest run in `getTrainingDays()`), challenges cleared
all-time, and lines mastered / in training.

**The perfect day** — `recap.perfect` (not one wrong all day) AND
`perfectDayEligible(config, active)`: **≥ 3 active tasks, none set below 2**. Brass
palette, and the pixel pawn promotes — it hops for 1.1s, then bursts and returns as
`pixelQueenSvg` (pixel-pawn.ts). Confetti + starfall + a second burst on promotion.
Nothing anywhere else in the app hints that it exists.

---

## 21. My Lines tab

`src/lines-screen.ts`. Your saved repertoire.

- Cards use the shared **position-card scaffold** (`card-position.ts`): row 1 the title
  with a colour pip, row 2 a miniature board on the left and info/actions on the right.
  Miniatures are static inline SVG (`board-mini.ts`) drawn straight from a FEN — no
  chessground instance, so 50+ cards stay instant. They recolour live with the board
  theme; the global "Board miniatures" toggle turns them off.
- A **shared two-row filter bar** (`filters.ts`): row 1 = colour segment (All/White/Black)
  + sort menu; row 2 = a scrollable chip row of your own tags, then "vs <name>" opponent
  tags, then exclusive status pills (Due / Learning / Solid). Selection persists under
  the bar's `persistKey`.
- The **group toggle cycles** flat → by opening family → compact (by full variation
  name) — the same control on Train, My Lines and My games. Grouping is rendered by
  `line-groups.ts`, which builds each family's cards lazily on first open.
- Per card: edit pencil in the title row, training on/off switch (through
  `requestTrainingSlot()`) and delete on the training row, plus "Add to training" when
  not enrolled.
- `focusSavedLine(id)` highlights a just-saved line when the app routes here.
- **Performance**: `analyseGames`/`countGamesPerLine` are memoised against the exact
  games+lines arrays a render pass was handed, so a sort toggle reuses the cached result
  while a fresh fetch busts it.
- Empty state offers a starter-pack picker, and the **inline import box**
  (`import-inline.ts`) for the "From my games" route.

---

## 22. Explore tab

`src/explore-screen.ts` — four pillars, tabbed exactly like My Lines
(`ExploreTab = 'recommended' | 'packs' | 'learn' | 'scouting'`; the initial tab is
Recommended when it has content, else Packs).

1. **Recommended** — openings you play often but score poorly in, built from your
   imported games (`analysis.ts`). Each card seeds the builder. Empty → the inline
   import box.
2. **Packs** — the curated library:
   - **Starter packs** (`starter-packs.json`, six packs) — collapsed accordion cards
     (colour pip, title, level · style · line count) that **animate open** (a `0fr → 1fr`
     grid row, so a collapsed pack is genuinely zero pixels). Line cards only render when
     a pack is opened. Lines carry per-move notes and a middlegame **plan**.
     **"Add & learn" opens the line in the builder**, played in, exactly like the
     first-run line (the `'build'` mode in `AddLineMode`), and the builder's own Save
     carries it the rest of the way. Bulk adds go through `freeTrainingSlots()` +
     `showBulkCapToast()`.
   - **Traps** (`traps.json`, `traps-screen.ts`) — famous lines where the opponent walks
     into a tempting losing move. Collapsed into one relevance-sorted "Traps" card. A
     trap's only action is "Build line".
   - **Lichess studies** (`study-browser.ts`, `study-catalog.ts`) — search a **bundled
     index** of ~250 most-liked studies per opening family (Lichess has no CORS-enabled
     study-search API; built offline by `scripts/build-study-index.mjs`, which probes
     every entry's PGN export and drops author-locked studies), plus **"Recommended for
     your repertoire"** ranked from your saved lines' openings (weight 3) and your
     imported games' openings (weight 1). Importing fetches the study live via
     `/api/study/{id}.pgn` and opens the shared chapter sheet.
3. **Learn** (`content-explore.ts`) — your saved lines grouped by opening family, each
   card showing name + line count + up to three YouTube miniatures searched from the
   majority colour you play it, with hand-picked pins from `content-curated.json`
   leading. Shelves for favourites and history come from `video-lib.ts`.
4. **Scouting** — scout opponents (up to `MAX_OPPONENTS = 10` entitled,
   `FREE_SCOUT_OPPONENTS = 1` free). Tapping one opens a full-screen dossier with their
   most-played openings per colour, W-D-L bars throughout, a **scouting report**
   (weak/strong openings + what to play), and their auto-built opening maps with
   per-move stats and a repeatable "Go deeper". A **Prepare** flow seeds the builder with
   their moves, flipped to your answering colour and stamped with the `vs <name>` tag.
   Hidden entirely when scouting is off in Settings. At the free cap, adding someone new
   **offers to replace** the existing one; a grandfathered user over the cap gets the
   ordinary "delete one to make room" refusal.

Also reachable from Explore: **Engine sparring** (`spar.ts`) — a casual game against the
local Stockfish worker, handed off to the builder at any point. It always uses the
bundled WASM engine (never the cloud) so it feels instant. A persisted opening-mode
picker (**Surprise me** / **From my games** / **Pure engine**) decides how the engine
opens, backed by `book-lines.ts`. A default-off engine toggle adds the eval bar and
candidate arrows, and a **Suggest** control (Solid · Aggressive · Random,
`chooseSuggestMove`) only ever plays a vetted, non-blundering move.

Two more map/explorer surfaces:

- `repertoire-map.ts` — all lines of one colour merged into a zoomable, arrow-navigable
  tree, with a position preview that slides in on tap.
- `board-explorer.ts` — a chess.com-style playable explorer over a pre-built stats tree
  (an opponent's games, or your own), showing the opening name plus each move played
  from here with its game count and W/D/L bar.

---

## 23. My games tab

`src/my-games-screen.ts`. Mirrors My Lines: an import action on top (or the inline
import box when empty), the shared filter bar (colour + group + your tags — sort and
Won/Lost/Drew were deliberately dropped), then a card per game.

Each card: opponent, opening, a thin won/loss border, a numeric date on its own row
(`23/06/2026`), a miniature of the position the stored moves reach, delete tucked into a
corner. **Analysed games** additionally show a full-width review strip under the board:
White's accuracy and per-class move counts, the class icons, Black's row.

The list renders in batches and grows on scroll, so a big library opens fast.

Tapping a card opens it in the **analyser**. Import comes via the builder's import popup
(`builder-import.ts`), which offers five ways in:

1. Import my last game (the newest from the connected account, deduped),
2. Browse my last 10 games,
3. Paste PGN (or pick a `.pgn` file) — comments become move notes; a pasted Lichess study
   link or a multi-game PGN routes to the chapter list,
4. Lichess study by link — each chapter becomes a line saved straight to My Lines,
5. Add a game manually (`manual-game.ts`) — an OTB round or friendly: date, both players,
   your side, result, tournament name (stored as a tag), optional PGN.

---

## 24. Statistics tab

`src/progress-screen.ts` — one scrolling page. (The forgotten-moves block moved to
Train in v0.22; the shared furniture now lives in `stats-ui.ts` so neither screen has to
import the other.)

### 1. Streak hero

Big daily streak + a rolling 7-day strip, with a collapsible "Times trained this month"
calendar. Streak rules (`streak.ts`): a day counts when you complete at least one
session in local calendar time; the streak is the run of consecutive counted days
backwards from today, with **one day of grace** — if you haven't trained *yet* today
it's measured from yesterday.

### 2. Openings

- **Move memory** — a repertoire-wide donut over every move in your lines: *solid*
  (remembered at the last drill) / *slipping* (missed last time) / *not trained yet*,
  with recall % in the hole. Straight from each move's SM-2 block (`moveMemory`).
- **Remembered moves over time** — a recall donut with spelled-out remembered/failed
  counts and a "trained X of Y days" line, over a per-day bar. Tapping a day swaps the
  header to that day's numbers. A small **"lines added"** marker per day (with a legend)
  means a recall dip reads as fresh material rather than real forgetting. Week / Month /
  All swipe as a sliding carousel.
- Quick-stat boxes that open sheets of shortcuts.

### 3. Your games (only when games are imported)

- A discreet account strip with refresh; empty → the inline import box.
- **Your rating** — current rating, peak and games played per time class
  (Bullet/Blitz/Rapid/Daily chips) from the free public APIs, cached 6 h, falling back
  to the last-seen numbers offline. Lichess gets its full history instantly from the
  rating-history endpoint; Chess.com has none, so its series builds from
  `ImportedGame.myRating` as games are imported.
- **Record strip** — one W-D-L bar across all imported games with counts and percentages.
- **Openings: games × memory** — per opening, a *Games* ring (W/D/L slices, score in the
  hole) beside a *Memory* ring (that opening's moves as solid/slipping/untrained, recall
  in the hole), with mastery dots and an Open/Build action. A dashed placeholder ring
  marks openings you have no lines for.
- **Win rate over time** — a filterable trend with a 50 % break-even line.
- A tabbed **most played / best / worst scoring** list, sliding between tabs.

### 4. Puzzles & Endgames

Puzzle rating with a trend, solved/accuracy boxes and a **Best run** box (longest clean
rated streak). Tapping a day on the rating line swaps the boxes to that day. The
Endgames region carries the endgame-puzzle rating and best run with its own trend, plus
progress meters for Classic endgames solved and from-your-games endgames played out
(with a "let slip" count).

### The chart engine (`stats-charts.ts`)

One renderer behind **every** trend: a monotone-cubic line (no overshoot, so the curve
never invents values) over a soft area wash, recessive hairline y-gridlines with clean
ticks, an optional reference baseline, tap-anywhere crosshair + exact read-out, and an
end-dot on the newest value. Plus `renderDonut` (SVG ring gauge, themed via CSS, 2 px
surface gaps, headline number in the hole) and `renderRecordStrip`.

### The numbers behind it

`stats.ts` (pure, self-tested) aggregates training and game figures — including
`moveMemory`, `needsWorkMoves`, `lineTrainingCount` and `lineReviewCount`, which Line
info also uses so the two screens can never disagree. `analysis.ts` turns games into the
coaching report; `progress.ts` cross-references game results against `lastTrained` dates
to answer *"is drilling actually helping?"*; `rating-stats.ts` fetches site ratings.
**Nothing is invented** — where a figure isn't tracked, the section shows an honest
empty state.

#### The family-join subtlety (v0.14)

Chess.com tags games with very specific names ("Sicilian Defense Najdorf Variation Main
Line…"), which scatter across dozens of micro-labels. `openingFamily()` folds a name down
to its family — and **cuts at the colon**, because the bundled dataset names lines
"Pirc Defense: Classical Variation". Chess.com names come from URL slugs that drop
apostrophes ("Queens Gambit" vs "Queen's Gambit"), so `familyKey()` normalises both
sides. Without these two fixes the memory rings said "No line yet" for openings you
definitely had lines for.

---

## 25. Settings

`src/settings-screen.ts` — accordion groups, in render order:

0. **Go pro** — a plain accent CTA button at the very top, shown only when
   `!isEntitled()`, opening the shared upgrade dialog. Under it, a quiet **"Already
   paid? Check again"** link (`checkForPurchase()`). That second link is the safety net
   for the entire buy flow: every automatic route to noticing a purchase can miss, and
   this one is the user asking directly, so it always answers.
1. **Account** — sign in / sign up / sign out, the plan pill, the sync caption. **Only
   built when `isSupabaseConfigured`.** Leads the screen because it's about who you are,
   before how the app behaves.
2. **Add your games** — a prominent accent CTA card until you've imported, then discreet
   (the connected account with a refresh).
3. **Connect to Lichess** — a prominent card until connected, then it collapses into a
   quiet accordion lower down.
4. **Appearance** — theme picker (Classic light / Classic dark / Elegant / Gamer /
   System), board colour swatches (9), piece-set swatches (10), coordinates,
   **Board miniatures**, **move notation** (SAN vs figurine), **Engine always on**,
   **Deeper reviews online**, show move classifications, engine arrows.
5. **Training** — retries before reveal (0/1/2), watch-line speed (slow/normal/fast),
   default training mode (due/recent/weakest), confirm run before training, feedback
   sound, show paused lines, scouting on/off.
6. **Daily challenge** — per-task counts (0 = off), Off/1/2/3 presets + Custom ≤ 20.
7. **Data** (was "Backup") — export/import JSON, **Cloud backup — Google Drive**
   (connect, Back up now, Restore from Drive with the merge-vs-replace chooser,
   auto-backup toggle, last-backed-up caption with a "pending" state), **Reset all
   progress**, **Erase everything** (two-step confirm with a back-up-first offer).
8. **Lichess connection** (when connected) — disconnect, explorer database choice.
9. **Feedback & about** — Send feedback, Beta survey, Replay walkthrough, About (opens
   the landing page), and the **Buy me a coffee** support section.

Shared control builders exported for reuse by the onboarding flows: `group()`,
`segmented()`, `boardSwatches()`, `pieceSwatches()`, `buildThemeRow()`,
`confirmDialog()`.

At desktop width this exact same `renderSettingsScreen()` renders inside
`settings-lightbox.ts` instead of the full-screen view (§12).

---

## 26. Game import, accounts and scouting

### The shared import core (`import-core.ts`)

Everything platform-neutral lives here: the `NormalisedGame` shape both platforms boil
down to, the PGN → compact `ImportedGame` parser, the driver (`runImport`) that applies
the `HARD_CAP = 1000` newest-first cap and reports truncation, the time-control tally,
and local filtering. Opening moves are kept to `OPENING_PLIES = 60`.
`DEFAULT_TIME_CLASSES = ['blitz','rapid','daily']` (bullet is off by default).

**The "how far back" range chooser is gone** (v0.20): every scan now reaches the whole
history, newest first, and the hard cap stops it.

A platform module only has to hit its own API and hand the core a stream of
`NormalisedGame` batches, newest first.

### Platforms

- **Chess.com** (`chesscom.ts`) — the free Published-Data API, no key, no auth:
  `/games/archives` lists monthly archive URLs, `/games/{YYYY}/{MM}` returns that
  month's games with PGN. Fetched **serially, newest first** (the API asks callers not
  to hammer it in parallel). Also fetches the profile avatar.
- **Lichess** (`lichess.ts`) — `GET /api/games/user/{username}` with
  `Accept: application/x-ndjson`, `?since&max&moves=true&pgnInJson=true&opening=true`.
  Streams newline-delimited JSON, newest first, no token needed for public games.

> Both hosts are blocked by the build/preview container's network allowlist, so live
> import can only be exercised **on the phone**. The parsers are covered offline by the
> import self-test.

### The import panel (`import-panel.ts`) and the inline form (`import-inline.ts`)

A two-step bottom sheet used everywhere games come in:

- **Step 1** — platform + username → Scan.
- **Step 2** — step 1 collapses behind an "Edit search" link; the source is echoed
  (`@user · platform`), "Found N games", a how-many chooser, a row of time-control
  toggles each showing its count, an Import button that always shows the resulting
  count, and the White/Black split of exactly what will land.

The how-many chips come from `import-tier.ts`:

```ts
FREE_GUEST_IMPORT = 100
defaultCountFor(total, guest)   // guest: min(100, all); signed in: 500 above 500, else all
countOptionsFor(total, truncated, guest)
```

A **guest** sees "Last 100", plus padlocked "Last 500" and "All" chips *only when the
account genuinely holds more* (no point advertising an upgrade that changes nothing).
Tapping a padlocked chip opens the sign-up sheet, and signing up unlocks them **in
place**, against the scan already in hand.

The scan runs behind a **full-screen loader** with your profile picture, a pixel-pawn
progress bar (`import-progress.ts` — an asymptotic curve over `gamesSoFar`, since neither
source reports a total up front) and a **facts ticker** that types chess facts while you
wait. The parser yields to the UI so the ticker never freezes mid-sentence.

**`import-inline.ts`** puts step 1 directly, boxed and accented, on the six screens that
are useless without games — Train → Middle game, Train → End game, My Lines → From my
games, Explore → Recommended, My games, and Statistics → Your games. Filling it in
scans immediately (`autoScan`), removing a button-then-form round trip from all six.
Same two fields, prefilled from the same per-platform saved usernames.

### Accounts and refresh

- `import-last.ts` — "Import my last game": fetches the single newest game, files it
  idempotently (an already-stored game is returned as stored, never rewritten, so its
  analysis/tags/scan data survive), and hands it back to open on the board.
- `auto-refresh.ts` — a weekly refresh that runs **only when the app opens** (a PWA
  without a service worker can't wake itself). It pulls games since the last refresh,
  merges them exactly as a manual import would, advances the date and toasts any new
  games. Failures are silent.
- `lichess-auth.ts` — OAuth 2.0 with **PKCE**, entirely in the browser, one scope:
  `puzzle:read`. Tokens are long-lived (~a year), no refresh tokens. Connecting from the
  builder stashes the board position so the post-redirect reload lands back on the
  Library tab at the same position — and, if a walkthrough was running, resumes it on
  the same bubble.

### Scouting (`scout.ts`)

An "opponent" is someone you've imported games *for*, from **their** perspective (colour /
result / opponent all describe them). Their two opening maps are precomputed the moment
the import finishes, so opening one later is instant. Games and trees live in one
IndexedDB record; deleting it removes every trace. Per-move statistics come from
`move-stats.ts`, a flat, deliberately **unpruned** lookup table keyed by UCI path (the
rendered tree does its own pruning, so every drawn node — however rare — still finds its
stats).

---

## 27. First run: the guest-first onboarding

Rebuilt across v0.19–v0.22 (six passes). The old flow was an install-an-app pattern:
beta code → five intro slides → a five-step setup wizard → "add 5 lines to unlock
training". That is a lot to ask of a stranger who has just landed on a web page. The
target now is **sixty seconds from arriving to a saved, scheduled line, with no account
and nothing to unlock.**

Boot calls `shouldShowFirstRun()` (no lines **and** onboarding never finished), so an
existing user sees none of this.

### Step 1 — the picker (`onboarding-picker.ts`, `onboarding-lines.ts`)

One screen, a small form, and out. A top bar carries the mark, wordmark and a **Sign in**
link (for someone who already has an account and landed here by accident); the rest is
one **card**:

1. **I play as** — White (default) / Black, as two wide buttons carrying a real white
   pawn on a light disc and a black pawn on a dark one (a pawn says "side" faster than
   the word does).
2. **How much to learn** — three big buttons in the same clothes: **Beginner / 3 moves**,
   **Club player / 5 moves**, **Deep prep / 7 moves**. Deliberately **nothing
   preselected** — it's the choice that decides how long the line is, and a pre-picked
   answer gets accepted without being read.
3. **Style** — the four tiles appear (animated in) only once a depth is chosen: a word,
   an icon and the opening's name, in a 2×2 grid. **Tapping one commits.**

Under a labelled "or start from" rule: **Import my games** / **Build my own**.

**No boards on this screen.** Four thumbnail positions of lines the user hasn't played
are four grids of beige squares; they cost the height the controls needed and made a
three-second decision look like homework. The board arrives one tap later, full size,
with the walkthrough on it.

`onboarding-lines.json` holds **eight curated lines** — Italian, Scotch, Ruy López,
Polish for White; Caro-Kann, Najdorf, French Classical, Owen for Black. A **level is a
truncation measured in the user's own moves** (White's nth move is ply 2n−1, Black's is
ply 2n), so every cut ends on a move the user has to remember — exactly how the builder
nudges you to finish a line. Everything is replayed through chess.js once, lazily, and
cached (the picker asks for up to 24 cuts while you flick between options, so they must
be free after the first look). A self-test asserts every cut ends on the user's move and
resolves an opening name, so editing the JSON can't quietly break a card.

### Step 2 — the builder walkthrough (`onboarding-tour.ts`)

**Coach-marks**: a bubble anchored beside the thing it's describing, everything else
dimmed. Cards on an empty screen taught nothing — naming "the tabs under the board"
while there are no tabs on screen asks the user to hold a description in their head and
match it later.

How the spotlight works: **one** scrim element positioned over the target's rect and
given an enormous `box-shadow` spread in the scrim colour. The element itself is
transparent, so the shadow paints everything *around* it — a cut-out with no SVG masks,
no four-rectangle jigsaw, no clipping at screen edges, and nothing to re-stack (a
box-shadow paints strictly outside its element's box, so the hole shows the real screen
at full strength whatever stacking contexts exist).

`EDGE_INSET = 9`: a phone board is the full width of the screen, so a spotlight drawn
exactly on its rect puts its ring off-screen on both sides and "highlighted" reads as
"the app went dark". Every spot is clamped to sit at least that far inside the viewport,
and the padding around the target is trimmed **symmetrically** when the clamp bites, so
a button near the edge still gets a ring that looks centred on it.

A step can be **live**: `interactive` drops the overlay's pointer capture so taps reach
the app underneath, and `watch` lets a step advance on something the user *did* (a move
played on the board, the next tab tapped). That is the difference between a slideshow
about the screen and a walkthrough of it.

The seven-bubble sequence: the board **rewinds to the user's second-to-last move** with
an arrow on it and waits (play it, or press Next and it's played for you) →
**Explore** → **Library** (offering **Connect Lichess** as a full-width primary, which
comes back to the same bubble) → **My lines** (offering **Import my games**, likewise) →
**Line info** → **Engine** (which opens the Engine tab with Stockfish running, and
switches it off again after) → the **last move of the line** → **Save** (with *Add more
moves* / *Save the line*).

Every bubble carries **Back** beside Next, with **Skip** as one quiet word in the
bubble's top-right corner. A step's `onEnter` re-runs on the way back, so the board
rewinds and panels reopen. Back on the *first* bubble returns to the picker — with the
walkthrough owed again, so the next pick brings it along. Navigation is the buttons and
the tabs and nothing else: tapping *Line info* goes to the Line info **bubble**, and
tabs with no bubble are locked for the duration.

Shown once ever (its own flag, `obertura.builderTourSeen`), so it also fronts a pack
line opened months later. The Save step runs on **every** guided line.

### Step 3 — the trainer explains itself, on the trainer

The trainer screen mounts first — board and all — and a coach-mark on the board explains
it with the thing itself behind it: *"Watch the line played once, then repeat it from
memory"*, two attempts before the move is revealed, with a quiet **Skip this time**
(the line is saved and in training either way). `drill.ts`'s `beforeWatch` hook holds
the moves at the start position until **Got it**. After the watch pass the first move is
asked for by name and drawn on the board — the one place the answer is given away,
because there is nothing to remember yet.

### Step 4 — the win, then the one ask (`onboarding-signup.ts`)

Finishing shows a centred **"Your first line is set!"** card over a **blurred** hub
(the app's own cards were legible behind a merely-dimmed one), with the training
finish's hopping pawn, a confetti burst, what happens next, and about-five-lines as
friendly advice. The account offer sits under a hairline with a quiet **Not now**.
Without accounts configured it's the same card minus the ask.

"Not now" is remembered **for good** (`obertura.signupAsked`, plus a session flag in
case the write fails), so the post-win ask happens once in a device's life and never
nags. The form itself is `account-ui.ts`'s `buildAuthForm`, unchanged.

`handleAuthUrlParam()` reads `?auth=signup` / `?auth=signin` (the landing page's links)
and `?buy=1` (the landing page's buy button for a signed-out visitor), strips them off
the URL, and either opens the sheet with the buy-flow lead + an `onSignedIn` that
continues to the checkout, or — for `?buy=1` alone — hands straight over to
`openCheckout()`, which asks for the account itself.

### The standing to-do list (`first-steps.ts`)

The picker can be backed out of (the system gesture, a mis-tap, a reload), and whoever
does that lands on a Train hub with nothing on it. This panel is the missing instruction
sheet, and it is deliberately the loudest thing on the screen: an accent-washed card
with a progress bar, above the tabs.

**Two phases**, around `TRAINING_UNLOCK_LINES = 3` saved lines:

- **Goal phase** (< 3) — it takes the daily challenge's slot outright and leads with the
  line goal, its bar, and the two real routes as equal primaries (**Build a line** ·
  **Starter packs**) with the engine builder as a discrete link under them.
- **Checklist phase** (≥ 3) — the goal block drops away, the daily card takes its slot
  back, and the checklist rides underneath it, compact.

The checklist rows, each ticking off on its own and each saying what it unlocks:
**Install the app** (Android only, and only when `gate.ts` is actually holding a real
`beforeinstallprompt` — no instructions card, no row where it can't work),
**Import your games**, **Connect Lichess**, **Create a free account** (only in a build
that has accounts). Plus a **Go pro** button wired to the shared upgrade dialog.

How it ends — and it is never "after N lines": a discrete **×** hides it for the session
(sessionStorage), and it **retires for good** once there's an account or an install.
Those are the two steps that actually change what the app can do for you; past either
one, a to-do list is nagging.

Chrome decides installability a beat after boot, so `onInstallAvailable()` repaints Train
when the prompt lands rather than making the user navigate away and back.

---

## 28. Gate, survey, feedback, support

### Beta access gate (`gate.ts`)

**Skipped entirely on the Cloudflare build** (`__DEPLOY_TARGET__ === 'cloudflare'`):
bitochess.com is a website a stranger can land on, and an access-code wall is the wrong
first thing to show them. The internal GitHub Pages build keeps it exactly as it always
was: the first open in a browser shows an "enter your beta access code" screen before
the app boots; a correct code unlocks the device forever (a localStorage flag) and then
offers an install screen; skipped when already unlocked or running as an installed PWA.

Codes are checked against **SHA-256 hashes baked into the bundle** (never the plain
code), and any code whose hash is in the list is accepted, so several can run at once.
Rotation instructions in `BETA-ACCESS.md`.

> **Honest caveat, stated in the source:** this is a *client-side* gate. A determined
> developer can read the JS and bypass it. It's a friendly speed-bump for a private beta,
> not real security.

`gate.ts` also owns the **install prompt**: it captures `beforeinstallprompt` at boot
(the event fires once and can't be re-requested), and exports `canInstallApp()`,
`isAppInstalled()`, `promptInstall()` and `onInstallAvailable()` for the Get-started
checklist.

The gate's local unlock flag is deliberately left untouched by all the account work, so
a later migration session can read it to grandfather existing testers.

### Survey (`survey.ts`)

A one-week-in beta questionnaire posting to the same **Web3Forms** relay as the feedback
form. A slim launch banner appears a week after `obertura.installedAt` (stamped on first
launch), shown once per session until submitted. The survey itself is a full-screen,
one-question-at-a-time form with Next / Back / Skip. **Every answer and the current step
autosave to a localStorage draft**, so closing the app never loses progress; a successful
submit clears the draft and sets `SENT_KEY` so the banner never returns.

### Feedback (`feedback.ts`) and support (`support.ts`)

Feedback is a bottom sheet posting to Web3Forms — a no-backend form relay, so messages
land in the owner's inbox with no server. The access key is **public by design**
(Web3Forms keys live in client code; the destination email is configured on their
dashboard and never appears in the source). Support offers Swish (opens the Swish app
pre-filled on a Swedish phone) and a Ko-fi card link.

### About (`about.ts`)

App / Open source / Version, with name and version baked in at build time from
`package.json` via the `vite.config.ts` defines (`__APP_NAME__`, `__APP_VERSION__`).
Carries the third-party licence table (chessground GPL-3.0, chess.js BSD-2-Clause,
Stockfish GPL-3.0, Lichess chess-openings CC0-1.0, the piece sets).

---

## 29. Backup, Google Drive, publishing

### Manual backup (`backup.ts` + `storage.ts`)

Export writes the whole `BackupFile` to one JSON download; Import reads it back with a
**merge vs replace** chooser (`openImportChooser` — merge overwrites by id and never
deletes, the safe default; replace wipes first). This is the same chooser the Supabase
sign-in reconcile uses. A restore carrying extras (games / localStorage) prompts a
reload, since modules cache localStorage state in memory.

### Google Drive cloud backup (`drive-backup.ts`)

Everything runs in the browser, no server: Google Identity Services hands the app a
short-lived access token via an OAuth popup (client IDs are public by design), and the
Drive REST API stores **one file** — the same JSON that Export downloads — in the app's
hidden **`appDataFolder`**. That folder never appears in the user's Drive and only this
app can read it, so the narrowest Drive scope suffices.

Features: Connect, Back up now, Restore from Drive, an **auto-backup toggle** (a debounced
upload ~30 s after any repertoire change, wired through the storage change notifier), and
a last-backed-up caption with a "pending" state. Connecting on a fresh device offers to
restore an existing cloud backup *before* anything is uploaded. Background auto-backup
only uploads while a session token is live — otherwise it stays quietly "pending" until
Settings is opened — so it can never trigger the Google sign-in screen mid-app.

`DRIVE-SETUP.md` is the click-by-click guide to creating a client ID. Drive backup now
coexists with Supabase sync: they are independent transports of the same `BackupFile`,
with the same last-write-wins ceiling.

### Publishing (`PUBLISHING.md`)

The full options analysis: **Google Play via a Trusted Web Activity** as the recommended
paid one-time-payment route, the Microsoft Store as an optional desktop storefront, Apple
deferred with honest cost/rejection caveats, web-only sale as the fallback. It documents
the free-web-vs-paid-app pricing stance, the step-by-step Play checklist with its gotchas
(12 testers / 14-day closed test, root `assetlinks.json` repo, free-can-never-become-paid),
and the design note for **true automatic sync** (per-line `updatedAt` + deletion
tombstones) so a later round starts from a design rather than from scratch.

---

## 30. The landing page

`docs/index.html` — a **standalone, hand-written ~98 KB HTML file** with no build step.
It serves at the `dist/` root on Cloudflare (bitochess.com) and at `…/obertura/docs/` on
GitHub Pages. `docs/LANDING-COPY.md` is the copy's **source of truth**: change wording
there first, then mirror it into the HTML by hand — nothing generates one from the other.

Rebuilt in v0.23 so the page and the app are visibly the same thing:

- **It uses the app's tokens verbatim** (`src/style.css` `:root` and the dark block) and
  the app's type — system-ui, with **Chakra Petch** reserved for the wordmark exactly as
  `header h1` does. It follows `prefers-color-scheme` instead of being light-only. Board
  colours stay unthemed in both schemes, as in the app.
- **A fixed top bar** with the wordmark left, **Sign in** and the app icon right. The
  icon starts big and overhangs the bar, then shrinks into it on the first scroll — it's
  absolutely positioned, so the bar's height never changes and the page never jumps.
  Signed in, the link becomes *Open app* and every CTA becomes *Open Bito Chess →*.
- **A playable hero board**: three scripted moves of the Italian Game with the app's own
  orange hint arrow and cburnett pieces. **No chess engine and no dependency** — the only
  legal move at each step is the one the arrow points at. The starting position is in the
  markup, so there is no empty frame before the script runs and none without it.
- **How it works** (3 steps), **Build**, **Train**, **Your games**, **Progress**.
- **"There's more than openings in here"** — five illustrated cards (puzzles, mistakes,
  brilliants, endgames, Stockfish) on a scroll-snap carousel with arrows and dots.
- **The price section** — Free €0 vs **Full access, one payment**, with an **Unlock full
  access** button. The card's price is **fetched** from `GET /api/stripe/prices` and
  overwritten on load (99 kr on a Swedish device), so the `9€` in the markup is a no-JS
  fallback rather than a second source of truth. Signed in, the button POSTs to
  `/api/stripe/checkout` with the access token read out of `localStorage` — this page
  never loads the Supabase library — and navigates to the returned Stripe URL. Signed
  out, it shows the `#signup-overlay` card, whose own button goes to
  `/app/?auth=signup&buy=1` so the app finishes the job. **Anything missing — no price
  id, no token, an expired token, the GitHub Pages mirror with no Worker behind it —
  hands over to `/app/?buy=1`**, where the app's own checkout has a live session it can
  refresh. A visitor is never left with no way to pay.
- **"Why I made Bito Chess"** as a comic speech bubble with a signature and an *About the
  app* box.
- **Six hand-drawn 3D vector pieces** drift behind the sections (silhouette + gradient +
  highlight, a few kB, no bitmaps), straddling band edges and moving at their own speed
  on one rAF-throttled scroll handler. They shrink and fade on a phone and hold still
  under `prefers-reduced-motion`. The final CTA gets the app's hopping pixel pawn.
- `?auth=signin` opens a **sign-in** sheet, not a sign-up form.

The five old screenshot PNGs stay in `docs/` for whenever they come back.

---

## 31. Design system, theming and appearance

### Tokens (`style.css`, ~17,000 lines)

Every colour resolves to a CSS variable on `:root`, overridden per theme. **The board
squares are deliberately never themed** — they stay identical across themes.

```css
/* Board — identical in every theme */
--board-light: #eecfa1;  --board-dark: #b58863;  --board-lastmove: #e3b25a;

/* Light theme surfaces */
--bg-page: #f1ece1;  --bg-card: #faf8f5;  --bg-sheet: #f5ede0;
--bg-elevated: #ede5d5;  --bg-parchment: #f8f3ea;

/* Text — every value verified ≥ 4.5:1 (--text-fainter targets ≥ 3:1, decorative) */
--text: #1c1610;  --text-muted: #5c4838;  --text-faint: #7a6353;  --text-fainter: #977f6b;

/* Accent + status */
--accent: #c07a2a;     /* warm brass */
--primary: #3e6650;    /* felt green — THE primary */
--success: #708151;    /* sage — "right" */
--danger:  #b4533a;    /* brick — "wrong" */
--warn:    #b8591a;

/* Spacing scale — every gap and padding resolves to one of these */
--space-xs: 4px; --space-sm: 8px; --space-md: 12px; --space-lg: 16px; --space-xl: 24px;
```

Dark mode is a **warm charcoal** (`--bg-page: #211c16`), not cold grey, with every value
contrast-audited; shadows disappear and borders do the work.

### Themes (`theme.ts`)

Five choices → a concrete `data-theme` value read by CSS (CSS never reads
`prefers-color-scheme`; JS is the single source of truth):

| Choice | `data-theme` | Look |
|---|---|---|
| `classic-light` | `light` | the original light theme |
| `classic-dark` | `dark` | warm charcoal |
| `elegant` | `game` | warm casino-felt green, between light and dark |
| `gamer` | `gamer` | near-black base with neon cyan/violet glow on the chrome |
| `system` | resolved | follows the OS |

Pre-v1.3 stored values (`light`/`dark`/`auto`/`game`) are migrated on read — **in both
`theme.ts` and the inline `index.html` script**.

### Appearance (`appearance.ts`)

- **Board colours** (9): `wood` (default), `green`, `blue`, `grey`, `purple-diag`,
  `wood4`, `newspaper`, `olive`, `blue-marble` — applied via `data-board` on `<html>`;
  the textured ones load images from `public/boards/`.
- **Piece sets** (10): `cburnett` (bundled default, its CSS ships in `main.ts`), plus
  `maestro`, `california`, `mpchess`, `kiwen-suwi`, `horsey`, `gioco`, `tatiana`,
  `letter`, `anarcandy`. Each non-default set's CSS is vendored under `src/pieces/`,
  scoped to `html[data-pieces="<set>"]` (out-specifying cburnett's unscoped rules) and
  **dynamically imported on first pick** via a static loader map so Vite splits each into
  its own async chunk. The promise is cached, so re-selecting never re-imports.
- **Coordinates** toggle.

### Feedback colours and move classes

Sage (right) and brick (wrong) replaced generic green/red across training and validation.
`icons.ts` maps each `MoveClass` to a colour, a label, and a board badge SVG.

### Motion

`confetti.ts`, `count-up.ts` and the pixel pawn all check `prefers-reduced-motion` and
degrade to a static result. The sliding carousel effect on ranged charts is CSS-only and
honours it too.

### Arrow brushes (`board-brushes.ts`)

Chessground draws each arrow head as an SVG `<marker>` whose id is global to the
document. Many boards alive at once (builder, trainer, review, miniatures) meant key
collisions were the rule, and an arrow would resolve to the *first* matching marker —
which, if that board is `display:none`, paints the shaft but **not the head**.
`registerBrushes()` gives every board unique keys.

---

## 32. Preference reference (localStorage keys)

All device-local. All backed up as part of `BackupFile.local` **except** the excluded
ones marked below.

| Key | Module | Meaning / default |
|---|---|---|
| `obertura-theme` | theme.ts | theme choice; default `system` |
| `obertura.boardColour` | appearance.ts | board scheme; default `wood` |
| `obertura.pieceSet` | appearance.ts | piece set; default `cburnett` |
| `obertura.showCoordinates` | appearance.ts | board coordinates |
| `obertura.moveNotation` | notation.ts | `standard` \| `figurine`; **default figurine** |
| `obertura.retriesBeforeReveal` | prefs.ts | `0`\|`1`\|`2`; default 1 |
| `obertura.watchSpeed` | prefs.ts | `slow` 800 / `normal` 400 / `fast` 200 ms |
| `obertura.defaultTrainingMode` | prefs.ts | `due` \| `recent` \| `weakest`; default `due` |
| `obertura.confirmRunBeforeTraining` | prefs.ts | default **ON** |
| `obertura.onboardingComplete` | prefs.ts | first-run gate flag |
| `obertura.builderTourSeen` | prefs.ts | the coach-mark walkthrough, once ever |
| `obertura.signupAsked` | onboarding-signup.ts | the post-win account ask, once ever |
| `obertura.lines.showMiniatures` | prefs.ts | board miniatures; default ON |
| `obertura.train.showPaused` | prefs.ts | show paused lines; default ON |
| `obertura.train.filter` | filters.ts | the Train filter bar's persisted selection |
| `obertura.builder.showEngineArrows` | prefs.ts | default ON |
| `obertura.builder.engineEverywhere` | prefs.ts | "Engine always on"; default OFF |
| `obertura.builder.showMoveClassifications` | prefs.ts | default ON |
| `obertura.remoteEngine` | prefs.ts | "Deeper reviews online" (chess-api.com); default **OFF** |
| `obertura.stats.range` | prefs.ts | `week` \| `month` \| `all` |
| `obertura.stats.calendarExpanded` | prefs.ts | default collapsed |
| `obertura.includeSecondPlatform` | prefs.ts | surface the other platform; default OFF |
| `obertura.explorerDb` | prefs.ts | `lichess` (default) \| `masters` |
| `obertura.timedBest.{1,3,5}` | prefs.ts | timed personal bests |
| `obertura.installedAt` | main.ts | first-launch timestamp; gates the survey banner |
| `engineEnabled` / `sparEngineEnabled` | engine.ts / spar.ts | engine on/off (backed up) |
| **`obertura.supabase.auth`** | supabase.ts | the Supabase session (namespaced so the erase sweep clears it) |
| **`obertura.supabase.oauthPending`** | auth.ts | the 10-minute Google-sign-in-in-flight flag |
| **`obertura.sync.account`** | repertoire-sync.ts | the user id this device has reconciled with — **excluded from backups** |
| **`obertura.sync.last` / `.pending` / `.failed`** | repertoire-sync.ts | sync state — **excluded** |
| **`obertura.sync.coreFingerprint` / `.gamesFingerprint`** | repertoire-sync.ts | what was last pushed — **excluded** |
| **`obertura.entitled`** | entitlement-cache.ts | `{ id, entitled }` — **excluded from backups AND from the sync blob** |
| `obertura.drive.*` | drive-backup.ts | Drive connection state — **excluded from backups** |
| `obertura.lichessReturnTo` | lichess-auth.ts | OAuth return crumb — **excluded from backups** |

Plus the stat/log stores: streak days, review outcome log (`REVIEW_LOG_WINDOW = 120`
days), reviewed-today counter, puzzle day/opening tallies, puzzle ratings (per scope),
puzzle repeat queue, forgotten-move tallies, endgame progress, brilliant log, video
shelves, daily-challenge state and config, gate unlock flag, intro/wizard seen flags,
survey draft + sent flag.

`sessionStorage` holds exactly one thing: the Get-started panel's per-session dismiss.

---

## 33. Self-tests and runtime verification

### The self-test harness

There is **no test framework**. Each `src/*.selftest.ts` exports a
`run<Name>SelfTest(): { name, pass, detail }[]`. `scripts/run-selftests.ts` imports the
DOM-free suites and prints a `PASS/FAIL` line each with a final tally, exiting non-zero
on any failure. Run with `npm run selftest` (Node ≥ 22, using
`--experimental-strip-types` plus `scripts/register-ts.mjs` + `scripts/ts-resolve.mjs`
for extensionless imports).

The **30 headless suites**, in runner order:

`openings`, `import`, **`import-tier`**, `scheduler`, `analysis`, `spar`, `scout`,
`traps`, `move-stats`, `progress`, `stats`, **`struggle`**, `tree`, `engine`, `puzzles`,
`puzzle-rating`, **`puzzle-alt`**, `winprob`, `review`, `move-facts`, `accuracy`,
`mistake-scan`, `brilliant`, `endgame-catalog`, `endgame-progress`, `endgame-scan`,
`study-import`, `study-catalog`, **`account-sync`** (`repertoire-sync.selftest.ts`,
which tests `sync-core.ts`), **`onboarding-lines`**.

`storage.selftest.ts` runs against a real IndexedDB, so it stays phone-only
(`selftest-panel.ts` renders the in-app runner, which accepts sync or async runners).

> ⚠️ `npm run selftest` needs `node_modules` installed (`npm ci`). In a fresh container
> it fails with `ERR_MODULE_NOT_FOUND: chess.js` until dependencies are installed.

**Why `sync-core.ts` exists at all**: importing `repertoire-sync.ts` would drag in the
Supabase client, which reads `import.meta.env` and therefore only exists inside a Vite
build. The pure half lives next door so it runs under plain Node.

### Runtime verification (`.claude/skills/verify/SKILL.md`)

A repo skill for driving the built PWA headlessly:

```bash
npm ci
npm run build                    # tsc + vite build → dist/ (also copies the engine)
npx vite preview --port 4173 &   # http://localhost:4173/obertura/
```

Then drive with Playwright (not a repo dependency — install it in the scratchpad with
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, launch Chromium with an explicit executable path)
at a **phone viewport of 412×915**, since the app is phone-first.

---

## 34. Third-party services and offline behaviour

| Service | Endpoint | Auth | Used for | On failure |
|---|---|---|---|---|
| **Supabase Auth** | `/auth/v1` | anon key + PKCE | sign-up / sign-in / Google | friendly message; the app works signed out |
| **Supabase REST** | `/rest/v1/profiles` | anon key + RLS | the synced copy, the `entitled` flag | "Sync failed — will retry"; last answer stands |
| **Stripe API** (from our Worker) | `prices.list`, `prices.retrieve`, `checkout.sessions.create` | `STRIPE_SECRET_KEY` | the price card, the checkout session | prices soft-fail to `[]` → built-in fallback; checkout toasts, nothing charged |
| **Stripe Checkout** | `checkout.stripe.com` (redirect) | the session URL | taking the €9 / 99 kr | the return poll is silent |
| **Stripe → our Worker** | `POST /api/stripe/webhook` | `Stripe-Signature` HMAC-SHA256 | granting `entitled` | **non-200 on purpose** → they retry for 3 days |
| Lichess cloud eval | `/api/cloud-eval` | optional Bearer | tier-1 eval | circuit breaker → next tier; "Lichess off" badge |
| Lichess opening explorer | explorer API | none | W/D/L bars, deep continuations | bundled stats / `liveFailed` |
| Lichess puzzles | `/api/puzzle/next` | **none (must be anonymous)** | every puzzle mode | `null` → empty state |
| Lichess puzzle dashboard | `/api/puzzle/dashboard/{days}` | Bearer | Statistics dashboard | omitted |
| Lichess study export | `/api/study/{id}.pgn` | none | study import | error toast |
| Lichess tablebase | `tablebase.lichess.org/standard` | none | endgame ground truth | local engine judges instead |
| Lichess games export | `/api/games/user/{u}` | none | import | import fails with a message |
| Lichess rating history | `/api/user/{u}` + history | none | Statistics ratings | cached / last-seen |
| Chess.com Published-Data | `api.chess.com/pub/...` | none | import, avatar, ratings | as above |
| chess-api.com | POST | none | opt-in depth-18 tier | breaker → local engine |
| YouTube Data API v3 | search | shared key | Learn video cards | one-tap "Search on YouTube" link |
| Web3Forms | POST | public key | feedback + survey | error message |
| Google Drive | REST + GIS | OAuth popup | cloud backup | "pending" state |
| Google Identity | OAuth | client ID (public) | Drive + Supabase Google sign-in | friendly message |

**Public-by-design keys in the bundle**: the Supabase anon key (protected by RLS and
column grants), the Google OAuth client IDs, the Web3Forms access key, and the
**shared YouTube key** in `src/youtube.ts` — the last is
restricted in Google's console to the app's origin and to YouTube Data API v3 only, so
outside the deployed app it's dead weight. All users share the free quota (~100
searches/day); queries are per **opening name** (not per move) and cached for a week.

**Never in the bundle**: `SUPABASE_SERVICE_ROLE_KEY`, `LEMONSQUEEZY_WEBHOOK_SECRET`.
Both are Cloudflare Worker secrets, and nothing logs, echoes or returns them.

**Container caveat:** `lichess.org`, `api.chess.com` and `tablebase.lichess.org` are all
blocked by the build/preview container's network allowlist. Anything touching them can
only be exercised **on the phone**; the parsers are covered offline by self-tests. The
same is true of the entire payment path — the only real test of the buy flow is a
purchase.

---

## 35. Known limits and deliberately deferred work

- **No service worker** — no offline mode, no background sync. The `no-cache` meta tags
  are the deliberate stand-in.
- **Sync is last-write-wins, not true sync.** Two devices editing in the same window
  means one overwrites the other; there is no per-line merge and no way to tell
  "deleted" from "hasn't arrived yet". Fix needs per-line `updatedAt` + deletion
  tombstones (design note in `PUBLISHING.md`).
- **Supabase's REST request-body limit is unmeasured.** If a very heavy games library
  ever fails to sync while the lines keep syncing, that's the suspect —
  `npm run probe-sync-limit` answers it from a desktop.
- **The beta gate is client-side only**, and explicitly not real security. It is also
  now only on the internal channel.
- **Study import drops side variations** — `variations=false` is requested, so only the
  mainline reaches the parser.
- **No tree migrations.** Pre-single-path lines may carry hidden dead branches; readers
  ignore them and the first divergent edit cleans them up.
- **`explorer-stats.json` is currently empty** (`{}`) — regenerate with
  `npm run build-explorer-stats` to restore the offline W/D/L core.
- **Map transpositions are not merged** — positions reached by different move orders show
  as separate nodes.
- **Chart labels distort on very wide screens** (`preserveAspectRatio: none`) — accepted
  for a phone-first app.
- **Scouted opponents are excluded from backups and from sync** (re-fetchable, bulky).
- **The price lives in four places, and only Stripe charges** (§11). The app and the
  landing page fetch it; their hard-coded numbers are offline fallbacks.
- **Nothing reads `entitled_at`, `stripe_customer_id` or `stripe_payment_intent_id`** —
  they exist so a row can answer "when did this account get access, did a purchase or a
  human do it, and which Stripe payment was it?" without searching Stripe by email.
- **There is deliberately no `subscription_status` column.** A boolean is the honest shape
  for a one-time unlock; a status enum would imply renewals and dunning that don't exist.
- Parked seeds: a fourth board/app theme, deeper engine adaptation, richer explanations,
  more opening-database coverage, the Play Store build-out.

---

## 36. Working conventions

These come from `CLAUDE.md` and are visible throughout the code. They matter for anyone —
human or AI — continuing the project.

### How to communicate with the owner

Marçal is a designer/WordPress developer who **does not write code and doesn't want to**.
He understands concepts, not syntax. He directs; the assistant builds; he tests on his
phone.

- Lead with the answer, then brief reasoning. No long preambles.
- Work **one layer at a time**. End every change with a clear *"how to test on my phone"* step.
- Give **whole files**, not fragments, and say where each file goes.
- Flag uncertainty; **never invent library APIs**.
- **Protect the v1 scope** — push back on scope creep.
- **Never reach for a paid service without flagging it first.**
- Confirm scope before starting new work; record the round in `ROADMAP.md` with its
  branch name and restore point.

### Code conventions

- **Long "why" header comments** on every module. They are the primary documentation —
  update them when behaviour changes.
- **Split pure logic from DOM**, and add a `*.selftest.ts` for the pure part. Register new
  DOM-free suites in `scripts/run-selftests.ts`.
- **Fail soft on every network call** — return `null`, degrade the UI, never throw at the
  user. *The one exception is `worker/stripe-webhook.ts`, which must fail loudly.*
- **Every account/sync/payment path checks `isSupabaseConfigured` first** and returns
  early, so the internal build stays exactly as it is.
- **Nothing secret goes in a `VITE_` variable.** Anything so prefixed is inlined into the
  bundle and is public by definition.
- **`entitled` is written by the server only.** The database revokes the column from every
  key the app ships with; the cache is a mirror, never a grant.
- **Small, focused files.** When a module grows past its job, split it.
- **Reuse the shared primitives**: `showDialog`, `showToast`, `buildEmptyState`,
  `renderLoadError`, `createFilterBar`, `buildPositionCard`, `renderGroups`,
  `renderLineChart` / `renderDonut`, `wdlBlock`, `pushBack`, `Icons`, `group()`,
  `buildAuthForm`, `showCoachMarks`, `buildInlineImport`, `buildCapNotice`.
- **Every overlay registers `pushBack`** so the Android back gesture closes it.
- **Every device-local pref goes through a getter/setter** in its own module — never read
  `localStorage` inline at a call site.
- **Design tokens only** — no raw hex in component CSS; use the spacing scale.
- Keep `theme.ts` and the `index.html` pre-paint script in sync.
- Keep `DESKTOP_NAV_BREAKPOINT` (main.ts) and every `$desktop-nav` media query in sync.
- Builder slides are addressed **by name**, never by index.
- **Do not "finish" the Obertura→Bito rename** into storage keys, the IndexedDB name or
  the backup format string (§1.1).
- Commit and push to the designated feature branch; the Pages deploy runs on `main` and
  the Cloudflare deploy is `npx wrangler deploy`.
