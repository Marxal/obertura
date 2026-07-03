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

## v0.6 — cloud backup & publishing groundwork 🔜

The first "leave the device" round: the existing backup file learns to keep
itself in the user's own Google Drive, and the publishing question (stores,
one-time payment, desktop) is answered in writing. Still no server anywhere.

- ✅ **Google Drive cloud backup** — a "Cloud backup — Google Drive" section in
  Settings → Data: connect (OAuth popup, hidden app-data folder — the app can
  never see the user's real files), Back up now, Restore from Drive (the usual
  merge-vs-replace chooser), an auto-backup toggle (debounced upload ~30s after
  any repertoire change, wired via a storage-layer change notifier), and a
  last-backed-up caption with a "pending" state when an upload fails quietly.
  Connecting on a fresh device offers to restore an existing cloud backup
  before anything is uploaded. Inert until a (free) Google OAuth client ID is
  pasted in — the click-by-click setup is `DRIVE-SETUP.md`. This also gives
  manual cross-device sync (back up on the phone, restore on the desktop PWA).
- ✅ **Publishing guide** — `PUBLISHING.md`: the full options analysis (Google
  Play via a Trusted Web Activity as the recommended paid one-time-payment
  route, Microsoft Store as an optional desktop storefront, Apple deferred with
  its honest cost/rejection caveats, web-only sale as the fallback), the
  free-web-vs-paid-app pricing stance, the step-by-step Play checklist with its
  gotchas (12-testers/14-days closed test, root `assetlinks.json` repo,
  free-can-never-become-paid), and the design note for true automatic sync
  (per-line `updatedAt` + deletion tombstones) so a later round starts from a
  design rather than from scratch.

_In progress on `claude/app-backup-sync-publish-90talj`. Restore point: `v0.4`._

---

## v0.7 — mistake retry round 🔜

Training leaves the repertoire and reaches into your own games: Train becomes
a 2×2 grid of game modes, and the new Mistake Retry mode drills the exact
positions where your imported games went wrong.

- ✅ **Train tab grid** — the Train screen's two tabs become a 2×2 grid of
  taller, game-mode style buttons (icon tile on top, per-mode accent colour
  when active, cyan halo in Gamer): Openings, Puzzles, Mistake retry, End
  game. End game is a "coming soon" placeholder card for a later round.
- ✅ **The mistake scan** — a user-triggered "Analyse my games" pass (newest
  first, cancellable, resumable — every finished game is saved) walks each
  game with the Lichess cloud first and the local engine on misses, grades
  your moves with the same win-probability model as Game Review, re-checks
  candidates at the analyser's depth and stores the engine's top-3
  continuations on the game record. Four categories: opening blunders (lost
  the game in the opening), punish the opening (chances the opponent handed
  you), missed wins (~+2.5 thrown away), and plain game-losing blunders from
  level positions. Re-imports no longer overwrite stored games (this used to
  silently wipe saved analysis/tags — now the stored copy always wins).
- ✅ **The retry drill** — puzzle-style sessions of 5: the position as you had
  it, your actual move as a red arrow, "You played … here and …", a two-stage
  hint, instant checking against the stored top-3 (live engine as backup),
  badge + confetti on a clean find. You advance by hand: before "Next
  position" the engine's three continuations are laid out, and "Review game"
  steps through the whole game inline (move strip, eval readout, jump to the
  full analyser). Answered spots persist immediately; the pane shows spots
  found / fixed / games analysed and per-category cards with to-fix counts.
- ✅ **Daily challenge, task four** — "3 mistakes to fix" (a mixed pick) joins
  the card once spots exist, and every daily task's success screen now leads
  with "Next task →" so the whole daily runs in one sitting; "Close session"
  stays beneath.

_In progress on `claude/mistake-retry-training-vn7p3y`. Restore point: `v0.4`._

---

## v0.8 — general fixes round 🔜

A grab-bag of fixes and polish across the app, driven by real phone use.

- ✅ **Retry drill: instant answers, lean after-screen** — answers are judged
  on the spot against the stored top-3 (any of the three counts; a non-#1 gets
  "Good move ✓ — even stronger: ♞f3" with the #1 drawn as an orange arrow) —
  no live engine call, so feedback is immediate. After answering: just "Open
  full analysis" and "Next position" (the second-pass revision dropped the
  in-drill eval bar / move list / free play as too much). Full analysis opens
  the game *at the drilled position*, without auto-starting a review; the
  header swaps Save for a "Back to train" button and drops the opponent name,
  and that button (or the builder's back arrow) resumes the session exactly
  where it was.
- ✅ **Retry drill: compact one-screen layout** — opponent on top, the opening
  as its own small quiet row, and a one-line story ("You played ♞f6 ?? here and
  blundered.") with the played move on a red chip carrying its ?? / ? symbol.
  A discrete eye toggle beside the prompt hides the red arrow for the current
  position only.
- ✅ **Retry results: tappable rows** — each row of the session-complete list
  pops the position up (played move red, engine's answer orange) with an
  "Analyse game" button into the full analyser.
- ✅ **Faster game scan** — the trail pass now runs MultiPV 1 (≈3× less local
  search), stops asking the Lichess cloud after 3 consecutive misses (the game
  has left known territory — no more wasted round-trip + politeness delay per
  middlegame ply), and caps the scan at 80 plies. The scan overlay reuses the
  import wait's facts ticker and says up front it can take a while.
- ✅ **Faster game analysis (the "seconds → minutes" regression)** — two
  engine-wide guards: a Lichess-cloud circuit breaker (three consecutive
  failures or one 429 rate-limit pause all cloud calls for a cooldown, so a
  throttled connection no longer burns a fetch timeout on every single
  position before falling back), and a hard 1.5 s time budget on each local
  fallback search (a phone's depth-12 middlegame search could eat 6 s per
  ply). Cloud fetch timeout tightened 4 s → 2.5 s. Applies to the Game
  Review, the mistake scan and the eval panel alike.
- ✅ **Full backup** — backup files (manual and Drive alike, format v2) now
  carry the imported games (with their scan spots and saved analyses) plus the
  stats/streaks/puzzle-rating/preferences snapshot, and restoring one reloads
  the app exactly where it was left. Old v1 files still restore.
- ✅ **Mode identity** — each Train tab washes the pane background with a very
  subtle tint of its accent, and the exercise overlays follow (openings =
  accent, puzzles bronze, mistakes ember). Openings tab icon is now the pawn;
  the due-now card's button is "Refresh lines" with a brain icon (caption
  dropped).
- ✅ **Tags: reuse what exists** — the tags sheet lists every tag you've
  already created as tappable chips (suggested chips stay), so reusing a tag
  never means retyping it.
- ✅ **Notation fix** — parenthesised variations in the analyser's move list
  now wrap like the main line instead of forcing horizontal scroll.

---

## v0.9 — retry analysis & organisation round 🔜

Thirteen fixes/features from phone use: smarter analysis reuse, clearer engine
status, and denser list organisation.

- ✅ **Retry drill after-buttons** — "Open full analysis" is now "Analyse" with
  the analysis icon, and both post-answer buttons share one height/shape.
- ✅ **Scan: live Lichess status** — the analyse-games overlay shows whether the
  Lichess cloud is answering (green), rate-limited (amber — the on-device
  engine covers for a minute) or unreachable (red).
- ✅ **Scan reuses saved analyses** — games already reviewed in the analyser
  seed the scan's eval cache from their stored per-move evals, so analysed
  games (and openings they share) scan far faster.
- ✅ **Analyser: auto-stored reviews** — a finished review writes itself onto
  the game record (reopening restores it, and the mistake scan reuses it);
  "Save game" now greys out until there's something of *yours* to save
  (variations, notes, tags).
- ✅ **Facts ticker** — sentences type and hold noticeably slower, and the
  import parser now yields to the UI so the ticker no longer freezes
  mid-sentence during a big import (it only ever worked smoothly on the
  mistake scan, whose heavy work lives off the main thread).
- ✅ **Latest mistakes carousel** — the Mistake retry pane gets a forgotten-
  moves-style board carousel: the newest unfixed spot per category, played
  move as a red arrow + red chip story line, "Fix it" (drills exactly that
  position) with a quiet "find the best move" hint. Nav is four icon-only
  tabs with the category name below.
- ✅ **Train list: collapsible + branch pause** — "In training" collapses
  behind its header (collapsed by default), and grouped views carry a pause
  control per branch header that takes the whole family out of rotation
  (with a confirm).
- ✅ **Compact grouping everywhere** — the group toggle now cycles flat → by
  opening family → compact (by full variation name, narrower buckets), on
  Train, My Lines and My games alike.
- ✅ **Puzzles → analyser** — after a puzzle, a discrete "Analyse position"
  (analysis icon) opens the game + solution in the analyser, landing straight
  on the Engine tab at the puzzle position, with the same "Back to train"
  suspended-session hand-off as the mistake drill.
- ✅ **Daily puzzles ladder** — the daily challenge's three puzzles now run
  easy → medium → hard, one Lichess difficulty band below / at / above your
  rating's own band.
- ✅ **Game tags** — the tags sheet now offers tags you've used on games, not
  just on lines.
- ✅ **Stats carousels** — "Remembered moves over time" and "Puzzle rating"
  swipe horizontally between Week / Month / All (the chips stay as the
  indicator).
- ✅ **Drive popup fix** — background auto-backup no longer triggers the Google
  sign-in screen mid-app: it only uploads while a session token is live, and
  otherwise stays quietly "pending" until Settings is opened.

---

## v0.10 — end game training round 🔜

The End game tab stops being a placeholder. First round of a multi-part module:
the two pillars that stand on their own (no imported games needed), leaning on
Lichess's free endgame data.

- ✅ **Endgame puzzles** — rated Lichess puzzles filtered to endgame themes
  (All / Rook / Pawn / Queen / Minor piece → the `endgame`, `rookEndgame`,
  `pawnEndgame`, `queenEndgame`, `bishopEndgame`/`knightEndgame` angles),
  reusing the whole puzzle-solving engine. They ride their OWN rating ladder,
  separate from the openings puzzle rating (a `scope` on `puzzle-rating.ts`),
  so endgame skill is tracked on its own.
- ✅ **Classic endgames** — a curated, bundled list of the fundamentals (basic
  mates, key pawn / rook / queen / minor endings) grouped by theme and level.
  Load one and play it out against the local Stockfish engine. The Lichess
  7-piece **tablebase** is the ground-truth judge: it reads the position's true
  result up front (your target), refuses any move that throws it, and feeds the
  engine the optimal defence so the technique is really tested. Everything fails
  soft — offline (or in the build container, where the tablebase host is
  blocked) you simply play it out and the final result is judged. Progress is
  ticked per position; "Reset progress" and backups cover it.
- 🔜 **From your games** (later round) — mine the endgame phase from imported
  games and surface the ones you drifted in, forgotten-moves style.
- 🔜 **Annotated studies** (later round) — pull endgame studies via the Lichess
  study-export API for real commentary.

_On `claude/endgame-training-module-tm2n1n`. Restore point: `v0.4`._

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

- 💤 True automatic sync (Drive *backup* shipped in v0.6; auto two-device sync
  needs per-line `updatedAt` + deletion tombstones — design note in `PUBLISHING.md`)
- 💤 Monetization build-out (options and recommended path now in `PUBLISHING.md`)
- 💤 Offline support (service worker / installable cache)
- 💤 Deeper engine features and richer explanations
- 💤 More opening-database coverage and naming
