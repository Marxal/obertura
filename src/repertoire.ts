// The repertoire: ONE move tree per book, and the pure operations on it.
//
// This is the model the app moved to in the redesign (see REPERTOIRE-REDESIGN.md
// at the repo root). The short version:
//
//   • A REPERTOIRE is what's stored — a named book of one colour holding a
//     single move tree. "My White lines", "London for blitz", "vs Anna".
//   • A LINE is DERIVED — the path from the root to a line end. Nothing about a
//     line is stored as a record; its name, tags, training state and priority
//     are resolved from the nodes along its path (see lines-view.ts, which does
//     the projection).
//
// So the same moves are never stored twice. Two answers at a position are two
// children of one node, and everything before them is literally shared — which
// is what makes drilling, scoring, tagging and deleting behave sanely without
// the duplicate-reconciliation machinery the flat-line model needed.
//
// DOM-free and storage-free on purpose, so all of it is exercised under Node by
// repertoire.selftest.ts.

import type { MoveNode } from './tree';
import type { LinePriority } from './types';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** A book of one colour. `tree` is the root — a move-less node at START_FEN. */
export interface Repertoire {
  id: string;
  name: string;
  colour: 'white' | 'black';
  tree: MoveNode;
  createdAt: number;
  /** Kept but out of the way: excluded from training and the default views. */
  archived?: boolean;
}

/** The two books every account starts with. */
export const DEFAULT_REPERTOIRE_NAMES: Record<'white' | 'black', string> = {
  white: 'My White lines',
  black: 'My Black lines',
};

export function emptyTree(): MoveNode {
  return { id: 'root', san: '', uci: '', fen: START_FEN, children: [] };
}

export function newRepertoire(
  colour: 'white' | 'black', name?: string, id?: string,
): Repertoire {
  return {
    id: id ?? newId(),
    name: name ?? DEFAULT_REPERTOIRE_NAMES[colour],
    colour,
    tree: emptyTree(),
    createdAt: Date.now(),
  };
}

// crypto.randomUUID exists in every browser we target and in Node 22 (the
// self-test runner), but guard anyway so this module never depends on it.
function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// ── Node ids ─────────────────────────────────────────────────────────────────
//
// Ids must be unique WITHIN a repertoire: a derived line is addressed by its end
// node's id, and the write-back path finds a node by id. They are not required
// to be unique across repertoires, and nothing persists them outside the tree
// they live in.
//
// The generator is seeded by scanning the tree, exactly as tree.ts does, so a
// merge into a loaded repertoire can never collide with an existing id — and it
// stays deterministic, which is what makes the self-tests readable.

export type IdFactory = () => string;

export function makeIdFactory(root: MoveNode): IdFactory {
  let max = scanMaxId(root);
  return () => `n${++max}`;
}

function scanMaxId(node: MoveNode): number {
  let max = 0;
  const m = node.id.match(/^n(\d+)$/);
  if (m) max = parseInt(m[1], 10);
  for (const child of node.children) max = Math.max(max, scanMaxId(child));
  return max;
}

// ── Walking ──────────────────────────────────────────────────────────────────

/** Every node in the tree, root FIRST. */
export function allNodes(root: MoveNode): MoveNode[] {
  const out: MoveNode[] = [];
  const walk = (n: MoveNode): void => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

/** How many moves the book holds — the root is not a move. */
export function moveCount(root: MoveNode): number {
  return allNodes(root).length - 1;
}

export function findNode(root: MoveNode, id: string): MoveNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * The moves from the root down to `id`, root EXCLUDED (it isn't a move). Empty
 * when the id is the root's own, null when it isn't in this tree at all — the
 * two are different answers and callers care which.
 */
export function pathToNode(root: MoveNode, id: string): MoveNode[] | null {
  if (root.id === id) return [];
  const walk = (node: MoveNode, trail: MoveNode[]): MoveNode[] | null => {
    for (const child of node.children) {
      const next = [...trail, child];
      if (child.id === id) return next;
      const found = walk(child, next);
      if (found) return found;
    }
    return null;
  };
  return walk(root, []);
}

/** The parent of `id`, or null for the root / an id not in this tree. */
export function parentOf(root: MoveNode, id: string): MoveNode | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = parentOf(child, id);
    if (found) return found;
  }
  return null;
}

// ── Line ends ────────────────────────────────────────────────────────────────
//
// A line ends at a LEAF, or at any node explicitly marked `endpoint` — which is
// how "this is a line in its own right, even though I've prepared more moves
// past it" gets said. A marked node with children yields its own line AND its
// descendants keep yielding theirs.

export function isLineEnd(node: MoveNode): boolean {
  return node.children.length === 0 || node.endpoint === true;
}

/** Every line end in the tree, in a stable depth-first order. */
export function lineEnds(root: MoveNode): MoveNode[] {
  return allNodes(root).filter(n => n !== root && isLineEnd(n));
}

/**
 * Every derived line as its path of moves, in the same order as lineEnds. A
 * repertoire with no moves has no lines — not one empty line.
 */
export function linePaths(root: MoveNode): MoveNode[][] {
  const out: MoveNode[][] = [];
  const walk = (node: MoveNode, trail: MoveNode[]): void => {
    if (node !== root && isLineEnd(node)) out.push(trail);
    for (const child of node.children) walk(child, [...trail, child]);
  };
  walk(root, []);
  return out;
}

// ── Inherited properties ─────────────────────────────────────────────────────
//
// THE RULE THAT MAKES A BIG REPERTOIRE MANAGEABLE: `training`, `priority` and
// `tags` set on a node apply to everything below it unless a deeper node says
// otherwise. Pausing the whole French is one toggle at the 1…e6 node rather
// than twenty rows in a list, and tagging a branch tags every line through it.
//
// Resolution runs from the DEEPEST node up, so the most specific answer wins.

export const DEFAULT_TRAINING = true;

/** Nearest explicit `training` up the path; on by default. */
export function resolveTraining(path: MoveNode[]): boolean {
  for (let i = path.length - 1; i >= 0; i--) {
    const v = path[i].training;
    if (typeof v === 'boolean') return v;
  }
  return DEFAULT_TRAINING;
}

/** Nearest explicit `priority` up the path; 'standard' by default. */
export function resolvePriority(path: MoveNode[]): LinePriority | undefined {
  for (let i = path.length - 1; i >= 0; i--) {
    const v = path[i].priority;
    if (v === 'high' || v === 'low' || v === 'standard') return v;
  }
  return undefined;
}

/**
 * Every tag on the path, outermost first, de-duplicated case-insensitively —
 * tags ACCUMULATE rather than override, because a tag names something true
 * about the branch and a deeper branch doesn't stop it being true.
 */
export function resolveTags(path: MoveNode[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const node of path) {
    for (const tag of node.tags ?? []) {
      const key = tag.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

/** The deepest pinned `label` on the path, or null when nothing is named. */
export function resolveLabel(path: MoveNode[]): string | null {
  for (let i = path.length - 1; i >= 0; i--) {
    const v = path[i].label;
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

// ── Merging moves in ─────────────────────────────────────────────────────────

export interface MergeStep {
  san: string;
  uci: string;
  fen: string;
  /** Carried over when the move is new (a note typed while building, say). */
  extra?: Partial<MoveNode>;
}

export interface MergeResult {
  /** The node the last move arrives at — the line end, if it is one. */
  end: MoveNode;
  /** Nodes actually created. Empty when every move was already prepared. */
  added: MoveNode[];
}

/**
 * Merge a path of moves into the tree, creating only what isn't there.
 *
 * This is the whole "no more duplicates" behaviour in one function: saving
 * 1.d4 d5 2.c4 c5 3.e4 onto a book that already had the first four half-moves
 * adds ONE node. Matching is by UCI within the parent, so a move that is already
 * prepared is walked onto rather than re-created, and the review record, note and
 * annotation it has built up are left exactly as they are.
 *
 * A second, different move at a position is simply an additional child — that is
 * a second answer, not a replacement. Replacing is `removeSubtree` first, which
 * the builder does deliberately and asks about.
 */
export function mergePath(
  root: MoveNode,
  steps: MergeStep[],
  nextId: IdFactory = makeIdFactory(root),
  now: number = Date.now(),
): MergeResult {
  let cursor = root;
  const added: MoveNode[] = [];
  for (const step of steps) {
    let child = cursor.children.find(c => c.uci === step.uci);
    if (!child) {
      child = {
        createdAt: now,
        ...step.extra,
        id: nextId(),
        san: step.san,
        uci: step.uci,
        fen: step.fen,
        children: [],
      };
      cursor.children.push(child);
      added.push(child);
    }
    cursor = child;
  }
  return { end: cursor, added };
}

/** The path a set of moves takes, as far as the tree actually prepares it. */
export function walkPath(root: MoveNode, ucis: string[]): MoveNode[] {
  const out: MoveNode[] = [];
  let cursor = root;
  for (const uci of ucis) {
    const child = cursor.children.find(c => c.uci === uci);
    if (!child) break;
    out.push(child);
    cursor = child;
  }
  return out;
}

/** The node a UCI path arrives at, or null when the book doesn't go there. */
export function nodeAtPath(root: MoveNode, ucis: string[]): MoveNode | null {
  const path = walkPath(root, ucis);
  if (path.length !== ucis.length) return null;
  return path.length === 0 ? root : path[path.length - 1];
}

// ── Removing ─────────────────────────────────────────────────────────────────

/**
 * A subtree lifted out of a tree, and everything needed to put it back.
 *
 * Removal is the one repertoire edit that destroys work: the moves go, and with
 * them the review history, notes and confidence built up over weeks. Re-playing
 * the moves does NOT bring that back. So the cut hands back the node it took and
 * where it sat, and an undo is a re-attach of the very same object rather than a
 * reconstruction — which is what makes offering removal in more places safe.
 */
export interface DetachedSubtree {
  /** The removed node, with its whole subtree under it. */
  node: MoveNode;
  /** The node it hung off. */
  parentId: string;
  /** Its place among its siblings — restored, because children[0] is the main line. */
  index: number;
  /** How many moves went: the subtree's, plus the node itself. */
  moves: number;
}

/**
 * Lift a node and everything under it out of the tree, keeping what an undo
 * needs. Returns null when the id isn't in this tree (or is its root).
 */
export function detachSubtree(root: MoveNode, id: string): DetachedSubtree | null {
  const parent = parentOf(root, id);
  if (!parent) return null;
  const index = parent.children.findIndex(c => c.id === id);
  if (index === -1) return null;
  const [node] = parent.children.splice(index, 1);
  return { node, parentId: parent.id, index, moves: moveCount(node) + 1 };
}

/**
 * Put a detached subtree back exactly where it was. False when the parent has
 * gone in the meantime — the tree moved on and the undo no longer applies.
 */
export function reattachSubtree(root: MoveNode, cut: DetachedSubtree): boolean {
  const parent = findNode(root, cut.parentId);
  if (!parent) return false;
  if (findNode(root, cut.node.id)) return false; // already back
  parent.children.splice(Math.min(cut.index, parent.children.length), 0, cut.node);
  return true;
}

/**
 * Remove a node and everything under it. Returns how many moves went — the
 * number the confirm dialog quotes, so it must count the subtree and not just
 * the one move the user tapped.
 */
export function removeSubtree(root: MoveNode, id: string): number {
  return detachSubtree(root, id)?.moves ?? 0;
}

/**
 * Where "delete this line" has to cut: the deepest ancestor of `endId` whose
 * subtree holds ONLY this line. Everything above it is shared with another line
 * and must survive, which is exactly the distinction the flat-line model could
 * not make — deleting a line there deleted moves other lines still needed, or
 * left the shared prefix behind as an orphan.
 *
 * Stops at a branch (a parent with more than one child), at a node someone
 * marked as a line end in its own right, and at the root.
 */
export function lineTailStart(root: MoveNode, endId: string): MoveNode | null {
  const path = pathToNode(root, endId);
  if (!path || path.length === 0) return null;
  let cut = path.length - 1;
  while (cut > 0) {
    const parent = path[cut - 1];
    if (parent.children.length !== 1) break;   // a branch: shared from here up
    if (parent.endpoint === true) break;       // a line ends here in its own right
    cut--;
  }
  return path[cut];
}

// ── Grouping a set of added moves ────────────────────────────────────────────

/** One place in a tree where a run of added moves starts. */
export interface AddedBranch {
  /** The shallowest added node — removing this removes the whole run. */
  rootId: string;
  /** Every added move under it, in walk order. */
  moves: MoveNode[];
  /** The prepared moves above it, for saying where it hangs off. */
  from: MoveNode[];
  /** The deepest added move — where "go and look at it" should land. */
  lastId: string;
}

/**
 * Group a set of added node ids into the branches they form.
 *
 * The builder holds its draft as a flat set of ids, which is the right way to
 * STORE it and the wrong way to describe it: someone who adds three moves off
 * the French, walks back, and adds two off the King's Indian has built two
 * things, and a header offering "Add 5 moves" while the move strip shows two of
 * them is counting work they cannot see.
 *
 * A branch root is an added node whose parent is not added. Everything added
 * below it belongs to the same run — a node can only be added by playing a move
 * onto its parent, so an added node never has an unadded descendant, which is
 * what makes one walk enough.
 */
export function groupAddedBranches(root: MoveNode, added: Set<string>): AddedBranch[] {
  if (added.size === 0) return [];
  const out: AddedBranch[] = [];
  // One trail, pushed and popped: this runs behind every board move while a
  // draft is open, over the whole book.
  const trail: MoveNode[] = [];

  const walk = (node: MoveNode, insideBranch: boolean): void => {
    for (const child of node.children) {
      const isAdded = added.has(child.id);
      if (isAdded && !insideBranch) out.push(collectBranch(child, trail, added));
      trail.push(child);
      walk(child, isAdded);
      trail.pop();
    }
  };
  walk(root, false);
  return out;
}

function collectBranch(root: MoveNode, from: MoveNode[], added: Set<string>): AddedBranch {
  const moves: MoveNode[] = [];
  let last = root;
  const walk = (node: MoveNode): void => {
    moves.push(node);
    last = node;
    for (const child of node.children) if (added.has(child.id)) walk(child);
  };
  walk(root);
  return { rootId: root.id, moves, from: [...from], lastId: last.id };
}

/** How many moves "delete this line" would take, without taking them. */
export function lineTailSize(root: MoveNode, endId: string): number {
  const cut = lineTailStart(root, endId);
  return cut ? moveCount(cut) + 1 : 0;
}

// ── Parity ───────────────────────────────────────────────────────────────────

/**
 * Is the move at this depth one the USER plays? Depth is 1-based (the first move
 * of the game is depth 1), matching a path's length. Same rule the scheduler and
 * the position index use: White's moves are the odd depths, Black's the even.
 */
export function isUserMoveAtDepth(depth: number, colour: 'white' | 'black'): boolean {
  return colour === 'white' ? depth % 2 === 1 : depth % 2 === 0;
}

/** Every node on the path that the user plays. */
export function userMovesOnPath(path: MoveNode[], colour: 'white' | 'black'): MoveNode[] {
  return path.filter((_, i) => isUserMoveAtDepth(i + 1, colour));
}

// ── Copies ───────────────────────────────────────────────────────────────────

/**
 * A detached deep copy. MoveNodes are plain data, so structuredClone gives a
 * fully serialisable copy — but `review.due` is a Date, and structuredClone
 * keeps Dates as Dates, which is what storage and the scheduler both want.
 */
export function cloneTree(node: MoveNode): MoveNode {
  return structuredClone(node);
}
