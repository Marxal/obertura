// The Blunder-detective drill — the overlay where you browse a short run of
// moves from one of your own games and say which one is the blunder.
//
// It shares the puzzle chrome (.pt-*) with every other exercise, and adds three
// things of its own:
//
//   • THE STEPPER. Back and forward through the run, one move at a time, with
//     the move you are looking at named in the middle. Nothing is hidden — you
//     can walk it as many times as you like before committing.
//   • THE ACCUSATION. One wide button that always names the move currently on
//     the board: "13…Nxe4 is the blunder". Wrong, and it says so and crosses
//     that move off — the run carries on. There is no penalty beyond losing the
//     clean solve, because guessing your way through six moves is still reading
//     six positions.
//   • THE ANSWER. Catching it is only half. The board then goes back to the
//     position before the blunder and asks for the move that should have been
//     played — judged instantly against the top-3 the scan stored, exactly like
//     the mistake drill, so there is no engine round-trip mid-exercise.
//
// WHOSE BLUNDER IT IS is never said until it is over. That is the exercise: in
// a real game nobody tells you whose move deserves the attention.

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
import { detectiveLog } from './middle-log';
import { buildRunHeader } from './run-header';
import { openSpotPeek } from './spot-peek';
import { DETECTIVE_ACCENT } from './exercise-identity';
import type { DetectiveRef } from './detective';
import type { OpenGameCtx } from './mistake-run';
import type { ImportedGame } from './import-core';

// How many wrong tries at the answer before the drill offers to show it. Two,
// because by then the user is guessing and the point has been made.
const TRIES_BEFORE_HINT = 2;

export interface DetectiveSessionOptions {
  refs: DetectiveRef[];
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
export function openDetectiveInfo(): void {
  openInfoSheet({
    title: 'Blunder detective',
    intro: 'A short run of moves from one of your own games, with exactly one blunder in it. '
      + 'Step through them and say which one it is — then play what should have been played.',
    entries: [
      {
        icon: Icons.moveArrow(18), accent: HINT_COLOR,
        label: 'Either side',
        detail: 'The blunder can be yours or your opponent’s, and nothing on the board says '
          + 'which. That is the point: in a game nobody tells you whose move to look at.',
      },
      {
        icon: Icons.alert(18), accent: '#c93636',
        label: 'Exactly one',
        detail: 'A run is only offered when the engine found one move over the blunder line '
          + 'in it and nothing else in it even close — so there is always one answer, and it '
          + 'is never arguable.',
      },
      {
        icon: Icons.target(18), accent: '#3f7d8a',
        label: 'Then the move',
        detail: 'Spotting it is half. The board goes back to the position before the blunder '
          + 'and asks for the move that should have been played. Any of the engine’s top '
          + 'three counts.',
      },
      {
        icon: Icons.reset(18), accent: '#c79a2a',
        label: 'Wrong guesses are free',
        detail: 'An accusation that misses crosses that move off and the run carries on. You '
          + 'only lose the clean solve — and a case you crack rests a few days before it '
          + 'comes back. One you miss rests a day, so it is back tomorrow rather than next.',
      },
      {
        icon: Icons.bulb(18), accent: '#c79a2a',
        label: 'Stuck on the answer',
        detail: 'Hint highlights the piece that should move and leaves the rest to you. Only '
          + 'once you have used it does Show solution appear, and once the case is closed so '
          + 'does Analyse, which opens the whole game at that position.',
      },
    ],
    footnote: 'The runs come from the same engine pass that finds your mistakes, so they '
      + 'appear as your games are analysed. One run per game at most.',
  });
}

interface SessionEntry {
  ref: DetectiveRef;
  clean: boolean;
}

export function startDetectiveSession(opts: DetectiveSessionOptions): void {
  if (opts.refs.length === 0) { opts.onExit(); return; }

  const chess = new Chess();
  let cg: Api;
  let isCleaned = false;

  // ── Per-case state ─────────────────────────────────────────────────────────
  let index = 0;
  let current: DetectiveRef = opts.refs[0];
  // The run, replayed: fens[i] is the position BEFORE the run's i-th move, so
  // fens has one more entry than the run has moves.
  let fens: string[] = [];
  let sans: string[] = [];
  let ucis: string[] = [];
  let cursor = 0;                 // 0 = the run's opening position, k = after move k
  let blunderIdx = 0;             // the blunder's index inside the run
  const accused = new Set<number>();
  let phase: 'browse' | 'answer' | 'done' = 'browse';
  let cleanSoFar = true;          // no wrong accusation, no reveal, no wrong move
  let wrongTries = 0;
  let revealedMove = false;
  // The answer phase's ladder: 0 nothing shown, 1 the piece highlighted, 2 the
  // whole move drawn. Offering "Show the move" as the only help meant the only
  // way to get unstuck was to be told the answer.
  let hintStage: 0 | 1 | 2 = 0;

  // Session tallies.
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
  // The Middle-game ember, same as the mistake drill — this is the same pane.
  overlay.style.setProperty('--pt-tint', '#a3492e');

  const header = buildRunHeader({
    icon: Icons.scout(18),
    title: opts.modeLabel ?? 'Blunder detective',
    kicker: opts.contextLabel,
    accent: DETECTIVE_ACCENT,
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

  // Top block: who it was against, the opening, then the brief — with the (i)
  // beside it for anyone who wants the longer version.
  const topEl = document.createElement('div');
  topEl.className = 'pt-top mr-top';
  const nameEl = document.createElement('div');
  nameEl.className = 'pt-line-name mr-opponent';
  topEl.appendChild(nameEl);
  const openingEl = document.createElement('div');
  openingEl.className = 'mr-opening';
  topEl.appendChild(openingEl);
  const briefEl = document.createElement('div');
  briefEl.className = 'mr-intro dt-brief';
  const briefText = document.createElement('span');
  briefText.textContent = 'Find the blunder — it can be yours or theirs.';
  briefEl.appendChild(briefText);
  briefEl.appendChild(buildInfoButton('About Blunder detective', openDetectiveInfo));
  topEl.appendChild(briefEl);

  const boardWrap = document.createElement('div');
  boardWrap.className = 'pt-board-wrap';
  const boardEl = document.createElement('div');
  boardEl.className = 'pt-board';
  boardWrap.appendChild(boardEl);

  const bottomEl = document.createElement('div');
  bottomEl.className = 'pt-bottom';

  // The stepper: back, the move you're looking at, forward.
  const navEl = document.createElement('div');
  navEl.className = 'dt-nav';
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'dt-nav-btn';
  prevBtn.setAttribute('aria-label', 'Previous move');
  prevBtn.appendChild(Icons.back(20));
  prevBtn.addEventListener('click', () => step(-1));
  const moveLabelEl = document.createElement('div');
  moveLabelEl.className = 'dt-move-label';
  moveLabelEl.setAttribute('aria-live', 'polite');
  const nextMoveBtn = document.createElement('button');
  nextMoveBtn.type = 'button';
  nextMoveBtn.className = 'dt-nav-btn';
  nextMoveBtn.setAttribute('aria-label', 'Next move');
  nextMoveBtn.appendChild(Icons.chevronRight(20));
  nextMoveBtn.addEventListener('click', () => step(1));
  navEl.appendChild(prevBtn);
  navEl.appendChild(moveLabelEl);
  navEl.appendChild(nextMoveBtn);

  // One pip per move in the run: where you are, what you've crossed off, and —
  // once it's over — which one it was. Tappable, so the run can be jumped about.
  const pipsEl = document.createElement('div');
  pipsEl.className = 'dt-pips';

  // The accusation — always named after the move currently on the board.
  const accuseBtn = document.createElement('button');
  accuseBtn.type = 'button';
  accuseBtn.className = 'btn-primary dt-accuse';
  accuseBtn.addEventListener('click', () => accuse());

  const statusEl = document.createElement('div');
  statusEl.className = 'pt-status';
  statusEl.setAttribute('aria-live', 'polite');

  // Two ways to get unstuck, one after the other. HINT comes first in the answer
  // phase — it highlights the piece and nothing more, which is usually all
  // anyone needs — and only once it has been used does the reveal appear.
  const hintBtn = document.createElement('button');
  hintBtn.type = 'button';
  hintBtn.className = 'pz-hint-btn dt-hint';
  hintBtn.appendChild(Icons.bulb(16));
  hintBtn.appendChild(document.createTextNode('Hint'));
  hintBtn.hidden = true;
  hintBtn.addEventListener('click', () => useHint());

  // Quiet, and deliberately not a button-shaped button: it is the way out, not
  // the way through.
  const revealBtn = document.createElement('button');
  revealBtn.type = 'button';
  revealBtn.className = 'dt-reveal';
  revealBtn.textContent = 'Show solution';
  revealBtn.addEventListener('click', () => reveal());

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
  nextBtn.textContent = 'Next case';
  nextBtn.addEventListener('click', () => onNextTap());
  afterActions.appendChild(nextBtn);
  afterEl.appendChild(afterActions);

  bottomEl.appendChild(navEl);
  bottomEl.appendChild(pipsEl);
  bottomEl.appendChild(accuseBtn);
  bottomEl.appendChild(statusEl);
  bottomEl.appendChild(hintBtn);
  bottomEl.appendChild(revealBtn);
  bottomEl.appendChild(afterEl);

  overlay.appendChild(headerEl);
  if (opts.refs.length >= 2) overlay.appendChild(sessionBarEl);
  overlay.appendChild(topEl);
  overlay.appendChild(boardWrap);
  overlay.appendChild(bottomEl);
  document.body.appendChild(overlay);

  // NOT viewOnly, even though the browse phase is look-only: chessground binds
  // its drag/click listeners once, when the board is created, and binds nothing
  // at all if viewOnly is set — a later set({viewOnly:false}) never gets them
  // back. Interaction is gated by movable.color instead, which is live state.
  cg = Chessground(boardEl, {
    orientation: 'white',
    movable: { color: undefined, free: false, dests: new Map() },
    draggable: { showGhost: true },
    animation: { enabled: true, duration: 200 },
    events: { move(from, to) { onUserMove(from as Key, to as Key); } },
  });
  registerBrushes(cg, {
    accent: { color: HINT_COLOR, opacity: 0.85, lineWidth: 10 },
    danger: { color: '#c93636', opacity: 0.8, lineWidth: 10 },
  });
  const ro = new ResizeObserver(() => cg.redrawAll());
  ro.observe(boardEl);

  // Desktop convenience — the same two steps as the arrows.
  const onKey = (e: KeyboardEvent): void => {
    if (phase !== 'browse') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  };
  window.addEventListener('keydown', onKey);

  // ── Abandon guard (mirrors the mistake drill) ──────────────────────────────
  function showAbandonDialog(onStay: () => void): void {
    showDialog({
      title: 'End this session?',
      body: 'Cases you already cracked are kept.',
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
  let sessionOver = false;

  // ── Small helpers ──────────────────────────────────────────────────────────
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
  /** Whose move the run's i-th move is, in board terms. */
  function moverAt(i: number): 'white' | 'black' {
    return (current.spot.startPly + i) % 2 === 0 ? 'white' : 'black';
  }
  /** "13…Nxe4", numbered from the game, not from the run. */
  function moveName(i: number): string {
    return numberedMove(sans[i], current.spot.startPly + i + 1);
  }
  function renderSessionBar(): void {
    const total = opts.refs.length;
    sessionFillEl.style.width = `${Math.min(1, completed / total) * 100}%`;
    sessionLabelEl.textContent = `Case ${Math.min(completed + 1, total)} of ${total}`;
  }

  // ── Loading a case ─────────────────────────────────────────────────────────
  function loadCase(): void {
    current = opts.refs[index];
    const { game, spot } = current;
    accused.clear();
    phase = 'browse';
    cleanSoFar = true;
    wrongTries = 0;
    revealedMove = false;
    hintStage = 0;
    cursor = 0;
    blunderIdx = spot.blunderPly - spot.startPly;
    afterEl.hidden = true;
    revealBtn.hidden = false;
    revealBtn.textContent = 'Show solution';
    hintBtn.hidden = true;
    hintBtn.replaceChildren(Icons.bulb(16), document.createTextNode('Hint'));
    navEl.hidden = false;
    pipsEl.hidden = false;
    accuseBtn.hidden = false;
    renderSessionBar();

    nameEl.textContent = `vs ${game.opponent}`;
    openingEl.textContent = game.opening ?? '';
    openingEl.hidden = !game.opening;
    briefEl.hidden = false;

    const run = replayRun(game, spot.startPly, spot.plies);
    fens = run.fens;
    sans = run.sans;
    ucis = run.ucis;

    // A run that won't replay in full (a game record edited or truncated since
    // the scan) can't be asked — the accusation would be about a move that
    // isn't there. Skip to the next case rather than showing a broken board.
    if (sans.length <= blunderIdx) {
      if (index + 1 < opts.refs.length) { index++; loadCase(); return; }
      showResults();
      return;
    }

    cg.set({
      orientation: game.colour,
      movable: { color: undefined, dests: new Map() },
    });
    // No prompt here. The instruction lives in the stepper (renderNav), where it
    // is beside the arrows it is telling you to press — printing it a second
    // time under the button just filled the screen with the same sentence.
    setStatus('');
    renderPips();
    goTo(0, false);
  }

  /**
   * Replay the run out of the stored game. The scan stored only where the run
   * starts and how long it is — the moves themselves are the game's, and
   * re-deriving them here means a run can never disagree with the game it came
   * from.
   */
  function replayRun(
    game: ImportedGame,
    startPly: number,
    plies: number,
  ): { fens: string[]; sans: string[]; ucis: string[] } {
    const ch = new Chess();
    const outFens: string[] = [];
    const outSans: string[] = [];
    const outUcis: string[] = [];
    const total = Math.min(game.ucis.length || game.sans.length, startPly + plies);
    for (let i = 0; i < total; i++) {
      if (i === startPly) outFens.push(ch.fen());
      let moved;
      try {
        moved = game.ucis.length
          ? ch.move({
              from: game.ucis[i].slice(0, 2),
              to: game.ucis[i].slice(2, 4),
              promotion: (game.ucis[i][4] as 'q' | 'r' | 'b' | 'n') || undefined,
            })
          : ch.move(game.sans[i]);
      } catch {
        break;
      }
      if (i >= startPly) {
        outSans.push(moved.san);
        outUcis.push(moved.from + moved.to + (moved.promotion ?? ''));
        outFens.push(ch.fen());
      }
    }
    return { fens: outFens, sans: outSans, ucis: outUcis };
  }

  /** Move the board to a point in the run. `cursor` 0 = before the first move. */
  function goTo(next: number, animate = true): void {
    cursor = Math.max(0, Math.min(sans.length, next));
    const fen = fens[cursor];
    if (!fen) return;
    chess.load(fen);
    cg.set({
      fen,
      animation: { enabled: animate },
      lastMove: cursor > 0 ? lastMoveKeys(cursor - 1) : undefined,
      turnColor: cgTurn(),
    });
    paintBrowseShapes();
    renderNav();
    renderPips();
  }

  function lastMoveKeys(i: number): [Key, Key] | undefined {
    const uci = ucis[i];
    if (!uci) return undefined;
    const { from, to } = uciParts(uci);
    return [from, to];
  }

  // While browsing, nothing is drawn but the move just played (which chessground
  // highlights itself) — an arrow anywhere would be a clue.
  function paintBrowseShapes(): void {
    requestAnimationFrame(() => { if (!isCleaned) cg.setAutoShapes([]); });
  }

  function renderNav(): void {
    prevBtn.disabled = cursor <= 0;
    nextMoveBtn.disabled = cursor >= sans.length;
    const i = cursor - 1;
    if (i < 0) {
      // Before the first move there is no move to name, so the slot carries the
      // instruction instead of the words "Before the run" — which said where
      // the board was, which the disabled arrow already said.
      moveLabelEl.textContent = 'Step through moves to name the blunder, yours or theirs';
      moveLabelEl.classList.add('dt-move-label--hint');
      moveLabelEl.classList.remove('dt-move-label--cleared');
      accuseBtn.disabled = true;
      accuseBtn.textContent = 'Step forward to a move';
      return;
    }
    moveLabelEl.textContent = moveName(i);
    moveLabelEl.classList.remove('dt-move-label--hint');
    const cleared = accused.has(i);
    moveLabelEl.classList.toggle('dt-move-label--cleared', cleared);
    accuseBtn.disabled = cleared || phase !== 'browse';
    accuseBtn.textContent = cleared
      ? `${formatMove(sans[i])} — ruled out`
      : `${formatMove(sans[i])} is the blunder`;
  }

  function renderPips(): void {
    pipsEl.replaceChildren();
    for (let i = 0; i < sans.length; i++) {
      const pip = document.createElement('button');
      pip.type = 'button';
      pip.className = 'dt-pip';
      if (i === cursor - 1) pip.classList.add('dt-pip--here');
      if (accused.has(i)) pip.classList.add('dt-pip--out');
      if (phase !== 'browse' && i === blunderIdx) pip.classList.add('dt-pip--found');
      pip.setAttribute('aria-label', moveName(i));
      pip.title = moveName(i);
      pip.addEventListener('click', () => { if (phase === 'browse') goTo(i + 1); });
      pipsEl.appendChild(pip);
    }
  }

  function step(delta: number): void {
    if (phase !== 'browse') return;
    goTo(cursor + delta);
  }

  // ── The accusation ─────────────────────────────────────────────────────────
  function accuse(): void {
    if (phase !== 'browse') return;
    const i = cursor - 1;
    if (i < 0 || accused.has(i)) return;
    if (i === blunderIdx) { caught(false); return; }

    accused.add(i);
    cleanSoFar = false;
    flashError();
    const left = sans.length - accused.size - 1;
    setStatus(
      left <= 1
        ? `${formatMove(sans[i])} is fine — one of the others, then.`
        : `${formatMove(sans[i])} is fine — keep looking.`,
      'pt-status--error',
    );
    renderNav();
    renderPips();
  }

  function reveal(): void {
    if (phase === 'browse') { cleanSoFar = false; caught(true); return; }
    // During the answer this is the SECOND rung — the hint below has already
    // pointed at the piece, and this draws the move itself.
    revealedMove = true;
    hintStage = 2;
    cleanSoFar = false;
    const best = current.spot.best[0];
    if (best) {
      paintAnswerShapes({ blunder: true, suggestUci: best.uci });
      setStatus(`Play ${formatMove(best.san)}`, 'pt-status--reveal');
    }
    hintBtn.hidden = true;
    revealBtn.hidden = true;
  }

  /**
   * The first rung: highlight the square the move starts from, and nothing else.
   * Most of the time that is enough, and it leaves the finding to the user —
   * which is the difference between a hint and an answer. Using it costs the
   * clean solve, exactly as revealing does.
   */
  function useHint(): void {
    if (phase !== 'answer' || hintStage !== 0) return;
    hintStage = 1;
    cleanSoFar = false;
    const best = current.spot.best[0];
    if (!best) { reveal(); return; }
    paintAnswerShapes({ blunder: true, hintFrom: uciParts(best.uci).from });
    setStatus('Move the highlighted piece', 'pt-status--reveal');
    hintBtn.hidden = true;
    // Only now does the full answer become available — one rung at a time.
    revealBtn.hidden = false;
    revealBtn.textContent = 'Show solution';
  }

  /**
   * The blunder is on the table — either caught or shown. The board goes back to
   * the position before it, the move is drawn in blunder red with its ?? badge,
   * and the exercise turns into "so what should it have been".
   */
  function caught(shown: boolean): void {
    phase = 'answer';
    const { spot } = current;
    playFeedback(shown ? 'wrong' : 'correct');

    navEl.hidden = true;
    accuseBtn.hidden = true;
    briefEl.hidden = true;
    renderPips();

    // Back to the position as it stood before the blunder — the move itself is
    // drawn on it in red rather than played, because this is where the answer
    // has to be given.
    chess.load(spot.preFen);
    cg.set({
      fen: spot.preFen,
      animation: { enabled: true },
      turnColor: cgTurn(),
      lastMove: undefined,
      movable: { color: undefined, dests: new Map() },
    });
    paintAnswerShapes({ blunder: true, badgeAt: uciParts(spot.playedUci).to });

    const who = spot.byUser ? 'You played' : 'They played';
    const move = `${formatMove(spot.playedSan)} ??`;
    setStatus(
      shown
        ? `${who} ${move} — now play the better move.`
        : `Caught it ✓ — ${who.toLowerCase()} ${move}. Now play the better move.`,
      shown ? 'pt-status--reveal' : 'pt-status--success',
    );
    if (!shown) burstConfetti(boardWrap);

    // The answer phase opens with a HINT, not with "show me". The reveal comes
    // back once the hint has been spent (useHint) or after a couple of wrong
    // tries (onUserMove).
    hintStage = 0;
    hintBtn.hidden = false;
    hintBtn.replaceChildren(Icons.bulb(16), document.createTextNode('Hint'));
    revealBtn.hidden = true;

    // Hand the board over to whoever blundered.
    setTimeout(() => {
      if (isCleaned || phase !== 'answer') return;
      cg.set({
        turnColor: cgTurn(),
        movable: { color: moverAt(blunderIdx), dests: legalDests() },
      });
      requestAnimationFrame(() => { if (!isCleaned) cg.redrawAll(); });
    }, 420);
  }

  // Everything drawn on the answer board lives in one call — the red blunder
  // arrow, its ?? badge and (once shown) the move that should have been played.
  function paintAnswerShapes(o: {
    blunder?: boolean;
    badgeAt?: Key;
    /** The hint's first rung: the square the right move starts from. */
    hintFrom?: Key;
    suggestUci?: string;
    solvedAt?: Key;
  } = {}): void {
    const shapes: DrawShape[] = [];
    if (o.blunder) {
      const { from, to } = uciParts(current.spot.playedUci);
      shapes.push({ orig: from, dest: to, brush: 'danger' });
    }
    if (o.hintFrom) shapes.push({ orig: o.hintFrom, brush: 'accent' });
    if (o.badgeAt) shapes.push({ orig: o.badgeAt, customSvg: classBoardSvg('blunder') });
    if (o.suggestUci) {
      const { from, to } = uciParts(o.suggestUci);
      shapes.push({ orig: from, dest: to, brush: 'accent' });
    }
    if (o.solvedAt) shapes.push({ orig: o.solvedAt, customSvg: classBoardSvg('best') });
    requestAnimationFrame(() => { if (!isCleaned) cg.setAutoShapes(shapes); });
  }

  // ── The answer ─────────────────────────────────────────────────────────────
  function onUserMove(from: Key, to: Key): void {
    if (phase !== 'answer') return;
    const { spot } = current;
    const uci4 = `${from}${to}`;
    const hit = spot.best.slice(0, 3).find(m => m.uci.slice(0, 4) === uci4);
    if (hit) { solve(hit.uci, spot.best[0].uci === hit.uci); return; }

    wrongTries++;
    cleanSoFar = false;
    flashError();
    setStatus('Not that one — try again', 'pt-status--error');
    chess.load(spot.preFen);
    cg.set({
      fen: spot.preFen,
      turnColor: cgTurn(),
      movable: { color: moverAt(blunderIdx), dests: legalDests() },
    });
    paintAnswerShapes(hintStage === 1
      ? { blunder: true, hintFrom: uciParts(spot.best[0]?.uci ?? '').from }
      : { blunder: true });
    // Two wrong tries and the reveal appears whether the hint was taken or not:
    // by then the point has been made.
    if (wrongTries >= TRIES_BEFORE_HINT && !revealedMove) {
      hintBtn.hidden = true;
      revealBtn.hidden = false;
      revealBtn.textContent = 'Show solution';
    } else if (hintStage === 0) {
      hintBtn.hidden = false;
    }
  }

  function solve(uci: string, isBest: boolean): void {
    const { spot } = current;
    phase = 'done';
    completed++;
    const clean = cleanSoFar;
    if (clean) solvedCount++;
    entries.push({ ref: current, clean });
    // Clean solves earn the long ladder; a case that needed a wrong accusation,
    // a reveal or a wrong move still stands aside for a day, so tomorrow's
    // session doesn't open on the very case that just beat you (middle-log.ts).
    if (clean) detectiveLog.solved(spot.id);
    else detectiveLog.seen(spot.id);

    const { from, to, promotion } = uciParts(uci);
    try {
      chess.move({ from, to, promotion });
    } catch { /* a stored uci should always replay; the board still shows the try */ }
    cg.set({
      fen: chess.fen(),
      turnColor: cgTurn(),
      lastMove: [from, to],
      movable: { color: undefined, dests: new Map() },
    });
    paintAnswerShapes({ solvedAt: to });

    playFeedback('correct');
    const best = spot.best[0];
    setStatus(
      isBest
        ? (clean ? 'Case closed ✓' : 'That’s the move ✓')
        : `Good move ✓ — even stronger: ${formatMove(best.san)}`,
      clean ? 'pt-status--success' : 'pt-status--reveal',
    );
    if (clean) burstConfetti(boardWrap);

    hintBtn.hidden = true;
    revealBtn.hidden = true;
    renderSessionBar();
    nextBtn.textContent = completed >= opts.refs.length ? 'See results' : 'Next case';
    // Analyse rides in here (afterEl) — the full game is worth opening once the
    // case is closed, and not a moment before.
    afterEl.hidden = false;
  }

  function onNextTap(): void {
    if (completed >= opts.refs.length) { showResults(); return; }
    index++;
    loadCase();
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
    sub.textContent = `${solvedCount}/${completed} cracked clean`;
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
      again.textContent = 'Another case';
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
  // case's position up right here (the blunder in red, the move that should
  // have been played in blue) with a jump into the full analyser.
  function resultRow(e: SessionEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'pz-result-row pz-result-row--linked '
      + (e.clean ? 'pz-result-row--solved' : 'pz-result-row--missed');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    const open = (): void => openCasePeek(e.ref);
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
    meta.textContent = `${e.ref.spot.byUser ? 'Your' : 'Their'} ${numberedMove(e.ref.spot.playedSan, e.ref.spot.blunderPly + 1)} ?? → ${formatMove(e.ref.spot.best[0]?.san ?? '?')}`;
    main.appendChild(meta);
    row.appendChild(main);
    return row;
  }

  function openCasePeek(ref: DetectiveRef): void {
    const best = ref.spot.best[0];
    openSpotPeek({
      fen: ref.spot.preFen,
      orientation: ref.game.colour,
      arrows: [
        { uci: ref.spot.playedUci, kind: 'danger' },
        ...(best ? [{ uci: best.uci, kind: 'accent' as const }] : []),
      ],
      meta: `${ref.spot.byUser ? 'Your' : 'Their'} `
        + `${numberedMove(ref.spot.playedSan, ref.spot.blunderPly + 1)} ?? → `
        + `${formatMove(best?.san ?? '?')} · vs ${ref.game.opponent}`,
      // The results screen sits over the run, so the hand-off is the same one
      // the Analyse button under the board uses — it comes back here.
      onAnalyse: opts.onOpenGame
        ? () => suspendForAnalysis(ref.game, ref.spot.preFen)
        : undefined,
    });
  }

  function doExit(): void {
    cleanup();
    opts.onExit();
  }
  function cleanup(): void {
    isCleaned = true;
    ro.disconnect();
    window.removeEventListener('keydown', onKey);
    overlay.remove();
    removeBack();
  }

  loadCase();
}
