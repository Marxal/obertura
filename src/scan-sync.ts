// Pro's scan sync: mistake-scan results and exercise progress, between one paying
// account's devices. The merge rules are in scan-sync-core.ts.
//
// KEPT APART FROM repertoire-sync.ts ON PURPOSE. Everything here is a separate
// request, made only for an entitled account, and every failure is quiet. A
// problem in this file can't stop a line syncing, and it never runs for a free
// account. That also means this can ship before its database column exists: the
// first request fails and nothing else notices.
//
// WHAT IT COSTS. About 0.3 MB stored per account with 500 scanned games. The
// routine check is one timestamp, every five minutes while the app is open. A scan
// changes results for hours, so a push is limited to one every ten minutes, or two
// when the app is leaving the screen, and only goes up if the content changed.

import { supabase, isSupabaseConfigured } from './supabase';
import { getAuthUser } from './auth';
import { isEntitled, ENTITLEMENT_CHANGE_EVENT } from './entitlement';
import { getAllGames, saveGames, onGamesChanged, countGames } from './storage';
import { payloadBytes, stampsEqual, SYNC_PART_LIMIT_BYTES } from './sync-core';
import {
  SCAN_LOG_CAPS,
  buildScanPayload,
  parseScanPayload,
  planScanMerge,
  scanFingerprint,
  type ScanLogs,
} from './scan-sync-core';

const TABLE = 'profiles';
const COLUMN = 'scans';
const STAMP_COLUMN = 'scans_updated_at';

// Under `obertura.sync.`, so they never travel and "erase everything" sweeps them.
const SEEN_KEY = 'obertura.sync.seenScans';
const FP_KEY = 'obertura.sync.scansFp';
const RESET_KEY = 'obertura.sync.scansResetAt';

const POLL_MS = 5 * 60_000;
const PULL_GAP_MS = 20_000;
const PUSH_GAP_MS = 10 * 60_000;
const PUSH_GAP_LEAVING_MS = 2 * 60_000;
const FIRST_TICK_MS = 15_000;
// After a failure (offline, or the column not there yet), leave it for a while.
const FAILURE_PAUSE_MS = 30 * 60_000;

type TickMode = 'routine' | 'leaving';

let isClaimed: () => boolean = () => false;
let onPulled: () => void = () => {};
let busy = false;
let dirty = true;
let lastPullAt = 0;
let lastPushAt = 0;
let pausedUntil = 0;
let lastLogsRaw = '';
// The account held results for games this device didn't have, at this many games.
// Worth fetching again once that number moves, and not before.
let missingGamesAt: number | null = null;

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage off: the sync just repeats itself */ }
}

function logsRaw(): string {
  return Object.keys(SCAN_LOG_CAPS).map(k => read(k) ?? '').join('\n');
}

function readLogs(): ScanLogs {
  const out: ScanLogs = {};
  for (const key of Object.keys(SCAN_LOG_CAPS)) {
    try {
      const parsed: unknown = JSON.parse(read(key) ?? 'null');
      if (parsed && typeof parsed === 'object') out[key] = parsed as Record<string, unknown>;
    } catch { /* a corrupt log is treated as empty */ }
  }
  return out;
}

function writeLogs(logs: ScanLogs): void {
  for (const key of Object.keys(SCAN_LOG_CAPS)) {
    write(key, logs[key] ? JSON.stringify(logs[key]) : null);
  }
  lastLogsRaw = logsRaw();
}

function resetAt(): number {
  return Number(read(RESET_KEY)) || 0;
}

function active(): boolean {
  return isSupabaseConfigured && !!getAuthUser() && isClaimed() && isEntitled()
    && Date.now() >= pausedUntil;
}

async function pull(userId: string): Promise<void> {
  if (Date.now() - lastPullAt < PULL_GAP_MS) return;
  lastPullAt = Date.now();

  const { data: stampRow, error: stampError } = await supabase
    .from(TABLE).select(STAMP_COLUMN).eq('id', userId).maybeSingle();
  if (stampError) throw new Error(stampError.message);
  const stamp = (stampRow as Record<string, unknown> | null)?.[STAMP_COLUMN];
  if (typeof stamp !== 'string') return; // this account hasn't pushed any yet
  const moreGames = missingGamesAt !== null && (await countGames()) !== missingGamesAt;
  if (!moreGames && stampsEqual(stamp, read(SEEN_KEY))) return;

  const { data, error } = await supabase
    .from(TABLE).select(COLUMN).eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  const incoming = parseScanPayload((data as Record<string, unknown> | null)?.[COLUMN]);
  if (!incoming) return;

  const games = await getAllGames();
  const plan = planScanMerge(games, readLogs(), resetAt(), incoming);
  if (plan.changed.length > 0) await saveGames(plan.changed);
  writeLogs(plan.logs);
  write(RESET_KEY, plan.resetAt ? String(plan.resetAt) : null);
  write(SEEN_KEY, stamp);
  missingGamesAt = plan.unknownGames ? games.length : null;

  if (plan.ahead) {
    write(FP_KEY, null);
    dirty = true;
  } else {
    // In step with the account as far as this device can tell. It records what it
    // holds rather than pushing it, or two devices holding different games would
    // overwrite each other for ever.
    const now = buildScanPayload(await getAllGames(), readLogs(), resetAt());
    write(FP_KEY, scanFingerprint(now));
    dirty = false;
  }
  if (plan.changed.length > 0) onPulled();
}

async function push(userId: string, mode: TickMode): Promise<void> {
  const raw = logsRaw();
  if (raw !== lastLogsRaw) dirty = true;
  if (!dirty) return;
  const gap = mode === 'leaving' ? PUSH_GAP_LEAVING_MS : PUSH_GAP_MS;
  if (Date.now() - lastPushAt < gap) return;

  const payload = buildScanPayload(await getAllGames(), readLogs(), resetAt());
  const fp = scanFingerprint(payload);
  lastLogsRaw = raw;
  if (fp === read(FP_KEY)) { dirty = false; return; }
  if (Object.keys(payload.games).length === 0 && read(FP_KEY) === null && !payload.resetAt) {
    dirty = false; // nothing scanned yet: don't write an empty copy
    return;
  }
  if (payloadBytes(payload) > SYNC_PART_LIMIT_BYTES) {
    console.warn('scan sync: too large to upload');
    dirty = false;
    return;
  }

  lastPushAt = Date.now();
  const now = new Date().toISOString();
  // Update only: the lines' push creates the row, and until then this just waits.
  const { data, error } = await supabase
    .from(TABLE)
    .update({ [COLUMN]: payload, [STAMP_COLUMN]: now })
    .eq('id', userId)
    .select('id');
  if (error) throw new Error(error.message);
  if (!Array.isArray(data) || data.length === 0) return;
  write(FP_KEY, fp);
  write(SEEN_KEY, now);
  dirty = false;
}

async function tick(mode: TickMode): Promise<void> {
  if (busy || !active()) return;
  const user = getAuthUser();
  if (!user) return;
  busy = true;
  try {
    if (mode !== 'leaving') await pull(user.id);
    await push(user.id, mode);
  } catch (err) {
    pausedUntil = Date.now() + FAILURE_PAUSE_MS;
    console.warn(`scan sync paused (${err instanceof Error ? err.message : String(err)})`);
  } finally {
    busy = false;
  }
}

/** Called by Settings' reset, so the reset reaches the other devices too. */
export function noteScansReset(): void {
  write(RESET_KEY, String(Date.now()));
  dirty = true;
}

/** Signed out, or this device was replaced from the account: start over. */
export function forgetScanSync(): void {
  write(SEEN_KEY, null);
  write(FP_KEY, null);
  write(RESET_KEY, null);
  dirty = true;
  lastPushAt = 0;
  lastPullAt = 0;
  pausedUntil = 0;
  missingGamesAt = null;
}

export function initScanSync(deps: { isClaimed: () => boolean; onPulled: () => void }): void {
  if (!isSupabaseConfigured) return;
  isClaimed = deps.isClaimed;
  onPulled = deps.onPulled;
  lastLogsRaw = logsRaw();

  onGamesChanged(() => { dirty = true; });
  window.addEventListener(ENTITLEMENT_CHANGE_EVENT, () => { void tick('routine'); });
  window.addEventListener('pagehide', () => { void tick('leaving'); });
  document.addEventListener('visibilitychange', () => {
    void tick(document.visibilityState === 'hidden' ? 'leaving' : 'routine');
  });
  window.setTimeout(() => { void tick('routine'); }, FIRST_TICK_MS);
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void tick('routine');
  }, POLL_MS);
}
