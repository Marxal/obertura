import type { Line } from './types';
import type { MoveNode } from './tree';
import { mainlineNodes, isReviewDue, interleaveNew } from './scheduler';

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
  prevUci?: string;      // the opponent's move that led to preFen (mark / replay)
  prevFen?: string;      // the position before that opponent move (replay start)
}

// The standard chess start position — used when a quizzed move is so early that
// the position before it (or before the opponent's reply) is the opening itself.
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// First ply we'll ever quiz. Index 4 = White's 3rd move / Black's 3rd move, so
// the board always opens somewhere mid-opening rather than on move 1.
const MIN_PLY_INDEX = 4;
// A comfortable cap on one set, so the stream of dots never feels endless.
const DEFAULT_MAX = 20;

interface Candidate extends IndividualPosition {
  due: boolean;
  isNew: boolean;
  lapses: number;
  dueTime: number;
}

function candidatesFor(line: Line, now: Date, minPly: number): Candidate[] {
  const nodes = mainlineNodes(line.tree);
  const out: Candidate[] = [];
  for (let i = minPly; i < nodes.length; i++) {
    const isUserMove = line.colour === 'white' ? i % 2 === 0 : i % 2 === 1;
    if (!isUserMove) continue;
    const expected = nodes[i];
    const review = expected.review;
    out.push({
      lineId: line.id,
      // Position before this move. At i === 0 (White's first move) that's the
      // opening itself; otherwise the previous node.
      preFen: i >= 1 ? nodes[i - 1].fen : START_FEN,
      expected,
      // The opponent's move into this position, and the position before it (for
      // the replay). Both are absent/START_FEN this early in a line.
      prevUci: i >= 1 ? nodes[i - 1].uci : undefined,
      prevFen: i >= 2 ? nodes[i - 2].fen : i === 1 ? START_FEN : undefined,
      due: isReviewDue(review, now),
      isNew: !review,
      lapses: review?.lapses ?? 0,
      dueTime: review ? new Date(review.due).getTime() : now.getTime(),
    });
  }
  return out;
}

export function selectIndividualPositions(
  lines: Line[],
  opts: { now?: Date; max?: number; includePaused?: boolean; minPly?: number } = {},
): IndividualPosition[] {
  const now = opts.now ?? new Date();
  const max = opts.max ?? DEFAULT_MAX;
  const minPly = opts.minPly ?? MIN_PLY_INDEX;

  const all: Candidate[] = [];
  for (const line of lines) {
    if (!opts.includePaused && !line.inTraining) continue;
    all.push(...candidatesFor(line, now, minPly));
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
  const dueSorted = uniq.filter(c => c.due).sort(byWeakness);
  // …except that weakest-first alone would bury everything you just ADDED. A
  // never-trained move has no lapses, so it sorts below every move you have
  // ever missed — and lapses only ever grow, so with a set of three a new line's
  // moves could wait for ever behind the same old sore spots. So new material
  // takes every third slot of the due pool instead of queueing at the back of
  // it, the same bargain dueLines strikes for whole lines.
  const duePool = interleaveNew(
    dueSorted.filter(c => c.isNew),
    dueSorted.filter(c => !c.isNew),
  );
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

  return blended.map(({ lineId, preFen, expected, prevUci, prevFen }) =>
    ({ lineId, preFen, expected, prevUci, prevFen }));
}

// Time attack must always be playable when there's anything saved at all. Try
// the normal in-training pool first; if it comes up empty (very little trained
// yet, or only shallow lines), broaden to EVERY saved line and the shallowest
// moves so a run is still possible with at least one position. Returns empty
// only when there are literally no saved user-moves anywhere.
export function selectTimedPositions(
  lines: Line[],
  opts: { now?: Date; max?: number } = {},
): IndividualPosition[] {
  const normal = selectIndividualPositions(lines, opts);
  if (normal.length > 0) return normal;
  return selectIndividualPositions(lines, { ...opts, includePaused: true, minPly: 0 });
}
