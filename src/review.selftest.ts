import { gradeMove } from './review';

// Pure checks of the per-move grader — no network, no engine. The I/O parts of
// reviewLine (cloud fetches, local engine, sequencing) aren't exercised here.

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

export function runReviewSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  // All cp values are mover-perspective at the parent. Top list is best-first.
  const top = [
    { uci: 'e2e4', cp: 30 },
    { uci: 'd2d4', cp: 20 },
    { uci: 'c2c4', cp: 10 },
  ];

  // Played the best move, not in book → best.
  const best = gradeMove({ parentTop: top, playedUci: 'e2e4', playedCp: 30, inBook: false, isSacrifice: false });
  check('played best → best', best?.classification === 'best' && best.cpLoss === 0, JSON.stringify(best));

  // Same, but it's book theory → book.
  const book = gradeMove({ parentTop: top, playedUci: 'e2e4', playedCp: 30, inBook: true, isSacrifice: false });
  check('best + book → book', book?.classification === 'book', JSON.stringify(book));

  // A move that throws the game away → blunder, with a real cpLoss.
  const blunder = gradeMove({ parentTop: top, playedUci: 'a2a3', playedCp: -350, inBook: false, isSacrifice: false });
  check(
    'huge eval drop → blunder',
    blunder?.classification === 'blunder' && blunder.cpLoss === 380,
    JSON.stringify(blunder),
  );

  // playedCp omitted but the move is in the top list → grader looks it up.
  const lookup = gradeMove({ parentTop: top, playedUci: 'd2d4', playedCp: null, inBook: false, isSacrifice: false });
  check('null playedCp falls back to top list', lookup?.classification === 'excellent', JSON.stringify(lookup));

  // Forced: every alternative is far worse, and the best move was played.
  const forcedTop = [{ uci: 'g1f3', cp: 40 }, { uci: 'a2a3', cp: -400 }];
  const forced = gradeMove({ parentTop: forcedTop, playedUci: 'g1f3', playedCp: 40, inBook: false, isSacrifice: false });
  check('only-move played → forced', forced?.classification === 'forced', JSON.stringify(forced));

  // Brilliant: a sound sacrifice that's also the best move, position stays good.
  const sacTop = [{ uci: 'c1h6', cp: 60 }, { uci: 'a2a3', cp: 50 }];
  const brilliant = gradeMove({ parentTop: sacTop, playedUci: 'c1h6', playedCp: 60, inBook: false, isSacrifice: true });
  check('best + sacrifice → brilliant', brilliant?.classification === 'brilliant', JSON.stringify(brilliant));

  // No data → null.
  const none = gradeMove({ parentTop: [], playedUci: 'e2e4', playedCp: 10, inBook: false, isSacrifice: false });
  check('empty top → null', none === null, JSON.stringify(none));

  return results;
}
