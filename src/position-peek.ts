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

// One figure in the row above the board: a big number and its label. `tone`
// colours the number — 'ok' green, 'mid' amber, 'low' red — so a bad figure
// reads as bad without needing the label.
export interface PeekStat {
  value: string;
  label: string;
  tone?: 'ok' | 'mid' | 'low';
}

export interface PositionPeekOptions {
  fen: string;
  orientation: 'white' | 'black';
  /** Figures above the board — misses, attempts, recall, streak… */
  stats?: PeekStat[];
  /** One quiet line under the actions (scheduling, opening, whatever fits). */
  footnote?: string;
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

  if (opts.stats?.length) sheet.appendChild(buildStatRow(opts.stats));

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

  if (opts.footnote) {
    const foot = document.createElement('div');
    foot.className = 'peek-foot';
    foot.textContent = opts.footnote;
    sheet.appendChild(foot);
  }

  const removeBack = pushBack(() => close());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

// The row of figures. Shared with the line popup so a stat cell looks the same
// wherever it appears.
export function buildStatRow(stats: PeekStat[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'peek-stats';
  for (const s of stats) row.appendChild(buildStatCell(s));
  return row;
}

export function buildStatCell(s: PeekStat): HTMLElement {
  const cell = document.createElement('div');
  cell.className = 'peek-stat' + (s.tone ? ` peek-stat--${s.tone}` : '');
  const v = document.createElement('span');
  v.className = 'peek-stat-value';
  v.textContent = s.value;
  cell.appendChild(v);
  const l = document.createElement('span');
  l.className = 'peek-stat-label';
  l.textContent = s.label;
  cell.appendChild(l);
  return cell;
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
