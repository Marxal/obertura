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

  return results;
}
