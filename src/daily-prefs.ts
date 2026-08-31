// The daily challenge's own preferences — which parts it includes, how many of
// each, and WHAT ORDER they come in — on their own so they have TWO homes.
//
// They started life inside settings-screen.ts, which meant the only way to
// change the challenge was Settings → Daily challenge: a tab away, an accordion
// down, from a card sitting right there on Train with no way in. The rows are
// unchanged; what is new is that the card can open them itself.
//
// THE ORDER IS A PREFERENCE, NOT A CONSTANT. The parts used to run in the order
// this file happened to list them, which quietly decided what you do first every
// single day — and the first thing is the thing that actually gets done. So each
// row carries a pair of move buttons, and "Shuffle each day" hands the whole
// decision to chance for anyone who would rather not be able to predict it.
//
// This module is deliberately below both of its callers in the import graph
// (it reaches daily-challenge.ts for the config and settings-controls.ts for the
// row chrome, and nothing that reaches back), so neither Settings nor the card
// has to import the other.

import {
  getDailyConfig,
  setDailyConfig,
  orderedDailyTasks,
  normaliseOrder,
  DAILY_COUNT_RANGE,
  dailyCountCeiling,
  DEFAULT_DAILY_ORDER,
  type DailyConfig,
  type DailyTaskId,
} from './daily-challenge';
import { row, segmented, toggle } from './settings-controls';
import { pushBack } from './back-nav';
import { Icons } from './icons';

// ── Daily challenge ──────────────────────────────────────────────────────────
// Turn the whole daily challenge on/off, pick which parts it includes, how many
// of each, and the order they run in.

// The same words the card uses, so the row you drag is recognisably the row you
// see on Train. (Not literally shared with TASK_META, which folds the count into
// its label — "3 lines to remember" is a card face, not a settings label.)
const DAILY_TASK_LABEL: Record<DailyTaskId, string> = {
  lines: 'Lines to remember',
  positions: 'Positions to refresh',
  growLines: 'Lines to grow',
  puzzles: 'Puzzles to solve',
  endgames: 'Endgame puzzles',
  mistakes: 'Mistakes to fix',
  detective: 'Blunders to catch',
  whichMove: 'Moves to pick',
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
    const again = (): void => { rebuild(); onChange?.(); };

    host.appendChild(row(
      'Show daily challenge',
      toggle(config.enabled, (on) => {
        write({ ...getDailyConfig(), enabled: on });
        again();
      }),
      { sub: 'Pick your challenges, how many of each, and the order they run in.' },
    ));

    if (!config.enabled) return;

    host.appendChild(row(
      'Shuffle each day',
      toggle(config.randomOrder, (on) => {
        write({ ...getDailyConfig(), randomOrder: on });
        again();
      }),
      {
        sub: 'A different order every day, picked for you. It settles once per day, '
          + 'so the challenge never rearranges itself while you are working through it.',
      },
    ));

    // The order the rows will actually run in today — so the list you are
    // looking at is the list you will meet, shuffle or no shuffle.
    const order = orderedDailyTasks(config);
    const list = document.createElement('div');
    list.className = 'daily-order-list';
    order.forEach((id, i) => {
      list.appendChild(dailyTaskRow(config, id, i, order, again));
    });
    host.appendChild(list);

    // Only worth offering once the order has actually been changed.
    if (!config.randomOrder && !sameOrder(config.order, DEFAULT_DAILY_ORDER)) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'daily-order-reset';
      reset.textContent = 'Reset to the default order';
      reset.addEventListener('click', () => {
        write({ ...getDailyConfig(), order: [...DEFAULT_DAILY_ORDER] });
        again();
      });
      host.appendChild(reset);
    }
  };
  rebuild();
}

function write(config: DailyConfig): void {
  setDailyConfig(config);
}

function sameOrder(a: DailyTaskId[], b: DailyTaskId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
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

// One task's row: its place in the running order, its title, the move buttons,
// then an Off/1/2/3/Custom count picker — Off IS a count of zero, so there's no
// separate switch. Custom reveals a capped number field, so nobody can type 50
// or 100 into it.
function dailyTaskRow(
  config: DailyConfig,
  id: DailyTaskId,
  index: number,
  order: DailyTaskId[],
  onChange: () => void,
): HTMLElement {
  const task = config.tasks[id];
  const isCustom = task.count > presetMax(id);

  const r = row(DAILY_TASK_LABEL[id], dailyCountControl(id, task.count, onChange));
  r.classList.add('daily-order-row');
  if (task.count <= 0) r.classList.add('daily-order-row--off');

  // The position badge and the move buttons ride on the title line. Shuffled,
  // the buttons go — there is no order to edit — but the number stays, because
  // "today it is third" is exactly what someone turning the shuffle on wants to
  // be able to check.
  const text = r.querySelector('.pref-row-text');
  if (text) {
    const head = document.createElement('div');
    head.className = 'daily-order-head';
    const num = document.createElement('span');
    num.className = 'daily-order-num';
    num.textContent = String(index + 1);
    num.setAttribute('aria-hidden', 'true');
    head.appendChild(num);
    // Move the row's own title into the head so the badge sits beside it.
    const title = text.querySelector('.pref-row-title');
    if (title) head.appendChild(title);
    if (!config.randomOrder) head.appendChild(moveButtons(id, index, order, onChange));
    text.prepend(head);
  }

  if (isCustom) r.appendChild(dailyCustomInput(id, task.count, onChange));

  return r;
}

// Up/down rather than drag-and-drop. A drag handle inside a scrolling bottom
// sheet on a phone fights the scroll for the same gesture, and seven rows are
// two taps apart at worst.
function moveButtons(
  id: DailyTaskId,
  index: number,
  order: DailyTaskId[],
  onChange: () => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'daily-order-moves';

  const mk = (dir: -1 | 1, label: string, icon: SVGElement): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'daily-order-move';
    btn.setAttribute('aria-label', `${label} ${DAILY_TASK_LABEL[id]}`);
    btn.appendChild(icon);
    btn.disabled = dir < 0 ? index === 0 : index === order.length - 1;
    btn.addEventListener('click', () => {
      const cur = getDailyConfig();
      // Re-read and re-locate: the stored order can differ from the list this
      // row was built from (a sibling row may have moved since).
      const next = normaliseOrder(cur.order);
      const from = next.indexOf(id);
      const to = from + dir;
      if (from < 0 || to < 0 || to >= next.length) return;
      [next[from], next[to]] = [next[to], next[from]];
      write({ ...cur, order: next });
      onChange();
    });
    return btn;
  };

  wrap.appendChild(mk(-1, 'Move up', Icons.chevronUp(16)));
  wrap.appendChild(mk(1, 'Move down', Icons.chevronDown(16)));
  return wrap;
}

/**
 * The highest one-tap preset this part offers. Normally three; a part with a
 * ceiling below that (growing a line, which is one a day by design) shows only
 * up to its ceiling — and therefore no Custom either, since there is nothing
 * past the presets to type.
 */
function presetMax(id: DailyTaskId): number {
  return Math.min(DAILY_COUNT_RANGE.stepMax, dailyCountCeiling(id));
}

// The Off/1/2/3/Custom segmented picker — five short labels, so it still fits
// one line on a phone (the 0-through-5-plus-Custom row it replaced didn't). A
// capped part shows fewer: "Off / 1" is the honest control for a part that only
// ever does one.
function dailyCountControl(id: DailyTaskId, count: number, onChange: () => void): HTMLElement {
  const stepMax = presetMax(id);
  const options: { value: string; label: string }[] = [];
  for (let n = DAILY_COUNT_RANGE.min; n <= stepMax; n++) {
    options.push({ value: String(n), label: n === 0 ? 'Off' : String(n) });
  }
  if (dailyCountCeiling(id) > DAILY_COUNT_RANGE.stepMax) {
    options.push({ value: 'custom', label: 'Custom' });
  }

  const isCustom = count > stepMax;
  const seg = segmented<string>(
    options,
    isCustom ? 'custom' : String(count),
    (v) => {
      const cur = getDailyConfig();
      const nextCount = v === 'custom'
        // Stepping into Custom keeps whatever custom value was already set;
        // otherwise it starts just past the preset row.
        ? Math.max(stepMax + 1, cur.tasks[id].count)
        : Number(v);
      write({ ...cur, tasks: { ...cur.tasks, [id]: { count: nextCount } } });
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
    write({ ...cur, tasks: { ...cur.tasks, [id]: { count: clamped } } });
    onChange();
  });
  wrap.appendChild(input);

  const suffix = document.createElement('span');
  suffix.className = 'daily-custom-suffix';
  suffix.textContent = `per day (max ${DAILY_COUNT_RANGE.max})`;
  wrap.appendChild(suffix);

  return wrap;
}
