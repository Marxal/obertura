// The daily challenge — the dynamic card at the top of the Train screen. A few
// bite-sized bits of work for today: remember some lines, refresh some
// positions, solve some rated puzzles and (once games have been scanned) fix a
// few of your own mistakes. When everything's done the card shrinks to a quiet
// "done for today" state. State is device-local (localStorage), reset each
// calendar day, mirroring streak.ts.
//
// BEFORE THE UNLOCK it has a third face. Under TRAINING_UNLOCK_LINES saved lines
// there is nothing to have a daily challenge about — two of its parts need
// a repertoire — so it does not run. It used to vanish entirely, which meant the
// single habit the whole app is built around was invisible until you had already
// done the work that turns it on. So it INTRODUCES itself instead: the same
// card, the same rows, greyed out, under a bar counting toward three lines. It
// rides below the Get-started checklist, because "how do I get lines" is the
// question that has to be answered first.
//
// The word is CHALLENGE, not task: one challenge a day, made of several parts.
// "Task" reads like a chore list and made the completion popup ("every task
// cleared") sound like an inbox.

import type { Line } from './types';
import { dueLines, recentlyAddedLines, weakestLines } from './scheduler';
import { currentStreak } from './streak';
import { recordDailyTask, type TaskOutcome } from './daily-recap';
import { TRAINING_UNLOCK_LINES } from './training-goal';
import { Icons } from './icons';

export type { TaskOutcome } from './daily-recap';

// Default per-task goals (used when the user hasn't customised the daily config).
export const DAILY_LINE_GOAL = 3;
export const DAILY_PUZZLE_GOAL = 3;
export const DAILY_POSITION_GOAL = 3;
export const DAILY_ENDGAME_GOAL = 3;
// Three of these was a lot of blank-board searching for one sitting, and it is
// now one of THREE "from your games" parts rather than the only one — so two
// each of the searching kind and three of the quick two-move kind.
export const DAILY_MISTAKE_GOAL = 2;
// One case is four to six moves to read plus the answer — a whole exercise, not
// an item. Three of them would be the longest part of the day by far.
export const DAILY_DETECTIVE_GOAL = 1;
export const DAILY_BETTER_GOAL = 3;

const KEY = 'obertura.dailyChallenge';
const CONFIG_KEY = 'obertura.dailyChallenge.config';

// The parts of the daily challenge, in the order they appear on the card — the
// "Next challenge →" chain follows this same order. The last three all come from
// your own games, so they sit together at the end: repertoire work first, then
// puzzles, then yourself.
export type DailyTaskId =
  | 'lines' | 'positions' | 'puzzles' | 'endgames'
  | 'mistakes' | 'detective' | 'better';
export const DAILY_TASK_IDS: DailyTaskId[] = [
  'lines', 'positions', 'puzzles', 'endgames', 'mistakes', 'detective', 'better',
];

export interface DailyState {
  day: string;        // "YYYY-MM-DD" local
  lines: boolean;     // the lines task is done
  positions: boolean; // the positions task is done
  puzzles: boolean;   // the puzzles task is done
  endgames: boolean;  // the endgame-puzzles task is done
  mistakes: boolean;  // the mistake-retry task is done (only offered when
                      // scanned spots exist — see renderDailyChallenge)
  detective: boolean; // the blunder-detective task is done (needs a scanned run)
  better: boolean;    // the better-or-blunder task is done (needs scanned spots)
}

// ── Config (Preferences) ──────────────────────────────────────────────────────
// Which tasks the daily challenge includes and how many of each. Device-local,
// like the done-state. Default: every task on, three each.

const DEFAULT_COUNT = 3;

// What each part ships with. Most are three; the two that aren't are the two
// newest ones, and both for the same reason — the size of one "item" differs
// wildly between parts. A detective case is a whole exercise; a better-or-
// blunder question is ten seconds.
const DEFAULT_COUNTS: Record<DailyTaskId, number> = {
  lines: DAILY_LINE_GOAL,
  positions: DAILY_POSITION_GOAL,
  puzzles: DAILY_PUZZLE_GOAL,
  endgames: DAILY_ENDGAME_GOAL,
  mistakes: DAILY_MISTAKE_GOAL,
  detective: DAILY_DETECTIVE_GOAL,
  better: DAILY_BETTER_GOAL,
};

/** What a part ships with — also the floor the perfect-day bar holds it to. */
export function defaultDailyCount(id: DailyTaskId): number {
  return DEFAULT_COUNTS[id];
}

const COUNT_MIN = 0;
// The last preset button before "Custom" — Off/1/2/3 as one-tap picks. Kept
// short so the row fits one line on a phone; anything past it is Custom.
const COUNT_STEP_MAX = 3;
// A custom count is still capped, so nobody can type 50 or 100 into the field.
const COUNT_CUSTOM_MAX = 20;
export const DAILY_COUNT_RANGE = {
  min: COUNT_MIN,
  stepMax: COUNT_STEP_MAX,
  max: COUNT_CUSTOM_MAX,
  default: DEFAULT_COUNT,
};

// A task is included in the day's challenge whenever its count is above zero —
// there's no separate on/off switch, 0 IS off.
export interface DailyTaskConfig { count: number; }
export interface DailyConfig {
  enabled: boolean;
  tasks: Record<DailyTaskId, DailyTaskConfig>;
}

function clampCount(n: unknown, fallback = DEFAULT_COUNT): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.max(COUNT_MIN, Math.min(COUNT_CUSTOM_MAX, v));
}

function defaultConfig(): DailyConfig {
  const tasks = {} as Record<DailyTaskId, DailyTaskConfig>;
  for (const id of DAILY_TASK_IDS) tasks[id] = { count: DEFAULT_COUNTS[id] };
  return { enabled: true, tasks };
}

export function getDailyConfig(): DailyConfig {
  const base = defaultConfig();
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return base;
    const obj = JSON.parse(raw) as {
      enabled?: boolean;
      tasks?: Record<string, { on?: boolean; count?: number }>;
    };
    for (const id of DAILY_TASK_IDS) {
      const t = obj.tasks?.[id];
      if (t) {
        // Back-compat with the old on/off switch: an explicit "off" now means
        // a count of zero, whatever count was stored alongside it.
        base.tasks[id] = { count: t.on === false ? 0 : clampCount(t.count, DEFAULT_COUNTS[id]) };
      }
    }
    return { enabled: obj.enabled !== false, tasks: base.tasks };
  } catch {
    return base;
  }
}

export function setDailyConfig(config: DailyConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    /* storage unavailable — the daily config is a nicety, never block on it. */
  }
}

// ── Done-state (resets each calendar day) ─────────────────────────────────────

function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function load(): DailyState {
  const fresh: DailyState = {
    day: todayKey(),
    lines: false, positions: false, puzzles: false, endgames: false,
    mistakes: false, detective: false, better: false,
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const obj = JSON.parse(raw) as Partial<DailyState>;
    // A new day wipes the slate — yesterday's done state never carries over.
    if (obj.day !== fresh.day) return fresh;
    // !! also covers state saved before a task existed (endgames, mistakes,
    // and now the two detective-flavoured ones).
    return {
      day: fresh.day,
      lines: !!obj.lines,
      positions: !!obj.positions,
      puzzles: !!obj.puzzles,
      endgames: !!obj.endgames,
      mistakes: !!obj.mistakes,
      detective: !!obj.detective,
      better: !!obj.better,
    };
  } catch {
    return fresh;
  }
}

function save(state: DailyState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — the daily card is a nicety, never block on it. */
  }
}

export function getDaily(): DailyState {
  return load();
}

// Tick a task off for today and file how it went (right/wrong) in the recap log,
// which is what the completion popup compares against yesterday.
function markDone(id: DailyTaskId, outcome: TaskOutcome): void {
  const s = load();
  const first = !s[id];
  s[id] = true;
  save(s);
  // Only the first clearing of a task counts — replaying it later in the day
  // shouldn't inflate (or dent) the day's figures.
  if (first) recordDailyTask(id, outcome);
}

export function markLinesDone(o: TaskOutcome): void { markDone('lines', o); }
export function markPositionsDone(o: TaskOutcome): void { markDone('positions', o); }
export function markPuzzlesDone(o: TaskOutcome): void { markDone('puzzles', o); }
export function markEndgamesDone(o: TaskOutcome): void { markDone('endgames', o); }
export function markMistakesDone(o: TaskOutcome): void { markDone('mistakes', o); }
export function markDetectiveDone(o: TaskOutcome): void { markDone('detective', o); }
export function markBetterDone(o: TaskOutcome): void { markDone('better', o); }

// ── Which tasks are active, and the next one ──────────────────────────────────

export interface DailyAvailability {
  hasLines: boolean;            // any in-training lines (lines + positions need these)
  mistakesAvailable: boolean;   // the mistake scan has found spots
  detectiveAvailable: boolean;  // the scan has found a "find the blunder" run
  betterAvailable: boolean;     // …and spots that make a fair two-move question
}

// The active tasks, in card order: switched on in the config AND actually
// runnable (lines/positions need a repertoire; the three from-your-games parts
// each need their own kind of scanned material).
export function activeDailyTasks(config: DailyConfig, avail: DailyAvailability): DailyTaskId[] {
  return DAILY_TASK_IDS.filter((id) => {
    if (config.tasks[id].count <= 0) return false;
    if ((id === 'lines' || id === 'positions') && !avail.hasLines) return false;
    if (id === 'mistakes' && !avail.mistakesAvailable) return false;
    if (id === 'detective' && !avail.detectiveAvailable) return false;
    if (id === 'better' && !avail.betterAvailable) return false;
    return true;
  });
}

// Whether every active task is done.
export function isDailyDone(config: DailyConfig, avail: DailyAvailability): boolean {
  const s = load();
  return activeDailyTasks(config, avail).every((id) => s[id]);
}

// ── The perfect-day bar ───────────────────────────────────────────────────────
//
// A day with NOT ONE move wrong earns its own (rare, deliberately surprising)
// celebration — see daily-celebration.ts. It only counts when the day was worth
// winning: at least three tasks switched on, none of them set to a single item.
// Someone running one task of one puzzle can still have a clean day; they just
// don't get the fanfare.

export const PERFECT_MIN_TASKS = 3;
export const PERFECT_MIN_COUNT = 2;

// The floor a part has to clear: two, or its own default where that is lower.
// Blunder detective ships at one because one case IS the exercise — holding the
// whole day to "two of everything" would have made a perfect day impossible for
// anyone running the defaults, which is exactly the wrong incentive.
function perfectFloor(id: DailyTaskId): number {
  return Math.min(PERFECT_MIN_COUNT, DEFAULT_COUNTS[id]);
}

export function perfectDayEligible(config: DailyConfig, active: DailyTaskId[]): boolean {
  if (active.length < PERFECT_MIN_TASKS) return false;
  return active.every((id) => config.tasks[id].count >= perfectFloor(id));
}

// ── The next-task chain ───────────────────────────────────────────────────────
// A finished part's success screen offers "Next challenge →"; this names the
// task it should jump to. Pure (active list passed in) so it's self-testable;
// the list is already in card order.

export function nextDailyTask(
  state: Pick<DailyState, DailyTaskId>,
  active: DailyTaskId[],
): DailyTaskId | null {
  for (const id of active) if (!state[id]) return id;
  return null;
}

// Today's three lines: due ones first, then topped up with the newest and then the
// weakest in-training lines until we reach the goal (de-duplicated). Returns fewer
// than the goal only when the repertoire is small.
export function pickDailyLines(allLines: Line[], goal = DAILY_LINE_GOAL): Line[] {
  const training = allLines.filter((l) => l.inTraining);
  const picked: Line[] = [];
  const seen = new Set<string>();
  const add = (ls: Line[]): void => {
    for (const l of ls) {
      if (picked.length >= goal) break;
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      picked.push(l);
    }
  };
  add(dueLines(training));
  add(recentlyAddedLines(training));
  add(weakestLines(training));
  return picked;
}

export interface DailyChallengeDeps {
  config: DailyConfig;
  active: DailyTaskId[];
  // The lines to drill for today's lines task (already picked), or [] when none.
  lines: Line[];
  // How many lines are SAVED. Under TRAINING_UNLOCK_LINES the card renders its
  // locked, introducing face instead of running (see renderDailyChallenge).
  savedLineCount: number;
  onTrainLines: (lines: Line[]) => void;
  onRefreshPositions: () => void;
  onSolvePuzzles: () => void;
  // Solve today's few rated endgame puzzles.
  onSolveEndgames: () => void;
  // How many mistake-retry spots the scan has found (for the card note only).
  mistakeSpotCount: number;
  onFixMistakes: () => void;
  // The two newer from-your-games parts: catch the blunder in a short run, and
  // pick the better of two moves.
  onCatchBlunders: () => void;
  onBetterOrBlunder: () => void;
  // Reopen today's completion popup from the "done" card. Omitted where there is
  // nothing to reopen.
  onReplayRecap?: () => void;
  // The locked card's one way out, offered ONLY when nothing else on screen is
  // (the Get-started panel above it carries the same routes and says them
  // louder, so two of them would be one too many).
  onBuildLine?: () => void;
  // Open the challenge's own preferences (daily-prefs.ts). Passed in rather than
  // imported: daily-prefs reads this module's config, so reaching back for its
  // sheet would be a cycle. Omit and the gear simply isn't drawn.
  onOpenPrefs?: () => void;
}

// Each task's card face: an icon and a label that folds in the configured count.
const TASK_META: Record<DailyTaskId, { icon: () => SVGElement; label: (n: number) => string }> = {
  lines:     { icon: () => Icons.tree(18),        label: (n) => `${n} line${n === 1 ? '' : 's'} to remember` },
  positions: { icon: () => Icons.target(18),      label: (n) => `${n} position${n === 1 ? '' : 's'} to refresh` },
  puzzles:   { icon: () => Icons.puzzlePiece(18), label: (n) => `${n} puzzle${n === 1 ? '' : 's'} to solve` },
  endgames:  { icon: () => Icons.flag(18),        label: (n) => `${n} endgame puzzle${n === 1 ? '' : 's'}` },
  mistakes:  { icon: () => Icons.reset(18),       label: (n) => `${n} mistake${n === 1 ? '' : 's'} to fix` },
  detective: { icon: () => Icons.scout(18),       label: (n) => `${n} blunder${n === 1 ? '' : 's'} to catch` },
  better:    { icon: () => Icons.merge(18),       label: (n) => `${n} better move${n === 1 ? '' : 's'} to pick` },
};

// The gear, bottom-right of the card. Which tasks the challenge includes and how
// many of each used to be reachable only from Settings → Daily challenge — a tab
// away and an accordion down from the card those settings describe, which is a
// good way to own settings nobody ever finds. It is small and quiet on purpose:
// the card is for doing today's work, not configuring it.
function buildPrefsButton(onOpen: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'daily-card-prefs';
  btn.setAttribute('aria-label', 'Daily challenge preferences');
  btn.appendChild(Icons.settings(16));
  btn.addEventListener('click', (e) => { e.stopPropagation(); onOpen(); });
  return btn;
}

// The card's last row: whatever note the face carries on the left, the gear on
// the right. A face with no note still gets the row, so the gear is always in
// the same corner.
function buildFoot(note: HTMLElement | null, onOpenPrefs?: () => void): HTMLElement | null {
  if (!note && !onOpenPrefs) return null;
  const foot = document.createElement('div');
  foot.className = 'daily-card-foot';
  if (note) foot.appendChild(note);
  if (onOpenPrefs) foot.appendChild(buildPrefsButton(onOpenPrefs));
  return foot;
}

function runDailyTask(id: DailyTaskId, deps: DailyChallengeDeps): void {
  switch (id) {
    case 'lines': deps.onTrainLines(deps.lines); break;
    case 'positions': deps.onRefreshPositions(); break;
    case 'puzzles': deps.onSolvePuzzles(); break;
    case 'endgames': deps.onSolveEndgames(); break;
    case 'mistakes': deps.onFixMistakes(); break;
    case 'detective': deps.onCatchBlunders(); break;
    case 'better': deps.onBetterOrBlunder(); break;
  }
}

/**
 * Is the daily challenge locked — fewer than TRAINING_UNLOCK_LINES lines saved?
 *
 * Exported so the caller can put the card in the right PLACE without building it
 * first: locked, it rides under the Get-started checklist; unlocked, it leads.
 */
export function dailyChallengeLocked(savedLineCount: number): boolean {
  return savedLineCount < TRAINING_UNLOCK_LINES;
}

// Build the daily-challenge card. Returns null only when the whole thing is
// switched off in Preferences, or when nothing at all is configured — with a
// repertoire too small to run it the card still comes back, in its locked face.
export function renderDailyChallenge(deps: DailyChallengeDeps): HTMLElement | null {
  const { config, active } = deps;
  if (!config.enabled) return null;
  if (dailyChallengeLocked(deps.savedLineCount)) return buildLockedCard(deps);
  if (active.length === 0 || deps.lines.length === 0) return null;

  const state = getDaily();
  const done = active.every((id) => state[id]);

  const card = document.createElement('div');
  card.className = 'card daily-card' + (done ? ' daily-card--done' : '');

  const head = document.createElement('div');
  head.className = 'daily-card-head';
  const title = document.createElement('span');
  title.className = 'daily-card-title';
  title.textContent = 'Daily challenge';
  head.appendChild(title);
  head.appendChild(buildStreakPill());
  card.appendChild(head);

  if (done) {
    // The whole line is the button: the completion popup carries the day's
    // figures, and losing it to a stray tap used to mean losing them until
    // tomorrow. It reads as a button (chevron, pressable) so nobody has to
    // discover it.
    const msg = deps.onReplayRecap
      ? document.createElement('button')
      : document.createElement('div');
    msg.className = 'daily-card-done-msg';
    if (msg instanceof HTMLButtonElement) {
      msg.type = 'button';
      msg.classList.add('daily-card-done-msg--tap');
      msg.setAttribute('aria-label', 'Daily challenge done — see today’s results');
      msg.addEventListener('click', deps.onReplayRecap!);
    }
    const label = document.createElement('span');
    label.textContent = 'Daily challenge done — keep training ✓';
    msg.appendChild(label);
    if (msg instanceof HTMLButtonElement) {
      const chev = Icons.chevronRight(15);
      chev.classList.add('daily-card-done-chev');
      msg.appendChild(chev);
    }
    card.appendChild(msg);
    const doneFoot = buildFoot(null, deps.onOpenPrefs);
    if (doneFoot) card.appendChild(doneFoot);
    return card;
  }

  const tasks = document.createElement('div');
  tasks.className = 'daily-card-tasks';
  for (const id of active) {
    const meta = TASK_META[id];
    tasks.appendChild(buildTask({
      icon: meta.icon(),
      label: meta.label(config.tasks[id].count),
      done: state[id],
      onClick: () => runDailyTask(id, deps),
    }));
  }
  card.appendChild(tasks);

  const note = document.createElement('div');
  note.className = 'daily-card-note';
  const fromYourGames = active.some(id => id === 'mistakes' || id === 'detective' || id === 'better');
  note.textContent = fromYourGames
    ? 'Lines, puzzles and your own mistakes, picked for you.'
    : 'A daily mix of lines, puzzles and endgames, picked for you.';
  card.appendChild(buildFoot(note, deps.onOpenPrefs) ?? note);

  return card;
}

// ── The locked card ──────────────────────────────────────────────────────────
//
// Same card, same rows, nothing tappable: what the daily challenge WILL be, once
// there are three lines to run it on. The rows are the real configured ones
// (minus the two that need data nobody has on day one), so the preview is not a
// mock-up of a feature — it is the feature, greyed.

// The rows the preview shows: everything switched on in Preferences except the
// three from-your-games parts, which need imported, scanned games and would
// promise something a new install can't deliver.
const GAME_FED: DailyTaskId[] = ['mistakes', 'detective', 'better'];

function previewTasks(config: DailyConfig): DailyTaskId[] {
  return DAILY_TASK_IDS.filter((id) => !GAME_FED.includes(id) && config.tasks[id].count > 0);
}

function buildLockedCard(deps: DailyChallengeDeps): HTMLElement | null {
  const { config } = deps;
  const preview = previewTasks(config);
  if (preview.length === 0) return null;

  const saved = Math.max(0, deps.savedLineCount);
  const left = Math.max(0, TRAINING_UNLOCK_LINES - saved);

  const card = document.createElement('div');
  card.className = 'card daily-card daily-card--locked';

  const head = document.createElement('div');
  head.className = 'daily-card-head';
  const title = document.createElement('span');
  title.className = 'daily-card-title';
  title.textContent = 'Daily challenge';
  head.appendChild(title);

  const lock = document.createElement('span');
  lock.className = 'daily-lock-pill';
  lock.appendChild(Icons.lock(13));
  const lockLabel = document.createElement('span');
  lockLabel.textContent = `${saved} / ${TRAINING_UNLOCK_LINES} lines`;
  lock.appendChild(lockLabel);
  head.appendChild(lock);
  card.appendChild(head);

  const blurb = document.createElement('p');
  blurb.className = 'daily-locked-blurb';
  blurb.textContent =
    'A few minutes a day, picked for you — this is the habit the whole app is '
    + 'built around, and it starts as soon as you have something to train.';
  card.appendChild(blurb);

  card.appendChild(buildGoalBar(saved));

  const tasks = document.createElement('div');
  tasks.className = 'daily-card-tasks';
  for (const id of preview) {
    const meta = TASK_META[id];
    tasks.appendChild(buildLockedTask(meta.icon(), meta.label(config.tasks[id].count)));
  }
  card.appendChild(tasks);

  const note = document.createElement('div');
  note.className = 'daily-card-note';
  note.textContent = saved === 0
    ? `Save ${TRAINING_UNLOCK_LINES} lines and your first challenge is waiting tomorrow.`
    : left === 1
      ? 'One more line and this starts.'
      : `${left} more lines and this starts.`;
  card.appendChild(buildFoot(note, deps.onOpenPrefs) ?? note);

  // Only where nothing else on screen offers the route — see DailyChallengeDeps.
  if (deps.onBuildLine) {
    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'btn-secondary daily-locked-cta';
    cta.textContent = saved === 0 ? 'Build your first line' : 'Build another line';
    cta.addEventListener('click', deps.onBuildLine);
    card.appendChild(cta);
  }

  return card;
}

// The three-line goal as a bar — the same figure the Get-started panel counts,
// so the two never disagree about how far along you are.
function buildGoalBar(saved: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'daily-goal';

  const track = document.createElement('span');
  track.className = 'daily-goal-track';
  const fill = document.createElement('span');
  fill.className = 'daily-goal-fill';
  const pct = Math.min(100, (Math.min(saved, TRAINING_UNLOCK_LINES) / TRAINING_UNLOCK_LINES) * 100);
  fill.style.width = `${pct}%`;
  track.appendChild(fill);
  wrap.appendChild(track);

  wrap.setAttribute('role', 'progressbar');
  wrap.setAttribute('aria-valuemin', '0');
  wrap.setAttribute('aria-valuemax', String(TRAINING_UNLOCK_LINES));
  wrap.setAttribute('aria-valuenow', String(Math.min(saved, TRAINING_UNLOCK_LINES)));
  wrap.setAttribute('aria-label', `${saved} of ${TRAINING_UNLOCK_LINES} lines saved`);
  return wrap;
}

// A preview row: the real icon and label, dimmed, and inert. Not a <button> —
// there is nothing behind it, and a button that does nothing is worse than a
// line of text.
function buildLockedTask(icon: SVGElement, label: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'daily-task daily-task--locked';

  const iconWrap = document.createElement('span');
  iconWrap.className = 'daily-task-icon';
  iconWrap.appendChild(icon);
  row.appendChild(iconWrap);

  const text = document.createElement('span');
  text.className = 'daily-task-label';
  text.textContent = label;
  row.appendChild(text);
  return row;
}

function buildTask(o: { icon: SVGElement; label: string; done: boolean; onClick: () => void }): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'daily-task' + (o.done ? ' daily-task--done' : '');

  const icon = document.createElement('span');
  icon.className = 'daily-task-icon';
  icon.appendChild(o.done ? Icons.checkCircle(18) : o.icon);
  btn.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'daily-task-label';
  label.textContent = o.label;
  btn.appendChild(label);

  if (o.done) {
    btn.disabled = true;
    btn.setAttribute('aria-label', `${o.label} — done`);
  } else {
    btn.addEventListener('click', o.onClick);
  }
  return btn;
}

function buildStreakPill(): HTMLElement {
  const streak = currentStreak();
  const pill = document.createElement('span');
  pill.className = 'streak-pill' + (streak === 0 ? ' streak-pill--cold' : '');

  const flame = document.createElement('span');
  flame.className = 'streak-pill-flame';
  flame.setAttribute('aria-hidden', 'true');
  flame.textContent = '🔥';
  pill.appendChild(flame);

  const label = document.createElement('span');
  label.className = 'streak-pill-label';
  label.textContent = streak === 0 ? 'No streak yet' : `${streak}-day streak`;
  pill.appendChild(label);

  return pill;
}
