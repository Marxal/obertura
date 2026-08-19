// The last-known "is this account entitled?" answer, kept in localStorage so a
// paid user isn't locked out of their own app the moment they go offline.
//
// THIS IS A CACHE, NEVER A GRANT. It only ever holds what the server last said.
// entitlement.ts overwrites it on every successful profile fetch — including
// overwriting true with false when a subscription has gone away — and reads it
// only when the fetch itself couldn't happen (offline, Supabase down, the query
// errored). It must never be the thing that decides someone is entitled when the
// server is reachable and says otherwise.
//
// KEYED BY USER ID, deliberately. Phones get shared and accounts get switched;
// signing in as a second account must not inherit the first one's answer. The
// stored blob carries the id it belongs to, so a read for a different id misses
// rather than leaking. Signing out clears it outright.
//
// The key sits under the `obertura.` prefix like everything else the app writes,
// so the Settings "erase everything" sweep clears it — but it is excluded from
// backups (storage.ts's backupLocalKey), the same way the sync flags are. The
// sync payload reuses the BackupFile shape, so without that exclusion
// this value would ride the Supabase blob to every other device: restore an
// entitled user's copy onto a free phone and the free phone would believe it.

const KEY = 'obertura.entitled';

interface CachedEntitlement {
  // The Supabase auth id this answer belongs to.
  id: string;
  entitled: boolean;
}

// The cached answer for this user, or null when there isn't one — no cache yet,
// storage is blocked, or the cache belongs to a different account.
export function getCachedEntitled(userId: string): boolean | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null; // storage off — behave as if nothing was ever cached
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CachedEntitlement> | null;
    if (!parsed || parsed.id !== userId) return null;
    return parsed.entitled === true;
  } catch {
    return null; // corrupt entry — treat it as absent
  }
}

// Write through the server's answer for this user. Called on every successful
// fetch, so the value can move in both directions.
export function setCachedEntitled(userId: string, entitled: boolean): void {
  const value: CachedEntitlement = { id: userId, entitled };
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* storage off — we simply won't have an offline fallback */
  }
}

// Drop the cache entirely. Called on sign-out, so the next account on this
// device starts from the server rather than from someone else's answer.
export function clearCachedEntitled(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage off — nothing to clear */
  }
}
