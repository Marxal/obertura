// Pure checks of the daily challenge's two moving parts: the RUNNING ORDER (a
// preference now, optionally handed over to chance) and which LINES today's
// "lines to remember" deals.
//
// Both exist because of the same complaint — the challenge felt identical every
// day. The order was whatever this module happened to list, and the lines were
// "the newest three" whenever nothing was actually due, which on a settled
// repertoire is most days.
//
// No DOM, no localStorage: every function here takes its config and its lines as
// arguments.

import {
  DAILY_TASK_IDS,
  DEFAULT_DAILY_ORDER,
  normaliseOrder,
  orderedDailyTasks,
  activeDailyTasks,
  pickDailyLines,
  nextDailyTask,
  defaultDailyCount,
  type DailyConfig,
  type DailyTaskId,
  type DailyState,
} from './daily-challenge';
import type { Line } from './types';
import type { MoveNode } from './tree';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

function config(over: Partial<DailyConfig> = {}): DailyConfig {
  const tasks = {} as DailyConfig['tasks'];
  for (const id of DAILY_TASK_IDS) tasks[id] = { count: defaultDailyCount(id) };
  return {
    enabled: true,
    tasks,
    order: [...DEFAULT_DAILY_ORDER],
    randomOrder: false,
    ...over,
  };
}

const ALL_AVAILABLE = {
  hasLines: true,
  mistakesAvailable: true,
  detectiveAvailable: true,
  whichMoveAvailable: true,
};

/**
 * A line whose only user move is due `daysUntilDue` from `now` (undefined = a
 * never-trained move, which the scheduler counts as due).
 */
function makeLine(o: {
  id: string;
  daysUntilDue?: number;
  lastTrained?: string | null;
  createdAt?: number;
  now: Date;
}): Line {
  const root: MoveNode = { id: `${o.id}-root`, san: '', uci: '', fen: '', children: [] };
  root.children.push({
    id: `${o.id}-m`, san: 'e4', uci: 'e2e4', fen: '', children: [],
    review: o.daysUntilDue === undefined
      ? { ease: 2.5, interval: 30, reps: 4, lapses: 0, due: new Date(o.now.getTime() + 30 * 86400000) }
      : { ease: 2.5, interval: 1, reps: 1, lapses: 0, due: new Date(o.now.getTime() + o.daysUntilDue * 86400000) },
  });
  return {
    id: o.id, name: o.id, tags: [], colour: 'white', openingName: null,
    confidence: 0, lastTrained: o.lastTrained ?? null, inTraining: true, tree: root,
    createdAt: o.createdAt,
  };
}

export function runDailyChallengeSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail: detail || (pass ? 'ok' : 'failed') });
  };

  // ── normaliseOrder: a stored order is never allowed to lose a part ──────────
  {
    check('the default order holds every part once',
      DEFAULT_DAILY_ORDER.length === DAILY_TASK_IDS.length
        && new Set(DEFAULT_DAILY_ORDER).size === DAILY_TASK_IDS.length);

    check('the shipped order leads with the repertoire',
      DEFAULT_DAILY_ORDER[0] === 'lines' && DEFAULT_DAILY_ORDER[1] === 'positions');

    const partial = normaliseOrder(['puzzles', 'lines']);
    check('a short stored order keeps what it named, first',
      partial[0] === 'puzzles' && partial[1] === 'lines', partial.join(','));
    check('…and gets the missing parts back',
      partial.length === DAILY_TASK_IDS.length
        && new Set(partial).size === DAILY_TASK_IDS.length,
      partial.join(','));

    const junk = normaliseOrder(['puzzles', 'puzzles', 'nonsense', 42]);
    check('duplicates and junk are dropped',
      junk.length === DAILY_TASK_IDS.length && new Set(junk).size === DAILY_TASK_IDS.length,
      junk.join(','));
    check('a missing order falls back to the default',
      normaliseOrder(undefined).join(',') === DEFAULT_DAILY_ORDER.join(','));
  }

  // ── A custom order is followed, and the card and the chain agree ────────────
  {
    const mine: DailyTaskId[] = [
      'puzzles', 'detective', 'lines', 'endgames', 'positions', 'whichMove', 'mistakes',
    ];
    const c = config({ order: mine });
    check('the card follows the stored order',
      orderedDailyTasks(c, '2026-08-25').join(',') === mine.join(','));

    const active = activeDailyTasks(c, ALL_AVAILABLE, '2026-08-25');
    check('the active list is in the same order',
      active.join(',') === mine.join(','), active.join(','));

    // The "Next challenge →" chain walks the active list, so it inherits the
    // order for free — which is the whole reason the two share it.
    const state = { ...blankState(), puzzles: true };
    check('the chain picks the next one in MY order',
      nextDailyTask(state, active) === 'detective');
  }

  // ── A part switched off, or with nothing to deal, drops out ─────────────────
  {
    const c = config();
    c.tasks.puzzles = { count: 0 };
    const active = activeDailyTasks(c, ALL_AVAILABLE, '2026-08-25');
    check('a count of zero is off', !active.includes('puzzles'), active.join(','));

    const noGames = activeDailyTasks(config(), {
      hasLines: true,
      mistakesAvailable: false,
      detectiveAvailable: false,
      whichMoveAvailable: false,
    }, '2026-08-25');
    check('the from-your-games parts need scanned games',
      !noGames.includes('mistakes') && !noGames.includes('detective')
        && !noGames.includes('whichMove'),
      noGames.join(','));
    check('…and the rest are still there, in order',
      noGames.join(',') === 'lines,positions,puzzles,endgames', noGames.join(','));
  }

  // ── Shuffle: different day by day, identical within a day ──────────────────
  {
    const c = config({ randomOrder: true });
    const a = orderedDailyTasks(c, '2026-08-25');
    const b = orderedDailyTasks(c, '2026-08-25');
    check('a shuffled order is fixed for the day', a.join(',') === b.join(','), a.join(','));
    check('…and still holds every part once',
      a.length === DAILY_TASK_IDS.length && new Set(a).size === DAILY_TASK_IDS.length);

    // Over a fortnight the order has to actually move. (It may repeat the
    // default on some day — what would be a bug is never changing at all.)
    const seen = new Set<string>();
    for (let d = 1; d <= 14; d++) {
      seen.add(orderedDailyTasks(c, `2026-09-${String(d).padStart(2, '0')}`).join(','));
    }
    check('the order changes from day to day', seen.size > 1, `${seen.size} distinct in 14 days`);

    // …and the same day always comes back the same, so a card rebuilt mid-run
    // can't rearrange itself.
    check('the same day always shuffles the same way',
      orderedDailyTasks(c, '2026-09-03').join(',')
        === orderedDailyTasks(c, '2026-09-03').join(','));
  }

  // ── pickDailyLines: due first, then the longest unseen ─────────────────────
  {
    const now = new Date('2026-08-25T09:00:00Z');
    const day = (n: number): string => new Date(now.getTime() - n * 86400000).toISOString();

    const due = makeLine({ id: 'due', daysUntilDue: -1, lastTrained: day(9), now });
    const stale = makeLine({ id: 'stale', lastTrained: day(30), now });
    const recent = makeLine({ id: 'recent', lastTrained: day(1), now });
    const never = makeLine({ id: 'never', lastTrained: null, now });

    const picked = pickDailyLines([recent, due, stale, never], 3).map(l => l.id);
    check('a due line always leads', picked[0] === 'due', picked.join(','));
    check('a never-trained line comes before a stale one',
      picked.indexOf('never') < picked.indexOf('stale'), picked.join(','));
    check('the line trained yesterday is last out',
      !picked.includes('recent'), picked.join(','));

    // THE BUG THIS EXISTS FOR: with nothing due, yesterday's three must not be
    // today's three. Training a line stamps it, which is what moves the queue.
    const nothingDue = [recent, stale, never];
    const today = pickDailyLines(nothingDue, 2).map(l => l.id);
    const trained = nothingDue.map(l =>
      today.includes(l.id) ? { ...l, lastTrained: now.toISOString() } : l);
    const tomorrow = pickDailyLines(trained, 2).map(l => l.id);
    check('training today’s lines changes tomorrow’s',
      today.join(',') !== tomorrow.join(','), `${today.join(',')} → ${tomorrow.join(',')}`);

    check('a line out of training is never dealt',
      pickDailyLines([{ ...never, inTraining: false }], 3).length === 0);
    check('a small repertoire deals what it has',
      pickDailyLines([never], 3).length === 1);
  }

  return results;
}

function blankState(): Pick<DailyState, DailyTaskId> {
  return {
    lines: false, positions: false, puzzles: false, endgames: false,
    mistakes: false, detective: false, whichMove: false,
  };
}
