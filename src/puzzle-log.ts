// Local record of puzzles solved in the app — kept device-local in localStorage,
// mirroring streak.ts. It powers the "Puzzles" block on the Statistics page even
// when you're not connected to Lichess (and complements the richer Lichess
// dashboard when you are).
//
// Two small tallies, recorded going FORWARD from each finished puzzle (no
// backfill): a per-day solved/failed count (for "puzzles this week/month"), and a
// per-opening solved/failed count keyed by Lichess angle (for accuracy by
// opening — which trained openings you're sharp or shaky in tactically).

const DAY_KEY = 'obertura.puzzleLog';
const OPENING_KEY = 'obertura.puzzleByOpening';
const SEEN_KEY = 'obertura.puzzleSeen';
const MAX_DAYS = 120;
const MAX_SEEN = 300;

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Compact storage: { "2026-06-22": { s: 8, f: 2 }, … }.
type Tally = { s: number; f: number };
type StoredDays = Record<string, Tally>;
type StoredOpenings = Record<string, Tally>;

function load<T>(key: string): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {} as T;
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== 'object') return {} as T;
    return obj as T;
  } catch {
    return {} as T;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable/full — puzzle stats are a nicety, never block on them. */
  }
}

// Record one finished puzzle: solved (clean, no wrong move) or failed. `angle` is
// the Lichess opening key it was drawn for (null for mixed/themeless runs).
export function recordPuzzleResult(angle: string | null, solved: boolean, now: Date = new Date()): void {
  const bump = (t: Tally | undefined): Tally => ({
    s: (t?.s ?? 0) + (solved ? 1 : 0),
    f: (t?.f ?? 0) + (solved ? 0 : 1),
  });

  const days = load<StoredDays>(DAY_KEY);
  const dk = dayKey(now);
  days[dk] = bump(days[dk]);
  // Prune to the most recent MAX_DAYS so the store can't grow unbounded.
  const keys = Object.keys(days);
  if (keys.length > MAX_DAYS) {
    const keep = keys.sort().slice(keys.length - MAX_DAYS);
    const trimmed: StoredDays = {};
    for (const k of keep) trimmed[k] = days[k];
    save(DAY_KEY, trimmed);
  } else {
    save(DAY_KEY, days);
  }

  if (angle) {
    const byOpening = load<StoredOpenings>(OPENING_KEY);
    byOpening[angle] = bump(byOpening[angle]);
    save(OPENING_KEY, byOpening);
  }
}

export interface PuzzleDay {
  day: string; // "YYYY-MM-DD" local
  solved: number;
  failed: number;
}

export function getPuzzleDays(): PuzzleDay[] {
  const days = load<StoredDays>(DAY_KEY);
  return Object.keys(days).sort().map((day) => ({
    day,
    solved: Math.max(0, Math.floor(days[day]?.s ?? 0)),
    failed: Math.max(0, Math.floor(days[day]?.f ?? 0)),
  }));
}

export interface PuzzleOpeningTally {
  angle: string;
  solved: number;
  failed: number;
}

export function getPuzzlesByOpening(): PuzzleOpeningTally[] {
  const byOpening = load<StoredOpenings>(OPENING_KEY);
  return Object.keys(byOpening).map((angle) => ({
    angle,
    solved: Math.max(0, Math.floor(byOpening[angle]?.s ?? 0)),
    failed: Math.max(0, Math.floor(byOpening[angle]?.f ?? 0)),
  }));
}

// ── Seen-puzzle de-dup ─────────────────────────────────────────────────────────
//
// Because /api/puzzle/next is called anonymously (sending the token breaks CORS),
// Lichess can't skip puzzles you've already seen. We do it locally instead: a
// capped, most-recent-first ring of puzzle ids. The solver checks wasRecentlySeen
// when drawing and refetches a few times before accepting a repeat.

function loadSeen(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

export function wasRecentlySeen(id: string): boolean {
  return loadSeen().includes(id);
}

// Record a puzzle as seen, moving it to the front and trimming to MAX_SEEN.
export function recordSeenPuzzle(id: string): void {
  if (!id) return;
  const seen = loadSeen().filter((x) => x !== id);
  seen.unshift(id);
  if (seen.length > MAX_SEEN) seen.length = MAX_SEEN;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* storage unavailable/full — de-dup is a nicety, never block on it. */
  }
}

// Forget every puzzle tally — part of "Reset progress" in Settings.
export function clearPuzzleLog(): void {
  try {
    localStorage.removeItem(DAY_KEY);
    localStorage.removeItem(OPENING_KEY);
    localStorage.removeItem(SEEN_KEY);
  } catch {
    /* storage unavailable — nothing to clear. */
  }
}
