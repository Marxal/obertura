// The puzzle-solving overlay. A close cousin of drill.ts (and it reuses the same
// .pt-* overlay styles), but the loop is different: instead of walking a saved
// line, it loads Lichess puzzles one after another and asks you to find the
// solution. Opponent moves auto-play; you play your moves.
//
// Puzzles come in SESSIONS with a defined end and a results screen:
//   • count mode — a fixed number of puzzles (e.g. 10). You keep trying until you
//     find each move; a Hint button reveals the arrow if you're stuck. A wrong
//     move or a hint marks the puzzle as not-clean (no rating gain). The puzzle
//     never auto-jumps — you tap "Next" when you're ready. When `rated`, each
//     clean first-try solve moves your puzzle rating (Daily Rated Mix only).
//   • timed mode — "Time Attack": a countdown (3/5/10 min) with a 3-mistake cap.
//     A wrong move flashes, fills a red mistake dot and jumps straight to the
//     next puzzle (no reveal). The run ends on the clock or the third mistake.
//     Difficulty ramps up as you solve. Casual — never touches your rating.
// Either way the session ends on a results screen: a per-puzzle review list,
// "Play again", "Retry mistakes" and "Done".

import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { Icons } from './icons';
import { playFeedback } from './sound';
import { pushBack } from './back-nav';
import { burstConfetti, celebratePawn } from './confetti';
import { puzzleSetup, type Puzzle } from './puzzles';
import { showDialog } from './dialog';
import { wasRecentlySeen, recordSeenPuzzle } from './puzzle-log';
import { getPuzzleRating, nextRating, commitRating } from './puzzle-rating';
import { countUp } from './count-up';

// One puzzle plus the opening it was drawn for (so stats and retry know its
// angle even in a Mixed session). `family` is a friendly display name for the
// results list.
export interface PuzzleDraw {
  puzzle: Puzzle;
  angle: string | null;
  family?: string;
}

export type PuzzleMode =
  | { kind: 'count'; count: number; rated?: boolean }
  | { kind: 'timed'; ms: number; maxMistakes: number };

export interface PuzzleResult {
  puzzle: Puzzle;
  solved: boolean; // true only when finished clean (no wrong move, no hint)
  angle: string | null;
}

export interface PuzzleSessionOptions {
  // Draw the next puzzle to present, or null when none is available. Receives the
  // running solved count so the caller can ramp difficulty (Time Attack).
  nextPuzzle: (ctx: { solved: number }) => Promise<PuzzleDraw | null>;
  // How the session ends.
  mode: PuzzleMode;
  // Fired once per puzzle when it's finished (solved or failed).
  onResult?: (r: PuzzleResult) => void;
  onExit: () => void;
  // Re-launch the same session from the results screen ("Play again").
  onPlayAgain?: () => void;
  // Small muted label above the board (e.g. the opening name, or "Mixed").
  modeLabel?: string;
  // Skip puzzles seen recently (default true); a retry session turns this off so
  // the missed puzzles are deliberately repeated.
  dedup?: boolean;
}

// One finished puzzle, kept for the end-of-session review list.
interface SessionEntry {
  draw: PuzzleDraw;
  clean: boolean;   // solved first try, no hint
  points?: number;  // rated mode: the rating change this puzzle earned (+/-)
}

export function startPuzzleSession(opts: PuzzleSessionOptions): void {
  const chess = new Chess();
  let cg: Api;
  let isCleaned = false;
  let autoTimer: ReturnType<typeof setTimeout> | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  const timed = opts.mode.kind === 'timed';
  const rated = opts.mode.kind === 'count' && opts.mode.rated === true;
  const dedup = opts.dedup !== false;

  // Per-puzzle state.
  let draw: PuzzleDraw | null = null;
  let solution: string[] = [];
  let solIndex = 1;             // next solution move the solver owes (1, 3, 5…)
  let solverColour: 'white' | 'black' = 'white';
  let failedThisPuzzle = false; // a wrong move or hint was used on this puzzle
  let inputLocked = true;       // board frozen during loads / animations
  let sessionOver = false;      // results shown — back exits without confirming

  // Session tallies.
  let completed = 0;           // puzzles finished so far
  let solvedCount = 0;         // clean solves
  let mistakes = 0;            // timed: wrong puzzles (capped by maxMistakes)
  const missed: PuzzleDraw[] = [];
  const entries: SessionEntry[] = [];
  let deadline = 0;            // timed mode: epoch ms when the clock hits 0

  // Rating (rated count mode only). We evolve a live rating across the run and
  // bank it after every puzzle, so an early exit still keeps what was earned.
  const ratingBefore = getPuzzleRating();
  let liveRating = ratingBefore;

  // ── Overlay scaffold (mirrors drill.ts) ──────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'pt-overlay pt-overlay--puzzle';

  const headerEl = document.createElement('div');
  headerEl.className = 'pt-header';
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'pt-back-btn';
  backBtn.appendChild(Icons.back(15));
  backBtn.appendChild(document.createTextNode('End session'));
  backBtn.addEventListener('click', () => exitViaButton());
  headerEl.appendChild(backBtn);

  const scoreEl = document.createElement('div');
  scoreEl.className = 'pt-timed-score';
  if (timed) headerEl.appendChild(scoreEl);

  // Time Attack HUD: the countdown and a 3-dot mistake tracker, centred above the
  // mode title (built into .pt-top below).
  const timerEl = document.createElement('div');
  const mistakesEl = document.createElement('div');
  const mistakeDots: HTMLElement[] = [];
  if (timed && opts.mode.kind === 'timed') {
    timerEl.className = 'pt-timer';
    mistakesEl.className = 'pt-mistakes';
    mistakesEl.setAttribute('aria-label', 'Mistakes');
    for (let i = 0; i < opts.mode.maxMistakes; i++) {
      const dot = document.createElement('span');
      dot.className = 'pt-mistake-dot';
      mistakeDots.push(dot);
      mistakesEl.appendChild(dot);
    }
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
  // Time Attack: clock + mistake dots sit centred at the top of the block, above
  // the mode title (the block bottom-aligns, so this row floats just above it).
  if (timed) {
    const hud = document.createElement('div');
    hud.className = 'pt-timed-hud';
    hud.appendChild(timerEl);
    hud.appendChild(mistakesEl);
    topEl.appendChild(hud);
  }
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

  // Count mode: a Hint button (reveals the arrow) and a Next button (the puzzle
  // never auto-advances — you tap when ready).
  const hintBtn = document.createElement('button');
  hintBtn.type = 'button';
  hintBtn.className = 'pz-hint-btn';
  hintBtn.appendChild(Icons.bulb(16));
  hintBtn.appendChild(document.createTextNode('Hint'));
  hintBtn.hidden = true;
  hintBtn.addEventListener('click', () => useHint());

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'btn-primary pz-next-btn';
  nextBtn.textContent = 'Next puzzle';
  nextBtn.hidden = true;
  nextBtn.addEventListener('click', () => onNextTap());

  bottomEl.appendChild(statusEl);
  bottomEl.appendChild(themesEl);
  if (!timed) bottomEl.appendChild(hintBtn);
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

  // Leaving mid-session asks first; once the results screen is up the session is
  // already over, so back just exits. Mirrors drill.ts's abandon guard, including
  // re-arming the back-nav layer when the user decides to stay after a back gesture.
  function showAbandonDialog(onStay: () => void): void {
    showDialog({
      title: 'End this session?',
      body: 'Your progress so far is kept.',
      buttons: [
        { label: 'End session', variant: 'danger', onClick: doExit },
        { label: 'Keep going', variant: 'secondary', onClick: onStay },
      ],
      onDismiss: onStay,
    });
  }
  function exitViaButton(): void {
    if (sessionOver) doExit();
    else showAbandonDialog(() => {});
  }
  function exitViaBackGesture(): void {
    if (sessionOver) { doExit(); return; }
    showAbandonDialog(() => { removeBack = pushBack(exitViaBackGesture); });
  }
  let removeBack = pushBack(exitViaBackGesture);

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
    hintBtn.hidden = true;
    cg.set({ movable: { color: undefined, dests: new Map() } });
  }
  function handToSolver(): void {
    inputLocked = false;
    if (!timed) hintBtn.hidden = false;
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
  function renderMistakes(): void {
    for (let i = 0; i < mistakeDots.length; i++) {
      mistakeDots[i].classList.toggle('pt-mistake-dot--miss', i < mistakes);
    }
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
    nextBtn.hidden = true;
    cg.setAutoShapes([]);
    renderSessionBar();

    // Skip puzzles whose data won't replay, and (unless retrying) puzzles seen
    // recently. Give up after a few misses so a backend hiccup can't spin forever.
    let setup = null;
    for (let tries = 0; tries < 6 && !isCleaned; tries++) {
      const d = await opts.nextPuzzle({ solved: solvedCount });
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
    failedThisPuzzle = false;

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
      // Refresh chessground's cached bounds after the layout has settled, so drags
      // register from the right place even if anything nudged the board.
      requestAnimationFrame(() => { if (!isCleaned) cg.redrawAll(); });
    }, 360);
  }

  // Show the arrow for the move the solver currently owes (used by the Hint
  // button, and re-shown after a wrong move while a hint is active).
  function showArrow(): void {
    const expected = solution[solIndex];
    if (!expected) return;
    const { from, to } = uciParts(expected);
    requestAnimationFrame(() => {
      if (isCleaned) return;
      cg.setAutoShapes([{ orig: from, dest: to, brush: 'accent' }]);
    });
  }

  function useHint(): void {
    if (inputLocked) return;
    failedThisPuzzle = true; // a hinted solve earns no points
    hintBtn.hidden = true;
    showArrow();
    setStatus('Hint — play the highlighted move', 'pt-status--reveal');
  }

  function onUserMove(from: Key, to: Key): void {
    if (inputLocked) return;
    const expected = solution[solIndex];
    if (!expected) return;
    const { from: eFrom, to: eTo } = uciParts(expected);

    if (from === eFrom && to === eTo) {
      // Correct.
      cg.setAutoShapes([]);
      playFeedback('correct');
      playMove(expected);
      solIndex++;
      advance();
      return;
    }

    // Wrong move.
    failedThisPuzzle = true;
    flashError();
    if (timed) {
      // No reveal — count it missed and jump straight to the next puzzle.
      cg.set({ fen: chess.fen(), turnColor: cgTurn(), movable: { color: undefined, dests: new Map() } });
      finish();
      return;
    }
    // Count mode: snap the piece back and let them try again (the Hint button is
    // there if they're stuck). If a hint is already showing, keep the arrow up.
    setStatus('Not quite — try again', 'pt-status--error');
    cg.set({ fen: chess.fen(), turnColor: cgTurn(), movable: { color: solverColour, dests: legalDests() } });
    if (cg.state.drawable.autoShapes.length) showArrow();
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

  // Finish the current puzzle: record it, update tallies and rating, then advance
  // the session (next puzzle, or the results screen when the session is over).
  function finish(): void {
    lockBoard();
    cg.setAutoShapes([]);
    completed++;
    const cur = draw!;
    const clean = !failedThisPuzzle;
    if (clean) solvedCount++; else missed.push(cur);
    renderScore();
    opts.onResult?.({ puzzle: cur.puzzle, solved: clean, angle: cur.angle });

    // Rating moves only in rated mode, and only a clean solve scores. Record the
    // per-puzzle change and bank it immediately so an early exit keeps it.
    let points: number | undefined;
    if (rated) {
      const updated = nextRating(liveRating, cur.puzzle.rating, clean);
      points = updated - liveRating;
      liveRating = updated;
      commitRating(liveRating);
    }
    entries.push({ draw: cur, clean, points });

    if (timed) {
      if (!clean) { mistakes++; renderMistakes(); }
      // End on the third mistake or when the clock is up; otherwise keep going.
      const maxMistakes = opts.mode.kind === 'timed' ? opts.mode.maxMistakes : 3;
      if (mistakes >= maxMistakes || Date.now() >= deadline) {
        autoTimer = setTimeout(() => { if (!isCleaned) showResults(); }, clean ? 300 : 700);
        return;
      }
      autoTimer = setTimeout(() => { if (!isCleaned && Date.now() < deadline) void loadNext(); }, 420);
      return;
    }

    // Count mode: show the outcome and wait for a tap (no auto-advance).
    const total = opts.mode.kind === 'count' ? opts.mode.count : 0;
    renderSessionBar();
    if (cur.puzzle.themes.length) {
      themesEl.textContent = cur.puzzle.themes.map(prettyTheme).join(' · ');
      themesEl.hidden = false;
    }
    if (clean) {
      setStatus('Solved!', 'pt-status--success');
      burstConfetti(boardWrap);
    } else {
      setStatus('Got it — no points this time', 'pt-status--reveal');
    }
    nextBtn.textContent = completed >= total ? 'See results' : 'Next puzzle';
    nextBtn.hidden = false;
  }

  // The Next/See-results button in count mode.
  function onNextTap(): void {
    const total = opts.mode.kind === 'count' ? opts.mode.count : 0;
    nextBtn.hidden = true;
    if (completed >= total) showResults();
    else void loadNext();
  }

  // ── Results screen ──────────────────────────────────────────────────────────
  let resultsShown = false;
  function showResults(): void {
    if (resultsShown || isCleaned) return; // the clock and finish() can both reach here
    resultsShown = true;
    sessionOver = true;
    stopTimer();
    if (autoTimer) clearTimeout(autoTimer);
    lockBoard();
    cg.setAutoShapes([]);

    // Swap the overlay's body for a summary panel (reusing the train look). The
    // panel fills the space below the header as a flex column: a fixed head, a
    // scrollable list, and fixed actions — so it fits without the page scrolling.
    boardWrap.remove();
    bottomEl.remove();
    topEl.remove();
    sessionBarEl.remove();

    const wrap = document.createElement('div');
    wrap.className = 'train-completion train-completion--enter pz-results';

    const head = document.createElement('div');
    head.className = 'pz-results-head';
    wrap.appendChild(head);

    head.appendChild(celebratePawn());
    burstConfetti(wrap);

    const done = document.createElement('div');
    done.className = 'train-completion-done';
    done.textContent = 'Session complete ✓';
    head.appendChild(done);

    const sub = document.createElement('div');
    sub.className = 'train-completion-name';
    sub.textContent = `${solvedCount}/${completed} solved clean${timed ? ' against the clock' : ''}`;
    head.appendChild(sub);

    // Rated: the rating delta + the new total, animated up from the old rating.
    if (rated) {
      const delta = liveRating - ratingBefore;
      const card = document.createElement('div');
      card.className = 'pz-rating-result';
      const deltaEl = document.createElement('div');
      deltaEl.className = 'pz-rating-delta ' + (delta >= 0 ? 'pz-rating-delta--up' : 'pz-rating-delta--down');
      deltaEl.textContent = `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}`;
      card.appendChild(deltaEl);
      const totalEl = document.createElement('div');
      totalEl.className = 'pz-rating-total';
      totalEl.textContent = String(ratingBefore);
      card.appendChild(totalEl);
      const lbl = document.createElement('div');
      lbl.className = 'pz-rating-label';
      lbl.textContent = 'puzzle rating';
      card.appendChild(lbl);
      head.appendChild(card);
      // Let the panel settle, then tick the total up to its new value.
      setTimeout(() => { if (!isCleaned) countUp(totalEl, liveRating, { from: ratingBefore, durationMs: 950 }); }, 320);
    }

    // Per-puzzle review list: green for clean, red for missed/hinted. Scrolls
    // inside its own area, with a bottom fade to hint there's more.
    if (entries.length) {
      const listWrap = document.createElement('div');
      listWrap.className = 'pz-results-list-wrap';
      const list = document.createElement('div');
      list.className = 'pz-results-list';
      for (const e of entries) list.appendChild(resultRow(e));
      listWrap.appendChild(list);
      const fade = document.createElement('div');
      fade.className = 'pz-results-fade';
      fade.setAttribute('aria-hidden', 'true');
      listWrap.appendChild(fade);
      wrap.appendChild(listWrap);
    }

    // Actions, matching the training success screen: a green primary + white
    // secondaries, all full width.
    const actions = document.createElement('div');
    actions.className = 'pz-results-actions';

    if (opts.onPlayAgain) {
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'btn-primary train-next-btn';
      again.textContent = 'Play again';
      again.addEventListener('click', () => { const fn = opts.onPlayAgain!; cleanup(); fn(); });
      actions.appendChild(again);
    }

    if (missed.length > 0) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn-secondary train-done-btn';
      retry.textContent = `Retry mistakes (${missed.length})`;
      retry.addEventListener('click', () => retryMistakes(missed.slice()));
      actions.appendChild(retry);
    }

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    // Without a "Play again" there's no green action, so promote Done.
    doneBtn.className = opts.onPlayAgain ? 'btn-secondary train-done-btn' : 'btn-primary train-next-btn';
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', () => doExit());
    actions.appendChild(doneBtn);

    wrap.appendChild(actions);
    overlay.appendChild(wrap);
  }

  // One row in the review list: outcome edge + opening name + theme/rating meta.
  function resultRow(e: SessionEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'pz-result-row ' + (e.clean ? 'pz-result-row--solved' : 'pz-result-row--missed');

    const dot = document.createElement('span');
    dot.className = 'pz-result-dot';
    dot.textContent = e.clean ? '✓' : '✕';
    row.appendChild(dot);

    // Rated runs: the points this puzzle won or lost, right next to the outcome.
    if (e.points !== undefined) {
      const pts = document.createElement('span');
      pts.className = 'pz-result-points ' + (e.points >= 0 ? 'pz-result-points--up' : 'pz-result-points--down');
      pts.textContent = `${e.points >= 0 ? '+' : '−'}${Math.abs(e.points)}`;
      row.appendChild(pts);
    }

    const main = document.createElement('div');
    main.className = 'pz-result-main';
    const name = document.createElement('div');
    name.className = 'pz-result-name';
    name.textContent = e.draw.family ?? prettyAngle(e.draw.angle);
    main.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'pz-result-meta';
    const theme = e.draw.puzzle.themes.length ? prettyTheme(e.draw.puzzle.themes[0]) : 'Tactic';
    meta.textContent = theme;
    main.appendChild(meta);
    row.appendChild(main);

    const rating = document.createElement('span');
    rating.className = 'pz-result-rating';
    rating.textContent = String(e.draw.puzzle.rating);
    row.appendChild(rating);

    return row;
  }

  // Replay the missed puzzles as a fresh count session (de-dup off so they repeat).
  // Always unrated — a retry shouldn't move the ladder.
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
  renderMistakes();
  if (timed) startTimer();
  void loadNext();
}

// "mateIn2" → "Mate in 2", "kingsideAttack" → "Kingside attack".
function prettyTheme(theme: string): string {
  const spaced = theme.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// "Sicilian_Defense" → "Sicilian Defense"; null → "Mixed".
function prettyAngle(angle: string | null): string {
  if (!angle) return 'Mixed';
  return angle.replace(/_/g, ' ');
}
