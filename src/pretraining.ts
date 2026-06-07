import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import type { Line } from './types';
import type { MoveNode } from './tree';
import { saveLine } from './storage';

// Raise to 2 later to require two consecutive clean runs before gating inTraining.
const REQUIRED_CLEAN_RUNS = 1;

function mainlineOf(tree: MoveNode): MoveNode[] {
  const result: MoveNode[] = [];
  let node = tree.children[0];
  while (node) {
    result.push(node);
    node = node.children[0];
  }
  return result;
}

// Mounts a full-screen pre-training run over the current view.
// Walks the mainline only. Auto-plays the opponent side; validates user moves.
// On one clean run (REQUIRED_CLEAN_RUNS = 1): sets inTraining = true, persists,
// shows confirmation, then calls onComplete. Cancel exits without saving.
export function startPretrainingRun(
  line: Line,
  onComplete: () => void,
  onCancel: () => void
): void {
  const moves = mainlineOf(line.tree);
  if (moves.length === 0) {
    onCancel();
    return;
  }

  // Deep-clone so lapse edits don't mutate the caller's copy in memory.
  const lineCopy: Line = { ...line, tree: structuredClone(line.tree) };
  const copyMoves = mainlineOf(lineCopy.tree);

  const chess = new Chess();
  const userColour = line.colour;
  let moveIndex = 0;
  let autoTimer: ReturnType<typeof setTimeout> | undefined;

  // ── Overlay ───────────────────────────────────────────────────────────────

  const overlay = document.createElement('div');
  overlay.className = 'pt-overlay';

  const headerEl = document.createElement('div');
  headerEl.className = 'pt-header';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'pt-back-btn';
  backBtn.textContent = '← Cancel';
  backBtn.addEventListener('click', () => { cleanup(); onCancel(); });

  const titleEl = document.createElement('div');
  titleEl.className = 'pt-title';
  titleEl.textContent = line.name || 'Untitled line';

  headerEl.appendChild(backBtn);
  headerEl.appendChild(titleEl);

  const boardWrap = document.createElement('div');
  boardWrap.className = 'pt-board-wrap';

  const boardEl = document.createElement('div');
  boardEl.className = 'pt-board';
  boardWrap.appendChild(boardEl);

  const statusEl = document.createElement('div');
  statusEl.className = 'pt-status';
  statusEl.setAttribute('aria-live', 'polite');

  const progressEl = document.createElement('div');
  progressEl.className = 'pt-progress';

  overlay.appendChild(headerEl);
  overlay.appendChild(boardWrap);
  overlay.appendChild(statusEl);
  overlay.appendChild(progressEl);
  document.body.appendChild(overlay);

  // ── Chess helpers ─────────────────────────────────────────────────────────

  function legalDests(): Map<Key, Key[]> {
    const dests = new Map<Key, Key[]>();
    for (const m of chess.moves({ verbose: true })) {
      const from = m.from as Key;
      if (!dests.has(from)) dests.set(from, []);
      dests.get(from)!.push(m.to as Key);
    }
    return dests;
  }

  function cgTurn(): 'white' | 'black' {
    return chess.turn() === 'w' ? 'white' : 'black';
  }

  function isUserTurn(): boolean {
    return cgTurn() === userColour;
  }

  // ── Chessground ───────────────────────────────────────────────────────────

  const cg = Chessground(boardEl, {
    orientation: userColour,
    movable: {
      color: isUserTurn() ? userColour : undefined,
      free: false,
      dests: isUserTurn() ? legalDests() : new Map(),
    },
    draggable: { showGhost: true },
    animation: { enabled: true, duration: 200 },
    events: {
      move(from, to) { onUserMove(from, to); },
    },
  });

  const ro = new ResizeObserver(() => cg.redrawAll());
  ro.observe(boardEl);

  // ── Progress ──────────────────────────────────────────────────────────────

  function updateProgress(): void {
    const userIdxs = moves
      .map((_, i) => i)
      .filter(i => userColour === 'white' ? i % 2 === 0 : i % 2 !== 0);
    const done = userIdxs.filter(i => i < moveIndex).length;
    progressEl.textContent = `Move ${done} / ${userIdxs.length}`;
  }

  updateProgress();

  // ── Move logic ────────────────────────────────────────────────────────────

  function onUserMove(from: Key, to: Key): void {
    const expected = moves[moveIndex];
    const eFrom = expected.uci.slice(0, 2);
    const eTo = expected.uci.slice(2, 4);

    if (from === eFrom && to === eTo) {
      statusEl.textContent = '';
      statusEl.className = 'pt-status';
      chess.move({ from, to, promotion: 'q' });
      moveIndex++;
      updateProgress();

      if (moveIndex >= moves.length) {
        void completeRun();
        return;
      }

      cg.set({
        fen: chess.fen(),
        turnColor: cgTurn(),
        movable: { color: undefined, dests: new Map() },
        lastMove: [from, to],
      });

      scheduleOpponent();
    } else {
      recordLapse(expected);
      statusEl.textContent = 'Not yet — try that move again';
      statusEl.className = 'pt-status pt-status--error';
      // Snap the piece back to the pre-move position (chess was not updated).
      cg.set({
        fen: chess.fen(),
        turnColor: cgTurn(),
        movable: { color: userColour, dests: legalDests() },
      });
    }
  }

  function scheduleOpponent(): void {
    if (moveIndex >= moves.length || isUserTurn()) return;
    autoTimer = setTimeout(() => {
      const node = moves[moveIndex];
      const from = node.uci.slice(0, 2) as Key;
      const to = node.uci.slice(2, 4) as Key;
      chess.move({ from, to, promotion: 'q' });
      moveIndex++;
      updateProgress();

      cg.set({
        fen: chess.fen(),
        turnColor: cgTurn(),
        movable: {
          color: isUserTurn() ? userColour : undefined,
          dests: isUserTurn() ? legalDests() : new Map(),
        },
        lastMove: [from, to],
      });

      if (moveIndex >= moves.length) {
        void completeRun();
      } else {
        scheduleOpponent();
      }
    }, 700);
  }

  function recordLapse(node: MoveNode): void {
    const target = copyMoves.find(m => m.id === node.id);
    if (!target) return;
    if (!target.review) {
      target.review = { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: new Date() };
    }
    target.review.lapses++;
  }

  async function completeRun(): Promise<void> {
    if (autoTimer) clearTimeout(autoTimer);
    cg.set({ movable: { color: undefined, dests: new Map() } });
    lineCopy.inTraining = true;
    await saveLine(lineCopy);
    statusEl.textContent = 'Line confirmed — added to training';
    statusEl.className = 'pt-status pt-status--success';
    setTimeout(() => { cleanup(); onComplete(); }, 1500);
  }

  function cleanup(): void {
    if (autoTimer) clearTimeout(autoTimer);
    ro.disconnect();
    overlay.remove();
  }

  // Kick off auto-play if it's the opponent's move first (e.g. Black lines start with e4).
  if (!isUserTurn()) {
    scheduleOpponent();
  }
}
