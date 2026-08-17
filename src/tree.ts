import type { MoveClass } from './winprob';
import type { LinePriority } from './types';

// The six standard chess annotation marks, strongest to worst.
export type Annotation = '!!' | '!' | '!?' | '?!' | '?' | '??';

export interface MoveNode {
  id: string;
  san: string;
  uci: string;
  fen: string;
  children: MoveNode[];
  note?: string;
  annotation?: Annotation;
  missedThisSession?: boolean;
  // The lifetime miss count when training last offered to write a note for this
  // move (see struggle.ts). Keeps a dismissed prompt quiet until the move has
  // been missed several more times. Optional and serialisable — absent on old
  // data, no migration needed.
  noteAskedAtLapses?: number;
  // Game-review grade for the move INTO this node, judged from the parent
  // position. Optional and serialisable, so it persists if the line is saved and
  // is simply absent on un-reviewed / old data (no migration). A divergent edit
  // replaces the node outright, so a grade can never outlive the move it scored.
  classification?: MoveClass;
  cpLoss?: number; // centipawns behind the engine's best, for display
  // Engine evaluation AFTER this move, in WHITE's perspective (centipawns;
  // mate maps to a large signed sentinel). Written by the reviewer and used by
  // the Line-tab eval graph. Absent on un-reviewed / old data.
  evalCp?: number;
  review?: {
    ease: number;
    interval: number;
    reps: number;
    lapses: number;
    due: Date;
  };

  // ── Repertoire fields (see repertoire.ts and REPERTOIRE-REDESIGN.md) ───────
  //
  // A repertoire is one tree and a "line" is a path through it, so everything a
  // line used to carry as a record field now lives on a node. All optional, all
  // serialisable, and absent on the overwhelming majority of nodes.
  //
  // The first four INHERIT: set on a node, they apply to everything below it
  // unless a deeper node overrides. That is what turns "pause the whole French"
  // into one toggle instead of twenty.

  /** A name pinned here: "Anti-Sicilian", "Main line". Names every line below. */
  label?: string;
  /** Tags for this branch. They accumulate down the path rather than override. */
  tags?: string[];
  /** Explicit training on/off for this branch. Inherited; on by default. */
  training?: boolean;
  /** Explicit review spacing for this branch. Inherited; 'standard' by default. */
  priority?: LinePriority;

  /** Marks a line as ending here even though prepared moves continue past it. */
  endpoint?: true;
  /** When this move was added to the repertoire — the derived line's "Latest". */
  createdAt?: number;
  /** On a line end: full start-to-finish runs of the line ending here. */
  timesTrained?: number;
  /** On a line end: ISO date of the last full run. Drives "last trained" labels. */
  lastTrained?: string;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

let idCounter = 0;

const root: MoveNode = {
  id: 'root',
  san: '',
  uci: '',
  fen: START_FEN,
  children: [],
};

let current: MoveNode = root;

// How the tree grows when a move is played from mid-line:
//   • 'single'     — the builder edits ONE line. A deviating move REPLACES the
//                    continuation (becomes the node's sole child), so the tree
//                    stays a single path and serialise() stores exactly one line.
//   • 'variations' — the game analyser. A deviating move is ADDED as a new
//                    sibling branch, keeping the original main line (children[0])
//                    intact, so you can explore "what if" lines as variations.
export type TreeMode = 'single' | 'variations';
let treeMode: TreeMode = 'single';

export function setTreeMode(mode: TreeMode): void {
  treeMode = mode;
}

export function getTreeMode(): TreeMode {
  return treeMode;
}

// Play a move from the cursor. If a child already continues with this move (the
// main line OR an existing variation), just advance onto it. Otherwise add it —
// replacing the continuation in 'single' mode, or appending a new variation in
// 'variations' mode (main line preserved).
export function addMove(san: string, uci: string, fen: string): MoveNode {
  const existing = current.children.find(c => c.san === san);
  if (existing) {
    current = existing;
    return existing;
  }
  const node: MoveNode = { id: `n${++idCounter}`, san, uci, fen, children: [] };
  if (treeMode === 'variations') current.children.push(node);
  else current.children = [node];
  current = node;
  return node;
}

export function goTo(nodeId: string): void {
  const found = findNode(root, nodeId);
  if (found) current = found;
}

// Drop the last move of the mainline (the children[0] chain), leaving the cursor
// on the new last node — or the root when the line had a single move. Used by the
// builder's "end on your move?" save nudge to trim a trailing opponent move.
export function removeLastMove(): void {
  const line = mainline();
  if (line.length === 0) return;
  const parent = line.length === 1 ? root : line[line.length - 2];
  parent.children = [];
  current = parent;
}

// Drop everything after the cursor, so the line ends on the move currently shown
// on the board. The builder edits a single path, so this just cuts the
// children[0] chain at the cursor. Used by "save up to the move on the board"
// (e.g. after importing a full game and stepping back to the position you want).
export function truncateAfterCurrent(): void {
  current.children = [];
}

function findNode(node: MoveNode, id: string): MoveNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export function mainline(): MoveNode[] {
  const result: MoveNode[] = [];
  let node = root.children[0];
  while (node) {
    result.push(node);
    node = node.children[0];
  }
  return result;
}

export function pathTo(nodeId: string): MoveNode[] {
  function walk(node: MoveNode, path: MoveNode[]): MoveNode[] | null {
    const p = [...path, node];
    if (node.id === nodeId) return p;
    for (const child of node.children) {
      const result = walk(child, p);
      if (result) return result;
    }
    return null;
  }
  const full = walk(root, []) ?? [];
  return full.slice(1); // exclude root (no move)
}

export function getCurrentNode(): MoveNode {
  return current;
}

// The live tree root, for renderers that need to walk variations (read-only).
export function rootNode(): MoveNode {
  return root;
}

// UCI moves from the start to the given node, ready for an opening lookup.
// Defaults to the current node. Root is excluded by pathTo, so this is just
// each node's uci in order.
export function uciPathTo(nodeId: string = current.id): string[] {
  return pathTo(nodeId).map(n => n.uci);
}

export function isEmpty(): boolean {
  return root.children.length === 0;
}

// Return a clean, deep-cloned snapshot of the move tree. MoveNodes are already
// plain data (no functions or class instances), so structuredClone gives us a
// detached, fully serialisable copy that IndexedDB can store directly.
export function serialise(): MoveNode {
  return structuredClone(root);
}

export function reset(): void {
  root.children = [];
  current = root;
  idCounter = 0;
  treeMode = 'single';
}

// Load a previously serialised tree into the module, replacing the current
// tree. Scans the loaded nodes for the highest numeric id so that any new
// moves added afterwards don't collide with existing node ids.
//
// OLD DATA: there is NO migration. Lines saved before the builder edited a
// single line may carry hidden dead branches (extra siblings under some node).
// They load fine and display their mainline (the children[0] chain) exactly as
// today, since every reader walks children[0] only. The first divergent edit
// truncates from the edit point onward (see addMove), which discards those dead
// branches and cleans the line naturally on the next save.
export function loadTree(data: MoveNode): void {
  root.children = structuredClone(data.children);
  current = root;
  idCounter = scanMaxId(root);
  treeMode = 'single';
}

function scanMaxId(node: MoveNode): number {
  let max = 0;
  const m = node.id.match(/^n(\d+)$/);
  if (m) max = parseInt(m[1], 10);
  for (const child of node.children) {
    max = Math.max(max, scanMaxId(child));
  }
  return max;
}
