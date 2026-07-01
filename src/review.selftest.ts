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
  const best = gradeMove({ parentTop: top, playedUci: 'e2e4', playedCp: 30, inBook: false });
  check('played best → best', best?.classification === 'best' && best.cpLoss === 0, JSON.stringify(best));

  // Same, but it's book theory → book.
  const book = gradeMove({ parentTop: top, playedUci: 'e2e4', playedCp: 30, inBook: true });
  check('best + book → book', book?.classification === 'book', JSON.stringify(book));

  // A move that throws the game away → blunder, with a real cpLoss.
  const blunder = gradeMove({ parentTop: top, playedUci: 'a2a3', playedCp: -350, inBook: false });
  check(
    'huge eval drop → blunder',
    blunder?.classification === 'blunder' && blunder.cpLoss === 380,
    JSON.stringify(blunder),
  );

  // playedCp omitted but the move is in the top list → grader looks it up.
  const lookup = gradeMove({ parentTop: top, playedUci: 'd2d4', playedCp: null, inBook: false });
  check('null playedCp falls back to top list', lookup?.classification === 'excellent', JSON.stringify(lookup));

  // The best move is far ahead of every alternative, and the player found it → great.
  const greatTop = [{ uci: 'g1f3', cp: 40 }, { uci: 'a2a3', cp: -400 }];
  const great = gradeMove({ parentTop: greatTop, playedUci: 'g1f3', playedCp: 40, inBook: false });
  check('standout move played → great', great?.classification === 'great', JSON.stringify(great));

  // Same standout gap, but the board facts say it was just taking a hung piece
  // (or the only legal reply) → best, not great.
  const factsBase = { onlyMove: false, trivialRecapture: false, seeNet: 0 };
  const hung = gradeMove({
    parentTop: greatTop, playedUci: 'g1f3', playedCp: 40, inBook: false,
    facts: { ...factsBase, seeNet: 9 },
  });
  check('hung-piece grab → best, not great', hung?.classification === 'best', JSON.stringify(hung));
  const recap = gradeMove({
    parentTop: greatTop, playedUci: 'g1f3', playedCp: 40, inBook: false,
    facts: { ...factsBase, trivialRecapture: true },
  });
  check('recapture → best, not great', recap?.classification === 'best', JSON.stringify(recap));

  // A genuine sacrifice that keeps a healthy eval → brilliant.
  const sac = gradeMove({
    parentTop: [{ uci: 'd3h7', cp: 150 }, { uci: 'a2a3', cp: 60 }],
    playedUci: 'd3h7', playedCp: 150, inBook: false,
    facts: { ...factsBase, seeNet: -2 },
  });
  check('sound sac → brilliant', sac?.classification === 'brilliant', JSON.stringify(sac));

  // The same sac while dead lost stays a plain best move.
  const desperado = gradeMove({
    parentTop: [{ uci: 'd3h7', cp: -400 }, { uci: 'a2a3', cp: -700 }],
    playedUci: 'd3h7', playedCp: -400, inBook: false,
    facts: { ...factsBase, seeNet: -2 },
  });
  check('sac while losing → best', desperado?.classification === 'best', JSON.stringify(desperado));

  // No data → null.
  const none = gradeMove({ parentTop: [], playedUci: 'e2e4', playedCp: 10, inBook: false });
  check('empty top → null', none === null, JSON.stringify(none));

  return results;
}
