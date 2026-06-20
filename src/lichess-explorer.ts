// A thin client for the free Lichess opening explorer (no API key, online,
// lightly rate-limited). Used to put a win/draw/loss bar on the Library slide's
// book moves — the bundled book has no results of its own.
//
// We query the "lichess" database (all rated games — the largest sample) and
// return, per continuation UCI, how those games went. Counts are Lichess's own
// (huge in early positions, fewer as the line deepens), unrelated to the
// bundled library's named-opening count.

export interface ExplorerCounts {
  white: number;
  draws: number;
  black: number;
}

const ENDPOINT = 'https://explorer.lichess.org/lichess';

// Per-FEN cache for the session, plus a single in-flight request that newer
// positions abort — we only ever care about the current position's stats.
const cache = new Map<string, Map<string, ExplorerCounts>>();
let inflight: AbortController | null = null;

export async function fetchExplorer(fen: string): Promise<Map<string, ExplorerCounts> | null> {
  const cached = cache.get(fen);
  if (cached) return cached;

  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  try {
    const url = `${ENDPOINT}?variant=standard&topGames=0&recentGames=0&moves=24` +
      `&fen=${encodeURIComponent(fen)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json() as {
      moves?: Array<{ uci: string; white: number; draws: number; black: number }>;
    };
    const map = new Map<string, ExplorerCounts>();
    for (const m of data.moves ?? []) {
      map.set(m.uci, { white: m.white, draws: m.draws, black: m.black });
    }
    cache.set(fen, map);
    return map;
  } catch {
    return null; // offline / aborted / parse error — caller leaves the count
  } finally {
    if (inflight === ctrl) inflight = null;
  }
}
