// One blunder, three doors — the shared rest log.
//
// THE BUG THIS FIXES. The same move from one of your games can be dealt by
// three different exercises: Blunder detective shows it inside a run of six,
// Which move puts it up against the engine's pick, and the mistake drill
// (Opening blunder, Punish, Missed win, Blunder) asks you to play the fix at a
// blank board. Each of them kept its own memory of what it had dealt —
// detectiveLog, whichMoveLog, and the spot's own `fixed`/`lastTrained` — and
// none of them could see the others. So catching 14…Nxe4 in the detective and
// then being asked about 14…Nxe4 again two rows down the daily challenge was
// not a coincidence, it was the design.
//
// THE RULE. A blunder that has been ANSWERED anywhere goes to the back of the
// queue everywhere. It is not removed — nothing here ever deletes an exercise —
// it just stops being one of the ones dealt first, exactly like each mode's own
// rest log, only shared.
//
// THE KEY. Every exercise id already names the game and the ply it came from:
//   mistake spot   `${gameId}#${ply}`
//   detective run  `${gameId}#d${ply}`
//   brilliant find `${gameId}#b${ply}`
// Strip the letter and they collapse onto one key — which is the mistake spot's
// own id, so the shared store is keyed by "this move of this game" and nothing
// has to be looked up to find it. (Brilliant finds share the scheme but never
// the position: a brilliancy is the engine's first choice and a blunder is not,
// so the two can't be the same ply. brilliant-log.ts stays out of this.)
//
// HOW LONG. Whatever rest the mode that dealt it earned — a cracked detective
// case rests four days, so the same blunder is four days away from Which move
// too — with a floor of one day, which is the part that stops a single sitting
// (or a single day's challenge) asking the same question twice.
//
// Device-local in localStorage, throwaway by design: the Middle-game pane's
// Reset clears it along with the two per-mode logs.

const KEY = 'obertura.spotRest';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ITEMS = 400;

/**
 * The shortest a blunder can rest once any exercise has dealt it. One day —
 * long enough to see out today's sitting and today's challenge, short enough
 * that a miss is back tomorrow.
 */
export const SHARED_REST_DAYS = 1;

type Store = Record<string, number>;

/**
 * The shared key behind any exercise id: the game and the ply, with whatever
 * letter the mode tags its own ids with removed. Anything that doesn't look
 * like an exercise id is passed through unchanged — an unknown shape gets its
 * own key rather than colliding with someone else's.
 */
export function restKey(id: string): string {
  const cut = id.lastIndexOf('#');
  if (cut < 0) return id;
  const tail = id.slice(cut + 1);
  // `d14` / `b7` → `14` / `7`; a bare ply is already the key.
  return `${id.slice(0, cut)}#${tail.replace(/^[a-z]+(?=\d)/, '')}`;
}

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
  let out = map;
  const ids = Object.keys(map);
  if (ids.length > MAX_ITEMS) {
    // Keep the ones that come back LATEST: the entries nearest their return
    // date are about to stop mattering anyway.
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

/**
 * File one answered exercise: this blunder rests everywhere until `until`, or
 * for SHARED_REST_DAYS if that is longer. Never pulls an existing rest forward
 * — the longest rest any mode has earned is the one that stands.
 */
export function restSpot(id: string, until = 0, now: number = Date.now()): void {
  if (!id) return;
  const key = restKey(id);
  const due = Math.max(until, now + SHARED_REST_DAYS * DAY_MS);
  const map = load();
  if ((map[key] ?? 0) >= due) return;
  map[key] = due;
  save(map);
}

/** The epoch ms each blunder comes back, keyed by restKey. */
export function sharedRestDueMap(): Record<string, number> {
  return load();
}

/**
 * The due-date lookup every picker takes, with the shared rest folded in: a
 * blunder is available only when BOTH its own mode and the shared log say so.
 *
 * Read the maps once at the top of a deal and pass this down — the pickers call
 * it per candidate, and re-reading localStorage per candidate would be silly.
 */
export function combinedDueAt(
  own: Record<string, number>,
  shared: Record<string, number> = sharedRestDueMap(),
): (id: string) => number {
  return (id: string): number => Math.max(own[id] ?? 0, shared[restKey(id)] ?? 0);
}

/** Forget every shared rest — part of the Middle-game pane's Reset. */
export function clearSpotRest(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — nothing to clear. */
  }
}
