import { winPercentFromCp, moveAccuracyPercent, gameAccuracy } from './accuracy';

// Pure checks of the Lichess-model accuracy maths — no network, no DOM.

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

export function runAccuracySelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  // ── winPercentFromCp ─────────────────────────────────────────────────────────
  check('win%(0) = 50', Math.abs(winPercentFromCp(0) - 50) < 1e-9, String(winPercentFromCp(0)));
  check(
    'win% is monotonic',
    winPercentFromCp(100) > winPercentFromCp(0) && winPercentFromCp(0) > winPercentFromCp(-100),
  );
  check('win%(+huge) ≈ 100', winPercentFromCp(99900) > 99.9, String(winPercentFromCp(99900)));

  // ── moveAccuracyPercent ──────────────────────────────────────────────────────
  const noDrop = moveAccuracyPercent(50, 50);
  check('no drop ≈ 100', noDrop > 99.9 && noDrop <= 100, String(noDrop));
  check('improving is also ≈ 100', moveAccuracyPercent(40, 60) > 99.9);
  check(
    'accuracy decays with the drop',
    moveAccuracyPercent(60, 55) > moveAccuracyPercent(60, 40) &&
      moveAccuracyPercent(60, 40) > moveAccuracyPercent(60, 10),
  );
  check('a total collapse ≈ 0', moveAccuracyPercent(100, 0) < 1, String(moveAccuracyPercent(100, 0)));

  // ── gameAccuracy ─────────────────────────────────────────────────────────────
  check('no evals → nulls', JSON.stringify(gameAccuracy([])) === '{"white":null,"black":null}');

  // A flat, error-free game: both sides near 100.
  const flat = gameAccuracy([0, 0, 0, 0, 0, 0]);
  check(
    'flat game → both ≈ 100',
    flat.white !== null && flat.white > 95 && flat.black !== null && flat.black > 95,
    JSON.stringify(flat),
  );

  // White keeps losing ground on their own moves; Black just keeps the eval.
  const whiteSlips = gameAccuracy([-150, -150, -300, -300, -450, -450]);
  check(
    'the side that slips scores lower',
    whiteSlips.white !== null && whiteSlips.black !== null && whiteSlips.white < whiteSlips.black,
    JSON.stringify(whiteSlips),
  );
  check(
    'slipping side is well below 100',
    whiteSlips.white !== null && whiteSlips.white < 90,
    JSON.stringify(whiteSlips),
  );

  // A gap (un-reviewed ply) breaks the chain but doesn't poison the rest.
  const gappy = gameAccuracy([0, undefined, 0, 0]);
  check(
    'gap skips only the unscoreable moves',
    gappy.white !== null && gappy.black !== null,
    JSON.stringify(gappy),
  );

  // Only one side has scoreable moves → the other is null.
  const oneSided = gameAccuracy([0]);
  check(
    'single ply → white only',
    oneSided.white !== null && oneSided.black === null,
    JSON.stringify(oneSided),
  );

  return results;
}
