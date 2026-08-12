// The two blocks at the foot of the Line info tab: how often this line should
// come round, and how it has actually been going.
//
// WHY PRIORITY IS A CONTROL AND NOT A GUESS. The scheduler knows how well you
// remember a move; it has no way of knowing how much that move MATTERS. The
// main line you get in half your games and a sideline kept for completeness
// look identical to SM-2 — same ease, same ladder, same rotation. Priority is
// the one thing only the user can supply, so it's one control with three
// settings and a plain sentence under it saying what each does to the schedule.
// (The mechanics live in scheduler.ts's PRIORITY_SPACING; it multiplies the
// WAIT between reviews, not the stored interval, so it can't compound.)
//
// WHY THE STATS ARE HERE AND NOT ONLY IN STATISTICS. The Statistics screen
// answers "how is my repertoire doing?" — it ranks lines against each other.
// Standing on one line, the question is narrower and the answer was two screens
// away: has this line ever come up in a real game, do I actually remember it,
// and which move keeps breaking? Those four numbers are built from the same
// stats module the global screen uses, so they can never disagree with it.

import type { Line, LinePriority } from './types';
import type { ImportedGame } from './import-core';
import { PRIORITY_SPACING, linePriority, nextDue, describeDue } from './scheduler';
import {
  moveMemory, needsWorkMoves, lineTrainingCount, lineReviewCount,
  type NeedsWorkMove,
} from './stats';
import { countGamesPerLine } from './analysis';
import { Icons } from './icons';

// How many "most failed" moves the block lists before it stops. Three is enough
// to see a pattern and short enough that the block stays a footnote to the line
// rather than a screen of its own.
const TOP_FAILED = 3;

export interface LinePriorityOpts {
  priority: LinePriority;
  onChange: (p: LinePriority) => void;
}

const PRIORITY_COPY: Record<LinePriority, { label: string; blurb: string }> = {
  high: {
    label: 'High',
    blurb: 'Comes round about 40% sooner than usual. For the lines you actually get.',
  },
  standard: {
    label: 'Standard',
    blurb: 'The normal spaced-repetition schedule.',
  },
  low: {
    label: 'Low',
    blurb: 'Comes round about 70% later than usual. For sidelines you keep but rarely face.',
  },
};

export function renderLinePriority(host: HTMLElement, opts: LinePriorityOpts): void {
  host.replaceChildren();

  const head = document.createElement('div');
  head.className = 'lineinfo-head';
  head.appendChild(spanEl('lineinfo-head-title', 'Training priority'));
  host.appendChild(head);

  const row = document.createElement('div');
  row.className = 'lprio-row';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Training priority');

  const blurb = document.createElement('p');
  blurb.className = 'lprio-blurb';

  const order: LinePriority[] = ['high', 'standard', 'low'];
  const buttons = new Map<LinePriority, HTMLButtonElement>();

  const reflect = (p: LinePriority): void => {
    for (const [key, btn] of buttons) {
      const on = key === p;
      btn.classList.toggle('lprio-btn--on', on);
      btn.setAttribute('aria-pressed', String(on));
    }
    blurb.textContent = PRIORITY_COPY[p].blurb;
  };

  for (const p of order) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `lprio-btn lprio-btn--${p}`;
    btn.textContent = PRIORITY_COPY[p].label;
    // Say the actual effect in the accessible name — "High" alone doesn't tell
    // anyone what changes.
    btn.setAttribute('aria-label', `${PRIORITY_COPY[p].label} priority. ${PRIORITY_COPY[p].blurb}`);
    btn.addEventListener('click', () => {
      if (btn.classList.contains('lprio-btn--on')) return;
      reflect(p);
      opts.onChange(p);
    });
    buttons.set(p, btn);
    row.appendChild(btn);
  }

  host.appendChild(row);
  host.appendChild(blurb);
  reflect(opts.priority);
}

export interface LineStatsOpts {
  line: Line;
  games: ImportedGame[];
  // Tapping a failed move jumps the board to the position before it, which is
  // the only useful thing to do with "you keep getting this wrong".
  onGoToMove?: (move: NeedsWorkMove) => void;
}

export function renderLineStats(host: HTMLElement, opts: LineStatsOpts): void {
  const { line, games } = opts;
  host.replaceChildren();

  const memory = moveMemory([line]);
  const runs = lineTrainingCount(line);
  const reviews = lineReviewCount(line);
  const faced = countGamesPerLine(games, [line]).get(line.id) ?? 0;
  const failed = needsWorkMoves([line], TOP_FAILED);

  const head = document.createElement('div');
  head.className = 'lineinfo-head';
  head.appendChild(spanEl('lineinfo-head-title', 'How this line is going'));
  const due = describeDue(nextDue(line));
  head.appendChild(spanEl('lineinfo-head-meta',
    line.inTraining ? due : 'Not in training'));
  host.appendChild(head);

  // Four numbers, in the same boxes the Statistics screen uses so a figure means
  // the same thing in both places.
  const row = document.createElement('div');
  row.className = 'stats-quick-row lineinfo-quick';
  row.appendChild(statBox('faced', Icons.grid2x2(18), String(faced), 'Faced in games'));
  row.appendChild(statBox('recall', Icons.brain(18),
    memory.recallPct === null ? '—' : `${memory.recallPct}%`, 'Recalled'));
  row.appendChild(statBox('runs', Icons.reset(18), String(runs), 'Full runs'));
  row.appendChild(statBox('reviews', Icons.zap(18), String(reviews), 'Reviews'));
  host.appendChild(row);

  // The honest caveat: a recall figure built from nothing is not a figure.
  const covered = document.createElement('p');
  covered.className = 'lineinfo-note';
  covered.textContent = memory.trained === 0
    ? `None of this line’s ${memory.total} move${memory.total === 1 ? '' : 's'} has been drilled yet.`
    : `${memory.solid} of ${memory.trained} drilled move${memory.trained === 1 ? '' : 's'} remembered at the last attempt`
      + (memory.trained < memory.total ? ` · ${memory.total - memory.trained} still untouched` : '');
  host.appendChild(covered);

  // ── Where it breaks ──
  const failHead = document.createElement('div');
  failHead.className = 'lineinfo-head';
  failHead.appendChild(spanEl('lineinfo-head-title', 'Where it breaks'));
  host.appendChild(failHead);

  if (!failed.length) {
    const none = document.createElement('p');
    none.className = 'lineinfo-note';
    none.textContent = memory.trained === 0
      ? 'Nothing to report until the line has been trained.'
      : 'No missed moves in this line — it is holding up.';
    host.appendChild(none);
    return;
  }

  const list = document.createElement('div');
  list.className = 'lineinfo-fails';
  for (const m of failed) {
    const rowEl = document.createElement(opts.onGoToMove ? 'button' : 'div');
    rowEl.className = 'lineinfo-fail';
    if (opts.onGoToMove) {
      (rowEl as HTMLButtonElement).type = 'button';
      rowEl.addEventListener('click', () => opts.onGoToMove!(m));
    }
    rowEl.appendChild(spanEl('lineinfo-fail-move', `${m.moveNumber}. ${m.san}`));
    const rate = m.attempts > 0 ? Math.round((100 * m.lapses) / m.attempts) : 0;
    rowEl.appendChild(spanEl('lineinfo-fail-detail',
      `missed ${m.lapses}× of ${m.attempts}${m.attempts ? ` · ${rate}%` : ''}`));
    // Is it recovering? A move on a clean streak is a different problem from one
    // that just broke again.
    rowEl.appendChild(spanEl(
      `lineinfo-fail-state lineinfo-fail-state--${m.reps > 0 ? 'ok' : 'shaky'}`,
      m.reps > 0 ? `${m.reps} clean` : 'shaky',
    ));
    list.appendChild(rowEl);
  }
  host.appendChild(list);
}

// ── small helpers ────────────────────────────────────────────────────────────

function statBox(kind: string, icon: SVGElement, value: string, label: string): HTMLElement {
  const cell = document.createElement('div');
  cell.className = `stats-quick-cell stats-quick-cell--${kind}`;

  const num = document.createElement('span');
  num.className = 'stats-quick-num';
  num.textContent = value;
  cell.appendChild(num);

  const iconWrap = document.createElement('span');
  iconWrap.className = 'stats-quick-icon';
  iconWrap.appendChild(icon);
  cell.appendChild(iconWrap);

  const lbl = document.createElement('span');
  lbl.className = 'stats-quick-label';
  lbl.textContent = label;
  cell.appendChild(lbl);
  return cell;
}

function spanEl(cls: string, s: string): HTMLElement {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = s;
  return el;
}

// Re-exported so main.ts can read a line's effective priority without also
// importing the scheduler for one call.
export { linePriority, PRIORITY_SPACING };
