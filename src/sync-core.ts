// The account sync's pure logic, with no Supabase, no auth and no browser in
// sight — repertoire-sync.ts is the module that talks to the network, and this is
// the part of it that can be reasoned about and tested on its own. Kept separate
// for exactly that reason: importing repertoire-sync.ts pulls in the Supabase
// client, which reads `import.meta.env` and so only exists inside a Vite build.
// The self-test (repertoire-sync.selftest.ts) imports this file and runs under
// plain Node.
//
// Three jobs, all of them things that fail silently rather than loudly:
// deciding what the Account section should say, reassembling the two synced
// columns back into one backup, and answering "is this byte-for-byte what I last
// pushed?" so unchanged data isn't re-uploaded.

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

// The games half, fingerprinted over the array alone.
export function gamesFingerprintOf(games: unknown[]): string {
  return fingerprint(JSON.stringify(games));
}
