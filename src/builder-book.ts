// The builder's side of the redesign: it no longer edits ONE line in isolation,
// it stands inside a repertoire.
//
// What that means concretely:
//
//   • The whole book's tree is loaded onto the board module, so every move you
//     have already prepared is there to walk. Playing a move you already have is
//     NAVIGATION; playing one you don't is an ADDITION.
//   • Additions are held as a draft until you commit them. Nothing is written
//     while you are trying ideas out, and the header button can say exactly what
//     it is about to do — "Add 3 moves" — instead of "Save line".
//   • Committing MERGES. Adding three moves to the end of a line you already
//     have stores three nodes, not a second copy of the line. That is the whole
//     complaint the redesign exists to answer, and it is now structural rather
//     than something a save-time duplicate check has to notice.
//
// This module owns that session state. It deliberately keeps the STORED tree
// separate from the working tree: the line-level controls (training, priority,
// name, tags) may only touch a line that is actually in the book, so they need
// something to ask that isn't the draft.

import type { MoveNode } from './tree';
import type { Line } from './types';
import {
  loadBookTree, serialise, getCurrentNode, currentLineNodes, removeNode, rootNode,
} from './tree';
import {
  defaultRepertoireFor, getRepertoire, saveRepertoire,
} from './storage';
import { applyLineWrite, endsUnder, makeLineId, projectRepertoire } from './lines-view';
import { cloneTree, isLineEnd, findNode, lineTailStart, moveCount, type Repertoire } from './repertoire';

// The book being edited. `tree` here is the STORED state — the working copy
// lives in tree.ts and only comes back on commit.
let book: Repertoire | null = null;

// Nodes added since the last commit. One entry per move, which is exactly what
// the "Add N moves" label counts.
const pending = new Set<string>();

/** The book the builder is standing in, or null before one is opened. */
export function activeBook(): Repertoire | null {
  return book;
}

export function bookColour(): 'white' | 'black' {
  return book?.colour ?? 'white';
}

/**
 * Open a book and load its whole tree onto the board. `id` picks a specific
 * book; without one — or with one of the wrong colour — you get the default for
 * that colour, created if the user has none yet.
 *
 * The colour check matters because the id usually comes from whichever book the
 * user last chose on My Lines. Building a White line while a Black book is
 * selected must not file it in the Black book.
 */
export async function openBook(
  colour: 'white' | 'black', id?: string,
): Promise<Repertoire> {
  const found = id ? await getRepertoire(id) : undefined;
  const rep = found && found.colour === colour && !found.archived
    ? found
    : await defaultRepertoireFor(colour);
  book = rep;
  pending.clear();
  loadBookTree(rep.tree);
  return rep;
}

/** Forget the book (leaving the builder for the analyser, say). */
export function closeBook(): void {
  book = null;
  pending.clear();
}

// ── The draft ────────────────────────────────────────────────────────────────

/** Record that a move was just added rather than walked onto. */
export function notePending(nodeId: string): void {
  pending.add(nodeId);
}

export function pendingCount(): number {
  return pending.size;
}

export function hasPending(): boolean {
  return pending.size > 0;
}

export function isPending(nodeId: string): boolean {
  return pending.has(nodeId);
}

/** Does the line the cursor is standing in contain anything uncommitted? */
export function currentLineHasPending(): boolean {
  return currentLineNodes().some(n => pending.has(n.id));
}

/**
 * Throw the draft away: remove every added node from the working tree. Removing
 * an ancestor takes its descendants with it, so ids that have already gone are
 * simply skipped.
 */
export function discardPending(): number {
  let removed = 0;
  for (const id of pending) removed += removeNode(id);
  pending.clear();
  return removed;
}

/**
 * Write the draft into the book. The working tree already IS the merged result —
 * a move played onto an existing branch became a child of the node that was
 * already there — so committing is storing it, not reconciling it.
 */
export async function commitPending(): Promise<number> {
  if (!book) return 0;
  const added = pending.size;
  book.tree = serialise();
  await saveRepertoire(book);
  pending.clear();
  return added;
}

// ── What is already prepared where the cursor stands ─────────────────────────

/** How much of the book lies at, or under, the position on the board. */
export interface CursorCoverage {
  /** Line ends here or below — the lines that pass through this position. */
  lines: number;
  /** The cursor is standing on the end of a line, with nothing after it. */
  atLineEnd: boolean;
  /** The board is at the starting position, so this describes the whole book. */
  atStart: boolean;
}

/**
 * What the book already covers from where the cursor is.
 *
 * Read off the WORKING tree, which is the same as the stored one whenever
 * there is no draft open — and a draft is the only case where the header has
 * something else to say. It is what lets the builder answer "is this path
 * already prepared?" without the user having to go and look at My Lines.
 */
export function cursorCoverage(): CursorCoverage | null {
  if (!book) return null;
  const node = getCurrentNode();
  const atStart = node.id === 'root';
  if (atStart && node.children.length === 0) {
    return { lines: 0, atLineEnd: false, atStart: true };
  }
  return {
    // endsUnder counts the node itself when it is a line end, so this is
    // "1" on a leaf and "the whole book" at the start.
    lines: endsUnder(node).length,
    atLineEnd: !atStart && isLineEnd(node),
    atStart,
  };
}

// ── The line the cursor is standing in ───────────────────────────────────────

/** The node the current line ends on, or null when the board is at the start. */
export function currentLineEnd(): MoveNode | null {
  const nodes = currentLineNodes();
  return nodes.length ? nodes[nodes.length - 1] : null;
}

/**
 * The current line as the rest of the app knows it — but only when it is really
 * in the book. A line with uncommitted moves in it has no stored identity yet,
 * and the controls that describe a saved line say so rather than pretending.
 */
export function currentLine(): Line | null {
  if (!book) return null;
  const end = currentLineEnd();
  if (!end) return null;
  const stored = findNode(book.tree, end.id);
  if (!stored || !isLineEnd(stored)) return null;
  const id = makeLineId(book.id, end.id);
  return projectRepertoire(book).find(l => l.id === id) ?? null;
}

/** The current line's id, or null when it isn't a stored line yet. */
export function currentLineId(): string | null {
  return currentLine()?.id ?? null;
}

/**
 * Apply a metadata change (training, priority, name, tags) to the current line
 * and store it. Touches only the line-level fields — the moves are the draft's
 * business — so it can be called while a draft is open elsewhere in the book
 * without committing it.
 */
export async function updateCurrentLine(patch: Partial<Line>): Promise<Line | null> {
  if (!book) return null;
  const line = currentLine();
  if (!line) return null;
  applyLineWrite([book], { ...line, ...patch });
  await saveRepertoire(book);
  return currentLine();
}

// ── Removing moves ───────────────────────────────────────────────────────────

export interface RemovalPlan {
  /** The node the cut starts at. */
  from: MoveNode;
  /** How many moves go, the subtree included. */
  moves: number;
  /** True when the cut takes moves shared with no other line — a whole line. */
  wholeLine: boolean;
}

/**
 * What "remove this move" would actually do, so the confirm can be honest about
 * it. A move with a branch under it takes that branch too; the count says so.
 */
export function planRemoval(nodeId: string): RemovalPlan | null {
  const node = findNode(rootOfWorking(), nodeId);
  if (!node || node.id === 'root') return null;
  return { from: node, moves: moveCount(node) + 1, wholeLine: node.children.length === 0 };
}

/**
 * What "delete this line" would cut: the deepest ancestor of the current line's
 * end whose subtree holds only this line, so the moves shared with its
 * neighbours survive. This is the distinction the old flat model could not make.
 */
export function planLineRemoval(): RemovalPlan | null {
  const end = currentLineEnd();
  if (!end) return null;
  const cut = lineTailStart(rootOfWorking(), end.id);
  if (!cut) return null;
  return { from: cut, moves: moveCount(cut) + 1, wholeLine: true };
}

/**
 * Remove a subtree from the working book and store the result. Anything pending
 * inside it is forgotten with it — it was never in the book to begin with.
 */
export async function removeAndStore(nodeId: string): Promise<number> {
  if (!book) return 0;
  const node = findNode(rootOfWorking(), nodeId);
  const doomed = node ? collectIds(node) : [];
  const removed = removeNode(nodeId);
  for (const id of doomed) pending.delete(id);
  book.tree = serialise();
  await saveRepertoire(book);
  return removed;
}

function collectIds(node: MoveNode): string[] {
  const out = [node.id];
  for (const c of node.children) out.push(...collectIds(c));
  return out;
}

// The working tree's live root. Every use below only READS it (finding a node,
// counting a subtree, locating a cut), so there is nothing to be gained by
// cloning — and a clone would go stale the moment a move was played.
function rootOfWorking(): MoveNode {
  return rootNode();
}

/** A detached copy of the stored book's tree — for readers that must not mutate. */
export function storedTree(): MoveNode | null {
  return book ? cloneTree(book.tree) : null;
}

/** Where the cursor is, for callers that would otherwise import tree.ts too. */
export function cursorId(): string {
  return getCurrentNode().id;
}
