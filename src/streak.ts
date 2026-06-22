// Daily-training streak — kept on the device in localStorage (it's small,
// non-critical meta, and survives reloads without touching the IndexedDB line
// store).
//
// ── The streak rule ──────────────────────────────────────────────────────────
// A day "counts" when you complete at least one training session that day, in
// your LOCAL calendar time. The current streak is the run of consecutive
// counted days with no gaps, counted backwards from today.
//
// One day of grace: if you haven't trained YET today, the streak is measured
// from yesterday instead, so an unbroken streak doesn't read as zero first
// thing in the morning. It only breaks once a whole calendar day passes with
// no session — i.e. the most recent counted day is older than yesterday.

const KEY = 'obertura-training-days';
const REVIEWED_KEY = 'obertura-reviewed-today';

// Local-time day key, e.g. "2026-06-09" — local, not UTC, so "today" matches
// the wall clock on the phone.
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function loadDays(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveDays(days: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...days].sort()));
  } catch {
    /* storage unavailable/full — the streak is a nicety, never block on it. */
  }
}

// Step a Date back one calendar day, returning a fresh Date.
function prevDay(d: Date): Date {
  const c = new Date(d);
  c.setDate(c.getDate() - 1);
  return c;
}

// Mark today as a day with a completed training session. Idempotent — calling
// it twice in a day records one day.
export function recordTrainingDay(now: Date = new Date()): void {
  const days = loadDays();
  const key = dayKey(now);
  if (days.has(key)) return;
  days.add(key);
  saveDays(days);
}

// Whether today already has a completed session.
export function trainedToday(now: Date = new Date()): boolean {
  return loadDays().has(dayKey(now));
}

// All recorded training day keys ("YYYY-MM-DD" local time), sorted oldest-first.
export function getTrainingDays(): string[] {
  return [...loadDays()].sort();
}

// Forget every recorded training day — part of "Reset progress" in Settings.
export function clearTrainingDays(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — nothing to clear. */
  }
}

// ── Reviewed-today counter ─────────────────────────────────────────────────────
//
// A running tally of how many positions you've reviewed today, shown on the
// Train hero so the screen reflects today's effort. It's purely a daily figure:
// stored with the day it belongs to and read as 0 once the calendar rolls over.

interface ReviewedToday {
  day: string;
  count: number;
}

function loadReviewed(): ReviewedToday {
  try {
    const raw = localStorage.getItem(REVIEWED_KEY);
    if (!raw) return { day: '', count: 0 };
    const obj = JSON.parse(raw) as Partial<ReviewedToday>;
    return {
      day: typeof obj.day === 'string' ? obj.day : '',
      count: typeof obj.count === 'number' && obj.count > 0 ? Math.floor(obj.count) : 0,
    };
  } catch {
    return { day: '', count: 0 };
  }
}

// How many positions have been reviewed today (0 once a new day begins).
export function reviewedToday(now: Date = new Date()): number {
  const r = loadReviewed();
  return r.day === dayKey(now) ? r.count : 0;
}

// Add to today's reviewed tally. Resets automatically when the day has rolled
// over since the stored figure.
export function recordReviewed(n: number, now: Date = new Date()): void {
  if (n <= 0) return;
  const key = dayKey(now);
  const r = loadReviewed();
  const count = (r.day === key ? r.count : 0) + n;
  try {
    localStorage.setItem(REVIEWED_KEY, JSON.stringify({ day: key, count }));
  } catch {
    /* storage unavailable — the tally is a nicety, never block on it. */
  }
}

// Forget today's reviewed tally — part of "Reset progress" in Settings.
export function clearReviewedToday(): void {
  try {
    localStorage.removeItem(REVIEWED_KEY);
  } catch {
    /* storage unavailable — nothing to clear. */
  }
}

// ── Remembered-vs-failed review log ─────────────────────────────────────────────
//
// A small per-day tally of how many moves were REMEMBERED (recalled first try)
// vs FAILED (missed) in training — the data behind the Statistics "remembered vs
// failed" bar. Kept device-local like the streak. It's recorded going FORWARD
// from each finished drill (full-line training and the single-move "Fix
// mistakes" mode); there is deliberately NO historical backfill, so days before
// this existed simply read as zero. A rolling window keeps the store tiny.

const REVIEW_LOG_KEY = 'obertura-review-log';
const REVIEW_LOG_MAX_DAYS = 120;

// One day's outcome.
export interface DayOutcome {
  day: string;        // "YYYY-MM-DD" local
  remembered: number;
  failed: number;
}

// Stored compactly as { "2026-06-22": { r: 12, f: 3 }, … } to keep the key small.
type StoredLog = Record<string, { r: number; f: number }>;

function loadReviewLog(): StoredLog {
  try {
    const raw = localStorage.getItem(REVIEW_LOG_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== 'object') return {};
    return obj as StoredLog;
  } catch {
    return {};
  }
}

function saveReviewLog(log: StoredLog): void {
  // Prune to the most recent REVIEW_LOG_MAX_DAYS days so it can't grow unbounded.
  let out = log;
  const keys = Object.keys(log);
  if (keys.length > REVIEW_LOG_MAX_DAYS) {
    const keep = keys.sort().slice(keys.length - REVIEW_LOG_MAX_DAYS);
    out = {};
    for (const k of keep) out[k] = log[k];
  }
  try {
    localStorage.setItem(REVIEW_LOG_KEY, JSON.stringify(out));
  } catch {
    /* storage unavailable/full — the log is a nicety, never block training on it. */
  }
}

// Add one finished drill's outcome to today's tally. Idempotent across a day in
// the sense that repeated calls accumulate (a day with two sessions sums both).
export function recordReviewOutcome(remembered: number, failed: number, now: Date = new Date()): void {
  if (remembered <= 0 && failed <= 0) return;
  const key = dayKey(now);
  const log = loadReviewLog();
  const cur = log[key] ?? { r: 0, f: 0 };
  log[key] = { r: cur.r + Math.max(0, remembered), f: cur.f + Math.max(0, failed) };
  saveReviewLog(log);
}

// The whole log as a sorted (oldest-first) array of clean DayOutcome rows.
export function getReviewLog(): DayOutcome[] {
  const log = loadReviewLog();
  return Object.keys(log).sort().map(day => ({
    day,
    remembered: Math.max(0, Math.floor(log[day]?.r ?? 0)),
    failed: Math.max(0, Math.floor(log[day]?.f ?? 0)),
  }));
}

// Forget the whole remembered/failed log — part of "Reset progress" in Settings.
export function clearReviewLog(): void {
  try {
    localStorage.removeItem(REVIEW_LOG_KEY);
  } catch {
    /* storage unavailable — nothing to clear. */
  }
}

// The current streak length, in days (see the rule at the top of the file).
export function currentStreak(now: Date = new Date()): number {
  const days = loadDays();
  if (days.size === 0) return 0;

  // Anchor on today if it counts, else yesterday (the grace day), else broken.
  let cursor = new Date(now);
  if (!days.has(dayKey(cursor))) {
    cursor = prevDay(cursor);
    if (!days.has(dayKey(cursor))) return 0;
  }

  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor = prevDay(cursor);
  }
  return streak;
}
