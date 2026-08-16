// "What level does this user actually play at?" — the number behind the
// explorer's "Around my level" band, and the band that is actually in force.
//
// THREE SOURCES, IN ORDER:
//
//   1. A rating typed in Settings. It's last in the list of things we can work
//      out AUTOMATICALLY, but first here: somebody who opened Settings and typed
//      a number has told us their level outright, and a field that gets silently
//      overruled by a guess is worse than no field at all.
//   2. Your imported games — the most-played time class, then the median rating
//      across your five most recent RATED games in it. A median, not the last
//      game, because one bad night is not a level.
//   3. Your connected Lichess account — GET /api/account, whose `perfs` carry a
//      rating per speed. THIS NEEDS NO NEW OAUTH SCOPE: the endpoint is declared
//      `security: OAuth2: []` (any valid token, no scope required), so the
//      `puzzle:read` token the app already has reaches it. Nothing here ever
//      asks for a wider grant.
//
// Nothing found → null. "Around my level" is then unavailable and the band falls
// back to All ratings, which is exactly what the app did before this existed.
//
// The answer is cached in localStorage so the Library slide can paint a band
// caption on its first frame instead of after a round trip.

import { getAllGames } from './storage';
import type { ImportedGame, TimeClass } from './import-core';
import { getAccessToken, isConnected } from './lichess-auth';
import { getExplorerBand, getManualLevel } from './prefs';
import type { ExplorerBand } from './explorer-bands';

export type LevelSource = 'manual' | 'games' | 'lichess';

export interface MyLevel {
  rating: number;
  source: LevelSource;
  // Which speed the rating came from, when the source knows. Drives the caption
  // ("from your rapid rating, 1520").
  timeClass?: TimeClass;
}

const CACHE_KEY = 'obertura.explorerLevel';
// Ratings move slowly; a day-old number is still the right band.
const CACHE_TTL_MS = 24 * 3600_000;
const FETCH_TIMEOUT_MS = 6000;
// How many recent games the median is taken over. Small enough to track a real
// change in strength, big enough that one game can't move the band.
const RECENT_GAMES = 5;

interface CachedLevel extends MyLevel { fetchedAt: number }

function readCache(): CachedLevel | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as CachedLevel;
    return typeof v?.rating === 'number' && v.rating > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeCache(level: MyLevel | null): void {
  try {
    if (level === null) localStorage.removeItem(CACHE_KEY);
    else localStorage.setItem(CACHE_KEY, JSON.stringify({ ...level, fetchedAt: Date.now() }));
  } catch { /* storage off — we just re-derive next time */ }
}

// The level we can answer with RIGHT NOW, with no awaiting: a manual rating (an
// outright statement, always current) or the last cached inference. For the
// first paint; resolveMyLevel() then refreshes it.
export function cachedMyLevel(): MyLevel | null {
  const manual = getManualLevel();
  if (manual !== null) return { rating: manual, source: 'manual' };
  return readCache();
}

// The full chain. Cheap and safe to call on every panel open — it only touches
// the network when games gave nothing and the cached account rating has aged
// out. Never throws; a failure just means "no level", which is a valid answer.
export async function resolveMyLevel(): Promise<MyLevel | null> {
  const manual = getManualLevel();
  if (manual !== null) return { rating: manual, source: 'manual' };

  const fromGames = await levelFromGames();
  if (fromGames) { writeCache(fromGames); return fromGames; }

  const cached = readCache();
  // A cached account rating that hasn't aged out is worth more than a fetch.
  if (cached && cached.source === 'lichess' && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  const fromLichess = await levelFromLichess();
  if (fromLichess) { writeCache(fromLichess); return fromLichess; }

  // A stale cached number still beats no band at all (offline, rate-limited).
  return cached ?? null;
}

// ── 2. Your imported games ────────────────────────────────────────────────────

async function levelFromGames(): Promise<MyLevel | null> {
  try {
    return levelFromGameList(await getAllGames());
  } catch {
    return null;   // storage unavailable — not an error worth surfacing
  }
}

// Split out and pure, so the self-test can drive it without IndexedDB.
export function levelFromGameList(games: ImportedGame[]): MyLevel | null {
  // Only rated games with a rating on them can say anything about a level.
  const usable = games.filter(g => g.rated && typeof g.myRating === 'number' && g.myRating > 0);
  if (!usable.length) return null;

  // The most-played time class — the one whose rating actually represents them.
  const counts = new Map<TimeClass, number>();
  for (const g of usable) counts.set(g.timeClass, (counts.get(g.timeClass) ?? 0) + 1);
  let timeClass: TimeClass | null = null;
  let best = 0;
  for (const [tc, n] of counts) {
    if (n > best) { best = n; timeClass = tc; }
  }
  if (!timeClass) return null;

  const recent = usable
    .filter(g => g.timeClass === timeClass)
    .sort((a, b) => b.endTime - a.endTime)
    .slice(0, RECENT_GAMES)
    .map(g => g.myRating as number);
  if (!recent.length) return null;

  return { rating: median(recent), source: 'games', timeClass };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// ── 3. Your connected Lichess account ─────────────────────────────────────────

interface LichessPerf { games?: number; rating?: number; prov?: boolean }

// Lichess speeds folded into the app's four buckets, the same way import-core
// does it — classical and correspondence both land in "daily".
const PERF_CLASSES: [string, TimeClass][] = [
  ['bullet', 'bullet'],
  ['blitz', 'blitz'],
  ['rapid', 'rapid'],
  ['classical', 'daily'],
  ['correspondence', 'daily'],
];

async function levelFromLichess(): Promise<MyLevel | null> {
  if (!isConnected()) return null;
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const res = await fetch('https://lichess.org/api/account', {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json() as { perfs?: Record<string, LichessPerf> };
    const perfs = data.perfs ?? {};

    // The speed they've played most — the same "which number represents them?"
    // question the games path answers, asked of the account instead.
    let bestGames = 0;
    let level: MyLevel | null = null;
    for (const [perf, tc] of PERF_CLASSES) {
      const p = perfs[perf];
      // Provisional ratings, and ratings with no games behind them, are noise.
      if (!p || typeof p.rating !== 'number' || p.prov || (p.games ?? 0) === 0) continue;
      if ((p.games ?? 0) <= bestGames) continue;
      bestGames = p.games ?? 0;
      level = { rating: p.rating, source: 'lichess', timeClass: tc };
    }
    return level;
  } catch {
    return null;   // offline, blocked, rejected token — no level, no noise
  }
}

// ── The band actually in force ────────────────────────────────────────────────

export interface ActiveBand {
  band: ExplorerBand;
  // True when the app picked this band rather than the user. The control says so
  // out loud — a band the user never chose must never look like one they did.
  inferred: boolean;
  level: MyLevel | null;
}

// Resolve the stored choice against what we know about the user. Synchronous, so
// every render can call it; `level` comes from the cache that resolveMyLevel()
// keeps warm.
export function activeBand(level: MyLevel | null = cachedMyLevel()): ActiveBand {
  const stored = getExplorerBand();
  if (stored) return { band: stored, inferred: false, level };
  // Never chosen: follow their level when we know it, otherwise behave exactly
  // as the app did before bands existed.
  return { band: level ? 'mine' : 'all', inferred: !!level, level };
}

// How the caption explains where an inferred level came from — the quiet line
// that stops the band feeling like a guess made behind the user's back.
export function levelSourceLabel(level: MyLevel): string {
  const speed = level.timeClass === 'daily' ? 'classical' : level.timeClass;
  switch (level.source) {
    case 'manual': return `from the rating you set, ${level.rating}`;
    case 'lichess': return `from your Lichess ${speed ?? ''} rating, ${level.rating}`.replace('  ', ' ');
    default: return `from your ${speed ?? ''} rating, ${level.rating}`.replace('  ', ' ');
  }
}
