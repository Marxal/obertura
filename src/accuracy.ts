// Per-player game accuracy, following Lichess's published model
// (https://lichess.org/page/accuracy):
//
//   Win%       = 50 + 50 · (2 / (1 + e^(−0.00368208·cp)) − 1)
//   Accuracy%  = 103.1668 · e^(−0.04354·(winBefore − winAfter)) − 3.1669
//
// per move (in the MOVER's perspective, clamped 0..100), then aggregated per
// colour as the average of a volatility-weighted mean (sharp phases of the game
// weigh more) and a harmonic mean (one blunder can't hide behind many easy
// moves). Pure arithmetic over the reviewer's stored evals — no network, no
// chess.js; self-tested in accuracy.selftest.ts.

// White's winning chances in percent (0..100) from a white-perspective eval.
export function winPercentFromCp(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

// One move's accuracy from the mover's win% before and after it. A move that
// keeps (or improves) the position scores ~100; bigger drops decay
// exponentially toward 0.
export function moveAccuracyPercent(before: number, after: number): number {
  const drop = Math.max(0, before - after);
  const raw = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669;
  return Math.max(0, Math.min(100, raw));
}

export interface PlayerAccuracy {
  white: number | null; // null when that colour has no scoreable moves
  black: number | null;
}

// Lichess's aggregation shape: sliding-window volatility for the weights,
// window sized to the game, both clamps as in lila.
const WINDOW_MIN = 2;
const WINDOW_MAX = 8;
const WEIGHT_MIN = 0.5;
const WEIGHT_MAX = 12;

function stddev(xs: number[]): number {
  if (!xs.length) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / xs.length;
  return Math.sqrt(variance);
}

function weightedMean(values: number[], weights: number[]): number {
  let sum = 0, wsum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] * weights[i];
    wsum += weights[i];
  }
  return wsum ? sum / wsum : 0;
}

function harmonicMean(values: number[]): number {
  let inv = 0;
  // Floor each accuracy well above zero so a single 0-accuracy move can't
  // collapse the harmonic mean through a division blow-up.
  for (const v of values) inv += 1 / Math.max(v, 0.1);
  return values.length ? values.length / inv : 0;
}

/**
 * Game accuracy per colour from the reviewer's eval trail: `evalsCp[i]` is the
 * WHITE-perspective eval (centipawns; mate = large sentinel) AFTER ply i
 * (ply 0 = White's first move), `undefined` where a move wasn't reviewed.
 * A move is scoreable only when the evals on both sides of it are known (the
 * game is assumed to start at the standard position, eval 0).
 */
export function gameAccuracy(evalsCp: (number | undefined)[]): PlayerAccuracy {
  // White win% at every known point, for the volatility windows: the start
  // position, then each reviewed ply.
  const wins: number[] = [50];
  // Scoreable moves: mover-perspective accuracy + where their "after" sits in
  // `wins` (for window alignment) + whose move it was.
  const moves: { acc: number; winIdx: number; white: boolean }[] = [];

  let prevWin: number | null = 50; // white win% before the current ply
  for (let i = 0; i < evalsCp.length; i++) {
    const cp = evalsCp[i];
    if (cp === undefined) { prevWin = null; continue; }
    const win = winPercentFromCp(cp);
    wins.push(win);
    if (prevWin !== null) {
      const white = i % 2 === 0;
      const before = white ? prevWin : 100 - prevWin;
      const after = white ? win : 100 - win;
      moves.push({ acc: moveAccuracyPercent(before, after), winIdx: wins.length - 1, white });
    }
    prevWin = win;
  }

  if (!moves.length) return { white: null, black: null };

  // Volatility weight per move: the stddev of the win% window ending at the
  // move, window sized to the game length.
  const windowSize = Math.max(WINDOW_MIN, Math.min(WINDOW_MAX, Math.floor(wins.length / 10)));
  const weightAt = (winIdx: number): number => {
    const from = Math.max(0, winIdx - windowSize + 1);
    const sd = stddev(wins.slice(from, winIdx + 1));
    return Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, sd));
  };

  const side = (white: boolean): number | null => {
    const mine = moves.filter(m => m.white === white);
    if (!mine.length) return null;
    const accs = mine.map(m => m.acc);
    const weighted = weightedMean(accs, mine.map(m => weightAt(m.winIdx)));
    return (weighted + harmonicMean(accs)) / 2;
  };

  return { white: side(true), black: side(false) };
}
