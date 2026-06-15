// Small device-local training preferences, kept in localStorage (tiny, never
// synced). Mirrors the style of theme.ts / streak.ts.

const RETRIES_KEY = 'obertura.retriesBeforeReveal';
const WATCH_SPEED_KEY = 'obertura.watchSpeed';
const DEFAULT_MODE_KEY = 'obertura.defaultTrainingMode';
const CONFIRM_RUN_KEY = 'obertura.confirmRunBeforeTraining';

// Opt-in crash reporting (Sentry). OFF by default: when off, the Sentry SDK is
// never even loaded (see crash.ts), so nothing is sent. Turning it on lazily
// loads and initialises Sentry; turning it off shuts it down again, live.
const CRASH_REPORTS_KEY = 'obertura.crashReportsEnabled';

// Whether anonymous crash reports are sent. Default OFF (opt-in).
export function getCrashReportsEnabled(): boolean {
  return localStorage.getItem(CRASH_REPORTS_KEY) === 'on';
}

export function setCrashReportsEnabled(on: boolean): void {
  localStorage.setItem(CRASH_REPORTS_KEY, on ? 'on' : 'off');
}

// My Lines view options. Both default ON.
//   quick view   → the swipe-through board carousels at the top of My Lines.
//   miniatures   → the tiny position board on each saved-line / suggestion card.
const SHOW_QUICKVIEW_KEY = 'obertura.lines.showQuickView';
const SHOW_MINIATURES_KEY = 'obertura.lines.showMiniatures';

// The Train hub's line-list filters & sort now live in the shared filter bar
// (filters.ts), which persists its own selection under 'obertura.train.filter'.

// Whether the Train list reveals paused (out-of-training) lines, dimmed and with
// their switch off, so one flick re-enables them. Default ON (shown); the header
// toggle hides them.
const SHOW_PAUSED_KEY = 'obertura.train.showPaused';

export function getShowPausedLines(): boolean {
  return localStorage.getItem(SHOW_PAUSED_KEY) !== 'off';
}

export function setShowPausedLines(on: boolean): void {
  localStorage.setItem(SHOW_PAUSED_KEY, on ? 'on' : 'off');
}

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

// ── My Lines view options ────────────────────────────────────────────────────

// The quick-view carousels at the top of My Lines. ON by default; OFF hides them
// and the screen surfaces inline "add line" buttons instead.
export function getShowQuickView(): boolean {
  return localStorage.getItem(SHOW_QUICKVIEW_KEY) !== 'off';
}

export function setShowQuickView(on: boolean): void {
  localStorage.setItem(SHOW_QUICKVIEW_KEY, on ? 'on' : 'off');
}

// The tiny position board on each saved-line and suggestion card. ON by default.
export function getShowLineMiniatures(): boolean {
  return localStorage.getItem(SHOW_MINIATURES_KEY) !== 'off';
}

export function setShowLineMiniatures(on: boolean): void {
  localStorage.setItem(SHOW_MINIATURES_KEY, on ? 'on' : 'off');
}

// ── Statistics screen sections ───────────────────────────────────────────────
//
// Two device-local toggles that hide whole sections of the Statistics screen,
// plus the 28-day activity grid's remembered open/closed state. The streak and
// activity sections both default ON; the grid itself defaults COLLAPSED.
const SHOW_STREAK_KEY = 'obertura.stats.showStreak';
const SHOW_ACTIVITY_KEY = 'obertura.stats.showActivity';
const ACTIVITY_EXPANDED_KEY = 'obertura.stats.activityExpanded';

// Whether the streak hero (big streak + 7-day strip) shows on Statistics. The
// Train-header streak pill is separate and unaffected by this.
export function getShowStreakSection(): boolean {
  return localStorage.getItem(SHOW_STREAK_KEY) !== 'off';
}

export function setShowStreakSection(on: boolean): void {
  localStorage.setItem(SHOW_STREAK_KEY, on ? 'on' : 'off');
}

// Whether the Training Activity section shows on Statistics at all.
export function getShowActivitySection(): boolean {
  return localStorage.getItem(SHOW_ACTIVITY_KEY) !== 'off';
}

export function setShowActivitySection(on: boolean): void {
  localStorage.setItem(SHOW_ACTIVITY_KEY, on ? 'on' : 'off');
}

// The 28-day grid starts collapsed; we remember each open/close toggle.
export function getActivityExpanded(): boolean {
  return localStorage.getItem(ACTIVITY_EXPANDED_KEY) === 'on';
}

export function setActivityExpanded(on: boolean): void {
  localStorage.setItem(ACTIVITY_EXPANDED_KEY, on ? 'on' : 'off');
}

// Saved lines always auto-name themselves from the bundled opening database on
// save (no popup). The pencil in the builder's title row is the override: a
// manual rename is stored on the line itself and wins over the auto name. There
// is no naming-mode preference — auto is the single, hard-coded behaviour.

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
