# Bito Chess — how the app works

The complete reference for this codebase: what the app does, how it is put
together, where every module lives, and which decisions are load-bearing.

**It is not a substitute for the four specs.** `REPERTOIRE-REDESIGN.md`,
`TRANSPOSITIONS.md`, `SUPABASE-SYNC.md` and `STRIPE-SETUP.md` are cited by
section number from ~60 places in the source and stay the authority on their
subjects. This file explains the app *around* them: the shape, the flow, the
inventory, and enough of each feature to know what you are touching before you
open it.

**If a line here disagrees with the code, the code is right** — fix the line in
the same pass. `archive/` is history and describes nothing that runs today.

Counts in this document were measured on 2026-09-02 against `main` at `c55ed98`
(`package.json` version `0.5.0`).

---

## Contents

1. [What Bito Chess is](#1-what-bito-chess-is)
2. [Read this before touching that](#2-read-this-before-touching-that)
3. [Runtime architecture](#3-runtime-architecture)
4. [The data model](#4-the-data-model)
5. [Storage and persistence](#5-storage-and-persistence)
6. [Training and the scheduler](#6-training-and-the-scheduler)
7. [The daily challenge](#7-the-daily-challenge)
8. [Exercises built from your own games](#8-exercises-built-from-your-own-games)
9. [The builder and the analyser](#9-the-builder-and-the-analyser)
10. [Engines and evaluation](#10-engines-and-evaluation)
11. [Opening knowledge](#11-opening-knowledge)
12. [Explore, coverage, maps and scouting](#12-explore-coverage-maps-and-scouting)
13. [Puzzles and endgames](#13-puzzles-and-endgames)
14. [Statistics](#14-statistics)
15. [Game import](#15-game-import)
16. [Accounts, sync, entitlement and payment](#16-accounts-sync-entitlement-and-payment)
17. [Onboarding, settings and chrome](#17-onboarding-settings-and-chrome)
18. [The anonymous event counter](#18-the-anonymous-event-counter)
19. [Module index](#19-module-index)
20. [Bundled data and assets](#20-bundled-data-and-assets)
21. [The Worker, the scripts and the public pages](#21-the-worker-the-scripts-and-the-public-pages)
22. [Build, deploy and test](#22-build-deploy-and-test)
23. [Conventions and invariants](#23-conventions-and-invariants)
24. [Known gaps and honest caveats](#24-known-gaps-and-honest-caveats)

---

## 1. What Bito Chess is

A phone-first chess **opening** trainer, shipped as an installable PWA. You build
a repertoire that is genuinely yours, drill it under spaced repetition, and the
app reads your own games to find what to fix next.

- **Public product name:** Bito Chess. **Repo codename:** `obertura` (folders,
  storage keys and internal identifiers keep the old name — do not rename them).
- **Stack:** Vite + vanilla TypeScript (no framework), `chessground` for boards,
  `chess.js` for rules/SAN/PGN, `stockfish` (lite WASM) in a Web Worker.
- **Storage:** IndexedDB on the device is the single source of truth for every
  read. Supabase holds one synced copy per account; a Cloudflare Worker handles
  Stripe and account deletion. Nothing else is server-side.
- **Scale:** 189 modules in `src/` (plus `src/pieces/previews.ts`), 50
  `*.selftest.ts` suites, `main.ts` at 6,270 lines and `style.css` at 20,485.
- **No third-party requests** beyond the named APIs. The privacy policy promises
  it. Chakra Petch is self-hosted twice (`src/fonts/`, `docs/fonts/`) — never add
  a Google Fonts `<link>`.

### The two builds, from one repo

`DEPLOY_TARGET` (read in `vite.config.ts`, inlined as `__DEPLOY_TARGET__`) picks
the shape:

| | `github` (default) | `cloudflare` |
|---|---|---|
| App base | `/obertura/` | `/app/` |
| App output | `dist/` | `dist/app/` |
| Landing page | copied by CI to `dist/docs/` | copied to `dist/` root |
| Beta gate (`gate.ts`) | **on** | **skipped entirely** |
| Supabase env vars | absent → accounts, sync, entitlement and payment are all inert | present |
| Purpose | internal test mirror | the public product |

`public/manifest.webmanifest` is shared unchanged: `start_url: "."` is relative
and resolves correctly under either base.

---

## 2. Read this before touching that

| Touching… | Read first |
|---|---|
| The move tree, repertoires, what a "line" is | **`REPERTOIRE-REDESIGN.md`** |
| Saving, drilling or counting a line; anything about duplicates | **`TRANSPOSITIONS.md`** (cited by §number from ~60 places) |
| Accounts, sync, the `profiles` table, RLS, email, providers | **`SUPABASE-SYNC.md`** |
| The buy flow, Stripe secrets, webhook, prices | **`STRIPE-SETUP.md`** |
| The beta access codes | **`BETA-ACCESS.md`** |
| The landing-page copy | **`docs/LANDING-COPY.md`** (source of truth — edit there, then mirror) |
| Store/monetization plans not yet built | **`PUBLISHING.md`** |
| Behaviour rules, stack decisions, hard constraints | **`CLAUDE.md`** |
| What shipped when | **`ROADMAP.md`**, and `archive/ROADMAP-history.md` for older rounds |

---

## 3. Runtime architecture

### 3.1 Boot sequence

`index.html` is deliberately uncached (`Cache-Control: no-cache` meta tags) —
there is no service worker yet, so re-fetching the shell is what stops it going
stale against Vite's hashed assets. It applies the saved theme and board colour
**before first paint** in an inline script (mirroring `theme.ts` /
`appearance.ts`), shows `#app-splash` (the app icon), and loads `src/main.ts`.

`main.ts` then, in order:

1. `initTheme()`, `initAppearance()`, `setupNav()`.
2. `initAccountSync()` and `initEntitlement()` **before** `initAuth()` — both
   listen for the sign-in event `initAuth` is about to report, and a listener
   added afterwards would miss it.
3. Password-recovery detection (a reset link signs you in silently, so the
   "choose a new password" sheet is put in front of the app).
4. `purgeRetiredLocalKeys()` — one-time cleanup of the retired Google Drive flags.
5. `primePricing()` — fetch the unlock price in the background so checkout opens
   without a round trip.
6. `lichessTryCallback()` — complete a "Connect to Lichess" OAuth return and
   stash where to resume.
7. `maybeShowGate(...)` — the beta gate. Everything below runs inside its
   callback; on the Cloudflare build the gate passes through immediately.
8. Chessground is created on `#board`, brushes registered (`board-brushes.ts`),
   then the `Engine`, `EvalPanel`, `EnginePanel`, `BuilderPanels`, `GrowPanel`
   and `ExplorePanel` are constructed against it.
9. `showView('train')`, splash dropped once `getAllLines()` resolves (3s safety
   net), FAB mounted.
10. Deferred work, in this order and never blocking launch: a Lichess return
    replay, `?auth=signup`, `handlePurchaseReturn()`, the entitlement-change
    listener, the first-run picker (held until the account copy lands, or 8s),
    `maybeAutoRefreshGames()`, then after `AUTO_SCAN_DELAY_MS` the background
    `startAutoScan()` and `startEndgameAutoScan()`.

### 3.2 Views and navigation

Seven views, all present in `index.html` and toggled by `hidden` in `showView()`:

`train` · `lines` · `explore` · `games` · `progress` · `builder` · `settings`

- **Five tabs** (Train, My Lines, Explore, My games, Statistics) show in
  `#bottom-nav` on a phone and `#side-nav` at/above `DESKTOP_NAV_BREAKPOINT`;
  `syncNavVisibility()` swaps them on both navigation and live resize.
- **Two full screens** (`BACK_VIEWS`: builder, settings) hide both navs and show
  the header back arrow. `returnView` remembers where to go back to.
- `document.documentElement.dataset.view` is set on every navigation, so CSS
  rules can reach outside a view's own element (the builder's desktop grid needs
  `main` to drop its sidebar gutter).
- On desktop, Settings opens as a **centred lightbox** (`settings-lightbox.ts`)
  rather than a view, so the sidebar stays visible and no `returnView`
  bookkeeping is needed.

### 3.3 Overlays and the back gesture

Every drill, puzzle, exercise, sheet and dialog is an **overlay**, not a view.
`back-nav.ts` keeps exactly one spare history entry armed at all times so the
Android back gesture steps *within* the app instead of closing the PWA. Two
kinds of back are checked in order: dismissible layers registered with
`pushBack()` (sheets, dialogs, drills), then view-level back. When nothing is
left, the press is replayed and the app closes as expected.

The builder additionally arms its own back layer (`armBuilderBack`) so the
save-guard runs with priority.

### 3.4 The suspended-session pattern

An exercise can hand off to the analyser mid-run ("Open full analysis" in a
mistake drill, "Analyse position" from a puzzle). The overlay is **hidden, not
destroyed**: `suspendedSession` holds `{ resume, discard }`, the header swaps
Save for "Back to train", and `showView()` resumes it when the user lands back on
Train — or discards it anywhere else, so a hidden overlay can never linger under
a different screen.

### 3.5 The `liveDaily` indirection

`renderTrainTabbed()` rebuilds the whole Train screen from scratch, including the
daily card and its launchers. Anything holding the *old* closures then writes
into detached nodes. So completions and the "Next challenge →" chain go through
the module-level `liveDaily` box, and the newest render always owns it. Read the
long comment above `liveDaily` in `main.ts` before touching daily wiring.

### 3.6 The desktop path

Above `DESKTOP_NAV_BREAKPOINT` the same DOM re-lays out: a left sidebar replaces
the tab bar, the Train Openings pane becomes two columns
(`.train-pane-openings`), Statistics becomes a dashboard grid with charts capped
at 460px, and Settings becomes a lightbox. No separate markup, no separate
render path.

---

## 4. The data model

**Read `REPERTOIRE-REDESIGN.md` before changing any of this.**

### 4.1 Repertoire — the stored thing

```ts
interface Repertoire {
  id: string; name: string;
  colour: 'white' | 'black';
  tree: MoveNode;          // root: a move-less node at START_FEN
  createdAt: number;
  archived?: boolean;      // kept, but out of training and the default views
}
```

Two exist by default — "My White lines" and "My Black lines". More are for
*situations* (blitz, a tournament, a named opponent), not for colours.

### 4.2 Line — derived, never stored

A **line** is the path from the root to a *line end* (a leaf, or a node marked
`endpoint`). `lines-view.ts` projects it:

- **id** = `` `${repertoireId}::${endNodeId}` `` — derived, never persisted.
- **name / tags / training / priority** resolved from the nodes along the path.
- **confidence, buckets, due dates** computed from the moves' review records.
- **`ownMoves`** = how many moves no other line passes through (what "delete this
  line" would actually cut).
- An archived book forces `inTraining: false` whatever its nodes say.

`storage.getAllLines()` still hands out `Line[]` exactly as it always did, which
is why ~50 consumer modules never had to change. Only writers learned the new
model, and most of them go through `applyLineWrite`.

### 4.3 MoveNode

```ts
interface MoveNode {
  id; san; uci; fen; children: MoveNode[];
  note?; annotation?;                    // the six marks: !! ! !? ?! ? ??
  missedThisSession?; noteAskedAtLapses?;
  classification?; cpLoss?; evalCp?;     // written by review.ts
  review?: { ease; interval; reps; lapses; due };

  // repertoire fields
  label?; tags?; training?; priority?;   // ← these four INHERIT
  endpoint?; joinTo?; createdAt?; timesTrained?; lastTrained?;
}
```

**The first four inherit.** Set on a node, they apply to the whole subtree unless
a deeper node overrides. That is what turns "pause the whole French" into one
toggle instead of twenty edits — and it is what `branch-sheet.ts` exists to
expose. `tags` accumulate down the path rather than overriding; `label`,
`training` and `priority` take the deepest explicit value.

### 4.4 The no-duplicates rule

**The same moves are never stored twice.** Saving a longer version of a line
extends its branch; a second answer at a position is a second child. Every write
of moves goes through `repertoire.mergePath` — matching by UCI within the parent,
so an already-prepared move is *walked onto* and its review record, note and
annotation survive untouched. Replacing is `removeSubtree` first, which the
builder does deliberately and asks about.

### 4.5 Tree modes

`tree.ts` holds the working (in-memory, cursor-carrying) tree and grows in three
modes:

- `single` — one line edited in isolation; a deviating move **replaces**.
- `variations` — the game analyser; a deviating move is a new sibling, main line
  (`children[0]`) preserved.
- `repertoire` — the builder; a deviating move is a **second answer**, added as a
  sibling. Same growth as `variations`, named apart because the intent differs.
  Only this mode stamps `createdAt`.

### 4.6 The position index

`position-index.ts` maps the whole repertoire by position — "which lines pass
through here, and what does each play?" — keyed by **EPD** (the first four FEN
fields; the same key `openings.ts` and the bundled datasets use). It answers:

- **Duplicate verdicts** for the save button: `identical`, `extension-longer`,
  `extension-shorter`, `divergent`, with `sharedPlies`.
- **Transpositions** — the same position reached by another move order.
- **Sibling answers** a drill needs to offer a divert.

`buildPositionIndex()` is pure. The cached, storage-touching half
(`positionIndex()` / `holdPositionIndex()`) sits at the bottom of the file.
`save-index.ts` and `train-index.ts` are the pure "what does the index change
about saving / about training" halves, split out precisely so they run under Node
(`main.ts` cannot). See `TRANSPOSITIONS.md` §5–§9.

### 4.7 Transposition joins

`repertoire-join.ts`. A **join** is opt-in: mark one line end "carry on as in
that line", and the line simply gets longer — the *same* nodes, so drilling
either grades the same records. Three rules keep it safe: a join is followed
**once** only; a continuation that would revisit a move already on the line is
refused (no loops); and the join must land on the **same position**. The
projection keeps `path` (everything played) separate from `originPath` (the
line's own branch, which decides identity, name, tags, training and priority).

---

## 5. Storage and persistence

### 5.1 IndexedDB

Database **`obertura`, version 4** (`storage.ts` — a thin promisifying wrapper):

| Store | Key | Contents |
|---|---|---|
| `repertoires` | `id` | **primary** — one book per record, holding one tree |
| `lines` | `id` | **legacy**, left untouched after migration as a one-version rollback |
| `games` | `id` | imported games; index on `endTime` |
| `opponents` | `id` | one self-contained scouting record each (games + precomputed maps) |

`repertoire-migrate.ts` runs the one-way migration (flat `Line[]` → one tree per
colour) on first launch after the redesign, and on any backup or sync payload
still in the old shape. It merges by path, so lines that shared an opening stop
storing it twice, and reports exactly how much collapsed.

Change notifications: `onLinesChanged` / `onGamesChanged` are what drive the
sync's debounced push and the position index's invalidation.

### 5.2 localStorage

~100 dot-form `obertura.*` keys plus 5 dash-form legacy ones. **They are not
enumerated in prose — they drift.** List them with:

```sh
grep -oh "'obertura\.[a-zA-Z.]*'" src/*.ts | sort -u
```

What may **leave the device** is decided in exactly one place: **`local-keys.ts`**,
an import-free module held by `local-keys.selftest.ts`. The rule is allow-by-
prefix, deny-by-exception, and every exception carries its reason. The one that
bit: `obertura.supabase.` is the signed-in session itself (access + refresh
token) — it matched "starts with obertura", got swept into backups and the synced
snapshot, and was written over the session of whatever device pulled it.

The three newest exceptions are the event counter's (`obertura.installedAt`,
`obertura.metricsSeen`, `obertura.metricsOptOut`) — each describes what *this
install* has already counted, so a synced copy would make a second device
inherit the first one's history and stop counting. See §18.

### 5.3 Backup and restore

`storage.ts` owns the format (v2) and `backup.ts` the UI. A file declares which
`parts` it carries — `lines` · `games` · `stats` · `settings` — and that is what
makes a partial import safe: "Replace everything" on a lines-only file replaces
the lines and leaves the games alone, because the file never claimed to speak for
them.

`resetAllProgress()` and `eraseAllData()` live here too (Settings → Data).

---

## 6. Training and the scheduler

### 6.1 SM-2, and what is scheduled

`scheduler.ts` is pure and DOM-free. Every **MoveNode** carries its own review
block; a *due line* is any line containing a due move; training always walks a
whole line (or a stream of single positions).

```
ease     starts 2.5, floor 1.3 (MIN_EASE)
interval whole days: 1 → 6 → round(interval × ease)
reps     consecutive clean recalls, reset to 0 on a miss
lapses   lifetime misses, only ever grows
due      the Date the move next wants asking
```

A binary drill is mapped onto SM-2's 0–5 quality by miss count:
0 misses → 5, 1 → 2, 2+ → 0.

**Priority multiplies the wait, not the interval.** `PRIORITY_SPACING` is
`high 0.6 · standard 1 · low 1.7`, applied once to the due *date*. Scaling
`interval` would compound — after five reps a "slightly more often" line would
come round twenty times more often than intended. Keeping `interval` pure also
keeps it meaning one thing: "how well is this known?", which is what the
Learning/Solid buckets read (`SETTLED_INTERVAL_DAYS = 21`).

`dueLines()` is the one door every session queues from: highest priority first,
never-trained material woven in every `NEW_MATERIAL_CADENCE` (3rd) slot, reviews
ordered by *relative* overdueness (lateness ÷ own interval, so a 1-day move two
days late outranks a 90-day move two days late).

### 6.2 Sessions and the drill runtime

- `session.ts` — a `TrainingSession` is an ordered queue of lines to walk once
  each. It only shrinks; missed material is handled by the end-of-session review
  and by the scheduler bringing the move back sooner.
- `drill.ts` (1,620 lines) — the one drill overlay, with three entry points:
  `startDrill` (walk a whole line), `startPositionsDrill` (a stream of single
  positions), `startTimedDrill` (a countdown). `DrillOptions` is the contract and
  is worth reading in full; the notable slots are `checkAlternative`
  (engine-verified good alternatives, and other-line detection), `onDivert`
  (TRANSPOSITIONS §9 — carry on in the other in-training line instead of being
  corrected), `startAtPly`, `watchFirstMs` / `beforeWatch`, `skipRun`,
  `struggle`, and the `modeLabel`/`modeIcon`/`modeAccent`/`contextLabel` set that
  paints `run-header.ts`.

### 6.3 The Train screen

`main.ts:renderTrainTabbed()` owns the shared daily-challenge card above four
tabs, each with its own accent wash (`data-train-mode`, `--train-accent`):

| Tab | Renderer | Accent |
|---|---|---|
| **Openings** | `train-screen.ts` | app green |
| **Puzzles** | `puzzles-screen.ts` | `#c4741d` |
| **Middle game** | `mistakes-screen.ts` | `#a3492e` |
| **End game** | `endgame-screen.ts` | `#33677a` |

The **Openings** pane (`train-screen.ts`, 2,572 lines) is: the due hero (when
anything is due), the Practise menu, and the "Forgotten moves" block. On desktop
those split into a *do next* column and a *state* column.

### 6.4 The training unlock

`TRAINING_UNLOCK_LINES = 3` (`training-goal.ts`, which imports nothing so it stays
Node-safe). Below three saved lines the Practise menu is greyed out and the due
hero stays away — a session built from one line teaches the user that the loop is
trivial. **Not** locked: the confirm run a line goes through on save, and a
"Drill" button on a named line elsewhere.

### 6.5 The six practice modes

`renderModeCards()` in `train-screen.ts`; the same list is explained behind the
(i) in `openPracticeInfo()` — a mode added to one and not the other is an obvious
omission because they sit together.

| Mode | Accent | What it asks |
|---|---|---|
| **Time attack** | gold | single positions against the clock (1/3/5 min), own personal bests; falls back to paused and shallow lines so it works early |
| **Review missed moves** | terracotta | single moves you have actually got wrong, no run-up |
| **Repertoire run** | indigo | one walk of the whole book, every move asked **once** (`repertoire-run.ts`) |
| **Drill new lines** | green | full runs of the newest lines |
| **Target weak areas** | plum | full runs of the weakest lines |
| **Prep** | teal | full runs of opponent-tagged lines; only appears once some exist |

**Repertoire run** deserves its own note: a session of line walks re-asks the
shared opening once per line. Write-through fixes the *score* afterwards
(TRANSPOSITIONS §8); it cannot give back the minutes. A repertoire run walks the
tree depth-first instead, so the dedupe is structural.

### 6.6 Enrolment and the confirm run

Saving a line does **not** silently enrol it. With the default "Confirm run
before training" pref on, the line is played through once before joining the
rotation; `pretraining.ts` is the no-confirm path when the pref is off.
`settleNewBookLines()` in `main.ts` is the tail of every commit: it writes the
explicit `training: false` when "store, don't train" was chosen (a new branch
would otherwise inherit training from its ancestors), and queues one confirm run
per new line.

### 6.7 Chronic misses

`struggle.ts` owns the whole policy: `STRUGGLE_LAPSES = 6` misses before a move
counts as chronic, `ASK_AGAIN_AFTER = 4` further misses before a dismissed prompt
returns (so asks land at 6, 10, 14…). `struggle-nudge.ts` is the box that slides
in **below** the board — never a dialog, never steals focus, dismissed by flicking
sideways. `fix-it.ts` is the three-rep "Fix it" drill, with a written reveal
between reps.

`forgotten-moves.ts` is currently **write-only**: the carousel that read it was
replaced by `forgotten-section.ts`, which ranks by per-move SM-2 `lapses`. The log
is kept recording because it holds the one thing `lapses` cannot answer — *when*
a move was missed.

---

## 7. The daily challenge

`daily-challenge.ts` — the card at the top of Train, spanning every mode. State
is device-local, reset each local calendar day.

**Eight parts** (`DailyTaskId`), shipped in this order (`DEFAULT_DAILY_ORDER`):

| Part | Default count | Needs |
|---|---|---|
| `lines` | 3 | a repertoire |
| `positions` | 3 | a repertoire |
| `growLines` | **1** | a *mastered* line |
| `puzzles` | 3 | network |
| `endgames` | 3 | network |
| `whichMove` | **2** | scanned games |
| `detective` | **2** | scanned games |
| `mistakes` | **2** | scanned games |

The three game-fed parts ship at 2 and sit together at the end, so a new install
simply doesn't show them and the parts that do show are still in a sensible
order. Growing a line ships at **1** because it is the only part that asks you to
*write* something rather than remember something.

- **A count of 0 is off** — there is no separate switch. Range: 0–3 as one-tap
  presets, up to 20 as a custom value.
- **The order is a preference** (`config.order`), rearrangeable in
  `daily-prefs.ts` — reachable both from Settings and from the gear on the card
  itself. "Shuffle each day" hands the order to chance, stably within a day.
- **Before the unlock** the card has a third face: the same rows, greyed, under a
  bar counting toward three lines, riding *below* the Get-started checklist.
- **"Next challenge →"** chains from each part's results screen into the next
  still-open one, resolved at click time and routed through `liveDaily`.
- **Completion** stamps the day (`markDayComplete`), builds the recap
  (`daily-recap.ts`) and shows `daily-celebration.ts` — the everyday hopping pixel
  pawn, or, on a day with not one wrong move across a challenge worth winning
  (`perfectDayEligible`: `PERFECT_MIN_TASKS = 3`, `PERFECT_MIN_COUNT = 2`), the
  pawn **queens**. Nothing anywhere else hints at that, which is the point.
- **Any past day is reopenable** through `daily-review.ts` — from the finished
  card, the 7-day strip on Statistics, or the month calendar. Everything is
  recomputed *as of* that day; the two figures that cannot be reconstructed are
  labelled as current, which is why a replay dates itself.

`daily-recap.ts` keeps its own per-day log (max 180 days) rather than reusing the
streak or puzzle tallies, so today is compared with a day of the **same shape**.

---

## 8. Exercises built from your own games

All of these are downstream of one long job: the engine reading every imported
game and marking where the evaluation swung.

### 8.1 The mistake scan

`mistake-scan.ts` walks each unscanned game newest-first, builds a cheap eval
trail (Lichess cloud first, shallow local Stockfish on a miss), and flags plies
where **your** move went wrong, in four categories:

- `opening-blunder` — you blundered in the opening and lost
- `punish-opening` — the opponent erred in the opening and you let them off
- `missed-win` — you stood clearly winning and gave it away
- `blunder` — a game-losing blunder from a roughly equal position

Candidates are re-verified at analyser depth and stored on the game record
(`ImportedGame.retry`) together with the engine's top-3 continuations, so the
drill gives instant feedback with no engine round-trip. Persistence is per game,
so the scan is abortable and resumable.

`mistake-autoscan.ts` runs the same scan quietly after launch. Its rules are the
file: one controller ever, the manual scan always wins (pausing this one), never
blocks a launch, aborting costs nothing, and the free tier's cap is the same one
the button obeys.

### 8.2 The four "read your own games" exercises

| Exercise | Modules | The question |
|---|---|---|
| **Mistake retry** | `mistake-run.ts`, `mistakes-screen.ts` | your position, your move drawn in red — play a better one. Judged instantly against the stored top-3 |
| **Blunder detective** | `detective.ts` + `detective-run.ts` | a run of 4–6 moves; which one is the blunder? Then: what should have been played. **Exactly one** blunder per run, re-verified at depth |
| **Which move** | `which-move.ts` + `which-move-run.ts` | one position, two arrows — yours and the engine's. Pick |
| **Brilliant moves** | `brilliant.ts`, `brilliant-run.ts`, `brilliant-log.ts` | find your own `!!`/`!` again. Two sources: a game's saved analysis, and the scan's own finds |

`eval-chip.ts` is the shared red/green "♝xe6 −5.2 / hangs material on e6"
comparison, used by all three of the first ones once the answer is in.
`spot-peek.ts` is the shared results-row popup.

### 8.3 One blunder, three doors

The same move can be dealt by the detective, by Which move and by the mistake
drill. Each kept its own memory and none could see the others, so catching a
blunder and then being asked about it again two rows down the daily challenge was
the design, not a coincidence.

`spot-rest.ts` is the shared rest log. Every exercise id already names the game
and ply (`gameId#ply`, `gameId#dPly`, `gameId#bPly`); strip the letter and they
collapse onto one key. A blunder answered **anywhere** goes to the back of the
queue **everywhere** — never removed, just no longer dealt first.
`middle-log.ts` and `brilliant-log.ts` are the per-mode ladders on top of it
(a clean solve rests longer each time; a miss rests one day so it is out of
today's way but back tomorrow).

### 8.4 Grow your lines

`grow-line.ts` (pure) + `grow-panel.ts` (the tab) + `grow-log.ts` (the rest log)
+ the wiring in `main.ts`.

The one **creative** daily part: stand at the end of a line you have genuinely
mastered and add an answer to something you would meet next. It waits for
`lineMastered` (three clean runs, 80% recall, every move drilled, and
`ownMoves > 0` — a line that already continues has nowhere to grow), and only
offers lines ending on **your** move, so the end position is one where the
opponent moves next.

**It is a tab, not an overlay.** Adding a move is *building*, and the builder is
where the tools are — the board, the library, your games, the engine, the
explorer. The panel is a pure readout of where the cursor is, so the user can
wander off to Library and come back to a brief that still knows what it asked.

---

## 9. The builder and the analyser

One screen, one board, two modes. `#view-builder` is: a fixed square board, a
draggable Google-Maps-style sheet below it, and a dock at the bottom.

### 9.1 The sheet, the carousel, the dock

Tabs and slides are addressed by **name**, never by index, because the two modes
show a different set in a different order (`applyBuilderSlideOrder()` reorders
the real DOM so "visual order" and "DOM order" stay the same thing):

```
BUILDER_SLIDES   explore · library · mylines · line · engine
GROW_SLIDES      grow · explore · library · mylines · line · engine
ANALYSER_SLIDES  line · library · mylines · engine       (no Explore)
```

- **Move strip** — the sequence on the board, under the tabs, on *every* tab.
  Deliberately the shortest row in the app: every pixel is a pixel off the board.
- **The dock** — flip board, engine toggle, and four step controls
  (start / end / back / forward). The docked eval bar slides up above it when the
  engine is on (and stays shut on the Engine tab, which shows the same thing
  full size).
- **Sheet states** — `default` and `full`, drag-snapped; `layoutBuilderSheet()`
  can only run while the builder is visible, so it is deferred to a RAF on entry.
- **The (i)** sits outside the carousel (so it cannot scroll away) and follows
  the active slide — copy in `builder-info.ts`, except Library whose (i) also
  carries the Lichess connect/disconnect buttons.

### 9.2 Standing inside a book

`builder-book.ts` owns the session state. The **whole book's tree** is loaded, so
every prepared move is there to walk:

- playing a move you already have is **navigation**;
- playing one you don't is an **addition**, held as a *draft* until committed.

The header button therefore says what it is about to do — "Add 3 moves" — rather
than "Save line". The **stored** tree is kept separate from the **working** tree,
because the line-level controls (training, priority, name, tags) may only touch a
line that actually exists in the book.

`commitBook()` merges (the working tree is already the merged result), shows an
**Undo** toast naming the branches just written, then runs `settleNewBookLines()`.
When the draft finishes more than one line, `draft-sheet.ts` opens first: one row
per line, each with its own training switch and bin, so a book-wide draft is
still a set of separate decisions.

### 9.3 Removing moves

`line-removal.ts` works out, once, what every screen must say:

> Removing a move removes everything after it. Everything before it stays,
> because your other lines are built on it.

There is no "take this move out and keep the rest". The only honest question is
**how much** goes, and it has two shapes the user must tell apart at a glance: a
**trim** (nothing else hangs off the move above — the line survives and ends
earlier) or a **cut** (several lines run through it and they all go). Removals are
undoable via `detachSubtree` / `reattachSubtree`.

### 9.4 Branch actions

`branch-sheet.ts` is where the inheritance rule becomes a feature: pause a whole
branch, name it, tag all of it, change its priority — one tap at the branch point
instead of twenty edits. It always names how many lines it is about to affect.

### 9.5 The save path

`persistCurrentLine()` reads the position index **before** the write, while it
still describes the repertoire *without* this line:

- `inheritReviews` gives every user move the training it already had in another
  line (TRANSPOSITIONS §7) — ahead of the write, so the confirm run and the
  scheduler see the inherited state rather than a line of new moves;
- `duplicatesOf` produces the verdict the extension toast reports (§6).

The save button itself changes shape from that verdict: an exact duplicate offers
to open the existing line, a differing tag offers "add tag to…", an extension
saves and toasts (§4–§6). `saveLine()` returns the line **as stored** — a new
line's real id is derived from the book and its end node, not the UUID built
locally.

### 9.6 The analyser

Opening an imported game (`openImportedGame` / `openGameForAnalysis`) puts the
tree in `variations` mode and swaps the Line tab for the game. "Analyse game"
runs `review.ts` over the mainline; results are written onto the nodes
(`classification`, `cpLoss`, `evalCp`) and persisted with "Save game" onto the
game record, so reopening restores the analysis. `line-analysis.ts` draws the
eval graph and the grade summary; `accuracy.ts` computes per-player accuracy
following Lichess's published model.

Five ways to get a game in, from the dock's import icon (`builder-import.ts`):
last game · browse last 10 · paste PGN or a `.pgn` file · a Lichess study link ·
add manually (`manual-game.ts`).

---

## 10. Engines and evaluation

Three tiers, tried in order, each failing soft to the next:

1. **Lichess cloud eval** — a cache; only knows book positions. Free, no token
   (but uses the Lichess token for higher rate limits when connected).
2. **chess-api.com** (`remote-engine.ts`) — strictly opt-in (Settings → "Deeper
   reviews online", default **off**), depth 18, any position. Every request sends
   the position to a third party.
3. **Local Stockfish** (`engine.ts`) — lite WASM in a Web Worker; the floor.
   Review fallback runs at depth 12 with a hard per-position time budget.

**All cp/mate values are normalised to white's perspective** at the `engine.ts`
boundary. The classifier (`winprob.ts`) expects the *mover's* perspective at the
position *before* the move, and `review.ts` is responsible for the conversion.

- `winprob.ts` — pure, deterministic move classification on **expected points**
  (win%), not raw centipawns, so a 100cp swing near equality is not equated with
  the same swing in a won game. `brilliant` requires a genuine material sacrifice
  (a SEE check in `move-facts.ts`) *plus* being the engine's #1.
- `move-facts.ts` — static exchange evaluation confined to the destination
  square. chess.js generates only legal moves, so pins and checks are respected
  for free. `SEE_MATERIAL_MARGIN = 2` pawns.
- `book-check.ts` — "is this opening theory?" for the reviewer, over the bundled
  library trie (lazy-loaded, built once per session).
- `lichess-tablebase.ts` — the free 7-piece tablebase; **ground truth** for the
  endgame trainer. Fails soft to local Stockfish.
- The **engine is off by default on every fresh load** (it costs worker time and
  battery). Within a session the state lives in `engineOn` in `main.ts`, so
  leaving the builder and coming back preserves it. Settings has an "Engine
  always on" pref.

---

## 11. Opening knowledge

- `openings.ts` — **naming only**, from `openings-data.json` (12,082 positions
  from the CC0 lichess-org/chess-openings dataset), keyed by EPD. Instant,
  offline, no API. `epdKey` here is *the* position convention for the whole app.
- `book-tree.ts` — the bundled book (`openings-library.json`, 12,352 entries) as
  a SAN-keyed trie: `children` = what the book plays next, `count` = named
  openings at or below, `name`/`eco` when one ends exactly there.
- `library.ts` — the browsable Library: a stacked search list, a visual
  family tree, and `library-explorer.ts`'s playable board, all sharing one leaf
  action ("Open in builder", asking White or Black).
- `explorer-*` — the win/draw/loss layer:
  - `explorer-stats.ts` reads the **bundled** set (offline, no login);
  - `lichess-explorer.ts` is the live client (login-gated nowadays — an optional
    overlay on the Library slide, **never** a dependency);
  - `explorer-bands.ts` maps a human band ("1400–1800") to Lichess's fixed
    bucket lower bounds, so the label and the query can never disagree;
  - `explorer-level.ts` decides "around my level" from, in order, a rating typed
    in Settings, your imported games' median, then your Lichess `perfs`;
  - `explorer-resolve.ts` is the one place that answers "how has this position
    scored?" — bundled is the floor, live only ever *replaces* it when it
    actually arrives, and a failed live fetch is reported as `liveFailed` rather
    than silently degrading.
- `traps.ts` / `traps-screen.ts` — 19 curated traps in 2 groups. A trap's only
  action is "Build line", so nothing touches the scheduler until you save.
- **Lichess studies** — `study-catalog.ts` (pure ranking over the bundled
  253-study index), `study-browser.ts` (the Packs section), `study-import.ts`
  (PGN helpers), `study-sheet.ts` (the shared chapter list). Lichess's study
  *search* has no CORS, so the index is built at build time; the *import*
  (`/api/study/{id}.pgn`) is CORS-enabled and live. Side variations are dropped
  (`variations=false`).

---

## 12. Explore, coverage, maps and scouting

### 12.1 The Explore tab

`explore-screen.ts` — **everything you don't have yet**. That sentence is the
information architecture, and its other half is My Lines (what you own). Four
tabs:

1. **Coverage** — the replies your saved lines can't answer. The only tab that
   reads your repertoire, so the only one whose answer changes as you work.
2. **Openings** — what your games show, each row saying what to do: no line yet /
   your line is losing / prepared. (This is the old "Recommended" and "From my
   games" merged — they were always the same pass with a different `filter()`.)
3. **Packs** — starter packs (6 packs, 62 lines), traps, and the study browser.
4. **Scouting** — imported opponents and their opening maps.

### 12.2 Coverage

A **gap** is one thing precisely: a position in your saved lines where it is the
*opponent's* move, a reply exists that matters, and none of your lines answers
it. Every repertoire has infinite gaps at depth, so the whole difficulty is
keeping the list short and honest — a reply must clear a floor, and the list is
capped several ways over. Line *ends* are deliberately ignored: a line that simply
ends is a stopping point you chose, not a hole (that is what Grow-your-lines is
for).

`coverage-gaps.ts` is pure (lines, games, scouts and explorer numbers all arrive
as already-fetched data). `coverage-data.ts` is the only impure half and exists
mostly to enforce one rule: **the explorer is asked about at most `LIVE_BUDGET`
positions per computation, shallowest first, one at a time.** Everything past the
budget gets the bundled set and is labelled all-ratings rather than "at your
level". Nothing here is stored.

### 12.3 The maps

- `map-merge.ts` (pure) merges lines into one tree in two modes: **`path`**
  (matched by UCI within the parent — always a tree, cannot loop) and
  **`position`** (matched by position key across the whole map, so transpositions
  land on one node; this is the only mode that can cycle, hence its loop guards).
- `repertoire-map.ts` draws the zoomable pan/zoom SVG tree, as a full-screen
  overlay or embedded.
- `lines-tree-view.ts` is My Lines → tree view (position-merged, read-only, four
  moves deep before "Go deeper").
- `move-stats.ts` supplies per-node W/D/L by replaying each game's stored move
  list along the UCI path — deliberately unpruned, so every drawn node finds its
  stats.

### 12.4 Scouting

`scout.ts` imports an opponent's games with the *same* importer, from **their**
perspective, and precomputes two opening maps (their White games, their Black
games) at import time so opening one later is instant. Everything lives in one
IndexedDB record per opponent, so deleting it removes every trace. Capped at
`MAX_OPPONENTS` (1 on the free tier).

---

## 13. Puzzles and endgames

### 13.1 Puzzles

`puzzles.ts` is a thin client for the free Lichess Puzzle API. `/api/puzzle/next`
is called **anonymously on purpose**: adding the Bearer token makes it a
non-simple CORS request Lichess won't preflight from a browser, so the fetch
throws and no puzzle ever loads. Repeat-avoidance is handled locally instead
(`puzzle-log.ts`'s seen-id ring). The dashboard endpoint does need the token.

Three modes (`puzzles-screen.ts`):

- **Daily Rated Mix** — the flagship and the *only* rated mode. 10 puzzles from
  your repertoire and your games; moves your personal puzzle Elo.
- **Time Attack** — 3/5/10 min, three mistakes and out, difficulty ramping. Two
  sources with per-length records. Casual, never rated.
- **Practice by opening / by theme** — one opening (mapped to a Lichess "angle"
  via `puzzle-openings.json`, 122 entries) or one of the bundled themes
  (`puzzle-themes.ts`).

`puzzle-run.ts` is the solving overlay (count mode and timed mode, both ending on
a results screen with Play again / Retry mistakes / Done). `puzzle-alt.ts` asks
the local engine, on the **first** non-solution move only, whether the move played
is genuinely equivalent — conservative by design: anything unverifiable is
treated as wrong. `puzzle-repeat.ts` deliberately brings missed puzzles *back*
along a 1 → 3 → 7 → 14-day ladder.

`puzzle-rating.ts` is plain Elo against the puzzle's own Lichess rating, with a
**speed bonus** on top, namespaced by scope so the endgame ladder is separate from
the openings ladder. The bonus only ever adds, so the ladder settles higher — it
is measuring how hard a puzzle you can solve *quickly*, and it is self-limiting.

### 13.2 Endgames

`endgame-screen.ts` — three pillars:

1. **Endgame puzzles** — rated Lichess puzzles filtered to endgame themes, on
   their own rating ladder.
2. **Classic endgames** — 18 curated fundamentals (`endgames.json`, all ≤7 pieces
   so the tablebase can judge), played out against the engine
   (`endgame-playout.ts`), grouped in accordions, each solve banking a best time.
3. **From your games** — endgames you actually reached (`endgame-scan.ts`): the
   first ≤10-piece position on your move, judged by the tablebase (≤7 pieces) or a
   bounded local search (8–10). Only clearly winnable or holdable positions are
   kept. `endgame-autoscan.ts` runs it quietly, **after** the mistake pass goes
   idle — both queue on the same worker chain, so running both at once would only
   make each take twice as long.

`endgame-progress.ts` keeps device-local per-endgame records (solved, attempts,
last trained, best time).

---

## 14. Statistics

`progress-screen.ts` — one scrolling page (a dashboard grid on desktop), three
blocks:

1. **Streak hero** — the daily streak, a rolling 7-day strip, and a collapsible
   "times trained this month" calendar. Days in both are tappable and reopen that
   day's recap.
2. **Training** — four tappable quick-stat boxes and the remembered-vs-failed bar
   with Week/Month/All.
3. **Your games** (only when games exist) — account strip with refresh, win rate
   by opening × training, win rate over time, and most/best/worst-scoring lists.

`stats.ts` holds every aggregation, pure and self-tested. `stats-charts.ts` is
the one line-chart renderer behind every trend (inline SVG, monotone-cubic so the
curve never invents values, themed entirely through CSS variables).
`rating-stats.ts` fetches live site ratings (both platforms' free public APIs,
cached in localStorage, failing soft); Lichess has a rating-history endpoint,
Chess.com does not, so its series is built from `ImportedGame.myRating` and fills
in as games arrive.

Where a figure genuinely is not tracked, the section shows an honest empty state
rather than a guess.

---

## 15. Game import

```
import-panel.ts  (the two-step sheet)      import-inline.ts (the boxed empty-state form)
        │                                            │
        └────────────► import-games.ts ◄─────────────┘
                            │
                     import-core.ts
                      ╱          ╲
             chesscom.ts        lichess.ts
```

- **`import-core.ts`** owns everything platform-neutral: the `NormalisedGame`
  shape, the PGN → compact `ImportedGame` parser, the driver (`runImport`) with
  its 1000-game `HARD_CAP` newest-first and truncation reporting, the per-time-
  control tally, and local filtering. A platform module only has to hand it
  batches of `NormalisedGame`, newest first.
- **Chess.com** — the free Published-Data API: list monthly archives, fetch the
  chosen range **serially** newest-first (the API asks callers not to parallelise).
- **Lichess** — the ndjson games-export stream, no token needed for public games.
- **`import-panel.ts`** — step 1 picks platform + username; step 2 collapses it
  and shows the source, the count, a how-many chooser, per-time-control toggles
  with counts (bullet off by default), the White/Black split, and an amber alert
  on a big "All". There is deliberately **no "how far back"** — nobody can answer
  that before seeing a number.
- **`import-inline.ts`** — six screens are useless without games, and each used to
  show a button that opened a sheet that then asked the question. The first step
  of the form now lands directly on those screens.
- **`auto-refresh.ts`** — a weekly pull on app open (a PWA with no service worker
  cannot wake itself), merging exactly as a manual import would, silent on zero
  or on failure.
- **`import-last.ts`** — the FAB shortcut. Idempotent: a game already held is
  returned as stored, so its analysis, tags and scan data survive.
- **`my-games-screen.ts`** — the library, mirroring My Lines: filter bar
  (colour · result · sort · group · tags), cards rendered in batches that grow on
  scroll.

---

## 16. Accounts, sync, entitlement and payment

**Everything in this section is inert when Supabase is not configured** — which is
the whole internal GitHub Pages build. `isSupabaseConfigured` is false there,
nobody can sign in, and the Account section is not built at all (not a disabled
row — absent).

### 16.1 Auth

`supabase.ts` creates the one shared client (the anon key is public by design;
RLS policies are the real protection). `auth.ts` is the **only** module that
touches `supabase.auth` — sign-up, sign-in, sign-out, password reset, OAuth
returns and email confirmations. `account-ui.ts` is the Settings group; its two
tabs are "Registration" and "Sign in" (not "Sign up"/"Sign in", which differ by
one letter in the middle of a word).

### 16.2 Sync

`repertoire-sync.ts` (network) + `sync-core.ts` (pure, Node-testable — importing
the network half would drag `import.meta.env` into the tests).

**IndexedDB stays the source of truth for every read.** Around it:

- **Push** — every write schedules a debounced upload (~30s after the last edit),
  a pending flag survives a failed attempt, and a fingerprint of what was last
  sent means an unchanged half costs no request.
- **Pull** — on sign-in, on returning to the foreground, and every few minutes.
  Two timestamps answer "has either half moved?" in a few hundred bytes.

Four columns on `profiles` (one row per user, keyed by auth id):

| Column | Holds |
|---|---|
| `repertoire` | **the name lies** — lines *plus* the localStorage snapshot (stats, streaks, ratings, prefs). 0.2–1.3 MB |
| `repertoire_updated_at` | its stamp |
| `games` | the games, split off because a heavy analysed library is 4–20 MB |
| `games_updated_at` | its stamp |
| `entitled` | read by `entitlement.ts`, written by the Stripe webhook |

**A pull always merges; there is no merge-or-replace question.** Repertoires merge
by move (the better review record survives), games merge by id, and the app-state
snapshot cannot merge so it is last-write-wins on its own timestamp, guarded so it
can never overwrite unpushed local changes. What goes up is `gamesForSync()`: the
500 most recent games with saved analysis trees and scan spots stripped (engine
output, derived from moves that *are* synced, and ~80% of the payload). The manual
backup file keeps all of it. Scouted opponents never sync — pure re-fetchable
cache, and the bulkiest thing on the device.

**The known cost: deletions do not travel.** Remove a line on phone A and phone B
hands it back on its next push. The escape hatch is explicit rather than guessed
at: Settings → Data → "Replace this device from the account". Tombstones are in
the Later list.

`signing-in.ts` covers the reload a pull requires (the snapshot is written to
localStorage after modules have already read it at boot) with the same pulsing
icon as the boot splash, so signing in reads as one step rather than a crash.

### 16.3 Entitlement — the free tier

`entitlement.ts` caps **exactly one thing**: how many lines may be enrolled in
training at once. Building and saving lines is unlimited, and so is everything
else — library, packs, traps, studies, import, puzzles, endgames, the engine, the
analyser, statistics and sync.

| Constant | Value | Means |
|---|---|---|
| `FREE_TRAINING_LINES` | 10 | lines in the rotation at once |
| `TRAINING_COUNT_VISIBLE_FROM` | 7 | where the counter starts showing |
| `FREE_REPERTOIRES` | 3 | the two defaults plus one; archived books still count |
| `FREE_MISTAKE_GAME_WINDOW` / `_SPOTS` | 50 / 10 | rolling window and rolling top-N *unfixed* spots |
| `FREE_ENDGAME_GAME_WINDOW` / `_SPOTS` | 50 / 3 | same, for endgames |
| `FREE_SCOUT_OPPONENTS` | 1 | offers to *replace* rather than refusing |
| `FREE_GUEST_IMPORT` | 100 | what a signed-out visitor may import at a time |

Who is entitled: Supabase unconfigured → **everyone** (capping the test channel
would be absurd); signed in with `profiles.entitled = true` → yes; anything else,
including signed-out guests → capped, through the same code path.
`entitlement-cache.ts` keeps the last server answer keyed by user id so a paid
user is not locked out offline — it is **a cache, never a grant**, and is
overwritten (including true→false) on every successful fetch.
`ENTITLEMENT_CHANGE_EVENT` repaints the current view when the answer really
changes (never the builder, which holds unsaved work in the DOM).

### 16.4 Payment

Stripe hosted Checkout, a redirect (`checkout.ts`). The return journey is handled
rather than avoided: `?purchased=1` on the way back, a focus watcher for when
that URL is never reached, and a poll on a backoff because the webhook lands a
moment after the money does. `pricing.ts` fetches the real price per currency
from `GET /api/stripe/prices` — €9 or a round 99 kr, chosen by the *device's
language list*, not by IP, with built-in fallbacks. `pro-sheet.ts` is the offer
popup and deliberately reuses the landing page's wording.

---

## 17. Onboarding, settings and chrome

### 17.1 First run

`onboarding-picker.ts` asks **one question** — which colour — and that is the
whole screen. It used to ask three (colour, depth, style) and hand back a curated
line somebody else chose, which is the wrong first experience for an app whose
point is that the lines are *yours*.

Then `onboarding-tour.ts` runs the builder walkthrough as **coach-marks anchored
beside the real thing they describe**, with everything else dimmed — not a card
stack on an empty screen, because naming "the tabs under the board" while there
are no tabs asks the user to do the matching. The walkthrough survives a Lichess
OAuth round trip (a one-shot, ten-minute stash, read on both the success and the
back-out paths). `onboarding-signup.ts` closes the run: celebrate first, offer an
account second, "Not now" in plain text underneath.

`first-steps.ts` is the Get-started checklist that catches anyone who backed out:
install the app · take the walkthrough · import your games · connect Lichess ·
create an account. Below three saved lines it takes the daily card's slot
outright and leads with the line goal; past the unlock the two swap and it rides
underneath, compact, until hidden or retired.

`onboarding-lines.ts` holds the 8 curated first lines (truncated by *the user's
own moves*, so a cut always ends on a move they have to remember).
`onboarding-starter.ts` holds the starter packs and their picker.

### 17.2 Settings

`settings-screen.ts`, in order: a Go-Pro CTA (free accounts only) · Account ·
Add your games · Lichess connection (prominent until connected, then a quiet
accordion lower down) · Appearance · Repertoires · Training · Daily challenge ·
Data · About. `settings-controls.ts` holds the three row primitives, extracted so
the daily card's gear can reuse them without an import cycle.

### 17.3 Appearance

- **Themes** (`theme.ts`): `classic-light` · `classic-dark` · `elegant` (warm
  casino-felt green) · `gamer` (near-black + neon) · `system`. JS resolves the
  choice to `light|dark|game|gamer` on `<html data-theme>`; **CSS never reads
  `prefers-color-scheme`**. Pre-v1.3 values are migrated on read.
- **Boards and pieces** (`appearance.ts`): 9 board schemes (the default plus 3 flat CSS
  checkers, and 5 photo/pattern textures in `public/boards/`) on `<html data-board>`, 10 piece sets lazily
  loading their own CSS from `src/pieces/`, and a coordinates toggle.
- **Notation** (`notation.ts`): SAN or figurine (`♞f3`), default figurine. One
  `formatMove()` runs everywhere a move is printed.

### 17.4 Shared chrome

`dialog.ts` (bottom-sheet dialog) · `toast.ts` (the one transient pill, with an
optional single action — this is how Undo is offered) · `info-sheet.ts` (the (i)
popups) · `empty-state.ts` · `load-error.ts` (IndexedDB failed + Retry) ·
`fab.ts` (speed dial: New line white/black, and Import last game when an account
is connected) · `run-header.ts` (every exercise overlay's identity + exit) ·
`confetti.ts` / `pixel-pawn.ts` / `count-up.ts` · `sound.ts` (Web Audio, off by
default) · `promotion.ts` · `board-mini.ts` (static SVG miniatures — 50+ per
screen, so no chessground instance) · `card-position.ts` · `position-peek.ts` ·
`wdl-bar.ts` · `icons.ts` (inlined Lucide-style, only what is used) ·
`avatar.ts` · `about.ts` · `legal.ts` · `feedback.ts` (posts to Web3Forms; the
key is public by design and the destination email never appears in the bundle).

`board-brushes.ts` deserves its own line: chessground names each arrowhead
`marker-end: url(#arrowhead-<key>)`, document-globally. With many boards alive at
once, identical keys make an arrow resolve to whichever marker is first in the
document — and if that board is `display:none`, the arrowhead silently
disappears. Per-instance keys fix it.

---

## 18. The anonymous event counter

**`src/metrics.ts` + `worker/metrics.ts` + `POST /api/event`.** One clicker per
named event. It is the only measurement in the app and it is built so that it
*cannot* become anything more.

### What is on the wire

The whole request body is `{"name":"app_open"}` — one string off a fixed list of
sixteen, and nothing else. `readName` in `worker/metrics.ts` rejects an object
with any second key, so a future caller cannot quietly add a field: adding one
means editing that file, on purpose, where it shows up in a diff.

The Worker reads **no** IP, user agent, `Referer`, cookie or `Authorization`
header, and returns no body, so it can neither observe an identifier nor plant
one. The client side sets `credentials: 'omit'` and `referrerPolicy:
'no-referrer'` so the browser doesn't offer either in the first place.

The row written is `(name, day, hits)` — nothing else, ever. **Two visits cannot
be told apart at either end.** These numbers count *events*, never people; any
sentence starting "how many users…" is unanswerable here by construction.

### The sixteen names

| | |
|---|---|
| `install`, `app_open` | reach |
| `return_after_d2` / `_d7` / `_d30` | retention |
| `onboarding_complete`, `starter_pack_added` | did first run work |
| `line_saved`, `drill_completed`, `puzzle_session`, `daily_completed`, `endgame_solved`, `games_imported` | is it being used for what it is for |
| `signed_in`, `signed_up_email`, `purchase_confirmed` | accounts and money |

The list lives **twice** — `ALLOWED` in `worker/metrics.ts` and the `MetricName`
union in `src/metrics.ts` — and is kept in step by hand. The two are separate
builds with separate typechecks; a name that drifts is a 400 and a dropped
count, never a user-visible error. Every name must also satisfy the
`metrics_name_shape` check constraint on the table (`^[a-z0-9_]{1,40}$`).

### `app_open` is cold launches, not sessions

Gated by a `sessionStorage` flag, which belongs to the *document*. Backgrounding
and resuming does not re-count, and neither does a bfcache restore — but Android
evicts a backgrounded PWA's document freely under memory pressure, and resuming
then re-navigates into a fresh document and a fresh flag. So the number is
"launches, plus however often the OS reclaimed the app". **Never read it as a
headcount.** Closing that gap needs a persistent per-device marker, which is
exactly what this feature refuses to have.

### Retention has no cohorts, deliberately

`return_after_dN` fires once ever, on the first launch at least N days after
`obertura.installedAt`. **The sets nest** (`d30 ⊆ d7 ⊆ d2`), so these mean "ever
came back after N days", *not* classic day-N retention. Read as a lagged ratio
against `install` from an earlier period; the lag smears across the boundary.

That imprecision is the price of something specific. The obvious design — naming
the metric `retained_d7:2026-w36` — was rejected: a rotating name cannot sit on
a literal allowlist (so the endpoint becomes writable with unbounded distinct
rows), and at this project's traffic a cohort week with one member is a
pseudo-identifier that follows a device across sessions. Nothing derived from
`installedAt` beyond "a threshold was crossed" ever leaves the device.

### OAuth sign-ups cannot be distinguished from OAuth sign-ins

`signed_in` fires at all four points where a session is actually established
(`auth.ts`): password sign-in, an email link redeemed, an OAuth code exchanged,
and a sign-up that came back with a session. `signed_up_email` fires only in
`signUpWithPassword`.

**There is no `signed_up_oauth`, and there will not be one.** Google/Facebook/
Apple redirect away and come back with a session that looks identical whether
the account is ten seconds or ten months old. Telling them apart means asking
the server whether `created_at` is within a few seconds of now — an extra lookup
on every sign-in, to learn something no decision depends on. **We are
deliberately not doing it.** So `signed_up_email` is a floor on registrations,
not the total, and the gap is however many people use a social button.

`signed_up_email` is `trackOnce`, not `track`: re-registering is the normal
response to a confirmation email that never arrived (see the "Send it again"
dialog in `account-ui.ts`), and counting each attempt would inflate the one
number a registration figure exists to give.

### The three local keys, and why none of them travels

All in `localStorage`, all registered in `local-keys.ts` as never-synced, all
covered by name in `local-keys.selftest.ts`. None is ever *sent* — they are read
to decide whether to send.

| Key | | If it travelled |
|---|---|---|
| `obertura.installedAt` | first launch on this profile | a new phone would count no install and trip all three return milestones on launch one — retention would measure backup restores |
| `obertura.metricsSeen` | once-ever events already spent | a second phone would inherit "already counted" and go silent for life |
| `obertura.metricsOptOut` | the Settings switch | handing someone a backup would silently stop counting on *their* device |

`obertura.metricsSession` is in `sessionStorage`, which nothing in the backup
path walks, so it needs no entry.

### The switch

**Settings → Feedback & about → "Leave me out of the counts."** Off by default,
device-local. It exists because with no identifier there is nothing to filter on
afterwards — the only way for the owner or a tester to stay out of the numbers
is to say so up front, on the device. Built only when `metricsActive()`, so it
never appears on a build that counts nothing.

### Everything fails soft

`worker/stripe-webhook.ts` carries a banner saying the exact opposite; that
reasoning is Stripe-specific and does not apply here. A missing secret, a
Supabase outage and an accepted event all return the same `204`. Once-ever
events are marked spent **before** they are sent, so "once ever" means one
attempt — a failed send is simply lost, which is correct. The only loud response
is `400` on a name that isn't allowlisted, because the only things that produce
one are a bug in `src/metrics.ts` or somebody poking at the endpoint.

`__DEPLOY_TARGET__ !== 'cloudflare'` makes the entire client compile to a no-op,
so the GitHub Pages build (which has no Worker behind it) fires nothing.

---

## 19. Module index

Every non-selftest module in `src/`, exactly once.

### App shell, navigation, chrome
| Module | |
|---|---|
| `main.ts` | the entry point and spine — 6,270 lines; routes every screen and owns the save path |
| `back-nav.ts` | back-gesture / hardware-back handling for the installed PWA |
| `theme.ts` | theme control — five named choices, persisted per device |
| `appearance.ts` | board colour scheme, piece set, coordinates |
| `notation.ts` | SAN vs figurine move notation |
| `icons.ts` | inlined Lucide-style icons |
| `dialog.ts` | the shared bottom-sheet dialog |
| `toast.ts` | the one transient status toast |
| `info-sheet.ts` | the shared "what is this?" popup behind (i) buttons |
| `empty-state.ts` | the one "nothing here yet" pattern |
| `load-error.ts` | the shared "data wouldn't load" + Retry panel |
| `fab.ts` | the floating action button on the main tabs |
| `run-header.ts` | the bar across the top of every exercise overlay |
| `confetti.ts` | the celebration burst |
| `count-up.ts` | numbers that tick up on screen entry |
| `pixel-pawn.ts` | the blocky 8-bit pawn, inline SVG |
| `sound.ts` | optional correct/wrong training tones |
| `avatar.ts` | the small round user avatar |
| `about.ts` | the About sheet |
| `legal.ts` | resolves the public-document URLs per host |
| `promotion.ts` | the pawn-promotion picker |
| `board-brushes.ts` | per-board arrow brushes with collision-proof marker ids |
| `board-mini.ts` | a static SVG board miniature drawn straight from a FEN |
| `card-position.ts` | shared scaffold for any card representing a position |
| `position-peek.ts` | a small popup showing one position on a view-only board |
| `wdl-bar.ts` | the slim win/draw/loss bar |
| `selftest-panel.ts` | the shared "Run X self-test" panel |
| `pieces/previews.ts` | piece-set preview glyphs for Settings |

### Data model and storage
| Module | |
|---|---|
| `repertoire.ts` | **the core** — one move tree per book, and the pure operations on it |
| `lines-view.ts` | repertoires in, `Line[]` out, plus the write-back |
| `tree.ts` | the working tree, its cursor, and the three growth modes |
| `types.ts` | `Line`, `LinePriority` |
| `storage.ts` | IndexedDB — DB `obertura` **v4**; backup/restore, reset, erase |
| `repertoire-migrate.ts` | one-way migration: flat `Line[]` → one tree per colour |
| `repertoire-picker.ts` | making, naming, archiving and removing repertoires |
| `repertoire-join.ts` | transposition joins — "from here, continue as in that line" |
| `position-index.ts` | the whole repertoire mapped by position |
| `save-index.ts` | the pure half of what the index changes about saving |
| `train-index.ts` | the pure half of what the index changes about training |
| `line-removal.ts` | what removing a move will actually do, in numbers and words |
| `line-status.ts` | what a line's card and popup say about it, in one place |
| `line-groups.ts` | groups a line list into collapsible opening families |
| `prefs.ts` | small device-local training preferences |
| `local-keys.ts` | **which localStorage keys may leave the device** — selftest-guarded |
| `backup.ts` | backup & restore UI (format v2) |

### Training, drills and the scheduler
| Module | |
|---|---|
| `scheduler.ts` | the spaced-repetition brain (SM-2), pure, zero DOM |
| `session.ts` | a training session — an ordered queue of lines |
| `drill.ts` | the training session runner — the main drill overlay |
| `train-screen.ts` | the Train → Openings pane |
| `training-goal.ts` | the three-line goal, shared by four screens |
| `pretraining.ts` | enrol a line straight into training with no confirm run |
| `repertoire-run.ts` | one walk through a book, asking each move once |
| `individual.ts` | picks which single positions "Review missed moves" drills |
| `review.ts` | Game Review — a line of moves into a list of judgements |
| `forgotten-moves.ts` | per-window miss log (currently write-only) |
| `forgotten-section.ts` | the "Forgotten moves" block on Train |
| `struggle.ts` | chronic misses — the threshold, the snooze, the counting |
| `struggle-nudge.ts` | the quiet nudge below the board |
| `fix-it.ts` | the three-rep "Fix it" drill |
| `filters.ts` | the reusable two-row filter bar for lists |
| `streak.ts` | the daily-training streak (one day of grace) |
| `progress.ts` | cross-references game results with training progress |

### The daily challenge
| Module | |
|---|---|
| `daily-challenge.ts` | the card, the config, the day's state |
| `daily-prefs.ts` | which parts, how many of each, and in what order |
| `daily-recap.ts` | the day-by-day results log and the recap numbers |
| `daily-review.ts` | reopening a past day |
| `daily-celebration.ts` | the completion popup, and the perfect-day promotion |
| `exercise-identity.ts` | the "from your games" exercises' colours, import-free |

### Exercises built from your own games
| Module | |
|---|---|
| `mistake-scan.ts` | the scan that turns imported games into training material |
| `mistake-autoscan.ts` | the same scan, run quietly in the background |
| `mistake-run.ts` | the Mistake Retry drill overlay |
| `mistakes-screen.ts` | the Middle game pane on Train |
| `brilliant.ts` | Brilliant Moves — the "find it again" source |
| `brilliant-run.ts` | its drill |
| `brilliant-log.ts` | its "come back after a while" store |
| `detective.ts` | Blunder detective — the pure core |
| `detective-run.ts` | its overlay |
| `which-move.ts` / `which-move-run.ts` | the two-move question: pure core, then overlay |
| `eval-chip.ts` | the shared good/bad move comparison chip |
| `grow-line.ts` | Grow your lines — the pure "add one more move" core |
| `grow-panel.ts` | the builder's Grow line tab |
| `grow-log.ts` | which lines have had their turn |
| `middle-log.ts` | rest logs for the two "read your own games" exercises |
| `spot-rest.ts` | one blunder, three doors — the shared rest log |
| `spot-peek.ts` | the results-row popup for those exercises |
| `fixed-sheet.ts` | the list behind the Middle-game pane's "fixed" figure |

### The builder / board / analyser
| Module | |
|---|---|
| `builder-book.ts` | the builder standing inside a repertoire; the draft |
| `builder-panels.ts` | the Library and My-lines slides |
| `builder-import.ts` | the builder's "Import a game" popup — five routes in |
| `builder-info.ts` | one sentence per builder tab, behind the (i) |
| `branch-sheet.ts` | branch actions — a whole subtree at once |
| `draft-sheet.ts` | "what am I actually saving?" — the draft as lines |
| `note-sheet.ts` | writing the note on one move |
| `line-info.ts` | priority + how the line has been going |
| `line-peek.ts` | the whole line in one steppable popup |
| `line-analysis.ts` | the Line-tab analysis block for a loaded game |
| `analysis.ts` | imported games → a coaching report (families, scores, left-theory) |
| `accuracy.ts` | per-player game accuracy, following Lichess's model |
| `winprob.ts` | move classification — pure, deterministic core |
| `move-facts.ts` | SEE and board facts for the classifier's judgement calls |
| `book-check.ts` | "is this move opening theory?" for the reviewer |
| `explore.ts` | the throw-away "where does this go?" board over the drill |
| `manual-game.ts` | "Add a game" — manual entry for My games |

### Engines
| Module | |
|---|---|
| `engine.ts` | Stockfish WASM in a Worker + Lichess cloud; all values white-normalised |
| `engine-panel.ts` | the Engine tab — eval, three walkable PVs |
| `eval-panel.ts` | the docked eval bar's fixed-height 3-best-moves view |
| `remote-engine.ts` | opt-in deep analysis via chess-api.com |
| `lichess-tablebase.ts` | the free Lichess 7-piece tablebase client |

### Opening knowledge
| Module | |
|---|---|
| `openings.ts` | offline opening-name lookups; the `epdKey` convention |
| `book-tree.ts` | the bundled opening book as a SAN-keyed trie |
| `library.ts` | the browsable opening Library |
| `library-explorer.ts` | the playable board over the bundled library |
| `board-explorer.ts` | the chess.com-style opening explorer board |
| `explorer-stats.ts` | the bundled win/draw/loss database |
| `explorer-bands.ts` | rating band ↔ Lichess bucket lower bounds |
| `explorer-level.ts` | "what level does this user actually play at?" |
| `explorer-resolve.ts` | one place to answer "how has this position scored?" |
| `lichess-explorer.ts` | the live explorer client (login-gated; overlay only) |
| `move-stats.ts` | per-move WDL keyed by UCI path from the start |
| `traps.ts` / `traps-screen.ts` | opening traps: pure data, then the pane |
| `study-catalog.ts` | pure logic for the Lichess-study browser |
| `study-browser.ts` | the Packs tab's Lichess studies section |
| `study-import.ts` | Lichess study import — pure PGN helpers |
| `study-sheet.ts` | the study-chapter list, shared by two callers |

### Explore, maps and coverage
| Module | |
|---|---|
| `explore-screen.ts` | the Explore tab — everything you don't have yet |
| `explore-panel.ts` | the builder's Explore slide — three curated moves |
| `repertoire-map.ts` | the zoomable full-colour repertoire tree |
| `map-merge.ts` | merging lines into one map tree — the data half |
| `lines-tree-view.ts` | My Lines → tree view |
| `lines-screen.ts` | the My Lines tab |
| `coverage-gaps.ts` | the replies your repertoire can't answer (pure) |
| `coverage-data.ts` | its impure half — the device, and the explorer budget |
| `coverage-section.ts` | the coverage block on screen |
| `scout.ts` | opponent scouting — the data layer |

### Puzzles and endgames
| Module | |
|---|---|
| `puzzles.ts` | the free Lichess Puzzle API client, and opening mapping |
| `puzzles-screen.ts` | the Puzzles tab |
| `puzzle-run.ts` | the puzzle-solving overlay |
| `puzzle-rating.ts` | the personal puzzle Elo + speed bonus |
| `puzzle-repeat.ts` | the spaced-repetition-lite repeat queue |
| `puzzle-alt.ts` | "is this other move just as good?" |
| `puzzle-log.ts` | device-local record of puzzles solved |
| `puzzle-themes.ts` | the bundled Lichess theme catalogue |
| `endgame-screen.ts` | the End game tab — three pillars |
| `endgame-catalog.ts` | the bundled fundamental-endgame catalogue |
| `endgame-playout.ts` | play a classic endgame out against the engine |
| `endgame-scan.ts` | "from your games" — the endgames you reached |
| `endgame-autoscan.ts` | the same scan, run quietly, second in the queue |
| `endgame-progress.ts` | device-local progress on the Classic list |

### Statistics
| Module | |
|---|---|
| `progress-screen.ts` | the Statistics screen |
| `stats.ts` | pure aggregations, no DOM |
| `stats-charts.ts` | the one line-chart renderer behind every trend |
| `stats-ui.ts` | the small layout pieces the stats blocks are built from |
| `rating-stats.ts` | your current site ratings and their history |

### Game import
| Module | |
|---|---|
| `import-core.ts` | the one import core, shared by both platforms |
| `import-games.ts` | the unified entry point |
| `chesscom.ts` / `lichess.ts` | the two platform sources |
| `import-panel.ts` | the two-step bottom sheet |
| `import-inline.ts` | the boxed form empty states show instead of a button |
| `import-last.ts` | "import my last game" — the FAB shortcut |
| `import-progress.ts` | the pixel-pawn progress bar + facts ticker |
| `import-tier.ts` | the pure "how many games may this person import?" |
| `auto-refresh.ts` | the weekly games auto-refresh |
| `my-games-screen.ts` | the My games tab |
| `lichess-auth.ts` | "Connect to Lichess" — OAuth 2.0 + PKCE, browser-only |

### Accounts, sync and payment
| Module | |
|---|---|
| `supabase.ts` | the one shared Supabase client |
| `auth.ts` | the only module that talks to `supabase.auth` |
| `account-ui.ts` | the Account group in Settings |
| `account-delete.ts` | "Delete my account" — the app half |
| `repertoire-sync.ts` | account sync — the cross-device copy |
| `sync-core.ts` | the sync's pure logic: no Supabase, no auth, no browser |
| `signing-in.ts` | the cover that makes signing in look like one step |
| `entitlement.ts` | the free tier and its caps |
| `entitlement-cache.ts` | the last-known "is this account entitled?" answer |
| `checkout.ts` | the buy flow's app half |
| `pricing.ts` | what the unlock costs, in the reader's currency |
| `pro-sheet.ts` | the Full Access popup |
| `gate.ts` | the beta access gate + install screen (self-contained, removable) |
| `metrics.ts` | the anonymous event counter's app half (§18) — a no-op off Cloudflare |

### Onboarding, settings, feedback
| Module | |
|---|---|
| `onboarding-picker.ts` | the first-run screen — one question, and out |
| `onboarding-lines.ts` | the eight curated first lines |
| `onboarding-starter.ts` | the starter packs and their picker |
| `onboarding-signup.ts` | the sign-up sheet that closes the first run |
| `onboarding-tour.ts` | coach-marks, anchored beside what they describe |
| `first-steps.ts` | the "Get started" checklist at the top of Train |
| `settings-screen.ts` | every device-local preference, grouped |
| `settings-controls.ts` | the three controls every preference row is made of |
| `settings-lightbox.ts` | Settings as a centred lightbox (desktop path) |
| `feedback.ts` | the in-app feedback form |

---

## 20. Bundled data and assets

All JSON in `src/` is **generated** by `scripts/build-*.mjs`. Regenerate;
never hand-edit.

| File | Size | Contents |
|---|---|---|
| `openings-data.json` | 1.3 MB | 12,082 EPD → opening name (CC0 lichess dataset) |
| `openings-library.json` | 1.7 MB | 12,352 library entries (name, ECO, moves) |
| `starter-packs.json` | 64 KB | 6 packs, 62 lines |
| `study-index.json` | 59 KB | 253 Lichess studies, ranked per family |
| `traps.json` | 10 KB | 19 traps in 2 groups |
| `endgames.json` | 6.6 KB | 18 fundamental endgames, all ≤7 pieces |
| `onboarding-lines.json` | 3.4 KB | the 8 curated first lines |
| `puzzle-openings.json` | 2.8 KB | 122 opening → Lichess puzzle "angle" mappings |
| `explorer-stats.json` | **2 bytes** | **currently `{}` — see §23** |

Assets: `src/style.css` (20,485 lines, all of it) · `src/fonts/` (Chakra Petch
700, self-hosted) · `src/pieces/` (one CSS file per piece set, lazily imported) ·
`public/boards/` (5 textures) · `public/icons/` · `public/engine/`
(staged by `copy-engine.mjs`, gitignored) · `public/manifest.webmanifest`.

---

## 21. The Worker, the scripts and the public pages

### `worker/` — the only server-side code

A **Worker**, not a Pages project (`wrangler.jsonc`, `npx wrangler deploy`), so
there is no `functions/` folder and routing is done by hand in `index.ts` — about
ten lines, and the entire cost of not being a Pages project.

`run_worker_first: ["/api/*"]` means only those paths reach the Worker; every
page, script and image is served straight from the static assets in `dist/`.

| Endpoint | File |
|---|---|
| `GET /api/stripe/prices` | `stripe-prices.ts` |
| `POST /api/stripe/checkout` | `stripe-checkout.ts` |
| `POST /api/stripe/webhook` | `stripe-webhook.ts` → `profiles.entitled` |
| `POST /api/account/delete` | `account-delete.ts` |
| `POST /api/event` | `metrics.ts` → `bump_metric` (see §18) |

No CORS headers anywhere, deliberately: all five are called from pages served by
this same Worker's assets, so every call is same-origin.

`/api/event` is the only endpoint that takes `ctx` (for `waitUntil`) and the only
one that fails soft — see §18.

### `scripts/`

| Script | |
|---|---|
| `copy-engine.mjs` | stages Stockfish lite into `public/engine/` — runs before dev **and** build |
| `generate-icons.mjs` | makes the PWA icons |
| `build-openings.mjs` | `openings-data.json` |
| `build-explorer-stats.mjs` | `explorer-stats.json` — **needs `LICHESS_TOKEN`** (build-time only, never shipped) |
| `build-starter-packs.mjs` | `starter-packs.json` (source in `scripts/starter-packs/`) |
| `build-study-index.mjs` | `study-index.json` |
| `build-traps.mjs` / `build-traps-from-lichess.mjs` | `traps.json` |
| `build-puzzle-openings.mjs` | `puzzle-openings.json` |
| `run-selftests.ts` + `register-ts.mjs` + `ts-resolve.mjs` | the headless test runner |
| `probe-sync-limit.mjs` | measures account storage headroom |

### `docs/` — the public static pages

Four hand-written pages — `index.html` (landing), `privacy.html`, `terms.html`,
`licences.html` — sharing `legal.css` and `docs/fonts/`, plus screenshots,
`robots.txt` and `sitemap.xml`. **Nothing generates them.**
`docs/LANDING-COPY.md` is the copy's source of truth: edit there first, then
mirror by hand. `src/legal.ts` resolves the right URL per host.

---

## 22. Build, deploy and test

| Command | What it does |
|---|---|
| `npm run dev` | stage engine, then Vite dev server (LAN-open; `.local` and `dev.bitochess.com` allow-listed) |
| `npm run build` | stage engine → `tsc` → `tsc -p tsconfig.worker.json` → `vite build` |
| `npm run selftest` | the headless data-layer suites |
| `npm run preview` | serve `dist/` |

**The self-tests:** 50 `*.selftest.ts` files; **49 suites run headless**
(`storage.selftest.ts` needs a real IndexedDB and stays phone-only, via
`selftest-panel.ts` in the app). Last measured run: **1482/1482 passed.** They run
under Node's `--experimental-strip-types`, which is why every module they touch
must stay free of DOM, IndexedDB and `import.meta.env` — that constraint is the
reason for most of the pure/impure splits in this codebase.

**Deploy:** pushing `main` runs `.github/workflows/` → build → `cp -r docs
dist/docs` → GitHub Pages (forced into "GitHub Actions" source mode so Jekyll
can't overwrite it). The Cloudflare build is triggered from its own dashboard
with `DEPLOY_TARGET=cloudflare` set there; nothing else differs.

**Versioning (from `CLAUDE.md`, and it matters):** before a risky round —
`npm run selftest` and `npm run build` both pass → bump `version` in
`package.json` → commit just that → `git tag vX.Y && git push origin main && git
push origin vX.Y`. `v0.5` had to be cut to close a ~30-round gap where everything
shipped without a tag, leaving `v0.4` stale as the only restore point. Don't let
that happen again.

---

## 23. Conventions and invariants

1. **The same moves are never stored twice.** Every write of moves goes through
   `repertoire.mergePath`, never a copy.
2. **Four repertoire fields inherit** — `label`, `tags`, `training`, `priority`.
3. **Pure cores are split from their overlays on purpose** so the logic can be
   self-tested without a browser: `detective.ts`/`detective-run.ts`,
   `which-move.ts`/`which-move-run.ts`, `coverage-gaps.ts`/`coverage-data.ts`,
   `grow-line.ts`/`grow-panel.ts`, `repertoire-sync.ts`/`sync-core.ts`,
   `position-index.ts`/`save-index.ts`/`train-index.ts`. **Keep new logic on the
   pure side.**
4. **One position key for the whole app** — `epdKey` in `openings.ts`: the first
   four FEN fields. The bundled datasets are built on it.
5. **All engine values are normalised to white** at the `engine.ts` boundary.
6. **Everything network fails soft.** Offline, a rate limit, a CORS refusal and a
   parse error all return `null` and the caller degrades — but a *silent* degrade
   that could be mistaken for real data is reported (`liveFailed`, `cloudHealth`,
   `describeSyncError`).
7. **localStorage keys are never documented in prose** — they drift. `grep` for
   them; `local-keys.ts` decides what may leave the device.
8. **No third-party requests** beyond the named APIs. No Google Fonts, no CDNs.
9. **Device-local state is never synced** — which book new lines go into, which
   walkthroughs are done, the theme… anything where one phone's choice would move
   another phone's work.
10. **Anything that offers to change several things at once says how many.**
11. **Anything destructive is undoable or asks first** — the commit toast carries
    Undo, removals go through `line-removal.ts`, and the leave-guard offers the
    draft rather than a bare "Discard".
12. **`main.ts` is the only place allowed to be huge and DOM-bound.** New logic
    that could live in a module should.

---

## 24. Known gaps and honest caveats

- **`src/explorer-stats.json` is empty (`{}`).** The bundled win/draw/loss set has
  never been generated on this checkout, so `bundledStats()` always returns null
  and every explorer number today comes from the live Lichess overlay (which is
  login-gated) or from nothing. Regenerating it needs `LICHESS_TOKEN` and egress
  to `explorer.lichess.org`. Everything downstream — the Library slide's graphs,
  `explorer-resolve.ts`, coverage's off-budget rows — is written to cope, but
  reads thinner than intended.
- **Deletions don't sync.** Lines and games merge, so removing a line on one phone
  leaves it on the other. Escape hatch: Settings → Data → "Replace this device
  from the account". Tombstones need per-line `updatedAt` plus a remembered
  deleted-id list — design note in `PUBLISHING.md`.
- **No service worker, so no offline.** `index.html` is deliberately uncached to
  keep the shell fresh, `auto-refresh.ts` can only run when the app opens, and
  "true background sync" is parked.
- **`forgotten-moves.ts` is write-only.** Nothing reads `mostForgotten` /
  `forgottenSlides` today.
- **The beta gate is a speed bump, not security.** Codes are checked against
  SHA-256 hashes baked into the bundle; a developer can read the JS and bypass it.
  Accepted trade-off, and it is absent from the public build entirely.
- **Two hosts are unreachable from the build/preview container**
  (`lichess.org`, `api.chess.com`, `tablebase.lichess.org`), so the import,
  explorer, tablebase and puzzle paths can only be exercised **on the phone**.
  Their parsers are covered offline by self-tests.
- **Lichess study import drops side variations** (`variations=false`). Studies
  laid out one line per chapter import fully.
- **Currency is guessed from the device's language list**, not from IP. A Swede
  whose phone is in English is quoted €9 and charged €9 — a fine outcome, just
  not the friendliest one.
