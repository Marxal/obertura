// Small device-local training preferences, kept in localStorage (tiny, never
// synced). Mirrors the style of theme.ts / streak.ts.

import { parseBand, type ExplorerBand } from './explorer-bands';

const RETRIES_KEY = 'obertura.retriesBeforeReveal';
const WATCH_SPEED_KEY = 'obertura.watchSpeed';
const DEFAULT_MODE_KEY = 'obertura.defaultTrainingMode';
const CONFIRM_RUN_KEY = 'obertura.confirmRunBeforeTraining';

// My Lines view options.
//   miniatures   → the tiny position board on each saved-line / suggestion card
//                  ("Board miniatures" in Settings). ON by default.
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

// The builder walkthrough (onboarding-tour.ts) — the coach-marks that name the
// board, the tabs and Save while the first line is being built. It's a separate
// flag from the onboarding gate above because the tour also fronts a pack line
// opened months later, on a device where onboarding is long finished.
const TOUR_SEEN_KEY = 'obertura.builderTourSeen';

export function isBuilderTourSeen(): boolean {
  try { return localStorage.getItem(TOUR_SEEN_KEY) === '1'; } catch { return true; }
}

export function setBuilderTourSeen(): void {
  try { localStorage.setItem(TOUR_SEEN_KEY, '1'); } catch { /* storage off */ }
}

// Backing out of the walkthrough's first bubble puts the user back on the
// first-run screen, where picking a line has to bring the walkthrough with it —
// so the flag it set on the way in is cleared on the way out.
export function clearBuilderTourSeen(): void {
  try { localStorage.removeItem(TOUR_SEEN_KEY); } catch { /* storage off */ }
}

// SEEN is not the same as DONE. The flag above is set the moment the walkthrough
// opens, so it can't run twice in one sitting; this one is set only when the
// user reaches its last bubble. Someone who skipped on their first visit and
// came back later has seen it and not done it — which is exactly the person the
// walkthrough is for, so the first-run flow offers it again (see
// isBuilderTourOwed) rather than deciding they've had their turn.
const TOUR_DONE_KEY = 'obertura.builderTourDone';

export function isBuilderTourDone(): boolean {
  try { return localStorage.getItem(TOUR_DONE_KEY) === '1'; } catch { return true; }
}

export function setBuilderTourDone(): void {
  try { localStorage.setItem(TOUR_DONE_KEY, '1'); } catch { /* storage off */ }
}

// ── My Lines view options ────────────────────────────────────────────────────

// The tiny position board on each saved-line and suggestion card. ON by default.
export function getShowLineMiniatures(): boolean {
  return localStorage.getItem(SHOW_MINIATURES_KEY) !== 'off';
}

export function setShowLineMiniatures(on: boolean): void {
  localStorage.setItem(SHOW_MINIATURES_KEY, on ? 'on' : 'off');
}

// Whether the engine draws arrows on the board for its top 3 suggested moves.
// ON by default; the icon toggle next to the source badge in the docked eval bar
// can switch it off if the arrows get in the way.
const SHOW_ENGINE_ARROWS_KEY = 'obertura.builder.showEngineArrows';

export function getShowEngineArrows(): boolean {
  return localStorage.getItem(SHOW_ENGINE_ARROWS_KEY) !== 'off';
}

export function setShowEngineArrows(on: boolean): void {
  localStorage.setItem(SHOW_ENGINE_ARROWS_KEY, on ? 'on' : 'off');
}

// Settings → Appearance: "Engine always on". When on, the engine starts running
// every time the board (builder/analyser) opens; the board's engine button still
// switches it on or off at any moment — this only sets how it STARTS. OFF by
// default: the engine keeps the worker (and battery) busy, so it's an opt-in.
// (Key kept from the old "engine everywhere" toggle, to preserve saved state.)
const ENGINE_EVERYWHERE_KEY = 'obertura.builder.engineEverywhere';

export function getEngineAlwaysOn(): boolean {
  return localStorage.getItem(ENGINE_EVERYWHERE_KEY) === 'on';
}

export function setEngineAlwaysOn(on: boolean): void {
  localStorage.setItem(ENGINE_EVERYWHERE_KEY, on ? 'on' : 'off');
}

// Settings → Appearance: "Deeper reviews online". When on, game reviews send
// positions the Lichess cloud doesn't know to chess-api.com (a free public
// Stockfish service) instead of straight to the slower on-device engine —
// deeper (depth 18 vs 12) and much faster on a phone. OFF by default: it ships
// positions from your games to a third-party service, so it's an explicit
// opt-in; when the service can't answer, reviews fall back to the device as
// before.
const REMOTE_ENGINE_KEY = 'obertura.remoteEngine';

export function getUseRemoteEngine(): boolean {
  return localStorage.getItem(REMOTE_ENGINE_KEY) === 'on';
}

export function setUseRemoteEngine(on: boolean): void {
  localStorage.setItem(REMOTE_ENGINE_KEY, on ? 'on' : 'off');
}

// The old "show move classifications" switch is gone — Game-Review grades (the
// per-move colour in the move list and the badge on the board) always show now.

// ── Statistics screen ────────────────────────────────────────────────────────
//
// The range selector's remembered choice plus the monthly calendar's remembered
// open/closed state. (The old show-streak / show-activity switches are gone —
// the Statistics screen always shows every section now.)
const STATS_RANGE_KEY = 'obertura.stats.range';
const CALENDAR_EXPANDED_KEY = 'obertura.stats.calendarExpanded';

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
// The builder's Explore slide: play the opponent's reply automatically after
// every move of mine, so building a line is only ever my own decisions. OFF by
// default — it moves pieces on the board on its own, which nobody should meet
// without having asked for it.
const AUTO_REPLY_KEY = 'obertura.builder.autoReply';

export function getAutoReply(): boolean {
  return localStorage.getItem(AUTO_REPLY_KEY) === 'on';
}

export function setAutoReply(on: boolean): void {
  localStorage.setItem(AUTO_REPLY_KEY, on ? 'on' : 'off');
}

//   'masters'  → over-the-board games between strong titled players.
const EXPLORER_DB_KEY = 'obertura.explorerDb';

export function getExplorerDb(): 'masters' | 'lichess' {
  return localStorage.getItem(EXPLORER_DB_KEY) === 'masters' ? 'masters' : 'lichess';
}

export function setExplorerDb(db: 'masters' | 'lichess'): void {
  localStorage.setItem(EXPLORER_DB_KEY, db);
}

// Which rating band those stats are filtered to (explorer-bands.ts maps it onto
// the API's fixed buckets).
//
// NULL MEANS "NEVER CHOSEN", and that is not the same as "All ratings". An
// explicit 'all' is the user saying they want the whole database; null lets the
// app infer a band from their own rating and SAY SO (explorer-level.ts's
// activeBand). Someone who never touches the control and has no rating we can
// read gets null → 'all' → exactly the request the app has always sent.
const EXPLORER_BAND_KEY = 'obertura.explorerBand';

export function getExplorerBand(): ExplorerBand | null {
  return parseBand(localStorage.getItem(EXPLORER_BAND_KEY));
}

// Passing null forgets the choice, handing the band back to inference.
export function setExplorerBand(band: ExplorerBand | null): void {
  if (band === null) localStorage.removeItem(EXPLORER_BAND_KEY);
  else localStorage.setItem(EXPLORER_BAND_KEY, band);
}

// A rating the user typed in Settings, for "Around my level" when we have
// nothing to infer from — no imported games and no Lichess account. Kept as a
// plain number; null when unset.
const EXPLORER_LEVEL_KEY = 'obertura.explorerManualLevel';

export function getManualLevel(): number | null {
  const n = Number(localStorage.getItem(EXPLORER_LEVEL_KEY));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function setManualLevel(rating: number | null): void {
  if (rating === null) localStorage.removeItem(EXPLORER_LEVEL_KEY);
  else localStorage.setItem(EXPLORER_LEVEL_KEY, String(Math.round(rating)));
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
