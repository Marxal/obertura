// The daily challenge — the dynamic card at the top of the Train screen. Two
// bite-sized tasks for today: remember a few lines and solve a few rated puzzles.
// When both are done the card shrinks to a quiet "done for today" state. State is
// device-local (localStorage), reset each calendar day, mirroring streak.ts.

import type { Line } from './types';
import { dueLines, recentlyAddedLines, weakestLines } from './scheduler';
import { currentStreak } from './streak';
import { Icons } from './icons';

export const DAILY_LINE_GOAL = 3;
export const DAILY_PUZZLE_GOAL = 3;
export const DAILY_POSITION_GOAL = 3;

const KEY = 'obertura.dailyChallenge';

interface DailyState {
  day: string;        // "YYYY-MM-DD" local
  lines: boolean;     // the lines third is done
  puzzles: boolean;   // the puzzles third is done
  positions: boolean; // the positions third is done
}

function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function load(): DailyState {
  const fresh: DailyState = { day: todayKey(), lines: false, puzzles: false, positions: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const obj = JSON.parse(raw) as Partial<DailyState>;
    // A new day wipes the slate — yesterday's done state never carries over.
    if (obj.day !== fresh.day) return fresh;
    return { day: fresh.day, lines: !!obj.lines, puzzles: !!obj.puzzles, positions: !!obj.positions };
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

export function markLinesDone(): void {
  const s = load();
  s.lines = true;
  save(s);
}

export function markPuzzlesDone(): void {
  const s = load();
  s.puzzles = true;
  save(s);
}

export function markPositionsDone(): void {
  const s = load();
  s.positions = true;
  save(s);
}

export function isDailyDone(): boolean {
  const s = load();
  return s.lines && s.puzzles && s.positions;
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
  // The lines to drill for today's lines third (already picked), or [] when none.
  lines: Line[];
  onTrainLines: (lines: Line[]) => void;
  onSolvePuzzles: () => void;
  // Drill today's few individual positions to refresh (due moves, not whole lines).
  onRefreshPositions: () => void;
}

// Build the daily-challenge card. Returns null when there's nothing to offer (no
// lines in training yet) so the caller can simply skip it.
export function renderDailyChallenge(deps: DailyChallengeDeps): HTMLElement | null {
  if (deps.lines.length === 0) return null;

  const state = getDaily();
  const done = state.lines && state.puzzles && state.positions;

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

  tasks.appendChild(buildTask({
    icon: Icons.tree(18),
    label: `${DAILY_LINE_GOAL} lines to remember`,
    done: state.lines,
    onClick: () => deps.onTrainLines(deps.lines),
  }));
  tasks.appendChild(buildTask({
    icon: Icons.target(18),
    label: `${DAILY_POSITION_GOAL} positions to refresh`,
    done: state.positions,
    onClick: () => deps.onRefreshPositions(),
  }));
  tasks.appendChild(buildTask({
    icon: Icons.puzzlePiece(18),
    label: `${DAILY_PUZZLE_GOAL} puzzles to solve`,
    done: state.puzzles,
    onClick: () => deps.onSolvePuzzles(),
  }));
  card.appendChild(tasks);

  const note = document.createElement('div');
  note.className = 'daily-card-note';
  note.textContent = 'A few lines and rated puzzles, picked for you.';
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
