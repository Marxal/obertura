// Time pressure with too few mistakes of your own. A round deals up to 60 positions
// and loops through what it has, so a pool of a few mistakes repeats within one
// round. That's most people's first days: a scan takes 15-40 seconds a game and
// finds at most three mistakes in it.
//
// So a small pool is topped up with Lichess puzzles. Your own mistakes keep the
// front of the round (dealRound puts puzzles last). A puzzle counts only its first
// move, and the round still writes nothing but your best score.

import { Chess } from 'chess.js';
import { fetchNextPuzzle, puzzleSetup, type Puzzle } from './puzzles';
import type { ImportedGame } from './import-core';
import type { SpotRef } from './mistake-scan';
import { isPuzzleRef, PUZZLE_ID_PREFIX } from './time-pressure';
import { t } from './i18n';

export { isPuzzleRef };

// Twenty positions outlasts most two-minute rounds, at twenty seconds a position.
export const TARGET_POOL = 20;
const AT_ONCE = 4;
// Starting the round matters more than a full pool.
const FILL_TIMEOUT_MS = 3500;

/** A puzzle in the shape a round deals. Null if the puzzle can't be replayed. */
export function puzzleRef(puzzle: Puzzle): SpotRef | null {
  const setup = puzzleSetup(puzzle);
  if (!setup) return null;
  const uci = setup.solution[0];
  const board = new Chess(setup.fen);
  const move = board.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  });
  const game: ImportedGame = {
    id: `${PUZZLE_ID_PREFIX}${puzzle.id}`,
    url: '',
    endTime: 0,
    timeClass: 'blitz',
    timeControl: '',
    rated: false,
    colour: setup.solverColour,
    result: 'draw',
    opponent: t('mid.puzzle13'),
    eco: null,
    opening: null,
    sans: [],
    ucis: [],
    plyCount: 0,
  };
  return {
    game,
    spot: {
      id: `${PUZZLE_ID_PREFIX}${puzzle.id}`,
      ply: 0,
      category: 'blunder',
      preFen: setup.fen,
      playedSan: '',
      playedUci: '',
      best: [{ uci, san: move.san }],
      evalBefore: 0,
      evalAfter: 0,
    },
  };
}

export type PuzzleFetch = () => Promise<Puzzle | null>;

/** The pool for a round: your mistakes, plus puzzles if there are too few. */
export async function fillPool(
  refs: SpotRef[],
  fetchPuzzle: PuzzleFetch = () => fetchNextPuzzle(null),
  timeoutMs = FILL_TIMEOUT_MS,
): Promise<SpotRef[]> {
  if (refs.length === 0 || refs.length >= TARGET_POOL) return refs;

  const out = [...refs];
  const seen = new Set<string>();
  let timedOut = false;
  const work = (async () => {
    while (out.length < TARGET_POOL && !timedOut) {
      const want = Math.min(AT_ONCE, TARGET_POOL - out.length);
      const batch = await Promise.all(Array.from({ length: want }, () => fetchPuzzle().catch(() => null)));
      const got = batch.filter((p): p is Puzzle => !!p);
      if (timedOut) return;
      // A batch that adds nothing ends it, whether offline, refused, or the same
      // puzzles again: asking once more wouldn't change the answer.
      let added = 0;
      for (const puzzle of got) {
        if (seen.has(puzzle.id) || out.length >= TARGET_POOL) continue;
        seen.add(puzzle.id);
        const ref = puzzleRef(puzzle);
        if (ref) { out.push(ref); added++; }
      }
      if (added === 0) return;
    }
  })();
  await Promise.race([
    work,
    new Promise<void>((resolve) => { setTimeout(() => { timedOut = true; resolve(); }, timeoutMs); }),
  ]);
  return [...out];
}
