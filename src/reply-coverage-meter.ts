// The small coverage meter at the top of "Add a missing reply".
//
// It's the reward for saving: the same element stays in place from card to card, so the
// bar moves when a line goes in. The number itself is in reply-coverage.ts.

import { COVERAGE_MOVES } from './reply-coverage';
import { currentCoverage } from './next-reply-data';
import type { StatsAt } from './rare-branch';

export interface CoverageMeter {
  el: HTMLElement;
  /** The statistics have arrived, so the real figures can be worked out. */
  setStats: (statsAt: StatsAt) => void;
  refresh: () => void;
}

export type CoverageFigures = Record<'white' | 'black', number | null>;

const COLOURS = ['white', 'black'] as const;
const NAMES = { white: 'White', black: 'Black' };

/** Starts from the figures it showed last time; `onChange` keeps them for next time. */
export function buildCoverageMeter(
  initial: CoverageFigures | null,
  onChange: (figures: CoverageFigures) => void,
): CoverageMeter {
  let statsAt: StatsAt | null = null;
  const el = document.createElement('div');
  el.className = 'nr-cov';
  el.hidden = true;

  const title = document.createElement('p');
  title.className = 'nr-cov-title';
  title.textContent = `Covered, first ${COVERAGE_MOVES} moves`;
  el.appendChild(title);

  const cells = document.createElement('div');
  cells.className = 'nr-cov-cells';
  el.appendChild(cells);

  const shown = new Map<'white' | 'black', { fill: HTMLElement; value: HTMLElement; pct: number }>();

  const cellFor = (colour: 'white' | 'black'): { fill: HTMLElement; value: HTMLElement; pct: number } => {
    const existing = shown.get(colour);
    if (existing) return existing;
    const cell = document.createElement('div');
    cell.className = 'nr-cov-cell';
    const name = document.createElement('span');
    name.className = 'nr-cov-name';
    name.textContent = NAMES[colour];
    const track = document.createElement('div');
    track.className = 'nr-meter';
    const fill = document.createElement('div');
    fill.className = 'nr-meter-fill';
    fill.style.width = '0%';
    track.appendChild(fill);
    const value = document.createElement('span');
    value.className = 'nr-cov-value';
    cell.append(name, track, value);
    cells.appendChild(cell);
    const made = { fill, value, pct: -1 };
    shown.set(colour, made);
    return made;
  };

  const paint = (now: CoverageFigures): void => {
    for (const colour of COLOURS) {
      const pct = now[colour];
      if (pct === null) {
        shown.get(colour)?.fill.closest('.nr-cov-cell')?.remove();
        shown.delete(colour);
        continue;
      }
      const cell = cellFor(colour);
      const rose = cell.pct >= 0 && pct > cell.pct;
      cell.pct = pct;
      cell.value.textContent = `${pct}%`;
      cell.fill.style.width = `${pct}%`;
      cell.value.classList.remove('nr-cov-value--rose');
      if (rose) {
        // Restart the highlight if two saves come close together.
        void cell.value.offsetWidth;
        cell.value.classList.add('nr-cov-value--rose');
      }
    }
    el.hidden = shown.size === 0;
  };

  const refresh = (): void => {
    if (!statsAt) return;
    void currentCoverage(statsAt).then((now) => {
      paint(now);
      onChange(now);
    }).catch(() => { /* the meter is a bonus: the board works without it */ });
  };

  if (initial) paint(initial);
  return {
    el,
    setStats(next) {
      statsAt = next;
      refresh();
    },
    refresh,
  };
}
