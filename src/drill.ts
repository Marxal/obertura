import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import type { Line } from './types';
import type { MoveNode } from './tree';
import { Icons } from './icons';
import { getRetriesBeforeReveal } from './prefs';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface DrillOptions {
  onComplete: () => void;
  onCancel: () => void;
  // Called before the success message is shown; use for saves that must
  // complete before the user sees confirmation.
  onBeforeComplete?: () => Promise<void>;
  recordMiss?: (node: MoveNode) => void;
  // Individual-moves mode only: fires once per position when it's finished
  // (after a correct move, even if it took a couple of tries). Use to grade and
  // persist that single position before the stream moves on.
  onStepComplete?: (expected: MoveNode) => void;
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
  // Fire a brief confetti burst when the run is completed.
  celebrateOnComplete?: boolean;
  // If provided (full mode only), the engine checks whether a wrong move is
  // actually a good alternative before penalising it as a mistake.
  checkAlternative?: (preFen: string, userUci: string) => Promise<boolean>;
  // If provided, the good-alternative card offers an "Explore this line" button
  // that opens the position AFTER the played move so the user can see where it
  // leads. The drill stays open underneath and resumes when the explorer closes.
  onExplore?: (fenAfter: string, label: string, orientation: 'white' | 'black') => void;
}

// A single ply to auto-play (animated) between the user's moves.
interface Ply { uci: string; fen: string; }

// One thing the user has to play: the board sits at `preFen`, they must play
// `expected`. `replies` are the plies auto-played afterwards (line mode keeps
// the board continuous; positions mode leaves it empty and jumps to the next
// task instead). `colour` is the side the user is playing this task.
interface Task {
  preFen: string;
  expected: MoveNode;
  colour: 'white' | 'black';
  replies: Ply[];
  continuous: boolean;
}

interface DrillConfig {
  intro: Ply[];      // opponent plies to animate from the start (line mode)
  tasks: Task[];
  titleText: string; // shown under the board (revealed on completion)
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

function colourToMove(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

// The position (and SAN) after applying a UCI move to a FEN — used to open the
// explorer at the spot a good-alternative move leads to. Null on an illegal move.
function afterMove(preFen: string, uci: string): { fen: string; san: string } | null {
  try {
    const ch = new Chess(preFen);
    const m = ch.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: (uci[4] as 'q' | 'r' | 'b' | 'n') || 'q',
    });
    return m ? { fen: ch.fen(), san: m.san } : null;
  } catch {
    return null;
  }
}

// ── Public entry points ──────────────────────────────────────────────────────

// Walk a whole line: auto-play the opponent, quiz every user move in order.
export function startDrill(line: Line, opts: DrillOptions): void {
  const moves = mainlineOf(line.tree);
  if (moves.length === 0) {
    opts.onCancel();
    return;
  }

  const userColour = line.colour;
  const isUser = (i: number) => (userColour === 'white' ? i % 2 === 0 : i % 2 === 1);
  const ply = (n: MoveNode): Ply => ({ uci: n.uci, fen: n.fen });

  // Leading opponent moves before the user gets to play (a Black line opens
  // with White's move).
  const firstUser = moves.findIndex((_, i) => isUser(i));
  if (firstUser < 0) {
    opts.onCancel();
    return;
  }
  const intro = moves.slice(0, firstUser).map(ply);

  const tasks: Task[] = [];
  for (let i = firstUser; i < moves.length; i += 2) {
    tasks.push({
      preFen: i === 0 ? START_FEN : moves[i - 1].fen,
      expected: moves[i],
      colour: userColour,
      // The single opponent reply that follows (or nothing, at the line's end).
      replies: moves.slice(i + 1, i + 2).map(ply),
      continuous: true,
    });
  }

  runDrill(
    { intro, tasks, titleText: line.openingName || line.name || 'Untitled line' },
    opts,
  );
}

// Drill a stream of individual positions. Each one resets the board to its
// position; a correct move jumps straight to the next.
export function startPositionsDrill(
  positions: { preFen: string; expected: MoveNode }[],
  opts: DrillOptions,
): void {
  if (positions.length === 0) {
    opts.onCancel();
    return;
  }
  const tasks: Task[] = positions.map(p => ({
    preFen: p.preFen,
    expected: p.expected,
    colour: colourToMove(p.preFen),
    replies: [],
    continuous: false,
  }));
  runDrill({ intro: [], tasks, titleText: '' }, opts);
}

// ── The shared drill runtime ──────────────────────────────────────────────────

function runDrill(config: DrillConfig, opts: DrillOptions): void {
  const { tasks } = config;

  const chess = new Chess();
  // The side the user is playing right now — constant in line mode, per-task in
  // positions mode.
  let userColour = tasks[0].colour;
  let taskIndex = 0;
  let autoTimer: ReturnType<typeof setTimeout> | undefined;
  // True while the user must replay the correct move after the arrow is shown.
  let awaitingCorrectReplay = false;
  // True while the user must play the expected move after a good-alternative notice.
  let awaitingAlternativePlay = false;
  // True while an async engine check is in progress — blocks board input.
  let checkingAlternative = false;
  let isCleaned = false;

  // Wrong attempts on the *current* task; reset when we advance.
  let wrongAttempts = 0;
  // Extra tries a wrong move gets before we draw the arrow (full mode only).
  const retriesAllowed = getRetriesBeforeReveal();

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
  modeEl.textContent = opts.modeLabel ?? config.titleText;

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
  titleEl.textContent = config.titleText;
  if (opts.hideTitleUntilComplete) titleEl.setAttribute('hidden', '');

  // Progress dots — one circle per task.
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

  // ── Chessground ───────────────────────────────────────────────────────────

  const cg = Chessground(boardEl, {
    orientation: userColour,
    movable: { color: undefined, free: false, dests: new Map() },
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

  // ── Progress dots ─────────────────────────────────────────────────────────

  const dotEls: HTMLElement[] = [];
  for (let k = 0; k < tasks.length; k++) {
    const dot = document.createElement('span');
    dot.className = 'pt-dot';
    progressEl.appendChild(dot);
    dotEls.push(dot);
  }

  // Mark the dot for a task. Red is sticky — a correct replay never overrides an
  // earlier miss.
  function markDot(idx: number, state: 'correct' | 'wrong'): void {
    const dot = dotEls[idx];
    if (!dot) return;
    if (state === 'wrong') {
      dot.classList.add('pt-dot--wrong');
    } else if (!dot.classList.contains('pt-dot--wrong')) {
      dot.classList.add('pt-dot--correct');
    }
  }

  // ── Status line ───────────────────────────────────────────────────────────

  function setStatus(text: string, variant = ''): void {
    statusEl.textContent = text;
    statusEl.className = 'pt-status' + (variant ? ' ' + variant : '');
  }

  function promptYourMove(): void {
    setStatus('Your move', 'pt-status--prompt');
  }

  // ── Error flash ─────────────────────────────────────────────────────────────

  function flashError(): void {
    const flash = document.createElement('div');
    flash.className = 'pt-error-flash';
    boardWrap.appendChild(flash);
    flash.addEventListener('animationend', () => flash.remove(), { once: true });
  }

  // ── Confetti ──────────────────────────────────────────────────────────────

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

  // ── Note card (mistake hints) ───────────────────────────────────────────────

  function showNoteCard(note: string): void {
    noteCardEl.textContent = note;
    noteCardEl.removeAttribute('hidden');
  }

  function hideNoteCard(): void {
    noteCardEl.setAttribute('hidden', '');
    noteCardEl.textContent = '';
  }

  // ── Alt card (good-alternative notice) ───────────────────────────────────────

  function showAltCard(expected: MoveNode, explore: { fen: string; san: string } | null): void {
    altCardEl.innerHTML = '';

    // Brief headline: a sound move, but not the saved line.
    const headEl = document.createElement('div');
    headEl.className = 'pt-alt-head';
    headEl.textContent = `Good move${explore ? ` (${explore.san})` : ''} — but not your saved line.`;
    altCardEl.appendChild(headEl);

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

    const btnRow = document.createElement('div');
    btnRow.className = 'pt-alt-btn-row';

    // "Explore this line" — open the position after the played move so the user
    // can see where it goes, without leaving the drill.
    if (explore && opts.onExplore) {
      const exploreBtn = document.createElement('button');
      exploreBtn.type = 'button';
      exploreBtn.className = 'pt-alt-explore-btn';
      exploreBtn.textContent = 'Explore this line →';
      exploreBtn.addEventListener('click', () => {
        opts.onExplore!(explore.fen, `After ${explore.san}`, userColour);
      });
      btnRow.appendChild(exploreBtn);
    }

    const newLineBtn = document.createElement('button');
    newLineBtn.type = 'button';
    newLineBtn.className = 'pt-alt-new-line-btn';
    newLineBtn.textContent = 'Create new line';
    newLineBtn.addEventListener('click', () => { cleanup(); opts.onCancel(); });
    btnRow.appendChild(newLineBtn);

    altCardEl.appendChild(btnRow);
    altCardEl.removeAttribute('hidden');
  }

  function hideAltCard(): void {
    altCardEl.setAttribute('hidden', '');
    altCardEl.innerHTML = '';
  }

  // ── Wrong-move flow (full mode) ──────────────────────────────────────────────

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
      markDot(taskIndex, 'wrong');
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

  function handleGoodAlternative(expected: MoveNode, preFen: string, userUci: string): void {
    awaitingAlternativePlay = true;

    // A sound move, but it isn't the line we saved — still ask for the saved move.
    setStatus(`Good move — but not your line. Play ${expected.san} to continue.`, 'pt-status--alt');

    // Restrict board to only the expected move (the green arrow shows where).
    const orig = expected.uci.slice(0, 2) as Key;
    const dest = expected.uci.slice(2, 4) as Key;
    cg.set({
      movable: {
        color: userColour,
        dests: new Map([[orig, [dest]]]),
      },
    });

    const explore = afterMove(preFen, userUci);

    requestAnimationFrame(() => {
      if (isCleaned) return;
      cg.setAutoShapes([{ orig, dest, brush: 'alt' }]);
      showAltCard(expected, explore);
    });
  }

  // ── Move logic ────────────────────────────────────────────────────────────

  function onUserMove(from: Key, to: Key): void {
    // Block input while an async engine check is running.
    if (checkingAlternative) return;

    const expected = tasks[taskIndex].expected;
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
      markDot(taskIndex, 'correct');
      setStatus('');
      chess.move({ from, to, promotion: 'q' });

      cg.set({
        fen: chess.fen(),
        turnColor: cgTurn(),
        movable: { color: undefined, dests: new Map() },
        lastMove: [from, to],
      });

      advanceAfterCorrect();
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
            if (isAlt) handleGoodAlternative(expected, preFen, from + to);
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
      markDot(taskIndex, 'wrong');
      setStatus('Not yet — try that move again', 'pt-status--error');
      snapBack();
    }
  }

  // After a correct move, either flow into the next task (line mode, animating
  // the opponent's reply) or jump to the next position (individual mode).
  function advanceAfterCorrect(): void {
    const task = tasks[taskIndex];

    if (task.continuous) {
      animatePlies(task.replies, () => {
        if (taskIndex + 1 >= tasks.length) { void completeRun(); return; }
        startTask(taskIndex + 1);
      });
    } else {
      // Individual position done — let the caller grade it before moving on.
      opts.onStepComplete?.(task.expected);
      autoTimer = setTimeout(() => {
        if (isCleaned) return;
        if (taskIndex + 1 >= tasks.length) { void completeRun(); return; }
        startTask(taskIndex + 1);
      }, 550);
    }
  }

  // Auto-play a run of plies (opponent replies / opening lead-in), animated.
  function animatePlies(plies: Ply[], done: () => void): void {
    let k = 0;
    function step(): void {
      if (isCleaned) return;
      if (k >= plies.length) { done(); return; }
      const p = plies[k++];
      autoTimer = setTimeout(() => {
        if (isCleaned) return;
        const from = p.uci.slice(0, 2) as Key;
        const to = p.uci.slice(2, 4) as Key;
        chess.move({ from, to, promotion: 'q' });
        cg.set({
          fen: chess.fen(),
          turnColor: cgTurn(),
          movable: { color: undefined, dests: new Map() },
          lastMove: [from, to],
        });
        step();
      }, 700);
    }
    step();
  }

  // Present a task: place the board at its position and hand control over.
  function startTask(idx: number): void {
    taskIndex = idx;
    const task = tasks[idx];
    userColour = task.colour;
    wrongAttempts = 0;
    awaitingCorrectReplay = false;
    awaitingAlternativePlay = false;
    chess.load(task.preFen);
    cg.setAutoShapes([]);
    hideNoteCard();
    hideAltCard();

    const base = {
      fen: task.preFen,
      orientation: task.colour,
      turnColor: cgTurn(),
      movable: { color: userColour, dests: legalDests() },
    };
    // Continuous tasks keep the opponent's last-move highlight that the reply
    // animation just set; a position jump starts clean.
    cg.set(task.continuous ? base : { ...base, lastMove: undefined });
    promptYourMove();
  }

  async function completeRun(): Promise<void> {
    if (autoTimer) clearTimeout(autoTimer);
    cg.set({ movable: { color: undefined, dests: new Map() } });

    if (opts.onBeforeComplete) {
      await opts.onBeforeComplete();
    }

    setStatus(opts.completeMessage ?? 'Line complete', 'pt-status--success');
    if (opts.hideTitleUntilComplete && config.titleText) titleEl.removeAttribute('hidden');
    if (opts.celebrateOnComplete) burstConfetti();
    setTimeout(() => { cleanup(); opts.onComplete(); }, 1500);
  }

  function cleanup(): void {
    isCleaned = true;
    if (autoTimer) clearTimeout(autoTimer);
    ro.disconnect();
    overlay.remove();
  }

  // ── Kick off ──────────────────────────────────────────────────────────────

  if (config.intro.length > 0) {
    // Animate the opening lead-in from the start before the first user move.
    chess.load(START_FEN);
    cg.set({
      fen: START_FEN,
      orientation: tasks[0].colour,
      turnColor: 'white',
      movable: { color: undefined, dests: new Map() },
    });
    animatePlies(config.intro, () => startTask(0));
  } else {
    startTask(0);
  }
}
