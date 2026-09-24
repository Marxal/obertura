// The Train screen's two small calculations, kept pure so they can be tested
// under plain Node (train-progress.selftest.ts): the week of dots on the Today
// strip (train-today.ts) and the "on the way to the next hundred" bar on a
// rated door (train-doors.ts).

import { localDayKey } from './daily-recap';

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export interface WeekDay {
  key: string;
  initial: string;
  trained: boolean;
  today: boolean;
}

/** The last seven days, oldest first, each with whether you trained. */
export function lastSevenDays(trained: ReadonlySet<string>, now: Date = new Date()): WeekDay[] {
  const out: WeekDay[] = [];
  for (let back = 6; back >= 0; back--) {
    const d = new Date(now);
    d.setDate(d.getDate() - back);
    const key = localDayKey(d);
    out.push({ key, initial: WEEKDAY_INITIALS[d.getDay()], trained: trained.has(key), today: back === 0 });
  }
  return out;
}

/**
 * The next round hundred above a rating, and how far through the current
 * hundred it is — the progress a rated door shows. 1437 → 37 of 100, "63 pts
 * to 1500". A rating exactly on a hundred has the whole next hundred to go.
 */
export function ratingProgress(rating: number): { value: number; max: number; label: string } {
  const r = Math.max(0, Math.round(rating));
  const next = Math.floor(r / 100) * 100 + 100;
  return { value: r - (next - 100), max: 100, label: `${next - r} pts to ${next}` };
}
