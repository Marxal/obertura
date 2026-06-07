import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';
import { addMove, goTo, mainline, pathTo, getCurrentNode, reset, isEmpty, serialise, uciPathTo } from './tree';
import { saveLine, getAllLines } from './storage';
import { probeOpeningName } from './openings';
import type { Line } from './types';

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

// Opening-name lookup. Debounced so rapid moves fire one request, and
// race-guarded so a slow older request can't overwrite a newer result.
let openingTimer: ReturnType<typeof setTimeout> | undefined;
let openingRequestId = 0;

function updateOpeningName() {
  if (openingTimer) clearTimeout(openingTimer);
  openingTimer = setTimeout(async () => {
    const reqId = ++openingRequestId;
    // TEMPORARY DIAGNOSTIC: probe reports why a lookup is empty.
    const { name, debug } = await probeOpeningName(uciPathTo());
    // Ignore stale results: only apply if this is still the latest request.
    if (reqId !== openingRequestId) return;
    const el = document.getElementById('opening-name')!;
    el.textContent = name ?? debug;
    console.log('[opening]', debug);
  }, 350);
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
  updateOpeningName();
}

let saveColour: 'white' | 'black' = 'white';

async function refreshDebugReadout() {
  const all = await getAllLines();
  const el = document.getElementById('debug-readout')!;
  el.textContent = `${all.length} line${all.length === 1 ? '' : 's'} saved`;
}

function setupSaveForm() {
  const nameInput = document.getElementById('line-name') as HTMLInputElement;
  const tagsInput = document.getElementById('line-tags') as HTMLInputElement;
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
  const saveMsg = document.getElementById('save-msg')!;
  const toggle = document.getElementById('colour-toggle')!;

  // White / Black segmented control.
  toggle.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      saveColour = btn.dataset.colour as 'white' | 'black';
      toggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  saveBtn.addEventListener('click', async () => {
    if (isEmpty()) {
      saveMsg.textContent = 'Play a move first';
      return;
    }

    const tags = tagsInput.value
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const line: Line = {
      id: crypto.randomUUID(),
      name: nameInput.value.trim() || 'Untitled line',
      tags,
      colour: saveColour,
      openingName: null,
      confidence: 0,
      lastTrained: null,
      inTraining: false,
      tree: serialise(),
    };

    await saveLine(line);
    saveMsg.textContent = 'Saved ✓';
    await refreshDebugReadout();
  });

  // Show the persisted count on load — confirms data survived an app restart.
  refreshDebugReadout();
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
        document.getElementById('save-msg')!.textContent = '';
        cg.set({
          turnColor: turnColor(),
          movable: {
            color: 'both',
            dests: legalDests(),
          },
        });
        renderMoveList();
        updateOpeningName();
      },
    },
  });

  setupSaveForm();

  document.getElementById('reset-btn')!.addEventListener('click', () => {
    reset();
    chess.reset();
    document.getElementById('save-msg')!.textContent = '';
    // Clear the opening label and invalidate any in-flight lookup.
    openingRequestId++;
    document.getElementById('opening-name')!.textContent = '';
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
