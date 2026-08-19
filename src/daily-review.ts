// Looking BACK at a daily challenge — the one place that turns a day in the log
// into the same popup the day itself ended on.
//
// WHY IT EXISTS. The completion popup carries the only reading of "how did that
// go" the app produces: the day's accuracy, how it compares with the last one,
// the streak, the tally. It appeared once, and a tap anywhere dismissed it — so
// the figures were gone until tomorrow, and the calendar under the streak hero
// was a grid of "trained / didn't", which says nothing about how it went.
//
// So the popup is now reopenable, from three places, all of them going through
// here so they cannot drift apart:
//   · the Train card, once the day is cleared ("Daily challenge done ✓"),
//   · a day in the 7-day strip on Statistics,
//   · a day in the month calendar.
//
// WHAT A REOPENED RECAP SAYS. Everything is recomputed AS OF that day rather
// than as of now: the streak is counted back out of the training-days set, and
// the all-time tallies read the log truncated at that day (see logUpTo). The two
// figures that genuinely cannot be reconstructed — how much of the repertoire
// was solid then — are the current ones, which is why the popup dates itself
// when it is a replay rather than pretending to be about today.
//
// No day in the log = nothing to show. The callers ask `dayPerformance` first
// and simply don't offer a tap on a day with nothing behind it.

import type { Line } from './types';
import { masteredLines } from './stats';
import { getTrainingDays } from './streak';
import { getAllLines } from './storage';
import {
  accuracyOf, buildRecap, getDailyLog, isPerfectDay, logUpTo, streakEndingOn,
  type DailyDayResult, type Recap,
} from './daily-recap';
import { showDailyCelebration, showPerfectDayCelebration } from './daily-celebration';

/** What a calendar cell needs to colour itself. */
export interface DayPerformance {
  day: string;
  right: number;
  wrong: number;
  total: number;
  accuracy: number;   // 0–100
  done: boolean;      // the whole challenge was cleared that day
  perfect: boolean;   // cleared without a single miss
}

function toPerformance(row: DailyDayResult): DayPerformance {
  return {
    day: row.day,
    right: row.right,
    wrong: row.wrong,
    total: row.right + row.wrong,
    accuracy: accuracyOf(row.right, row.wrong),
    done: row.done,
    perfect: isPerfectDay(row),
  };
}

/**
 * Every logged day, keyed by "YYYY-MM-DD" — read once per render rather than
 * once per calendar cell.
 */
export function dailyPerformanceByDay(): Map<string, DayPerformance> {
  const out = new Map<string, DayPerformance>();
  for (const row of getDailyLog()) {
    // A day with nothing answered has no performance to show; it may still be a
    // training day, which the cell's own "trained" mark already covers.
    if (row.right + row.wrong === 0 && !row.done) continue;
    out.set(row.day, toPerformance(row));
  }
  return out;
}

/**
 * The banding the calendars colour by. Deliberately coarse — three steps and a
 * flat "nothing recorded" — because a per-percent gradient over a 20px square
 * is a colour nobody can read back into a number.
 */
export type PerformanceBand = 'none' | 'low' | 'mid' | 'high' | 'perfect';

export const PERFORMANCE_MID = 70;
export const PERFORMANCE_HIGH = 90;

export function performanceBand(p: DayPerformance | undefined): PerformanceBand {
  if (!p || p.total === 0) return 'none';
  if (p.perfect) return 'perfect';
  if (p.accuracy >= PERFORMANCE_HIGH) return 'high';
  if (p.accuracy >= PERFORMANCE_MID) return 'mid';
  return 'low';
}

/**
 * Build the recap for any logged day. `lines` are the CURRENT saved lines (the
 * only repertoire figures that exist); everything else is reconstructed as of
 * `day`. Returns null when nothing was recorded that day.
 */
export function recapForDay(day: string, lines: Line[], today: string): Recap | null {
  const log = getDailyLog();
  const row = log.find((r) => r.day === day);
  if (!row || (row.right + row.wrong === 0 && !row.done)) return null;

  const training = lines.filter((l) => l.inTraining);
  const trainingDays = getTrainingDays();
  return buildRecap({
    log: logUpTo(log, day),
    today: day,
    streak: streakEndingOn(trainingDays, day),
    trainingDays: trainingDays.filter((d) => d <= day),
    linesMastered: masteredLines(training).length,
    linesInTraining: training.length,
    replay: day !== today,
  });
}

/**
 * Reopen a day's popup. The perfect-day variant is shown for a day that really
 * was perfect, so looking back at one is the same event as living it.
 *
 * Reads the lines itself so every caller is one line; hand it `lines` when you
 * already have them (the Train card does) to save the round trip.
 */
export async function showRecapForDay(
  day: string, today: string, lines?: Line[],
): Promise<void> {
  const all = lines ?? await getAllLines().catch(() => [] as Line[]);
  const recap = recapForDay(day, all, today);
  if (!recap) return;
  if (recap.perfect && recap.total > 0) showPerfectDayCelebration(recap);
  else showDailyCelebration(recap);
}
