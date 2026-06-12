// A runnable check of the move-tree editing semantics, no test framework — same
// spirit as scheduler.selftest.ts and the other *.selftest.ts files. The builder
// edits ONE line: replaying the existing continuation advances the cursor, but a
// different move mid-line truncates and replaces everything from that point on.
// This verifies that, plus a serialise/deserialise round-trip storing one path.
// Surfaced in Settings → Diagnostics and in the headless `npm run selftest`.

import type { MoveNode } from './tree';
import type { TestResult } from './selftest-panel';
import { reset, addMove, goTo, mainline, serialise, loadTree } from './tree';

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

  reset();
  return results;
}
