// The results-row popup for the "from your games" exercises: one position on a
// real board, the moves drawn on it, a line of context, and a way into the full
// analyser.
//
// It started inside mistake-run.ts, where the mistake drill's results rows have
// always been tappable. Blunder detective and Which move copied the results
// SCREEN but not that, so their rows were the only ones in the app that looked
// like buttons and did nothing — the run finishes, you see the case you got
// wrong, and there is no way to look at it again short of starting another
// session. Lifting the popup out is what let all three share it.
//
// It is deliberately NOT position-peek.ts, which serves the repertoire drills:
// that one is about a saved line (notes, turning it off, editing it in the
// builder), this one is about a position out of a game you played.

import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { registerBrushes, HINT_COLOR } from './board-brushes';
import { Icons } from './icons';
import { pushBack } from './back-nav';

export interface SpotPeekArrow {
  uci: string;
  /** 'danger' = the move that was played (red); 'accent' = the engine's (blue). */
  kind: 'danger' | 'accent';
}

export interface SpotPeekOptions {
  fen: string;
  orientation: 'white' | 'black';
  /** Drawn on the board, in the order given. */
  arrows?: SpotPeekArrow[];
  /** One quiet line under the board — the moves and who it was against. */
  meta?: string;
  /**
   * "Analyse game" — omitted where the caller can't hand off to the analyser.
   * The popup closes itself before calling it.
   */
  onAnalyse?: () => void;
}

function uciParts(uci: string): { from: Key; to: Key } {
  return { from: uci.slice(0, 2) as Key, to: uci.slice(2, 4) as Key };
}

export function openSpotPeek(o: SpotPeekOptions): void {
  const ov = document.createElement('div');
  ov.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet peek-sheet';

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    ov.remove();
    removePeekBack();
  };

  const board = document.createElement('div');
  board.className = 'peek-board cg-wrap';
  sheet.appendChild(board);

  const pcg = Chessground(board, {
    fen: o.fen,
    orientation: o.orientation,
    viewOnly: true,
    coordinates: false,
    animation: { enabled: false },
    drawable: { enabled: false, visible: true },
  });
  registerBrushes(pcg, {
    accent: { color: HINT_COLOR, opacity: 0.9, lineWidth: 10 },
    danger: { color: '#c93636', opacity: 0.8, lineWidth: 10 },
  });
  const shapes: DrawShape[] = (o.arrows ?? []).map((a) => {
    const { from, to } = uciParts(a.uci);
    return { orig: from, dest: to, brush: a.kind };
  });
  pcg.setAutoShapes(shapes);
  requestAnimationFrame(() => pcg.redrawAll());

  if (o.meta) {
    const meta = document.createElement('div');
    meta.className = 'mr-peek-meta';
    meta.textContent = o.meta;
    sheet.appendChild(meta);
  }

  const btnRow = document.createElement('div');
  btnRow.className = 'peek-actions';
  if (o.onAnalyse) {
    const onAnalyse = o.onAnalyse;
    const analyse = document.createElement('button');
    analyse.type = 'button';
    analyse.className = 'peek-action';
    analyse.appendChild(Icons.review(18));
    const lbl = document.createElement('span');
    lbl.textContent = 'Analyse game';
    analyse.appendChild(lbl);
    analyse.addEventListener('click', () => { close(); onAnalyse(); });
    btnRow.appendChild(analyse);
  }
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'peek-action';
  closeBtn.appendChild(Icons.back(18));
  const closeLbl = document.createElement('span');
  closeLbl.textContent = 'Close';
  closeBtn.appendChild(closeLbl);
  closeBtn.addEventListener('click', close);
  btnRow.appendChild(closeBtn);
  sheet.appendChild(btnRow);

  const removePeekBack = pushBack(close);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

  ov.appendChild(sheet);
  document.body.appendChild(ov);
}
