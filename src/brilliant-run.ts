// The Brilliant Moves drill — the mirror image of the Mistake Retry drill
// (mistake-run.ts), sharing its .pt-* / .mr-* chrome. Each spot loads the
// position from YOUR OWN game just before a move the review graded brilliant
// (!!) or great (!), and asks you to find that move again. The answer IS the
// move you played, so there's no red "mistake" arrow — the board is clean and
// the class name (not the move) is all the intro gives away.
//
// Judging is instant and local: the played move's uci is the one right answer;
// anything else is wrong (a hint reveals the piece, then the move). No engine
// round-trip, no persistence — a find is a find; replay it as often as you like.

import { Chess } from 'chess.js';
import { registerBrushes } from './board-brushes';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { Icons, classBoardSvg, CLASS_LABEL } from './icons';
import { playFeedback } from './sound';
import { pushBack } from './back-nav';
import { burstConfetti, celebratePawn } from './confetti';
import { showDialog } from './dialog';
import { formatMove } from './notation';
import type { ImportedGame } from './import-core';
import type { BrilliantRef } from './brilliant';
import type { OpenGameCtx } from './mistake-run';

export interface BrilliantSessionOptions {
  refs: BrilliantRef[];            // the finds to drill, in order
  onExit: () => void;
  onComplete?: (summary: { solved: number; completed: number }) => void;
  onPlayAgain?: () => void;
  // Open this game in the full analyser, AT the drill position; the session
  // suspends itself and hands over resume/discard hooks via ctx.
  onOpenGame?: (game: ImportedGame, ctx?: OpenGameCtx) => void;
}

interface SessionEntry {
  ref: BrilliantRef;
  clean: boolean;
}

export function startBrilliantSession(opts: BrilliantSessionOptions): void {
  if (opts.refs.length === 0) { opts.onExit(); return; }

  const chess = new Chess();
  let cg: Api;
  let isCleaned = false;

  // Per-spot state.
  let index = 0;
  let current: BrilliantRef = opts.refs[0];
  let answered = false;
  let failedThisSpot = false;
  let hintStage = 0;                 // 0 none, 1 piece highlighted, 2 arrow
  let inputLocked = true;
  let sessionOver = false;

  // Session tallies.
  let completed = 0;
  let solvedCount = 0;
  const entries: SessionEntry[] = [];

  // ── Overlay scaffold (mirrors mistake-run.ts) ───────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'pt-overlay pt-overlay--puzzle pt-overlay--tinted';
  // The brilliant teal, as a whisper behind the exercise.
  overlay.style.setProperty('--pt-tint', '#1d9e8f');

  const headerEl = document.createElement('div');
  headerEl.className = 'pt-header';
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'pt-back-btn';
  backBtn.appendChild(Icons.back(15));
  backBtn.appendChild(document.createTextNode('End session'));
  backBtn.addEventListener('click', () => exitViaButton());
  headerEl.appendChild(backBtn);

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
  topEl.className = 'pt-top mr-top';
  const nameEl = document.createElement('div');
  nameEl.className = 'pt-line-name mr-opponent';
  topEl.appendChild(nameEl);
  const openingEl = document.createElement('div');
  openingEl.className = 'mr-opening';
  topEl.appendChild(openingEl);
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

  const statusRow = document.createElement('div');
  statusRow.className = 'mr-status-row';
  const statusEl = document.createElement('div');
  statusEl.className = 'pt-status';
  statusEl.setAttribute('aria-live', 'polite');
  statusRow.appendChild(statusEl);

  const hintBtn = document.createElement('button');
  hintBtn.type = 'button';
  hintBtn.className = 'pz-hint-btn';
  hintBtn.appendChild(Icons.bulb(16));
  hintBtn.appendChild(document.createTextNode('Hint'));
  hintBtn.hidden = true;
  hintBtn.addEventListener('click', () => useHint());

  const afterEl = document.createElement('div');
  afterEl.className = 'mr-after';
  afterEl.hidden = true;
  const afterActions = document.createElement('div');
  afterActions.className = 'mr-after-actions';
  if (opts.onOpenGame) {
    const analyseBtn = document.createElement('button');
    analyseBtn.type = 'button';
    analyseBtn.className = 'btn-secondary mr-after-btn';
    analyseBtn.appendChild(Icons.review(16));
    analyseBtn.appendChild(document.createTextNode('Analyse'));
    analyseBtn.addEventListener('click', () =>
      suspendForAnalysis(current.game, current.spot.preFen));
    afterActions.appendChild(analyseBtn);
  }
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'btn-primary pz-next-btn mr-after-btn';
  nextBtn.textContent = 'Next position';
  nextBtn.addEventListener('click', () => onNextTap());
  afterActions.appendChild(nextBtn);
  afterEl.appendChild(afterActions);

  bottomEl.appendChild(statusRow);
  bottomEl.appendChild(hintBtn);
  bottomEl.appendChild(afterEl);

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
    events: { move(from, to) { onUserMove(from as Key, to as Key); } },
  });
  // The found move is drawn in the brilliant teal (hint / answer arrow).
  registerBrushes(cg, {
    accent: { color: '#1d9e8f', opacity: 0.9, lineWidth: 10 },
  });
  const ro = new ResizeObserver(() => cg.redrawAll());
  ro.observe(boardEl);

  // ── Exit guards (mirror mistake-run) ────────────────────────────────────────
  function showAbandonDialog(onStay: () => void): void {
    showDialog({
      title: 'End this session?',
      body: 'The moves you already found stay found.',
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

  // ── Small helpers (same shapes as mistake-run) ──────────────────────────────
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

  // One setAutoShapes call — a hint (piece / arrow) before the answer, the class
  // badge after it.
  function paintShapes(o: { hint?: 'piece' | 'arrow'; badge?: { at: Key } } = {}): void {
    const shapes: DrawShape[] = [];
    const { from, to } = uciParts(current.spot.playedUci);
    if (!answered && o.hint === 'piece') {
      shapes.push({ orig: from, brush: 'accent' });
    } else if (!answered && o.hint === 'arrow') {
      shapes.push({ orig: from, dest: to, brush: 'accent' });
    }
    if (o.badge) {
      shapes.push({ orig: o.badge.at, customSvg: classBoardSvg(current.spot.cls) });
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
    renderSessionBar();

    const { game, spot } = current;
    nameEl.textContent = `vs ${game.opponent}`;
    openingEl.textContent = game.opening ?? '';
    openingEl.hidden = !game.opening;
    renderIntro();
    setStatus(spot.cls === 'brilliant' ? 'Find your brilliant move' : 'Find your best move',
      'pt-status--prompt');

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

  // "You played a [Brilliant] move here — can you find it again?" The class name
  // sits on a teal chip; the MOVE is never shown (it's the answer).
  function renderIntro(): void {
    const { spot } = current;
    introEl.replaceChildren();
    introEl.appendChild(document.createTextNode('You played a '));
    const chip = document.createElement('span');
    chip.className = `mr-played mr-played--${spot.cls}`;
    chip.textContent = CLASS_LABEL[spot.cls];
    introEl.appendChild(chip);
    introEl.appendChild(document.createTextNode(' move here — can you find it again?'));
  }

  function useHint(): void {
    if (inputLocked || answered) return;
    failedThisSpot = true; // a hinted solve isn't a clean find
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

  function onUserMove(from: Key, to: Key): void {
    if (inputLocked || answered) return;
    const uci4 = `${from}${to}`;
    if (current.spot.playedUci.slice(0, 4) === uci4) {
      solve();
      return;
    }
    // Not the move you found — wrong, instantly. Snap back and keep looking.
    failedThisSpot = true;
    flashError();
    setStatus('Not that one — try again', 'pt-status--error');
    cg.set({ fen: chess.fen(), turnColor: cgTurn(), movable: { color: current.game.colour, dests: legalDests() } });
    if (hintStage !== 2) hintBtn.hidden = false;
    paintShapes(hintStage === 1 ? { hint: 'piece' } : {});
  }

  // The found move was played again. Lock the board, badge the move, celebrate.
  function solve(): void {
    answered = true;
    lockBoard();
    hintBtn.hidden = true;
    completed++;
    const clean = !failedThisSpot;
    if (clean) solvedCount++;
    entries.push({ ref: current, clean });

    const { from, to, promotion } = uciParts(current.spot.playedUci);
    try {
      chess.move({ from, to, promotion });
    } catch { /* stored uci should always replay */ }
    cg.set({
      fen: chess.fen(),
      turnColor: cgTurn(),
      lastMove: [from, to],
      movable: { color: undefined, dests: new Map() },
    });
    paintShapes({ badge: { at: to } });

    playFeedback('correct');
    const label = CLASS_LABEL[current.spot.cls];
    setStatus(
      clean ? `${label} ✓ — you found it again` : `That's it — ${label} ✓`,
      clean ? 'pt-status--success' : 'pt-status--reveal');
    if (clean) burstConfetti(boardWrap);
    renderSessionBar();
    nextBtn.textContent = completed >= opts.refs.length ? 'See results' : 'Next position';
    afterEl.hidden = false;
  }

  function onNextTap(): void {
    if (completed >= opts.refs.length) { showResults(); return; }
    index++;
    loadSpot();
  }

  // ── Suspend for the full analyser (mirrors mistake-run) ─────────────────────
  function suspendForAnalysis(game: ImportedGame, atFen: string): void {
    if (!opts.onOpenGame) return;
    removeBack();
    removeBack = () => {};
    overlay.hidden = true;
    opts.onOpenGame(game, {
      atFen,
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

  // ── Results screen (mirrors mistake-run's) ──────────────────────────────────
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
    sub.textContent = `${solvedCount}/${completed} found clean`;
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
    if (opts.onPlayAgain) {
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'btn-primary train-next-btn';
      again.textContent = 'Play again';
      again.addEventListener('click', () => { const fn = opts.onPlayAgain!; cleanup(); fn(); });
      actions.appendChild(again);
    }
    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = opts.onPlayAgain ? 'btn-secondary train-done-btn' : 'btn-primary train-next-btn';
    doneBtn.textContent = 'Close session';
    doneBtn.addEventListener('click', () => doExit());
    actions.appendChild(doneBtn);

    wrap.appendChild(actions);
    overlay.appendChild(wrap);
  }

  function resultRow(e: SessionEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'pz-result-row '
      + (e.clean ? 'pz-result-row--solved' : 'pz-result-row--missed');

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
    meta.textContent = `${CLASS_LABEL[e.ref.spot.cls]} · ${formatMove(e.ref.spot.playedSan)}`;
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
    ro.disconnect();
    overlay.remove();
    removeBack();
  }

  loadSpot();
}
