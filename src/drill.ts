import { Chess } from 'chess.js';
import { registerBrushes } from './board-brushes';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import type { Line } from './types';
import type { MoveNode } from './tree';
import { Icons } from './icons';
import { getRetriesBeforeReveal } from './prefs';
import { playFeedback } from './sound';
import { pushBack } from './back-nav';
import { showDialog } from './dialog';
import { showToast } from './toast';
import { burstConfetti } from './confetti';
import { formatMove } from './notation';
import { createStruggleNudge, type StruggleNudge } from './struggle-nudge';

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
  // Line mode only. When set, the whole line is auto-played through once at this
  // interval (ms between moves) before the user is asked to play it — a "watch it
  // once, then do it yourself" warm-up. Use watchSpeedMs() to honour the pref.
  watchFirstMs?: number;
  // Fire a brief confetti burst when the run is completed.
  celebrateOnComplete?: boolean;
  // If provided (full mode only), the engine checks whether a wrong move is
  // actually a good alternative before penalising it as a mistake.
  checkAlternative?: (preFen: string, userUci: string) => Promise<boolean>;
  // If provided, the good-alternative card offers an "Explore this line" button
  // that opens the position AFTER the played move so the user can see where it
  // leads. The drill stays open underneath and resumes when the explorer closes.
  onExplore?: (fenAfter: string, label: string, orientation: 'white' | 'black') => void;
  // Timed mode (positions only). When set, the drill runs as a countdown of this
  // many milliseconds: a correct move scores and jumps on; a wrong move flashes
  // and IMMEDIATELY advances (no retry, no arrow). The pool cycles until the
  // clock runs out, then onComplete fires. onTimedResult reports each answer.
  timedMs?: number;
  onTimedResult?: (correct: boolean, position: { preFen: string; expected: MoveNode }) => void;
  // Positions modes only. When set, each resting position carries the opponent's
  // previous move as a last-move highlight, so you can see how the position arose.
  showLastMove?: boolean;
  // Positions modes only. When set, the opponent's previous move is animated INTO
  // each position before you play, rather than the board jumping straight to it.
  // (Implies the last-move highlight.) Needs prevUci/prevFen on each position.
  playPrelude?: boolean;
  // When set, backing out (Back button or system back gesture) asks "Abandon this
  // session?" first. Whatever was already reviewed still counts. Used by the
  // training modes so a stray back press can't drop you out of a drill.
  confirmAbandon?: boolean;
  // Full-line training only. When provided, a small control row beneath the board
  // offers in-session actions on the current line. The drill tears itself down
  // first (overlay + back-nav layer), then hands control back via the callback.
  //  onPauseLine — stop scheduling this line (inTraining=false); the caller drops
  //    it from the session and carries on with whatever's left.
  //  onEditLine  — leave the session and open this line in the builder, at the
  //    position currently on the board (atFen).
  //  onNoteEdit  — the current move's note was edited in-session; persist it.
  onPauseLine?: () => void;
  onEditLine?: (atFen: string) => void;
  onNoteEdit?: () => void;
  // Full-line training sessions only. Drives the session-level progress bar at
  // the top of the overlay: how far through the whole session we are. The dots
  // near the board track moves WITHIN this line; this bar tracks lines ACROSS
  // the session. `completed` = lines finished before this one; `total` = lines
  // the session started with.
  sessionProgress?: { completed: number; total: number };
  // Full-line, non-timed training only. Chronic-miss handling (see struggle.ts):
  // the caller decides which moves qualify and what each offer means, the drill
  // only picks the moment. Fires at most once per run, so a line never nags twice.
  //  offerFor      — 'note' to nudge for one, 'fix' to offer the drill, null for
  //    nothing. Called when a miss hardens into a reveal.
  //  missCount     — lifetime misses, for the nudge's one-liner.
  //  onNoteChanged — the nudge's note was edited; persist it.
  //  onNoteDismissed — the nudge was closed or flicked away; stamp the snooze.
  //    Carries the miss count the nudge was BUILT with, because grading at line
  //    completion may have moved it on since.
  //  startFix      — "Fix it" was tapped on the note card. The drill has already
  //    torn itself down (overlay + back-nav layer) when this fires.
  struggle?: {
    offerFor: (node: MoveNode) => 'note' | 'fix' | null;
    missCount: (node: MoveNode) => number;
    onNoteChanged: (node: MoveNode) => void;
    onNoteDismissed: (node: MoveNode, count: number) => void;
    startFix: (node: MoveNode, preFen: string) => void;
  };
}

// A single ply to auto-play (animated) between the user's moves. `note` rides
// along so the watch-first pass can show the move's explanation as it plays.
interface Ply { uci: string; fen: string; note?: string; }

// One thing the user has to play: the board sits at `preFen`, they must play
// `expected`. `replies` are the plies auto-played afterwards (line mode keeps
// the board continuous; positions mode leaves it empty and jumps to the next
// task instead). `colour` is the side the user is playing this task. In positions
// modes, `lastMove`/`prelude` optionally carry the opponent's previous move — to
// highlight, or to animate in (see DrillOptions.showLastMove / playPrelude).
interface Task {
  preFen: string;
  expected: MoveNode;
  colour: 'white' | 'black';
  replies: Ply[];
  continuous: boolean;
  lastMove?: [Key, Key];
  prelude?: Ply;
  preludeFen?: string;
}

interface DrillConfig {
  intro: Ply[];      // opponent plies to animate from the start (line mode)
  tasks: Task[];
  titleText: string; // the line/opening name shown above the board ('' hides it)
  // The whole line as plies (line mode only), used for the optional watch-first
  // warm-up. Empty for positions/timed modes.
  watchPlies?: Ply[];
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
  const ply = (n: MoveNode): Ply => ({ uci: n.uci, fen: n.fen, note: n.note });

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
    {
      intro,
      tasks,
      titleText: line.openingName || line.name || 'Untitled line',
      watchPlies: moves.map(ply),
    },
    opts,
  );
}

// A single position to drill. `prevUci`/`prevFen` describe the opponent's move
// that led here — optional, used only for the last-move mark / replay.
interface Position {
  preFen: string;
  expected: MoveNode;
  prevUci?: string;
  prevFen?: string;
}

// Build a positions-mode task, wiring up the opponent's previous move as a
// last-move highlight (showLastMove) and/or an animated prelude (playPrelude).
function positionTask(p: Position, opts: DrillOptions): Task {
  const lastMove: [Key, Key] | undefined = p.prevUci
    ? [p.prevUci.slice(0, 2) as Key, p.prevUci.slice(2, 4) as Key]
    : undefined;
  const canPrelude = opts.playPrelude && !!p.prevUci && !!p.prevFen;
  return {
    preFen: p.preFen,
    expected: p.expected,
    colour: colourToMove(p.preFen),
    replies: [],
    continuous: false,
    // The mark shows for showLastMove, and also rides along with a prelude.
    lastMove: (opts.showLastMove || canPrelude) ? lastMove : undefined,
    prelude: canPrelude ? { uci: p.prevUci!, fen: p.preFen } : undefined,
    preludeFen: canPrelude ? p.prevFen : undefined,
  };
}

// Drill a stream of individual positions. Each one resets the board to its
// position; a correct move jumps straight to the next.
export function startPositionsDrill(
  positions: Position[],
  opts: DrillOptions,
): void {
  if (positions.length === 0) {
    opts.onCancel();
    return;
  }
  const tasks: Task[] = positions.map(p => positionTask(p, opts));
  runDrill({ intro: [], tasks, titleText: '' }, opts);
}

// Timed mode: a countdown drill over a pool of individual positions. Correct
// moves score; wrong moves flash and skip on at once. The pool reshuffles and
// repeats until the clock expires.
export function startTimedDrill(
  positions: Position[],
  opts: DrillOptions & { timedMs: number },
): void {
  if (positions.length === 0) {
    opts.onCancel();
    return;
  }
  const tasks: Task[] = positions.map(p => positionTask(p, opts));
  runDrill({ intro: [], tasks, titleText: '' }, opts);
}

// ── The shared drill runtime ──────────────────────────────────────────────────

function runDrill(config: DrillConfig, opts: DrillOptions): void {
  const { tasks } = config;
  const timed = opts.timedMs != null;

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

  // Chronic-miss state (see DrillOptions.struggle). `strugglePending` holds the
  // move whose reveal armed the write-a-note prompt, waiting for the user to
  // replay it; `struggleUsed` spends the one offer this run is allowed.
  let strugglePending: MoveNode | null = null;
  let struggleUsed = false;
  let struggleNudge: StruggleNudge | null = null;

  // Wrong attempts on the *current* task; reset when we advance.
  let wrongAttempts = 0;
  // Extra tries a wrong move gets before we draw the arrow (full mode only).
  const retriesAllowed = getRetriesBeforeReveal();

  // Timed-mode state: a live correct tally and a countdown that ends the run.
  let timedCorrect = 0;
  let timeUp = false;
  let tickTimer: ReturnType<typeof setTimeout> | undefined;

  // ── Overlay ───────────────────────────────────────────────────────────────
  //
  // Vertical layout: a fixed back/timer toolbar, then a flexible TOP block (mode
  // title + line name) that hugs the board from above, the board in the middle,
  // and a flexible BOTTOM block (dots + your-move prompt / feedback + hint cards)
  // that hugs it from below. The two flex blocks share the spare height, so the
  // board sits vertically centred and within easy thumb reach.

  const overlay = document.createElement('div');
  overlay.className = 'pt-overlay pt-overlay--tinted';
  // Openings training wears the app accent, faintly — each training mode's
  // exercise screen carries its own subtle colour identity.
  overlay.style.setProperty('--pt-tint', 'var(--accent)');

  const headerEl = document.createElement('div');
  headerEl.className = 'pt-header';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'pt-back-btn';
  backBtn.appendChild(Icons.back(15));
  backBtn.appendChild(document.createTextNode(opts.backLabel ?? 'End session'));
  backBtn.addEventListener('click', () => exitViaButton());
  headerEl.appendChild(backBtn);

  // Timed mode: a live "✓ N" score and a mm:ss countdown pinned to the right of
  // the toolbar.
  const scoreEl = document.createElement('div');
  const timerEl = document.createElement('div');
  if (timed) {
    scoreEl.className = 'pt-timed-score';
    timerEl.className = 'pt-timer';
    headerEl.appendChild(scoreEl);
    headerEl.appendChild(timerEl);
  }

  // ── Session progress bar ───────────────────────────────────────────────────
  //
  // A thin bar pinned just under the toolbar. Two shapes share the same look
  // (see .pt-session-bar):
  //  • Full-line modes pass sessionProgress; the bar tracks LINES across the
  //    whole session, with a "Line X of Y" caption. (The dots near the board,
  //    by contrast, track the MOVES within the current line.)
  //  • Single-move modes (Fix mistakes) drill a FIXED number of
  //    positions, so the bar honestly tracks POSITIONS through the run, with a
  //    "Position N of M" caption. Timed mode is excluded: its pool cycles, so a
  //    fixed count is meaningless (the same reason it has no dots).
  // Either way a one-item run has nothing to track, so the bar is skipped.
  const sp = opts.sessionProgress;
  const showLineBar = !!sp && sp.total >= 2;
  const isPositionsMode = !timed && !tasks[0].continuous;
  const showPositionBar = isPositionsMode && tasks.length >= 2;
  const showSessionBar = showLineBar || showPositionBar;
  const sessionBarEl = document.createElement('div');
  let sessionFillEl: HTMLElement | null = null;
  let sessionLabelEl: HTMLElement | null = null;
  if (showSessionBar) {
    sessionBarEl.className = 'pt-session-bar';

    sessionLabelEl = document.createElement('div');
    sessionLabelEl.className = 'pt-session-bar-label';
    sessionBarEl.appendChild(sessionLabelEl);

    const trackEl = document.createElement('div');
    trackEl.className = 'pt-session-bar-track';
    sessionFillEl = document.createElement('div');
    sessionFillEl.className = 'pt-session-bar-fill';
    trackEl.appendChild(sessionFillEl);
    sessionBarEl.appendChild(trackEl);
  }

  // Paint the bar: `frac` (0..1) drives the fill width, `label` the caption.
  function paintSessionBar(frac: number, label: string): void {
    if (!sessionFillEl || !sessionLabelEl) return;
    sessionFillEl.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    sessionLabelEl.textContent = label;
  }

  // Full-line bar: `completed` lines are behind us (0..total). The caption reads
  // "Line X of Y".
  function renderSessionBar(completed: number): void {
    if (!sp) return;
    paintSessionBar(
      completed / sp.total,
      `Line ${Math.min(completed + 1, sp.total)} of ${sp.total}`,
    );
  }

  // Single-move bar: `done` positions are behind us (0..total). The caption
  // reads "Position N of M".
  function renderPositionBar(done: number): void {
    const total = tasks.length;
    paintSessionBar(done / total, `Position ${Math.min(done + 1, total)} of ${total}`);
  }

  if (showLineBar && sp) renderSessionBar(sp.completed);
  else if (showPositionBar) renderPositionBar(0);

  // ── Top block: mode title + line name, sitting just above the board ─────────

  const topEl = document.createElement('div');
  topEl.className = 'pt-top';

  // The training mode (e.g. "Training") — never the opening, in modes where that
  // would be a hint.
  const modeEl = document.createElement('div');
  modeEl.className = 'pt-mode-title';
  modeEl.textContent = opts.modeLabel ?? config.titleText;
  topEl.appendChild(modeEl);

  // The line name, directly under the mode title. Shown for full-line drills
  // (you picked the line by name); empty — and so hidden — for the individual-
  // move and timed modes, where it would give the answer away.
  const titleEl = document.createElement('div');
  titleEl.className = 'pt-line-name';
  titleEl.textContent = config.titleText;
  if (!config.titleText) titleEl.setAttribute('hidden', '');
  topEl.appendChild(titleEl);

  function renderTimedScore(): void {
    scoreEl.textContent = `✓ ${timedCorrect}`;
  }

  function renderTimer(msLeft: number): void {
    const secs = Math.ceil(msLeft / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
    timerEl.classList.toggle('pt-timer--low', secs <= 10);
  }

  // ── Board ───────────────────────────────────────────────────────────────────

  const boardWrap = document.createElement('div');
  boardWrap.className = 'pt-board-wrap';

  const boardEl = document.createElement('div');
  boardEl.className = 'pt-board';
  boardWrap.appendChild(boardEl);

  // ── Bottom block: progress dots, your-move prompt / feedback, hint cards ─────

  const bottomEl = document.createElement('div');
  bottomEl.className = 'pt-bottom';

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

  bottomEl.appendChild(progressEl);
  bottomEl.appendChild(statusEl);
  bottomEl.appendChild(noteCardEl);
  bottomEl.appendChild(altCardEl);

  const isLineDrill = tasks[0].continuous;

  // ── In-session controls (full-line training) ────────────────────────────────
  //
  // A discreet row beneath the board: view/add a note on this move, peek a hint,
  // pause this line out of training, or jump to the builder to edit it. Quiet
  // icons (+ a tiny label) so the board stays the focus. Positions/timed modes
  // don't get the row — these act on a whole line, which those modes lack.
  let noteControl: HTMLButtonElement | null = null;
  let noteControlLabel: HTMLElement | null = null;
  const showControls = isLineDrill && !timed;
  if (showControls) {
    const controls = document.createElement('div');
    controls.className = 'pt-controls';

    // Note — view this move's note, or add one when it has none. The label flips
    // between "View note" and "Add note" as the current move changes.
    noteControl = buildControl('note', Icons.note(19), 'Add note', () => toggleNote());
    noteControlLabel = noteControl.querySelector('.pt-control-label');
    controls.appendChild(noteControl);

    // Hint — draw the correct-move arrow for the current position. Never counts
    // as a miss; it just reuses the reveal arrow without requiring a replay.
    controls.appendChild(buildControl('hint', Icons.bulb(19), 'Hint', () => showHint()));

    if (opts.onPauseLine) {
      controls.appendChild(buildControl('pause', Icons.toggleOff(19), 'Turn off', () => confirmPause()));
    }
    if (opts.onEditLine) {
      controls.appendChild(buildControl('edit', Icons.pencil(19), 'Edit', () => leaveForEdit()));
    }

    bottomEl.appendChild(controls);
  }

  overlay.appendChild(headerEl);
  if (showSessionBar) overlay.appendChild(sessionBarEl);
  overlay.appendChild(topEl);
  overlay.appendChild(boardWrap);
  overlay.appendChild(bottomEl);
  document.body.appendChild(overlay);

  // Reflect whether the current move has a note: the control reads "View note"
  // when it does, "Add note" when it doesn't.
  function updateNoteButton(expected: MoveNode): void {
    if (!noteControlLabel || !noteControl) return;
    const has = !!expected.note;
    noteControlLabel.textContent = has ? 'View note' : 'Add note';
    noteControl.classList.toggle('pt-control--has-note', has);
  }

  // ── Exit / abandon guard ────────────────────────────────────────────────────
  //
  // Leaving the drill (End session button or system back gesture) either exits
  // straight away, or — when confirmAbandon is set — asks "End this session?"
  // first. Both doors raise the same dialog. The back gesture consumes our
  // back-layer before we hear about it, so the "stay" path on that route re-arms
  // the layer for the next press (so a second back-swipe asks again).

  function doExit(): void {
    cleanup();
    opts.onCancel();
  }

  function showAbandonDialog(onStay: () => void): void {
    showDialog({
      title: 'End this session?',
      body: 'Progress on finished lines is kept.',
      buttons: [
        { label: 'End session', variant: 'danger', onClick: doExit },
        { label: 'Keep going', variant: 'secondary', onClick: onStay },
      ],
      onDismiss: onStay,
    });
  }

  // Back button: our back-layer is still armed, so staying needs no re-arm.
  function exitViaButton(): void {
    if (opts.confirmAbandon) showAbandonDialog(() => {});
    else doExit();
  }

  // System back gesture: our back-layer was just popped, so re-arm it if the
  // user decides to stay.
  function exitViaBackGesture(): void {
    if (opts.confirmAbandon) showAbandonDialog(() => { removeBack = pushBack(exitViaBackGesture); });
    else doExit();
  }

  let removeBack = pushBack(exitViaBackGesture);

  // ── In-session controls ─────────────────────────────────────────────────────

  // One control: a small icon button with a tiny label beneath it.
  function buildControl(kind: string, icon: SVGElement, label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `pt-control pt-control--${kind}`;
    btn.setAttribute('aria-label', label);
    btn.appendChild(icon);
    const lbl = document.createElement('span');
    lbl.className = 'pt-control-label';
    lbl.textContent = label;
    btn.appendChild(lbl);
    btn.addEventListener('click', onClick);
    return btn;
  }

  // Draw the correct-move arrow for the current position — a free peek that never
  // records a miss. No-op while a reveal/alternative arrow is already up, or while
  // an engine check is mid-flight.
  function showHint(): void {
    if (awaitingCorrectReplay || awaitingAlternativePlay || checkingAlternative) return;
    const expected = tasks[taskIndex]?.expected;
    if (!expected) return;
    const orig = expected.uci.slice(0, 2) as Key;
    const dest = expected.uci.slice(2, 4) as Key;
    cg.setAutoShapes([{ orig, dest, brush: 'accent' }]);
  }

  // Turn this line off from training. We confirm first (it stops the line being
  // scheduled), then tear down and hand back to the caller, which drops it from
  // the session and carries on.
  function confirmPause(): void {
    showDialog({
      title: 'Turn off this line?',
      body: 'It will stop appearing in your active training sessions. You can flip it back on in My Lines.',
      buttons: [
        { label: 'Turn off', variant: 'danger', onClick: () => {
          cleanup();
          opts.onPauseLine!();
          showToast('Line turned off, continue training');
        } },
        { label: 'Keep training', variant: 'secondary', onClick: () => {} },
      ],
      onDismiss: () => {},
    });
  }

  // Leave the session to edit the line in the builder, at the position currently
  // on the board. The drill runs on a clone and only commits on completion, so
  // there's nothing half-saved to lose — we tear down cleanly (releasing the
  // back-nav layer) and hand control over.
  function leaveForEdit(): void {
    const atFen = tasks[taskIndex]?.preFen ?? START_FEN;
    cleanup();
    opts.onEditLine!(atFen);
  }

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

  // Register brushes for hint arrows after the instance exists. Unique keys per
  // board so the arrowhead markers never collide with another board's (see
  // board-brushes.ts — collisions drop the arrowhead, leaving a headless line).
  registerBrushes(cg, {
    accent: { color: '#ff9b21', opacity: 0.85, lineWidth: 10 },
    alt: { color: '#708151', opacity: 0.85, lineWidth: 10 },
  });

  const ro = new ResizeObserver(() => cg.redrawAll());
  ro.observe(boardEl);

  // ── Progress dots ─────────────────────────────────────────────────────────

  // No dots in timed mode — the pool cycles, so a fixed count is meaningless;
  // the header score + clock stand in instead.
  const dotEls: HTMLElement[] = [];
  if (!timed) {
    for (let k = 0; k < tasks.length; k++) {
      const dot = document.createElement('span');
      dot.className = 'pt-dot';
      progressEl.appendChild(dot);
      dotEls.push(dot);
    }
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
    playFeedback('wrong');
    const flash = document.createElement('div');
    flash.className = 'pt-error-flash';
    boardWrap.appendChild(flash);
    flash.addEventListener('animationend', () => flash.remove(), { once: true });
  }

  // ── Note card (mistake hints + the note control's view/add editor) ──────────

  function showNoteCard(note: string): void {
    noteCardEl.classList.remove('pt-note-card--edit', 'pt-note-card--fix');
    noteCardEl.textContent = note;
    noteCardEl.removeAttribute('hidden');
    // Restart the entrance each time it's shown: the note arriving is the point
    // of the moment, so it should read as arriving, not as having been there.
    noteCardEl.classList.remove('pt-note-card--enter');
    void noteCardEl.offsetWidth; // reflow, so the animation replays
    noteCardEl.classList.add('pt-note-card--enter');
  }

  function hideNoteCard(): void {
    noteCardEl.setAttribute('hidden', '');
    noteCardEl.classList.remove('pt-note-card--edit', 'pt-note-card--fix');
    noteCardEl.textContent = '';
  }

  // The one chronic-miss offer per run is reserved for full-line, non-timed
  // training: positions modes have no line to replay afterwards, and timed mode
  // never grades, so a move can't go chronic there in the first place.
  function struggleAvailable(): boolean {
    return !!opts.struggle && isLineDrill && !timed && !struggleUsed;
  }

  // Slide the nudge in under the board, between the status line and the control
  // row — never over the board, and never in the way of the next move.
  function showStruggleNudge(node: MoveNode): StruggleNudge {
    const s = opts.struggle!;
    struggleNudge?.destroy();
    // Read the count once, here: it's what the box says, and what the snooze is
    // stamped with when the box goes away — even if grading has moved on since.
    const count = s.missCount(node);
    struggleNudge = createStruggleNudge({
      node,
      count,
      onNoteChanged: () => { s.onNoteChanged(node); updateNoteButton(node); },
      onDismiss: () => s.onNoteDismissed(node, count),
    });
    statusEl.insertAdjacentElement('afterend', struggleNudge.el);
    // The board is frozen on their move while this is up, so say so rather than
    // leaving the last status ("Your move") contradicting a dead board.
    setStatus('');
    return struggleNudge;
  }

  // The note control: open an editor for the current move's note (closing it if
  // already open). Empty text clears the note. Edits write straight to the move
  // node; onNoteEdit lets the caller persist (so a note survives an abandon).
  function toggleNote(): void {
    if (!noteCardEl.hasAttribute('hidden')) { hideNoteCard(); return; }
    const expected = tasks[taskIndex]?.expected;
    if (!expected) return;
    noteCardEl.textContent = '';
    noteCardEl.classList.add('pt-note-card--edit');
    const ta = document.createElement('textarea');
    ta.className = 'pt-note-input';
    ta.placeholder = 'Why does the line play this move?';
    ta.value = expected.note ?? '';
    ta.addEventListener('input', () => {
      expected.note = ta.value.trim() || undefined;
      updateNoteButton(expected);
    });
    ta.addEventListener('change', () => opts.onNoteEdit?.());
    noteCardEl.appendChild(ta);
    noteCardEl.removeAttribute('hidden');
    ta.focus();
  }

  // ── Alt card (good-alternative notice) ───────────────────────────────────────

  function showAltCard(expected: MoveNode, explore: { fen: string; san: string } | null): void {
    altCardEl.innerHTML = '';

    // Brief headline: a sound move, but not the saved line.
    const headEl = document.createElement('div');
    headEl.className = 'pt-alt-head';
    headEl.textContent = `Good move${explore ? ` (${formatMove(explore.san)})` : ''} — but not your saved line.`;
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
        opts.onExplore!(explore.fen, `After ${formatMove(explore.san)}`, userColour);
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

    // The moment a miss has hardened into a reveal: if this is a move the user
    // keeps forgetting, either offer the drill (it has a note to act on) or arm
    // the write-a-note nudge for once they've replayed it. At most once a run.
    const offer = struggleAvailable() ? opts.struggle!.offerFor(expected) : null;
    if (offer === 'note') strugglePending = expected;

    // Deferred to the next frame so it always runs after chessground's own
    // pending render, avoiding a shapes-clearing race condition.
    requestAnimationFrame(() => {
      if (isCleaned) return;
      const orig = expected.uci.slice(0, 2) as Key;
      const dest = expected.uci.slice(2, 4) as Key;
      cg.setAutoShapes([{ orig, dest, brush: 'accent' }]);
      if (expected.note) {
        showNoteCard(expected.note);
        if (offer === 'fix') appendFixItButton(expected);
      }
    });
  }

  // The "Fix it" offer, tacked onto the note card of a move that keeps being
  // missed. Opt-in: ignoring it costs nothing, you just play the arrow and go on.
  function appendFixItButton(expected: MoveNode): void {
    noteCardEl.classList.add('pt-note-card--fix');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-primary pt-note-fix-btn';
    btn.textContent = 'Fix it';
    btn.addEventListener('click', () => {
      struggleUsed = true;
      const preFen = tasks[taskIndex].preFen;
      cleanup();
      opts.struggle!.startFix(expected, preFen);
    });
    noteCardEl.appendChild(btn);

    const hint = document.createElement('div');
    hint.className = 'pt-note-fix-hint';
    hint.textContent = 'Play the move 3× then replay the full line.';
    noteCardEl.appendChild(hint);
  }

  // ── Good-alternative sequence ─────────────────────────────────────────────

  function handleGoodAlternative(expected: MoveNode, preFen: string, userUci: string): void {
    awaitingAlternativePlay = true;

    // A sound move, but it isn't the line we saved — still ask for the saved move.
    setStatus(`Good move — but not your line. Play ${formatMove(expected.san)} to continue.`, 'pt-status--alt');

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

    if (timed) { onTimedMove(from, to); return; }

    const expected = tasks[taskIndex].expected;
    const eFrom = expected.uci.slice(0, 2);
    const eTo = expected.uci.slice(2, 4);

    if (from === eFrom && to === eTo) {
      // Correct move — clear any arrow (reveal, alternative, or a peeked hint).
      cg.setAutoShapes([]);
      if (awaitingCorrectReplay) {
        hideNoteCard();
        awaitingCorrectReplay = false;
      }
      if (awaitingAlternativePlay) {
        cg.setAutoShapes([]);
        hideAltCard();
        awaitingAlternativePlay = false;
      }
      markDot(taskIndex, 'correct');
      playFeedback('correct');
      setStatus('');
      chess.move({ from, to, promotion: 'q' });

      cg.set({
        fen: chess.fen(),
        turnColor: cgTurn(),
        movable: { color: undefined, dests: new Map() },
        lastMove: [from, to],
      });

      // A chronic move with no note yet: the reveal armed the nudge, and the
      // user has just replayed the move correctly. Hold the board exactly here —
      // their move played and highlighted, the opponent yet to answer — and
      // slide the box in underneath. The line resumes once the box is gone
      // (it sees itself off if you never touch it).
      if (strugglePending === expected) {
        strugglePending = null;
        struggleUsed = true;
        const nudge = showStruggleNudge(expected);
        void nudge.settled.then(() => { if (!isCleaned) advanceAfterCorrect(); });
        return;
      }

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

  // ── Timed mode ──────────────────────────────────────────────────────────────

  // One answer in timed mode: correct scores and jumps on; wrong flashes and
  // skips on at once. No retries, no arrows — speed is the whole point.
  function onTimedMove(from: Key, to: Key): void {
    if (timeUp) return;
    const task = tasks[taskIndex];
    const expected = task.expected;
    const correct = from === expected.uci.slice(0, 2) && to === expected.uci.slice(2, 4);

    if (correct) {
      timedCorrect++;
      playFeedback('correct');
      renderTimedScore();
      chess.move({ from, to, promotion: 'q' });
      cg.set({
        fen: chess.fen(),
        turnColor: cgTurn(),
        movable: { color: undefined, dests: new Map() },
        lastMove: [from, to],
      });
    } else {
      flashError();
      snapBack();
      cg.set({ movable: { color: undefined, dests: new Map() } });
    }

    opts.onTimedResult?.(correct, { preFen: task.preFen, expected });

    autoTimer = setTimeout(() => {
      if (isCleaned || timeUp) return;
      let next = taskIndex + 1;
      if (next >= tasks.length) { shuffleTasks(); next = 0; }
      startTask(next);
    }, correct ? 220 : 360);
  }

  // Fisher–Yates, so a second lap through the pool feels fresh rather than rote.
  function shuffleTasks(): void {
    for (let i = tasks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tasks[i], tasks[j]] = [tasks[j], tasks[i]];
    }
  }

  function startTimer(): void {
    const deadline = Date.now() + opts.timedMs!;
    renderTimedScore();
    const tick = (): void => {
      if (isCleaned) return;
      const left = Math.max(0, deadline - Date.now());
      renderTimer(left);
      if (left <= 0) { finishTimed(); return; }
      tickTimer = setTimeout(tick, 200);
    };
    tick();
  }

  function finishTimed(): void {
    timeUp = true;
    if (autoTimer) clearTimeout(autoTimer);
    if (tickTimer) clearTimeout(tickTimer);
    cg.set({ movable: { color: undefined, dests: new Map() } });
    cleanup();
    opts.onComplete();
  }

  // Auto-play a run of plies (opponent replies / opening lead-in / watch-first
  // warm-up), animated. `delay` is the gap before each move (default 700 ms);
  // the watch-first pass passes the user's watch-speed instead. With
  // `showNotes` (watch-first only), a ply's note pops up as its move plays —
  // the teaching moment — and the next move waits long enough to read it.
  function animatePlies(plies: Ply[], done: () => void, delay = 700, showNotes = false): void {
    let k = 0;
    let readingTime = 0; // extra hold after a ply that showed a note
    function step(): void {
      if (isCleaned) return;
      if (k >= plies.length) {
        if (readingTime > 0) { autoTimer = setTimeout(() => { if (!isCleaned) done(); }, readingTime); }
        else done();
        return;
      }
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
        if (showNotes) {
          if (p.note) {
            showNoteCard(p.note);
            readingTime = Math.min(3500, 900 + p.note.length * 25);
          } else {
            hideNoteCard();
            readingTime = 0;
          }
        }
        step();
      }, delay + readingTime);
    }
    step();
  }

  // Present a task: place the board at its position and hand control over.
  function startTask(idx: number): void {
    taskIndex = idx;
    // Single-move modes: advance the position bar as each new position opens.
    if (showPositionBar) renderPositionBar(idx);
    const task = tasks[idx];
    userColour = task.colour;
    wrongAttempts = 0;
    awaitingCorrectReplay = false;
    awaitingAlternativePlay = false;
    cg.setAutoShapes([]);
    hideNoteCard();
    hideAltCard();
    updateNoteButton(task.expected);

    // Fix mistakes: animate the opponent's previous move INTO the position, so you
    // see how you got here, then hand control over.
    if (task.prelude && task.preludeFen) {
      chess.load(task.preludeFen);
      cg.set({
        fen: task.preludeFen,
        orientation: task.colour,
        turnColor: colourToMove(task.preludeFen),
        movable: { color: undefined, dests: new Map() },
        lastMove: undefined,
      });
      animatePlies([task.prelude], () => {
        if (isCleaned) return;
        cg.set({ turnColor: cgTurn(), movable: { color: userColour, dests: legalDests() } });
        promptYourMove();
      });
      return;
    }

    chess.load(task.preFen);
    const base = {
      fen: task.preFen,
      orientation: task.colour,
      turnColor: cgTurn(),
      movable: { color: userColour, dests: legalDests() },
    };
    // Continuous tasks keep the opponent's last-move highlight that the reply
    // animation just set; a position jump shows its own opponent-move mark (timed
    // mode) or starts clean.
    cg.set(task.continuous ? base : { ...base, lastMove: task.lastMove ?? undefined });
    promptYourMove();
  }

  async function completeRun(): Promise<void> {
    if (autoTimer) clearTimeout(autoTimer);
    cg.set({ movable: { color: undefined, dests: new Map() } });

    if (opts.onBeforeComplete) {
      await opts.onBeforeComplete();
    }

    setStatus(opts.completeMessage ?? 'Line complete', 'pt-status--success');
    // Fill this line's notch on the session bar before we hand off.
    if (showLineBar && sp) renderSessionBar(sp.completed + 1);
    // Single-move modes: top the bar off — every position is behind us now.
    if (showPositionBar) renderPositionBar(tasks.length);
    if (opts.celebrateOnComplete) burstConfetti(boardWrap);
    // Nothing to wait on here: a live nudge holds the advance that leads to this
    // point, so by the time we complete it has already been dealt with.
    setTimeout(() => { cleanup(); opts.onComplete(); }, 1500);
  }

  function cleanup(): void {
    isCleaned = true;
    if (autoTimer) clearTimeout(autoTimer);
    if (tickTimer) clearTimeout(tickTimer);
    struggleNudge?.destroy();
    ro.disconnect();
    overlay.remove();
    removeBack();
  }

  // ── Kick off ──────────────────────────────────────────────────────────────

  // The real run: animate the opening lead-in (black lines open with White's
  // move) before handing the first task over, or start straight away.
  function beginRun(): void {
    if (config.intro.length > 0) {
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

  // Watch-first warm-up (line mode): play the whole line through once at the
  // user's watch speed, then reset to the start and hand the run over so they
  // play it themselves.
  const watchPlies = config.watchPlies ?? [];
  if (opts.watchFirstMs != null && watchPlies.length > 0) {
    chess.load(START_FEN);
    cg.set({
      fen: START_FEN,
      orientation: tasks[0].colour,
      turnColor: 'white',
      movable: { color: undefined, dests: new Map() },
    });
    setStatus('Watch the line once', 'pt-status--prompt');
    animatePlies(watchPlies, () => {
      // Hold on the final position for a beat (animatePlies already added
      // reading time when the last move carried a note), then reset and start
      // the quiz.
      autoTimer = setTimeout(() => { if (!isCleaned) beginRun(); }, opts.watchFirstMs! + 300);
    }, opts.watchFirstMs, true);
  } else {
    beginRun();
  }

  if (timed) startTimer();
}
