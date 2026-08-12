import type { Line } from './types';
import type { MoveNode } from './tree';
import {
  newReview,
  gradeReview,
  qualityFromMisses,
  isReviewDue,
  dueLines,
  lineIsDue,
  linePriority,
  lineSpacing,
  PRIORITY_SPACING,
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

  // 10. A session walks each line once, then ends — no resurfacing.
  const session = new TrainingSession([dueLine, restedLine], { explicit: true });
  const startCount = session.initialCount;
  const walked: string[] = [];
  for (let item = session.next(); item; item = session.next()) walked.push(item.line.id);
  check(
    'session yields each line once, then ends',
    startCount === 2 && walked.length === 2 && walked[0] === 'L' && walked[1] === 'R' && session.isEmpty(),
    `walked: [${walked.join(', ')}]`
  );

  // 11. Priority defaults to standard, including for lines saved before the
  //     field existed (and for a junk value that survived a bad sync).
  const plain = makeLine([1], now);
  const bogus = makeLine([1], now);
  (bogus as { priority?: string }).priority = 'urgent';
  const high = makeLine([1], now);
  high.priority = 'high';
  check(
    'priority defaults to standard, and only known values are honoured',
    linePriority(plain) === 'standard'
      && linePriority(bogus) === 'standard'
      && linePriority(high) === 'high'
      && lineSpacing(high) === PRIORITY_SPACING.high,
    `plain=${linePriority(plain)} bogus=${linePriority(bogus)} high=${linePriority(high)}`
  );

  // 12. Priority scales the WAIT, not the stored interval — the whole point of
  //     applying it to the due date. A high-priority move on a 30-day rung is
  //     due in 18 days but still records 30, so the Learning/Solid buckets
  //     (which read `interval`) are untouched by a scheduling preference.
  const settled = { ease: 2.5, interval: 12, reps: 3, lapses: 0, due: now };
  const std = gradeReview(settled, 5, now, PRIORITY_SPACING.standard);
  const hi = gradeReview(settled, 5, now, PRIORITY_SPACING.high);
  const lo = gradeReview(settled, 5, now, PRIORITY_SPACING.low);
  const days = (r: { due: Date }) => (r.due.getTime() - now.getTime()) / 86400000;
  check(
    'priority scales the wait and leaves the SM-2 interval alone',
    std.interval === hi.interval && hi.interval === lo.interval
      && Math.abs(days(hi) - days(std) * PRIORITY_SPACING.high) < 1e-6
      && Math.abs(days(lo) - days(std) * PRIORITY_SPACING.low) < 1e-6
      && days(hi) < days(std) && days(std) < days(lo),
    `interval=${std.interval} · waits high=${days(hi).toFixed(1)}d std=${days(std).toFixed(1)}d low=${days(lo).toFixed(1)}d`
  );

  // 13. Repeated gradings must not COMPOUND the multiplier — the bug that made
  //     the obvious "scale the interval" implementation unusable. After five
  //     clean reps a high-priority move's wait is still exactly 0.6× the
  //     standard one's, not 0.6^5 of it.
  let hiChain = newReview(now);
  let stdChain = newReview(now);
  for (let i = 0; i < 5; i++) {
    hiChain = gradeReview(hiChain, 5, now, PRIORITY_SPACING.high);
    stdChain = gradeReview(stdChain, 5, now, PRIORITY_SPACING.standard);
  }
  check(
    'the priority multiplier does not compound across reps',
    hiChain.interval === stdChain.interval
      && Math.abs(days(hiChain) / days(stdChain) - PRIORITY_SPACING.high) < 1e-6,
    `after 5 reps: interval=${stdChain.interval} ratio=${(days(hiChain) / days(stdChain)).toFixed(3)}`
  );

  // 14. Due lines lead with the high-priority ones, and keep their input order
  //     inside a band.
  const a = makeLine([-1], now); a.id = 'A';
  const b = makeLine([-1], now); b.id = 'B'; b.priority = 'low';
  const c = makeLine([-1], now); c.id = 'C'; c.priority = 'high';
  const d = makeLine([-1], now); d.id = 'D';
  const ordered = dueLines([a, b, c, d], now).map(l => l.id).join('');
  check(
    'due lines are ordered high → standard → low, stable within a band',
    ordered === 'CADB',
    `order: ${ordered}`
  );

  return results;
}
