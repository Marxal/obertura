// Grow your lines — the pure half.
//
// Three things are worth proving here, and the third is the one that would
// actually hurt if it broke:
//
//   1. WHICH LINES ARE OFFERED. Only mastered ones, only where the line ends on
//      the OPPONENT's move, and only within the depth cap.
//   2. WHAT IS OFFERED AT THE END. The three sources in the app's established
//      order — your games, the book, a scouted opponent — each carrying one
//      reason, with the floors that keep a one-off out of it.
//   3. A REST IS NEVER A REMOVAL. Skipping a line stands it aside for a day;
//      on a repertoire with one mastered line it still comes back, because an
//      empty exercise is a worse answer than the same line again.
//
// No DOM, no storage, no network — the rest log is localStorage and lives
// outside this file, exactly as the other pickers' logs do.

import { Chess } from 'chess.js';
import {
  growSpot, growCandidates, growMoves, pickGrowSpots, firstGrowTarget, uciAt,
  GROW_MAX_PLIES, type GrowSpot, type GrowSources,
} from './grow-line';
import type { Line } from './types';
import type { MoveNode } from './tree';
import type { Review } from './scheduler';
import { positionKey } from './position-index';
import type { PositionReplyIndex, ScoutIndex } from './coverage-gaps';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const NOW = 1_000_000;
const DAY = 24 * 60 * 60 * 1000;

const SOLID: Review = {
  due: new Date(NOW + 30 * DAY),
  interval: 30, ease: 2.5, reps: 4, lapses: 0,
};

/** A line built by replaying real SANs, so every fen in it is a real position. */
function mkLine(
  id: string, colour: 'white' | 'black', sans: string[], over: Partial<Line> = {},
): Line {
  const chess = new Chess();
  const root: MoveNode = {
    id: 'root', san: '', uci: '', fen: chess.fen(), children: [],
  };
  let cursor = root;
  sans.forEach((san, i) => {
    const m = chess.move(san);
    if (!m) throw new Error(`illegal SAN in test line: ${san}`);
    const mine = colour === 'white' ? i % 2 === 0 : i % 2 === 1;
    const node: MoveNode = {
      id: `${id}-${i}`, san: m.san, uci: m.from + m.to + (m.promotion ?? ''),
      fen: chess.fen(), children: [],
      // Only the user's own moves carry review records — the scheduler tracks
      // the moves you have to remember, not the ones played at you.
      ...(mine ? { review: { ...SOLID } } : {}),
    };
    cursor.children = [node];
    cursor = node;
  });
  return {
    id, name: id, tags: [], colour, openingName: null,
    confidence: 4, lastTrained: new Date(NOW).toISOString(), inTraining: true,
    tree: root, timesTrained: 5, ownMoves: 2,
    ...over,
  };
}

/** The position a line ends at, as the evidence indexes key it. */
function endKey(line: Line): string {
  const spot = growSpot(line);
  if (!spot) throw new Error(`no spot for ${line.id}`);
  return spot.key;
}

const RUY = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4'];  // 7 plies, black to move

export function runGrowLineSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail: detail || (pass ? 'ok' : 'failed') });
  };

  // ── Where does a line stop? ────────────────────────────────────────────────
  {
    const white = mkLine('w', 'white', RUY);
    const spot = growSpot(white);
    check('a White line ending on White’s move has a spot', !!spot);
    check('…and it is Black to move there',
      !!spot && new Chess(spot.fen).turn() === 'b', spot?.fen ?? '');
    check('…standing at the end of the line',
      spot?.ply === RUY.length, String(spot?.ply));

    // Ending on the opponent's move is a coverage gap (an unanswered reply),
    // not a line to grow — a different feature, deliberately.
    const unanswered = mkLine('w2', 'white', RUY.slice(0, 6));
    check('a line ending on the opponent’s move is not offered',
      growSpot(unanswered) === null);

    const black = mkLine('b', 'black', ['e4', 'c5', 'Nf3', 'd6']);
    check('a Black line ending on Black’s move has a spot', !!growSpot(black));

    check('an empty line has nowhere to grow',
      growSpot(mkLine('empty', 'white', [])) === null);
  }

  // ── Depth cap ──────────────────────────────────────────────────────────────
  {
    const long: string[] = [];
    const chess = new Chess();
    // A legal shuffle that runs well past the cap without repeating a position
    // in a way chess.js would reject.
    while (long.length <= GROW_MAX_PLIES + 1) {
      const moves = chess.moves();
      const m = chess.move(moves[0]);
      if (!m) break;
      long.push(m.san);
    }
    const deep = mkLine('deep', long.length % 2 === 1 ? 'white' : 'black', long);
    check('past the depth cap there is nothing to prepare',
      growSpot(deep) === null, `${long.length} plies`);
  }

  // ── Which lines are candidates ─────────────────────────────────────────────
  {
    const mastered = mkLine('m', 'white', RUY);
    check('a mastered line is a candidate', growCandidates([mastered]).length === 1);

    check('a paused line is not',
      growCandidates([mkLine('p', 'white', RUY, { inTraining: false })]).length === 0);
    // ownMoves 0 means prepared moves continue past this end — nothing to add.
    check('a line that already continues is not',
      growCandidates([mkLine('c', 'white', RUY, { ownMoves: 0 })]).length === 0);
    check('a line with too few runs is not',
      growCandidates([mkLine('r', 'white', RUY, { timesTrained: 1 })]).length === 0);
    check('a line you are not confident in is not',
      growCandidates([mkLine('u', 'white', RUY, { confidence: 1 })]).length === 0);

    // Strongest first — the exercise's claim is "you know this one".
    const weak = mkLine('weak', 'white', RUY, { confidence: 3 });
    const strong = mkLine('strong', 'white', RUY, { confidence: 5 });
    check('the strongest line leads',
      growCandidates([weak, strong])[0].line.id === 'strong');
  }

  // ── The continuations, and the reason on each ──────────────────────────────
  {
    const line = mkLine('m', 'white', RUY);
    const spot = growSpot(line)!;
    const key = endKey(line);

    // 4…Nf6 faced four times; 4…b5 faced once (below the floor).
    const games: PositionReplyIndex = new Map([[key, new Map([
      [uciAt(spot.fen, 'Nf6')!, 4],
      [uciAt(spot.fen, 'b5')!, 1],
    ])]]);
    const book = new Map([['b5', 12], ['Nf6', 40]]);
    const scouts: ScoutIndex = new Map([[key, [
      { name: 'Kevin', uci: uciAt(spot.fen, 'd6')!, games: 5 },
      { name: 'Sam', uci: uciAt(spot.fen, 'f5')!, games: 1 },
    ]]]);

    const moves = growMoves(spot, { games, scouts, book });
    check('three moves are offered', moves.length === 3, String(moves.length));
    check('your own games lead',
      moves[0].san === 'Nf6' && moves[0].source === 'games', moves[0]?.san);
    check('…and say how often you faced it',
      moves[0].reason === 'you have faced this 4 times', moves[0]?.reason);
    check('the book comes next, biggest branch first',
      moves[1].san === 'b5' && moves[1].source === 'library', moves[1]?.san);
    check('…and says how much theory goes that way',
      moves[1].reason === '12 openings continue this way', moves[1]?.reason);
    check('a scouted opponent is last, and named',
      moves[2].source === 'scout' && moves[2].opponentName === 'Kevin', moves[2]?.reason);

    // The tiers are absolute, not weighted: a second book move takes the third
    // slot ahead of a scout, however many games the scout has behind them. What
    // theory plays is a better bet than what one person you looked up plays.
    const withMore = growMoves(spot, {
      games, scouts, book: new Map([...book, ['Be7', 3]]),
    });
    check('a book move outranks a scouted one',
      withMore[2].san === 'Be7' && withMore.every(m => m.source !== 'scout'),
      withMore.map(m => `${m.san}:${m.source}`).join(' '));

    // One game is an accident; two is a thing that happens to you. b5 was faced
    // once, so it is on the list as the BOOK's move, not as one of yours.
    check('a move faced once doesn’t qualify as yours',
      moves.every(m => !(m.san === 'b5' && m.source === 'games')));
    check('one opponent game doesn’t qualify either',
      moves.every(m => m.opponentName === 'Kevin' || m.source !== 'scout'));

    // A move the book and your games both know keeps YOUR reason — the first
    // source to reach it owns it.
    check('the strongest source owns the reason',
      moves.filter(m => m.san === 'Nf6').length === 1);

    // The tail of a real book node is a long list of one-opening curiosities.
    // Only the main continuation is exempt from the floor.
    const noisy = growMoves(spot, {
      book: new Map([['Nf6', 468], ['Bc5', 4], ['Be7', 1], ['Nd4', 1], ['Nge7', 1]]),
    });
    check('a one-opening sideline is not worth preparing for',
      noisy.length === 2 && noisy.map(m => m.san).join(',') === 'Nf6,Bc5',
      noisy.map(m => `${m.san}:${m.weight}`).join(' '));
    check('…but the book’s only continuation always is',
      growMoves(spot, { book: new Map([['Nge7', 1]]) }).length === 1);

    check('nothing known here means nothing offered',
      growMoves(spot, {}).length === 0);
    check('an illegal stored move is dropped rather than shown',
      growMoves(spot, { games: new Map([[key, new Map([['a1a8', 9]])]]) }).length === 0);
  }

  // ── A rest is never a removal ──────────────────────────────────────────────
  {
    const a = mkLine('a', 'white', RUY, { confidence: 5 });
    const b = mkLine('b', 'white', RUY, { confidence: 4 });
    const spots = growCandidates([a, b]);
    const resting = (id: string) => (lineId: string): number =>
      lineId === id ? NOW + DAY : 0;

    check('a skipped line steps aside for the next one',
      pickGrowSpots(spots, 1, resting('a'), NOW)[0].line.id === 'b');
    check('…but is still dealt when it is all there is',
      pickGrowSpots(growCandidates([a]), 1, resting('a'), NOW).length === 1);
    check('yesterday’s rest does not hold today',
      pickGrowSpots(spots, 1, () => NOW - DAY, NOW)[0].line.id === 'a');
  }

  // ── The target: skip a line nobody knows anything about ────────────────────
  {
    const known = mkLine('known', 'white', RUY, { confidence: 4 });
    const blank = mkLine('blank', 'white', ['d4', 'd5', 'c4', 'e6', 'Nc3'], { confidence: 5 });
    const spots = growCandidates([blank, known]);
    check('the unknown line leads on strength', spots[0].line.id === 'blank');

    const bookAt = (spot: GrowSpot): GrowSources =>
      spot.line.id === 'known' ? { book: new Map([['b5', 12]]) } : {};
    const target = firstGrowTarget(spots, bookAt);
    check('but the target is the line we can actually say something about',
      target?.spot.line.id === 'known', target?.spot.line.id ?? 'none');
    check('…with its moves attached', (target?.moves.length ?? 0) === 1);

    check('nothing anywhere means no target',
      firstGrowTarget(spots, () => ({})) === null);
  }

  // Sanity: the key a spot reports is the key the evidence indexes are built on.
  {
    const line = mkLine('k', 'white', RUY);
    const spot = growSpot(line)!;
    check('the spot’s key is the position key of its fen',
      spot.key === positionKey(spot.fen));
  }

  return results;
}
