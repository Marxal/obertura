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
//
// `obertura.ytCache.` was a YouTube lookup cache no code reads any more. It still
// sat in old browsers, and up to 48 KB of it was being uploaded on every push.
export const RETIRED_KEY_PREFIXES = ['obertura.drive.', 'obertura.ytCache.', 'obertura.installedAt', 'obertura.metricsSeen'];

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
//
// ── THE METRICS KEY (src/metrics.ts) ────────────────────────────────────────
// The counter once kept `obertura.installedAt` and `obertura.metricsSeen` too. Both
// are retired, above, because counting no longer stores anything on the device.
//
// `obertura.metricsOptOut` — the "don't count me" switch in Settings. This one
// is subtler and is the reason it is listed rather than left to inherit the
// default. It exists so the owner's own phone stays out of the owner's own
// numbers; if it travelled, handing somebody a backup file to help them with a
// problem would silently switch THEIR device off too, and the numbers would
// quietly under-report for reasons nobody could ever trace back. A switch that
// means "not this device" has to be stored per device or it does not mean
// anything.
//
// `obertura.analysisNotice` — whether this device has told its user their game
// analysis is ready. The scan results it describes don't sync (sync-core.ts drops
// `retry`), so a second phone restoring "already told" would never announce its own.
//
// `obertura.newMovesToday` — how many new moves this device has trained today. A
// value that changes on every first move learned would mean an account push each
// time, to police a soft limit on an unusual two-phone day (new-move-limit.ts).
//
// `obertura.nextReplyLog` — which positions Home's "Your next reply" card has been
// told to rest. A position coming back on a second phone costs one tap; syncing it
// would mean an account push for every card anyone skipped (next-reply-log.ts).
//
// `obertura.homeCards` — the first few positions of Home's live boards, kept so they
// can appear instantly while the fresh ones are worked out (next-reply-cache.ts). Worked
// out again on every visit, so another device has no use for it, and every card saved
// or skipped would otherwise mean an account push.
//
// `obertura.replyAuto` — whether the boards reply for you. A preference for this phone;
// not worth a push for each flick of the switch.
//
// `obertura.spotRest`, `obertura.detectiveLog`, `obertura.whichMoveLog`,
// `obertura.brilliantLog` — when each exercise from your games may come back. They
// name game ids, and a free account's games stay on the phone, so another device
// has nothing to apply them to. Syncing them in the snapshot meant an account push
// for every answer, and with the free scan limits gone these can each reach a few
// hundred entries. A paying account's logs travel in the scans column instead
// (scan-sync.ts). The cost for everyone else is that an exercise can come back
// sooner on a second phone, or after restoring a backup file.
//
// `obertura.lastGamesRefresh` — when this device last checked for new games. A
// check every few hours would otherwise push the row each time to say nothing
// happened (auto-refresh.ts). A new device falls back on the source's date.
//
const PRIVATE_KEY_PREFIXES = [
  'obertura.supabase.',
  'obertura.sync.',
];

const PRIVATE_KEYS = [
  'obertura.entitled',
  'obertura.pricing',
  'obertura.lichessReturnTo',
  'obertura.metricsOptOut',
  'obertura.analysisNotice',
  'obertura.newMovesToday',
  'obertura.nextReplyLog',
  'obertura.homeCards',
  'obertura.replyAuto',
  'obertura.spotRest',
  'obertura.detectiveLog',
  'obertura.whichMoveLog',
  'obertura.brilliantLog',
  'obertura.lastGamesRefresh',
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
