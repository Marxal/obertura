// A lightweight repeat queue for puzzles — spaced-repetition-lite, device-local
// in localStorage (mirrors puzzle-log.ts). The seen-ring in puzzle-log.ts only
// stops immediate repeats; this is the opposite intent: it deliberately brings
// puzzles BACK.
//
// The rule, kept simple:
//   • Miss a puzzle (wrong move or hint) → it's queued and becomes due straight
//     away, so it resurfaces in your next count-mode session.
//   • Solve a queued puzzle cleanly → it's pushed further out along a growing
//     ladder (1 → 3 → 7 → 14 days); once it clears the top step it graduates and
//     leaves the queue.
//   • Solve a puzzle that was never queued → nothing to do.
// We store the whole Puzzle so a repeat can be replayed without re-fetching.

import type { Puzzle } from './puzzles';

const KEY = 'obertura.puzzleRepeat';
const MAX_ITEMS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
// The interval ladder, in days. A clean solve steps up to the next value.
const LADDER = [1, 3, 7, 14] as const;

export interface RepeatItem {
  puzzle: Puzzle;
  angle: string | null;
  family?: string;
  due: number;       // epoch ms — eligible once Date.now() ≥ due
  interval: number;  // current spacing in days (0 = freshly missed)
  lapses: number;    // how many times it's been missed
}

type Stored = Record<string, RepeatItem>;

function load(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== 'object') return {};
    const out: Stored = {};
    for (const [id, v] of Object.entries(obj as Record<string, unknown>)) {
      const it = v as Partial<RepeatItem>;
      // Keep only entries that still carry a replayable puzzle.
      if (it && it.puzzle && typeof it.puzzle === 'object' && Array.isArray(it.puzzle.solution)) {
        out[id] = {
          puzzle: it.puzzle as Puzzle,
          angle: it.angle ?? null,
          family: it.family,
          due: Number(it.due) || 0,
          interval: Number(it.interval) || 0,
          lapses: Number(it.lapses) || 0,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function save(map: Stored): void {
  // Cap the store: keep the most urgent (smallest due) items.
  const ids = Object.keys(map);
  if (ids.length > MAX_ITEMS) {
    const keep = ids.sort((a, b) => map[a].due - map[b].due).slice(0, MAX_ITEMS);
    const trimmed: Stored = {};
    for (const id of keep) trimmed[id] = map[id];
    map = trimmed;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable/full — the repeat queue is a nicety, never block on it. */
  }
}

// The next ladder step above the current interval, or null once it's graduated.
function nextInterval(current: number): number | null {
  for (const step of LADDER) if (current < step) return step;
  return null;
}

// Record the outcome of a finished puzzle against the queue.
export function reviewResult(
  puzzle: Puzzle,
  angle: string | null,
  family: string | undefined,
  solved: boolean,
  now: number = Date.now(),
): void {
  if (!puzzle?.id) return;
  const map = load();
  const existing = map[puzzle.id];

  if (solved) {
    if (!existing) return; // a fresh clean solve isn't tracked
    const ni = nextInterval(existing.interval);
    if (ni === null) {
      delete map[puzzle.id]; // graduated — it stuck
    } else {
      existing.interval = ni;
      existing.due = now + ni * DAY_MS;
    }
  } else {
    // Missed: (re)queue it, due now, and remember it's lapsed again.
    map[puzzle.id] = {
      puzzle,
      angle,
      family: family ?? existing?.family,
      due: now,
      interval: 0,
      lapses: (existing?.lapses ?? 0) + 1,
    };
  }
  save(map);
}

// Peek the most-due queued repeat (does NOT remove it — reviewResult reschedules
// it when the puzzle finishes). `exclude` skips ids already served this session;
// `angles`, when given, limits to those opening keys (Practice by a single
// opening). Returns null when nothing is due.
export function takeDueRepeat(
  exclude: Set<string>,
  angles: Set<string> | null = null,
  now: number = Date.now(),
): RepeatItem | null {
  const map = load();
  let best: RepeatItem | null = null;
  for (const [id, it] of Object.entries(map)) {
    if (it.due > now) continue;
    if (exclude.has(id)) continue;
    if (angles && (it.angle === null || !angles.has(it.angle))) continue;
    if (!best || it.due < best.due) best = it;
  }
  return best;
}

// How many repeats are currently due — handy for badges/diagnostics.
export function dueRepeatCount(now: number = Date.now()): number {
  const map = load();
  let n = 0;
  for (const it of Object.values(map)) if (it.due <= now) n++;
  return n;
}

// Forget the whole repeat queue — part of "Reset progress" in Settings.
export function clearPuzzleRepeat(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — nothing to clear. */
  }
}
