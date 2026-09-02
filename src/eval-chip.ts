// The "which move was better" comparison — a move's SAN, what the position
// was worth after it, and one short clause explaining why. First built for
// Which move (which-move-run.ts); shared here so Blunder detective
// (detective-run.ts) and Mistake retry (mistake-run.ts) can show the same
// red/green comparison once their own answer is in.

import { formatMove } from './notation';

/**
 * "♝xe6 −5.2 / hangs material on e6" — one move, what the position was worth
 * after it, and the one thing that makes that number make sense.
 */
export function evalChip(san: string, cp: number, kind: 'good' | 'bad', why: string): HTMLElement {
  const chip = document.createElement('span');
  chip.className = `wm-eval wm-eval--${kind}`;
  const head = document.createElement('span');
  head.className = 'wm-eval-head';
  const move = document.createElement('span');
  move.className = 'wm-eval-move';
  move.textContent = formatMove(san);
  head.appendChild(move);
  const num = document.createElement('span');
  num.className = 'wm-eval-cp';
  num.textContent = showCp(cp);
  head.appendChild(num);
  chip.appendChild(head);
  if (why) {
    const reason = document.createElement('span');
    reason.className = 'wm-eval-why';
    reason.textContent = why;
    chip.appendChild(reason);
  }
  return chip;
}

// Mate scores are stored as big sentinels (winprob.ts), so they get words
// rather than a nonsense number.
export function showCp(cp: number): string {
  if (cp >= 90000) return 'mate';
  if (cp <= -90000) return 'mated';
  const pawns = cp / 100;
  // A real minus sign, not a hyphen: these sit next to a figurine at the same
  // size, and a hyphen reads as a dash between two words.
  return pawns > 0 ? `+${pawns.toFixed(1)}` : pawns.toFixed(1).replace('-', '−');
}

/** The two moves side by side: the one played in red, the engine's in green. */
export function evalPairRow(
  playedSan: string, playedCp: number, playedWhy: string,
  bestSan: string, bestCp: number, bestWhy: string,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'wm-facts-evals';
  row.appendChild(evalChip(playedSan, playedCp, 'bad', playedWhy));
  row.appendChild(evalChip(bestSan, bestCp, 'good', bestWhy));
  return row;
}
