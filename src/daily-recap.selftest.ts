// Pure checks of the daily-challenge recap maths — no DOM, no storage. Feeds
// buildRecap synthetic day logs and checks the comparison day, the delta, the
// perfect-day rule, the best-streak search and the eligibility bar for the
// promotion popup.

import {
  accuracyOf,
  buildRecap,
  formatDayLabel,
  isPerfectDay,
  logUpTo,
  longestStreak,
  recapMessage,
  streakEndingOn,
  type DailyDayResult,
} from './daily-recap';
import {
  perfectDayEligible,
  DAILY_TASK_IDS,
  type DailyConfig,
  type DailyTaskId,
} from './daily-challenge';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

function day(d: string, right: number, wrong: number, done = true): DailyDayResult {
  return { day: d, right, wrong, tasks: 3, done };
}

// A config with every task at `count`, so the eligibility bar can be poked.
function config(count: number, only?: DailyTaskId[]): DailyConfig {
  const tasks = {} as DailyConfig['tasks'];
  for (const id of DAILY_TASK_IDS) tasks[id] = { count: only && !only.includes(id) ? 0 : count };
  return { enabled: true, tasks };
}

function recapFor(log: DailyDayResult[], today = '2026-08-14', extra: Partial<{
  streak: number; trainingDays: string[]; linesMastered: number; linesInTraining: number;
}> = {}) {
  return buildRecap({
    log,
    today,
    streak: extra.streak ?? 1,
    trainingDays: extra.trainingDays ?? [today],
    linesMastered: extra.linesMastered ?? 0,
    linesInTraining: extra.linesInTraining ?? 0,
  });
}

export function runDailyRecapSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  // ── accuracyOf ──────────────────────────────────────────────────────────────
  check('accuracy of nothing is 0', accuracyOf(0, 0) === 0);
  check('accuracy of a clean run is 100', accuracyOf(9, 0) === 100);
  check('accuracy rounds', accuracyOf(2, 1) === 67, String(accuracyOf(2, 1)));

  // ── longestStreak ───────────────────────────────────────────────────────────
  check('empty streak is 0', longestStreak([]) === 0);
  check('single day is 1', longestStreak(['2026-08-14']) === 1);
  check('consecutive days join up',
    longestStreak(['2026-08-12', '2026-08-13', '2026-08-14']) === 3);
  check('a gap breaks the run',
    longestStreak(['2026-08-10', '2026-08-12', '2026-08-13', '2026-08-14']) === 3);
  check('the longest run wins, not the latest',
    longestStreak(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-14']) === 4);
  check('a run across a month boundary holds',
    longestStreak(['2026-07-30', '2026-07-31', '2026-08-01']) === 3);
  check('unordered input is fine',
    longestStreak(['2026-08-14', '2026-08-12', '2026-08-13']) === 3);

  // ── The comparison day ──────────────────────────────────────────────────────
  const withYesterday = recapFor([day('2026-08-13', 17, 3), day('2026-08-14', 19, 1)]);
  check('yesterday is picked as the comparison', withYesterday.compare?.day === '2026-08-13');
  check('yesterday is flagged as yesterday', withYesterday.compare?.isYesterday === true);
  check('accuracy is today\'s', withYesterday.accuracy === 95, String(withYesterday.accuracy));
  check('delta is today minus the comparison',
    withYesterday.delta === 95 - 85, String(withYesterday.delta));

  const withGap = recapFor([day('2026-08-09', 10, 10), day('2026-08-14', 15, 5)]);
  check('a missing yesterday falls back to the last logged day',
    withGap.compare?.day === '2026-08-09');
  check('the fallback is not called yesterday', withGap.compare?.isYesterday === false);

  const firstEver = recapFor([day('2026-08-14', 12, 0)]);
  check('the first logged day has nothing to compare', firstEver.compare === null);
  check('no comparison means no delta', firstEver.delta === null);

  const emptyEarlier = recapFor([day('2026-08-13', 0, 0), day('2026-08-14', 8, 2)]);
  check('a day with no moves is skipped as a comparison', emptyEarlier.compare === null);

  // ── Today's totals + the perfect flag ───────────────────────────────────────
  check('totals add up', withYesterday.total === 20, String(withYesterday.total));
  check('a clean day is perfect', firstEver.perfect === true);
  check('one miss is not perfect', withYesterday.perfect === false);
  const nothingDone = recapFor([]);
  check('an empty day is not perfect', nothingDone.perfect === false);
  check('an empty day scores 0', nothingDone.accuracy === 0);

  // ── Tallies ─────────────────────────────────────────────────────────────────
  const tallies = recapFor([
    day('2026-08-11', 10, 0),
    day('2026-08-12', 8, 2),
    day('2026-08-13', 9, 0, false), // cleanly played, but never finished
    day('2026-08-14', 12, 0),
  ]);
  check('completed challenges are counted', tallies.challengesDone === 3, String(tallies.challengesDone));
  check('perfect days need the challenge finished',
    tallies.perfectDays === 2, String(tallies.perfectDays));
  check('an unfinished clean day is not perfect',
    !isPerfectDay(day('2026-08-13', 9, 0, false)));

  // ── Streaks ─────────────────────────────────────────────────────────────────
  const best = recapFor([day('2026-08-14', 5, 0)], '2026-08-14', {
    streak: 3,
    trainingDays: ['2026-08-12', '2026-08-13', '2026-08-14'],
  });
  check('a matching run reads as a personal best', best.streakIsBest === true);
  check('the best streak is the longest run', best.bestStreak === 3, String(best.bestStreak));

  const notBest = recapFor([day('2026-08-14', 5, 0)], '2026-08-14', {
    streak: 2,
    trainingDays: ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-13', '2026-08-14'],
  });
  check('a shorter run is not a best', notBest.streakIsBest === false);
  check('the old best survives', notBest.bestStreak === 4, String(notBest.bestStreak));

  const oneDay = recapFor([day('2026-08-14', 5, 0)], '2026-08-14', {
    streak: 1, trainingDays: ['2026-08-14'],
  });
  check('a one-day streak is never crowned', oneDay.streakIsBest === false);

  // ── The message ─────────────────────────────────────────────────────────────
  check('a first day gets its own line', recapMessage(firstEver).includes('First one'));
  check('a big jump gets the bigger line', recapMessage(withYesterday).includes('big step up'));
  check('a small improvement is called out',
    recapMessage(recapFor([day('2026-08-13', 18, 2), day('2026-08-14', 19, 1)])).includes('Sharper'));
  check('a steady day is called steady',
    recapMessage(recapFor([day('2026-08-13', 9, 1), day('2026-08-14', 18, 2)])).includes('steady'));
  check('a personal best leads', recapMessage(best).includes('longest run'));

  // ── Perfect-day eligibility ─────────────────────────────────────────────────
  const three: DailyTaskId[] = ['lines', 'positions', 'puzzles'];
  check('three tasks of two qualify', perfectDayEligible(config(2), three));
  check('three tasks of three qualify', perfectDayEligible(config(3), three));
  check('two tasks never qualify', !perfectDayEligible(config(3), ['lines', 'puzzles']));
  check('a task set to one disqualifies the day', !perfectDayEligible(config(1), three));
  check('one thin task among three disqualifies the day', !perfectDayEligible(
    { enabled: true, tasks: { ...config(3).tasks, puzzles: { count: 1 } } }, three));
  check('all five at two qualify', perfectDayEligible(config(2), [...DAILY_TASK_IDS]));

  // ── Reopening a past day (daily-review.ts's maths) ──────────────────────────
  //
  // A day tapped in the calendar has to read as it did THEN, not as things stand
  // now: the streak counted back to that day, and every all-time tally taken off
  // the log truncated at it.

  const days = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-14'];
  check('a streak ends on the day asked about', streakEndingOn(days, '2026-08-12') === 3);
  check('a gap breaks the run', streakEndingOn(days, '2026-08-14') === 1);
  check('a day never trained has no streak', streakEndingOn(days, '2026-08-13') === 0);
  check('an empty history has no streak', streakEndingOn([], '2026-08-12') === 0);

  const full = [day('2026-08-12', 8, 2), day('2026-08-13', 9, 1), day('2026-08-14', 10, 0)];
  check('the log truncates inclusively', logUpTo(full, '2026-08-13').length === 2);
  const truncated = logUpTo(full, '2026-08-13');
  check('truncating keeps the day asked for',
    truncated[truncated.length - 1]?.day === '2026-08-13');
  check('truncating before everything gives nothing',
    logUpTo(full, '2026-08-01').length === 0);

  // The replayed recap: same shape, but measured on the day it names.
  const past = buildRecap({
    log: logUpTo(full, '2026-08-13'),
    today: '2026-08-13',
    streak: streakEndingOn(['2026-08-12', '2026-08-13'], '2026-08-13'),
    trainingDays: ['2026-08-12', '2026-08-13'],
    linesMastered: 2,
    linesInTraining: 5,
    replay: true,
  });
  check('a replay names its day', past.day === '2026-08-13');
  check('a replay is flagged as one', past.replay);
  check('a replay scores its own day', past.accuracy === 90, String(past.accuracy));
  check('a replay compares with the day before it', past.compare?.day === '2026-08-12');
  check('a replay counts only the challenges up to it', past.challengesDone === 2);
  check('a later day is invisible to a replay', past.right === 9 && past.wrong === 1);

  // …and a live recap still isn't a replay.
  check('a finished day is not a replay', !recapFor([day('2026-08-14', 10, 0)]).replay);
  check('a finished day names today', recapFor([day('2026-08-14', 10, 0)]).day === '2026-08-14');

  // ── formatDayLabel ──────────────────────────────────────────────────────────
  const now = new Date(2026, 7, 14);
  check('today is named today', formatDayLabel('2026-08-14', now) === 'Today');
  check('yesterday is named yesterday', formatDayLabel('2026-08-13', now) === 'Yesterday');
  check('older days get a date', /\d/.test(formatDayLabel('2026-08-02', now))
    && formatDayLabel('2026-08-02', now) !== 'Today');
  check('a malformed key comes back unchanged', formatDayLabel('nonsense', now) === 'nonsense');

  return results;
}
