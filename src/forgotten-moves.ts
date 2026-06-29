// Tracks which exact moves you miss in training, so Statistics can surface the
// single "most forgotten move this week" with a board. Device-local, mirroring
// streak.ts / puzzle-log.ts. Keyed by position + move, with a small per-day tally
// so the "this week" window is a simple sum over the last seven day keys.

const KEY = 'obertura.forgottenMoves';
const MAX_MOVES = 120;     // cap distinct moves so the store can't grow unbounded
const KEEP_DAYS = 14;      // prune day tallies older than this (a margin over a week)

interface StoredMove {
  fen: string;                       // the position before the user's move (to show)
  san: string;                       // the move they kept missing
  colour: 'white' | 'black';         // board orientation for the miniature
  days: Record<string, number>;      // miss count per "YYYY-MM-DD"
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// The earliest day key (inclusive) still inside the last `back + 1` days.
function cutoff(back: number, now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() - back);
  return dayKey(d);
}

function load(): StoredMove[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as StoredMove[]) : [];
  } catch {
    return [];
  }
}

function save(moves: StoredMove[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(moves));
  } catch {
    /* storage unavailable/full — this is a nicety, never block on it. */
  }
}

function recentTotal(m: StoredMove, from: string): number {
  let n = 0;
  for (const [day, count] of Object.entries(m.days)) {
    if (day >= from) n += count;
  }
  return n;
}

// Record one missed move during training. Folds into an existing entry for the
// same position + move, drops stale day tallies, and caps the store by evicting
// the move with the fewest recent misses.
export function recordMissedMove(
  fen: string,
  san: string,
  colour: 'white' | 'black',
  now: Date = new Date(),
): void {
  if (!fen || !san) return;
  const moves = load();
  const keep = cutoff(KEEP_DAYS, now);
  const today = dayKey(now);

  let entry = moves.find((m) => m.fen === fen && m.san === san);
  if (!entry) {
    entry = { fen, san, colour, days: {} };
    moves.push(entry);
  }
  entry.colour = colour;
  entry.days[today] = (entry.days[today] ?? 0) + 1;

  // Prune stale day tallies, then drop any entry left with nothing recent.
  for (const m of moves) {
    for (const day of Object.keys(m.days)) {
      if (day < keep) delete m.days[day];
    }
  }
  let live = moves.filter((m) => Object.keys(m.days).length > 0);

  // Cap: keep the most-missed-recently moves.
  if (live.length > MAX_MOVES) {
    live.sort((a, b) => recentTotal(b, keep) - recentTotal(a, keep));
    live = live.slice(0, MAX_MOVES);
  }
  save(live);
}

export interface ForgottenMove {
  fen: string;
  san: string;
  colour: 'white' | 'black';
  count: number; // misses in the last 7 days
}

// The single most-forgotten move over the last seven days, or null when nothing
// has been missed in that window.
export function mostForgottenThisWeek(now: Date = new Date()): ForgottenMove | null {
  const from = cutoff(6, now); // today + previous 6 days
  let best: ForgottenMove | null = null;
  for (const m of load()) {
    const count = recentTotal(m, from);
    if (count > 0 && (!best || count > best.count)) {
      best = { fen: m.fen, san: m.san, colour: m.colour, count };
    }
  }
  return best;
}

// Forget everything — part of "Reset progress" in Settings.
export function clearForgottenMoves(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — nothing to clear. */
  }
}
