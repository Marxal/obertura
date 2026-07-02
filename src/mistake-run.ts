// The Mistake Retry drill — a puzzle-style overlay (same .pt-* chrome as
// puzzle-run.ts) over positions from YOUR OWN games where the scan caught a
// mistake. Each spot loads the position as you had it, shows the move you
// actually played as a red arrow (with a quiet per-position hide toggle), and
// asks for a better one.
//
// Differences from the puzzle loop, by design:
//   • one move per position (the engine's best, or anything within a whisker
//     of it — checked against the stored top-3 first, live engine as backup),
//   • after answering the board opens up: keep playing either side and analyse
//     right there — an eval bar, a branching move list (variations included)
//     and a Game-Review grade on every move you try — or jump into the full
//     analyser ("Open full analysis" suspends the session; a "Back to
//     training" chip in the top bar brings you straight back to this spot).
//
// Results are persisted per spot the moment it's answered (recordSpotResult),
// so an abandoned session still counts what it fixed.

import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { Icons, classIcon, classBoardSvg } from './icons';
import { playFeedback } from './sound';
import { pushBack } from './back-nav';
import { burstConfetti, celebratePawn } from './confetti';
import { showDialog } from './dialog';
import { formatMove } from './notation';
import { isGoodAlternative, analysePosition, cloudTopLines } from './engine';
import type { MoveEval, CloudTopMove } from './engine';
import { gradeMove } from './review';
import { cpToWin, flattenCp } from './winprob';
import type { MoveClass } from './winprob';
import { recordSpotResult, GOOD_ALT_CP } from './mistake-scan';
import type { SpotRef, MistakeCategory } from './mistake-scan';
import type { ImportedGame } from './import-core';

// Presentation names for the four categories — shared with the pane's cards.
export const CATEGORY_LABEL: Record<MistakeCategory, string> = {
  'opening-blunder': 'Opening blunders',
  'punish-opening': 'Punish the opening',
  'missed-win': 'Missed wins',
  'blunder': 'Blunders',
};

// The story line per category — short on purpose, so "You played ♛xe8 here
// and …" stays on one line on a phone.
const CATEGORY_PHRASE: Record<MistakeCategory, string> = {
  'opening-blunder': 'blundered the opening',
  'punish-opening': 'let them off the hook',
  'missed-win': 'threw the win away',
  'blunder': 'blundered',
};

// How the played move reads on its red chip: the review palette's class (chip
// colour) and the annotation symbol shown beside the move.
const CATEGORY_BADGE: Record<MistakeCategory, { cls: MoveClass; sym: string }> = {
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
  // Daily challenge: the results screen's primary jumps to the next task.
  nextAction?: { label: string; run: () => void };
  modeLabel?: string;              // e.g. a category label or "Daily challenge"
}

interface SessionEntry {
  ref: SpotRef;
  clean: boolean;
}

// One node of the post-answer analysis tree. children[0] is the "main" branch;
// later siblings render as parenthesised variations, PGN style.
interface ANode {
  san: string;
  uci: string;
  fen: string;
  parent: ANode | null;
  children: ANode[];
  cls?: MoveClass;
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
  let checkToken = 0;                // invalidates an in-flight live check
  let sessionOver = false;

  // Post-answer analysis state.
  let anRoot: ANode | null = null;
  let anCur: ANode | null = null;

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

  // The post-answer block: eval bar + your analysis moves + the two actions.
  const afterEl = document.createElement('div');
  afterEl.className = 'mr-after';
  afterEl.hidden = true;

  const evalRow = document.createElement('div');
  evalRow.className = 'mr-eval-row';
  const evalBar = document.createElement('div');
  evalBar.className = 'mr-eval-bar';
  const evalFill = document.createElement('div');
  evalFill.className = 'mr-eval-bar-fill';
  evalBar.appendChild(evalFill);
  evalRow.appendChild(evalBar);
  const evalText = document.createElement('div');
  evalText.className = 'mr-eval-readout';
  evalRow.appendChild(evalText);
  afterEl.appendChild(evalRow);

  const anMovesEl = document.createElement('div');
  anMovesEl.className = 'mr-an-moves';
  afterEl.appendChild(anMovesEl);

  const afterActions = document.createElement('div');
  afterActions.className = 'mr-after-actions';
  let analyseBtn: HTMLButtonElement | null = null;
  if (opts.onOpenGame) {
    analyseBtn = document.createElement('button');
    analyseBtn.type = 'button';
    analyseBtn.className = 'btn-secondary';
    analyseBtn.textContent = 'Open full analysis';
    analyseBtn.addEventListener('click', () =>
      suspendForAnalysis(current.game, anCur?.fen ?? current.spot.preFen));
    afterActions.appendChild(analyseBtn);
  }
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'btn-primary pz-next-btn';
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
  // any hint shape and a class badge share the single autoshape list, so
  // painting them separately would wipe each other.
  function paintShapes(o: { hint?: 'piece' | 'arrow'; badge?: { at: Key; cls: MoveClass } } = {}): void {
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
    anRoot = null;
    anCur = null;
    hintBtn.replaceChildren(Icons.bulb(16), document.createTextNode('Hint'));
    hintBtn.hidden = true;
    afterEl.hidden = true;
    anMovesEl.innerHTML = '';
    renderSessionBar();

    const { game, spot } = current;
    nameEl.textContent = `vs ${game.opponent}`;
    openingEl.textContent = game.opening ?? '';
    openingEl.hidden = !game.opening;
    renderIntro();
    setStatus('Find a better move', 'pt-status--prompt');
    // Seed the eval cache with the stored top-3, so the answer position's bar
    // and the first grades come back instantly.
    evalCache.set(spot.preFen, Promise.resolve(spot.best));

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
    if (answered) { analysisMove(from, to); return; }
    if (inputLocked) return;
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
    repaintPrompt();
  }

  // A better move was found (kind: the engine's #1, or a good alternative).
  // The board then opens up for free analysis from the answered position.
  function solve(uci: string, kind: 'best' | 'alt'): void {
    answered = true;
    hintBtn.hidden = true;
    arrowBtn.hidden = true;
    completed++;
    const clean = !failedThisSpot;
    if (clean) solvedCount++;
    entries.push({ ref: current, clean });
    void recordSpotResult(current.game.id, current.spot.id, clean);

    const { from, to, promotion } = uciParts(uci);
    let san = uci;
    try {
      san = chess.move({ from, to, promotion }).san;
    } catch { /* stored uci should always replay; the board still shows the try */ }

    // Root the analysis tree at the drill position, with the found move as its
    // first (graded) node.
    anRoot = { san: '', uci: '', fen: current.spot.preFen, parent: null, children: [] };
    const first: ANode = {
      san,
      uci,
      fen: chess.fen(),
      parent: anRoot,
      children: [],
      cls: kind === 'best' ? 'best' : 'excellent',
    };
    anRoot.children.push(first);
    anCur = first;

    playFeedback('correct');
    if (clean) {
      setStatus(kind === 'best' ? 'The engine’s move ✓ — keep exploring' : 'A strong move — just as good ✓', 'pt-status--success');
      burstConfetti(boardWrap);
    } else {
      setStatus('Found it — play on to see why', 'pt-status--reveal');
    }
    renderSessionBar();
    nextBtn.textContent = completed >= opts.refs.length ? 'See results' : 'Next position';
    afterEl.hidden = false;
    inputLocked = false;
    showNode(first);
  }

  function onNextTap(): void {
    if (completed >= opts.refs.length) { showResults(); return; }
    index++;
    loadSpot();
  }

  // ── Post-answer free analysis ───────────────────────────────────────────────
  // Both sides playable; each move is added to the little tree (revisiting an
  // earlier position and playing something new opens a variation), graded like
  // the Game Review grades it, and reflected in the eval bar.

  // Session-wide eval lookup, promise-cached so the bar and the grader share
  // one fetch per position: cloud first, local depth-12 fallback.
  const evalCache = new Map<string, Promise<MoveEval[] | null>>();
  function topEvals(fen: string): Promise<MoveEval[] | null> {
    let p = evalCache.get(fen);
    if (!p) {
      p = (async () => {
        const cloud = await cloudTopLines(fen);
        if (cloud && cloud.length) return cloud;
        const local = await analysePosition(fen, 12);
        return local.length ? local : null;
      })();
      evalCache.set(fen, p);
    }
    return p;
  }

  function analysisMove(from: Key, to: Key): void {
    if (!anCur || inputLocked) return;
    let mv;
    try {
      mv = chess.move({ from: from as string, to: to as string, promotion: 'q' });
    } catch {
      // Shouldn't happen (dests are legal) — resync the board and move on.
      cg.set({ fen: chess.fen(), turnColor: cgTurn(), movable: { color: 'both', dests: legalDests() } });
      return;
    }
    const uci = mv.from + mv.to + (mv.promotion ?? '');
    // Re-playing a move that's already in the tree just follows it.
    const existing = anCur.children.find(c => c.uci === uci);
    if (existing) {
      showNode(existing);
      return;
    }
    const node: ANode = { san: mv.san, uci, fen: chess.fen(), parent: anCur, children: [] };
    anCur.children.push(node);
    anCur = node;
    syncAnalysisBoard();
    renderAnMoves();
    scheduleEvalBar(node.fen);
    void gradeAnalysisNode(node);
  }

  // Jump the board (and the chess instance) to a node of the analysis tree.
  function showNode(node: ANode): void {
    anCur = node;
    chess.load(node.fen);
    syncAnalysisBoard();
    renderAnMoves();
    scheduleEvalBar(node.fen);
  }

  function syncAnalysisBoard(): void {
    if (!anCur) return;
    const parts = anCur.parent ? uciParts(anCur.uci) : null;
    cg.set({
      fen: anCur.fen,
      turnColor: cgTurn(),
      lastMove: parts ? [parts.from, parts.to] : undefined,
      movable: { color: 'both', dests: legalDests() },
    });
    if (parts && anCur.cls) paintShapes({ badge: { at: parts.to, cls: anCur.cls } });
    else paintShapes();
  }

  // Grade one analysis move exactly like the Game Review does: the engine's
  // top moves at the parent (mover-perspective) + the played move's eval.
  async function gradeAnalysisNode(node: ANode): Promise<void> {
    const parentFen = node.parent?.fen;
    if (!parentFen) return;
    const parentTop = await topEvals(parentFen);
    if (isCleaned || !parentTop || parentTop.length === 0) return;
    const moverIsBlack = parentFen.split(' ')[1] === 'b';
    const flip = (v: number | undefined): number | undefined =>
      v === undefined ? undefined : (moverIsBlack ? -v : v);
    const top: CloudTopMove[] = parentTop.map(e => ({ uci: e.uci, cp: flip(e.cp), mate: flip(e.mate) }));

    let playedCp: number | null = null;
    const mine = top.find(m => m.uci.slice(0, 4) === node.uci.slice(0, 4));
    if (mine) playedCp = flattenCp(mine);
    if (playedCp === null) {
      const childTop = await topEvals(node.fen);
      if (isCleaned) return;
      const childW = childTop && childTop.length ? flattenCp(childTop[0]) : null;
      if (childW !== null) playedCp = moverIsBlack ? -childW : childW;
    }
    if (playedCp === null) return;

    const grade = gradeMove({ parentTop: top, playedUci: node.uci, playedCp, inBook: false });
    if (!grade || isCleaned) return;
    node.cls = grade.classification;
    if (anCur === node) syncAnalysisBoard();
    renderAnMoves();
  }

  // ── The analysis move list (variations parenthesised, PGN style) ────────────
  function renderAnMoves(): void {
    anMovesEl.innerHTML = '';
    if (!anRoot) return;
    // A quiet head chip jumps back to the drill position itself, so other
    // first moves can be tried there too (they open as variations).
    const rootChip = document.createElement('span');
    rootChip.className = 'move-san mr-an-root' + (anCur === anRoot ? ' active' : '');
    rootChip.textContent = '⟲';
    rootChip.title = 'Back to the position';
    rootChip.addEventListener('click', () => showNode(anRoot!));
    anMovesEl.appendChild(rootChip);
    // 1-based ply of the first analysis move = the flagged ply + 1.
    renderAnCont(anMovesEl, anRoot, current.spot.ply + 1, true);
  }

  function renderAnCont(container: HTMLElement, parent: ANode, ply: number, forceNumber: boolean): void {
    if (parent.children.length === 0) return;
    const main = parent.children[0];
    emitAnMove(container, main, ply, forceNumber);

    let nextForce = false;
    if (parent.children.length > 1) {
      for (let i = 1; i < parent.children.length; i++) {
        const v = parent.children[i];
        const wrap = document.createElement('span');
        wrap.className = 'move-var';
        wrap.appendChild(document.createTextNode('('));
        emitAnMove(wrap, v, ply, true);
        renderAnCont(wrap, v, ply + 1, false);
        wrap.appendChild(document.createTextNode(')'));
        container.appendChild(wrap);
      }
      nextForce = true;
    }
    renderAnCont(container, main, ply + 1, nextForce);
  }

  function emitAnMove(container: HTMLElement, node: ANode, ply: number, force: boolean): void {
    const white = ply % 2 === 1;
    if (white || force) {
      const num = document.createElement('span');
      num.className = 'move-num';
      num.textContent = white ? `${Math.ceil(ply / 2)}.` : `${Math.ceil(ply / 2)}…`;
      container.appendChild(num);
    }
    const span = document.createElement('span');
    span.className = 'move-san' + (node === anCur ? ' active' : '');
    span.textContent = formatMove(node.san);
    if (node.cls) {
      span.classList.add(`class--${node.cls}`);
      span.appendChild(classIcon(node.cls, 12));
    }
    span.addEventListener('click', () => showNode(node));
    container.appendChild(span);
  }

  // ── Eval bar ────────────────────────────────────────────────────────────────
  let evalToken = 0;
  function scheduleEvalBar(fen: string): void {
    const myToken = ++evalToken;
    evalText.textContent = '…';
    void topEvals(fen).then((top) => {
      if (isCleaned || myToken !== evalToken) return;
      if (!top || !top.length) {
        evalText.textContent = '—';
        return;
      }
      const whiteCp = flattenCp(top[0]);
      if (whiteCp !== null) {
        evalFill.style.width = `${Math.round(cpToWin(whiteCp) * 100)}%`;
      }
      evalText.textContent = `${fmtEval(top[0])} · best ${formatMove(top[0].san)}`;
    });
  }

  // ── Suspend for the full analyser ───────────────────────────────────────────
  // The overlay hides (session state intact) while the analyser opens at the
  // position on the board; the app's "Back to training" chip resumes it, and
  // navigating anywhere else discards it cleanly.
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

  // One results row — tappable: pops the position up right here, with a jump
  // into the full analyser for that game.
  function resultRow(e: SessionEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'pz-result-row pz-result-row--linked '
      + (e.clean ? 'pz-result-row--solved' : 'pz-result-row--missed');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    const open = (): void => openSpotPeek(e.ref);
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

  // The results-row popup: the position as you had it (played move in red, the
  // engine's answer in orange) plus "Analyse game" into the full analyser.
  function openSpotPeek(ref: SpotRef): void {
    const ov = document.createElement('div');
    ov.className = 'edit-overlay';
    const sheet = document.createElement('div');
    sheet.className = 'edit-sheet peek-sheet';

    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      ov.remove();
      removePeekBack();
    };

    const board = document.createElement('div');
    board.className = 'peek-board cg-wrap';
    sheet.appendChild(board);

    const pcg = Chessground(board, {
      fen: ref.spot.preFen,
      orientation: ref.game.colour,
      viewOnly: true,
      coordinates: false,
      animation: { enabled: false },
      drawable: { enabled: false, visible: true },
    });
    pcg.state.drawable.brushes['accent'] = { key: 'accent', color: '#ff9b21', opacity: 0.9, lineWidth: 10 };
    pcg.state.drawable.brushes['danger'] = { key: 'danger', color: '#c93636', opacity: 0.8, lineWidth: 10 };
    const shapes: DrawShape[] = [];
    const played = uciParts(ref.spot.playedUci);
    shapes.push({ orig: played.from, dest: played.to, brush: 'danger' });
    const best = ref.spot.best[0];
    if (best) {
      const b = uciParts(best.uci);
      shapes.push({ orig: b.from, dest: b.to, brush: 'accent' });
    }
    pcg.setAutoShapes(shapes);
    requestAnimationFrame(() => pcg.redrawAll());

    const meta = document.createElement('div');
    meta.className = 'mr-peek-meta';
    meta.textContent =
      `${formatMove(ref.spot.playedSan)} → ${formatMove(best?.san ?? '?')} · vs ${ref.game.opponent}`;
    sheet.appendChild(meta);

    const btnRow = document.createElement('div');
    btnRow.className = 'peek-actions';
    if (opts.onOpenGame) {
      const analyse = document.createElement('button');
      analyse.type = 'button';
      analyse.className = 'peek-action';
      analyse.appendChild(Icons.review(18));
      const lbl = document.createElement('span');
      lbl.textContent = 'Analyse game';
      analyse.appendChild(lbl);
      analyse.addEventListener('click', () => {
        close();
        suspendForAnalysis(ref.game, ref.spot.preFen);
      });
      btnRow.appendChild(analyse);
    }
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'peek-action';
    closeBtn.appendChild(Icons.back(18));
    const closeLbl = document.createElement('span');
    closeLbl.textContent = 'Close';
    closeBtn.appendChild(closeLbl);
    closeBtn.addEventListener('click', close);
    btnRow.appendChild(closeBtn);
    sheet.appendChild(btnRow);

    const removePeekBack = pushBack(close);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

    ov.appendChild(sheet);
    document.body.appendChild(ov);
  }

  function doExit(): void {
    cleanup();
    opts.onExit();
  }
  function cleanup(): void {
    isCleaned = true;
    checkToken++;
    evalToken++;
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
