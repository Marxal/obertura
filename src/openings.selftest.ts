// A runnable check of the bundled opening-name lookup — no network, no test
// framework, just like the other *.selftest.ts files. Surfaced in Settings →
// Diagnostics so the naming database can be verified right on the phone, offline.
//
// The FENs are generated with chess.js (the same engine the builder uses), so
// the lookup keys match exactly what the app computes at runtime — a hardcoded
// FEN could drift from chess.js's en-passant handling and give a false failure.

import { Chess } from 'chess.js';
import { nameForFen, nameForPath } from './openings';
import type { TestResult } from './selftest-panel';

// FEN after playing a list of SANs from the start position.
function fenAfter(sans: string[]): string {
  const chess = new Chess();
  for (const san of sans) chess.move(san);
  return chess.fen();
}

// The FEN of every position along a line, in order — what nameForPath expects.
function pathFens(sans: string[]): string[] {
  const chess = new Chess();
  return sans.map(san => {
    chess.move(san);
    return chess.fen();
  });
}

export function runOpeningsSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // 1. A known first move resolves to its book name.
  const e4 = nameForFen(fenAfter(['e4']));
  check("1.e4 is named the King's Pawn Game", e4 === "King's Pawn Game", e4 ?? 'null');

  const d4 = nameForFen(fenAfter(['d4']));
  check("1.d4 is named the Queen's Pawn Game", d4 === "Queen's Pawn Game", d4 ?? 'null');

  // 2. A known mid-opening position resolves to the right family.
  const italian = nameForFen(fenAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']));
  check('the Italian Game position is recognised', italian === 'Italian Game', italian ?? 'null');

  // 3. nameForPath returns the DEEPEST named position on a line, ignoring an
  //    off-book tail (3...a5 here isn't in the database, so the Italian wins).
  const italianThenOffBook = nameForPath(pathFens(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'a5']));
  check(
    'a path returns its deepest named position, past an off-book move',
    italianThenOffBook === 'Italian Game',
    italianThenOffBook ?? 'null',
  );

  // 4. An unnamed position (a bare king-and-king endgame) returns null.
  const none = nameForFen('8/8/8/4k3/8/4K3/8/8 w - - 0 1');
  check('an unknown position returns null', none === null, String(none));

  // 5. nameForPath over only-unknown positions is null too (no false match).
  const allUnknown = nameForPath(['8/8/8/4k3/8/4K3/8/8 w - - 0 1']);
  check('a path with no named position returns null', allUnknown === null, String(allUnknown));

  return results;
}
