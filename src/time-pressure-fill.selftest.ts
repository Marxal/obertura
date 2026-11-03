// Topping up a small Time pressure pool with puzzles.

import { fillPool, isPuzzleRef, puzzleRef, TARGET_POOL } from './time-pressure-fill';
import { dealRound } from './time-pressure';
import type { Puzzle } from './puzzles';
import type { SpotRef } from './mistake-scan';

interface TestResult { name: string; pass: boolean; detail: string }

// 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6: White to play Qxf7#.
const puzzle = (id: string): Puzzle => ({
  id, rating: 1500, plays: 1, themes: [], gameId: 'x',
  pgn: 'e4 e5 Qh5 Nc6 Bc4 Nf6', initialPly: 5, solution: ['h5f7'],
});
const mine = (id: string): SpotRef => ({
  game: { id } as SpotRef['game'],
  spot: { id: `${id}#4` } as SpotRef['spot'],
});

export async function runTimePressureFillSelfTest(): Promise<TestResult[]> {
  const out: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => { out.push({ name, pass, detail }); };

  const ref = puzzleRef(puzzle('a'))!;
  check('a puzzle becomes a position', !!ref && ref.game.colour === 'white');
  check('its answer is the first move', ref.spot.best[0].uci === 'h5f7' && ref.spot.best[0].san === 'Qxf7#');
  check('it can be told apart', isPuzzleRef(ref) && !isPuzzleRef(mine('g')));
  check('an impossible puzzle is skipped', puzzleRef({ ...puzzle('b'), solution: ['a1a8'] }) === null);

  let n = 0;
  const ok = async (): Promise<Puzzle> => puzzle(`p${n++}`);
  const three = [mine('a'), mine('b'), mine('c')];
  const filled = await fillPool(three, ok);
  check('a small pool is filled', filled.length === TARGET_POOL, String(filled.length));
  check('your own mistakes stay', filled.slice(0, 3).every(r => !isPuzzleRef(r)));

  const dealt = dealRound(filled, 20);
  check('a round deals your own mistakes first',
    dealt.slice(0, 3).every(r => !isPuzzleRef(r)) && dealt.slice(3).every(isPuzzleRef));

  const before = n;
  const full = Array.from({ length: TARGET_POOL }, (_, i) => mine(`m${i}`));
  check('a full pool fetches nothing', (await fillPool(full, ok)).length === TARGET_POOL && n === before);
  check('no mistakes at all stays empty', (await fillPool([], ok)).length === 0);
  check('offline, the round plays what it has',
    (await fillPool(three, async () => null)).length === 3);
  check('a thrown fetch is the same',
    (await fillPool(three, async () => { throw new Error('x'); })).length === 3);
  check('the same puzzle twice counts once',
    (await fillPool(three, async () => puzzle('same'), 50)).length === 4);
  check('a slow network can’t hold the round up',
    (await fillPool(three, () => new Promise<Puzzle>(() => {}), 20)).length === 3);
  return out;
}
