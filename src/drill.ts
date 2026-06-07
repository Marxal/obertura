import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import type { Line } from './types';
import type { MoveNode } from './tree';

export interface DrillOptions {
  onComplete: () => void;
  onCancel: () => void;
  // Called before the success message is shown; use for saves that must
  // complete before the user sees confirmation.
  onBeforeComplete?: () => Promise<void>;
  recordMiss?: (node: MoveNode) => void;
  completeMessage?: string;
  backLabel?: string;
}

function mainlineOf(tree: MoveNode): MoveNode[] {
  const result: MoveNode[] = [];
  let node = tree.children[0];
  while (node) {
    result.push(node);
    node = node.children[0];
  }
  return result;
}

export function startDrill(line: Line, opts: DrillOptions): void {
  const moves = mainlineOf(line.tree);
  if (moves.length === 0) {
    opts.onCancel();
    return;
  }

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
  backBtn.textContent = opts.backLabel ?? '← Back';
  backBtn.addEventListener('click', () => { cleanup(); opts.onCancel(); });

  const titleEl = document.createElement('div');
  titleEl.className = 'pt-title';
  titleEl.textContent = line.openingName || line.name || 'Untitled line';

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
      opts.recordMiss?.(expected);
      statusEl.textContent = 'Not yet — try that move again';
      statusEl.className = 'pt-status pt-status--error';
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

  async function completeRun(): Promise<void> {
    if (autoTimer) clearTimeout(autoTimer);
    cg.set({ movable: { color: undefined, dests: new Map() } });

    if (opts.onBeforeComplete) {
      await opts.onBeforeComplete();
    }

    statusEl.textContent = opts.completeMessage ?? 'Line complete';
    statusEl.className = 'pt-status pt-status--success';
    setTimeout(() => { cleanup(); opts.onComplete(); }, 1500);
  }

  function cleanup(): void {
    if (autoTimer) clearTimeout(autoTimer);
    ro.disconnect();
    overlay.remove();
  }

  if (!isUserTurn()) {
    scheduleOpponent();
  }
}
