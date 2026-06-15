import type { Line } from './types';
import { dueLines, resurfaceGap } from './scheduler';

// ── A training session ──────────────────────────────────────────────────────────
//
// A session is an ordered queue of lines to walk today. It starts as the set of
// due lines, and it grows: when you miss moves in a line, that line is
// re-inserted a few positions later so the shaky material comes back before you
// finish. The more you've missed a line across the session, the sooner it
// returns (see resurfaceGap). A per-line cap stops a stubborn line from looping
// forever, so every session terminates.
//
// No DOM here — the queue logic stands alone and is covered by the self-test.

export interface SessionItem {
  line: Line;
  // false on a line's first appearance; true when it has been resurfaced after
  // a miss. The driver grades moves only on the first pass; resurfaced passes
  // are pure reinforcement and don't touch the schedule.
  isResurface: boolean;
}

export class TrainingSession {
  private queue: SessionItem[] = [];
  private resurfaceCount = new Map<string, number>();
  private cumulativeMisses = new Map<string, number>();
  readonly maxResurface: number;
  // How many lines the session started with (first-pass lines only, before any
  // resurfacing). The denominator for the session-level "Line X of Y" progress
  // bar — resurfaced reviews are bonus reinforcement and don't inflate it.
  readonly initialCount: number;

  // Build from a pool of lines (only the due ones are queued), or pass an
  // explicit list of lines to force into the queue (used for single-line
  // practice, where you may want to drill a line that isn't strictly due yet).
  constructor(
    lines: Line[],
    opts: { now?: Date; explicit?: boolean; maxResurface?: number } = {}
  ) {
    const now = opts.now ?? new Date();
    this.maxResurface = opts.maxResurface ?? 3;
    const initial = opts.explicit ? lines : dueLines(lines, now);
    this.queue = initial.map(line => ({ line, isResurface: false }));
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

  // Re-insert a missed line later in the queue. `missesThisPass` is how many
  // distinct moves were missed on the pass that just finished. Returns true if
  // the line was actually re-queued (false once the per-line cap is hit).
  resurface(line: Line, missesThisPass: number): boolean {
    const used = this.resurfaceCount.get(line.id) ?? 0;
    if (used >= this.maxResurface) return false;
    this.resurfaceCount.set(line.id, used + 1);

    const total = (this.cumulativeMisses.get(line.id) ?? 0) + missesThisPass;
    this.cumulativeMisses.set(line.id, total);

    const gap = resurfaceGap(total);
    const pos = Math.min(gap, this.queue.length);
    this.queue.splice(pos, 0, { line, isResurface: true });
    return true;
  }
}
