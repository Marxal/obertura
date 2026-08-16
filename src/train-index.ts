// The pure half of "what does the position index change about TRAINING?" —
// the sibling of save-index.ts, which does the same job for saving.
//
// Two questions, both answered from the index and both exercised under plain
// Node by train-index.selftest.ts (no DOM, no IndexedDB, no board):
//
//   §8  which OTHER lines play the move just drilled, from this position?
//       Their nodes get the same review record — shared work is credited once.
//   §9  the played move isn't this line's move: is it another line's move here?
//       If that line is in training, the drill offers a divert into it.
//
// See TRANSPOSITIONS.md for the decisions these implement.
//
// Deliberately NOT written through the index's live MoveNode references. The
// index hands back a lineId + ply; the caller re-reads that line from storage,
// writes the record there and saves it. A drill can therefore run without
// freezing the index, and a write-through can never resurrect a stale copy of a
// line the session edited some other way (pausing it mid-drill, say).

import type { Line } from './types';
import type { MoveNode } from './tree';
import type { Review } from './scheduler';
import type { PositionIndex, PositionEntry } from './position-index';

// The mainline, the same children[0] chain every other reader walks.
function mainlineNodes(tree: MoveNode): MoveNode[] {
  const out: MoveNode[] = [];
  let node = tree.children[0];
  while (node) {
    out.push(node);
    node = node.children[0];
  }
  return out;
}

// Same move? Compared on from+to only, because that is all the drill can tell
// apart: chessground reports a drag as two squares and the drill promotes to a
// queen, so a stored uci's promotion suffix is not part of the answer.
function sameMove(a: string, b: string): boolean {
  return a.slice(0, 4) === b.slice(0, 4);
}

// A detached copy. Two lines must never share a `review` object — a later drill
// grades each independently, and `due` is a Date a shared reference would carry
// across both. (save-index.ts keeps the same rule for §7 inheritance.)
function cloneReview(r: Review): Review {
  return { ease: r.ease, interval: r.interval, reps: r.reps, lapses: r.lapses, due: new Date(r.due) };
}

// ── §8 Write-through ─────────────────────────────────────────────────────────

/**
 * Every OTHER line that plays THIS MOVE from THIS POSITION — the lines whose
 * record should move in step with the one just drilled (TRANSPOSITIONS.md §8).
 *
 * Keyed on position AND move together. A different move from the same position
 * is a different piece of knowledge and must be left alone: drilling the
 * Scandinavian main-line answer must not credit the surprise weapon filed at
 * the same position.
 *
 * User moves only, and never the line being drilled — `siblingAnswers` already
 * enforces both. An opponent move carries no review record, so it can neither
 * be drilled nor credited.
 */
export function siblingCredits(
  index: PositionIndex,
  preFen: string,
  uci: string,
  fromLineId: string,
): PositionEntry[] {
  return index.siblingAnswers(preFen, fromLineId).filter(e => sameMove(e.uci, uci));
}

/**
 * Write a review record onto one line's mainline move, addressed the way the
 * index reports it: `ply` is 1-based, `uci` is what that move must still be.
 *
 * Refuses (returns false) when the line has changed under us — the move at that
 * ply is a different one now, or the line is shorter than the ply. The index is
 * a snapshot and the line is re-read from storage, so the two CAN disagree; a
 * mismatch means "this credit no longer applies", never "write it anyway".
 *
 * The record is copied, not aliased — see cloneReview.
 */
export function applyReviewAt(line: Line, ply: number, uci: string, review: Review): boolean {
  const nodes = mainlineNodes(line.tree);
  const node = nodes[ply - 1];
  if (!node || !sameMove(node.uci, uci)) return false;
  node.review = cloneReview(review);
  return true;
}

// ── §9 The divert ────────────────────────────────────────────────────────────

/** Another line's answer at a position — one of the drill's arrow choices. */
export interface OtherLineMove {
  lineId: string;
  lineName: string;
  uci: string;
  /** 1-based half-move number of this move within that line. */
  ply: number;
}

export type DivertVerdict =
  // The played move is another IN-TRAINING line's move here. `candidates` is
  // EVERY distinct in-training alternative saved at this position (deduped by
  // move) — not only the one played — so the drill can show the full set of
  // saved answers as arrows, one colour per line, rather than just the one hit.
  | { kind: 'in-training'; candidates: OtherLineMove[] }
  // The played move belongs only to a PARKED line — nothing to divert into.
  | { kind: 'parked'; lineName: string };

/**
 * What the played move means, when it isn't this line's own move but IS
 * another line's move from this position (TRANSPOSITIONS.md §9). Null when no
 * line of the user's plays it here — an ordinary wrong move.
 */
export function judgeOtherLineMove(
  index: PositionIndex,
  preFen: string,
  uci: string,
  currentLineId: string,
): DivertVerdict | null {
  const answers = index.siblingAnswers(preFen, currentLineId);
  const matched = answers.find(e => sameMove(e.uci, uci));
  if (!matched) return null;

  if (!matched.inTraining) {
    return { kind: 'parked', lineName: matched.lineName || 'Untitled line' };
  }

  // Every distinct in-training move here, `siblingAnswers`' own in-training-first
  // order kept so a tie between two lines sharing a move favours the same one
  // consistently.
  const seen = new Set<string>();
  const candidates: OtherLineMove[] = [];
  for (const e of answers) {
    if (!e.inTraining) continue;
    const key = e.uci.slice(0, 4);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ lineId: e.lineId, lineName: e.lineName || 'Untitled line', uci: e.uci, ply: e.ply });
  }
  return { kind: 'in-training', candidates };
}
