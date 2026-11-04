import { t } from './i18n';
// How many never-trained moves a day's training may bring in.
//
// WHY THERE IS ONE. Adding a pack or five lines from your games puts a lot of new
// material in training at once, and every one of those moves is "due" from the
// first second. Without a limit that is one enormous first session and the same
// wall the next day: Anki's oldest lesson, and the audit's C1. Reviews are never
// limited. They're the moves you might be about to forget.
//
// WHAT IT GOVERNS. The sessions the app deals on its own: the Openings door, the
// Whole lines card and Individual moves. NOT a line someone opened by name, a
// confirm run, or the daily challenge's fixed three lines, though any new move
// trained in those still counts towards today's number.
//
// THE COUNTER IS THIS DEVICE'S (local-keys.ts). It's one small value overwritten
// daily, and syncing it would mean an account push on every first move learned, to
// stop an unusual two-phone day going over a soft limit. The preference itself
// travels with the account's other settings.

const PER_DAY_KEY = 'obertura.newMovesPerDay';
const TODAY_KEY = 'obertura.newMovesToday';

/** The choices in Settings. 0 means no limit. */
export const NEW_MOVE_CHOICES = [5, 10, 20, 0] as const;
export type NewMoveChoice = (typeof NEW_MOVE_CHOICES)[number];
const DEFAULT_PER_DAY: NewMoveChoice = 10;

export function getNewMovesPerDay(): NewMoveChoice {
  try {
    const v = Number(localStorage.getItem(PER_DAY_KEY));
    if (localStorage.getItem(PER_DAY_KEY) !== null
      && (NEW_MOVE_CHOICES as readonly number[]).includes(v)) return v as NewMoveChoice;
  } catch { /* storage off: the default */ }
  return DEFAULT_PER_DAY;
}

export function setNewMovesPerDay(n: NewMoveChoice): void {
  try { localStorage.setItem(PER_DAY_KEY, String(n)); } catch { /* storage off */ }
}

function dayKey(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function trainedToday(now: Date): number {
  try {
    const raw = localStorage.getItem(TODAY_KEY);
    if (!raw) return 0;
    const v = JSON.parse(raw) as { day?: string; n?: number };
    return v.day === dayKey(now) && typeof v.n === 'number' ? v.n : 0;
  } catch {
    return 0;
  }
}

/** New moves still allowed today. Infinity when there's no limit. */
export function newMovesLeftToday(now: Date = new Date()): number {
  const limit = getNewMovesPerDay();
  if (limit === 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, limit - trainedToday(now));
}

/**
 * Call just before grading a move, with the record it has NOW. Counts it only if
 * this is the first time it's ever been trained.
 */
export function noteMoveGraded(
  review: { reps: number; lapses: number; interval: number } | undefined,
  now: Date = new Date(),
): void {
  if (review && (review.reps > 0 || review.lapses > 0 || review.interval > 0)) return;
  try {
    localStorage.setItem(TODAY_KEY, JSON.stringify({ day: dayKey(now), n: trainedToday(now) + 1 }));
  } catch { /* storage off: the limit just doesn't tick */ }
}

/** Why a session has nothing to deal, when the limit is the reason. */
export function newMoveLimitReason(): string {
  const limit = getNewMovesPerDay();
  return limit === 0
    ? t('train.nothingDue')
    : t('train.newDone', { limit });
}
