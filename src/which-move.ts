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

/** How many questions are available right now (not resting) — the card's badge. */
export function readyWhichMoveCount(
  refs: SpotRef[],
  dueAt: (id: string) => number,
  now: number = Date.now(),
): number {
  return fairPairs(refs).filter(r => dueAt(r.spot.id) <= now).length;
}
