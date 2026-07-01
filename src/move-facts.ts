// Board facts about a single move, for the classifier's judgement calls — is
// this "great" move actually forced? is that "best" move really a sacrifice?
// Pure chess.js, no network, no engine; self-tested in move-facts.selftest.ts.
//
// The material model is a static exchange evaluation (SEE) confined to the
// move's destination square: play the move, then let both sides capture there
// with their least valuable attacker while it profits. chess.js generates only
// LEGAL moves, so pins and checks are respected for free — a "defender" that is
// pinned to its king simply never appears in the capture list.

import { Chess } from 'chess.js';

// Classic piece values in pawns. The king is priced high so "capturing" it never
// looks attractive in the arithmetic (it can't be captured legally anyway).
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

// Exchange outcomes at least this big (in pawns) count as a real sacrifice /
// a free capture, rather than exchange noise around an even trade.
export const SEE_MATERIAL_MARGIN = 2;

export interface MoveFacts {
  onlyMove: boolean;         // the mover had exactly one legal move
  trivialRecapture: boolean; // a capture on the square the opponent just moved to
  seeNet: number | null;     // net material of the exchange on the destination
                             // square, mover's perspective (null: move illegal)
}

// The best material outcome (≥ 0) for the side to move in `chess`, capturing on
// `sq` with its least valuable attacker — the standard SEE recursion with
// stand-pat, over legal moves only. Terminates because every step removes a
// piece from the board.
function seeCapture(chess: Chess, sq: string): number {
  const caps = chess
    .moves({ verbose: true })
    .filter(m => m.to === sq && m.captured);
  if (!caps.length) return 0;
  caps.sort((a, b) => VALUE[a.piece] - VALUE[b.piece]);
  const m = caps[0];
  const next = new Chess(chess.fen());
  next.move({ from: m.from, to: m.to, promotion: m.promotion });
  return Math.max(0, VALUE[m.captured!] - seeCapture(next, sq));
}

// Net material of playing `uci` and letting the exchange on its destination
// square run out, in the mover's perspective: what we took, minus what the
// opponent then wins back on that square. Exported for the self-test.
export function seeAfterMove(parentFen: string, uci: string): number | null {
  const chess = new Chess(parentFen);
  let played;
  try {
    played = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.slice(4) || undefined,
    });
  } catch {
    return null;
  }
  if (!played) return null;
  const taken = played.captured ? VALUE[played.captured] : 0;
  return taken - seeCapture(chess, played.to);
}

export function moveFacts(parentFen: string, uci: string, prevUci?: string): MoveFacts {
  let chess: Chess;
  try {
    chess = new Chess(parentFen);
  } catch {
    return { onlyMove: false, trivialRecapture: false, seeNet: null };
  }
  const legal = chess.moves({ verbose: true });
  const onlyMove = legal.length === 1;
  const played = legal.find(m => m.from + m.to + (m.promotion ?? '') === uci);
  if (!played) return { onlyMove, trivialRecapture: false, seeNet: null };

  const trivialRecapture =
    !!played.captured && !!prevUci && played.to === prevUci.slice(2, 4);

  return { onlyMove, trivialRecapture, seeNet: seeAfterMove(parentFen, uci) };
}
