// Chess.com source for the shared import core (see import-core.ts).
//
// The free Published-Data API (no key, no auth) does all the work via two
// endpoints:
//   1. .../games/archives        → a list of monthly-archive URLs (one per month
//                                   you ever played), oldest first.
//   2. .../games/{YYYY}/{MM}     → every game you played that month, each with a
//                                   PGN string.
//
// This module lists the archives, takes the chosen RANGE of recent months, and
// fetches them SERIALLY newest-first (the API asks callers not to hammer it in
// parallel) — handing each month's games to the core as NormalisedGame batches.
// The core parses, caps at HARD_CAP newest-first, tallies and reports. We keep
// every time format here; filtering by speed happens locally afterwards.

import {
  runImport,
  parseNormalised,
  type NormalisedGame,
  type TimeClass,
  type Range,
  type ImportOptions,
  type ImportResult,
  type SourceFetch,
} from './import-core';

// Re-exported so existing importers of './chesscom' keep working unchanged while
// the shared shapes/helpers now live in import-core.
export {
  OPENING_PLIES,
  summariseGames,
  parseNormalised,
  type ImportedGame,
  type TimeClass,
  type GameResult,
  type GameStats,
  type NormalisedGame,
} from './import-core';
import type { ImportedGame } from './import-core';

const API_BASE = 'https://api.chess.com/pub';
const USERNAME_KEY = 'obertura.chesscomUser';

// Legacy "my games" default range, in months. The new range chooser (1/3/12)
// replaces this in the next task; the current callers still pass it.
export const MONTHS_BACK: Range = 12;

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

// Fetch a player's profile picture from the Chess.com public API. Returns the
// avatar URL, or undefined when they have none (or the request fails) — purely
// cosmetic, so a miss just means the fallback user icon shows instead.
export async function fetchAvatar(username: string): Promise<string | undefined> {
  const name = username.trim().toLowerCase();
  if (!name) return undefined;
  try {
    const res = await fetch(`${API_BASE}/player/${encodeURIComponent(name)}`);
    if (!res.ok) return undefined;
    const data = (await res.json()) as { avatar?: string };
    return typeof data.avatar === 'string' && data.avatar ? data.avatar : undefined;
  } catch {
    return undefined;
  }
}

// ── Raw API shapes (only the fields we read) ───────────────────────────────────

interface ArchivesResponse {
  archives: string[]; // full monthly URLs, oldest → newest
}

interface RawPlayer {
  username: string;
  result: string; // "win", "checkmated", "agreed", "timeout", "resigned", …
  rating?: number;
}

export interface RawGame {
  url: string;
  uuid?: string;
  pgn?: string;
  time_control: string;
  time_class: TimeClass;
  rated?: boolean;
  rules?: string; // "chess", "chess960", "bughouse", … — we keep only "chess"
  end_time?: number;
  eco?: string; // an ECO *URL*, e.g. https://www.chess.com/openings/Italian-Game
  white: RawPlayer;
  black: RawPlayer;
}

interface ArchiveResponse {
  games: RawGame[];
}

// Turn a chess.com opening URL into a readable name:
//   https://www.chess.com/openings/Sicilian-Defense-Najdorf-Variation
//   → "Sicilian Defense Najdorf Variation"
function openingFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const slug = url.split('/').pop();
  if (!slug) return null;
  return decodeURIComponent(slug).replace(/-/g, ' ').replace(/\.\.\..*$/, '').trim() || null;
}

// ── RawGame → NormalisedGame ────────────────────────────────────────────────────

// Map one chess.com game to the platform-neutral shape, or null to drop it
// (non-standard variant, or no PGN). The ECO *code* comes from the PGN's [ECO]
// header, so we leave the hint null and let the core read it after parsing.
export function normaliseChesscom(raw: RawGame): NormalisedGame | null {
  if (raw.rules && raw.rules !== 'chess') return null; // variants don't belong in a repertoire
  if (!raw.pgn) return null;

  // chess.com marks the winning side's result "win"; draws give both sides a
  // draw code (agreed/stalemate/repetition/…) and neither "win".
  const winner: NormalisedGame['winner'] =
    raw.white.result === 'win' ? 'white' :
    raw.black.result === 'win' ? 'black' :
    null;

  return {
    id: raw.uuid || raw.url,
    url: raw.url,
    endTime: raw.end_time ?? 0,
    timeClass: raw.time_class,
    timeControl: raw.time_control,
    rated: raw.rated ?? false,
    white: raw.white.username,
    black: raw.black.username,
    whiteRating: raw.white.rating,
    blackRating: raw.black.rating,
    winner,
    pgn: raw.pgn,
    eco: null,
    opening: openingFromUrl(raw.eco),
  };
}

// Back-compat: parse one raw chess.com game straight to an ImportedGame. Used by
// the import self-test.
export function parseGame(raw: RawGame, username: string): ImportedGame | null {
  const norm = normaliseChesscom(raw);
  if (!norm) return null;
  return parseNormalised(norm, username);
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

// The shared core's Chess.com fetcher: scan the chosen months newest-first,
// emitting each month's games (newest-first within the month) to the core.
export const fetchChesscom: SourceFetch = async (username, months, emit) => {
  const user = username.trim();
  if (!user) throw new Error('Enter your Chess.com username first.');

  const all = await listArchives(user);
  const recent = all.slice(-months);          // last N months (URLs are date-ascending)
  const newestFirst = [...recent].reverse();  // … but we want newest first for the cap
  let done = 0;

  for (const archiveUrl of newestFirst) {
    // The URL tail is "/YYYY/MM" — a tidy label for the progress line.
    const label = archiveUrl.split('/').slice(-2).join('/');

    // One transient archive failure (a 5xx, a dropped connection) shouldn't sink
    // the whole import — earlier batches are already saved via onGames. Skip the
    // bad month and carry on; the next refresh can pick it up.
    let games: RawGame[];
    try {
      ({ games } = await fetchJson<ArchiveResponse>(archiveUrl));
    } catch {
      done++;
      continue;
    }

    // Newest-first within the month so the 500-cap keeps the most recent games.
    const batch = [...games]
      .sort((a, b) => (b.end_time ?? 0) - (a.end_time ?? 0))
      .map(normaliseChesscom)
      .filter((g): g is NormalisedGame => g !== null);
    done++;

    const keepGoing = await emit(batch, {
      monthsTotal: newestFirst.length,
      monthsDone: done,
      label,
    });
    if (!keepGoing) break;
  }

  return newestFirst.length;
};

// ── "My games" entry (back-compat) ──────────────────────────────────────────────

export interface ImportSummary {
  games: ImportedGame[];
  monthsFetched: number;
  skipped: number;
}

// Pull the chosen months of a player's games. Kept as a thin wrapper over the
// shared core so the existing "my games" screens work unchanged; the next task
// swaps these call sites for the unified importGames + range chooser.
export async function importRecentGames(
  username: string,
  opts: { months?: number; onProgress?: ImportOptions['onProgress']; onGames?: ImportOptions['onGames'] } = {},
): Promise<ImportSummary> {
  const result: ImportResult = await runImport('chesscom', fetchChesscom, username, {
    months: (opts.months as Range) ?? MONTHS_BACK,
    onProgress: opts.onProgress,
    onGames: opts.onGames,
  });
  return { games: result.games, monthsFetched: result.monthsScanned, skipped: result.skipped };
}
