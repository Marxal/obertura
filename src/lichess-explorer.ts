// A thin client for the free Lichess opening explorer (no API key, online,
// lightly rate-limited). Used by the builder's Library slide to show, per
// continuation, how real games went — both as a win/draw/loss bar on book moves
// and, once the bundled book runs out, as the continuations themselves.
//
// Two public databases, both anonymous:
//   'lichess'  — every rated Lichess game (the largest sample; hundreds of
//                millions in early positions). We pass the speed and rating
//                range explicitly so the sample isn't narrowed by API defaults —
//                and, when the user has picked a rating band, so it IS narrowed,
//                deliberately (explorer-bands.ts).
//   'masters'  — over-the-board games between strong titled players (cleaner
//                theory, far smaller counts). Takes NO rating or speed filter;
//                see the note on the filter argument below.
//
// Per continuation we return how those games went (white/draws/black). The games
// total is the sum, so callers can show a count. Counts are Lichess's own,
// unrelated to the bundled library's named-opening count.

import { ALL_FILTER, type ExplorerFilter } from './explorer-bands';

export type ExplorerDb = 'masters' | 'lichess';

export interface ExplorerCounts {
  white: number;
  draws: number;
  black: number;
}

const ENDPOINTS: Record<ExplorerDb, string> = {
  lichess: 'https://explorer.lichess.org/lichess',
  masters: 'https://explorer.lichess.org/masters',
};

// Per-request cache for the session, plus a single in-flight request that newer
// positions abort — we only ever care about the current position.
const cache = new Map<string, Map<string, ExplorerCounts>>();
let inflight: AbortController | null = null;

// THE CACHE KEY IS BUILT FROM THE SAME VALUES THE URL IS.
//
// Keyed on the position alone, changing the rating band would serve the previous
// band's numbers back for every position already visited — and it would look
// like it worked, because the numbers are plausible either way. That is not a
// bug you find by using the app.
//
// So the key is derived from exactly the fields that vary the RESPONSE: the
// database, and the two filter strings that go into the query verbatim. Both
// come from the one ExplorerFilter the caller passed, so the request and the key
// cannot describe different things. Masters passes null and gets stable empty
// segments, which keeps its existing entries valid.
function cacheKey(fen: string, db: ExplorerDb, filter: ExplorerFilter | null): string {
  return `${db}|${filter?.ratings ?? ''}|${filter?.speeds ?? ''}|${fen}`;
}

// Drop everything cached this session and abort any in-flight request. Called on
// connect AND disconnect (see lichess-auth.ts): the cache is NOT keyed by token,
// so an auth-state change must reset it — otherwise an entry fetched in the wrong
// auth state lingers until a full page reload. (Reconnecting used to be the only
// thing that cleared it, because the OAuth redirect reloads the page; that's why
// the library appeared to "come back" only after a disconnect/reconnect.)
export function clearExplorerCache(): void {
  cache.clear();
  inflight?.abort();
  inflight = null;
}

// `filter` is the rating/speed narrowing, or null for "this database has no such
// dimension". It is ONLY ever sent to the lichess database: /masters has no
// `ratings` or `speeds` parameter, and — verified against the server — ignores
// unknown query parameters instead of rejecting them, so sending a band there
// would return HTTP 200 full of unfiltered numbers under a filtered label.
export async function fetchExplorer(
  fen: string,
  db: ExplorerDb = 'lichess',
  token?: string | null,
  filter: ExplorerFilter | null = null,
): Promise<Map<string, ExplorerCounts> | null> {
  // The lichess database always sends both parameters explicitly — omitting them
  // lets the API apply narrower defaults, which makes positions look far emptier
  // than they are. With no band chosen that's the full range, i.e. exactly the
  // request this module has always made.
  const effective = db === 'lichess' ? (filter ?? ALL_FILTER) : null;

  const key = cacheKey(fen, db, effective);
  const cached = cache.get(key);
  if (cached) return cached;

  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  try {
    let url = `${ENDPOINTS[db]}?topGames=0&moves=24&fen=${encodeURIComponent(fen)}`;
    if (effective) {
      url += `&variant=standard&recentGames=0` +
        `&speeds=${effective.speeds}&ratings=${effective.ratings}`;
    }
    // Lichess now gates the explorer behind a login; an anonymous request is
    // blocked. The token (when connected) lets us through. Without one we still
    // try — it just degrades to the bundled stats in the caller.
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) return null;
    const data = await res.json() as {
      moves?: Array<{ uci: string; white: number; draws: number; black: number }>;
    };
    const map = new Map<string, ExplorerCounts>();
    for (const m of data.moves ?? []) {
      map.set(m.uci, { white: m.white, draws: m.draws, black: m.black });
    }
    // Only cache a non-empty answer. An empty map means "reached, no games here"
    // (a deep position) — cheap to re-ask, and NOT caching it means a one-off
    // blocked/flaky response can't poison this position for the whole session.
    // The empty map is still RETURNED, so the caller can tell it apart from a
    // null (couldn't reach live) and degrade gracefully either way.
    if (map.size) cache.set(key, map);
    return map;
  } catch {
    return null; // offline / aborted / CORS / parse error — caller falls back
  } finally {
    if (inflight === ctrl) inflight = null;
  }
}
