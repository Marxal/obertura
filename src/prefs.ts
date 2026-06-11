// Small device-local training preferences, kept in localStorage (tiny, never
// synced). Mirrors the style of theme.ts / streak.ts.

const RETRIES_KEY = 'obertura.retriesBeforeReveal';
const NAMING_MODE_KEY = 'obertura.namingMode';
const WATCH_SPEED_KEY = 'obertura.watchSpeed';
const DEFAULT_MODE_KEY = 'obertura.defaultTrainingMode';
const CONFIRM_RUN_KEY = 'obertura.confirmRunBeforeTraining';

// The Train hub's line-list filters & sort. Device-local like every other pref,
// so what you were looking at survives a reload.
const TRAIN_COLOUR_KEY = 'obertura.train.filterColour';
const TRAIN_STATUS_KEY = 'obertura.train.filterStatus';
const TRAIN_SORT_KEY = 'obertura.train.sort';
// The opponent filter: 'all' (default) or a "vs <name>" tag string.
const TRAIN_OPPONENT_KEY = 'obertura.train.filterOpponent';

// Timed personal bests are kept per duration ("obertura.timedBest.3" etc.).
const TIMED_BEST_PREFIX = 'obertura.timedBest.';
// The pre-split single best lived here; migrated to the 3-minute slot on first
// read (the old timed mode was always a 3-minute run).
const LEGACY_TIMED_BEST_KEY = 'obertura.timedBest';

export type Retries = 0 | 1 | 2;

// Which session the Home screen's "Start training" launches, and the option the
// Train screen leads with. Mirrors the practice picker:
//   "due"     → the scheduled spaced-repetition queue (default)
//   "recent"  → newest lines first
//   "weakest" → the lines you miss most, hardest first
export type TrainingMode = 'due' | 'recent' | 'weakest';

export function getDefaultTrainingMode(): TrainingMode {
  const v = localStorage.getItem(DEFAULT_MODE_KEY);
  return v === 'recent' || v === 'weakest' ? v : 'due';
}

export function setDefaultTrainingMode(mode: TrainingMode): void {
  localStorage.setItem(DEFAULT_MODE_KEY, mode);
}

// Whether adding a line to training first requires one clean "confirm run".
// Default ON: the run double-checks the line plays as expected before it joins
// the schedule. OFF: a line is enrolled instantly, with no run.
export function getConfirmRunBeforeTraining(): boolean {
  return localStorage.getItem(CONFIRM_RUN_KEY) !== 'false';
}

export function setConfirmRunBeforeTraining(on: boolean): void {
  localStorage.setItem(CONFIRM_RUN_KEY, String(on));
}

// ── Train hub line-list view (filters + sort) ───────────────────────────────────
//
// Three small choices that shape the "In training" list. Each is read with a
// safe fallback so a stray/old value can never wedge the screen.

export type TrainColourFilter = 'all' | 'white' | 'black';
export type TrainStatusFilter = 'all' | 'due' | 'learning' | 'solid';
export type TrainSort = 'weakest' | 'oldest' | 'newest' | 'name';

export function getTrainColourFilter(): TrainColourFilter {
  const v = localStorage.getItem(TRAIN_COLOUR_KEY);
  return v === 'white' || v === 'black' ? v : 'all';
}

export function setTrainColourFilter(v: TrainColourFilter): void {
  localStorage.setItem(TRAIN_COLOUR_KEY, v);
}

export function getTrainStatusFilter(): TrainStatusFilter {
  const v = localStorage.getItem(TRAIN_STATUS_KEY);
  return v === 'due' || v === 'learning' || v === 'solid' ? v : 'all';
}

export function setTrainStatusFilter(v: TrainStatusFilter): void {
  localStorage.setItem(TRAIN_STATUS_KEY, v);
}

export function getTrainSort(): TrainSort {
  const v = localStorage.getItem(TRAIN_SORT_KEY);
  return v === 'oldest' || v === 'newest' || v === 'name' ? v : 'weakest';
}

export function setTrainSort(v: TrainSort): void {
  localStorage.setItem(TRAIN_SORT_KEY, v);
}

// The opponent filter: 'all' for no filter, otherwise a "vs <name>" tag. A stale
// tag (opponent prep since deleted) is harmless — the list just shows nothing,
// and the filter row reverts to All on the next render.
export function getTrainOpponentFilter(): string {
  return localStorage.getItem(TRAIN_OPPONENT_KEY) ?? 'all';
}

export function setTrainOpponentFilter(v: string): void {
  localStorage.setItem(TRAIN_OPPONENT_KEY, v);
}

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

// The three timed-run lengths, in minutes. Each keeps its own personal best.
export type TimedMinutes = 1 | 3 | 5;
export const TIMED_DURATIONS: readonly TimedMinutes[] = [1, 3, 5];

function timedBestKey(minutes: TimedMinutes): string {
  return TIMED_BEST_PREFIX + minutes;
}

// One-time move of the old single best into the 3-minute slot, so an existing
// record survives the split. Runs on first best access; harmless afterwards.
function migrateLegacyTimedBest(): void {
  const legacy = localStorage.getItem(LEGACY_TIMED_BEST_KEY);
  if (legacy === null) return;
  const key = timedBestKey(3);
  if (localStorage.getItem(key) === null) localStorage.setItem(key, legacy);
  localStorage.removeItem(LEGACY_TIMED_BEST_KEY);
}

// Personal best for a timed run — the most positions answered correctly in one
// countdown of this length. Kept device-local like every other pref.
export function getTimedBest(minutes: TimedMinutes): number {
  migrateLegacyTimedBest();
  const n = Number(localStorage.getItem(timedBestKey(minutes)));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// Store a new best for this duration if it beats the old one. Returns true then.
export function recordTimedBest(minutes: TimedMinutes, score: number): boolean {
  if (score > getTimedBest(minutes)) {
    localStorage.setItem(timedBestKey(minutes), String(score));
    return true;
  }
  return false;
}

// Forget every timed personal best — part of "Reset progress" in Settings.
export function clearTimedBest(): void {
  for (const m of TIMED_DURATIONS) localStorage.removeItem(timedBestKey(m));
  localStorage.removeItem(LEGACY_TIMED_BEST_KEY);
}
