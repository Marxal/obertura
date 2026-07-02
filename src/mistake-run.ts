// The Mistake Retry drill — a puzzle-style overlay (same .pt-* chrome as
// puzzle-run.ts) over positions from YOUR OWN games where the scan caught a
// mistake. Each spot loads the position as you had it, shows the move you
// actually played as a red arrow, and asks for a better one.
//
// Differences from the puzzle loop, by design:
//   • one move per position (the engine's best, or anything within a whisker
//     of it — checked against the stored top-3 first, live engine as backup),
//   • after answering you can stay and dig: the engine's three continuations
//     are laid out, and "Review game" opens the whole game right there (move
//     strip + board stepping + a small eval readout), with a jump into the
//     full analyser — you tap "Next position" when you're done.
//
// Results are persisted per spot the moment it's answered (recordSpotResult),
// so an abandoned session still counts what it fixed.

import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { Icons, classBoardSvg } from './icons';
import { playFeedback } from './sound';
import { pushBack } from './back-nav';
import { burstConfetti, celebratePawn } from './confetti';
import { showDialog } from './dialog';
import { formatMove } from './notation';
import { isGoodAlternative, analysePosition, cloudTopLines } from './engine';
import type { MoveEval } from './engine';
import { flattenCp } from './winprob';
import { replayGame, recordSpotResult, GOOD_ALT_CP } from './mistake-scan';
import type { SpotRef, MistakeCategory } from './mistake-scan';
import type { ImportedGame } from './import-core';

// Presentation names for the four categories — shared with the pane's cards.
export const CATEGORY_LABEL: Record<MistakeCategory, string> = {
  'opening-blunder': 'Opening blunders',
  'punish-opening': 'Punish the opening',
  'missed-win': 'Missed wins',
  'blunder': 'Blunders',
};

// The story line per category: "You played Qxb2 here and …".
const CATEGORY_PHRASE: Record<MistakeCategory, string> = {
  'opening-blunder': 'blundered the opening',
  'punish-opening': 'let your opponent off the hook',
  'missed-win': 'threw away a winning position',
  'blunder': 'blundered',
};

export interface MistakeSessionOptions {
  refs: SpotRef[];                 // the spots to drill, in order (≤ 5 usually)
  onExit: () => void;
  // Fired once when the results screen comes up.
  onComplete?: (summary: { solved: number; completed: number }) => void;
  onPlayAgain?: () => void;
  // Open this game in the full analyser (ends the session first).
  onOpenGame?: (game: ImportedGame) => void;
  // Daily challenge: the results screen's primary jumps to the next task.
  nextAction?: { label: string; run: () => void };
  modeLabel?: string;              // e.g. a category label or "Daily challenge"
}

interface SessionEntry {
  ref: SpotRef;
  clean: boolean;
}

export function startMistakeSession(opts: MistakeSessionOptions): void {
  if (opts.refs.length === 0) { opts.onExit(); return; }

  const chess = new Chess();
  let cg: Api;
  let isCleaned = false;

  // Per-spot state.
  let index = 0;                     // which ref is on the board
  let current: SpotRef = opts.refs[0];
  let answered = false;              // the better move has been found
  let failedThisSpot = false;        // wrong try or hint used
  let hintStage = 0;                 // 0 none, 1 piece highlighted, 2 arrow
  let inputLocked = true;
  let checkToken = 0;                // invalidates an in-flight live check
  let sessionOver = false;

  // Session tallies.
  let completed = 0;
  let solvedCount = 0;
  const entries: SessionEntry[] = [];

  // ── Overlay scaffold (mirrors puzzle-run.ts) ────────────────────────────────
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

  // "Position X of N" progress bar.
  const sessionBarEl = document.createElement('div');
  sessionBarEl.className = 'pt-session-bar';
  const sessionLabelEl = document.createElement('div');
  sessionLabelEl.className = 'pt-session-bar-label';
  sessionBarEl.appendChild(sessionLabelEl);
  const trackEl = document.createElement('div');
  trackEl.className = 'pt-session-bar-track';
  const sessionFillEl = document.createElement('div');
  sessionFillEl.className = 'pt-session-bar-fill';
  trackEl.appendChild(sessionFillEl);
  sessionBarEl.appendChild(trackEl);

  const topEl = document.createElement('div');
  topEl.className = 'pt-top';
  const modeEl = document.createElement('div');
  modeEl.className = 'pt-mode-title';
  modeEl.textContent = opts.modeLabel ?? 'Mistake retry';
  topEl.appendChild(modeEl);
  const nameEl = document.createElement('div');
  nameEl.className = 'pt-line-name';
  topEl.appendChild(nameEl);
  // The story: "You played Qxb2 here and blundered — find a better move."
  const introEl = document.createElement('div');
  introEl.className = 'mr-intro';
  topEl.appendChild(introEl);

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

  const hintBtn = document.createElement('button');
  hintBtn.type = 'button';
  hintBtn.className = 'pz-hint-btn';
  hintBtn.appendChild(Icons.bulb(16));
  hintBtn.appendChild(document.createTextNode('Hint'));
  hintBtn.hidden = true;
  hintBtn.addEventListener('click', () => useHint());

  // The post-answer block: the engine's continuations + Review game / Next.
  const afterEl = document.createElement('div');
  afterEl.className = 'mr-after';
  afterEl.hidden = true;
  const contsEl = document.createElement('div');
  contsEl.className = 'mr-continuations';
  afterEl.appendChild(contsEl);
  const afterActions = document.createElement('div');
  afterActions.className = 'mr-after-actions';
  const reviewBtn = document.createElement('button');
  reviewBtn.type = 'button';
  reviewBtn.className = 'btn-secondary mr-review-btn';
  reviewBtn.textContent = 'Review game';
  reviewBtn.addEventListener('click', () => enterReview());
  afterActions.appendChild(reviewBtn);
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'btn-primary pz-next-btn';
  nextBtn.textContent = 'Next position';
  nextBtn.addEventListener('click', () => onNextTap());
  afterActions.appendChild(nextBtn);
  afterEl.appendChild(afterActions);

  bottomEl.appendChild(statusEl);
  bottomEl.appendChild(hintBtn);
  bottomEl.appendChild(afterEl);

  // The inline game review block (hidden until "Review game").
  const reviewEl = document.createElement('div');
  reviewEl.className = 'mr-review';
  reviewEl.hidden = true;
  bottomEl.appendChild(reviewEl);

  overlay.appendChild(headerEl);
  if (opts.refs.length >= 2) overlay.appendChild(sessionBarEl);
  overlay.appendChild(topEl);
  overlay.appendChild(boardWrap);
  overlay.appendChild(bottomEl);
  document.body.appendChild(overlay);

  cg = Chessground(boardEl, {
    orientation: 'white',
    movable: { color: undefined, free: false, dests: new Map() },
    draggable: { showGhost: true },
    animation: { enabled: true, duration: 200 },
    events: { move(from, to) { void onUserMove(from as Key, to as Key); } },
  });
  cg.state.drawable.brushes['accent'] = { key: 'accent', color: '#ff9b21', opacity: 0.85, lineWidth: 10 };
  // The played mistake — drawn in the review palette's blunder red.
  cg.state.drawable.brushes['danger'] = { key: 'danger', color: '#c93636', opacity: 0.8, lineWidth: 10 };
  const ro = new ResizeObserver(() => cg.redrawAll());
  ro.observe(boardEl);

  // Abandon guard — mirrors puzzle-run (results screen exits without asking).
  function showAbandonDialog(onStay: () => void): void {
    showDialog({
      title: 'End this session?',
      body: 'Positions you already solved stay fixed.',
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

  // ── Small helpers (same shapes as puzzle-run) ───────────────────────────────
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
    hintBtn.hidden = false;
    cg.set({ turnColor: cgTurn(), movable: { color: current.game.colour, dests: legalDests() } });
  }
  function renderSessionBar(): void {
    const total = opts.refs.length;
    sessionFillEl.style.width = `${Math.min(1, completed / total) * 100}%`;
    sessionLabelEl.textContent = `Position ${Math.min(completed + 1, total)} of ${total}`;
  }

  // All board decorations live in ONE setAutoShapes call — the danger arrow,
  // any hint shape and the solved badge share the single autoshape list, so
  // painting them separately would wipe each other.
  function paintShapes(o: { hint?: 'piece' | 'arrow'; badgeAt?: Key } = {}): void {
    const shapes: DrawShape[] = [];
    if (!answered) {
      const { from, to } = uciParts(current.spot.playedUci);
      shapes.push({ orig: from, dest: to, brush: 'danger' });
    }
    const best = current.spot.best[0];
    if (o.hint === 'piece' && best) {
      shapes.push({ orig: uciParts(best.uci).from, brush: 'accent' });
    } else if (o.hint === 'arrow' && best) {
      const { from, to } = uciParts(best.uci);
      shapes.push({ orig: from, dest: to, brush: 'accent' });
    }
    if (o.badgeAt) {
      shapes.push({ orig: o.badgeAt, customSvg: classBoardSvg('best') });
    }
    requestAnimationFrame(() => { if (!isCleaned) cg.setAutoShapes(shapes); });
  }

  // ── Spot lifecycle ──────────────────────────────────────────────────────────
  function loadSpot(): void {
    current = opts.refs[index];
    answered = false;
    failedThisSpot = false;
    hintStage = 0;
    hintBtn.replaceChildren(Icons.bulb(16), document.createTextNode('Hint'));
    hintBtn.hidden = true;
    afterEl.hidden = true;
    reviewEl.hidden = true;
    reviewEl.innerHTML = '';
    boardWrap.hidden = false;
    renderSessionBar();

    const { game, spot } = current;
    nameEl.textContent = `vs ${game.opponent}` + (game.opening ? ` · ${game.opening}` : '');
    introEl.textContent =
      `You played ${formatMove(spot.playedSan)} here and ${CATEGORY_PHRASE[spot.category]}.`;
    setStatus('Find a better move', 'pt-status--prompt');

    chess.load(spot.preFen);
    cg.set({
      fen: spot.preFen,
      orientation: game.colour,
      turnColor: cgTurn(),
      lastMove: undefined,
      movable: { color: undefined, dests: new Map() },
    });
    paintShapes();
    setTimeout(() => {
      if (isCleaned) return;
      handToSolver();
      requestAnimationFrame(() => { if (!isCleaned) cg.redrawAll(); });
    }, 360);
  }

  function useHint(): void {
    if (inputLocked || answered) return;
    failedThisSpot = true; // a hinted solve isn't a clean fix
    if (hintStage === 0) {
      hintStage = 1;
      paintShapes({ hint: 'piece' });
      hintBtn.replaceChildren(Icons.eye(16), document.createTextNode('Show solution'));
      setStatus('Hint — move the highlighted piece', 'pt-status--reveal');
    } else {
      hintStage = 2;
      hintBtn.hidden = true;
      paintShapes({ hint: 'arrow' });
      setStatus('Hint — play the highlighted move', 'pt-status--reveal');
    }
  }

  // Is `uci4` (from+to) one of the stored top-3 AND within GOOD_ALT_CP of the
  // best? The stored evals are white-perspective; the GAP is perspective-free.
  function storedAlternative(uci4: string): MoveEval | null {
    const best = current.spot.best;
    if (!best.length) return null;
    const bestCp = flattenCp(best[0]);
    if (bestCp === null) return null;
    for (const alt of best.slice(1)) {
      if (alt.uci.slice(0, 4) !== uci4) continue;
      const altCp = flattenCp(alt);
      if (altCp !== null && Math.abs(bestCp - altCp) <= GOOD_ALT_CP) return alt;
    }
    return null;
  }

  // Live fallback for a move outside the stored three: cloud first, then a
  // quick local search. "Good" = within GOOD_ALT_CP of the best move.
  async function liveCheck(uci4: string): Promise<boolean> {
    const { spot } = current;
    if (await isGoodAlternative(spot.preFen, uci4, GOOD_ALT_CP)) return true;
    const evals = await analysePosition(spot.preFen, 10);
    if (!evals.length) return false;
    const bestCp = flattenCp(evals[0]);
    const mine = evals.find(m => m.uci.slice(0, 4) === uci4);
    const mineCp = mine ? flattenCp(mine) : null;
    if (bestCp === null || mineCp === null) return false;
    return Math.abs(bestCp - mineCp) <= GOOD_ALT_CP;
  }

  async function onUserMove(from: Key, to: Key): Promise<void> {
    if (inputLocked || answered) return;
    const { spot } = current;
    const best = spot.best[0];
    if (!best) return;
    const uci4 = `${from}${to}`;

    if (best.uci.slice(0, 4) === uci4) {
      solve(best.uci, 'best');
      return;
    }
    const stored = storedAlternative(uci4);
    if (stored) {
      solve(stored.uci, 'alt');
      return;
    }

    // Not in the stored three — ask the engine before judging. The board locks
    // while the check runs (usually a beat, capped by the engine's own timeout).
    lockBoard();
    hintBtn.hidden = true;
    setStatus('Checking with the engine…', 'pt-status--prompt');
    const myToken = ++checkToken;
    const good = await liveCheck(uci4);
    if (isCleaned || myToken !== checkToken || answered) return;
    if (good) {
      solve(uci4, 'alt');
      return;
    }

    // Wrong — snap back and let them keep looking.
    failedThisSpot = true;
    flashError();
    setStatus('Not quite — try again', 'pt-status--error');
    cg.set({ fen: chess.fen(), turnColor: cgTurn(), movable: { color: current.game.colour, dests: legalDests() } });
    inputLocked = false;
    if (hintStage !== 2) hintBtn.hidden = false;
    if (hintStage === 1) paintShapes({ hint: 'piece' });
    else if (hintStage === 2) paintShapes({ hint: 'arrow' });
  }

  // A better move was found (kind: the engine's #1, or a good alternative).
  function solve(uci: string, kind: 'best' | 'alt'): void {
    answered = true;
    lockBoard();
    hintBtn.hidden = true;
    completed++;
    const clean = !failedThisSpot;
    if (clean) solvedCount++;
    entries.push({ ref: current, clean });
    void recordSpotResult(current.game.id, current.spot.id, clean);

    const { from, to, promotion } = uciParts(uci);
    try {
      chess.move({ from, to, promotion });
    } catch { /* stored uci should always replay; the board still shows the try */ }
    cg.set({ fen: chess.fen(), turnColor: cgTurn(), lastMove: [from, to], movable: { color: undefined, dests: new Map() } });
    paintShapes({ badgeAt: to });

    playFeedback('correct');
    if (clean) {
      setStatus(kind === 'best' ? 'The engine’s move ✓' : 'A strong move — just as good ✓', 'pt-status--success');
      burstConfetti(boardWrap);
    } else {
      setStatus('Found it — take a look at why', 'pt-status--reveal');
    }
    renderSessionBar();
    renderContinuations();
    nextBtn.textContent = completed >= opts.refs.length ? 'See results' : 'Next position';
    reviewBtn.hidden = !opts.onOpenGame && !current.game.sans.length && !current.game.ucis.length;
    afterEl.hidden = false;
  }

  // The engine's three continuations at the mistake position, best first.
  function renderContinuations(): void {
    contsEl.innerHTML = '';
    const heading = document.createElement('div');
    heading.className = 'mr-conts-title';
    heading.textContent = 'The engine’s picks here';
    contsEl.appendChild(heading);
    for (const m of current.spot.best.slice(0, 3)) {
      const row = document.createElement('div');
      row.className = 'mr-cont-row';
      const move = document.createElement('span');
      move.className = 'mr-cont-move';
      move.textContent = formatMove(m.san);
      row.appendChild(move);
      const ev = document.createElement('span');
      ev.className = 'mr-cont-eval';
      ev.textContent = fmtEval(m);
      row.appendChild(ev);
      if (m.sanLine && m.sanLine.length > 1) {
        const line = document.createElement('span');
        line.className = 'mr-cont-line';
        line.textContent = m.sanLine.slice(1).map(s => formatMove(s)).join(' ');
        row.appendChild(line);
      }
      contsEl.appendChild(row);
    }
  }

  function onNextTap(): void {
    if (completed >= opts.refs.length) { showResults(); return; }
    index++;
    loadSpot();
  }

  // ── Inline game review ──────────────────────────────────────────────────────
  // The whole game on the same board: a move-chip strip (the mistake ply marked
  // red), prev/next stepping, a small eval readout per position, and a jump
  // into the full analyser. Board input stays off — this is for looking.
  let viewIndex = 0;
  let evalToken = 0;
  let evalTimer: ReturnType<typeof setTimeout> | undefined;
  const evalCache = new Map<string, MoveEval[] | null>();
  let replayFens: string[] = [];
  let replayUcis: string[] = [];
  let chipEls: HTMLElement[] = [];
  let evalReadout: HTMLElement | null = null;

  function enterReview(): void {
    const { game, spot } = current;
    const replay = replayGame(game);
    if (!replay) return;
    replayFens = replay.fens;
    replayUcis = game.ucis.length ? game.ucis : replay.sans.map((_, i) => uciAt(replay.fens[i], replay.sans[i]) ?? '');
    evalCache.set(spot.preFen, spot.best);

    afterEl.hidden = true;
    reviewEl.hidden = false;
    reviewEl.innerHTML = '';
    cg.setAutoShapes([]);

    // Move strip.
    const strip = document.createElement('div');
    strip.className = 'mr-review-strip';
    chipEls = [];
    for (let i = 0; i < replay.sans.length; i++) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'mr-move-chip' + (i === spot.ply ? ' mr-move-chip--mistake' : '');
      chip.textContent = i % 2 === 0
        ? `${i / 2 + 1}.${formatMove(replay.sans[i])}`
        : formatMove(replay.sans[i]);
      chip.addEventListener('click', () => setView(i + 1));
      chipEls.push(chip);
      strip.appendChild(chip);
    }
    reviewEl.appendChild(strip);

    // Eval readout + stepper row.
    const controls = document.createElement('div');
    controls.className = 'mr-review-controls';
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'btn-quiet mr-step-btn';
    prev.appendChild(Icons.back(16));
    prev.setAttribute('aria-label', 'Previous move');
    prev.addEventListener('click', () => setView(viewIndex - 1));
    controls.appendChild(prev);
    evalReadout = document.createElement('div');
    evalReadout.className = 'mr-eval-readout';
    controls.appendChild(evalReadout);
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'btn-quiet mr-step-btn mr-step-btn--fwd';
    next.appendChild(Icons.back(16));
    next.setAttribute('aria-label', 'Next move');
    next.addEventListener('click', () => setView(viewIndex + 1));
    controls.appendChild(next);
    reviewEl.appendChild(controls);

    // Back to the drill / open the full analyser.
    const actions = document.createElement('div');
    actions.className = 'mr-after-actions';
    if (opts.onOpenGame) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn-secondary';
      open.textContent = 'Open full analysis';
      open.addEventListener('click', () => {
        const fn = opts.onOpenGame!;
        const game2 = current.game;
        cleanup();
        fn(game2);
      });
      actions.appendChild(open);
    }
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn-primary';
    back.textContent = 'Back to position';
    back.addEventListener('click', () => exitReview());
    actions.appendChild(back);
    reviewEl.appendChild(actions);

    setView(spot.ply);
  }

  function exitReview(): void {
    if (evalTimer) clearTimeout(evalTimer);
    evalToken++;
    reviewEl.hidden = true;
    reviewEl.innerHTML = '';
    afterEl.hidden = false;
    // Restore the answered position (chess still holds preFen + the found move).
    const hist = chess.history({ verbose: true });
    const last = hist[hist.length - 1];
    cg.set({
      fen: chess.fen(),
      lastMove: last ? [last.from as Key, last.to as Key] : undefined,
      movable: { color: undefined, dests: new Map() },
    });
    paintShapes({ badgeAt: last ? (last.to as Key) : undefined });
  }

  function setView(i: number): void {
    viewIndex = Math.max(0, Math.min(replayFens.length - 1, i));
    const fen = replayFens[viewIndex];
    const uci = viewIndex > 0 ? replayUcis[viewIndex - 1] : '';
    const parts = uci ? uciParts(uci) : null;
    cg.set({
      fen,
      lastMove: parts ? [parts.from, parts.to] : undefined,
      movable: { color: undefined, dests: new Map() },
    });
    for (let c = 0; c < chipEls.length; c++) {
      chipEls[c].classList.toggle('mr-move-chip--current', c === viewIndex - 1);
    }
    const cur = chipEls[viewIndex - 1];
    cur?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    scheduleEval(fen);
  }

  // The eval readout: stored/cached instantly, otherwise a debounced one-shot
  // lookup (cloud first, quick local search as backup) so stepping stays snappy.
  function scheduleEval(fen: string): void {
    if (!evalReadout) return;
    const cached = evalCache.get(fen);
    if (cached !== undefined) { renderEval(cached); return; }
    evalReadout.textContent = '…';
    if (evalTimer) clearTimeout(evalTimer);
    const myToken = ++evalToken;
    evalTimer = setTimeout(() => {
      void (async () => {
        const evals = (await cloudTopLines(fen)) ?? (await analysePosition(fen, 10));
        const top = evals && evals.length ? evals : null;
        evalCache.set(fen, top);
        if (isCleaned || myToken !== evalToken) return;
        renderEval(top);
      })();
    }, 300);
  }

  function renderEval(top: MoveEval[] | null): void {
    if (!evalReadout) return;
    if (!top || !top.length) { evalReadout.textContent = '—'; return; }
    evalReadout.textContent = `${fmtEval(top[0])} · best ${formatMove(top[0].san)}`;
  }

  // ── Results screen (mirrors puzzle-run's) ───────────────────────────────────
  let resultsShown = false;
  function showResults(): void {
    if (resultsShown || isCleaned) return;
    resultsShown = true;
    sessionOver = true;
    opts.onComplete?.({ solved: solvedCount, completed });
    lockBoard();
    cg.setAutoShapes([]);

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
    sub.textContent = `${solvedCount}/${completed} fixed clean`;
    head.appendChild(sub);

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

    const actions = document.createElement('div');
    actions.className = 'pz-results-actions';

    // Daily challenge: straight on to the next task is the main action.
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

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = (opts.nextAction || opts.onPlayAgain) ? 'btn-secondary train-done-btn' : 'btn-primary train-next-btn';
    doneBtn.textContent = 'Close session';
    doneBtn.addEventListener('click', () => doExit());
    actions.appendChild(doneBtn);

    wrap.appendChild(actions);
    overlay.appendChild(wrap);
  }

  function resultRow(e: SessionEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'pz-result-row ' + (e.clean ? 'pz-result-row--solved' : 'pz-result-row--missed');

    const dot = document.createElement('span');
    dot.className = 'pz-result-dot';
    dot.textContent = e.clean ? '✓' : '✕';
    row.appendChild(dot);

    const main = document.createElement('div');
    main.className = 'pz-result-main';
    const name = document.createElement('div');
    name.className = 'pz-result-name';
    name.textContent = `vs ${e.ref.game.opponent}`;
    main.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'pz-result-meta';
    meta.textContent = `${CATEGORY_LABEL[e.ref.spot.category]} · ${formatMove(e.ref.spot.playedSan)} → ${formatMove(e.ref.spot.best[0]?.san ?? '?')}`;
    main.appendChild(meta);
    row.appendChild(main);

    return row;
  }

  function doExit(): void {
    cleanup();
    opts.onExit();
  }
  function cleanup(): void {
    isCleaned = true;
    checkToken++;
    evalToken++;
    if (evalTimer) clearTimeout(evalTimer);
    ro.disconnect();
    overlay.remove();
    removeBack();
  }

  loadSpot();
}

// "+1.8" / "−0.4" / "#3" from a white-perspective MoveEval.
function fmtEval(m: MoveEval): string {
  if (m.mate !== undefined) return `#${m.mate}`;
  if (m.cp === undefined) return '';
  const pawns = m.cp / 100;
  const sign = pawns > 0 ? '+' : pawns < 0 ? '−' : '';
  return `${sign}${Math.abs(pawns).toFixed(1)}`;
}

// One SAN → UCI against a fen (for SAN-only stored games in the review strip).
function uciAt(fen: string, san: string): string | null {
  try {
    const ch = new Chess(fen);
    const m = ch.move(san);
    return m.from + m.to + (m.promotion ?? '');
  } catch {
    return null;
  }
}
