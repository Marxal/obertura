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
