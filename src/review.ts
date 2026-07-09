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
import { remoteEngineEnabled, remoteTopLines } from './remote-engine';
import { isBookMove } from './book-check';
import { moveFacts, SEE_MATERIAL_MARGIN } from './move-facts';
import type { MoveFacts } from './move-facts';
import { cpToWin, flattenCp, classifyMove } from './winprob';
import type { MoveClass } from './winprob';
import type { MoveNode } from './tree';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Depth for the local-engine fallback — shallow on purpose: enough to rank the
// candidate moves, cheap enough to grade a whole game without melting the phone.
const ENGINE_DEPTH = 12;
// Hard per-position time budget for that fallback. On a slow phone a depth-12
// MultiPV-3 middlegame search can take many seconds — across a whole game that
// is the difference between a seconds-long review and a minutes-long one. The
// engine stops at depth 12 or this budget, whichever comes first.
const ENGINE_MOVETIME_MS = 1500;
// A small breather between positions so a 30-move review doesn't burst the cloud
// rate limit. Only paced when a network call was actually made.
const CLOUD_DELAY_MS = 120;
// Once the cloud misses this many positions in a row the game has left known
// theory, and later positions won't be in the cloud either — stop asking for
// the rest of the line and go straight to the deeper tiers (same cutoff the
// mistake scan uses). Saves a round-trip per position on the whole out-of-book
// tail, and keeps 60 pointless requests from nudging the rate limit.
const CLOUD_MISS_STREAK = 3;

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
  // Board facts (forced? recapture? sacrifice?) from move-facts.ts. Optional so
  // the classifier degrades gracefully when a caller can't supply them.
  facts?: MoveFacts | null;
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

  const seeNet = a.facts?.seeNet ?? null;
  const classification = classifyMove({
    isBest,
    inBook: a.inBook,
    winLoss,
    secondBestGap,
    onlyMove: a.facts?.onlyMove,
    trivialRecapture: a.facts?.trivialRecapture,
    sacrifice: seeNet !== null && seeNet <= -SEE_MATERIAL_MARGIN,
    freeCapture: seeNet !== null && seeNet >= SEE_MATERIAL_MARGIN,
    playedWin,
    bestWin,
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
  // Skip nodes that are already graded (live analysis re-runs): only fill in the
  // gaps, never re-grade. Off (default) grades every node passed in.
  skipGraded?: boolean;
  // A caller-owned eval cache to share across runs (live analysis keeps one alive
  // for the whole session so incremental grades reuse earlier lookups). When
  // omitted, the run uses a fresh cache.
  cache?: Map<string, CloudTopMove[] | null>;
}

// One position lookup's outcome, summed across a grade's one-or-two lookups so
// the batch loop can pace itself (hitNetwork) and run the cloud miss-streak
// cutoff (cloudHits/cloudMisses).
interface LookupStats {
  hitNetwork: boolean;
  cloudHits: number;
  cloudMisses: number;
}

function addLookup(s: LookupStats, l: { cloud: 'hit' | 'miss' | 'skipped'; source: EngineSource | null }): void {
  if (l.cloud !== 'skipped' || l.source === 'remote') s.hitNetwork = true;
  if (l.cloud === 'hit') s.cloudHits++;
  if (l.cloud === 'miss') s.cloudMisses++;
}

type EngineSource = 'cloud' | 'remote' | 'local';

// Grade a single node in place from its parent position — the per-move unit the
// batch loop runs, exposed so live analysis can grade one freshly-played move
// without re-walking the line. Writes classification + cpLoss + evalCp on a
// successful grade. `source` names the engine that answered the PARENT lookup
// (for the "analysed with…" tag); the LookupStats fields tell the batch loop
// whether any network call went out and how the cloud answered.
export async function gradeNode(
  node: MoveNode,
  parentFen: string,
  cache: Map<string, CloudTopMove[] | null>,
  opts: {
    useEngineFallback: boolean;
    signal?: AbortSignal;
    // Every SAN from the game start up to AND INCLUDING this move — the opening
    // library is line-shaped, so book detection needs the whole path. Without
    // it, only named positions (transpositions) count as book.
    sanPath?: string[];
    // The opponent's previous move, for spotting routine recaptures.
    prevUci?: string;
    // Ask the Lichess cloud at all? The batch loop turns this off once the line
    // has clearly left book (the miss-streak cutoff). Default on.
    tryCloud?: boolean;
  },
): Promise<{ graded: boolean; source: EngineSource | null } & LookupStats> {
  const stats: LookupStats = { hitNetwork: false, cloudHits: 0, cloudMisses: 0 };
  const tryCloud = opts.tryCloud !== false;

  const parent = await topMovesFor(parentFen, cache, opts.useEngineFallback, tryCloud);
  addLookup(stats, parent);
  if (opts.signal?.aborted) return { graded: false, source: parent.source, ...stats };
  const parentTop = parent.top;
  if (!parentTop || !parentTop.length) return { graded: false, source: parent.source, ...stats };

  // The played move's mover-perspective cp: from the parent list when it's a top
  // candidate, otherwise the negated best eval of the resulting position.
  let playedCp: number | null = null;
  const mine = parentTop.find(m => m.uci === node.uci);
  if (mine) {
    playedCp = flattenCp(mine);
  } else {
    const child = await topMovesFor(node.fen, cache, opts.useEngineFallback, tryCloud);
    addLookup(stats, child);
    if (opts.signal?.aborted) return { graded: false, source: parent.source, ...stats };
    const c = child.top && child.top.length ? flattenCp(child.top[0]) : null;
    if (c !== null) playedCp = -c; // opponent's best, flipped to our side
  }

  const inBook = await isBookMove(opts.sanPath ?? [], node.fen);
  const facts = moveFacts(parentFen, node.uci, opts.prevUci);

  const graded = gradeMove({ parentTop, playedUci: node.uci, playedCp, inBook, facts });
  if (graded) {
    node.classification = graded.classification;
    node.cpLoss = graded.cpLoss;
    // Eval after the move, flipped from the mover's perspective to White's so the
    // graph reads "+ = White ahead" regardless of whose move it was.
    if (playedCp !== null) {
      node.evalCp = blackToMove(parentFen) ? -playedCp : playedCp;
    }
  }
  return { graded: !!graded, source: parent.source, ...stats };
}

// Top moves for a position (mover perspective, normalised ucis), best source
// first: Lichess cloud (when `tryCloud`), then chess-api.com when its Settings
// toggle is on, then the local engine. Caches per run — a move's child FEN is
// usually the next move's parent FEN, which roughly halves the requests.
// `source` names where the answer came from (for the "analysed with…" tag);
// null on a cached/empty result. `cloud` says how Lichess answered, feeding the
// batch loop's miss-streak cutoff.
async function topMovesFor(
  fen: string,
  cache: Map<string, CloudTopMove[] | null>,
  useEngine: boolean,
  tryCloud: boolean,
): Promise<{ top: CloudTopMove[] | null; cloud: 'hit' | 'miss' | 'skipped'; source: EngineSource | null }> {
  if (cache.has(fen)) return { top: cache.get(fen)!, cloud: 'skipped', source: null };

  let top: CloudTopMove[] | null = null;
  let source: EngineSource | null = null;
  let cloud: 'hit' | 'miss' | 'skipped' = 'skipped';
  if (tryCloud) {
    const c = await cloudTopMoves(fen);
    cloud = c && c.length ? 'hit' : 'miss';
    if (c && c.length) {
      top = normaliseTop(c, fen);
      source = 'cloud';
    }
  }
  if (!top && remoteEngineEnabled()) {
    const remote = await remoteTopLines(fen); // white-perspective
    if (remote && remote.length) { top = toMoverTop(remote, fen); source = 'remote'; }
  }
  if (!top && useEngine) {
    const evals = await analysePosition(fen, ENGINE_DEPTH, undefined, { movetimeMs: ENGINE_MOVETIME_MS });
    if (evals.length) { top = toMoverTop(evals, fen); source = 'local'; }
  }
  cache.set(fen, top);
  return { top, cloud, source };
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
  engine: 'lichess' | 'remote' | 'local' | 'mixed' | 'none';
}

function engineFrom(cloud: number, remote: number, local: number): ReviewSummary['engine'] {
  const used = [cloud, remote, local].filter(n => n > 0).length;
  if (used > 1) return 'mixed';
  if (cloud) return 'lichess';
  if (remote) return 'remote';
  if (local) return 'local';
  return 'none';
}

// Review a line in place, writing classification + cpLoss + evalCp onto each
// node. Walks sequentially; safe to abort via opts.signal (also stops the local
// engine). Returns which engine(s) actually answered.
export async function reviewLine(nodes: MoveNode[], opts: ReviewOptions): Promise<ReviewSummary> {
  const cache = opts.cache ?? new Map<string, CloudTopMove[] | null>();
  const onAbort = () => cancelLocalAnalysis();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  let cloudUses = 0, remoteUses = 0, localUses = 0;
  // Consecutive cloud misses so far — at CLOUD_MISS_STREAK the line has left
  // book and the cloud isn't asked again (a hit resets it, mirroring the scan).
  let cloudMisses = 0;
  const sans: string[] = []; // SAN path from the start, grown as we walk

  try {
    for (let i = 0; i < nodes.length; i++) {
      if (opts.signal?.aborted) break;
      const node = nodes[i];
      sans.push(node.san);

      // Live re-runs only fill the gaps — a node we've already graded just
      // advances the progress bar.
      if (opts.skipGraded && node.classification) {
        opts.onProgress?.(i, node);
        continue;
      }

      const parentFen = i === 0 ? START_FEN : nodes[i - 1].fen;
      const r = await gradeNode(node, parentFen, cache, {
        ...opts,
        sanPath: sans,
        prevUci: i > 0 ? nodes[i - 1].uci : undefined,
        tryCloud: cloudMisses < CLOUD_MISS_STREAK,
      });
      if (opts.signal?.aborted) break;
      if (r.cloudHits) cloudMisses = 0;
      else cloudMisses += r.cloudMisses;
      if (r.source === 'cloud') cloudUses++;
      else if (r.source === 'remote') remoteUses++;
      else if (r.source === 'local') localUses++;
      if (r.graded) opts.onProgress?.(i, node);

      if (r.hitNetwork) await sleep(CLOUD_DELAY_MS, opts.signal);
    }
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
  }
  return { engine: engineFrom(cloudUses, remoteUses, localUses) };
}

// Strip grades from a line (e.g. before a fresh review). Mutates in place.
export function clearClassifications(nodes: MoveNode[]): void {
  for (const n of nodes) {
    delete n.classification;
    delete n.cpLoss;
    delete n.evalCp;
  }
}
