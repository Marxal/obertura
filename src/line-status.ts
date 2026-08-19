// What a line's card and its popup say ABOUT the line, in one place so the two
// can never disagree.
//
// Two facts, and they answer different questions:
//
//   • STATUS — what this line wants from you now. It is the only thing worth
//     scanning a list of cards for, so it leads, carries a colour, and is
//     phrased as a state ("Due now · 4 of 7 moves") rather than a measurement.
//   • TRAINING — how it has been GOING: runs and recall, and the verdict those
//     two add up to (lineMastered), which is what the "keep growing this line"
//     offer is made on.
//
// DOM-free, so both the card and the peek can use it and a self-test can too.

import type { Line } from './types';
import {
  lineBucket, nextDue, describeDue, userMoveNodes, isReviewDue,
} from './scheduler';
import { lineTrainingCount } from './stats';

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

  // describeDue already leads with the word — "Due tomorrow", "Due in 5 days" —
  // so it is used as it comes. Prefixing it again read as "Due due tomorrow" on
  // every card of every line that wasn't due yet.
  const when = describeDue(nextDue(line), now);
  return { tone: lineBucket(line, now) === 'solid' ? 'solid' : 'learning', text: when };
}

/**
 * How the line is GOING, as the two figures worth putting on a card: how many
 * full runs it has had, and how much of it comes back clean.
 *
 * Recall is `solid / drilled`, not `solid / total`: a move that has never been
 * asked for hasn't been forgotten, and counting it as a failure would tell a
 * half-learned line it is worse than it is. `drilled` is reported alongside so a
 * caller can say what the percentage is OF.
 *
 * The line popup showed exactly this and computed it inline; both read it from
 * here now, so the card and the popup can't quote different numbers for the
 * same line.
 */
export interface LineTraining {
  /** Full start-to-finish runs (falls back to an estimate on older lines). */
  runs: number;
  /** User moves with a review record — the denominator of `recallPct`. */
  drilled: number;
  /** User moves in total. */
  total: number;
  /** Percentage of drilled moves currently on a clean streak; null if none. */
  recallPct: number | null;
  /** User moves currently on a clean recall streak — the popup's "correct" figure. */
  solid: number;
}

export function lineTraining(line: Line): LineTraining {
  const nodes = userMoveNodes(line.tree, line.colour);
  const drilled = nodes.filter(n => n.review).length;
  const solid = nodes.filter(n => n.review && n.review.reps > 0).length;
  return {
    runs: lineTrainingCount(line),
    drilled,
    total: nodes.length,
    recallPct: drilled > 0 ? Math.round((100 * solid) / drilled) : null,
    solid,
  };
}

/** "3 runs · 86% recall" — the same figures as one quiet line, or null. */
export function lineTrainingText(line: Line, t: LineTraining = lineTraining(line)): string | null {
  if (t.runs === 0 && t.drilled === 0) return null;
  const bits: string[] = [];
  if (t.runs > 0) bits.push(`${t.runs} ${t.runs === 1 ? 'run' : 'runs'}`);
  if (t.recallPct !== null) bits.push(`${t.recallPct}% recall`);
  return bits.length ? bits.join(' · ') : null;
}

// A line is "mastered" when it has been round enough times to have proved it,
// with nothing on it still slipping. Deliberately modest: three clean-ish runs
// is where a line stops teaching you anything and starts being a thing you
// know — which is the moment to ask for more moves rather than more reps.
const MASTERED_RUNS = 3;
const MASTERED_RECALL = 80;

/**
 * Is this line ready to GROW — trained enough, confident enough, and with room
 * at the end to grow into?
 *
 * `ownMoves === 0` means prepared moves continue past this line's end, so its
 * last move already has answers saved after it: there is nothing to add HERE,
 * and telling someone to extend a line that is already extended is noise. A
 * line projected outside a repertoire carries no `ownMoves` at all, and those
 * are never offered the tag rather than guessing at their shape.
 */
export function lineMastered(line: Line): boolean {
  if (!line.inTraining) return false;
  if (line.ownMoves === undefined || line.ownMoves === 0) return false;
  const t = lineTraining(line);
  if (t.total === 0 || t.drilled < t.total) return false;
  return t.runs >= MASTERED_RUNS
    && (t.recallPct ?? 0) >= MASTERED_RECALL
    && line.confidence >= 3;
}
