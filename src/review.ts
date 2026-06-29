// Game Review — the orchestrator that turns a line of moves into a list of
// Chess.com-style grades. It walks the line, gets an engine eval for each
// position (Lichess cloud first, local Stockfish only where the cloud has no
// entry), works out how much each move cost in win%, and writes a grade onto
// each MoveNode.
//
// The pure scoring (gradeMove) is split out and self-tested, exactly like
// explain.ts: feed it fetched evals, get back a class — no network in the test.
// reviewLine does the I/O: sequencing, a per-run cache, abort, and progress.

import { cloudTopMoves, analysePosition, cancelLocalAnalysis, resolveUci } from './engine';
import type { CloudTopMove, MoveEval } from './engine';
import { bundledStats } from './explorer-stats';
import type { ExplorerDb } from './lichess-explorer';
import { cpToWin, flattenCp, classifyMove } from './winprob';
import type { MoveClass } from './winprob';
import type { MoveNode } from './tree';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Depth for the local-engine fallback — shallow on purpose: enough to rank the
// candidate moves, cheap enough to grade a whole game without melting the phone.
const ENGINE_DEPTH = 12;
// A small breather between positions so a 30-move review doesn't burst the cloud
// rate limit. Only paced when a cloud call was actually made.
const CLOUD_DELAY_MS = 120;

// ── Pure scoring ─────────────────────────────────────────────────────────────

export interface GradeArgs {
  // The engine's top moves at the PARENT position, best first, cp/mate in the
  // MOVER's perspective, ucis already normalised (standard, not king-to-rook).
  parentTop: CloudTopMove[];
  playedUci: string;
  // The mover-perspective cp of the played move, if known (from the parent list
  // or the negated child eval). When null, gradeMove tries the parent list.
  playedCp: number | null;
  inBook: boolean;
}

// Grade one move from already-fetched evals. Pure → unit-tested. Returns null
// when there isn't enough data to judge (no eval for the position / the move).
export function gradeMove(a: GradeArgs): { classification: MoveClass; cpLoss: number } | null {
  if (!a.parentTop.length) return null;
  const bestCp = flattenCp(a.parentTop[0]);
  if (bestCp === null) return null;

  let playedCp = a.playedCp;
  if (playedCp === null) {
    const mine = a.parentTop.find(m => m.uci === a.playedUci);
    if (mine) playedCp = flattenCp(mine);
  }
  if (playedCp === null) return null;

  const bestWin = cpToWin(bestCp);
  const playedWin = cpToWin(playedCp);
  const winLoss = Math.max(0, bestWin - playedWin);

  const secondCp = a.parentTop[1] ? flattenCp(a.parentTop[1]) : null;
  const secondBestGap = secondCp !== null ? Math.max(0, bestWin - cpToWin(secondCp)) : 0;

  const isBest = a.parentTop[0].uci === a.playedUci;

  const classification = classifyMove({
    isBest,
    inBook: a.inBook,
    winLoss,
    secondBestGap,
  });
  return { classification, cpLoss: Math.max(0, Math.round(bestCp - playedCp)) };
}

// ── Perspective helpers ──────────────────────────────────────────────────────

function blackToMove(fen: string): boolean {
  return fen.split(' ')[1] === 'b';
}

// Cloud evals are already mover-perspective; just normalise the ucis so they
// match our tree's standard notation (Lichess uses king-to-rook castling).
function normaliseTop(top: CloudTopMove[], fen: string): CloudTopMove[] {
  return top.map(m => ({ ...m, uci: resolveUci(fen, m.uci)?.uci ?? m.uci }));
}

// Local engine evals are WHITE-perspective; flip to the mover's perspective.
function toMoverTop(evals: MoveEval[], fen: string): CloudTopMove[] {
  const flip = blackToMove(fen);
  return evals.map(e => ({
    uci: e.uci,
    cp: e.cp === undefined ? undefined : (flip ? -e.cp : e.cp),
    mate: e.mate === undefined ? undefined : (flip ? -e.mate : e.mate),
  }));
}

// ── Batch review ─────────────────────────────────────────────────────────────

export interface ReviewOptions {
  // Allow the local Stockfish fallback for positions the cloud doesn't have.
  // Mirror the user's engine availability — off means cloud-only (skip misses).
  useEngineFallback: boolean;
  signal?: AbortSignal;
  // Called after each move is graded, so the UI can paint badges incrementally.
  onProgress?: (index: number, node: MoveNode) => void;
  // Which bundled book to check for "Book" moves. Defaults to the broad lichess one.
  db?: ExplorerDb;
}

// Top moves for a position (mover perspective, normalised ucis), cloud first then
// the local engine. Caches per run — a move's child FEN is usually the next
// move's parent FEN, which roughly halves the requests. `source` names where the
// answer came from (for the "analysed with…" tag); null on a cached/empty result.
async function topMovesFor(
  fen: string,
  cache: Map<string, CloudTopMove[] | null>,
  useEngine: boolean,
): Promise<{ top: CloudTopMove[] | null; hitCloud: boolean; source: 'cloud' | 'local' | null }> {
  if (cache.has(fen)) return { top: cache.get(fen)!, hitCloud: false, source: null };

  let top: CloudTopMove[] | null = null;
  let source: 'cloud' | 'local' | null = null;
  const cloud = await cloudTopMoves(fen);
  const hitCloud = true; // a request went out (success or miss)
  if (cloud && cloud.length) {
    top = normaliseTop(cloud, fen);
    source = 'cloud';
  } else if (useEngine) {
    const evals = await analysePosition(fen, ENGINE_DEPTH);
    if (evals.length) { top = toMoverTop(evals, fen); source = 'local'; }
  }
  cache.set(fen, top);
  return { top, hitCloud, source };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(); return; }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

// What a finished (or aborted) review used to judge the game — drives the
// discrete "analysed with…" tag on the Line tab.
export interface ReviewSummary {
  engine: 'lichess' | 'local' | 'mixed' | 'none';
}

function engineFrom(cloud: number, local: number): ReviewSummary['engine'] {
  if (cloud && local) return 'mixed';
  if (cloud) return 'lichess';
  if (local) return 'local';
  return 'none';
}

// Review a line in place, writing classification + cpLoss + evalCp onto each
// node. Walks sequentially; safe to abort via opts.signal (also stops the local
// engine). Returns which engine(s) actually answered.
export async function reviewLine(nodes: MoveNode[], opts: ReviewOptions): Promise<ReviewSummary> {
  const db = opts.db ?? 'lichess';
  const cache = new Map<string, CloudTopMove[] | null>();
  const onAbort = () => cancelLocalAnalysis();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  let cloudUses = 0, localUses = 0;

  try {
    for (let i = 0; i < nodes.length; i++) {
      if (opts.signal?.aborted) break;
      const node = nodes[i];
      const parentFen = i === 0 ? START_FEN : nodes[i - 1].fen;

      const parent = await topMovesFor(parentFen, cache, opts.useEngineFallback);
      if (opts.signal?.aborted) break;
      if (parent.source === 'cloud') cloudUses++;
      else if (parent.source === 'local') localUses++;
      const parentTop = parent.top;
      if (!parentTop || !parentTop.length) continue; // can't judge → leave ungraded

      // The played move's mover-perspective cp: from the parent list when it's a
      // top candidate, otherwise the negated best eval of the resulting position.
      let playedCp: number | null = null;
      let hitCloudChild = false;
      const mine = parentTop.find(m => m.uci === node.uci);
      if (mine) {
        playedCp = flattenCp(mine);
      } else {
        const child = await topMovesFor(node.fen, cache, opts.useEngineFallback);
        if (opts.signal?.aborted) break;
        hitCloudChild = child.hitCloud;
        const c = child.top && child.top.length ? flattenCp(child.top[0]) : null;
        if (c !== null) playedCp = -c; // opponent's best, flipped to our side
      }

      const inBook = (await bundledStats(parentFen, db))?.has(node.uci) ?? false;

      const graded = gradeMove({ parentTop, playedUci: node.uci, playedCp, inBook });
      if (graded) {
        node.classification = graded.classification;
        node.cpLoss = graded.cpLoss;
        // Eval after the move, flipped from the mover's perspective to White's so
        // the graph reads "+ = White ahead" regardless of whose move it was.
        if (playedCp !== null) {
          node.evalCp = blackToMove(parentFen) ? -playedCp : playedCp;
        }
        opts.onProgress?.(i, node);
      }

      if (parent.hitCloud || hitCloudChild) await sleep(CLOUD_DELAY_MS, opts.signal);
    }
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
  }
  return { engine: engineFrom(cloudUses, localUses) };
}

// Strip grades from a line (e.g. before a fresh review). Mutates in place.
export function clearClassifications(nodes: MoveNode[]): void {
  for (const n of nodes) {
    delete n.classification;
    delete n.cpLoss;
    delete n.evalCp;
  }
}
