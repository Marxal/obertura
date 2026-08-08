// A small popup showing one position on a real (view-only) board, plus a row of
// actions. Lifted out of train-screen.ts, where it served the results screen's
// tapped rows, so the Statistics forgotten-moves list can open the same thing.
//
// Two flavours, from the same component:
//   • quizzing (training results) — the move stays hidden behind a Hint action.
//   • reviewing (Statistics)      — pass `revealUci` and the arrow is drawn at
//     once, because there's nothing to test here, only something to look at.

import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import { registerBrushes } from './board-brushes';
import { Icons } from './icons';
import { pushBack } from './back-nav';

export interface PeekAction {
  icon: SVGElement;
  label: string;
  // `close` lets an action dismiss the popup first (e.g. before navigating);
  // `disable` greys the button out once it's been used (e.g. "Turn off").
  onClick: (ctx: { close: () => void; disable: () => void }) => void;
}

export interface PositionPeekOptions {
  fen: string;
  orientation: 'white' | 'black';
  /** Heading above the board (e.g. "8. ♞f3 — Italian Game"). */
  title?: string;
  /** One quiet line under the heading (e.g. "Missed 9× · failed 3 in a row"). */
  subtitle?: string;
  /** The move's written note, shown in the drill's note-card styling. */
  note?: string;
  /** Draw this move's arrow straight away — for review, not for quizzing. */
  revealUci?: string;
  /** Add a Hint action that draws this move's arrow on demand — for quizzing. */
  hintUci?: string;
  actions?: PeekAction[];
}

export function openPositionPeek(opts: PositionPeekOptions): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet peek-sheet';

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  };

  if (opts.title) {
    const h = document.createElement('h3');
    h.className = 'edit-sheet-title peek-title';
    h.textContent = opts.title;
    sheet.appendChild(h);
  }
  if (opts.subtitle) {
    const sub = document.createElement('div');
    sub.className = 'peek-sub';
    sub.textContent = opts.subtitle;
    sheet.appendChild(sub);
  }

  const board = document.createElement('div');
  board.className = 'peek-board cg-wrap';
  sheet.appendChild(board);

  const cg = Chessground(board, {
    fen: opts.fen,
    orientation: opts.orientation,
    viewOnly: true,
    coordinates: false,
    animation: { enabled: false },
    drawable: { enabled: false, visible: true },
  });
  registerBrushes(cg, { accent: { color: '#ff9b21', opacity: 0.9, lineWidth: 10 } });

  const arrow = (uci: string): void => {
    cg.setAutoShapes([{ orig: uci.slice(0, 2) as Key, dest: uci.slice(2, 4) as Key, brush: 'accent' }]);
  };

  // Mounted into a transient popup, so nudge a redraw once it's actually sized —
  // and draw the reveal arrow in the same frame, after chessground's own render.
  requestAnimationFrame(() => {
    cg.redrawAll();
    if (opts.revealUci) arrow(opts.revealUci);
  });

  if (opts.note) {
    const noteEl = document.createElement('div');
    noteEl.className = 'peek-note';
    noteEl.textContent = opts.note;
    sheet.appendChild(noteEl);
  }

  const btnRow = document.createElement('div');
  btnRow.className = 'peek-actions';

  if (opts.hintUci) {
    btnRow.appendChild(peekActionBtn(Icons.bulb(18), 'Hint', () => arrow(opts.hintUci!)));
  }
  for (const action of opts.actions ?? []) {
    const btn = peekActionBtn(action.icon, action.label, () =>
      action.onClick({ close, disable: () => { btn.disabled = true; } }));
    btnRow.appendChild(btn);
  }

  if (btnRow.childElementCount > 0) sheet.appendChild(btnRow);

  const removeBack = pushBack(() => close());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

export function peekActionBtn(icon: SVGElement, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'peek-action';
  btn.appendChild(icon);
  const lbl = document.createElement('span');
  lbl.textContent = label;
  btn.appendChild(lbl);
  btn.addEventListener('click', onClick);
  return btn;
}
