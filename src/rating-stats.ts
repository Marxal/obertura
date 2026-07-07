// Rating numbers for the Statistics screen — your CURRENT site ratings and a
// rating-over-time series, per time class.
//
//   • Live ratings come from the platform's free, CORS-open public API:
//       Chess.com  GET api.chess.com/pub/player/{user}/stats
//       Lichess    GET lichess.org/api/user/{user}
//     Both fail soft (null) and sit behind a small localStorage cache so the
//     Statistics screen never blocks on the network and works offline with the
//     last-seen numbers.
//
//   • History: Lichess has a public rating-history endpoint (the full series,
//     instantly). Chess.com has none, so its series is built from the ratings
//     your imported games carry (ImportedGame.myRating) — it fills in as games
//     are imported/refreshed.
//
// Pure aggregation helpers carry no DOM; only the fetchers touch the network.

import type { ImportedGame, Platform, TimeClass } from './import-core';

// One time-class's live numbers. `best` and the W-L-D record are Chess.com
// extras; Lichess's user API doesn't break the record down per class.
export interface LiveClassRating {
  rating: number;
  best?: number;
  games?: number;
  wins?: number;
  losses?: number;
  draws?: number;
}

export interface LiveRatings {
  platform: Platform;
  username: string;
  fetchedAt: number; // epoch ms
  classes: Partial<Record<TimeClass, LiveClassRating>>;
}

const CACHE_KEY = 'obertura.liveRatings';
const CACHE_TTL_MS = 6 * 3600_000; // refresh at most every 6 h
const FETCH_TIMEOUT_MS = 6000;

// The display order for time-class chips, fastest first.
export const TIME_CLASS_ORDER: readonly TimeClass[] = ['bullet', 'blitz', 'rapid', 'daily'];

// ── Live current ratings ──────────────────────────────────────────────────────

function readCache(): LiveRatings | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as LiveRatings;
    if (!v || typeof v !== 'object' || !v.classes) return null;
    return v;
  } catch {
    return null;
  }
}

function writeCache(v: LiveRatings): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(v)); } catch { /* non-critical */ }
}

// The last-seen live ratings for this account, fresh or stale — for painting
// something immediately while (or instead of) fetching.
export function cachedLiveRatings(platform: Platform, username: string): LiveRatings | null {
  const c = readCache();
  if (!c || c.platform !== platform) return null;
  if (c.username.toLowerCase() !== username.toLowerCase()) return null;
  return c;
}

// Fetch (or reuse) the account's current ratings. Uses the cache within its
// TTL; on any network failure falls back to the stale cache, else null.
export async function getLiveRatings(platform: Platform, username: string): Promise<LiveRatings | null> {
  const cached = cachedLiveRatings(platform, username);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  const fetched = platform === 'chesscom'
    ? await fetchChesscomStats(username)
    : await fetchLichessPerfs(username);
  if (!fetched) return cached; // offline — the stale numbers still beat nothing

  const result: LiveRatings = { platform, username, fetchedAt: Date.now(), classes: fetched };
  writeCache(result);
  return result;
}

interface ChesscomPerf {
  last?: { rating?: number };
  best?: { rating?: number };
  record?: { win?: number; loss?: number; draw?: number };
}

async function fetchChesscomStats(username: string): Promise<LiveRatings['classes'] | null> {
  try {
    const res = await fetch(
      `https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/stats`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    const data = await res.json() as Record<string, ChesscomPerf>;
    const map: [string, TimeClass][] = [
      ['chess_bullet', 'bullet'], ['chess_blitz', 'blitz'],
      ['chess_rapid', 'rapid'], ['chess_daily', 'daily'],
    ];
    const classes: LiveRatings['classes'] = {};
    for (const [key, tc] of map) {
      const p = data[key];
      const rating = p?.last?.rating;
      if (typeof rating !== 'number') continue;
      const rec = p?.record;
      const wins = rec?.win, losses = rec?.loss, draws = rec?.draw;
      classes[tc] = {
        rating,
        ...(typeof p?.best?.rating === 'number' ? { best: p.best.rating } : {}),
        ...(typeof wins === 'number' ? { wins } : {}),
        ...(typeof losses === 'number' ? { losses } : {}),
        ...(typeof draws === 'number' ? { draws } : {}),
        ...(typeof wins === 'number' && typeof losses === 'number' && typeof draws === 'number'
          ? { games: wins + losses + draws } : {}),
      };
    }
    return Object.keys(classes).length ? classes : null;
  } catch {
    return null;
  }
}

interface LichessPerf { games?: number; rating?: number; prov?: boolean }

async function fetchLichessPerfs(username: string): Promise<LiveRatings['classes'] | null> {
  try {
    const res = await fetch(
      `https://lichess.org/api/user/${encodeURIComponent(username)}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    const data = await res.json() as { perfs?: Record<string, LichessPerf> };
    const perfs = data.perfs ?? {};
    const classes: LiveRatings['classes'] = {};
    const take = (name: string, tc: TimeClass): void => {
      const p = perfs[name];
      // Skip provisional ratings with no games behind them — they're noise.
      if (!p || typeof p.rating !== 'number' || (p.games ?? 0) === 0) return;
      const existing = classes[tc];
      // classical + correspondence both fold into "daily"; keep the more-played.
      if (existing && (existing.games ?? 0) >= (p.games ?? 0)) return;
      classes[tc] = { rating: p.rating, ...(typeof p.games === 'number' ? { games: p.games } : {}) };
    };
    take('bullet', 'bullet');
    take('blitz', 'blitz');
    take('rapid', 'rapid');
    take('classical', 'daily');
    take('correspondence', 'daily');
    return Object.keys(classes).length ? classes : null;
  } catch {
    return null;
  }
}

// ── Rating history ────────────────────────────────────────────────────────────

export interface RatingHistoryPoint {
  ms: number;     // epoch ms (start of that day)
  rating: number;
}

// Build a per-day series from the ratings your imported games carry: the LAST
// rated game of each day sets that day's point (oldest → newest). Unrated games
// don't move a rating, so they're skipped.
export function ratingSeriesFromGames(games: ImportedGame[], timeClass: TimeClass): RatingHistoryPoint[] {
  const byDay = new Map<string, { ms: number; endTime: number; rating: number }>();
  for (const g of games) {
    if (g.timeClass !== timeClass || !g.rated) continue;
    if (typeof g.myRating !== 'number' || !g.endTime) continue;
    const d = new Date(g.endTime * 1000);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const prev = byDay.get(key);
    if (!prev || g.endTime > prev.endTime) {
      byDay.set(key, {
        ms: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
        endTime: g.endTime,
        rating: g.myRating,
      });
    }
  }
  return [...byDay.values()]
    .sort((a, b) => a.ms - b.ms)
    .map(({ ms, rating }) => ({ ms, rating }));
}

// Lichess's full rating history, one series per time class we track. Cached in
// sessionStorage (it can be a big payload) for the session; fails soft to null.
//   GET https://lichess.org/api/user/{user}/rating-history
//   → [{ name: "Blitz", points: [[year, month0, day, rating], …] }, …]
const HISTORY_CACHE_PREFIX = 'obertura.lichessRatingHistory.';
// Cap each series so a decade of daily points doesn't bloat storage/DOM.
const HISTORY_MAX_POINTS = 400;

const LICHESS_HISTORY_NAME: Record<string, TimeClass> = {
  Bullet: 'bullet',
  Blitz: 'blitz',
  Rapid: 'rapid',
  Classical: 'daily',
  Correspondence: 'daily',
};

export async function fetchLichessRatingHistory(
  username: string,
): Promise<Partial<Record<TimeClass, RatingHistoryPoint[]>> | null> {
  const cacheKey = HISTORY_CACHE_PREFIX + username.toLowerCase();
  try {
    const raw = sessionStorage.getItem(cacheKey);
    if (raw) return JSON.parse(raw) as Partial<Record<TimeClass, RatingHistoryPoint[]>>;
  } catch { /* fall through to the fetch */ }

  try {
    const res = await fetch(
      `https://lichess.org/api/user/${encodeURIComponent(username)}/rating-history`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    const data = await res.json() as { name?: string; points?: [number, number, number, number][] }[];
    const out: Partial<Record<TimeClass, RatingHistoryPoint[]>> = {};
    for (const perf of data) {
      const tc = perf.name ? LICHESS_HISTORY_NAME[perf.name] : undefined;
      if (!tc || !perf.points?.length) continue;
      const series = perf.points
        .map(([y, m0, d, rating]) => ({ ms: new Date(y, m0, d).getTime(), rating }))
        .sort((a, b) => a.ms - b.ms)
        .slice(-HISTORY_MAX_POINTS);
      // classical + correspondence both fold into "daily" — keep the longer one.
      if (!out[tc] || series.length > out[tc]!.length) out[tc] = series;
    }
    if (!Object.keys(out).length) return null;
    try { sessionStorage.setItem(cacheKey, JSON.stringify(out)); } catch { /* non-critical */ }
    return out;
  } catch {
    return null;
  }
}

// ── Small pure helpers for the screen ─────────────────────────────────────────

// The account's most-played time class among the given games (falls back to the
// first class that has any live rating, then 'blitz').
export function dominantTimeClass(games: ImportedGame[], live: LiveRatings | null): TimeClass {
  const counts = new Map<TimeClass, number>();
  for (const g of games) counts.set(g.timeClass, (counts.get(g.timeClass) ?? 0) + 1);
  let best: TimeClass | null = null;
  for (const tc of TIME_CLASS_ORDER) {
    if ((counts.get(tc) ?? 0) > (best ? counts.get(best)! : 0)) best = tc;
  }
  if (best) return best;
  for (const tc of TIME_CLASS_ORDER) if (live?.classes[tc]) return tc;
  return 'blitz';
}

// Clip a series to the last N days (null = everything).
export function clipHistory(points: RatingHistoryPoint[], days: number | null): RatingHistoryPoint[] {
  if (days === null) return points;
  const cutoff = Date.now() - days * 86_400_000;
  return points.filter(p => p.ms >= cutoff);
}
