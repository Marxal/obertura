// Tracks which exact moves you miss in training, per time window (today / this
// week / all time). Device-local, mirroring streak.ts / puzzle-log.ts.
//
// STATUS: currently write-only. The Openings carousel that read it was replaced
// by the "Forgotten moves" section (forgotten-section.ts), which ranks by the
// per-move SM-2 `lapses` instead. The log is kept recording because it holds the
// one thing `lapses` cannot answer — WHEN a move was missed — so a recency view
// ("worst this week") can still be built without starting from zero. Nothing
// reads mostForgotten/forgottenSlides today.
// Keyed by position + move, with a small per-day tally so the "today" and "this
// week" windows are a simple sum over the recent day keys, plus a never-pruned
// `all` running total for the all-time window.

const KEY = 'obertura.forgottenMoves';
const MAX_MOVES = 120;     // cap distinct moves so the store can't grow unbounded
const KEEP_DAYS = 14;      // prune day tallies older than this (a margin over a week)

interface StoredMove {
  fen: string;                       // the position before the user's move (to show)
  san: string;                       // the move they kept missing
  colour: 'white' | 'black';         // board orientation for the miniature
  days: Record<string, number>;      // miss count per "YYYY-MM-DD" (recent window)
  all?: number;                      // running all-time total (never pruned)
}

// The all-time count for an entry. Old data (saved before `all` existed) has no
// running total, so fall back to whatever recent day tallies survive — a floor,
// not the true history, but honest and never negative.
function allTimeOf(m: StoredMove): number {
  if (typeof m.all === 'number') return m.all;
  let n = 0;
  for (const c of Object.values(m.days)) n += c;
  return n;
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
    entry = { fen, san, colour, days: {}, all: 0 };
    moves.push(entry);
  }
  entry.colour = colour;
  entry.days[today] = (entry.days[today] ?? 0) + 1;
  entry.all = allTimeOf(entry) + 1;

  // Prune stale day tallies (the all-time total is kept untouched).
  for (const m of moves) {
    for (const day of Object.keys(m.days)) {
      if (day < keep) delete m.days[day];
    }
  }
  // Keep any move that's still alive in either window: a recent miss OR an
  // all-time tally — so the "all time" board survives a quiet stretch.
  let live = moves.filter((m) => Object.keys(m.days).length > 0 || allTimeOf(m) > 0);

  // Cap: keep the moves that matter most, ranked by all-time then recent misses.
  if (live.length > MAX_MOVES) {
    live.sort((a, b) =>
      (allTimeOf(b) - allTimeOf(a)) || (recentTotal(b, keep) - recentTotal(a, keep)));
    live = live.slice(0, MAX_MOVES);
  }
  save(live);
}

export interface ForgottenMove {
  fen: string;
  san: string;
  colour: 'white' | 'black';
  count: number; // misses inside the chosen window
}

// Which slice of history a query looks at: just today, the last seven days, or
// everything ever recorded.
export type ForgottenWindow = 'day' | 'week' | 'all';

// How many misses an entry has inside the given window.
function windowCount(m: StoredMove, window: ForgottenWindow, now: Date): number {
  switch (window) {
    case 'day':  return recentTotal(m, cutoff(0, now)); // today only
    case 'week': return recentTotal(m, cutoff(6, now)); // today + previous 6 days
    case 'all':  return allTimeOf(m);
  }
}

// The single most-forgotten move inside a window, or null when nothing has been
// missed there. Ties resolve to the first seen — stable enough for one board.
export function mostForgotten(
  window: ForgottenWindow,
  now: Date = new Date(),
): ForgottenMove | null {
  return mostForgottenExcluding(window, new Set(), now);
}

// Like mostForgotten, but skips any move already claimed by an earlier window
// (keyed by fen+san). Used to fill the carousel with DISTINCT moves.
function mostForgottenExcluding(
  window: ForgottenWindow,
  used: Set<string>,
  now: Date,
): ForgottenMove | null {
  let best: ForgottenMove | null = null;
  for (const m of load()) {
    if (used.has(m.fen + ' ' + m.san)) continue;
    const count = windowCount(m, window, now);
    if (count > 0 && (!best || count > best.count)) {
      best = { fen: m.fen, san: m.san, colour: m.colour, count };
    }
  }
  return best;
}

// One move per window (Today / This week / All time) for the carousel, with no
// position repeated across windows: the same move is usually the worst in more
// than one window, so each window claims the top move not already shown by an
// earlier one. Windows with no distinct move left are simply dropped.
export function forgottenSlides(
  now: Date = new Date(),
): { window: ForgottenWindow; move: ForgottenMove }[] {
  const used = new Set<string>();
  const out: { window: ForgottenWindow; move: ForgottenMove }[] = [];
  for (const window of ['day', 'week', 'all'] as ForgottenWindow[]) {
    const move = mostForgottenExcluding(window, used, now);
    if (move) {
      used.add(move.fen + ' ' + move.san);
      out.push({ window, move });
    }
  }
  return out;
}

// Forget one move — called after a "Fix it" drill completes, so that move drops
// out of the carousel (every window) and the next-worst surfaces. It only comes
// back if it's missed again in training.
export function clearForgottenMove(fen: string, san: string): void {
  const moves = load().filter((m) => !(m.fen === fen && m.san === san));
  save(moves);
}

// Forget everything — part of "Reset progress" in Settings.
export function clearForgottenMoves(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — nothing to clear. */
  }
}
