// Which move — the pure core of the two-move question.
//
// THE EXERCISE. One position from one of your games, two moves drawn on the
// board as arrows: the one you actually played, and the one the engine wanted.
// You pick. It is the smallest exercise in the app on purpose — no blank board,
// no search, just "which of these two is the good one" — which makes it the one
// that still works on a bus with thirty seconds to spare.
//
// It reads the mistake scan's spots (mistake-scan.ts); there is nothing new to
// find. What this file decides is which of those spots make a FAIR question,
// because a two-answer question with a defensible wrong answer is worse than no
// question at all:
//
//   • the move you played must not itself be one of the engine's picks —
//     otherwise "wrong" is a lie;
//   • the gap between the two has to be wide enough to see, so nobody is asked
//     to split hairs between two reasonable moves;
//   • and the two moves have to be visibly different on the board (a promotion
//     to a different piece from the same square is one arrow, not two).
//
// No DOM, no engine, no storage — which-move.selftest.ts covers the lot.

import { cpToWin } from './winprob';
import { moveFacts, SEE_MATERIAL_MARGIN } from './move-facts';
import type { MoveEval } from './engine';
import type { SpotRef } from './mistake-scan';

/**
 * How much worse the played move has to be, in win probability. The grader's
 * mistake boundary (winprob.ts): below this the two moves are close enough that
 * calling one of them "the blunder" would be picking a fight with the user.
 */
export const MIN_GAP = 0.10;

/** Is this spot a fair two-move question? */
export function isFairPair(ref: SpotRef): boolean {
  const { spot } = ref;
  const best = spot.best[0];
  if (!best) return false;
  const played = spot.playedUci.slice(0, 4);
  // The engine's move has to be a different move on the board.
  if (best.uci.slice(0, 4) === played) return false;
  // …and the move you played must not be one of its other picks either.
  if (spot.best.slice(1, 3).some(m => m.uci.slice(0, 4) === played)) return false;
  return cpToWin(spot.evalBefore) - cpToWin(spot.evalAfter) >= MIN_GAP;
}

/** Every spot that makes a fair question. */
export function fairPairs(refs: SpotRef[]): SpotRef[] {
  return refs.filter(isFairPair);
}

/**
 * Deal a session's worth: questions you haven't answered lately first (the rest
 * log — middle-log.ts), newest game first inside that, and never two questions
 * from the same game in a row while other games are waiting. Same game twice
 * running means the same opponent, often the same opening — it reads as a bug.
 */
export function pickWhichMove(
  refs: SpotRef[],
  count: number,
  dueAt: (id: string) => number = () => 0,
  now: number = Date.now(),
): SpotRef[] {
  const pool = fairPairs(refs).slice().sort((a, b) => {
    const ra = dueAt(a.spot.id) > now ? 1 : 0;
    const rb = dueAt(b.spot.id) > now ? 1 : 0;
    if (ra !== rb) return ra - rb;                       // available first
    if (ra === 1) return dueAt(a.spot.id) - dueAt(b.spot.id); // soonest back
    return b.game.endTime - a.game.endTime;              // newest game first
  });

  const out: SpotRef[] = [];
  const held: SpotRef[] = [];
  for (const ref of pool) {
    if (out.length >= count) break;
    if (out.length && out[out.length - 1].game.id === ref.game.id) { held.push(ref); continue; }
    out.push(ref);
  }
  // Whatever was held back for being a repeat of the game before it still beats
  // dealing a short session.
  for (const ref of held) {
    if (out.length >= count) break;
    out.push(ref);
  }
  return out;
}

// ── The "why" under each answer ──────────────────────────────────────────────
//
// After you have picked, the two moves sit side by side with what the position
// was worth after each: red for yours, green for the engine's. The numbers were
// the whole argument, and a number is only an argument if you already know how
// to read one — "−4.2" says the move was bad without ever saying what was bad
// about it.
//
// So each chip gets one short clause. It is derived, never guessed: a static
// exchange on the move's destination square (move-facts.ts) answers "did this
// hang something", the mate sentinels answer "is this mate", and the win
// probabilities either side answer "what changed". Where none of those has
// anything definite to say, the clause is about the SWING and nothing more —
// which is still true, and still more than a number.
//
// Anything the engine did not tell us, we do not say.

/** Mate scores are stored as ±100000-ish sentinels (winprob.flattenCp). */
const MATE_CP = 90000;

export interface PairWhy {
  /** One clause for the move that was played. */
  played: string;
  /** …and one for the engine's. */
  best: string;
}

/**
 * The fields explainPair needs, and nothing more — MistakeSpot satisfies it,
 * and so does detective.ts's DetectiveSpot (evals in the blunderer's own
 * perspective, same convention as MistakeSpot's "yours"), which is what lets
 * Blunder detective show the same red/green pair without its own copy of this.
 */
export interface EvalPairSpot {
  preFen: string;
  playedSan: string;
  playedUci: string;
  best: MoveEval[];
  evalBefore: number;
  evalAfter: number;
}

/**
 * A short reason for each side of the red/green pair. Pure: FEN + the stored
 * evals in, two clauses out.
 *
 * Both evals are in the mover's own perspective: `evalBefore` is what the
 * position was worth with the engine's move, `evalAfter` what it was worth
 * after the move actually played.
 */
export function explainPair(spot: EvalPairSpot): PairWhy {
  const best = spot.best[0];
  const winBefore = cpToWin(spot.evalBefore);
  const winAfter = cpToWin(spot.evalAfter);
  const playedSee = seeOf(spot.preFen, spot.playedUci);
  const bestSee = best ? seeOf(spot.preFen, best.uci) : null;

  return {
    played: whyPlayed(spot, winBefore, winAfter, playedSee),
    best: whyBest(spot, winBefore, playedSee, bestSee),
  };
}

function seeOf(fen: string, uci: string): number | null {
  if (!fen || !uci) return null;
  return moveFacts(fen, uci).seeNet;
}

function whyPlayed(
  spot: EvalPairSpot,
  winBefore: number,
  winAfter: number,
  see: number | null,
): string {
  if (spot.evalAfter <= -MATE_CP) return 'allows mate';
  // A losing exchange on the square it lands on is the most concrete thing we
  // can say, and the most common answer.
  if (see !== null && see <= -SEE_MATERIAL_MARGIN) {
    return `hangs material on ${spot.playedUci.slice(2, 4)}`;
  }
  if (winBefore >= 0.75 && winAfter < 0.55) return 'throws away a won position';
  if (winAfter <= 0.25) return 'leaves you losing';
  if (winBefore >= 0.55) return 'gives up the advantage';
  return 'makes it much worse';
}

function whyBest(
  spot: EvalPairSpot,
  winBefore: number,
  playedSee: number | null,
  bestSee: number | null,
): string {
  const best = spot.best[0];
  if (!best) return '';
  if (spot.evalBefore >= MATE_CP) return 'forces mate';
  if (bestSee !== null && bestSee >= SEE_MATERIAL_MARGIN) {
    return `wins material on ${best.uci.slice(2, 4)}`;
  }
  // Only worth saying "keeps it" when there was something to lose — i.e. when
  // the move actually played was the one that dropped it.
  if (playedSee !== null && playedSee <= -SEE_MATERIAL_MARGIN) return 'keeps the material';
  if (winBefore >= 0.75) return 'keeps you winning';
  if (winBefore >= 0.45) return 'holds the balance';
  return 'keeps the game alive';
}

/** How many questions are available right now (not resting) — the card's badge. */
export function readyWhichMoveCount(
  refs: SpotRef[],
  dueAt: (id: string) => number,
  now: number = Date.now(),
): number {
  return fairPairs(refs).filter(r => dueAt(r.spot.id) <= now).length;
}
