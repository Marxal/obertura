import { Chess } from 'chess.js';
import type { Square } from 'chess.js';

export type EvalSource = 'lichess' | 'stockfish';

export interface MoveEval {
  uci: string;
  san: string;
  // All cp/mate values are normalised to white's perspective:
  // positive → white ahead, negative → black ahead.
  cp?: number;
  mate?: number;
  // The principal variation as SAN, starting with `san` — used to show the
  // engine's full line, not just its first move. Capped to a few plies.
  sanLine?: string[];
}

export interface EvalResult {
  fen: string;
  source: EvalSource;
  depth: number;
  // Local Stockfish only: the depth the search is climbing towards, so the
  // badge can show "local · d14…d20" while it works.
  targetDepth?: number;
  moves: MoveEval[];
}

export type EvalCallback = (result: EvalResult) => void;

const MAX_DEPTH = 20;
const LICHESS_CLOUD = 'https://lichess.org/api/cloud-eval';

// If the live Engine's worker goes this long without any output after a search
// was issued, treat it as wedged and rebuild it (see Engine.recoverWorker).
const ENGINE_WATCHDOG_MS = 6000;
// Cap a single review search so one stuck position can't stall the whole chain.
const REVIEW_TIMEOUT_MS = 6000;

// Cloud-eval works anonymously, but a Lichess token raises the rate limit and
// keeps working if Lichess tightens anonymous access. The app injects a token
// getter at boot (see setCloudAuthToken); headless self-tests never set one, so
// engine.ts stays free of the OAuth import and its window/localStorage needs.
let cloudTokenProvider: (() => Promise<string | null>) | null = null;

export function setCloudAuthToken(provider: () => Promise<string | null>): void {
  cloudTokenProvider = provider;
}

async function cloudAuthHeaders(): Promise<Record<string, string>> {
  try {
    const token = cloudTokenProvider ? await cloudTokenProvider() : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

// Returns true if userUci is a "good alternative" at this position — i.e. it
// appears in Lichess cloud's top-3 lines AND is within `threshold` centipawns
// of the best move. Falls back to false on any network/parse failure.
export async function isGoodAlternative(
  fen: string,
  userUci: string,
  threshold = 30
): Promise<boolean> {
  try {
    const url = `${LICHESS_CLOUD}?fen=${encodeURIComponent(fen)}&multiPv=3`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: await cloudAuthHeaders() });
    if (!res.ok) return false;

    const data = await res.json() as {
      pvs?: Array<{ moves?: string; cp?: number; mate?: number }>;
    };
    if (!data.pvs?.length) return false;

    const side = sideToMove(fen);

    // Normalise a Lichess pv entry to a white-perspective centipawn value.
    // Mate scores become ±10000 sentinel values.
    const pvCp = (pv: { cp?: number; mate?: number }): number | null => {
      if (pv.mate !== undefined) {
        const winsForSide = pv.mate > 0;
        return (side === 'w') === winsForSide ? 10000 : -10000;
      }
      if (pv.cp !== undefined) return normCp(pv.cp, side);
      return null;
    };

    const pvs = data.pvs.slice(0, 3);
    const bestCp = pvCp(pvs[0]);
    if (bestCp === null) return false;

    const userPv = pvs.find(pv => pv.moves?.split(' ')[0] === userUci);
    if (!userPv) return false;

    const userCp = pvCp(userPv);
    if (userCp === null) return false;

    return Math.abs(bestCp - userCp) <= threshold;
  } catch {
    return false;
  }
}

// ── Continuation lookup (for "explore this line") ────────────────────────────
// The engine's single best line from a position: the first move (for an arrow),
// a white-normalised eval, and the principal variation in both SAN and UCI so a
// caller can show "where it leads" and let the user step into it.

export interface CloudLine {
  bestUci: string;
  cp?: number;    // white perspective
  mate?: number;  // white perspective
  sanLine: string[];
  uciLine: string[];
}

export async function cloudLine(fen: string): Promise<CloudLine | null> {
  const data = await cloudEval(fen);
  const pv = data?.pvs?.[0];
  const moves = pv?.moves?.trim();
  if (!pv || !moves) return null;

  const uciAll = moves.split(/\s+/);
  if (!uciAll[0]) return null;

  // Convert the PV to SAN by replaying it; stop at the first move that doesn't
  // apply (cloud PVs are trustworthy, but stay defensive).
  const ch = new Chess(fen);
  const sanLine: string[] = [];
  const uciLine: string[] = [];
  for (const u of uciAll) {
    const r = applyUci(ch, u); // tolerant of Lichess king-to-rook castling
    if (!r) break;
    sanLine.push(r.san);
    uciLine.push(r.uci);
  }
  if (uciLine.length === 0) return null;

  const side = sideToMove(fen);
  return {
    bestUci: uciLine[0],
    cp: pv.cp !== undefined ? normCp(pv.cp, side) : undefined,
    mate: pv.mate !== undefined ? normCp(pv.mate, side) : undefined,
    sanLine,
    uciLine,
  };
}

interface CloudEval {
  pvs?: Array<{ moves?: string; cp?: number; mate?: number }>;
}

// The cloud's top moves from a position, in order (best first), with cp/mate left
// in Lichess's side-to-move (mover) perspective — handy for explaining a move
// from the mover's point of view. Null when the position isn't in the cloud.
export interface CloudTopMove { uci: string; cp?: number; mate?: number }

export async function cloudTopMoves(fen: string): Promise<CloudTopMove[] | null> {
  const data = await cloudEval(fen);
  if (!data?.pvs?.length) return null;
  return data.pvs
    .map(pv => ({ uci: pv.moves?.trim().split(/\s+/)[0] ?? '', cp: pv.cp, mate: pv.mate }))
    .filter(m => m.uci);
}

// Single multiPv=3 cloud-eval request, shared by the graders. Resolves to the
// parsed body or null on any failure.
async function cloudEval(fen: string): Promise<CloudEval | null> {
  try {
    const url = `${LICHESS_CLOUD}?fen=${encodeURIComponent(fen)}&multiPv=3`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: await cloudAuthHeaders() });
    if (!res.ok) return null;
    return await res.json() as CloudEval;
  } catch {
    return null;
  }
}

function sideToMove(fen: string): 'w' | 'b' {
  return fen.split(' ')[1] as 'w' | 'b';
}

// Normalise a UCI side-to-move centipawn value to white's perspective.
function normCp(cp: number, side: 'w' | 'b'): number {
  return side === 'w' ? cp : -cp;
}

// Lichess encodes castling as "king onto its own rook" (e1h1/e1a1/e8h8/e8a8),
// the way it stores Chess960 internally. chess.js's standard mode rejects that
// (the king can't capture its own rook), so we remap such a move to the standard
// king-two-squares destination before replaying it. Returns the standard target
// square, or null if `from`→`to` isn't a king-to-own-rook move.
function castlingTarget(ch: Chess, from: string, to: string): string | null {
  const k = ch.get(from as Square);
  const r = ch.get(to as Square);
  if (k?.type === 'k' && r?.type === 'r' && k.color === r.color && from[1] === to[1]) {
    const file = to[0] === 'h' ? 'g' : to[0] === 'a' ? 'c' : null; // kingside / queenside
    return file ? file + from[1] : null;
  }
  return null;
}

// A single move attempt that yields null instead of throwing — chess.js 1.x
// throws on an illegal move, and we want to fall through to the castling retry.
function tryMove(ch: Chess, from: string, to: string, promotion?: 'q' | 'r' | 'b' | 'n') {
  try {
    return ch.move({ from, to, promotion });
  } catch {
    return null;
  }
}

// Apply a UCI move to a LIVE board (mutating it), tolerating Lichess's
// king-to-rook castling notation. Returns the canonical SAN plus a NORMALISED,
// legal uci, or null if the move is truly illegal. Used both for one-off
// conversion and for replaying a whole PV in sequence (cloudLine).
function applyUci(ch: Chess, uci: string): { uci: string; san: string } | null {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = (uci[4] as 'q' | 'r' | 'b' | 'n') || undefined;

  const m = tryMove(ch, from, to, promotion);
  if (m) return { uci, san: m.san };

  // Standard application failed — try it as king-to-rook castling.
  const dest = castlingTarget(ch, from, to);
  if (dest) {
    const c = tryMove(ch, from, dest);
    if (c) return { uci: from + dest, san: c.san };
  }
  return null;
}

// Convert a single UCI move against `fen`, without mutating any shared board.
export function resolveUci(fen: string, uci: string): { uci: string; san: string } | null {
  try {
    return applyUci(new Chess(fen), uci);
  } catch {
    return null;
  }
}

// Replay a UCI principal variation into a SAN list (for showing the engine's
// line), capped to `cap` plies and stopping at the first move that won't apply.
function uciLineToSan(fen: string, ucis: string[], cap: number): string[] {
  const ch = new Chess(fen);
  const out: string[] = [];
  for (const u of ucis) {
    if (out.length >= cap) break;
    const r = applyUci(ch, u);
    if (!r) break;
    out.push(r.san);
  }
  return out;
}

// How many plies of each line to show.
const PV_DISPLAY_PLIES = 8;

// A parsed Stockfish "info ... multipv ... pv ..." line, white-normalised. Shared
// by the live Engine class and the one-shot analysePosition() helper so the regex
// parsing lives in exactly one place.
interface ParsedPv { pvNum: number; depth: number; uci: string; cp?: number; mate?: number; pv: string[] }

function parseMultiPvLine(line: string, fen: string): ParsedPv | null {
  if (!(line.startsWith('info') && line.includes('multipv') && line.includes(' pv '))) return null;
  const depth = parseInt(line.match(/\bdepth (\d+)/)?.[1] ?? '0');
  const pvNum = parseInt(line.match(/\bmultipv (\d+)/)?.[1] ?? '0');
  // Capture the WHOLE principal variation after " pv ", not just the first move.
  const pvMatch = line.match(/\bpv (.+?)\s*$/);
  const pv = pvMatch ? pvMatch[1].trim().split(/\s+/) : [];
  if (!pv.length || pvNum < 1) return null;
  const side = sideToMove(fen);
  const cpRaw = line.match(/\bscore cp (-?\d+)/)?.[1];
  const mateRaw = line.match(/\bscore mate (-?\d+)/)?.[1];
  return {
    pvNum, depth, uci: pv[0],
    cp: cpRaw !== undefined ? normCp(parseInt(cpRaw), side) : undefined,
    mate: mateRaw !== undefined ? normCp(parseInt(mateRaw), side) : undefined,
    pv,
  };
}

// Build white-normalised MoveEval[] from a collected multipv map for `fen`.
function evalsFromMultiPv(
  fen: string,
  multiPv: Map<number, { uci: string; cp?: number; mate?: number; pv: string[] }>,
): MoveEval[] {
  const entries = [...multiPv.entries()].sort(([a], [b]) => a - b);
  return entries.map(([, v]) => {
    const r = resolveUci(fen, v.uci);
    return {
      uci: r?.uci ?? v.uci,
      san: r?.san ?? v.uci,
      cp: v.cp,
      mate: v.mate,
      sanLine: uciLineToSan(fen, v.pv, PV_DISPLAY_PLIES),
    };
  });
}

// ── One-shot local analysis (the Game Review fallback) ───────────────────────
// A promise-per-FEN wrapper around a DEDICATED Stockfish worker, separate from
// any live Engine instance so a running review never blanks the eval panel (and
// vice-versa). One worker can only search one position at a time, so calls are
// serialised through a promise chain. Returns white-perspective MoveEval[] (same
// shape as the cloud path), or [] on any failure.

let reviewWorker: Worker | null = null;
let reviewReady = false;
let reviewChain: Promise<unknown> = Promise.resolve();
// Resolves the in-flight analyseOnce with whatever it has so far — used by
// cancelLocalAnalysis() so aborting a batch doesn't leave a promise hanging.
let inflightFinish: (() => void) | null = null;

function getReviewWorker(baseUrl: string): Promise<Worker | null> {
  if (reviewWorker && reviewReady) return Promise.resolve(reviewWorker);
  return new Promise((resolve) => {
    try {
      const w = new Worker(`${baseUrl}engine/stockfish.js`);
      w.onmessage = (e: MessageEvent<string>) => {
        if (e.data === 'readyok') { reviewReady = true; resolve(w); }
      };
      w.onerror = () => { reviewWorker = null; reviewReady = false; resolve(null); };
      reviewWorker = w;
      reviewReady = false;
      w.postMessage('uci');
      w.postMessage('setoption name MultiPV value 3');
      w.postMessage('isready');
    } catch {
      resolve(null);
    }
  });
}

function analyseOnce(fen: string, depth: number, baseUrl: string): Promise<MoveEval[]> {
  return new Promise((resolve) => {
    void (async () => {
      const worker = await getReviewWorker(baseUrl);
      if (!worker) { resolve([]); return; }
      const multiPv = new Map<number, { uci: string; cp?: number; mate?: number; pv: string[] }>();
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        inflightFinish = null;
        resolve(evalsFromMultiPv(fen, multiPv));
      };
      inflightFinish = finish;
      worker.onmessage = (e: MessageEvent<string>) => {
        const msg = e.data;
        if (typeof msg !== 'string') return;
        if (msg.startsWith('bestmove')) { finish(); return; }
        const p = parseMultiPvLine(msg, fen);
        if (p) multiPv.set(p.pvNum, { uci: p.uci, cp: p.cp, mate: p.mate, pv: p.pv });
      };
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(`go depth ${depth}`);
      // A wedged search would otherwise hang this promise forever and block every
      // later review call (they're serialised on reviewChain). Cap it: stop the
      // worker and resolve with whatever depth we reached.
      timer = setTimeout(() => {
        if (reviewWorker && reviewReady) reviewWorker.postMessage('stop');
        finish();
      }, REVIEW_TIMEOUT_MS);
    })();
  });
}

export function analysePosition(
  fen: string,
  depth = 12,
  baseUrl: string = import.meta.env.BASE_URL,
): Promise<MoveEval[]> {
  const run = reviewChain.then(() => analyseOnce(fen, depth, baseUrl));
  // Keep the chain alive even if a call rejects, so the next one still runs.
  reviewChain = run.catch(() => {});
  return run;
}

// Stop the review worker's current search and resolve the in-flight call. Safe to
// call when nothing is running.
export function cancelLocalAnalysis(): void {
  if (reviewWorker && reviewReady) reviewWorker.postMessage('stop');
  inflightFinish?.();
}

export class Engine {
  private worker: Worker | null = null;
  private workerReady = false;
  private pendingFen: string | null = null;
  private currentFen = '';
  private multiPv = new Map<number, { uci: string; cp?: number; mate?: number; depth: number; pv: string[] }>();
  private abortCtrl: AbortController | null = null;
  // Bumped on every evaluate(). A call that awaited the cloud fetch checks this
  // on resume and bails if a newer evaluate() has superseded it — without this,
  // a stale call fires `go` on the worker for an old position, overlapping the
  // live search and wedging Stockfish (AUDIT 1.3 / the intermittent freeze).
  private gen = 0;
  // Self-heal: if a search produces no output for ENGINE_WATCHDOG_MS the worker
  // is assumed wedged and rebuilt. `lastRecover` debounces against a hot loop.
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private lastRecover = 0;
  private _enabled: boolean;
  private cb: EvalCallback;
  private baseUrl: string;
  // localStorage key the on/off state persists under. Defaults to the builder's
  // key; spar passes its own so its toggle is independent and defaults OFF.
  private storageKey: string;

  constructor(baseUrl: string, cb: EvalCallback, storageKey = 'engineEnabled') {
    this.baseUrl = baseUrl;
    this.cb = cb;
    this.storageKey = storageKey;
    this._enabled = localStorage.getItem(storageKey) === 'true';
  }

  get isEnabled() { return this._enabled; }

  enable() {
    this._enabled = true;
    localStorage.setItem(this.storageKey, 'true');
    if (!this.worker) this.initWorker();
  }

  disable() {
    this._enabled = false;
    localStorage.setItem(this.storageKey, 'false');
    this.cancel();
  }

  private initWorker() {
    const url = `${this.baseUrl}engine/stockfish.js`;
    try {
      this.worker = new Worker(url);
      this.worker.onmessage = (e: MessageEvent<string>) => this.onMsg(e.data);
      this.worker.onerror = (e) => { console.error('[engine] worker error', e); this.recoverWorker(); };
      // UCI handshake — setoption before isready is fine; engine queues commands.
      this.worker.postMessage('uci');
      this.worker.postMessage('setoption name MultiPV value 3');
      this.worker.postMessage('isready');
    } catch (err) {
      console.error('[engine] failed to start worker', err);
    }
  }

  private onMsg(msg: string) {
    if (msg === 'readyok') {
      this.workerReady = true;
      if (this.pendingFen) {
        this.runSF(this.pendingFen);
        this.pendingFen = null;
      }
      return;
    }
    if (msg.startsWith('info') && msg.includes('multipv') && msg.includes(' pv ')) {
      this.armWatchdog();  // progress — worker is alive, keep waiting
      this.parseInfo(msg);
    }
    if (msg.startsWith('bestmove')) {
      this.clearWatchdog();  // search finished
      this.emit();
    }
  }

  // Search-liveness watchdog: re-armed on each `info`, cleared on `bestmove`. If
  // it ever fires, no output arrived in time → rebuild the worker and re-search.
  private armWatchdog() {
    this.clearWatchdog();
    this.watchdog = setTimeout(() => this.recoverWorker(), ENGINE_WATCHDOG_MS);
  }

  private clearWatchdog() {
    if (this.watchdog) { clearTimeout(this.watchdog); this.watchdog = null; }
  }

  // Tear down a wedged/crashed worker and rebuild it, re-issuing the current
  // search once it's ready so the eval panel heals without a page reload. Debounced
  // so a worker that errors on construction can't spin in a tight loop.
  private recoverWorker() {
    this.clearWatchdog();
    const now = Date.now();
    if (now - this.lastRecover < 3000) return;
    this.lastRecover = now;
    this.worker?.terminate();
    this.worker = null;
    this.workerReady = false;
    if (!this._enabled || !this.currentFen) return;
    this.pendingFen = this.currentFen;  // runs when the rebuilt worker signals readyok
    this.initWorker();
  }

  private parseInfo(line: string) {
    const p = parseMultiPvLine(line, this.currentFen);
    if (!p) return;
    this.multiPv.set(p.pvNum, { uci: p.uci, cp: p.cp, mate: p.mate, depth: p.depth, pv: p.pv });
    // Emit progressive updates once we have a decent depth.
    if (p.depth >= 10) this.emit();
  }

  private emit() {
    if (!this.multiPv.size) return;
    const entries = [...this.multiPv.entries()].sort(([a], [b]) => a - b);
    const maxDepth = Math.max(...entries.map(([, v]) => v.depth));
    const moves: MoveEval[] = entries.map(([, v]) => {
      const r = resolveUci(this.currentFen, v.uci);
      return {
        uci: r?.uci ?? v.uci,
        san: r?.san ?? v.uci,
        cp: v.cp,
        mate: v.mate,
        sanLine: uciLineToSan(this.currentFen, v.pv, PV_DISPLAY_PLIES),
      };
    });
    this.cb({ fen: this.currentFen, source: 'stockfish', depth: maxDepth, targetDepth: MAX_DEPTH, moves });
  }

  async evaluate(fen: string) {
    if (!this._enabled) return;
    const myGen = ++this.gen;
    this.cancel();
    this.currentFen = fen;
    this.multiPv.clear();

    const lichessResult = await this.tryLichess(fen);
    if (myGen !== this.gen) return;  // a newer evaluate() superseded us mid-fetch

    if (lichessResult) {
      this.cb(lichessResult);
      return;
    }

    // Fall back to local Stockfish WASM.
    if (!this.worker) this.initWorker();
    if (this.workerReady) {
      this.runSF(fen);
    } else {
      this.pendingFen = fen;
    }
  }

  private async tryLichess(fen: string): Promise<EvalResult | null> {
    this.abortCtrl = new AbortController();
    try {
      const url = `${LICHESS_CLOUD}?fen=${encodeURIComponent(fen)}&multiPv=3`;
      const res = await fetch(url, { signal: this.abortCtrl.signal, headers: await cloudAuthHeaders() });
      if (!res.ok) return null;

      const data = await res.json() as {
        depth?: number;
        pvs?: Array<{ moves?: string; cp?: number; mate?: number }>;
      };
      if (!data.pvs?.length) return null;

      const side = sideToMove(fen);
      const moves: MoveEval[] = data.pvs.slice(0, 3).map(pv => {
        const all = pv.moves?.trim().split(/\s+/) ?? [];
        const rawUci = all[0] ?? '';
        const r = resolveUci(fen, rawUci); // normalises Lichess king-to-rook castling
        return {
          uci: r?.uci ?? rawUci,
          san: r?.san ?? rawUci,
          cp: pv.cp !== undefined ? normCp(pv.cp, side) : undefined,
          mate: pv.mate !== undefined ? normCp(pv.mate, side) : undefined,
          sanLine: uciLineToSan(fen, all, PV_DISPLAY_PLIES),
        };
      });

      return { fen, source: 'lichess', depth: data.depth ?? 0, moves };
    } catch {
      return null;
    }
  }

  private cancel() {
    this.abortCtrl?.abort();
    this.abortCtrl = null;
    this.clearWatchdog();
    if (this.worker && this.workerReady) {
      this.worker.postMessage('stop');
    }
    this.multiPv.clear();
  }

  private runSF(fen: string) {
    this.multiPv.clear();
    // `stop` first so a stray previous search can't overlap the new one — one
    // worker searches one position at a time (mirrors spar.ts's SuggestEngine).
    this.worker!.postMessage('stop');
    this.worker!.postMessage(`position fen ${fen}`);
    this.worker!.postMessage(`go depth ${MAX_DEPTH}`);
    this.armWatchdog();
  }

  destroy() {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
    this.workerReady = false;
  }
}
