// Account sync — the cross-device copy of everything, kept in Supabase.
//
// IndexedDB stays the one source of truth for every read; every write
// schedules a debounced upload (~30s after the last edit, so an editing burst is
// one request), a "pending" flag survives a failed attempt, and connecting looks
// for a remote copy BEFORE it ever uploads — so a fresh phone restores instead
// of clobbering. It uploads a row after you sign in, with no extra step to take.
//
// The payload is a BackupFile — the same JSON "Export backup" downloads — so
// the same parseBackup/restoreBackup path validates and applies it, and the
// same merge-vs-replace chooser asks what to do. One format, two transports.
//
// ── BUT THE SYNCED COPY IS ON A DIET, AND THE BACKUP FILE ISN'T ─────────────
// Same format, deliberately not the same contents. What goes up is
// gamesForSync()'s output (sync-core.ts, where the WHY of each exclusion is
// spelled out): the most recent 500 games, with each game's saved analysis tree
// and mistake-scan spots stripped off. Those two are engine output, derived from
// moves that ARE synced, and they were ~80% of every games upload.
//
// The manual backup file keeps all of it, and that difference is intentional
// rather than an oversight. A backup is a user-controlled export of ONE device,
// downloaded on purpose, stored wherever the user likes, and paid for by nobody
// else; the account row is a shared, quota-bearing resource this app writes to
// automatically on the user's behalf. So the file's rule is "lose nothing" and
// the row's is "carry only what another device can't recompute". storage.ts's
// exportBackup is therefore left exactly as it was — anything dropped here is
// still one "Export backup" tap away.
//
// ── THE COLUMN NAMES LIE A LITTLE, AND IT MATTERS ───────────────────────────
// `profiles.repertoire` is NOT just the repertoire. The name is a leftover from
// when the schema was first drafted and lines were the only thing that synced;
// by the time this shipped it held the whole backup blob. It now holds the
// backup MINUS the imported games: the lines plus the localStorage snapshot
// (statistics, streaks, puzzle ratings, endgame progress, preferences). Renaming
// the column would be a migration for zero user-visible gain, so it stays —
// don't read the name as a description of the contents.
//
// The games live next door in `profiles.games`, and the split is measured, not
// aesthetic. A game carrying a saved analysis tree costs ~18 KB against ~1.3 KB
// bare, so a heavy library (1000 games, some analysed) put the full blob at
// 4–20 MB while the lines-plus-snapshot half stays at 0.2–1.3 MB. Pushing all of
// it every time a line changed meant re-uploading megabytes of games that hadn't
// changed — on mobile data, and rewriting the whole TOASTed value in Postgres
// each time. Two columns off two notifiers (onLinesChanged / onGamesChanged in
// storage.ts) means an edit sends the small half and games go up only when games
// actually change, which is rare and deliberate: an import, a saved analysis, a
// scan run.
//
// With the diet on top, that same 1000-game library now pushes ~0.7 MB of games
// instead of ~7 MB. Note what this does to the second half of that sentence: a
// saved analysis or a scan run still fires onGamesChanged, but no longer changes
// anything that syncs — the fingerprint comes out identical and the push is
// skipped without a request. Analysing a game is now free, sync-wise.
//
// Scouted opponents stay out entirely, exactly as backup.ts has it — pure
// re-fetchable cache, and by far the bulkiest thing on the device.
//
// ── KNOWN LIMITATION: LAST WRITE WINS ───────────────────────────────────────
// This is not true sync and doesn't pretend to be. The whole part goes up as one
// value, so editing on two devices inside the same window means one silently
// overwrites the other — there is no per-line merge and no way to tell a
// deletion from a line that simply hasn't arrived yet. Drive backup has exactly
// the same ceiling today. Lifting it needs a per-line `updatedAt` bumped on
// every save, plus deletion tombstones so a delete can be told apart from an
// absence; both are already parked in PUBLISHING.md (lines 131–133). Deliberately
// NOT attempted here. In practice one person with one phone never meets it, and
// the sign-in reconcile below asks before it overwrites anything, which covers
// the case that actually bites (a second device joining).
//
// ── THE WHOLE MODULE IS A NO-OP WHEN SUPABASE ISN'T CONFIGURED ──────────────
// The internal GitHub Pages build ships without the env vars, so
// `isSupabaseConfigured` is false there, nobody can ever be signed in, and the
// Account section isn't even built (settings-screen.ts). initAccountSync()
// returns immediately on that build rather than registering listeners that would
// fire on every edit — the checks below are belt-and-braces over that UI gating,
// kept explicit so this build can never make a pointless network call.
//
// Fail-soft, like every network client in this repo: an unreachable Supabase
// never interrupts anything. The change is already safe in IndexedDB; the sync
// is marked pending/failed, the Account section says so, and the next edit — or
// the next app launch — retries.

import { supabase, isSupabaseConfigured } from './supabase';
import { getAuthUser, onAuthChange } from './auth';
import {
  exportCore,
  getAllGames,
  parseBackup,
  restoreBackup,
  backupHasExtras,
  getAllLines,
  onLinesChanged,
  onGamesChanged,
  type BackupFile,
} from './storage';
import { openImportChooser } from './backup';
import { showToast } from './toast';
// The pure half lives next door so it can be self-tested under plain Node —
// importing this module would drag the Supabase client, and `import.meta.env`
// with it, into the test.
import {
  syncStateFrom,
  combineRemote,
  coreFingerprintOf,
  gamesFingerprintOf,
  gamesForSync,
  payloadBytes,
  SYNC_PART_LIMIT_BYTES,
  SYNC_TOO_LARGE_MESSAGE,
  type SyncState,
} from './sync-core';

export { type SyncState } from './sync-core';

// The row and columns this module owns. One row per user, keyed by their auth
// id; see SUPABASE-SYNC.md for the table, the migration and its row-level
// security policies.
const TABLE = 'profiles';
const CORE_COLUMN = 'repertoire'; // lines + localStorage snapshot — see above
const CORE_STAMP_COLUMN = 'repertoire_updated_at';
const GAMES_COLUMN = 'games';
const GAMES_STAMP_COLUMN = 'games_updated_at';

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
// Why the last push failed, when the reason is one the user can act on (today:
// only the size ceiling). Absent for the ordinary offline/server failures, which
// retry on their own and need no explaining. Read by the Account caption.
const ERROR_KEY = 'obertura.sync.error';
// Fingerprints of the two parts as last successfully pushed, so an unchanged
// part costs nothing (see pushDirtyParts).
const CORE_FP_KEY = 'obertura.sync.coreFingerprint';
const GAMES_FP_KEY = 'obertura.sync.gamesFingerprint';

// Fired on window whenever the sync state changes, so an open Settings screen
// can refresh its Account caption without polling. Same idea as
// DRIVE_CHANGE_EVENT.
export const SYNC_CHANGE_EVENT = 'obertura:syncchange';

// ── State readers / writers ───────────────────────────────────────────────────

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
  return syncStateFrom({
    configured: isSupabaseConfigured,
    userId: getAuthUser()?.id ?? null,
    claimedAccount: readLocal(ACCOUNT_KEY),
    failed: readLocal(FAILED_KEY) === '1',
    pending: readLocal(PENDING_KEY) === '1',
    lastSync: getLastSync(),
  });
}

function notifyChange(): void {
  window.dispatchEvent(new Event(SYNC_CHANGE_EVENT));
}

// The explanation behind a 'failed' state, or null when there isn't a useful
// one. The Account section shows it in place of the generic caption.
export function getSyncError(): string | null {
  return readLocal(ERROR_KEY);
}

function markPending(): void {
  writeLocal(PENDING_KEY, '1');
  notifyChange();
}

function markFailed(message: string | null): void {
  writeLocal(FAILED_KEY, '1');
  writeLocal(ERROR_KEY, message);
  notifyChange();
}

function markSynced(): void {
  writeLocal(LAST_KEY, new Date().toISOString());
  writeLocal(PENDING_KEY, null);
  writeLocal(FAILED_KEY, null);
  writeLocal(ERROR_KEY, null);
  notifyChange();
}

function claimAccount(userId: string): void {
  writeLocal(ACCOUNT_KEY, userId);
}

// Signing out (or losing the session) puts this device back to "never synced
// here". The remote row is untouched — signing back in finds it again and runs
// the same fetch-first flow, exactly like reconnecting Drive. The fingerprints
// go too: they describe an account's copy, and keeping them could make the next
// account's first push skip a part it has never actually seen.
function forgetAccount(): void {
  writeLocal(ACCOUNT_KEY, null);
  writeLocal(PENDING_KEY, null);
  writeLocal(FAILED_KEY, null);
  writeLocal(ERROR_KEY, null);
  writeLocal(LAST_KEY, null);
  writeLocal(CORE_FP_KEY, null);
  writeLocal(GAMES_FP_KEY, null);
  notifyChange();
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

// Read the copy stored in the user's row, or null when there isn't one yet.
// Validation is parseBackup's, the same one a hand-picked file goes through, so
// a corrupt or foreign blob throws here rather than reaching the repertoire.
// Writing it stays the caller's decision (the merge-vs-replace chooser).
//
// A project that hasn't run the `games` migration in SUPABASE-SYNC.md fails here
// with "column profiles.games does not exist" — which lands, correctly, as
// "Sync failed — will retry" in the Account section rather than as a crash.
export async function fetchRemoteBackup(): Promise<BackupFile | null> {
  const user = getAuthUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select(`${CORE_COLUMN}, ${GAMES_COLUMN}`)
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown> | null;
  const text = combineRemote(row?.[CORE_COLUMN] ?? null, row?.[GAMES_COLUMN] ?? null);
  if (text === null) return null;
  // The columns are jsonb, so supabase-js hands back already-parsed values.
  // Re-serialising to run parseBackup is deliberate: one validator for files,
  // Drive and Supabase alike — including reviving each move's `review.due` back
  // into a real Date.
  return parseBackup(text);
}

// ── Debounced push ────────────────────────────────────────────────────────────
//
// Both parts share one 30s timer and one round trip, with a dirty flag each.
// Drive's cadence, and there's no reason for the two halves to differ: games
// change rarely but when they do (a 300-game import, a scan sweep) they fire in
// bursts that one debounce window absorbs perfectly well.

const PUSH_DELAY_MS = 30_000;
let pushTimer: number | undefined;
let pushBusy = false;
let coreDirty = false;
let gamesDirty = false;

// Whether a background push is allowed right now. The account check is what
// stops us uploading over the cross-device copy before the user has been asked
// how to reconcile with it.
function canPush(): boolean {
  return isSupabaseConfigured && isAccountClaimed();
}

// A push refused by the size ceiling rather than by the network. Distinct from
// every other failure here because it will NOT fix itself by retrying, so the
// caller swaps the generic "will retry" caption for something the user can act
// on.
class PayloadTooLargeError extends Error {}

// Upload whichever parts are dirty, in ONE upsert — two columns of the same row,
// so a burst that touched lines and games costs one request, not two. Throws on
// failure; the caller decides whether that's a silent "pending" or visible.
async function pushDirtyParts(): Promise<void> {
  const user = getAuthUser();
  if (!user) throw new Error('Not signed in.');

  const wantCore = coreDirty;
  const wantGames = gamesDirty;
  if (!wantCore && !wantGames) return;
  // Claim the flags now, so an edit that lands mid-flight re-dirties them and
  // gets its own push rather than being swallowed by this one.
  coreDirty = false;
  gamesDirty = false;

  const row: Record<string, unknown> = { id: user.id };
  const now = new Date().toISOString();
  let nextCoreFp: string | null = null;
  let nextGamesFp: string | null = null;
  // Parts the ceiling refused. Whatever fits still goes up in the same request —
  // an unsyncably huge games library must never stop the lines syncing — but the
  // push as a whole is then reported as failed, because part of it didn't happen.
  let refusedCore = false;
  let refusedGames = false;

  try {
    if (wantCore) {
      const core = await exportCore();
      const fp = coreFingerprintOf(core);
      if (fp !== readLocal(CORE_FP_KEY)) {
        if (payloadBytes(core) > SYNC_PART_LIMIT_BYTES) {
          refusedCore = true;
        } else {
          row[CORE_COLUMN] = core;
          row[CORE_STAMP_COLUMN] = now;
          nextCoreFp = fp;
        }
      }
    }
    if (wantGames) {
      // Slimmed and capped BEFORE anything else looks at it, so the size check,
      // the fingerprint and the upload can't possibly disagree about what "the
      // games" are.
      const games = gamesForSync(await getAllGames());
      const fp = gamesFingerprintOf(games);
      if (fp !== readLocal(GAMES_FP_KEY)) {
        if (payloadBytes(games) > SYNC_PART_LIMIT_BYTES) {
          refusedGames = true;
        } else {
          row[GAMES_COLUMN] = games;
          row[GAMES_STAMP_COLUMN] = now;
          nextGamesFp = fp;
        }
      }
    }

    // Nothing actually changed — a save that rewrote identical data, or the
    // retry-everything sweep on app launch finding the account already in step.
    // Don't spend the request; we ARE synced, so say so.
    if (Object.keys(row).length > 1) {
      // Upsert, not update: the row may not exist yet (a brand-new account, or
      // a project without the create-profile-on-signup trigger). RLS still
      // limits this to the caller's own id.
      const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    }
  } catch (err) {
    // Put the flags back so the work is still owed, then let the caller mark it.
    coreDirty = coreDirty || wantCore;
    gamesDirty = gamesDirty || wantGames;
    throw err;
  }

  if (nextCoreFp) writeLocal(CORE_FP_KEY, nextCoreFp);
  if (nextGamesFp) writeLocal(GAMES_FP_KEY, nextGamesFp);

  // A refused part stays dirty and stays unfingerprinted, so the state keeps
  // telling the truth: it is still owed, and a later push retries it — which is
  // what makes deleting some games (or the cap moving) fix it by itself. It
  // can't spin, because runPush only chains after a clean success.
  if (refusedCore || refusedGames) {
    coreDirty = coreDirty || refusedCore;
    gamesDirty = gamesDirty || refusedGames;
    throw new PayloadTooLargeError(SYNC_TOO_LARGE_MESSAGE);
  }

  markSynced();
}

async function runPush(): Promise<void> {
  if (!canPush() || pushBusy) return;
  pushBusy = true;
  let ok = false;
  try {
    await pushDirtyParts();
    ok = true;
  } catch (err) {
    // Offline, RLS misconfigured, migration not run, Supabase down — none of it
    // is the user's problem mid-edit. The flags carry the retry; Settings shows
    // the state. The one exception is the size ceiling: retrying can't cure it,
    // so it carries its own caption instead of "will retry" (never mind that the
    // data is perfectly safe locally — the user has to be told it isn't
    // leaving).
    markFailed(err instanceof PayloadTooLargeError ? err.message : null);
  } finally {
    pushBusy = false;
  }
  // Chain ONLY after a success. A hard failure leaves the flags set, and
  // retrying here would spin against a dead network forever; the next edit, the
  // next launch or the next flush picks it up at a human pace instead.
  if (ok && (coreDirty || gamesDirty)) void runPush();
}

function schedule(): void {
  if (!canPush()) return;
  markPending();
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => void runPush(), PUSH_DELAY_MS);
}

// Closing the app inside the 30s window shouldn't leave the change owed until
// the next launch, so hitch a push to the page going away. Best-effort by
// nature: the browser may kill the page before the request lands, especially on
// Android. That's survivable rather than lossy — the pending flag is already in
// localStorage, so the next launch retries, and the fingerprint check makes that
// retry free if the push did get through.
function flush(): void {
  if (!canPush()) return;
  if (!coreDirty && !gamesDirty) return;
  window.clearTimeout(pushTimer);
  void runPush();
}

// ── Sign-in reconcile ─────────────────────────────────────────────────────────

let reconciling = false;

// Remember what the account already holds, so the push that follows a restore
// skips any part the restore left byte-identical. After a `replace` both halves
// match and nothing goes back up — which is the difference between a silent
// no-op and immediately re-uploading the megabytes of games we just downloaded.
// After a `merge` local is ahead, the fingerprints differ, and it pushes.
function rememberRemoteFingerprints(remote: BackupFile): void {
  writeLocal(CORE_FP_KEY, coreFingerprintOf(remote));
  writeLocal(GAMES_FP_KEY, gamesFingerprintOf(remote.games ?? []));
}

// First sign-in on this device with this account. Order matters and mirrors
// Drive's afterConnect(): LOOK before you ever upload. On a new phone the
// account's copy is the thing the user wants back, and an eager first push of an
// empty repertoire would destroy it.
async function reconcile(userId: string): Promise<void> {
  let remote: BackupFile | null;
  try {
    remote = await fetchRemoteBackup();
  } catch {
    // Unreachable, or a copy we can't read. Claim nothing, push nothing,
    // destroy nothing: the next auth event or app launch tries again.
    markFailed(null);
    return;
  }

  // Games count as "the account holds something" as much as lines do — a phone
  // that only ever imported games has a copy worth asking about. A row carrying
  // ONLY the app-state snapshot doesn't reach the chooser: `local` is never
  // empty in practice (preferences alone fill it), so treating it as content
  // would put a merge-or-replace question in front of every genuinely-new
  // account. Stats-only rows lose to the seeding device; a deliberate line.
  const hasRemoteData = !!remote && (remote.lines.length > 0 || (remote.games?.length ?? 0) > 0);

  if (remote && hasRemoteData) {
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
      rememberRemoteFingerprints(found);
      // Only now is this device in step with the account, so only now may it
      // start pushing. restoreBackup's own writes have already set the dirty
      // flags through the two notifiers; push straight away rather than waiting
      // for the next edit, and let the fingerprints decide what's worth sending.
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

  // Nothing up there yet (a first sign-in, or an account that has only ever been
  // signed into from an empty device): seed it with what's on this phone, both
  // halves.
  claimAccount(userId);
  coreDirty = true;
  gamesDirty = true;
  await runPush();
}

// ── Boot ──────────────────────────────────────────────────────────────────────

// Call once at boot, BEFORE initAuth(), so the first auth notification (the
// stored session being picked up) isn't missed. Returns immediately unless this
// build has Supabase configured.
export function initAccountSync(): void {
  if (!isSupabaseConfigured) return;

  onLinesChanged(() => {
    coreDirty = true;
    schedule();
  });

  onGamesChanged(() => {
    gamesDirty = true;
    schedule();
  });

  // Both events, because neither alone is reliable on a phone: Android usually
  // kills a PWA without ever firing pagehide, while visibilitychange fires on
  // every app switch. flush() is idempotent — with nothing dirty it returns.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
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
      // offline, is still owed. The dirty flags don't survive a launch and we
      // can't know WHICH part changed, so offer both and let the fingerprints
      // sort it out: if the account is already in step this costs one hash of
      // each half and no request at all.
      const state = getSyncState();
      if (state === 'pending' || state === 'failed') {
        coreDirty = true;
        gamesDirty = true;
        void runPush();
      }
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
