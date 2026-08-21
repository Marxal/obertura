// The playful "Fix it" drill for a forgotten move. Launched from the Openings
// screen's forgotten-moves carousel: you replay the one move you keep missing
// three times in a row, with a written reveal between reps to burn it in. When
// the move belongs to a saved line, the caller then runs the full line so the
// move lands back in context.
//
// Sequence per rep: load the board → animate the opponent's move in → "your
// move" → on the right move, celebrate, then fade the board out and show the
// move in big written notation for a beat → fade back → next rep. After three
// clean reps, a closing flourish, then onComplete (the caller decides whether to
// chain into the full line).

import { Chess } from 'chess.js';
import { registerBrushes, HINT_COLOR } from './board-brushes';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import { Icons } from './icons';
import { pushBack } from './back-nav';
import { playFeedback } from './sound';
import { burstConfetti } from './confetti';
import { formatMove } from './notation';

const REPS = 3;

export interface FixItMove {
  preFen: string;                    // the position before the move you must play
  san: string;                       // the move you keep missing
  colour: 'white' | 'black';         // the side you're playing (board orientation)
  count: number;                     // how often it's been missed (for the intro)
  openingName?: string | null;       // shown as the quiet subtitle
  // The opponent's move that leads INTO preFen, animated in at the start of each
  // rep so you see how the position arose. Omitted when it isn't known.
  prelude?: { uci: string; fromFen: string };
}

export interface FixItOptions {
  // True when the caller will chain into the full line after the reps — changes
  // the closing message to "Now play the full line".
  playFullLine?: boolean;
  onComplete: () => void;
  onCancel: () => void;
}

function colourToMove(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

// Little rotating encouragements, so three reps don't read identically.
const CHEERS = ['Nice!', 'Got it!', 'Yes!', 'Locked in!'];

export function startFixIt(move: FixItMove, opts: FixItOptions): void {
  const chess = new Chess();

  // Resolve the move's squares from its SAN at the start position. If it doesn't
  // match (stale data / illegal), there's nothing to drill — bail gracefully.
  chess.load(move.preFen);
  const target = chess.moves({ verbose: true }).find(m => m.san === move.san);
  if (!target) { opts.onComplete(); return; }
  const tFrom = target.from as Key;
  const tTo = target.to as Key;

  let rep = 0;            // reps completed so far
  let isCleaned = false;
  let autoTimer: ReturnType<typeof setTimeout> | undefined;

  // ── Overlay scaffold (mirrors the drill overlay, trimmed for one move) ───────

  const overlay = document.createElement('div');
  overlay.className = 'pt-overlay fixit-overlay';

  const headerEl = document.createElement('div');
  headerEl.className = 'pt-header';
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'pt-back-btn';
  backBtn.appendChild(Icons.back(15));
  backBtn.appendChild(document.createTextNode('Close'));
  backBtn.addEventListener('click', () => doExit());
  headerEl.appendChild(backBtn);

  const topEl = document.createElement('div');
  topEl.className = 'pt-top';
  const modeEl = document.createElement('div');
  modeEl.className = 'pt-mode-title';
  modeEl.textContent = 'Fix it';
  topEl.appendChild(modeEl);
  const titleEl = document.createElement('div');
  titleEl.className = 'pt-line-name';
  titleEl.textContent = move.openingName || 'Forgotten move';
  topEl.appendChild(titleEl);

  // Three rep pips, filled as each clean rep banks.
  const pipsEl = document.createElement('div');
  pipsEl.className = 'fixit-pips';
  const pips: HTMLElement[] = [];
  for (let i = 0; i < REPS; i++) {
    const pip = document.createElement('span');
    pip.className = 'fixit-pip';
    pipsEl.appendChild(pip);
    pips.push(pip);
  }
  topEl.appendChild(pipsEl);

  // ── Board + the written-reveal overlay that sits on top of it ────────────────

  const boardWrap = document.createElement('div');
  boardWrap.className = 'pt-board-wrap fixit-board-wrap';
  const boardEl = document.createElement('div');
  boardEl.className = 'pt-board fixit-board';
  boardWrap.appendChild(boardEl);

  const revealEl = document.createElement('div');
  revealEl.className = 'fixit-reveal';
  revealEl.setAttribute('hidden', '');
  const revealMove = document.createElement('div');
  revealMove.className = 'fixit-reveal-move';
  const revealSub = document.createElement('div');
  revealSub.className = 'fixit-reveal-sub';
  revealSub.textContent = 'Remember this move';
  revealEl.appendChild(revealMove);
  revealEl.appendChild(revealSub);
  boardWrap.appendChild(revealEl);

  const bottomEl = document.createElement('div');
  bottomEl.className = 'pt-bottom';
  const statusEl = document.createElement('div');
  statusEl.className = 'pt-status';
  statusEl.setAttribute('aria-live', 'polite');
  bottomEl.appendChild(statusEl);

  overlay.appendChild(headerEl);
  overlay.appendChild(topEl);
  overlay.appendChild(boardWrap);
  overlay.appendChild(bottomEl);
  document.body.appendChild(overlay);

  const removeBack = pushBack(() => doExit());

  function setStatus(text: string, variant = ''): void {
    statusEl.textContent = text;
    statusEl.className = 'pt-status' + (variant ? ' ' + variant : '');
  }

  // ── Chessground ──────────────────────────────────────────────────────────

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

  const cg = Chessground(boardEl, {
    orientation: move.colour,
    movable: { color: undefined, free: false, dests: new Map() },
    draggable: { showGhost: true },
    animation: { enabled: true, duration: 220 },
    events: { move(from, to) { onUserMove(from, to); } },
  });
  registerBrushes(cg, { accent: { color: HINT_COLOR, opacity: 0.9, lineWidth: 10 } });

  const ro = new ResizeObserver(() => cg.redrawAll());
  ro.observe(boardEl);

  function flashError(): void {
    playFeedback('wrong');
    const flash = document.createElement('div');
    flash.className = 'pt-error-flash';
    boardWrap.appendChild(flash);
    flash.addEventListener('animationend', () => flash.remove(), { once: true });
  }

  function snapBack(): void {
    cg.set({
      fen: chess.fen(),
      turnColor: cgTurn(),
      movable: { color: move.colour, dests: legalDests() },
    });
  }

  // ── Rep flow ───────────────────────────────────────────────────────────────

  // Open a rep: reset to the position, optionally animate the opponent's move in,
  // then hand control to the user.
  function startRep(): void {
    cg.setAutoShapes([]);
    revealEl.setAttribute('hidden', '');
    boardEl.classList.remove('fixit-board--faded');

    setStatus(`Round ${rep + 1} of ${REPS}`, 'pt-status--prompt');

    if (move.prelude) {
      chess.load(move.prelude.fromFen);
      cg.set({
        fen: move.prelude.fromFen,
        orientation: move.colour,
        turnColor: colourToMove(move.prelude.fromFen),
        movable: { color: undefined, dests: new Map() },
        lastMove: undefined,
      });
      const uci = move.prelude.uci;
      autoTimer = setTimeout(() => {
        if (isCleaned) return;
        const from = uci.slice(0, 2) as Key;
        const to = uci.slice(2, 4) as Key;
        chess.move({ from, to, promotion: 'q' });
        cg.set({ fen: chess.fen(), turnColor: cgTurn(), lastMove: [from, to] });
        handOver();
      }, 600);
    } else {
      chess.load(move.preFen);
      cg.set({
        fen: move.preFen,
        orientation: move.colour,
        turnColor: cgTurn(),
        movable: { color: undefined, dests: new Map() },
        lastMove: undefined,
      });
      handOver();
    }
  }

  // The board is at preFen and it's the user's turn.
  function handOver(): void {
    cg.set({ turnColor: cgTurn(), movable: { color: move.colour, dests: legalDests() } });
    setStatus('Your move', 'pt-status--prompt');
  }

  function onUserMove(from: Key, to: Key): void {
    if (isCleaned) return;
    if (from === tFrom && to === tTo) {
      chess.move({ from, to, promotion: 'q' });
      cg.set({
        fen: chess.fen(),
        turnColor: cgTurn(),
        movable: { color: undefined, dests: new Map() },
        lastMove: [from, to],
      });
      playFeedback('correct');
      burstConfetti(boardWrap);
      setStatus(CHEERS[rep % CHEERS.length], 'pt-status--success');
      rep++;
      pips[rep - 1]?.classList.add('fixit-pip--done');
      autoTimer = setTimeout(() => { if (!isCleaned) revealThenNext(); }, 700);
    } else {
      // Gentle: flash, snap back, draw the right arrow as a nudge, try again.
      flashError();
      snapBack();
      setStatus('Not that one — try again', 'pt-status--error');
      requestAnimationFrame(() => {
        if (isCleaned) return;
        cg.setAutoShapes([{ orig: tFrom, dest: tTo, brush: 'accent' }]);
      });
    }
  }

  // Fade the board out, show the move in big written notation for a beat, then
  // either start the next rep or finish.
  function revealThenNext(): void {
    boardEl.classList.add('fixit-board--faded');
    cg.setAutoShapes([]);
    revealMove.textContent = formatMove(move.san);
    revealEl.removeAttribute('hidden');
    setStatus('', '');
    autoTimer = setTimeout(() => {
      if (isCleaned) return;
      if (rep >= REPS) finish();
      else startRep();
    }, 1700);
  }

  function finish(): void {
    revealEl.setAttribute('hidden', '');
    boardEl.classList.remove('fixit-board--faded');
    cg.set({ movable: { color: undefined, dests: new Map() } });
    burstConfetti(boardWrap);
    setStatus(
      opts.playFullLine ? 'Now play the full line' : 'Fixed! 🎉',
      'pt-status--success',
    );
    autoTimer = setTimeout(() => { cleanup(); opts.onComplete(); }, 1500);
  }

  function cleanup(): void {
    isCleaned = true;
    if (autoTimer) clearTimeout(autoTimer);
    ro.disconnect();
    overlay.remove();
    removeBack();
  }

  function doExit(): void {
    cleanup();
    opts.onCancel();
  }

  // A short framing line, then into the first rep.
  setStatus(`You've missed this ${move.count}× — let's lock it in`, 'pt-status--prompt');
  autoTimer = setTimeout(() => { if (!isCleaned) startRep(); }, 900);
}
