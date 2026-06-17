import type { Line } from './types';
import { dueLines } from './scheduler';

// ── A training session ──────────────────────────────────────────────────────────
//
// A session is an ordered queue of lines to walk today, once each. It starts as
// the set of due lines (or an explicit list) and only shrinks as you work
// through it. Missed material isn't replayed here — it's handled at the end by
// the "Try your mistakes again" review (failed positions only) and by the
// scheduler bringing the move back due sooner.
//
// No DOM here — the queue logic stands alone and is covered by the self-test.

export interface SessionItem {
  line: Line;
}

export class TrainingSession {
  private queue: SessionItem[] = [];
  // How many lines the session started with — the denominator for the
  // session-level "Line X of Y" progress bar.
  readonly initialCount: number;

  // Build from a pool of lines (only the due ones are queued), or pass an
  // explicit list of lines to force into the queue (used for single-line
  // practice, where you may want to drill a line that isn't strictly due yet).
  constructor(lines: Line[], opts: { now?: Date; explicit?: boolean } = {}) {
    const now = opts.now ?? new Date();
    const initial = opts.explicit ? lines : dueLines(lines, now);
    this.queue = initial.map(line => ({ line }));
    this.initialCount = this.queue.length;
  }

  get remaining(): number {
    return this.queue.length;
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  // A peek at the upcoming line ids, for debug readouts.
  upcomingIds(): string[] {
    return this.queue.map(it => it.line.id);
  }

  next(): SessionItem | null {
    return this.queue.shift() ?? null;
  }
}
