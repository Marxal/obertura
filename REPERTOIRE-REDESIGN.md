# The repertoire redesign — proposal

**Status: proposal, nothing built.** This is the thinking round Marçal asked for.
Read it, argue with it, then we cut it into phases and start. Restore point for
whatever we do: `v0.5`.

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

Two exist by default: **My White lines** and **My Black lines**. The user can add
more (see §9, open question 1).

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
- **The free-tier cap needs re-expressing.** It counts in-training lines
  (`FREE_TRAINING_LINES = 10`). With branch-level toggles, flipping training on
  at a high node could enrol thirty derived lines in one tap. The cap must count
  **line ends**, and the toggle must say what it's about to do ("this turns on 12
  lines — you have 4 free slots left"). Flagged as a decision, not assumed.

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

## 9. Decisions I need from you

1. **Can there be several repertoires of the same colour?** I recommend yes —
   colour is a property, not the identity, so "1.e4 main" and "London for blitz"
   can coexist and be trained separately. It costs nothing now and is awkward to
   retrofit.
2. **Does the free tier stay "10 lines in training"?** With branch toggles it has
   to count line ends and warn before a bulk enrolment. Same number, clearer
   accounting — or a different rule if you'd rather.
3. **Names.** Auto from the bundled openings table, with an optional pinned label
   at a node? Or do manual names stay the primary identity the way they are in My
   Lines today?
4. **Migrate, or clean slate?** I recommend migrate (it's cheap and it protects
   your own repertoire, which is the biggest one that exists).
5. **Transpositions: tree, not graph.** A true position-graph (a DAG) would merge
   transpositions structurally — but it has no unique path to a line end, which
   is what training, notes and review records are all anchored to, and it can
   cycle. I recommend we **stay a tree** and keep the position index for
   awareness (the builder already reports "you reach this by another move order").
   Later, an opt-in **join**: mark a leaf "from here, continue as in that branch"
   and training follows the pointer. That gives you the "transpositions could join
   specific lines" outcome without the graph's costs. Confirm you're happy with
   opt-in joins as a later phase rather than structural merging now.

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
