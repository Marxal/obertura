// Which move — the two-move question, as an overlay.
//
// One position out of one of your games with TWO moves drawn on it: the move
// you played, and the move the engine wanted. Pick the good one. Two buttons
// under the board name them, and the board takes the answer too — playing the
// move you believe in is the more natural way to say it, and the more useful one
// to practise.
//
// It is the smallest exercise in the app, deliberately. The mistake drill asks
// you to find a move on a blank board, which is real work; this asks you only to
// tell two moves apart, which is the skill underneath it and takes ten seconds.
//
// TWO RULES KEEP IT HONEST:
//   • ONE COLOUR for both arrows and both buttons. Colour in this app carries
//     meaning — red is a blunder, green is the engine's move — so two different
//     colours would have started answering the question. The only thing telling
//     the moves apart is the chess.
//   • the sides are shuffled every time, so neither the left button nor the
//     first arrow is ever "the answer".
//
// A wrong pick is final. With two options there is nothing left to guess, so it
// shows the answer, plays it out, and moves on — the tell-me-why is the point of
// the exercise, not a second chance at it.

import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { registerBrushes, HINT_COLOR } from './board-brushes';
import { Icons, classBoardSvg } from './icons';
import { playFeedback } from './sound';
import { pushBack } from './back-nav';
import { burstConfetti, celebratePawn } from './confetti';
import { showDialog } from './dialog';
import { formatMove, numberedMove } from './notation';
import { openInfoSheet, buildInfoButton } from './info-sheet';
import { whichMoveLog } from './middle-log';
import { explainPair } from './which-move';
import { evalPairRow } from './eval-chip';
import { buildRunHeader } from './run-header';
import { openSpotPeek, type SpotPeekOptions } from './spot-peek';
import { WHICH_MOVE_ACCENT } from './exercise-identity';
import type { SpotRef } from './mistake-scan';
import type { OpenGameCtx } from './mistake-run';
import type { ImportedGame } from './import-core';

// The one candidate colour, shared by both arrows and both buttons: the app's
// hint blue, which every board in the app already uses for "look here". Both
// candidates wear it, so it points without judging.
export const PICK_COLOR = HINT_COLOR;

export interface WhichMoveSessionOptions {
  refs: SpotRef[];
  onExit: () => void;
  onComplete?: (summary: { solved: number; completed: number }) => void;
  onPlayAgain?: () => void;
  onOpenGame?: (game: ImportedGame, ctx?: OpenGameCtx) => void;
  /** Daily challenge: the results screen's primary jumps to the next challenge. */
  nextAction?: { label: string; run: () => void };
  modeLabel?: string;
  /**
   * The session's framing, shown above the exercise's name in the run header —
   * "Daily challenge", "Your games mix". Context, not identity.
   */
  contextLabel?: string;
}

/** What this exercise is, one tap from the run itself. */
export function openWhichMoveInfo(): void {
  openInfoSheet({
    title: 'Which move',
    intro: 'A position from one of your games with two moves on it: the one you played and '
      + 'the one the engine wanted. Say which is which.',
    entries: [
      {
        icon: Icons.merge(18), accent: PICK_COLOR,
        label: 'Two moves, one question',
        detail: 'Tap the move you think is better — or just play it on the board. Both arrows '
          + 'are the same colour and they swap sides every time, so nothing but the chess '
          + 'tells you which is which.',
      },
      {
        icon: Icons.alert(18), accent: '#c93636',
        label: 'One of them cost you',
        detail: 'The wrong one is the move you actually played, in a game the engine says it '
          + 'went badly wrong. Once you have answered, it says which game, which move and '
          + 'what it cost.',
      },
      {
        icon: Icons.review(18), accent: '#3f7d8a',
        label: 'Then look properly',
        detail: 'Analyse opens the game at exactly this position, with your variations and '
          + 'notes, so a question you got wrong can turn into ten minutes of real study.',
      },
    ],
    footnote: 'The questions come from the same engine pass that finds your mistakes, so more '
      + 'appear as your games are analysed. One you answer right rests a couple of days and '
      + 'then comes back.',
  });
}

interface SessionEntry {
  ref: SpotRef;
  correct: boolean;
}

export function startWhichMoveSession(opts: WhichMoveSessionOptions): void {
  if (opts.refs.length === 0) { opts.onExit(); return; }

  const chess = new Chess();
  let cg: Api;
  let isCleaned = false;

  // Per-question state.
  let index = 0;
  let current: SpotRef = opts.refs[0];
  // The two candidates in the order they're shown: [left, right]. `bestSide` is
  // which of the two is the engine's.
  let options: { uci: string; san: string }[] = [];
  let bestSide = 0;
  let answered = false;

  let completed = 0;
  let solvedCount = 0;
  const entries: SessionEntry[] = [];

  // ── Overlay scaffold ───────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  // --compact: the shared overlay centres its board by letting the top block
  // eat the spare height, which works when the bottom is a status line. Both
  // of these carry a stack under the board (a stepper, two picks, the reveal)
  // and need that height instead — without it the primary action lands under
  // the fold on a phone.
  overlay.className = 'pt-overlay pt-overlay--puzzle pt-overlay--tinted pt-overlay--compact';
  overlay.style.setProperty('--pt-tint', '#a3492e');

  const header = buildRunHeader({
    icon: Icons.merge(18),
    title: opts.modeLabel ?? 'Which move',
    kicker: opts.contextLabel,
    accent: WHICH_MOVE_ACCENT,
    onEnd: () => exitViaButton(),
  });
  const headerEl = header.el;

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

  // Before the answer the top block says nothing about the game — the opponent
  // and the move number are part of the answer, not the question.
  const topEl = document.createElement('div');
  topEl.className = 'pt-top mr-top';
  const briefEl = document.createElement('div');
  briefEl.className = 'mr-intro dt-brief';
  const briefText = document.createElement('span');
  briefText.textContent = 'One of these two moves went wrong.';
  briefEl.appendChild(briefText);
  briefEl.appendChild(buildInfoButton('About Which move', openWhichMoveInfo));
  topEl.appendChild(briefEl);

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

  // The two picks, in one row, each in its arrow's colour.
  const picksEl = document.createElement('div');
  picksEl.className = 'wm-picks';
  const pickBtns: HTMLButtonElement[] = [0, 1].map((side) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wm-pick';
    btn.addEventListener('click', () => choose(side));
    picksEl.appendChild(btn);
    return btn;
  });

  // The story, after the answer: which game, which move, what it cost.
  const factsEl = document.createElement('div');
  factsEl.className = 'wm-facts';
  factsEl.hidden = true;

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

  bottomEl.appendChild(statusEl);
  bottomEl.appendChild(picksEl);
  bottomEl.appendChild(factsEl);
  bottomEl.appendChild(afterEl);

  overlay.appendChild(headerEl);
  if (opts.refs.length >= 2) overlay.appendChild(sessionBarEl);
  overlay.appendChild(topEl);
  overlay.appendChild(boardWrap);
  overlay.appendChild(bottomEl);
  document.body.appendChild(overlay);

  // Never viewOnly — see detective-run.ts: chessground binds its input listeners
  // once, at creation, and a board built view-only never becomes playable.
  // movable.color is what opens and closes the board here.
  cg = Chessground(boardEl, {
    orientation: 'white',
    movable: { color: undefined, free: false, dests: new Map() },
    draggable: { showGhost: true },
    animation: { enabled: true, duration: 200 },
    events: { move(from, to) { onUserMove(from as Key, to as Key); } },
  });
  registerBrushes(cg, {
    pick: { color: PICK_COLOR, opacity: 0.9, lineWidth: 11 },
  });
  const ro = new ResizeObserver(() => cg.redrawAll());
  ro.observe(boardEl);

  // ── Abandon guard ──────────────────────────────────────────────────────────
  let sessionOver = false;
  function showAbandonDialog(onStay: () => void): void {
    showDialog({
      title: 'End this session?',
      body: 'Questions you already answered are kept.',
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

  // ── Helpers ────────────────────────────────────────────────────────────────
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
  function cgTurn(): 'white' | 'black' {
    return chess.turn() === 'w' ? 'white' : 'black';
  }
  function renderSessionBar(): void {
    const total = opts.refs.length;
    sessionFillEl.style.width = `${Math.min(1, completed / total) * 100}%`;
    sessionLabelEl.textContent = `Position ${Math.min(completed + 1, total)} of ${total}`;
  }

  // Only the two candidates are playable. Anything else isn't a wrong answer,
  // it's a misunderstanding of the question — so the board simply won't do it.
  function candidateDests(): Map<Key, Key[]> {
    const dests = new Map<Key, Key[]>();
    for (const o of options) {
      const { from, to } = uciParts(o.uci);
      if (!dests.has(from)) dests.set(from, []);
      dests.get(from)!.push(to);
    }
    return dests;
  }

  // ── Loading a question ─────────────────────────────────────────────────────
  function loadSpot(): void {
    current = opts.refs[index];
    const { spot, game } = current;
    answered = false;
    afterEl.hidden = true;
    factsEl.hidden = true;
    factsEl.replaceChildren();
    picksEl.hidden = false;
    briefEl.hidden = false;
    renderSessionBar();

    const best = spot.best[0];
    const pair = [
      { uci: best.uci, san: best.san },
      { uci: spot.playedUci, san: spot.playedSan },
    ];
    // Shuffle: neither side is ever the safe bet.
    const bestFirst = Math.random() < 0.5;
    options = bestFirst ? pair : [pair[1], pair[0]];
    bestSide = bestFirst ? 0 : 1;

    chess.load(spot.preFen);
    cg.set({
      fen: spot.preFen,
      orientation: game.colour,
      turnColor: cgTurn(),
      lastMove: undefined,
      movable: { color: undefined, dests: new Map() },
    });
    paintCandidates();

    pickBtns.forEach((btn, side) => {
      btn.disabled = false;
      btn.className = 'wm-pick';
      btn.textContent = formatMove(options[side].san);
    });
    setStatus('Choose the best move', 'pt-status--prompt');

    // Hand the board over a beat later, the same pause every other drill uses.
    setTimeout(() => {
      if (isCleaned || answered) return;
      cg.set({ turnColor: cgTurn(), movable: { color: cgTurn(), dests: candidateDests() } });
      requestAnimationFrame(() => { if (!isCleaned) cg.redrawAll(); });
    }, 340);
  }

  function paintCandidates(): void {
    const shapes: DrawShape[] = options.map((o) => {
      const { from, to } = uciParts(o.uci);
      return { orig: from, dest: to, brush: 'pick' };
    });
    requestAnimationFrame(() => { if (!isCleaned) cg.setAutoShapes(shapes); });
  }

  // ── Answering ──────────────────────────────────────────────────────────────
  function onUserMove(from: Key, to: Key): void {
    if (answered) return;
    const uci4 = `${from}${to}`;
    const side = options.findIndex(o => o.uci.slice(0, 4) === uci4);
    if (side < 0) {
      // Shouldn't happen (dests are limited to the two), but never leave the
      // board in a state the question didn't ask for.
      cg.set({ fen: current.spot.preFen, turnColor: cgTurn() });
      paintCandidates();
      return;
    }
    choose(side, true);
  }

  function choose(side: number, played = false): void {
    if (answered) return;
    answered = true;
    const { spot } = current;
    const right = side === bestSide;
    completed++;
    if (right) solvedCount++;
    entries.push({ ref: current, correct: right });
    // The rest log is this exercise's whole record. It deliberately does NOT
    // touch the spot's own training state: "fixed" means you found the move on a
    // blank board in the mistake drill, and telling two moves apart is not the
    // same feat. Inflating that number here would quietly devalue it.
    if (right) whichMoveLog.solved(spot.id);
    // A wrong answer rests for a day rather than not at all. Without this the
    // picker (newest game first) dealt the question you just got wrong straight
    // back to you, over and over — see middle-log.ts.
    else whichMoveLog.seen(spot.id);

    pickBtns.forEach((btn, i) => {
      btn.disabled = true;
      btn.classList.add(i === bestSide ? 'wm-pick--best' : 'wm-pick--bad');
      if (i === side) btn.classList.add('wm-pick--chosen');
    });

    // Whichever way they answered, the board ends on the RIGHT move played out:
    // that is the thing worth remembering, so that is what is left on screen.
    const best = spot.best[0];
    const { from, to, promotion } = uciParts(best.uci);
    chess.load(spot.preFen);
    try {
      chess.move({ from, to, promotion });
    } catch { /* a stored uci should always replay */ }
    const finalFen = chess.fen();

    const showBest = (): void => {
      if (isCleaned) return;
      cg.set({
        fen: finalFen,
        animation: { enabled: true },
        lastMove: [from, to],
        turnColor: cgTurn(),
        movable: { color: undefined, dests: new Map() },
      });
      cg.setAutoShapes([{ orig: to, customSvg: classBoardSvg('best') }]);
    };
    if (played && !right) {
      // Their drag put the wrong piece somewhere; snap it back with no
      // animation, then play the right move so the correction is visible.
      cg.set({ fen: spot.preFen, animation: { enabled: false } });
      requestAnimationFrame(showBest);
    } else {
      showBest();
    }

    if (right) {
      playFeedback('correct');
      setStatus(`${formatMove(best.san)} ✓`, 'pt-status--success');
      burstConfetti(boardWrap);
    } else {
      flashError();
      setStatus(`No — ${formatMove(best.san)} was the move`, 'pt-status--error');
    }

    renderFacts();
    renderSessionBar();
    nextBtn.textContent = completed >= opts.refs.length ? 'See results' : 'Next position';
    afterEl.hidden = false;
  }

  /**
   * The reveal, in two lines. Which game it was and what you played — held back
   * until now because "vs Kevin, move 14" is a clue about a game you might
   * remember. Then the two moves side by side with what each was worth: the one
   * you played in red, the engine's in green. The numbers do the arguing, which
   * is shorter and more convincing than a sentence saying the same thing.
   */
  function renderFacts(): void {
    const { spot, game } = current;
    factsEl.replaceChildren();

    const line = document.createElement('div');
    line.className = 'wm-facts-line';
    line.appendChild(document.createTextNode(`Against ${game.opponent} you played`));
    const mv = document.createElement('span');
    mv.className = 'mr-played mr-played--blunder';
    mv.textContent = `${numberedMove(spot.playedSan, spot.ply + 1)} ??`;
    line.appendChild(mv);
    factsEl.appendChild(line);

    // …and WHY, one clause each. The two numbers alone were an argument only for
    // someone who already reads evals; explainPair (which-move.ts) turns them
    // and the board into a sentence.
    const why = explainPair(spot);
    factsEl.appendChild(evalPairRow(
      spot.playedSan, spot.evalAfter, why.played,
      spot.best[0].san, spot.evalBefore, why.best,
    ));

    factsEl.hidden = false;
  }

  function onNextTap(): void {
    if (completed >= opts.refs.length) { showResults(); return; }
    index++;
    loadSpot();
  }

  // ── Suspend for the full analyser ──────────────────────────────────────────
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
      onDiscard: () => { if (!isCleaned) cleanup(); },
    });
  }

  // ── Results ────────────────────────────────────────────────────────────────
  let resultsShown = false;
  function showResults(): void {
    if (resultsShown || isCleaned) return;
    resultsShown = true;
    sessionOver = true;
    opts.onComplete?.({ solved: solvedCount, completed });
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
    sub.textContent = `${solvedCount}/${completed} right`;
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

  // One results row — tappable, exactly like the mistake drill's: it pops the
  // question's position up right here, the move you played in red and the
  // engine's in blue, with a jump into the full analyser.
  function resultRow(e: SessionEntry, idx: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'pz-result-row pz-result-row--linked '
      + (e.correct ? 'pz-result-row--solved' : 'pz-result-row--missed');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    const open = (): void => openQuestionPeek(idx);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
    });

    const dot = document.createElement('span');
    dot.className = 'pz-result-dot';
    dot.textContent = e.correct ? '✓' : '✕';
    row.appendChild(dot);

    const main = document.createElement('div');
    main.className = 'pz-result-main';
    const name = document.createElement('div');
    name.className = 'pz-result-name';
    name.textContent = `vs ${e.ref.game.opponent}`;
    main.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'pz-result-meta';
    meta.textContent = `${formatMove(e.ref.spot.playedSan)} → ${formatMove(e.ref.spot.best[0]?.san ?? '?')}`;
    main.appendChild(meta);
    row.appendChild(main);
    return row;
  }

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
      meta: `${numberedMove(ref.spot.playedSan, ref.spot.ply + 1)} → `
        + `${formatMove(best?.san ?? '?')} · vs ${ref.game.opponent}`,
      onAnalyse: opts.onOpenGame
        ? () => suspendForAnalysis(ref.game, ref.spot.preFen)
        : undefined,
      onNav: (dir) => peekOptionsFor(idx + dir),
    };
  }
  function openQuestionPeek(idx: number): void {
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
