import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import type { Line } from './types';
import type { MoveNode } from './tree';
import { Icons } from './icons';
import { getRetriesBeforeReveal } from './prefs';

export interface DrillOptions {
  onComplete: () => void;
  onCancel: () => void;
  // Called before the success message is shown; use for saves that must
  // complete before the user sees confirmation.
  onBeforeComplete?: () => Promise<void>;
  recordMiss?: (node: MoveNode) => void;
  completeMessage?: string;
  backLabel?: string;
  // Small muted label shown at the top of the overlay (e.g. "Training"). Falls
  // back to the opening/line name when omitted.
  modeLabel?: string;
  // 'gentle': show error text and let the user retry freely (pre-training).
  // 'full':   flash → snap back → (retries) → draw arrow → require correct replay.
  wrongMoveMode?: 'gentle' | 'full';
  // Keep the opening title hidden (under the board) until the line completes, so
  // it can't act as a hint mid-drill. Used by the training screen.
  hideTitleUntilComplete?: boolean;
  // Fire a brief confetti burst when the line is completed.
  celebrateOnComplete?: boolean;
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
  // True while the user must replay the correct move after the arrow is shown.
  let awaitingCorrectReplay = false;
  // True while the user must play the expected move after a good-alternative notice.
  let awaitingAlternativePlay = false;
  // True while an async engine check is in progress — blocks board input.
  let checkingAlternative = false;
  let isCleaned = false;

  // Wrong attempts on the *current* user move; reset when we advance.
  let wrongAttempts = 0;
  // Extra tries a wrong move gets before we draw the arrow (full mode only).
  const retriesAllowed = getRetriesBeforeReveal();

  const opponentName = line.openingName || line.name || 'Untitled line';

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

  // Top label: the training mode, not the opening (which would be a hint).
  const modeEl = document.createElement('div');
  modeEl.className = 'pt-mode-label';
  modeEl.textContent = opts.modeLabel ?? opponentName;

  headerEl.appendChild(backBtn);
  headerEl.appendChild(modeEl);

  const boardWrap = document.createElement('div');
  boardWrap.className = 'pt-board-wrap';

  const boardEl = document.createElement('div');
  boardEl.className = 'pt-board';
  boardWrap.appendChild(boardEl);

  // Opening title, UNDER the board. Hidden until completion in full mode.
  const titleEl = document.createElement('div');
  titleEl.className = 'pt-title-under';
  titleEl.textContent = opponentName;
  if (opts.hideTitleUntilComplete) titleEl.setAttribute('hidden', '');

  // Progress dots — one circle per user move.
  const progressEl = document.createElement('div');
  progressEl.className = 'pt-dots';

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

  overlay.appendChild(headerEl);
  overlay.appendChild(boardWrap);
  overlay.appendChild(titleEl);
  overlay.appendChild(progressEl);
  overlay.appendChild(statusEl);
  overlay.appendChild(noteCardEl);
  overlay.appendChild(altCardEl);
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

  // ── Progress dots ───────────────────────────────────────────────────────────

  // Indices into `moves` that are the user's own moves.
  const userIdxs = moves
    .map((_, i) => i)
    .filter(i => (userColour === 'white' ? i % 2 === 0 : i % 2 !== 0));

  const dotEls: HTMLElement[] = [];
  for (let k = 0; k < userIdxs.length; k++) {
    const dot = document.createElement('span');
    dot.className = 'pt-dot';
    progressEl.appendChild(dot);
    dotEls.push(dot);
  }

  // Mark the dot for the user move at `mi`. Red is sticky for the rest of the
  // line — a correct replay never overrides an earlier miss.
  function markDot(mi: number, state: 'correct' | 'wrong'): void {
    const di = userIdxs.indexOf(mi);
    if (di < 0) return;
    const dot = dotEls[di];
    if (state === 'wrong') {
      dot.classList.add('pt-dot--wrong');
    } else if (!dot.classList.contains('pt-dot--wrong')) {
      dot.classList.add('pt-dot--correct');
    }
  }

  // ── Status line ─────────────────────────────────────────────────────────────

  function setStatus(text: string, variant = ''): void {
    statusEl.textContent = text;
    statusEl.className = 'pt-status' + (variant ? ' ' + variant : '');
  }

  function promptYourMove(): void {
    setStatus('Your move', 'pt-status--prompt');
  }

  // ── Error flash ───────────────────────────────────────────────────────────

  function flashError(): void {
    const flash = document.createElement('div');
    flash.className = 'pt-error-flash';
    boardWrap.appendChild(flash);
    flash.addEventListener('animationend', () => flash.remove(), { once: true });
  }

  // ── Confetti ────────────────────────────────────────────────────────────────

  function burstConfetti(): void {
    // Respect users who'd rather not have motion.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const layer = document.createElement('div');
    layer.className = 'confetti-layer';
    const colors = ['#c07a2a', '#2d7d3e', '#e8c14a', '#d4633f', '#5b8fb0', '#f5ede0'];
    const N = 26;
    for (let i = 0; i < N; i++) {
      const p = document.createElement('span');
      p.className = 'confetti-piece';
      const angle = Math.random() * Math.PI * 2;
      const dist = 55 + Math.random() * 120;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist - 35; // bias upward
      p.style.setProperty('--dx', `${dx.toFixed(0)}px`);
      p.style.setProperty('--dy', `${dy.toFixed(0)}px`);
      p.style.setProperty('--rot', `${(Math.random() * 720 - 360).toFixed(0)}deg`);
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = `${(Math.random() * 60).toFixed(0)}ms`;
      layer.appendChild(p);
    }
    boardWrap.appendChild(layer);
    setTimeout(() => layer.remove(), 1300);
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

  // ── Wrong-move flow (full mode) ────────────────────────────────────────────

  // Snap the board back to the pre-move position and re-enable the user's pieces.
  function snapBack(): void {
    cg.set({
      fen: chess.fen(),
      turnColor: cgTurn(),
      movable: { color: userColour, dests: legalDests() },
    });
  }

  // A wrong attempt in full mode. The first wrong attempt on a move records the
  // miss and reddens its dot (recordMiss fires once per node). Retries are
  // allowed up to the pref; after that, the correct-move arrow is revealed.
  function registerWrongAttempt(expected: MoveNode): void {
    if (wrongAttempts === 0) {
      opts.recordMiss?.(expected);
      markDot(moveIndex, 'wrong');
    }
    wrongAttempts++;

    flashError();
    snapBack();

    if (wrongAttempts > retriesAllowed) {
      revealCorrectMove(expected);
    } else {
      const left = retriesAllowed - wrongAttempts + 1;
      setStatus(left === 1 ? 'Not quite — one more try' : 'Not quite — try again', 'pt-status--error');
    }
  }

  // Draw the hint arrow and require the user to replay the correct move.
  function revealCorrectMove(expected: MoveNode): void {
    awaitingCorrectReplay = true;
    setStatus(expected.note ? '' : 'Play the highlighted move', 'pt-status--reveal');

    // Deferred to the next frame so it always runs after chessground's own
    // pending render, avoiding a shapes-clearing race condition.
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

    setStatus(`Good alternative! Your line plays ${expected.san}.`, 'pt-status--alt');

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
      markDot(moveIndex, 'correct');
      setStatus('');
      chess.move({ from, to, promotion: 'q' });
      moveIndex++;
      wrongAttempts = 0;

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
      return;
    }

    // ── Wrong move ──
    if (opts.wrongMoveMode === 'full') {
      // Already showing the arrow: just flash; don't re-record or re-check.
      if (awaitingCorrectReplay) {
        flashError();
        snapBack();
        // Re-draw the arrow (snapBack cleared the board state, not shapes, but
        // keep it robust across renders).
        requestAnimationFrame(() => {
          if (isCleaned) return;
          const orig = expected.uci.slice(0, 2) as Key;
          const dest = expected.uci.slice(2, 4) as Key;
          cg.setAutoShapes([{ orig, dest, brush: 'accent' }]);
        });
        return;
      }

      // First wrong move on this position — maybe it's a good alternative.
      if (opts.checkAlternative) {
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
            if (isAlt) handleGoodAlternative(expected);
            else registerWrongAttempt(expected);
          })
          .catch(() => {
            if (isCleaned) return;
            checkingAlternative = false;
            registerWrongAttempt(expected);
          });
      } else {
        registerWrongAttempt(expected);
      }
    } else {
      // Gentle mode (default) — used by pre-training. Retry freely, no arrow.
      opts.recordMiss?.(expected);
      markDot(moveIndex, 'wrong');
      setStatus('Not yet — try that move again', 'pt-status--error');
      snapBack();
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
        if (isUserTurn()) promptYourMove();
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

    setStatus(opts.completeMessage ?? 'Line complete', 'pt-status--success');
    if (opts.hideTitleUntilComplete) titleEl.removeAttribute('hidden');
    if (opts.celebrateOnComplete) burstConfetti();
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
  } else {
    promptYourMove();
  }
}
