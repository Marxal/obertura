// The daily challenge — the dynamic card at the top of the Train screen. A few
// bite-sized tasks for today: remember some lines, refresh some positions, solve
// some rated puzzles and (once games have been scanned) fix a few of your own
// mistakes. When everything's done the card shrinks to a quiet "done for today"
// state. State is device-local (localStorage), reset each calendar day,
// mirroring streak.ts.

import type { Line } from './types';
import { dueLines, recentlyAddedLines, weakestLines } from './scheduler';
import { currentStreak } from './streak';
import { recordDailyTask, type TaskOutcome } from './daily-recap';
import { Icons } from './icons';

export type { TaskOutcome } from './daily-recap';

// Default per-task goals (used when the user hasn't customised the daily config).
export const DAILY_LINE_GOAL = 3;
export const DAILY_PUZZLE_GOAL = 3;
export const DAILY_POSITION_GOAL = 3;
export const DAILY_ENDGAME_GOAL = 3;
export const DAILY_MISTAKE_GOAL = 3;

const KEY = 'obertura.dailyChallenge';
const CONFIG_KEY = 'obertura.dailyChallenge.config';

// The five daily tasks, in the order they appear on the card — the "Next task →"
// chain follows this same order.
export type DailyTaskId = 'lines' | 'positions' | 'puzzles' | 'endgames' | 'mistakes';
export const DAILY_TASK_IDS: DailyTaskId[] = ['lines', 'positions', 'puzzles', 'endgames', 'mistakes'];

export interface DailyState {
  day: string;        // "YYYY-MM-DD" local
  lines: boolean;     // the lines task is done
  positions: boolean; // the positions task is done
  puzzles: boolean;   // the puzzles task is done
  endgames: boolean;  // the endgame-puzzles task is done
  mistakes: boolean;  // the mistake-retry task is done (only offered when
                      // scanned spots exist — see renderDailyChallenge)
}

// ── Config (Preferences) ──────────────────────────────────────────────────────
// Which tasks the daily challenge includes and how many of each. Device-local,
// like the done-state. Default: every task on, three each.

const DEFAULT_COUNT = 3;
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

function clampCount(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_COUNT;
  return Math.max(COUNT_MIN, Math.min(COUNT_CUSTOM_MAX, v));
}

function defaultConfig(): DailyConfig {
  const tasks = {} as Record<DailyTaskId, DailyTaskConfig>;
  for (const id of DAILY_TASK_IDS) tasks[id] = { count: DEFAULT_COUNT };
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
        base.tasks[id] = { count: t.on === false ? 0 : clampCount(t.count) };
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
    day: todayKey(), lines: false, positions: false, puzzles: false, endgames: false, mistakes: false,
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const obj = JSON.parse(raw) as Partial<DailyState>;
    // A new day wipes the slate — yesterday's done state never carries over.
    if (obj.day !== fresh.day) return fresh;
    // !! also covers state saved before a task existed (endgames, mistakes).
    return {
      day: fresh.day,
      lines: !!obj.lines,
      positions: !!obj.positions,
      puzzles: !!obj.puzzles,
      endgames: !!obj.endgames,
      mistakes: !!obj.mistakes,
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

// ── Which tasks are active, and the next one ──────────────────────────────────

export interface DailyAvailability {
  hasLines: boolean;           // any in-training lines (lines + positions need these)
  mistakesAvailable: boolean;  // the mistake scan has found spots
}

// The active tasks, in card order: switched on in the config AND actually
// runnable (lines/positions need a repertoire; mistakes needs scanned spots).
export function activeDailyTasks(config: DailyConfig, avail: DailyAvailability): DailyTaskId[] {
  return DAILY_TASK_IDS.filter((id) => {
    if (config.tasks[id].count <= 0) return false;
    if ((id === 'lines' || id === 'positions') && !avail.hasLines) return false;
    if (id === 'mistakes' && !avail.mistakesAvailable) return false;
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

export function perfectDayEligible(config: DailyConfig, active: DailyTaskId[]): boolean {
  if (active.length < PERFECT_MIN_TASKS) return false;
  return active.every((id) => config.tasks[id].count >= PERFECT_MIN_COUNT);
}

// ── The next-task chain ───────────────────────────────────────────────────────
// A finished daily task's success screen offers "Next task →"; this names the
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
  onTrainLines: (lines: Line[]) => void;
  onRefreshPositions: () => void;
  onSolvePuzzles: () => void;
  // Solve today's few rated endgame puzzles.
  onSolveEndgames: () => void;
  // How many mistake-retry spots the scan has found (for the card note only).
  mistakeSpotCount: number;
  onFixMistakes: () => void;
}

// Each task's card face: an icon and a label that folds in the configured count.
const TASK_META: Record<DailyTaskId, { icon: () => SVGElement; label: (n: number) => string }> = {
  lines:     { icon: () => Icons.tree(18),        label: (n) => `${n} line${n === 1 ? '' : 's'} to remember` },
  positions: { icon: () => Icons.target(18),      label: (n) => `${n} position${n === 1 ? '' : 's'} to refresh` },
  puzzles:   { icon: () => Icons.puzzlePiece(18), label: (n) => `${n} puzzle${n === 1 ? '' : 's'} to solve` },
  endgames:  { icon: () => Icons.flag(18),        label: (n) => `${n} endgame puzzle${n === 1 ? '' : 's'}` },
  mistakes:  { icon: () => Icons.reset(18),       label: (n) => `${n} mistake${n === 1 ? '' : 's'} to fix` },
};

function runDailyTask(id: DailyTaskId, deps: DailyChallengeDeps): void {
  switch (id) {
    case 'lines': deps.onTrainLines(deps.lines); break;
    case 'positions': deps.onRefreshPositions(); break;
    case 'puzzles': deps.onSolvePuzzles(); break;
    case 'endgames': deps.onSolveEndgames(); break;
    case 'mistakes': deps.onFixMistakes(); break;
  }
}

// Build the daily-challenge card. Returns null when it's switched off, nothing is
// active, or there's no repertoire yet (the lines/positions tasks need one — this
// keeps first-run onboarding clean).
export function renderDailyChallenge(deps: DailyChallengeDeps): HTMLElement | null {
  const { config, active } = deps;
  if (!config.enabled || active.length === 0 || deps.lines.length === 0) return null;

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
    const msg = document.createElement('div');
    msg.className = 'daily-card-done-msg';
    msg.textContent = 'Daily challenge done — keep training ✓';
    card.appendChild(msg);
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
  note.textContent = active.includes('mistakes')
    ? 'Lines, puzzles and your own mistakes, picked for you.'
    : 'A daily mix of lines, puzzles and endgames, picked for you.';
  card.appendChild(note);

  return card;
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
