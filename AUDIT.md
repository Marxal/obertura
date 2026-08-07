# Bito Chess — code audit (v1.2, task 1.1)

Read-only pass over the whole `src/` tree, `index.html`, `style.css`, the Vite
config and the three build scripts. No app code was changed in this session;
this file is the only artefact.

Severity key: **critical** (fix this round), **worth-it** (do it when nearby),
**cosmetic** (nice to have). The Today/home screen is slated for retirement
later in v1.2, so its couplings are noted but not counted as findings to fix.

---

## Fixed in task 1.2 (this round)

Both criticals plus the cheap, zero-risk worth-it items, with new self-tests so
they stay fixed. Each finding below is tagged **✅ FIXED** inline.

- **4.1** ✅ — every data screen (Lines / Train / Stats) now wraps its IndexedDB
  load in try/catch and shows a shared error + Retry panel (`load-error.ts`)
  instead of hanging on "Loading…". (Home left alone — it retires later.)
- **6.1** ✅ — game analysis (`analyseGames` / `countGamesPerLine`) is memoised
  per games+lines snapshot in `lines-screen.ts`; sort toggles and re-renders now
  reuse the cached result instead of re-walking every game.
- **6.3** ✅ — the Repertoire Map's window `mousemove`/`mouseup` listeners are
  detached on `close()` (via a disposer from `initPanZoom`), ending the leak.
- **1.4** ✅ (partial) — `openDB()` now handles `onblocked` and rejects with a
  clear message (surfaced by the 4.1 panels). Quota-on-write surfacing deferred.
- **4.2** ✅ — a single failed month no longer aborts the whole Chess.com import;
  the bad archive is skipped and the import carries on.

New self-tests added: **openings lookup** (`openings.selftest.ts`) and a
**storage round-trip** (`storage.selftest.ts`), both surfaced in Settings →
Diagnostics alongside the **import parser** test (`chesscom.selftest.ts`, which
was previously defined but never wired into a screen). A shared
`selftest-panel.ts` renders them (sync or async). The scheduler self-test was
also made date-independent (it had started failing as the wall clock moved past
its authoring date). All self-tests and the production build pass.

Deliberately skipped this round (not quick-and-zero-risk, or cosmetic): **1.1**
(Manual naming — threads through the builder's live title state machine),
**1.2 / 1.3** (mid-line variations, stale-eval race — real changes, not
zero-risk), **6.2** (Progress caching — not on a hot path), and all items tagged
*cosmetic*.

---

## 1) Bugs / likely bugs

### 1.1 "Manual" naming mode is a no-op — `worth-it`
`prefs.ts` exposes `getNamingMode()`/`setNamingMode()` and `settings-screen.ts`
(~288) renders the Auto/Manual toggle, but `main.ts › saveCurrentLine()`
(~930–960) **never reads** `getNamingMode()`. It always computes
`detectedNameForLine()` and falls back to it. The pref's own comment admits it's
"wired into Settings in task 7.2". Net effect: choosing **Manual** changes
nothing — new lines still auto-name from the bundled DB.
*Fix:* in `saveCurrentLine`, when mode is `manual` don't fall back to the
detected name (leave it "Untitled line" / prompt), or remove the setting until
it's implemented.

### 1.2 Mid-line variations silently vanish from the builder and training — `worth-it`
The data model says a Line is a *tree* of moves, but the builder only ever
surfaces the **mainline** (`children[0]` chain). `tree.ts › addMove()` (~32)
appends an alternative as a non-first child when you play a different move from a
mid-line cursor; `mainline()` (~58) and `renderMoveList()` (`main.ts` ~332) only
walk `children[0]`, and training (`scheduler.ts › mainlineNodes`) does the same.
So a variation you build is stored by `serialise()` but never shown in the move
list and never drilled — looks like lost work. Only the Repertoire Map reveals
it.
*Fix:* either block/redirect off-mainline moves in the builder with a visible
notice, or render variations in the move list. At minimum, document the
limitation.

### 1.3 Stale-eval race in `Engine.evaluate` — `worth-it`
`engine.ts` (~368–387): `evaluate()` `await`s `tryLichess()`. If the user
navigates during the await, a newer `evaluate()` runs `cancel()` (aborting the
fetch). The **older** call resumes after its aborted fetch returns `null` and can
still call `runSF(fen)` on the now-superseded FEN. `emit()` then builds SANs with
`this.currentFen` (the *new* fen) from the *old* search → mismatched move SANs,
and `eval-panel.update`'s `result.fen !== fen` guard passes because `currentFen`
already equals the live fen. Rare (Lichess usually answers first) but real.
*Fix:* tag each `evaluate()` with a request id and bail in the continuation if a
newer request has started (same pattern already used for `gradeRequestId` in
`main.ts`).

### 1.4 No `onblocked` / quota handling on the IndexedDB open — `worth-it` ✅ FIXED (onblocked; quota deferred)
`storage.ts › openDB()` (~29) handles `onsuccess`/`onerror` but not `onblocked`
(another tab holding the old version during a `DB_VERSION` bump will hang the
open forever) and there's no surfacing of quota-exceeded on writes. See also 4.1.

### 1.5 Promotion is hard-coded to queen everywhere — `cosmetic`
`main.ts` board `move` handler (~1047) and `playUci()` (~520), `drill.ts`
(~95, 599, 698, 762), `explore.ts` (~131) all pass `promotion: 'q'`.
Under-promotion is impossible in the builder/drills. Fine for an openings
trainer; flagged for completeness.

### 1.6 `nextDue()` returns "New" for a partly-trained line — `cosmetic`
`scheduler.ts › nextDue()` (~121) returns `null` (→ `describeDue` "New") as soon
as **any** user-move lacks a review, even when the rest are scheduled weeks out.
Minor label quirk on the Train card.

---

## 2) Dead code / unused exports

### 2.1 `uciPathTo()` is never called — `cosmetic`
`tree.ts` (~98) exports it; no callers. Safe to delete.

### 2.2 `TrainingSession.upcomingIds()` and `.isEmpty()` unused — `cosmetic`
`session.ts` (~46, 51). Only `remaining` is used (and only in the self-test).
Drop the unused two.

### 2.3 Unused icons — `cosmetic`
`icons.ts`: `build`, `search`, `save`, `flip`, `settings` are defined but never
referenced (header uses inline SVG). Trim to shrink the bundle slightly.

### 2.4 `startTimedDrill` is a copy of `startPositionsDrill` — `worth-it`
`drill.ts` (~146 vs ~167): identical bodies (same `tasks` mapping, same
`runDrill` call); the only difference is the `opts` type carrying `timedMs`.
Collapse into one entry point. (Also listed under duplication.)

### 2.5 Home/Today couplings (retiring later — not a fix now)
For when it's pulled: `home-screen.ts` (whole file), `main.ts` `renderHomeScreen`
import + `showView('home')` branch (~814), `'home'` in `ViewName`/`currentView`,
the `setViewBack` "return to home" fallback (~914), `pendingTrainAutoStart`
(~659, ~816) and `sessionForDefaultMode`/`autoStart` path in `train-screen.ts`
(~96, ~112). `getDefaultTrainingMode` exists mainly to serve the Today screen.

---

## 3) Duplication worth merging

### 3.1 Mainline-walk helper copied 4–5× — `worth-it`
Identical `let node = tree.children[0]; while(node){…; node = node.children[0]}`
in `tree.ts › mainline()`, `scheduler.ts › mainlineNodes()`, `drill.ts ›
mainlineOf()`, `train-screen.ts › mainlineOf()` (~426), `pretraining.ts ›
mainlineOf()` (~7), and inlined in `lines-screen.ts › finalMainlineFen()` (~49).
Export one shared `mainlineOf(tree)`.

### 3.2 `START_FEN` constant duplicated — `worth-it`
Re-declared in `tree.ts`, `drill.ts`, `train-screen.ts`, `lines-screen.ts`,
`repertoire-map.ts` (and the self-test). Export it once.

### 3.3 `legalDests()` copied verbatim — `worth-it`
Same `Map<Key,Key[]>` builder in `main.ts` (~30), `drill.ts` (~304),
`explore.ts` (~98). One helper taking a `Chess` instance.

### 3.4 "side to move from FEN" logic scattered — `worth-it`
`turnColor`/`cgTurn`/`colourToMove`/`movedBy`/`sideToMove` across `main.ts`,
`drill.ts`, `explore.ts`, `engine.ts`, `repertoire-map.ts`, `analysis`/`chesscom`.
Centralise `sideToMove(fen)` / `colourToMove(fen)`.

### 3.5 Merged-tree builders duplicated — `worth-it`
`analysis.ts` (`buildMergedTree`/`graft`, `MergeNode`), `repertoire-map.ts`
(`buildMergedTree`/`mergeInto`, `MapNode`) and `progress.ts › matchDepth` all
re-implement "fold lines into a UCI-keyed tree / replay a game through it". The
view-specific node shapes differ, but the core merge + match-depth could be one
utility.

### 3.6 `scorePct` formula + score-bar colours repeated — `worth-it`
`(wins + draws/2)/games*100` in `analysis.ts` (~102), `progress.ts` (~128),
`progress-screen.ts` (~461). The `≥55 green / ≥45 amber / else red` bar colour is
duplicated in `lines-screen.ts › scoreBar` (~786) and `progress-screen.ts`
(~477, ~606). Extract `scorePct()` and a `scoreColour()` helper.

### 3.7 Three near-identical `appendSelfTestLink()` — `worth-it`
`train-screen.ts` (~988), `lines-screen.ts` (~859), `progress-screen.ts` (~710)
are ~40 lines of the same pass/fail renderer. Parameterise one helper with the
runner function + console tag.

### 3.8 Completion stat-box scaffolding repeated 3× — `cosmetic`
`train-screen.ts`: `renderIndividualComplete`, `renderSessionComplete`,
`renderTimedComplete` each hand-build the same `summary-stat-box` "correct vs
missed" pair. A small `statBox(value, label, variant)` builder removes ~60 lines.

### 3.9 Two PV→white-cp normalisers in engine.ts — `cosmetic`
`engine.ts` has `pvToWhiteCp()` (~207) and an inline `pvCp()` inside
`isGoodAlternative()` (~48) doing the same job. Reuse the named one.

### 3.10 view-only mini-board config repeated — `cosmetic`
`lines-screen.ts › mountMiniBoard` (~322), `repertoire-map.ts › makePreview`
(~232) and the rename sheet (~971) repeat the same Chessground viewOnly options.

---

## 4) Missing error handling — network & IndexedDB

### 4.1 Data screens get stuck on "Loading…" if IndexedDB fails — `critical` ✅ FIXED
Every screen's `doRender` does `container.innerHTML = '…Loading…'; const x = await
getAllLines()` with **no try/catch**: `home-screen.ts` (~28), `lines-screen.ts`
(~136), `train-screen.ts` (~66), `progress-screen.ts` (~36). If `openDB()` rejects
(private-mode, quota, blocked upgrade), the await throws, the spinner never
clears, and it surfaces as an unhandled rejection. Wrap each in try/catch with a
visible error + retry.

### 4.2 One failed month aborts the whole import — `worth-it` ✅ FIXED
`chesscom.ts › importRecentGames()` (~249): a single archive fetch that throws
(transient 5xx) rejects the entire import. Already-saved months persist
(incremental `onGames`), but the user just sees "failed". Catch per-archive,
count it as skipped, and continue.
The fetch layer itself (`fetchJson`, ~188) is good — it handles 404/429/!ok with
human messages.

### 4.3 No caching of Lichess cloud-eval calls — `worth-it`
`engine.ts`: `cloudEval`, `tryLichess`, `isGoodAlternative`, `gradeMove` each
issue their own `fetch` (timeout-guarded, good) but nothing is memoised by FEN.
Navigating back and forth, or `gradeMove` calling `cloudEval` twice for one move,
re-hits the network. A tiny FEN→result LRU would cut requests and latency on a
phone connection.

### 4.4 Backup/restore & reset error paths are covered — *(no action)*
`backup.ts`, `settings-screen.ts` and `storage.ts`'s `parseBackup`/`validateLine`
handle malformed files and wrap writes in try/catch with friendly messages — good
reference for the rest of the app.

---

## 5) TypeScript weaknesses

### 5.1 `as never` cast to satisfy chess.js — `worth-it`
`explain.ts › findThreat` (~69): `attackers(...).includes(move.to as never)`.
The `as never` hides a real type mismatch with the chess.js `Square` type; if the
API shifts this silently breaks. Type `move.to` as `Square` instead.

### 5.2 `chess.move(san) as unknown as MoveLike` — `worth-it`
`explain.ts › explainMove` (~116). Double-cast through `unknown` to a hand-rolled
`MoveLike`. Prefer chess.js's own `Move` type (it already carries
`flags/piece/captured/from/to/san`).

### 5.3 Repeated promotion casts — `cosmetic`
`(uci[4] as 'q' | 'r' | 'b' | 'n')` appears in ~6 places (`main.ts`, `drill.ts`,
`explore.ts`, `engine.ts`). Wrap UCI→move parsing in one typed helper.

### 5.4 Inline response shapes + casts in engine.ts — `cosmetic`
`tryLichess` (~396) and `isGoodAlternative` (~39) redeclare the `{ pvs?: … }`
shape inline and `as`-cast `res.json()`, while the named `CloudEval` interface
(~216) already exists. Reuse it; consider a runtime guard since the body is
untrusted network data.

### 5.5 `(err as Error).message` assumes Error — `cosmetic`
Several catch blocks (`lines-screen.ts` ~762, `settings-screen.ts` ~363, ~413,
`backup.ts` ~84/101/119). A thrown non-Error becomes `undefined`. A small
`messageOf(err)` helper is safer.

(No blanket `any` types were found — the weaknesses here are casts, not `any`.)

---

## 6) Performance smells (phone)

### 6.1 Game analysis recomputed on every render and every sort toggle — `critical` ✅ FIXED
`lines-screen.ts`: `doRender` calls `countGamesPerLine` (~141); `renderSavedTab`
calls it **again** (~423); `renderGamesTab` runs the full `analyseGames` (~676)
and re-runs it on **every** sort-dropdown change (the `rerender` closure, ~678).
`analyseGames` walks every game through the merged tree — with a year of imported
games (thousands) this is a visible hitch each time you switch the sort or
re-enter the tab. Compute once per games/lines snapshot and cache; re-sort the
cached `stats` array rather than re-analysing.

### 6.2 `crossReference` re-run on every Progress open — `worth-it`
`progress.ts › crossReference` (~166) is O(games × lines × plies) and runs on
each `renderProgressScreen`. Same data-snapshot caching applies.

### 6.3 Repertoire Map leaks window listeners — `worth-it` ✅ FIXED
`repertoire-map.ts › initPanZoom` (~347, ~353) attaches `mousemove`/`mouseup`
to `window` but the `close()` path (~475) only removes the overlay and the
back-stack entry — it never detaches these. Every open of the map adds another
pair that fires for the rest of the session. Return a disposer from
`initPanZoom` and call it in `close()`.

### 6.4 No cloud-eval cache — *(see 4.3)* — `worth-it`
Eval fires on every builder navigation; repeated FENs refetch.

### 6.5 Minor — `cosmetic`
`renderMoveList` (`main.ts` ~332) rebuilds the whole list via `innerHTML=''` +
re-append on every move/step; fine for short opening lines. `structuredClone` of
each line's tree per session item is cheap at opening depth.

---

## 7) Accessibility / contrast notes

### 7.1 `user-scalable=no` blocks pinch-zoom — `worth-it`
`index.html` (~5): `maximum`/`user-scalable=no` prevents users from zooming the
page text. Common in PWAs but an accessibility regression; consider allowing
zoom (drop `user-scalable=no`).

### 7.2 Sparse keyboard focus styling — `cosmetic`
Only `.eval-move:focus-visible` has an explicit ring (`style.css` ~3339). Inputs
replace `outline:none` with a border-colour change (acceptable: `.settings-input`
~1114, `.edit-input` ~1869, `.note-panel-textarea` ~3090). JS-built buttons rely
on the UA default ring (not globally removed, so OK), but a consistent
`:focus-visible` token would help keyboard users.

### 7.3 Colour-carrying indicators have text backup — *(mostly OK)* — `cosmetic`
Score bars and confidence use colour **plus** a text readout (good). The drill
progress dots (`drill.ts › markDot`, ~353) are colour-only (red/green) — the
live status line and final score provide partial redundancy, but the dots alone
don't encode state for colour-blind users.

### 7.4 Tiny labels — `cosmetic`
~24 `font-size: 0.x` rules in `style.css`; the smallest sub-labels/chips may fall
below ~12px on a phone. Spot-check the smallest against the device.

### 7.5 Reduced-motion only partly respected — `cosmetic`
Confetti checks `prefers-reduced-motion` (`drill.ts` ~388, good), but the
Repertoire Map pan/zoom transitions (`applyTx`, ~298) and smooth scroll-into-view
do not.

---

## Recommended fix batch (criticals, in order) — ✅ all done (task 1.2)

1. ✅ **Guard data screens against IndexedDB failure** (4.1) — `lines/train/progress`
   `doRender`s now wrap the load in try/catch with a shared error + Retry panel
   (`load-error.ts`). (Home skipped — it retires later in v1.2.)
2. ✅ **Cache game analysis** (6.1) — `analyseGames`/`countGamesPerLine` are
   memoised per lines+games snapshot in `lines-screen.ts`; sort toggles re-use
   the cached result instead of re-analysing.
3. ✅ **Stop the Repertoire Map listener leak** (6.3) — the window
   `mousemove`/`mouseup` handlers are detached in the map's `close()`.
