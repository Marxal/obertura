// The moves that reach a position, as one row you can swipe, with back and forward.
//
// Every move shows its position. The owner keeps track of the board; this only says
// which position was asked for, and scrolls the row to keep that move in view.

import { Icons } from './icons';
import { formatMove } from './notation';
import { t } from './i18n';

export interface LineStrip {
  el: HTMLElement;
  /**
   * Redraw for this list of moves, showing the position after `at` of them. From
   * `pendingFrom` on they're dimmed: a line ends on your move, so a reply you haven't
   * answered isn't part of what Save would keep. `startPly` numbers a line that
   * doesn't begin at the first move (0 is 1.White, 1 is 1...Black).
   */
  update: (sans: string[], at: number, pendingFrom?: number, startPly?: number) => void;
}

function stepButton(label: string, icon: SVGElement, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'nr-step';
  b.setAttribute('aria-label', label);
  b.appendChild(icon);
  b.addEventListener('click', onClick);
  return b;
}

export function buildLineStrip(onShow: (at: number) => void): LineStrip {
  let total = 0;
  let current = 0;

  const el = document.createElement('div');
  el.className = 'nr-line';
  const row = document.createElement('div');
  row.className = 'nr-moves';
  const back = stepButton(t('builder.previousMove'), Icons.back(20), () => {
    if (current > 0) onShow(current - 1);
  });
  const forward = stepButton(t('builder.nextMove'), Icons.chevronRight(20), () => {
    if (current < total) onShow(current + 1);
  });
  el.append(back, row, forward);

  const update = (sans: string[], at: number, pendingFrom = Infinity, startPly = 0): void => {
    total = sans.length;
    current = at;
    row.replaceChildren();
    let active: HTMLElement | null = null;
    sans.forEach((san, i) => {
      const move = document.createElement('button');
      move.type = 'button';
      move.className = 'nr-move';
      const ply = startPly + i;
      const white = ply % 2 === 0;
      if (white || i === 0) {
        const number = document.createElement('span');
        number.className = 'nr-move-number';
        number.textContent = `${Math.floor(ply / 2) + 1}${white ? '.' : '…'}`;
        move.appendChild(number);
      }
      move.append(formatMove(san));
      if (i >= pendingFrom) move.classList.add('nr-move--pending');
      move.addEventListener('click', () => onShow(i + 1));
      if (i + 1 === at) {
        move.classList.add('nr-move--now');
        move.setAttribute('aria-current', 'true');
        active = move;
      }
      row.appendChild(move);
    });
    back.disabled = at <= 0;
    forward.disabled = at >= total;
    // Sideways only: scrollIntoView would also move the page.
    requestAnimationFrame(() => {
      const target = active as HTMLElement | null;
      row.scrollLeft = target
        ? target.offsetLeft - (row.clientWidth - target.offsetWidth) / 2
        : 0;
    });
  };
  return { el, update };
}
