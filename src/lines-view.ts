// Repertoires in, Lines out — and the write-back that puts changes to a Line
// onto the right node of the right tree.
//
// This module is the reason the redesign was affordable. Fifty-odd modules read
// `Line[]` (My Lines, the Train hub, the drill, statistics, coverage, the daily
// challenge, the map…). None of them had to change: they still get the same
// `Line` objects with the same fields, projected from the tree on read. Only the
// handful of places that WRITE had to learn the new model, and most of those go
// through `applyLineWrite` below rather than knowing anything about trees.
//
// The projection is lossless in the direction that matters: every field a
// consumer reads is either resolved from the path (name, tags, training,
// priority) or computed from the moves on it (confidence, buckets, due dates),
// so there is exactly one source of truth and no cache to invalidate.
//
// DOM-free and storage-free; exercised under Node by lines-view.selftest.ts.

import type { MoveNode } from './tree';
import type { Line, LinePriority } from './types';
import { nameForPath } from './openings';
import {
  isLineEnd, linePaths, resolveLabel, resolveTags, resolveTraining, resolvePriority,
  userMovesOnPath, pathToNode, makeIdFactory, mergePath,
  type MergeStep, type Repertoire,
} from './repertoire';

// ── Line ids ─────────────────────────────────────────────────────────────────
//
// A derived line is addressed by the repertoire it lives in and the node it ends
// at. Nothing persists a line id — the stores key on repertoires, and every
// consumer that holds one (a session queue, a stats row, a "drill this line"
// button) holds it for the length of one interaction — so an id that changes
// when a line is extended is harmless, and being able to derive it costs nothing.

const ID_SEP = '::';

export function makeLineId(repertoireId: string, endNodeId: string): string {
  return `${repertoireId}${ID_SEP}${endNodeId}`;
}

export function parseLineId(id: string): { repertoireId: string; endNodeId: string } | null {
  const at = id.indexOf(ID_SEP);
  if (at === -1) return null;
  return {
    repertoireId: id.slice(0, at),
    endNodeId: id.slice(at + ID_SEP.length),
  };
}

// ── Projection ───────────────────────────────────────────────────────────────

/** Every derived line across every repertoire, in repertoire order. */
export function projectLines(repertoires: Repertoire[]): Line[] {
  const out: Line[] = [];
  for (const rep of repertoires) out.push(...projectRepertoire(rep));
  return out;
}

/** The lines of one book. A book with no moves has no lines, not one empty one. */
export function projectRepertoire(rep: Repertoire): Line[] {
  return linePaths(rep.tree).map(path => projectLine(rep, path));
}

/** One line, built from the path that ends it. */
export function projectLine(rep: Repertoire, path: MoveNode[]): Line {
  const end = path[path.length - 1];
  const opening = nameForPath(path.map(n => n.fen));
  const label = resolveLabel(path);
  return {
    id: makeLineId(rep.id, end.id),
    name: label ?? opening ?? notationName(path),
    tags: resolveTags(path),
    colour: rep.colour,
    openingName: opening,
    confidence: pathConfidence(path, rep.colour),
    lastTrained: end.lastTrained ?? null,
    // An archived book is out of the rotation whatever its nodes say — that is
    // what archiving IS, and resolving it per node would make "archive" a
    // twenty-node edit that un-archiving could not reliably undo.
    inTraining: rep.archived ? false : resolveTraining(path),
    tree: spine(path),
    createdAt: end.createdAt,
    priority: resolvePriority(path),
    timesTrained: end.timesTrained,
  };
}

/**
 * The line's moves as the single-path tree every consumer already walks: a root
 * whose children[0] chain IS the line. Nodes are detached copies, so a drill
 * that grades a review record mutates its own copy and the repertoire only
 * changes when the write is applied deliberately (see applyLineWrite).
 */
function spine(path: MoveNode[]): MoveNode {
  const root: MoveNode = {
    id: 'root', san: '', uci: '',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    children: [],
  };
  let cursor = root;
  for (const node of path) {
    const copy = copyNode(node);
    cursor.children = [copy];
    cursor = copy;
  }
  return root;
}

/** Every field of a node except its children, deeply detached. */
function copyNode(node: MoveNode): MoveNode {
  const { children: _children, ...rest } = node;
  const copy = structuredClone(rest) as MoveNode;
  copy.children = [];
  return copy;
}

/**
 * "1.d4 d5 2.c4" — the name when nothing is pinned and no opening matches.
 *
 * In practice the bundled table names every first move, so a real line always
 * resolves to SOMETHING; this is the safety net for a path the table has no
 * answer for at all. Exported so it can be exercised directly rather than
 * through a line that cannot exist.
 *
 * Plain SAN, deliberately: formatMove would render figurines, and it reads the
 * notation preference out of localStorage, which would drag this module (and
 * everything that projects a line) out of Node and into a browser.
 */
export function notationName(path: MoveNode[]): string {
  const parts: string[] = [];
  for (let i = 0; i < path.length && i < 6; i++) {
    const move = path[i].san;
    parts.push(i % 2 === 0 ? `${i / 2 + 1}.${move}` : move);
  }
  return parts.join(' ') + (path.length > 6 ? '…' : '');
}

/**
 * The 0–5 confidence My Lines shows, by the same rule scheduler.lineConfidence
 * has always used: each user move scores its consecutive clean reps (capped at
 * 5), and the line takes the average. Recomputed here rather than stored,
 * because it is a pure function of records that live on the nodes.
 */
function pathConfidence(path: MoveNode[], colour: 'white' | 'black'): number {
  const nodes = userMovesOnPath(path, colour);
  if (nodes.length === 0) return 0;
  const total = nodes.reduce((sum, n) => sum + (n.review ? Math.min(5, n.review.reps) : 0), 0);
  return Math.round(total / nodes.length);
}

// ── Locating a projected line again ──────────────────────────────────────────

export interface LineLocation {
  repertoire: Repertoire;
  /** The live nodes in the repertoire's own tree, root excluded. */
  path: MoveNode[];
  end: MoveNode;
}

/** Find the live nodes a projected line id refers to, or null if it's gone. */
export function locateLine(repertoires: Repertoire[], lineId: string): LineLocation | null {
  const parsed = parseLineId(lineId);
  if (!parsed) return null;
  const rep = repertoires.find(r => r.id === parsed.repertoireId);
  if (!rep) return null;
  const path = pathToNode(rep.tree, parsed.endNodeId);
  if (!path || path.length === 0) return null;
  return { repertoire: rep, path, end: path[path.length - 1] };
}

// ── Write-back ───────────────────────────────────────────────────────────────

// The per-node fields a consumer is allowed to change on a projected line and
// have stick. Everything else about a node (its move, its place in the tree) is
// the builder's business and is never written through a Line.
const WRITTEN_BACK = [
  'review', 'note', 'annotation', 'missedThisSession', 'noteAskedAtLapses',
  'classification', 'cpLoss', 'evalCp',
] as const;

/**
 * Apply a projected Line back onto its repertoire: the per-move records first
 * (this is how a drill's grading lands), then the line-level metadata onto the
 * node that ends it.
 *
 * Matching is by NODE ID, walking the projected spine and the live path
 * together. A projected line whose moves no longer match the tree (the builder
 * changed it underneath a screen holding an old copy) writes back only as far as
 * the ids agree, rather than corrupting the tree to match a stale view.
 *
 * Returns false when the line no longer exists, so a caller can fall back to
 * merging it as new.
 */
export function applyLineWrite(repertoires: Repertoire[], line: Line): boolean {
  const found = locateLine(repertoires, line.id);
  if (!found) return false;

  const incoming = spineNodes(line.tree);
  for (const node of incoming) {
    const live = found.path.find(n => n.id === node.id);
    if (!live) continue;
    for (const field of WRITTEN_BACK) {
      const value = node[field];
      if (value === undefined) delete live[field];
      else Object.assign(live, { [field]: value });
    }
  }

  applyLineMeta(found, line);
  return true;
}

/** The children[0] chain of a projected line, root excluded. */
export function spineNodes(tree: MoveNode): MoveNode[] {
  const out: MoveNode[] = [];
  let node = tree.children[0];
  while (node) {
    out.push(node);
    node = node.children[0];
  }
  return out;
}

/**
 * The line-level fields, written onto the end node — but only where they differ
 * from what the path already resolves to.
 *
 * THAT CONDITION IS THE WHOLE POINT. Stamping an explicit `training: true` on
 * every leaf on every save would quietly kill inheritance: the next time the
 * user paused a whole branch, every leaf under it would out-vote the branch and
 * nothing would happen. So an explicit flag is written when it says something
 * the ancestors don't, and REMOVED when it merely repeats them.
 */
function applyLineMeta(at: LineLocation, line: Line): void {
  const { path, end } = at;
  const above = path.slice(0, -1);

  setInherited(end, 'training', line.inTraining, resolveTraining(above));
  setInherited(end, 'priority', line.priority, resolvePriority(above));

  // Names: a name that matches what the line would be called anyway isn't worth
  // pinning, so auto-named lines keep a clean node.
  const auto = nameForPath(path.map(n => n.fen)) ?? notationName(path);
  const inheritedLabel = resolveLabel(above);
  if (!line.name || line.name === auto || line.name === inheritedLabel) delete end.label;
  else end.label = line.name;

  // Tags already carried by an ancestor stay there; only the extras are pinned.
  const inheritedTags = new Set(resolveTags(above).map(t => t.trim().toLowerCase()));
  const own = line.tags.filter(t => t.trim() && !inheritedTags.has(t.trim().toLowerCase()));
  if (own.length) end.tags = own;
  else delete end.tags;

  if (typeof line.timesTrained === 'number') end.timesTrained = line.timesTrained;
  else delete end.timesTrained;

  if (line.lastTrained) end.lastTrained = line.lastTrained;
  else delete end.lastTrained;
}

function setInherited<K extends 'training' | 'priority'>(
  node: MoveNode,
  key: K,
  value: MoveNode[K] | undefined,
  inherited: MoveNode[K] | undefined,
): void {
  if (value === undefined || value === inherited) delete node[key];
  else node[key] = value;
}

// ── Merging a Line into a book ───────────────────────────────────────────────

/**
 * Add a line's moves to a repertoire, creating only what isn't already there,
 * and carry its metadata onto the node that ends it.
 *
 * This is the no-duplicates behaviour that the whole redesign exists for:
 * importing, restoring or starter-packing a line you already have adds nothing
 * but its name and tags. Returns the line as it now exists in the book.
 *
 * Pure with respect to storage — the caller saves.
 */
export function mergeLineIntoRepertoire(rep: Repertoire, line: Line): Line | null {
  const nodes = spineNodes(line.tree);
  if (nodes.length === 0) return null;

  const steps: MergeStep[] = nodes.map(n => ({
    san: n.san,
    uci: n.uci,
    fen: n.fen,
    // Only used for a move that turns out to be NEW; an existing node keeps
    // whatever it has already earned.
    extra: {
      review: n.review, note: n.note, annotation: n.annotation,
      classification: n.classification, cpLoss: n.cpLoss, evalCp: n.evalCp,
    },
  }));

  const { end } = mergePath(rep.tree, steps, makeIdFactory(rep.tree), line.createdAt ?? Date.now());
  // The moves continue past where this line stops, so it only stays a line of
  // its own by being marked as one.
  if (end.children.length > 0) end.endpoint = true;

  const id = makeLineId(rep.id, end.id);
  applyLineWrite([rep], { ...line, id });
  return projectRepertoire(rep).find(l => l.id === id) ?? null;
}

/**
 * Fold one book into another: every line of `from` merged into `into`. Used by
 * the "merge" restore and by the account sync when a device already has work of
 * its own. Nothing is ever removed — that is what makes merge the safe default.
 */
export function mergeRepertoireInto(into: Repertoire, from: Repertoire): void {
  for (const line of projectRepertoire(from)) mergeLineIntoRepertoire(into, line);
}

// ── Bulk enrolment, the thing branch toggles need ────────────────────────────

/**
 * Turn training on or off for a whole branch, in one explicit flag on that node.
 *
 * Deliberately CLEARS every explicit flag below it, so the branch toggle is the
 * answer for everything under it and the user's tap does what it looks like it
 * does. Without this, a leaf that was individually paused six months ago would
 * silently ignore "train the whole French".
 */
export function setBranchTraining(node: MoveNode, on: boolean, inherited: boolean): void {
  const walk = (n: MoveNode): void => {
    delete n.training;
    for (const c of n.children) walk(c);
  };
  walk(node);
  if (on !== inherited) node.training = on;
}

/** The line ends under a node — how many lines a branch toggle is about to move. */
export function endsUnder(node: MoveNode): MoveNode[] {
  const out: MoveNode[] = [];
  const walk = (n: MoveNode, isRoot: boolean): void => {
    if (!isRoot && isLineEnd(n)) out.push(n);
    for (const c of n.children) walk(c, false);
  };
  walk(node, false);
  return out;
}

/** A line's resolved priority, for callers that only hold the projected Line. */
export function linePriorityOf(line: Line): LinePriority {
  return line.priority ?? 'standard';
}
