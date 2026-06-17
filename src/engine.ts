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
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
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

// Single multiPv=3 cloud-eval request, shared by the graders. Resolves to the
// parsed body or null on any failure.
async function cloudEval(fen: string): Promise<CloudEval | null> {
  try {
    const url = `${LICHESS_CLOUD}?fen=${encodeURIComponent(fen)}&multiPv=3`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
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

export class Engine {
  private worker: Worker | null = null;
  private workerReady = false;
  private pendingFen: string | null = null;
  private currentFen = '';
  private multiPv = new Map<number, { uci: string; cp?: number; mate?: number; depth: number }>();
  private abortCtrl: AbortController | null = null;
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
      this.worker.onerror = (e) => console.error('[engine] worker error', e);
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
      this.parseInfo(msg);
    }
    if (msg.startsWith('bestmove')) {
      this.emit();
    }
  }

  private parseInfo(line: string) {
    const depth = parseInt(line.match(/\bdepth (\d+)/)?.[1] ?? '0');
    const pvNum = parseInt(line.match(/\bmultipv (\d+)/)?.[1] ?? '0');
    const uciMatch = line.match(/\bpv ([a-h][1-8][a-h][1-8][qrbn]?)/);
    if (!uciMatch || pvNum < 1) return;

    const side = sideToMove(this.currentFen);
    const cpRaw = line.match(/\bscore cp (-?\d+)/)?.[1];
    const mateRaw = line.match(/\bscore mate (-?\d+)/)?.[1];

    this.multiPv.set(pvNum, {
      uci: uciMatch[1],
      cp: cpRaw !== undefined ? normCp(parseInt(cpRaw), side) : undefined,
      mate: mateRaw !== undefined ? normCp(parseInt(mateRaw), side) : undefined,
      depth,
    });

    // Emit progressive updates once we have a decent depth.
    if (depth >= 10) this.emit();
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
      };
    });
    this.cb({ fen: this.currentFen, source: 'stockfish', depth: maxDepth, targetDepth: MAX_DEPTH, moves });
  }

  async evaluate(fen: string) {
    if (!this._enabled) return;
    this.cancel();
    this.currentFen = fen;
    this.multiPv.clear();

    const lichessResult = await this.tryLichess(fen);
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
      const res = await fetch(url, { signal: this.abortCtrl.signal });
      if (!res.ok) return null;

      const data = await res.json() as {
        depth?: number;
        pvs?: Array<{ moves?: string; cp?: number; mate?: number }>;
      };
      if (!data.pvs?.length) return null;

      const side = sideToMove(fen);
      const moves: MoveEval[] = data.pvs.slice(0, 3).map(pv => {
        const rawUci = pv.moves?.split(' ')[0] ?? '';
        const r = resolveUci(fen, rawUci); // normalises Lichess king-to-rook castling
        return {
          uci: r?.uci ?? rawUci,
          san: r?.san ?? rawUci,
          cp: pv.cp !== undefined ? normCp(pv.cp, side) : undefined,
          mate: pv.mate !== undefined ? normCp(pv.mate, side) : undefined,
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
    if (this.worker && this.workerReady) {
      this.worker.postMessage('stop');
    }
    this.multiPv.clear();
  }

  private runSF(fen: string) {
    this.multiPv.clear();
    this.worker!.postMessage(`position fen ${fen}`);
    this.worker!.postMessage(`go depth ${MAX_DEPTH}`);
  }

  destroy() {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
    this.workerReady = false;
  }
}
