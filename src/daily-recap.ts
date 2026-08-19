// The daily challenge's day-by-day results log, and the recap numbers built from
// it for the completion popup (daily-celebration.ts).
//
// Every daily task reports how many moves/puzzles it got RIGHT and WRONG when it
// finishes; those land in a small rolling per-day log (device-local, like the
// streak). That log is what lets the popup say "94% today, up from 87%
// yesterday" — and it's what makes a PERFECT day (not one move wrong, all day)
// detectable.
//
// Why its own log rather than the existing tallies: streak.ts counts every
// reviewed move and puzzle-log.ts counts every puzzle, wherever they happened.
// The daily challenge needs its own numbers so today's is compared with a day of
// the SAME shape — the challenge, not everything you happened to do that day.
//
// No DOM here — the maths is pure and covered by daily-recap.selftest.ts.

import type { DailyTaskId } from './daily-challenge';

const LOG_KEY = 'obertura.dailyChallenge.log';
const MAX_DAYS = 180;

// One day's daily-challenge result.
export interface DailyDayResult {
  day: string;      // "YYYY-MM-DD" local
  right: number;    // moves/puzzles answered correctly, first try
  wrong: number;    // moves/puzzles missed
  tasks: number;    // how many tasks reported in (a finished day = every active one)
  done: boolean;    // the whole challenge was cleared that day
}

// What a finished task hands back.
export interface TaskOutcome {
  right: number;
  wrong: number;
}

// Stored compactly: { "2026-08-13": { r: 26, w: 2, t: 5, d: 1 }, … }.
type StoredDay = { r: number; w: number; t: number; d: 0 | 1 };
type StoredLog = Record<string, StoredDay>;

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function loadLog(): StoredLog {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== 'object') return {};
    return obj as StoredLog;
  } catch {
    return {};
  }
}

function saveLog(log: StoredLog): void {
  let out = log;
  const keys = Object.keys(log);
  if (keys.length > MAX_DAYS) {
    const keep = keys.sort().slice(keys.length - MAX_DAYS);
    out = {};
    for (const k of keep) out[k] = log[k];
  }
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(out));
  } catch {
    /* storage unavailable/full — the recap is a nicety, never block on it. */
  }
}

function clean(day: string, s: StoredDay | undefined): DailyDayResult {
  return {
    day,
    right: Math.max(0, Math.floor(s?.r ?? 0)),
    wrong: Math.max(0, Math.floor(s?.w ?? 0)),
    tasks: Math.max(0, Math.floor(s?.t ?? 0)),
    done: s?.d === 1,
  };
}

// Fold one finished daily task into today's row. Called once per task, from the
// task's own completion callback.
export function recordDailyTask(_id: DailyTaskId, outcome: TaskOutcome, now: Date = new Date()): void {
  const key = dayKey(now);
  const log = loadLog();
  const cur = log[key] ?? { r: 0, w: 0, t: 0, d: 0 as 0 | 1 };
  log[key] = {
    r: cur.r + Math.max(0, Math.floor(outcome.right)),
    w: cur.w + Math.max(0, Math.floor(outcome.wrong)),
    t: cur.t + 1,
    d: cur.d,
  };
  saveLog(log);
}

// Today's local day key ("YYYY-MM-DD"), for callers building a recap.
export function localDayKey(now: Date = new Date()): string {
  return dayKey(now);
}

// Stamp today as a fully-cleared challenge. Returns true only the FIRST time it
// lands today — which is what stops the celebration popping again if a finished
// task is replayed later in the day.
export function markDayComplete(now: Date = new Date()): boolean {
  const key = dayKey(now);
  const log = loadLog();
  const cur = log[key] ?? { r: 0, w: 0, t: 0, d: 0 as 0 | 1 };
  if (cur.d === 1) return false;
  log[key] = { ...cur, d: 1 };
  saveLog(log);
  return true;
}

// The whole log, oldest day first.
export function getDailyLog(): DailyDayResult[] {
  const log = loadLog();
  return Object.keys(log).sort().map((day) => clean(day, log[day]));
}

// Forget every recorded daily-challenge day — part of "Reset progress".
export function clearDailyLog(): void {
  try {
    localStorage.removeItem(LOG_KEY);
  } catch {
    /* storage unavailable — nothing to clear. */
  }
}

// ── The recap ────────────────────────────────────────────────────────────────
//
// Everything below is pure: hand it the log and a few figures the caller already
// has, get back the numbers the popup renders. Nothing here touches storage.

export interface RecapInput {
  log: DailyDayResult[];
  today: string;            // the day being summarised, "YYYY-MM-DD" local
  streak: number;           // training streak on that day, in days
  trainingDays: string[];   // every recorded training day (for the best streak)
  linesMastered: number;
  linesInTraining: number;
  // Set when the day is being reopened from the calendar rather than just
  // finished. Carried straight through onto the Recap.
  replay?: boolean;
}

export interface RecapCompare {
  // The day we're measuring against: literally yesterday when there's a row for
  // it, otherwise the most recent earlier day with one.
  day: string;
  accuracy: number;   // 0–100
  // True when `day` is the calendar day before today (so the popup can say
  // "yesterday" rather than "last time").
  isYesterday: boolean;
}

export interface Recap {
  // The day this recap describes ("YYYY-MM-DD" local). Usually today; a recap
  // reopened from the calendar carries the day that was tapped.
  day: string;
  // True when this is a day being LOOKED BACK AT rather than one just finished,
  // so the popup can date itself instead of claiming to be about today.
  replay: boolean;
  right: number;
  wrong: number;
  total: number;
  accuracy: number;             // 0–100, on `day`
  perfect: boolean;             // not one wrong, and something was actually done
  compare: RecapCompare | null; // null on the very first logged day
  delta: number | null;         // this day's accuracy minus the compare day's
  streak: number;
  bestStreak: number;
  // The streak equals the longest ever (and is worth more than one day).
  streakIsBest: boolean;
  challengesDone: number;       // completed daily challenges, all time
  perfectDays: number;          // days finished without a single miss, all time
  linesMastered: number;
  linesInTraining: number;
}

// Percentage right, rounded, 0 when nothing was attempted.
export function accuracyOf(right: number, wrong: number): number {
  const total = right + wrong;
  return total === 0 ? 0 : Math.round((right / total) * 100);
}

// Step a "YYYY-MM-DD" key back one calendar day.
function prevKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() - 1);
  return dayKey(date);
}

// The longest run of consecutive days in a set of day keys.
export function longestStreak(days: string[]): number {
  const set = new Set(days);
  let best = 0;
  for (const day of set) {
    // Only start counting from the first day of a run, so each run is walked once.
    if (set.has(prevKey(day))) continue;
    let run = 0;
    let cursor = day;
    while (set.has(cursor)) {
      run++;
      const [y, m, d] = cursor.split('-').map(Number);
      const next = new Date(y, (m ?? 1) - 1, d ?? 1);
      next.setDate(next.getDate() + 1);
      cursor = dayKey(next);
    }
    if (run > best) best = run;
  }
  return best;
}

/**
 * The training streak AS OF a given day: the run of consecutive recorded days
 * ending on it, or 0 when nothing was trained that day.
 *
 * `currentStreak()` in streak.ts answers the same question for today (and
 * forgives today when yesterday counts, so a streak survives until midnight).
 * A day reopened from the calendar needs the figure that was true THEN, and
 * nothing stored it, so it is counted back out of the training-days set.
 */
export function streakEndingOn(days: string[], day: string): number {
  const set = new Set(days);
  if (!set.has(day)) return 0;
  let run = 0;
  let cursor = day;
  while (set.has(cursor)) {
    run++;
    cursor = prevKey(cursor);
  }
  return run;
}

/**
 * The log up to and including a day — which is what makes every all-time figure
 * on a reopened recap ("challenges cleared", "perfect days", the best streak)
 * read as it did on that day rather than as it does now.
 */
export function logUpTo(log: DailyDayResult[], day: string): DailyDayResult[] {
  return log.filter((r) => r.day <= day);
}

/**
 * A day key as a human date — "Today", "Yesterday", or "12 August". Used by the
 * reopened popup's date line and by the calendars' labels, so both name a day
 * the same way.
 */
export function formatDayLabel(day: string, now: Date = new Date()): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  const date = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}

// A day counts as perfect when it was cleared and nothing at all was missed.
export function isPerfectDay(r: DailyDayResult): boolean {
  return r.done && r.wrong === 0 && r.right > 0;
}

export function buildRecap(input: RecapInput): Recap {
  const { log, today } = input;
  const todayRow = log.find((r) => r.day === today) ?? { day: today, right: 0, wrong: 0, tasks: 0, done: false };

  // The comparison day: yesterday if it's there, else the most recent earlier
  // day we have anything for.
  const earlier = log.filter((r) => r.day < today && r.right + r.wrong > 0);
  const previous = earlier.length > 0 ? earlier[earlier.length - 1] : null;
  const yesterdayKey = prevKey(today);
  const compare: RecapCompare | null = previous
    ? {
        day: previous.day,
        accuracy: accuracyOf(previous.right, previous.wrong),
        isYesterday: previous.day === yesterdayKey,
      }
    : null;

  const accuracy = accuracyOf(todayRow.right, todayRow.wrong);
  const bestStreak = Math.max(longestStreak(input.trainingDays), input.streak);

  return {
    day: today,
    replay: input.replay === true,
    right: todayRow.right,
    wrong: todayRow.wrong,
    total: todayRow.right + todayRow.wrong,
    accuracy,
    perfect: todayRow.wrong === 0 && todayRow.right > 0,
    compare,
    delta: compare ? accuracy - compare.accuracy : null,
    streak: input.streak,
    bestStreak,
    streakIsBest: input.streak > 1 && input.streak >= bestStreak,
    // Today is stamped complete before the recap is built, so it's included.
    challengesDone: log.filter((r) => r.done).length,
    perfectDays: log.filter(isPerfectDay).length,
    linesMastered: input.linesMastered,
    linesInTraining: input.linesInTraining,
  };
}

// The one line of encouragement under the comparison. Ordered by what's most
// worth saying — a personal best beats a small improvement, which beats a
// steady day.
export function recapMessage(r: Recap): string {
  if (r.streakIsBest && r.streak >= 3) return `${r.streak} days in a row — your longest run yet.`;
  if (r.delta === null) return 'First one logged. Tomorrow has something to beat.';
  if (r.delta >= 10) return 'A big step up on last time. That is progress you can feel.';
  if (r.delta > 0) return 'Sharper than last time. The lines are settling in.';
  if (r.delta === 0) return 'Holding steady — consistency is what makes it stick.';
  if (r.delta >= -10) return 'A shade behind last time. Repetition is doing its work.';
  return 'A tougher set today. Missed moves come back sooner — that is the point.';
}
