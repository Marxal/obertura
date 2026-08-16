# Transpositions & duplicates

**Read this before touching anything that saves a line, drills a line, or shows
statistics.** The position index (`src/position-index.ts`) knows which lines pass
through which positions. That one fact changes the behaviour of several screens,
and those behaviours have already been decided. This file is the decision record;
the code implements the parts marked *built*, and later sessions implement the
rest without re-litigating them.

Nothing in here is UI work that has shipped yet. `src/position-index.ts` and its
self-test are the whole of it so far.

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

## 4. An exact duplicate transforms the save button

Saving a line whose moves and colour already exist must **not** create a second
copy. The save button changes into an update of the existing line: it opens that
line, keeps its training record, and says so. The user should never end up with
two identical lines and no idea which one they have been drilling.

## 5. A differing tag becomes "add tag to existing line"

If the only difference is metadata — the moves and colour match, but the new save
carries a tag (or a name) the stored line lacks — the offer is **"add this tag to
your existing line"**, not a new save. This is the direct consequence of tags
being outside identity in §3.

## 6. An extension gets a toast

When the new line *extends* a stored one (`extension-longer`), the save proceeds
and a toast reports it: the stored line's moves are a prefix of what was just
saved. The reverse (`extension-shorter` — saving something already contained in a
longer stored line) is the same conversation from the other end. Neither blocks
the save; both must be visible, because silently ending up with a line and a
truncated copy of it is how a repertoire rots.

## 7. New lines inherit training records for moves already known

A newly saved line that passes through positions the user has already drilled in
another line starts with those moves' review records, rather than as brand-new
material. You do not re-learn a move because you filed it under a second name.

Inheritance is per move, keyed by position: a user move at a position where
another line has a review record for **the same move** copies that record.

## 8. Write-through credits the same move in other lines

The mirror of §7, and the reason entries hold live node references. Drilling a
move updates the review record on **every** line that plays that same move from
that same position — not only the line being drilled. `siblingAnswers(fen,
excludeLineId)` returns exactly the candidates; filter to those whose `san`
matches the move just played.

Without this, a move shared by six lines gets drilled six times over and its
schedule is nonsense.

## 9. The drill offers a divert only when the other line is in training

When a drill reaches a position where another line plays a *different* move, it
may offer to divert into that line — but **only if that line is in training**.
Offering a divert into a line the user has parked is noise about work they
explicitly chose not to do. `siblingAnswers` already sorts in-training lines
first; the divert offer must also filter on `inTraining`.

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
