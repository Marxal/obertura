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

## v0.4 — beta polish round 🔜

In progress. This round's scope is confirmed before work begins on each phase.
The `v0.3` tag (formerly `v1.3`) is the rollback point for the whole round.

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
