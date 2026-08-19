// The account sync's pure logic, with no Supabase, no auth and no browser in
// sight — repertoire-sync.ts is the module that talks to the network, and this is
// the part of it that can be reasoned about and tested on its own. Kept separate
// for exactly that reason: importing repertoire-sync.ts pulls in the Supabase
// client, which reads `import.meta.env` and so only exists inside a Vite build.
// The self-test (repertoire-sync.selftest.ts) imports this file and runs under
// plain Node.
//
// Four jobs, all of them things that fail silently rather than loudly:
// deciding what the Account section should say, reassembling the two synced
// columns back into one backup, trimming the games down to what's worth
// uploading, and answering "is this byte-for-byte what I last pushed?" so
// unchanged data isn't re-uploaded.

import type { BackupFile } from './storage';

export type SyncState =
  | 'off' // not configured, or signed out
  | 'never' // signed in, but nothing has gone up from this device yet
  | 'synced'
  | 'pending' // local changes not yet uploaded
  | 'failed'; // an upload attempt failed; a retry is queued

// Everything getSyncState() needs, as plain data. Split out from the
// localStorage and auth reads so the flag PRECEDENCE — the part that's easy to
// get subtly wrong and impossible to eyeball — can be tested directly.
export interface SyncFlags {
  configured: boolean;
  userId: string | null;
  claimedAccount: string | null;
  failed: boolean;
  pending: boolean;
  lastSync: string | null;
}

// Order is the whole point here. `failed` and `pending` deliberately outrank
// "hasn't reconciled yet": a first sign-in that couldn't reach Supabase has to
// SAY it failed, not sit there looking like it hasn't got round to it. And a
// claimed account with no successful push yet is still 'never', not 'synced' —
// the caption must never claim a copy exists before one does.
export function syncStateFrom(flags: SyncFlags): SyncState {
  if (!flags.configured || !flags.userId) return 'off';
  if (flags.failed) return 'failed';
  if (flags.pending) return 'pending';
  if (flags.claimedAccount !== flags.userId) return 'never';
  return flags.lastSync ? 'synced' : 'never';
}

// Reassemble the two synced columns into one BackupFile JSON string, ready for
// parseBackup. Returns null when the account holds nothing yet.
//
// The fallback is the migration path: rows written before games moved to their
// own column carry them INSIDE the core blob. If the games column is empty we
// leave whatever the blob already had, so an existing tester's copy survives the
// upgrade untouched. Once anything pushes again the games move across and this
// stops mattering. When both are present the column wins — otherwise the first
// post-migration push would be shadowed by the stale copy in the blob.
export function combineRemote(core: unknown, games: unknown): string | null {
  if (core === null || core === undefined) return null;

  let base: Record<string, unknown>;
  if (typeof core === 'string') {
    // jsonb normally comes back already parsed; a string means someone stored
    // text. Parse it so games can be spliced in — and if it isn't JSON at all,
    // hand it straight back for parseBackup to reject with its friendly message.
    try {
      const parsed: unknown = JSON.parse(core);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return core;
      base = { ...(parsed as Record<string, unknown>) };
    } catch {
      return core;
    }
  } else if (typeof core === 'object' && !Array.isArray(core)) {
    base = { ...(core as Record<string, unknown>) };
  } else {
    // A number, a boolean, an array — not a backup. Let parseBackup say so.
    return JSON.stringify(core);
  }

  let split: unknown = games;
  if (typeof split === 'string') {
    try {
      split = JSON.parse(split);
    } catch {
      split = null;
    }
  }
  if (Array.isArray(split) && split.length > 0) base.games = split;

  return JSON.stringify(base);
}

// ── The synced games' diet ───────────────────────────────────────────────────
//
// The account row is not a backup of the device; it's the copy another phone
// restores from. Two things are therefore deliberately left out of it, and both
// exclusions are about ONE heavy user not being able to fill the database or
// burn the egress quota on data nobody needs across devices.
//
// Measured on a synthetic 1000-game library (the numbers behind SUPABASE-SYNC.md,
// re-checked when this diet was written): a bare game is ~1.3 KB, its saved
// analysis tree ~18 KB, its mistake scan ~1 KB. That library pushes ~7 MB, of
// which the analyses are 72% and the mistake scans 8.5% — 80% of every games
// upload is data the engine can regenerate from the moves it's stapled to.
//
// 1. SAVED ANALYSES (`analysis`) and MISTAKE SCANS (`retry`) are DERIVED. The
//    game's moves are the input; a saved analysis tree and a scan's spots are
//    what an engine produced from them, and re-running either on the new device
//    reproduces them. Syncing them means paying for megabytes of engine output
//    on every import, so they stay local — kept on the device that made them,
//    and still written to the manual backup file, which is a user-controlled
//    export of THIS device and follows different rules (storage.ts).
//    The one real cost: a mistake spot carries a little training state
//    (`fixed`/`attempts`/`lastTrained`) that a re-scan on another device starts
//    fresh. Accepted knowingly — it's a per-spot counter, not a repertoire, and
//    it isn't worth 8.5% of every upload. The endgame scan is NOT dropped: at
//    ~150 bytes a game it's 1.2% of the payload, and dropping it would cost a
//    tablebase/engine sweep to regain for no measurable saving.
// 2. OLD GAMES. Only the most recent SYNC_GAME_LIMIT by date go up. A new phone
//    wants your recent play, not a decade of it; older games stay on the device
//    that imported them and in its backup file. Sorted newest-first with an id
//    tiebreak so the cap is deterministic — an unstable order would change the
//    fingerprint on every push and re-upload an unchanged library forever.
//
// Together these take that 1000-game library from ~7 MB to ~0.7 MB.

// A game as this module needs to see it: a date to sort by and an id to break
// ties on. Deliberately the bare minimum rather than ImportedGame — nothing here
// needs to know what else a game carries, and asking for less lets the self-test
// hand it plain little objects. Callers keep their own richer type; the helpers
// below are generic in it so an ImportedGame[] goes in without a cast.
export interface SyncGame {
  id?: string;
  endTime?: number;
}

// How many games the account row keeps. 500 recent games is ~0.7 MB slimmed —
// comfortably inside any gateway limit, and more history than a restore needs.
export const SYNC_GAME_LIMIT = 500;

// Engine output, recomputable from the game itself. Dropped from the upload.
const DERIVED_GAME_FIELDS = ['analysis', 'retry'];

function slimGame(game: SyncGame): SyncGame {
  if (!DERIVED_GAME_FIELDS.some((field) => field in game)) return game;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(game)) {
    if (DERIVED_GAME_FIELDS.includes(key)) continue;
    out[key] = value;
  }
  return out as SyncGame;
}

// Exactly what goes into the games column: newest first, capped, slimmed.
// Idempotent by construction — running it on an already-slimmed array returns
// the same array content — which is what lets the fingerprint below be taken
// over either a local library or a copy just downloaded from the account.
export function gamesForSync<T extends SyncGame>(games: readonly T[]): SyncGame[] {
  return [...games]
    .sort(
      (a, b) =>
        (b.endTime ?? 0) - (a.endTime ?? 0) || String(a.id ?? '').localeCompare(String(b.id ?? '')),
    )
    .slice(0, SYNC_GAME_LIMIT)
    .map(slimGame);
}

// ── The hard ceiling ─────────────────────────────────────────────────────────
//
// The diet above is what a payload SHOULD be; this is the wall it may never go
// through whatever happens. Nothing on the device is bounded — a repertoire can
// hold any number of lines, each with notes — so without a ceiling one
// pathological user can push a row of unbounded size, over and over, at the
// database's and the egress quota's expense. 4 MB per column is roughly six
// times the biggest payload the diet can produce and well under the gateway
// limit scripts/probe-sync-limit.mjs exists to find, so it is a backstop, not a
// budget: reaching it means something is wrong, and the user is told so rather
// than watching a push fail forever in silence.
export const SYNC_PART_LIMIT_BYTES = 4 * 1024 * 1024;

// What the caption says when a part is refused. Local-first is the point: the
// data is not lost, it simply isn't leaving this phone.
export const SYNC_TOO_LARGE_MESSAGE =
  'Too large to sync — everything still works on this phone, and “Export backup” saves it all.';

// Serialised size in BYTES, not characters: a note full of accented text costs
// more on the wire than its length suggests, and the wall is a byte limit.
export function payloadBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? '').length;
}

// A cheap content fingerprint, used only to answer "is this byte-for-byte what I
// last pushed?". Two independent hashes plus the length, so a false match — the
// one outcome that would matter, since it would skip a real push — needs a
// simultaneous collision in both, around 2^-64. Not a security hash and it
// doesn't need to be; crypto.subtle would drag an await into a hot path for no
// gain here.
//
// Math.imul is not decoration: the FNV multiply overflows 2^53 and would lose
// precision under plain `*`, quietly weakening the hash to far less than it looks.
export function fingerprint(text: string): string {
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    fnv = Math.imul(fnv ^ c, 0x01000193) >>> 0;
    djb = (Math.imul(djb, 33) + c) >>> 0;
  }
  return `${fnv.toString(36)}.${djb.toString(36)}.${text.length.toString(36)}`;
}

// What the core fingerprint is taken over. Explicitly NOT the whole BackupFile:
// `exportedAt` is restamped on every export, so including it would make every
// payload look new and defeat the skip entirely. `format`/`version` are
// constants. That leaves the two things that actually carry user data.
export function coreFingerprintOf(backup: BackupFile): string {
  return fingerprint(JSON.stringify({ lines: backup.lines, local: backup.local ?? null }));
}

// The games half, fingerprinted over WHAT WOULD BE PUSHED rather than over
// what's on the device — the slimmed, capped array, not the raw one. That
// distinction is the whole reason the skip still works after the diet: saving an
// analysis or running a mistake scan rewrites games in IndexedDB and fires the
// games notifier, but changes nothing that syncs, so the fingerprint must come
// out identical and cost no request at all. Fingerprinting the raw array would
// re-upload the same 500 games after every scan.
//
// The same call answers "what does the account already hold?" for a copy just
// downloaded (rememberRemoteFingerprints): that copy is already slim and capped,
// and gamesForSync is idempotent, so both sides agree.
export function gamesFingerprintOf<T extends SyncGame>(games: readonly T[]): string {
  return fingerprint(JSON.stringify(gamesForSync(games)));
}

// ── Which half is worth downloading ──────────────────────────────────────────
//
// The two columns carry a timestamp each, and this device remembers the last
// stamp it has already SEEN on each — whether it saw it by pushing that value
// itself or by pulling it. A stamp that has moved since means another device
// wrote that half, and only then is it worth spending a request on the blob.
//
// Reading two timestamptz columns is a few hundred bytes; reading the blobs is
// up to 4 MB each. That gap is the whole reason this comparison exists rather
// than the pull simply fetching everything every time.

export interface RemoteStamps {
  core: string | null;
  games: string | null;
}

export interface PullParts {
  core: boolean;
  games: boolean;
}

export function anyPart(parts: PullParts): boolean {
  return parts.core || parts.games;
}

// A stamp is "newer" only when it parses AND it is strictly later than the one
// we hold. Unparseable stamps (a hand-edited row, a null) count as newer when we
// hold nothing and as unchanged otherwise — the safe direction, since the worst
// case is one wasted fetch that merges data we already have.
function movedOn(remote: string | null, seen: string | null): boolean {
  if (!remote) return false; // that half has never been written at all
  if (!seen) return true; // we've never seen it — always worth a look
  if (remote === seen) return false;
  const r = Date.parse(remote);
  const s = Date.parse(seen);
  if (!Number.isFinite(r) || !Number.isFinite(s)) return true;
  return r > s;
}

export function partsToPull(remote: RemoteStamps, seen: RemoteStamps): PullParts {
  return {
    core: movedOn(remote.core, seen.core),
    games: movedOn(remote.games, seen.games),
  };
}

// ── Whose statistics win ─────────────────────────────────────────────────────
//
// The lines and the games MERGE — a union of move trees and a union of games by
// id, so a pull can never delete another device's work. The app-state snapshot
// (statistics, streaks, ratings, preferences) cannot merge: there is no sensible
// union of two streak counters, and pretending otherwise would invent numbers
// nobody earned. So that half is last-write-wins, decided by the column's own
// timestamp, and this is the function that decides it.
//
// `localDirty` is the guard that makes LWW safe rather than lossy: if this
// device has unpushed changes of its own, applying the account's snapshot would
// throw them away before they were ever sent. In that case we push first and
// pull the snapshot on the next round, when the comparison is honest.
export function shouldApplyRemoteLocal(opts: {
  remoteCoreStamp: string | null;
  lastPushedCoreStamp: string | null;
  localDirty: boolean;
}): boolean {
  if (opts.localDirty) return false;
  if (!opts.remoteCoreStamp) return false;
  if (!opts.lastPushedCoreStamp) return true;
  if (opts.remoteCoreStamp === opts.lastPushedCoreStamp) return false;
  const r = Date.parse(opts.remoteCoreStamp);
  const p = Date.parse(opts.lastPushedCoreStamp);
  if (!Number.isFinite(r) || !Number.isFinite(p)) return true;
  return r > p;
}
