// Plain-language "why this move" explanations, generated from the position
// itself — no AI, no annotation database. Everything here is derived with
// chess.js from the move and the resulting position.
//
// Two layers, both shown only when the engine is on (the engine verdict is
// what makes the description worth reading):
//   1. describeGrade()  — the engine's short verdict (good / mistake / …).
//   2. explainMove()    — a short, intention-focused note on what the move does
//                         (centre, development, king safety, tactics).
//
// The user's own note always overrides both — when a note exists the panel hides.

import { Chess } from 'chess.js';
import type { MoveGrade } from './engine';

const PIECE_NAMES: Record<string, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

// Rough material values, used only to decide whether a threat is worth naming.
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

const CENTRE = new Set(['d4', 'e4', 'd5', 'e5']);

// Starting squares of the minor pieces, to tell "developing" (leaving the back
// rank for the first time) from merely "repositioning".
const MINOR_START: Record<'w' | 'b', Set<string>> = {
  w: new Set(['b1', 'g1', 'c1', 'f1']),
  b: new Set(['b8', 'g8', 'c8', 'f8']),
};

// Squares that signal a fianchetto is being prepared.
const FIANCHETTO = new Set(['b3', 'g3', 'b6', 'g6']);

interface MoveLike {
  color: 'w' | 'b';
  piece: string;
  captured?: string;
  promotion?: string;
  flags: string;
  from: string;
  to: string;
  san: string;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// After the move (chess is at the resulting position), find the most valuable
// enemy piece the just-moved piece now attacks that's actually worth grabbing:
// either undefended, or worth more than our attacker. Pawns and king ignored.
function findThreat(chess: Chess, move: MoveLike): { type: string; square: string } | null {
  const oppColor = move.color === 'w' ? 'b' : 'w';
  let best: { type: string; square: string; value: number } | null = null;

  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== oppColor) continue;
      if (sq.type === 'p' || sq.type === 'k') continue;

      const attackers = chess.attackers(sq.square, move.color);
      if (!attackers.includes(move.to as never)) continue;

      const defenders = chess.attackers(sq.square, oppColor);
      const undefended = defenders.length === 0;
      const winsMaterial = VALUE[sq.type] > VALUE[move.piece];
      if (!undefended && !winsMaterial) continue;

      if (!best || VALUE[sq.type] > best.value) {
        best = { type: sq.type, square: sq.square, value: VALUE[sq.type] };
      }
    }
  }

  return best ? { type: best.type, square: best.square } : null;
}

// Describe a quiet (non-capturing, non-developing, non-central) move so we
// always have something to say.
function quietLead(move: MoveLike): string {
  const name = PIECE_NAMES[move.piece];
  switch (move.piece) {
    case 'p':
      if (FIANCHETTO.has(move.to)) return `prepares to fianchetto a bishop`;
      return `advances to ${move.to}, gaining space`;
    case 'r':
      return `activates the rook on ${move.to}`;
    case 'q':
      return `brings the queen out to ${move.to}`;
    case 'k':
      return `walks the king to ${move.to}`;
    default:
      return `repositions the ${name} to ${move.to}`;
  }
}

/**
 * A short, plain-language note on what a move *does* (its intention).
 *
 * @param beforeFen  FEN of the position before the move.
 * @param san        The move in SAN (e.g. "Nf3", "exd5", "O-O").
 * @returns The note, or null if the move can't be replayed (bad FEN / illegal).
 */
export function explainMove(beforeFen: string, san: string): string | null {
  let chess: Chess;
  let move: MoveLike | null;
  try {
    chess = new Chess(beforeFen);
    move = chess.move(san) as unknown as MoveLike;
  } catch {
    return null;
  }
  if (!move) return null;

  const isMate = chess.isCheckmate();
  const isCheck = chess.isCheck() && !isMate;
  const isCastleK = move.flags.includes('k');
  const isCastleQ = move.flags.includes('q');
  const isEnPassant = move.flags.includes('e');
  const isCapture = move.flags.includes('c') || isEnPassant;
  const isPromotion = move.flags.includes('p');
  const central = move.piece === 'p' && CENTRE.has(move.to);
  const developing =
    (move.piece === 'n' || move.piece === 'b') &&
    MINOR_START[move.color].has(move.from);

  // The lead clause: the single most important thing the move does.
  let lead: string;
  if (isMate) {
    lead = `checkmate — the game is over`;
  } else if (isCastleK || isCastleQ) {
    lead = `castles ${isCastleK ? 'kingside' : 'queenside'}, bringing the king to safety`;
  } else if (isPromotion) {
    lead = `promotes to a ${PIECE_NAMES[move.promotion ?? 'q']}`;
  } else if (isCapture) {
    const what = isEnPassant ? 'pawn (en passant)' : PIECE_NAMES[move.captured ?? 'p'];
    lead = `captures the ${what} on ${move.to}`;
  } else if (central) {
    lead = `fights for the centre`;
  } else if (developing) {
    lead = `develops the ${PIECE_NAMES[move.piece]} toward the centre`;
  } else {
    lead = quietLead(move);
  }

  // Tactical riders: check and/or a concrete threat.
  const riders: string[] = [];
  if (isCheck) riders.push('with check');
  const threat = isMate ? null : findThreat(chess, move);
  if (threat) riders.push(`threatening the ${PIECE_NAMES[threat.type]} on ${threat.square}`);

  let sentence = cap(lead);
  if (riders.length) sentence += `, ${riders.join(', and ')}`;
  return sentence + '.';
}

// Turn an engine move-grade into a short verdict shown above the description.
// Pure and offline — grading itself happens in engine.ts; this only phrases it.
export function describeGrade(grade: MoveGrade): string {
  switch (grade.classification) {
    case 'best':
      return `The engine's top choice.`;
    case 'good':
      return `A good move.`;
    case 'inaccuracy':
      return `Inaccurate — ${grade.bestSan} is better.`;
    case 'mistake':
      return `A mistake — ${grade.bestSan} is stronger.`;
    case 'blunder':
      return `A blunder — ${grade.bestSan} is much better.`;
    case 'dubious':
      return `Not one of the engine's top moves — it prefers ${grade.bestSan}.`;
  }
}
