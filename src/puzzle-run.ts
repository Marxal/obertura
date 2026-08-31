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
import { registerBrushes, HINT_COLOR } from './board-brushes';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { Icons } from './icons';
import { playFeedback } from './sound';
import { pushBack } from './back-nav';
import { buildRunHeader } from './run-header';
import { burstConfetti, celebratePawn } from './confetti';
import { puzzleSetup, type Puzzle } from './puzzles';
import { checkPuzzleAlternate, isPromotionMove } from './puzzle-alt';
import { resolveUci } from './engine';
import { formatMove } from './notation';
import { showDialog } from './dialog';
import { wasRecentlySeen, recordSeenPuzzle } from './puzzle-log';
import {
  getPuzzleRating, rateSolve, commitRating, recordCleanResult,
  parSolveMs, speedFactor, type RatingScope,
} from './puzzle-rating';
import { getShowPuzzleClock, setShowPuzzleClock } from './prefs';
import { countUp } from './count-up';

// One puzzle plus the opening it was drawn for (so stats and retry know its
// angle even in a Mixed session). `family` is a friendly display name for the
// results list.
export interface PuzzleDraw {
  puzzle: Puzzle;
  angle: string | null;
  family?: string;
  // A deliberate repeat from the review queue: it bypasses the recently-seen
  // dedup (we want it back) and never moves the rating (re-seeing a known puzzle
  // mustn't inflate the ladder).
  repeat?: boolean;
}

export type PuzzleMode =
  | { kind: 'count'; count: number; rated?: boolean }
  | { kind: 'timed'; ms: number; maxMistakes: number };

export interface PuzzleResult {
  puzzle: Puzzle;
  solved: boolean; // true only when finished clean (no wrong move, no hint)
  angle: string | null;
  family?: string; // friendly opening name, for the repeat queue
}

// What "Analyse position" hands the app: the puzzle's game + solution as a UCI
// list for the analyser board, the position the solver faced (to open at, with
// the engine on), and the resume/discard hooks for the suspended session —
// the same shape as the mistake drill's OpenGameCtx hand-off.
export interface AnalyseRequest {
  ucis: string[];
  colour: 'white' | 'black';
  atFen: string;
  label: string;
  onReturn: () => void;
  onDiscard: () => void;
}

export interface PuzzleSessionOptions {
  // Draw the next puzzle to present, or null when none is available. Receives the
  // running solved count so the caller can ramp difficulty (Time Attack).
  nextPuzzle: (ctx: { solved: number }) => Promise<PuzzleDraw | null>;
  // Open the finished puzzle in the full analyser (engine on). When set, a
  // discrete "Analyse position" appears under Next once a puzzle is done.
  onAnalysePosition?: (req: AnalyseRequest) => void;
  // How the session ends.
  mode: PuzzleMode;
  // Fired once per puzzle when it's finished (solved or failed).
  onResult?: (r: PuzzleResult) => void;
  // Fired once when the session ends (results screen), with the final tally.
  onComplete?: (summary: { solved: number; completed: number; timed: boolean }) => void;
  onExit: () => void;
  // Re-launch the same session from the results screen ("Play again").
  onPlayAgain?: () => void;
  // Small muted label above the board (e.g. the opening name, or "Mixed").
  modeLabel?: string;
  /**
   * The session's framing, shown above the exercise's name in the run header —
   * "Daily challenge", "Your games mix". Context, not identity.
   */
  contextLabel?: string;
  // Skip puzzles seen recently (default true); a retry session turns this off so
  // the missed puzzles are deliberately repeated.
  dedup?: boolean;
  // Daily challenge: an extra leading primary on the results screen that chains
  // straight into the next part of the challenge ("Next challenge →").
  nextAction?: { label: string; run: () => void };
  // Which rating ladder a rated session moves. Defaults to the openings puzzle
  // rating; the End game trainer passes 'endgame' so its rated runs keep a
  // separate ladder (and never disturb the openings one).
  ratingScope?: RatingScope;
}

// One finished puzzle, kept for the end-of-session review list.
interface SessionEntry {
  draw: PuzzleDraw;
  clean: boolean;   // solved first try, no hint
  points?: number;  // rated mode: the rating change this puzzle earned (+/-)
  bonus?: number;   // …of which this much was the speed bonus (absent when none)
  alt?: boolean;    // finished with a verified alternative, not the puzzle's move
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
  let solIndex = 0;             // next solution move the solver owes (0, 2, 4…)
  let solverColour: 'white' | 'black' = 'white';
  let failedThisPuzzle = false; // a wrong move or hint was used on this puzzle
  let hintStage = 0;            // 0 none, 1 piece highlighted, 2 arrow shown
  let inputLocked = true;       // board frozen during loads / animations
  let sessionOver = false;      // results shown — back exits without confirming
  // Alternate-move check (puzzle-alt.ts): true while the engine is deciding
  // whether a non-solution move is just as good, and — once one is accepted —
  // the puzzle's own move in SAN, for the "different way" message.
  let checkingAlt = false;
  let altSolve = false;
  let altOfficialSan: string | null = null;

  // Session tallies.
  let completed = 0;           // puzzles finished so far
  let solvedCount = 0;         // clean solves
  let mistakes = 0;            // timed: wrong puzzles (capped by maxMistakes)
  const missed: PuzzleDraw[] = [];
  const entries: SessionEntry[] = [];
  let deadline = 0;            // timed mode: epoch ms when the clock hits 0

  // Rating (rated count mode only). We evolve a live rating across the run and
  // bank it after every puzzle, so an early exit still keeps what was earned.
  const ratingScope: RatingScope = opts.ratingScope ?? 'openings';
  const ratingBefore = getPuzzleRating(ratingScope);
  let liveRating = ratingBefore;
  // The clean-solve best run, if it improved during this rated session (shown once
  // on the results screen).
  let newBestStreak: number | null = null;

  // ── The solve clock (rated count mode only) ─────────────────────────────────
  //
  // YOUR THINKING TIME, not wall time: the clock runs only while the board is
  // actually yours, so the opening animation, the opponent's scripted replies
  // and the alternative-move check are all free. Anything else would charge you
  // for the app's own pauses, which is the quickest way to make a speed bonus
  // feel rigged.
  const timing = rated;
  let thinkMs = 0;            // banked thinking time on the current puzzle
  let thinkFrom = 0;          // epoch ms the board was handed over (0 = not yours)
  let parMs = 0;              // what this puzzle is "supposed" to take
  let earning = false;        // is a bonus still on the table for this puzzle?
  let speedTick: ReturnType<typeof setInterval> | undefined;

  // ── Overlay scaffold (mirrors drill.ts) ──────────────────────────────────────
  const overlay = document.createElement('div');
  // .pz-run is this runner's own hook — it carries no styles on a phone, and at
  // desktop width it selects the two-column layout in style.css. It can't hang
  // off .pt-overlay--puzzle: the mistake and brilliant runners share that class
  // and keep the phone layout at every width.
  overlay.className = 'pt-overlay pt-overlay--puzzle pt-overlay--tinted pz-run';
  // The Puzzles mode's bronze, as a whisper behind the whole exercise — the
  // same hue as its Train tab, so the mode reads consistently.
  overlay.style.setProperty('--pt-tint', '#8a5a20');

  const header = buildRunHeader({
    icon: timed ? Icons.clock(18) : Icons.puzzlePiece(18),
    title: opts.modeLabel ?? (timed ? 'Time attack' : 'Puzzles'),
    kicker: opts.contextLabel,
    onEnd: () => exitViaButton(),
  });
  const headerEl = header.el;

  const scoreEl = document.createElement('div');
  scoreEl.className = 'pt-timed-score';
  if (timed) header.extras.appendChild(scoreEl);

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
  // No mode title here: the run header says which exercise this is (see
  // run-header.ts), and saying it twice cost the block a line it needs for the
  // rating and the themes.
  // ── The HUD (rated runs) ───────────────────────────────────────────────────
  //
  // One block, two states. WHILE SOLVING it is just the clock — a time and a
  // bar, nothing else, because there is nothing to report yet; a rating sitting
  // there unearned reads as a promise rather than a fact. ONCE THE PUZZLE IS
  // OVER the clock gives way to the result: your rating and what this puzzle
  // was worth, side by side, because "+6" only means something next to the
  // number it just changed.
  const hudEl = document.createElement('div');
  const hudRatingEl = document.createElement('span');
  const hudPointsEl = document.createElement('span');
  const pointsGroup = document.createElement('div');
  const hudClockEl = document.createElement('div');
  const hudTimeEl = document.createElement('span');
  const hudFillEl = document.createElement('span');
  const hudClockToggleEl = document.createElement('button');
  if (timing) {
    hudEl.className = 'pz-hud';

    hudClockEl.className = 'pz-hud-clock';
    hudTimeEl.className = 'pz-hud-time';
    hudClockEl.appendChild(hudTimeEl);
    const track = document.createElement('span');
    track.className = 'pz-hud-track';
    hudFillEl.className = 'pz-hud-fill';
    track.appendChild(hudFillEl);
    hudClockEl.appendChild(track);
    hudEl.appendChild(hudClockEl);

    // The result row: hidden while solving (see .pz-hud--done in style.css),
    // shown in its place once the puzzle is over.
    const resultRow = document.createElement('div');
    resultRow.className = 'pz-hud-top';

    const ratingGroup = document.createElement('div');
    ratingGroup.className = 'pz-hud-group';
    const ratingLabel = document.createElement('span');
    ratingLabel.className = 'pz-hud-label';
    ratingLabel.textContent = 'Your rating';
    hudRatingEl.className = 'pz-hud-rating';
    hudRatingEl.textContent = String(ratingBefore);
    ratingGroup.append(ratingLabel, hudRatingEl);
    resultRow.appendChild(ratingGroup);

    // Absent on a repeat from the review queue — nothing was earned or lost, so
    // there is no second number to show beside the rating.
    pointsGroup.className = 'pz-hud-group pz-hud-group--points';
    pointsGroup.hidden = true;
    const pointsLabel = document.createElement('span');
    pointsLabel.className = 'pz-hud-label';
    pointsLabel.textContent = 'Points';
    hudPointsEl.className = 'pz-hud-points';
    pointsGroup.append(pointsLabel, hudPointsEl);
    resultRow.appendChild(pointsGroup);

    hudEl.appendChild(resultRow);

    // Discreet, and a DISPLAY switch only — see getShowPuzzleClock. Some people
    // solve worse with a clock in front of them; they should still be paid for
    // being quick, so this hides the readout and touches nothing else.
    hudClockToggleEl.type = 'button';
    hudClockToggleEl.className = 'pz-hud-toggle';
    hudClockToggleEl.addEventListener('click', () => {
      setShowPuzzleClock(!getShowPuzzleClock());
      syncClockVisibility();
    });
    hudEl.appendChild(hudClockToggleEl);

    topEl.appendChild(hudEl);
  }

  const ratingEl = document.createElement('div');
  ratingEl.className = 'pt-line-name';
  topEl.appendChild(ratingEl);

  // The end-of-puzzle award: what this one was worth, and where it came from.
  const awardEl = document.createElement('div');
  awardEl.className = 'pz-award';
  awardEl.hidden = true;
  topEl.appendChild(awardEl);
  // The puzzle's themes ("explanation") — lives up here, under the rating, so a
  // long theme list can never push the Hint/Next buttons below the fold. This
  // block is content-independent in height (see .pt-overlay--puzzle .pt-top in
  // style.css), so it overflows upward rather than shifting the board or bottom.
  const themesEl = document.createElement('div');
  themesEl.className = 'pz-run-themes';
  themesEl.hidden = true;
  topEl.appendChild(themesEl);

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

  // A quiet "open this one in the full analyser" under Next — count mode only,
  // shown once the puzzle is finished.
  const analyseBtn = document.createElement('button');
  analyseBtn.type = 'button';
  analyseBtn.className = 'pz-analyse-btn';
  analyseBtn.appendChild(Icons.review(15));
  analyseBtn.appendChild(document.createTextNode('Analyse position'));
  analyseBtn.hidden = true;
  analyseBtn.addEventListener('click', () => suspendForAnalysis());

  bottomEl.appendChild(statusEl);
  if (!timed) bottomEl.appendChild(hintBtn);
  bottomEl.appendChild(nextBtn);
  if (!timed && opts.onAnalysePosition) bottomEl.appendChild(analyseBtn);

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
  registerBrushes(cg, { accent: { color: HINT_COLOR, opacity: 0.85, lineWidth: 10 } });
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
    pauseSolveClock();
    cg.set({ movable: { color: undefined, dests: new Map() } });
  }
  function handToSolver(): void {
    inputLocked = false;
    if (!timed) hintBtn.hidden = false;
    startSolveClock();
    cg.set({ turnColor: cgTurn(), movable: { color: solverColour, dests: legalDests() } });
  }

  // ── The solve clock ────────────────────────────────────────────────────────
  function elapsedMs(): number {
    return thinkMs + (thinkFrom ? Date.now() - thinkFrom : 0);
  }
  function startSolveClock(): void {
    if (!timing || thinkFrom) return;
    thinkFrom = Date.now();
    renderSpeed();
    speedTick = setInterval(() => { if (!isCleaned) renderSpeed(); }, 200);
  }
  function pauseSolveClock(): void {
    if (speedTick) { clearInterval(speedTick); speedTick = undefined; }
    if (!thinkFrom) return;
    thinkMs += Date.now() - thinkFrom;
    thinkFrom = 0;
    renderSpeed();
  }

  // The bar drains as the bonus does, so "how much is still on the table" is one
  // glance rather than a number to interpret. Once it is empty it says so and
  // stops being a countdown — nobody needs a clock telling them they are late.
  /**
   * The bonus is gone — a wrong move or a hint means this puzzle scores as a
   * loss, and the clock stops mattering. The BAR goes rather than freezing (a bar
   * that has stopped moving reads as a bug, and one that keeps draining is
   * counting down to a bonus already spent); the time stays, because how long a
   * puzzle took is still worth knowing.
   */
  function dropSpeedBonus(): void {
    if (!timing) return;
    pauseSolveClock();
    earning = false;
    renderSpeed();
  }

  // The clock toggle. Hidden, the readout goes and the button stays as the way
  // back — never both gone, or there'd be no way to bring it back inside a run.
  function syncClockVisibility(): void {
    if (!timing) return;
    const on = getShowPuzzleClock();
    hudEl.classList.toggle('pz-hud--clockless', !on);
    hudClockToggleEl.replaceChildren(on ? Icons.clock(14) : Icons.clockOff(14));
    const label = on ? 'Hide the clock' : 'Show the clock';
    hudClockToggleEl.setAttribute('aria-label', label);
    hudClockToggleEl.title = `${label} — the speed bonus is earned either way`;
  }

  // ── The award ──────────────────────────────────────────────────────────────
  //
  // The points figure lives IN the HUD, right beside your rating — "+6" only
  // means something next to the number it just changed, and stacking them
  // as two separate blocks was the reason they read as unrelated.
  //
  // WHY THE BREAKDOWN IS STILL AN ANIMATION. "+6 points ⚡+6 fast" used to sit
  // there as two facts side by side, and nobody could tell whether the bolt was
  // part of the six or on top of it. Addition is a thing that HAPPENS, so it is
  // staged: the solve lands, the bolt arrives beside it, and only then does the
  // points figure count up from the base to the sum — and your rating, which
  // has been on screen since the reveal, ticks with it.
  //
  // Three beats via one class and CSS transition-delays, plus a single timer for
  // the two counting numbers. Reduced motion gets the final state at once.
  const AWARD_BEAT_MS = 240;
  let awardTimer: ReturnType<typeof setTimeout> | undefined;

  function awardChip(text: string, kind: 'base' | 'bonus'): HTMLElement {
    const el = document.createElement('span');
    el.className = `pz-award-part pz-award-part--${kind}`;
    if (kind === 'bonus') el.appendChild(Icons.zap(12));
    el.appendChild(document.createTextNode(text));
    return el;
  }

  function renderAward(before: number, points: number, bonus: number): void {
    if (awardTimer) { clearTimeout(awardTimer); awardTimer = undefined; }
    awardEl.replaceChildren();
    awardEl.hidden = true;
    awardEl.classList.remove('pz-award--in', 'pz-award--summed');
    pointsGroup.hidden = false;
    const up = points >= 0;
    const after = before + points;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    hudPointsEl.classList.toggle('pz-hud-points--up', up);
    hudPointsEl.classList.toggle('pz-hud-points--down', !up);

    const base = points - bonus;
    const sign = (n: number): string => (n >= 0 ? '+' : '−') + Math.abs(n);

    // No bonus (a miss, or a solve the clock didn't pay for): there is no sum to
    // break down, so the points figure is the whole story and lands on its own.
    if (bonus <= 0) {
      hudPointsEl.textContent = sign(points);
      settleRating(before, after, reduce);
      return;
    }

    awardEl.hidden = false;
    const sum = document.createElement('div');
    sum.className = 'pz-award-sum';
    sum.appendChild(awardChip(`${sign(base)} solved`, 'base'));
    const plus = document.createElement('span');
    plus.className = 'pz-award-plus';
    plus.textContent = '+';
    sum.appendChild(plus);
    sum.appendChild(awardChip(`+${bonus} fast`, 'bonus'));
    awardEl.appendChild(sum);

    hudPointsEl.textContent = sign(base);
    show(reduce);
    if (reduce) {
      hudPointsEl.textContent = sign(points);
      settleRating(before, after, true);
      return;
    }
    // Beat three: the parts add up. The points figure counts on from the base
    // rather than from zero — the point being made is "and this much MORE".
    awardTimer = setTimeout(() => {
      if (isCleaned) return;
      awardEl.classList.add('pz-award--summed');
      countSigned(hudPointsEl, base, points, 420);
      settleRating(before, after, false);
    }, AWARD_BEAT_MS * 2);
  }

  /**
   * countUp for a SIGNED total. count-up.ts writes a bare number, and "6"
   * appearing where "+6" was is a different claim — so this one keeps the sign
   * on every frame.
   */
  function countSigned(el: HTMLElement, from: number, to: number, ms: number): void {
    const write = (n: number): void => {
      el.textContent = (n >= 0 ? '+' : '−') + Math.abs(n);
    };
    const started = performance.now();
    const step = (now: number): void => {
      if (isCleaned) return;
      const t = Math.min(1, (now - started) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      write(Math.round(from + (to - from) * eased));
      if (t < 1) requestAnimationFrame(step);
      else write(to);
    };
    requestAnimationFrame(step);
  }

  function show(reduce: boolean): void {
    if (reduce) { awardEl.classList.add('pz-award--in', 'pz-award--summed'); return; }
    requestAnimationFrame(() => { if (!isCleaned) awardEl.classList.add('pz-award--in'); });
  }

  /** Your rating, moving — the one presentation of a rating change anybody reads. */
  function settleRating(before: number, after: number, reduce: boolean): void {
    if (!timing) return;
    hudRatingEl.classList.toggle('pz-hud-rating--up', after > before);
    hudRatingEl.classList.toggle('pz-hud-rating--down', after < before);
    if (reduce || after === before) { hudRatingEl.textContent = String(after); return; }
    countUp(hudRatingEl, after, { from: before, durationMs: 420 });
  }

  function renderSpeed(): void {
    if (!timing) return;
    const ms = elapsedMs();
    const secs = Math.floor(ms / 1000);
    hudTimeEl.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    // No bar on a puzzle that cannot pay — a repeat from the review queue, or one
    // already spoiled by a wrong move. The clock itself stays, so it never
    // flickers in and out of a run.
    const speed = earning ? speedFactor(ms, parMs) : 0;
    hudFillEl.style.width = `${Math.round(speed * 100)}%`;
    hudClockEl.classList.toggle('pz-hud-clock--spent', speed <= 0);
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
    analyseBtn.hidden = true;
    cg.setAutoShapes([]);
    renderSessionBar();

    // Skip puzzles whose data won't replay, and (unless retrying) puzzles seen
    // recently. Give up after a few misses so a backend hiccup can't spin forever.
    let setup = null;
    for (let tries = 0; tries < 10 && !isCleaned; tries++) {
      const d = await opts.nextPuzzle({ solved: solvedCount });
      if (isCleaned) return;
      if (!d) break;
      // A queued repeat is meant to come back, so it skips the dedup check.
      if (dedup && !d.repeat && wasRecentlySeen(d.puzzle.id)) continue;
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
    // Par is per-puzzle: how many moves you have to find, and how hard it is.
    // A repeat from the review queue never scores, so it never shows a clock —
    // a bonus bar over a puzzle that cannot pay is a lie with a progress bar on it.
    thinkMs = 0;
    thinkFrom = 0;
    parMs = parSolveMs(draw.puzzle.rating, Math.ceil(setup.solution.length / 2));
    // A repeat from the review queue never moves the rating, so there is nothing
    // to earn on it — the clock runs, the bar doesn't.
    earning = !draw.repeat;
    if (timing) {
      hudEl.hidden = false;
      hudEl.classList.remove('pz-hud--done');
      hudRatingEl.classList.remove('pz-hud-rating--up', 'pz-hud-rating--down');
      pointsGroup.hidden = true;
      hudPointsEl.classList.remove('pz-hud-points--up', 'pz-hud-points--down');
      hudPointsEl.textContent = '';
      if (awardTimer) { clearTimeout(awardTimer); awardTimer = undefined; }
      awardEl.hidden = true;
      awardEl.classList.remove('pz-award--in', 'pz-award--summed');
      awardEl.replaceChildren();
      hudRatingEl.textContent = String(liveRating);
      syncClockVisibility();
      renderSpeed();
    }
    solverColour = setup.solverColour;
    solIndex = 0;            // the solver plays solution[0] first
    failedThisPuzzle = false;
    hintStage = 0;
    checkingAlt = false;
    altSolve = false;
    altOfficialSan = null;
    hintBtn.replaceChildren(Icons.bulb(16), document.createTextNode('Hint'));

    chess.load(setup.fen);
    cg.set({
      fen: setup.fen,
      orientation: solverColour,
      turnColor: cgTurn(),
      lastMove: undefined,
      movable: { color: undefined, dests: new Map() },
    });
    // In Time Attack the rating shows right away — that's the whole point, you're
    // meant to track the difficulty ramp as you go. Count modes still hide it until
    // the puzzle is solved (see finish()), since the reveal is part of the payoff.
    if (timed) {
      ratingEl.className = 'pt-line-name pt-rating--solved';
      ratingEl.textContent = `Rating ${draw.puzzle.rating}`;
    } else {
      ratingEl.textContent = '';
      ratingEl.className = 'pt-line-name';
    }

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

  // First hint tap: just highlight the piece that needs to move. Second tap
  // (button now reads "Show solution"): reveal the full arrow.
  function showPieceHighlight(): void {
    const expected = solution[solIndex];
    if (!expected) return;
    const { from } = uciParts(expected);
    requestAnimationFrame(() => {
      if (isCleaned) return;
      cg.setAutoShapes([{ orig: from, brush: 'accent' }]);
    });
  }

  function useHint(): void {
    if (inputLocked) return;
    failedThisPuzzle = true; // a hinted solve earns no points
    dropSpeedBonus();
    if (hintStage === 0) {
      hintStage = 1;
      showPieceHighlight();
      hintBtn.replaceChildren(Icons.eye(16), document.createTextNode('Show solution'));
      setStatus('Hint — move the highlighted piece', 'pt-status--reveal');
    } else {
      hintStage = 2;
      hintBtn.hidden = true;
      showArrow();
      setStatus('Hint — play the highlighted move', 'pt-status--reveal');
    }
  }

  function onUserMove(from: Key, to: Key): void {
    if (inputLocked || checkingAlt) return;
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

    // Not the puzzle's move — but plenty of positions have a second move that's
    // just as good (an equally fast mate, or another move that doesn't blunder).
    // Ask the local engine before calling it a mistake. Once per puzzle only, and
    // never once they've already slipped or taken a hint: the check costs a
    // search, and after a miss the puzzle is unclean anyway.
    const preFen = chess.fen();
    if (!failedThisPuzzle && hintStage === 0 && !isPromotionMove(preFen, from, to)) {
      void tryAlternate(from, to, expected, preFen);
      return;
    }
    registerWrong();
  }

  // The wrong-move outcome — also the fallback whenever the alternate check can't
  // verify a move, so an unverifiable move behaves exactly as it always did.
  function registerWrong(): void {
    failedThisPuzzle = true;
    dropSpeedBonus();
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
    if (hintStage < 2) hintBtn.hidden = false;
    if (hintStage === 1) showPieceHighlight();
    else if (hintStage === 2) showArrow();
  }

  // ── Alternate-move check ────────────────────────────────────────────────────
  // Mirrors drill.ts's checkAlternative: freeze the board while the engine
  // decides, then either accept the move or fall through to the normal wrong-move
  // path. The piece is left where it was dropped during the wait — if it's
  // accepted it's already home, and a rejection snaps it back with the usual flash.
  async function tryAlternate(from: Key, to: Key, expected: string, preFen: string): Promise<void> {
    checkingAlt = true;
    const startedAt = Date.now();
    lockBoard();
    setStatus('Checking that move…', 'pt-status--alt');

    let ok = false;
    try {
      ok = await checkPuzzleAlternate({
        fen: preFen,
        userUci: from + to,
        officialUci: expected,
        themes: draw?.puzzle.themes ?? [],
      });
    } catch {
      ok = false;
    }
    if (isCleaned) return;
    checkingAlt = false;
    // Time Attack runs on a wall clock: give back whatever the check just cost.
    if (timed) deadline += Date.now() - startedAt;

    if (ok) { acceptAlternate(from, to, expected, preFen); return; }
    inputLocked = false;
    registerWrong();
  }

  // A verified alternative ends the puzzle as solved, there and then. The rest of
  // solution[] assumed the puzzle's own move was played — the scripted reply after
  // a different move is usually illegal and always unmotivated — so rather than
  // force the remaining line we stop here and count it. "Analyse position" is
  // right below for anyone who wants to see how the official line finished.
  function acceptAlternate(from: Key, to: Key, expected: string, preFen: string): void {
    cg.setAutoShapes([]);
    playFeedback('correct');
    altSolve = true;
    altOfficialSan = resolveUci(preFen, expected)?.san ?? null;
    try {
      chess.move({ from, to, promotion: 'q' });
    } catch { /* the engine just ranked this move, so it's legal */ }
    cg.set({
      fen: chess.fen(),
      turnColor: cgTurn(),
      lastMove: [from, to],
      movable: { color: undefined, dests: new Map() },
    });
    setAlternateStatus();
    finish();
    // Show the puzzle's own move alongside yours, the way the mistake drill nudges
    // toward the engine's first choice. Drawn after finish(), which clears shapes.
    const { from: eFrom, to: eTo } = uciParts(expected);
    requestAnimationFrame(() => {
      if (!isCleaned) cg.setAutoShapes([{ orig: eFrom, dest: eTo, brush: 'accent' }]);
    });
  }

  // "Good move ✓ — a different way!", with the puzzle's own move underneath.
  function setAlternateStatus(): void {
    setStatus('Good move ✓ — a different way!', 'pt-status--success');
    if (!altOfficialSan) return;
    const line = document.createElement('span');
    line.className = 'pz-alt-official';
    line.textContent = `The puzzle played ${formatMove(altOfficialSan)}`;
    statusEl.appendChild(line);
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
    opts.onResult?.({ puzzle: cur.puzzle, solved: clean, angle: cur.angle, family: cur.family });

    // Rating moves only in rated mode, and only a clean solve scores. A queued
    // repeat never scores (already seen). Record the per-puzzle change and bank it
    // immediately so an early exit keeps it.
    // The clock stopped when finish() locked the board, so this is the thinking
    // time and nothing else. A miss ignores it entirely (see puzzle-rating.ts).
    const speed = clean ? speedFactor(thinkMs, parMs) : 0;
    let points: number | undefined;
    let speedBonus = 0;
    if (rated && !cur.repeat) {
      const change = rateSolve(liveRating, cur.puzzle.rating, clean, speed);
      points = change.points;
      speedBonus = change.bonus;
      liveRating = change.next;
      commitRating(liveRating, ratingScope);
      // Track the clean-solve best run; remember it if it just improved.
      const streak = recordCleanResult(clean, ratingScope);
      if (streak.improved) newBestStreak = streak.best;
    }
    entries.push({ draw: cur, clean, points, bonus: speedBonus || undefined, alt: altSolve });

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

    // Reveal the rating now that the puzzle is over. In the rated Daily Mix we
    // also show how many points the solve won or lost (green up / red down);
    // practice runs just show the puzzle's rating.
    if (rated) {
      // The PUZZLE's rating, quietly — the number that matters is yours, and it
      // is in the HUD above, about to move.
      ratingEl.className = 'pt-line-name pt-rating--solved';
      ratingEl.textContent = `Puzzle ${cur.puzzle.rating}`;
      if (timing) hudEl.classList.add('pz-hud--done');
      if (points !== undefined) renderAward(liveRating - points, points, speedBonus);
    } else {
      ratingEl.className = 'pt-line-name pt-rating--solved';
      ratingEl.textContent = `Rating ${cur.puzzle.rating}`;
    }
    if (clean) {
      // An alternate solve has already said its piece ("a different way!") — don't
      // overwrite it with the plain "Solved!".
      if (!altSolve) setStatus('Solved!', 'pt-status--success');
      burstConfetti(boardWrap);
    } else {
      setStatus('Got it — no points this time', 'pt-status--reveal');
    }
    nextBtn.textContent = completed >= total ? 'See results' : 'Next puzzle';
    nextBtn.hidden = false;
    analyseBtn.hidden = !opts.onAnalysePosition;
  }

  // ── Suspend for the full analyser (mirrors mistake-run's hand-off) ──────────
  // The overlay hides with the session state intact while the analyser opens at
  // the puzzle position with the engine on; "Back to train" resumes right here,
  // navigating anywhere else discards the session cleanly.
  function suspendForAnalysis(): void {
    if (!opts.onAnalysePosition || !draw) return;
    const moves = analyseMovesFor(draw.puzzle);
    if (!moves) return;
    removeBack();
    removeBack = () => {};
    overlay.hidden = true;
    opts.onAnalysePosition({
      ...moves,
      label: `Puzzle · rating ${draw.puzzle.rating}`,
      onReturn: () => {
        if (isCleaned) return;
        overlay.hidden = false;
        removeBack = pushBack(exitViaBackGesture);
        requestAnimationFrame(() => { if (!isCleaned) cg.redrawAll(); });
      },
      onDiscard: () => {
        if (!isCleaned) cleanup();
      },
    });
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
    opts.onComplete?.({ solved: solvedCount, completed, timed });
    stopTimer();
    if (autoTimer) clearTimeout(autoTimer);
    lockBoard();
    cg.setAutoShapes([]);

    // Swap the whole overlay for a summary panel (reusing the train look) — the
    // header bar goes too, so results are chrome-free. The panel is a flex column:
    // a fixed head, a scrollable list, and fixed actions — fits without scrolling.
    headerEl.remove();
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

    // A new best clean-solve run beats everything else for a "well done" — call it
    // out right under the headline.
    if (newBestStreak !== null) {
      const best = document.createElement('div');
      best.className = 'pz-best-streak';
      best.textContent = `New best run — ${newBestStreak} in a row! 🔥`;
      head.appendChild(best);
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
    // secondaries, all full width. With a daily-challenge nextAction, the chain
    // to the next challenge takes the green and everything else steps down.
    const actions = document.createElement('div');
    actions.className = 'pz-results-actions';

    if (opts.nextAction) {
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'btn-primary train-next-btn';
      next.textContent = opts.nextAction.label;
      next.addEventListener('click', () => { const fn = opts.nextAction!.run; cleanup(); fn(); });
      actions.appendChild(next);
    }

    if (opts.onPlayAgain) {
      const again = document.createElement('button');
      again.type = 'button';
      again.className = opts.nextAction ? 'btn-secondary train-done-btn' : 'btn-primary train-next-btn';
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
    // Without any other green action, promote the close.
    doneBtn.className = (opts.onPlayAgain || opts.nextAction) ? 'btn-secondary train-done-btn' : 'btn-primary train-next-btn';
    doneBtn.textContent = 'End session';
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

    // Rated runs: the points this puzzle won or lost, right next to the outcome —
    // with a bolt on the ones where the clock is what paid.
    if (e.points !== undefined) {
      const pts = document.createElement('span');
      pts.className = 'pz-result-points ' + (e.points >= 0 ? 'pz-result-points--up' : 'pz-result-points--down');
      pts.textContent = `${e.points >= 0 ? '+' : '−'}${Math.abs(e.points)}`;
      if (e.bonus) {
        const bolt = Icons.zap(10);
        bolt.classList.add('pz-result-bolt');
        pts.appendChild(bolt);
        pts.title = `${e.points - e.bonus} for the solve, +${e.bonus} for the speed`;
      }
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
    meta.textContent = e.alt ? `${theme} · your own way` : theme;
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
      onAnalysePosition: opts.onAnalysePosition,
    });
  }

  function doExit(): void {
    cleanup();
    opts.onExit();
  }
  function cleanup(): void {
    isCleaned = true;
    if (autoTimer) clearTimeout(autoTimer);
    if (awardTimer) { clearTimeout(awardTimer); awardTimer = undefined; }
    if (speedTick) { clearInterval(speedTick); speedTick = undefined; }
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

// The analyser board's moves for a puzzle: the game up to the position the
// solver faced (the pgn is truncated to end on the opponent's blunder) plus the
// full solution, so the whole tactic is there to step through with the engine.
// Null when the data won't replay (corrupt puzzle) — the button just no-ops.
function analyseMovesFor(puzzle: Puzzle): { ucis: string[]; colour: 'white' | 'black'; atFen: string } | null {
  try {
    const game = new Chess();
    game.loadPgn(puzzle.pgn);
    const history = game.history({ verbose: true });

    const board = new Chess();
    const plies = Math.min(puzzle.initialPly + 1, history.length);
    const ucis: string[] = [];
    for (let i = 0; i < plies; i++) {
      ucis.push(board.move(history[i].san).lan);
    }
    const atFen = board.fen();
    const colour: 'white' | 'black' = board.turn() === 'w' ? 'white' : 'black';
    for (const uci of puzzle.solution) {
      const m = board.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: (uci[4] as 'q' | 'r' | 'b' | 'n') || undefined,
      });
      ucis.push(m.lan);
    }
    return { ucis, colour, atFen };
  } catch {
    return null;
  }
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
