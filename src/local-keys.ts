// Which localStorage keys may leave this device, and which may never.
//
// This is a one-function module on purpose. The predicate below decides what
// goes into a backup FILE and — because the account sync reuses the backup shape
// — what gets uploaded to `profiles.repertoire` and written back onto every
// other phone that signs in. It is the boundary between "this device's state"
// and "this user's data", and getting it wrong has already cost one credential
// leak (see the Supabase session note below). It lives here, with no imports and
// no DOM, so local-keys.selftest.ts can hold the line under `npm run selftest`.
//
// The rule is allow-by-prefix, deny-by-exception: everything the app writes
// starts with "obertura" (both the dot and dash spellings) except the engine
// toggle, and the exceptions are listed one at a time with the reason.

// Retired features' leftovers. Cheap to keep listed: it costs one comparison and
// it guarantees a phone that still has them can't push them anywhere.
export const RETIRED_KEY_PREFIXES = ['obertura.drive.'];

// ── THE KEYS THAT MUST NEVER TRAVEL ─────────────────────────────────────────
//
// `obertura.supabase.` — THE SIGNED-IN SESSION ITSELF, and the one that bit.
// supabase-js keeps the access token and the refresh token under
// `obertura.supabase.auth` (the storageKey set in supabase.ts). It matched
// "starts with obertura", so it was swept into the snapshot like any preference:
// uploaded to the account row, saved into every exported backup file, and — on
// the way back — written straight over the session of whatever device pulled it.
//
// The visible symptom was a sign-in that undid itself. Sign in with Google, the
// first connect pulls the account's copy, applyLocalSnapshot replaces the
// brand-new session with the OLDER one that was in the snapshot, the app
// reloads, supabase-js tries to refresh a refresh token that has already been
// rotated, and the user is signed out seconds after signing in.
//
// It stayed hidden while nothing could be written to `profiles` at all. The
// moment pushes started working, every sign-in hit it.
//
// The leak matters on its own, independently of the logout: a refresh token is a
// bearer credential, and this put it in a database column and in every backup
// file a user might mail themselves or hand to someone for help. Sessions belong
// to a device and are re-established by signing in — there is no version of this
// that should ever be copied anywhere.
//
// `obertura.sync.` — this device's relationship with the account: what it last
// pushed, what it last saw, whether a push is owed. Restoring it onto a fresh
// device would simply lie. (And the sync blob IS a backup, so carrying "last
// synced" inside it is circular.)
//
// `obertura.entitled` — the entitlement cache. Excluded for a sharper reason
// than "it would lie": it describes an ACCOUNT's plan, and this blob travels, so
// carrying it would let an entitled user's backup grant full access to whatever
// phone restored it. Entitlement is only ever read back from the server
// (entitlement.ts); it must never arrive in a file.
//
// `obertura.pricing` — cached Stripe prices. A milder version of the same
// reasoning: per-locale and cheap to re-fetch, so carrying them would quote a
// Swedish restore a Swedish price on a Spanish phone, for no gain at all.
//
// `obertura.lichessReturnTo` — the OAuth return-path crumb. Mid-flight state for
// one redirect on one device.
const PRIVATE_KEY_PREFIXES = [
  'obertura.supabase.',
  'obertura.sync.',
];

const PRIVATE_KEYS = [
  'obertura.entitled',
  'obertura.pricing',
  'obertura.lichessReturnTo',
];

/**
 * True when this localStorage key belongs in a backup file and in the account's
 * synced copy.
 *
 * Used in BOTH directions — writing a snapshot and applying one — so a key
 * denied here can neither be uploaded by this device nor planted on it by
 * someone else's copy. That symmetry is what makes the fix retroactive: an
 * account row that already holds a session blob simply stops being able to
 * deliver it.
 */
export function backupLocalKey(key: string): boolean {
  if (key === 'engineEnabled') return true;
  if (!key.startsWith('obertura')) return false;
  if (RETIRED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) return false;
  if (PRIVATE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) return false;
  if (PRIVATE_KEYS.includes(key)) return false;
  return true;
}
