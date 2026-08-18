// The repertoire run: one walk through a book, asking each move once.
//
// The line walk and this mode answer different questions. Walking a LINE
// start-to-finish is muscle memory — you play the whole thing, in order, the way
// it happens in a game, and that is worth keeping. But a session made of line
// walks asks the shared opening over and over: six lines through 1.d4 d5 2.c4
// means answering 2.c4 six times in one sitting. Write-through fixes the SCORE
// afterwards (TRANSPOSITIONS.md §8); it cannot give you back the four minutes.
//
// A repertoire run walks the tree instead. Every move is a node, a node is
// visited once, and so the dedupe is structural rather than a filter that has to
// be kept honest. The order is depth-first, which reads as walking down a line
// and backing up to the last branch when it ends — the way you would go through
// a book by hand.
//
// Pure: repertoires in, positions out. Exercised under Node by
// repertoire-run.selftest.ts.

import type { MoveNode } from './tree';
import type { LinePriority } from './types';
import { isReviewDue } from './scheduler';
import {
  START_FEN, isUserMoveAtDepth, resolveTraining, resolvePriority, linePaths,
  type Repertoire,
} from './repertoire';
import { projectLine } from './lines-view';

/** One move the run will ask for. */
export interface RunPosition {
  repertoireId: string;
  /** The live node carrying the review record — graded in place by the runner. */
  expected: MoveNode;
  /** The position to show: the one this move is played FROM. */
  preFen: string;
  /** The opponent's move into `preFen`, for the little replay before the ask. */
  prevUci?: string;
  /** The position before that opponent move. */
  prevFen?: string;
  colour: 'white' | 'black';
  /** Resolved at this node, so a branch's own spacing is respected. */
  priority: LinePriority;
  /** A line through this move — for the name, the peek, and cross-book credit. */
  lineId: string;
  lineName: string;
  /** 1-based ply. */
  depth: number;
  due: boolean;
}

export interface RunPlan {
  positions: RunPosition[];
  /** Distinct trainable moves in the books walked. */
  totalMoves: number;
  /** How many of those are due right now. */
  dueMoves: number;
  /**
   * What the SAME material costs as line walks — every in-training line's user
   * moves, added up. Counted over exactly the moves the run itself covers (the
   * opening plies below `minDepth` are excluded from both sides), because a
   * figure that compared two different sets would overstate the saving by
   * counting moves that are never asked at all.
   */
  asLineWalks: number;
}

// A comfortable ceiling on one sitting, matching the individual-moves mode.
const DEFAULT_MAX = 24;

// Move 1–2 is shared by half the book and too easy to be worth a rep. Same floor
// the individual-moves mode uses, for the same reason.
const MIN_DEPTH = 3;

export interface RunOptions {
  now?: Date;
  max?: number;
  /** Ask everything trainable, not just what's due. */
  includeAll?: boolean;
  /** Only this book (the repertoire screen's selection). */
  repertoireId?: string;
  minDepth?: number;
}

/**
 * Plan a run over the given books. Archived books are skipped outright — that is
 * what putting a book aside means — as are branches the user has paused.
 */
export function planRepertoireRun(reps: Repertoire[], opts: RunOptions = {}): RunPlan {
  const now = opts.now ?? new Date();
  const max = opts.max ?? DEFAULT_MAX;
  const minDepth = opts.minDepth ?? MIN_DEPTH;

  const all: RunPosition[] = [];
  let asLineWalks = 0;

  for (const rep of reps) {
    if (rep.archived) continue;
    if (opts.repertoireId && rep.id !== opts.repertoireId) continue;

    // One projection pass gives every node a line to be named by. The first line
    // to reach a node claims it, which is the depth-first order the walk uses,
    // so a shared opening is named after the line the run reaches it through.
    const owner = new Map<string, { id: string; name: string }>();
    for (const path of linePaths(rep.tree)) {
      const line = projectLine(rep, path);
      if (!resolveTraining(path)) continue;
      asLineWalks += path.filter(
        (_, i) => isUserMoveAtDepth(i + 1, rep.colour) && i + 1 >= minDepth).length;
      for (const node of path) {
        if (!owner.has(node.id)) owner.set(node.id, { id: line.id, name: line.name });
      }
    }

    // Depth-first, in child order: down a line, then back to the last branch.
    const walk = (node: MoveNode, path: MoveNode[]): void => {
      for (const child of node.children) {
        const next = [...path, child];
        const depth = next.length;
        if (isUserMoveAtDepth(depth, rep.colour) && resolveTraining(next) && depth >= minDepth) {
          const named = owner.get(child.id);
          if (named) {
            all.push({
              repertoireId: rep.id,
              expected: child,
              preFen: depth >= 2 ? next[depth - 2].fen : START_FEN,
              prevUci: depth >= 2 ? next[depth - 2].uci : undefined,
              prevFen: depth >= 3 ? next[depth - 3].fen : depth === 2 ? START_FEN : undefined,
              colour: rep.colour,
              priority: resolvePriority(next) ?? 'standard',
              lineId: named.id,
              lineName: named.name,
              depth,
              due: isReviewDue(child.review, now),
            });
          }
        }
        walk(child, next);
      }
    };
    walk(rep.tree, []);
  }

  const dueMoves = all.filter(p => p.due).length;

  // Due first. With nothing due the mode still has to be playable, so it falls
  // back to whatever comes round soonest rather than being a dead end.
  let chosen = opts.includeAll ? all : all.filter(p => p.due);
  if (chosen.length === 0) {
    chosen = [...all]
      .sort((a, b) => dueTime(a, now) - dueTime(b, now))
      .slice(0, max);
  }

  // Cap, then put the survivors back into walk order — a run that jumped about
  // would lose the one thing that makes it feel like going through a book.
  const order = new Map(all.map((p, i) => [p, i]));
  const positions = chosen
    .slice(0, max)
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

  return { positions, totalMoves: all.length, dueMoves, asLineWalks };
}

function dueTime(p: RunPosition, now: Date): number {
  return p.expected.review ? new Date(p.expected.review.due).getTime() : now.getTime();
}

/**
 * The sentence the mode card carries. Silent about the saving unless there is
 * one worth mentioning — "0 fewer repeats" is noise, and on a book with no
 * shared openings the two numbers are simply equal.
 */
export function runSavingNote(plan: RunPlan): string | null {
  const saved = plan.asLineWalks - plan.totalMoves;
  if (saved <= 0) return null;
  return saved === 1
    ? 'one move you’d otherwise answer twice'
    : `${saved} repeated moves you’d otherwise answer twice`;
}
