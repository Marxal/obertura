# Obertura — roadmap

A personal chess-openings trainer (a focused Lotus-style clone, openings only),
built as an installable PWA. See `CLAUDE.md` for the project guide and the
phase-by-phase build order.

Status key: ✅ done · 🔜 next · 💤 later

> **Renumbering note (June 2026):** The project has moved from an internal v1.x
> scheme to a public v0.x beta scheme. Conceptually: v1.0→v0.1, v1.1→v0.2,
> v1.2→v0.2, v1.3→v0.3. Old git tags (`v1.0`–`v1.3`) are left intact; new
> releases are tagged `v0.x`.

---

## v0.4 — beta polish round ✅

A wide polish round on top of v0.3: first-run onboarding, a clearer Explore vs
Statistics split, a unified builder, a much larger opening library, opening
traps, a friendlier import/scouting flow, and the app's first public landing
page. The `v0.3` tag was the restore point for the whole round. The summary
below is grouped by area; only Phase 6 was tracked as a distinct numbered phase
in the plan, so the rest is recorded by theme rather than by phase number.

- ✅ **Onboarding & first run** — a first-launch flow that seeds starter packs
  and game-based line suggestions (gated at six lines / six packs, packs
  collapsed by default, mini-boards and footer routes).
- ✅ **My Lines (Phase 2)** — group My Lines by opening family, Save-as-new on
  edit, and a shared two-row filter bar (icon-only sort + group-by-opening)
  rolled out across the line lists.
- ✅ **Builder & engine** — unified the library / games / scouting sources into
  the builder behind tabs, a builder carousel (and fixed the engine-toggle board
  shift), engine eval confined to the Engine tab, deeper online continuations in
  the Library board explorer, and fixed the engine showing raw `e8h8` instead of
  O-O.
- ✅ **Opening library & master games** — dropped the FIDE master-games
  integration in favour of growing the bundled opening library ~3×, with a
  dedicated master-games board explorer that shows real games from a position
  and a live game-count badge.
- ✅ **Opening traps** — added Opening traps to Explore (relevance-ranked packs
  and puzzles), led Explore with a Recommended | Traps split, and pared the trap
  cards down to a "build a line" action.
- ✅ **Phase 6 — Explore vs Statistics** — moved the opening **Maps** (your
  repertoire + your games) out of Statistics and into the Explore tab, with the
  data wiring carried over intact. Set the agreed Explore order: Opponents →
  Maps → Opening library → Build with the engine. Statistics now stays about
  progress (streak, stats, win-rate, needs-attention, opening detail). Plus an
  Explore/Scout polish pass: library moved to the top, slimmer opponent cards, a
  scouting report, board perspective fixes, and miniatures.
- ✅ **Import & scouting flow** — a full-screen import loader with your profile
  picture and a review graph, carried into opponent scouting; named the scouted
  opponent instead of "their"; and a Spar → Open-in-builder hand-off.
- ✅ **Training feel** — split training into rounds to bank progress
  mid-session, dropped the in-session "second look" resurfacing, and made the
  finish screens more playful/gamified.
- ✅ **FAB** — a floating action button with quick create/import actions and a
  readable backdrop.
- ✅ **Landing page & Settings** — the app's first public landing page (with
  README and an About-sheet link) and a redesigned Settings screen (accordion
  groups, scouting toggle, dual-platform import, pinned Add-your-games).
- ✅ **Release** — full self-test (108/108) + production build pass, version at
  `0.4.0`, and the `v0.4` tag.

_Restore point: tag `v0.4`. Shipped._

---

## v0.5 — small improvements round 🔜

A batch of focused UX refinements across Games, Lines, Train, Statistics and the
PWA shell, plus a new daily-challenge feature. Shipped in three sessions; `v0.4`
is the restore point for the round.

- ✅ **Session 1 — card polish, close prompt, PWA shell, puzzle repeats.**
  My Games cards now match the My Lines miniature size, carry a thin won/loss
  border, show a numeric date (`23/06/2026`) on its own row, tuck delete into a
  corner, and drop the sort + Won/Lost/Drew controls (colour + group only). The
  game analyser no longer prompts "Save…" when an untouched game is closed (only
  your own variations make it dirty; the auto-review's classifications are
  excluded from the check) and the prompt is now game-aware. My Lines cards swap
  the eye for an edit pencil in the title row and move delete onto the training
  row. Added `overscroll-behavior` to stop pull-to-refresh reloads, a boot splash
  (app icon) that replaces the first-paint "Loading…", and widened the puzzle
  seen-ring + retry count so puzzles repeat far less often.
- ✅ **Session 2 — Train redesign, daily challenge, success screens.**
  The Train screen drops its day-streak pill (the streak now lives on the new
  card), leads its mode list with Time attack, drops the due-count badge from
  Review missed moves, and hides the "due now" hero entirely when nothing's due.
  A new **daily challenge** card sits above the Openings/Puzzles tabs: two tasks
  — 3 lines to remember (due-first, topped up) and 5 rated puzzles (the Daily
  Rated Mix engine, capped at 5) — with the streak alongside; once both are done
  it shrinks to a "done — keep training ✓" line. Every training mode's success
  screen now lists the **openings reviewed** with correct/incorrect in the
  puzzle-results style (faded, one screen).
- ✅ **Session 3 — Statistics overhaul.**
  The training region is now titled **Openings**. A new **most-forgotten-move**
  card shows a board for the move you've missed most this week (fed by a small
  device-local miss log written during line and single-move drills). The puzzle
  rating block gains a 4th **Best run** box (longest clean rated streak), and
  **tapping a day** on the rating line now swaps the rating / solved / accuracy
  boxes to that day. Beating your best clean run is announced on the puzzle
  results screen. The remembered-moves graph overlays a small **"lines added"**
  marker per day (with a legend), so a recall dip reads as fresh material rather
  than real forgetting.

- ✅ **Forgotten-moves carousel + "Fix it" drill.**
  The most-forgotten-move board moved off Statistics and onto the **Openings**
  screen, below Practise, as a swipeable **carousel** with a slide per time
  window — **Today / This week / All time** (fed by the device-local miss log,
  now with an all-time tally). Each slide is a full-width board (honouring the
  section margins) with an **arrow on the move**, then the move, its opening, the
  miss count, and a **Fix it** button. Fix it runs a playful repeat drill: load
  the board, play the opponent's move in, you play the move, the board fades and
  the move shows in big written notation, repeated **three times**, then "now
  play the full line" chains into the full line when the move belongs to one.

_Restore point: tag `v0.4`. In progress on `claude/games-training-ui-improvements-wblxc7`._

---

## v1.0 — the working trainer ✅

The first end-to-end version: build lines, save them, train them with spaced
repetition, and look at your games.

- ✅ **Phase 1** — board on the phone (chessground + chess.js + PWA shell)
- ✅ **Phase 2** — repertoire builder: move tree, clickable move list, save to
  IndexedDB, opening names, My Lines screen, branch view, playback
- ✅ **Phase 3** — training + SM-2 spaced repetition: pre-training gate, drill
  loop, wrong-move behaviour, move notes, scheduler, end-of-session summary,
  training on/off per line
- ✅ **Phase 4** — Stockfish 18 lite WASM engine: eval bar + top-moves panel
- ✅ **Phase 5** — plain-language "why this move" explanations, engine-graded
- ✅ **Phase 6** — Chess.com import (Published-Data API) + Progress tab

_Restore point: tag `v1.0`._

---

## v1.1 — redesign & polish ✅

A design-token theming pass and a thorough product polish on top of v1.0.

- ✅ **1.1** design-token theming foundation + light/dark/auto switch
- ✅ **1.2** component styling pass — cards, buttons, icons
- ✅ **2.1** bottom tab-bar navigation
- ✅ **2.2** Home "Today" dashboard
- ✅ **3.2** My Lines — per-colour carousels merged with the detailed list
- ✅ **4.2** bundled offline opening-name database (dropped the Lichess token)
- ✅ **4.3** builder — tag chips + move step/jump navigation; Save in the header
- ✅ **5.2** individual-moves training mode
- ✅ **5.3** practice picker + good-alternative explorer
- ✅ **5.4** timed mode, end-of-session review, watch-line polish
- ✅ **6.x** Statistics screen redesign + repertoire map
- ✅ **7.1** repertoire backup & restore (export / import JSON)
- ✅ **7.2** Settings screen — Appearance, Training, Naming, User, Data; theme
  toggle moved out of the header into a user-icon → Settings flow

_Restore point: tag `v1.1`. Shipped._

---

## v1.2 — structure, scouting & shine ✅

A bigger round than v1.1: a foundations sweep, a navigation restructure around
training, an Explore tab that turns imported games into preparation, and a
trimmings phase to round the app off. Built in four phases, in order. The v1.1
tag was the restore point for the whole round.

### Phase 1 — Foundations ✅

Get the house in order before adding rooms. No new product surface; this phase
is about correctness, consistency, and the visual baseline.

- ✅ **Code audit & critical fixes** — a read-only pass over the codebase to
  find real bugs and fragile spots, then fix the critical ones and add new
  self-tests so they stay fixed.
- ✅ **Design-system pass** — a consistent component & spacing system: shared
  card / button / chip / list patterns and a single spacing scale applied
  across screens.
- ✅ **Dark-mode retune** — a warm-charcoal dark theme (away from the cold grey)
  with a contrast audit so text and controls meet legibility targets.
- ✅ **Feedback colours** — replace generic green/red with a sage (right) and
  brick (wrong) pair used consistently for training and validation feedback.
- ✅ **Two small visual fixes** — a pair of targeted layout/visual corrections
  carried over from v1.1 use.

### Phase 2 — Structure ✅

Re-centre the whole app on training and tidy the flows around it.

- ✅ **Today retires** — drop the "Today" dashboard tab.
- ✅ **Four tabs** — Train / Lines / Explore / Stats, with **Train** as the
  home tab.
- ✅ **Train hub redesign** — mode cards, a filterable training list, and
  1 / 3 / 5-minute timed personal bests on the hub.
- ✅ **Drill screen** — a centred drill-screen layout.
- ✅ **Builder bottom control bar** — move the builder controls into a bottom
  bar, with annotation-symbol chips (!, ?, !?, etc.).
- ✅ **Flow guards** — a save-to-training dialog, a builder leave guard, and a
  training abandon guard so work and sessions aren't lost by accident.

### Phase 3 — Explore ✅

Turn games into preparation. The Explore tab is the new home for import,
scouting, the opening library, and engine sparring.

- ✅ **Unified import** — one Chess.com + Lichess import with date/colour
  ranges and a scan step before committing.
- ✅ **Opponent scouting** — scout up to 10 opponents, build auto repertoire
  maps from their games, and a **Prepare** flow that produces opponent-tagged
  lines.
- ✅ **Opening library** — a browser over the bundled opening book.
- ✅ **Engine sparring** — create lines by sparring against the engine.

### Phase 4 — Trimmings ✅

The finishing layer that makes it feel like a real, shippable app.

- ✅ **Feedback & About** — an in-app feedback form and an About screen with
  open-source licenses.
- ✅ **Piece sets** — four selectable piece sets.
- ✅ **Position miniatures** — small board thumbnails on line cards.
- ✅ **Statistics polish** — another pass on the Stats screen.
- ✅ **Full app reset** — a complete wipe-and-start-over option (Settings →
  Data → "Erase everything"): a two-step confirm that backs up on request,
  then wipes every store and preference back to a first-launch state.
- ✅ **Tag v1.2** — cut the v1.2 restore point.

_Restore point: tag `v1.2`. Shipped._

---

## v1.3 — refinement round ✅

A nine-phase round that tightened the visual language, made the builder and
train hub tell the truth, deepened Explore and engine-assisted building, and
finished with onboarding and a release pass. Built in order. The `v1.2` tag was
the restore point for the whole round.

- ✅ **Phase 0 — Safety & dead wood** — cut the `v1.2` rollback tag, swept the
  dead controls (inline self-test links, the Paper-texture toggle), and fixed a
  dead back-navigation zone in training (the exit became "End session").
- ✅ **Phase 1 — Visual language** — swapped the oxblood primary for felt green,
  reworked themes into a four-option picker (added the Game theme), and flattened
  listings into individual cards on a bare page with tidy carousel edge insets.
- ✅ **Phase 2 — Builder truth** — the builder now saves exactly one line
  (divergent edits truncate the tree), notes are purely manual, annotation marks
  live in the note sheet, and the eval reads honestly (winning-chances bar,
  depth-20 progressive fallback, source badge).
- ✅ **Phase 3 — Train hub** — a compact two-stat hero, a shared two-row filter
  bar rolled out everywhere, and pause/resume via a switch that flips the card in
  place (with Show paused) instead of a page jump.
- ✅ **Phase 4 — Explore & scouting** — a library-first slim landing,
  informative opponent cards with a three-way delete, a dossier detail with
  W-D-L bars throughout, a scouting report (weak/strong openings + what to play),
  deeper repeatable maps with per-move stats and a Go deeper control, a Board
  explorer, and a games map on Statistics.
- ✅ **Phase 5 — Build with the engine** — a persisted opening-mode picker
  (Surprise me / From my games / Pure engine) so the engine opens like a human,
  plus a default-off Engine toggle (eval bar/panel + candidate arrows) and a
  Suggest control (Solid · Aggressive · Random) that only ever plays a vetted,
  non-blundering move.
- ✅ **Phase 6 — Statistics** — reordered the screen, switched the activity grid
  to weekday letters, and made the heatmap full-width.
- ✅ **Phase 7 — Onboarding & empty states** — a first-launch intro walkthrough
  and pedagogical empty states across the four main screens.
- ✅ **Phase 8 — Settings & release** — regrouped Settings (dropped Naming,
  folded in Diagnostics, switch rows), added weekly games auto-refresh, and cut
  the release: full self-test + build pass, version bump, and the `v1.3` tag.

_Restore point: tag `v1.3`. Shipped._

---

## v1.4 — seeds (parked) 💤

Deliberately parked during the v1.3 round; revisit once v1.3 has had real use on
the phone.

- 💤 A fourth board/app theme.
- 💤 Map transpositions (merge positions reached by different move orders).
- 💤 True background sync via a service worker.
- 💤 Deeper engine adaptation.

---

## Later 💤

Deliberately deferred. Revisited once the app has had more real use on the phone.

- 💤 Accounts / sync (Google Drive sync for the repertoire backup, etc.)
- 💤 Monetization build-out
- 💤 Offline support (service worker / installable cache)
- 💤 Deeper engine features and richer explanations
- 💤 More opening-database coverage and naming
