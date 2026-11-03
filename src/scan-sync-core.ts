// The pure half of Pro's scan sync: what goes up, and how two devices' copies
// merge. No network, no storage, so it runs under Node in the self-test.
// scan-sync.ts does the talking. SUPABASE-SYNC.md §1 has the column.
//
// WHY IT EXISTS. A scan takes 15-40 seconds a game, so a paying user's new phone
// spent hours re-reading games another device had already read, and lost which
// mistakes they had fixed. The results are still derived data, so the games column
// keeps leaving them out (sync-core.ts). They get a column of their own because a
// scan changes them for hours, and rewriting the games with them would be wasteful.
//
// MERGING. Results are additive: nothing here removes a scan. For one game the
// newer rules win, then the later scan, and training state is combined so that a
// fix on either device counts. Both devices must reach the same answer from the
// same two inputs, or they would push at each other for ever.

import type { GameRetry, MistakeSpot } from './mistake-scan';
import { fingerprint, gamesForSync } from './sync-core';

// The rest logs that travel with the results, each with the cap its module uses.
export const SCAN_LOG_CAPS: Record<string, number> = {
  'obertura.spotRest': 400,
  'obertura.detectiveLog': 300,
  'obertura.whichMoveLog': 300,
  'obertura.brilliantLog': 200,
};

export type ScanLogs = Record<string, Record<string, unknown>>;

export interface ScanPayload {
  v: 1;
  /** When progress was last reset (ms), so a reset on one device holds on all. */
  resetAt: number;
  games: Record<string, GameRetry>;
  logs: ScanLogs;
}

interface ScanGame {
  id: string;
  endTime?: number;
  retry?: GameRetry;
}

/** JSON with sorted keys: the same data always gives the same text. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(v => canonical(v ?? null)).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function scanFingerprint(payload: ScanPayload): string {
  return fingerprint(canonical(payload));
}

/** Only the games the account syncs: the same 500 as the games column. */
export function syncedGameIds(games: readonly ScanGame[]): Set<string> {
  return new Set(gamesForSync(games).map(g => g.id as string));
}

export function buildScanPayload(
  games: readonly ScanGame[],
  logs: ScanLogs,
  resetAt: number,
): ScanPayload {
  const ids = syncedGameIds(games);
  const out: Record<string, GameRetry> = {};
  for (const game of games) {
    if (game.retry && ids.has(game.id)) out[game.id] = game.retry;
  }
  return { v: 1, resetAt, games: out, logs };
}

/** A payload from the account, or null if it isn't one this build understands. */
export function parseScanPayload(raw: unknown): ScanPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<ScanPayload>;
  if (p.v !== 1 || !p.games || typeof p.games !== 'object') return null;
  return {
    v: 1,
    resetAt: Number(p.resetAt) || 0,
    games: p.games,
    logs: p.logs && typeof p.logs === 'object' ? p.logs : {},
  };
}

// Training from before the last reset no longer counts.
function clearOldTraining(spot: MistakeSpot, resetAt: number): MistakeSpot {
  if ((spot.lastTrained ?? 0) > resetAt) return spot;
  if (!spot.fixed && !spot.attempts && !spot.lastTrained) return spot;
  const { fixed: _f, attempts: _a, lastTrained: _l, ...rest } = spot;
  return rest;
}

function freshRetry(retry: GameRetry, resetAt: number): GameRetry {
  return { ...retry, spots: retry.spots.map(s => clearOldTraining(s, resetAt)) };
}

export function mergeRetry(
  local: GameRetry | undefined,
  incoming: GameRetry | undefined,
  resetAt = 0,
): GameRetry | undefined {
  const a = local && freshRetry(local, resetAt);
  const b = incoming && freshRetry(incoming, resetAt);
  if (!a || !b) return a ?? b;

  // The base decides which spots exist. The tiebreak is on content rather than on
  // which side is "local", so both devices choose the same one.
  const order = (a.version - b.version) || (a.scannedAt - b.scannedAt)
    || canonical(a).localeCompare(canonical(b));
  const base = order >= 0 ? a : b;
  const other = order >= 0 ? b : a;

  const others = new Map(other.spots.map(s => [s.id, s]));
  const spots = base.spots.map((spot) => {
    const o = others.get(spot.id);
    if (!o) return spot;
    const attempts = Math.max(spot.attempts ?? 0, o.attempts ?? 0);
    const lastTrained = Math.max(spot.lastTrained ?? 0, o.lastTrained ?? 0);
    const { fixed: _f, attempts: _a, lastTrained: _l, ...rest } = spot;
    return {
      ...rest,
      ...(spot.fixed || o.fixed ? { fixed: true } : {}),
      ...(attempts ? { attempts } : {}),
      ...(lastTrained ? { lastTrained } : {}),
    };
  });
  return { ...base, spots };
}

function dueOf(value: unknown): number {
  if (typeof value === 'number') return value;
  return Number((value as { due?: unknown } | null)?.due) || 0;
}

/** Each exercise keeps whichever rest runs later, within the module's own cap. */
export function mergeLogs(local: ScanLogs, incoming: ScanLogs): ScanLogs {
  const out: ScanLogs = {};
  for (const [key, cap] of Object.entries(SCAN_LOG_CAPS)) {
    const merged: Record<string, unknown> = { ...(local[key] ?? {}) };
    for (const [id, value] of Object.entries(incoming[key] ?? {})) {
      const mine = merged[id];
      const diff = mine === undefined ? 1 : dueOf(value) - dueOf(mine);
      if (diff > 0 || (diff === 0 && canonical(value) > canonical(mine))) merged[id] = value;
    }
    const kept = Object.keys(merged)
      .sort((x, y) => (dueOf(merged[y]) - dueOf(merged[x])) || x.localeCompare(y))
      .slice(0, cap);
    if (kept.length === 0) continue;
    out[key] = Object.fromEntries(kept.map(id => [id, merged[id]]));
  }
  return out;
}

export interface ScanMergePlan<T> {
  /** Games to save here, with their merged results. */
  changed: T[];
  logs: ScanLogs;
  resetAt: number;
  /** This device holds something the account doesn't, so it owes a push. */
  ahead: boolean;
  /** The account holds results for a game this device doesn't have yet. */
  unknownGames: boolean;
}

export function planScanMerge<T extends ScanGame>(
  games: readonly T[],
  localLogs: ScanLogs,
  localResetAt: number,
  incoming: ScanPayload,
): ScanMergePlan<T> {
  const resetAt = Math.max(localResetAt, incoming.resetAt);
  const ids = syncedGameIds(games);
  const changed: T[] = [];
  let ahead = localResetAt > incoming.resetAt;

  for (const game of games) {
    const theirs = incoming.games[game.id];
    if (!game.retry && !theirs) continue;
    const merged = mergeRetry(game.retry, theirs, resetAt);
    if (canonical(merged) !== canonical(game.retry)) changed.push({ ...game, retry: merged });
    if (ids.has(game.id) && canonical(merged) !== canonical(theirs)) ahead = true;
  }

  const known = new Set(games.map(g => g.id));
  const unknownGames = Object.keys(incoming.games).some(id => !known.has(id));

  // The side that reset most recently is the only one whose logs still count.
  const logs = mergeLogs(
    incoming.resetAt > localResetAt ? {} : localLogs,
    localResetAt > incoming.resetAt ? {} : incoming.logs,
  );
  if (canonical(logs) !== canonical(mergeLogs({}, incoming.logs))) ahead = true;

  return { changed, logs, resetAt, ahead, unknownGames };
}
