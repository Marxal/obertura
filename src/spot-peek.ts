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
  /**
   * Enables the left/right nav arrows for browsing between results-row
   * positions without closing the popup. `dir` is -1 for "previous", +1 for
   * "next"; return the options for that neighbour, or null at the end of the
   * list (the arrow renders disabled).
   */
  onNav?: (dir: -1 | 1) => SpotPeekOptions | null;
}

function uciParts(uci: string): { from: Key; to: Key } {
  return { from: uci.slice(0, 2) as Key, to: uci.slice(2, 4) as Key };
}

export function openSpotPeek(initial: SpotPeekOptions): void {
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

  const boardWrap = document.createElement('div');
  boardWrap.className = 'peek-board-wrap';
  const board = document.createElement('div');
  board.className = 'peek-board cg-wrap';
  boardWrap.appendChild(board);
  sheet.appendChild(boardWrap);

  const pcg = Chessground(board, {
    fen: initial.fen,
    orientation: initial.orientation,
    viewOnly: true,
    coordinates: false,
    animation: { enabled: false },
    drawable: { enabled: false, visible: true },
  });
  registerBrushes(pcg, {
    accent: { color: HINT_COLOR, opacity: 0.9, lineWidth: 10 },
    danger: { color: '#c93636', opacity: 0.8, lineWidth: 10 },
  });

  let prevBtn: HTMLButtonElement | null = null;
  let nextBtn: HTMLButtonElement | null = null;

  const meta = document.createElement('div');
  meta.className = 'mr-peek-meta';
  meta.hidden = true;
  sheet.appendChild(meta);

  const btnRow = document.createElement('div');
  btnRow.className = 'peek-actions';

  const analyse = document.createElement('button');
  analyse.type = 'button';
  analyse.className = 'peek-action';
  analyse.hidden = true;
  analyse.appendChild(Icons.review(18));
  const analyseLbl = document.createElement('span');
  analyseLbl.textContent = 'Analyse game';
  analyse.appendChild(analyseLbl);
  btnRow.appendChild(analyse);

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

  // Renders one position into the already-mounted board/meta/analyse button,
  // so browsing between results-row positions doesn't flash the whole popup
  // closed and reopened.
  const render = (o: SpotPeekOptions): void => {
    pcg.set({ fen: o.fen, orientation: o.orientation });
    const shapes: DrawShape[] = (o.arrows ?? []).map((a) => {
      const { from, to } = uciParts(a.uci);
      return { orig: from, dest: to, brush: a.kind };
    });
    pcg.setAutoShapes(shapes);
    requestAnimationFrame(() => pcg.redrawAll());

    meta.textContent = o.meta ?? '';
    meta.hidden = !o.meta;

    analyse.hidden = !o.onAnalyse;
    const onAnalyse = o.onAnalyse;
    analyse.onclick = onAnalyse ? () => { close(); onAnalyse(); } : null;

    if (o.onNav) {
      if (!prevBtn || !nextBtn) {
        prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'peek-nav peek-nav--prev';
        prevBtn.setAttribute('aria-label', 'Previous position');
        prevBtn.appendChild(Icons.back(20));
        nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'peek-nav peek-nav--next';
        nextBtn.setAttribute('aria-label', 'Next position');
        nextBtn.appendChild(Icons.chevronRight(20));
        boardWrap.appendChild(prevBtn);
        boardWrap.appendChild(nextBtn);
      }
      const prevO = o.onNav(-1);
      const nextO = o.onNav(1);
      prevBtn.disabled = !prevO;
      prevBtn.onclick = prevO ? () => render(prevO) : null;
      nextBtn.disabled = !nextO;
      nextBtn.onclick = nextO ? () => render(nextO) : null;
    } else if (prevBtn && nextBtn) {
      prevBtn.remove();
      nextBtn.remove();
      prevBtn = null;
      nextBtn = null;
    }
  };
  render(initial);

  const removePeekBack = pushBack(close);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

  ov.appendChild(sheet);
  document.body.appendChild(ov);
}
