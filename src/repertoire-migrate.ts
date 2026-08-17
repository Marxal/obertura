// One-way migration: the old flat list of Lines becomes one tree per colour.
//
// Every user's repertoire arrived through the old model, so this runs once on
// first launch after the redesign (and again on any backup or sync payload still
// written in the old shape). It must be lossless in the ways a user would
// notice: no move disappears, no name disappears, no training progress
// disappears, and the number of lines they see afterwards is the number they had.
//
// The merge is by PATH — the same walk map-merge.ts already does for the map
// view — so lines that shared an opening stop storing it twice. That collapse is
// the entire point, and the report below counts exactly how much of it happened
// so the app can tell the user what it did.
//
// Pure: Lines in, Repertoires out. Exercised under Node by
// repertoire-migrate.selftest.ts.

import type { Line } from './types';
import type { MoveNode } from './tree';
import { nameForPath } from './openings';
import { betterReview } from './save-index';
import {
  DEFAULT_REPERTOIRE_NAMES, emptyTree, makeIdFactory, mergePath, moveCount,
  type MergeStep, type Repertoire,
} from './repertoire';

export interface MigrationReport {
  /** Books created — at most one per colour that had lines. */
  repertoires: number;
  /** Lines that went in. */
  linesIn: number;
  /** Lines that come out. Equal to linesIn unless two were truly identical. */
  linesOut: number;
  /** Moves actually stored afterwards. */
  movesStored: number;
  /** Move records the old model held — the difference is the duplication removed. */
  movesBefore: number;
  /**
   * Lines whose moves ended INSIDE a longer line. They're kept as lines in their
   * own right (marked as line ends) so nothing vanishes, but they no longer
   * store a second copy of the moves.
   */
  containedLines: number;
  /** Nodes where two lines disagreed about a move's review record. */
  reviewConflicts: number;
}

/** The old single-path walk: a stored line IS its children[0] chain. */
function mainlineNodes(tree: MoveNode): MoveNode[] {
  const out: MoveNode[] = [];
  let node = tree.children[0];
  while (node) {
    out.push(node);
    node = node.children[0];
  }
  return out;
}

export interface MigrationResult {
  repertoires: Repertoire[];
  report: MigrationReport;
}

/**
 * Turn stored lines into repertoires. Lines are merged oldest-first so that
 * where two of them disagree about something un-mergeable (a note on the same
 * move), the older one — the one the user has lived with longer — wins.
 */
export function migrateLines(lines: Line[], now: number = Date.now()): MigrationResult {
  const report: MigrationReport = {
    repertoires: 0, linesIn: lines.length, linesOut: 0,
    movesStored: 0, movesBefore: 0, containedLines: 0, reviewConflicts: 0,
  };

  const byColour = new Map<'white' | 'black', Repertoire>();
  // Every node a line ends on, so endpoints can be decided once at the end.
  const ends = new Set<MoveNode>();
  const ordered = [...lines].sort(
    (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id),
  );

  for (const line of ordered) {
    const nodes = mainlineNodes(line.tree);
    report.movesBefore += nodes.length;
    if (nodes.length === 0) continue; // an empty line was never a line

    let rep = byColour.get(line.colour);
    if (!rep) {
      rep = {
        id: `rep-${line.colour}`,
        name: DEFAULT_REPERTOIRE_NAMES[line.colour],
        colour: line.colour,
        tree: emptyTree(),
        createdAt: line.createdAt ?? now,
      };
      byColour.set(line.colour, rep);
    }

    const steps: MergeStep[] = nodes.map(n => ({
      san: n.san,
      uci: n.uci,
      fen: n.fen,
      // A move that turns out to be new keeps everything the old node carried.
      extra: movePayload(n),
    }));

    const before = mergePathTargets(rep.tree, steps);
    const { end } = mergePath(rep.tree, steps, makeIdFactory(rep.tree), line.createdAt ?? now);

    // Moves that already existed: fold the old node's per-move data into the
    // node that's now shared, rather than letting the first line to arrive win
    // outright. A review record is the one thing genuinely worth reconciling.
    for (const { live, old } of before) {
      report.reviewConflicts += foldMove(live, old) ? 1 : 0;
    }

    applyLineMeta(rep, end, line, report);
    ends.add(end);
    report.linesOut++;
  }

  // Marking line ends has to wait until every line is in. A short line merged
  // BEFORE the longer line that contains it is a leaf at the moment it lands,
  // and only stops being one when the extension arrives — so deciding as we go
  // would silently drop it. Ask once, at the end, when the tree is final.
  for (const end of ends) {
    if (end.children.length > 0 && end.endpoint !== true) {
      end.endpoint = true;
      report.containedLines++;
    }
  }

  const repertoires = [...byColour.values()];
  report.repertoires = repertoires.length;
  report.movesStored = repertoires.reduce((n, r) => n + moveCount(r.tree), 0);
  return { repertoires, report };
}

/** The per-move fields a node carries into the tree when it's the one creating it. */
function movePayload(n: MoveNode): Partial<MoveNode> {
  const out: Partial<MoveNode> = {};
  if (n.review) out.review = n.review;
  if (n.note) out.note = n.note;
  if (n.annotation) out.annotation = n.annotation;
  if (n.noteAskedAtLapses !== undefined) out.noteAskedAtLapses = n.noteAskedAtLapses;
  if (n.classification) out.classification = n.classification;
  if (n.cpLoss !== undefined) out.cpLoss = n.cpLoss;
  if (n.evalCp !== undefined) out.evalCp = n.evalCp;
  return out;
}

/**
 * The nodes this path will land on that ALREADY exist, paired with the old
 * node arriving at the same move. Computed before the merge, because afterwards
 * there is no way to tell which nodes were new.
 */
function mergePathTargets(
  root: MoveNode, steps: MergeStep[],
): Array<{ live: MoveNode; old: MoveNode }> {
  const out: Array<{ live: MoveNode; old: MoveNode }> = [];
  let cursor: MoveNode | undefined = root;
  for (const step of steps) {
    const child: MoveNode | undefined = cursor?.children.find(c => c.uci === step.uci);
    if (!child) break;
    out.push({ live: child, old: step.extra as MoveNode });
    cursor = child;
  }
  return out;
}

/**
 * Fold an old line's copy of a move into the shared node. Returns true when the
 * two held different review records — the count the report quotes.
 *
 * The BEST record wins (TRANSPOSITIONS.md §10): the user demonstrably knows the
 * move, and the weaker copy is bookkeeping, not evidence. Notes and annotations
 * only fill a gap — the older line already wrote its note and overwriting it
 * with a later line's would lose work silently.
 */
function foldMove(live: MoveNode, old: Partial<MoveNode>): boolean {
  let conflict = false;
  if (old.review) {
    if (live.review) {
      conflict = true;
      live.review = betterReview(live.review, old.review);
    } else {
      live.review = old.review;
    }
  }
  if (old.note && !live.note) live.note = old.note;
  if (old.annotation && !live.annotation) live.annotation = old.annotation;
  if (old.classification && !live.classification) live.classification = old.classification;
  if (old.cpLoss !== undefined && live.cpLoss === undefined) live.cpLoss = old.cpLoss;
  if (old.evalCp !== undefined && live.evalCp === undefined) live.evalCp = old.evalCp;
  return conflict;
}

/**
 * Put the old line's record-level fields onto the node that now ends it.
 *
 * Two lines can land on the SAME end node (they were identical, or one is a
 * prefix of another that already marked it). Then the fields merge generously:
 * tags union, training on if either was on, the more urgent priority, the higher
 * run count, the later training date. Losing a line's training state to a
 * near-duplicate would be the one migration bug a user actually feels.
 */
function applyLineMeta(
  rep: Repertoire, end: MoveNode, line: Line, report: MigrationReport,
): void {
  // A name worth keeping is one the app wouldn't have produced anyway.
  const path = pathOf(rep.tree, end);
  const auto = nameForPath(path.map(n => n.fen));
  if (line.name && line.name !== auto && !end.label) end.label = line.name;

  const tags = new Set([...(end.tags ?? []), ...line.tags].map(t => t.trim()).filter(Boolean));
  if (tags.size) end.tags = [...tags];

  // Training defaults to ON in the new model, so only "off" needs recording —
  // and a second line landing here that WAS in training clears it again.
  if (line.inTraining) delete end.training;
  else if (end.training === undefined) end.training = false;

  if (line.priority && line.priority !== 'standard') {
    end.priority = moreUrgent(end.priority, line.priority);
  }

  if (typeof line.timesTrained === 'number') {
    end.timesTrained = Math.max(end.timesTrained ?? 0, line.timesTrained);
  }
  if (line.lastTrained && (!end.lastTrained || line.lastTrained > end.lastTrained)) {
    end.lastTrained = line.lastTrained;
  }
  if (line.createdAt && (!end.createdAt || line.createdAt < end.createdAt)) {
    end.createdAt = line.createdAt;
  }
}

const URGENCY = { high: 0, standard: 1, low: 2 } as const;

function moreUrgent(
  a: Line['priority'], b: NonNullable<Line['priority']>,
): NonNullable<Line['priority']> {
  if (!a) return b;
  return URGENCY[a] <= URGENCY[b] ? a : b;
}

/** The path from the root down to a node we already hold a reference to. */
function pathOf(root: MoveNode, target: MoveNode): MoveNode[] {
  const walk = (node: MoveNode, trail: MoveNode[]): MoveNode[] | null => {
    for (const child of node.children) {
      const next = [...trail, child];
      if (child === target) return next;
      const found = walk(child, next);
      if (found) return found;
    }
    return null;
  };
  return walk(root, []) ?? [];
}

/**
 * A one-line summary for the toast the migration shows. Silent about the parts a
 * user doesn't care about; loud about the one number that justifies the change.
 */
export function migrationSummary(r: MigrationReport): string {
  const saved = r.movesBefore - r.movesStored;
  const books = r.repertoires === 1 ? '1 repertoire' : `${r.repertoires} repertoires`;
  if (saved <= 0) return `${r.linesOut} lines moved into ${books}.`;
  return `${r.linesOut} lines moved into ${books} — ${saved} duplicated moves merged away.`;
}
