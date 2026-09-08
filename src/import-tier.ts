// The pure half of "how many games may this person import?" — split out of
// import-panel.ts so it runs under plain Node in the self-test, without dragging
// in the DOM, Supabase or the auth client.
//
// One rule: a signed-out visitor takes FREE_GUEST_IMPORT games at a time.
// Everything above that is shown but padlocked, so the offer is legible instead
// of invisible. Signed in — or in a build with no accounts at all — the old
// 100 / 500 / All ladder is unchanged.

import { HARD_CAP, type CountChoice } from './import-core';

// What a signed-out visitor may take in one import. Enough to see which openings
// they actually play (which is the whole pitch), small enough that the full
// library stays a reason to make an account.
//
// Raised 50 → 100 → 500. Fifty games is a thin sample once it's split by colour
// and time control; a hundred is enough to see which openings you play, but not
// enough to slice by time control on top of that and still have anything left
// to say — and the first-run recap now does exactly that (the user picks a time
// format and the openings re-derive under it).
//
// 500 is affordable because the scan is now BOUNDED BY THIS NUMBER rather than
// by HARD_CAP: first run asks importGames for exactly this many and stops, so a
// bigger figure here costs archives we actually keep instead of ten times the
// fetching for games thrown away. The account's edge is the full 1,000 ladder
// (import-panel's chooser) plus sync, not the raw count of a first look.
export const FREE_GUEST_IMPORT = 500;

// One chip in the how-many row. A `locked` chip can't be selected: it opens the
// sign-up sheet instead.
export interface CountOption {
  value: CountChoice;
  label: string;
  locked?: boolean;
}

// Default the chooser to a phone-friendly 500 once there's more than that to
// choose from; otherwise keep everything the scan held. Big imports (All, up to
// the 1000 cap) noticeably slow the map and the board browser on a phone, so we
// don't reach for them by default — the user can opt up.
//
// A guest can never default to more than their cap, whatever the scan found.
export function defaultCountFor(total: number, guest: boolean): CountChoice {
  if (guest) return total > FREE_GUEST_IMPORT ? FREE_GUEST_IMPORT : 'all';
  return total > 500 ? 500 : 'all';
}

// The chips to offer. A smaller slice only appears when the scan actually held
// more than it ("Last 100" is pointless with 80 games); "All" is always offered
// to a signed-in user and is already ≤ HARD_CAP.
export function countOptionsFor(
  total: number,
  truncated: boolean,
  guest: boolean,
): CountOption[] {
  const opts: CountOption[] = [];
  // When the hard cap bit, "All" is the most recent HARD_CAP — spell it out.
  const allLabel = truncated ? `All (${HARD_CAP.toLocaleString()})` : 'All';

  if (guest) {
    opts.push({ value: FREE_GUEST_IMPORT, label: `Last ${FREE_GUEST_IMPORT}` });
    // Only worth padlocking the bigger slices when the account genuinely holds
    // more than the cap — otherwise we'd advertise an upgrade that changes
    // nothing for this user.
    if (total > FREE_GUEST_IMPORT) {
      opts.push({ value: 500, label: 'Last 500', locked: true });
      opts.push({ value: 'all', label: allLabel, locked: true });
    }
    return opts;
  }

  if (total > 100) opts.push({ value: 100, label: 'Last 100' });
  if (total > 500) opts.push({ value: 500, label: 'Last 500' });
  opts.push({ value: 'all', label: allLabel });
  return opts;
}
