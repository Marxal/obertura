// Merging saved lines into ONE map tree — the data half of repertoire-map.ts.
//
// DOM-free on purpose, so the merge (and above all its loop guards) can be
// exercised under Node by map-merge.selftest.ts.
//
// Two merge modes:
//
//   'path'     — the original. A child is matched by its UCI INSIDE its parent,
//                so two lines share nodes only while they have not parted. One
//                route per node, always a tree, cannot loop.
//
//   'position' — the tree view in My Lines. A child is matched by its POSITION
//                KEY across the whole map, so two lines that transpose into each
//                other land on ONE node and continue once.
//
// The position merge is the only one that can produce a cycle: a position can be
// reached again later, by a repetition (1.Nf3 Nf6 2.Ng1 Ng8 is the same key
// again — same board, side to move, castling and en passant) or by two lines
// crossing over each other. See the "loop guards" note below.

import type { Line } from './types';
import type { MoveNode } from './tree';
import { epdKey } from './openings';
import type { StatNode } from './move-stats';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// A hard ceiling on how deep any map is built, on top of whatever the caller
// asks for. Nothing in a repertoire needs 40 moves of tree, and it means a walk
// is bounded even before the structural guard below applies.
export const MAX_MAP_PLIES = 80;

export type MergeMode = 'path' | 'position';

/**
 * A route into a position OTHER than the one that created its node — the whole
 * point of the position merge, and the thing that must never become a child
 * edge. `san`/`uci` are THIS route's move, which differs from the node's own
 * (that is what makes it a different route).
 */
export interface MapEdge {
  to: MapNode;
  san: string;
  uci: string;
  /**
   * True when the target sits at or above the source's depth — a repetition or
   * a cross-over, i.e. exactly the edge that would have closed a loop.
   */
  back: boolean;
}

export interface MapNode {
  san: string;
  uci: string;
  fen: string;
  lineIds: string[];
  /**
   * The spanning-tree children — the ONLY edges any walker follows. A node is
   * pushed here exactly once, when it is created, so every node has exactly one
   * parent and depth strictly increases along these edges.
   */
  children: MapNode[];
  parent: MapNode | null;
  /** Half-moves from the start along the route that created this node. */
  depth: number;
  /** Position-merge only: other routes LEAVING this node. Drawn, never walked. */
  altOut: MapEdge[];
  /** Position-merge only: how many other routes ARRIVE here (0 = not merged). */
  altIn: number;
  /**
   * Distinct moves the USER has from this position — 0 at an opponent-to-move
   * node. More than one means more than one answer saved here.
   */
  answers: number;
  x: number;
  y: number;
  svgEl: SVGGElement | null; // set during SVG build
  stats: StatNode | null;    // stamped by attachStats when a stats lookup is set
}

function newNode(
  san: string, uci: string, fen: string, parent: MapNode | null, depth: number,
): MapNode {
  return {
    san, uci, fen, lineIds: [], children: [], parent, depth,
    altOut: [], altIn: 0, answers: 0,
    x: 0, y: 0, svgEl: null, stats: null,
  };
}

/** FEN field 2 — whose turn it is AT this position. */
export function sideToMove(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

/** FEN field 2: 'b' = black to move, meaning white just played. */
export function movedBy(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'b' ? 'white' : 'black';
}

export function buildMergedTree(
  lines: Line[],
  maxPlies = Infinity,
  mode: MergeMode = 'path',
  colour?: 'white' | 'black',
): MapNode {
  const root = newNode('', '', START_FEN, null, 0);
  const cap = Math.min(maxPlies, MAX_MAP_PLIES);

  if (mode === 'position') {
    const byKey = new Map<string, MapNode>([[epdKey(START_FEN), root]]);
    for (const l of lines) mergeByPosition(root, l.tree, l.id, cap, byKey);
    // Belt and braces: the construction above cannot produce a cycle, and this
    // says so out loud by severing one if it ever finds one. Cheap (one pass)
    // and it is what stops a future edit to the merge from reaching the layout.
    pruneCycles(root);
  } else {
    for (const l of lines) mergeByPath(root, l.tree, l.id, cap);
  }

  markAnswers(root, colour);
  return root;
}

// ── Path merge (unchanged behaviour) ─────────────────────────────────────────

// `depthLeft` is the plies still allowed below `parent`; at 0 we stop, which is
// how "Go deeper" truncates a long line to the current render depth.
function mergeByPath(parent: MapNode, src: MoveNode, lineId: string, depthLeft: number): void {
  if (depthLeft <= 0) return;
  for (const sc of src.children) {
    let ex = parent.children.find(c => c.uci === sc.uci);
    if (!ex) {
      ex = newNode(sc.san, sc.uci, sc.fen, parent, parent.depth + 1);
      parent.children.push(ex);
    }
    if (!ex.lineIds.includes(lineId)) ex.lineIds.push(lineId);
    mergeByPath(ex, sc, lineId, depthLeft - 1);
  }
}

// ── Position merge, and its loop guards ──────────────────────────────────────
//
// The recursion below walks the SOURCE line's own tree, never the map graph, so
// it is bounded by that line's length no matter what shape the map takes.
//
// The map stays walkable because of one rule: a node joins `parent.children`
// ONLY in the branch that creates it. Every later route into that position —
// whether a genuine transposition (the other line gets there deeper) or a
// repetition (it gets there again at or above its own depth) — is recorded as an
// `altOut` edge, which is drawn and counted but never followed. So child edges
// always run from depth d to depth d+1, and a walk down them terminates.
//
// The line's continuation is NOT lost when a route is demoted: we still descend
// into the shared node, so the moves after the transposition attach to it. That
// is exactly the "two lines that transpose continue once" behaviour.
function mergeByPosition(
  parent: MapNode,
  src: MoveNode,
  lineId: string,
  depthLeft: number,
  byKey: Map<string, MapNode>,
): void {
  if (depthLeft <= 0) return;
  for (const sc of src.children) {
    const key = epdKey(sc.fen);
    let node = byKey.get(key);
    if (!node) {
      node = newNode(sc.san, sc.uci, sc.fen, parent, parent.depth + 1);
      byKey.set(key, node);
      parent.children.push(node);
    } else if (node !== parent && node.parent !== parent) {
      // A second route into a position we already have.
      if (!parent.altOut.some(e => e.to === node)) {
        parent.altOut.push({
          to: node, san: sc.san, uci: sc.uci, back: node.depth <= parent.depth,
        });
        node.altIn++;
      }
    }
    if (!node.lineIds.includes(lineId)) node.lineIds.push(lineId);
    mergeByPosition(node, sc, lineId, depthLeft - 1, byKey);
  }
}

/**
 * Walk the finished tree with a visited set and an on-path set, and demote any
 * child edge that would revisit a node to an alt edge. Returns how many edges it
 * had to sever — 0 for a correctly built map, which is what the self-test
 * asserts, repetitions and cross-overs included.
 */
export function pruneCycles(root: MapNode): number {
  const visited = new Set<MapNode>();
  const onPath = new Set<MapNode>();
  let severed = 0;

  const walk = (n: MapNode, depthLeft: number): void => {
    visited.add(n);
    onPath.add(n);
    const keep: MapNode[] = [];
    for (const c of n.children) {
      if (onPath.has(c) || visited.has(c) || depthLeft <= 0) {
        severed++;
        if (!n.altOut.some(e => e.to === c)) {
          n.altOut.push({ to: c, san: c.san, uci: c.uci, back: c.depth <= n.depth });
          c.altIn++;
        }
        continue;
      }
      keep.push(c);
    }
    n.children = keep;
    for (const c of keep) walk(c, depthLeft - 1);
    onPath.delete(n);
  };

  walk(root, MAX_MAP_PLIES);
  return severed;
}

// ── "More than one answer here" ──────────────────────────────────────────────

/**
 * Stamp each node with how many DISTINCT moves the user has from that position —
 * children plus alt routes out, deduped by UCI. Opponent-to-move nodes get 0:
 * several opponent replies is a fork, not a choice you have to make.
 */
function markAnswers(root: MapNode, colour?: 'white' | 'black'): void {
  if (!colour) return;
  const seen = new Set<MapNode>();
  const walk = (n: MapNode): void => {
    if (seen.has(n)) return;
    seen.add(n);
    if (sideToMove(n.fen) === colour) {
      const moves = new Set<string>();
      for (const c of n.children) moves.add(c.uci);
      for (const e of n.altOut) moves.add(e.uci);
      n.answers = moves.size;
    }
    for (const c of n.children) walk(c);
  };
  walk(root);
}

// ── Small shared walkers ─────────────────────────────────────────────────────

/** Every node in the spanning tree, root first. Visited-guarded. */
export function allNodes(root: MapNode): MapNode[] {
  const out: MapNode[] = [];
  const seen = new Set<MapNode>();
  const walk = (n: MapNode): void => {
    if (seen.has(n)) return;
    seen.add(n);
    out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}
