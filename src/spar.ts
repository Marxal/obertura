// Spar with the engine — a casual game against the LOCAL Stockfish worker, from
// the start position, that you can freeze into a saved line at any point.
//
// This is deliberately separate from engine.ts's Engine (the eval helper, which
// tries Lichess cloud first): sparring ALWAYS uses the bundled WASM engine, so
// it works offline-ish and feels instant. We drive our own short-lived worker
// with a UCI Skill Level and a fixed, snappy movetime.
//
// The screen is a full-screen overlay (the pre-training pt- look): board,
// opening name, a status line, and three controls — Save, Undo, New game. While
// the position is still recognised by the bundled opening book we show its name;
// the first move that leaves the book pops a one-time banner, then a quiet
// "out of book" indicator stays put.

import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import { Icons } from './icons';
import { showDialog } from './dialog';
import { pushBack } from './back-nav';
import { isOutOfBook, nameForPath } from './openings';

// How the spar screen hands a finished game back to the app shell: persist the
// moves as a new auto-named line and run the post-save "add to training" dialog.
// `afterSaved` reports whether the user stayed in the spar screen ('stay' — keep
// playing / new game) or left it for training / My Lines ('left').
export type SparSaveFn = (
  ucis: string[],
  colour: 'white' | 'black',
  afterSaved: (action: 'stay' | 'left') => void,
) => void;

export interface SparOptions {
  colour: 'white' | 'black';   // the side I play
  skill: number;               // UCI Skill Level (0–20)
  levelLabel: string;          // friendly name, shown in the toolbar
  onSparSave: SparSaveFn;
}

// A short, fixed think-time so replies feel instant. The Skill Level — not the
// time — is what makes the engine easy or hard here.
const MOVETIME_MS = 300;

// ── The local engine driver ──────────────────────────────────────────────────
// A thin wrapper over a single Stockfish worker: set a skill level, then ask for
// the best move within a movetime budget. One request in flight at a time, which
// is all the turn-based spar loop needs.
class SparEngine {
  private worker: Worker;
  private ready = false;
  private queued: (() => void)[] = [];
  private resolveBest: ((uci: string | null) => void) | null = null;

  constructor(skill: number) {
    this.worker = new Worker(`${import.meta.env.BASE_URL}engine/stockfish.js`);
    this.worker.onmessage = (e: MessageEvent<string>) => this.onMsg(e.data);
    this.worker.onerror = (e) => console.error('[spar] engine error', e);
    this.worker.postMessage('uci');
    this.worker.postMessage(`setoption name Skill Level value ${skill}`);
    this.worker.postMessage('isready');
  }

  private onMsg(msg: string): void {
    if (typeof msg !== 'string') return;
    if (msg === 'readyok') {
      this.ready = true;
      const q = this.queued;
      this.queued = [];
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

  // Resolves with the engine's chosen move in UCI, or null if there is none
  // (game already over). Never rejects — the spar loop just renders the result.
  bestMove(fen: string): Promise<string | null> {
    return new Promise((resolve) => {
      const run = () => {
        this.resolveBest = resolve;
        this.worker.postMessage(`position fen ${fen}`);
        this.worker.postMessage(`go movetime ${MOVETIME_MS}`);
      };
      if (this.ready) run();
      else this.queued.push(run);
    });
  }

  destroy(): void {
    try { this.worker.terminate(); } catch { /* already gone */ }
  }
}

// ── The spar screen ──────────────────────────────────────────────────────────

export function openSpar(opts: SparOptions): void {
  const myColour = opts.colour;
  const chess = new Chess();
  const engine = new SparEngine(opts.skill);

  // Move history, kept in parallel for naming, book detection, and saving.
  const sans: string[] = [];
  const ucis: string[] = [];
  const fens: string[] = [];

  let thinking = false;       // engine is choosing a move — board is locked
  let bannerShown = false;    // the one-time out-of-book banner has fired
  let closed = false;
  // Bumped on every reset / undo / close so a slow engine reply that lands after
  // the position changed underneath it is ignored rather than corrupting state.
  let gen = 0;

  // ── DOM ──────────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'pt-overlay spar-overlay';

  const header = document.createElement('div');
  header.className = 'pt-header';
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'pt-back-btn';
  backBtn.appendChild(Icons.back(15));
  backBtn.appendChild(document.createTextNode('Done'));
  backBtn.addEventListener('click', () => close());
  const modeLabel = document.createElement('div');
  modeLabel.className = 'pt-mode-label';
  modeLabel.textContent =
    `Spar · ${opts.levelLabel} · ${myColour === 'white' ? '○ White' : '● Black'}`;
  header.appendChild(backBtn);
  header.appendChild(modeLabel);
  overlay.appendChild(header);

  const top = document.createElement('div');
  top.className = 'pt-top';
  const nameEl = document.createElement('div');
  nameEl.className = 'pt-line-name';
  const oobEl = document.createElement('div');
  oobEl.className = 'spar-oob';
  oobEl.setAttribute('hidden', '');
  oobEl.textContent = 'Out of book';
  top.appendChild(nameEl);
  top.appendChild(oobEl);
  overlay.appendChild(top);

  const boardWrap = document.createElement('div');
  boardWrap.className = 'pt-board-wrap';
  const boardEl = document.createElement('div');
  boardEl.className = 'pt-board';
  boardWrap.appendChild(boardEl);
  // The one-time "left the book" banner floats over the top of the board.
  const banner = document.createElement('div');
  banner.className = 'spar-banner';
  banner.setAttribute('hidden', '');
  banner.textContent = 'Out of book — new territory';
  boardWrap.appendChild(banner);
  overlay.appendChild(boardWrap);

  const bottom = document.createElement('div');
  bottom.className = 'spar-bottom';
  const statusEl = document.createElement('div');
  statusEl.className = 'spar-status';
  statusEl.setAttribute('aria-live', 'polite');
  bottom.appendChild(statusEl);

  const controls = document.createElement('div');
  controls.className = 'spar-controls';
  const saveBtn = ctrlButton('Save', Icons.save(16));
  const undoBtn = ctrlButton('Undo', Icons.back(16));
  const newBtn = ctrlButton('New game', Icons.reset(16));
  saveBtn.addEventListener('click', () => save());
  undoBtn.addEventListener('click', () => undoPair());
  newBtn.addEventListener('click', () => newGame());
  controls.appendChild(saveBtn);
  controls.appendChild(undoBtn);
  controls.appendChild(newBtn);
  bottom.appendChild(controls);
  overlay.appendChild(bottom);

  document.body.appendChild(overlay);

  // ── Board ──────────────────────────────────────────────────────────────────
  function legalDests(): Map<Key, Key[]> {
    const dests = new Map<Key, Key[]>();
    for (const m of chess.moves({ verbose: true })) {
      const from = m.from as Key;
      if (!dests.has(from)) dests.set(from, []);
      dests.get(from)!.push(m.to as Key);
    }
    return dests;
  }

  function turnColour(): 'white' | 'black' {
    return chess.turn() === 'w' ? 'white' : 'black';
  }

  function lastMoveKeys(): [Key, Key] | undefined {
    const u = ucis[ucis.length - 1];
    return u ? [u.slice(0, 2) as Key, u.slice(2, 4) as Key] : undefined;
  }

  const cg = Chessground(boardEl, {
    orientation: myColour,
    movable: { color: undefined, free: false, dests: new Map() },
    draggable: { showGhost: true },
    animation: { enabled: true, duration: 200 },
    events: {
      move(from, to) { onUserMove(from as Key, to as Key); },
    },
  });
  const ro = new ResizeObserver(() => cg.redrawAll());
  ro.observe(boardEl);

  // Reflect the chess.js position onto the board, locking input whenever it
  // isn't my turn (engine thinking, or game over).
  function syncBoard(): void {
    const myTurn = !thinking && !chess.isGameOver() && turnColour() === myColour;
    cg.set({
      fen: chess.fen(),
      turnColor: turnColour(),
      movable: {
        color: myTurn ? myColour : undefined,
        dests: myTurn ? legalDests() : new Map(),
      },
      lastMove: lastMoveKeys(),
    });
  }

  // ── Move flow ────────────────────────────────────────────────────────────
  function record(move: { san: string; promotion?: string }, from: string, to: string): void {
    sans.push(move.san);
    ucis.push(from + to + (move.promotion ?? ''));
    fens.push(chess.fen());
  }

  function onUserMove(from: Key, to: Key): void {
    if (thinking || chess.isGameOver()) return;
    let move;
    try { move = chess.move({ from, to, promotion: 'q' }); } catch { move = null; }
    if (!move) { syncBoard(); return; } // illegal (shouldn't happen) — resync
    record(move, from, to);
    syncBoard();
    checkBook();
    render();
    void engineReply();
  }

  async function engineReply(): Promise<void> {
    if (chess.isGameOver()) { render(); return; }
    const myGen = gen;
    thinking = true;
    syncBoard();
    render();
    const uci = await engine.bestMove(chess.fen());
    if (closed || myGen !== gen) return; // position moved on — drop this reply
    thinking = false;
    if (uci) {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = (uci[4] as 'q' | 'r' | 'b' | 'n') || undefined;
      let move;
      try { move = chess.move({ from, to, promotion: promotion ?? 'q' }); } catch { move = null; }
      if (move) record(move, from, to);
    }
    syncBoard();
    checkBook();
    render();
  }

  // ── Controls ─────────────────────────────────────────────────────────────
  // Undo takes back one full move pair — my move and the engine's reply — so I'm
  // back on move with the position I had before my last move. Disabled until a
  // full pair exists and only while it's quietly my turn.
  function undoPair(): void {
    if (thinking || ucis.length < 2 || turnColour() !== myColour) return;
    gen++; // invalidate any in-flight reply
    chess.undo();
    chess.undo();
    sans.length -= 2;
    ucis.length -= 2;
    fens.length -= 2;
    syncBoard();
    render();
  }

  function newGame(): void {
    gen++;
    thinking = false;
    chess.reset();
    sans.length = 0;
    ucis.length = 0;
    fens.length = 0;
    bannerShown = false;
    banner.setAttribute('hidden', '');
    syncBoard();
    render();
    // Playing Black means the engine opens.
    if (myColour === 'black') void engineReply();
  }

  function save(): void {
    if (ucis.length === 0) return;
    opts.onSparSave([...ucis], myColour, (action) => {
      if (closed) return;
      if (action === 'left') { close(); return; }
      // Saved, stayed: offer to keep playing or start fresh.
      showDialog({
        title: 'Line saved ✓',
        body: 'Keep playing this game, or start a fresh one?',
        buttons: [
          { label: 'New game', variant: 'secondary', onClick: () => newGame() },
          { label: 'Keep playing', variant: 'primary' },
        ],
      });
    });
  }

  // ── Book + status rendering ──────────────────────────────────────────────
  // Pop the one-time banner the first half-move the line leaves the book.
  function checkBook(): void {
    if (!bannerShown && isOutOfBook(fens)) {
      bannerShown = true;
      banner.removeAttribute('hidden');
      banner.classList.remove('spar-banner--in');
      // restart the entrance animation
      void banner.offsetWidth;
      banner.classList.add('spar-banner--in');
      window.setTimeout(() => banner.setAttribute('hidden', ''), 3600);
    }
  }

  function render(): void {
    const name = nameForPath(fens);
    nameEl.textContent = name ?? (fens.length === 0 ? 'Starting position' : 'Unknown opening');

    const oob = isOutOfBook(fens);
    oobEl.toggleAttribute('hidden', !oob);

    // Status line.
    let status: string;
    if (chess.isGameOver()) {
      status = gameOverText();
    } else if (thinking) {
      status = 'Engine is thinking…';
    } else if (turnColour() === myColour) {
      status = 'Your move';
    } else {
      status = '…';
    }
    statusEl.textContent = status;

    // Control availability.
    saveBtn.disabled = ucis.length === 0;
    undoBtn.disabled = thinking || ucis.length < 2 || turnColour() !== myColour;
  }

  function gameOverText(): string {
    if (chess.isCheckmate()) {
      // The side to move is the one mated.
      const iLost = turnColour() === myColour;
      return iLost ? 'Checkmate — you lost' : 'Checkmate — you won!';
    }
    if (chess.isStalemate()) return 'Stalemate — draw';
    if (chess.isInsufficientMaterial()) return 'Draw — insufficient material';
    if (chess.isThreefoldRepetition()) return 'Draw — repetition';
    if (chess.isDraw()) return 'Draw';
    return 'Game over';
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  function close(): void {
    if (closed) return;
    closed = true;
    gen++;
    ro.disconnect();
    engine.destroy();
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);

  // First paint, then the opening move if the engine is White.
  syncBoard();
  render();
  if (myColour === 'black') void engineReply();
}

// A labelled control button (icon + text) for the bottom bar.
function ctrlButton(label: string, icon: SVGElement): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-secondary spar-ctrl-btn';
  btn.appendChild(icon);
  btn.appendChild(document.createTextNode(label));
  return btn;
}
