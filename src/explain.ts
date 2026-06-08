// Plain-language "why this move" explanations, generated from the position
// itself — no engine, no network, no cost. Everything here is derived with
// chess.js from the move and the resulting position, optionally seasoned with
// the opening name we already fetched from Lichess.
//
// The four opening pillars we try to name in everyday words:
//   • the centre        (pawns/pieces fighting for d4/e4/d5/e5)
//   • development       (minor pieces leaving the back rank)
//   • king safety       (castling)
//   • concrete tactics  (captures, checks, mate, simple threats)
//
// This text is a *fallback*. The builder shows the user's own note instead
// whenever one exists — their words always win.

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

// Rough material values, used only to decide whether a threat is worth naming
// (capturing up, or grabbing something undefended).
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

const CENTRE = new Set(['d4', 'e4', 'd5', 'e5']);

// Starting squares of the minor pieces, so we can tell "developing" (leaving
// the back rank for the first time) from merely "repositioning".
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

// Capitalise the first letter of a sentence fragment.
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// After the move (chess is at the resulting position), find the most valuable
// enemy piece the just-moved piece now attacks that would actually be worth
// grabbing: either undefended, or worth more than our attacker. Pawns and the
// king are ignored as targets — pawn threats are noise, the king can't be won.
function findThreat(chess: Chess, move: MoveLike): { type: string; square: string } | null {
  const oppColor = move.color === 'w' ? 'b' : 'w';
  let best: { type: string; square: string; value: number } | null = null;

  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== oppColor) continue;
      if (sq.type === 'p' || sq.type === 'k') continue;

      // Does our just-moved piece (now on move.to) attack this square?
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
    case 'p': {
      if (FIANCHETTO.has(move.to)) {
        return `prepares to fianchetto a bishop on the long diagonal`;
      }
      return `nudges a pawn to ${move.to}, gaining a little space`;
    }
    case 'r':
      return `activates the rook on ${move.to}`;
    case 'q':
      return `brings the queen into play on ${move.to}`;
    case 'k':
      return `walks the king to ${move.to}`;
    case 'n':
    case 'b':
      return `repositions the ${name} to ${move.to}`;
    default:
      return `plays ${move.san}`;
  }
}

/**
 * Generate a one- or two-sentence explanation for a move.
 *
 * @param beforeFen  FEN of the position *before* the move is played.
 * @param san        The move in SAN (e.g. "Nf3", "exd5", "O-O").
 * @param openingName  Opening name from Lichess, if known (else null/undefined).
 * @returns A friendly explanation, or null if the move can't be replayed
 *          (bad FEN / illegal move) — callers should just show nothing.
 */
export function explainMove(
  beforeFen: string,
  san: string,
  openingName?: string | null
): string | null {
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

  // ── The lead clause: the single most important thing the move does. ──────
  let lead: string;
  if (isMate) {
    lead = `delivers checkmate — the game is over`;
  } else if (isCastleK || isCastleQ) {
    lead = `castles ${isCastleK ? 'kingside' : 'queenside'}, tucking the king into safety and linking the rooks`;
  } else if (isPromotion) {
    lead = `promotes the pawn to a ${PIECE_NAMES[move.promotion ?? 'q']} — a decisive gain in force`;
  } else if (isCapture) {
    const what = isEnPassant ? 'pawn (en passant)' : PIECE_NAMES[move.captured ?? 'p'];
    lead = `captures the ${what} on ${move.to}`;
  } else if (central) {
    lead = `stakes a claim in the centre, the foundation of a sound opening`;
  } else if (developing) {
    lead = `develops the ${PIECE_NAMES[move.piece]}, bringing a fresh piece toward the centre`;
  } else {
    lead = quietLead(move);
  }

  // ── Tactical riders: check and/or a concrete threat. ─────────────────────
  const riders: string[] = [];
  if (isCheck) riders.push('with check');
  const threat = isMate ? null : findThreat(chess, move);
  if (threat) {
    riders.push(`threatening to win the ${PIECE_NAMES[threat.type]} on ${threat.square}`);
  }

  let sentence = cap(lead);
  if (riders.length) sentence += `, ${riders.join(', and ')}`;
  sentence += '.';

  // ── Opening-name grounding, if we have it. ───────────────────────────────
  // Neutral context only — it names the opening, it does NOT vouch for the move
  // (that judgement is the engine verdict's job, when the engine is on).
  if (openingName) {
    sentence += ` Part of the ${openingName}.`;
  }

  return sentence;
}

// Turn an engine move-grade into a plain-language verdict to sit under the
// descriptive sentence. Pure and offline — the grading itself happens in
// engine.ts; this only phrases the result.
export function describeGrade(grade: MoveGrade): string {
  const pawns = (grade.lossCp / 100).toFixed(1);
  switch (grade.classification) {
    case 'best':
      return `This is the engine's top choice.`;
    case 'good':
      return `A sound alternative — it barely changes the evaluation.`;
    case 'inaccuracy':
      return `A slight inaccuracy — it gives up about ${pawns}. The engine prefers ${grade.bestSan}.`;
    case 'mistake':
      return `A mistake — it loses about ${pawns}. Better is ${grade.bestSan}.`;
    case 'blunder':
      return `A blunder — it drops about ${pawns}. The engine plays ${grade.bestSan}.`;
  }
}
