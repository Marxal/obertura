// "Another position": which cards are resting, on this device only.
//
// Listed in local-keys.ts as private, so it never reaches the account: a rest is a
// mild preference, and a position coming back on a second phone costs one tap,
// while syncing it would mean a push for every card anyone skipped.

const KEY = 'obertura.nextReplyLog';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ITEMS = 200;

/** How long a skipped position stays away. */
export const NEXT_REPLY_REST_DAYS = 30;

export type RestMap = Record<string, number>;   // card id → epoch ms it comes back

export function restedPositions(): RestMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== 'object') return {};
    const out: RestMap = {};
    for (const [id, v] of Object.entries(obj as Record<string, unknown>)) {
      const due = Number(v);
      if (Number.isFinite(due) && due > 0) out[id] = due;
    }
    return out;
  } catch {
    return {};
  }
}

export function restPosition(id: string, now: number = Date.now()): void {
  const map = restedPositions();
  map[id] = now + NEXT_REPLY_REST_DAYS * DAY_MS;
  // Keep the entries that come back latest; the others are nearly free anyway.
  const kept = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, MAX_ITEMS);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* storage full or unavailable: the card simply comes back next visit. */
  }
}
