// Sacrifice detection for the "Brilliant" move class — deliberately simple and
// conservative. A move is treated as a sacrifice when, in the position it
// produces, the opponent can win real material (a minor piece or more) off the
// board by a capturing sequence. We use a small static-exchange evaluation (SEE)
// per square, which already accounts for defenders, so quiet developing moves and
// even trades never register.
//
// This is a heuristic: it can miss a deep sac and (rarely) over-fire. That's why
// the caller only ever crowns a move "Brilliant" when it's ALSO the engine's best
// move and the position stays good (see winprob.ts) — soundness is checked there,
// material give-up is checked here.

import { Chess } from 'chess.js';
import type { Color, PieceSymbol, Square } from 'chess.js';

const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 1000 };

// Smallest net material (in pawns) the opponent must be able to win for the move
// to count as a sacrifice — a full minor piece. Kept high so exchange-grabs and
// pawn tactics don't masquerade as brilliancies.
const MIN_SACRIFICE = 3;

// Has `color` been left material on `target` that the side to move can win?
// Returns the net material the side to move gains by initiating captures there
// (0 when the piece is adequately defended). Simplified SEE: no x-ray attackers,
// least-valuable-attacker first.
function seeGain(chess: Chess, target: Square): number {
  const victim = chess.get(target);
  const side0 = chess.turn();
  if (!victim || victim.color === side0) return 0;

  const valsOf = (c: Color): number[] =>
    chess.attackers(target, c)
      .map(sq => VALUE[chess.get(sq)!.type])
      .sort((a, b) => a - b);

  const atk: Record<Color, number[]> = { w: valsOf('w'), b: valsOf('b') };
  let side: Color = side0;
  if (atk[side].length === 0) return 0;

  const gain: number[] = [VALUE[victim.type]];
  let occupantVal = atk[side].shift()!; // the piece that lands on the square
  let d = 0;
  while (true) {
    d++;
    gain[d] = occupantVal - gain[d - 1];
    side = side === 'w' ? 'b' : 'w';
    if (atk[side].length === 0) break;
    occupantVal = atk[side].shift()!;
  }
  // Negamax fold: each side stops capturing once it's no longer worth it.
  while (--d > 0) gain[d - 1] = -Math.max(-gain[d - 1], gain[d]);
  return gain[0];
}

// Does playing `uci` from `parentFen` give up material the opponent can win? The
// move is replayed, then every piece the mover leaves on the board is checked for
// a losing exchange against the opponent to move.
export function isSacrifice(parentFen: string, uci: string): boolean {
  let chess: Chess;
  try {
    chess = new Chess(parentFen);
  } catch {
    return false;
  }
  const mover = chess.turn();
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const promotion = (uci[4] as 'q' | 'r' | 'b' | 'n') || undefined;
  try {
    if (!chess.move({ from, to, promotion })) return false;
  } catch {
    return false;
  }

  const opp: Color = chess.turn(); // it's the opponent's move now
  for (const rank of chess.board()) {
    for (const sq of rank) {
      if (!sq || sq.color !== mover) continue;
      if (!chess.isAttacked(sq.square, opp)) continue;
      if (seeGain(chess, sq.square) >= MIN_SACRIFICE) return true;
    }
  }
  return false;
}
