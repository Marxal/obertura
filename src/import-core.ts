// The one import core, shared by both platforms (Chess.com + Lichess) and by
// both callers ("my games" today, opponent scouting next). Everything that is
// NOT platform-specific lives here:
//
//   • the NORMALISED game shape both platforms boil down to (NormalisedGame),
//   • the PGN → compact ImportedGame parser (parseNormalised),
//   • the driver that runs a platform fetcher, parses, applies the 500-game cap
//     (newest first), and reports truncation (runImport),
//   • the TALLY step (counts per time control over the fetched set),
//   • local FILTERING by chosen time controls.
//
// A platform module (chesscom.ts / lichess.ts) only has to: hit its own API and
// hand this core a stream of NormalisedGame batches, newest first. The shape of
// the result — and all the counting/capping — is identical for both.

import { Chess } from 'chess.js';

// Opening depth we retain per game. 24 plies = 12 full moves — deep enough to
// capture the opening and early middlegame, shallow enough to stay compact.
export const OPENING_PLIES = 24;

// Hard cap per import, newest first. A heavy bullet/blitz year can run to
// thousands of games; we keep the most recent 500 and report when we truncate.
export const MAX_GAMES = 500;

// How far back an import reaches. Chess.com counts monthly archives; Lichess
// uses the matching `since` timestamp. The old fixed 12 is now just one choice.
export type Range = 1 | 3 | 12;
export const RANGES: Range[] = [1, 3, 12];
export const DEFAULT_RANGE: Range = 3;

export type Platform = 'chesscom' | 'lichess';

// Four buckets both platforms fold into. "daily" is the slow bucket: Chess.com
// daily + correspondence AND Lichess classical + correspondence all land here
// (the tally shows it as "Classical / Daily"). ultraBullet folds into bullet.
export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily';
export type GameResult = 'win' | 'loss' | 'draw';

// Human labels for the buckets, for the import readout / time-control chooser.
export const TIME_CLASS_LABELS: Record<TimeClass, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  daily: 'Classical / Daily',
};

// Time controls offered by default in the (upcoming) chooser: everything but
// bullet, which is too fast to reflect real opening choices.
export const DEFAULT_TIME_CLASSES: TimeClass[] = ['blitz', 'rapid', 'daily'];

// ── The two shared shapes ──────────────────────────────────────────────────────

// What a platform module produces, before chess.js turns the PGN into moves.
// Deliberately platform-neutral: a winner (not a per-side result code), plain
// usernames, a PGN string, and best-effort opening hints.
export interface NormalisedGame {
  id: string;
  url: string;
  endTime: number;                       // unix seconds, UTC
  timeClass: TimeClass;
  timeControl: string;                   // raw, e.g. "180+2", "1/259200", "-"
  rated: boolean;
  white: string;                         // username
  black: string;                         // username
  winner: 'white' | 'black' | null;      // null = draw
  pgn: string;                           // movetext (with or without headers)
  eco: string | null;                    // ECO *code* hint; falls back to PGN [ECO]
  opening: string | null;                // readable opening name, if known
}

// The compact, stored shape — what lands in IndexedDB. Deliberately small.
export interface ImportedGame {
  id: string;
  url: string;
  endTime: number;
  timeClass: TimeClass;
  timeControl: string;
  rated: boolean;
  colour: 'white' | 'black';             // which side *you* played
  result: GameResult;                    // from your perspective
  opponent: string;
  eco: string | null;                    // ECO code (e.g. "C50"), if present
  opening: string | null;                // readable opening name
  sans: string[];                        // opening moves in SAN, capped
  ucis: string[];                        // same moves in UCI ("e2e4"), capped
  plyCount: number;                      // total plies in the *full* game
}

// ── NormalisedGame → compact ImportedGame ──────────────────────────────────────

function resultFromWinner(winner: NormalisedGame['winner'], colour: 'white' | 'black'): GameResult {
  if (winner === null) return 'draw';
  return winner === colour ? 'win' : 'loss';
}

// Parse one normalised game into an ImportedGame, or null if it should be
// skipped (not our game, or missing/empty/unparseable moves).
export function parseNormalised(raw: NormalisedGame, username: string): ImportedGame | null {
  const me = username.trim().toLowerCase();
  const iAmWhite = raw.white.toLowerCase() === me;
  const iAmBlack = raw.black.toLowerCase() === me;
  if (!iAmWhite && !iAmBlack) return null; // not our game
  if (!raw.pgn) return null;

  const chess = new Chess();
  try {
    // strict:false tolerates clock comments ({[%clk ...]}), header quirks, and
    // a bare SAN movetext with no move numbers (Lichess's `moves` field).
    chess.loadPgn(raw.pgn, { strict: false });
  } catch {
    return null;
  }

  const verbose = chess.history({ verbose: true });
  if (verbose.length === 0) return null; // abandoned before a move — nothing to learn

  const colour: 'white' | 'black' = iAmWhite ? 'white' : 'black';
  const capped = verbose.slice(0, OPENING_PLIES);
  // Prefer the platform's ECO hint; otherwise read the PGN's [ECO] tag.
  const eco = raw.eco ?? chess.getHeaders().ECO ?? null;

  return {
    id: raw.id,
    url: raw.url,
    endTime: raw.endTime,
    timeClass: raw.timeClass,
    timeControl: raw.timeControl,
    rated: raw.rated,
    colour,
    result: resultFromWinner(raw.winner, colour),
    opponent: iAmWhite ? raw.black : raw.white,
    eco,
    opening: raw.opening,
    sans: capped.map(m => m.san),
    ucis: capped.map(m => m.lan), // chess.js `lan` is UCI ("e2e4", "e7e8q")
    plyCount: verbose.length,
  };
}

// ── The driver ─────────────────────────────────────────────────────────────────

export interface ImportProgress {
  monthsTotal: number;   // chess.com: archives to scan; lichess: 1 (one stream)
  monthsDone: number;
  label: string;         // human-readable current step, e.g. "2026/05"
  gamesSoFar: number;
}

// A platform fetcher: hit the API and push NormalisedGame batches, newest first,
// via `emit`. `emit` returns false once the cap is reached — stop fetching then.
// Returns how many "months" (archives / streams) it scanned, for the readout.
export type Emit = (batch: NormalisedGame[], progress: Omit<ImportProgress, 'gamesSoFar'>) => Promise<boolean>;
export type SourceFetch = (username: string, months: Range, emit: Emit) => Promise<number>;

export interface ImportOptions {
  months?: Range;
  onProgress?: (p: ImportProgress) => void;
  // Called per parsed batch so the caller can persist incrementally and free it.
  onGames?: (games: ImportedGame[]) => Promise<void> | void;
}

export interface TimeTally {
  byTimeClass: Record<TimeClass, number>;
  total: number;
}

export interface ImportResult {
  games: ImportedGame[];   // all kept games, newest first, ≤ MAX_GAMES
  platform: Platform;
  range: Range;
  monthsScanned: number;
  fetched: number;         // normalised games seen before the cap
  kept: number;            // games.length
  skipped: number;         // dropped (not our game / unparseable)
  truncated: boolean;      // hit the cap with more still available
  tally: TimeTally;
}

// Run one platform fetcher end to end: parse each batch, enforce the cap
// (newest first), tally, and report. The fetcher does the talking to the API;
// this owns every count.
export async function runImport(
  platform: Platform,
  fetchFn: SourceFetch,
  username: string,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const range = opts.months ?? DEFAULT_RANGE;
  const games: ImportedGame[] = [];
  let fetched = 0;
  let skipped = 0;
  let truncated = false;

  const emit: Emit = async (batch, progress) => {
    const parsed: ImportedGame[] = [];
    for (const raw of batch) {
      if (games.length + parsed.length >= MAX_GAMES) {
        // A game beyond the cap exists, so this import is genuinely truncated.
        truncated = true;
        break;
      }
      fetched++;
      const g = parseNormalised(raw, username);
      if (g) parsed.push(g);
      else skipped++;
    }
    if (parsed.length) {
      games.push(...parsed);
      if (opts.onGames) await opts.onGames(parsed);
    }
    opts.onProgress?.({ ...progress, gamesSoFar: games.length });
    return games.length < MAX_GAMES; // keep going?
  };

  const monthsScanned = await fetchFn(username, range, emit);

  return {
    games,
    platform,
    range,
    monthsScanned,
    fetched,
    kept: games.length,
    skipped,
    truncated,
    tally: tallyTimeClasses(games),
  };
}

// ── Tally + filter ─────────────────────────────────────────────────────────────

// Count games per time control over a set (the fetched set), plus the total.
// This drives the chooser: "you have 412 blitz, 88 rapid, 6 daily…".
export function tallyTimeClasses(games: { timeClass: TimeClass }[]): TimeTally {
  const byTimeClass: Record<TimeClass, number> = { bullet: 0, blitz: 0, rapid: 0, daily: 0 };
  for (const g of games) byTimeClass[g.timeClass]++;
  return { byTimeClass, total: games.length };
}

// Keep only games whose time control the user chose. Runs locally, after the
// fetch — the import always pulls every speed; the filter is a view on top.
export function filterByTimeClasses(games: ImportedGame[], allowed: Iterable<TimeClass>): ImportedGame[] {
  const set = new Set(allowed);
  return games.filter(g => set.has(g.timeClass));
}

// ── Quick stats over a set of games (for the post-import readout) ──────────────

export interface GameStats {
  total: number;
  byTimeClass: Record<TimeClass, number>;
  white: number;
  black: number;
  wins: number;
  losses: number;
  draws: number;
}

export function summariseGames(games: ImportedGame[]): GameStats {
  const { byTimeClass } = tallyTimeClasses(games);
  const stats: GameStats = {
    total: games.length,
    byTimeClass,
    white: 0,
    black: 0,
    wins: 0,
    losses: 0,
    draws: 0,
  };
  for (const g of games) {
    if (g.colour === 'white') stats.white++;
    else stats.black++;
    if (g.result === 'win') stats.wins++;
    else if (g.result === 'loss') stats.losses++;
    else stats.draws++;
  }
  return stats;
}
