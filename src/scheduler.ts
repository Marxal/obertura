import type { Line, LinePriority } from './types';
import type { MoveNode } from './tree';
import { byNewestFirst } from './lines-view';

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

// ── Line priority ───────────────────────────────────────────────────────────
//
// A per-line multiplier on the WAIT between reviews. High priority sees a line
// at 60% of the gap SM-2 asked for, low priority at 170% of it.
//
// WHY IT MULTIPLIES THE WAIT AND NOT THE INTERVAL. The obvious implementation —
// scale `interval` when it's written — compounds: the scaling lands on a number
// that is itself the input to the next step's `interval × ease`, so after five
// reps a "slightly more often" line is coming round twenty times more often
// than intended, and a low-priority one has effectively left the rotation. So
// `interval` stays the pure SM-2 ladder and the multiplier is applied once, to
// the due DATE. The effect is exactly "this line is asked about 40% sooner,
// every time", at every point on the ladder, and it can't run away.
//
// It also keeps `interval` meaning one thing. Everything else that reads it —
// the Learning/Solid buckets, SETTLED_INTERVAL_DAYS — is asking "how well is
// this known?", which is a fact about the user's memory and has nothing to do
// with how often they've chosen to be asked.
export const PRIORITY_SPACING: Record<LinePriority, number> = {
  high: 0.6,
  standard: 1,
  low: 1.7,
};

// Order for "which of these due lines first?" — a high-priority line leads a
// session it shares with standard ones.
const PRIORITY_RANK: Record<LinePriority, number> = { high: 0, standard: 1, low: 2 };

export const DEFAULT_PRIORITY: LinePriority = 'standard';

// A line's priority, defaulting for the lines saved before the field existed.
export function linePriority(line: Line): LinePriority {
  const p = line.priority;
  return p === 'high' || p === 'low' || p === 'standard' ? p : DEFAULT_PRIORITY;
}

export function lineSpacing(line: Line): number {
  return PRIORITY_SPACING[linePriority(line)];
}

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
//
// `spacing` is the line's priority multiplier (see PRIORITY_SPACING). It scales
// the WAIT — the distance from now to the due date — and deliberately not the
// stored interval, which stays the pure SM-2 ladder.
export function gradeReview(
  prev: Review, quality: number, now: Date = new Date(), spacing = 1,
): Review {
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

  // Clamped so a caller passing a nonsense multiplier can't park a move forever
  // or make it permanently due.
  const factor = Math.max(0.25, Math.min(4, spacing));
  const due = new Date(now.getTime() + interval * factor * DAY_MS);
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

// ── New material vs. review ─────────────────────────────────────────────────
//
// THE BUG THIS FIXES. A line you add today is due the moment it is saved — its
// moves have no review record, and `isReviewDue` treats "never trained" as due.
// So it joins the due pile immediately. What it did NOT do was ever come UP:
// the due pile used to be handed out in book order (the depth-first walk of the
// tree), `mergePath` appends a new branch after its siblings, and a session is
// served in rounds of five while the daily challenge takes the first three. A
// just-graded line comes back due in one day, so the same handful at the front
// of the book was re-served every day and a line added later never surfaced.
// The line was in training, correctly; it was simply always eleventh in a queue
// that only ever got five deep.
//
// THE FIX, in two halves:
//
//   · Reviews are ordered by how LATE they are, not by where they sit in the
//     book — lateness measured against the move's own interval, so a 2-day
//     lapse on a 1-day move outranks a week's slip on a 3-month one. Nothing
//     can hide at the back of a book any more.
//
//   · New material is INTERLEAVED rather than sorted in. Putting never-trained
//     lines first would let one afternoon of adding twenty lines flush the
//     day's reviews; putting them last is the bug. So one slot in every three
//     is reserved for new material while any is waiting — first slot, then the
//     fourth, then the seventh. A round of five carries two new lines; the
//     daily challenge's three carry one. Neither can starve the other.
//
// Both halves live here because `dueLines` is the one door: the Train hero's
// "Full lines", the Home screen's "Start training" and the daily challenge's
// lines task all queue from it.

/** One slot in every N is reserved for never-trained material. */
export const NEW_MATERIAL_CADENCE = 3;

/**
 * How overdue a review is, in multiples of its own interval: 0 = not due yet or
 * due this instant, 1 = a whole interval has passed since it came due, Infinity
 * = never trained.
 *
 * Relative, not absolute, because absolute lateness is dominated by whatever
 * has the longest interval. A move on a 1-day interval that is 2 days late has
 * been forgotten; a move on a 90-day interval that is 2 days late has not.
 */
export function reviewOverdueness(review: Review | undefined, now: Date = new Date()): number {
  if (!review) return Infinity;
  const late = (now.getTime() - new Date(review.due).getTime()) / DAY_MS;
  if (late <= 0) return 0;
  return late / Math.max(1, review.interval);
}

/** A line's most-overdue user move — what the line as a whole is judged on. */
export function lineOverdueness(line: Line, now: Date = new Date()): number {
  let worst = 0;
  for (const n of userMoveNodes(line.tree, line.colour)) {
    const o = reviewOverdueness(n.review, now);
    if (o > worst) worst = o;
  }
  return worst;
}

/**
 * Does this line hold a move that has never been trained? True for a line just
 * added, and also for one just EXTENDED — the shared opening moves carry their
 * records, the new tail doesn't, and the new tail is the part you can't play.
 */
export function hasNewMoves(line: Line): boolean {
  return userMoveNodes(line.tree, line.colour).some(n => !n.review);
}

/**
 * Weave two queues together, giving `fresh` every `cadence`-th slot and `seen`
 * the rest. When either runs dry the other simply drains — so a repertoire with
 * nothing new behaves exactly as it did before this existed.
 */
export function interleaveNew<T>(
  fresh: T[], seen: T[], cadence: number = NEW_MATERIAL_CADENCE,
): T[] {
  const out: T[] = [];
  let f = 0, s = 0;
  while (f < fresh.length || s < seen.length) {
    const wantsNew = out.length % cadence === 0;
    if (f < fresh.length && (wantsNew || s >= seen.length)) out.push(fresh[f++]);
    else out.push(seen[s++]);
  }
  return out;
}

// Every in-training line that has a due move, in the order a session should
// walk them: highest priority first, then new material woven through reviews at
// NEW_MATERIAL_CADENCE, with the reviews themselves most-overdue first. Lines
// that tie on all of that keep their input order, so the ordering is stable.
export function dueLines(lines: Line[], now: Date = new Date()): Line[] {
  const due = lines.filter(l => l.inTraining && lineIsDue(l, now));
  const rank = (l: Line): number => PRIORITY_RANK[linePriority(l)];

  // Stable sort helper: index carried alongside so ties fall back to input order
  // whatever the engine's own sort stability does with a mixed comparator.
  const order = (pool: Line[], cmp: (a: Line, b: Line) => number): Line[] =>
    pool.map((line, i) => ({ line, i }))
      .sort((a, b) => rank(a.line) - rank(b.line) || cmp(a.line, b.line) || a.i - b.i)
      .map(x => x.line);

  // New material is served oldest-first. Adding three lines on Monday and two
  // more on Wednesday must not push Monday's remaining ones further back every
  // time you add something — first in, first drilled.
  const fresh = order(due.filter(hasNewMoves), (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const seen = order(due.filter(l => !hasNewMoves(l)),
    (a, b) => lineOverdueness(b, now) - lineOverdueness(a, now));

  return interleaveNew(fresh, seen);
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
  return [...lines].sort(byNewestFirst);
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
