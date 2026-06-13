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
import { pickBookLine, pickGameLine, MIN_BOOK_PLIES } from './book-lines';
import { chooseSuggestMove, type SuggestCand } from './spar';
import type { ImportedGame } from './import-core';
import type { TestResult } from './selftest-panel';

// First move (san) matching a predicate, plus its UCI — for building suggest
// candidate lists from a real position.
function findMove(fen: string, pred: (san: string) => boolean): { uci: string; san: string } {
  const ch = new Chess(fen);
  const m = ch.moves({ verbose: true }).find(v => pred(v.san));
  if (!m) throw new Error(`no move matching predicate in ${fen}`);
  return { uci: m.from + m.to + (m.promotion ?? ''), san: m.san };
}

// A throwaway ImportedGame with just the fields the book sampler reads.
function fakeGame(colour: 'white' | 'black', ucis: string[]): ImportedGame {
  return { colour, ucis } as unknown as ImportedGame;
}

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

  // ── Book-line sampling (Surprise me / From my games) ──────────────────────
  const deep = ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6',
    'b1c3', 'a7a6', 'f1e2', 'e7e5']; // 12 plies (Najdorf)
  const shallow = ['e2e4', 'e7e5', 'g1f3']; // only 3 plies

  // 6. "Surprise me": one library entry → its SAN replayed into UCI.
  const line = pickBookLine([{ eco: 'C20', name: 'King\'s Pawn', moves: ['e4', 'e5', 'Nf3'] }]);
  check('pickBookLine converts SAN to UCI', line.join(',') === 'e2e4,e7e5,g1f3', line.join(','));
  check('pickBookLine on an empty catalogue yields nothing', pickBookLine([]).length === 0, 'empty');

  // 7. "From my games": only games on the sparred side, deep enough, are sampled.
  const games = [
    fakeGame('white', deep),     // I played White → engine (Black) replays this
    fakeGame('black', deep),     // wrong side for a White spar
    fakeGame('white', shallow),  // too shallow
  ];
  const fromWhite = pickGameLine(games, 'white');
  check('pickGameLine samples my side, deep enough',
    fromWhite.join(',') === deep.join(','), `${fromWhite.length} plies (≥ ${MIN_BOOK_PLIES})`);
  check('pickGameLine with no qualifying games yields nothing',
    pickGameLine([fakeGame('white', shallow)], 'white').length === 0, 'only shallow');

  // ── Suggest-a-move flavour selection ───────────────────────────────────────
  // 8. Solid always returns the engine's best (first) candidate.
  const trio: SuggestCand[] = [{ uci: 'a', cp: 50 }, { uci: 'b', cp: 30 }, { uci: 'c', cp: -200 }];
  check('Solid takes the best move', chooseSuggestMove('solid', '', trio) === 'a', 'cp 50/30/-200');

  // 9. Random never escapes the 50cp safe set — the far-worse 'c' is unreachable.
  let everPickedBad = false;
  for (let i = 0; i < 60; i++) if (chooseSuggestMove('random', '', trio) === 'c') everPickedBad = true;
  check('Random never blunders out of the safe set', !everPickedBad, '60 draws, none = c (-200)');

  // 10. Aggressive prefers a check inside the 80cp safe set over the quiet best.
  const checkFen = '4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1';
  const quiet = findMove(checkFen, s => !s.includes('+') && !s.includes('x'));
  const giveCheck = findMove(checkFen, s => s.includes('+'));
  const checkCands: SuggestCand[] = [{ uci: quiet.uci, cp: 60 }, { uci: giveCheck.uci, cp: 30 }];
  check('Aggressive prefers a check', chooseSuggestMove('aggressive', checkFen, checkCands) === giveCheck.uci,
    `${quiet.san}=best, picks ${giveCheck.san}`);

  // 11. With no check available, Aggressive falls back to a capture.
  const capFen = '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1';
  const push = findMove(capFen, s => !s.includes('+') && !s.includes('x'));
  const capture = findMove(capFen, s => s.includes('x'));
  const capCands: SuggestCand[] = [{ uci: push.uci, cp: 60 }, { uci: capture.uci, cp: 25 }];
  check('Aggressive takes a capture when no check exists',
    chooseSuggestMove('aggressive', capFen, capCands) === capture.uci, `picks ${capture.san}`);

  return results;
}
