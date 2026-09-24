// A rated door's progress toward the next hundred.

import type { TestResult } from './selftest-panel';
import { ratingProgress } from './train-progress';

export function runTrainProgressSelfTest(): TestResult[] {
  const out: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) => out.push({ name, pass, detail });

  const mid = ratingProgress(1437);
  check('1437 is 37 of the way to 1500', mid.value === 37 && mid.max === 100 && mid.label === '63 pts to 1500',
    JSON.stringify(mid));
  const flat = ratingProgress(1000);
  check('a round rating has the whole next hundred to go', flat.value === 0 && flat.label === '100 pts to 1100',
    JSON.stringify(flat));
  check('a fractional rating rounds', ratingProgress(1499.6).label === '100 pts to 1600',
    JSON.stringify(ratingProgress(1499.6)));
  check('never negative', ratingProgress(-20).value === 0, JSON.stringify(ratingProgress(-20)));
  return out;
}
