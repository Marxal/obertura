// The personal puzzle rating — an Elo number that grows as you solve the Daily
// Rated Mix (and only that mode; Time Attack and opening practice are casual). It
// lives device-local in localStorage, mirroring puzzle-log.ts / streak.ts.
//
// The maths is plain Elo against the puzzle's own Lichess rating: you "win" a
// puzzle by solving it on the first try (no wrong move, no hint), and "lose" it
// otherwise. Beating a harder puzzle is worth more; missing an easy one costs
// more. The pure helpers (expectedScore / nextRating / difficulty*) carry no DOM
// or storage so they can be self-tested.

import type { Difficulty } from './puzzles';

const RATING_KEY = 'obertura.puzzleRating';
const HISTORY_KEY = 'obertura.puzzleRatingHistory';
export const START_RATING = 1000;
const K = 24;             // Elo step size — brisk but not jumpy.
const MAX_HISTORY = 120;  // cap the stored series, like the day log.

// ── Pure Elo maths ──────────────────────────────────────────────────────────

// The chance an average solver at `user` beats a puzzle rated `puzzle`.
export function expectedScore(user: number, puzzle: number): number {
  return 1 / (1 + Math.pow(10, (puzzle - user) / 400));
}

// The new rating after one puzzle. `solvedFirstTry` is the only thing that scores
// — a hinted or second-try solve counts as a loss (score 0).
export function nextRating(user: number, puzzle: number, solvedFirstTry: boolean): number {
  const score = solvedFirstTry ? 1 : 0;
  return Math.round(user + K * (score - expectedScore(user, puzzle)));
}

// Adaptive difficulty for the Daily Rated Mix: harder puzzles as your rating
// climbs, so the run keeps pace with you.
export function difficultyForRating(rating: number): Difficulty {
  if (rating < 900) return 'easiest';
  if (rating < 1200) return 'easier';
  if (rating < 1600) return 'normal';
  if (rating < 1900) return 'harder';
  return 'hardest';
}

// Adaptive difficulty for Time Attack: start gentle and ramp up as the solved
// count rises, so the warm-up is quick and the finish is spicy.
export function difficultyForStreak(solved: number): Difficulty {
  if (solved < 2) return 'easiest';
  if (solved < 4) return 'easier';
  if (solved < 7) return 'normal';
  if (solved < 10) return 'harder';
  return 'hardest';
}

// A rising rating floor for Time Attack. Lichess's difficulty bands are coarse and
// overlap, so anonymous puzzles bounce around in absolute rating (1200 → 1500 →
// 1100). The caller fetches a few candidates and keeps the first at/above this
// floor, so the run climbs in level instead of zig-zagging. Starts gentle, gains
// ~75 a solve, capped so it stays beatable.
export function targetRatingForStreak(solved: number): number {
  return Math.min(2000, 1000 + solved * 75);
}

// ── Storage ───────────────────────────────────────────────────────────────────

export function getPuzzleRating(): number {
  try {
    const raw = localStorage.getItem(RATING_KEY);
    if (!raw) return START_RATING;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.round(n) : START_RATING;
  } catch {
    return START_RATING;
  }
}

export interface RatingPoint {
  day: string; // "YYYY-MM-DD" local
  rating: number;
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function loadHistory(): RatingPoint[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return (arr as RatingPoint[]).filter((p) => p && typeof p.day === 'string' && Number.isFinite(p.rating));
  } catch {
    return [];
  }
}

export function getRatingHistory(): RatingPoint[] {
  return loadHistory();
}

// Store the new rating and record it in the history series. One point per day —
// a later run the same day overwrites it, so the graph reads as a clean daily
// line. Capped to the most recent MAX_HISTORY days.
export function commitRating(newRating: number, now: Date = new Date()): void {
  const rating = Math.round(newRating);
  const history = loadHistory();
  const dk = dayKey(now);
  const last = history[history.length - 1];
  if (last && last.day === dk) last.rating = rating;
  else history.push({ day: dk, rating });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  try {
    localStorage.setItem(RATING_KEY, String(rating));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* storage unavailable/full — the rating is a nicety, never block on it. */
  }
}

// Forget the rating and its history — part of "Reset progress" in Settings.
export function clearPuzzleRating(): void {
  try {
    localStorage.removeItem(RATING_KEY);
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* storage unavailable — nothing to clear. */
  }
}
