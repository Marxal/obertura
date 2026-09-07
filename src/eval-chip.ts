// The "which move was better" comparison — a move's SAN, what the position
// was worth after it, and one short clause explaining why. First built for
// Which move (which-move-run.ts); shared here so Blunder detective
// (detective-run.ts) and Mistake retry (mistake-run.ts) can show the same
// red/green comparison once their own answer is in.

import { formatMove } from './notation';

/**
 * Fills an element (a `<span>` chip, or a `<button>` that was already a pick)
 * with a move's SAN, its evaluation, and the one clause explaining it. Shared
 * so Which move can put this content straight into the button the user
 * already answered with, instead of a second box underneath it.
 */
export function fillEvalContent(el: HTMLElement, san: string, cp: number, why: string): void {
  el.replaceChildren();
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
  el.appendChild(head);
  if (why) {
    const reason = document.createElement('span');
    reason.className = 'wm-eval-why';
    reason.textContent = why;
    el.appendChild(reason);
  }
}

/**
 * "♝xe6 −5.2 / hangs material on e6" — one move, what the position was worth
 * after it, and the one thing that makes that number make sense. Tappable
 * when `onTap` is given, to show that move's resulting position on the board.
 */
export function evalChip(
  san: string, cp: number, kind: 'good' | 'bad', why: string, onTap?: () => void,
): HTMLElement {
  const chip = document.createElement(onTap ? 'button' : 'span');
  if (onTap) {
    const btn = chip as HTMLButtonElement;
    btn.type = 'button';
    btn.addEventListener('click', onTap);
  }
  chip.className = `wm-eval wm-eval--${kind}` + (onTap ? ' wm-eval--tap' : '');
  fillEvalContent(chip, san, cp, why);
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

/**
 * The two moves side by side: the one played in red, the engine's in green.
 * `onPlayedTap`/`onBestTap`, when given, preview that move's position.
 */
export function evalPairRow(
  playedSan: string, playedCp: number, playedWhy: string,
  bestSan: string, bestCp: number, bestWhy: string,
  onPlayedTap?: () => void, onBestTap?: () => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'wm-facts-evals';
  row.appendChild(evalChip(playedSan, playedCp, 'bad', playedWhy, onPlayedTap));
  row.appendChild(evalChip(bestSan, bestCp, 'good', bestWhy, onBestTap));
  return row;
}
