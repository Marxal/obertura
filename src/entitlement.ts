// The free tier: how many lines may be enrolled in TRAINING at once.
//
// This caps exactly one thing — the number of lines actively in the training
// rotation. Everything else stays wide open: building and saving lines is
// unlimited, and so are the library, packs, traps, studies, import, puzzles,
// endgames, the engine, sparring, the analyser, statistics and sync. A free user
// can keep five hundred lines in My Lines; they just train ten at a time, and
// they can rotate which ten whenever they like.
//
// WHO IS ENTITLED
//   • Supabase not configured  → everyone, no cap. The internal GitHub Pages
//     build ships without env vars, so nobody can sign in there at all; treating
//     it as free-tier would cap the test channel. It is fully entitled instead.
//   • Signed in, profiles.entitled = true  → no cap.
//   • Signed in, anything else             → capped.
//   • Signed out (a guest)                 → capped, via the same code path.
//     This is deliberate and permanent. The public build lets anyone build and
//     train without an account, and a guest gets exactly the free tier a free
//     signed-in user gets — so signing in only ever ADDS sync, and can never
//     look like it took a restriction away.
//
// HOW THE FLAG IS READ
// `profiles.entitled` is fetched ONCE per sign-in and held in a module-level
// snapshot, so the dozens of cap checks the UI makes never touch the network.
// The snapshot is mirrored to localStorage (entitlement-cache.ts) purely so an
// offline paid user isn't locked out; a successful fetch always overwrites both,
// in either direction. A failed fetch changes nothing and leaves the cache
// standing.
//
// NOTHING HERE EVER PAUSES OR UN-ENROLS A LINE. Existing users may sit well over
// the cap — early testers have dozens enrolled — and every one of those lines
// stays enrolled and scheduled. The cap only ever blocks ADDING one more. There
// is deliberately no reconciliation pass, no trimming, no "you're over, we've
// paused some for you". Pausing is always the user's own doing, and a pause
// frees a slot immediately because the count is read live from storage on every
// check.

import { supabase, isSupabaseConfigured } from './supabase';
import { getAuthUser, onAuthChange } from './auth';
import { getAllLines } from './storage';
import { getCachedEntitled, setCachedEntitled, clearCachedEntitled } from './entitlement-cache';
import { openProSheet } from './pro-sheet';
import { showToast } from './toast';

// How many lines a free account may have in training at once.
export const FREE_TRAINING_LINES = 10;

// What the unlock costs, written once. The landing page (docs/index.html and
// docs/LANDING-COPY.md) cannot import this — it is a standalone static page —
// so those two are kept in step by eye, and the comment at the top of the
// page's script says so. The Lemon Squeezy product's own price is the third
// copy, and the only one that takes the money: if these ever disagree, the
// store is right and this is a bug.
//
// It lives HERE rather than in checkout.ts because the imports only run one
// way: checkout.ts imports this module, and this module reaches back for it
// only dynamically (see the button handler below). Putting the price in
// checkout.ts would need a static import in the other direction, which is
// exactly the cycle that arrangement exists to avoid.
// Written symbol-after-number ("9€"), which is how it is set on the landing
// page and how the audience this is priced for reads it. The Lemon Squeezy
// checkout will show whatever format the store is configured with; that screen
// is theirs, not ours.
export const PRO_PRICE = '9€';

// ── The coaching caps: Mistake Retry, endgames-from-your-games, Scouting ─────
//
// These three all read YOUR imported games and burn the app's heaviest
// resources doing it (cloud eval calls, tablebase probes, local engine time).
// A free account gets a real, always-fresh taste of each rather than either
// an empty tab or an untouched full history:
//   • Mistake Retry only considers the FREE_MISTAKE_GAME_WINDOW most recent
//     games, and keeps a ROLLING top FREE_MISTAKE_SPOTS unfixed spots — fixing
//     one frees a slot for the next; importing a newer game can push the
//     window forward. Fixed spots are never hidden; only the unfixed list is
//     capped.
//   • Endgames from your games: same game window, ROLLING top
//     FREE_ENDGAME_SPOTS unplayed positions (played-out ones stay visible).
//   • Scouting: FREE_SCOUT_OPPONENTS saved opponent instead of MAX_OPPONENTS
//     (scout.ts) — adding a new one offers to REPLACE the existing one rather
//     than refusing, as long as there's exactly one to replace. A user who
//     already holds more (grandfathered from being entitled, or an early
//     tester) gets the same "delete one to make room" refusal an entitled
//     user over MAX_OPPONENTS would — nothing is ever auto-deleted.
export const FREE_MISTAKE_GAME_WINDOW = 50;
export const FREE_MISTAKE_SPOTS = 10;
export const FREE_ENDGAME_GAME_WINDOW = 50;
export const FREE_ENDGAME_SPOTS = 3;
export const FREE_SCOUT_OPPONENTS = 1;

// Where the counter starts appearing on the Train hub, so the ceiling is visible
// before it's hit rather than a surprise at line eleven.
export const TRAINING_COUNT_VISIBLE_FROM = 7;

// Fired on window when the answer actually changes, so an open Settings screen
// can refresh its plan pill without polling. The profile fetch lands a moment
// after sign-in, so whatever painted first would otherwise sit stale. Same idea
// as SYNC_CHANGE_EVENT.
export const ENTITLEMENT_CHANGE_EVENT = 'obertura:entitlementchange';

const TABLE = 'profiles';
const COLUMN = 'entitled';

// The in-memory snapshot every check reads. Null until the first auth event.
let snapshot: { userId: string; entitled: boolean } | null = null;

// ── Reading the flag ─────────────────────────────────────────────────────────

// Is the current user entitled to unlimited training lines? Synchronous and
// network-free — the UI is built synchronously, so this has to be too.
export function isEntitled(): boolean {
  // No Supabase in this build: no accounts exist, so there is nobody to charge
  // and nothing to enforce. Fully open.
  if (!isSupabaseConfigured) return true;

  const user = getAuthUser();
  if (!user) return false; // signed out — the same free tier, not a special case

  if (snapshot && snapshot.userId === user.id) return snapshot.entitled;
  // Signed in but the fetch hasn't landed yet (or failed): fall back to the last
  // thing the server told us about THIS user, and to "free" if that's nothing.
  return getCachedEntitled(user.id) ?? false;
}

// Can one more line be enrolled right now, given how many are already in
// training? The pure form of the rule — no storage read, no DOM.
export function canEnrolAnother(inTrainingCount: number): boolean {
  return isEntitled() || inTrainingCount < FREE_TRAINING_LINES;
}

// How many more lines may be enrolled right now. Infinity for an entitled user,
// so callers can compare against it without special-casing. Never negative: a
// grandfathered user sitting above the cap gets 0, not a negative slot count.
export async function freeTrainingSlots(): Promise<number> {
  if (isEntitled()) return Infinity;
  return Math.max(0, FREE_TRAINING_LINES - (await countInTraining()));
}

export async function countInTraining(): Promise<number> {
  try {
    return (await getAllLines()).filter(l => l.inTraining).length;
  } catch {
    // Storage unreadable — the enrolment about to happen would fail anyway.
    // Report zero rather than blocking on a number we couldn't get.
    return 0;
  }
}

// ── The gate every single-line enrolment goes through ────────────────────────

// "May I enrol one more line?" — the async, UI-side form of canEnrolAnother.
// Returns true to proceed. Returns false having ALREADY shown the upsell dialog,
// so callers just bail out quietly.
//
// The count is re-read from storage on every call, which is what makes pausing
// free a slot instantly: pause a line, and the very next check sees the lower
// number with no cache to invalidate.
export async function requestTrainingSlot(): Promise<boolean> {
  if (isEntitled()) return true;
  if (canEnrolAnother(await countInTraining())) return true;
  showTrainingCapDialog();
  return false;
}

// The upsell. Shown ONLY when someone deliberately adds a single line that would
// cross the cap, and only after they've actually been using the app — never
// during first-run onboarding, and never for a bulk add (both of those get the
// quieter toast below). A paywall in the first minute, before the user has
// drilled anything, is the wrong first impression.
export function showTrainingCapDialog(): void {
  openUpgradeDialog(`You’ve got ${FREE_TRAINING_LINES} lines in training`);
}

// The same offer, asked for rather than run into: the Get-started panel's "Go
// pro" and the Settings CTA. It carries no context line, because the cap
// version's leads with a number this user hasn't reached — someone with two
// lines being told they've got ten is just wrong.
export function showGoProDialog(): void {
  openUpgradeDialog();
}

// One pitch, one price, one place the checkout is opened from. The words are
// the landing page's words (see pro-sheet.ts, and docs/LANDING-COPY.md for the
// source of truth); the price is PRO_PRICE above, and the landing page and the
// Lemon Squeezy product have to say the same thing — two different numbers for
// the same unlock is the fastest way to lose a sale.
function openUpgradeDialog(eyebrow?: string): void {
  openProSheet({
    eyebrow,
    price: PRO_PRICE,
    // Dynamic on purpose — checkout.ts imports this module, so a static import
    // here would close the loop. See the note over PRO_PRICE.
    onBuy: () => { void import('./checkout').then(m => m.openCheckout()); },
  });
}

// A discreet inline line for wherever a coaching cap is actively hiding
// something ("Showing your 10 most recent mistakes"). Not a dialog, not a
// toast — sits in the flow of the screen, so it's visible but never blocks.
// Its action opens the SAME upsell dialog as the training cap (it already
// pitches "coaching from your own games", which is exactly what these caps
// gate) rather than a bespoke dialog per feature.
export function buildCapNotice(message: string): HTMLElement {
  const note = document.createElement('div');
  note.className = 'section-desc entitlement-cap-note';
  note.appendChild(document.createTextNode(`${message} · `));
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'entitlement-cap-link';
  link.textContent = 'Unlock full access';
  link.addEventListener('click', () => showTrainingCapDialog());
  note.appendChild(link);
  return note;
}

// The bulk-add message. A batch (a starter pack, an "add all") enrols as many as
// fit and leaves the rest SAVED but not enrolled, then says so plainly. No
// price, no buy button: a batch add is usually onboarding, and the dialog would
// land far too early.
export function showBulkCapToast(enrolled: number, total: number): void {
  showToast(
    enrolled > 0
      ? `${enrolled} of ${total} lines added — the free tier trains ${FREE_TRAINING_LINES} at a time.`
      : `Already training ${FREE_TRAINING_LINES} lines — the rest were saved to My Lines.`,
  );
}

// ── Fetching the flag ────────────────────────────────────────────────────────

// Read profiles.entitled for the signed-in user and write it through to both the
// snapshot and the cache. Never throws.
//
// A FAILED FETCH CHANGES NOTHING. Offline, Supabase down, RLS misconfigured, the
// column not added yet — in every one of those cases the previous answer stands,
// which is exactly what keeps a paid user working on a plane. A SUCCESSFUL fetch
// always overwrites, including true → false: the server is the only authority on
// who is entitled, and the cache must never outvote it.
export async function refreshEntitlement(): Promise<void> {
  const user = getAuthUser();
  if (!isSupabaseConfigured || !user) return;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(COLUMN)
      .eq('id', user.id)
      .maybeSingle();
    if (error) return; // keep whatever we had — see the note above
    // No row yet, a null column, or anything that isn't literally true means
    // "not entitled". That IS the server's answer, so it's written through.
    const entitled = (data as Record<string, unknown> | null)?.[COLUMN] === true;
    const changed = !snapshot || snapshot.userId !== user.id || snapshot.entitled !== entitled;
    snapshot = { userId: user.id, entitled };
    setCachedEntitled(user.id, entitled);
    if (changed) window.dispatchEvent(new Event(ENTITLEMENT_CHANGE_EVENT));
  } catch {
    /* unreachable — the previous answer stands */
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────

// Call once at boot, BEFORE initAuth(), so the first auth notification (the
// stored session being picked up) isn't missed — the same ordering requirement
// initRepertoireSync() has, and for the same reason.
export function initEntitlement(): void {
  if (!isSupabaseConfigured) return;

  onAuthChange(() => {
    const user = getAuthUser();
    if (!user) {
      // Signed out: forget both the snapshot and the cache, so the next account
      // on this device can't inherit this one's entitlement.
      snapshot = null;
      clearCachedEntitled();
      return;
    }
    // Seed the snapshot from the cache so the very first paint (before the fetch
    // lands) doesn't cap a paid user who is offline.
    if (!snapshot || snapshot.userId !== user.id) {
      snapshot = { userId: user.id, entitled: getCachedEntitled(user.id) ?? false };
    }
    void refreshEntitlement();
  });
}

// The Account card's plan pill.
export function entitlementLabel(): string {
  return isEntitled() ? 'Full access' : `Free — ${FREE_TRAINING_LINES} lines in training`;
}
