// A runnable check of the engine-sparring "out of book" detector — no network,
// no test framework, like the other *.selftest.ts files. The interesting cases
// are real opening lines whose book naming has mid-sequence gaps: the detector
// must NOT cry "out of book" inside known theory, but MUST latch once a line
// runs off into genuinely unnamed territory.
//
// FENs come from chess.js (the same engine the app uses) so the lookup keys
// match what the app computes at runtime.

import { Chess } from 'chess.js';
import { isOutOfBook } from './openings';
import type { TestResult } from './selftest-panel';

// The FEN of every position along a line, in order — what isOutOfBook expects.
function pathFens(sans: string[]): string[] {
  const chess = new Chess();
  return sans.map(san => {
    chess.move(san);
    return chess.fen();
  });
}

export function runSparSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // 1. The start position is in book.
  check('the start position is in book', !isOutOfBook([]), 'no moves');

  // 2. A deep but mainline Ruy Lopez stays in book despite its naming gaps
  //    (Ba4, Re1, c3 etc. are unnamed between named positions).
  const ruy = pathFens(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O']);
  check('a deep Ruy Lopez mainline stays in book', !isOutOfBook(ruy), 'closed Ruy, 16 plies');

  // 3. A short gap inside theory (an unnamed half-move past a named position) is
  //    tolerated — 6...e5 here is unnamed but the Opočenský before it is named.
  const najdorf = pathFens(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be2', 'e5']);
  check('a 1-ply naming gap inside theory is not off-book', !isOutOfBook(najdorf), 'Najdorf, Opočenský + e5');

  // 4. A line that runs well past known theory latches as out of book.
  const offbook = pathFens(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'a5', 'a4', 'Qf6', 'd3', 'Qg6']);
  check('a line past theory reads as out of book', isOutOfBook(offbook), 'Italian + 5 off-book plies');

  // 5. A weird first move with no follow-up names latches after the tolerance.
  const weird = pathFens(['a4', 'h5', 'b4', 'g5']);
  check('an unnamed opening latches off-book', isOutOfBook(weird), '1.a4 h5 2.b4 g5');

  return results;
}
