// Device-local progress for the Classic Endgames list — which fundamentals you've
// converted, how many tries each took, and when you last practised it. Pure
// localStorage, mirroring forgotten-moves.ts / puzzle-log.ts. The pure reducer
// (foldResult) carries no storage so it can be self-tested.

const KEY = 'obertura.endgameProgress';

export interface EndgameRecord {
  solved: boolean;      // once you clear it, it stays cleared (a mastery tick)
  attempts: number;     // total play-outs, clean or not
  lastTrained: number;  // epoch ms of the most recent attempt
  bestMs?: number;      // fastest successful solve, in ms — the beat-the-clock mark
}

export type EndgameProgress = Record<string, EndgameRecord>;

function load(): EndgameProgress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== 'object') return {};
    const out: EndgameProgress = {};
    for (const [id, rec] of Object.entries(obj as Record<string, Partial<EndgameRecord>>)) {
      const best = rec?.bestMs;
      out[id] = {
        solved: rec?.solved === true,
        attempts: Number.isFinite(rec?.attempts) ? Math.max(0, Math.floor(rec!.attempts as number)) : 0,
        lastTrained: Number.isFinite(rec?.lastTrained) ? (rec!.lastTrained as number) : 0,
        ...(Number.isFinite(best) && (best as number) > 0 ? { bestMs: Math.round(best as number) } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function save(p: EndgameProgress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable/full — progress is a nicety, never block on it. */
  }
}

// Pure: fold one attempt into a record. `solved` latches true (mastery sticks);
// attempts always increments; lastTrained stamps now. A successful solve with a
// finite elapsed time keeps the FASTEST run seen (the beat-the-clock mark); a
// miss (or no time given) never touches the record best.
export function foldResult(
  prev: EndgameRecord | undefined,
  solved: boolean,
  now: number,
  elapsedMs?: number,
): EndgameRecord {
  const prevBest = prev?.bestMs;
  const time = solved && Number.isFinite(elapsedMs) && (elapsedMs as number) > 0
    ? Math.round(elapsedMs as number) : undefined;
  const bestMs = time !== undefined
    ? (prevBest !== undefined ? Math.min(prevBest, time) : time)
    : prevBest;
  return {
    solved: (prev?.solved ?? false) || solved,
    attempts: (prev?.attempts ?? 0) + 1,
    lastTrained: now,
    ...(bestMs !== undefined ? { bestMs } : {}),
  };
}

export function getEndgameProgress(): EndgameProgress {
  return load();
}

export function getEndgameRecord(id: string): EndgameRecord | undefined {
  return load()[id];
}

export function isEndgameSolved(id: string): boolean {
  return load()[id]?.solved === true;
}

// Record one play-out result and persist it. `elapsedMs` (when the solve
// succeeded) feeds the best-time mark.
export function recordEndgameResult(
  id: string,
  solved: boolean,
  elapsedMs?: number,
  now: number = Date.now(),
): EndgameRecord {
  const p = load();
  const next = foldResult(p[id], solved, now, elapsedMs);
  p[id] = next;
  save(p);
  return next;
}

// How many of the given ids are solved (for a "3 / 5 done" section count).
export function solvedCount(ids: string[]): number {
  const p = load();
  let n = 0;
  for (const id of ids) if (p[id]?.solved) n++;
  return n;
}

// Forget all endgame progress — part of "Reset progress" in Settings.
export function clearEndgameProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — nothing to clear. */
  }
}
