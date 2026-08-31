// The Mistake Retry drill — a puzzle-style overlay (same .pt-* chrome as
// puzzle-run.ts) over positions from YOUR OWN games where the scan caught a
// mistake. Each spot loads the position as you had it, shows the move you
// actually played as a red arrow (with a quiet per-position hide toggle), and
// asks for a better one.
//
// Differences from the puzzle loop, by design:
//   • one move per position, judged instantly against the STORED top-3 (any of
//     the three counts as correct; anything else is wrong — no live engine
//     call, so feedback is immediate). A non-#1 answer still gets a nudge
//     toward the engine's first choice.
//   • after answering: just two actions — "Open full analysis" (opens the game
//     in the analyser AT the drill position, suspending the session; the
//     "Back to train" button in the top bar brings you straight back) and
//     "Next position".
//
// Results are persisted per spot the moment it's answered (recordSpotResult),
// so an abandoned session still counts what it fixed.

import { Chess } from 'chess.js';
import { registerBrushes, HINT_COLOR } from './board-brushes';
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
import type { MoveEval } from './engine';
import type { MoveClass } from './winprob';
import { recordSpotResult } from './mistake-scan';
import type { SpotRef, MistakeCategory } from './mistake-scan';
import type { ImportedGame } from './import-core';
import { buildRunHeader } from './run-header';
import { openSpotPeek, type SpotPeekOptions } from './spot-peek';

// Presentation names for the four categories — shared with the pane's cards.
export const CATEGORY_LABEL: Record<MistakeCategory, string> = {
  'opening-blunder': 'Opening blunders',
  'punish-opening': 'Punish the opening',
  'missed-win': 'Missed wins',
  'blunder': 'Blunders',
};

// The story line per category — short on purpose, so "You played ♛xe8 here
// and …" stays on one line on a phone. Shared with the pane's latest-mistakes
// carousel so the board cards read exactly like the drill.
export const CATEGORY_PHRASE: Record<MistakeCategory, string> = {
  'opening-blunder': 'blundered the opening',
  'punish-opening': 'let them off the hook',
  'missed-win': 'threw the win away',
  'blunder': 'blundered',
};

// How the played move reads on its red chip: the review palette's class (chip
// colour) and the annotation symbol shown beside the move.
export const CATEGORY_BADGE: Record<MistakeCategory, { cls: MoveClass; sym: string }> = {
  'opening-blunder': { cls: 'blunder', sym: '??' },
  'punish-opening': { cls: 'mistake', sym: '?' },
  'missed-win': { cls: 'blunder', sym: '??' },
  'blunder': { cls: 'blunder', sym: '??' },
};

// Passed to onOpenGame so the analyser can open AT the drill position and the
// app can bring the user back to this exact session state afterwards (or drop
// it cleanly if they wander somewhere else instead).
export interface OpenGameCtx {
  atFen?: string;
  onReturn: () => void;
  onDiscard: () => void;
}

export interface MistakeSessionOptions {
  refs: SpotRef[];                 // the spots to drill, in order (≤ 5 usually)
  onExit: () => void;
  // Fired once when the results screen comes up.
  onComplete?: (summary: { solved: number; completed: number }) => void;
  onPlayAgain?: () => void;
  // Open this game in the full analyser. The session suspends itself first and
  // hands over resume/discard hooks via ctx.
  onOpenGame?: (game: ImportedGame, ctx?: OpenGameCtx) => void;
  // Daily challenge: the results screen's primary jumps to the next challenge.
  nextAction?: { label: string; run: () => void };
  modeLabel?: string;              // e.g. a category label or "Daily challenge"
  // The exercise's face in the run header (run-header.ts). Defaults to the
  // pane's own alert icon and ember; a category card passes its own two so the
  // overlay looks like the card that opened it.
  modeIcon?: () => SVGElement;
  modeAccent?: string;
  /**
   * The session's framing, shown above the exercise's name in the run header —
   * "Daily challenge", "Your games mix". Context, not identity.
   */
  contextLabel?: string;
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
  let arrowHidden = false;           // the red played-move arrow, per position
  let inputLocked = true;
  let sessionOver = false;

  // Session tallies.
  let completed = 0;
  let solvedCount = 0;
  const entries: SessionEntry[] = [];

  // ── Overlay scaffold (mirrors puzzle-run.ts) ────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'pt-overlay pt-overlay--puzzle pt-overlay--tinted';
  // The Mistake retry ember, as a whisper behind the exercise — same hue as
  // its Train tab.
  overlay.style.setProperty('--pt-tint', '#a3492e');

  const header = buildRunHeader({
    icon: (opts.modeIcon ?? (() => Icons.reset(18)))(),
    title: opts.modeLabel ?? 'Mistakes to fix',
    kicker: opts.contextLabel,
    accent: opts.modeAccent,
    onEnd: () => exitViaButton(),
  });
  const headerEl = header.el;

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

  // The compact top block: opponent, then the opening (small and quiet), then
  // the one-line story with the played move on its red chip.
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

  // Status + the discrete "hide the red arrow" toggle share one row.
  const statusRow = document.createElement('div');
  statusRow.className = 'mr-status-row';
  const statusEl = document.createElement('div');
  statusEl.className = 'pt-status';
  statusEl.setAttribute('aria-live', 'polite');
  statusRow.appendChild(statusEl);
  const arrowBtn = document.createElement('button');
  arrowBtn.type = 'button';
  arrowBtn.className = 'mr-arrow-toggle';
  arrowBtn.title = 'Hide the played-move arrow';
  arrowBtn.setAttribute('aria-label', 'Hide the played-move arrow');
  arrowBtn.appendChild(eyeOffIcon(15));
  arrowBtn.addEventListener('click', () => {
    arrowHidden = !arrowHidden;
    arrowBtn.classList.toggle('mr-arrow-toggle--off', arrowHidden);
    arrowBtn.title = arrowHidden ? 'Show the played-move arrow' : 'Hide the played-move arrow';
    repaintPrompt();
  });
  statusRow.appendChild(arrowBtn);

  const hintBtn = document.createElement('button');
  hintBtn.type = 'button';
  hintBtn.className = 'pz-hint-btn';
  hintBtn.appendChild(Icons.bulb(16));
  hintBtn.appendChild(document.createTextNode('Hint'));
  hintBtn.hidden = true;
  hintBtn.addEventListener('click', () => useHint());

  // The post-answer block: just the two actions.
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
    // Opens at the drill position — the same one the spot showed.
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
  // The played mistake is drawn in the review palette's blunder red. Unique
  // brush keys per board (board-brushes.ts) so arrowheads never collide.
  registerBrushes(cg, {
    accent: { color: HINT_COLOR, opacity: 0.85, lineWidth: 10 },
    danger: { color: '#c93636', opacity: 0.8, lineWidth: 10 },
  });
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
  // any hint shape, the answer badge and the "even stronger" suggestion share
  // the single autoshape list, so painting them separately would wipe each
  // other.
  function paintShapes(o: {
    hint?: 'piece' | 'arrow';
    badge?: { at: Key; cls: MoveClass };
    suggestUci?: string;
  } = {}): void {
    const shapes: DrawShape[] = [];
    if (!answered && !arrowHidden) {
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
    if (o.suggestUci) {
      const { from, to } = uciParts(o.suggestUci);
      shapes.push({ orig: from, dest: to, brush: 'accent' });
    }
    if (o.badge) {
      shapes.push({ orig: o.badge.at, customSvg: classBoardSvg(o.badge.cls) });
    }
    requestAnimationFrame(() => { if (!isCleaned) cg.setAutoShapes(shapes); });
  }

  // Re-draw the pre-answer shapes with the current hint stage (used by the
  // arrow toggle so hiding the red arrow never loses an active hint).
  function repaintPrompt(): void {
    if (answered) return;
    paintShapes(hintStage === 1 ? { hint: 'piece' } : hintStage === 2 ? { hint: 'arrow' } : {});
  }

  // ── Spot lifecycle ──────────────────────────────────────────────────────────
  function loadSpot(): void {
    current = opts.refs[index];
    answered = false;
    failedThisSpot = false;
    hintStage = 0;
    arrowHidden = false;
    arrowBtn.classList.remove('mr-arrow-toggle--off');
    arrowBtn.title = 'Hide the played-move arrow';
    arrowBtn.hidden = false;
    hintBtn.replaceChildren(Icons.bulb(16), document.createTextNode('Hint'));
    hintBtn.hidden = true;
    afterEl.hidden = true;
    renderSessionBar();

    const { game, spot } = current;
    nameEl.textContent = `vs ${game.opponent}`;
    openingEl.textContent = game.opening ?? '';
    openingEl.hidden = !game.opening;
    renderIntro();
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

  // "You played [♛xe8 ??] here and blundered." — the move on a red chip with
  // its annotation symbol, the phrase kept short enough for one line.
  function renderIntro(): void {
    const { spot } = current;
    const badge = CATEGORY_BADGE[spot.category];
    introEl.replaceChildren();
    introEl.appendChild(document.createTextNode('You played '));
    const chip = document.createElement('span');
    chip.className = `mr-played mr-played--${badge.cls}`;
    chip.textContent = `${formatMove(spot.playedSan)} ${badge.sym}`;
    introEl.appendChild(chip);
    introEl.appendChild(document.createTextNode(` here and ${CATEGORY_PHRASE[spot.category]}.`));
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

  // Is `uci4` (from+to) one of the stored alternatives (best[1..2])? All three
  // engine picks count as correct — the #1 just earns a cleaner message.
  function storedAlternative(uci4: string): MoveEval | null {
    for (const alt of current.spot.best.slice(1, 3)) {
      if (alt.uci.slice(0, 4) === uci4) return alt;
    }
    return null;
  }

  function onUserMove(from: Key, to: Key): void {
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

    // Not one of the engine's three — wrong, instantly. Snap back and let
    // them keep looking (no engine round-trip; the stored picks are the judge).
    failedThisSpot = true;
    flashError();
    setStatus('Not quite — try again', 'pt-status--error');
    cg.set({ fen: chess.fen(), turnColor: cgTurn(), movable: { color: current.game.colour, dests: legalDests() } });
    if (hintStage !== 2) hintBtn.hidden = false;
    repaintPrompt();
  }

  // A better move was found (kind: the engine's #1, or one of its other two
  // picks). The board locks; an alt answer gets a nudge toward the #1, drawn
  // as an orange arrow next to the badge on the move just played.
  function solve(uci: string, kind: 'best' | 'alt'): void {
    answered = true;
    lockBoard();
    hintBtn.hidden = true;
    arrowBtn.hidden = true;
    completed++;
    const clean = !failedThisSpot;
    if (clean) solvedCount++;
    entries.push({ ref: current, clean });
    void recordSpotResult(current.game.id, current.spot.id, clean);

    const best = current.spot.best[0];
    const { from, to, promotion } = uciParts(uci);
    try {
      chess.move({ from, to, promotion });
    } catch { /* stored uci should always replay; the board still shows the try */ }
    cg.set({
      fen: chess.fen(),
      turnColor: cgTurn(),
      lastMove: [from, to],
      movable: { color: undefined, dests: new Map() },
    });
    paintShapes({
      badge: { at: to, cls: kind === 'best' ? 'best' : 'excellent' },
      // "That's good — but there's a better one": show the engine's #1.
      suggestUci: kind === 'alt' ? best.uci : undefined,
    });

    playFeedback('correct');
    if (kind === 'best') {
      setStatus(clean ? 'The engine’s move ✓' : 'Found it — the engine’s move ✓',
        clean ? 'pt-status--success' : 'pt-status--reveal');
    } else {
      setStatus(`Good move ✓ — even stronger: ${formatMove(best.san)}`,
        clean ? 'pt-status--success' : 'pt-status--reveal');
    }
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

  // ── Suspend for the full analyser ───────────────────────────────────────────
  // The overlay hides (session state intact) while the analyser opens at the
  // drill position; the app's "Back to train" button in the top bar resumes
  // it, and navigating anywhere else discards it cleanly.
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
      entries.forEach((e, idx) => list.appendChild(resultRow(e, idx)));
      listWrap.appendChild(list);
      const fade = document.createElement('div');
      fade.className = 'pz-results-fade';
      fade.setAttribute('aria-hidden', 'true');
      listWrap.appendChild(fade);
      wrap.appendChild(listWrap);
    }

    const actions = document.createElement('div');
    actions.className = 'pz-results-actions';

    // Daily challenge: straight on to the next challenge is the main action.
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

  // One results row — tappable: pops the position up right here, with a jump
  // into the full analyser for that game.
  function resultRow(e: SessionEntry, idx: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'pz-result-row pz-result-row--linked '
      + (e.clean ? 'pz-result-row--solved' : 'pz-result-row--missed');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    const open = (): void => openSpotPeekFor(idx);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
    });

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

  // The results-row popup — the shared one (spot-peek.ts), which the detective
  // and which-move runs use too. `idx` into `entries` so the popup's arrows
  // can browse to the neighbouring positions.
  function peekOptionsFor(idx: number): SpotPeekOptions | null {
    const e = entries[idx];
    if (!e) return null;
    const ref = e.ref;
    const best = ref.spot.best[0];
    return {
      fen: ref.spot.preFen,
      orientation: ref.game.colour,
      arrows: [
        { uci: ref.spot.playedUci, kind: 'danger' },
        ...(best ? [{ uci: best.uci, kind: 'accent' as const }] : []),
      ],
      meta: `${formatMove(ref.spot.playedSan)} → ${formatMove(best?.san ?? '?')} · vs ${ref.game.opponent}`,
      onAnalyse: opts.onOpenGame
        ? () => suspendForAnalysis(ref.game, ref.spot.preFen)
        : undefined,
      onNav: (dir) => peekOptionsFor(idx + dir),
    };
  }
  function openSpotPeekFor(idx: number): void {
    const o = peekOptionsFor(idx);
    if (o) openSpotPeek(o);
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

// The eye-off mark for the arrow toggle (Lucide eye-off, drawn inline like the
// Icons set but local to this file — the only place it's used).
function eyeOffIcon(size: number): SVGSVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '2');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML =
    '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>' +
    '<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>' +
    '<path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>' +
    '<line x1="2" x2="22" y1="2" y2="22"/>';
  return el;
}
