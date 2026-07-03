// Mistake Retry — the scan that turns your imported games into training
// positions. A user-triggered batch pass walks each unscanned game (newest
// first), builds a cheap engine eval trail over its positions (Lichess cloud
// first, shallow local Stockfish on a miss), and flags the plies where YOUR
// move went wrong, in four flavours:
//
//   opening-blunder  you blundered in the opening and lost the game
//   punish-opening   the opponent erred in the opening and you let them off
//   missed-win       you stood clearly winning and gave the win away
//   blunder          a game-losing blunder from a roughly equal position
//
// Candidates from the cheap pass are then re-verified at the analyser's depth
// and stored on the game record (ImportedGame.retry) together with the
// engine's top-3 continuations, so the drill can give instant feedback with
// no engine round-trip. Per-game persistence makes the scan abortable and
// resumable: stop any time, everything scanned so far stays.
//
// The detection core (categorise / detectSpots / pickSpots) is pure and
// self-tested; only scanGames talks to the network, the engine and storage.

import { Chess } from 'chess.js';
import {
  cloudTopMoves,
  cloudTopLines,
  analysePosition,
  cancelLocalAnalysis,
} from './engine';
import type { MoveEval } from './engine';
import { cpToWin, flattenCp } from './winprob';
import { getAllGames, getGame, saveGames } from './storage';
import type { ImportedGame, GameResult } from './import-core';

// ── Tunable thresholds (one place to adjust the whole feel) ──────────────────
// All cp values are USER-perspective (positive = good for you), mate-flattened
// through winprob's ±100000 sentinels. Drops are win-probability (0..1), the
// same model the Game Review grader uses, so a "blunder" here and a "??" there
// agree.
export const OPENING_MAX_PLY = 24;    // "the opening" = the first 12 moves
export const WIN_DROP_BLUNDER = 0.20; // the grader's blunder boundary
export const WIN_DROP_PUNISH = 0.10;  // giving back this much = failed to punish
export const LOSING_CP = -150;        // at/below this you're clearly losing
export const WINNING_CP = 250;        // at/above this you're clearly winning (~+2.5)
export const HELD_CP = 100;           // still at/above +1 after the move = win kept
export const EDGE_CP = 150;           // the opponent's gift left you at least this
export const NEUTRAL_CP = 50;         // dropping under +0.5 = advantage gone
export const EQUALISH_CP = 150;       // |eval| under this = "a roughly equal game"
export const OPP_GIFT_CP = 100;       // the opponent's move must hand you ≥ this
export const MAX_SPOTS_PER_GAME = 3;  // variety beats completeness
export const SCAN_DETECT_DEPTH = 8;   // cheap trail pass (cloud misses only)
export const SCAN_VERIFY_DEPTH = 12;  // candidate re-check = analyser's depth
export const GOOD_ALT_CP = 30;        // drill: an alternative within this of best is fine
export const MIN_GAME_PLIES = 10;     // shorter games teach nothing — skip
// Scan-speed guards. The trail only covers the first SCAN_MAX_PLIES plies (40
// moves) — this is an openings trainer, and long endgames are where a scan
// drowns in local-engine time for positions the cloud never has. And once the
// cloud misses CLOUD_MISS_STREAK positions in a row the game has left known
// territory, so the rest of its trail skips the cloud round-trip (and its
// politeness delay) entirely and goes straight to the local engine.
export const SCAN_MAX_PLIES = 80;
export const CLOUD_MISS_STREAK = 3;

// A small breather after cloud lookups so a long scan doesn't burst the Lichess
// rate limit (mirrors review.ts).
const CLOUD_DELAY_MS = 120;

// ── Stored shapes ─────────────────────────────────────────────────────────────

export type MistakeCategory = 'opening-blunder' | 'punish-opening' | 'missed-win' | 'blunder';

// One trainable position, persisted inside ImportedGame.retry. Evals are
// USER-perspective; `best` keeps the engine's top-3 at preFen (white-persp
// MoveEval, exactly what cloudTopLines/analysePosition return) so the drill
// can check an answer and show continuations without re-searching.
export interface MistakeSpot {
  id: string;               // `${gameId}#${ply}`
  ply: number;              // 0-based index into the game's moves — YOUR move
  category: MistakeCategory;
  preFen: string;           // the position before your move (the drill position)
  playedSan: string;        // the move you actually played…
  playedUci: string;
  best: MoveEval[];         // …and what the engine wanted (top-3, best first)
  evalBefore: number;       // user-persp cp before the move (mate-flattened)
  evalAfter: number;        // user-persp cp after the played move
  // Training state, updated by the drill (recordSpotResult).
  fixed?: boolean;          // solved cleanly at least once
  attempts?: number;
  lastTrained?: number;     // unix ms
}

// The whole scan result for one game — ImportedGame.retry. `version` names the
// detection rules that produced it; bumping RETRY_VERSION makes old scans look
// stale so a future round can re-scan with better rules.
export interface GameRetry {
  scannedAt: number;
  version: number;
  spots: MistakeSpot[];
}

export const RETRY_VERSION = 1;

// A spot plus the game it came from — sessions need both (the intro line names
// the opponent; the inline review replays the full game).
export interface SpotRef {
  game: ImportedGame;
  spot: MistakeSpot;
}

// ── Pure detection core (self-tested) ────────────────────────────────────────

export interface CategoriseCtx {
  ply: number;              // 0-based ply of YOUR move
  result: GameResult;
  before: number;           // user-persp cp before your move
  after: number;            // user-persp cp after it
  // User-persp cp before the OPPONENT's previous move (null at ply 0) — the
  // "gift" term: how much their last move handed you.
  beforeOpp: number | null;
}

// Classify one played move, or null when it isn't a trainable mistake. First
// match wins, so order encodes priority: the two opening flavours outrank the
// game-wide ones, and a spot never lands in two categories.
export function categorise(ctx: CategoriseCtx): MistakeCategory | null {
  const drop = Math.max(0, cpToWin(ctx.before) - cpToWin(ctx.after));

  // You blundered the opening and went on to lose because of it.
  if (
    ctx.ply < OPENING_MAX_PLY && ctx.result === 'loss' &&
    drop >= WIN_DROP_BLUNDER && ctx.after <= LOSING_CP
  ) return 'opening-blunder';

  // The opponent's opening move handed you a real edge — and your reply gave a
  // chunk of it straight back (or dropped you under +0.5).
  if (
    ctx.ply < OPENING_MAX_PLY &&
    ctx.beforeOpp !== null && ctx.before >= EDGE_CP &&
    ctx.before - ctx.beforeOpp >= OPP_GIFT_CP &&
    (drop >= WIN_DROP_PUNISH || ctx.after < NEUTRAL_CP)
  ) return 'punish-opening';

  // You were clearly winning and this move let the win go.
  if (ctx.before >= WINNING_CP && ctx.after < HELD_CP) return 'missed-win';

  // A plain game-losing blunder from a level position.
  if (
    ctx.result === 'loss' && Math.abs(ctx.before) < EQUALISH_CP &&
    drop >= WIN_DROP_BLUNDER && ctx.after <= LOSING_CP
  ) return 'blunder';

  return null;
}

export interface DetectInput {
  colour: 'white' | 'black';   // which side YOU played
  result: GameResult;
  // trail[i] = WHITE-perspective cp (mate-flattened) of the position before
  // ply i; trail[plyCount] is the final position. null = no eval available
  // (cloud miss + engine failure) — that ply is skipped, never guessed.
  trail: (number | null)[];
}

export interface SpotCandidate {
  ply: number;
  category: MistakeCategory;
  drop: number;              // win-prob drop, used to keep the worst offenders
}

// Walk your plies of the eval trail and collect candidate mistakes, biggest
// win-probability drop first, capped so one disaster game can't flood the deck.
export function detectSpots(input: DetectInput): SpotCandidate[] {
  const userParity = input.colour === 'white' ? 0 : 1;
  const flip = (whiteCp: number): number => (input.colour === 'white' ? whiteCp : -whiteCp);
  const out: SpotCandidate[] = [];
  for (let i = userParity; i + 1 < input.trail.length; i += 2) {
    const beforeW = input.trail[i];
    const afterW = input.trail[i + 1];
    if (beforeW === null || afterW === null) continue;
    const prevW = i > 0 ? input.trail[i - 1] : null;
    const ctx: CategoriseCtx = {
      ply: i,
      result: input.result,
      before: flip(beforeW),
      after: flip(afterW),
      beforeOpp: prevW === null ? null : flip(prevW),
    };
    const category = categorise(ctx);
    if (!category) continue;
    out.push({ ply: i, category, drop: Math.max(0, cpToWin(ctx.before) - cpToWin(ctx.after)) });
  }
  out.sort((a, b) => b.drop - a.drop);
  return out.slice(0, MAX_SPOTS_PER_GAME);
}

// Flatten every scanned game's spots into session-ready refs.
export function collectSpots(games: ImportedGame[]): SpotRef[] {
  const out: SpotRef[] = [];
  for (const game of games) {
    for (const spot of game.retry?.spots ?? []) out.push({ game, spot });
  }
  return out;
}

// Pick a session's worth of spots: unfixed first (newest game first), then
// fixed ones you trained longest ago. `category` null = mixed (the daily task).
export function pickSpots(refs: SpotRef[], category: MistakeCategory | null, count: number): SpotRef[] {
  const pool = category ? refs.filter(r => r.spot.category === category) : refs.slice();
  const unfixed = pool
    .filter(r => !r.spot.fixed)
    .sort((a, b) => b.game.endTime - a.game.endTime);
  const fixed = pool
    .filter(r => r.spot.fixed)
    .sort((a, b) => (a.spot.lastTrained ?? 0) - (b.spot.lastTrained ?? 0));
  return [...unfixed, ...fixed].slice(0, count);
}

// The numbers the pane shows — all cheap, straight off the stored records.
export interface RetryCounts {
  spots: number;                                  // total spots found
  fixed: number;                                  // solved cleanly at least once
  scanned: number;                                // games already scanned
  total: number;                                  // games in the library
  unfixedByCategory: Record<MistakeCategory, number>;
  byCategory: Record<MistakeCategory, number>;
}

export function countRetry(games: ImportedGame[]): RetryCounts {
  const zero = (): Record<MistakeCategory, number> =>
    ({ 'opening-blunder': 0, 'punish-opening': 0, 'missed-win': 0, 'blunder': 0 });
  const counts: RetryCounts = {
    spots: 0, fixed: 0, scanned: 0, total: games.length,
    unfixedByCategory: zero(), byCategory: zero(),
  };
  for (const game of games) {
    if (!game.retry) continue;
    counts.scanned++;
    for (const spot of game.retry.spots) {
      counts.spots++;
      counts.byCategory[spot.category]++;
      if (spot.fixed) counts.fixed++;
      else counts.unfixedByCategory[spot.category]++;
    }
  }
  return counts;
}

// ── Game replay (pure) ────────────────────────────────────────────────────────

export interface GameReplay {
  fens: string[];   // fens[i] = position before ply i; fens[plyCount] = final
  sans: string[];   // canonical SAN per ply (re-derived, so always displayable)
}

// Replay a stored game into its position list. Prefers the UCI list (already
// normalised at import), falls back to SAN for any older/manual record.
// Null when the moves don't replay — the scan then marks the game as scanned
// with no spots rather than guessing.
export function replayGame(game: Pick<ImportedGame, 'ucis' | 'sans'>): GameReplay | null {
  const ch = new Chess();
  const fens: string[] = [ch.fen()];
  const sans: string[] = [];
  const useUcis = game.ucis.length > 0;
  const moves: string[] = useUcis ? game.ucis : game.sans;
  for (const mv of moves) {
    try {
      const m = useUcis
        ? ch.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: (mv[4] as 'q' | 'r' | 'b' | 'n') || undefined })
        : ch.move(mv);
      sans.push(m.san);
    } catch {
      return null;
    }
    fens.push(ch.fen());
  }
  return sans.length > 0 ? { fens, sans } : null;
}

// ── The scan driver (I/O) ─────────────────────────────────────────────────────

export interface ScanProgress {
  gamesDone: number;
  gamesTotal: number;
  spotsFound: number;
  opponent: string;   // whose game just finished — the overlay's ticker line
}

export interface ScanResult {
  scanned: number;
  spots: number;
  aborted: boolean;
}

// How many games still wait for a scan — drives the pane's button label.
export function unscannedCount(games: ImportedGame[]): number {
  return games.filter(g => !g.retry).length;
}

// Scan every unscanned game, newest first. Each game's result is persisted the
// moment it finishes, so aborting keeps all completed work (resume = just run
// again). The shared position cache spans games — openings repeat, so later
// games get cheaper.
export async function scanGames(opts: {
  signal: AbortSignal;
  onProgress?: (p: ScanProgress) => void;
}): Promise<ScanResult> {
  const all = await getAllGames();
  const pending = all.filter(g => !g.retry).sort((a, b) => b.endTime - a.endTime);
  const onAbort = (): void => cancelLocalAnalysis();
  opts.signal.addEventListener('abort', onAbort, { once: true });

  const cache = new Map<string, number | null>();
  let scanned = 0;
  let spotsFound = 0;
  try {
    for (const game of pending) {
      if (opts.signal.aborted) break;
      const spots = await scanOneGame(game, cache, opts.signal);
      // An aborted game is half-judged — drop it rather than persisting junk.
      if (opts.signal.aborted) break;
      // Re-fetch before writing so a concurrent save (e.g. the analyser's Save
      // game) isn't clobbered; skip silently if the game was deleted mid-scan.
      const fresh = await getGame(game.id);
      if (fresh) {
        fresh.retry = { scannedAt: Date.now(), version: RETRY_VERSION, spots };
        await saveGames([fresh]);
      }
      scanned++;
      spotsFound += spots.length;
      opts.onProgress?.({ gamesDone: scanned, gamesTotal: pending.length, spotsFound, opponent: game.opponent });
    }
  } finally {
    opts.signal.removeEventListener('abort', onAbort);
  }
  return { scanned, spots: spotsFound, aborted: opts.signal.aborted };
}

async function scanOneGame(
  game: ImportedGame,
  cache: Map<string, number | null>,
  signal: AbortSignal,
): Promise<MistakeSpot[]> {
  const replay = replayGame(game);
  if (!replay || replay.sans.length < MIN_GAME_PLIES) return [];

  // The cheap pass: one eval per position. Opening plies mostly come straight
  // from the cloud; the rest fall back to a shallow local search. Once the
  // cloud misses a few positions in a row we stop asking it for this game —
  // a cache hit doesn't touch the streak, so repeated openings stay cheap.
  const trail: (number | null)[] = [];
  let cloudMisses = 0;
  for (const fen of replay.fens.slice(0, SCAN_MAX_PLIES + 1)) {
    if (signal.aborted) return [];
    const r = await positionCp(fen, cache, signal, cloudMisses < CLOUD_MISS_STREAK);
    if (r.cloud === 'miss') cloudMisses++;
    else if (r.cloud === 'hit') cloudMisses = 0;
    trail.push(r.cp);
  }

  const candidates = detectSpots({ colour: game.colour, result: game.result, trail });
  const spots: MistakeSpot[] = [];
  for (const cand of candidates) {
    if (signal.aborted) break;
    const spot = await verifyCandidate(game, cand, replay, trail, signal);
    if (spot) spots.push(spot);
  }
  return spots;
}

// WHITE-perspective cp of a position (its best move's eval), cloud first (when
// `tryCloud`), local depth-8 MultiPV-1 fallback, cached across the whole scan
// run. `cloud` tells the caller whether the cloud was asked and answered, so it
// can drive the per-game miss streak. cp null = neither source answered — the
// detector skips such plies.
async function positionCp(
  fen: string,
  cache: Map<string, number | null>,
  signal: AbortSignal,
  tryCloud: boolean,
): Promise<{ cp: number | null; cloud: 'hit' | 'miss' | 'skipped' }> {
  const cached = cache.get(fen);
  if (cached !== undefined) return { cp: cached, cloud: 'skipped' };
  if (signal.aborted) return { cp: null, cloud: 'skipped' };

  let whiteCp: number | null = null;
  let cloud: 'hit' | 'miss' | 'skipped' = 'skipped';
  if (tryCloud) {
    const top = await cloudTopMoves(fen); // mover-perspective
    cloud = top && top.length ? 'hit' : 'miss';
    if (top && top.length) {
      const mover = flattenCp(top[0]);
      whiteCp = mover === null ? null : (blackToMove(fen) ? -mover : mover);
    }
  }
  if (cloud !== 'hit' && !signal.aborted) {
    // The trail only needs the position's eval, so MultiPV 1 — about a third
    // of the search work of the default 3 — and a tight time budget so a slow
    // phone can't sink seconds into a single ply.
    const evals = await analysePosition(fen, SCAN_DETECT_DEPTH, undefined, {
      multiPv: 1,
      movetimeMs: 700,
    }); // white-perspective
    whiteCp = evals.length ? flattenCp(evals[0]) : null;
  }
  // An aborted search resolves early with junk — return without caching it.
  if (signal.aborted) return { cp: null, cloud };
  cache.set(fen, whiteCp);
  // Pace the cloud only when a request actually went out.
  if (cloud !== 'skipped') await sleep(CLOUD_DELAY_MS, signal);
  return { cp: whiteCp, cloud };
}

// Re-check one candidate at the analyser's depth and enrich it into a stored
// spot. Null = the deeper look disagreed (or the position is a forced move) —
// the candidate is quietly dropped.
async function verifyCandidate(
  game: ImportedGame,
  cand: SpotCandidate,
  replay: GameReplay,
  trail: (number | null)[],
  signal: AbortSignal,
): Promise<MistakeSpot | null> {
  const i = cand.ply;
  const preFen = replay.fens[i];
  const playedUci = game.ucis[i] ?? uciFromReplay(replay, i);
  if (!playedUci) return null;

  // A (near-)forced move teaches nothing — never drill it.
  if (new Chess(preFen).moves().length <= 1) return null;

  const best = await topLines(preFen, signal);
  if (signal.aborted || !best || best.length === 0) return null;
  // The deeper look says your move WAS the best — no mistake after all.
  if (best[0].uci === playedUci) return null;
  const bestW = flattenCp(best[0]);
  if (bestW === null) return null;

  // The played move's eval: from the top-3 list when it's there, otherwise the
  // best reply of the resulting position (same white perspective either way).
  let afterW: number | null = null;
  const played = best.find(m => m.uci === playedUci);
  if (played) afterW = flattenCp(played);
  if (afterW === null) {
    const child = await topLines(replay.fens[i + 1], signal);
    if (child && child.length) afterW = flattenCp(child[0]);
  }
  if (afterW === null) return null;

  const flip = (whiteCp: number): number => (game.colour === 'white' ? whiteCp : -whiteCp);
  const prevW = i > 0 ? trail[i - 1] : null;
  const ctx: CategoriseCtx = {
    ply: i,
    result: game.result,
    before: flip(bestW),
    after: flip(afterW),
    beforeOpp: prevW === null || prevW === undefined ? null : flip(prevW),
  };
  const category = categorise(ctx);
  if (!category) return null;

  return {
    id: `${game.id}#${i}`,
    ply: i,
    category,
    preFen,
    playedSan: replay.sans[i],
    playedUci,
    best: best.slice(0, 3),
    evalBefore: ctx.before,
    evalAfter: ctx.after,
  };
}

// Top-3 lines (white-perspective MoveEval[]) for the verify pass: cloud first,
// local SCAN_VERIFY_DEPTH fallback.
async function topLines(fen: string, signal: AbortSignal): Promise<MoveEval[] | null> {
  if (signal.aborted) return null;
  const cloud = await cloudTopLines(fen);
  await sleep(CLOUD_DELAY_MS, signal);
  if (cloud && cloud.length) return cloud;
  if (signal.aborted) return null;
  const local = await analysePosition(fen, SCAN_VERIFY_DEPTH, undefined, { movetimeMs: 1500 });
  return local.length ? local : null;
}

// Derive one ply's UCI from the replay fens (only needed for SAN-only records).
function uciFromReplay(replay: GameReplay, ply: number): string | null {
  try {
    const ch = new Chess(replay.fens[ply]);
    const m = ch.move(replay.sans[ply]);
    return m.from + m.to + (m.promotion ?? '');
  } catch {
    return null;
  }
}

// ── Spot training state ───────────────────────────────────────────────────────

// Record a drill attempt on a spot: bump attempts, stamp lastTrained, and latch
// `fixed` on a clean solve. Read-modify-write on the fresh record so a
// concurrent analyser save keeps its data.
export async function recordSpotResult(gameId: string, spotId: string, clean: boolean): Promise<void> {
  const fresh = await getGame(gameId);
  const spot = fresh?.retry?.spots.find(s => s.id === spotId);
  if (!fresh || !spot) return;
  spot.attempts = (spot.attempts ?? 0) + 1;
  spot.lastTrained = Date.now();
  if (clean) spot.fixed = true;
  await saveGames([fresh]);
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function blackToMove(fen: string): boolean {
  return fen.split(' ')[1] === 'b';
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(); return; }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}
