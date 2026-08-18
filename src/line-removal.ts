// What removing a move will actually do — in the numbers and the words a
// confirm has to say before it does it.
//
// The tree model has ONE rule for removal, and every screen that offers it must
// tell the same story:
//
//   Removing a move removes everything after it. Everything before it stays,
//   because your other lines are built on it.
//
// There is no "take this move out and keep the rest": the rest only exists
// because of it. So the only honest question left is HOW MUCH goes, and that has
// two very different shapes the user must be able to tell apart at a glance:
//
//   • a TRIM — nothing else hangs off the move above, so the line survives and
//     simply ends earlier ("your line will end at 1.e4 c5 2.Nf3 instead");
//   • a CUT — several lines run through the move, and they all go.
//
// Getting that distinction wrong is what makes a delete button frightening. This
// module works it out once so the builder, the branch sheet and anything added
// later cannot drift apart on it.
//
// DOM-free and storage-free, so it is exercised under Node by
// line-removal.selftest.ts.

import { formatSanLine, numberedMove } from './notation';
import { moveCount, parentOf, pathToNode, type Repertoire } from './repertoire';
import { endsUnder, projectLine } from './lines-view';

/** How many line names a confirm spells out before it starts counting instead. */
const NAMES_SHOWN = 3;

export interface RemovalImpact {
  nodeId: string;
  /** The move being removed, numbered: "2…c5". */
  move: string;
  /** Moves that go — this one and everything under it. */
  moves: number;
  /** Lines that end at or under it, and therefore go with it. */
  lines: number;
  /** The first few of their names, for saying WHICH lines. */
  names: string[];
  /** How many more there are beyond `names`. */
  more: number;
  /**
   * What the surviving line becomes when this is a trim: the notation it will
   * now end on. Null when the move above still has other continuations (so no
   * line ends there) or when there is no move above at all.
   */
  endsAt: string | null;
  /** The move hangs straight off the start — a whole opening leaves the book. */
  wholeOpening: boolean;
  /**
   * Safe to do without a confirm: one line is affected and an Undo can put it
   * back exactly. Anything wider gets asked about first.
   */
  small: boolean;
}

/**
 * Describe what removing `nodeId` from this book would do. Null when the node
 * isn't in the book (already gone, or a draft move that was never stored).
 */
export function describeRemoval(rep: Repertoire, nodeId: string): RemovalImpact | null {
  const path = pathToNode(rep.tree, nodeId);
  if (!path || path.length === 0) return null;
  const node = path[path.length - 1];
  const parent = parentOf(rep.tree, nodeId);
  if (!parent) return null;

  const ends = endsUnder(node);
  const names = ends.slice(0, NAMES_SHOWN).map(end => {
    const endPath = pathToNode(rep.tree, end.id);
    return endPath && endPath.length ? projectLine(rep, endPath).name : 'a line';
  });

  const wholeOpening = parent.id === rep.tree.id;
  // The move above becomes a line end only if this was its LAST continuation.
  // With a sibling left it stays a branch point and no new line appears there.
  const trims = !wholeOpening && parent.children.length === 1;

  return {
    nodeId,
    move: numberedMove(node.san, path.length),
    moves: moveCount(node) + 1, // the subtree's moves, plus this one
    lines: ends.length,
    names,
    more: Math.max(0, ends.length - names.length),
    endsAt: trims ? formatSanLine(path.slice(0, -1).map(n => n.san)) : null,
    wholeOpening,
    small: ends.length <= 1,
  };
}

/** "Remove 2…c5?" — the confirm's title, which names the actual move every time. */
export function removalTitle(impact: RemovalImpact): string {
  return `Remove ${impact.move}?`;
}

/**
 * The confirm's body: what goes, which lines go with it, and what is left. Three
 * short sentences at most — the third is the one that answers the question
 * everybody actually has, which is "am I losing the whole line here?".
 */
export function removalBody(impact: RemovalImpact, bookName: string): string {
  const out = [
    `This removes ${plural(impact.moves, 'move')} from “${bookName}”, along with their review history.`,
  ];

  if (impact.lines > 1) {
    const list = impact.names.map(n => `“${n}”`).join(', ');
    out.push(`${plural(impact.lines, 'line')} end here${list ? `: ${list}` : ''}`
      + `${impact.more > 0 ? ` and ${impact.more} more` : ''}.`);
  }

  if (impact.endsAt) out.push(`Your line will end at ${impact.endsAt} instead.`);
  else if (impact.wholeOpening) out.push('It starts at the first move, so the whole opening leaves this book.');
  else out.push('The moves leading up to it stay — your other lines need them.');

  return out.join(' ');
}

/** "Removed 5 moves" — what the toast says once it has happened. */
export function removalDone(moves: number): string {
  return `Removed ${plural(moves, 'move')}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
