// Online "deeper lines" source for the Library board explorer. Once a walked
// line leaves the bundled ECO book, this asks the free, public Lichess masters
// opening explorer (explorer.lichess.ovh) for sensible continuations. That host
// needs NO auth token (unlike some lichess.org/api endpoints).
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
const TIMEOUT_MS = 6000;
const MAX_MOVES = 12; // how many continuations to ask for

// One continuation from a position: a move plus how many master games reached it.
export interface ExplorerMove {
  uci: string;
  san: string;
  games: number; // white + draws + black totals for this move
}

// A typed outcome so the UI can show the right message without try/catch.
export type ExplorerResult =
  | { ok: true; moves: ExplorerMove[] }
  | { ok: false; reason: 'offline' | 'rate-limited' };

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

// In-memory cache keyed by the position's EPD (first four FEN fields, dropping
// the move clocks — they never change the continuations). Only SUCCESSFUL
// lookups are cached, so a failed request (offline / 429) can be retried later.
const cache = new Map<string, ExplorerMove[]>();

function epd(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

// Fetch the master-game continuations for a position. Resolves (never rejects)
// to a typed result; on timeout/offline/429 the caller shows a soft fallback.
export async function deeperMoves(fen: string): Promise<ExplorerResult> {
  const key = epd(fen);
  const hit = cache.get(key);
  if (hit) return { ok: true, moves: hit };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = new URL(HOST);
    url.searchParams.set('fen', fen);
    url.searchParams.set('moves', String(MAX_MOVES));
    url.searchParams.set('topGames', '0'); // we only want the moves, not games

    const res = await fetch(url.toString(), { signal: controller.signal });
    if (res.status === 429) return { ok: false, reason: 'rate-limited' };
    if (!res.ok) return { ok: false, reason: 'offline' };

    const moves = parseExplorerMoves(await res.json());
    cache.set(key, moves);
    return { ok: true, moves };
  } catch {
    // AbortError (timeout) or a network failure (offline / blocked host).
    return { ok: false, reason: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}
