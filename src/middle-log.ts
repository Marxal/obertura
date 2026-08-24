// The rest logs for the two "read your own games" exercises — Blunder detective
// and Which move — device-local in localStorage, exactly like
// brilliant-log.ts (this file is that file, generalised, rather than a third
// copy of it).
//
// WHY THEY REST. Both exercises deal from a fixed pool: one run per scanned
// game, one two-move question per found mistake. Without a memory they would
// deal the same handful forever — you'd learn "the third move, vs Kevin" rather
// than how to spot a blunder. So a run you crack goes away for a few days and
// then comes back, further out each time you get it right again; a run you miss
// never rests, because an unfound blunder is exactly what you should meet again
// tomorrow.
//
// Both stores are throwaway by design: clearing them (the pane's Reset) puts
// every exercise back on the table and loses nothing but the rotation.

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ITEMS = 300;

interface Rec {
  due: number;   // epoch ms — suppressed until now ≥ due
  step: number;  // ladder index of the last clean solve
}
type Store = Record<string, Rec>;

export interface RestLog {
  /** The epoch ms each id comes back (0 / absent = available now). */
  dueMap(): Record<string, number>;
  /** Record one clean solve: step up the ladder, push the return date out. */
  solved(id: string, now?: number): void;
  /** Forget everything — every exercise becomes available again. */
  clear(): void;
}

function makeRestLog(key: string, ladder: readonly number[]): RestLog {
  const load = (): Store => {
    try {
      const raw = localStorage.getItem(key);
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
  };

  const save = (map: Store): void => {
    // Cap the store: keep the entries that come back latest (the freshest
    // solves) — the oldest ones are available again anyway.
    let out = map;
    const ids = Object.keys(map);
    if (ids.length > MAX_ITEMS) {
      const keep = ids.sort((a, b) => map[b].due - map[a].due).slice(0, MAX_ITEMS);
      out = {};
      for (const id of keep) out[id] = map[id];
    }
    try {
      localStorage.setItem(key, JSON.stringify(out));
    } catch {
      /* storage unavailable/full — the rotation is a nicety, never block on it. */
    }
  };

  return {
    dueMap(): Record<string, number> {
      const map = load();
      const out: Record<string, number> = {};
      for (const [id, r] of Object.entries(map)) out[id] = r.due;
      return out;
    },
    solved(id: string, now: number = Date.now()): void {
      if (!id) return;
      const map = load();
      const step = Math.min((map[id]?.step ?? -1) + 1, ladder.length - 1);
      map[id] = { step, due: now + ladder[step] * DAY_MS };
      save(map);
    },
    clear(): void {
      try {
        localStorage.removeItem(key);
      } catch {
        /* storage unavailable — nothing to clear. */
      }
    },
  };
}

// A cracked case rests a good while: the answer ("it was 14…Nxe4") is the whole
// exercise, and it is memorable.
export const detectiveLog = makeRestLog('obertura.detectiveLog', [4, 10, 25, 60]);

// A two-move question is smaller, so it comes back sooner — and a right answer
// there is worth less than a right answer at a blank board.
export const whichMoveLog = makeRestLog('obertura.whichMoveLog', [2, 6, 15, 40]);

/** Both, for the Middle-game pane's Reset. */
export function clearMiddleLogs(): void {
  detectiveLog.clear();
  whichMoveLog.clear();
}
