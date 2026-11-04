// "Is this you?" — the player behind a username, before an import starts.
//
// A typo used to run the import and come back with nothing, or with a stranger's
// games. Both sites answer this from free, public, CORS-open endpoints, the same
// ones the import itself and the Statistics screen already use.
//
// THREE ANSWERS, and the third matters. 'unknown' is the network failing, or a site
// rate-limiting us, and it must never stop anyone importing: this is a courtesy in
// front of the import, not a gate. Only a definite 404 ('missing') holds it back.

import type { Platform } from './import-core';
import { t } from './i18n';

const TIMEOUT_MS = 6000;

export interface FoundPlayer {
  status: 'found';
  /** As the site spells it. */
  username: string;
  avatarUrl?: string;
  /** Their most-played time format's rating. */
  rating?: { label: string; value: number };
  games?: number;
}

export type PlayerLookup = FoundPlayer | { status: 'missing' } | { status: 'unknown' };

interface Perf { label: string; value: number; games: number }

// The format they play most, which is the rating they'd recognise as theirs.
function mostPlayed(perfs: Perf[]): Perf | undefined {
  return [...perfs].sort((a, b) => b.games - a.games)[0];
}

async function getJson(url: string, signal?: AbortSignal): Promise<{ status: number; data?: unknown }> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) return { status: res.status };
  return { status: res.status, data: await res.json() };
}

async function lookupChesscom(name: string, signal?: AbortSignal): Promise<PlayerLookup> {
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(name.toLowerCase())}`;
  const player = await getJson(base, signal);
  if (player.status === 404) return { status: 'missing' };
  if (!player.data) return { status: 'unknown' };
  const p = player.data as { username?: string; url?: string; avatar?: string };
  // `username` comes back lowercased; the profile URL keeps the real spelling.
  const spelled = p.url?.split('/').pop();

  const perfs: Perf[] = [];
  try {
    const stats = await getJson(`${base}/stats`, signal);
    const s = (stats.data ?? {}) as Record<string, {
      last?: { rating?: number };
      record?: { win?: number; loss?: number; draw?: number };
    }>;
    for (const [key, label] of [
      ['chess_bullet', t('time.bullet')], ['chess_blitz', t('time.blitz')],
      ['chess_rapid', t('time.rapid')], ['chess_daily', t('time.daily')],
    ] as const) {
      const value = s[key]?.last?.rating;
      if (typeof value !== 'number') continue;
      const r = s[key]?.record;
      perfs.push({ label, value, games: (r?.win ?? 0) + (r?.loss ?? 0) + (r?.draw ?? 0) });
    }
  } catch (err) {
    // The profile alone is enough to say "this is them". Only an abort is news.
    if ((err as Error).name === 'AbortError') throw err;
  }
  const top = mostPlayed(perfs);
  return {
    status: 'found',
    username: spelled || p.username || name,
    avatarUrl: p.avatar || undefined,
    rating: top ? { label: top.label, value: top.value } : undefined,
    games: perfs.length > 0 ? perfs.reduce((n, x) => n + x.games, 0) : undefined,
  };
}

async function lookupLichess(name: string, signal?: AbortSignal): Promise<PlayerLookup> {
  const res = await getJson(`https://lichess.org/api/user/${encodeURIComponent(name)}`, signal);
  if (res.status === 404) return { status: 'missing' };
  if (!res.data) return { status: 'unknown' };
  const u = res.data as {
    username?: string;
    disabled?: boolean;
    count?: { all?: number };
    perfs?: Record<string, { games?: number; rating?: number }>;
  };
  // A closed account answers 200 but has no games left to read.
  if (u.disabled) return { status: 'missing' };
  const perfs: Perf[] = [];
  for (const [key, label] of [
    ['bullet', t('time.bullet')], ['blitz', t('time.blitz')], ['rapid', t('time.rapid')],
    ['classical', t('time.classical')], ['correspondence', t('time.correspondence')],
  ] as const) {
    const perf = u.perfs?.[key];
    if (typeof perf?.rating === 'number' && (perf.games ?? 0) > 0) {
      perfs.push({ label, value: perf.rating, games: perf.games ?? 0 });
    }
  }
  const top = mostPlayed(perfs);
  return {
    status: 'found',
    username: u.username ?? name,
    rating: top ? { label: top.label, value: top.value } : undefined,
    games: u.count?.all,
  };
}

/** Rejects only when `signal` aborts; every other failure is 'unknown'. */
export async function lookupPlayer(
  platform: Platform,
  username: string,
  signal?: AbortSignal,
): Promise<PlayerLookup> {
  try {
    return platform === 'chesscom'
      ? await lookupChesscom(username, signal)
      : await lookupLichess(username, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    return { status: 'unknown' };
  }
}
