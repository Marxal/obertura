import { Chess } from 'chess.js';
import { moveFacts, seeAfterMove } from './move-facts';

// Pure checks of the board-facts helper — crafted positions, no network.

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

export function runMoveFactsSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  const START = new Chess().fen();

  // ── quiet opening move: nothing forced, nothing captured ────────────────────
  const e4 = moveFacts(START, 'e2e4');
  check('1.e4 not forced', !e4.onlyMove, JSON.stringify(e4));
  check('1.e4 not a recapture', !e4.trivialRecapture);
  check('1.e4 exchange-neutral', e4.seeNet === 0, String(e4.seeNet));

  // ── only legal move: Kh8 in check from Qg7 must take the undefended queen ───
  const forcedFen = '7k/6Q1/8/8/8/8/8/K7 b - - 0 1';
  const forced = moveFacts(forcedFen, 'h8g7');
  check('forced position → onlyMove', forced.onlyMove, JSON.stringify(forced));
  check('taking the free queen → seeNet +9', forced.seeNet === 9, String(forced.seeNet));

  // ── recapture: 1.e4 d5 2.exd5 Qxd5 — queen takes back on d5 ────────────────
  const game = new Chess();
  for (const m of ['e4', 'd5', 'exd5']) game.move(m);
  const recap = moveFacts(game.fen(), 'd8d5', 'e4d5');
  check('Qxd5 is a recapture of exd5', recap.trivialRecapture, JSON.stringify(recap));
  check(
    'same move without prevUci is not flagged',
    !moveFacts(game.fen(), 'd8d5').trivialRecapture,
  );

  // ── sacrifice: queen takes a pawn defended by a pawn (Qxd6, exd6) ───────────
  const sacFen = 'k7/4p3/3p4/8/8/8/8/K2Q4 w - - 0 1';
  const sac = seeAfterMove(sacFen, 'd1d6');
  check('QxP guarded by a pawn → seeNet -8', sac === -8, String(sac));

  // ── even trade: rook takes rook, pawn recaptures, no net loss beyond noise ──
  // White Rd1 x black Rd8, defended by the king on e8 — a plain even trade.
  const tradeFen = '3rk3/8/8/8/8/8/8/K2R4 w - - 0 1';
  const trade = seeAfterMove(tradeFen, 'd1d8');
  check('even rook trade is not a sacrifice', trade !== null && trade > -2, String(trade));

  // ── illegal input degrades to null, not a throw ─────────────────────────────
  const bad = moveFacts(START, 'e2e5');
  check('illegal move → seeNet null', bad.seeNet === null, JSON.stringify(bad));

  return results;
}
