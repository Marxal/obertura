// Offline coverage for the deeper-lines explorer parser — no network, no test
// framework, like the other *.selftest.ts files. The live fetch in
// explorer-api.ts can only be exercised on the phone (the build container blocks
// lichess hosts), so here we pin down the PARSING of a representative masters
// explorer response and the defensive handling of junk shapes.

import { parseExplorerMoves } from './explorer-api';
import type { TestResult } from './selftest-panel';

// A trimmed but real-shaped masters response for the position after 1.e4 e5 2.Nf3.
const SAMPLE = {
  white: 1500,
  draws: 900,
  black: 600,
  moves: [
    { uci: 'b8c6', san: 'Nc6', white: 800, draws: 500, black: 300 },
    { uci: 'g8f6', san: 'Nf6', white: 200, draws: 150, black: 100 },
    { uci: 'd7d6', san: 'd6', white: 30, draws: 20, black: 10 },
  ],
  opening: { eco: 'C40', name: "King's Knight Opening" },
};

export function runExplorerApiSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // 1. A normal response parses to one ExplorerMove per move, in order.
  const moves = parseExplorerMoves(SAMPLE);
  check(
    'parses every move from a masters response',
    moves.length === 3 && moves[0].san === 'Nc6' && moves[0].uci === 'b8c6',
    `got ${moves.length} moves: ${moves.map(m => m.san).join(', ')}`,
  );

  // 2. Game totals sum white + draws + black for each move.
  check(
    'sums white + draws + black into a games total',
    moves[0].games === 1600 && moves[2].games === 60,
    `Nc6=${moves[0]?.games}, d6=${moves[2]?.games}`,
  );

  // 3. Missing tallies count as zero rather than NaN.
  const sparse = parseExplorerMoves({ moves: [{ uci: 'e2e4', san: 'e4' }] });
  check(
    'a move with no tallies has a games total of 0',
    sparse.length === 1 && sparse[0].games === 0,
    `games=${sparse[0]?.games}`,
  );

  // 4. Junk / unexpected shapes yield an empty list, never a throw.
  const junk =
    parseExplorerMoves(null).length === 0 &&
    parseExplorerMoves({}).length === 0 &&
    parseExplorerMoves({ moves: 'nope' }).length === 0 &&
    parseExplorerMoves({ moves: [{ uci: 'e2e4' }, 7, null] }).length === 0;
  check('defends against null / malformed responses', junk, 'all empty, no throw');

  return results;
}
