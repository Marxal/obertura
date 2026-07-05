// Spar with the engine — a casual game against the LOCAL Stockfish worker, from
// the start position, that you can hand off to the builder at any point.
//
// This is deliberately separate from engine.ts's Engine (the eval helper, which
// tries Lichess cloud first): sparring ALWAYS uses the bundled WASM engine, so
// it works offline-ish and feels instant. We drive our own short-lived worker
// with a UCI Skill Level and a fixed, snappy movetime.
//
// The screen is a full-screen overlay (the pre-training pt- look): board,
// opening name, a status line, and three controls — Open in builder, Undo, New
// game. While the position is still recognised by the bundled opening book we
// show its name; the first move that leaves the book pops a one-time banner,
// then a quiet "out of book" indicator stays put.

import { Chess } from 'chess.js';
import { registerBrushes } from './board-brushes';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import { Icons } from './icons';
import { pushBack } from './back-nav';
import { isOutOfBook, nameForPath } from './openings';
import { Engine, type EvalResult } from './engine';
import { EvalPanel } from './eval-panel';

// Where the engine's opening comes from: a random book line, a line sampled from
// my imported games, or nothing at all (today's pure-engine behaviour).
export type SparMode = 'surprise' | 'games' | 'engine';

export interface SparOptions {
  colour: 'white' | 'black';   // the side I play
  skill: number;               // UCI Skill Level (0–20)
  movetimeMs: number;          // think-time budget per move
  levelLabel: string;          // friendly name, shown in the toolbar
  mode: SparMode;              // where the engine's opening comes from
  // A fresh book line (UCI sequence) for each new game, or undefined / [] for
  // none (Pure engine). The engine follows its OWN side's moves from this line
  // while the game stays on it; the first deviation hands over to Stockfish.
  nextBookLine?: () => string[];
  // Hand the game so far to the builder, oriented to my colour, instead of
  // saving it straight as a line — same path as the board browser's
  // "Open in builder".
  onOpenInBuilder: (ucis: string[], colour: 'white' | 'black') => void;
}

// How far the book layer reaches before normal engine play resumes: 6 full moves
// (12 plies). Plus a tiny pause so a booked reply doesn't teleport onto the board.
const BOOK_PLIES = 12;
const BOOK_PAUSE_MS = 250;

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── The local engine driver ──────────────────────────────────────────────────
// A thin wrapper over a single Stockfish worker: set a skill level, then ask for
// the best move within a movetime budget. One request in flight at a time, which
// is all the turn-based spar loop needs.
class SparEngine {
  private worker: Worker;
  private ready = false;
  private queued: (() => void)[] = [];
  private resolveBest: ((uci: string | null) => void) | null = null;
  private movetime: number;

  constructor(skill: number, movetime: number) {
    this.movetime = movetime;
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
        this.worker.postMessage(`go movetime ${this.movetime}`);
      };
      if (this.ready) run();
      else this.queued.push(run);
    });
  }

  destroy(): void {
    try { this.worker.terminate(); } catch { /* already gone */ }
  }
}

// ── "Suggest a move" — a one-shot local analysis ──────────────────────────────
// Separate from both SparEngine (move-playing) and engine.ts's Engine (the eval
// panel, which may use Lichess cloud): "suggest" must be LOCAL and runs MultiPV
// so we get a spread of candidates to choose a flavour from. Modest budget —
// capped at ~14 plies / ~1.2s — so it feels instant on a phone.
const SUGGEST_MULTIPV = 4;
const SUGGEST_DEPTH = 14;
const SUGGEST_MOVETIME = 1200;

// One engine candidate, scored from the SIDE-TO-MOVE's perspective (positive =
// good for the player on move) — the natural frame for "best move for me".
export interface SuggestCand { uci: string; cp?: number; mate?: number; }

export type SuggestFlavour = 'solid' | 'aggressive' | 'random';

class SuggestEngine {
  private worker: Worker;
  private ready = false;
  private queued: (() => void)[] = [];
  private resolve: ((c: SuggestCand[]) => void) | null = null;
  private lines = new Map<number, SuggestCand & { depth: number }>();
  private bestUci: string | null = null;

  constructor() {
    this.worker = new Worker(`${import.meta.env.BASE_URL}engine/stockfish.js`);
    this.worker.onmessage = (e: MessageEvent<string>) => this.onMsg(e.data);
    this.worker.onerror = (e) => console.error('[spar] suggest engine error', e);
    this.worker.postMessage('uci');
    this.worker.postMessage(`setoption name MultiPV value ${SUGGEST_MULTIPV}`);
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
    if (msg.startsWith('info') && msg.includes('multipv') && msg.includes(' pv ')) {
      const pvNum = parseInt(msg.match(/\bmultipv (\d+)/)?.[1] ?? '0');
      const uci = msg.match(/\bpv ([a-h][1-8][a-h][1-8][qrbn]?)/)?.[1];
      if (!uci || pvNum < 1) return;
      const depth = parseInt(msg.match(/\bdepth (\d+)/)?.[1] ?? '0');
      const cp = msg.match(/\bscore cp (-?\d+)/)?.[1];
      const mate = msg.match(/\bscore mate (-?\d+)/)?.[1];
      this.lines.set(pvNum, {
        uci,
        cp: cp !== undefined ? parseInt(cp) : undefined,
        mate: mate !== undefined ? parseInt(mate) : undefined,
        depth,
      });
      return;
    }
    if (msg.startsWith('bestmove')) {
      const uci = msg.split(/\s+/)[1];
      this.bestUci = uci && uci !== '(none)' ? uci : null;
      const resolve = this.resolve;
      this.resolve = null;
      if (resolve) resolve(this.collect());
    }
  }

  // Candidates best-first (MultiPV 1 is the engine's best). Falls back to the
  // bare bestmove if no multipv lines arrived (e.g. a forced single reply).
  private collect(): SuggestCand[] {
    const entries = [...this.lines.entries()].sort(([a], [b]) => a - b);
    const cands = entries.map(([, v]) => ({ uci: v.uci, cp: v.cp, mate: v.mate }));
    if (cands.length === 0 && this.bestUci) return [{ uci: this.bestUci }];
    return cands;
  }

  // Analyse fen locally; resolves with up to MultiPV candidates, best-first.
  // Never rejects — the caller just renders whatever comes back.
  analyze(fen: string): Promise<SuggestCand[]> {
    return new Promise((resolve) => {
      const run = () => {
        this.lines.clear();
        this.bestUci = null;
        this.resolve = resolve;
        this.worker.postMessage('stop'); // ignored if idle; clears any stray search
        this.worker.postMessage(`position fen ${fen}`);
        this.worker.postMessage(`go depth ${SUGGEST_DEPTH} movetime ${SUGGEST_MOVETIME}`);
      };
      if (this.ready) run();
      else this.queued.push(run);
    });
  }

  destroy(): void {
    try { this.worker.terminate(); } catch { /* already gone */ }
  }
}

// ── Suggest-flavour selection (pure, side-to-move frame) ──────────────────────
// A single comparable number per candidate, bigger = better for the mover. Mate
// scores dominate centipawns, and a nearer mate outranks a farther one.
export function candScore(c: SuggestCand): number {
  if (c.mate !== undefined) return c.mate > 0 ? 100000 - c.mate : -100000 - c.mate;
  return c.cp ?? 0;
}

// The "never a bad move" core: every flavour picks only from a SAFE SET of
// candidates within a centipawn margin of the best move.
//   Solid      = the engine's best move.
//   Random     = uniform over the safe set (within 50cp).
//   Aggressive = safe set widened to 80cp, then prefer checks, then captures,
//                then the most advancing move (score breaks ties).
// `fen` is the position to move in — needed to classify a move as check/capture.
export function chooseSuggestMove(
  flavour: SuggestFlavour,
  fen: string,
  cands: SuggestCand[],
): string | null {
  if (cands.length === 0) return null;
  const best = cands[0];
  if (flavour === 'solid') return best.uci;

  const bestCp = candScore(best);
  const within = (margin: number) => cands.filter(c => bestCp - candScore(c) <= margin);

  if (flavour === 'random') {
    const safe = within(50);
    return safe[Math.floor(Math.random() * safe.length)].uci;
  }

  // Aggressive.
  const feats = within(80).map(c => ({ c, ...classifyMove(fen, c.uci) }));
  const checks = feats.filter(f => f.check);
  if (checks.length) return topByScore(checks).c.uci;
  const caps = feats.filter(f => f.capture);
  if (caps.length) return topByScore(caps).c.uci;
  feats.sort((a, b) => b.advance - a.advance || candScore(b.c) - candScore(a.c));
  return feats[0].c.uci;
}

function topByScore<T extends { c: SuggestCand }>(items: T[]): T {
  return items.reduce((best, f) => (candScore(f.c) > candScore(best.c) ? f : best));
}

// Classify a candidate move in `fen`: does it give check, is it a capture, and
// how many ranks does the moving piece advance toward the opponent?
function classifyMove(
  fen: string,
  uci: string,
): { check: boolean; capture: boolean; advance: number } {
  try {
    const ch = new Chess(fen);
    const mover = ch.turn();
    const m = ch.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: (uci[4] as 'q' | 'r' | 'b' | 'n') || 'q',
    });
    if (!m) return { check: false, capture: false, advance: 0 };
    const check = m.san.includes('+') || m.san.includes('#');
    const capture = m.flags.includes('c') || m.flags.includes('e');
    const fromRank = parseInt(uci[1]);
    const toRank = parseInt(uci[3]);
    const advance = mover === 'w' ? toRank - fromRank : fromRank - toRank;
    return { check, capture, advance };
  } catch {
    return { check: false, capture: false, advance: 0 };
  }
}

// ── The spar screen ──────────────────────────────────────────────────────────

export function openSpar(opts: SparOptions): void {
  const myColour = opts.colour;
  const chess = new Chess();
  const engine = new SparEngine(opts.skill, opts.movetimeMs);

  // Move history, kept in parallel for naming, book detection, and saving.
  const sans: string[] = [];
  const ucis: string[] = [];
  const fens: string[] = [];

  // The current book line (UCI), refreshed for each new game. Empty in
  // Pure-engine mode, or when the chosen source had nothing to offer.
  let bookUcis: string[] = opts.nextBookLine?.() ?? [];

  let thinking = false;       // engine is choosing a move — board is locked
  let suggesting = false;     // a "suggest a move" analysis is in flight
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
  const modeWord = opts.mode === 'surprise' ? 'Surprise me'
    : opts.mode === 'games' ? 'From my games' : 'Pure engine';
  modeLabel.textContent =
    `${opts.levelLabel} · ${myColour === 'white' ? '○ White' : '● Black'} · ${modeWord}`;
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

  // Engine eval bar — sits just above the board, like the builder's. The
  // EvalPanel hides this wrapper when the engine is off; the CSS collapses the
  // empty strip so it leaves no gap.
  const evalBarEl = document.createElement('div');
  evalBarEl.className = 'spar-eval-bar';
  overlay.appendChild(evalBarEl);

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

  // Engine controls (candidate-move chips + source badge + the on/off toggle),
  // mounted by EvalPanel below the board exactly as in the builder.
  const evalControlsEl = document.createElement('div');
  evalControlsEl.className = 'spar-eval-controls';
  bottom.appendChild(evalControlsEl);

  // "Suggest a move" — three flavours that each play a vetted move for me.
  const suggestRow = document.createElement('div');
  suggestRow.className = 'spar-suggest';
  const suggestLabel = document.createElement('span');
  suggestLabel.className = 'spar-suggest-label';
  suggestLabel.textContent = 'Suggest';
  const solidBtn = suggestButton('Solid');
  const aggroBtn = suggestButton('Aggressive');
  const randomBtn = suggestButton('Random');
  solidBtn.addEventListener('click', () => void suggest('solid'));
  aggroBtn.addEventListener('click', () => void suggest('aggressive'));
  randomBtn.addEventListener('click', () => void suggest('random'));
  suggestRow.appendChild(suggestLabel);
  suggestRow.appendChild(solidBtn);
  suggestRow.appendChild(aggroBtn);
  suggestRow.appendChild(randomBtn);
  bottom.appendChild(suggestRow);

  const statusEl = document.createElement('div');
  statusEl.className = 'spar-status';
  statusEl.setAttribute('aria-live', 'polite');
  bottom.appendChild(statusEl);

  const controls = document.createElement('div');
  controls.className = 'spar-controls';
  // Styled exactly like the board browser's primary "Open in builder" — brass
  // accent, since it's the one button that leaves this screen for the builder.
  const openBuilderBtn = navBtn(Icons.reply(20), 'Open in builder', 'Open in builder', () => openInBuilder());
  openBuilderBtn.classList.add('bx-nav-btn--accent');
  const undoBtn = ctrlButton('Undo', Icons.back(16));
  const newBtn = ctrlButton('New game', Icons.reset(16));
  undoBtn.addEventListener('click', () => undoPair());
  newBtn.addEventListener('click', () => newGame());
  controls.appendChild(openBuilderBtn);
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

  // Candidate-arrow brushes: the engine's best line in solid green, the next
  // two progressively fainter; the suggest flash in the accent orange.
  registerBrushes(cg, {
    eng1: { color: '#3a9a5c', opacity: 0.9, lineWidth: 11 },
    eng2: { color: '#3a9a5c', opacity: 0.55, lineWidth: 9 },
    eng3: { color: '#3a9a5c', opacity: 0.38, lineWidth: 8 },
    flash: { color: '#ff9b21', opacity: 0.95, lineWidth: 12 },
  });

  // ── Engine analysis (toggle) + suggest ─────────────────────────────────────
  // The analysis engine drives the eval bar/panel and the candidate arrows. It
  // persists under its OWN key so the spar toggle is independent of the builder's
  // and defaults OFF. The suggest engine is a separate, local-only MultiPV worker.
  const analysisEngine = new Engine(import.meta.env.BASE_URL, (result) => {
    evalPanel.update(result, chess.fen());
    drawEngineArrows(result);
  }, 'sparEngineEnabled');

  const evalPanel = new EvalPanel(
    evalBarEl,
    evalControlsEl,
    analysisEngine.isEnabled,
    (enabled) => {
      if (enabled) { analysisEngine.enable(); refreshAnalysis(); }
      else { analysisEngine.disable(); evalPanel.clear(); cg.setAutoShapes([]); }
      // Re-sync chessground bounds after the toggle so dragging stays correct
      // (the eval bar now reserves its space, so the board itself won't move).
      cg.redrawAll();
    },
    (uci) => { playMyMove(uci); },
    { compact: true }, // one row of best moves, no PV — see eval-panel.ts
  );

  let suggestEngine: SuggestEngine | null = null; // created lazily on first use

  // Draw arrows for the engine's top lines — only while the toggle is on, it's a
  // stable (my-turn) position, and the result matches what's on the board.
  function drawEngineArrows(result: EvalResult): void {
    if (!analysisEngine.isEnabled || thinking || suggesting || result.fen !== chess.fen()) return;
    const brushes = ['eng1', 'eng2', 'eng3'];
    cg.setAutoShapes(result.moves.slice(0, 3).map((m, i) => ({
      orig: m.uci.slice(0, 2) as Key,
      dest: m.uci.slice(2, 4) as Key,
      brush: brushes[i],
    })));
  }

  // Kick a fresh analysis of the current position. No-op while the engine is
  // off; clears the board's arrows whenever it isn't a quiet, my-turn position
  // (the two engines shouldn't crunch at once, and stale arrows must not linger).
  function refreshAnalysis(): void {
    if (!analysisEngine.isEnabled) { cg.setAutoShapes([]); return; }
    if (thinking || suggesting || chess.isGameOver()) { cg.setAutoShapes([]); return; }
    cg.setAutoShapes([]);
    evalPanel.clear();
    analysisEngine.evaluate(chess.fen());
  }

  // Reflect the chess.js position onto the board, locking input whenever it
  // isn't my turn (engine thinking, suggesting, or game over).
  function syncBoard(): void {
    const myTurn = !thinking && !suggesting && !chess.isGameOver() && turnColour() === myColour;
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
    if (thinking || suggesting || chess.isGameOver()) return;
    let move;
    try { move = chess.move({ from, to, promotion: 'q' }); } catch { move = null; }
    if (!move) { syncBoard(); return; } // illegal (shouldn't happen) — resync
    record(move, from, to);
    syncBoard();
    checkBook();
    render();
    void engineReply();
  }

  // The next book move for the engine, or null to defer to Stockfish: only while
  // we're inside the opening window AND every move so far has matched the line.
  // The first deviation — mine, or the engine's own once Stockfish takes the
  // wheel — drops us off book for good (no transposition chasing).
  function bookMove(): string | null {
    const ply = ucis.length;
    if (ply >= BOOK_PLIES || ply >= bookUcis.length) return null;
    for (let i = 0; i < ply; i++) if (ucis[i] !== bookUcis[i]) return null;
    return bookUcis[ply];
  }

  async function engineReply(): Promise<void> {
    if (chess.isGameOver()) { render(); return; }
    const myGen = gen;
    thinking = true;
    syncBoard();
    render();
    cg.setAutoShapes([]); // drop my-turn arrows while the engine replies
    // Play the book move when we still have one (after a short, natural pause);
    // otherwise hand the position to Stockfish.
    const booked = bookMove();
    let uci: string | null;
    if (booked) {
      await delay(BOOK_PAUSE_MS);
      uci = booked;
    } else {
      uci = await engine.bestMove(chess.fen());
    }
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
    refreshAnalysis(); // my turn again — re-evaluate and redraw arrows
  }

  // Play a move (UCI) as MY move — used by the engine-line chips and by the
  // suggest buttons. Validates it's legal and genuinely my turn first.
  function playMyMove(uci: string): boolean {
    if (thinking || suggesting || chess.isGameOver() || turnColour() !== myColour) return false;
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = (uci[4] as 'q' | 'r' | 'b' | 'n') || 'q';
    let move;
    try { move = chess.move({ from, to, promotion }); } catch { move = null; }
    if (!move) return false;
    record(move, from, to);
    syncBoard();
    checkBook();
    render();
    void engineReply();
    return true;
  }

  // ── Suggest a move ─────────────────────────────────────────────────────────
  async function suggest(flavour: SuggestFlavour): Promise<void> {
    if (thinking || suggesting || chess.isGameOver() || turnColour() !== myColour) return;
    suggesting = true;
    const myGen = gen;
    const flavourBtns = [solidBtn, aggroBtn, randomBtn];
    for (const b of flavourBtns) b.classList.add('is-loading');
    syncBoard(); // lock the board while we think
    render();
    cg.setAutoShapes([]); // clear any engine arrows during the flash

    if (!suggestEngine) suggestEngine = new SuggestEngine();
    const fen = chess.fen();
    const cands = await suggestEngine.analyze(fen);

    // Always clear the busy state first, even if the position moved on under us.
    suggesting = false;
    for (const b of flavourBtns) b.classList.remove('is-loading');
    if (closed || myGen !== gen) return; // position moved on — drop the result

    const uci = chooseSuggestMove(flavour, fen, cands);
    if (!uci) { syncBoard(); render(); refreshAnalysis(); return; }

    // Flash an arrow on the chosen move, then play it for me.
    cg.setAutoShapes([{ orig: uci.slice(0, 2) as Key, dest: uci.slice(2, 4) as Key, brush: 'flash' }]);
    await delay(550);
    if (closed || myGen !== gen) return;
    cg.setAutoShapes([]);
    playMyMove(uci);
  }

  // ── Controls ─────────────────────────────────────────────────────────────
  // Undo takes back one full move pair — my move and the engine's reply — so I'm
  // back on move with the position I had before my last move. Disabled until a
  // full pair exists and only while it's quietly my turn.
  function undoPair(): void {
    if (thinking || suggesting || ucis.length < 2 || turnColour() !== myColour) return;
    gen++; // invalidate any in-flight reply
    chess.undo();
    chess.undo();
    sans.length -= 2;
    ucis.length -= 2;
    fens.length -= 2;
    syncBoard();
    render();
    refreshAnalysis();
  }

  function newGame(): void {
    gen++;
    thinking = false;
    suggesting = false;
    chess.reset();
    sans.length = 0;
    ucis.length = 0;
    fens.length = 0;
    bookUcis = opts.nextBookLine?.() ?? []; // a fresh opening for the new game
    bannerShown = false;
    banner.setAttribute('hidden', '');
    syncBoard();
    render();
    // Playing Black means the engine opens.
    if (myColour === 'black') void engineReply();
    else refreshAnalysis();
  }

  function openInBuilder(): void {
    if (ucis.length === 0) return;
    opts.onOpenInBuilder([...ucis], myColour);
    close();
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
    openBuilderBtn.disabled = ucis.length === 0 || suggesting;
    undoBtn.disabled = thinking || suggesting || ucis.length < 2 || turnColour() !== myColour;
    newBtn.disabled = suggesting; // don't yank the board out from under a suggest
    // Suggest only when it's quietly my turn.
    const canSuggest = !thinking && !suggesting && !chess.isGameOver() && turnColour() === myColour;
    solidBtn.disabled = !canSuggest;
    aggroBtn.disabled = !canSuggest;
    randomBtn.disabled = !canSuggest;
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
    engine.destroy();          // the move-playing SparEngine
    analysisEngine.destroy();  // the eval-panel engine
    suggestEngine?.destroy();
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);

  // First paint, then the opening move if the engine is White.
  syncBoard();
  render();
  if (myColour === 'black') void engineReply();
  else refreshAnalysis(); // show the eval bar/arrows at once if the toggle's on
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

// The board browser's stacked icon-over-label control button — reused here so
// "Open in builder" matches it exactly (see board-explorer.ts's navBtn).
function navBtn(icon: SVGElement, label: string, aria: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'bx-nav-btn';
  btn.setAttribute('aria-label', aria);
  btn.appendChild(icon);
  const span = document.createElement('span');
  span.textContent = label;
  btn.appendChild(span);
  btn.addEventListener('click', onClick);
  return btn;
}

// A "Suggest" flavour button: its label plus a dot that spins while it computes.
function suggestButton(label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-secondary spar-suggest-btn';
  const text = document.createElement('span');
  text.className = 'spar-suggest-text';
  text.textContent = label;
  const dot = document.createElement('span');
  dot.className = 'spar-suggest-spinner';
  dot.setAttribute('aria-hidden', 'true');
  btn.appendChild(text);
  btn.appendChild(dot);
  return btn;
}
