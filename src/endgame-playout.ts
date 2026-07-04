// Play a classic endgame out against the engine. Launched from the End game
// screen's "Classic endgames" list: you're handed a textbook position and must
// reach (or hold) its result against best defence.
//
// The judge is the Lichess 7-piece tablebase (lichess-tablebase.ts) — ground
// truth. At load we ask it the position's true result; that becomes your TARGET
// (win or draw). After each of your moves we ask again: if you let the result slip
// (threw a win, or walked into a loss) the move is refused with a nudge, exactly
// like the drill. The opponent then replies with the tablebase-optimal move, so
// your technique is really tested.
//
// Everything fails soft: the tablebase host is blocked by the build/preview
// container and can be offline on a phone, so when it's unreachable we fall back to
// the LOCAL Stockfish worker for both the defence and end-state judging — you
// simply play it out and we check the final result. Reuses the .pt-* overlay look
// and the chessground + chess.js pattern from fix-it.ts / spar.ts.

import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { Icons } from './icons';
import { pushBack } from './back-nav';
import { playFeedback } from './sound';
import { burstConfetti } from './confetti';
import type { Endgame } from './endgame-catalog';
import { recordEndgameResult } from './endgame-progress';
import {
  probeTablebase, bestMove as tbBestMove, outcomeOf, inTablebaseRange,
  type TbOutcome,
} from './lichess-tablebase';

// Deep teal — the End game mode's accent (matches its Train tab).
const TINT = '#33677a';
// How long the local engine thinks per defensive move — snappy on a phone.
const ENGINE_MOVETIME = 500;
// Safety cap on your own moves, so a shuffled won position (or a held draw) always
// terminates. KBN mate needs ≤33, so 60 is comfortable headroom.
const MAX_USER_MOVES = 60;

export interface EndgamePlayoutOptions {
  onExit: () => void;             // back to the list (so it can refresh the ticks)
  onNext?: () => void;            // optional "Next endgame" chaining
}

function invert(o: TbOutcome): TbOutcome {
  return o === 'win' ? 'loss' : o === 'loss' ? 'win' : o;
}

// ── The local engine driver (a trimmed copy of spar.ts's SparEngine) ─────────────
// One Stockfish worker: ask for the best move within a movetime budget. Used for
// the defence and the fallback best-move hint when the tablebase is unreachable.
class PlayoutEngine {
  private worker: Worker;
  private ready = false;
  private queued: (() => void)[] = [];
  private resolveBest: ((uci: string | null) => void) | null = null;

  constructor(private movetime: number) {
    this.worker = new Worker(`${import.meta.env.BASE_URL}engine/stockfish.js`);
    this.worker.onmessage = (e: MessageEvent<string>) => this.onMsg(e.data);
    this.worker.onerror = (e) => console.error('[endgame] engine error', e);
    this.worker.postMessage('uci');
    this.worker.postMessage('setoption name Skill Level value 20');
    this.worker.postMessage('isready');
  }

  private onMsg(msg: string): void {
    if (typeof msg !== 'string') return;
    if (msg === 'readyok') {
      this.ready = true;
      const q = this.queued; this.queued = [];
      for (const fn of q) fn();
      return;
    }
    if (msg.startsWith('bestmove')) {
      const uci = msg.split(/\s+/)[1];
      const resolve = this.resolveBest;
      this.resolveBest = null;
      if (resolve) resolve(uci && uci !== '(none)' ? uci : null);
    }
  }

  bestMove(fen: string): Promise<string | null> {
    return new Promise((resolve) => {
      const run = () => {
        this.resolveBest = resolve;
        this.worker.postMessage(`position fen ${fen}`);
        this.worker.postMessage(`go movetime ${this.movetime}`);
      };
      if (this.ready) run(); else this.queued.push(run);
    });
  }

  destroy(): void {
    try { this.worker.terminate(); } catch { /* already gone */ }
  }
}

export function startEndgamePlayout(endgame: Endgame, opts: EndgamePlayoutOptions): void {
  const chess = new Chess(endgame.fen);
  const you = endgame.youPlay;

  // The result you must achieve, in YOUR perspective. Filled from the tablebase at
  // load (ground truth); until then, the catalogue's stated goal.
  let target: TbOutcome = endgame.goal === 'win' ? 'win' : 'draw';

  let engine: PlayoutEngine | null = null;
  const getEngine = (): PlayoutEngine => (engine ??= new PlayoutEngine(ENGINE_MOVETIME));

  let userMoves = 0;
  let mistakes = 0;              // refused (result-throwing) attempts
  let hintsUsed = 0;
  let finished = false;
  let isCleaned = false;
  let autoTimer: ReturnType<typeof setTimeout> | undefined;
  // Beat-the-clock: the wall-clock stamp of when you first got the move (after the
  // opening tablebase read), so a successful solve can bank its time (Fix 4).
  let startedAt = 0;

  // ── Overlay scaffold (mirrors fix-it.ts) ─────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'pt-overlay pt-overlay--tinted endgame-overlay';
  overlay.style.setProperty('--pt-tint', TINT);

  const headerEl = document.createElement('div');
  headerEl.className = 'pt-header';
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'pt-back-btn';
  backBtn.appendChild(Icons.back(15));
  backBtn.appendChild(document.createTextNode('End session'));
  backBtn.addEventListener('click', () => doExit());
  headerEl.appendChild(backBtn);

  const topEl = document.createElement('div');
  topEl.className = 'pt-top';
  const modeEl = document.createElement('div');
  modeEl.className = 'pt-mode-title';
  modeEl.textContent = endgame.name;
  topEl.appendChild(modeEl);
  const goalChip = document.createElement('span');
  goalChip.className = `eg-goal-chip eg-goal-chip--${endgame.goal}`;
  goalChip.textContent = endgame.goal === 'win' ? 'You must win' : 'You must draw';
  topEl.appendChild(goalChip);
  const ideaEl = document.createElement('div');
  ideaEl.className = 'pt-line-name eg-idea';
  ideaEl.textContent = endgame.idea;
  topEl.appendChild(ideaEl);

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
  bottomEl.appendChild(statusEl);
  // Actions row: a Hint while playing; Try again / Done once finished.
  const actionsEl = document.createElement('div');
  actionsEl.className = 'eg-actions';
  bottomEl.appendChild(actionsEl);

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

  // ── Chessground ──────────────────────────────────────────────────────────────
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

  const cg: Api = Chessground(boardEl, {
    fen: chess.fen(),
    orientation: you,
    turnColor: cgTurn(),
    movable: { color: undefined, free: false, dests: new Map() },
    draggable: { showGhost: true },
    animation: { enabled: true, duration: 220 },
    events: { move(from, to) { onUserMove(from as Key, to as Key); } },
  });
  cg.state.drawable.brushes['accent'] = { key: 'accent', color: '#ff9b21', opacity: 0.9, lineWidth: 10 };
  const ro = new ResizeObserver(() => cg.redrawAll());
  ro.observe(boardEl);

  function flashError(): void {
    playFeedback('wrong');
    const flash = document.createElement('div');
    flash.className = 'pt-error-flash';
    boardWrap.appendChild(flash);
    flash.addEventListener('animationend', () => flash.remove(), { once: true });
  }

  function lockBoard(): void {
    cg.set({ movable: { color: undefined, dests: new Map() } });
  }
  function handToUser(): void {
    if (startedAt === 0) startedAt = Date.now(); // start the clock on your first move
    cg.set({ turnColor: cgTurn(), movable: { color: you, dests: legalDests() } });
    setStatus('Your move', 'pt-status--prompt');
  }

  // Mate/stalemate/draw check after any move. Returns true when the game ended (and
  // the session has been finished).
  function checkTerminal(): boolean {
    if (chess.isCheckmate()) {
      // The side to move is mated. If that's the opponent, you delivered mate.
      const matedIsOpponent = cgTurn() !== you;
      if (matedIsOpponent) finish(true, 'Checkmate! 🎉');
      else finish(false, 'You got mated — try again.');
      return true;
    }
    if (chess.isStalemate() || chess.isInsufficientMaterial() ||
        chess.isThreefoldRepetition() || chess.isDraw()) {
      if (target === 'draw') finish(true, 'Held the draw! 🎉');
      else finish(false, 'It slipped to a draw — try again.');
      return true;
    }
    return false;
  }

  // Ask the tablebase whether `fen` (opponent to move, after your move) still holds
  // your target. Returns 'ok' / 'bad' / 'unknown' (unknown → we don't reject).
  async function judgeUserMove(fen: string): Promise<'ok' | 'bad' | 'unknown'> {
    if (!inTablebaseRange(fen)) return 'unknown';
    const res = await probeTablebase(fen);
    if (!res) return 'unknown';
    const userAfter = invert(outcomeOf(res.category)); // res.category is opponent's
    if (target === 'win') return userAfter === 'win' ? 'ok' : 'bad';
    if (target === 'draw') return userAfter === 'loss' ? 'bad' : 'ok';
    return 'ok';
  }

  function onUserMove(from: Key, to: Key): void {
    if (finished || isCleaned) return;
    const snapshot = chess.fen();
    // Apply on the rules engine (promotion always to queen — no underpromotion in
    // the fundamentals). chessground already restricted to legal dests.
    let ok = false;
    try { ok = !!chess.move({ from, to, promotion: 'q' }); } catch { ok = false; }
    if (!ok) { snapBack(snapshot); return; }

    const afterFen = chess.fen();
    lockBoard();
    setStatus('Checking…');
    void judgeUserMove(afterFen).then((verdict) => {
      if (finished || isCleaned) return;
      if (verdict === 'bad') {
        // Undo, flash, nudge with the best move, let them retry.
        chess.load(snapshot);
        mistakes++;
        flashError();
        cg.set({ fen: chess.fen(), turnColor: cgTurn(), lastMove: undefined });
        setStatus(target === 'win' ? 'That throws the win — try again' : 'That loses — try again', 'pt-status--error');
        handToUser();
        void showHintArrow(false);
        return;
      }
      // Accepted.
      cg.set({ fen: afterFen, turnColor: cgTurn(), lastMove: [from, to] });
      userMoves++;
      playFeedback('correct');
      if (checkTerminal()) return;
      if (userMoves >= MAX_USER_MOVES) {
        if (target === 'draw') finish(true, 'You held it — draw! 🎉');
        else finish(false, 'Taking too long — try again for a cleaner win.');
        return;
      }
      engineReply();
    });
  }

  function snapBack(fen: string): void {
    cg.set({ fen, turnColor: cgTurn(), movable: { color: you, dests: legalDests() } });
  }

  // The opponent's reply: tablebase-optimal when reachable, else local Stockfish.
  async function engineReply(): Promise<void> {
    lockBoard();
    setStatus('Engine is thinking…');
    const fen = chess.fen();
    let uci: string | null = null;
    if (inTablebaseRange(fen)) {
      const res = await probeTablebase(fen);
      if (res) uci = tbBestMove(res)?.uci ?? null;
    }
    if (!uci) uci = await getEngine().bestMove(fen);
    if (finished || isCleaned) return;
    if (!uci) { // no legal move — must be terminal
      checkTerminal();
      return;
    }
    const from = uci.slice(0, 2) as Key;
    const to = uci.slice(2, 4) as Key;
    try { chess.move({ from, to, promotion: uci.slice(4) || 'q' }); } catch { /* ignore */ }
    cg.set({ fen: chess.fen(), turnColor: cgTurn(), lastMove: [from, to] });
    if (checkTerminal()) return;
    handToUser();
  }

  // Show the best move for YOU as an arrow. `costsClean` marks a deliberate Hint
  // press (auto-nudges after a refused move don't count against a clean solve).
  async function showHintArrow(costsClean: boolean): Promise<void> {
    if (costsClean) hintsUsed++;
    const fen = chess.fen();
    let uci: string | null = null;
    if (inTablebaseRange(fen)) {
      const res = await probeTablebase(fen);
      if (res) uci = tbBestMove(res)?.uci ?? null;
    }
    if (!uci) uci = await getEngine().bestMove(fen);
    if (finished || isCleaned || !uci) return;
    cg.setAutoShapes([{ orig: uci.slice(0, 2) as Key, dest: uci.slice(2, 4) as Key, brush: 'accent' }]);
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  function mkButton(label: string, cls: string, onClick: () => void, icon?: SVGElement): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    if (icon) b.appendChild(icon);
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', onClick);
    return b;
  }

  function renderHintButton(): void {
    actionsEl.innerHTML = '';
    // Same look as the other training modes' hint (Fix 3): the shared .pz-hint-btn.
    actionsEl.appendChild(mkButton('Hint', 'pz-hint-btn', () => {
      cg.setAutoShapes([]);
      void showHintArrow(true);
    }, Icons.bulb(16)));
  }

  function finish(success: boolean, message: string): void {
    if (finished) return;
    finished = true;
    lockBoard();
    cg.setAutoShapes([]);
    const clean = success && mistakes === 0 && hintsUsed === 0;
    // Bank the time on a successful solve (Fix 4); a miss records no time.
    const elapsedMs = success && startedAt > 0 ? Date.now() - startedAt : undefined;
    recordEndgameResult(endgame.id, success, elapsedMs);
    if (success) burstConfetti(boardWrap);
    setStatus(
      clean ? `${message} Flawless.` : message,
      success ? 'pt-status--success' : 'pt-status--error',
    );
    // Results actions.
    actionsEl.innerHTML = '';
    actionsEl.appendChild(mkButton('Try again', 'btn-ghost', () => { cleanup(); startEndgamePlayout(endgame, opts); }, Icons.reset(16)));
    if (success && opts.onNext) {
      actionsEl.appendChild(mkButton('Next endgame', 'btn-primary', () => { cleanup(); opts.onNext!(); }, Icons.chevronRight(16)));
    } else {
      actionsEl.appendChild(mkButton('Done', 'btn-primary', () => { doExit(); }));
    }
  }

  function cleanup(): void {
    isCleaned = true;
    if (autoTimer) clearTimeout(autoTimer);
    ro.disconnect();
    engine?.destroy();
    engine = null;
    overlay.remove();
    removeBack();
  }

  function doExit(): void {
    cleanup();
    opts.onExit();
  }

  // ── Kick off ──────────────────────────────────────────────────────────────
  renderHintButton();
  setStatus('Reading the position…');
  // Probe the true result up front so the target is ground-truth, then start.
  void (async () => {
    if (inTablebaseRange(endgame.fen)) {
      const res = await probeTablebase(endgame.fen);
      if (res && !isCleaned) {
        const t = outcomeOf(res.category);
        if (t === 'win' || t === 'draw') target = t;
      }
    }
    if (isCleaned || finished) return;
    handToUser();
  })();
}
