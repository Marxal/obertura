// The puzzle-solving overlay. A close cousin of drill.ts (and it reuses the same
// .pt-* overlay styles), but the loop is different: instead of walking a saved
// line, it loads Lichess puzzles one after another and asks you to find the
// solution. Opponent moves auto-play; you play your moves.
//
// Puzzles come in SESSIONS with a defined end and a results screen:
//   • count mode — a fixed number of puzzles (e.g. 10). A wrong move reveals the
//     answer and you replay it (so you still learn the idea); the puzzle counts
//     as missed.
//   • timed mode — a single countdown (e.g. 3 min). A wrong move just flashes and
//     jumps straight to the next puzzle (no reveal); each clean solve scores.
// Either way the session ends on a results screen offering "Retry mistakes".

import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { Icons } from './icons';
import { playFeedback } from './sound';
import { pushBack } from './back-nav';
import { burstConfetti } from './confetti';
import { puzzleSetup, type Puzzle } from './puzzles';
import { wasRecentlySeen, recordSeenPuzzle } from './puzzle-log';

// One puzzle plus the opening it was drawn for (so stats and retry know its
// angle even in a Mixed session).
export interface PuzzleDraw {
  puzzle: Puzzle;
  angle: string | null;
}

export type PuzzleMode =
  | { kind: 'count'; count: number }
  | { kind: 'timed'; ms: number };

export interface PuzzleResult {
  puzzle: Puzzle;
  solved: boolean; // true only when finished with no wrong move
  angle: string | null;
}

export interface PuzzleSessionOptions {
  // Draw the next puzzle to present, or null when none is available.
  nextPuzzle: () => Promise<PuzzleDraw | null>;
  // How the session ends.
  mode: PuzzleMode;
  // Fired once per puzzle when it's finished (solved or failed).
  onResult?: (r: PuzzleResult) => void;
  onExit: () => void;
  // Small muted label above the board (e.g. the opening name, or "Mixed").
  modeLabel?: string;
  // Skip puzzles seen recently (default true); a retry session turns this off so
  // the missed puzzles are deliberately repeated.
  dedup?: boolean;
}

export function startPuzzleSession(opts: PuzzleSessionOptions): void {
  const chess = new Chess();
  let cg: Api;
  let isCleaned = false;
  let autoTimer: ReturnType<typeof setTimeout> | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  const timed = opts.mode.kind === 'timed';
  const dedup = opts.dedup !== false;

  // Per-puzzle state.
  let draw: PuzzleDraw | null = null;
  let solution: string[] = [];
  let solIndex = 1;             // next solution move the solver owes (1, 3, 5…)
  let solverColour: 'white' | 'black' = 'white';
  let failed = false;          // a wrong move was played on this puzzle
  let awaitingReplay = false;  // after a miss, the correct move must be replayed
  let inputLocked = true;      // board frozen during loads / animations

  // Session tallies.
  let completed = 0;           // puzzles finished so far
  let solvedCount = 0;
  const missed: PuzzleDraw[] = [];
  let deadline = 0;            // timed mode: epoch ms when the clock hits 0

  // ── Overlay scaffold (mirrors drill.ts) ──────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'pt-overlay';

  const headerEl = document.createElement('div');
  headerEl.className = 'pt-header';
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'pt-back-btn';
  backBtn.appendChild(Icons.back(15));
  backBtn.appendChild(document.createTextNode(timed ? 'End session' : 'Done'));
  backBtn.addEventListener('click', () => doExit());
  headerEl.appendChild(backBtn);

  const scoreEl = document.createElement('div');
  scoreEl.className = 'pt-timed-score';
  headerEl.appendChild(scoreEl);

  // Timed countdown, pinned right (drill's .pt-timer look).
  const timerEl = document.createElement('div');
  if (timed) {
    timerEl.className = 'pt-timer';
    headerEl.appendChild(timerEl);
  }

  // Count mode: a "Puzzle X of N" progress bar under the toolbar.
  const sessionBarEl = document.createElement('div');
  let sessionFillEl: HTMLElement | null = null;
  let sessionLabelEl: HTMLElement | null = null;
  if (opts.mode.kind === 'count' && opts.mode.count >= 2) {
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

  const topEl = document.createElement('div');
  topEl.className = 'pt-top';
  const modeEl = document.createElement('div');
  modeEl.className = 'pt-mode-title';
  modeEl.textContent = opts.modeLabel ?? 'Puzzles';
  topEl.appendChild(modeEl);
  const ratingEl = document.createElement('div');
  ratingEl.className = 'pt-line-name';
  topEl.appendChild(ratingEl);

  const boardWrap = document.createElement('div');
  boardWrap.className = 'pt-board-wrap';
  const boardEl = document.createElement('div');
  boardEl.className = 'pt-board';
  boardWrap.appendChild(boardEl);

  const bottomEl = document.createElement('div');
  bottomEl.className = 'pt-bottom';
  const statusEl = document.createElement('div');
  statusEl.className = 'pt-status';
  statusEl.setAttribute('aria-live', 'polite');
  const themesEl = document.createElement('div');
  themesEl.className = 'pz-themes';
  themesEl.hidden = true;
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'pz-next-btn';
  nextBtn.textContent = 'Next puzzle';
  nextBtn.hidden = true;
  nextBtn.addEventListener('click', () => { nextBtn.hidden = true; void loadNext(); });
  bottomEl.appendChild(statusEl);
  bottomEl.appendChild(themesEl);
  bottomEl.appendChild(nextBtn);

  overlay.appendChild(headerEl);
  if (sessionFillEl) overlay.appendChild(sessionBarEl);
  overlay.appendChild(topEl);
  overlay.appendChild(boardWrap);
  overlay.appendChild(bottomEl);
  document.body.appendChild(overlay);

  cg = Chessground(boardEl, {
    orientation: 'white',
    movable: { color: undefined, free: false, dests: new Map() },
    draggable: { showGhost: true },
    animation: { enabled: true, duration: 200 },
    events: { move(from, to) { onUserMove(from as Key, to as Key); } },
  });
  cg.state.drawable.brushes['accent'] = { key: 'accent', color: '#ff9b21', opacity: 0.85, lineWidth: 10 };
  const ro = new ResizeObserver(() => cg.redrawAll());
  ro.observe(boardEl);

  const removeBack = pushBack(() => doExit());

  // ── Helpers ───────────────────────────────────────────────────────────────
  function cgTurn(): 'white' | 'black' {
    return chess.turn() === 'w' ? 'white' : 'black';
  }
  function legalDests(): Map<Key, Key[]> {
    const dests = new Map<Key, Key[]>();
    for (const m of chess.moves({ verbose: true })) {
      const from = m.from as Key;
      if (!dests.has(from)) dests.set(from, []);
      dests.get(from)!.push(m.to as Key);
    }
    return dests;
  }
  function uciParts(uci: string): { from: Key; to: Key; promotion: 'q' | 'r' | 'b' | 'n' } {
    return {
      from: uci.slice(0, 2) as Key,
      to: uci.slice(2, 4) as Key,
      promotion: (uci[4] as 'q' | 'r' | 'b' | 'n') || 'q',
    };
  }
  function setStatus(text: string, variant = ''): void {
    statusEl.textContent = text;
    statusEl.className = 'pt-status' + (variant ? ' ' + variant : '');
  }
  function flashError(): void {
    playFeedback('wrong');
    const flash = document.createElement('div');
    flash.className = 'pt-error-flash';
    boardWrap.appendChild(flash);
    flash.addEventListener('animationend', () => flash.remove(), { once: true });
  }
  function lockBoard(): void {
    inputLocked = true;
    cg.set({ movable: { color: undefined, dests: new Map() } });
  }
  function handToSolver(): void {
    inputLocked = false;
    cg.set({ turnColor: cgTurn(), movable: { color: solverColour, dests: legalDests() } });
  }
  // Apply a UCI move to both chess.js and the board, animated.
  function playMove(uci: string): void {
    const { from, to, promotion } = uciParts(uci);
    chess.move({ from, to, promotion });
    cg.set({ fen: chess.fen(), turnColor: cgTurn(), lastMove: [from, to], movable: { color: undefined, dests: new Map() } });
  }
  function renderScore(): void {
    scoreEl.textContent = `✓ ${solvedCount}`;
  }
  function renderSessionBar(): void {
    if (!sessionFillEl || !sessionLabelEl || opts.mode.kind !== 'count') return;
    const total = opts.mode.count;
    sessionFillEl.style.width = `${Math.min(1, completed / total) * 100}%`;
    sessionLabelEl.textContent = `Puzzle ${Math.min(completed + 1, total)} of ${total}`;
  }

  // ── Timed countdown ─────────────────────────────────────────────────────────
  function renderTimer(): void {
    const msLeft = Math.max(0, deadline - Date.now());
    const secs = Math.ceil(msLeft / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
    timerEl.classList.toggle('pt-timer--low', secs <= 10);
  }
  function startTimer(): void {
    deadline = Date.now() + (opts.mode.kind === 'timed' ? opts.mode.ms : 0);
    renderTimer();
    tickTimer = setInterval(() => {
      if (isCleaned) return;
      renderTimer();
      if (Date.now() >= deadline) { stopTimer(); showResults(); }
    }, 250);
  }
  function stopTimer(): void {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = undefined; }
  }

  // ── Puzzle lifecycle ──────────────────────────────────────────────────────
  async function loadNext(): Promise<void> {
    lockBoard();
    setStatus('Loading puzzle…', 'pt-status--prompt');
    themesEl.hidden = true;
    cg.setAutoShapes([]);
    renderSessionBar();

    // Skip puzzles whose data won't replay, and (unless retrying) puzzles seen
    // recently. Give up after a few misses so a backend hiccup can't spin forever.
    let setup = null;
    for (let tries = 0; tries < 6 && !isCleaned; tries++) {
      const d = await opts.nextPuzzle();
      if (isCleaned) return;
      if (!d) break;
      if (dedup && wasRecentlySeen(d.puzzle.id)) continue;
      const s = puzzleSetup(d.puzzle);
      if (s) { draw = d; setup = s; break; }
    }
    if (!setup || !draw) {
      // Ran dry. If we already solved some, treat it as the end; otherwise it's a
      // connection/availability problem.
      if (completed > 0) { showResults(); return; }
      setStatus('No more puzzles right now. Check your connection and try again.', 'pt-status--error');
      return;
    }

    recordSeenPuzzle(draw.puzzle.id);
    solution = setup.solution;
    solverColour = setup.solverColour;
    solIndex = 0;            // the solver plays solution[0] first
    failed = false;
    awaitingReplay = false;

    chess.load(setup.fen);
    cg.set({
      fen: setup.fen,
      orientation: solverColour,
      turnColor: cgTurn(),
      lastMove: undefined,
      movable: { color: undefined, dests: new Map() },
    });
    ratingEl.textContent = `Rating ${draw.puzzle.rating}`;

    // The solver is already to move — prompt and hand over (no opponent setup
    // move; the pgn already ended with it).
    autoTimer = setTimeout(() => {
      if (isCleaned) return;
      setStatus(`${solverColour === 'white' ? 'White' : 'Black'} to play — find the best move`, 'pt-status--prompt');
      handToSolver();
    }, 360);
  }

  function revealCorrect(): void {
    awaitingReplay = true;
    const expected = solution[solIndex];
    const { from, to } = uciParts(expected);
    cg.set({ turnColor: cgTurn(), movable: { color: solverColour, dests: new Map([[from, [to]]]) } });
    requestAnimationFrame(() => {
      if (isCleaned) return;
      cg.setAutoShapes([{ orig: from, dest: to, brush: 'accent' }]);
    });
    setStatus('Play the highlighted move', 'pt-status--reveal');
  }

  function onUserMove(from: Key, to: Key): void {
    if (inputLocked) return;
    const expected = solution[solIndex];
    if (!expected) return;
    const { from: eFrom, to: eTo } = uciParts(expected);

    if (from === eFrom && to === eTo) {
      // Correct (or the required replay after a miss).
      cg.setAutoShapes([]);
      awaitingReplay = false;
      playFeedback('correct');
      playMove(expected);
      solIndex++;
      advance();
      return;
    }

    // Wrong move.
    if (awaitingReplay) {
      // Already revealed — just nudge them back to the highlighted move.
      flashError();
      cg.set({ fen: chess.fen(), turnColor: cgTurn(), movable: { color: solverColour, dests: new Map([[eFrom, [eTo]]]) } });
      requestAnimationFrame(() => { if (!isCleaned) cg.setAutoShapes([{ orig: eFrom, dest: eTo, brush: 'accent' }]); });
      return;
    }
    failed = true;
    flashError();
    if (timed) {
      // No reveal — count it missed and jump straight to the next puzzle.
      cg.set({ fen: chess.fen(), turnColor: cgTurn(), movable: { color: undefined, dests: new Map() } });
      finish();
      return;
    }
    // Count mode: reveal the answer and make them replay it to learn the idea.
    cg.set({ fen: chess.fen(), turnColor: cgTurn(), movable: { color: undefined, dests: new Map() } });
    revealCorrect();
  }

  // After the solver's correct move: auto-play the opponent's reply, then either
  // hand back for the next move or finish the puzzle.
  function advance(): void {
    if (solIndex >= solution.length) { finish(); return; }
    // solution[solIndex] is now an opponent reply — auto-play it.
    lockBoard();
    autoTimer = setTimeout(() => {
      if (isCleaned) return;
      playMove(solution[solIndex]);
      solIndex++;
      if (solIndex >= solution.length) { finish(); return; }
      setStatus('Your move', 'pt-status--prompt');
      handToSolver();
    }, 360);
  }

  // Finish the current puzzle: record it, update tallies, then advance the
  // session (next puzzle, or the results screen when the session is over).
  function finish(): void {
    lockBoard();
    cg.setAutoShapes([]);
    completed++;
    const cur = draw!;
    if (!failed) solvedCount++; else missed.push(cur);
    renderScore();
    opts.onResult?.({ puzzle: cur.puzzle, solved: !failed, angle: cur.angle });

    if (timed) {
      // Keep moving — the clock, not a button, ends the session.
      if (Date.now() >= deadline) { showResults(); return; }
      autoTimer = setTimeout(() => { if (!isCleaned && Date.now() < deadline) void loadNext(); }, 420);
      return;
    }

    // Count mode: show the outcome, then either finish or load the next puzzle.
    const total = opts.mode.kind === 'count' ? opts.mode.count : 0;
    renderSessionBar();
    if (cur.puzzle.themes.length) {
      themesEl.textContent = cur.puzzle.themes.map(prettyTheme).join(' · ');
      themesEl.hidden = false;
    }
    if (failed) {
      setStatus('Solution shown — next time!', 'pt-status--error');
    } else {
      setStatus('Solved!', 'pt-status--success');
      burstConfetti(boardWrap);
    }
    if (completed >= total) {
      autoTimer = setTimeout(() => { if (!isCleaned) showResults(); }, failed ? 1800 : 1200);
      return;
    }
    nextBtn.hidden = false;
    autoTimer = setTimeout(() => { if (!isCleaned) { nextBtn.hidden = true; void loadNext(); } }, failed ? 2600 : 1500);
  }

  // ── Results screen ──────────────────────────────────────────────────────────
  function showResults(): void {
    stopTimer();
    if (autoTimer) clearTimeout(autoTimer);
    lockBoard();
    cg.setAutoShapes([]);
    burstConfetti(boardWrap);

    // Swap the overlay's body for a summary panel (reusing the train look).
    boardWrap.remove();
    bottomEl.remove();
    topEl.remove();
    sessionBarEl.remove();
    timerEl.remove();
    scoreEl.remove();

    const wrap = document.createElement('div');
    wrap.className = 'section train-completion train-completion--enter pz-results';

    const done = document.createElement('div');
    done.className = 'train-completion-done';
    done.textContent = 'Session complete ✓';
    wrap.appendChild(done);

    const sub = document.createElement('div');
    sub.className = 'train-completion-name';
    sub.textContent = `${completed} puzzle${completed === 1 ? '' : 's'}${timed ? ' in the time' : ''}`;
    wrap.appendChild(sub);

    const row = document.createElement('div');
    row.className = 'summary-stats-row';
    row.appendChild(statBox(solvedCount, 'solved', 'summary-stat-box--right'));
    row.appendChild(statBox(missed.length, 'missed', missed.length > 0 ? 'summary-stat-box--missed' : 'summary-stat-box--zero'));
    wrap.appendChild(row);

    if (missed.length > 0) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'pz-next-btn';
      retry.textContent = `Retry mistakes (${missed.length})`;
      retry.addEventListener('click', () => retryMistakes(missed.slice()));
      wrap.appendChild(retry);
    }

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = missed.length > 0 ? 'pz-results-secondary' : 'pz-next-btn';
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', () => doExit());
    wrap.appendChild(doneBtn);

    overlay.appendChild(wrap);
  }

  function statBox(value: number, label: string, cls: string): HTMLElement {
    const box = document.createElement('div');
    box.className = `summary-stat-box ${cls}`;
    const val = document.createElement('div');
    val.className = 'summary-stat-value';
    val.textContent = String(value);
    const lbl = document.createElement('div');
    lbl.className = 'summary-stat-label';
    lbl.textContent = label;
    box.appendChild(val);
    box.appendChild(lbl);
    return box;
  }

  // Replay the missed puzzles as a fresh count session (de-dup off so they repeat).
  function retryMistakes(pool: PuzzleDraw[]): void {
    cleanup();
    const queue = [...pool];
    startPuzzleSession({
      nextPuzzle: async () => queue.shift() ?? null,
      mode: { kind: 'count', count: queue.length },
      onResult: opts.onResult,
      onExit: opts.onExit,
      modeLabel: 'Retry mistakes',
      dedup: false,
    });
  }

  function doExit(): void {
    cleanup();
    opts.onExit();
  }
  function cleanup(): void {
    isCleaned = true;
    if (autoTimer) clearTimeout(autoTimer);
    stopTimer();
    ro.disconnect();
    overlay.remove();
    removeBack();
  }

  renderScore();
  if (timed) startTimer();
  void loadNext();
}

// "mateIn2" → "Mate in 2", "kingsideAttack" → "Kingside attack".
function prettyTheme(theme: string): string {
  const spaced = theme.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
