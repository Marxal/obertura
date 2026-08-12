# Bito Chess — roadmap

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

- ✅ **Chronic-miss notes + forgotten-move statistics.**
  Closing the loop on moves that never stick. Once a user move has been missed
  **six times** (`review.lapses`, so timed mode — which never grades — can't
  trigger it), full-line training makes one offer, and only one per line:

  - **No note yet.** You miss it, the arrow reveals it, you replay it — and only
    then does a sheet slide up: _"You keep missing this move · ♞f3 · missed 6× ·
    Write a note. It'll show up the next time you slip."_ with **Not now** /
    **Save note**. Dismissing stamps a snooze on the move, so the next ask waits
    four more misses (6 → 10 → 14) rather than returning next session.
  - **A note exists.** The reveal already showed it; now the note card also
    carries **Fix it**, which runs the three-rep drill and then replays the whole
    line from move 1. Opt-in, so ignoring it costs nothing.

  Statistics gains a **Forgotten moves** section in the Openings region, with two
  tabs: **Moves** (most-missed moves, each with its miss count, a note marker and
  its own Fix it) and **Lines** (per-line recall, weakest first). Recall — not
  "accuracy": the scheduler keeps no lifetime attempt count, so the honest figure
  is the share of a line's drilled moves remembered at their last drill, and the
  caption says so.

  New pure module `struggle.ts` owns the threshold and the snooze (self-tested);
  the note sheet was lifted out of `train-screen.ts` into a shared `note-sheet.ts`
  rather than duplicated.

- ✅ **Making it discrete, and the statistics visual.** The follow-up round on
  the above, after the first cut proved too pushy.

  **The nudge, not a dialog.** The write-a-note prompt was a sheet over the board
  with an auto-focused textarea. It's now a quiet strip that slides in *below*
  the board (`struggle-nudge.ts`): it never covers the position, never opens the
  keyboard on its own, and the drill carries straight on underneath it — no
  pause. **Flick it sideways** to throw it away, or tap ×; either stamps the
  snooze. Tapping **Note** swaps in the textarea, and only then does the keyboard
  appear. If the move you keep missing is the line's *last* move, the results
  screen waits for the box rather than yanking it away (capped, so a
  put-down phone still finishes). The note card itself now animates in on reveal —
  the note arriving is the moment, so it should read as arriving.

  **Statistics you can see.** Both tabs went from text rows to visual ones: every
  forgotten move carries a **position miniature** and a **miss bar** scaled
  against the worst move on the list, so the ranking reads before any number
  does; every line carries a **segmented memory bar** (solid / slipping /
  untrained) in the Move-memory donut's own colours.

  **And you can open them.** Tapping a move opens the **position** on a board
  with its arrow drawn and its note underneath (Fix it · Drill line). Tapping a
  line opens the **whole line**: its recall / drilled / misses figures, a board
  you step through, and the full move list where each of your moves shows its
  miss count and a bar — the opponent's replies stay muted, because only your
  moves are ever scheduled. It opens on the worst move in the line.

  Two popups were extracted rather than duplicated: `position-peek.ts` (shared
  with the training results rows — quizzing hides the move behind Hint, reviewing
  draws it at once) and `line-peek.ts`.

- ✅ **Forgotten moves lands on Openings; the board holds still.** The tidy-up
  round.

  **The board stops for the nudge.** It no longer plays the opponent's reply
  underneath the box: the position freezes exactly as you left it — your move
  played and still highlighted — and the line resumes only once the box is gone.
  That also retired the special case for a chronic move landing on a line's last
  move, since the advance itself now waits.

  **The section moved to Train → Openings**, replacing the old per-window
  (Today / This week / All time) board carousel, and left Statistics. The
  "Needs work" quick-stat box there opens the same list, so the rows behave
  identically in both places. `forgotten-moves.ts` keeps recording — it holds the
  one thing `lapses` can't answer, WHEN a move was missed — but nothing reads it
  today; a recency view can be rebuilt later without starting from zero.

  **Times trained.** A recall percentage needs a denominator: 50% over two runs
  is not 50% over twenty. `Line.timesTrained` counts full runs (line completion
  only — the positions modes grade single moves, not lines) and shows as a
  **runs** figure in the line popup and "trained N×" on each row. Lines drilled
  before the counter existed fall back to a floor derived from their review
  blocks rather than reading a flat zero.

  **Two bugs fixed.** The line popup's board rendered *squashed* — an
  aspect-ratio child inside a `max-height: 85vh` flex column, so a long move list
  shrank it off square (measured 280×258) and chessground laid the pieces on a
  non-square grid. And the run counter double-counted its own run when falling
  back to the estimate, because grading moves the very review blocks the estimate
  reads.

  Board miniatures on the rows now match the saved-line cards
  (`clamp(88px, 30vw, 116px)`), and honour the same "show line miniatures"
  Settings toggle. The shared furniture both screens draw — section card,
  segmented row, sheet — moved to `stats-ui.ts` so neither has to import the
  other.

- ✅ **Ask at the arrow; give every number a denominator.**

  **The nudge moved to the reveal.** It used to wait until you'd replayed the
  move; it now arrives *with the arrow*, on the second miss — you're looking
  straight at the move you keep forgetting, which is the moment to say why. Write
  a note if you want, then play the highlighted move to carry on; playing it is
  what sees the box off. Nothing is frozen or held any more, because the drill is
  already waiting for you at that point.

  **Attempts, everywhere.** A miss count alone can't be read: 9 misses out of 9
  is a different move from 9 out of 40. Every move row now says
  **"missed 9 of 24"**, and its bar is **green (recalled) / red (missed)** in
  proportion — the same language the Lines view already used. Nothing records
  attempts directly, so `moveAttempts` takes the larger of two floors: the line's
  run count (a full run asks every user move once) and the move's own
  `reps + lapses` (which also catches single-position drills, that grade a move
  without touching the line count). It can never read fewer attempts than misses.

  *Caveat worth knowing:* on a line drilled before `timesTrained` existed, both
  floors are conservative, so a much-missed move can read "9 of 9 · 0% recall"
  when the truth was kinder. It self-corrects as you train — from this release the
  run count is exact.

  **The move lightbox got the rest of what we know:** four figures — *recall*,
  *misses*, *asked*, and *in a row* (clean recalls right now, the one
  forward-looking number: is it recovering, or still going) — plus a footnote
  with the opening and when it next comes round, above the note and the
  Fix it / Drill line actions. The figure row is shared with the line popup.

  The rows lost their red left stripe; the bars carry the warning now.

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

## v0.11 — learn-the-opening round 🔜

Content for the opening on the board, everywhere you build or review. Research
first confirmed what's free and browser-callable — Wikibooks theory text,
Lichess study/opening deep links, YouTube (deep link keyless, Data API v3 with
a key) — and the first cut shipped all of it. Phone review then cut it down to
the one source that earns its place: **YouTube, with a sharp search**. The
Wikibooks extracts and Lichess links are gone (the research notes live in this
entry if they're ever wanted back); dead ends checked and skipped: Lichess's
video library (empty), study topic pages, keyless YouTube APIs.

- ✅ **Learn tab in the builder & analyser** — a carousel slide (before
  Scouting; one shared implementation since both modes are one carousel). Names
  the opening via the offline database, falling back to the deepest *named*
  position when the line runs past theory, with an honest "named theory ends at
  move N" note — then shows **in-app video cards** (thumbnail, title, channel)
  for it. The search is colour-aware: `"{opening} chess opening for
  white/black"` from the side you're building (the analyser uses your side in
  the game; flipping the board flips the search). Strict fetch discipline:
  nothing fires while the slide is hidden; searches are per opening NAME and
  cached for a week; any failure degrades to a one-tap "Search on YouTube"
  link — never an error.
- ✅ **Explore → Learn** — your saved lines grouped by opening family, each card
  just name + line count + up to three video miniatures from the majority
  colour you play it; hand-picked pins from `src/content-curated.json` (fed via
  chat) lead both surfaces. The four Explore pillars now sit in a **2×2 grid**
  of buttons instead of one cramped tab row.
- ✅ **One shared YouTube key** — baked into `src/youtube.ts` for every user
  (safe because it's restricted in Google's console to the app's origin and to
  the YouTube API only; rotation = replace the constant). The shared free
  quota (~100 searches/day) is ample under the weekly cache. No Settings
  field, no per-user setup.

_On `claude/board-content-tab-uu55k7`. Restore point: `v0.4`._

---

## v0.12 — statistics & general fixes round 🔜

Richer Statistics as the centrepiece, plus a sweep of fixes across the app.

- ✅ **Your rating on Statistics** — a new block in Your games: current rating,
  peak and games played per time class (Bullet/Blitz/Rapid/Daily chips), live
  from Chess.com/Lichess (free public APIs, cached 6 h, offline falls back to
  the last-seen numbers), over a proper rating-over-time chart. Lichess
  accounts get their full history instantly (the rating-history API);
  Chess.com history builds from the ratings games now carry on import
  (`ImportedGame.myRating` — a refresh/re-import fills it in).
- ✅ **One shared chart engine** (`src/stats-charts.ts`) — every Statistics
  trend (game rating, puzzle rating, endgame rating, win rate) now draws the
  same way: monotone curve over a soft area wash, hairline y-gridlines with
  clean tick values, tap anywhere for a crosshair + exact read-out, and an
  end-dot on the newest value. Win rate keeps its 50% break-even line.
- ✅ **Record strip** — one W-D-L bar across the imported games with counts and
  percentages spelled out.
- ✅ **Endgames region on Statistics** — the endgame-puzzle rating + best run
  with its own trend, plus progress meters for Classic endgames solved and
  from-your-games endgames played out (with a "let slip" count).
- ✅ **Settings slimmed** — quick-view carousels removed (feature + pref);
  "Board miniatures" naming; Statistics/Explore/Diagnostics groups gone
  (their features simply always-on; self-tests stay via `npm run selftest`);
  Data → **Backup**.
- ✅ **My games: full-width review strip** — analysed cards show accuracy +
  per-class move counts under the board across the whole card: White's row,
  the class icons, Black's row, accuracy leading each side.
- ✅ **Puzzles: openings inside Practice by theme** — the old Practice-by-opening
  section now lives as the first accordion there ("Your openings") with two
  tabs: Based on my repertoire / Based on my games. Also fixed a class-name
  collision that stopped that section's descriptions from wrapping.
- ✅ **Wider endgame scan** — "From your games" now detects endgames at ≤10
  pieces (was 7): tablebase judges ≤7 exactly, the local engine judges 8–10
  with conservative thresholds and falls back to the 7-piece tablebase check
  when unclear, so nothing the old scan found is lost. Scan version bumped so
  empty v1 scans re-run.
- ✅ **Train hub** — "In training" renamed **Lines in training**, its header now
  a proper card (expanded content untouched).
- ✅ **Explore → Learn** — a one-line intro explaining the tab, and a
  video-camera icon in place of the bulb.
- ✅ **Engine cloud warning** — when Lichess cloud eval can't be reached, the
  docked eval bar swaps its source badge for a discreet "Lichess off" warning
  that's also the retry button — same slot, so the panel never changes height.

_On `claude/app-ui-stats-improvements-1j241p`. Restore point: `v0.4`._

---

## v0.13 — circle-graph statistics round 🔜

Visual, data-rich opening statistics built on circle graphs, plus small fixes.

- ✅ **Donut chart engine** — `renderDonut` in `stats-charts.ts`: one SVG ring
  gauge for every part-to-whole stat, themed via CSS (the record strip's
  green/neutral/brick trio), 2px surface gaps between segments, the headline
  number in the hole, counts always spelled out beside it.
- ✅ **Move memory** (Openings region) — a repertoire-wide ring over every move
  you play in your lines: solid (remembered at the last drill) / slipping
  (missed last time) / not trained yet, with recall % in the centre. Straight
  from each move's SM-2 review block (`moveMemory` in stats.ts, self-tested).
- ✅ **Openings: games × memory** — the win-rate-by-opening cards rebuilt
  without board miniatures: per opening, a Games ring (W/D/L slices, score in
  the hole) beside a Memory ring (that opening's moves as solid/slipping/
  untrained, recall in the hole), with mastery dots and the Open/Build action
  kept. A dashed placeholder ring marks openings not in your lines yet.
- ✅ **Remembered moves over time, reshaped** — a recall donut + spelled-out
  remembered/failed counts and a "trained X of Y days" line lead the section;
  the per-day bar and tap-for-detail stay. Tapping a day swaps the header to
  that day's numbers.
- ✅ **Sliding carousel effect** — every range-swiped chart (remembered moves,
  puzzle rating, your rating, the Most played/Best/Worst tabs) now slides its
  content in from the direction of travel on chip tap or swipe (CSS only,
  honours reduced-motion).
- ✅ **Train hub order** — Lines in training now sits directly after Practise;
  the forgotten-moves carousel closes the pane.
- ✅ **My games cards** — the "analysed" icon next to the tags is gone; the
  review strip under the board already says a game was analysed.

_On `claude/opening-stats-ui-polish-dd7qrf`. Restore point: `v0.4`._

---

## v0.14 — memory-join & engine-pref fixes round 🔜

Fixes to the games × memory join, plus two small behaviour changes.

- ✅ **Memory ring finds your lines** — the games × memory cards said "No line
  yet" for openings you HAD lines on (Pirc, Queen's Gambit…). Two name-format
  mismatches broke the join: the bundled dataset names lines "Pirc Defense:
  Classical Variation" (the colon hid the family from `openingFamily`), and
  chess.com game names come from URL slugs that drop apostrophes ("Queens
  Gambit" vs "Queen's Gambit"). `openingFamily` now cuts at the colon, and a
  new normalised `familyKey` (analysis.ts) joins line and game families
  regardless of source. Self-tested with cross-format fixtures.
- ✅ **Opening cards get breathing room** — the games × memory cards now carry
  the same 0.6rem gap as every other card stack (they sat flush, edge to edge).
- ✅ **Lines-in-training accordion starts closed** — the Train hub's list no
  longer remembers open/closed across visits; it always loads collapsed and
  only stays open within the visit.
- ✅ **"Engine always on" preference** (Settings → Appearance, off by default) —
  when on, the engine starts running every time the board opens; the board's
  engine button still switches it on or off at any moment.

_On `claude/openings-memory-ui-fixes-mtxrg1`. Restore point: `v0.4`._

---

## v0.15 — faster & deeper game reviews 🔜

Why reviews "fall to the local engine" so often: the Lichess cloud is a cache
of already-analysed positions (essentially opening theory, ~the first 8–15
moves), not an on-demand engine — everything after book was always going to be
computed on the device. This round makes that tail faster and, optionally,
deeper.

- ✅ **Reviews stop knocking on the cloud once out of book** — after 3 cloud
  misses in a row the rest of the game skips the Lichess request entirely
  (the same cutoff the mistake scan already used). Saves a round-trip per
  position across the whole out-of-book tail and stops ~60 pointless requests
  per game from nudging the anonymous rate limit (one 429 = 90 s of forced
  local-only, even for book positions).
- ✅ **"Deeper reviews online"** (Settings → Appearance, OFF by default) — an
  opt-in middle tier between the Lichess cloud and the on-device engine:
  chess-api.com, a free public Stockfish service, analyses out-of-book
  positions at depth 18 (vs 12 locally) and far faster than a phone can.
  Game reviews and the mistake scan's verify pass both use it. Own circuit
  breaker (60 s after repeated failures, 90 s after a rate limit) so an
  outage degrades to the local engine once instead of stalling every
  position; positions are sent to that third-party service only while the
  toggle is on. The "analysed with…" tag names it.

_On `claude/lichess-engine-limits-ay1fnw`. Restore point: `v0.4`._

---

## v0.16 — engine un-sticking & Lichess studies in Packs 🔜

The "Analyzing… forever" fix, a study browser inside Packs, and a scannable
Packs layout.

- ✅ **Engine can't get stuck on "Analyzing…" any more** — browsing moves could
  leave the eval panel waiting forever until the engine was toggled off/on.
  Four holes closed in `engine.ts`: the Lichess cloud request now has a hard
  2.5 s timeout (a mobile connection that dies silently used to hang the
  fetch — and the whole evaluation — indefinitely); a superseded search's
  `bestmove` can no longer clear the watchdog guarding the LIVE search (it
  re-arms while any search is still owed an answer); a failed worker rebuild
  inside the debounce window is now deferred instead of dropped (dropping it
  stranded a dead worker that every later evaluation queued behind forever);
  and a worker that never finishes booting gets its own 20 s deadline. Plus:
  finished positions (a trap line's final checkmate) now show "Checkmate" /
  "Draw" instead of analysing a position with no moves, and a superseded
  cloud request can't be miscounted as a cloud failure.
- ✅ **Lichess studies inside Packs** — a "Lichess studies" section on the
  Packs tab: search popular opening studies and get **"Recommended for your
  repertoire"** picks ranked from your saved lines' openings (weight 3) and
  your imported games' apertures (weight 1). Lichess has no CORS-enabled
  study-search API, so search runs over a bundled index of the most-liked
  studies per opening family (~250 studies, 57 KB, lazy-loaded), built by
  `npm run build-study-index` — which also probes every entry's PGN export
  and drops author-locked studies. Importing fetches the study live and opens
  the chapter sheet; any study not in the catalogue still imports by link
  from the board's Import menu, as before.
- ✅ **Study parser survives real-world chapters** — two Lichess-export quirks
  used to silently kill whole chapters in the existing import-by-link flow
  (chess.js accepts neither ADJACENT comment blocks — `{ prose } { [%csl … ] }`
  — nor blank lines inside a comment; 6 of the 7 chapters of the most popular
  Caro-Kann study failed). Both are normalised away before parsing, with
  selftests pinned on them.
- ✅ **Study chapters import tagged and annotated** — chapters now save tagged
  with the study's title (shortened at a word boundary to ≤28 chars, emoji
  wrapping stripped) so they group under one chip in My Lines; the author's
  intro comment (the text before move one) shows at the top of the import
  sheet above the chapter/moves list and rides into the first move's note;
  chapter names use the export's ChapterName header. One shared chapter sheet
  (`study-sheet.ts`) now serves both the board's Import menu and the Packs
  browser.
- ✅ **Packs tab reads as a list, not a wall** — each starter pack is a
  collapsed accordion card (colour pip, title, level · style · line count);
  traps collapse into one "Traps" card with relevance-sorted contents. Line
  cards only render when a pack is opened, which also cuts the tab's initial
  render cost (no more building every board miniature up front).

_On `claude/engine-lichess-study-features-2lwmtb`. Restore point: `v0.4`._

---

## v0.17 — free tier: the training cap 🔜

The first real entitlement work. One thing gets capped and one thing only: how
many lines are **in training** at once. Everything else stays wide open —
building and saving lines is unlimited, and so are the library, packs, traps,
studies, import, puzzles, endgames, engine, sparring, analyser, statistics and
sync.

- ✅ **Free tier trains 10 lines at a time** — `entitlement.ts` owns the rule
  (`FREE_TRAINING_LINES = 10`), reading `profiles.entitled` from Supabase once
  per sign-in and holding it in memory so the dozens of cap checks the UI makes
  never touch the network. Entitled accounts, and any build without Supabase
  configured (the internal GitHub Pages channel), are uncapped. Signed-out use
  takes the same capped path rather than a special case of its own.
- ✅ **Every enrolment point enforces it** — the five places that could ever set
  `inTraining = true` now funnel through one guard: the post-save "Start
  training this line?" prompt, the My Lines switch, the Train hub switch, the
  builder's Line-panel switch, the Progress screen's Drill, and onboarding's
  one-at-a-time adds. A single deliberate add over the cap gets the upsell
  dialog (€10 once); a bulk add — "Add all 12 without the walkthrough" —
  enrols what fits, saves the rest to My Lines unenrolled, and says so with a
  quiet toast. No price tag in the first minute.
- ✅ **Nothing is ever auto-paused** — existing users sitting over the cap (early
  testers with dozens enrolled) keep every line enrolled and scheduled. Only the
  ON direction of a switch is guarded, so pausing always works and frees its
  slot immediately: a free user rotates their ten freely.
- ✅ **The ceiling is visible before it's hit** — the Train hub's "Lines in
  training" card shows "7 of 10 lines in training" from 7 upward, free tier
  only. Entitled users see no counter, no dialog, no cap.
- ✅ **Entitlement is a cache of server truth, never a grant** —
  `entitlement-cache.ts` mirrors the last server answer to localStorage purely
  so an offline paid user isn't locked out. Every successful fetch overwrites
  it in both directions; the cache is keyed to the Supabase user id so a second
  account on a shared device can't inherit the first one's access, and
  sign-out clears it. It's excluded from backups **and** from the Supabase sync
  blob (which reuses the same BackupFile shape), so an entitled user's copy can
  never grant access to the phone that restores it.
- ✅ **`entitled` is enforced in the database, not the bundle** — the profiles
  table's update policy is row-scoped, so on its own it would let any signed-in
  user flip their own flag from the browser. `SUPABASE-SYNC.md` now revokes
  UPDATE on the column and re-grants it only on the two sync columns.

_On `claude/free-tier-training-cap-avhhfs`. Restore point: `v0.4`._

Not in this round, by design: the buy flow (the "Unlock full access" button is a
no-op stub), and the beta-code gate in `gate.ts` — its local unlock flag is left
completely untouched so a later migration session can read it to grandfather
existing testers.

---

## v0.18 — the sync stops re-uploading your whole game library 🔜

A sizing round, not a feature round. The account sync shipped pushing one blob
holding everything; measuring a heavy user showed why that doesn't scale.

- ✅ **Games sync in their own column** — `profiles` gains `games` +
  `games_updated_at`; `repertoire` keeps the lines and the app-state snapshot.
  Measured on a synthetic heavy library: a bare imported game is ~1.3 KB, one
  carrying a saved analysis ~18 KB, so 1000 games runs 2.5–20 MB against
  0.2–1.3 MB for the lines-and-settings half. Editing one move used to re-upload
  every game you own, over mobile data, rewriting the whole TOASTed value in
  Postgres each time. Now an edit sends the small half and games go up only when
  games change. The migration is additive — a row still carrying its games
  inside the old blob keeps working and moves them across on its next push.
- ✅ **Games changes actually trigger a sync** — `onLinesChanged` was the only
  trigger, and `saveGames`/`deleteGame`/`clearGames` never fired it, so an
  import of 300 games only reached the account if you happened to touch a line
  afterwards. A second notifier (`onGamesChanged`) fixes it, and the two share
  one 30s debounce and one upsert.
- ✅ **Unchanged data isn't re-sent** — each half carries a content fingerprint
  of what was last pushed, taken over the lines/games/snapshot and deliberately
  NOT over `exportedAt` (restamped every export, so including it would make
  every payload look new). It also makes the retry-everything sweep on app
  launch free, and stops a restore from immediately re-uploading the megabytes
  it just downloaded.
- ✅ **Closing the app pushes on the way out** — `pagehide` and
  `visibilitychange` flush a pending change instead of leaving it owed until the
  next launch. Best-effort by nature (Android kills PWAs without warning), which
  is why the pending flag still survives in localStorage.
- ✅ **The erase-can't-clobber-the-cloud property is preserved** — verified end
  to end: `eraseAllData` still doesn't notify, the new games notifier is equally
  exempt, and the localStorage sweep takes the sync's account claim and the
  Supabase session with it, so there is nothing to push and no session to push
  with.
- ✅ **Selftested** — the pure half moved to `sync-core.ts` (status-flag
  precedence, two-column reassembly including the pre-split migration case, the
  fingerprint) so it runs under plain Node without dragging in the Supabase
  client. 27 new checks.

Still last-write-wins, deliberately: two devices editing in the same window
means one overwrites the other. Per-line `updatedAt` + deletion tombstones stay
parked in `PUBLISHING.md`.

Unmeasured and flagged rather than guessed: Supabase publishes no request-body
limit for the REST API, and this container has no outbound network to test one.
`npm run probe-sync-limit <url> <anon-key>` measures it from a desktop — it
writes nothing, since RLS rejects every probe by design.

_On `claude/supabase-app-data-sync-eyuv0g`. Restore point: `v0.4`._

---

## v0.19 — the guest-first first run 🔜

The old first run was an install-an-app pattern: beta code → five intro slides →
a five-step setup wizard → "add 5 lines to unlock training". That's a lot to ask
of a stranger who has just landed on a web page. This round replaces it with a
web-visitor pattern — sixty seconds from arriving to a saved, scheduled line,
with no account and nothing to unlock.

- ✅ **Guests are first-class** — the public Cloudflare build skips the beta gate
  entirely (`DEPLOY_TARGET` is now visible to the app, not just to Vite); the
  internal GitHub Pages build keeps it unchanged. Nothing else needed unblocking:
  storage never knew about user ids, the entitlement check already treated
  signed-out as the ordinary free tier, and the account sync was already inert
  without a session. A guest gets exactly what a free signed-in user gets — the
  same 10-lines-in-training cap — so signing in only ever adds sync. Claiming
  local data on first sign-in already worked too, via `reconcile()` and
  `backup.ts`'s merge chooser; no new merge code.
- ✅ **The picker replaces the slides and the wizard** — one screen: colour,
  depth (3 / 5 / 7 moves), and a 2×2 grid of style cards, each with a mini board
  at that line's final position. Changing colour or level cross-fades the four
  cards. Fits 412×915 without scrolling. Black cards say "against 1.e4".
- ✅ **Eight curated lines** (`onboarding-lines.json`) — Italian, Scotch, Ruy
  López, Polish for White; Caro-Kann, Najdorf, French Classical, Owen for Black.
  Every cut ends on the user's own move and resolves an opening name, asserted by
  a new self-test (84 checks) so editing the JSON can't quietly break a card.
- ✅ **The guided first line** — the builder opens with the line laid down and
  plays it in using the builder's OWN Watch playback (lifted out of the button
  handler rather than reimplemented), then a three-beat coach strip that lives in
  the bottom dock, so it can never cover the board. Any move the user plays jumps
  to the last beat.
- ✅ **Straight into the confirm run** — saving from guided mode skips the "start
  training this line?" dialog and goes directly into the existing pre-training
  run, finishing on "It's in training. It'll come back tomorrow, before you
  forget it."
- ✅ **One ask, after the win** — the sign-up sheet appears only after that first
  clean run, and reuses Settings' own auth form rather than a second copy of it.
  "Not now" is remembered for good. `?auth=signup` opens it directly.
- ✅ **The wizard's questions, re-timed** — notation, theme and Lichess come back
  as dismissible cards on Train once a line exists, built from the Settings
  controls themselves. The intro and the wizard stay replayable from Settings.
- ✅ **`ONBOARDING_GOAL` 5 → 1**, and the boot splash dropped below the overlay
  tier so a first-run screen is never invisible underneath it.

_On `claude/first-run-experience-rebuild-xfwdpa`. Restore point: `v0.4`._

---

## v0.20 — the first-user round 🔜

The v0.19 guest-first run answered "how does a stranger get their first line?".
This round answers the two questions after it: what if they *skip* that screen,
and what does the app ask of them once they're inside. Phone review drove all of
it.

- ✅ **The picker is a board, a tag and a title** — the first screen now opens on
  the real installed **app icon**, and each style card lost its move list and its
  blurb (both survive in the card's accessible name; the moves are one tap away
  in the builder). The cards were also *overlapping* the level chooser and the
  "Rather start from your own games?" link on a phone: `.picker-cards` was
  `height: 100%` with `align-content: center`, so anything taller than the stage
  spilled out of it in both directions. It's `min-height` now, the stage is the
  only scrolling part of the screen, and the head/controls/footer are pinned.
- ✅ **A "Get started" checklist for anyone who skipped** — a deliberately loud
  accent-bordered panel above the Train tabs, shown while fewer than **5 lines**
  are saved (it takes the daily challenge's slot; the daily card returns at
  five). It carries a progress bar to the line goal with the three routes to
  moving it (**Starter packs · Build a line · With the engine**), then a
  checklist: **Import your games**, **Connect Lichess** and — where accounts
  exist — **Create an account**, each ticking off on its own. Honest about the
  numbers: one line already unlocks training, five make a repertoire.
- ✅ **Lichess and sign-in have a home** — both were only ever offered where they
  happened to be needed (Puzzles, the explorer, the post-win sheet). They're now
  standing items in the checklist, each saying what it unlocks. Preferences stay
  open to signed-out users, deliberately: a guest is a full free user, so an
  account only ever ADDS sync.
- ✅ **Train's first-run gate is gone** — the screen used to swap itself for a
  full-page "Build your first lines" view until a line was in training, so a user
  who backed out of the picker got a *second* onboarding screen instead of the
  app. The hub always renders now, with the checklist above it. What's left of
  `onboarding-starter.ts` is the pack data and its picker sheet.
- ✅ **Practise tells the truth when it's empty** — "Drill new lines" and "Target
  weak areas" stayed live with an empty rotation and started sessions with
  nothing in them. All four modes now grey out together, with a reason that
  distinguishes "nothing saved" from "nothing enrolled". Time attack also read as
  a *different* disabled state, because its card and its chips each applied 0.5
  opacity (0.25 together) — the chips no longer dim inside an already-dim card.
- ✅ **Import loses a step, and lands where it's needed** — "How far back"
  (1m/3m/12m/All) is gone; every scan now reaches the whole history, newest
  first, and the hard cap stops it. And the panel's first step is now shown
  **inline, boxed**, on the six screens that are useless without games —
  Train → Middle game, Train → End game, My Lines → From my games,
  Explore → Recommended, My games and Statistics → Your games. Filling it in
  scans immediately (`autoScan`), so a button-then-form round trip is gone from
  all six.
- ✅ **Signed out imports 50 games at a time** — `FREE_GUEST_IMPORT`. The 500 and
  All slices still show, padlocked, and open the sign-up sheet; signing up
  unlocks them **in place**, against the scan already in hand, rather than making
  the user start over. The rules are pure and self-tested (`import-tier.ts`,
  28 checks) so the cap can't drift.

_On `claude/onboarding-first-user-experience-3v8dam`. Restore point: `v0.4`._

---

## v0.21 — the onboarding flow round 🔜

Phone review of the v0.20 first run. The pieces were all there; the *order* was
wrong. A stranger met a screen of four chessboards before they knew what the app
was, got dropped into a dense builder with no idea what any of it did, and then —
if they made it that far — was handed straight to a drill with no warning. This
round is mostly about sequencing, plus a lock so training isn't first met with a
single line in it.

- ✅ **The start screen loses its boards** — four thumbnail positions of lines the
  user hasn't played are four grids of beige squares, and they cost the height
  the controls needed. The picker is now a small **form** (colour, then depth)
  over four **style rows** — a word, an icon and the opening's name. Colour is
  two wide buttons carrying a real white pawn on a light disc and a black pawn on
  a dark one (the FAB's token), because a pawn says "side" faster than the word
  does. The two ways out are **buttons** now — *Import my games* and *Build my own
  line* — not a sentence with a link inside it. Fits a 412×640 window without
  scrolling.
- ✅ **A builder walkthrough, before the line** (`onboarding-tour.ts`) — three
  cards on an empty screen naming the board, the **Line · Library · My lines ·
  Learn** tabs and Save, then the picked line opens. Skippable from any card, and
  shown once ever (its own flag, so it also fronts a pack line opened months
  later). It deliberately doesn't anchor callouts to live elements: the builder
  isn't mounted yet, and three sentences don't justify a coach-mark rig.
- ✅ **The save prompt is a button, not a caption** — the coach strip's closing
  beat used to be grey text pointing at a faint pulse on a Save button somewhere
  in the header. The strip now fills with the accent and grows its **own "Save
  the line"** button under the user's thumb (the header pulse stays as a second
  pointer, and settles after three beats rather than pulsing forever).
- ✅ **The trainer explains itself** — saving used to hand the user straight to the
  confirm run, which auto-plays the line and then silently waits. With no warning
  that pause reads as a freeze. One card now says what's about to happen —
  **① watch it · ② play it**, one clean run and it's in training — with *Later*
  leaving the line saved but out of the rotation.
- ✅ **Starter packs open in the builder** — "Add & learn" fired the trainer
  directly from a sheet that then stayed up over it, so the tap looked like it
  had done nothing. It now **closes the sheet** and opens the line in the builder,
  played in, exactly like the first-run line; the builder's own Save carries it
  the rest of the way (new `'build'` mode in `AddLineMode`; the line's notes and
  its middlegame plan ride along). The sheet also lost its **Close** button (the
  backdrop and the back gesture already close it) and the per-pack blurb, and its
  accordions now **animate open** (a `0fr → 1fr` grid row, so a collapsed pack is
  genuinely zero pixels).
- ✅ **Training locks until 3 saved lines** — a session built from one line shows
  you the thing you just learned and declares you finished, which teaches the
  wrong lesson about the loop. Every Practise mode greys out below three with the
  count still to go, the due hero stays away, and the confirm run's closing line
  stops promising a review tomorrow that won't come. `TRAINING_UNLOCK_LINES` is
  the same number the Get-started bar counts to, so the panel and the lock tell
  one story.
- ✅ **Get started, re-weighted** — the line goal is the whole point, so it gets a
  full-width **"Build a line"** primary; Starter packs and *Play the engine* drop
  to chips beneath it, and import / Lichess / account become quiet checklist rows.
  "With the engine" used to open an empty builder with the eval bar switched on
  (an analysis aid) — it now opens the **engine builder**: a game against
  Stockfish you can hand to the builder at any point. Android gets an **Install
  the app** row, which fires the real prompt captured at boot.
- ✅ **Guests import 100 games** (was 50) — fifty is a thin sample once it's split
  by colour and time control. `FREE_GUEST_IMPORT`, still self-tested, now
  cap-relative so the number can move again without editing assertions.
- ✅ **Two removals and a margin** — Train's three contextual cards (import,
  Lichess, make it yours) are gone: two repeated the checklist above them and the
  third asked about theme, which nobody visits Train to answer. The sign-up
  sheet's lead is one line instead of three clauses about where data lives. And
  Train → Middle game's empty state got its side gutter back — the screen carries
  no padding of its own, so the accent-bordered import box was running edge to
  edge while everything around it was inset.

- ✅ **The refinement pass, after a second phone review.** Same round, second
  session — mostly about where things happen rather than what they say.

  **The walkthrough moved onto the builder.** Three cards on an empty screen
  named "the tabs under the board" while there were no tabs on screen, which asks
  the user to hold a description in their head and match it later. It's now
  **coach-marks**: a bubble anchored beside the thing it's describing, everything
  else dimmed, one step each for the board, the tab strip and Save. The scrim is
  a single element with a 9999px `box-shadow` spread, so the hole shows the real
  screen at full strength with no re-stacking and no clipping at the edges. And
  it runs in the right place in the sequence now: the line **plays itself in
  first**, then the bubbles, then the coach strip's decision — which after a
  walkthrough opens straight on its call to action instead of repeating the two
  beats the bubbles just delivered. The strip's closing line names both ways
  forward: *keep playing with it, or save it and train it*.

  **The trainer explains itself on the trainer.** The watch/play card used to sit
  over the builder, asking the user to agree to go somewhere they hadn't seen.
  The trainer screen now mounts first — board and all — and the card explains it
  with the thing itself behind it; a new `beforeWatch` hook on the drill holds
  the moves at the start position until **Got it** (one button; nothing is being
  decided). The two steps are a numbered list with a badge and a bold label
  (`steps` on the shared dialog) rather than ①/② buried in prose.

  **The start screen is a form all the way down.** The four styles are a **2×2
  grid that selects**, and a single **"Start building the …"** button commits,
  disabled until something is chosen and naming the choice once there is one.
  Tapping a tile used to launch the builder on the spot, which made the last
  field behave unlike the two above it — colour and depth were changeable, style
  was a trapdoor. The two ways out sit under a labelled **"or start from"** rule,
  so they read as alternatives rather than two unexplained buttons.

  **Install actually installs.** The row is now offered only when gate.ts is
  holding a real `beforeinstallprompt` — so there's no instructions card behind
  it, and no row at all on browsers that can't do it. The event lands after boot,
  so Train repaints when it arrives (`onInstallAvailable`).

  **Weights and copy.** Build a line and Starter packs are equal peers; the
  engine drops to a discrete link under them. The import cap reads "you can
  import 100 games" flat, with the sign-up as a **button** instead of an
  underlined word at the end of the sentence. And the account ask stopped saying
  the same thing twice — "Save your progress" over "Create an account to save
  your progress" is now **"Create a free account"** over what it actually buys.

- ✅ **Third pass: one screen, one teaching voice, one standing to-do list.**

  **The start screen fits a phone browser.** The centred app tile over a wordmark
  over the lead was three rows of chrome before anything actionable, and a phone
  browser's URL bar takes another ~110px — the footer fell off the bottom.
  Identity is now a **top bar**: small mark and wordmark on the left, **Sign in**
  on the right (for someone who already has an account and landed here by
  accident). The room that frees goes to the lead, which is a proper headline
  now; the style tiles lost some height. Verified with no scrolling at 412×720
  and again at 412×600.

  **The coach strip is gone.** It cycled three sentences on a timer in the
  builder's dock while the walkthrough talked about the same screen in a
  different voice — two teaching devices, one of which moved on whether or not
  you'd read it. Its job (the save decision) is now the walkthrough's last step,
  and `onboarding-guide.ts` is deleted.

  **The walkthrough is split around the line playing in**, and says more:
  *Build your line here* explains that you play the line on the board and save
  it; *Three panels to build from* names **Line**, **Library** and **My lines**
  one by one (Learn and Scouting are left for later — a walkthrough that lists
  five things teaches none of them); and then, once the line has played itself
  in, *Ready when you are* on the Save button, with **Keep editing** and **Save
  the line** as the two answers. That last step runs on every guided line, not
  just the first — it's what replaced the strip. The old "nothing is saved until
  you press this, so there's nothing to break" is gone: telling a first-time
  user the app is fragile is neither friendly nor true.

  **"Saved. Now learn it" became a coach-mark too**, on the trainer's board
  rather than a card in the middle of the screen — a card explains the app, a
  bubble on the board explains the board. Coach-marks are a general component
  now (`showCoachMarks`), with per-step actions.

  **The Get-started banner stops disappearing at three lines.** Past the unlock
  the daily card takes its slot back and the checklist rides underneath it,
  compact — import, Lichess, install and the account are the easiest things in
  the app to put off forever. A **discrete ×** hides it for the session
  (sessionStorage), and it retires for good once there's an account or an
  install. It also grew a **Go pro** button (wired to the shared upgrade dialog;
  the Lemon Squeezy checkout is still the TODO), and Build a line / Starter packs
  are `btn-primary` rather than outlined chips.

  **And a margin:** Statistics → Your games had the same edge-to-edge import box
  Middle game did. Now inset to match its region heading exactly.

- ✅ **Fourth pass: the walkthrough teaches one thing at a time, and the first
  line ends on a win.**

  **The start screen is one object.** Colour, depth, style and the CTA were four
  things floating at four weights; they're one **card** now, with the button as
  its last row and the two escape hatches demoted to text links under it. The
  card hugs its contents (a card with 300px of empty floor between the last tile
  and the button reads as a bug) and the slack goes below it as margin. The lead
  scales with the room there actually is — a proper headline on a tall phone,
  trimmed on a short window.

  **You can't see a highlight you can't see the edges of.** A phone board is the
  full width of the screen, so the spotlight's ring was off-screen on both sides
  and "the board is highlighted" read as "the app went dark". Every spot is now
  clamped to sit just inside the viewport, and the ring breathes. The bubbles
  went up a notch too: darker scrim, an accent hairline, and a shadow deep enough
  to read on a dimmed screen.

  **The board step is live.** *Build your line* is one sentence — play the line,
  save it, train it — and the overlay lets taps through, so **playing a move on
  the board** is what advances it. From an **empty board** the save prompt now
  arrives on its own after three moves, and the save routes into the confirm run
  exactly as a curated line's does: it's the same first line.

  **Three panels became three steps.** *Line*, *Library* and *My lines* each get
  their own bubble with **that panel actually open behind it** — and tapping the
  next tab advances, so the instruction is real. Library offers **Connect
  Lichess** and comes back to the same step after the OAuth round-trip (the
  walkthrough stashes its step alongside the position); My lines offers the
  **games import**, and picks the guided line back up when that sheet closes.

  **The watch stopped stopping.** A note popping up mid-replay held the next move
  for up to 3.5s, turning a ten-second watch into a stop-start minute — in the
  trainer's watch-first pass and, as a re-laid-out panel, in the builder's own
  playback. Notes still show where they teach: on a miss, and on the note
  control. *Saved. Now learn it* says what the run actually does (two tries, then
  the move is shown, and your misses come back) and its button says **Start
  training**.

  **The first line ends on a card, not a form.** Finishing used to hand the user
  a bare sign-up sheet. Now the hub comes up behind a centred **"Your first line
  is in"** — the training finish's hopping pawn, a confetti burst, what happens
  next, and about-five-lines as friendly advice — with the account offer under a
  hairline and a quiet **Not now**. Without accounts configured it's the same
  card minus the ask.

_On `claude/walkthrough-ui-refinements-aet12d`. Restore point: `v0.4`._

- ✅ **Fifth pass: the first run stops being a slideshow.** The pieces were right;
  the user was a spectator for most of them.

  **The start screen asks two questions, then a third.** Colour and depth come
  first — depth as three big buttons in the same clothes as *I play as*, with the
  move count where the pawn sits, and deliberately nothing preselected. The four
  styles arrive underneath once a depth is chosen, animated in, and **tapping one
  commits**: the "Start building the …" button was an extra tap to confirm a
  choice already made, on the one screen whose whole point is speed. The two ways
  out are now **Import my games** / **Build my own**.

  **The walkthrough is one sequence, and the user makes the moves.** The line no
  longer plays itself in. The board **rewinds to the user's second-to-last move**
  with an arrow on it and waits — play it, or press Next and it's played for you.
  Then *Line Overview*, *Opening Library* and *My lines* (each with its panel
  open behind it), a new **Engine** step that switches Stockfish on to talk about
  it and off again after, a second board step for **the last move of the line**,
  and Save. Seven bubbles, one thread.

  **Back, everywhere, including out.** Every bubble carries Back beside Next,
  with Skip demoted to a quiet link underneath; a step's setup re-runs on the way
  back, so the board rewinds and the panels reopen. Back on the FIRST bubble
  returns to the start screen — with the walkthrough owed again, so the next pick
  brings it along.

  **Navigation is the buttons and the tabs, and nothing else.** Tapping *Line*
  goes back to the Line bubble, not just the Line panel. Learn and Scouting are
  switched off for the duration rather than left as taps into panels the
  walkthrough never explains.

  **The two connects are main buttons now**, full-width above the nav row, because
  on those two steps they're the point: **Connect Lichess** (which comes back to
  the same bubble, showing *Lichess connected* in the button's place — and it's
  the only Lichess connect in the app that redirects into the builder) and
  **Import my games** (which comes back to the same bubble whether or not
  anything was imported).

  **Save is aimed at Save.** The spotlight's padding is trimmed symmetrically near
  a screen edge, so the ring is centred on the button instead of bulging off to
  its left, and the bubble's tail points at the spotlight rather than always at
  the middle. *Keep editing* became **Add more moves**.

  **The trainer says what it does, and lets you out.** *Watch the line played
  once, then repeat it from memory* — two attempts before the move is revealed —
  with a quiet **Skip this time** for someone who'd rather look around (the line
  is saved and in training either way). After the watch pass the first move is
  asked for by name and drawn on the board: the one place the answer is given
  away, because there is nothing to remember yet.

  **And the finish card stands apart from the app.** *Your first line is set!*
  over a **blurred** hub rather than a dimmed one, with an accent hairline around
  the card — the app's own cards and buttons were legible right behind it.

_On `claude/boarding-experience-refinements-bss1mn`. Restore point: `v0.4`._

---

## v0.22 — the builder tab round 🔜

The builder had five tabs and the wrong five. Line, Library, My lines, Learn,
Scouting: two of them were content shelves that had nothing to do with the line
in front of you, one was the line's own metadata sitting in the first slot, and
the engine — the thing you reach for most — wasn't a tab at all.

- ✅ **Five tabs, and which five depends on what you're doing.** The strip is now
  **Explore / Library / My lines / Line info / Engine**. Slides are addressed by
  name rather than by index, so the analyser can put its **Game** tab first and
  drop Explore — there is nothing to explore about a game already played — and
  the scroll-position→index maths still needs to know nothing about any of it.
  **Learn and Scouting are gone**; scouting comes back as My lines' third
  section, **My opponents**, next to your own games, because it answers the same
  question from the other side of the board.

- ✅ **Explore: three curated moves, each saying why it's there.** Library
  answers "what is playable here" exhaustively, which is the right tool once you
  know what you're looking for and the wrong one when you don't. Explore asks a
  narrower question: given your games, the master library and the engine, what
  are the three moves worth having here? Priority order is **your own played (or
  faced) moves first**, then the library's most popular continuation, then the
  engine for positions the other two have run out on — and every card carries the
  badge and the number that earned it. The header does the framing: *Possible
  answers for 3.♝b5* on your move, *Prepare for the reply to 3.♝b5* on theirs.

- ✅ **An Engine tab, and a quick engine that stops explaining itself.** The tab
  gets the full eval bar, what analysed it and how deep, three principal
  variations with **every move tappable to play the line out**, and a real
  search-depth control. The docked strip loses its *cloud · d38* tag and puts the
  move and its eval on one line instead of two — it's the app's most
  space-constrained row, and provenance is now the tab's story.

- ✅ **One move strip instead of three move lists.** The list used to be copied
  into the foot of every list panel: the same information three times on one
  screen, none of it visible from another tab. Now it's a single
  horizontally-scrolling strip under the tab bar, on every tab, at the smallest
  height it can be — with the full wrapping list kept only on Line info.

- ✅ **Line info: a training priority, and how the line is actually going.** The
  scheduler knows how well you remember a move and can't know how much it
  matters. **High / Standard / Low** multiplies the *wait* between reviews (0.6× /
  1× / 1.7×) rather than the stored interval, so it can't compound across reps
  and the Learning/Solid buckets keep meaning "how well is this known?". Due
  lines lead with the high-priority ones. Under it, four figures built from the
  same stats module the Statistics screen uses — **faced in games, recalled, full
  runs, reviews** — and the three most-missed moves, each tappable to put the
  board on the position before it.

- ✅ **The walkthrough teaches the new tabs.** Explore stands where the Line
  bubble stood, My lines gained a sentence about its third section, and the
  engine step opens the **Engine tab** with the engine running instead of
  pointing at the dock icon. Which tabs get locked is derived from which tabs
  have a bubble.

- ✅ **Picker and Skip.** *How much to learn* asked for a self-assessment and
  answered in numbers; the answer is now the option — **3, 5 or 7 moves**, with
  the skill word as a caption. More air between the three questions, room under
  the lead, and the brand mark links out to bitochess.com. **Skip** moves to the
  bubble's top-right corner as one quiet word — under the footer it was a third
  full-width control competing with Back and Next — and the *Saved. Now learn it*
  card gets the same treatment.

_On `claude/builder-tab-structure-c1a7ko`. Restore point: `v0.4`._

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
