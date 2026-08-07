// Offline coverage for the puzzle alternate-move judge. No engine here — the
// verdict function is pure, so the searches are stubbed as MoveEval[] and only
// the decision rules are exercised (plus the two board helpers, which are pure
// chess.js). Same zero-framework style as the other suites.

import { judgeAlternate, deliversMate, isPromotionMove, isMateThemed } from './puzzle-alt';
import type { MoveEval } from './engine';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

// White to move, Ra1: a8 is mate (the black king is boxed in by its own pawns).
const MATE_FEN = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
// Black to move, after 1.e4.
const BLACK_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
// White to move, a7 pawn one square from promoting.
const PROMO_FEN = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';

function ev(uci: string, score: { cp?: number; mate?: number }): MoveEval {
  return { uci, san: uci, cp: score.cp, mate: score.mate };
}

export function runPuzzleAltSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  // ── Centipawn comparisons (white to move) ──────────────────────────────────
  const white = (lines: MoveEval[], user: string, official: string, extra = {}) =>
    judgeAlternate({ lines, fen: MATE_FEN, userUci: user, officialUci: official, solver: 'white', ...extra });

  check(
    'equal-ish move accepted (within tolerance)',
    white([ev('a1a8', { cp: 300 }), ev('a1b1', { cp: 285 })], 'a1b1', 'a1a8') === true,
    '15cp worse should pass a 30cp tolerance',
  );
  check(
    'clearly worse move rejected',
    white([ev('a1a8', { cp: 300 }), ev('a1b1', { cp: 120 })], 'a1b1', 'a1a8') === false,
    '180cp worse must fail',
  );
  check(
    'better move accepted',
    white([ev('a1a8', { cp: 300 }), ev('a1b1', { cp: 420 })], 'a1b1', 'a1a8') === true,
  );
  check(
    'the puzzle’s own move is not an "alternative"',
    white([ev('a1a8', { cp: 300 }), ev('a1b1', { cp: 285 })], 'a1a8', 'a1a8') === false,
  );

  // ── The two moves must both be ranked by the search ────────────────────────
  check(
    'played move missing from the lines → rejected',
    white([ev('a1a8', { cp: 300 }), ev('a1c1', { cp: 290 })], 'a1b1', 'a1a8') === false,
    'unranked moves are never accepted',
  );
  check(
    'puzzle move missing from the lines → rejected',
    white([ev('a1b1', { cp: 300 }), ev('a1c1', { cp: 290 })], 'a1b1', 'a1a8') === false,
    'without the official move’s own score there is nothing to compare against',
  );

  // ── Mate distances ─────────────────────────────────────────────────────────
  check(
    'equal-length mate accepted',
    white([ev('a1a8', { mate: 2 }), ev('a1b1', { mate: 2 })], 'a1b1', 'a1a8') === true,
  );
  check(
    'faster mate accepted',
    white([ev('a1a8', { mate: 3 }), ev('a1b1', { mate: 1 })], 'a1b1', 'a1a8') === true,
  );
  check(
    'slower mate rejected',
    white([ev('a1a8', { mate: 2 }), ev('a1b1', { mate: 4 })], 'a1b1', 'a1a8') === false,
    'mate in 4 is not the mate-in-2 the puzzle asked for',
  );
  check(
    'winning-but-not-mating move rejected when the puzzle mates',
    white([ev('a1a8', { mate: 2 }), ev('a1b1', { cp: 900 })], 'a1b1', 'a1a8') === false,
  );
  check(
    'mate accepted over a merely winning puzzle move',
    white([ev('a1a8', { cp: 400 }), ev('a1b1', { mate: 3 })], 'a1b1', 'a1a8') === true,
  );
  check(
    'move that gets you mated rejected',
    white([ev('a1a8', { cp: 300 }), ev('a1b1', { mate: -2 })], 'a1b1', 'a1a8') === false,
  );

  // ── Mate-themed puzzles demand a mate ──────────────────────────────────────
  check(
    'mate-themed puzzle rejects an equal non-mating move',
    white([ev('a1a8', { cp: 300 }), ev('a1b1', { cp: 295 })], 'a1b1', 'a1a8', { requireMate: true }) === false,
  );

  // ── Black to move: scores are white-normalised, so the sign must flip ───────
  const black = (lines: MoveEval[], user: string, official: string) =>
    judgeAlternate({ lines, fen: BLACK_FEN, userUci: user, officialUci: official, solver: 'black' });

  check(
    'black: equal-ish move accepted',
    black([ev('e7e5', { cp: -310 }), ev('c7c5', { cp: -300 })], 'c7c5', 'e7e5') === true,
    'both good for black; 10cp apart',
  );
  check(
    'black: worse move rejected (sign handling)',
    black([ev('e7e5', { cp: -400 }), ev('c7c5', { cp: -100 })], 'c7c5', 'e7e5') === false,
    'without the perspective flip this wrongly reads as "better"',
  );

  // ── Board helpers ──────────────────────────────────────────────────────────
  check('deliversMate spots mate in one', deliversMate(MATE_FEN, 'a1a8') === true);
  check('deliversMate false for a quiet move', deliversMate(MATE_FEN, 'a1b1') === false);
  check('deliversMate false for an illegal move', deliversMate(MATE_FEN, 'a1h8') === false);
  check('isPromotionMove spots a promotion', isPromotionMove(PROMO_FEN, 'a7', 'a8') === true);
  check('isPromotionMove false for a king move', isPromotionMove(PROMO_FEN, 'e1', 'e2') === false);

  // ── Theme detection ────────────────────────────────────────────────────────
  check('mateIn2 is mate-themed', isMateThemed(['short', 'mateIn2']) === true);
  check('backRankMate is mate-themed', isMateThemed(['backRankMate']) === true);
  check('a plain tactic is not mate-themed', isMateThemed(['fork', 'crushing']) === false);

  return results;
}
