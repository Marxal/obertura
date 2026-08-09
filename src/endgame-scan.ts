// "From your games" — the scan that finds the endgames you actually reached.
//
// A user-triggered batch pass, modelled on mistake-scan.ts. For each unscanned
// game it replays the moves and finds the FIRST endgame position (≤10 pieces)
// on YOUR move, then asks a judge what result was available to you there:
//
//   • ≤7 pieces  → the Lichess tablebase — exact ground truth.
//   • 8–10 pieces → the local Stockfish engine (a bounded, ~1s search). Only a
//     CLEAR verdict counts (comfortably winning, or level enough to hold); a
//     murky eval falls back to the game's first ≤7-piece position and asks the
//     tablebase there, so nothing the old 7-piece scan found is ever lost.
//
// We keep only the positions you could have WON or DRAWN — a real training
// target you can play out against the engine (endgame-playout.ts). The result
// is stored per game (ImportedGame.endgame), so the scan is abortable and
// resumable: stop any time, everything scanned so far stays.
//
// The tablebase host is blocked by the build/preview container's egress and can
// be offline on a phone. A game whose endgame needs the tablebase but can't
// reach it is left UNSCANNED for a later online run, and the scan bails out
// after a short streak of unreachable probes, reporting `unreachable` so the
// screen can nudge the user to try again online.
//
// The detection core (firstEndgameSpot / outcomeFromEval / didConvert) is pure
// and self-tested; only scanEndgames talks to the engine, network and storage.

import { Chess } from 'chess.js';
import { getAllGames, getGame, saveGames } from './storage';
import type { ImportedGame, GameResult } from './import-core';
import {
  pieceCount, TABLEBASE_MAX_PIECES, probeTablebase, outcomeOf,
} from './lichess-tablebase';
import { analysePosition, type MoveEval } from './engine';
import { getEndgameProgress, type EndgameProgress } from './endgame-progress';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Give up a scan run after this many games in a row whose tablebase probe fails —
// the host is unreachable (offline / blocked), so there's no point grinding on.
const UNREACHABLE_STREAK = 3;

// The widened detection threshold: a position with this many pieces or fewer on
// your move counts as "an endgame you reached". The tablebase still only judges
// ≤7; the 8–10 band is judged by the local engine instead.
export const SCAN_MAX_PIECES = 10;

// The local engine's budget per judged position — depth-capped AND time-capped,
// so a batch scan stays bounded on a slow phone.
const JUDGE_DEPTH = 18;
const JUDGE_MOVETIME_MS = 900;

// Engine-verdict thresholds, in centipawns from YOUR side. Deliberately
// conservative: a "win" needs a comfortably winning margin, a "draw" a truly
// level eval. Anything between is murky — the scan falls back to the exact
// 7-piece tablebase check instead of guessing.
const WIN_CP = 250;
const DRAW_CP = 60;

// One playable endgame you reached in a game. `outcome` is the tablebase result
// for YOU at this position; `converted` records whether the game's final result
// actually met it (so "the ones you let slip" can be surfaced first).
export interface EndgameSpot {
  ply: number;                    // 0-based ply you were about to play
  fen: string;                    // the position; side to move === you
  youPlay: 'white' | 'black';     // board orientation / the side you drive
  outcome: 'win' | 'draw';        // what was available to you here
  converted: boolean;             // did the game's result keep it?
}

// The whole scan result for one game — ImportedGame.endgame. `version` names the
// detection rules; bumping it makes old scans look stale for a future re-scan.
export interface GameEndgame {
  scannedAt: number;
  version: number;
  spots: EndgameSpot[];
}

// v2 widened detection from ≤7 pieces to ≤10 (engine-judged above tablebase
// range). Games scanned under v1 that found NOTHING look unscanned again so the
// wider net gets a pass at them; v1 games that DID find a spot keep it (it's
// still a valid ≤7-piece tablebase verdict).
export const ENDGAME_SCAN_VERSION = 2;

// A spot plus the game it came from — the screen needs both (the card names the
// opponent; the play-out drives the position).
export interface EndgameSpotRef {
  game: ImportedGame;
  spot: EndgameSpot;
}

// The id endgame-progress.ts (localStorage play-out records) keys spots by.
// Centralised here so the scan's own free-tier capping and the screen's
// carousel can never drift apart on the format.
export function endgameSpotId(gameId: string, ply: number): string {
  return `game:${gameId}:${ply}`;
}

// ── Pure detection core (self-tested) ────────────────────────────────────────

// Whether `fen` is an endgame position (≤maxPieces) with `colour` to move —
// i.e. one you were on move for and a judge can rule on.
export function isEndgameToMove(
  fen: string,
  colour: 'white' | 'black',
  maxPieces: number = SCAN_MAX_PIECES,
): boolean {
  const toMove = fen.split(' ')[1] === 'w' ? 'white' : 'black';
  return toMove === colour && pieceCount(fen) <= maxPieces;
}

// Replay a game's UCI moves and return the FIRST position where it's YOUR move
// and the piece count has fallen to `maxPieces` or below, or null if it never
// does (or a move is malformed). `startFen` defaults to the standard start; it
// exists mostly so the pure core can be self-tested from a near-endgame position.
export function firstEndgameSpot(
  ucis: string[],
  colour: 'white' | 'black',
  startFen: string = START_FEN,
  maxPieces: number = SCAN_MAX_PIECES,
): { ply: number; fen: string } | null {
  const chess = new Chess(startFen);
  for (let i = 0; i <= ucis.length; i++) {
    const fen = chess.fen();
    if (isEndgameToMove(fen, colour, maxPieces)) return { ply: i, fen };
    if (i >= ucis.length) break;
    const uci = ucis[i];
    try {
      const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
      if (!move) return null;
    } catch {
      return null; // a malformed move list — skip this game
    }
  }
  return null;
}

// Read a clear verdict for YOU out of an engine line (white-perspective cp/mate,
// the shape engine.ts returns). 'win' needs a comfortable margin, 'draw' a truly
// level eval; anything else — murky, losing, or no eval at all — is null so the
// caller can fall back to the exact tablebase check.
export function outcomeFromEval(
  line: MoveEval | undefined,
  youPlay: 'white' | 'black',
): 'win' | 'draw' | null {
  if (!line) return null;
  if (line.mate !== undefined) {
    const mineMate = youPlay === 'white' ? line.mate : -line.mate;
    return mineMate > 0 ? 'win' : null;
  }
  if (line.cp === undefined) return null;
  const mine = youPlay === 'white' ? line.cp : -line.cp;
  if (mine >= WIN_CP) return 'win';
  if (Math.abs(mine) <= DRAW_CP) return 'draw';
  return null;
}

// Whether the game's final result kept the outcome that was on offer: a win must
// be won; a draw must be held (a win is even better).
export function didConvert(available: 'win' | 'draw', result: GameResult): boolean {
  return available === 'win' ? result === 'win' : result !== 'loss';
}

// Whether this game still needs (another) endgame scan: never scanned, or
// scanned under older rules WITHOUT finding anything — the widened net may find
// a spot the old one missed. Found spots survive version bumps untouched.
export function needsEndgameScan(g: ImportedGame): boolean {
  if (!g.endgame) return true;
  return g.endgame.version < ENDGAME_SCAN_VERSION && g.endgame.spots.length === 0;
}

// ── The scan driver (I/O) ─────────────────────────────────────────────────────

export interface EndgameScanProgress {
  gamesDone: number;
  gamesTotal: number;
  found: number;      // playable endgames found so far
  opponent: string;   // whose game just finished — the overlay's ticker line
}

export interface EndgameScanResult {
  scanned: number;
  found: number;
  aborted: boolean;
  unreachable: boolean; // bailed because the tablebase couldn't be reached
  capped: boolean;      // stopped early because the free-tier rolling cap was hit
}

// Free-tier scan limit — same shape as mistake-scan.ts's ScanCap: only the
// `windowGames` most recent games are ever considered, and the run stops
// (before touching the tablebase/engine at all, if already true) once the
// window's rolling unplayed count reaches `maxUnplayed`.
export interface EndgameScanCap {
  windowGames: number;
  maxUnplayed: number;
}

// How many games still wait for an endgame scan — drives the section's button.
export function unscannedEndgameCount(games: ImportedGame[]): number {
  return games.filter(needsEndgameScan).length;
}

// ── Free-tier view cap (pure but reads localStorage play state) ─────────────
//
// Mirrors mistake-scan.ts's capMistakeGamesForTier: a display-side backstop
// that windows to the most recent games and keeps a ROLLING cap of unplayed
// positions, treating "played at least once" (endgame-progress.ts) the same
// way the mistake cap treats "fixed" — always visible, never counted against
// the cap. Guaranteed non-mutating for the same reason: a trimmed game is
// rebuilt as { ...game, endgame: { ...game.endgame, spots: <new array> } },
// so the original game's `endgame.spots` array is never touched; an untrimmed
// game is returned by reference.
export interface EndgameGameCapResult {
  games: ImportedGame[];
  capped: boolean;
}

export function capEndgameGamesForTier(
  games: ImportedGame[],
  windowGames: number,
  maxUnplayed: number,
  progress: EndgameProgress = getEndgameProgress(),
): EndgameGameCapResult {
  const sorted = [...games].sort((a, b) => b.endTime - a.endTime);
  const windowed = sorted.slice(0, windowGames);
  const truncatedByWindow = sorted.length > windowed.length;

  const isUnplayed = (gameId: string, ply: number): boolean => {
    const rec = progress[endgameSpotId(gameId, ply)];
    return !rec || rec.attempts === 0;
  };

  const unplayedIds: string[] = [];
  for (const game of windowed) {
    for (const spot of game.endgame?.spots ?? []) {
      if (isUnplayed(game.id, spot.ply)) unplayedIds.push(endgameSpotId(game.id, spot.ply));
    }
  }
  const keep = new Set(unplayedIds.slice(0, maxUnplayed));
  const droppedUnplayed = unplayedIds.length > keep.size;

  const cappedGames = windowed.map(game => {
    if (!game.endgame) return game;
    const spots = game.endgame.spots.filter(spot =>
      !isUnplayed(game.id, spot.ply) || keep.has(endgameSpotId(game.id, spot.ply)));
    if (spots.length === game.endgame.spots.length) return game;
    return { ...game, endgame: { ...game.endgame, spots } };
  });

  return { games: cappedGames, capped: truncatedByWindow || droppedUnplayed };
}

// Flatten every scanned game's spots into screen-ready refs.
export function collectEndgameSpots(games: ImportedGame[]): EndgameSpotRef[] {
  const out: EndgameSpotRef[] = [];
  for (const game of games) {
    for (const spot of game.endgame?.spots ?? []) out.push({ game, spot });
  }
  return out;
}

type ScanOne =
  | { kind: 'done'; spots: EndgameSpot[] }
  | { kind: 'unreachable' };

// Package one judged position as the game's spot (or none when you were lost).
function spotFrom(
  game: ImportedGame,
  found: { ply: number; fen: string },
  outcome: 'win' | 'draw' | 'loss' | 'unknown',
): ScanOne {
  if (outcome !== 'win' && outcome !== 'draw') return { kind: 'done', spots: [] };
  return {
    kind: 'done',
    spots: [{
      ply: found.ply,
      fen: found.fen,
      youPlay: game.colour,
      outcome,
      converted: didConvert(outcome, game.result),
    }],
  };
}

// Judge a ≤7-piece position with the tablebase (through the shared cache).
async function judgeTablebase(
  fen: string,
  cache: Map<string, 'win' | 'draw' | 'loss' | 'unknown'>,
): Promise<'win' | 'draw' | 'loss' | 'unknown' | null> {
  let outcome = cache.get(fen);
  if (outcome === undefined) {
    const res = await probeTablebase(fen);
    if (!res) return null; // couldn't reach the judge — retry later
    outcome = outcomeOf(res.category);
    cache.set(fen, outcome);
  }
  return outcome;
}

async function scanOneGame(
  game: ImportedGame,
  cache: Map<string, 'win' | 'draw' | 'loss' | 'unknown'>,
  signal: AbortSignal,
): Promise<ScanOne> {
  const found = firstEndgameSpot(game.ucis, game.colour);
  if (!found) return { kind: 'done', spots: [] }; // no ≤10-piece endgame on your move
  if (signal.aborted) return { kind: 'unreachable' };

  // In tablebase range → exact verdict, same as the original scan.
  if (pieceCount(found.fen) <= TABLEBASE_MAX_PIECES) {
    const outcome = await judgeTablebase(found.fen, cache);
    if (outcome === null) return { kind: 'unreachable' };
    return spotFrom(game, found, outcome);
  }

  // 8–10 pieces → ask the local engine for a clear verdict.
  const lines = await analysePosition(found.fen, JUDGE_DEPTH, undefined, {
    multiPv: 1,
    movetimeMs: JUDGE_MOVETIME_MS,
  });
  if (signal.aborted) return { kind: 'unreachable' };
  const verdict = outcomeFromEval(lines[0], game.colour);
  if (verdict) return spotFrom(game, found, verdict);

  // Murky (or the engine had nothing) — fall back to the game's first ≤7-piece
  // position and let the tablebase rule there, exactly like the old scan.
  const tight = firstEndgameSpot(game.ucis, game.colour, undefined, TABLEBASE_MAX_PIECES);
  if (!tight) return { kind: 'done', spots: [] };
  const outcome = await judgeTablebase(tight.fen, cache);
  if (outcome === null) return { kind: 'unreachable' };
  return spotFrom(game, tight, outcome);
}

// Scan every unscanned game, newest first. Each game's result is persisted the
// moment it's judged, so aborting keeps all completed work. A game whose endgame
// the tablebase can't be reached for is left unscanned (not persisted) so a later
// online run picks it up; a streak of those ends the run early.
export async function scanEndgames(opts: {
  signal: AbortSignal;
  onProgress?: (p: EndgameScanProgress) => void;
  cap?: EndgameScanCap;
}): Promise<EndgameScanResult> {
  const all = await getAllGames();
  // Free tier: only the window's most recent games are ever fetched from the
  // tablebase/engine — an older game outside it is never scanned, cap or no cap.
  const windowed = opts.cap
    ? [...all].sort((a, b) => b.endTime - a.endTime).slice(0, opts.cap.windowGames)
    : all;
  const pending = windowed.filter(needsEndgameScan).sort((a, b) => b.endTime - a.endTime);

  const cache = new Map<string, 'win' | 'draw' | 'loss' | 'unknown'>();
  let scanned = 0;
  let found = 0;
  let unreachableStreak = 0;
  let unreachable = false;
  // A freshly-found spot can't already have a play-out record (its id didn't
  // exist before the scan found it), so seeding from what's already scanned in
  // the window and then adding 1 per newly-found spot is exact, no localStorage
  // lookup needed mid-loop.
  let unplayed = opts.cap ? countUnplayedInWindow(windowed) : 0;
  let capped = opts.cap ? unplayed >= opts.cap.maxUnplayed : false;

  if (!capped) {
    for (const game of pending) {
      if (opts.signal.aborted) break;
      const r = await scanOneGame(game, cache, opts.signal);
      if (opts.signal.aborted) break;

      if (r.kind === 'unreachable') {
        if (++unreachableStreak >= UNREACHABLE_STREAK) { unreachable = true; break; }
        continue; // leave this game unscanned for a later online run
      }
      unreachableStreak = 0;

      // Re-fetch before writing so a concurrent save isn't clobbered; skip silently
      // if the game was deleted mid-scan. A v1 re-scan that found nothing again
      // just gets its version stamped forward.
      const fresh = await getGame(game.id);
      if (fresh) {
        fresh.endgame = { scannedAt: Date.now(), version: ENDGAME_SCAN_VERSION, spots: r.spots };
        await saveGames([fresh]);
      }
      scanned++;
      found += r.spots.length;
      opts.onProgress?.({ gamesDone: scanned, gamesTotal: pending.length, found, opponent: game.opponent });
      if (opts.cap) {
        unplayed += r.spots.length;
        if (unplayed >= opts.cap.maxUnplayed) { capped = true; break; }
      }
    }
  }

  return { scanned, found, aborted: opts.signal.aborted, unreachable, capped };
}

function countUnplayedInWindow(games: ImportedGame[]): number {
  const progress = getEndgameProgress();
  let n = 0;
  for (const game of games) {
    for (const spot of game.endgame?.spots ?? []) {
      const rec = progress[endgameSpotId(game.id, spot.ply)];
      if (!rec || rec.attempts === 0) n++;
    }
  }
  return n;
}
