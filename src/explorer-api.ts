// Online "deeper lines" source for the Library board explorer. Once a walked
// line leaves the bundled ECO book, this asks the free, public Lichess masters
// opening explorer (explorer.lichess.ovh) for sensible continuations AND for the
// real master games played from the position (FIDE-rated, 2200+ OTB, 1952–now —
// the closest free, no-auth source of "FIDE games" there is). That host needs NO
// auth token (unlike some lichess.org/api endpoints).
//
// Everything here is a graceful enhancement layered BEHIND the bundled book:
// named openings still render instantly and offline. Any failure — offline,
// timeout, or a 429 rate-limit — resolves to a typed "couldn't load" result so
// the book browser is never blocked or broken.
//
// VERIFICATION NOTE: the build container's network allowlist blocks lichess
// hosts (same as lichess.ts), so the live call can't be exercised in CI — only
// from the phone. The endpoint + params are confirmed against the public
// explorer API; the response PARSING is covered offline by
// explorer-api.selftest.ts.

const HOST = 'https://explorer.lichess.ovh/masters';
const TIMEOUT_MS = 12000; // the masters DB is slower than the games DB, esp. cold
const MAX_MOVES = 12; // how many continuations to ask for
const TOP_GAMES = 10; // how many real master games to show for the position

// One continuation from a position: a move plus how many master games reached it.
export interface ExplorerMove {
  uci: string;
  san: string;
  games: number; // white + draws + black totals for this move
}

// One real master game played FROM the current position: players, ratings,
// result and year, plus the lichess id so the UI can link to it.
export interface ExplorerGame {
  id: string;
  white: string;
  whiteRating: number;
  black: string;
  blackRating: number;
  winner: 'white' | 'black' | null;
  year: number;
}

// A typed outcome so the UI can show the right message without try/catch.
// `detail` carries the real failure cause (HTTP status / error name) so a stuck
// request can be diagnosed from the phone, where the live call actually runs.
export type ExplorerResult =
  | { ok: true; moves: ExplorerMove[]; games: ExplorerGame[] }
  | { ok: false; reason: 'offline' | 'rate-limited'; detail?: string };

// Pure parser, split out so it can be unit-tested offline. Defensive about the
// shape: anything unexpected just yields no moves rather than throwing.
export function parseExplorerMoves(json: unknown): ExplorerMove[] {
  if (!json || typeof json !== 'object') return [];
  const rawMoves = (json as { moves?: unknown }).moves;
  if (!Array.isArray(rawMoves)) return [];

  const out: ExplorerMove[] = [];
  for (const m of rawMoves) {
    if (!m || typeof m !== 'object') continue;
    const { uci, san, white, draws, black } = m as Record<string, unknown>;
    if (typeof uci !== 'string' || typeof san !== 'string') continue;
    const games =
      (typeof white === 'number' ? white : 0) +
      (typeof draws === 'number' ? draws : 0) +
      (typeof black === 'number' ? black : 0);
    out.push({ uci, san, games });
  }
  return out;
}

// Pure parser for the `topGames` array, split out for offline unit testing.
// Same defensive stance as parseExplorerMoves: anything missing or oddly shaped
// is skipped rather than thrown over.
export function parseTopGames(json: unknown): ExplorerGame[] {
  if (!json || typeof json !== 'object') return [];
  const raw = (json as { topGames?: unknown }).topGames;
  if (!Array.isArray(raw)) return [];

  const out: ExplorerGame[] = [];
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue;
    const { id, winner, year, white, black } = g as Record<string, unknown>;
    if (typeof id !== 'string') continue;
    const w = white && typeof white === 'object' ? (white as Record<string, unknown>) : {};
    const b = black && typeof black === 'object' ? (black as Record<string, unknown>) : {};
    out.push({
      id,
      white: typeof w.name === 'string' ? w.name : '?',
      whiteRating: typeof w.rating === 'number' ? w.rating : 0,
      black: typeof b.name === 'string' ? b.name : '?',
      blackRating: typeof b.rating === 'number' ? b.rating : 0,
      winner: winner === 'white' || winner === 'black' ? winner : null,
      year: typeof year === 'number' ? year : 0,
    });
  }
  return out;
}

// In-memory cache keyed by the position's EPD (first four FEN fields, dropping
// the move clocks — they never change the continuations). Only SUCCESSFUL
// lookups are cached, so a failed request (offline / 429) can be retried later.
const cache = new Map<string, { moves: ExplorerMove[]; games: ExplorerGame[] }>();

function epd(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

// Fetch the master-game continuations for a position. Resolves (never rejects)
// to a typed result; on timeout/offline/429 the caller shows a soft fallback.
export async function deeperMoves(fen: string): Promise<ExplorerResult> {
  const key = epd(fen);
  const hit = cache.get(key);
  if (hit) return { ok: true, moves: hit.moves, games: hit.games };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Build the query by hand: URLSearchParams encodes spaces as "+", which the
    // masters endpoint rejects inside a FEN. encodeURIComponent uses %20 — but it
    // also turns the FEN's "/" separators into %2F, which lichess's proxy bounces
    // (a 401). Restore literal slashes (legal in a query string); FENs only hold
    // letters/digits/"/"/space/"-", so encoding just the rest is safe.
    const fenParam = encodeURIComponent(fen).replace(/%2F/g, '/');
    const url = `${HOST}?fen=${fenParam}&moves=${MAX_MOVES}&topGames=${TOP_GAMES}`;

    const res = await fetch(url, { signal: controller.signal });
    if (res.status === 429) return { ok: false, reason: 'rate-limited' };
    if (!res.ok) return { ok: false, reason: 'offline', detail: `HTTP ${res.status}` };

    const json = await res.json();
    const moves = parseExplorerMoves(json);
    const games = parseTopGames(json);
    cache.set(key, { moves, games });
    return { ok: true, moves, games };
  } catch (err) {
    // AbortError (timeout) or a network failure (offline / blocked host / CORS).
    return { ok: false, reason: 'offline', detail: (err as Error)?.name || 'error' };
  } finally {
    clearTimeout(timer);
  }
}
