// Transposition joins: "from here, continue as in that line".
//
// A repertoire is a TREE, and two move orders that reach the same position are
// two different branches of it. That is a deliberate choice (see
// REPERTOIRE-REDESIGN.md §9.5): a graph would merge them structurally, but a
// graph has no unique path to a line end, and a unique path is what training,
// notes and review records are all anchored to.
//
// A join is the opt-in version of the same idea, and it costs none of that. You
// mark one line end with "this is the Queen's Gambit by another road — carry on
// as in that line", and the line simply gets longer: the moves after the shared
// position are appended to it. They are the SAME nodes as the other line's, so
// drilling either one grades the same records; there is no second copy of
// anything.
//
// Three rules keep it safe, and all three matter:
//
//   • A join is only followed ONCE. The line it points into may have a join of
//     its own; that one is not taken, so no chain can run away.
//   • A continuation that would revisit a move already on the line is refused,
//     so a join can never make a loop.
//   • The join must land on the SAME POSITION. That is what makes it a
//     transposition rather than an arbitrary jump to somewhere else in the book.
//
// Pure: trees in, paths out. Exercised under Node by repertoire-join.selftest.ts.

import type { MoveNode } from './tree';
import { epdKey } from './openings';
import { linePaths, pathToNode } from './repertoire';

/** A hard ceiling on how much one join may add, whatever the target's length. */
export const MAX_JOIN_PLIES = 40;

/**
 * The line's full move path, following its join if it has a usable one.
 * Returns `originPath` unchanged when there is no join, or when the join no
 * longer resolves — a target that has since been deleted or moved simply stops
 * being followed, rather than breaking the line that pointed at it.
 */
export function joinedPath(root: MoveNode, originPath: MoveNode[]): MoveNode[] {
  const continuation = joinContinuation(root, originPath);
  return continuation.length ? [...originPath, ...continuation] : originPath;
}

/**
 * Just the moves a join adds, or an empty array. Split out because the UI wants
 * to say how many moves a join is worth before it is made.
 */
export function joinContinuation(root: MoveNode, originPath: MoveNode[]): MoveNode[] {
  const origin = originPath[originPath.length - 1];
  if (!origin?.joinTo) return [];

  const targetPath = pathToNode(root, origin.joinTo);
  if (!targetPath || targetPath.length === 0) return [];

  const cut = sharedPositionIndex(targetPath, origin);
  if (cut < 0) return [];

  const continuation = targetPath.slice(cut + 1, cut + 1 + MAX_JOIN_PLIES);
  if (continuation.length === 0) return [];

  // A continuation that walks back over the line's own moves would be a loop.
  const onPath = new Set(originPath.map(n => n.id));
  if (continuation.some(n => onPath.has(n.id))) return [];

  return continuation;
}

/** Where in the target's path the shared position sits, or -1. */
function sharedPositionIndex(targetPath: MoveNode[], origin: MoveNode): number {
  const key = epdKey(origin.fen);
  return targetPath.findIndex(n => n.id !== origin.id && epdKey(n.fen) === key);
}

// ── Offering a join ──────────────────────────────────────────────────────────

export interface JoinCandidate {
  /** The line end to point at — what gets stored in `joinTo`. */
  endId: string;
  /** How many moves the join would add. */
  moves: number;
  /** Those moves in SAN, for the offer's own words. */
  sans: string[];
  /** The target line's full path, so the caller can name it however it names lines. */
  path: MoveNode[];
}

/**
 * The lines this one could continue as: other lines in the same book that pass
 * through this exact position **by a different move order**, and that still have
 * moves left after it.
 *
 * A line that reaches the position down the same road is not a transposition —
 * the two simply have not parted yet — and it is excluded, which is the same
 * rule TRANSPOSITIONS.md applies everywhere else.
 */
export function joinCandidates(root: MoveNode, originPath: MoveNode[]): JoinCandidate[] {
  const origin = originPath[originPath.length - 1];
  if (!origin) return [];
  const key = epdKey(origin.fen);
  const originUcis = originPath.map(n => n.uci);

  const out: JoinCandidate[] = [];
  for (const path of linePaths(root)) {
    const end = path[path.length - 1];
    if (!end || end.id === origin.id) continue;

    const cut = path.findIndex(n => n.id !== origin.id && epdKey(n.fen) === key);
    if (cut < 0) continue;
    // Same road so far: a shared prefix, not a transposition.
    if (cut + 1 === originUcis.length
      && originUcis.every((u, i) => u === path[i]?.uci)) continue;

    const continuation = path.slice(cut + 1, cut + 1 + MAX_JOIN_PLIES);
    if (continuation.length === 0) continue;

    const onPath = new Set(originPath.map(n => n.id));
    if (continuation.some(n => onPath.has(n.id))) continue;

    out.push({
      endId: end.id,
      moves: continuation.length,
      sans: continuation.map(n => n.san),
      path,
    });
  }

  // Longest continuation first: the most useful join is the one that carries
  // the line furthest. Stable on ties by node id so the list never reshuffles.
  out.sort((a, b) => b.moves - a.moves || a.endId.localeCompare(b.endId));
  return out;
}

/** Is this line end pointing somewhere that still resolves? */
export function hasLiveJoin(root: MoveNode, originPath: MoveNode[]): boolean {
  return joinContinuation(root, originPath).length > 0;
}
