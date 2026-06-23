// A thin client for the free Lichess opening explorer (no API key, online,
// lightly rate-limited). Used by the builder's Library slide to show, per
// continuation, how real games went — both as a win/draw/loss bar on book moves
// and, once the bundled book runs out, as the continuations themselves.
//
// Two public databases, both anonymous:
//   'lichess'  — every rated Lichess game (the largest sample; hundreds of
//                millions in early positions). We pass the full speed and rating
//                range explicitly so the sample isn't narrowed by API defaults.
//   'masters'  — over-the-board games between strong titled players (cleaner
//                theory, far smaller counts).
//
// Per continuation we return how those games went (white/draws/black). The games
// total is the sum, so callers can show a count. Counts are Lichess's own,
// unrelated to the bundled library's named-opening count.

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

// The full speed and rating-band ranges for the Lichess database. Sent
// explicitly so we always get the widest sample (omitting them lets the API
// apply narrower defaults, which makes positions look far emptier than they are).
const ALL_SPEEDS = 'ultraBullet,bullet,blitz,rapid,classical,correspondence';
const ALL_RATINGS = '0,1000,1200,1400,1600,1800,2000,2200,2500';

// Per-database, per-FEN cache for the session, plus a single in-flight request
// that newer positions abort — we only ever care about the current position.
const cache = new Map<string, Map<string, ExplorerCounts>>();
let inflight: AbortController | null = null;

export async function fetchExplorer(
  fen: string,
  db: ExplorerDb = 'lichess',
  token?: string | null,
): Promise<Map<string, ExplorerCounts> | null> {
  const key = `${db}|${fen}`;
  const cached = cache.get(key);
  if (cached) return cached;

  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  try {
    let url = `${ENDPOINTS[db]}?topGames=0&moves=24&fen=${encodeURIComponent(fen)}`;
    if (db === 'lichess') {
      url += `&variant=standard&recentGames=0` +
        `&speeds=${ALL_SPEEDS}&ratings=${ALL_RATINGS}`;
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
    cache.set(key, map);
    return map;
  } catch {
    return null; // offline / aborted / CORS / parse error — caller falls back
  } finally {
    if (inflight === ctrl) inflight = null;
  }
}
