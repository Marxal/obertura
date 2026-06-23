import {
  expectedScore,
  nextRating,
  difficultyForRating,
  difficultyForStreak,
} from './puzzle-rating';

// Runnable checks for the puzzle rating Elo maths and the adaptive-difficulty
// ramps — the pure pieces only, in the same zero-framework style as the other
// suites. The localStorage-backed commit/history isn't exercised here (it's
// phone-only, like the storage suite).

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

export function runPuzzleRatingSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  // ── expectedScore ───────────────────────────────────────────────────────────
  check('expected: equal rating ≈ 0.5', Math.abs(expectedScore(1000, 1000) - 0.5) < 1e-9);
  check('expected: stronger user > 0.5', expectedScore(1400, 1000) > 0.5);
  check('expected: weaker user < 0.5', expectedScore(1000, 1400) < 0.5);
  check(
    'expected: symmetric around 0.5',
    Math.abs(expectedScore(1200, 1000) + expectedScore(1000, 1200) - 1) < 1e-9,
  );

  // ── nextRating ──────────────────────────────────────────────────────────────
  const solveEqual = nextRating(1000, 1000, true);
  const failEqual = nextRating(1000, 1000, false);
  check('next: solving an equal puzzle gains', solveEqual > 1000, `got ${solveEqual}`);
  check('next: failing an equal puzzle loses', failEqual < 1000, `got ${failEqual}`);

  // Beating a HARDER puzzle is worth more than beating an easier one.
  const beatHard = nextRating(1000, 1400, true) - 1000;
  const beatEasy = nextRating(1000, 600, true) - 1000;
  check('next: beating a harder puzzle gains more', beatHard > beatEasy, `hard ${beatHard} vs easy ${beatEasy}`);

  // Missing an EASY puzzle costs more than missing a hard one.
  const missEasy = 1000 - nextRating(1000, 600, false);
  const missHard = 1000 - nextRating(1000, 1400, false);
  check('next: missing an easy puzzle costs more', missEasy > missHard, `easy ${missEasy} vs hard ${missHard}`);

  // A hinted / second-try solve scores as a loss (solvedFirstTry = false).
  check('next: hinted solve is treated as a loss', nextRating(1000, 1000, false) < 1000);

  // ── Adaptive difficulty ramps ─────────────────────────────────────────────────
  check('difficultyForRating: low → easiest', difficultyForRating(700) === 'easiest');
  check('difficultyForRating: mid → normal', difficultyForRating(1300) === 'normal');
  check('difficultyForRating: high → hardest', difficultyForRating(2100) === 'hardest');

  check('difficultyForStreak: start → easiest', difficultyForStreak(0) === 'easiest');
  check('difficultyForStreak: ramps to hardest', difficultyForStreak(12) === 'hardest');
  check(
    'difficultyForStreak: monotonic non-decreasing',
    (() => {
      const order = ['easiest', 'easier', 'normal', 'harder', 'hardest'];
      let prev = -1;
      for (let n = 0; n <= 14; n++) {
        const idx = order.indexOf(difficultyForStreak(n));
        if (idx < prev) return false;
        prev = idx;
      }
      return true;
    })(),
  );

  return results;
}
