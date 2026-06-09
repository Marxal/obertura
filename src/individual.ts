import type { Line } from './types';
import type { MoveNode } from './tree';
import { mainlineNodes, isReviewDue } from './scheduler';

// ── Individual-moves selection ──────────────────────────────────────────────────
//
// "Individual moves" training is a stream of single positions, not a walk down a
// whole line. This picks WHICH positions to drill, reusing the data the
// scheduler already keeps on each move (due date + lifetime lapses):
//
//   • due moves   — the ones spaced repetition says it's time to see again;
//   • weak moves  — the ones I keep missing (most lapses), even if not due yet.
//
// The set blends the two so a session mixes "what's scheduled" with "what I'm
// bad at". Very early positions are skipped — move 1–2 is shared by half the
// repertoire and too easy to be worth a rep — so every position starts at
// move 3 or deeper.

export interface IndividualPosition {
  lineId: string;
  preFen: string;        // the position to show (before the user's move)
  expected: MoveNode;    // the one correct move to play
}

// First ply we'll ever quiz. Index 4 = White's 3rd move / Black's 3rd move, so
// the board always opens somewhere mid-opening rather than on move 1.
const MIN_PLY_INDEX = 4;
// A comfortable cap on one set, so the stream of dots never feels endless.
const DEFAULT_MAX = 20;

interface Candidate extends IndividualPosition {
  due: boolean;
  lapses: number;
  dueTime: number;
}

function candidatesFor(line: Line, now: Date): Candidate[] {
  const nodes = mainlineNodes(line.tree);
  const out: Candidate[] = [];
  for (let i = MIN_PLY_INDEX; i < nodes.length; i++) {
    const isUserMove = line.colour === 'white' ? i % 2 === 0 : i % 2 === 1;
    if (!isUserMove) continue;
    const expected = nodes[i];
    const review = expected.review;
    out.push({
      lineId: line.id,
      preFen: nodes[i - 1].fen, // position before this move (i ≥ 4, so safe)
      expected,
      due: isReviewDue(review, now),
      lapses: review?.lapses ?? 0,
      dueTime: review ? new Date(review.due).getTime() : now.getTime(),
    });
  }
  return out;
}

export function selectIndividualPositions(
  lines: Line[],
  opts: { now?: Date; max?: number } = {},
): IndividualPosition[] {
  const now = opts.now ?? new Date();
  const max = opts.max ?? DEFAULT_MAX;

  const all: Candidate[] = [];
  for (const line of lines) {
    if (!line.inTraining) continue;
    all.push(...candidatesFor(line, now));
  }

  // Drop duplicate prep shared across lines (same position + same answer).
  const seen = new Set<string>();
  const uniq = all.filter(c => {
    const key = c.preFen + ' ' + c.expected.uci;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Two pools: due now, and not-yet-due-but-weak. Each is ordered weakest-first
  // (then soonest-due) so the shakiest material leads.
  const byWeakness = (a: Candidate, b: Candidate) =>
    b.lapses - a.lapses || a.dueTime - b.dueTime;
  const duePool = uniq.filter(c => c.due).sort(byWeakness);
  const weakPool = uniq.filter(c => !c.due && c.lapses > 0).sort(byWeakness);

  // Interleave the pools so the set genuinely blends due reviews with weak spots
  // rather than front-loading one kind.
  const blended: Candidate[] = [];
  let i = 0, j = 0;
  while (blended.length < max && (i < duePool.length || j < weakPool.length)) {
    if (i < duePool.length) blended.push(duePool[i++]);
    if (j < weakPool.length && blended.length < max) blended.push(weakPool[j++]);
  }

  // Nothing due and nothing missed yet — still give the mode something to do by
  // surfacing the positions coming up soonest.
  if (blended.length === 0) {
    blended.push(...[...uniq].sort((a, b) => a.dueTime - b.dueTime).slice(0, max));
  }

  return blended.map(({ lineId, preFen, expected }) => ({ lineId, preFen, expected }));
}
