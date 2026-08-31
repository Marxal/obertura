import {
  expectedScore,
  nextRating,
  rateSolve,
  parSolveMs,
  speedFactor,
  MAX_SPEED_BONUS,
  FAST_FRACTION,
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

  // ── Par time ────────────────────────────────────────────────────────────────
  {
    check('par: a harder puzzle gets longer',
      parSolveMs(2000, 1) > parSolveMs(800, 1),
      `${parSolveMs(800, 1)} → ${parSolveMs(2000, 1)}`);
    check('par: more moves to find gets longer',
      parSolveMs(1200, 3) > parSolveMs(1200, 1));
    check('par: the difficulty allowance is capped at both ends',
      parSolveMs(200, 1) === parSolveMs(600, 1)
        && parSolveMs(2400, 1) === parSolveMs(3000, 1));
    // The numbers a phone actually meets: brisk but not frantic.
    check('par: a one-move 800 is around a quarter-minute',
      parSolveMs(800, 1) >= 12_000 && parSolveMs(800, 1) <= 16_000,
      `${parSolveMs(800, 1)}ms`);
    check('par: a three-move 2000 is under a minute',
      parSolveMs(2000, 3) >= 35_000 && parSolveMs(2000, 3) <= 55_000,
      `${parSolveMs(2000, 3)}ms`);
  }

  // ── The speed factor ────────────────────────────────────────────────────────
  {
    const par = 20_000;
    check('speed: instant is full', speedFactor(0, par) === 1);
    check('speed: anything under the fast line is still full',
      speedFactor(par * FAST_FRACTION * 0.99, par) === 1);
    check('speed: at par it is spent', speedFactor(par, par) === 0);
    check('speed: past par it stays spent', speedFactor(par * 3, par) === 0);
    const half = speedFactor(par * (FAST_FRACTION + (1 - FAST_FRACTION) / 2), par);
    check('speed: halfway between is about half', Math.abs(half - 0.5) < 1e-9, String(half));
    check('speed: it only ever falls',
      (() => {
        let prev = 2;
        for (let ms = 0; ms <= par + 5000; ms += 500) {
          const v = speedFactor(ms, par);
          if (v > prev) return false;
          prev = v;
        }
        return true;
      })());
  }

  // ── The speed bonus: what the whole thing is for ────────────────────────────
  {
    // THE CASE THAT PROMPTED IT. A 900 puzzle at 1600 pays nothing at all —
    // plain Elo says "of course you solved it" — so speed is the only thing
    // left worth measuring, and it pays nearly the whole cap.
    const slowEasy = rateSolve(1600, 900, true, 0);
    const fastEasy = rateSolve(1600, 900, true, 1);
    check('easy puzzle, slow: still worth nothing',
      slowEasy.points === 0, `${slowEasy.points}`);
    check('easy puzzle, fast: worth something at last',
      fastEasy.points >= MAX_SPEED_BONUS - 1, `${fastEasy.points}`);
    check('…and all of it came from the clock',
      fastEasy.bonus === fastEasy.points && fastEasy.base === 0);

    // THE OTHER HALF OF THE PROMISE: a puzzle harder than you pays the same
    // whether you were quick or not.
    const slowHard = rateSolve(1000, 1400, true, 0);
    const fastHard = rateSolve(1000, 1400, true, 1);
    check('a harder puzzle pays a full step either way',
      slowHard.points >= 20 && fastHard.points - slowHard.points <= 1,
      `${slowHard.points} → ${fastHard.points}`);
    check('…because the bonus fades where the base is already big',
      fastHard.bonus < fastEasy.bonus, `${fastHard.bonus} vs ${fastEasy.bonus}`);

    // A miss ignores the clock completely.
    check('a miss is priced the same however fast it was',
      rateSolve(1200, 900, false, 1).points === rateSolve(1200, 900, false, 0).points);
    check('a miss never earns a bonus', rateSolve(1200, 900, false, 1).bonus === 0);
    check('a miss still costs', rateSolve(1200, 900, false, 1).points < 0);

    // Invariants that keep the ladder honest.
    check('the bonus never exceeds its cap',
      rateSolve(3000, 400, true, 1).bonus <= MAX_SPEED_BONUS);
    check('speed can never take points away',
      (() => {
        for (let u = 600; u <= 2400; u += 200) {
          for (let p = 400; p <= 2600; p += 200) {
            if (rateSolve(u, p, true, 1).points < rateSolve(u, p, true, 0).points) return false;
          }
        }
        return true;
      })());
    check('a fast solve never out-earns beating something hard',
      rateSolve(1000, 600, true, 1).points < rateSolve(1000, 1400, true, 0).points,
      `${rateSolve(1000, 600, true, 1).points} vs ${rateSolve(1000, 1400, true, 0).points}`);
    check('base + bonus is exactly the change',
      (() => {
        const c = rateSolve(1100, 1000, true, 0.6);
        return c.base + c.bonus === c.points && c.next === 1100 + c.points;
      })());
    // Nothing about the plain path moved: every caller with no clock to report
    // gets exactly the number it always got.
    check('nextRating still agrees with the unclocked score',
      nextRating(1234, 1500, true) === rateSolve(1234, 1500, true).next
        && nextRating(1234, 1500, false) === rateSolve(1234, 1500, false).next);
  }

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
