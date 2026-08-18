// What a line's card and its popup say ABOUT the line, in one place so the two
// can never disagree.
//
// Two facts, and they answer different questions:
//
//   • STATUS — what this line wants from you now. It is the only thing worth
//     scanning a list of cards for, so it leads, carries a colour, and is
//     phrased as a state ("Due now · 4 of 7 moves") rather than a measurement.
//   • SHAPE — what the line IS. Its length, and how much of it is its own.
//     "3 only here" is the tree model made visible: a line whose 12 moves are 3
//     of its own is mostly prep shared with its neighbours, which is why
//     deleting it cuts only 3 and why drilling it re-covers ground you meet
//     elsewhere. The flat model could not have told you this.
//
// DOM-free, so both the card and the peek can use it and a self-test can too.

import type { Line } from './types';
import type { MoveNode } from './tree';
import {
  lineBucket, nextDue, describeDue, userMoveNodes, isReviewDue,
} from './scheduler';

export type StatusTone = 'due' | 'learning' | 'solid' | 'new' | 'off';

export interface LineStatus {
  tone: StatusTone;
  text: string;
}

/**
 * The line's state in one phrase.
 *
 * Paused wins over everything. A paused line is not due for anything, and
 * telling someone it is due today when the scheduler will never offer it is the
 * kind of small lie that costs trust in the whole screen.
 */
export function lineStatus(line: Line, now: Date = new Date()): LineStatus {
  if (!line.inTraining) return { tone: 'off', text: 'Paused' };

  const moves = userMoveNodes(line.tree, line.colour);
  if (moves.length === 0) return { tone: 'new', text: 'No moves of yours yet' };

  // Never drilled at all reads as "Not started", not as "Due now". Both are
  // true — an untrained move IS due — but one of them says something.
  if (moves.every(n => !n.review)) return { tone: 'new', text: 'Not started' };

  const due = moves.filter(n => isReviewDue(n.review, now)).length;
  if (due > 0) {
    return {
      tone: 'due',
      text: `Due now · ${due} of ${moves.length} ${moves.length === 1 ? 'move' : 'moves'}`,
    };
  }

  // describeDue speaks in sentence case ("In 5 days", "Tomorrow"); lowercased
  // so it reads as one phrase after "Due".
  const when = describeDue(nextDue(line), now).toLowerCase();
  return { tone: lineBucket(line, now) === 'solid' ? 'solid' : 'learning', text: `Due ${when}` };
}

/**
 * The line's shape as its parts, for a caller to lay out however it likes.
 *
 * `ownMoves` is omitted when it is the whole line (nothing to contrast it
 * with) or zero. Zero means prepared moves continue PAST this line's end, so
 * every move on it is shared — and "0 only here" is a riddle, not a fact.
 */
export function lineShape(line: Line): { moves: number; ownMoves: number | null } {
  const moves = spineLength(line.tree);
  const own = line.ownMoves ?? 0;
  return { moves, ownMoves: own > 0 && own < moves ? own : null };
}

/** The shape as one line of text: "12 moves · 3 only here". */
export function lineShapeText(line: Line): string {
  const { moves, ownMoves } = lineShape(line);
  const head = `${moves} ${moves === 1 ? 'move' : 'moves'}`;
  return ownMoves === null ? head : `${head} · ${ownMoves} only here`;
}

/** How many moves a projected line's spine holds. */
export function spineLength(tree: MoveNode): number {
  let n = 0;
  let node = tree.children[0];
  while (node) { n++; node = node.children[0]; }
  return n;
}
