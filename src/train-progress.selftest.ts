// The Train screen's pure readouts: the Today strip's week and a rated door's
// progress toward the next hundred.

import type { TestResult } from './selftest-panel';
import { lastSevenDays, ratingProgress } from './train-progress';

export function runTrainProgressSelfTest(): TestResult[] {
  const out: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) => out.push({ name, pass, detail });

  // Thursday 24 September 2026, local noon.
  const now = new Date(2026, 8, 24, 12);
  const week = lastSevenDays(new Set(['2026-09-24', '2026-09-20', '2026-09-01']), now);
  check('seven days, oldest first, ending today',
    week.length === 7 && week[0].key === '2026-09-18' && week[6].key === '2026-09-24' && week[6].today,
    JSON.stringify(week.map(d => d.key)));
  check('only today is marked today', week.filter(d => d.today).length === 1, '');
  check('trained days inside the week are on, one outside is ignored',
    week.filter(d => d.trained).map(d => d.key).join() === '2026-09-20,2026-09-24',
    JSON.stringify(week.filter(d => d.trained)));
  check('weekday initials line up', week[6].initial === 'T' && week[2].initial === 'S',
    week.map(d => d.initial).join(''));

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
