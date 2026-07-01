import { cpToWin, flattenCp, classifyMove } from './winprob';

// Pure checks of the win% model and move classifier — no network, no engine.

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

export function runWinprobSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  // ── cpToWin ────────────────────────────────────────────────────────────────
  check('cpToWin(0) ≈ 0.5', Math.abs(cpToWin(0) - 0.5) < 1e-9, String(cpToWin(0)));
  check('cpToWin is monotonic', cpToWin(100) > cpToWin(0) && cpToWin(0) > cpToWin(-100));
  check('cpToWin(+big) ≈ 1', cpToWin(99900) > 0.999, String(cpToWin(99900)));
  check('cpToWin(-big) ≈ 0', cpToWin(-99900) < 0.001, String(cpToWin(-99900)));

  // ── flattenCp (mate sentinels + sign-flip on negation) ──────────────────────
  check('flattenCp cp passthrough', flattenCp({ cp: 35 }) === 35);
  check('flattenCp empty → null', flattenCp({}) === null);
  const mIn3 = flattenCp({ mate: 3 })!;
  const mAgainst3 = flattenCp({ mate: -3 })!;
  check('flattenCp(mate 3) large positive', mIn3 === 99997, String(mIn3));
  check('flattenCp(mate -3) large negative', mAgainst3 === -99997, String(mAgainst3));
  // Negating a "mate for me" must stay clearly winning for the other side, i.e.
  // negative — the reviewer relies on this to flip child evals.
  check('negate(mate for me) → losing', -mIn3 < -90000, String(-mIn3));

  // ── classifyMove bands (not best, not book) ─────────────────────────────────
  const band = (winLoss: number) =>
    classifyMove({ isBest: false, inBook: false, winLoss, secondBestGap: 0 });
  check('excellent band', band(0.01) === 'excellent', band(0.01));
  check('good band', band(0.03) === 'good', band(0.03));
  check('inaccuracy band', band(0.07) === 'inaccuracy', band(0.07));
  check('mistake band', band(0.15) === 'mistake', band(0.15));
  check('blunder band', band(0.30) === 'blunder', band(0.30));

  // ── best / book ──────────────────────────────────────────────────────────────
  check(
    'best move',
    classifyMove({ isBest: true, inBook: false, winLoss: 0, secondBestGap: 0 }) === 'best',
  );
  check(
    'book beats best',
    classifyMove({ isBest: true, inBook: true, winLoss: 0, secondBestGap: 0 }) === 'book',
  );
  check(
    'book beats great (theory is not a find)',
    classifyMove({ isBest: true, inBook: true, winLoss: 0, secondBestGap: 0.25 }) === 'book',
  );
  check(
    'book never hides a blunder',
    classifyMove({ isBest: false, inBook: true, winLoss: 0.30, secondBestGap: 0 }) === 'blunder',
  );

  // ── great gap ────────────────────────────────────────────────────────────────
  const greatBase = { isBest: true, inBook: false, winLoss: 0, secondBestGap: 0.12 };
  check('great move (best, clearly ahead of the rest)', classifyMove(greatBase) === 'great');
  check(
    'gap just under the bar → best, not great',
    classifyMove({ ...greatBase, secondBestGap: 0.11 }) === 'best',
  );
  check(
    'forced move is never great',
    classifyMove({ ...greatBase, onlyMove: true }) === 'best',
  );
  check(
    'routine recapture is never great',
    classifyMove({ ...greatBase, trivialRecapture: true }) === 'best',
  );
  check(
    'taking hung material is never great',
    classifyMove({ ...greatBase, freeCapture: true }) === 'best',
  );
  check(
    'ignoring the standout move is still a real error',
    classifyMove({ isBest: false, inBook: false, winLoss: 0.30, secondBestGap: 0.25 }) === 'blunder',
  );

  // ── brilliant (sound sacrifice) ──────────────────────────────────────────────
  const sacBase = {
    isBest: true, inBook: false, winLoss: 0, secondBestGap: 0,
    sacrifice: true, playedWin: 0.60, bestWin: 0.60,
  };
  check('sound sacrifice → brilliant', classifyMove(sacBase) === 'brilliant');
  check(
    'brilliant beats great (sac with a wide gap)',
    classifyMove({ ...sacBase, secondBestGap: 0.25 }) === 'brilliant',
  );
  check(
    'sac while losing is not brilliant',
    classifyMove({ ...sacBase, playedWin: 0.30, bestWin: 0.30 }) === 'best',
  );
  check(
    'sac when already crushing is not brilliant',
    classifyMove({ ...sacBase, playedWin: 0.95, bestWin: 0.95 }) === 'best',
  );
  check(
    'forced sac is not brilliant',
    classifyMove({ ...sacBase, onlyMove: true }) === 'best',
  );
  check(
    'book sac reads as theory',
    classifyMove({ ...sacBase, inBook: true }) === 'book',
  );
  check(
    'a sac that is not the top move falls to the bands',
    classifyMove({ ...sacBase, isBest: false, winLoss: 0.01 }) === 'excellent',
  );
  check(
    'no facts → never brilliant',
    classifyMove({ isBest: true, inBook: false, winLoss: 0, secondBestGap: 0 }) === 'best',
  );

  return results;
}
