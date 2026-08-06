# Obertura — complete app & codebase context

> A single-file reference describing everything Obertura is and does: the product,
> every feature, the architecture, the data model, every source file, the build and
> deploy pipeline, and the conventions the codebase follows.
>
> Written to be dropped into a Claude Project as standing context. Generated from the
> repository state on branch `claude/app-documentation-context-96c679`
> (latest commit at time of writing: `9b72dc3`, "Engine un-sticking, Lichess studies in
> Packs, scannable Packs layout").

---

## Table of contents

1. [What Obertura is](#1-what-obertura-is)
2. [Project status, versioning and history](#2-project-status-versioning-and-history)
3. [Tech stack, hard constraints and philosophy](#3-tech-stack-hard-constraints-and-philosophy)
4. [Repository layout — every file](#4-repository-layout--every-file)
5. [Build, scripts and deployment](#5-build-scripts-and-deployment)
6. [App shell, navigation and back handling](#6-app-shell-navigation-and-back-handling)
7. [Data model](#7-data-model)
8. [Storage layer](#8-storage-layer)
9. [The chess engines and analysis stack](#9-the-chess-engines-and-analysis-stack)
10. [Opening knowledge: naming, book, library, explorer stats](#10-opening-knowledge-naming-book-library-explorer-stats)
11. [Spaced repetition: the scheduler](#11-spaced-repetition-the-scheduler)
12. [The board builder / game analyser](#12-the-board-builder--game-analyser)
13. [Train tab — the four training modes](#13-train-tab--the-four-training-modes)
14. [The daily challenge](#14-the-daily-challenge)
15. [My Lines tab](#15-my-lines-tab)
16. [Explore tab](#16-explore-tab)
17. [My games tab](#17-my-games-tab)
18. [Statistics tab](#18-statistics-tab)
19. [Settings](#19-settings)
20. [Game import, accounts and scouting](#20-game-import-accounts-and-scouting)
21. [Onboarding, gate, survey, feedback, support](#21-onboarding-gate-survey-feedback-support)
22. [Backup, Google Drive, publishing](#22-backup-google-drive-publishing)
23. [Design system, theming and appearance](#23-design-system-theming-and-appearance)
24. [Preference reference (localStorage keys)](#24-preference-reference-localstorage-keys)
25. [Self-tests and runtime verification](#25-self-tests-and-runtime-verification)
26. [Third-party services and offline behaviour](#26-third-party-services-and-offline-behaviour)
27. [Known limits and deliberately deferred work](#27-known-limits-and-deliberately-deferred-work)
28. [Working conventions](#28-working-conventions)

---

## 1. What Obertura is

Obertura is a **personal chess-openings trainer**, built as an installable PWA and
optimised for a phone. Its pitch: *"Learn chess openings your way. Build your own
repertoire, train it, and let spaced repetition help you remember."*

It began as a focused clone of Lotus (openings only) for one user — Marçal, a
designer/WordPress developer who directs the work but does not write code — and has
grown into a broad training app. It is now in a **public beta** behind an invitation
code gate.

- **Live app:** https://marxal.github.io/obertura
- **Landing page:** https://marxal.github.io/obertura/docs/
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

### Non-goals (protected v1 scope)

No backend. No accounts of our own. No paid services without explicit approval. No
service worker / offline mode yet. Everything the user owns lives on their device.

---

## 2. Project status, versioning and history

`ROADMAP.md` is the authoritative, phase-by-phase log. `CLAUDE.md` is the project
guide (behavioural rules for the AI, stack decisions, hard constraints).

### Versioning scheme

The project ran an internal `v1.x` scheme, then renumbered to a **public `v0.x` beta
scheme** in June 2026. Old git tags `v1.0`–`v1.3` are left intact; new releases are
tagged `v0.x`. Conceptual mapping: v1.0→v0.1, v1.1→v0.2, v1.2→v0.2, v1.3→v0.3.

`package.json` version is `0.4.0`. The last cut rollback tag is **`v0.4`**; every
round since has used `v0.4` as its restore point. Note the repo currently has **no
tags present in this working clone** — tags live on the remote.

### Round-by-round history (condensed from ROADMAP.md)

| Round | Theme | Status |
|---|---|---|
| v1.0 | Board on phone → builder → SM-2 training → Stockfish → explanations → Chess.com import | ✅ |
| v1.1 | Design-token theming, tab bar, Today dashboard, offline opening DB, backup/restore, Settings | ✅ |
| v1.2 | Foundations audit, four-tab restructure around training, Explore tab (import/scouting/library/sparring), trimmings (feedback, piece sets, miniatures, full reset) | ✅ |
| v1.3 | Visual language (felt green, four themes), builder truth, Train hub, Explore/scouting depth, build-with-engine, Statistics, onboarding, Settings & release | ✅ |
| v0.4 | Beta polish: onboarding, Explore vs Statistics split, unified builder, ~3× larger opening library, opening traps, import/scouting flow, landing page | ✅ (tag `v0.4`) |
| v0.5 | Card polish, PWA shell fixes, Train redesign, **daily challenge**, Statistics overhaul, forgotten-moves carousel + "Fix it" drill | ✅ |
| v0.6 | **Google Drive cloud backup** + `PUBLISHING.md` publishing guide | ✅ |
| v0.7 | **Mistake retry**: Train 2×2 grid, the mistake scan, the retry drill, daily task four | ✅ |
| v0.8 | General fixes: instant retry answers, faster scans, engine circuit breakers, **full backup (format v2)**, mode identity tints, tag reuse | ✅ |
| v0.9 | Retry analysis & organisation: live Lichess status, scan reuses saved analyses, auto-stored reviews, latest-mistakes carousel, collapsible train list, compact grouping, puzzles→analyser, daily puzzle ladder, stats carousels | ✅ |
| v0.10 | **End game module**: endgame puzzles (own rating ladder) + classic endgames vs tablebase | ✅ |
| v0.11 | **Learn** surfaces: YouTube video cards in builder/analyser and Explore → Learn, one shared API key | ✅ |
| v0.12 | Statistics & fixes: your site rating + charts, one shared chart engine, record strip, endgames region, slimmed Settings, wider endgame scan | ✅ |
| v0.13 | **Circle-graph statistics**: donut engine, move memory ring, games × memory cards, sliding carousels | ✅ |
| v0.14 | Memory-join fixes (`familyKey`), card spacing, collapsed accordion, "Engine always on" pref | ✅ |
| v0.15 | Faster/deeper reviews: cloud miss-streak cutoff, opt-in chess-api.com deep tier | ✅ |
| v0.16 | **Engine un-sticking** (4 hang fixes), **Lichess studies in Packs**, study-parser robustness, scannable Packs layout | ✅ |
| v1.4 / Later | Parked: 4th theme, map transpositions, true background sync, deeper engine adaptation, offline SW, automatic two-device sync, monetization build-out | 💤 |

---

## 3. Tech stack, hard constraints and philosophy

### Stack

| Layer | Choice |
|---|---|
| Build tool | **Vite 5**, `base: '/obertura/'` |
| Language | **TypeScript 5.4**, `strict: true`, `noEmit` (tsc is a type-check gate; Vite bundles) |
| Framework | **None** — vanilla TS with direct DOM construction |
| Board UI | **chessground 9** (Lichess's board) |
| Chess rules / SAN / PGN | **chess.js 1.3** |
| Engine | **stockfish 18 lite (single-threaded WASM)**, in a Web Worker |
| OAuth (Lichess) | `@bity/oauth2-auth-code-pkce` |
| Storage | **IndexedDB** (repertoire, games, opponents) + **localStorage** (prefs, stats, streaks, logs) |
| Hosting | **GitHub Pages** via GitHub Actions |
| Fonts | Google Fonts *Silkscreen* — wordmark only |

There are exactly **four runtime dependencies** and **two dev dependencies**. No CSS
framework, no icon package (icons are inlined SVG in `src/icons.ts`), no chart library
(charts are hand-rolled inline SVG in `src/stats-charts.ts`), no test framework
(self-tests are plain functions returning result arrays).

### Hard constraints

- **No backend, ever.** Every network call goes to a free, public, CORS-enabled
  third-party API, anonymously where possible.
- **Data lives on the device.** Google Drive backup is the only "leaves the device"
  path, and it writes to the app's hidden `appDataFolder` which the user's real Drive
  never shows.
- **Must install as a PWA on Android** (manifest + add-to-home-screen).
- **Online-only is fine.** A service worker / offline mode is explicitly deferred.
- **Keep files small and focused** — this keeps context/token cost low for AI work.
- **Never reach for a paid service without flagging it first.**

### Code philosophy visible throughout

- **Pure cores, self-tested.** Anything that can be logic-without-DOM is split into a
  pure module with a matching `*.selftest.ts` (scheduler, winprob, review grading,
  accuracy, stats, analysis, scout, traps, puzzles, mistake-scan, endgame-*, study-*).
- **Fail soft, always.** Every network client returns `null` on any failure and the UI
  degrades to a link/offline state rather than showing an error.
- **Long explanatory header comments.** Nearly every file opens with a multi-paragraph
  comment explaining *why* the module exists and what the tricky parts are. These are
  the best documentation in the repo and should be maintained.
- **No migrations.** Old data loads as-is; new optional fields are simply absent on old
  records.

---

## 4. Repository layout — every file

```
/                          root
├── CLAUDE.md              project guide for Claude Code (behaviour + stack + constraints)
├── ROADMAP.md             phase-by-phase log of every round (the source of truth)
├── README.md              public readme (features, stack, licences, deploy)
├── AUDIT.md               v1.2 read-only code audit + what was fixed
├── BACKNAV-DIAGNOSIS.md   v1.3 investigation into the dead back gesture in training
├── BETA-ACCESS.md         owner notes: rotating the beta access codes
├── DRIVE-SETUP.md         click-by-click Google OAuth client-ID setup
├── PUBLISHING.md          store/monetization options analysis + Play checklist
├── Obertura_Style_Guide.html  standalone visual style guide
├── APP-CONTEXT.md         ← this file
├── index.html             the app shell (header, views, tab bar, pre-paint theme script)
├── vite.config.ts         base path + __APP_NAME__/__APP_VERSION__ defines
├── tsconfig.json          ES2020, strict, bundler resolution, resolveJsonModule
├── package.json           deps + the npm scripts
├── .github/workflows/deploy.yml   build → copy /docs → upload → Pages
├── .claude/skills/verify/SKILL.md  repo skill: build + drive the app headlessly
├── docs/                  the public landing page (index.html + screenshots + icon)
├── public/
│   ├── manifest.webmanifest
│   ├── icons/             192 / 512 / 512-maskable / master
│   ├── boards/            board textures: blue-marble.jpg, newspaper.svg, olive.jpg,
│   │                      purple-diag.png, wood4.jpg
│   └── engine/            (gitignored) stockfish.js + stockfish.wasm, copied at build
├── scripts/               offline data generators + tooling (see §5)
└── src/                   the app (≈180 modules, ~48k lines of TS + 13k lines of CSS)
```

### `src/` by area

#### App shell & navigation
| File | Role |
|---|---|
| `main.ts` (3441) | The router and the builder/analyser controller. Owns `showView`, the chessground instance, the carousel, the save flow, the leave guards, the FAB wiring, boot sequence. |
| `back-nav.ts` | Android back-gesture trapping: one spare history entry, a dismissible-layer stack (`pushBack`) plus a view-level fallback (`setViewBack`). |
| `theme.ts` | Five theme choices → `<html data-theme>`; migrates pre-v1.3 values. |
| `appearance.ts` | Board colour (9 options), piece set (10 sets, lazily imported CSS), coordinates toggle. |
| `style.css` (13218) | The whole design system: tokens, four themes, every component. |
| `icons.ts` | Inlined Lucide-style SVG icons + move-class colours/labels/board badges. |
| `fab.ts` | Floating action button + speed-dial, rebuilt on every open. |
| `toast.ts`, `dialog.ts`, `empty-state.ts`, `load-error.ts` | Shared UI primitives. |
| `confetti.ts`, `count-up.ts`, `pixel-pawn.ts` | Celebration/motion helpers (all honour `prefers-reduced-motion`). |

#### Data & storage
| File | Role |
|---|---|
| `types.ts` | The `Line` interface. |
| `tree.ts` | The live move tree: `MoveNode`, cursor, `single` vs `variations` mode, serialise/load. |
| `storage.ts` | IndexedDB wrapper (3 stores), backup export/parse/restore, reset progress, erase everything, change notifier. |
| `prefs.ts` | Device-local training/view prefs. |
| `streak.ts` | Daily streak, per-day review log, reviewed-today counter. |
| `forgotten-moves.ts` | Per-move miss tally by day/week/all-time. |
| `puzzle-log.ts`, `puzzle-rating.ts`, `puzzle-repeat.ts` | Puzzle history, Elo rating (scoped), repeat ladder. |
| `endgame-progress.ts` | Classic-endgame solve records. |
| `brilliant-log.ts` | Resurface ladder for the brilliant-moves exercise. |
| `video-lib.ts` | Hidden / favourite / seen YouTube shelves. |

#### Chess logic & analysis
| File | Role |
|---|---|
| `engine.ts` (883) | The eval stack: Lichess cloud client (+ circuit breaker, health), the Stockfish `Engine` class with watchdog/boot/recovery, `analysePosition`, `resolveUci`, `gameOverResult`. |
| `remote-engine.ts` | Opt-in chess-api.com depth-18 tier with its own breaker. |
| `winprob.ts` | Pure move classification (`MoveClass`, thresholds, `cpToWin`). |
| `review.ts` | Game Review orchestrator: per-node grading, cloud→remote→local tiering, cache, miss-streak cutoff, abort, progress. |
| `move-facts.ts` | SEE-based board facts (forced? recapture? sacrifice? free capture?). |
| `accuracy.ts` | Lichess accuracy model (volatility-weighted + harmonic mean). |
| `book-check.ts`, `book-tree.ts`, `book-lines.ts` | "Is this book?", the SAN trie, and opening seeds for sparring. |
| `openings.ts` | Offline opening naming by EPD key; `isOutOfBook`. |
| `explorer-stats.ts`, `lichess-explorer.ts` | Bundled W/D/L stats + the live Lichess explorer. |
| `lichess-tablebase.ts` | 7-piece tablebase ground truth for endgames. |
| `scheduler.ts` | SM-2 + due/bucket/confidence helpers. |
| `session.ts` | The training-session queue. |
| `individual.ts` | Which single positions to drill (due ∪ weak, from move 3+). |
| `notation.ts` | SAN vs figurine formatting, applied everywhere via `formatMove`. |
| `card-position.ts`, `board-mini.ts`, `board-brushes.ts`, `promotion.ts` | Position-card scaffold, SVG miniatures, collision-proof arrow brushes, promotion picker. |

#### Screens
`train-screen.ts`, `lines-screen.ts`, `explore-screen.ts`, `my-games-screen.ts`,
`progress-screen.ts` (Statistics), `settings-screen.ts`, `puzzles-screen.ts`,
`mistakes-screen.ts`, `endgame-screen.ts`.

#### Overlays / runners
`drill.ts` (line + positions + timed drills), `pretraining.ts`, `fix-it.ts`,
`puzzle-run.ts`, `mistake-run.ts`, `brilliant-run.ts`, `endgame-playout.ts`,
`spar.ts`, `explore.ts` (line explorer), `library.ts`, `library-explorer.ts`,
`board-explorer.ts`, `repertoire-map.ts`.

#### Import & scouting
`import-core.ts`, `import-games.ts`, `import-panel.ts`, `import-progress.ts`,
`import-last.ts`, `chesscom.ts`, `lichess.ts`, `lichess-auth.ts`, `manual-game.ts`,
`auto-refresh.ts`, `scout.ts`, `move-stats.ts`, `wdl-bar.ts`.

#### Content & catalogues
`starter-packs.json` + `onboarding-starter.ts`, `traps.json` + `traps.ts` +
`traps-screen.ts`, `study-index.json` + `study-catalog.ts` + `study-browser.ts` +
`study-import.ts` + `study-sheet.ts`, `endgames.json` + `endgame-catalog.ts`,
`puzzle-themes.ts`, `puzzle-openings.json`, `content-curated.json` +
`content-explore.ts` + `content-panel.ts` + `content-ui.ts` + `youtube.ts`,
`video-lib.ts`.

#### Statistics & analysis reporting
`stats.ts`, `stats-charts.ts`, `analysis.ts`, `progress.ts`, `rating-stats.ts`,
`line-analysis.ts`, `line-groups.ts`, `filters.ts`.

#### Meta / product
`onboarding.ts` (intro), `onboarding-wizard.ts` (setup), `gate.ts` (beta code),
`survey.ts`, `feedback.ts`, `support.ts`, `about.ts`, `backup.ts`,
`drive-backup.ts`, `selftest-panel.ts`, `avatar.ts`, `sound.ts`.

#### Bundled data (all lazy-loaded except `openings-data.json`)
| File | Size | Contents |
|---|---|---|
| `openings-data.json` | 1.3 MB | `{ epd: "Opening Name" }` — ~every named opening position |
| `openings-library.json` | 1.7 MB | `[{ eco, name, moves[] }]` — ~3,700 named openings as SAN lines |
| `explorer-stats.json` | 4 KB | Bundled W/D/L per EPD (currently `{}` — regenerate with the script) |
| `starter-packs.json` | 64 KB | Six curated repertoire packs with annotated lines + plans |
| `traps.json` | 12 KB | Curated opening traps (bait + idea + SAN/UCI) |
| `study-index.json` | 60 KB | ~250 most-liked Lichess studies per opening family |
| `endgames.json` | 8 KB | Classic-endgame catalogue (FEN, goal, category, level, idea) |
| `puzzle-openings.json` | 4 KB | Lichess opening "angle" keys that have puzzle sets |
| `content-curated.json` | 4 KB | Hand-pinned YouTube videos per opening family |

---

## 5. Build, scripts and deployment

### npm scripts

```jsonc
"dev":                  "node scripts/copy-engine.mjs && vite"
"build":                "node scripts/copy-engine.mjs && tsc && vite build"
"selftest":             "node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/run-selftests.ts"
"preview":              "vite preview"
"generate-icons":       "node scripts/generate-icons.mjs"
"build-openings":       "node scripts/build-openings.mjs"          // lichess-org/chess-openings (CC0) → openings-data + openings-library
"build-explorer-stats": "node scripts/build-explorer-stats.mjs"    // Lichess explorer → explorer-stats.json
"build-starter-packs":  "node scripts/build-starter-packs.mjs"     // assembles the six packs from scripts/starter-packs/*.mjs
"build-study-index":    "node scripts/build-study-index.mjs"        // most-liked studies per family; probes PGN export, drops locked studies
"build-traps":          "node scripts/build-traps.mjs"              // curated traps → traps.json
"build-traps-lichess":  "node scripts/build-traps-from-lichess.mjs"
"build-puzzle-openings":"node scripts/build-puzzle-openings.mjs"    // probes which angles Lichess has puzzles for
```

`scripts/copy-engine.mjs` copies `stockfish-18-lite-single.{js,wasm}` from
`node_modules/stockfish/bin` into `public/engine/` (gitignored). `scripts/ts-resolve.mjs`
and `scripts/register-ts.mjs` let Node run the TS self-tests with extensionless imports.

### Deployment (`.github/workflows/deploy.yml`)

Triggers on push to `main` (or manual dispatch). Steps: checkout → Node 20 with npm
cache → `npm ci` → generate icons → `npm run build` → `cp -r docs dist/docs` → PATCH
the Pages API to force `build_type: workflow` (so Jekyll never overwrites the deploy)
→ `configure-pages` → upload `dist` → `deploy-pages`.

Result: the app at `…/obertura/` and the landing page at `…/obertura/docs/`.

### Cache strategy without a service worker

`index.html` sends `Cache-Control: no-cache, no-store, must-revalidate` plus `Pragma`
and `Expires` meta tags, so every open re-fetches the shell, which always points at
the newest hashed Vite bundles. Tapping the "Obertura" wordmark in the header reloads
the app — the quick way to pull a fresh deploy.

---

## 6. App shell, navigation and back handling

### The shell (`index.html`)

- A **pre-paint inline script** reads `obertura-theme` and `obertura.boardColour` from
  localStorage and sets `data-theme` / `data-board` on `<html>` before first paint, so
  there is no flash of the wrong theme. It mirrors `theme.ts` including the pre-v1.3
  migration — **keep the two in sync**.
- A **boot splash** (`#app-splash`, the app icon) covers the first paint and is removed
  by `hideAppSplashWhenReady()` once `getAllLines()` resolves (3 s safety net).
- **Header**: back arrow (full screens) / wordmark / settings-avatar button / Save
  button (builder only).
- **Views** are sibling `<div>`s toggled with `hidden`: `view-builder`, `view-lines`,
  `view-explore`, `view-games`, `view-train`, `view-progress`, `view-settings`.
- **Bottom tab bar**: Train · My Lines · Explore · My games · Statistics.

### Routing (`main.ts`)

`type ViewName = 'train' | 'lines' | 'explore' | 'games' | 'progress' | 'builder' | 'settings'`.

`showView(view)` is the single entry point. It:
- resumes or discards a **suspended training session** (a drill that handed off to the
  analyser — landing on Train resumes it, anywhere else discards it),
- remembers `returnView` when entering a `BACK_VIEWS` full screen (`builder`, `settings`),
- toggles view visibility, swaps the tab bar for the back arrow, hides the FAB,
- renders the destination screen with its dependency object,
- for the builder: restores the carousel slide, applies `pendingEngineOn` /
  "Engine always on", resets the sheet to `default`, and re-lays out after a frame.

`train` is both the start view and the back-navigation root.

### Back handling (`back-nav.ts`)

Android PWAs boot with one history entry, so a back press closes the app. The fix keeps
exactly one spare "buffer" entry armed. A press consumes it, fires `popstate`, and the
handler performs **one** step of in-app back before re-arming. Two kinds of back, in
order:

1. **Dismissible layers** — every sheet, dialog, overlay, drill and explorer registers
   itself with `pushBack(close)` and gets a remover back.
2. **View-level fallback** — `setViewBack(fn)` in `main.ts`: full screens return to
   `returnView`; any other tab returns to Train; Train with nothing open lets the press
   through so the app closes.

The builder additionally arms **its own** back layer while it is on screen
(`armBuilderBack`), so the unsaved-work guard fires on a gesture exactly as it does on
the back arrow. `BACKNAV-DIAGNOSIS.md` documents the historical z-index bug where the
guard dialog rendered *under* the drill overlay.

---

## 7. Data model

### `Line` (`src/types.ts`) — one saved opening line

```ts
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
}
```

### `MoveNode` (`src/tree.ts`) — one ply in a tree

```ts
interface MoveNode {
  id: string;                 // 'root' | 'n1', 'n2', …
  san: string; uci: string; fen: string;
  children: MoveNode[];       // children[0] is the main line
  note?: string;              // manual per-move reminder
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
  id, url, endTime;                 // endTime = unix seconds
  platform?: 'chesscom' | 'lichess';   // absent for manually-added games
  timeClass: 'bullet'|'blitz'|'rapid'|'daily'; timeControl; rated;
  colour: 'white' | 'black';        // which side YOU played
  result: 'win' | 'loss' | 'draw';  // YOUR perspective
  opponent; opponentRating?; myRating?;
  eco: string | null; opening: string | null;
  sans: string[]; ucis: string[]; plyCount: number;
  tags?: string[];                  // user tags, saved by "Save game"
  analysis?: GameAnalysis;          // { tree, engine, reviewedAt }
  retry?: GameRetry;                // mistake-scan spots + engine top-3
  endgame?: GameEndgame;            // endgame-scan result
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
Hard cap of `MAX_OPPONENTS = 10`. Maps open at 10 plies and "Go deeper" steps 10 at a
time up to 60 (`OPENING_PLIES`).

### `BackupFile` (`src/storage.ts`) — format v2

```ts
{ format: 'obertura-backup', version: 2, exportedAt,
  lines: Line[], games?: ImportedGame[], local?: Record<string,string> }
```
`local` is a snapshot of every `obertura*` localStorage key plus `engineEnabled` /
`sparEngineEnabled`, excluding `obertura.drive.*` and `obertura.lichessReturnTo`
(device/session specific). v1 files (lines only) still restore. **Scouted opponents are
deliberately excluded** — pure re-fetchable cache and by far the bulkiest data.

---

## 8. Storage layer

`src/storage.ts` wraps IndexedDB requests in Promises. Database `obertura`, **version 3**:

| Store | Key | Indexes | Contents |
|---|---|---|---|
| `lines` | `id` | — | Every saved `Line` |
| `games` | `id` | `endTime` | Every `ImportedGame` |
| `opponents` | `id` | — | Every scouted `Opponent` (self-contained) |

Notable behaviours:

- The **connection promise** is cached (not the `IDBDatabase`), so a reload rebuilds it
  cleanly.
- `onblocked` rejects with *"Another tab has Obertura open. Close it and reload."* —
  without this a version bump would hang every data screen on "Loading…" forever.
- A **change notifier** (`onLinesChanged`) fires after every repertoire write; the Drive
  auto-backup subscribes to it. `eraseAllData` deliberately does **not** notify, so an
  erase can't auto-upload an empty repertoire over the cloud copy.
- `resetAllProgress()` strips every `review` block and resets confidence/lastTrained,
  keeping the lines themselves ("forget my scores", not "delete my work").
- `eraseAllData()` clears all three stores in one transaction; the Settings dialog adds
  the two-step confirm, the "back up first" offer, and the localStorage wipe.
- Multi-write helpers issue all `put`s synchronously and await the *transaction*
  (`txnDone`) rather than individual requests, so IndexedDB can't auto-commit early.

Every data screen wraps its load in try/catch and renders `load-error.ts` (a message +
Retry) instead of hanging.

---

## 9. The chess engines and analysis stack

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
  a cooldown (90 s after a rate limit). Without it a throttled connection burned a fetch
  timeout on *every* position. `cloudHealth()` returns `'untested' | 'ok' | 'limited' |
  'down'`; the scan overlay shows it live (green/amber/red), and the docked eval bar
  swaps its source badge for a tappable "Lichess off" retry.
- **Cloud fetch timeout**: 2.5 s (tightened from 4 s).
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

### Move classification (`winprob.ts` — pure, self-tested)

Grades are computed on **expected points (win%)**, not raw centipawns, so a 100 cp swing
near equality costs far more than the same swing in a won game.

```
cpToWin(cp) = 1 / (1 + e^(-0.00368208·cp))     // Lichess's fit
```

`MoveClass = brilliant | great | best | excellent | good | book | inaccuracy | mistake | blunder`

Thresholds (win-probability drop vs the best move):

| Class | Rule |
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
the "analysed with…" tag.

`gradeNode` is exported separately so **live analysis** can grade one freshly-played
move without re-walking the line.

### Accuracy (`accuracy.ts`)

Implements Lichess's published model per move, then aggregates per colour as the average
of a **volatility-weighted mean** (sharp phases weigh more) and a **harmonic mean** (one
blunder can't hide behind many easy moves). Pure arithmetic over the reviewer's stored
evals — no network, no chess.js.

---

## 10. Opening knowledge: naming, book, library, explorer stats

### Naming (`openings.ts`)

`openings-data.json` maps **EPD keys** (the first four FEN fields — board, side to move,
castling, en-passant) to opening names, generated by `scripts/build-openings.mjs` from
the CC0 `lichess-org/chess-openings` dataset. A lookup is a plain object access:
instant, offline, no API and no token.

- `nameForFen(fen)` — exact match.
- `nameForPath(fens)` — the **deepest** named position along a path (this is what the
  builder title shows and what Save auto-fills).
- `openingForPath(fens)` — name plus the ply it was reached at.
- `isOutOfBook(fens)` with `BOOK_GAP_TOLERANCE = 3` — used by the spar screen's
  "out of book" banner.

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
  (`lichess` = every rated game; `masters` = OTB titled games). Used by the builder's
  Library slide for W/D/L bars and for continuations once the bundled book runs out.
  Choice persists under `obertura.explorerDb`.

---

## 11. Spaced repetition: the scheduler

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
due = now + interval days
```

### What gets scheduled

Only **the user's own moves** — `userMoveNodes(tree, colour)` filters the mainline by
parity (White = even plies, Black = odd). Opponent replies are auto-played and never
tested. A move with no `review` block counts as due, so a never-trained line is always
a due line.

### Derived signals

| Helper | Meaning |
|---|---|
| `lineIsDue` / `dueLines` | any due user-move |
| `nextDue(line)` | soonest due across the line's user-moves |
| `lineBucket` | `due` \| `learning` \| `solid` — `solid` requires every move's interval ≥ `SETTLED_INTERVAL_DAYS = 21` |
| `lineConfidence` | 0–5: average of `min(5, reps)` across user-moves, rounded |
| `lineMissCount` | total lapses — the "weakest" signal |
| `recentlyAddedLines` / `weakestLines` | the session-picker orderings |
| `describeDue` | "New" / "Due now" / "Due tomorrow" / "Due in N days" |

---

## 12. The board builder / game analyser

One screen (`#view-builder`), two modes, both driven by `main.ts`.

| | **Builder** (`builderMode = 'builder'`) | **Analyser** (`'analyser'`) |
|---|---|---|
| Subject | A repertoire `Line` | An `ImportedGame` |
| Tree mode | `single` (edits truncate) | `variations` (deviations become branches) |
| Save button | "Save line" / "Save changes" | "Save game" (greys out until *your* edits exist) |
| First tab | "Line" | "Game" |
| Extra actions | rename, training toggle, delete line | "Analyse game", "Save line" (extract current path), delete game |
| Title row | opening name + colour pip | hidden — "vs <opponent> (rating) · date" + platform link |

### Layout

```
┌─────────────────────────────┐
│ board-wrap  (fixed square)  │   ← chessground; tap here (in full) to collapse the sheet
├─────────────────────────────┤
│ builder-sheet               │   ← draggable Google-Maps-style panel
│  ├ panel handle (drag/tap)  │
│  ├ slide tabs               │   Line/Game · Library · My lines · Learn · Scouting
│  └ builder-carousel         │   horizontally paged slides
├─────────────────────────────┤
│ builder-dock                │
│  ├ builder-eval (animated)  │   ← the docked eval bar, height-animated open/closed
│  └ builder-bar              │   Flip · Engine │ Watch · ◀ · ▶
└─────────────────────────────┘
```

**The sheet** snaps between `default` (board fully visible) and `full` (~15 % of the
board peeking, `SHEET_PEEK = 0.15`). Its *height* changes; the board stays put behind
it. It can be dragged by the handle, by the tab strip (vertical swipes only — taps and
horizontal scroll pass through), or by over-scrolling the slide content (only once the
list is fully scrolled and you keep pulling).

**The eval dock** animates its own height and hands the sheet its final layout in the
same beat (`animateEvalDock`), so the whole dock grows/shrinks smoothly instead of
shoving everything up instantly.

### The five carousel slides

| # | Tab | Contents |
|---|---|---|
| 0 | **Line** / **Game** | Title + tags + note controls, the move list, the analysis block (analyser), training toggle, delete |
| 1 | **Library** | What the bundled book plays next from here — move, opening reached, count of named openings down that branch, plus live Lichess W/D/L bars and deeper online continuations once the book runs out |
| 2 | **My lines** | Two stacked sections, each with a "Show tree" link: *My saved lines* (what your repertoire plays from here) and *My games* (what you actually played, with W/D/L) |
| 3 | **Learn** | YouTube video cards for the opening on the board, searched colour-aware ("… for white/black"), plus hand-curated pins |
| 4 | **Scouting** | Scouted opponents' continuations from here; hideable in Settings — **must stay last**, the scroll→index maths only tolerates hiding the final slide |

### The move list

Rendered into three mirrored mounts (`move-list`, `move-list-library`,
`move-list-games`). PGN-style: the main line inline, sibling branches as parenthesised
`(…)` variations, recursively. Each move span carries its classification colour tint
(no glyph — icons made the strip read too far apart), its annotation chip, and a note
dot. The active move is kept centred by adjusting the strip's own `scrollLeft` (not
`scrollIntoView`, which dragged the carousel back to the Line tab).

### Board overlays

`refreshBoardShapes()` paints **one** `setAutoShapes` pass combining:
1. the active move's grade badge (a `customSvg` disc above the piece) plus a square
   wash below the piece via chessground custom highlights, and
2. the engine's top-3 candidate arrows (`eng1`/`eng2`/`eng3` brushes, decreasing
   opacity), only when the result's FEN matches the live position.

Doing these in separate calls made the last one wipe the other.

### The engine toggle

The dock's engine icon is the single on/off switch. On → the eval bar slides open with
the top-3 moves and arrows, **and live analysis is switched on** so moves you play get
graded (it never bulk-analyses an existing game — that's the Game tab's "Analyse game").
It starts OFF each session unless Settings → "Engine always on" is set, or a hand-off
requested it (`pendingEngineOn`).

### Save flow (three sequential nudges)

`saveCurrentLine()` →
- **Editing an existing, dirty line?** → "Update this line" / "Save as new line" / Cancel.
- **1. Partial save** — the cursor sits before the line's end → "Save up to this move" /
  "Save the whole line" / Cancel.
- **2. End-on-move** — the line ends on the opponent's move → "Trim last move" / "Keep
  as is" / Cancel. (You drill *your* moves, so a line should finish on one.)
- **3. Long line** — more than `LONG_LINE_PLIES = 40` plies → "Save anyway" / "Go back
  to edit".
- Then persist, toast, and (if not already enrolled) offer **"Start training this
  line?"** — the primary action is a confirm run or an instant enrol depending on the
  `confirmRunBeforeTraining` pref.

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

## 13. Train tab — the four training modes

The Train screen is a **2×2 grid** of chunky mode tabs, each with an icon tile and its
own accent colour that washes the pane background (`--train-accent`) and tints the
overlays:

| Tab | Icon | Accent | Pane |
|---|---|---|---|
| **Openings** | pawn | app green | `train-screen.ts` |
| **Puzzles** | puzzle piece | `#c4741d` warm orange | `puzzles-screen.ts` |
| **Middle game** (mistake retry) | swords | `#a3492e` ember | `mistakes-screen.ts` |
| **End game** | flag | `#33677a` deep teal | `endgame-screen.ts` |

The **daily challenge card** sits above the tabs — it spans all four modes.

### 13.1 Openings (`train-screen.ts`, `drill.ts`, `session.ts`)

**First-run gate**: until `ONBOARDING_GOAL = 5` lines are in training (and the
`onboardingComplete` flag has never been set), the pane shows the starter onboarding
flow instead of the hub.

**The hub**, top to bottom:
1. A compact two-stat hero (due / reviewed / rounds) — hidden entirely when nothing is due.
2. **Practise** — the mode cards:
   - **Time attack** (leads the list) — 1 / 3 / 5-minute countdowns over single
     positions, each with its own personal best. `MODE_ACCENT.timed` gold.
   - **Review missed moves** — single moves you've missed (terracotta).
   - **Drill new lines** — full runs, newest first (green).
   - **Target weak areas** — full runs, most-lapsed first (plum).
   - **Prep** — opponent-tagged lines, only shown when any exist (teal).
3. **Lines in training** — a collapsible card (always loads collapsed) with the shared
   two-row filter bar; grouped views carry a per-branch pause control.
4. **Forgotten-moves carousel** — a swipeable board per time window (Today / This week /
   All time) fed by the device-local miss log, each with an arrow on the move, the move,
   its opening, the miss count, and a **Fix it** button.

**The drill runtime** (`drill.ts`) serves three shapes through one runner:
- `startDrill(line)` — walk a whole line: auto-play the opponent, quiz every user move
  in order, board stays continuous.
- `startPositionsDrill(positions)` — a stream of single positions; correct → jump on.
  Optionally animates the opponent's previous move in (`playPrelude`).
- `startTimedDrill(positions, { timedMs })` — a countdown; correct scores, wrong flashes
  and skips immediately, the pool reshuffles until the clock expires.

Key `DrillOptions`: `watchFirstMs` (auto-play the line once before asking — the
watch-then-play warm-up, and it shows each move's note as it plays), `wrongMoveMode`
(`gentle` for pre-training vs `full` = flash → snap back → retries → draw the arrow →
require the correct replay), `checkAlternative` (the engine checks whether a "wrong"
move is actually a good alternative before penalising it), `onExplore` (opens the line
explorer at the position after the played move, drill intact underneath),
`confirmAbandon`, `sessionProgress`, and the in-session controls `onPauseLine` /
`onEditLine` / `onNoteEdit`.

Retries before the arrow is revealed: `getRetriesBeforeReveal()` — 0 / 1 (default) / 2.

**Sessions** run in **rounds** so progress banks mid-sitting. Finish screens are playful
(pixel pawn, confetti) and list the **openings reviewed** with correct/incorrect counts.

**Pre-training** (`pretraining.ts`) — with `confirmRunBeforeTraining` ON (default),
adding a line first plays it through once, then has you play it; a clean run enrols it.
OFF enrols instantly (`enrolLineDirectly`).

**Fix it** (`fix-it.ts`) — the playful repeat drill: load the board → animate the
opponent's move in → you play the move → celebrate → fade the board and show the move in
big written notation → fade back. **Three reps**, then "now play the full line" chains
into the full line when the move belongs to one.

### 13.2 Puzzles (`puzzles-screen.ts`, `puzzle-run.ts`, `puzzles.ts`)

Lichess puzzles, fetched **anonymously** from `GET /api/puzzle/next?angle=&difficulty=&color=`.
(Adding the Bearer token makes it a non-simple CORS request Lichess's puzzle endpoint
won't preflight from a browser, so the fetch throws — repeat-avoidance is handled
locally instead via `puzzle-log`'s seen-id ring.) The **dashboard** (`/api/puzzle/dashboard/{days}`)
does need the token.

Three modes:
- **Daily Rated Mix** — the flagship, fronted by a "today" hero. Mixed puzzles from your
  repertoire *and* your games, a 10-puzzle run. **The only rated mode.**
- **Time Attack** — 3 / 5 / 10 min, 3-mistake cap, ramping difficulty. Two sources
  ("From My Openings" and "Satisfying Traps" = the Lichess `opening` theme), each with
  per-length records. Casual.
- **Practice by theme** — an accordion over `puzzle-themes.ts` (Lichess theme ids:
  mateInX, the named mating patterns, tactical motifs, length and goal buckets). Its
  first accordion is **"Your openings"** with two tabs: *Based on my repertoire* /
  *Based on my games*.

Openings resolve to Lichess "angle" keys; only angles present in `puzzle-openings.json`
are offered so a run never starves.

**Rating** (`puzzle-rating.ts`) — plain Elo against the puzzle's own Lichess rating. You
"win" by solving on the first try with no hint. It carries a `scope`, so **endgame
puzzles ride a separate ladder** from openings puzzles.

**Repeats** (`puzzle-repeat.ts`) — spaced-repetition-lite that deliberately brings
puzzles *back*: a miss queues the puzzle due immediately; a clean solve pushes it out
along 1 → 3 → 7 → 14 days, then it graduates. The whole puzzle is stored so a repeat
replays without re-fetching.

After a puzzle, a discrete **"Analyse position"** opens the game + solution in the
analyser on the Engine view at the puzzle position, with the "Back to train" hand-off.

Daily puzzles run **easy → medium → hard** (one Lichess difficulty band below / at /
above your rating's band).

### 13.3 Middle game / Mistake retry (`mistakes-screen.ts`, `mistake-scan.ts`, `mistake-run.ts`)

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

**The drill** — sessions of 5. The position as you had it, your actual move as a **red
arrow** (with a discrete per-position eye toggle to hide it) and a one-line story:
*"You played ♞f6 ?? here and blundered."* with the played move on a red chip carrying
its ?? / ? symbol. Answers are judged **instantly** against the stored top-3 (any of the
three counts; a non-#1 gets *"Good move ✓ — even stronger: ♞f3"* with the #1 drawn as an
orange arrow). Two post-answer actions only: **Analyse** (opens the game in the analyser
at the drilled position, suspending the session) and **Next position**. Badge + confetti
on a clean find; results rows are tappable to pop the position up.

The pane also carries a **latest-mistakes carousel** (four icon-only category tabs, the
newest unfixed spot per category, "Fix it" drills exactly that position).

**Brilliant moves** (`brilliant.ts`, `brilliant-run.ts`, `brilliant-log.ts`) is the
mirror image: where the scan finds where your games went *wrong*, this reads the
brilliant (!!) and great (!) moves *you* played straight off a game's saved analysis —
no engine, no network. Judging is instant and local (the played move's UCI is the one
right answer). A game containing your own brilliant move is auto-tagged `brilliant`.
Clean re-finds are suppressed along a 2 → 5 → 12 → 30-day ladder.

### 13.4 End game (`endgame-screen.ts`)

Three pillars:

1. **Endgame puzzles** — rated Lichess puzzles filtered to endgame themes
   (`endgame`, `rookEndgame`, `pawnEndgame`, `queenEndgame`,
   `bishopEndgame`/`knightEndgame`), reusing the whole puzzle engine but on their **own
   rating ladder**. A wide "all endgames" button plus piece-symbol shortcuts.
2. **Classic endgames** (`endgame-catalog.ts` + `endgames.json` + `endgame-playout.ts`)
   — a curated list of fundamentals grouped by category (`mates`, `pawn`, `rook`,
   `queen`, `minor`) and level (`essential`, `intermediate`, `advanced`), each ≤7 pieces.
   You play it out against the engine, and the **Lichess 7-piece tablebase is the
   ground-truth judge**: it reads the position's true result up front (your target),
   *refuses* any move that throws it, and feeds the engine the tablebase-optimal defence
   so the technique is really tested. Progress is ticked per position with a best time,
   making the list a beat-the-clock ladder.
3. **From your games** (`endgame-scan.ts`) — endgames you actually reached. The scan
   finds the first endgame position (`SCAN_MAX_PIECES = 10`) on *your* move, then asks a
   judge what result was available: ≤7 pieces → tablebase (exact); 8–10 → the local
   engine with conservative thresholds, falling back to the first ≤7-piece position and
   the tablebase when unclear. Only positions you could have **won or drawn** are kept.

Everything **fails soft**: the tablebase host is blocked by the build/preview container
and can be offline on a phone, so when unreachable you simply play it out and the final
result is judged locally.

---

## 14. The daily challenge

`src/daily-challenge.ts` — the dynamic card at the top of Train. Device-local state
(localStorage), reset each calendar day, mirroring `streak.ts`.

Five configurable tasks (`DailyTaskId`), each with an on/off and a count (default 3,
range in `DAILY_COUNT_RANGE`), configured in Settings → Daily challenge:

| Task | What it runs |
|---|---|
| `lines` | N lines to remember (due-first, topped up) |
| `positions` | N single due positions |
| `puzzles` | N rated puzzles (Daily Rated Mix engine), easy → medium → hard |
| `endgames` | N rated endgame puzzles |
| `mistakes` | N mixed mistake spots (only once spots exist) |

`activeDailyTasks(config, avail)` filters by what's actually runnable now. Every task's
success screen leads with **"Next task →"** (resolved at click time, and only offered
when another active task would still be open), so the whole daily runs in one sitting;
"Close session" sits beneath. Once everything's done the card shrinks to a quiet
"done — keep training ✓" line. The streak sits alongside.

---

## 15. My Lines tab

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
- Per card: edit pencil in the title row, training on/off switch and delete on the
  training row, plus "Add to training" when not enrolled.
- `focusSavedLine(id)` highlights a just-saved line when the app routes here.
- **Performance**: `analyseGames`/`countGamesPerLine` are memoised against the exact
  games+lines arrays a render pass was handed, so a sort toggle reuses the cached result
  while a fresh fetch busts it.
- Empty state offers a starter-pack picker.

---

## 16. Explore tab

`src/explore-screen.ts` — four pillars in a **2×2 grid** of buttons.

1. **Recommended** — openings you play often but score poorly in, built from your
   imported games (`analysis.ts`). Each card seeds the builder.
2. **Packs** — the curated library:
   - **Starter packs** (`starter-packs.json`, six packs, built by
     `scripts/build-starter-packs.mjs` from `scripts/starter-packs/*.mjs`) — each a
     collapsed accordion card (colour pip, title, level · style · line count). Line
     cards only render when a pack is opened, which also cuts the tab's initial render
     cost. Lines carry per-move notes and a middlegame **plan** (which rides on the
     final move's note).
   - **Traps** (`traps.json`, `traps-screen.ts`) — famous lines where the opponent walks
     into a tempting losing move. Collapsed into one relevance-sorted "Traps" card. A
     trap's only action is "Build line".
   - **Lichess studies** (`study-browser.ts`, `study-catalog.ts`) — search a **bundled
     index** of ~250 most-liked studies per opening family (Lichess has no CORS-enabled
     study-search API; the index is built offline by `scripts/build-study-index.mjs`,
     which also probes every entry's PGN export and drops author-locked studies), plus
     **"Recommended for your repertoire"** ranked from your saved lines' openings
     (weight 3) and your imported games' openings (weight 1). Importing fetches the
     study live via the CORS-enabled `/api/study/{id}.pgn` and opens the shared chapter
     sheet.
3. **Learn** (`content-explore.ts`) — your saved lines grouped by opening family, each
   card showing name + line count + up to three YouTube miniatures searched from the
   majority colour you play it, with hand-picked pins from `content-curated.json`
   leading. Shelves for favourites and history come from `video-lib.ts`.
4. **Scouting** — scout up to 10 opponents. Tapping one opens a full-screen dossier with
   their most-played openings per colour, W-D-L bars throughout, a **scouting report**
   (weak/strong openings + what to play), and their auto-built opening maps with
   per-move stats and a repeatable "Go deeper". A **Prepare** flow seeds the builder
   with their moves, flipped to your answering colour and stamped with the
   `vs <name>` tag. Hidden entirely when scouting is off in Settings.

Also reachable from Explore: **Engine sparring** (`spar.ts`) — a casual game against the
local Stockfish worker from the start position, handed off to the builder at any point.
It always uses the bundled WASM engine (never the cloud) so it feels instant. A persisted
opening-mode picker (**Surprise me** / **From my games** / **Pure engine**) decides how
the engine opens, backed by `book-lines.ts`. A default-off engine toggle adds the eval
bar and candidate arrows, and a **Suggest** control (Solid · Aggressive · Random,
`chooseSuggestMove`) only ever plays a vetted, non-blundering move.

Two more map/explorer surfaces:
- `repertoire-map.ts` — all lines of one colour merged into a zoomable, arrow-navigable
  tree, with a position preview that slides in on tap.
- `board-explorer.ts` — a chess.com-style playable explorer over a pre-built stats tree
  (an opponent's games, or your own), showing the opening name plus each move played
  from here with its game count and W/D/L bar.

---

## 17. My games tab

`src/my-games-screen.ts`. Mirrors My Lines: an import action on top, the shared filter
bar (colour + group + your tags — sort and Won/Lost/Drew were deliberately dropped), then
a card per game.

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

## 18. Statistics tab

`src/progress-screen.ts` — one scrolling page.

### 1. Streak hero
Big daily streak + a rolling 7-day strip, with a collapsible "Times trained this month"
calendar (weekday letters, full-width heatmap). Streak rules (`streak.ts`): a day counts
when you complete at least one session in local calendar time; the streak is the run of
consecutive counted days backwards from today, with **one day of grace** — if you
haven't trained *yet* today it's measured from yesterday, so an unbroken streak doesn't
read as zero first thing in the morning.

### 2. Openings
- **Move memory** — a repertoire-wide donut over every move in your lines:
  *solid* (remembered at the last drill) / *slipping* (missed last time) / *not trained
  yet*, with recall % in the hole. Straight from each move's SM-2 block (`moveMemory`).
- **Remembered moves over time** — a recall donut with spelled-out remembered/failed
  counts and a "trained X of Y days" line, over a per-day bar. Tapping a day swaps the
  header to that day's numbers. A small **"lines added"** marker per day (with a legend)
  means a recall dip reads as fresh material rather than real forgetting. Week / Month /
  All swipe as a sliding carousel.
- Quick-stat boxes that open sheets of shortcuts.

### 3. Your games (only when games are imported)
- A discreet account strip with refresh.
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
rated streak — beating it is announced on the results screen). Tapping a day on the
rating line swaps the boxes to that day. The Endgames region carries the endgame-puzzle
rating and best run with its own trend, plus progress meters for Classic endgames solved
and from-your-games endgames played out (with a "let slip" count).

### The chart engine (`stats-charts.ts`)

One renderer behind **every** trend: a monotone-cubic line (no overshoot, so the curve
never invents values) over a soft area wash, recessive hairline y-gridlines with clean
ticks, an optional reference baseline, tap-anywhere crosshair + exact read-out, and an
end-dot on the newest value. Plus `renderDonut` (SVG ring gauge, themed via CSS, 2 px
surface gaps, headline number in the hole) and `renderRecordStrip`.

### The numbers behind it

`stats.ts` (pure, self-tested) aggregates training and game figures; `analysis.ts` turns
games into the coaching report; `progress.ts` cross-references game results against
`lastTrained` dates to answer *"is drilling actually helping?"*; `rating-stats.ts` fetches
site ratings. **Nothing is invented** — where a figure isn't tracked (e.g. "first trained
this opening"), the section shows an honest empty state.

#### The family-join subtlety (v0.14)

Chess.com tags games with very specific names ("Sicilian Defense Najdorf Variation Main
Line…"), which scatter across dozens of micro-labels. `openingFamily()` folds a name down
to its family — and **cuts at the colon**, because the bundled dataset names lines
"Pirc Defense: Classical Variation". Chess.com names come from URL slugs that drop
apostrophes ("Queens Gambit" vs "Queen's Gambit"), so `familyKey()` normalises both
sides. Without these two fixes the memory rings said "No line yet" for openings you
definitely had lines for.

---

## 19. Settings

`src/settings-screen.ts` — accordion groups, in render order:

1. **Add your games** (always leads; a prominent accent CTA card until you've imported,
   then discreet — the connected account with a refresh).
2. **Connect to Lichess** — a prominent card until connected, then it collapses into a
   quiet accordion lower down.
3. **Appearance** — theme picker (Classic light / Classic dark / Elegant / Gamer /
   System), board colour swatches (9), piece-set swatches (10), coordinates,
   **Board miniatures**, **move notation** (SAN vs figurine), **Engine always on**,
   **Deeper reviews online**, show move classifications, engine arrows.
4. **Training** — retries before reveal (0/1/2), watch-line speed (slow/normal/fast),
   default training mode (due/recent/weakest), confirm run before training, feedback
   sound, show paused lines, scouting on/off.
5. **Daily challenge** — per-task on/off and counts.
6. **Backup** — export/import JSON, **Cloud backup — Google Drive** (connect, Back up
   now, Restore from Drive with the merge-vs-replace chooser, auto-backup toggle,
   last-backed-up caption with a "pending" state), **Reset all progress**, **Erase
   everything** (two-step confirm with a back-up-first offer).
7. **Lichess connection** (when connected) — disconnect, explorer database choice.
8. **Feedback & about** — Send feedback, Beta survey, Replay intro, Replay setup, About
   (opens the landing page), and the **Buy me a coffee** support section.

Shared control builders exported for reuse by the onboarding wizard: `segmented()`,
`boardSwatches()`, `pieceSwatches()`, `buildThemeRow()`, `confirmDialog()`.

Note: the Statistics/Explore/Diagnostics setting groups were removed in v0.12 — those
features are simply always on, and self-tests run via `npm run selftest`.

---

## 20. Game import, accounts and scouting

### The shared import core (`import-core.ts`)

Everything platform-neutral lives here: the `NormalisedGame` shape both platforms boil
down to, the PGN → compact `ImportedGame` parser, the driver (`runImport`) that applies
the `HARD_CAP = 1000` newest-first cap and reports truncation, the time-control tally,
and local filtering. Ranges are `[1, 3, 12]` months (default 3) plus "All". Opening moves
are kept to `OPENING_PLIES = 60`. `DEFAULT_TIME_CLASSES = ['blitz','rapid','daily']`
(bullet is off by default).

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

### The import panel (`import-panel.ts`)

A two-step bottom sheet used everywhere games come in:

- **Step 1** — platform, username, range (1m / 3m / 12m / All) → Scan.
- **Step 2** — step 1 collapses behind an "Edit search" link; the source is echoed
  (`@user · platform`), "Found N games", a how-many chooser (Last 100 / Last 500 / All,
  defaulting to 500 above that), a row of time-control toggles each showing its count, an
  amber alert for a big "All", an Import button that always shows the resulting count,
  and the White/Black split of exactly what will land.

The scan runs behind a **full-screen loader** with your profile picture, a pixel-pawn
progress bar (`import-progress.ts` — an asymptotic curve over `gamesSoFar`, since neither
source reports a total up front) and a **facts ticker** that types chess facts while you
wait. The parser yields to the UI so the ticker never freezes mid-sentence.

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
  Library tab at the same position.

### Scouting (`scout.ts`)

An "opponent" is someone you've imported games *for*, from **their** perspective (colour /
result / opponent all describe them). Their two opening maps are precomputed the moment
the import finishes, so opening one later is instant. Games and trees live in one
IndexedDB record; deleting it removes every trace. Per-move statistics come from
`move-stats.ts`, a flat, deliberately **unpruned** lookup table keyed by UCI path (the
rendered tree does its own pruning, so every drawn node — however rare — still finds its
stats).

---

## 21. Onboarding, gate, survey, feedback, support

### Beta access gate (`gate.ts`)

The first open in a browser shows an "enter your beta access code" screen before the app
boots. A correct code unlocks the device forever (a localStorage flag) and then offers an
install screen. Skipped entirely when already unlocked or running as an installed PWA.

Codes are checked against **SHA-256 hashes baked into the bundle** (never the plain
code), and any code whose hash is in the list is accepted, so several can run at once.
Current codes: `joan`, `thunderchess` — rotation instructions in `BETA-ACCESS.md`.

> **Honest caveat, stated in the source:** this is a *client-side* gate. A determined
> developer can read the JS and bypass it. It's a friendly speed-bump for a private beta,
> not real security. No email, no personal data, no analytics are collected.

### First launch

1. **Intro** (`onboarding.ts`) — four full-screen slides, each led by the icon of the tab
   it points at, ending on a "start from your games" action. CSS-only animation, shown
   once, replayable from Settings.
2. **Setup wizard** (`onboarding-wizard.ts`) — a full-screen flow with step dots:
   (1) move notation, (2) theme + board colour + piece set, (3) connect to Lichess or
   skip, (4) import your games or skip, (5) "You're all set up". Steps 1–2 write straight
   to the same prefs Settings uses, via the exact same controls, so there is nothing to
   "save". If the app reboots mid-wizard (a Lichess OAuth redirect), `wizardStepPending()`
   resumes at the stashed step instead of replaying the intro.
3. **Starter onboarding** (`onboarding-starter.ts`) — the Train screen's empty state,
   adapting to what you have: games imported → "Based on your games" suggestions; nothing
   yet → curated starter packs. Adding a line runs the normal add-to-training path, and
   the flow repaints in place so the progress bar climbs. Gated until `ONBOARDING_GOAL = 5`.

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
pre-filled with 50 kr on a Swedish phone) and a Ko-fi card link.

### About (`about.ts`)

App / Open source / Version, with name and version baked in at build time from
`package.json` via `vite.config.ts` defines (`__APP_NAME__`, `__APP_VERSION__`).

---

## 22. Backup, Google Drive, publishing

### Manual backup (`backup.ts` + `storage.ts`)

Export writes the whole `BackupFile` to one JSON download; Import reads it back with a
**merge vs replace** chooser (merge overwrites by id and never deletes — the safe
default; replace wipes first). A restore carrying extras (games / localStorage) prompts a
reload, since modules cache localStorage state in memory.

### Google Drive cloud backup (`drive-backup.ts`)

Everything runs in the browser, no server: Google Identity Services hands the app a
short-lived access token via an OAuth popup (client IDs are public by design — there is
no secret anywhere), and the Drive REST API stores **one file** — the same JSON that
Export downloads — in the app's hidden **`appDataFolder`**. That folder never appears in
the user's Drive and only this app can read it, so the narrowest Drive scope suffices and
the user's real files are untouchable.

Features: Connect, Back up now, Restore from Drive, an **auto-backup toggle** (a debounced
upload ~30 s after any repertoire change, wired through the storage change notifier), and
a last-backed-up caption with a "pending" state. Connecting on a fresh device offers to
restore an existing cloud backup *before* anything is uploaded. Background auto-backup
only uploads while a session token is live — otherwise it stays quietly "pending" until
Settings is opened — so it can never trigger the Google sign-in screen mid-app.

The client ID is wired in; `DRIVE-SETUP.md` is the click-by-click guide to creating a new
one. This also gives **manual cross-device sync**: back up on the phone, restore on the
desktop PWA.

### Publishing (`PUBLISHING.md`)

The full options analysis: **Google Play via a Trusted Web Activity** as the recommended
paid one-time-payment route, the Microsoft Store as an optional desktop storefront, Apple
deferred with honest cost/rejection caveats, web-only sale as the fallback. It documents
the free-web-vs-paid-app pricing stance, the step-by-step Play checklist with its gotchas
(12 testers / 14-day closed test, root `assetlinks.json` repo, free-can-never-become-paid),
and the design note for **true automatic sync** (per-line `updatedAt` + deletion
tombstones) so a later round starts from a design rather than from scratch.

---

## 23. Design system, theming and appearance

### Tokens (`style.css`, ~13,200 lines)

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
--primary: #3e6650;    /* felt green — THE primary (replaced the retired oxblood) */
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
`registerBrushes()` gives every board unique keys, fixing the intermittent
"arrow with no pointer" bug.

---

## 24. Preference reference (localStorage keys)

All device-local, all backed up (except the excluded ones) as part of `BackupFile.local`.

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
| `obertura.timedBest.{1,3,5}` | prefs.ts | timed personal bests (legacy single key migrated to the 3-min slot) |
| `obertura.installedAt` | main.ts | first-launch timestamp; gates the survey banner |
| `obertura.drive.*` | drive-backup.ts | Drive connection state — **excluded from backups** |
| `obertura.lichessReturnTo` | lichess-auth.ts | OAuth return crumb — **excluded from backups** |
| `engineEnabled` / `sparEngineEnabled` | engine.ts / spar.ts | engine on/off (backed up) |

Plus the stat/log stores: streak days, review outcome log (`REVIEW_LOG_WINDOW = 120`
days), reviewed-today counter, puzzle day/opening tallies, puzzle ratings (per scope),
puzzle repeat queue, forgotten-move tallies, endgame progress, brilliant log, video
shelves, daily-challenge state and config, gate unlock flag, intro/wizard seen flags,
survey draft + sent flag.

---

## 25. Self-tests and runtime verification

### The self-test harness

There is **no test framework**. Each `src/*.selftest.ts` exports a
`run<Name>SelfTest(): { name, pass, detail }[]`. `scripts/run-selftests.ts` imports the
DOM-free suites and prints a `PASS/FAIL` line each with a final tally, exiting non-zero
on any failure. Run with `npm run selftest` (Node ≥ 22, using
`--experimental-strip-types` plus `scripts/register-ts.mjs` + `scripts/ts-resolve.mjs`
for extensionless imports). **533+ assertions** at the time of writing.

The 26 headless suites: `openings`, `import`, `scheduler`, `analysis`, `spar`, `scout`,
`traps`, `move-stats`, `progress`, `stats`, `tree`, `engine`, `puzzles`,
`puzzle-rating`, `winprob`, `review`, `move-facts`, `accuracy`, `drive`, `mistake-scan`,
`brilliant`, `endgame-catalog`, `endgame-progress`, `endgame-scan`, `study-import`,
`study-catalog`.

`storage.selftest.ts` runs against a real IndexedDB, so it stays phone-only
(`selftest-panel.ts` renders the in-app runner, which accepts sync or async runners).

> ⚠️ `npm run selftest` needs `node_modules` installed (`npm ci`). In a fresh container
> it fails with `ERR_MODULE_NOT_FOUND: chess.js` until dependencies are installed.

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

## 26. Third-party services and offline behaviour

| Service | Endpoint | Auth | Used for | On failure |
|---|---|---|---|---|
| Lichess cloud eval | `/api/cloud-eval` | optional Bearer | tier-1 eval | circuit breaker → next tier; "Lichess off" badge |
| Lichess opening explorer | explorer API | none | W/D/L bars, deep continuations | bundled stats / hidden |
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

**The shared YouTube key** is committed in `src/youtube.ts`. This is safe by design: in
Google's console it is restricted to the app's origin (`https://marxal.github.io/*`) and
to the YouTube Data API v3 only, so outside the deployed app it's dead weight. All users
share the free quota (~100 searches/day); queries are per **opening name** (not per move)
and cached for a week in memory + localStorage, keeping real usage far under the cap.
Rotation = create a new restricted key, replace the constant, redeploy.

**Container caveat:** `lichess.org`, `api.chess.com` and `tablebase.lichess.org` are all
blocked by the build/preview container's network allowlist. Anything touching them can
only be exercised **on the phone**; the parsers are covered offline by self-tests.

---

## 27. Known limits and deliberately deferred work

- **No service worker** — no offline mode, no background sync. The `no-cache` meta tags
  are the deliberate stand-in.
- **No automatic two-device sync.** Drive *backup* ships; true sync needs per-line
  `updatedAt` + deletion tombstones (design note in `PUBLISHING.md`).
- **Study import drops side variations** — `variations=false` is requested, so only the
  mainline reaches the parser. Studies laid out one-line-per-chapter (the common
  convention) import fully.
- **No tree migrations.** Pre-single-path lines may carry hidden dead branches; readers
  ignore them and the first divergent edit cleans them up.
- **`explorer-stats.json` is currently empty** (`{}`) — regenerate with
  `npm run build-explorer-stats` to restore the offline W/D/L core.
- **Map transpositions are not merged** — positions reached by different move orders show
  as separate nodes.
- **Chart labels distort on very wide screens** (`preserveAspectRatio: none`) — accepted
  for a phone-first app.
- **The beta gate is client-side only** and explicitly not real security.
- **Scouted opponents are excluded from backups** (re-fetchable, bulky).
- Parked seeds: a fourth board/app theme, deeper engine adaptation, richer explanations,
  more opening-database coverage, monetization build-out.

---

## 28. Working conventions

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
- Confirm scope before starting new work; record the round in `ROADMAP.md`.

### Code conventions

- **Long "why" header comments** on every module. They are the primary documentation —
  update them when behaviour changes.
- **Split pure logic from DOM**, and add a `*.selftest.ts` for the pure part. Register new
  DOM-free suites in `scripts/run-selftests.ts`.
- **Fail soft on every network call** — return `null`, degrade the UI, never throw at the
  user.
- **Small, focused files.** When a module grows past its job, split it (this is why there
  are ~180 of them).
- **Reuse the shared primitives**: `showDialog`, `showToast`, `buildEmptyState`,
  `renderLoadError`, `createFilterBar`, `buildPositionCard`, `renderGroups`,
  `renderLineChart` / `renderDonut`, `wdlBlock`, `pushBack`, `Icons`.
- **Every overlay registers `pushBack`** so the Android back gesture closes it.
- **Every device-local pref goes through a getter/setter** in its own module — never read
  `localStorage` inline at a call site.
- **Design tokens only** — no raw hex in component CSS; use the spacing scale.
- Keep `theme.ts` and the `index.html` pre-paint script in sync.
- Keep the **Scouting slide last** in the builder carousel.
- Commit and push to the designated feature branch; the Pages deploy runs on `main`.
