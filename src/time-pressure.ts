// Time pressure — the pure core of the speed round.
//
// THE EXERCISE. Two minutes, twenty seconds a position, drawn from the moves you
// actually got wrong. Any of the engine's top three counts: under that clock the
// question is "can you see a move that doesn't lose", not "can you find the
// single best one", and the scan already stores all three so the judging costs
// no engine and no network.
//
// WHY IT RANKS AND DOES NOT FILTER. The obvious build is "positions where you
// were low on time" — and it would leave most people with an empty card. The
// scan keeps at most three spots a game, of which only some were played in a
// scramble. So the pool is EVERY mistake, ORDERED by how little time you had:
// the round opens on the moves you rushed and works outwards. The framing stays
// honest either way, because all of them are positions you actually got wrong.
//
// WHAT IT DELIBERATELY DOES NOT WRITE. No spot is marked fixed here and no rest
// is filed. Finding a move in four seconds under a clock is not the same act as
// working one out in the Mistake retry drill, and letting a speed round mark
// blunders "fixed" would quietly empty the queue that exists to make sure they
// aren't. The only thing this round persists is your best score.
//
// Pure: no DOM, no storage beyond the one localStorage best, no engine.
// Exercised offline by time-pressure.selftest.ts.

import { timeFactsAt } from './clock';
import type { SpotRef } from './mistake-scan';

// ── The shape of a round ─────────────────────────────────────────────────────

/**
 * The round's default length, in minutes. Two is long enough to find a rhythm
 * and short enough to sprint, and it is what both the card and the daily
 * challenge ship with.
 */
export const DEFAULT_ROUND_MINUTES = 2;

/** The one-tap lengths offered in the daily challenge's picker. */
export const ROUND_MINUTE_STEPS = [2, 3, 5] as const;

/** A custom length is still capped — nobody needs a forty-minute sprint. */
export const MAX_ROUND_MINUTES = 20;

/** The default round, in ms. */
export const ROUND_MS = DEFAULT_ROUND_MINUTES * 60 * 1000;

/** Minutes → ms, clamped to something a round can actually be. */
export function roundMsFor(minutes: number): number {
  const m = Math.max(1, Math.min(MAX_ROUND_MINUTES, Math.round(minutes) || DEFAULT_ROUND_MINUTES));
  return m * 60 * 1000;
}

/**
 * Per position. Twenty seconds is the pressure — it is the exercise, not a
 * limit. Long enough to actually look at a middlegame position, short enough
 * that you cannot calculate your way out of every one of them.
 */
export const PER_POSITION_MS = 20_000;

/**
 * Answer inside this and the solve is worth double. Three seconds is about as
 * long as it takes to see a move you already know rather than work one out,
 * which is the thing this round is trying to train. It is deliberately NOT a
 * share of the twenty — recognition speed doesn't scale with how long you are
 * allowed, so lengthening the clock must not lower the bar for a bonus.
 */
export const FAST_MS = 3_000;

export const SOLVE_POINTS = 1;
export const FAST_BONUS = 1;

/**
 * Three outcomes, not two. "I knew it but was too slow" and "I had no idea" are
 * different failures, and the whole point of this exercise is the difference —
 * so the clock running out is never folded in with a wrong move.
 */
export type TimePressureOutcome = 'found' | 'missed' | 'ran-out';

export interface TimePressureEntry {
  ref: SpotRef;
  outcome: TimePressureOutcome;
  /** How long it took, in ms. The full PER_POSITION_MS when the clock ran out. */
  ms: number;
  /** What it scored: 0, SOLVE_POINTS, or SOLVE_POINTS + FAST_BONUS. */
  points: number;
}

// ── Ranking by pressure ──────────────────────────────────────────────────────

/**
 * Where a position with no clock data sits in the order. Above a comfortable
 * clock (a move you had two minutes for is not what this round is about) and
 * below anything genuinely played under pressure. Games imported before the
 * clock round have none, so this is most people's library at first.
 */
export const NO_CLOCK_PRESSURE = 0.25;

/**
 * How much time pressure this move was played under, 0 (all the time in the
 * world) to 1 (no time at all). It is simply the share of your clock that was
 * already gone — the emptier it was, the higher this reads, which puts the
 * scrambles at the front of the round on their own.
 */
export function pressureScore(ref: SpotRef): number {
  const facts = timeFactsAt(ref.game, ref.spot.ply);
  if (!facts || facts.baseSec <= 0) return NO_CLOCK_PRESSURE;
  const left = Math.max(0, Math.min(1, facts.leftSec / facts.baseSec));
  return 1 - left;
}

/**
 * The pool, hardest-pressed first. Ties go to the newer game, so a round played
 * twice in a row opens the same way — a shuffled order would make the personal
 * best meaningless.
 */
export function orderByPressure(refs: SpotRef[]): SpotRef[] {
  return refs
    .map((ref, i) => ({ ref, pressure: pressureScore(ref), i }))
    .sort((a, b) =>
      b.pressure - a.pressure
      || b.ref.game.endTime - a.ref.game.endTime
      || a.i - b.i)
    .map(x => x.ref);
}

/**
 * Deal the round: the ordered pool, cycled if it is shorter than two minutes
 * can get through. Cycling matters — a pool of six positions would otherwise
 * end the round in under two minutes, and a speed round that stops early feels
 * like a bug rather than a small library.
 *
 * `max` caps how many are prepared. Sized for the worst case rather than the
 * likely one: twenty seconds is a ceiling, not a cost, so a round of instant
 * answers gets through far more positions than 120 ÷ 20 suggests.
 */
export function dealRound(refs: SpotRef[], max = 60): SpotRef[] {
  const ordered = orderByPressure(refs);
  if (ordered.length === 0) return [];
  const out: SpotRef[] = [];
  while (out.length < max) {
    for (const ref of ordered) {
      out.push(ref);
      if (out.length >= max) break;
    }
  }
  return out;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

/** What a solve is worth: one point, doubled if it landed inside FAST_MS. */
export function scoreSolve(elapsedMs: number): number {
  return SOLVE_POINTS + (elapsedMs <= FAST_MS ? FAST_BONUS : 0);
}

export interface RoundTotals {
  score: number;
  found: number;
  missed: number;
  ranOut: number;
  fast: number;
  /** Mean time over the positions you answered — null when you answered none. */
  averageMs: number | null;
}

export function totalsFor(entries: TimePressureEntry[]): RoundTotals {
  let score = 0, found = 0, missed = 0, ranOut = 0, fast = 0, answeredMs = 0;
  for (const e of entries) {
    score += e.points;
    if (e.outcome === 'found') {
      found++;
      answeredMs += e.ms;
      if (e.points > SOLVE_POINTS) fast++;
    } else if (e.outcome === 'missed') {
      missed++;
      answeredMs += e.ms;
    } else {
      ranOut++;
    }
  }
  const answered = found + missed;
  return {
    score, found, missed, ranOut, fast,
    averageMs: answered > 0 ? Math.round(answeredMs / answered) : null,
  };
}

// ── The personal best ────────────────────────────────────────────────────────
//
// ONE BEST PER LENGTH. A five-minute round gets through more positions than a
// two-minute one, so a single number across both would only ever record the
// longest round you had played — which is a fact about your patience, not your
// speed. Time attack splits its bests the same way, for the same reason
// (prefs.ts).

const BEST_PREFIX = 'obertura.timePressureBest.';
// Where the pre-split single best lived. The exercise shipped at a fixed two
// minutes, so that is the slot its record belongs in.
const LEGACY_BEST_KEY = 'obertura.timePressureBest';

function bestKey(minutes: number): string {
  return BEST_PREFIX + Math.round(minutes);
}

// One-time move of the old single best into the two-minute slot. Runs on first
// access and is harmless afterwards.
function migrateLegacyBest(): void {
  try {
    const legacy = localStorage.getItem(LEGACY_BEST_KEY);
    if (legacy === null) return;
    const key = bestKey(DEFAULT_ROUND_MINUTES);
    if (localStorage.getItem(key) === null) localStorage.setItem(key, legacy);
    localStorage.removeItem(LEGACY_BEST_KEY);
  } catch {
    /* storage unavailable — there is nothing to migrate to either */
  }
}

export function getTimePressureBest(minutes: number = DEFAULT_ROUND_MINUTES): number {
  migrateLegacyBest();
  try {
    const raw = Number(localStorage.getItem(bestKey(minutes)));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  } catch {
    return 0;
  }
}

/**
 * File a finished round of `minutes`. Returns the best as it now stands and
 * whether this round set it — the results screen says "best yet" off that
 * rather than comparing numbers itself.
 */
export function recordTimePressureRound(
  score: number, minutes: number = DEFAULT_ROUND_MINUTES,
): { best: number; improved: boolean } {
  const previous = getTimePressureBest(minutes);
  if (score <= previous) return { best: previous, improved: false };
  try {
    localStorage.setItem(bestKey(minutes), String(score));
  } catch {
    return { best: previous, improved: false }; // private mode: the round still counted, it just isn't kept
  }
  return { best: score, improved: previous > 0 };
}
