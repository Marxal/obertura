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
  review?: {
    ease: number;
    interval: number;
    reps: number;
    lapses: number;
    due: Date;
  };
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

// The builder edits a single line, not a branching tree. Playing the move that
// already continues from the cursor (children[0]) just advances along it. Playing
// ANY other move from mid-line is an edit: the new move REPLACES everything from
// here on — it becomes the node's sole child and the old continuation is dropped
// immediately. This keeps the tree a single path, so mainline() always equals the
// visible line and serialise() stores exactly one line (no stray sibling branches).
export function addMove(san: string, uci: string, fen: string): MoveNode {
  const next = current.children[0];
  if (next && next.san === san) {
    current = next;
    return next;
  }
  const node: MoveNode = { id: `n${++idCounter}`, san, uci, fen, children: [] };
  current.children = [node];
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
