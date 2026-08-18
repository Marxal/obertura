// A runnable check of the move-tree editing semantics, no test framework — same
// spirit as scheduler.selftest.ts and the other *.selftest.ts files. The builder
// edits ONE line: replaying the existing continuation advances the cursor, but a
// different move mid-line truncates and replaces everything from that point on.
// This verifies that, plus a serialise/deserialise round-trip storing one path.
// Surfaced in Settings → Diagnostics and in the headless `npm run selftest`.

import type { MoveNode } from './tree';
import type { TestResult } from './selftest-panel';
import {
  reset, addMove, goTo, mainline, serialise, loadTree, setTreeMode, getCurrentNode,
  hasMove, pathTo, removeNode, currentLineNodes,
} from './tree';

// Total nodes in a tree (root included), so a single mainline of N moves is N+1.
// Used to prove no stray sibling branches survive a round-trip.
function countNodes(node: MoveNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

const sans = () => mainline().map(n => n.san).join(' ');

export function runTreeSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // Build 1.e4 e5 2.Nf3 — a plain single line.
  reset();
  addMove('e4', 'e2e4', 'fen-e4');
  const e5 = addMove('e5', 'e7e5', 'fen-e5');
  addMove('Nf3', 'g1f3', 'fen-nf3');

  check(
    'line builds along a single path',
    sans() === 'e4 e5 Nf3',
    `mainline "${sans()}"`
  );

  // Take back to move 2 (sit on Black's e5) and play a DIFFERENT White move, 2.f4.
  goTo(e5.id);
  addMove('f4', 'f2f4', 'fen-f4');

  check(
    'a different move mid-line truncates and replaces',
    sans() === 'e4 e5 f4',
    `mainline "${sans()}"`
  );

  // The old continuation (Nf3) is gone: e5 now has exactly one child, f4.
  check(
    'old continuation discarded (single child)',
    e5.children.length === 1 && e5.children[0].san === 'f4',
    `e5 children: [${e5.children.map(c => c.san).join(', ')}]`
  );

  // Replaying the existing continuation just advances — it must NOT fork.
  goTo(e5.id);
  addMove('f4', 'f2f4', 'fen-f4');
  check(
    'replaying the continuation advances, no fork',
    e5.children.length === 1 && sans() === 'e4 e5 f4',
    `e5 children: ${e5.children.length}, mainline "${sans()}"`
  );

  // A manual note on a move rides along with the line through a round-trip.
  mainline()[2].note = 'kingside attack idea';

  // serialise / loadTree round-trip preserves exactly one path, nothing else.
  const snapshot = serialise();
  reset();
  loadTree(snapshot);
  const total = countNodes(serialise());
  check(
    'round-trip preserves exactly one line',
    sans() === 'e4 e5 f4' && total === 4,
    `mainline "${sans()}", ${total} nodes total (root + 3 moves)`
  );

  // The note survived serialise → loadTree on the right move.
  const noteAfter = mainline()[2]?.note;
  check(
    'a move note round-trips through save/load',
    noteAfter === 'kingside attack idea',
    `f4 note "${noteAfter ?? '(none)'}"`
  );

  // ── Variations mode (the game analyser) ─────────────────────────────────────
  // Build the same main line, then deviate mid-line in 'variations' mode: the
  // deviating move must be ADDED as a sibling, leaving the main line intact.
  reset();
  addMove('e4', 'e2e4', 'fen-e4');
  const e5b = addMove('e5', 'e7e5', 'fen-e5');
  addMove('Nf3', 'g1f3', 'fen-nf3');

  setTreeMode('variations');
  goTo(e5b.id);
  addMove('Bc4', 'f1c4', 'fen-bc4'); // an alternative to Nf3

  check(
    'variation adds a sibling, main line intact',
    e5b.children.length === 2 && e5b.children[0].san === 'Nf3' && e5b.children[1].san === 'Bc4',
    `e5 children: [${e5b.children.map(c => c.san).join(', ')}]`
  );
  check(
    'mainline still follows children[0]',
    sans() === 'e4 e5 Nf3',
    `mainline "${sans()}"`
  );
  check(
    'cursor sits on the new variation move',
    getCurrentNode().san === 'Bc4',
    `current "${getCurrentNode().san}"`
  );

  // Replaying an existing variation move advances onto it (no duplicate sibling).
  goTo(e5b.id);
  addMove('Bc4', 'f1c4', 'fen-bc4');
  check(
    'replaying a variation advances, no duplicate',
    e5b.children.length === 2,
    `e5 children: ${e5b.children.length}`
  );

  // ── Walking a prepared move is not an addition ──────────────────────────────
  //
  // The builder counts "moves to add" by asking hasMove before every addMove.
  // It used to compare a SAN against a UCI, so it never matched and walking
  // your own repertoire read as drafting five new moves.
  reset();
  setTreeMode('repertoire');
  addMove('e4', 'e2e4', 'fen-e4');
  const blackE5 = addMove('e5', 'e7e5', 'fen-e5');
  addMove('Nf3', 'g1f3', 'fen-nf3');

  goTo('root');
  check(
    'a prepared move reports as already there',
    hasMove('e4'),
    `hasMove('e4') = ${hasMove('e4')}`
  );
  check(
    'an unprepared move reports as new',
    !hasMove('d4'),
    `hasMove('d4') = ${hasMove('d4')}`
  );
  addMove('e4', 'e2e4', 'fen-e4');
  check(
    'a second answer at the same position reports as new',
    !hasMove('c5'),
    `hasMove('c5') = ${hasMove('c5')}`
  );

  // A move added inside a book is stamped with when it arrived — that is what
  // My Lines sorts "Latest" by, and an unstamped node sorted to the bottom.
  goTo(blackE5.id);
  const stamped = addMove('Bc4', 'f1c4', 'fen-bc4');
  check(
    'a move added to a book records when it arrived',
    typeof stamped.createdAt === 'number' && stamped.createdAt > 0,
    `createdAt ${stamped.createdAt}`
  );

  reset();
  setTreeMode('single');
  const plain = addMove('e4', 'e2e4', 'fen-e4');
  check(
    "a game's moves are not stamped",
    plain.createdAt === undefined,
    `createdAt ${plain.createdAt}`
  );

  // ── pathTo: cached, but never shared ───────────────────────────────────────
  //
  // The path is remembered between calls (a dozen readers ask for the same one
  // behind every board move) and invalidated by anything that changes the tree.
  // Callers append to what they get — currentLineNodes does — so each caller
  // must get its own array.
  reset();
  setTreeMode('repertoire');
  addMove('e4', 'e2e4', 'fen-e4');
  const cached = addMove('e5', 'e7e5', 'fen-e5');
  const first = pathTo(cached.id);
  const second = pathTo(cached.id);
  check(
    'pathTo hands each caller its own array',
    first !== second && first.map(n => n.san).join(' ') === second.map(n => n.san).join(' '),
    `same contents, ${first === second ? 'SAME array' : 'separate arrays'}`
  );
  check(
    'currentLineNodes cannot corrupt the cached path',
    currentLineNodes().length === 2 && pathTo(cached.id).length === 2,
    `path ${pathTo(cached.id).map(n => n.san).join(' ')}`
  );

  const deep = addMove('Nf3', 'g1f3', 'fen-nf3');
  check(
    'a new move invalidates the cached path',
    pathTo(deep.id).map(n => n.san).join(' ') === 'e4 e5 Nf3',
    `path "${pathTo(deep.id).map(n => n.san).join(' ')}"`
  );
  removeNode(deep.id);
  check(
    'a removed move leaves no path behind',
    pathTo(deep.id).length === 0,
    `path length ${pathTo(deep.id).length}`
  );

  reset();
  return results;
}
