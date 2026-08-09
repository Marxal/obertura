// Repertoire sync — the cross-device copy of everything, kept in Supabase.
//
// This is drive-backup.ts's pattern pointed at a different destination. Same
// shape: IndexedDB stays the one source of truth for every read, every
// repertoire write schedules a debounced upload (~30s after the last edit, so
// an editing burst is one request), a "pending" flag survives a failed attempt,
// and connecting looks for a remote copy BEFORE it ever uploads — so a fresh
// phone restores instead of clobbering. What changes is the destination and the
// trigger: Drive uploads a file after you tap "Connect"; this uploads a row
// after you sign in, with no extra step to take.
//
// The payload is a BackupFile — byte-for-byte what "Export backup" downloads
// and what Drive stores — so the same parseBackup/restoreBackup path validates
// and applies it, and the same merge-vs-replace chooser asks what to do. One
// format, three transports.
//
// THE WHOLE MODULE IS A NO-OP WHEN SUPABASE ISN'T CONFIGURED. The internal
// GitHub Pages build ships without the env vars, so `isSupabaseConfigured` is
// false there, nobody can ever be signed in, and the Account section isn't even
// built (settings-screen.ts). initRepertoireSync() returns immediately on that
// build rather than registering listeners that would fire on every edit — the
// checks below are belt-and-braces over that UI gating, kept explicit so this
// build can never make a pointless network call.
//
// Fail-soft, like every network client in this repo: an unreachable Supabase
// never interrupts anything. The change is already safe in IndexedDB; the sync
// is marked pending/failed, the Account section says so, and the next edit —
// or the next app launch — retries.

import { supabase, isSupabaseConfigured } from './supabase';
import { getAuthUser, onAuthChange } from './auth';
import {
  exportBackup,
  parseBackup,
  restoreBackup,
  backupHasExtras,
  getAllLines,
  onLinesChanged,
  type BackupFile,
} from './storage';
import { openImportChooser } from './backup';
import { showToast } from './toast';

// The row and columns this module owns. One row per user, keyed by their auth
// id; see SUPABASE-SYNC.md for the table and its row-level-security policies.
const TABLE = 'profiles';
const COLUMN = 'repertoire';
const STAMP_COLUMN = 'repertoire_updated_at';

// All state keys sit under the `obertura.` prefix so the Settings "erase
// everything" sweep (wipeOberturaLocalStorage) clears them with the rest. They
// are also excluded from backups (storage.ts's backupLocalKey): they describe
// THIS device's relationship with an account, and restoring them onto another
// phone would simply lie.
//
// ACCOUNT_KEY is the analogue of Drive's "connected" flag: it holds the user id
// this device has already reconciled with. Its absence is what makes the next
// sign-in run the fetch-first flow instead of pushing straight away.
const ACCOUNT_KEY = 'obertura.sync.account';
const LAST_KEY = 'obertura.sync.last';
const PENDING_KEY = 'obertura.sync.pending';
const FAILED_KEY = 'obertura.sync.failed';

// Fired on window whenever the sync state changes, so an open Settings screen
// can refresh its Account caption without polling. Same idea as
// DRIVE_CHANGE_EVENT.
export const SYNC_CHANGE_EVENT = 'obertura:syncchange';

// ── State readers / writers ───────────────────────────────────────────────────

export type SyncState =
  | 'off' // not configured, or signed out
  | 'never' // signed in, but nothing has gone up from this device yet
  | 'synced'
  | 'pending' // local changes not yet uploaded
  | 'failed'; // an upload attempt failed; a retry is queued

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked — sync simply stays off
  }
}

function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked — nothing to remember, nothing to break */
  }
}

// ISO timestamp of the last successful push, or null before the first one.
export function getLastSync(): string | null {
  return readLocal(LAST_KEY);
}

// Has this device already reconciled with the signed-in account? False while
// signed out, and false on the first sign-in until the fetch-or-seed finishes.
function isAccountClaimed(): boolean {
  const user = getAuthUser();
  return !!user && readLocal(ACCOUNT_KEY) === user.id;
}

export function getSyncState(): SyncState {
  if (!isSupabaseConfigured || !getAuthUser()) return 'off';
  // The flags come first, and deliberately outrank "hasn't reconciled yet": a
  // first sign-in that couldn't reach Supabase has to SAY it failed, not sit
  // there looking like it hasn't got round to it.
  if (readLocal(FAILED_KEY) === '1') return 'failed';
  if (readLocal(PENDING_KEY) === '1') return 'pending';
  if (!isAccountClaimed()) return 'never';
  return getLastSync() ? 'synced' : 'never';
}

function notifyChange(): void {
  window.dispatchEvent(new Event(SYNC_CHANGE_EVENT));
}

function markPending(): void {
  writeLocal(PENDING_KEY, '1');
  notifyChange();
}

function markFailed(): void {
  writeLocal(FAILED_KEY, '1');
  notifyChange();
}

function markSynced(): void {
  writeLocal(LAST_KEY, new Date().toISOString());
  writeLocal(PENDING_KEY, null);
  writeLocal(FAILED_KEY, null);
  notifyChange();
}

function claimAccount(userId: string): void {
  writeLocal(ACCOUNT_KEY, userId);
}

// Signing out (or losing the session) puts this device back to "never synced
// here". The remote row is untouched — signing back in finds it again and runs
// the same fetch-first flow, exactly like reconnecting Drive.
function forgetAccount(): void {
  writeLocal(ACCOUNT_KEY, null);
  writeLocal(PENDING_KEY, null);
  writeLocal(FAILED_KEY, null);
  writeLocal(LAST_KEY, null);
  notifyChange();
}

// ── The two remote operations ─────────────────────────────────────────────────

// Upload the whole repertoire to the signed-in user's row, stamping when.
// Returns how many lines it held. Throws on any failure — callers decide
// whether that's a silent "pending" or a visible error.
export async function pushRepertoire(): Promise<number> {
  const user = getAuthUser();
  if (!user) throw new Error('Not signed in.');
  const data = await exportBackup();
  // Upsert, not update: the row may not exist yet (a brand-new account, or a
  // project without the create-profile-on-signup trigger). RLS still limits
  // this to the caller's own id.
  const { error } = await supabase.from(TABLE).upsert(
    {
      id: user.id,
      [COLUMN]: data,
      [STAMP_COLUMN]: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error) throw new Error(error.message);
  markSynced();
  return data.lines.length;
}

// Read the copy stored in the user's row, or null when there isn't one yet.
// Validation is parseBackup's, the same one a hand-picked file goes through, so
// a corrupt or foreign blob throws here rather than reaching the repertoire.
// Writing it stays the caller's decision (the merge-vs-replace chooser).
export async function fetchRemoteRepertoire(): Promise<BackupFile | null> {
  const user = getAuthUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMN)
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const raw = (data as Record<string, unknown> | null)?.[COLUMN];
  if (raw === null || raw === undefined) return null;
  // The column is jsonb, so supabase-js hands back an already-parsed object.
  // Re-serialising to run parseBackup is deliberate: one validator for files,
  // Drive and Supabase alike — including reviving each move's `review.due`
  // back into a real Date.
  return parseBackup(typeof raw === 'string' ? raw : JSON.stringify(raw));
}

// ── Debounced push ────────────────────────────────────────────────────────────
//
// Every repertoire write (save/delete/merge/reset — see storage.ts) schedules
// an upload, so an editing burst becomes one request ~30s after the last
// change. Drive's cadence exactly; there's no reason for the two to differ.

const PUSH_DELAY_MS = 30_000;
let pushTimer: number | undefined;
let pushBusy = false;
let pushDirty = false;

// Whether a background push is allowed right now. The account check is what
// stops us uploading over the cross-device copy before the user has been asked
// how to reconcile with it.
function canPush(): boolean {
  return isSupabaseConfigured && isAccountClaimed();
}

async function runPush(): Promise<void> {
  if (!canPush()) return;
  if (pushBusy) {
    pushDirty = true; // a push is in flight; redo once it finishes
    return;
  }
  pushBusy = true;
  try {
    await pushRepertoire();
  } catch {
    // Offline, RLS misconfigured, Supabase down — none of it is the user's
    // problem mid-edit. The flags carry the retry; Settings shows the state.
    markFailed();
  } finally {
    pushBusy = false;
    if (pushDirty) {
      pushDirty = false;
      void runPush();
    }
  }
}

// ── Sign-in reconcile ─────────────────────────────────────────────────────────

let reconciling = false;

// First sign-in on this device with this account. Order matters and mirrors
// Drive's afterConnect(): LOOK before you ever upload. On a new phone the
// account's copy is the thing the user wants back, and an eager first push of
// an empty repertoire would destroy it.
async function reconcile(userId: string): Promise<void> {
  let remote: BackupFile | null;
  try {
    remote = await fetchRemoteRepertoire();
  } catch {
    // Unreachable, or a copy we can't read. Claim nothing, push nothing,
    // destroy nothing: the next auth event or app launch tries again.
    markFailed();
    return;
  }

  if (remote && remote.lines.length > 0) {
    // Bound to a const so the callback below keeps the non-null narrowing.
    const found = remote;
    const existing = (await getAllLines()).length;
    openImportChooser(found, existing, async (mode) => {
      try {
        await restoreBackup(found, mode);
      } catch (err) {
        showToast(`Couldn’t restore from your account — ${(err as Error).message}`);
        return;
      }
      // Only now is this device in step with the account, so only now may it
      // start pushing. A merge leaves local ahead of remote, so push straight
      // away rather than waiting for the next edit.
      claimAccount(userId);
      const n = found.lines.length;
      showToast(
        mode === 'replace'
          ? `Restored ${n} line${n === 1 ? '' : 's'} from your account`
          : `Merged in ${n} line${n === 1 ? '' : 's'} from your account`,
        { variant: 'success' },
      );
      await runPush();
      // A copy carrying stats/streaks/games needs a reload to take everywhere —
      // several modules cache their localStorage state in memory at boot. Same
      // beat backup.ts leaves before refreshing, so the toast can be read.
      if (backupHasExtras(found)) setTimeout(() => window.location.reload(), 1200);
    });
    // Cancelling leaves the account unclaimed: nothing syncs, the caption says
    // so, and the next launch asks again. Never assume an answer.
    return;
  }

  // Nothing up there yet (a first sign-in, or an account that has only ever
  // been signed into from an empty device): seed it with what's on this phone.
  claimAccount(userId);
  await runPush();
}

// ── Boot ──────────────────────────────────────────────────────────────────────

// Call once at boot, BEFORE initAuth(), so the first auth notification (the
// stored session being picked up) isn't missed. Returns immediately unless this
// build has Supabase configured.
export function initRepertoireSync(): void {
  if (!isSupabaseConfigured) return;

  onLinesChanged(() => {
    if (!canPush()) return;
    markPending();
    window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(runPush, PUSH_DELAY_MS);
  });

  onAuthChange(() => {
    const user = getAuthUser();
    if (!user) {
      forgetAccount();
      return;
    }
    if (readLocal(ACCOUNT_KEY) === user.id) {
      // A resumed session (app launch, token refresh). Nothing to ask — but a
      // debounce timer that died when the app was closed, or a push that failed
      // offline, is still owed. Retry it now.
      const state = getSyncState();
      if (state === 'pending' || state === 'failed') void runPush();
      return;
    }
    // A different account, or the first sign-in on this device.
    if (reconciling) return;
    reconciling = true;
    void reconcile(user.id).finally(() => {
      reconciling = false;
    });
  });
}
