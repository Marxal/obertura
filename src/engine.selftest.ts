// Offline coverage for the engine's UCI→SAN/uci resolver — no network, no test
// framework, like the other *.selftest.ts files. The interesting case is
// Lichess's "king-to-rook" castling notation (e8h8 / e1a1), which chess.js's
// standard mode rejects and which used to surface as a raw "e8h8" chip.
//
// FENs are generated with chess.js (the engine the app uses) so the keys match
// runtime exactly, as in openings.selftest.ts.

import { Chess } from 'chess.js';
import { resolveUci } from './engine';
import type { TestResult } from './selftest-panel';

function fenAfter(sans: string[]): string {
  const chess = new Chess();
  for (const san of sans) chess.move(san);
  return chess.fen();
}

const START = new Chess().fen();

export function runEngineSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // 1. Black kingside castling in Lichess king-to-rook form (e8h8) → O-O / e8g8.
    //  After 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.O-O Nf6 5.d3 it's Black to move and able to O-O.
  const blackOO = fenAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O', 'Nf6', 'd3']);
  const r1 = resolveUci(blackOO, 'e8h8');
  check(
    'Lichess e8h8 resolves to Black O-O (e8g8)',
    r1?.san === 'O-O' && r1?.uci === 'e8g8',
    `${r1?.san} / ${r1?.uci}`,
  );

  // 2. White queenside castling in king-to-rook form (e1a1) → O-O-O / e1c1.
  //    After 1.d4 d5 2.Nc3 Nc6 3.Bf4 Bf5 4.Qd2 Qd7 White can O-O-O.
  const whiteOOO = fenAfter(['d4', 'd5', 'Nc3', 'Nc6', 'Bf4', 'Bf5', 'Qd2', 'Qd7']);
  const r2 = resolveUci(whiteOOO, 'e1a1');
  check(
    'Lichess e1a1 resolves to White O-O-O (e1c1)',
    r2?.san === 'O-O-O' && r2?.uci === 'e1c1',
    `${r2?.san} / ${r2?.uci}`,
  );

  // 3. A normal move passes through unchanged (uci kept, SAN computed).
  const r3 = resolveUci(START, 'g1f3');
  check(
    'a normal move keeps its uci and gets its SAN',
    r3?.san === 'Nf3' && r3?.uci === 'g1f3',
    `${r3?.san} / ${r3?.uci}`,
  );

  // 4. A genuinely illegal move returns null (no crash, no raw fallback here).
  const r4 = resolveUci(START, 'e2e5');
  check('an illegal move returns null', r4 === null, String(r4));

  // 5. King-to-rook shape that ISN'T a legal castle (blocked at the start
  //    position) must NOT be conjured into a phantom O-O — it returns null.
  const r5 = resolveUci(START, 'e1h1');
  check('a blocked king-to-rook move is not a phantom castle', r5 === null, String(r5));

  return results;
}
