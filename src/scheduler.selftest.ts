import type { Line } from './types';
import type { MoveNode } from './tree';
import {
  newReview,
  gradeReview,
  qualityFromMisses,
  isReviewDue,
  resurfaceGap,
  dueLines,
  lineIsDue,
  MIN_EASE,
} from './scheduler';
import { TrainingSession } from './session';

// ── A runnable check of the scheduling brain ────────────────────────────────────
//
// No test framework (zero budget, no dev deps). This is a plain function that
// asserts the scheduler's behaviour and returns a pass/fail list. The Train
// screen has a "Run scheduler self-test" link at the bottom that calls this and
// shows the results — so the maths can be verified right on the phone.

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

function makeLine(reviews: (number | undefined)[], now: Date): Line {
  // Build a 2-ply-per-user-move mainline so `reviews[i]` lands on the i-th
  // White (user) move. Opponent replies get no review. Due dates are offset from
  // the test's fixed `now` (not the wall clock) so the checks are deterministic
  // whatever day they're run.
  const root: MoveNode = { id: 'root', san: '', uci: '', fen: '', children: [] };
  let cursor = root;
  reviews.forEach((daysUntilDue, i) => {
    const userMove: MoveNode = {
      id: `u${i}`, san: 'e4', uci: 'e2e4', fen: '', children: [],
      review: daysUntilDue === undefined
        ? undefined
        : { ease: 2.5, interval: 1, reps: 1, lapses: 0, due: new Date(now.getTime() + daysUntilDue * 86400000) },
    };
    const reply: MoveNode = { id: `o${i}`, san: 'e5', uci: 'e7e5', fen: '', children: [] };
    cursor.children.push(userMove);
    userMove.children.push(reply);
    cursor = reply;
  });
  return {
    id: 'L', name: 'Test', tags: [], colour: 'white', openingName: null,
    confidence: 0, lastTrained: null, inTraining: true, tree: root,
  };
}

export function runSchedulerSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const now = new Date('2026-06-07T12:00:00Z');
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // 1. A fresh, never-trained move is due immediately.
  check(
    'fresh move is due now',
    isReviewDue(undefined, now) === true,
    'undefined review → due'
  );

  // 2. Clean reps grow the interval 1 → 6 → ~15 days.
  let r = newReview(now);
  r = gradeReview(r, qualityFromMisses(0), now); // 1st clean
  const i1 = r.interval;
  r = gradeReview(r, qualityFromMisses(0), now); // 2nd clean
  const i2 = r.interval;
  r = gradeReview(r, qualityFromMisses(0), now); // 3rd clean
  const i3 = r.interval;
  check(
    'clean reps grow interval (1 → 6 → larger)',
    i1 === 1 && i2 === 6 && i3 > i2,
    `intervals: ${i1}, ${i2}, ${i3}`
  );

  // 3. A mastered move (after several clean reps) is NOT due now.
  check(
    'mastered move fades (due in the future)',
    isReviewDue(r, now) === false && r.interval >= 6,
    `interval ${r.interval}d, due ${r.due.toISOString().slice(0, 10)}`
  );

  // 4. A miss resets the move: interval back to 1, reps 0, +1 lapse.
  const beforeLapses = r.lapses;
  const missed = gradeReview(r, qualityFromMisses(1), now);
  check(
    'a miss returns the move sooner (interval → 1, +1 lapse)',
    missed.interval === 1 && missed.reps === 0 && missed.lapses === beforeLapses + 1,
    `interval ${missed.interval}d, reps ${missed.reps}, lapses ${missed.lapses}`
  );

  // 5. A missed move IS due in the next session (within ~1 day).
  const tomorrow = new Date(now.getTime() + 25 * 3600 * 1000);
  check(
    'missed move is due next session',
    isReviewDue(missed, tomorrow) === true,
    `due ${missed.due.toISOString().slice(0, 10)}, checked next day`
  );

  // 6. Repeated misses drag ease toward (never below) the floor.
  let e = newReview(now);
  for (let n = 0; n < 12; n++) e = gradeReview(e, qualityFromMisses(2), now);
  check(
    'ease floors at 1.3, never lower',
    e.ease >= MIN_EASE - 1e-9 && Math.abs(e.ease - MIN_EASE) < 1e-9,
    `ease after 12 bad misses: ${e.ease.toFixed(2)}`
  );

  // 7. Worse recall lowers ease more than a single miss.
  const oneMiss = gradeReview(newReview(now), qualityFromMisses(1), now).ease;
  const badMiss = gradeReview(newReview(now), qualityFromMisses(2), now).ease;
  check(
    'more misses cost more ease',
    badMiss < oneMiss,
    `1 miss → ${oneMiss.toFixed(2)} ease, repeated → ${badMiss.toFixed(2)} ease`
  );

  // 8. Resurface gap is in 3–8 and shrinks as misses grow.
  const g1 = resurfaceGap(1), g2 = resurfaceGap(2), g4 = resurfaceGap(4), g9 = resurfaceGap(9);
  check(
    'resurface gap is 3–8 and tightens with misses',
    g1 === 8 && g2 < g1 && g4 <= g2 && g9 >= 3 && g1 <= 8,
    `gaps: 1→${g1}, 2→${g2}, 4→${g4}, 9→${g9}`
  );

  // 9. dueLines / lineIsDue: a line with one overdue move is due; a line whose
  //    moves are all far in the future is not.
  const dueLine = makeLine([-1, 10], now);   // first user move overdue by a day
  const restedLine = makeLine([20, 30], now); // both far in the future
  restedLine.id = 'R';
  const due = dueLines([dueLine, restedLine], now);
  check(
    'due line = any line with a due move',
    lineIsDue(dueLine, now) === true &&
      lineIsDue(restedLine, now) === false &&
      due.length === 1 && due[0].id === 'L',
    `due lines: [${due.map(l => l.id).join(', ')}]`
  );

  // 10. Session resurfacing: a missed line comes back later, then stops at the cap.
  const session = new TrainingSession([dueLine], { now, explicit: true, maxResurface: 2 });
  const first = session.next();
  const reA = session.resurface(dueLine, 1); // 1st resurface (allowed)
  const requeuedLen = session.remaining;
  session.next();
  const reB = session.resurface(dueLine, 1); // 2nd resurface (allowed)
  session.next();
  const reC = session.resurface(dueLine, 1); // 3rd (over cap → refused)
  check(
    'missed line resurfaces, capped so the session ends',
    first?.line.id === 'L' && reA === true && requeuedLen === 1 && reB === true && reC === false,
    `requeued=${reA}/${reB}, over-cap refused=${!reC}`
  );

  return results;
}
