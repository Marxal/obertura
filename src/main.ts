import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';

const chess = new Chess();

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

const boardEl = document.getElementById('board') as HTMLElement;
const fenEl = document.getElementById('fen') as HTMLElement;

fenEl.textContent = chess.fen();

// Defer init by one frame so getBoundingClientRect() on #board
// returns real pixel dimensions (chessground sizes cg-container in px).
requestAnimationFrame(() => {
  const cg = Chessground(boardEl, {
    movable: {
      color: 'both',
      free: false,
      dests: legalDests(),
    },
    draggable: {
      showGhost: true,
    },
    animation: {
      enabled: true,
      duration: 200,
    },
    events: {
      move(from, to) {
        chess.move({ from, to, promotion: 'q' });
        cg.set({
          turnColor: turnColor(),
          movable: {
            color: 'both',
            dests: legalDests(),
          },
        });
        fenEl.textContent = chess.fen();
      },
    },
  });

  new ResizeObserver(() => cg.redrawAll()).observe(boardEl);
});
