// The personal puzzle rating — an Elo number that grows as you solve the Daily
// Rated Mix (and only that mode; Time Attack and opening practice are casual). It
// lives device-local in localStorage, mirroring puzzle-log.ts / streak.ts.
//
// The maths is plain Elo against the puzzle's own Lichess rating: you "win" a
// puzzle by solving it on the first try (no wrong move, no hint), and "lose" it
// otherwise. Beating a harder puzzle is worth more; missing an easy one costs
// more. On top of that sits a SPEED BONUS — see the long note further down, which
// is where the interesting decisions are. The pure helpers (expectedScore /
// rateSolve / parSolveMs / speedFactor / difficulty*) carry no DOM or storage so
// they can be self-tested.

import type { Difficulty } from './puzzles';

// The rating is namespaced by SCOPE so the End game trainer keeps its own puzzle
// ladder, separate from the openings-puzzle ladder. 'openings' keeps the original
// keys, so existing data — and every existing caller (all default to 'openings') —
// is untouched.
export type RatingScope = 'openings' | 'endgame';

const KEYS: Record<RatingScope, { rating: string; history: string; streak: string }> = {
  openings: {
    rating: 'obertura.puzzleRating',
    history: 'obertura.puzzleRatingHistory',
    streak: 'obertura.puzzleStreak',
  },
  endgame: {
    rating: 'obertura.endgamePuzzleRating',
    history: 'obertura.endgamePuzzleRatingHistory',
    streak: 'obertura.endgamePuzzleStreak',
  },
};

export const START_RATING = 1000;
const K = 24;             // Elo step size — brisk but not jumpy.
const MAX_HISTORY = 120;  // cap the stored series, like the day log.

// ── Pure Elo maths ──────────────────────────────────────────────────────────

// The chance an average solver at `user` beats a puzzle rated `puzzle`.
export function expectedScore(user: number, puzzle: number): number {
  return 1 / (1 + Math.pow(10, (puzzle - user) / 400));
}

// ── The speed bonus ─────────────────────────────────────────────────────────
//
// THE PROBLEM IT FIXES. Plain Elo pays you for the UNEXPECTED. Beat a puzzle
// rated 700 points below you and the maths says "of course you did": the gain
// rounds to zero, while missing it costs a full step. So an easy puzzle is all
// downside, and a run of them feels like work you were not paid for — which is
// exactly what happens at the bottom of the ladder, where Lichess's difficulty
// bands are coarse and a 1000-rated solver keeps drawing 600-rated puzzles.
//
// THE FIX, IN ONE SENTENCE: you are paid for HOW FAST, in exactly the
// proportion that you were not paid for WHETHER.
//
//     bonus = MAX_SPEED_BONUS × speed × expectedScore(you, puzzle)
//
// `expectedScore` is the share of the puzzle plain Elo already treated as a
// foregone conclusion, so the bonus is largest precisely where the base gain is
// smallest, and fades to nothing on a puzzle harder than you — where the base
// gain is already a full step and needs no help. Two consequences, both wanted:
//
//   • Solve a puzzle rated above you and the rating moves as it always did,
//     fast or slow. Being quick against something genuinely hard is worth a
//     point or two, not a windfall.
//   • Solve one far below you and speed is the ONLY thing worth measuring,
//     because whether you'd solve it was never in doubt.
//
// A MISS IGNORES THE CLOCK ENTIRELY. Losing rating for being slow would turn
// every puzzle into a test of nerve, and "I saw it, I just checked it twice"
// is not a mistake. Wrong is wrong, at the same price as before.
//
// AND IT ONLY EVER ADDS. That does mean the ladder settles a little higher than
// one that only measured whether you solved things — it is now measuring how
// hard a puzzle you can solve QUICKLY, which is a different (and, for practical
// strength, a better) question. It is self-limiting: the harder the puzzles get,
// the smaller `expectedScore` gets, and the bonus goes with it.

/**
 * The most a fast solve can add. A quarter of K: enough that clearing an easy
 * puzzle quickly is visibly worth something, never enough to out-earn actually
 * beating a hard one.
 */
export const MAX_SPEED_BONUS = 6;

/** Par time: the base every puzzle gets, just to read the position. */
const PAR_BASE_MS = 5_000;
/** …plus this much per move you have to find. */
const PAR_PER_MOVE_MS = 5_000;
/** …plus up to this much for the puzzle's own difficulty. */
const PAR_RATING_MS = 30_000;
/** The rating span that difficulty allowance is spread over. */
const PAR_RATING_FLOOR = 600;
const PAR_RATING_CEIL = 2400;

/**
 * How long this puzzle is "supposed" to take — the point at which the bonus has
 * run out. It scales with both things that actually make a puzzle slow: how many
 * moves you have to find, and how hard it is.
 *
 * A one-move 800 is 13 seconds; a three-move 2000 is 43. Deliberately generous:
 * par is not a target, it is the line past which speed stops being evidence.
 */
export function parSolveMs(puzzleRating: number, solverMoves: number): number {
  const span = PAR_RATING_CEIL - PAR_RATING_FLOOR;
  const hardness = Math.max(0, Math.min(1, (puzzleRating - PAR_RATING_FLOOR) / span));
  return PAR_BASE_MS
    + PAR_PER_MOVE_MS * Math.max(1, solverMoves)
    + PAR_RATING_MS * hardness;
}

/**
 * The share of par under which a solve counts as instant — full bonus, no
 * stopwatch anxiety. Above it the bonus tapers to nothing at par.
 */
export const FAST_FRACTION = 0.35;

/** 1 = as fast as it gets, 0 = at or past par. */
export function speedFactor(elapsedMs: number, parMs: number): number {
  if (!(parMs > 0)) return 0;
  const fast = parMs * FAST_FRACTION;
  if (elapsedMs <= fast) return 1;
  if (elapsedMs >= parMs) return 0;
  return (parMs - elapsedMs) / (parMs - fast);
}

/** What one puzzle did to the rating, split so the screen can show the why. */
export interface RatingChange {
  /** The rating afterwards. */
  next: number;
  /** The whole change — `base + bonus`. */
  points: number;
  /** What the solve itself was worth, exactly as it always has been. */
  base: number;
  /** …and what speed added. Zero on anything but a fast, clean, first-try solve. */
  bonus: number;
}

/**
 * Score one puzzle. `solvedFirstTry` is the only thing that scores — a hinted or
 * second-try solve counts as a loss (score 0) — and `speed` (0…1, from
 * speedFactor above) can only ever ADD to a solve.
 */
export function rateSolve(
  user: number, puzzle: number, solvedFirstTry: boolean, speed = 0,
): RatingChange {
  const expected = expectedScore(user, puzzle);
  const base = Math.round(K * ((solvedFirstTry ? 1 : 0) - expected));
  const bonus = solvedFirstTry
    ? Math.round(MAX_SPEED_BONUS * Math.max(0, Math.min(1, speed)) * expected)
    : 0;
  const points = base + bonus;
  return { next: user + points, points, base, bonus };
}

// The new rating after one puzzle, with no clock involved — the plain Elo step,
// kept for every caller that has no time to report.
export function nextRating(user: number, puzzle: number, solvedFirstTry: boolean): number {
  return rateSolve(user, puzzle, solvedFirstTry).next;
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

// The Lichess difficulty bands in order — for stepping one band up or down.
const DIFFICULTY_ORDER: Difficulty[] = ['easiest', 'easier', 'normal', 'harder', 'hardest'];

// One band easier (-1), your own band (0), or one band harder (+1) than the
// rating's adaptive difficulty, clamped at the ends. The daily challenge's
// easy → medium → hard ladder, still anchored to YOUR rating.
export function difficultyStep(rating: number, step: -1 | 0 | 1): Difficulty {
  const i = DIFFICULTY_ORDER.indexOf(difficultyForRating(rating));
  return DIFFICULTY_ORDER[Math.max(0, Math.min(DIFFICULTY_ORDER.length - 1, i + step))];
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

export function getPuzzleRating(scope: RatingScope = 'openings'): number {
  try {
    const raw = localStorage.getItem(KEYS[scope].rating);
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

function loadHistory(scope: RatingScope): RatingPoint[] {
  try {
    const raw = localStorage.getItem(KEYS[scope].history);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return (arr as RatingPoint[]).filter((p) => p && typeof p.day === 'string' && Number.isFinite(p.rating));
  } catch {
    return [];
  }
}

export function getRatingHistory(scope: RatingScope = 'openings'): RatingPoint[] {
  return loadHistory(scope);
}

// Store the new rating and record it in the history series. One point per day —
// a later run the same day overwrites it, so the graph reads as a clean daily
// line. Capped to the most recent MAX_HISTORY days.
export function commitRating(newRating: number, scope: RatingScope = 'openings', now: Date = new Date()): void {
  const rating = Math.round(newRating);
  const history = loadHistory(scope);
  const dk = dayKey(now);
  const last = history[history.length - 1];
  if (last && last.day === dk) last.rating = rating;
  else history.push({ day: dk, rating });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  try {
    localStorage.setItem(KEYS[scope].rating, String(rating));
    localStorage.setItem(KEYS[scope].history, JSON.stringify(history));
  } catch {
    /* storage unavailable/full — the rating is a nicety, never block on it. */
  }
}

// ── Clean-solve streak ────────────────────────────────────────────────────────
//
// The longest run of rated puzzles solved first-try with no miss in between. A
// missed/hinted rated puzzle resets the running count; the best ever is kept for
// the Statistics "Best run" box and the end-of-session "new best" note.

interface StreakState { current: number; best: number; }

function loadStreak(scope: RatingScope): StreakState {
  try {
    const raw = localStorage.getItem(KEYS[scope].streak);
    if (!raw) return { current: 0, best: 0 };
    const obj = JSON.parse(raw) as Partial<StreakState>;
    return {
      current: Number.isFinite(obj.current) ? Math.max(0, Math.floor(obj.current as number)) : 0,
      best: Number.isFinite(obj.best) ? Math.max(0, Math.floor(obj.best as number)) : 0,
    };
  } catch {
    return { current: 0, best: 0 };
  }
}

export function getBestCleanStreak(scope: RatingScope = 'openings'): number {
  return loadStreak(scope).best;
}

// Fold one rated result into the streak. A clean first-try solve extends the run;
// anything else resets it. Returns the new best and whether it just improved (so
// the caller can celebrate it once, at the end of the session).
export function recordCleanResult(solvedFirstTry: boolean, scope: RatingScope = 'openings'): { best: number; improved: boolean } {
  const s = loadStreak(scope);
  let improved = false;
  if (solvedFirstTry) {
    s.current += 1;
    if (s.current > s.best) { s.best = s.current; improved = true; }
  } else {
    s.current = 0;
  }
  try {
    localStorage.setItem(KEYS[scope].streak, JSON.stringify(s));
  } catch {
    /* storage unavailable/full — the streak is a nicety, never block on it. */
  }
  return { best: s.best, improved };
}

// Forget the rating and its history — part of "Reset progress" in Settings. With
// no scope it clears EVERY ladder (openings + endgame), so the single reset button
// wipes them all; pass a scope to clear just one.
export function clearPuzzleRating(scope?: RatingScope): void {
  const scopes: RatingScope[] = scope ? [scope] : ['openings', 'endgame'];
  for (const sc of scopes) {
    try {
      localStorage.removeItem(KEYS[sc].rating);
      localStorage.removeItem(KEYS[sc].history);
      localStorage.removeItem(KEYS[sc].streak);
    } catch {
      /* storage unavailable — nothing to clear. */
    }
  }
}
