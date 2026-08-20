// Account sync — the cross-device copy of everything, kept in Supabase.
//
// IndexedDB stays the one source of truth for every read. Around it sit two
// halves of one loop:
//
//   PUSH — every write schedules a debounced upload (~30s after the last edit,
//   so an editing burst is one request), a "pending" flag survives a failed
//   attempt, and a fingerprint of what was last sent means an unchanged half
//   costs no request at all.
//
//   PULL — the app asks the account "has either half moved since I last saw
//   it?" on sign-in, whenever it comes back to the foreground, and every few
//   minutes while it's open. Two timestamps answer that in a few hundred bytes;
//   only a half that really has moved is downloaded.
//
// ── WHAT CHANGED, AND WHY IT HAD TO ─────────────────────────────────────────
// The first version of this module pulled exactly ONCE per device — on the
// first sign-in — and pushed forever after. That is not sync, and it failed in
// the obvious way: add lines on phone A, open phone B, and B still showed its
// own older copy and then pushed it back over A's. There was no way for a
// second device to ever learn anything. The pull loop above is the fix.
//
// ── AND THE MERGE QUESTION IS GONE ──────────────────────────────────────────
// Signing in used to stop and ask "merge or replace?" every time. It asked at
// the worst possible moment (you have just typed a password, you have not yet
// seen the app), the honest answer was always "merge", and cancelling left the
// device silently unsynced forever. So a pull now ALWAYS merges, with no
// question:
//
//   • repertoires merge by MOVE (storage.mergeRepertoires) — the two trees
//     become one tree, and the better review record survives on any move both
//     sides had. Nothing is ever deleted by a pull.
//   • games merge by id.
//   • the app-state snapshot (statistics, streaks, ratings, preferences) cannot
//     merge — there is no union of two streak counters — so it is last-write-
//     wins on the column's own timestamp, guarded so it can never overwrite
//     changes this device hasn't pushed yet. See shouldApplyRemoteLocal.
//
// The one thing merge cannot do is propagate a DELETION: remove a line on phone
// A and phone B will hand it back on its next push. That is the honest cost of
// having no tombstones, it is written down in SUPABASE-SYNC.md, and the escape
// hatch is explicit rather than a prompt — Settings → Data → "Replace this
// device from the account" (replaceFromAccount below), which is the old
// "replace" answer, asked for on purpose instead of guessed at.
//
// ── THE COLUMN NAMES LIE A LITTLE, AND IT MATTERS ───────────────────────────
// `profiles.repertoire` is NOT just the repertoire. The name is a leftover from
// when the schema was first drafted and lines were the only thing that synced;
// it now holds the backup MINUS the imported games: the lines plus the
// localStorage snapshot (statistics, streaks, puzzle ratings, endgame progress,
// preferences). Renaming the column would be a migration for zero user-visible
// gain, so it stays — don't read the name as a description of the contents.
//
// The games live next door in `profiles.games`, and the split is measured, not
// aesthetic. A game carrying a saved analysis tree costs ~18 KB against ~1.3 KB
// bare, so a heavy library (1000 games, some analysed) put the full blob at
// 4–20 MB while the lines-plus-snapshot half stays at 0.2–1.3 MB. Two columns
// off two notifiers (onLinesChanged / onGamesChanged in storage.ts) means an
// edit sends the small half and games go up only when games actually change.
//
// ── THE SYNCED COPY IS ON A DIET, AND THE BACKUP FILE ISN'T ─────────────────
// What goes up is gamesForSync()'s output (sync-core.ts, where the WHY of each
// exclusion is spelled out): the most recent 500 games, with each game's saved
// analysis tree and mistake-scan spots stripped off. Those two are engine
// output, derived from moves that ARE synced, and they were ~80% of every games
// upload. The manual backup file keeps all of it, deliberately: a backup is a
// user-controlled export of ONE device, and the account row is a shared,
// quota-bearing resource this app writes to on the user's behalf.
//
// Scouted opponents stay out entirely, exactly as the backup file has it — pure
// re-fetchable cache, and by far the bulkiest thing on the device.
//
// ── THE WHOLE MODULE IS A NO-OP WHEN SUPABASE ISN'T CONFIGURED ──────────────
// The internal GitHub Pages build ships without the env vars, so
// `isSupabaseConfigured` is false there, nobody can ever be signed in, and the
// Account section isn't even built (settings-screen.ts).
//
// Fail-soft, like every network client in this repo: an unreachable Supabase
// never interrupts anything. The change is already safe in IndexedDB; the sync
// is marked pending/failed, the Account section says WHY (see describeSyncError
// — a generic "will retry" hid a missing table for weeks), and the next edit,
// the next foreground or the next launch retries.

import { supabase, isSupabaseConfigured } from './supabase';
import { getAuthUser, onAuthChange } from './auth';
import {
  exportCore,
  getAllGames,
  parseBackup,
  applyLocalSnapshot,
  mergeRepertoires,
  repertoiresFrom,
  replaceAllRepertoires,
  clearGames,
  saveGames,
  backupLineCount,
  onLinesChanged,
  onGamesChanged,
  type BackupFile,
} from './storage';
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
  partsToPull,
  anyPart,
  shouldApplyRemoteLocal,
  payloadBytes,
  SYNC_PART_LIMIT_BYTES,
  SYNC_TOO_LARGE_MESSAGE,
  type SyncState,
  type PullParts,
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
const ACCOUNT_KEY = 'obertura.sync.account';
const LAST_KEY = 'obertura.sync.last';
const PENDING_KEY = 'obertura.sync.pending';
const FAILED_KEY = 'obertura.sync.failed';
// Why the last attempt failed, in words a person can act on. Always written on
// failure now — the old code only filled it for the size ceiling and left every
// other failure showing "Sync failed — will retry", which is exactly how a
// project missing its `profiles` table looked identical to a train tunnel.
const ERROR_KEY = 'obertura.sync.error';
// Fingerprints of the two parts as last successfully pushed, so an unchanged
// part costs nothing (see pushDirtyParts).
const CORE_FP_KEY = 'obertura.sync.coreFingerprint';
const GAMES_FP_KEY = 'obertura.sync.gamesFingerprint';
// The column timestamps this device has already SEEN — set both when we push a
// value ourselves and when we pull someone else's. A remote stamp that differs
// from these is another device's work, and the only thing worth downloading.
const SEEN_CORE_KEY = 'obertura.sync.seenCore';
const SEEN_GAMES_KEY = 'obertura.sync.seenGames';

// Fired on window whenever the sync state changes, so an open Settings screen
// can refresh its Account caption without polling.
export const SYNC_CHANGE_EVENT = 'obertura:syncchange';
// Fired after a pull actually changed something on this device, so open screens
// can redraw rather than showing what was true a minute ago.
export const SYNC_PULLED_EVENT = 'obertura:syncpulled';

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
// signed out, and false on the first sign-in until the first pull finishes.
function isAccountClaimed(): boolean {
  const user = getAuthUser();
  return !!user && readLocal(ACCOUNT_KEY) === user.id;
}

/**
 * Signed in, but this device hasn't reconciled with the account yet — the first
 * pull is still owed or still in flight.
 *
 * It exists for one caller (main.ts's first-run picker) and one bug: on a phone
 * that has just signed in, an empty IndexedDB means "we haven't looked yet", not
 * "this person is new". Taking it for the second reading is what made a second
 * device run the whole first-run walkthrough over a repertoire that was about to
 * arrive.
 */
export function isAwaitingAccountCopy(): boolean {
  return isSupabaseConfigured && !!getAuthUser() && !isAccountClaimed();
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

// The explanation behind a 'failed' state, or null when there isn't one.
export function getSyncError(): string | null {
  return readLocal(ERROR_KEY);
}

function markPending(): void {
  writeLocal(PENDING_KEY, '1');
  notifyChange();
}

function markFailed(message: string): void {
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

// A round trip that reached the server and came back clean, without necessarily
// having anything to send. Clears a stale failure without claiming a push.
function markReachable(): void {
  if (readLocal(FAILED_KEY) === '1') {
    writeLocal(FAILED_KEY, null);
    writeLocal(ERROR_KEY, null);
    notifyChange();
  }
}

function claimAccount(userId: string): void {
  writeLocal(ACCOUNT_KEY, userId);
}

// Signing out (or losing the session) puts this device back to "never synced
// here". The remote row is untouched — signing back in finds it again and pulls
// it. The fingerprints and seen-stamps go too: they describe one account's copy,
// and keeping them could make the next account's first push skip a half it has
// never actually seen.
function forgetAccount(): void {
  for (const key of [
    ACCOUNT_KEY, PENDING_KEY, FAILED_KEY, ERROR_KEY, LAST_KEY,
    CORE_FP_KEY, GAMES_FP_KEY, SEEN_CORE_KEY, SEEN_GAMES_KEY,
  ]) writeLocal(key, null);
  coreDirty = false;
  gamesDirty = false;
  notifyChange();
}

// ── Saying what went wrong ────────────────────────────────────────────────────
//
// Every failure used to read "Sync failed — will retry", which is true of a
// tunnel and a lie about a project whose SQL was never run. These are the ones
// worth naming: each maps a Postgres/PostgREST condition onto the thing the
// owner of the project would actually have to do about it.
export function describeSyncError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? '');
  // The friendly sentence below replaces the database's own words, which is
  // right for the caption and wrong for debugging — "re-run the grants" was
  // shown for weeks while the real message named the column Postgres had
  // actually refused. Keep the original where a remote console can reach it.
  console.warn('[sync]', message);
  const text = message.toLowerCase();

  if (/failed to fetch|networkerror|load failed|offline|network request failed/.test(text)) {
    return 'Offline — your changes are safe here and go up when you’re back.';
  }
  if (/does not exist/.test(text) && /relation|table/.test(text)) {
    return 'Your Supabase project has no “profiles” table yet — run the SQL in SUPABASE-SYNC.md.';
  }
  if (/column .* does not exist|could not find the .* column/.test(text)) {
    return 'Your “profiles” table is missing a column — re-run the SQL in SUPABASE-SYNC.md.';
  }
  if (/row-level security|violates row-level/.test(text)) {
    return 'Supabase blocked the write (row-level security) — re-run the policies in SUPABASE-SYNC.md.';
  }
  if (/permission denied|not authorized|insufficient privilege/.test(text)) {
    return 'Supabase refused the write — re-run the grants at the end of the SQL in SUPABASE-SYNC.md.';
  }
  if (/jwt|token is expired|invalid claim/.test(text)) {
    return 'Your session expired — sign out and back in.';
  }
  if (/duplicate key|conflict/.test(text)) {
    return 'Two devices wrote at once — the next sync sorts it out.';
  }
  // Anything unmapped keeps its real words. Ugly beats mysterious: this is the
  // string that would otherwise cost a debugging session.
  return message ? `Sync failed — ${trim(message)}` : 'Sync failed — will retry.';
}

function trim(text: string): string {
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

// The two column timestamps, and nothing else. A few hundred bytes, which is
// what makes polling for another device's work affordable.
async function fetchRemoteStamps(userId: string): Promise<{ core: string | null; games: string | null } | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(`${CORE_STAMP_COLUMN}, ${GAMES_STAMP_COLUMN}`)
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown> | null;
  if (!row) return null; // no row yet: the account holds nothing
  return {
    core: typeof row[CORE_STAMP_COLUMN] === 'string' ? (row[CORE_STAMP_COLUMN] as string) : null,
    games: typeof row[GAMES_STAMP_COLUMN] === 'string' ? (row[GAMES_STAMP_COLUMN] as string) : null,
  };
}

// Read the copy stored in the user's row, or null when there isn't one yet.
// Validation is parseBackup's, the same one a hand-picked file goes through, so
// a corrupt or foreign blob throws here rather than reaching the repertoire.
//
// `parts` decides which columns are worth the bytes. Asking for neither is not
// a valid call; asking for one is the common case.
export async function fetchRemoteBackup(
  parts: PullParts = { core: true, games: true },
): Promise<BackupFile | null> {
  const user = getAuthUser();
  if (!user) return null;
  const columns = [
    parts.core ? CORE_COLUMN : null,
    parts.games ? GAMES_COLUMN : null,
  ].filter(Boolean).join(', ');
  const { data, error } = await supabase
    .from(TABLE)
    .select(columns || CORE_COLUMN)
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown> | null;
  const text = combineRemote(row?.[CORE_COLUMN] ?? null, row?.[GAMES_COLUMN] ?? null);
  if (text === null) return null;
  // The columns are jsonb, so supabase-js hands back already-parsed values.
  // Re-serialising to run parseBackup is deliberate: one validator for files and
  // for Supabase alike — including reviving each move's `review.due` back into a
  // real Date.
  return parseBackup(text);
}

// ── Debounced push ────────────────────────────────────────────────────────────
//
// Both parts share one 30s timer and one round trip, with a dirty flag each.
// Games change rarely but when they do (a 300-game import, a scan sweep) they
// fire in bursts that one debounce window absorbs perfectly well.

const PUSH_DELAY_MS = 30_000;
let pushTimer: number | undefined;
let pushBusy = false;
let coreDirty = false;
let gamesDirty = false;

// Whether a background push is allowed right now. The account check is what
// stops us uploading before this device has pulled what the account already has.
function canPush(): boolean {
  return isSupabaseConfigured && isAccountClaimed();
}

// A push refused by the size ceiling rather than by the network. Distinct from
// every other failure here because it will NOT fix itself by retrying.
class PayloadTooLargeError extends Error {}

// Upload whichever parts are dirty, in ONE write — two columns of the same row,
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
      await writeRow(user.id, row);
    }
  } catch (err) {
    // Put the flags back so the work is still owed, then let the caller mark it.
    coreDirty = coreDirty || wantCore;
    gamesDirty = gamesDirty || wantGames;
    throw err;
  }

  // A stamp we wrote ourselves is a stamp we have already seen, so recording it
  // here is what stops the next poll downloading our own upload straight back.
  if (nextCoreFp) {
    writeLocal(CORE_FP_KEY, nextCoreFp);
    writeLocal(SEEN_CORE_KEY, now);
  }
  if (nextGamesFp) {
    writeLocal(GAMES_FP_KEY, nextGamesFp);
    writeLocal(SEEN_GAMES_KEY, now);
  }

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

// Write the changed columns into the user's row, creating the row if this
// account has never pushed before.
//
// ── AND IT IS DELIBERATELY NOT AN UPSERT ────────────────────────────────────
// This was `.upsert(row, { onConflict: 'id' })`, which is the obvious call and
// which silently broke every push in the app the day the column grants landed.
//
// PostgREST turns an upsert into
//
//     INSERT INTO profiles (id, repertoire, …)
//       VALUES (…)
//       ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id, repertoire = …
//
// — note `id = EXCLUDED.id`. It puts the conflict key itself in the SET list,
// even though assigning a column to the value it already has is a no-op, so the
// statement needs UPDATE privilege on `id`. (PostgREST issue #2446.)
//
// SUPABASE-SYNC.md deliberately does not grant that. The whole point of the
// grants there is that the browser may UPDATE the four sync columns and nothing
// else — that is what stops a signed-in user flipping their own `entitled` to
// true with the public anon key. So Postgres refused every push with "permission
// denied for table profiles", the Account section said so, and the account's row
// was never created at all: no copy to pull, which is why a second device came
// up empty and ran the first-run walkthrough all over again.
//
// UPDATE first, because after the very first push the row always exists. The
// INSERT is the once-per-account path, and a duplicate-key error there means
// another device created the row in the gap between our two statements — so we
// simply run the UPDATE again.
async function writeRow(userId: string, row: Record<string, unknown>): Promise<void> {
  const { id: _id, ...columns } = row;
  if (await updateRow(userId, columns)) return;

  const { error } = await supabase.from(TABLE).insert(row);
  if (!error) return;
  if (!/duplicate key|already exists|conflict/i.test(error.message)) throw new Error(error.message);
  if (!(await updateRow(userId, columns))) throw new Error(error.message);
}

// True when a row was actually there to update. The `select('id')` is what makes
// that answerable: without it PostgREST reports nothing about how many rows
// matched, and "this account has no row yet" would be indistinguishable from a
// successful write. It costs one uuid on the wire.
async function updateRow(userId: string, columns: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await supabase
    .from(TABLE)
    .update(columns)
    .eq('id', userId)
    .select('id');
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0;
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
    // the state, and now the reason with it.
    markFailed(err instanceof PayloadTooLargeError ? err.message : describeSyncError(err));
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
// nature: the browser may kill the page before the request lands. That's
// survivable rather than lossy — the pending flag is already in localStorage, so
// the next launch retries, and the fingerprint check makes that retry free if
// the push did get through.
function flush(): void {
  if (!canPush()) return;
  if (!coreDirty && !gamesDirty) return;
  window.clearTimeout(pushTimer);
  void runPush();
}

// ── The half nothing notifies about ──────────────────────────────────────────
//
// The core column is the lines PLUS the app-state snapshot, but only the lines
// have a change notifier. Solving a puzzle, extending a streak, playing out an
// endgame, changing the board colour — every one of those writes localStorage
// and nothing else, so `coreDirty` stayed false and the statistics sat on the
// phone until some unrelated line edit happened to carry them up. On a device
// used mostly for puzzles that could be weeks.
//
// Rather than teach a dozen modules to announce themselves, the core is simply
// OFFERED at the moments a push is due anyway, and the fingerprint decides.
// Offering costs one read of the repertoires and two hashes; when nothing has
// changed it sends no request at all, which is the whole reason the fingerprint
// exists. Quiet on purpose — it doesn't call schedule(), so the caption never
// flickers to "Pending" for a check that turns out to have nothing to say.
function offerCore(): void {
  coreDirty = true;
}

// ── Pull ──────────────────────────────────────────────────────────────────────

// How often the app asks whether the other device has been busy, while it is
// open and in the foreground. Two timestamps per poll; cheap enough to do often,
// slow enough that a phone left open all day costs a few hundred requests, not
// tens of thousands.
const PULL_POLL_MS = 5 * 60_000;
// Coming back to the foreground always checks, but not more often than this —
// app-switching on Android fires visibilitychange constantly.
const PULL_MIN_GAP_MS = 20_000;

let pullBusy = false;
let lastPullAt = 0;
let pollTimer: number | undefined;

/**
 * Bring down whatever the account has that this device hasn't seen, and merge
 * it in. Returns true when something actually changed here.
 *
 * Never destructive: repertoires and games merge, and the app-state snapshot is
 * only applied when the account's copy is genuinely newer than this device's
 * last push AND this device has nothing unpushed of its own.
 */
async function pullFromAccount(opts: { force?: boolean } = {}): Promise<boolean> {
  const user = getAuthUser();
  if (!isSupabaseConfigured || !user || pullBusy) return false;
  if (!opts.force && Date.now() - lastPullAt < PULL_MIN_GAP_MS) return false;

  pullBusy = true;
  lastPullAt = Date.now();
  try {
    const stamps = await fetchRemoteStamps(user.id);
    markReachable();
    if (!stamps) return false; // the account holds nothing yet

    const seen = { core: readLocal(SEEN_CORE_KEY), games: readLocal(SEEN_GAMES_KEY) };
    const parts = partsToPull(stamps, seen);
    if (!anyPart(parts)) return false;

    const remote = await fetchRemoteBackup(parts);
    if (!remote) return false;

    let changed = false;

    if (parts.core) {
      const incoming = repertoiresFrom(remote);
      if (incoming.length > 0) {
        await mergeRepertoires(incoming);
        changed = true;
      }
      // The statistics/preferences half: last-write-wins, and only when this
      // device has nothing of its own still waiting to go up.
      if (remote.local && shouldApplyRemoteLocal({
        remoteCoreStamp: stamps.core,
        lastPushedCoreStamp: readLocal(SEEN_CORE_KEY),
        localDirty: coreDirty,
      })) {
        applyLocalSnapshot(remote.local);
        changed = true;
      }
      writeLocal(SEEN_CORE_KEY, stamps.core);
    }

    if (parts.games && remote.games && remote.games.length > 0) {
      await saveGames(remote.games);
      changed = true;
    }
    if (parts.games) writeLocal(SEEN_GAMES_KEY, stamps.games);

    if (changed) window.dispatchEvent(new Event(SYNC_PULLED_EVENT));
    return changed;
  } catch (err) {
    markFailed(describeSyncError(err));
    return false;
  } finally {
    pullBusy = false;
  }
}

// ── Sign-in ───────────────────────────────────────────────────────────────────

let connecting = false;

/**
 * First sign-in on this device with this account. LOOK before you upload: on a
 * new phone the account's copy is the thing the user wants back, and an eager
 * first push of an empty repertoire would flatten it.
 *
 * There is no question here any more — the pull merges. Merging an empty device
 * with a full account restores it; merging a full device with an empty account
 * seeds it; merging two full ones keeps both, which is the answer a user would
 * have picked every time anyway.
 */
async function connect(userId: string): Promise<void> {
  let remote: BackupFile | null = null;
  try {
    remote = await fetchRemoteBackup();
  } catch (err) {
    // Unreachable, or a copy we can't read. Claim nothing, push nothing,
    // destroy nothing: the next auth event, foreground or launch tries again.
    markFailed(describeSyncError(err));
    return;
  }

  if (remote) {
    try {
      const incoming = repertoiresFrom(remote);
      if (incoming.length > 0) await mergeRepertoires(incoming);
      if (remote.games?.length) await saveGames(remote.games);
      // On a first connect the account's snapshot is applied unconditionally:
      // there is nothing this device has "already pushed" to weigh it against,
      // and a new phone signing in wants its streaks and ratings back.
      if (remote.local) applyLocalSnapshot(remote.local);
    } catch (err) {
      markFailed(describeSyncError(err));
      return;
    }
    const n = backupLineCount(remote);
    if (n > 0) {
      showToast(`Restored ${n} line${n === 1 ? '' : 's'} from your account`, { variant: 'success' });
    }
  }

  // Only now is this device in step with the account, so only now may it push.
  claimAccount(userId);
  coreDirty = true;
  gamesDirty = true;
  await runPush();
  window.dispatchEvent(new Event(SYNC_PULLED_EVENT));

  // A copy carrying stats/streaks/games needs a reload to take everywhere —
  // several modules cache their localStorage state in memory at boot. Only on
  // this first connect: a background pull applies the same keys without one,
  // because reloading the app under someone mid-drill would be far worse than a
  // statistic that catches up at the next launch.
  if (remote && (remote.local || remote.games?.length)) {
    setTimeout(() => window.location.reload(), 1200);
  }
}

// ── The public verbs ──────────────────────────────────────────────────────────

/**
 * "Sync now" — push anything owed, then pull anything new. Exported for the
 * Account section's button, and for the places that make a change big enough
 * that waiting 30 seconds to send it would be wrong (resetting progress, say).
 *
 * Returns nothing and never throws: the state flags and the Account caption are
 * how it reports.
 */
export async function syncNow(): Promise<void> {
  if (!isSupabaseConfigured || !getAuthUser()) return;
  const user = getAuthUser()!;
  if (!isAccountClaimed()) {
    if (connecting) return;
    connecting = true;
    try { await connect(user.id); } finally { connecting = false; }
    return;
  }
  window.clearTimeout(pushTimer);
  offerCore();
  gamesDirty = true;
  await runPush();
  await pullFromAccount({ force: true });
}

/** Push everything on this device, whether or not it looks changed. */
export function markEverythingDirty(): void {
  coreDirty = true;
  gamesDirty = true;
}

/**
 * The explicit "replace" that the sign-in prompt used to guess at: throw away
 * what is on this device and take the account's copy exactly. Settings → Data
 * offers it behind a confirm; nothing calls it on its own.
 *
 * Throws with a readable message on failure, because unlike everything else in
 * this module it was asked for and the user is watching.
 */
export async function replaceFromAccount(): Promise<number> {
  const user = getAuthUser();
  if (!isSupabaseConfigured || !user) throw new Error('You’re not signed in.');
  let remote: BackupFile | null;
  try {
    remote = await fetchRemoteBackup();
  } catch (err) {
    throw new Error(describeSyncError(err));
  }
  if (!remote) throw new Error('Your account has no copy yet.');

  await replaceAllRepertoires(repertoiresFrom(remote));
  await clearGames();
  if (remote.games?.length) await saveGames(remote.games);
  if (remote.local) applyLocalSnapshot(remote.local);

  // This device now holds exactly what the account holds, so record both halves
  // as seen and as pushed — otherwise the push that follows would send back a
  // byte-identical copy for nothing.
  writeLocal(CORE_FP_KEY, coreFingerprintOf(remote));
  writeLocal(GAMES_FP_KEY, gamesFingerprintOf(remote.games ?? []));
  claimAccount(user.id);
  markSynced();
  return backupLineCount(remote);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

// Everything that reacts to an auth event goes through here rather than running
// inside supabase-js's callback.
//
// THE `setTimeout(0)` IS NOT COSMETIC. supabase-js takes an internal lock around
// the auth state it is broadcasting, and any `supabase.*` call made from inside
// that broadcast waits on a lock the broadcast itself is holding. The library's
// own documentation says not to await inside an onAuthStateChange callback for
// exactly this reason. Our listeners are invoked synchronously from that
// callback, so the first thing they did — fetch the profile row — could sit
// there forever, which looks from the outside exactly like a sync that never
// works. Hopping to the next task lets the lock go first.
function deferred(fn: () => void): void {
  setTimeout(fn, 0);
}

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
  window.addEventListener('pagehide', () => { offerCore(); flush(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      offerCore();
      flush();
      stopPolling();
      return;
    }
    // Back in the foreground: the most likely moment for the other device to
    // have been busy, and the moment the user is about to look at the lines.
    if (canPush()) {
      void syncTick();
      startPolling();
    }
  });

  onAuthChange(() => deferred(() => {
    const user = getAuthUser();
    if (!user) {
      stopPolling();
      forgetAccount();
      return;
    }
    if (readLocal(ACCOUNT_KEY) === user.id) {
      // A resumed session (app launch, token refresh). The dirty flags don't
      // survive a launch and we can't know WHICH half changed while we were
      // away, so offer both and let the fingerprints sort it out: if the account
      // is already in step this costs one hash of each half and no request.
      coreDirty = true;
      gamesDirty = true;
      void runPush().then(() => pullFromAccount({ force: true }));
      startPolling();
      return;
    }
    // A different account, or the first sign-in on this device.
    if (connecting) return;
    connecting = true;
    void connect(user.id).finally(() => {
      connecting = false;
      startPolling();
    });
  }));
}

// One round of the loop: send whatever is owed, then take whatever is new.
// Push first, always — pulling first would let the account's older snapshot land
// on top of statistics this device hasn't sent yet, and shouldApplyRemoteLocal's
// guard would then refuse to apply anything at all until the next round.
async function syncTick(): Promise<void> {
  if (!canPush()) return;
  offerCore();
  await runPush();
  await pullFromAccount();
}

function startPolling(): void {
  stopPolling();
  if (document.visibilityState !== 'visible') return;
  pollTimer = window.setInterval(() => void syncTick(), PULL_POLL_MS);
}

function stopPolling(): void {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}
