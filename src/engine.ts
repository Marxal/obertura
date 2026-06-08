import { Chess } from 'chess.js';

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
  moves: MoveEval[];
}

export type EvalCallback = (result: EvalResult) => void;

const MAX_DEPTH = 15;
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

// ── Move grading ─────────────────────────────────────────────────────────────
// A richer cousin of isGoodAlternative: instead of a yes/no, it reports how far
// the played move is from the engine's best, and names that best move — so the
// builder can explain *why* a move is good or bad in plain language.

export type MoveClass = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export interface MoveGrade {
  classification: MoveClass;
  lossCp: number;   // centipawns lost vs the best move, mover's perspective (>= 0)
  bestSan: string;  // the engine's preferred move, in SAN
  isBest: boolean;  // the played move *is* the engine's top choice
}

// Pure, side-effect-free bucketing of a centipawn loss into a verbal grade.
// Thresholds echo training's 30 cp "good alternative" cutoff and are easy to
// tune. Exported so it can be unit-tested without the network.
export function classifyLoss(lossCp: number, isBest: boolean): MoveClass {
  if (isBest) return 'best';
  if (lossCp <= 30) return 'good';
  if (lossCp <= 90) return 'inaccuracy';
  if (lossCp <= 200) return 'mistake';
  return 'blunder';
}

// Ask Lichess cloud eval for the top lines at `preFen`, then grade `userUci`
// against the best move. Returns null on any network/parse failure or when the
// position simply isn't in the cloud — callers then show no verdict rather than
// invent one.
export async function gradeMove(preFen: string, userUci: string): Promise<MoveGrade | null> {
  try {
    const data = await cloudEval(preFen);
    if (!data?.pvs?.length) return null;

    const side = sideToMove(preFen);
    const pvs = data.pvs.slice(0, 3);
    const bestUci = pvs[0].moves?.split(' ')[0];
    const bestCp = pvToWhiteCp(pvs[0], side);
    if (!bestUci || bestCp === null) return null;

    const bestSan = uciToSan(preFen, bestUci);

    if (userUci === bestUci) {
      return { classification: 'best', lossCp: 0, bestSan, isBest: true };
    }

    // The played move's eval. If it's among the top-3 lines we have it directly;
    // otherwise (the genuinely weak moves) evaluate the resulting position once
    // more — its best-line value, white-normalised, is the played move's worth.
    let userCp: number | null = null;
    const userPv = pvs.find(pv => pv.moves?.split(' ')[0] === userUci);
    if (userPv) {
      userCp = pvToWhiteCp(userPv, side);
    } else {
      const afterFen = applyUci(preFen, userUci);
      if (afterFen) {
        const afterData = await cloudEval(afterFen);
        const afterPv = afterData?.pvs?.[0];
        // After-position eval is from the opponent's side; pvToWhiteCp normalises
        // to white either way, so it is directly comparable to bestCp.
        if (afterPv) userCp = pvToWhiteCp(afterPv, sideToMove(afterFen));
      }
    }
    if (userCp === null) return null;

    const lossCp = Math.abs(bestCp - userCp);
    return { classification: classifyLoss(lossCp, false), lossCp, bestSan, isBest: false };
  } catch {
    return null;
  }
}

// Normalise a Lichess pv entry to a white-perspective centipawn value, with
// mate scores collapsed to ±10000 sentinels. Returns null if the entry has
// neither cp nor mate.
function pvToWhiteCp(pv: { cp?: number; mate?: number }, side: 'w' | 'b'): number | null {
  if (pv.mate !== undefined) {
    const winsForSide = pv.mate > 0;
    return (side === 'w') === winsForSide ? 10000 : -10000;
  }
  if (pv.cp !== undefined) return normCp(pv.cp, side);
  return null;
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

// Apply a UCI move to a FEN, returning the resulting FEN (or null if illegal).
function applyUci(fen: string, uci: string): string | null {
  try {
    const ch = new Chess(fen);
    ch.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: (uci[4] as 'q' | 'r' | 'b' | 'n') || undefined,
    });
    return ch.fen();
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

function uciToSan(fen: string, uci: string): string {
  try {
    const ch = new Chess(fen);
    const move = ch.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: (uci[4] as 'q' | 'r' | 'b' | 'n') || undefined,
    });
    return move?.san ?? uci;
  } catch {
    return uci;
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

  constructor(baseUrl: string, cb: EvalCallback) {
    this.baseUrl = baseUrl;
    this.cb = cb;
    this._enabled = localStorage.getItem('engineEnabled') === 'true';
  }

  get isEnabled() { return this._enabled; }

  enable() {
    this._enabled = true;
    localStorage.setItem('engineEnabled', 'true');
    if (!this.worker) this.initWorker();
  }

  disable() {
    this._enabled = false;
    localStorage.setItem('engineEnabled', 'false');
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
    const moves: MoveEval[] = entries.map(([, v]) => ({
      uci: v.uci,
      san: uciToSan(this.currentFen, v.uci),
      cp: v.cp,
      mate: v.mate,
    }));
    this.cb({ fen: this.currentFen, source: 'stockfish', depth: maxDepth, moves });
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
        const uci = pv.moves?.split(' ')[0] ?? '';
        return {
          uci,
          san: uciToSan(fen, uci),
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
