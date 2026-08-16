// The pure half of "what does the position index change about saving a line?".
//
// Kept out of main.ts so it can be exercised under plain Node (see
// save-index.selftest.ts) — main.ts is 4 500 lines of DOM and cannot be.
// See TRANSPOSITIONS.md §5, §6 and §7 for the decisions these implement.

import type { Line } from './types';
import type { MoveNode } from './tree';
import type { Review } from './scheduler';
import type { PositionIndex } from './position-index';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// The mainline, the same children[0] chain every other reader walks.
function mainlineNodes(tree: MoveNode): MoveNode[] {
  const out: MoveNode[] = [];
  let node = tree.children[0];
  while (node) {
    out.push(node);
    node = node.children[0];
  }
  return out;
}

/**
 * Tags on `line` that the stored line doesn't have yet — the whole content of
 * the "Add tag to …" offer (TRANSPOSITIONS.md §5). Case- and whitespace-
 * insensitive, since "vs Anna" and "vs anna " are the same tag to a human.
 */
export function missingTags(line: Line, other: Line): string[] {
  const have = new Set(other.tags.map(t => t.trim().toLowerCase()));
  const out: string[] = [];
  for (const t of line.tags) {
    const k = t.trim().toLowerCase();
    if (!k || have.has(k)) continue;
    have.add(k); // a duplicate inside the new line's own tags counts once
    out.push(t);
  }
  return out;
}

/**
 * Which of two review records shows the move is better known — TRANSPOSITIONS.md
 * §10: the longest interval wins, then the most consecutive clean reps, then the
 * higher ease. Ties keep `a`.
 */
export function betterReview(a: Review, b: Review): Review {
  if (b.interval !== a.interval) return b.interval > a.interval ? b : a;
  if (b.reps !== a.reps) return b.reps > a.reps ? b : a;
  return b.ease > a.ease ? b : a;
}

// A detached copy. The two lines' records must not alias: a later drill grades
// each node independently, and `due` is a Date that a shared reference would
// carry across both.
function cloneReview(r: Review): Review {
  return { ease: r.ease, interval: r.interval, reps: r.reps, lapses: r.lapses, due: new Date(r.due) };
}

export interface InheritResult {
  /** User moves that took a record from another line. */
  inherited: number;
  /** User moves in the line altogether — the denominator for the save toast. */
  userMoves: number;
}

/**
 * Give a line being saved the training it has already had elsewhere
 * (TRANSPOSITIONS.md §7). For every USER move, look up position + move in the
 * index; if another line already holds a review record for that exact move from
 * that exact position, copy the best one onto this node.
 *
 * Mutates `line.tree`, and must therefore run BEFORE the line is written and
 * before the enrolment path, so the confirm run and the scheduler both see the
 * inherited state.
 *
 * Only ever fills a node that has NO record of its own — a move this line has
 * already been drilled on keeps its own history, so this is equally safe on an
 * edited line as on a new one.
 */
export function inheritReviews(line: Line, index: PositionIndex): InheritResult {
  const nodes = mainlineNodes(line.tree);
  let inherited = 0;
  let userMoves = 0;

  let fromFen = START_FEN;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isUserMove = line.colour === 'white' ? i % 2 === 0 : i % 2 === 1;
    const parentFen = fromFen;
    fromFen = node.fen;
    if (!isUserMove) continue;
    userMoves++;
    if (node.review) continue;

    let best: Review | null = null;
    for (const e of index.entriesAt(parentFen)) {
      if (e.lineId === line.id || !e.isUserMove || e.uci !== node.uci) continue;
      const r = e.node.review;
      if (!r) continue;
      best = best ? betterReview(best, r) : r;
    }
    if (best) {
      node.review = cloneReview(best);
      inherited++;
    }
  }

  return { inherited, userMoves };
}

/**
 * The save toast's extra sentence, or null when there is nothing to report.
 * Silent at zero, as specified — "0 of these 10 moves you already know" is noise.
 */
export function inheritanceNote(r: InheritResult): string | null {
  if (r.inherited <= 0) return null;
  return `${r.inherited} of these ${r.userMoves} moves you already know.`;
}
