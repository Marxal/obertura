# Transpositions & duplicates

**Read this before touching anything that saves a line, drills a line, or shows
statistics.** The position index (`src/position-index.ts`) knows which lines pass
through which positions. That one fact changes the behaviour of several screens,
and those behaviours have already been decided. This file is the decision record;
the code implements the parts marked *built*, and later sessions implement the
rest without re-litigating them.

**Shipped so far:** the index itself (`src/position-index.ts`); the builder's
save flow — §4, §5, §6 and §7, wired through `src/save-index.ts` and the save
path in `main.ts`; training's half — §8 and §9, wired through
`src/train-index.ts`, `src/drill.ts` and `src/train-screen.ts`; and §10 as it
applies to statistics, wired through `groupUserMoves` in `src/stats.ts` (feeding
`moveMemory`, `needsWorkMoves` and `memoryByOpening`) and read unchanged by
`src/line-info.ts` and `src/forgotten-section.ts`. The tree view in My Lines —
§11 — is the one consumer that does NOT read the index: it re-derives the same
position key over the saved trees, for the reason given there. Coverage gaps
(`src/coverage-gaps.ts`) is the second: it needs the OPPONENT-to-move positions
with the replies already prepared at each, which is a shape the index doesn't
hold, and it must stay pure (no storage) to be self-tested. It uses the same
`positionKey`, so two lines that transpose still meet on one position and a
reply answered in either counts as answered.

---

## 1. The position key

One convention, shared with `src/openings.ts`, which already keys
`openings-data.json` this way: **the first four FEN fields** — board, side to
move, castling rights, en passant. `position-index.ts` re-exports
`openings.epdKey` rather than copying it, so the two can never drift apart.

The halfmove clock and fullmove number are excluded. They describe the *journey*
to a position, not the position, and including them would stop every genuine
transposition matching.

**En passant is the subtle one, and it is already correct.** chess.js (verified
against 1.4.0, the version installed here) writes the en-passant square **only
when an en-passant capture is genuinely legal**:

| after | field 4 |
| --- | --- |
| `1.e4` — no black pawn beside the arriving pawn | `-` |
| `1.e4 a6 2.e5 d5` — `exd6` is on | `d6` |
| `…d5` where the capturing pawn is pinned along the rank | `-` |

It even strips a bogus square out of a FEN handed to it. So the raw field is
already the "is this really available?" answer and needs no normalisation. Do not
add any. If chess.js is ever upgraded, re-run the `position-index` self-test —
two of its checks assert this behaviour directly, and will fail loudly if a
future version starts writing the square unconditionally.

## 2. What an entry means

An entry is filed under **the position the move is played from**, so
`entriesAt(fen)` literally answers "what does each of my lines play here". The
entry's `node` is the node the move *arrives* at — that is where the review
record lives, and entries hold a live reference to it, which is what makes the
write-through in §7 possible.

`isUserMove` marks the moves the user plays, by the same parity rule as
`scheduler.userMoveNodes` (white's moves are the even plies, black's the odd).
**Anything training-related must filter on it.** An opponent move carries no
review record, so it can neither be drilled nor credited.

## 3. Line identity

Two lines are the same line when they have **the same moves and the same
colour**. Name and tags are *not* part of identity — that is precisely what makes
§5 possible. The same moves saved once as White and once as Black are two
different lines and must never match.

`duplicatesOf(line)` returns one of four relations plus the other line's id:

| relation | meaning |
| --- | --- |
| `identical` | same colour, same moves, start to finish |
| `extension-longer` | this line continues past the other one |
| `extension-shorter` | the other line continues past this one |
| `divergent` | shared opening moves, then they part |

It works on an unsaved line, which is what the save button needs.

## 4. An exact duplicate transforms the save button — BUILT

Saving a line whose moves and colour already exist must **not** create a second
copy. The save button changes into an update of the existing line: it opens that
line, keeps its training record, and says so. The user should never end up with
two identical lines and no idea which one they have been drilling.

It **transforms**, it never greys out — a dead primary button is a dead end where
the main action used to be. Label: "Already saved — open it".

Two limits worth knowing before you touch it:

- **Only on an exact whole-line match.** A line that is merely a PREFIX of a
  stored one leaves the button completely alone. Mid-build is indistinguishable
  from a prefix — every line you type is a prefix of something before it is
  finished — and a primary button that changes its label on every move is
  unusable. The prefix case is handled by §6 instead, after a save.
- **Only when the builder isn't editing a saved line.** Editing line A into a
  copy of line B and having the button offer to abandon your edits and open B
  would hijack the control. The second-copy risk this rule exists to stop only
  arises on a fresh build.

The check hangs off `refreshSaveButtonState()` in `main.ts` — the one function
both triggers already reach, every move (via `renderMoveList`) and every tag
change (via `renderBuilderTags`). It is fingerprinted on moves + colour + tags,
so it re-runs only when one of those actually changes, and a slow answer that
arrives after another move is discarded rather than applied to the wrong line.

## 5. A differing tag becomes "add tag to existing line" — BUILT

If the only difference is metadata — the moves and colour match, but the new save
carries a tag (or a name) the stored line lacks — the offer is **"add this tag to
your existing line"**, not a new save. This is the direct consequence of tags
being outside identity in §3.

## 6. An extension gets a toast — BUILT

When the new line *extends* a stored one (`extension-longer`), the save proceeds
and a toast reports it: the stored line's moves are a prefix of what was just
saved. The reverse (`extension-shorter` — saving something already contained in a
longer stored line) is the same conversation from the other end. Neither blocks
the save; both must be visible, because silently ending up with a line and a
truncated copy of it is how a repertoire rots.

The two directions are deliberately not symmetrical. Where the new line CONTAINS
an older one, the older one is now redundant and removing it is offered — behind
a confirm, because it is a delete. Where the new line is contained BY a longer
one, nothing is offered but the name and a way to open it: the longer line is the
user's work and this code does not get to touch it. `divergent` and `identical`
say nothing at all — neither is a problem.

Both are toasts carrying one optional action (`toast.ts` gained `action` and a
queue for this), because an extension is worth knowing about and never worth
blocking on. They queue behind the save confirmation rather than replacing it.

## 7. New lines inherit training records for moves already known — BUILT

A newly saved line that passes through positions the user has already drilled in
another line starts with those moves' review records, rather than as brand-new
material. You do not re-learn a move because you filed it under a second name.

Inheritance is per move, keyed by position: a user move at a position where
another line has a review record for **the same move** copies that record.

It runs in `persistCurrentLine()` BEFORE the write, and therefore before the
enrolment path, so the confirm run and the scheduler both see the inherited state
rather than a line of brand-new moves. It only ever fills a node with NO record
of its own, which makes it equally safe on an edited line. The copy is detached —
two lines must not share a `review` object, since a later drill grades each
independently. Where several lines disagree about the same move, §10 decides.

The save toast then reports it — "6 of these 10 moves you already know." — and
says nothing at all when the number is zero.

## 8. Write-through credits the same move in other lines — BUILT

The mirror of §7. Drilling a move updates the review record on **every** line
that plays that same move from that same position — not only the line being
drilled. `siblingCredits()` (`src/train-index.ts`) is the rule: `siblingAnswers`
for the candidates, then filter to the move actually played.

Without this, a move shared by six lines gets drilled six times over and its
schedule is nonsense.

Keyed on position AND move **together**, which is the part that is easy to get
wrong: a different move from the same position is different knowledge, so
drilling the Scandinavian main-line answer must never credit the surprise weapon
filed at the same spot. There is no training filter — a parked line takes the
record too, because it describes what the user knows, and switching that line
back on later should not mean re-learning it.

It runs wherever a review is written: `onBeforeComplete` for a full line (all its
graded moves in one pass) and `onStepComplete` for the single-move modes. What
it does NOT do is count: no streak, no "moves reviewed", no `lastTrained`, no
`timesTrained` on the lines it credits. Crediting shared work **once** is the
whole point, so the same move must not read as several reviews. It does refresh
each credited line's `confidence`, which is a pure function of the records that
just changed.

Deliberately not written through the index's live nodes, despite §2. The index
answers "which line, which ply"; the caller then re-reads that line from storage,
writes the record and saves it. So a drill needs no `holdPositionIndex()`, and a
write-through can never resurrect a stale copy of a line the session changed some
other way (pausing it mid-drill, say). A ply whose move no longer matches is
skipped rather than overwritten — the index is a snapshot and can disagree with
storage. `queueWriteThrough` in `train-screen.ts` serialises the writes: two
positions in one sitting can credit the same other line, and overlapping
read-modify-writes would lose one.

## 9. The drill offers a divert only when the other line is in training — BUILT

When a drill reaches a position where another line plays a *different* move, it
may offer to divert into that line — but **only if that line is in training**.
Offering a divert into a line the user has parked is noise about work they
explicitly chose not to do.

**Only in the full-line walk** (`startDrill`), and only after the move has
actually been played — the app never announces in advance that a position has two
answers. `startPositionsDrill`, `startTimedDrill` and pre-training's confirm run
pass no `onDivert`, and the runtime gate (`isLineDrill && !timed && !!onDivert`)
means they cannot reach it: a dialog with a clock running would be infuriating.

**The board never moves.** The first version of this put a strip of text above
the board, between the line name and the board itself — which grows that flex
block and pushes the board down a beat after the user's hand is already on the
screen. Rebuilt so nothing in the layout changes size when a divert triggers:

- **That line is in training.** No red flash, no miss, no dialog. `judgeOtherLineMove()`
  (`src/train-index.ts`) doesn't just answer the one move played — it returns
  **every** distinct in-training move saved at this position, deduped by move
  (`{kind:'in-training', candidates}`). The drill draws one arrow per candidate —
  green (the same brush as a good-alternative) for the move *this* line is
  training, blue (`sibling`) for each of the others — and widens the board's
  legal destinations to exactly those squares, nothing else. A card appears
  **below** the board, absolutely positioned exactly like the note/alt cards
  (`.pt-divert-card`, `position:absolute; bottom:0` inside `.pt-bottom`), so it
  overlays rather than pushing: it names what each colour is, nothing more —
  no buttons.
  The choice is made by **playing** one of the arrows. Playing the green one is
  simply staying — graded as an ordinary correct move. Playing a blue one hands
  off to that line via `onDivert`: it credits that move as a clean recall, drops
  the line from the session queue if it was already waiting there (drilling it
  twice would be daft), and walks it **from this position on** — the moves
  before it are auto-played as context and are NOT graded, because they were
  never asked. A run that starts mid-line doesn't count as a run of the line
  either (`timesTrained` is left alone).
  Either way the line being left takes no penalty and no credit: nothing is
  written for it, so it stays exactly as due as it was.
- **That line is parked.** The normal correction — flash, retries, the arrow —
  but the status names it: *That's your move from "X", which isn't in training
  right now.* The app explains rather than just refusing. No arrows, no card:
  there's nothing to divert into.

The judgement reuses `DrillOptions.checkAlternative`, which already existed for
the engine's version of the same question ("is this wrong move actually fine?").
It now returns a `WrongMoveVerdict` — `'good-alternative'` (the engine's answer,
unchanged), `'other-line'` (the index's set of in-training candidates), or
`'parked-line'` (named, uncredited) — rather than a bare boolean, so there is one
wrong-move judgement path and not two.

## 10. Statistics take the best record

Where the same move appears in several lines and their records disagree (older
data, or a line saved before write-through existed), statistics use the **best**
record — the longest interval / highest reps. The user demonstrably knows the
move; the weakest copy is a bookkeeping artefact, not evidence.

---

## Transpositions

`transpositionsFor(line)` reports positions the line shares with another line
that gets there **by a different move order**. A shared opening prefix is not a
transposition — the two lines simply have not parted yet — so a match only counts
when the move sequences arriving at the position differ.

Two deliberate limits, both because a consumer that wanted otherwise does not
exist:

- **Same colour only.** The White and Black repertoires are separate books. A
  position appearing in both is not actionable, since the move recorded there
  belongs to the opponent in one of them.
- **Reporting is one-directional.** The walk covers every position the queried
  line passes through, its final one included — so "my line ends where another is
  still going" is reported. The mirror case (their end meets my middle) is found
  by asking from their side. The relation is symmetric; the report is not.

## 11. The tree view merges by position — BUILT

The fourth stop on My Lines' grouping toggle draws the filtered lines as one map
with nodes keyed by **position** instead of by path, so two lines that transpose
meet on one node and continue once. `src/map-merge.ts` builds it,
`repertoire-map.ts` draws it, `lines-tree-view.ts` embeds it.

It uses the same position key (via `openings.epdKey`) but **not** the index. The
index answers "which line, which ply"; the map needs a graph of positions with
parent/child edges, which is a different shape, and it has to be rebuildable at a
truncated depth for the map's own controls. Re-walking the saved trees costs the
same as one index build and keeps the map out of the index's staleness rules.

**A position merge can loop, and a path merge cannot.** That is the one genuinely
new failure mode. A position is reachable again by a repetition (1.Nf3 Nf6 2.Ng1
Ng8 is the start position, exactly: same board, side to move, castling rights and
en passant) and by two lines crossing over each other. A naive walker then
recurses until the stack blows. Three guards, and all three should stay:

- **One visited-key map per build.** A node is pushed into `parent.children` only
  in the branch that CREATES it, so every node has exactly one child-edge parent
  and depth strictly increases along child edges. Any later route into an
  existing position becomes an `altOut` edge — drawn dashed, counted towards the
  answers, never followed by a walk.
- **A hard 80-ply cap** on top of whatever depth the caller asks for.
- **A severing pass** (`pruneCycles`) that re-walks the finished tree with an
  on-path set and demotes any child edge that would revisit a node. It should
  never fire; it is there so a later edit to the merge cannot reach the layout.

The merge recursion itself walks each saved line's own tree, never the map graph,
so it is bounded by that line's length regardless.

Two consequences worth knowing before reading a tree: a node's SAN is the move
that reached it FIRST (the other routes arrive by different moves, which is why
those live on the edge), and a node's column is its distance from the start along
that first route — not the ply it sits at in every line passing through it.

## Building and invalidating

Lazy, and it must stay lazy. `onLinesChanged` (`storage.ts`) only marks the index
stale; the rebuild happens on the next read. A burst of writes — a backup
restore, a starter pack, an account sync — therefore costs one rebuild rather
than one per line, and a session that never asks a position question never pays
for one.

**Never rebuild during a drill.** A drill holds references into the index and
writes review records back through them; swapping those nodes out mid-session
would lose the writes. `holdPositionIndex()` freezes the snapshot and returns a
release function:

```ts
const release = holdPositionIndex();
try { /* ...drill... */ } finally { release(); }
```

Writes during a hold still mark the index stale, so the first read after the last
hold is released rebuilds.

## Measured cost

A synthetic 200-line repertoire, 20 plies each, on this container (Node 22):

| | |
| --- | --- |
| entries | 4 000 |
| distinct position keys | 3 702 |
| **build time** | **5.7 ms median** (5.5 min / 10.7 max over 20 runs) |
| resident size | ≈ 1.3 MB per index |
| `duplicatesOf` + `transpositionsFor` across all 200 lines | 20 ms |

The synthetic lines take random legal tails, so key reuse (3 702 distinct out of
4 000) is far lower than a real repertoire's — this is the pessimistic end for
both memory and lookup. A phone is several times slower than this container, so
budget roughly 20–30 ms for a full rebuild. That is fine for a lazy rebuild on
the next read and firmly not fine on every keystroke, which is why §"Building"
above is written the way it is.
