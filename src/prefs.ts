// Small device-local training preferences, kept in localStorage (tiny, never
// synced). Mirrors the style of theme.ts / streak.ts.

const RETRIES_KEY = 'obertura.retriesBeforeReveal';
const NAMING_MODE_KEY = 'obertura.namingMode';
const WATCH_SPEED_KEY = 'obertura.watchSpeed';
const TIMED_BEST_KEY = 'obertura.timedBest';

export type Retries = 0 | 1 | 2;

// How a saved line gets its title. "auto" (default) fills the name from the
// bundled opening database with no popup; "manual" will open a name popup on
// save — wired into Settings in task 7.2. Stored now so the default is set.
export type NamingMode = 'auto' | 'manual';

export function getNamingMode(): NamingMode {
  return localStorage.getItem(NAMING_MODE_KEY) === 'manual' ? 'manual' : 'auto';
}

export function setNamingMode(mode: NamingMode): void {
  localStorage.setItem(NAMING_MODE_KEY, mode);
}

// How many extra attempts a wrong move gets before the correct-move arrow is
// drawn. 0 = reveal immediately, 1 (default) = one retry, 2 = two retries.
export function getRetriesBeforeReveal(): Retries {
  const raw = localStorage.getItem(RETRIES_KEY);
  if (raw === '0') return 0;
  if (raw === '2') return 2;
  return 1;
}

export function setRetriesBeforeReveal(n: Retries): void {
  localStorage.setItem(RETRIES_KEY, String(n));
}

// How fast "Watch line" auto-plays each move. "normal" is the 400 ms default;
// persisted here so the choice sticks (and is surfaced again in Settings, 7.2).
export type WatchSpeed = 'slow' | 'normal' | 'fast';

export function getWatchSpeed(): WatchSpeed {
  const raw = localStorage.getItem(WATCH_SPEED_KEY);
  if (raw === 'slow' || raw === 'fast') return raw;
  return 'normal';
}

export function setWatchSpeed(speed: WatchSpeed): void {
  localStorage.setItem(WATCH_SPEED_KEY, speed);
}

// Milliseconds between auto-played moves for each speed.
export function watchSpeedMs(speed: WatchSpeed = getWatchSpeed()): number {
  return speed === 'slow' ? 800 : speed === 'fast' ? 200 : 400;
}

// Personal best for timed mode — the most positions answered correctly in one
// countdown. Kept device-local like every other pref.
export function getTimedBest(): number {
  const n = Number(localStorage.getItem(TIMED_BEST_KEY));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// Store a new best if this score beats the old one. Returns true when it did.
export function recordTimedBest(score: number): boolean {
  if (score > getTimedBest()) {
    localStorage.setItem(TIMED_BEST_KEY, String(score));
    return true;
  }
  return false;
}
