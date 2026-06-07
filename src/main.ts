import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';
import { addMove, goTo, mainline, pathTo, getCurrentNode, reset } from './tree';

const chess = new Chess();
let cg!: ReturnType<typeof Chessground>;

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

function renderMoveList() {
  const moves = mainline();
  const activeId = getCurrentNode().id;
  const el = document.getElementById('move-list')!;
  el.innerHTML = '';

  for (let i = 0; i < moves.length; i += 2) {
    const white = moves[i];
    const black = moves[i + 1];
    const num = i / 2 + 1;

    const numSpan = document.createElement('span');
    numSpan.className = 'move-num';
    numSpan.textContent = `${num}.`;
    el.appendChild(numSpan);

    const wSpan = document.createElement('span');
    wSpan.className = `move-san${white.id === activeId ? ' active' : ''}`;
    wSpan.textContent = white.san;
    wSpan.addEventListener('click', () => handleMoveClick(white.id));
    el.appendChild(wSpan);

    if (black) {
      const bSpan = document.createElement('span');
      bSpan.className = `move-san${black.id === activeId ? ' active' : ''}`;
      bSpan.textContent = black.san;
      bSpan.addEventListener('click', () => handleMoveClick(black.id));
      el.appendChild(bSpan);
    }
  }
}

function handleMoveClick(nodeId: string) {
  goTo(nodeId);
  const path = pathTo(nodeId);

  chess.reset();
  for (const node of path) {
    chess.move(node.san);
  }

  const last = path[path.length - 1];
  cg.set({
    fen: chess.fen(),
    turnColor: turnColor(),
    movable: {
      color: 'both',
      dests: legalDests(),
    },
    lastMove: last
      ? [last.uci.slice(0, 2) as Key, last.uci.slice(2, 4) as Key]
      : undefined,
  });

  renderMoveList();
}

const boardEl = document.getElementById('board') as HTMLElement;

requestAnimationFrame(() => {
  cg = Chessground(boardEl, {
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
        const result = chess.move({ from, to, promotion: 'q' });
        if (!result) return;
        const uci = from + to + (result.promotion ?? '');
        addMove(result.san, uci, chess.fen());
        cg.set({
          turnColor: turnColor(),
          movable: {
            color: 'both',
            dests: legalDests(),
          },
        });
        renderMoveList();
      },
    },
  });

  document.getElementById('reset-btn')!.addEventListener('click', () => {
    reset();
    chess.reset();
    cg.set({
      fen: chess.fen(),
      turnColor: 'white',
      movable: {
        color: 'both',
        dests: legalDests(),
      },
      lastMove: undefined,
    });
    renderMoveList();
  });

  new ResizeObserver(() => cg.redrawAll()).observe(boardEl);
});
