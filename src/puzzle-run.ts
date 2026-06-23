// The puzzle-solving overlay. A close cousin of drill.ts (and it reuses the same
// .pt-* overlay styles), but the loop is different: instead of walking a saved
// line, it loads Lichess puzzles one after another and asks you to find the
// solution. Opponent moves auto-play; you play your moves; a wrong move reveals
// the answer and counts the puzzle as failed, but you still play it out to learn
// the idea. Solve one and the next loads automatically.

import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { Icons } from './icons';
import { playFeedback } from './sound';
import { pushBack } from './back-nav';
import { burstConfetti } from './confetti';
import { puzzleSetup, type Puzzle } from './puzzles';

export interface PuzzleResult {
  puzzle: Puzzle;
  solved: boolean; // true only when finished with no wrong move
  angle: string | null;
}

export interface PuzzleRunOptions {
  // Fetch the next puzzle to present, or null when none is available.
  nextPuzzle: () => Promise<Puzzle | null>;
  // Fired once per puzzle when it's finished (solved or failed).
  onResult?: (r: PuzzleResult) => void;
  onExit: () => void;
  // Small muted label above the board (e.g. the opening name, or "Mixed").
  modeLabel?: string;
  // The angle these puzzles were requested for — passed straight back in results.
  angle?: string | null;
}

export function startPuzzleRun(opts: PuzzleRunOptions): void {
  const chess = new Chess();
  let cg: Api;
  let isCleaned = false;
  let autoTimer: ReturnType<typeof setTimeout> | undefined;

  // Per-puzzle state.
  let puzzle: Puzzle | null = null;
  let solution: string[] = [];
  let solIndex = 1;             // next solution move the solver owes (1, 3, 5…)
  let solverColour: 'white' | 'black' = 'white';
  let failed = false;          // a wrong move was played on this puzzle
  let awaitingReplay = false;  // after a miss, the correct move must be replayed
  let inputLocked = true;      // board frozen during loads / animations
  let solvedCount = 0;

  // ── Overlay scaffold (mirrors drill.ts) ──────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'pt-overlay';

  const headerEl = document.createElement('div');
  headerEl.className = 'pt-header';
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'pt-back-btn';
  backBtn.appendChild(Icons.back(15));
  backBtn.appendChild(document.createTextNode('Done'));
  backBtn.addEventListener('click', () => doExit());
  headerEl.appendChild(backBtn);

  const scoreEl = document.createElement('div');
  scoreEl.className = 'pt-timed-score';
  headerEl.appendChild(scoreEl);

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

  // ── Puzzle lifecycle ──────────────────────────────────────────────────────
  async function loadNext(): Promise<void> {
    lockBoard();
    setStatus('Loading puzzle…', 'pt-status--prompt');
    themesEl.hidden = true;
    cg.setAutoShapes([]);

    // Skip puzzles whose data won't replay; give up after a few misses so a
    // backend hiccup can't spin forever.
    let setup = null;
    for (let tries = 0; tries < 4 && !isCleaned; tries++) {
      const p = await opts.nextPuzzle();
      if (isCleaned) return;
      if (!p) break;
      const s = puzzleSetup(p);
      if (s) { puzzle = p; setup = s; break; }
    }
    if (!setup || !puzzle) {
      setStatus('No more puzzles right now. Check your connection and try again.', 'pt-status--error');
      return;
    }

    solution = setup.solution;
    solverColour = setup.solverColour;
    solIndex = 1;
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
    ratingEl.textContent = `Rating ${puzzle.rating}`;

    // Animate the opponent's setup move (solution[0]), then hand over.
    autoTimer = setTimeout(() => {
      if (isCleaned) return;
      playMove(setup.setupMove);
      setStatus(`${solverColour === 'white' ? 'White' : 'Black'} to play — find the best move`, 'pt-status--prompt');
      handToSolver();
    }, 520);
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
    if (!failed) failed = true;
    flashError();
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

  function finish(): void {
    lockBoard();
    cg.setAutoShapes([]);
    opts.onResult?.({ puzzle: puzzle!, solved: !failed, angle: opts.angle ?? null });
    if (puzzle!.themes.length) {
      themesEl.textContent = puzzle!.themes.map(prettyTheme).join(' · ');
      themesEl.hidden = false;
    }
    if (failed) {
      setStatus('Solution shown — next time!', 'pt-status--error');
    } else {
      solvedCount++;
      scoreEl.textContent = `✓ ${solvedCount}`;
      setStatus('Solved!', 'pt-status--success');
      burstConfetti(boardWrap);
    }
    // Offer a manual Next, and also auto-advance after a beat so a solver on a
    // roll isn't interrupted.
    nextBtn.hidden = false;
    autoTimer = setTimeout(() => { if (!isCleaned) { nextBtn.hidden = true; void loadNext(); } }, failed ? 2600 : 1500);
  }

  function doExit(): void {
    cleanup();
    opts.onExit();
  }
  function cleanup(): void {
    isCleaned = true;
    if (autoTimer) clearTimeout(autoTimer);
    ro.disconnect();
    overlay.remove();
    removeBack();
  }

  void loadNext();
}

// "mateIn2" → "Mate in 2", "kingsideAttack" → "Kingside attack".
function prettyTheme(theme: string): string {
  const spaced = theme.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
