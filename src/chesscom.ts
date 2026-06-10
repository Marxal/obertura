// Chess.com import via the free Published-Data API (no key, no auth).
//
// Two endpoints do all the work:
//   1. .../games/archives        → a list of monthly-archive URLs (one per month
//                                   you ever played), oldest first.
//   2. .../games/{YYYY}/{MM}     → every game you played that month, each with a
//                                   PGN string.
//
// We list the archives, take roughly the last year, then fetch those months
// SERIALLY (the API asks callers not to hammer it in parallel — serial requests
// are the polite, rate-limit-friendly way), parse each PGN with chess.js, and
// boil every game down to a compact record (see ImportedGame). We keep ALL time
// formats — bullet, blitz, rapid, daily — because the point is to see which
// openings you actually play, regardless of speed.
//
// "Efficiently": we never store the raw PGN (a year of games is thousands of
// strings). Instead we keep just the opening moves (capped at OPENING_PLIES) as
// SAN + UCI, plus a handful of metadata fields. Positions can be replayed from
// the UCI list whenever a later phase needs them. Records are keyed by the
// game's id, so re-running an import overwrites rather than duplicates.

import { Chess } from 'chess.js';

const API_BASE = 'https://api.chess.com/pub';
const USERNAME_KEY = 'obertura.chesscomUser';

// How many monthly archives back to pull. 12 ≈ one year.
export const MONTHS_BACK = 12;

// Opening depth we retain per game. 24 plies = 12 full moves — deep enough to
// capture the opening and early middlegame, shallow enough to stay compact.
export const OPENING_PLIES = 24;

export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily';
export type GameResult = 'win' | 'loss' | 'draw';

// The compact, stored shape — what lands in IndexedDB. Deliberately small.
export interface ImportedGame {
  id: string;            // chess.com game uuid (falls back to the game URL)
  url: string;
  endTime: number;       // unix seconds, UTC (chess.com's end_time)
  timeClass: TimeClass;
  timeControl: string;   // raw, e.g. "180+2" or "1/259200" for daily
  rated: boolean;
  colour: 'white' | 'black'; // which side *you* played
  result: GameResult;        // from your perspective
  opponent: string;
  eco: string | null;        // ECO code from the PGN, if present
  opening: string | null;    // readable opening name, derived from the ECO URL
  sans: string[];            // opening moves in SAN, capped at OPENING_PLIES
  ucis: string[];            // same moves in UCI (e.g. "e2e4"), capped
  plyCount: number;          // total plies in the *full* game (before capping)
}

// ── Username storage (device-local, mirrors the Lichess token in openings.ts) ──

export function getUsername(): string {
  try {
    return localStorage.getItem(USERNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setUsername(name: string): void {
  try {
    const n = name.trim().toLowerCase();
    if (n) localStorage.setItem(USERNAME_KEY, n);
    else localStorage.removeItem(USERNAME_KEY);
  } catch {
    /* private mode / storage disabled — import will just need a fresh name */
  }
}

// ── Raw API shapes (only the fields we read) ───────────────────────────────────

interface ArchivesResponse {
  archives: string[]; // full monthly URLs, oldest → newest
}

interface RawPlayer {
  username: string;
  result: string; // "win", "checkmated", "agreed", "timeout", "resigned", …
}

interface RawGame {
  url: string;
  uuid?: string;
  pgn?: string;
  time_control: string;
  time_class: TimeClass;
  rated?: boolean;
  rules?: string; // "chess", "chess960", "bughouse", … — we keep only "chess"
  end_time?: number;
  eco?: string; // an ECO *URL* on chess.com, e.g. https://www.chess.com/openings/Italian-Game
  white: RawPlayer;
  black: RawPlayer;
}

interface ArchiveResponse {
  games: RawGame[];
}

// Chess.com result codes that mean the game was drawn (everything else that
// isn't "win" is a loss for that side).
const DRAW_RESULTS = new Set([
  'agreed',
  'repetition',
  'stalemate',
  'insufficient',
  '50move',
  'timevsinsufficient',
]);

function resultFor(code: string): GameResult {
  if (code === 'win') return 'win';
  if (DRAW_RESULTS.has(code)) return 'draw';
  return 'loss';
}

// Turn a chess.com opening URL into a readable name:
//   https://www.chess.com/openings/Sicilian-Defense-Najdorf-Variation
//   → "Sicilian Defense Najdorf Variation"
// The ECO field in chess.com PGNs is a URL like this; the bare ECO *code*
// (e.g. "B90") lives in the PGN's ECO header, which we read separately.
function openingFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const slug = url.split('/').pop();
  if (!slug) return null;
  return decodeURIComponent(slug).replace(/-/g, ' ').replace(/\.\.\..*$/, '').trim() || null;
}

// ── PGN → compact record ───────────────────────────────────────────────────────

// Parse one raw game into an ImportedGame, or null if it should be skipped
// (wrong variant, missing/empty/unparseable PGN, or a username we can't match).
export function parseGame(raw: RawGame, username: string): ImportedGame | null {
  // Only standard chess — variants don't belong in an openings repertoire.
  if (raw.rules && raw.rules !== 'chess') return null;
  if (!raw.pgn) return null;

  const me = username.toLowerCase();
  const iAmWhite = raw.white.username.toLowerCase() === me;
  const iAmBlack = raw.black.username.toLowerCase() === me;
  if (!iAmWhite && !iAmBlack) return null; // not our game (shouldn't happen)

  const chess = new Chess();
  try {
    // strict:false tolerates chess.com's clock comments ({[%clk ...]}) and any
    // header quirks. Throws on genuinely broken PGNs, which we skip below.
    chess.loadPgn(raw.pgn, { strict: false });
  } catch {
    return null;
  }

  const verbose = chess.history({ verbose: true });
  if (verbose.length === 0) return null; // abandoned before a move — nothing to learn

  const headers = chess.getHeaders();
  const opening = openingFromUrl(raw.eco);
  const eco = headers.ECO ?? null;

  const colour: 'white' | 'black' = iAmWhite ? 'white' : 'black';
  const result = resultFor((iAmWhite ? raw.white : raw.black).result);

  const capped = verbose.slice(0, OPENING_PLIES);

  return {
    id: raw.uuid || raw.url,
    url: raw.url,
    endTime: raw.end_time ?? 0,
    timeClass: raw.time_class,
    timeControl: raw.time_control,
    rated: raw.rated ?? false,
    colour,
    result,
    opponent: (iAmWhite ? raw.black : raw.white).username,
    eco,
    opening,
    sans: capped.map(m => m.san),
    ucis: capped.map(m => m.lan), // chess.js `lan` is UCI ("e2e4", "e7e8q")
    plyCount: verbose.length,
  };
}

// ── Fetch helpers ──────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404) {
    throw new Error('Player not found — check the username.');
  }
  if (res.status === 429) {
    throw new Error('Chess.com rate limit hit — wait a moment and try again.');
  }
  if (!res.ok) {
    throw new Error(`Chess.com API error ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// List a player's monthly-archive URLs (oldest → newest).
export async function listArchives(username: string): Promise<string[]> {
  const data = await fetchJson<ArchivesResponse>(
    `${API_BASE}/player/${encodeURIComponent(username)}/games/archives`
  );
  return data.archives ?? [];
}

export interface ImportProgress {
  monthsTotal: number;
  monthsDone: number;
  label: string;      // human-readable current step, e.g. "2026/05"
  gamesSoFar: number;
}

export interface ImportSummary {
  games: ImportedGame[];
  monthsFetched: number;
  skipped: number; // games dropped (variant / empty / parse failure)
}

// Pull ~MONTHS_BACK months of games for a player. Archives are fetched serially
// to stay friendly with the API. `onGames` is called after each month so the
// caller can persist incrementally (and free the parsed batch). `onProgress`
// drives a status line.
export async function importRecentGames(
  username: string,
  {
    months = MONTHS_BACK,
    onProgress,
    onGames,
  }: {
    months?: number;
    onProgress?: (p: ImportProgress) => void;
    onGames?: (games: ImportedGame[]) => Promise<void> | void;
  } = {}
): Promise<ImportSummary> {
  const user = username.trim();
  if (!user) throw new Error('Enter your Chess.com username first.');

  const all = await listArchives(user);
  const recent = all.slice(-months); // last N months (URLs are date-ascending)

  const collected: ImportedGame[] = [];
  let skipped = 0;
  let done = 0;

  for (const archiveUrl of recent) {
    // The URL tail is "/YYYY/MM" — a tidy label for the progress line.
    const label = archiveUrl.split('/').slice(-2).join('/');
    onProgress?.({ monthsTotal: recent.length, monthsDone: done, label, gamesSoFar: collected.length });

    // One transient archive failure (a 5xx, a dropped connection) shouldn't sink
    // the whole import — earlier months are already saved via onGames. Skip the
    // bad month and carry on; the next refresh can pick it up.
    let games: ArchiveResponse['games'];
    try {
      ({ games } = await fetchJson<ArchiveResponse>(archiveUrl));
    } catch {
      done++;
      continue;
    }
    const batch: ImportedGame[] = [];
    for (const raw of games) {
      const parsed = parseGame(raw, user);
      if (parsed) batch.push(parsed);
      else skipped++;
    }

    if (batch.length && onGames) await onGames(batch);
    collected.push(...batch);
    done++;
    onProgress?.({ monthsTotal: recent.length, monthsDone: done, label, gamesSoFar: collected.length });
  }

  return { games: collected, monthsFetched: recent.length, skipped };
}

// ── Quick stats over a set of imported games (for the post-import readout) ──────

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
  const stats: GameStats = {
    total: games.length,
    byTimeClass: { bullet: 0, blitz: 0, rapid: 0, daily: 0 },
    white: 0,
    black: 0,
    wins: 0,
    losses: 0,
    draws: 0,
  };
  for (const g of games) {
    stats.byTimeClass[g.timeClass] = (stats.byTimeClass[g.timeClass] ?? 0) + 1;
    if (g.colour === 'white') stats.white++;
    else stats.black++;
    if (g.result === 'win') stats.wins++;
    else if (g.result === 'loss') stats.losses++;
    else stats.draws++;
  }
  return stats;
}
