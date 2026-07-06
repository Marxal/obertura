// A tiny "come back after a while" store for the Brilliant-moves exercise —
// device-local in localStorage (mirrors puzzle-repeat.ts / forgotten-moves.ts).
//
// Brilliant finds are few, so the carousel would otherwise show you the same one
// forever. When you re-find one cleanly it's suppressed for a stretch, then
// resurfaces so you can prove you still know it. Each clean solve pushes the
// resurface date further out along a growing ladder (2 → 5 → 12 → 30 days).
// A miss never suppresses — an unfound gem stays available.

const KEY = 'obertura.brilliantLog';
const DAY_MS = 24 * 60 * 60 * 1000;
// Days a spot rests after each successive clean re-find. Wider than the puzzle
// ladder because brilliancies are scarce and worth savouring.
const LADDER = [2, 5, 12, 30] as const;
const MAX_ITEMS = 200;

interface Rec {
  due: number;   // epoch ms — the spot is suppressed until now ≥ due
  step: number;  // ladder index of the last clean solve
}
type Store = Record<string, Rec>;

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== 'object') return {};
    const out: Store = {};
    for (const [id, v] of Object.entries(obj as Record<string, unknown>)) {
      const r = v as Partial<Rec>;
      out[id] = { due: Number(r?.due) || 0, step: Number(r?.step) || 0 };
    }
    return out;
  } catch {
    return {};
  }
}

function save(map: Store): void {
  // Cap the store: keep the entries that resurface latest (the freshest solves).
  const ids = Object.keys(map);
  if (ids.length > MAX_ITEMS) {
    const keep = ids.sort((a, b) => map[b].due - map[a].due).slice(0, MAX_ITEMS);
    const trimmed: Store = {};
    for (const id of keep) trimmed[id] = map[id];
    map = trimmed;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable/full — the log is a nicety, never block on it. */
  }
}

// The epoch ms a spot resurfaces (0 = available now / never solved). Callers
// snapshot the whole map once so ordering a list stays a single read.
export function brilliantDueMap(): Record<string, number> {
  const map = load();
  const out: Record<string, number> = {};
  for (const [id, r] of Object.entries(map)) out[id] = r.due;
  return out;
}

// Record one clean re-find: step up the ladder and push the resurface date out.
export function recordBrilliantSolved(id: string, now: number = Date.now()): void {
  if (!id) return;
  const map = load();
  const prevStep = map[id]?.step ?? -1;
  const step = Math.min(prevStep + 1, LADDER.length - 1);
  map[id] = { step, due: now + LADDER[step] * DAY_MS };
  save(map);
}

// Forget the whole suppression log — part of "Reset progress" in Settings.
export function clearBrilliantLog(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — nothing to clear. */
  }
}
