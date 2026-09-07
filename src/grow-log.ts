// The rest log for "Grow a line" — which lines have had their turn, kept on
// the device in localStorage, exactly like middle-log.ts and brilliant-log.ts.
//
// IT MOSTLY EXISTS FOR THE TWO WAYS OF SAYING "NOT THIS ONE". A line that is
// actually grown looks after itself: adding moves to it gives it moves that
// have never been drilled, and `lineMastered` stops being true the moment that
// happens — so a grown line leaves the pool on its own and comes back only
// once it has been learned again. The other two rests are the cases with
// nothing behind them, and without a memory each would simply offer the same
// line again next time, which is the one thing they promise not to do:
//
//   - swiping the notification away (grow-notice.ts) — "not now", without even
//     opening the builder — rests the longest, because it is the vaguest signal.
//   - "Skip for today", the quiet link inside the builder's Grow tab
//     (grow-panel.ts) once you've actually looked at the line — a shorter rest,
//     because looking and passing is a more specific answer than a swipe.
//
// The longer GROWN rest is kept for the case in between: a line grown into a
// branch that was already being trained, which can come back mastered within
// days.
//
// Throwaway by design — clearing it puts every mastered line back on the table
// and loses nothing but the rotation.

const KEY = 'obertura.growLog';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ITEMS = 200;

/** Swiped the notification away without opening it — the vaguest "not now". */
export const GROW_NOTICE_DISMISS_DAYS = 3;

/** "Skip for today", from inside the builder's Grow tab. */
export const GROW_SKIP_DAYS = 1;

/** A line that has just been grown. Long enough that the next round of the
 * exercise moves on to somewhere else in the repertoire. */
export const GROW_GROWN_DAYS = 14;

type Store = Record<string, number>;   // line id → epoch ms it comes back

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== 'object') return {};
    const out: Store = {};
    for (const [id, v] of Object.entries(obj as Record<string, unknown>)) {
      const due = Number(v);
      if (Number.isFinite(due) && due > 0) out[id] = due;
    }
    return out;
  } catch {
    return {};
  }
}

function save(map: Store): void {
  // Cap the store, keeping the entries that come back latest — the oldest ones
  // are available again anyway.
  let out = map;
  const ids = Object.keys(map);
  if (ids.length > MAX_ITEMS) {
    const keep = ids.sort((a, b) => map[b] - map[a]).slice(0, MAX_ITEMS);
    out = {};
    for (const id of keep) out[id] = map[id];
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch {
    /* storage unavailable/full — the rotation is a nicety, never block on it. */
  }
}

/** The epoch ms each line comes back (0 / absent = available now). */
export function growDueMap(): Store {
  return load();
}

/** Stand a line aside. Never shortens a rest it already has. */
export function restGrowLine(id: string, days: number, now: number = Date.now()): void {
  if (!id) return;
  const map = load();
  const due = now + Math.max(0, days) * DAY_MS;
  if ((map[id] ?? 0) >= due) return;
  map[id] = due;
  save(map);
}

/** Forget everything — every mastered line is offered again. */
export function clearGrowLog(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — nothing to clear. */
  }
}
