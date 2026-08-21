// The daily challenge's own preferences — which tasks it includes and how many
// of each — on their own so they have TWO homes.
//
// They started life inside settings-screen.ts, which meant the only way to
// change the challenge was Settings → Daily challenge: a tab away, an accordion
// down, from a card sitting right there on Train with no way in. The rows are
// unchanged; what is new is that the card can open them itself.
//
// This module is deliberately below both of its callers in the import graph
// (it reaches daily-challenge.ts for the config and settings-controls.ts for the
// row chrome, and nothing that reaches back), so neither Settings nor the card
// has to import the other.

import {
  getDailyConfig,
  setDailyConfig,
  DAILY_TASK_IDS,
  DAILY_COUNT_RANGE,
  type DailyTaskId,
} from './daily-challenge';
import { row, segmented, toggle } from './settings-controls';
import { pushBack } from './back-nav';

// ── Daily challenge ──────────────────────────────────────────────────────────
// Turn the whole daily challenge on/off, and pick which tasks it includes and
// how many of each (default: all on, three each). Mirrors the card's task order.

const DAILY_TASK_LABEL: Record<DailyTaskId, string> = {
  lines: 'Lines to remember',
  positions: 'Positions to refresh',
  puzzles: 'Puzzles to solve',
  endgames: 'Endgame puzzles',
  mistakes: 'Mistakes to fix',
};

/**
 * The daily-challenge options, as plain rows in a host element. Settings puts
 * them in its accordion; the gear on the daily card itself puts the very same
 * rows in a sheet (openDailyPrefsSheet below) — which is the point of the
 * split. Options reachable only from a Settings screen two taps away are options
 * most people never find.
 *
 * `onChange` fires after any write, so a caller showing the card can repaint it.
 */
export function renderDailyPrefs(host: HTMLElement, onChange?: () => void): void {
  // Cheap to rebuild (a handful of rows), so any change re-renders in place —
  // the per-task rows hide when the challenge is off, and each row reads fresh
  // config so writes never clobber a sibling's change.
  const rebuild = (): void => {
    host.replaceChildren();
    const config = getDailyConfig();

    host.appendChild(row(
      'Show daily challenge',
      toggle(config.enabled, (on) => {
        const cur = getDailyConfig();
        setDailyConfig({ ...cur, enabled: on });
        rebuild();
        onChange?.();
      }),
      { sub: 'Pick your challenges and how many of each.' },
    ));

    if (!config.enabled) return;

    for (const id of DAILY_TASK_IDS) {
      host.appendChild(dailyTaskRow(id, () => { rebuild(); onChange?.(); }));
    }
  };
  rebuild();
}

/** The same rows as a bottom sheet — what the daily card's gear opens. */
export function openDailyPrefsSheet(onChange?: () => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet daily-prefs-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');

  const h = document.createElement('h3');
  h.className = 'edit-sheet-title';
  h.textContent = 'Daily challenge';
  sheet.appendChild(h);

  const body = document.createElement('div');
  body.className = 'daily-prefs-body';
  sheet.appendChild(body);
  // Every row writes as it is touched, so there is nothing to save or cancel —
  // and therefore exactly one button.
  renderDailyPrefs(body, onChange);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  };

  const btnRow = document.createElement('div');
  btnRow.className = 'dialog-btn-row';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'dialog-btn btn-primary';
  done.textContent = 'Done';
  done.addEventListener('click', close);
  btnRow.appendChild(done);
  sheet.appendChild(btnRow);

  const removeBack = pushBack(close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

// One task's row: a title, then an Off/1/2/3/Custom count picker — Off IS a
// count of zero, so there's no separate switch. Custom reveals a capped number
// field, so nobody can type 50 or 100 into it.
function dailyTaskRow(id: DailyTaskId, onChange: () => void): HTMLElement {
  const config = getDailyConfig();
  const task = config.tasks[id];
  const isCustom = task.count > DAILY_COUNT_RANGE.stepMax;

  const r = row(DAILY_TASK_LABEL[id], dailyCountControl(id, task.count, onChange));

  if (isCustom) r.appendChild(dailyCustomInput(id, task.count, onChange));

  return r;
}

// The Off/1/2/3/Custom segmented picker — five short labels, so it still fits
// one line on a phone (the 0-through-5-plus-Custom row it replaced didn't).
function dailyCountControl(id: DailyTaskId, count: number, onChange: () => void): HTMLElement {
  const options: { value: string; label: string }[] = [];
  for (let n = DAILY_COUNT_RANGE.min; n <= DAILY_COUNT_RANGE.stepMax; n++) {
    options.push({ value: String(n), label: n === 0 ? 'Off' : String(n) });
  }
  options.push({ value: 'custom', label: 'Custom' });

  const isCustom = count > DAILY_COUNT_RANGE.stepMax;
  const seg = segmented<string>(
    options,
    isCustom ? 'custom' : String(count),
    (v) => {
      const cur = getDailyConfig();
      const nextCount = v === 'custom'
        // Stepping into Custom keeps whatever custom value was already set;
        // otherwise it starts just past the preset row.
        ? Math.max(DAILY_COUNT_RANGE.stepMax + 1, cur.tasks[id].count)
        : Number(v);
      setDailyConfig({ ...cur, tasks: { ...cur.tasks, [id]: { count: nextCount } } });
      onChange(); // show/hide the custom field
    },
    // Full width, equal columns — five short labels that always fit one line,
    // rather than the natural sizing that made the old 0-through-5 row wrap.
    { fullWidth: true },
  );
  seg.classList.add('daily-count-seg');
  return seg;
}

// The capped custom-count field, shown only once "Custom" is picked.
function dailyCustomInput(id: DailyTaskId, count: number, onChange: () => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'daily-custom-count';

  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'numeric';
  input.className = 'daily-custom-input';
  input.min = String(DAILY_COUNT_RANGE.stepMax + 1);
  input.max = String(DAILY_COUNT_RANGE.max);
  input.value = String(count);
  input.addEventListener('change', () => {
    const clamped = Math.max(
      DAILY_COUNT_RANGE.stepMax + 1,
      Math.min(DAILY_COUNT_RANGE.max, Math.round(Number(input.value)) || DAILY_COUNT_RANGE.stepMax + 1),
    );
    input.value = String(clamped);
    const cur = getDailyConfig();
    setDailyConfig({ ...cur, tasks: { ...cur.tasks, [id]: { count: clamped } } });
    onChange();
  });
  wrap.appendChild(input);

  const suffix = document.createElement('span');
  suffix.className = 'daily-custom-suffix';
  suffix.textContent = `per day (max ${DAILY_COUNT_RANGE.max})`;
  wrap.appendChild(suffix);

  return wrap;
}
