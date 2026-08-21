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

- ✅ **Opening-explorer rating band.** The Library slide's statistics can now be
  filtered to the level you actually play at, with a segmented strip sitting
  right beside the existing Masters / Lichess toggle: **All · <1400 ·
  1400–1800 · 1800–2200 · 2200+ · My level**. It maps onto the Lichess
  explorer's fixed `ratings` buckets (`0,1000,1200,…,2500`, each running to the
  next, `2500` open-ended). *"My level"* is the bucket you're in plus one either
  side — a real ±300 window rather than a hard edge that would put 1399 and 1401
  in different worlds.

  **Your level is worked out for you**, in order: a rating typed in Settings, the
  median of your five most recent rated games in your most-played time class, or
  your connected Lichess account (`GET /api/account` — **no new OAuth scope**;
  the endpoint needs only a valid token, which the existing `puzzle:read`
  connection already is). With none of those the band stays *All ratings* and the
  request is byte-identical to the pre-band one, so a user who never touches this
  sees no change at all. When the app picked the band rather than the user, it
  says so under the control — *"Around my level · 1200–1799 · from your rapid
  rating, 1520"*.

  **Three things this feature can quietly get wrong, and what stops each:**
  *The cache* — the per-session request cache is keyed on the database and the
  filter strings that go into the query verbatim, both taken from one value, so a
  band cannot reach the URL without also reaching the key. Keyed on position
  alone, changing bands would serve the previous level's numbers back and look
  entirely convincing. *An empty band* — a narrow band runs out long before the
  database does, so "no games at this level" is its own state with a **Show all
  ratings** button, never the "New territory" note. *The bundled set* — it has no
  rating dimension whatsoever, so whenever it stands in for a failed live fetch
  the numbers are labelled **all ratings**; the renderer reads what the data
  actually is, never what was asked for.

  **Masters takes no rating filter** — the API has no such parameter and *ignores
  unknown ones rather than refusing them*, which would return unfiltered numbers
  under a filtered label. So the strip is disabled there, with the reason on it,
  and the parameters are never sent.

  Settings → Lichess connection carries the same band plus a manual rating field,
  for someone with no imported games. **No speeds control**: filtering by
  something invisible is how numbers change for reasons the user can't see, and
  a most-played time class flips after a single import.

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

- ✅ **Second pass: the panels stop explaining themselves.** Every tab was
  right; several of them led with apparatus instead of with the answer.

  **Explore leads with the moves.** Three tiles at the very top — the move and a
  mark saying where it came from — and tapping one plays it. Under them the same
  three with the number that earned each its place and, one tap further, the
  record behind it. And three now means three: if your games and the book can't
  fill the row the engine does, cloud first and the review worker after, which
  runs **with the engine toggle off** — "turn the engine on first" is not an
  answer to the question the slide exists to ask.

  **The Engine tab owns the engine while it's showing** — it switches it on and
  hides the docked quick engine, which was the same bar and the same three moves
  in miniature. So the tab needs no controls: the power button, the
  source-and-depth readout and the depth slider are gone, and each line is one
  sideways-scrolling row on its own raised background.

  **The grabber is gone**, because it advertised something the panel already does
  when you swipe it, and those pixels come off the board.

  **Line info sets training up instead of asking afterwards.** The move list goes
  (the strip above it is the same list); the training toggle and the priority
  control are live from the first move with the toggle **on by default**; the
  stats block shows the shape of its four figures rather than hiding. On an
  unsaved line the toggle states an intent and says so — *Train after saving* —
  and the save honours it, straight into the enrolment path where the free-tier
  cap and the confirm run live. The old *Start training this line?* modal asked
  something already answered two taps earlier.

  **The walkthrough teaches by using.** The Explore bubble rings the line's own
  next move and tapping it plays it, so the last board step's sentence is
  resolved when it's painted — *play the last move* or *that's your line*. Line
  info gets a bubble too, so no tab is locked out any more. And the depth tiles
  are words again: **Beginner / 3 moves**, not a number in a disc over a skill
  word that said the same thing twice.

_On `claude/builder-tab-structure-c1a7ko`. Restore point: `v0.4`._

---

## v0.23 — the landing page round 🔜

The landing page was a good editorial page for a different product. It used its
own type, its own light-only palette and its own art direction, showed five
empty screenshot frames, and had no way to buy anything. Rebuilt so that the
page and the app are visibly the same thing.

- ✅ **It looks like the app now.** The page takes the app's tokens verbatim
  (`src/style.css` :root and the dark block), the app's type — system-ui, with
  Chakra Petch reserved for the wordmark exactly as `header h1` does — and it
  follows the browser's light/dark preference instead of being light-only.
  Fraunces and Spline Sans are gone. The board colours stay unthemed in both
  schemes, as in the app.

- ✅ **A top bar with the app icon on it.** Fixed bar, wordmark left, **Sign in**
  and the app icon right. The icon starts big and overhangs the bar, then
  shrinks into it on the first scroll — it is absolutely positioned, so the
  bar's height never changes and the page never jumps. Signed in, the link
  becomes *Open app* and every CTA becomes *Open Bito Chess →*.

- ✅ **A hero that asks for less and shows more.** *Improve your next move* over
  *Build your repertoire, train smarter, and play with confidence*, then **Try
  it for free** with *No signup required* under it.

- ✅ **A board you can actually play.** Three scripted moves of the Italian Game
  in the hero, with the app's own orange hint arrow and the app's own cburnett
  pieces, then *That's the Italian Game* and the CTA. No chess engine and no
  dependency: the only legal move at each step is the one the arrow points at.
  The starting position is in the markup, so there is no empty frame before the
  script runs and none without it.

- ✅ **The five extras are a carousel.** *There's more than openings in here* is
  five illustrated cards — puzzles, mistakes, brilliants, endgames, Stockfish —
  on a scroll-snap track with arrows and dots, replacing a bare bullet list.
  The five screenshot frames are gone (the PNGs stay in `docs/` for whenever
  they come back), and so is the *watch a video* bullet: four ways in, not five.

- ✅ **You can buy from the page.** 89 kr, once, with a **Buy full access**
  button. Signed in it goes straight to the Lemon Squeezy checkout carrying
  `checkout[custom][user_id]`, which is what the webhook needs to know who paid;
  signed out it sends you to make an account first. One constant at the top of
  the page script (`CHECKOUT_URL`) is the whole configuration — until it is
  filled in the button routes into the app's own upgrade path rather than
  nowhere. The in-app dialog's price moved from €10 to the same 89 kr.

- ✅ **Why I made it, as a comic bubble** — with the signature under it and an
  *About the app* box beside it (one person, lines on your phone, tested on a
  real phone).

- ✅ **Six 3D vector pieces drift behind the sections.** Hand-drawn (silhouette,
  gradient, highlight — a few kB, no bitmap), straddling band edges and moving
  at their own speed on one rAF-throttled scroll handler, so the sections
  separate without a rule or a wave. They shrink and fade on a phone, and hold
  still under `prefers-reduced-motion`. The final CTA gets the app's hopping
  pixel pawn, the same one it plays after a training run.

- ✅ **`?auth=signin` opens a sign-in sheet**, not a sign-up form — the page's
  Sign in link and the onboarding picker's own *Sign in* button both use it.

_On `claude/bitrochess-landing-redesign-xcm0on`. Restore point: `v0.4`._

---

## v0.24 — the buy flow actually sells 🔜

The round that connected the price to the payment. Everything below it already
existed — the cap, the webhook, the database column, the landing page's tier
card — and none of it was reachable, because both "Unlock full access" buttons
were dead ends.

- ✅ **The app's buy button works.** `src/checkout.ts` is the whole flow: it
  opens the Lemon Squeezy checkout as an **overlay** via their lemon.js rather
  than navigating away, because sending an installed PWA to another origin
  hands the user to a Custom Tab and the way back lands somewhere unpredictable.
  If the script doesn't load, the same URL opens as an ordinary redirect —
  somebody trying to pay is never told to come back later.

- ✅ **An account is required, and asked for at the right moment.** The webhook
  matches a payment to a Supabase user id, so a guest cannot be credited. The
  sign-up sheet now takes a `lead` and an `onSignedIn`, so the buy flow explains
  *why* it's asking ("your unlock is tied to your account") and continues
  straight to the checkout once the account exists, instead of dropping the user
  on the Train screen with their intent thrown away.

- ✅ **The landing page keeps the intent too.** Signed out, "Buy full access"
  now goes to `/app/?auth=signup&buy=1`, and the app finishes the job. Signed
  in, it goes straight to the checkout carrying `checkout[custom][user_id]`.

- ✅ **Four ways to notice the unlock landed.** Access is granted by a webhook
  the phone never sees, and it arrives a second or two *after* the payment, so
  reading the flag once lands inside that gap about half the time and tells a
  paying customer they haven't paid. The app polls on a backoff instead, started
  by whichever of these fires first: lemon.js's success event, the app regaining
  focus, `?purchased=1` on the URL, or **Settings → "Already paid? Check
  again"** — the manual backstop, which always answers.

- ✅ **The cap furniture repaints when the flag flips.** The Train hub counter,
  the coaching-cap notices and the Go-pro CTA are drawn at render time, so an
  entitlement change now repaints the current view. Without it the first thing a
  new customer saw was still a price tag. (The builder is exempt — it holds
  unsaved work in the DOM.)

- ✅ **The price is €9, everywhere.** Was 89 kr in the app and on the landing
  page, and a stale €10 in the webhook's comments. Lemon Squeezy has one
  currency per store and does not localise it, so the store is the single source
  of truth and the other copies are kept in step by hand.

- 🐛 **The webhook was never going to fire.** It reads `SUPABASE_URL`; the
  Cloudflare project only had `VITE_SUPABASE_URL`. Every delivery would have
  answered `500 not configured` while the dashboard looked correct. It now falls
  back to the `VITE_` name — same string, same project.

- 🐛 **Settings' Go-pro CTA rendered as a 73px stub** against a 384px column.
  `width: auto` on a `<button>` resolves to fit-content whatever its `display`,
  so the `display: flex` trick it relied on never worked. Predates this round;
  fixed here because the round put a second control next to it.

_On `claude/go-pro-setup-payment-6lnmaa`. Restore point: `v0.4`._

---

## v0.25 — the new copy, the legal pages, and no more Google 🔜

The landing page said the right things about a smaller product. The new copy
positions Bito as a training lab rather than an opening trainer, and the page
had to change shape to carry it — eight bands of the same two-column block is
not a page anyone reads to the end of. Alongside that: the privacy and terms
documents finally exist, and the last third-party request on the site is gone.

### The landing page

- ✅ **All new copy, top to bottom.** *Your personal chess training lab* over
  *Improve your next move*; four ways to build; four ways to train; a centred
  argument about playing your own games; five things beyond openings; the
  measures as tags; and the price split into two sections — **Start free** and
  **Your whole repertoire. One payment.** `docs/LANDING-COPY.md` is rewritten as
  the source of truth and now flags which blocks are duplicated in the app.

- ✅ **Five new section shapes, no two alike.** A numbered ledger for the ways
  in, a single bordered panel cut into rows for the training modes, a centred
  narrow column for the argument, a tag row plus a pull quote for progress, and
  two very different price treatments (a wide free card, then a centred
  brass-edged slab). The repeated head/body block now appears three times
  instead of eight.

- ✅ **The app icon leads the top bar**, beside the wordmark, in that order —
  the pairing a phone home screen shows. It keeps the scale trick: absolutely
  positioned and overhanging at rest, shrinking into the bar on scroll, with the
  wordmark's padding travelling with it so the lockup never breaks.

- ✅ **The board breaks the layout on a desktop.** It is translated 88px below
  its own grid row so it crosses into the band beneath, and the scroll handler
  lags it a further 0–74px behind the page before letting go. The clamp is the
  safety argument: drop + max pin is less than the next band's 128px of top
  padding, so it can hang into empty space and can never reach the heading it
  floats over. Untouched on a phone.

- ✅ **"Play the move", with an arrow that moves.** A thin drawn curve into the
  board, bobbing endlessly; the on-board arrowhead now pulses with the fade; and
  the destination square breathes under it, which matters most on a phone where
  a finger is covering the arrow.

- ✅ **Six lines instead of one.** Italian, Ruy López, Scholar's Mate, Queen's
  Gambit, London, and punishing the Damiano — with real captures (Qxf7#, Nxe5)
  and ?? / ? marks on Black's worse ideas, in the app's own danger colours. A
  discreet **Show another line** under the board, **Play another line** in the
  finish panel, and confetti when a line completes.

- ✅ **Desktop hover throughout**, gated on `hover: hover` so a touchscreen
  never inherits a stuck :hover state — the board lifts, squares light up, cards
  rise and take the accent border, chips and price boxes lift.

- ✅ **The 3D pieces do more than slide.** One scroll position now drives three
  properties — drift, a degree or two of rotation, and a breath of scale — with
  a slow ambient drift on a child element underneath. Pieces that only translate
  read as wallpaper; these read as objects passing.

### Legal, and the last third-party request

- ✅ **`docs/privacy.html` and `docs/terms.html`**, plus **`docs/licences.html`**
  because both documents promise a licences page by name and the GPL components
  make that an obligation, not a courtesy. One shared `docs/legal.css`. Linked
  from the site footer and from **Settings → Feedback & about** in the app —
  someone who installed the PWA may never see the website again.

- ✅ **Chakra Petch is self-hosted.** The Google Fonts `<link>` in both
  `index.html` and `docs/index.html` made every visitor's browser call Google
  before first paint, handing over an IP and user-agent — which flatly
  contradicted the privacy policy being published in the same round. The two
  woff2 subsets (latin, latin-ext, ~19 kB) are committed and served from our own
  origin. Verified: **zero external requests** on the landing page.

### The app

- ✅ **A real Full Access popup** (`src/pro-sheet.ts`), replacing the generic
  title-body-two-buttons dialog. Centred at every width — the only overlay in
  the app that is not a bottom sheet on a phone, because a sheet sliding up from
  the bottom reads as a prompt to dismiss and this is a proposition to consider.
  It carries the landing page's own price card and the landing page's own words.

### Second pass, same round

- ✅ **The wordmark sits on the icon's centre line**, not the bar's. At rest the
  icon is much taller than the bar and hangs below it, so a vertically-centred
  wordmark floated up by its shoulder and the pair stopped reading as one
  lockup. One expression — icon centre minus bar centre, from the same variables
  the icon uses — so it stays right at every size and collapses to zero when the
  icon shrinks into the bar.

- ✅ **"Prepare for the games you actually play" is shorter and no longer
  centred.** The opponent-scouting paragraph and the pull quote are cut. Centred
  body copy reads badly and looked like a different website; it is now an
  editorial block — a 2px ink rule, an oversized opening line, and the detail
  beside it in the second column, bottom-aligned.

- ✅ **One price section instead of two.** Free above, Full Access below, same
  width, same padding, same corner — they were a wide card and then a narrow
  centred slab in separate bands, which made one offer in two states look like
  two unrelated products. Heights are deliberately *not* forced to match:
  stretching the shorter box only buys dead space inside it. No "€0" on the free
  box. The paid one still pops on brass edge, frame shadow and a large price.

- ✅ **A portrait next to the signature.** A circle with a brass stroke and a
  hard offset shadow — the speech bubble's own two moves — a little larger than
  the pixel pawn it replaces, because a face at 52px is a smudge. The pawn stays
  underneath as the fallback: if `docs/marcal.png` is missing the `<img>` removes
  itself rather than rendering a broken-image icon. The name links to marxal.net.

- ✅ **"About Bito Chess" is its own band**, immediately after "Why I made Bito
  Chess" and deliberately its sober counterpart — the same subject as fact
  rather than as a story. It was a small grey box under the signature, where it
  read as a footnote to the bubble.

- ✅ **The phone hero has room to breathe.** Loosened only below 900px, where
  an overhanging icon, an eyebrow, a display headline, a paragraph, a button, a
  trust line, an arrow and a chessboard were all competing inside 700px. The
  desktop hero has twice the width and did not need it.

- ✅ **The Full Access popup is half the length.** The headline above the
  question said the same thing twice and is gone; so are the solo-project
  paragraph (the website has room for it, a popup asking for money does not) and
  the free-rotation footnote. The price reads **9€ one payment**, symbol after
  the number, and `PRO_PRICE` moved with it.

- ✅ **"A Bito Chess account", never just "an account"** — in the popup, on the
  landing page, and in the sign-up sheet the checkout opens (`src/checkout.ts`).
  The next screen after that prompt belongs to Lemon Squeezy, and nobody should
  have to work out which of the two accounts they are being asked for.

### Third pass, same round

- ✅ **The two price boxes are centred again**, both of them. The second pass
  tried a left-aligned "detail card" treatment for Free and Full Access; it read
  as a settings panel rather than an offer, so both boxes are back to a centred
  column that funnels down to one button — the shape that reads as a price card.
  Only the Full Access checklist stays left-aligned inside the centred box.

- ✅ **The "Prepare for the games you actually play" ink rule is gone.** The
  section keeps its left-aligned, non-centred layout (that part was right) but
  loses the 2px rule that ran across its top.

- ✅ **The portrait is 150×150** (was 64px) and now a link, same as the name
  beside it — to marxal.net.

- ✅ **"About Bito Chess" is dressed up**: a brass rule down the left edge
  (the same move `docs/legal.css`'s `.tldr` box makes on the privacy/terms
  pages) and the app icon sitting above the heading, so the panel carries a
  face instead of reading as a slab of plain text.

- ✅ **Sign in sits on the icon's centre line too**, matching the wordmark.
  Both used to centre on the bar's own middle; the icon overhangs the bar at
  rest, so Sign in sat visibly higher than "bito chess" the instant the page
  loaded at the top. Same offset expression as the wordmark, same collapse to
  zero once the icon shrinks into the bar on scroll.

### Fourth pass, same round

- ✅ **"Unlock full access" no longer jumps into the app unannounced when
  signed out.** It used to be a hard navigation to `/app/?auth=signup&buy=1` —
  the first thing a signed-out visitor saw over there was a sign-up sheet they
  hadn't been told was coming. A "Create your Bito Chess account first" card
  now appears ON THE LANDING PAGE itself (`#signup-overlay`), styled to match
  the price card it grew out of (brass edge, `FULL ACCESS` label, frame
  shadow), and only that card's own button makes the jump. Dismissible by
  Escape, a backdrop click, or "Not now". Signed in, nothing changes — straight
  to Lemon Squeezy.

- ✅ **"One payment" stopped repeating itself** in the Full Access box — it was
  in the headline ("Your whole repertoire. One payment.") and in the price line
  ("9€ one payment") at once. The headline is now just "Your whole
  repertoire."; the fact stays next to the number, where it's load-bearing.

- ✅ **The portrait is bigger still on a phone — 190×190, up from 150 — and the
  layout switches to stacked** (portrait above, name and role below, both
  centred) below 900px. The side-by-side row doesn't have the width to spend at
  that size: a 190px circle beside two lines of text would squeeze them into a
  five-line ribbon.

- ✅ **Verified the icon/wordmark/Sign-in alignment on a phone specifically** —
  measured, not eyeballed: all three land on the exact same vertical centre
  (30.5px in a 390px-wide viewport) both at rest and scrolled. The previous
  pass's fix already covered mobile; no separate mobile-only rule was needed.

### Fifth pass — buying without leaving the page (tried, then reverted — see sixth pass)

- ⏪ **The account step became a real form, run from the landing page** — two
  Supabase REST calls (`/auth/v1/signup`, `/auth/v1/token`), an email-confirm
  follow-up step, a session written straight to `obertura.supabase.auth`, all
  driven from `vite.config.ts` substituting two build-time placeholders into the
  static page. It worked end to end, but it read as more form than the moment
  called for — a New account/Sign in tab strip, two labelled fields and a
  submit button is a bigger ask than "buy this". **Reverted in the sixth pass**
  back to the fourth pass's one-step interstitial. The code and the writeup stay
  here as a record of what was tried and why it didn't stick — not a set of
  instructions to re-apply.

- ✅ **The speech bubble's tail points at the portrait.** It was pinned at a
  hard-coded 44px, which meant nothing on desktop and hung off into empty margin
  on a phone once the signature became a stacked, centred column. Now derived
  from the same `--avatar` token the portrait is sized from — half the avatar's
  width in on desktop, dead centre on a phone — so resizing one can never leave
  the tail aimed at nothing. Measured, not eyeballed: 0px off on a phone, 2px on
  desktop (the bubble's own −0.6° tilt).

- ✅ **Copy:** "I'm a **passionate** chess player…"; the Full Access box drops
  the solo-project clause and now reads "Want to train everything you've built?
  Full Access unlocks unlimited training and helps keep the project alive.";
  and Lemon Squeezy is no longer named under the buy button — a payment
  processor the reader hasn't heard of is a question, not reassurance, and they
  meet the name on the checkout page anyway.

### Sixth pass — the account form reverted to the interstitial

- ⏪ **Back to the one-step "create an account first" card.** The fifth pass's
  form did the job but felt like too much friction in front of a €9 purchase —
  a tab strip, two fields and a submit button where a single sentence and one
  button used to be enough. `#signup-overlay` / `#signup-card` are back exactly
  as the fourth pass shipped them: brass-edged card, one line explaining why an
  account is needed, **Create account →** to `/app/?auth=signup&buy=1`, **Not
  now** to dismiss. `vite.config.ts`'s Supabase placeholder substitution is
  gone with it — the landing page needs nothing from the build beyond the
  Lemon Squeezy checkout URL again.

  Everything from the fifth pass that had nothing to do with the form stayed:
  the bubble tail's `--avatar`-derived aim, "passionate chess player", the
  shorter Full Access paragraph, and Lemon Squeezy dropped from the buy-note
  copy.

_On `claude/bito-chess-ui-redesign-gh3dd2`. Restore point: `v0.4`._

---

## v0.26 — the Explore slide opens up 🔜

The slide's three suggestions were right and its presentation was quiet: the
tiles read as three labels that happened to be tappable, and the record behind
each move — the part you actually decide on — sat folded behind a chevron.

- ✅ **The three picks look like buttons.** Raised (`--shadow-card`), tinted by
  source, a 1.5px border in the source's own colour, and a **＋ in the corner**
  saying what pressing one does: it adds that move to the line. Pressed, the tile
  sinks a pixel and darkens — which is also the whole affordance on dark, where
  the shadow token is `none`. One `--explore-tint` variable per source drives the
  border, the surface, the plus and the source word, so the three kinds of reason
  stay distinguishable without three copies of every rule.

- ✅ **No accordion — every card is fully open.** The chevron hid the interesting
  part exactly when you were choosing, and made comparing three moves a three-tap
  job. Each card now shows the same fixed layout in the same order, so the three
  read as one table.

- ✅ **Your games against the database, green and red, on one grid.** Two
  win/draw/loss bars per card — **You** over **Masters**/**Lichess** — laid out
  in a two-column grid so the bars line up down the whole panel, plus a line
  saying which way it went: *+23 points better than Lichess players here* in
  sage, worse in brick, and *about the same* when the gap is under 3 points. It
  waits for **3 games of your own** before drawing a verdict, because one win out
  of one game is a 100% score.

- ✅ **The engine's evaluation, on every card that has one.** The cloud eval is
  now asked for at every position the slide shows, not only when the other
  sources came up short — one request per position, cached as a promise so the
  three renders a position triggers can't race three identical requests out. So
  an engine card carries **Engine +0.34**, and a move of your own that is also
  one of the engine's top three says **Engine pick #1** — the most reassuring
  thing the card can tell you. The local shallow search still runs only to fill
  an empty slot.

- ✅ **Popularity where it isn't already said.** A library card's headline is its
  share of the database, so it doesn't repeat it; a card of yours or the
  engine's gets **Played by 30% of Lichess players** as a fact instead.

_On `claude/explore-tab-builder-improvements-n23goq`. Restore point: `v0.4`._

---

## v0.27 — the onboarding tightening round 🔜

Phone review of the first run as it stands. Three separate ways for a first
minute to go wrong: a start screen where nothing said which control to touch, a
walkthrough whose panels could be tapped straight off the line the user had just
chosen, and no second chance for anyone who skipped.

- ✅ **The start screen has one action, and it looks like it.** Depth is the only
  unanswered question on the picker — colour has a default, the styles don't
  exist until depth is picked — so it's now the only thing dressed as a live
  control: an accent **START HERE** chip beside its label, accent-edged tiles
  with a soft ring, and one slow breath (twice, not a loop — a control that
  pulses forever reads as an error). Colour drops to a quieter, one-size-smaller
  row, and **Sign in** loses its bordered pill for a plain underlined word: in
  the corner every website puts its primary action, a pill was pulling
  first-timers to the one control that isn't for them. All the emphasis comes off
  the moment a depth is chosen and the styles arrive in its place.

- ✅ **Nothing scrolls behind the picker.** The overlay is `position: fixed`, so
  the app underneath kept its own scroll height — a scrollbar down the side of a
  screen with nothing to scroll, and a Train screen sliding about behind a swipe.
  `html.picker-open` freezes the page while the picker is up and releases it on
  close; the import sheet still scrolls, because sheets scroll inside themselves.

- ✅ **The walkthrough's panels are for looking at.** Every panel step (Explore,
  Library, My lines, Line info, Engine) is now `lookOnly`: taps reach the app, so
  the lists still scroll and the tab strip still switches panels, but every
  control inside them is inert. The board, the dock, the header and the nav go
  with them. It closes the hole the old live Explore step left — one tap on a
  suggestion and a first-timer had silently walked their line off the opening
  they picked one screen earlier, three bubbles before being asked to save it.
  The only ways on are **Next**, **Back** and the tabs.

- ✅ **Skipping isn't spending your turn.** The walkthrough now records *done*
  (reached its last bubble) separately from *seen* (it opened). Someone who
  skipped and comes back to a genuine first run — no saved lines, onboarding
  unfinished — is offered it again, and a **Take the walkthrough** row sits at
  the top of the Get-started checklist, ticked off once it's been walked, so
  there's always a way back to it that isn't buried in Settings.

_On `claude/onboarding-process-improvements-5wy3u1`. Restore point: `v0.4`._

### Daily challenge — the completion popup

- ✅ **A reward at the end of the daily.** Clearing every task now lands a small
  centred popup: the hopping pixel pawn, today's accuracy against yesterday's as
  two bars with a delta chip, one line of encouragement, and three overall
  figures — day streak (flagged when it's a personal best), challenges cleared
  all-time, and lines mastered. It waits for the finishing task's own results
  screen to close, so the two never stack, and the backdrop, the back gesture,
  Escape or the button all get rid of it.

- ✅ **Its own numbers.** Each task now reports how many moves it got right and
  wrong; those go into a per-day daily-challenge log (`daily-recap.ts`) so today
  is compared against a day of the same shape rather than against everything you
  happened to do that day. Yesterday missing falls back to your last logged day,
  labelled honestly.

- ✅ **The perfect day.** A challenge finished without a single wrong move — on a
  day with at least three tasks, none set below two — swaps the popup for a brass
  one, and the pawn promotes: it hops, bursts, and comes back as a pixel queen.
  Nothing anywhere else in the app hints that it's there.


---

## v0.28 — training learns the position index 🔜

The index (`src/position-index.ts`) already knew which lines pass through which
positions; only the save flow used it. Training now does too — see
`TRANSPOSITIONS.md` §8 and §9, which this round implements.

- ✅ **Shared work is credited once.** A move drilled in one line is the same move
  in every other line that plays it from that position, so the record travels:
  grading writes it through to all of them. Keyed on position **and** move
  together — a different answer from the same position is different knowledge and
  is left alone, so drilling a main line never credits the surprise weapon filed
  beside it. Parked lines take it too (it describes what you know, not what's in
  the rotation), and nothing about it counts as a second review: no streak, no
  "moves reviewed", no last-trained on the lines it credits.

- ✅ **A wrong-but-prepared move becomes a choice — without moving the board.**
  Play another of your in-training lines' moves during a full-line run and
  there's no red flash: the board shows every saved answer here as an arrow —
  green for the move the line you're training plays, blue for each of the
  others — and an informative card appears *below* the board (never above it,
  never shifting anything) naming which line each colour belongs to. You choose
  by playing one of the arrows, not by tapping a button: the green one just
  continues where you are; a blue one hands off to that line, credits it,
  drops it from the queue if it was waiting there, and walks it from the
  position you're standing on rather than replaying what you just played (and
  grades only what it actually asked). The line you left takes no penalty and
  no credit — it stays exactly as due as it was. When the recognised line is
  parked, the normal correction stands but says whose move it was, so the app
  explains rather than just refusing.

- ✅ **Never where it would nag.** Only the full-line walk. The single-move mode,
  the timed sprint and the confirm run are structurally excluded — a dialog with
  a clock running would be infuriating — and nothing ever announces in advance
  that a position has two answers: the arrows and the card only exist after the
  move is played. The judgement reuses the drill's existing `checkAlternative`
  slot (the engine's version of the same question) rather than growing a second
  wrong-move path.

_On `claude/position-index-training-1fr7qh`. Restore point: `v0.4`._

---

## v0.29 — My Lines gets a tree 🔜

A fourth stop on the grouping toggle in My Lines: the same screen, the same
filter bar, the same remembered preference — but the filtered lines drawn as
ONE map instead of a list, merged by **position** rather than by path. Two lines
that transpose into each other stop being two branches that never touch and
become one node that continues once.

- ✅ **Merged by position, not by path.** `src/map-merge.ts` keys nodes by the
  position key already shared with `openings.ts` and `position-index.ts`, so the
  QGD reached by 1.d4 Nf6 2.c4 and by 1.c4 Nf6 2.d4 is one node carrying both
  lines. The route that got there second is drawn as a dashed edge rather than a
  second branch, and it keeps its own move — which is what makes the answer
  count right.

- ✅ **A position merge can loop; this one can't.** Path merging cannot produce a
  cycle. Position merging can, two ways: a repetition (1.Nf3 Nf6 2.Ng1 Ng8 is the
  start position again, exactly) and two lines crossing over each other. Guarded
  three ways: one visited-key map, so a node joins the walked tree only in the
  branch that creates it (child edges therefore always go one ply deeper); a hard
  80-ply cap; and a severing pass that demotes any child edge that would revisit
  a node. `map-merge.selftest.ts` drives a real repetition, a real cross-over and
  240 plies of knight shuffle through all three.

- ✅ **Where you have more than one answer is marked.** A small numbered dot on
  every position where the saved lines give you a choice — counting the answers
  that leave by a merge edge as well as the ones that leave as branches. Opponent
  forks are not marked: several replies to face is not a decision you make.

- ✅ **Read-only, and no new screen.** No editing, no dragging, no deleting —
  authoring stays in the builder. The map viewer (`repertoire-map.ts`) grew a
  `mountRepertoireMap` so it can be embedded in a page instead of only opened as
  an overlay; the existing zoom, pan, arrows and position preview are reused
  exactly as they are, with no new gestures.

_On `claude/repertoire-tree-position-i9r6si`. Restore point: `v0.4`._

---

## v0.30 — coverage gaps 🔜

The opponent replies your repertoire has no answer to, ranked by how much they
actually matter, one tap from preparing each. A gap is a position in your saved
lines where it is the OPPONENT's move, a reply exists, and none of your lines
answers it.

- ✅ **The floors are the feature.** Every repertoire has infinite gaps at
  sufficient depth, and an unbounded list reads as a verdict on your work. A
  reply only counts once it clears one: **faced twice** in your own games, or
  **≥8% at your rating band with ≥50 games** behind the position (the sample
  floor is the important half — one game in three is not "33% at your level"),
  or **played twice by a scouted opponent**. Capped at **12 plies** deep, **2
  gaps per position**, 12 rows on the screen and 3 in the builder. Positions
  where NOTHING is prepared are excluded outright: a line that simply ends is a
  stopping point you chose, not a hole.

- ✅ **Every row explains itself, and the sentence is the ranking.** "faced 3
  times", "played 34% at your level", "Erik plays this" — in the app's
  established source order (your games, then the library, then the scouts, the
  same priority explore-panel.ts uses). A ranking the user can't explain to
  themselves is noise.

- ✅ **Coverage is shown as a positive.** "44% · 4 of 9 replies answered", with a
  bar per opening family, above the list — from the same notable-reply set the
  gaps come out of, so the two numbers cannot disagree.

- ✅ **A bounded explorer budget, decided out loud.** The live explorer is asked
  about at most **24 positions per computation, shallowest first, one at a
  time** (lichess-explorer.ts aborts any in-flight request, so they cannot be
  parallelised). Everything past the budget uses the bundled set and is labelled
  all-ratings — the screen says how far the live check reached, and a bundled
  answer never claims to be "at your level". The report is memoised per colour
  (and per connection state) so the builder's per-move repaint costs nothing.

- ✅ **One component, two homes.** `coverage-section.ts` renders the block; the
  builder's My lines panel takes three rows of it and the Coverage screen
  (`coverage-screen.ts`, the map viewer's overlay chrome) takes the lot plus the
  family breakdown. "Build from here" seeds the builder at the position in the
  answering colour through the EXISTING Prepare flow — with the "vs <name>" tag
  when the gap came from a scouted opponent.

- ✅ **Derived, never stored.** No new record, no field on `Line`, nothing in the
  synced payload; recomputed on read. `coverage-gaps.ts` is pure (explorer
  numbers arrive as data, not as a fetch) and covered by 23 self-tests.

_On `claude/coverage-gaps-feature-6afe3b`. Restore point: `v0.4`._

---

## v0.6 — the repertoire redesign 🔜

The model change the app had been working around for a year. **The tree is the
data; a line is a view of it.** Decision record: `REPERTOIRE-REDESIGN.md`.

### Phase A — the model, the projection, the migration ✅

- ✅ **A repertoire is one move tree.** `repertoire.ts` holds the book and its
  pure operations: merging a path (which creates only the moves that aren't
  already there), line ends, the inherited `training`/`tags`/`priority`, and the
  cut "delete this line" has to make so the moves it shares with its neighbours
  survive — a distinction the flat-line model could not express at all.
- ✅ **Lines are projected, so nothing downstream changed.** `lines-view.ts`
  turns books into the same `Line[]` the app has always consumed. My Lines, the
  Train hub, the drill, statistics, coverage, the map and the daily challenge
  were not touched. Only the writers moved.
- ✅ **The write-back refuses to stamp what a branch already says.** Writing a
  line back never records an explicit `training` flag that merely repeats an
  ancestor's — otherwise every drill would quietly leave stale per-leaf flags
  that out-vote the next branch toggle.
- ✅ **Migration, not a clean slate.** `repertoire-migrate.ts` merges the old
  records by path, takes the better review record where two lines disagree
  (TRANSPOSITIONS.md §10), and keeps a line that ends inside a longer one as a
  line in its own right, so the line count a user sees is the one they had.
  Verified on a seeded device: 5 old lines → 2 books, white's 18 stored moves
  collapsed to 10, all 5 lines still listed.
- ✅ **Storage v4**, with the old `lines` store left untouched as a one-version
  rollback. Backup format v3 carries repertoires; v1/v2 files still restore.

### Phase B — the builder stands inside the repertoire ✅

- ✅ **Walking is not editing.** The builder loads the whole book, so every move
  already prepared is there to navigate. Playing a move you have walks onto it
  and writes nothing.
- ✅ **A new move is a draft, and the button counts it.** "Add 3 moves", not
  "Save line" — and committing MERGES, so extending a line stores the new moves
  rather than a second copy of the line. The old duplicate machinery
  (TRANSPOSITIONS.md §4/§5/§6) is skipped inside a book, because the second copy
  it existed to prevent can no longer be created.
- ✅ **Deleting quotes an honest number.** "This removes 3 moves… moves it shares
  with your other lines stay."
- ✅ The seeded single-line flows — the onboarding walkthrough, "prepare a
  reply", a line extracted from a game — deliberately still lay one line down in
  the old mode, and merge into the book when saved.

### Phase C — My Lines becomes a repertoire screen ✅

- ✅ **A book selector**, above the filter bar and hidden until there is more than
  one book to choose between. Behind it: make a repertoire, rename one, put one
  aside (out of training without touching a line), delete one. Putting a book
  aside is the reason `archived` beats pausing twenty lines by hand.
- ✅ **Branch actions on any node of the tree view.** Pause or train the whole
  branch, set how often it comes round, name it, tag it, build from it, remove
  it — each one saying how many lines it is about to move, because a control that
  silently changes twelve things is a control nobody trusts twice.
- ✅ **The branch's answer replaces the lines'.** Training, priority and names set
  on a branch clear that field on everything below, so a line set individually
  months ago can't out-vote today's tap. Tags are the deliberate exception: they
  accumulate. Verified — pausing 1.e4 e6 wrote ONE flag and paused exactly the
  two French lines.
- ✅ **The builder follows the book you're looking at.** A line built while "Blitz
  — White" is selected lands in that book; opening a saved line opens the book it
  actually lives in, never whichever one the list was filtered to.
- ✅ **`FREE_REPERTOIRES = 3`** (the two defaults plus one extra) and a
  whole-branch training check that refuses to enrol an arbitrary part of a branch
  — a user who asked for the French and got seven of its twelve lines would have
  no way of knowing which five were missing.

### Phase D — training walks the book ✅

- ✅ **Repertoire run**, a mode beside the line walks rather than a replacement.
  A session of line walks asks the shared opening once per line — six lines
  through 1.d4 d5 2.c4 means answering 2.c4 six times, and write-through fixes
  the score afterwards but not the four minutes. The run visits tree nodes, a
  node is visited once, so the dedupe is structural rather than a filter someone
  has to keep honest.
- ✅ **It reads like going through a book.** Depth-first: down a line, back up to
  the last branch when it ends. Paused branches and books put aside are skipped,
  and spacing comes from the priority resolved at each node — so a branch marked
  "less often" is respected move by move rather than through whichever line
  happens to be named there.
- ✅ **The card quotes the saving**, counted over exactly the moves the run
  covers. The first version compared the run's moves against every line's moves
  including the opening plies the run never asks, which overstated it; both sides
  now cover the same set.
- ✅ **The line walk is untouched.** Walking a line start-to-finish is muscle
  memory and was never the thing to fix.
- ✅ "Individual moves" needed no change — it already deduped by position and move.

Verified at the real UI on six lines sharing 1.d4 d5 2.c4: 8 moves due, a
reported saving of 4, and answering 2.c4 once graded the one shared node.

### Phase E — transposition joins ✅

- ✅ **"From here, continue as in that line."** A line end can point at another
  line that reaches the same position by a different move order; the moves after
  that position are appended to it. They are the same nodes, so drilling either
  line grades the same records and nothing is stored twice — taking a join left
  the book's stored move count exactly where it was.
- ✅ **The tree stays a tree.** A join is followed once (two lines pointing at
  each other cannot loop), a continuation that would revisit the line's own moves
  is refused, and the target must be the same position — not merely somewhere
  else in the book. All three are self-tested with real chess.js positions.
- ✅ **A join changes what a line plays, never what it is.** Name, tags, training
  and priority resolve from the line's own branch, so joining into a paused
  branch can't pause the line that joined, and renaming a joined line can't
  rename the line it points at.
- ✅ **The control sits on the line card, not the tree.** The tree merges by
  position, so two roads to one square are drawn as a single node — exactly the
  node a join cannot be made on. "Line options" on a card opens the same branch
  sheet, where a line has an unambiguous end.

**Still to do:** routing the seeded single-line flows (onboarding, "prepare a
reply", a line pulled from a game) through the book. They merge correctly on
save, so nothing duplicates; they just don't show you the book while you work.

### Phase F — the builder after real use ✅

First round of fixes from actually building on the phone. Four defects and two
pieces of housekeeping.

- ✅ **Walking your own repertoire counted as drafting it.** The builder asks
  `hasMove` before every `addMove` to tell navigation from addition — but
  `hasMove` compared a SAN against a node's `uci`, so it never matched. Every
  move played was counted as new: a fully prepared path read "Add 5 moves", the
  move strip drew prepared moves as drafts, leaving the builder raised the
  unsaved-work guard, and "Discard" there would have cut real moves out of the
  working tree. Both now go through one `findChild`, so they cannot drift apart
  again.
- ✅ **Nothing to add now says what IS there.** In a book the header button
  reads the position rather than greying out: "23 lines saved" at the start,
  "6 lines from here" mid-book, "Line saved" on a line end — outlined and inert,
  because it is a statement, not an action. The builder can now answer "have I
  done this one?" without a trip to My Lines.
- ✅ **"Latest" was ordering by nothing.** A line's date comes from its newest
  move, and moves added in the builder were never stamped — `addMove` doesn't go
  through `mergePath`, which is what stamps them — so every line built since the
  redesign projected as undated and sorted to the BOTTOM. Repertoire-mode moves
  are stamped now, and one shared comparator (`byNewestFirst`) falls back to node
  sequence for books already saved without stamps, so existing repertoires order
  correctly without inventing timestamps for them.
- ✅ **The builder board's per-move cost.** `pathTo` searched the tree copying
  its trail at every node it visited — cheap when the tree was one line, but
  since the redesign it is the whole book, and a dozen readers ask for the path
  behind every move. Profiling ten moves on a 2,900-node book put it at the top
  of the app's cost (70ms); pushing/popping one array and remembering the answer
  until the tree changes takes it to 7ms, below chess.js's own move generation.
- ✅ **Coverage gaps left the builder.** They were the one block on the My lines
  slide not about the position on the board, and while you are building, a list
  of what you have *not* built is noise. They live on My Lines.
- ✅ **The header title gets two rows.** Opening names are long and the Save
  button takes most of the row, so a single nowrap line was an ellipsis nearly
  every time. It wraps to two lines at 0.95rem and clamps there — 36px inside a
  38px row, so the header keeps exactly the height it had and the board doesn't
  move.

### Phase G — the line card, its popup, and what the draft really is ✅

- ✅ **A card says what the line needs, then what it is.** Two rows in the order
  you'd scan them: `● Due now · 4 of 7 moves` over `14 moves · 7 only here · ●●●○○`.
  The old row was "Confidence — · Never trained", two backward-looking figures
  that read as something broken. A coloured dot carries the state so a list of
  cards is scannable without reading a word, and **paused wins over due** —
  telling someone a line is due when the scheduler will never offer it is the
  kind of small lie that costs trust in the whole screen.
- ✅ **"7 only here" is the tree model made visible.** A line whose 14 moves are
  7 of its own is half shared prep — which is why deleting it cuts only 7, and
  why drilling it re-covers ground met elsewhere. Derived from the path the
  projection already holds (no extra tree search), by the same rule
  `lineTailStart` uses, so it agrees with the delete confirm by construction.
- ✅ **Tapping a card opens the line's popup, not the builder.** Nine times in ten
  the question is "what is this and how is it going?", and answering it meant a
  round trip through the editor with a save guard on the way out. It reuses the
  Forgotten-moves peek — steppable board, move list with miss bars, recall
  figures — plus the line's state, shape and tags, and offers *Drill line* /
  *Add to training* and *Open in builder* as the ways on.
- ✅ **The draft is no longer counted in secret.** Inside a book the draft is
  book-wide and every view of it was line-wide: add three moves off the French,
  walk back, add two off the King's Indian, and the header said "Add 5 moves"
  while the move strip showed two of them — or none, once you had walked on. It
  now commits straight away when every added move is on the line in front of you
  (the ordinary case, still one tap), and otherwise **shows you the draft first**:
  each place you have built, the moves it would write, a way to go and look, and
  a way to drop just that one. The button carries a `2 places` chip so the number
  never silently outruns what you can see.
- ✅ **The way out stopped being all-or-nothing.** Leaving with work in two places
  used to offer one "Discard" that threw both away, having named neither. It now
  opens the same list, with *Add all* · *Discard them all* · *Keep editing*.
- ✅ **Adding is reversible.** The confirm toast carries an Undo that removes
  exactly the branches just written — the redesign asked for this in §5 and it
  had never been built.

_On `claude/builder-ux-repertoire-redesign-j26ygg`. Restore point: `v0.5`._

---

## v0.6b — taking moves back out 🔜

The builder could only ever ADD. Removing a move meant leaving for My Lines and
finding it again, so in practice nobody did and the book only grew. This round
gives removal a home in the builder — and gives the save button somewhere to go.

- ✅ **One rule, said the same way everywhere.** *Removing a move removes
  everything after it; everything before it stays, because your other lines are
  built on it.* There is no "keep the rest" — the rest only exists because of
  that move. So the only honest question is how much goes, and `line-removal.ts`
  answers it once for every screen that asks: how many moves, how many lines,
  which lines by name, and the sentence people actually want — **"your line will
  end at 1.e4 c5 2.♞f3 instead"** when the line survives a move shorter rather
  than disappearing.
- ✅ **A trash on every "My saved lines" row.** That row already answers "what
  does my book play from here?" — one move, one branch, one count — so cutting it
  reads as trimming that answer rather than deleting something abstract
  elsewhere. Tap the move to play it, the icon to take it out.
- ✅ **The save button stopped being a dead end.** With nothing to add it was
  *disabled*, so "3 lines saved" was a fact you could not tap. It is live again:
  at the start position it goes to My Lines; deeper in it opens the branch sheet
  for the position you are standing on — name, tags, pause, priority, remove —
  with a chevron saying so. Not at the start, deliberately: there the "branch" is
  the whole repertoire and its remove button would be one tap from the header.
- ✅ **Confirm scaled to the cut, Undo always.** One line comes out on the tap
  with a `Removed 4 moves — Undo`; several lines stop and get named first.
  Confirming everything is how you teach someone to tap through confirmations, at
  which point the wide cut goes through as easily as the trim.
- ✅ **Undo re-attaches the very subtree that was taken** — review history, notes
  and confidence intact. Re-playing the moves would not bring any of that back,
  which is exactly why removal was worth being careful about before it could be
  offered in more places.
- ✅ **Two bugs found on the way.** `removeAndStore` wrote `serialise()` — the
  whole working tree, open draft included — so removing a move while drafting
  silently committed moves the user had never added. The cut is now made on the
  stored tree by id, separately from the board's. And the branch sheet writes
  straight to storage, so opening it from the builder now re-reads the book
  afterwards; without that, a later commit would have written the stale copy back
  and resurrected whatever it removed.

- ✅ **The branch sheet stopped shouting.** Now that the save button opens it,
  it is a sheet people land in rather than seek out, and its weights were
  backwards. The training switch is the app's own switch instead of a filled
  card; "How often it comes round" is called **Training priority**; the two text
  inputs — the least-used controls in the sheet and much its loudest — fold
  behind one quiet *Name & tags* line that shows what they hold; and **Remove**
  drops from a filled red button in the same stack as Done to quiet text at the
  foot. Weight follows how often a thing is wanted; the seriousness is carried
  by what happens after the tap.
- ✅ **"Show on the tree"** — a quiet link opening the same map My Lines draws,
  already centred on the branch you are standing on. Seeing where a branch sits
  among its neighbours is most of what makes a removal decidable: it is the
  difference between "2 lines" as a number and two lines you can point at.

_On `claude/repertoire-move-removal-flow-upnamo`. Restore point: `v0.5`._

---

## v0.6c — the line card grows up, and one screen stops being two 🔜

A round about the two places a line is looked at — its card in My Lines and the
popup behind it — plus four fixes to things that were quietly wrong on the way
past. The thread through all of it: a line is a thing you train, and once you
have trained it enough the useful next step is to make it longer.

- ✅ **Every action on a card is now in one row at its foot.** The pencil used to
  sit up in the title row and open a rename sheet; a line's NAME is the least of
  what you'd want to change about it, and naming already lives in the options
  sheet with the tags it belongs beside. So it comes down, and it opens the
  builder at the end of the line. The row now reads train · edit · options ·
  delete — ordered by how often each is wanted, and a card is read top-down and
  acted on at the bottom.
- ✅ **A train icon on the card** — the Train tab's own bolt, so the action reads
  the same wherever it appears. In the rotation it drills straight away; out of
  it, it runs the same add-to-training flow the popup offers. Four icons is the
  whole set: the switch beside them covers pausing, and the options sheet covers
  name, tags, priority and remove, so a fifth would be a second door to a room
  that already has one.
- ✅ **"5 runs · 100% recall"** — the two figures the popup already showed, quiet
  and last on the card, and computed in ONE place now (`line-status.ts`), so the
  list and the popup it opens can't quote different numbers. Silent on a line
  never drilled, where "0 runs · — recall" is punctuation saying what the status
  row said in words.
- ✅ **"Keep growing this line"** — a chip on a line that has been round three
  times or more, clean, with nothing saved after its last move. It opens the
  builder standing at the end of the line, which is where the moves would go.
  The trainer says it too: a line graded clean on the way past the finish screen
  gets a ★ on its row and one line above the list. This is the first thing in
  the app that says *stop drilling this and make it longer* — the reps have
  stopped paying, and depth is what's left to gain.
- ✅ **Search on My Lines** — a magnifier beside the sort and group icons opens a
  field that filters by name (and by the detected opening, so typing "sicilian"
  finds the lines you never renamed) as you type. While something is typed the
  results come back FLAT: both grouped views answer "find me this line" with a
  list of closed families the match is hidden inside. The text is never
  persisted — a filter you chose is worth remembering, a half-typed name
  silently hiding your lines after a reload is not.
- ✅ **"Lines in training" is gone from Train.** It was a second copy of My Lines
  one screen away from the real one, with its own filter bar, its own grouping,
  its own paused-rows toggle — and the only thing it could do that My Lines
  can't was flick a switch My Lines also has. Training now belongs to what you
  drill; the book belongs to My Lines. (~470 lines of screen and CSS with it.)
- ✅ **The results screen's Edit opened nothing.** Tapping a reviewed line on the
  finish screen opens its position; its Edit navigated to the builder *under* the
  completion overlay, which is a fixed full-screen layer on `<body>` — so the
  builder loaded, correctly, behind the results screen still covering it. It
  takes the overlay down with it now.
- ✅ **The chronic-miss nudge stopped moving the board.** It was inserted in flow
  between the status line and the controls, which grew the bottom block and
  pushed the board up mid-drill. It floats over the control row now, like the
  note and divert cards, on the same rule those two already followed: *nothing
  may move the board you are playing on.*
- ✅ **"Add without playing"** — a quiet link on the confirm run, opposite the
  exit. It saves exactly what a clean run would have saved, so nothing about the
  line's schedule depends on having played it. Deliberately quiet, because
  playing it once is worth doing: it is the first review, and the one that tells
  you whether you can actually recall what you just wrote down. Not offered on
  the guided first line, which has its own "Skip this time" on the coach-mark.
- ✅ **The library's level control is a dropdown.** Six rating pills never fitted
  a phone beside the Masters/Lichess toggle, so the strip wrapped onto a row of
  its own — two rows to say one thing. One pill-shaped menu now sits next to the
  toggle (native `<select>` laid transparently over it, so the platform picker
  opens on a tap and it stays accessible for free), and Masters greys it out with
  the reason underneath, as before.
- ✅ **"Due due tomorrow."** Found on the way past: `describeDue` already leads
  with the word, and `lineStatus` prefixed it again — on every card and popup of
  every line that wasn't due yet.
- ✅ **A follow-up pass on the card and the popup.** The training switch moves
  onto the icon row, on the left, so a card is one row shorter — its own label
  shrinks to "On"/"Off" to fit (the switch's colour already carries the state;
  `aria-label` keeps the full sentence for anyone not reading it visually). The
  card's shape row drops "12 moves · 3 only here" and keeps only the confidence
  dots — the one figure of the three that actually changes as a line beds in —
  and `lineShape`/`lineShapeText`/`lineShapeLongText`/`spineLength` go with it,
  unused everywhere once that text is gone. The popup drops its own copy of
  "Due tomorrow · 8 moves long": both were already sitting on the card you
  tapped to open it, so repeating them here was an echo, not information. The
  "You know this one" mastered verdict becomes a filled banner instead of a
  line of quiet text — the one thing on that sheet that asks you to DO
  something earns to look like it — and the "drilled" stat box (how many
  moves have ever been asked) becomes "correct" (how many are right now on a
  clean streak), which is the question the box next to a recall percentage
  should actually answer.
- ✅ **The confidence dots were also on their way out, and the popup's "correct"
  box had a real bug.** The dots come off the card entirely (nothing replaced
  them — the training-figures line already covers "how is it going"), and the
  switch's label goes back to the full "Training ON/OFF" — legible over
  compact. The two together don't fit one row next to four full-size icons at
  the card's actual ~226px content width, so the footer wraps to a second line
  when it needs to, exactly as it always did, rather than clipping the delete
  icon off the card (measured, then seen) or shrinking icons past a size worth
  tapping. Separately: the popup's "correct" box divided by the WHOLE line, so
  a line drilled clean for weeks and then extended ("Keep growing this line")
  counted its brand-new, never-tested moves as wrong rather than not-yet-asked
  — "23 runs, but 4/8 correct" for 4 solid old moves and 4 untested new ones.
  It now divides by what's actually been drilled, the same denominator recall%
  is already a percentage of, so the two figures can't read as contradicting
  each other.
- ✅ **The footer, one more time — same row, full label, matching icons.** Two
  rows ago the label shrank to "On/Off" to hold one row; the round after that
  reverted to the full "Training ON/OFF" text and let the row wrap onto two
  lines rather than clip an icon off the card. Neither was actually wanted:
  one row AND the full name, always. The card's content column measures out at
  ~226px next to its board, which doesn't hold "Training ON/OFF" at full size
  beside four 36px icons — so the LABEL's font shrinks (0.58rem, scoped to this
  footer) and the icon buttons come down a notch (26px, still a real tap
  target and clear of WCAG's 24px minimum) while the switch itself stays
  exactly the size it is everywhere else. The toggle is sized to its content
  rather than flex-shrunk to fit, so it can never truncate into "T…" again —
  if the numbers ever stop adding up, something will visibly overflow instead
  of silently clipping. The train icon also drops its accent tint; all four
  icons read as one quiet, equal-weight row now.
- ✅ **…and the actual fix: the footer moves out from beside the board.** Every
  round of shrinking text and icons was fighting the wrong constraint — the
  footer lived inside `.pcard-content`, the narrow column squeezed to one side
  of the board thumbnail (~226px of a ~350px card). It's appended to the CARD
  now, a sibling of the board+info row rather than a child of it, so it spans
  the full card width below the board. Nothing in it needs to be trimmed down
  any more: the switch, its full "Training ON/OFF" label and all four icons at
  their normal 36px are back to the same sizing used everywhere else in the
  app, with room to spare.

_On `claude/lines-library-ui-n0jbi2`. Restore point: `v0.5`._

---

## v0.6d — the builder tells you what it is doing 🔜

Ten fixes to the builder, all of them versions of the same complaint: the panel
was describing something other than the thing in front of you. A brand-new line
opened with moves already written in the strip. The header named a line you had
not chosen. Flipping the board to look at a position from the other side quietly
re-filed the line in the other colour's book. And the one button that admitted
the confusion said "1 place", which meant nothing to anybody.

- ✅ **Flipping the board carries the line across.** Flipping still switches the
  colour the line saves as, and says so — looking at a position from the other
  side is nearly always the moment you decide to prepare THAT side. What is new
  is that it now moves to the other colour's book and replays the moves on the
  board into it, so the flip carries the work rather than leaving it filed under
  a book it no longer belongs to.
- ✅ **A new line opens blank.** Inside a book the strip drew "the line you are
  standing in", which it worked out by descending the first continuation from
  the cursor — and at the start position that is whichever line happens to be
  first in the book. So the builder opened on a fresh line already showing
  somebody else's moves, with their name in the header and their statistics on
  Line info. The strip now draws the path you actually walked and nothing more,
  and `currentLineEnd()` returns null at the start and at any fork: standing on
  1.e4 with three answers under it is not standing in a line, and the panel says
  the honest thing rather than naming one at random.
- ✅ **The draft is drawn in full, variations in parentheses.** Play three moves
  off the French, walk back, play two off the King's Indian, and the strip shows
  both — `1.e4 e5 2.f4 (2.Nc3 Nf6)`, PGN style, each uncommitted move dashed. So
  "Add 5 moves" is now always a count of moves on screen, the "2 places" chip is
  gone, and the header button commits in one tap instead of stopping to show you
  work you could not see. Several answers to one position can be built and added
  in a single go, which the tree could always store and the strip could never
  show.
- ✅ **An info button per tab**, bottom right of the sheet: one discrete (i)
  whose dialog follows whichever slide is showing (`builder-info.ts`). The
  Library's own (i) went — that dialog is now what this button opens there.
- ✅ **Line info is one row of four.** "Title" went: a line is named by the
  opening it reaches, shown right under the row, and hand-naming it was a
  control almost nobody used taking a quarter of the width. What is left is
  training · tags · note · delete, with delete icon-only so all four fit a phone.
  The training toggle moved up from the old footer, which is gone.
- ✅ **The bottom bar is four navigation controls**: start · end · back ·
  forward. Getting to either end of a line took as many taps as it had moves.
  The play/watch button went to make room — a line that plays itself is what the
  trainer's watch step is for — and the two jump buttons are narrower than the
  step arrows, which is where the thumb actually lives.
- ✅ **Forward follows the line you walked.** Inside a book it used to mean
  `children[0]`, so at the start of a book tapping Forward played whichever line
  happened to be stored first, one move at a time. The builder now remembers the
  deepest node the cursor has stood at: stepping back keeps the way on (and the
  strip keeps drawing it), stepping elsewhere starts a new walk, and a fresh
  builder has all four arrows dead because there is no line yet.
- ✅ **A draft that finishes more than one line stops and shows them.** Every
  line the write is about to add gets a row — its opening, its moves, a
  train/store switch and a bin — and "Add all 3 lines" then runs a confirm drill
  on each one that said train, back to back. Two lines are two decisions, and
  "Add 7 moves" was not where to make them.
- ✅ **Explore's cards stopped being buttons.** Each card had a round plus and a
  press state, duplicating the tile directly above it, so the slide offered
  every move twice. The cards are reading matter now — but they keep their
  outlined chips, their divider and their tinted verdict strip, which is what
  makes three cards scannable as one table. The list gained a heading of its
  own ("Why these moves") so the slide reads as answers then evidence.
- ✅ **Empty sections on My lines collapse to one line.** Three sections each
  drawing a title and then a sentence saying it had nothing filled a fresh
  book's panel with three restatements of "nothing here yet".
- ✅ **Line info and the Game tab carry the move list in a box** — the same
  moves as the strip above, wrapped rather than scrolled, so the whole sequence
  reads at once. The Game tab's tags and note gave way to "Open in builder" and
  "Save line", which is what a game is actually for.
- ✅ **The Library tab's info is about the library**, not about a database: a
  third of the words, titled after the tab, and it still carries the Lichess
  connect button.
- ✅ **Auto-reply**, on the Explore slide, as a block of its own. Building a line
  means playing both sides, and half of every line is a move of the opponent's
  chosen only so the next one of yours can exist. With the switch on, that half
  is played for you, and a picker beside it says where the reply comes from —
  best guess, your games, the library or the engine. "Another reply" (full
  width, and a real tap target — it is the control you press once per reply you
  don't want) takes the played reply back and cycles to the next. A Black book
  gets White's first move played the moment it opens.
- ✅ **"Build with the engine" is gone**, and auto-reply is why: it was a whole
  second board you played a casual game on, a game first and a line second, when
  the thing it was for is having an opponent to answer while you build. Out with
  it went `spar.ts`, `book-lines.ts`, their self-test, the Explore launcher, the
  FAB entry, the Get-started link and the `sparEngineEnabled` key.
- ✅ **A line says when it was added** — on its card in My Lines and under "How
  this line is going" in the builder. The per-move `createdAt` stamps were
  already there (they are what "Latest" sorts by); this is the first time they
  are shown. Relative for the first week ("Added 3 days ago"), then a date.
- ✅ **The move strip has a tone of its own**, a few percent of the text colour,
  so it reads as the moves of the line rather than as the top row of whichever
  panel is showing.

Four things were quietly wrong and were fixed on the way past: playing a move
never re-derived the line state (only navigating did, so the header kept naming
the line you had just branched away from); "Delete game" was hidden on every
game opened from My games, because `analyserGameId` is set after the build that
paints the button; "Watch line" inside a book played the book's FIRST line back
at you from wherever you stood; and an empty book offered "Add 0 moves".

_On `claude/builder-improvements-sbs5fs`. Restore point: `v0.5`._

---

## Stripe migration — off Lemon Squeezy, on to being the merchant ✅

The processor swap. **Not a product change:** it is still a one-time unlock, still
"no subscription ever", and every existing customer keeps their access untouched
(`profiles.entitled` is never rewritten by this round).

The original brief asked for `mode: 'subscription'` with recurring prices. That was
raised as a conflict before any code was written — the app, the landing page, the
meta description, the JSON-LD and both legal pages all promise a single payment — and
settled as **one-time**, with no Stripe Tax, and the hosted redirect rather than
embedded Checkout.

- ✅ **Three Worker endpoints**, not Supabase Edge Functions: this repo has no
  `supabase/` directory, no CLI and no migrations, and the server already lived in a
  Worker. `GET /api/stripe/prices`, `POST /api/stripe/checkout`,
  `POST /api/stripe/webhook`, routed by hand in `worker/index.ts` as before.
- ✅ **The account id comes from a verified JWT, never from the request body.** The
  brief's "accepts `user.id`" would have let anyone POST a stranger's id and entitle
  their account. `verifyUser()` asks Supabase to validate the bearer token and takes
  the id *and* the email from it, which is also how `customer_email` gets pre-filled
  without the app sending anything.
- ✅ **The price id is validated too** — retrieved server-side and required to be
  active, one-time and (with `STRIPE_PRODUCT_ID` set) this product's. Otherwise any
  archived discount price in the account was sellable by anyone who could name it.
  Auth is checked *first*, so an unauthenticated caller can't probe price ids.
- ✅ **Dynamic EUR/SEK pricing** (`src/pricing.ts`). Locale → currency (`sv`, `sv-*`
  or any `-SE` region → kronor). The paywall is built synchronously, so it paints from
  a three-layer fallback (fetched → localStorage → built-in) and takes an
  `onPriceChange` subscription to correct itself when the fetch lands. Only the first
  two layers carry a price id, which is exactly what makes a fallback unsellable.
- ✅ **Redirect, not overlay.** lemon.js used to dodge the installed-PWA return
  journey; Stripe's hosted Checkout has no overlay to borrow, so the journey is
  handled by the machinery that already existed — `?purchased=1`, the focus watcher,
  the backoff poll, and Settings' "Already paid?". Two things got better: no
  third-party script in the app at all, and wallets with no domain verification.
- ✅ **Two events the brief didn't ask for, and one it did that can't happen.**
  `checkout.session.async_payment_succeeded` (without it, a delayed payment method
  means a customer pays and is never entitled) and `charge.refunded` → back to the
  free tier, which is what `docs/terms.html` already promised and nothing enforced.
  `customer.subscription.*` are answered with an explicit log line rather than
  silently ignored. Full refunds only.
- ✅ **Merchant of record moved to you.** EU VAT via OSS is now yours; prices are
  VAT-inclusive and Stripe Tax is deliberately off (0.5% a transaction — flagged, not
  assumed). `docs/terms.html` and `docs/privacy.html` rewritten to name you as the
  seller and Stripe as the processor.
- ✅ **The Worker is typechecked by the build now** (`tsconfig.worker.json`). It never
  was — `tsc` covered `src` only, and wrangler found worker errors at deploy time.
- ✅ Verified locally end to end with `wrangler dev`: `constructEventAsync` on workerd
  accepts a correctly-signed event and rejects tampering, the wrong secret, a missing
  header and a replayed timestamp; every event route and every guard returns what it
  should.

_Owner setup: `STRIPE-SETUP.md` (dashboard steps, secrets, decommissioning). Schema:
re-run the SQL in `SUPABASE-SYNC.md`. Restore point: `v0.4`._

---

## The account round — sync that actually syncs ✅

A pass over everything the account touches, prompted by three symptoms that
turned out to be one story: signing in on a second device showed the first
device's old lines, the Account section said "Sync failed — will retry" on every
launch, and nothing anyone did made either better.

**The sync only ever pulled once.** On the very first sign-in with an account,
and never again — after that a device pushed and only pushed. So the second
phone kept its own older copy, showed it, and then pushed it back over the
first's. Both columns now carry a timestamp, each device remembers the last one
it saw of each half, and it asks (two timestamps, a few hundred bytes) on
sign-in, on coming back to the foreground and every five minutes. Only a half
that really moved is downloaded. There is a **Sync now** button for impatience.

- ✅ **A pull always merges, so the merge-or-replace prompt is gone.** It asked
  at the worst possible moment — you have just typed a password and not yet seen
  the app — "merge" was right every time, and cancelling left the device
  silently unsynced for ever. Lines merge by move, games by id, statistics by
  last-write-wins with a guard that can't overwrite unpushed work. What the
  prompt uniquely did is now Settings → Data → **"Replace this device from your
  account"**, asked for on purpose.
- ✅ **The deadlock.** Every `onAuthChange` listener ran inside supabase-js's own
  auth broadcast, which holds an internal lock; the first thing they did was call
  Supabase, which waits on that lock. Auth work now hops to the next task first.
- ✅ **Statistics were only pushed when a line changed.** The core column is the
  lines *plus* the app-state snapshot, but only the lines had a change notifier —
  so a puzzle rating or a streak sat on the phone until some unrelated edit
  carried it up. The core is now offered at every push opportunity and the
  fingerprint decides, which costs no request when nothing changed.
- ✅ **Failures say what went wrong.** "Sync failed — will retry" covered a
  missing table, a missing column, a blocked write and a train tunnel alike.
  Now it names which.

**Email confirmation is back on, and the links now work.** Turning it off was a
mistake — a typo'd address means an account nobody can reach, including the
person who just paid for it. But the return leg had a bug that would have made it
useless: the app only claimed a `?code=` if a localStorage flag it set moments
before the redirect was still standing, and no such flag survives a trip through
a mail app. The flag is gone; `state` (which Lichess always sends and Supabase
never does) is a complete test on its own.

- ✅ **Password reset**, both halves: "Forgot your password?" on the sign-in tab,
  and a "choose a new password" sheet when the link is opened.
- ✅ **Resend the confirmation email**, because the commonest failure of email
  confirmation is an email that never arrives.
- ✅ **Facebook and Apple** join Google, behind `VITE_AUTH_PROVIDERS` so a button
  can never appear for a provider the dashboard hasn't enabled. Lichess and
  Chess.com were investigated and are **not possible** as sign-in providers —
  Supabase takes only its own fixed list, Lichess is OAuth2 without an
  `id_token`, and Chess.com has no public OAuth at all. `SUPABASE-SYNC.md` §3
  has the reasoning and the workaround (offer the existing Lichess connection
  right after sign-in instead).
- ✅ **Registration / Sign in**, not "sign up / sign in" — one letter in the
  middle of a word is a coin-toss to read on a phone. Registration now requires
  ticking a consent for the privacy policy and terms; the social buttons carry
  the passive line, because an OAuth tap is indistinguishable from a
  registration until it comes back.

**Everything else the round touched:**

- ✅ **Export takes a dropdown** — everything, lines, games, statistics or
  settings — and the file records which parts it holds, so "Replace" on a
  lines-only import replaces the lines and leaves the games alone.
- ✅ **Delete your account**, under Data: a Worker endpoint with the service-role
  key (the browser has no key that may touch `auth.users`, and shouldn't),
  type-DELETE to confirm, a backup offered first, and a separate tick-box for
  whether to wipe this phone too — because closing an online account is not the
  same as asking to lose the repertoire in your hand.
- ✅ **Reset progress pushes immediately** rather than waiting out the 30-second
  debounce, and says out loud that it reaches your other devices.
- ✅ **Google Drive backup retired for good** — the code went earlier; this round
  took the documentation, the privacy-policy entries, the dead CSS and the
  leftover device keys, which are now swept at boot.
- ✅ **A size guard in the database.** The 4 MB-per-column ceiling was enforced
  only in JavaScript the user is holding. It is now a Postgres trigger as well.
  Measured on the way: ~2.1–2.7 KB per line, ~1.4 KB per synced game, so the
  ceiling lands at roughly 1,600 lines and the games column can't reach its own
  at all. Full table in `SUPABASE-SYNC.md` §7.
- ✅ **`SUPABASE-SYNC.md` is now the whole account checklist**, not just the SQL:
  auth settings, the redirect allow-list, the email-template edit that makes
  links work in any browser, custom SMTP (the built-in sender is capped at a
  couple of emails an hour, which would have silently blocked registrations),
  every provider's setup, account deletion, quotas, and a checklist at the end.

---

## The daily-challenge, tree and Explore round ✅

Nine items off one brief. Two of them were questions before they were jobs —
what makes the repertoire tree hard to use on a phone, and whether Coverage,
Recommended and "From my games" are really three things — so they were measured
and written up first (the **Tree and Explore** report), then built.

**The daily challenge now exists before you can do it.** Under the three-line
goal it does not run — two of its five parts need a repertoire — and it used to
vanish entirely, which meant the one habit the whole app is built around was
invisible until after you had done the work that turns it on. It introduces
itself instead: the same card, the same rows, greyed and inert, under a bar
counting toward three lines. The Get-started checklist leads and the locked card
follows it, because "how do I get lines" is the question that has to be answered
first.

**The completion popup can be reopened.** It carried the only reading of "how
did that go" the app produces, and a tap anywhere lost it until tomorrow. Three
ways back to it now, all through `daily-review.ts` so they cannot drift apart:
the finished Train card, a day in the 7-day strip, and a day in the month
calendar. Both calendars are banded by how the day WENT rather than whether it
happened — four steps and a legend, coarse on purpose, because a per-percent
gradient on a 20px square is a colour nobody can read back into a number.

- ✅ A reopened day is recomputed **as of that day**: the streak counted back out
  of the training-days set, every all-time tally read off the log truncated
  there. It dates itself rather than borrowing the word "today", and skips the
  confetti — a replay is a look back, not an event.
- ✅ The copy: "Every task cleared" is gone for "9 correct moves of 10 played
  moves", and the word throughout is **challenge**, not task ("Next challenge →").
- ✅ `TRAINING_UNLOCK_LINES` moved to its own leaf module. `first-steps.ts`
  reaches auth, Supabase and the install gate, so importing the constant from
  `daily-challenge.ts` dragged the whole browser world into the headless
  self-test run.

**The trainer opens again after a new line.** Standing inside a book the header
button ADDS moves rather than saving a line, which is right — but it meant the
whole tail of the old save flow never ran. The confirm run stopped appearing,
and "Just save it" stopped being honoured, because a freshly grown branch
inherits `training` from its ancestors whatever the toggle said. Both are picked
back up at the end of `commitBook`, on the one condition that means "I have just
finished a line": the line in front of you contains part of the draft, and the
cursor is standing on its end.

**The filter bar stopped overlapping itself.** Row 1 is a nowrap flex row, and
the colour segment carried `min-width: 0` with nowrap children and no overflow
of its own — so on a narrow phone, or once the count badges reached three
digits, it shrank below its contents and the Black chip ran out across the
search, sort and view icons. Measured at 360px: 34px of overlap. The segment
scrolls itself now, its chips refuse to shrink, and the tools group is
fixed-size. Below 460px the chips also drop their WORDS and keep their pips,
which is what makes room for a fourth icon without anything scrolling at all.

**The tree got its own button and a phone-sized first paint.** It was the fourth
stop on the grouping toggle's cycle — three taps deep behind an icon whose other
states are all lists, with nothing on screen to say it existed. It is a switch
now, and turning it off restores the grouping that was showing before.

- ✅ It draws four moves deep with the existing "Go deeper" control, and the
  first paint shrinks to fit what it drew (floor 0.55, below which the move text
  stops being readable). Same ten-line book, same 378×512 box: **19 of 69 nodes
  on screen → 48 of 58**.
- ✅ The legend's "another move order to the same position" line is gone. It
  explained a line most people never see, in a sentence that reads as jargon on a
  phone, and cost a whole row above a view already short of height. The dashed
  edges still draw and the tap-preview still explains them where it matters.

**Repertoires moved to Settings.** The book picker sat at the top of My Lines,
asking a question most people never have a second answer to — and its answer HID
lines, which on a screen called My Lines reads as data loss. Making, naming,
putting aside and removing books is a setup decision, so it is a setting.
"Which book new lines are filed into" is offered only once there are more than
the two defaults. My Lines shows every saved line, always.

**My Lines ends by offering another line.** "And now what?" gets asked at the
bottom of the list, and the answer used to be to scroll back to the top and find
the + button.

**The Learn tab and every trace of YouTube are gone** — `youtube.ts`,
`video-lib.ts`, `content-ui.ts`, `content-explore.ts`, `content-curated.json`,
the API key that shipped with them, the Explore tab, the icon and ~230 lines of
CSS. Explore is three tabs now: Recommended, Packs, Scouting.

**Two questions were answered first and then built** — the reasoning, the
measurements and the ranking are in the **Tree and Explore** report.

**My Lines is what you own; Explore is what you don't.** One rule, and it
resolved all three of Coverage, Recommended and "From my games" — which were
never three things. `recommendationCard` and `suggestionCard` were the same
component twice, built from the same `analyseGames()` pass and differing only in
a `filter()`, and they overlapped on exactly the interesting case (played a lot,
scoring badly, no line yet), which therefore appeared on two screens with the
same button.

- ✅ **Coverage is an Explore tab**, and leads it once there are lines to have
  gaps in. `coverage-section.ts` already rendered standalone with exactly the
  options a tab body needs, so the full-screen `coverage-screen.ts` and the
  one-row launcher that opened it are both gone.
- ✅ **Recommended and "From my games" are one Openings tab.**
  `analysis.rankOpenings` labels every opening your games show with what it
  NEEDS — *no line yet* / *line is losing* / *prepared* — and orders by
  `games × (100 − score)`. The middle state is the one Recommended got wrong: it
  never checked `hasRepertoire`, so it offered "Build line" for openings already
  prepared. That row now opens the line you have.
- ✅ **My Lines lost its tab bar.** With "From my games" gone there was one tab
  left, and a one-tab tab bar is a title with extra steps.
- ✅ **A coverage row opens the POSITION, not the builder.** Jumping into the
  editor from a one-line list item meant agreeing to prepare something you could
  not yet see. It is `openPositionPeek` — the same popup Statistics' forgotten
  moves and the training results screen use — with the unanswered move drawn as
  an arrow, the figures that ranked it, and two ways on: prepare an answer, or
  see it in the tree. Openings rows do the same.

**The tree stops making a 512px box do a full screen's work.** All six remaining
fixes, on top of the four above:

- ✅ **The preview is a bottom sheet.** It was a full-height panel pinned to the
  TOP of the tree area — 190px of a 512px box, dropped over the part of the tree
  you had just been reading and often over the node you tapped, half of it a
  chessboard nobody had asked for. Collapsed it is a 44px strip at the bottom:
  **37% of the map → 11%**. Pull it up for the board.
- ✅ **Seven controls become three on a phone.** The variation arrows duplicate
  tapping a sibling in plain sight; the ± pair duplicates pinch and floated ON
  the tree. Both stay above the desktop breakpoint. That retires the 5rem of
  padding the bar carried to dodge the FAB.
- ✅ **Full screen.** The embedded map is a `touch-action: none` surface in a
  scrolling page, so at 62vh a vertical swipe panned the tree instead of the
  page with no way past it. The card is a 50vh preview now, and "Full screen"
  reopens the same map as the overlay, standing where you were.
- ✅ **The fit floor is derived from legibility rather than picked.** Shrinking
  to fit is a CSS transform, so it shrank the text: at the old 0.55 floor a 12px
  label rendered at 6.6px. The floor is now the scale at which the label is
  still readable, and anything wider is what panning is for.
- ✅ **Folding.** Every fork carries one, showing the number of LINE ENDS put
  away. The state keys on the uci path rather than the node, so it survives "Go
  deeper", All/Frequent and a colour switch — each of which rebuilds the tree.
- ✅ **Landscape** gets a fixed 300px card instead of 50vh of a 412px viewport,
  and `SIBLING_GAP` goes 12 → 16 so stacked 44px tap targets stop overlapping.

---

## The sign-in round — two taps, or a link in the post ✅

Signing in asked for an email and a password before it offered anything else,
which is the slowest way in and the one most likely to end at "what was my
password again". The sign-in tab is now built the other way round: the accounts
people already have come first, and typing is the fallback.

- ✅ **Facebook joins Google as a lead button**, both at the same weight. The
  choice between them is "whichever you already use", so neither may look
  recommended. This was almost entirely markup: `signInWithProvider()` already
  handled every provider generically (Facebook included, `email` scope and all),
  so `signInWithFacebook()` is one line calling it. It still needs the provider
  enabled in the dashboard and `facebook` added to `VITE_AUTH_PROVIDERS` —
  `SUPABASE-SYNC.md` §3 has the steps.
- ✅ **A magic link is the default email path.** "Send me a sign-in link" needs
  nothing remembered and works from any device, because the link comes back as
  `token_hash` — the same return leg confirmation and password reset already
  use, with no new plumbing (`initAuth` hands whatever `type` is on the URL
  straight to `verifyOtp`; `magiclink` was already in its accepted list).
- ✅ **The link cannot create an account.** `shouldCreateUser: false`, on
  purpose: sign-up means agreeing to the Terms, and there is one door for that.
  An unknown address gets a dialog offering the Registration tab rather than
  Supabase's own "signups not allowed for otp".
- ✅ **Password is one small link away** — "Use a password instead" reveals the
  field, and "Email me a link instead" goes back. One form, so the address you
  typed survives the switch, and one primary button at a time.
- ✅ **Registration is untouched.** Same email + password, same consent
  checkbox, same confirmation email. Only the sign-in surface changed.

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

- 💤 **Deletion tombstones.** Two-device sync now works (the account round), but
  a *deletion* still doesn't travel: lines and games merge, so removing a line on
  one phone leaves it on the other. Needs per-line `updatedAt` plus a remembered
  list of deleted ids — design note in `PUBLISHING.md`. Until then the escape
  hatch is Settings → Data → "Replace this device from your account".
- 💤 Monetization build-out (options and recommended path now in `PUBLISHING.md`)
- 💤 Offline support (service worker / installable cache)
- 💤 Deeper engine features and richer explanations
- 💤 More opening-database coverage and naming
