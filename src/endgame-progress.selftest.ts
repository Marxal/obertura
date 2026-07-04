import { foldResult } from './endgame-progress';

// Checks the pure play-out reducer: attempts increment, solved latches, lastTrained
// stamps. The localStorage-backed load/save isn't exercised here (phone-only, like
// the other storage suites).

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

export function runEndgameProgressSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  // First failed attempt: counts, not solved.
  const a = foldResult(undefined, false, 1000);
  check('first miss: attempts 1', a.attempts === 1, `got ${a.attempts}`);
  check('first miss: not solved', a.solved === false);
  check('first miss: stamps time', a.lastTrained === 1000);

  // A clean attempt solves it.
  const b = foldResult(a, true, 2000);
  check('clean: attempts 2', b.attempts === 2, `got ${b.attempts}`);
  check('clean: now solved', b.solved === true);
  check('clean: re-stamps time', b.lastTrained === 2000);

  // Solved latches even after a later miss.
  const c = foldResult(b, false, 3000);
  check('solved latches through a later miss', c.solved === true);
  check('later miss still counts', c.attempts === 3, `got ${c.attempts}`);

  // Best time: a successful solve records its elapsed; a miss records nothing.
  const t1 = foldResult(undefined, true, 1000, 40_000);
  check('first solve sets bestMs', t1.bestMs === 40_000, `got ${t1.bestMs}`);
  const miss = foldResult(undefined, false, 1000, 5_000);
  check('a miss never sets bestMs', miss.bestMs === undefined, `got ${miss.bestMs}`);

  // A slower later solve leaves the best alone; a faster one lowers it.
  const t2 = foldResult(t1, true, 2000, 55_000);
  check('slower solve keeps the old best', t2.bestMs === 40_000, `got ${t2.bestMs}`);
  const t3 = foldResult(t2, true, 3000, 22_500);
  check('faster solve lowers the best', t3.bestMs === 22_500, `got ${t3.bestMs}`);

  // A later miss can't erase or worsen an existing best.
  const t4 = foldResult(t3, false, 4000, 1_000);
  check('a miss keeps the standing best', t4.bestMs === 22_500, `got ${t4.bestMs}`);

  return results;
}
