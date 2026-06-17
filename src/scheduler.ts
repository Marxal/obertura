import type { Line } from './types';
import type { MoveNode } from './tree';

// ── The spaced-repetition brain ─────────────────────────────────────────────────
//
// Pure logic, zero DOM, so it can be exercised by the self-test (see
// scheduler.selftest.ts) without a browser. Everything here operates on a single
// MoveNode's `review` block:
//
//   { ease, interval, reps, lapses, due }
//
//   ease     – how fast the gap grows. Starts at 2.5; drops when you miss.
//   interval – whole days until the move is next due.
//   reps     – consecutive clean recalls (resets to 0 on a miss).
//   lapses   – lifetime count of misses (only ever grows).
//   due      – the Date the move next wants to be trained.
//
// This is the classic SM-2 algorithm, simplified for a binary drill: you either
// played the move correctly first time, or you missed it.

export interface Review {
  ease: number;
  interval: number;
  reps: number;
  lapses: number;
  due: Date;
}

export const DEFAULT_EASE = 2.5;
export const MIN_EASE = 1.3;
const DAY_MS = 24 * 60 * 60 * 1000;

// A brand-new, never-trained review. `due` = now, so a fresh move is due
// immediately (a never-trained line is always a due line).
export function newReview(now: Date = new Date()): Review {
  return { ease: DEFAULT_EASE, interval: 0, reps: 0, lapses: 0, due: new Date(now) };
}

// SM-2 grades recall on a 0–5 scale. Our drill only knows "clean" or "missed",
// so we map the count of misses on a move to a quality:
//   0 misses → 5 (perfect),  1 miss → 2 (a lapse),  2+ → 0 (a bad lapse).
// Anything below 3 is a fail in SM-2 and resets the move; more misses pull the
// ease (and therefore future intervals) down harder.
export function qualityFromMisses(misses: number): number {
  if (misses <= 0) return 5;
  if (misses === 1) return 2;
  return 0;
}

// Apply one SM-2 grading to a review, returning a fresh review object.
// Quality ≥ 3 advances the move (interval grows: 1 → 6 → interval×ease → …).
// Quality < 3 is a lapse: reps reset, interval drops back to 1 day (so the move
// returns in the very next session), and a lapse is banked.
export function gradeReview(prev: Review, quality: number, now: Date = new Date()): Review {
  let { ease, interval, reps, lapses } = prev;

  if (quality >= 3) {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = Math.round(interval * ease);
    reps += 1;
  } else {
    reps = 0;
    interval = 1;
    lapses += 1;
  }

  // Standard SM-2 ease adjustment. Perfect recall nudges ease up a touch; a
  // miss drags it down (a quality-0 miss costs ~0.8). Never below MIN_EASE.
  ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (ease < MIN_EASE) ease = MIN_EASE;

  const due = new Date(now.getTime() + interval * DAY_MS);
  return { ease, interval, reps, lapses, due };
}

// ── Due checks ──────────────────────────────────────────────────────────────────

// A review with no record yet counts as due (never trained = train it now).
// We coerce `due` through `new Date(...)` so a value that survived a storage
// round-trip as a string still compares correctly.
export function isReviewDue(review: Review | undefined, now: Date = new Date()): boolean {
  if (!review) return true;
  return new Date(review.due).getTime() <= now.getTime();
}

// ── Tree helpers ──────────────────────────────────────────────────────────────
//
// Training walks the mainline (the children[0] chain). Of those moves, only the
// ones the *user* plays are scheduled — the opponent's replies are auto-played,
// never tested. White's moves are the even plies; Black's are the odd plies.

export function mainlineNodes(tree: MoveNode): MoveNode[] {
  const result: MoveNode[] = [];
  let node = tree.children[0];
  while (node) {
    result.push(node);
    node = node.children[0];
  }
  return result;
}

export function userMoveNodes(tree: MoveNode, colour: 'white' | 'black'): MoveNode[] {
  return mainlineNodes(tree).filter((_, i) =>
    colour === 'white' ? i % 2 === 0 : i % 2 === 1
  );
}

// A "due line" = any line with at least one due user-move.
export function lineIsDue(line: Line, now: Date = new Date()): boolean {
  return userMoveNodes(line.tree, line.colour).some(n => isReviewDue(n.review, now));
}

// Every in-training line that has a due move, in the order given.
export function dueLines(lines: Line[], now: Date = new Date()): Line[] {
  return lines.filter(l => l.inTraining && lineIsDue(l, now));
}

// The soonest `due` across a line's user-moves — drives "Due in N days" labels.
// Returns null for a never-trained line (its moves are due now, handled above).
export function nextDue(line: Line): Date | null {
  let soonest: number | null = null;
  for (const n of userMoveNodes(line.tree, line.colour)) {
    if (!n.review) return null; // an untrained move is due now
    const t = new Date(n.review.due).getTime();
    if (soonest === null || t < soonest) soonest = t;
  }
  return soonest === null ? null : new Date(soonest);
}

// ── Status buckets (for the Train hub's filter row) ─────────────────────────────
//
// Each in-training line falls into exactly one of three buckets, derived purely
// from the scheduler's own per-move data:
//
//   Due      – something is due right now (or never trained). Train it today.
//   Learning – not due yet, but still being cemented: at least one move is on a
//              short interval. A miss resets a move to a 1-day interval, so this
//              also captures lines with a recent slip.
//   Solid    – not due, and every move has graduated to a long interval.
//
// The cut between Learning and Solid is the interval (in days) at which a move
// counts as "settled". 21 days is a sensible line: SM-2 climbs 1 → 6 → ~15 → ~37,
// so a move only reaches 21+ after several clean recalls — by then it's earned
// "Solid". A line is only as solid as its weakest (shortest-interval) move.
export type LineBucket = 'due' | 'learning' | 'solid';

export const SETTLED_INTERVAL_DAYS = 21;

export function lineBucket(line: Line, now: Date = new Date()): LineBucket {
  if (lineIsDue(line, now)) return 'due';
  // Past the due check, every user-move has a review; the weakest move's
  // interval decides. (A defensive `?? 0` keeps an unreviewed move in Learning.)
  let minInterval = Infinity;
  for (const n of userMoveNodes(line.tree, line.colour)) {
    const iv = n.review?.interval ?? 0;
    if (iv < minInterval) minInterval = iv;
  }
  return minInterval < SETTLED_INTERVAL_DAYS ? 'learning' : 'solid';
}

// A 0–5 confidence for the My-Lines display, derived from how settled the
// line's moves are. A move's score is its consecutive clean reps (capped at 5);
// the line's confidence is the average, rounded. Mastered lines climb to 5;
// a fresh miss anywhere pulls it back down.
export function lineConfidence(line: Line): number {
  const nodes = userMoveNodes(line.tree, line.colour);
  if (nodes.length === 0) return 0;
  const scores = nodes.map(n => (n.review ? Math.min(5, n.review.reps) : 0));
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.round(avg);
}

// ── Session-picker orderings ─────────────────────────────────────────────────────
//
// The Train screen lets you pick what a session loads. These are the cheap,
// engine-free orderings behind those choices — each takes the training lines
// and returns them in the order that picker wants to drill.

// Total lifetime misses (lapses) across a line's user-moves. The "weakest"
// signal: a line you keep getting wrong has a high count.
export function lineMissCount(line: Line): number {
  return userMoveNodes(line.tree, line.colour)
    .reduce((sum, n) => sum + (n.review?.lapses ?? 0), 0);
}

// Newest first. Lines without a createdAt (older saves) sort last.
export function recentlyAddedLines(lines: Line[]): Line[] {
  return [...lines].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

// Most-missed first; ties broken by lower confidence so the shakiest lead.
export function weakestLines(lines: Line[]): Line[] {
  return [...lines].sort((a, b) =>
    lineMissCount(b) - lineMissCount(a) || a.confidence - b.confidence);
}

// A human label for a move/line's next due date, for small UI readouts.
export function describeDue(due: Date | null, now: Date = new Date()): string {
  if (due === null) return 'New';
  const days = Math.round((new Date(due).getTime() - now.getTime()) / DAY_MS);
  if (days <= 0) return 'Due now';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}
