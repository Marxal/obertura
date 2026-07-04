// "From your games" — the scan that finds the endgames you actually reached.
//
// A user-triggered batch pass, modelled on mistake-scan.ts. For each unscanned
// game it replays the moves, finds the FIRST position that drops into tablebase
// range (≤7 pieces) on YOUR move, and asks the Lichess tablebase for the true
// result there. We keep only the positions you could have WON or DRAWN — a real
// training target you can play out against the engine (endgame-playout.ts). The
// result is stored per game (ImportedGame.endgame), so the scan is abortable and
// resumable: stop any time, everything scanned so far stays.
//
// Unlike the mistake scan, the tablebase is the ONLY judge here (no local-engine
// fallback), and that host is blocked by the build/preview container's egress and
// can be offline on a phone. So a game whose endgame we can't reach the tablebase
// for is left UNSCANNED for a later online run, and the scan bails out after a
// short streak of unreachable probes, reporting `unreachable` so the screen can
// nudge the user to try again online.
//
// The detection core (firstEndgameSpot / didConvert) is pure and self-tested;
// only scanEndgames talks to the network and storage.

import { Chess } from 'chess.js';
import { getAllGames, getGame, saveGames } from './storage';
import type { ImportedGame, GameResult } from './import-core';
import {
  pieceCount, TABLEBASE_MAX_PIECES, probeTablebase, outcomeOf,
} from './lichess-tablebase';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Give up a scan run after this many games in a row whose tablebase probe fails —
// the host is unreachable (offline / blocked), so there's no point grinding on.
const UNREACHABLE_STREAK = 3;

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

export const ENDGAME_SCAN_VERSION = 1;

// A spot plus the game it came from — the screen needs both (the card names the
// opponent; the play-out drives the position).
export interface EndgameSpotRef {
  game: ImportedGame;
  spot: EndgameSpot;
}

// ── Pure detection core (self-tested) ────────────────────────────────────────

// Whether `fen` is an endgame position (≤7 pieces) with `colour` to move — i.e.
// one you were on move for and the tablebase can judge.
export function isEndgameToMove(fen: string, colour: 'white' | 'black'): boolean {
  const toMove = fen.split(' ')[1] === 'w' ? 'white' : 'black';
  return toMove === colour && pieceCount(fen) <= TABLEBASE_MAX_PIECES;
}

// Replay a game's UCI moves and return the FIRST position where it's YOUR move
// and the piece count has fallen into tablebase range, or null if it never does
// (or a move is malformed). `startFen` defaults to the standard start; it exists
// mostly so the pure core can be self-tested from a near-endgame position.
export function firstEndgameSpot(
  ucis: string[],
  colour: 'white' | 'black',
  startFen: string = START_FEN,
): { ply: number; fen: string } | null {
  const chess = new Chess(startFen);
  for (let i = 0; i <= ucis.length; i++) {
    const fen = chess.fen();
    if (isEndgameToMove(fen, colour)) return { ply: i, fen };
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

// Whether the game's final result kept the outcome that was on offer: a win must
// be won; a draw must be held (a win is even better).
export function didConvert(available: 'win' | 'draw', result: GameResult): boolean {
  return available === 'win' ? result === 'win' : result !== 'loss';
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
}

// How many games still wait for an endgame scan — drives the section's button.
export function unscannedEndgameCount(games: ImportedGame[]): number {
  return games.filter(g => !g.endgame).length;
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

async function scanOneGame(
  game: ImportedGame,
  cache: Map<string, 'win' | 'draw' | 'loss' | 'unknown'>,
  signal: AbortSignal,
): Promise<ScanOne> {
  const found = firstEndgameSpot(game.ucis, game.colour);
  if (!found) return { kind: 'done', spots: [] }; // no ≤7-piece endgame on your move
  if (signal.aborted) return { kind: 'unreachable' };

  let outcome = cache.get(found.fen);
  if (outcome === undefined) {
    const res = await probeTablebase(found.fen);
    if (!res) return { kind: 'unreachable' }; // couldn't reach the judge — retry later
    outcome = outcomeOf(res.category);
    cache.set(found.fen, outcome);
  }
  if (outcome !== 'win' && outcome !== 'draw') return { kind: 'done', spots: [] }; // you were lost
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

// Scan every unscanned game, newest first. Each game's result is persisted the
// moment it's judged, so aborting keeps all completed work. A game whose endgame
// the tablebase can't be reached for is left unscanned (not persisted) so a later
// online run picks it up; a streak of those ends the run early.
export async function scanEndgames(opts: {
  signal: AbortSignal;
  onProgress?: (p: EndgameScanProgress) => void;
}): Promise<EndgameScanResult> {
  const all = await getAllGames();
  const pending = all.filter(g => !g.endgame).sort((a, b) => b.endTime - a.endTime);

  const cache = new Map<string, 'win' | 'draw' | 'loss' | 'unknown'>();
  let scanned = 0;
  let found = 0;
  let unreachableStreak = 0;
  let unreachable = false;

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
    // if the game was deleted mid-scan.
    const fresh = await getGame(game.id);
    if (fresh) {
      fresh.endgame = { scannedAt: Date.now(), version: ENDGAME_SCAN_VERSION, spots: r.spots };
      await saveGames([fresh]);
    }
    scanned++;
    found += r.spots.length;
    opts.onProgress?.({ gamesDone: scanned, gamesTotal: pending.length, found, opponent: game.opponent });
  }

  return { scanned, found, aborted: opts.signal.aborted, unreachable };
}
