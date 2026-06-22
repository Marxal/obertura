// Library board explorer — an interactive, playable board over the bundled
// opening book. It mirrors the map's board explorer (board-explorer.ts) in look
// and controls, but reads the BOOK (named openings) instead of a game-stats
// tree: the library has no game statistics to show.
//
// You walk a line by playing on the board, tapping a continuation, or stepping
// with the bottom controls. For the current position it shows the opening name
// and the book continuations from here — each move, where it leads, and how many
// named openings lie down that branch. "Open in builder" hands the walked moves
// back to the app shell, exactly like the List and Moves leaves do.
//
// Built as an embedded panel (not its own overlay) so it can live as one of the
// three library view modes; createLibraryExplorer returns its root element plus
// redraw()/destroy() for the host to drive on show/close.

import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import type { Api as CgApi } from 'chessground/api';
import { Icons } from './icons';
import { showDialog } from './dialog';
import { nameForFen, nameForPath } from './openings';
import type { LibraryEntry } from './library';
import { buildBook, bookNodeAt, type BookNode } from './book-tree';
import { formatMove } from './notation';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface LibraryExplorer {
  el: HTMLElement;
  redraw(): void;   // call after the panel is shown (it sizes the board)
  destroy(): void;  // detaches the resize observer
}

export function createLibraryExplorer(
  entries: LibraryEntry[],
  onOpenInBuilder: (ucis: string[], colour: 'white' | 'black') => void,
): LibraryExplorer {
  const book = buildBook(entries);
  const chess = new Chess();
  let orientation: 'white' | 'black' = 'white';

  // The walked line, in lockstep with `chess`. fens/lastMoves are indexed by ply
  // (index 0 = start). `forward` holds moves stepped back out of, for redo.
  const ucis: string[] = [];
  const sans: string[] = [];
  const fens: string[] = [START_FEN];
  const lastMoves: Array<[Key, Key] | undefined> = [undefined];
  const forward: string[] = [];

  const root = document.createElement('div');
  root.className = 'lib-explore';

  // Board.
  const boardWrap = document.createElement('div');
  boardWrap.className = 'bx-board-wrap';
  const boardEl = document.createElement('div');
  boardEl.className = 'bx-board';
  boardWrap.appendChild(boardEl);
  root.appendChild(boardWrap);

  const cg: CgApi = Chessground(boardEl, {
    fen: fens[fens.length - 1],
    orientation,
    turnColor: turnColor(),
    movable: { color: turnColor(), free: false, dests: legalDests() },
    draggable: { showGhost: true },
    animation: { enabled: true, duration: 180 },
    highlight: { lastMove: true, check: false },
    lastMove: lastMoves[lastMoves.length - 1],
    events: { move: onBoardMove },
  });
  const ro = new ResizeObserver(() => cg.redrawAll());
  ro.observe(boardEl);

  // Opening name for the live position.
  const openingEl = document.createElement('div');
  openingEl.className = 'bx-opening';
  root.appendChild(openingEl);

  // Continuation list.
  const list = document.createElement('div');
  list.className = 'bx-list';
  root.appendChild(list);

  // Step controls: flip / reset / back / forward.
  const controls = document.createElement('div');
  controls.className = 'bx-controls';
  const flipBtn = navBtn(Icons.flip(20), 'Flip', 'Flip board', () => {
    orientation = orientation === 'white' ? 'black' : 'white';
    cg.toggleOrientation();
  });
  const resetBtn = navBtn(Icons.reset(20), 'Reset', 'Back to start', reset);
  const backBtn = navBtn(Icons.back(20), 'Back', 'Step back', stepBack);
  const fwdBtn = navBtn(Icons.chevronRight(20), 'Forward', 'Step forward', stepForward);
  controls.append(flipBtn, resetBtn, backBtn, fwdBtn);
  root.appendChild(controls);

  // Open-in-builder action (same flow as the list/tree leaves).
  const actBtn = document.createElement('button');
  actBtn.type = 'button';
  actBtn.className = 'rmap-pos-open-btn bx-action';
  actBtn.textContent = 'Open in builder';
  actBtn.addEventListener('click', () => {
    if (!ucis.length) return;
    showDialog({
      title: 'Open in builder',
      body: 'Which side do you play? The board flips to your colour.',
      buttons: [
        { label: '○ White', variant: 'primary', onClick: () => onOpenInBuilder([...ucis], 'white') },
        { label: '● Black', variant: 'primary', onClick: () => onOpenInBuilder([...ucis], 'black') },
        { label: 'Cancel', variant: 'secondary' },
      ],
    });
  });
  root.appendChild(actBtn);

  render();

  // ── Move plumbing ───────────────────────────────────────────────────────────

  function legalDests(): Map<Key, Key[]> {
    const dests = new Map<Key, Key[]>();
    for (const m of chess.moves({ verbose: true })) {
      const from = m.from as Key;
      if (!dests.has(from)) dests.set(from, []);
      dests.get(from)!.push(m.to as Key);
    }
    return dests;
  }
  function turnColor(): 'white' | 'black' {
    return chess.turn() === 'w' ? 'white' : 'black';
  }

  function record(m: { from: string; to: string; san: string; promotion?: string }): void {
    ucis.push(m.from + m.to + (m.promotion ?? ''));
    sans.push(m.san);
    fens.push(chess.fen());
    lastMoves.push([m.from as Key, m.to as Key]);
  }

  function onBoardMove(from: Key, to: Key): void {
    // chessground only offers legal dests, so this resolves; auto-queen on promo.
    const m = chess.move({ from, to, promotion: 'q' });
    if (m) { record(m); forward.length = 0; }
    render();
  }

  function advance(san: string): void {
    const m = chess.move(san);
    if (m) { record(m); forward.length = 0; }
    render();
  }

  function stepBack(): void {
    if (!ucis.length) return;
    chess.undo();
    forward.push(sans.pop()!);
    ucis.pop();
    fens.pop();
    lastMoves.pop();
    render();
  }

  function stepForward(): void {
    const san = forward.pop();
    if (san) {
      const m = chess.move(san);
      if (m) record(m);
    }
    render();
  }

  function reset(): void {
    chess.reset();
    ucis.length = 0;
    sans.length = 0;
    fens.length = 1;
    lastMoves.length = 1;
    forward.length = 0;
    render();
  }

  // The book node reached by the current SAN path, or null once off the book.
  function bookNodeNow(): BookNode | null {
    return bookNodeAt(book, sans);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  function render(): void {
    cg.set({
      fen: chess.fen(),
      turnColor: turnColor(),
      movable: { color: turnColor(), free: false, dests: legalDests() },
      lastMove: lastMoves[lastMoves.length - 1],
    });

    openingEl.textContent = nameForPath(fens) ?? 'Starting position';

    resetBtn.disabled = backBtn.disabled = ucis.length === 0;
    fwdBtn.disabled = forward.length === 0;
    actBtn.disabled = ucis.length === 0;

    renderList();
  }

  function renderList(): void {
    list.innerHTML = '';
    const node = bookNodeNow();
    const kids = node ? [...node.children.entries()] : [];
    // Busiest branches first (most named openings under them), then alphabetical.
    kids.sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));

    // Past the named book (a leaf opening, or off-book entirely): the offline
    // book has nothing more to show here.
    if (!kids.length) {
      const empty = document.createElement('div');
      empty.className = 'bx-empty';
      empty.textContent = node
        ? 'End of the book line — this is a named opening.'
        : 'Off the book from here.';
      list.appendChild(empty);
      return;
    }

    const ply = ucis.length;
    const num = Math.floor(ply / 2) + 1;
    const prefix = ply % 2 === 0 ? `${num}.` : `${num}…`;

    for (const [san, child] of kids) {
      // Name of the position this move reaches (its own, else the deepest book
      // name there). Play/undo on the live board to get that position's FEN.
      let label = child.name ?? '';
      const m = chess.move(san);
      if (m) {
        if (!label) label = nameForFen(chess.fen()) ?? '';
        chess.undo();
      }

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'lib-bx-row';
      row.addEventListener('click', () => advance(san));

      const move = document.createElement('span');
      move.className = 'lib-bx-move';
      move.textContent = `${prefix} ${formatMove(san)}`;
      row.appendChild(move);

      const name = document.createElement('span');
      name.className = 'lib-bx-name';
      name.textContent = label;
      row.appendChild(name);

      const count = document.createElement('span');
      count.className = 'lib-bx-count';
      count.textContent = `${child.count}`;
      row.appendChild(count);

      list.appendChild(row);
    }
  }

  return {
    el: root,
    redraw: () => cg.redrawAll(),
    destroy: () => ro.disconnect(),
  };
}

// A stacked icon-over-label step button, matching the map explorer's controls.
function navBtn(icon: SVGElement, label: string, aria: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'bx-nav-btn';
  b.setAttribute('aria-label', aria);
  b.appendChild(icon);
  const span = document.createElement('span');
  span.textContent = label;
  b.appendChild(span);
  b.addEventListener('click', onClick);
  return b;
}
