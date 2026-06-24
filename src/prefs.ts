// Small device-local training preferences, kept in localStorage (tiny, never
// synced). Mirrors the style of theme.ts / streak.ts.

const RETRIES_KEY = 'obertura.retriesBeforeReveal';
const WATCH_SPEED_KEY = 'obertura.watchSpeed';
const DEFAULT_MODE_KEY = 'obertura.defaultTrainingMode';
const CONFIRM_RUN_KEY = 'obertura.confirmRunBeforeTraining';

// My Lines view options.
//   quick view   → the swipe-through board carousels at the top of My Lines.
//                  OFF by default (a focused list beats carousels for most).
//   miniatures   → the tiny position board on each saved-line / suggestion card.
//                  ON by default.
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

// First-run onboarding gate. The Train screen shows the "build your first lines"
// flow (not the hub) until the user has the goal number of lines in training;
// once they've ever reached it we flip this flag so they're never sent back to
// onboarding again, even if they later pause lines below the goal.
const ONBOARDING_DONE_KEY = 'obertura.onboardingComplete';

export function isOnboardingComplete(): boolean {
  return localStorage.getItem(ONBOARDING_DONE_KEY) === '1';
}

export function setOnboardingComplete(): void {
  localStorage.setItem(ONBOARDING_DONE_KEY, '1');
}

// ── My Lines view options ────────────────────────────────────────────────────

// The quick-view carousels at the top of My Lines. OFF by default; ON shows the
// swipe-through board rows. When off, the screen surfaces inline "add line"
// buttons instead.
export function getShowQuickView(): boolean {
  return localStorage.getItem(SHOW_QUICKVIEW_KEY) === 'on';
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

// Whether the builder's Engine tab draws arrows on the board for its top 3
// suggested moves. ON by default; the discrete toggle next to the source
// badge can switch it off if the arrows get in the way.
const SHOW_ENGINE_ARROWS_KEY = 'obertura.builder.showEngineArrows';

export function getShowEngineArrows(): boolean {
  return localStorage.getItem(SHOW_ENGINE_ARROWS_KEY) !== 'off';
}

export function setShowEngineArrows(on: boolean): void {
  localStorage.setItem(SHOW_ENGINE_ARROWS_KEY, on ? 'on' : 'off');
}

// ── Statistics screen sections ───────────────────────────────────────────────
//
// Two device-local toggles that hide whole sections of the Statistics screen,
// plus the 28-day activity grid's remembered open/closed state. The streak and
// activity sections both default ON; the grid itself defaults COLLAPSED.
const SHOW_STREAK_KEY = 'obertura.stats.showStreak';
const SHOW_ACTIVITY_KEY = 'obertura.stats.showActivity';
const STATS_RANGE_KEY = 'obertura.stats.range';
const CALENDAR_EXPANDED_KEY = 'obertura.stats.calendarExpanded';

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

// The Statistics → Training time selector (Week / Month / All). Drives the
// remembered-vs-failed bar's range; the last choice is remembered across visits.
// Any stale value (e.g. the earlier "today") falls back to the week default.
export type StatsRange = 'week' | 'month' | 'all';

export function getStatsRange(): StatsRange {
  const v = localStorage.getItem(STATS_RANGE_KEY);
  return v === 'month' || v === 'all' ? v : 'week';
}

export function setStatsRange(range: StatsRange): void {
  localStorage.setItem(STATS_RANGE_KEY, range);
}

// The "Times trained this month" calendar rides inside the streak hero as a
// collapsible row; we remember each open/close so it stays how the user left it.
// Default collapsed.
export function getCalendarExpanded(): boolean {
  return localStorage.getItem(CALENDAR_EXPANDED_KEY) === 'on';
}

export function setCalendarExpanded(on: boolean): void {
  localStorage.setItem(CALENDAR_EXPANDED_KEY, on ? 'on' : 'off');
}

// ── Explore / scouting ───────────────────────────────────────────────────────

// Whether opponent scouting is available at all. Default ON. When off, the
// Scout-opponents section disappears from Explore and the Scouting tab is
// removed from the board builder's carousel. Scouted opponents stay in storage,
// so turning it back on restores everything.
const SCOUTING_KEY = 'obertura.scoutingEnabled';

export function getScoutingEnabled(): boolean {
  return localStorage.getItem(SCOUTING_KEY) !== 'off';
}

export function setScoutingEnabled(on: boolean): void {
  localStorage.setItem(SCOUTING_KEY, on ? 'on' : 'off');
}

// A discreet opt-in: surface your *other* platform (the one you're not currently
// connected with) in the Add-your-games card, so you can pull games from both
// Chess.com and Lichess into one library without retyping. Default OFF — most
// people use a single site. The merging itself is done by the Replace/Add prompt
// on import; this only makes the second platform reachable.
const SECOND_PLATFORM_KEY = 'obertura.includeSecondPlatform';

export function getIncludeSecondPlatform(): boolean {
  return localStorage.getItem(SECOND_PLATFORM_KEY) === 'on';
}

export function setIncludeSecondPlatform(on: boolean): void {
  localStorage.setItem(SECOND_PLATFORM_KEY, on ? 'on' : 'off');
}

// Which Lichess opening-explorer database the builder's Library slide shows its
// real-game stats from. Both are free and anonymous (no login):
//   'lichess'  → every rated Lichess game (default; the biggest sample).
//   'masters'  → over-the-board games between strong titled players.
const EXPLORER_DB_KEY = 'obertura.explorerDb';

export function getExplorerDb(): 'masters' | 'lichess' {
  return localStorage.getItem(EXPLORER_DB_KEY) === 'masters' ? 'masters' : 'lichess';
}

export function setExplorerDb(db: 'masters' | 'lichess'): void {
  localStorage.setItem(EXPLORER_DB_KEY, db);
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
