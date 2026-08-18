# The repertoire redesign — proposal

**Status: Phases A, B and C are built.** §9 records the five decisions this was
agreed on; §10 says which phases have shipped and which have not. Restore point:
`v0.5`.

---

## 1. The problem, stated precisely

Today a **line is the stored thing**. `Line` (`src/types.ts`) is a record with a
name, tags, colour, training flags, and a `tree` that is really a single path —
`tree.ts` runs in `'single'` mode in the builder, so a deviating move *replaces*
the continuation rather than branching. The repertoire is a flat list of those
records.

Everything that hurts comes from that one decision:

- **The same moves are stored many times.** 1.d4 d5 2.c4 c5 and
  1.d4 d5 2.c4 c5 3.e4 e5 are two records that share four half-moves. Nothing
  in the data says they're related.
- **Adding one answer means rebuilding from move one.** A second reply to a
  position you already cover is a whole new line typed from the start.
- **Management scales badly.** Twenty lines through the French are twenty rows
  to rename, tag, pause and delete individually.
- **We've built a large subsystem to paper over it.** The position index, the
  duplicate-detecting save button, the "already saved — open it" transform, the
  extension toasts, review inheritance on save, and write-through crediting
  during training (`TRANSPOSITIONS.md` §4–§8) all exist to make N overlapping
  records behave *as if* they were one tree. That's several hundred lines of
  carefully-reasoned code whose entire job is to simulate the data model we
  should have had.

The instinct in the brief is right: **the tree is the data, the line is the
view.**

## 2. The proposal in one sentence

**Store one move tree per repertoire; derive lines from it.** The user still
builds by playing moves and still sees, tracks and trains *lines* — but a line
is now a path through the tree (root → where the line ends), not a record. Saving
merges moves into the tree instead of minting a duplicate.

---

## 3. Data model

### The stored object

```ts
interface Repertoire {
  id: string;
  name: string;                 // "My White lines", "London for blitz", "vs Anna"
  colour: 'white' | 'black';    // the side I play — sets orientation and parity
  tree: MoveNode;               // the root; ALL my moves in this book
  createdAt: number;
  archived?: boolean;
}
```

Two exist by default: **My White lines** and **My Black lines**. More can be
added — a book for blitz, one for a tournament, one for an opponent — with the
free tier allowing one extra beyond the defaults and Pro unlimited (§9.1).

### What `MoveNode` gains

Everything already on `MoveNode` stays (`san`, `uci`, `fen`, `children`, `note`,
`annotation`, `review`, the analysis fields). Four optional additions, all
serialisable, all absent on most nodes:

```ts
label?: string          // a name pinned here: "Anti-Sicilian", "Main line"
tags?: string[]         // applies here AND to everything below
training?: boolean      // explicit on/off; inherited when absent
priority?: LinePriority // same inheritance
timesTrained?: number   // on a line end: full runs of the line ending here
endpoint?: true         // "a line ends here" even though moves continue (rare)
```

**The inheritance rule is the thing that makes management scale.** `tags`,
`training` and `priority` set on a node apply to the whole subtree unless a
deeper node overrides. "Pause the whole French" is one toggle at the `1…e6`
node, not twenty. "Tag everything under 2.c4 as *Queen's Gambit*" is one action.

### Lines are derived, not stored

A **line** = the path from the root to a *line end*. A line end is a leaf, or any
node explicitly marked `endpoint`. Its properties are computed:

| property | derived from |
| --- | --- |
| `id` | `repertoireId:leafNodeId` — stable while that leaf exists |
| `name` | nearest `label` up the path → else the bundled opening name → else notation |
| `tags` | union of every `tags` on the path |
| `inTraining` | nearest `training` up the path (default **on**) |
| `priority` | nearest `priority` up the path (default standard) |
| `confidence`, `lastTrained`, bucket, due | the path's user-move `review` records, exactly as today |
| `timesTrained` | the leaf's counter |

### Why this is affordable

52 modules read lines today. **They don't have to change.** A projection module
turns repertoires into the same `Line[]` the app already consumes — same fields,
same shapes — and a small write-back layer maps the handful of *writes* (training
toggle, priority, rename, delete, review grading) onto the right tree node.

That's the whole trick: **one new module and a rewritten builder, not a
52-file rewrite.**

---

## 4. What the redesign fixes, concretely

| today | after |
| --- | --- |
| Save 1.d4 d5 2.c4 c5, then save it again three moves longer → two records | the branch grows; the line *becomes* the longer one. "Extension" stops being a concept |
| A second answer at a position → a new line typed from move 1 | a second child at that node. Everything before it is literally shared |
| Two lines sharing six moves drill those six twice; write-through fixes the *scheduling* afterwards | they're one node. Drilled once, scored once, by construction |
| Renaming/tagging/pausing twenty French lines = twenty actions | one action at the branch point |
| Deleting a line deletes moves other lines still need — or leaves orphans | delete a *move*: the node and its subtree. "Delete this line" = delete the deepest ancestor whose subtree holds only this leaf, and the app can say "this removes 3 moves; the 2 before them are shared with 4 other lines and stay" |
| Duplicate detection, extension toasts, inheritance-on-save, "save as new line?" | deleted. The problems they solve no longer exist |

The code that goes away is real: `TRANSPOSITIONS.md` §4, §5 and §6 in full, most
of §7, and the `detachAsNewLine` / `lastSavedLinePath` / duplicate-fingerprint
machinery in `main.ts`. **This redesign removes more code from `main.ts` than it
adds**, and concentrates what's left in one self-testable module.

---

## 5. The builder — the heart of it

Today the builder is a blank slate you fill with one line and then Save. After
this, **you are always standing inside a repertoire.**

**Picking up where you are.** The builder opens on a repertoire (White by
default, remembered), board oriented accordingly. The tree loaded into `tree.ts`
is the *whole repertoire*, not one path — so `treeMode` stops being
`'single'` and a deviating move adds a sibling instead of destroying the
continuation.

**Walking vs. adding.** Every move you play is one of two things, and the
interface must never leave you guessing which:

- **Already in your repertoire** — you're walking. The move list shows it solid.
  The My lines panel (`savedLineReplies`, already built) lists your saved
  continuations from here; tapping one walks down it. This is now the *primary*
  way to move around your repertoire.
- **New** — you're drafting. The move shows as pending (outline / accent), and
  the header button becomes **"Add 3 moves"** — an honest, cheap, additive
  action, not "Save line".

**Commit is additive and small.** Adding merges the pending moves onto the tree
at the position they were played from. Saving four moves onto a branch that
already had the first three adds one node. A toast confirms with an **Undo**.

**Playing a move where you already have one is the one dialog worth keeping**,
because it's the genuinely ambiguous case and today it silently destroys work:

> You already play **3.Nc3** here.
> **Add 3.e4 as a second answer** · **Replace 3.Nc3** (and the 6 moves after it) · Cancel

**Removing.** Long-press / tap a move in the move list or the tree → *Remove this
move and everything after it*, with the honest count ("removes 7 moves across 3
lines"). That is the only delete primitive needed; "delete this line" is a
convenience wrapper around it.

**Save nudges.** "End on your move?" stays — still good. "Save up to here?"
disappears: the path you're standing on *is* what you commit. The 40-ply warning
becomes a gentle note, not a dialog.

### The alternative I'm not recommending (but flag it)

Full **auto-commit**: every move you play is instantly in the repertoire, with
undo. It's the purest expression of "the tree is the data" and deletes the save
flow entirely. I'm not recommending it because exploring the board is a thing you
do constantly, and a repertoire that silently absorbs every experiment is worse
than one that asks. But if you'd rather try it, the draft/commit split above is
the safe half of it and can be flipped later.

---

## 6. My Lines becomes Repertoire

Same screen, re-pointed:

- **Repertoire selector** at the top (White · Black · any custom), with counts.
- **Two views**, both of which already exist:
  - **Lines** — the derived lines as today's cards, with the same filter bar,
    tag chips, sorting and miniatures. Nothing about how you *track* your
    repertoire changes, which is the point.
  - **Tree** — `repertoire-map.ts`, already built and already merging by
    position. It stops being the fourth stop on a grouping toggle and becomes a
    first-class view of one repertoire.
- **Per-node actions in the tree view**: name this branch, tag it, pause it,
  set priority, build from here (jumps into the builder at that position),
  remove it. This is where the inheritance rule pays off visually.
- **Line card actions** unchanged in feel: rename, tags, training toggle,
  priority, delete — each now writing to a node instead of a record.

---

## 7. Training

Mostly untouched, because it consumes derived `Line[]`. Two things get better and
one needs a decision:

- **Shared prefixes stop being drilled twice.** Today two lines sharing six moves
  ask for those six moves twice in a session; write-through corrects the *score*
  afterwards but you still played them twice. With a tree we can walk the
  repertoire and ask each due user-move once. I'd add this as a *mode*
  ("Repertoire run") rather than replacing the line walk — walking a whole line
  start-to-finish is genuinely good for muscle memory and shouldn't be lost.
- **"Individual moves" mode gets more honest.** It already trains moves rather
  than lines (`individual.ts`); on a tree it stops re-offering the same shared
  move under several line ids.
- **The free-tier cap is re-expressed, not re-decided** (§9.2). It stays
  `FREE_TRAINING_LINES = 10`, now counted as **line ends** whose resolved
  `training` is on. What changes is honesty at the point of action: flipping
  training on at a high node could enrol thirty lines in one tap, so the toggle
  says what it is about to do before it does it. Keep the counting behind a
  single function — whether the free tier should count *moves* rather than lines
  is a later round, and the tree is what finally makes that measurable.

---

## 8. Migration, backup, sync

**Migration is mechanical and I recommend doing it** rather than asking five
people to start over — it's the same merge `map-merge.ts` already performs:

1. IndexedDB v4 adds a `repertoires` store. The `lines` store is **left in
   place**, untouched, as a rollback for one version.
2. Group existing lines by colour → two repertoires.
3. Merge each line's path into the tree node by node, by UCI from the root.
4. Conflicting review records on the same node → keep the better one
   (`betterReview` in `save-index.ts` already defines "better").
5. Each line's name → `label` on its leaf; tags → `tags` on its leaf;
   `inTraining`, `priority`, `timesTrained` → the leaf. Notes and annotations
   travel with their node; on a clash, first non-empty wins.
6. Export a backup automatically before migrating, and offer it as a download.

**Backup format** goes to v3 (`repertoires` alongside the legacy `lines`), and
`parseBackup` keeps reading v1/v2 files by running them through the same merge.

**Sync is the sharp edge.** `repertoire-sync.ts` pushes the whole core blob. A
phone still on the old build must not overwrite a migrated account with its flat
line list. So: bump the payload format, and have both directions **refuse to
apply an older format** rather than merging it. Worth being explicit about,
because it's the one failure here that loses work.

---

## 9. Decisions — settled

All five answered by Marçal. Recorded here so later sessions don't re-litigate
them.

1. **Several repertoires of the same colour: YES.** Colour is a property, not the
   identity. The purpose is books for different *situations* — one for blitz, one
   for a tournament, one for an opponent — not just White and Black. So the
   selector is a first-class control, not a colour switch, and training/stats
   must be filterable by repertoire.
   **Tiering:** the free tier gets the two defaults plus **one extra**; Pro gets
   as many as you like. That's a new gate (`FREE_REPERTOIRES = 3`) and it belongs
   with the other caps in `entitlement.ts`.
2. **The free tier keeps FEELING the same for now.** Not a redesign of the
   business model in this round. Concretely: keep the cap at **10 lines in
   training**, counted as **line ends** whose resolved `training` is on. The one
   thing that must change is honesty at the point of action — a branch toggle
   that would enrol twelve lines has to say so *before* it fires ("this turns on
   12 lines; you have 4 free slots left") rather than silently enrolling three
   and dropping nine. Plus the repertoire count gate from §9.1.
   **Explicitly left open for a later round:** whether the better free-tier line
   is *moves saved* or *moves in training* rather than lines. The tree makes both
   countable for the first time, which is exactly why it's worth deciding later
   with real numbers instead of now by guesswork. Nothing in this round should
   assume the current rule is permanent — keep the counting behind one function.
3. **Names are automatic.** Derived from the bundled openings table, falling back
   to notation. A pinned `label` on a node stays in the model as the override
   (renaming a branch is how you get "Anti-Sicilian" onto twelve lines at once),
   but nothing requires the user to name anything, and no save flow ever asks.
4. **Migrate.** Per §8, including the automatic pre-migration backup and keeping
   the old `lines` store as a one-version rollback.
5. **Tree, not graph — confirmed.** Transpositions stay a matter of *awareness*
   (the position index, the merged map view) rather than structure. Opt-in joins
   ("from here, continue as in that branch") are Phase E, after the rest has had
   real use on the phone.

---

## 10. Suggested phases

Each is a tagged restore point, each leaves the app shippable.

- **Phase A — model and projection, no visible change.** `repertoire.ts` (merge a
  path, remove a subtree, resolve inherited properties), `lines-view.ts`
  (repertoire → `Line[]`), storage v4, migration, self-tests. The app runs on the
  projection and behaves exactly as it does today. This is the risky-but-
  invisible half, and the place to be slow and thorough.
- **Phase B — the builder.** Standing inside a repertoire, draft/commit, the
  branch-vs-replace dialog, remove-a-move. Deletes the duplicate machinery.
- **Phase C — Repertoire screen.** Selector, tree as a first-class view,
  per-node actions, branch-level training and tags.
- **Phase D — training.** Prefix dedupe, the repertoire run, cap accounting.
- **Phase E — optional, later.** Transposition joins.

Phase A carries almost all the risk and none of the reward; Phase B is where you
feel the difference on the phone. Worth knowing that ordering up front.

### What has shipped

**Phase A ✅** — `repertoire.ts`, `lines-view.ts`, `repertoire-migrate.ts`,
storage v4 with the migration, backup format v3. 143 new self-tests. Verified on
a seeded device: five old lines became two books, white's eighteen stored moves
collapsed to ten, and all five lines were still listed.

**Phase B ✅** — the builder stands inside a book: walking prepared moves writes
nothing, a new move is a draft, the header button says "Add N moves", and
committing merges. Deleting a line quotes what it will actually cut. Verified at
the real UI end to end.

**Phase C ✅** — My Lines became a repertoire screen. A book selector above the
filter bar (hidden when there is only one book to choose between), a sheet behind
it for making, renaming, putting aside and deleting books, and **branch actions**
on any node of the tree view: pause or train the whole branch, set how often it
comes round, name it, tag it, build from it, remove it. Every one of them names
how many lines it is about to move.

Two rules the branch controls follow, both because the alternative reads as the
control being broken:

- **The branch's answer replaces the lines'.** Setting training, priority or a
  name on a branch clears that field on everything below it, so a line someone
  set individually six months ago cannot out-vote the tap they just made. (Tags
  are the deliberate exception: they accumulate, so a branch tag is added to what
  the lines below already carry rather than replacing it.)
- **The value lives on the branch, not on every leaf.** Pausing twelve lines
  writes one flag.

Verified at the real UI: pausing 1.e4 e6 wrote the single flag `e4 e6=false` and
paused exactly the two French lines, leaving the Sicilian alone; naming the
branch renamed both and nothing else; a line built while a book is selected lands
in that book.

**Phase D, E — not started.** Specifically outstanding:

- Training's shared-prefix dedupe and the "repertoire run" mode.
- The seeded single-line flows (onboarding, "prepare a reply", a line pulled out
  of a game) still lay ONE line down in the old single-path mode. They merge into
  the book correctly when saved, so nothing duplicates — but they don't yet show
  you the book while you work.
- Transposition joins (Phase E), as agreed, after real use.

One thing worth knowing about the caps: `FREE_REPERTOIRES = 3` and the
whole-branch training check are wired through exactly the same `isEntitled()`
path as every other cap — which returns **true for everyone when the build has no
Supabase configured**. That is deliberate and predates this round (no accounts
means nobody to charge), but it does mean neither cap can be exercised in a
local or self-hosted build.
