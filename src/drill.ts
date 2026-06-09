import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import type { Line } from './types';
import type { MoveNode } from './tree';
import { Icons } from './icons';

export interface DrillOptions {
  onComplete: () => void;
  onCancel: () => void;
  // Called before the success message is shown; use for saves that must
  // complete before the user sees confirmation.
  onBeforeComplete?: () => Promise<void>;
  recordMiss?: (node: MoveNode) => void;
  completeMessage?: string;
  backLabel?: string;
  // 'gentle': show error text and let the user retry freely (pre-training).
  // 'full':   flash → snap back → draw arrow → show note → require correct replay.
  wrongMoveMode?: 'gentle' | 'full';
  // If provided (full mode only), the engine checks whether a wrong move is
  // actually a good alternative before penalising it as a mistake.
  checkAlternative?: (preFen: string, userUci: string) => Promise<boolean>;
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
  // True while the user must replay the correct move after a wrong attempt.
  let awaitingCorrectReplay = false;
  // True while the user must play the expected move after a good-alternative notice.
  let awaitingAlternativePlay = false;
  // True while an async engine check is in progress — blocks board input.
  let checkingAlternative = false;
  let isCleaned = false;

  // ── Overlay ───────────────────────────────────────────────────────────────

  const overlay = document.createElement('div');
  overlay.className = 'pt-overlay';

  const headerEl = document.createElement('div');
  headerEl.className = 'pt-header';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'pt-back-btn';
  backBtn.appendChild(Icons.back(15));
  backBtn.appendChild(document.createTextNode(opts.backLabel ?? 'Back'));
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

  const noteCardEl = document.createElement('div');
  noteCardEl.className = 'pt-note-card';
  noteCardEl.setAttribute('hidden', '');

  // Card shown after a good-alternative detection (note + create-line button).
  const altCardEl = document.createElement('div');
  altCardEl.className = 'pt-alt-card';
  altCardEl.setAttribute('hidden', '');

  const progressEl = document.createElement('div');
  progressEl.className = 'pt-progress';

  overlay.appendChild(headerEl);
  overlay.appendChild(boardWrap);
  overlay.appendChild(statusEl);
  overlay.appendChild(noteCardEl);
  overlay.appendChild(altCardEl);
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

  // Register brushes for hint arrows after the instance exists.
  cg.state.drawable.brushes['accent'] = { key: 'accent', color: '#ff9b21', opacity: 0.85, lineWidth: 10 };
  cg.state.drawable.brushes['alt'] = { key: 'alt', color: '#3a9a5c', opacity: 0.85, lineWidth: 10 };

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

  // ── Error flash ───────────────────────────────────────────────────────────

  function flashError(): void {
    const flash = document.createElement('div');
    flash.className = 'pt-error-flash';
    boardWrap.appendChild(flash);
    flash.addEventListener('animationend', () => flash.remove(), { once: true });
  }

  // ── Note card (mistake hints) ─────────────────────────────────────────────

  function showNoteCard(note: string): void {
    noteCardEl.textContent = note;
    noteCardEl.removeAttribute('hidden');
  }

  function hideNoteCard(): void {
    noteCardEl.setAttribute('hidden', '');
    noteCardEl.textContent = '';
  }

  // ── Alt card (good-alternative notice) ───────────────────────────────────

  function showAltCard(expected: MoveNode): void {
    altCardEl.innerHTML = '';

    if (expected.note) {
      const noteEl = document.createElement('div');
      noteEl.className = 'pt-alt-note';
      noteEl.textContent = expected.note;
      altCardEl.appendChild(noteEl);
    } else {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'pt-alt-add-note-btn';
      addBtn.textContent = '+ Add a note to remember this';

      const textarea = document.createElement('textarea');
      textarea.className = 'pt-alt-note-input';
      textarea.placeholder = 'Why does the line play this move?';
      textarea.hidden = true;

      addBtn.addEventListener('click', () => {
        addBtn.hidden = true;
        textarea.hidden = false;
        textarea.focus();
      });

      textarea.addEventListener('input', () => {
        expected.note = textarea.value.trim() || undefined;
      });

      altCardEl.appendChild(addBtn);
      altCardEl.appendChild(textarea);
    }

    const newLineBtn = document.createElement('button');
    newLineBtn.type = 'button';
    newLineBtn.className = 'pt-alt-new-line-btn';
    newLineBtn.textContent = 'Create new line';
    newLineBtn.addEventListener('click', () => { cleanup(); opts.onCancel(); });
    altCardEl.appendChild(newLineBtn);

    altCardEl.removeAttribute('hidden');
  }

  function hideAltCard(): void {
    altCardEl.setAttribute('hidden', '');
    altCardEl.innerHTML = '';
  }

  // ── Full wrong-move sequence ───────────────────────────────────────────────

  function handleWrongMoveFull(expected: MoveNode): void {
    awaitingCorrectReplay = true;

    // 1. Brief red flash over the board (~600ms CSS animation).
    flashError();

    // 2. Snap board back. chess.js was never updated (we don't call chess.move()
    //    in the wrong-move branch), so chess.fen() is still the pre-move FEN.
    cg.set({
      fen: chess.fen(),
      turnColor: cgTurn(),
      movable: { color: userColour, dests: legalDests() },
    });

    // 3. Draw a hint arrow. Deferred to the next animation frame so it always
    //    runs after chessground's own pending render, avoiding a shapes-clearing
    //    race condition.
    requestAnimationFrame(() => {
      if (isCleaned) return;
      const orig = expected.uci.slice(0, 2) as Key;
      const dest = expected.uci.slice(2, 4) as Key;
      cg.setAutoShapes([{ orig, dest, brush: 'accent' }]);
      if (expected.note) showNoteCard(expected.note);
    });
  }

  // ── Good-alternative sequence ─────────────────────────────────────────────

  function handleGoodAlternative(expected: MoveNode): void {
    awaitingAlternativePlay = true;

    statusEl.textContent = `Good alternative! Your line plays ${expected.san}.`;
    statusEl.className = 'pt-status pt-status--alt';

    // Restrict board to only the expected move (the green arrow shows where).
    const orig = expected.uci.slice(0, 2) as Key;
    const dest = expected.uci.slice(2, 4) as Key;
    cg.set({
      movable: {
        color: userColour,
        dests: new Map([[orig, [dest]]]),
      },
    });

    requestAnimationFrame(() => {
      if (isCleaned) return;
      cg.setAutoShapes([{ orig, dest, brush: 'alt' }]);
      showAltCard(expected);
    });
  }

  // ── Move logic ────────────────────────────────────────────────────────────

  function onUserMove(from: Key, to: Key): void {
    // Block input while an async engine check is running.
    if (checkingAlternative) return;

    const expected = moves[moveIndex];
    const eFrom = expected.uci.slice(0, 2);
    const eTo = expected.uci.slice(2, 4);

    if (from === eFrom && to === eTo) {
      // Correct move — clear any pending hint UI first.
      if (awaitingCorrectReplay) {
        cg.setAutoShapes([]);
        hideNoteCard();
        awaitingCorrectReplay = false;
      }
      if (awaitingAlternativePlay) {
        cg.setAutoShapes([]);
        hideAltCard();
        awaitingAlternativePlay = false;
      }
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
    } else if (opts.wrongMoveMode === 'full' && !awaitingCorrectReplay && !awaitingAlternativePlay && opts.checkAlternative) {
      // Async alternative check. Snap back and disable board immediately so the
      // user can't play again while we wait for the engine.
      checkingAlternative = true;
      const preFen = chess.fen();
      cg.set({
        fen: preFen,
        turnColor: cgTurn(),
        movable: { color: undefined, dests: new Map() },
      });

      opts.checkAlternative(preFen, from + to)
        .then(isAlt => {
          if (isCleaned) return;
          checkingAlternative = false;
          if (isAlt) {
            handleGoodAlternative(expected);
          } else {
            opts.recordMiss?.(expected);
            handleWrongMoveFull(expected);
          }
        })
        .catch(() => {
          if (isCleaned) return;
          checkingAlternative = false;
          opts.recordMiss?.(expected);
          handleWrongMoveFull(expected);
        });
    } else {
      // Synchronous wrong-move path (gentle mode or already in a hint state).
      if (opts.wrongMoveMode !== 'full' || !awaitingCorrectReplay) {
        opts.recordMiss?.(expected);
      }

      if (opts.wrongMoveMode === 'full') {
        handleWrongMoveFull(expected);
      } else {
        // Gentle mode (default) — used by pre-training.
        statusEl.textContent = 'Not yet — try that move again';
        statusEl.className = 'pt-status pt-status--error';
        cg.set({
          fen: chess.fen(),
          turnColor: cgTurn(),
          movable: { color: userColour, dests: legalDests() },
        });
      }
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
    isCleaned = true;
    if (autoTimer) clearTimeout(autoTimer);
    ro.disconnect();
    overlay.remove();
  }

  if (!isUserTurn()) {
    scheduleOpponent();
  }
}
