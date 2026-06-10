// The Settings screen — every device-local preference in one place, grouped into
// Appearance, Training, Naming, User and Data. Each control writes straight to
// the pref the matching feature already reads (theme.ts, appearance.ts, prefs.ts,
// sound.ts, chesscom.ts), so a change takes effect the next time that feature runs.

import { getThemeChoice, setThemeChoice, type ThemeChoice } from './theme';
import {
  getBoardColour,
  setBoardColour,
  getPaperTexture,
  setPaperTexture,
  type BoardColour,
} from './appearance';
import {
  getRetriesBeforeReveal,
  setRetriesBeforeReveal,
  type Retries,
  getWatchSpeed,
  setWatchSpeed,
  type WatchSpeed,
  getNamingMode,
  setNamingMode,
  type NamingMode,
  getDefaultTrainingMode,
  setDefaultTrainingMode,
  type TrainingMode,
  clearTimedBest,
} from './prefs';
import { getFeedbackSound, setFeedbackSound, previewFeedback } from './sound';
import {
  getUsername,
  setUsername,
  importRecentGames,
  summariseGames,
  MONTHS_BACK,
  type ImportedGame,
} from './chesscom';
import { saveGames, countGames, clearGames, resetAllProgress } from './storage';
import { clearTrainingDays } from './streak';
import { renderBackupSection } from './backup';
import { Icons } from './icons';

export function renderSettingsScreen(container: HTMLElement): void {
  container.innerHTML = '';

  const screen = document.createElement('div');
  screen.className = 'settings-screen';

  const title = document.createElement('h1');
  title.className = 'settings-title';
  title.textContent = 'Settings';
  screen.appendChild(title);

  screen.appendChild(buildAppearanceGroup());
  screen.appendChild(buildTrainingGroup());
  screen.appendChild(buildNamingGroup());
  screen.appendChild(buildUserGroup());
  screen.appendChild(buildDataGroup());

  container.appendChild(screen);
}

// ── Group / row scaffolding ──────────────────────────────────────────────────

function group(titleText: string): HTMLElement {
  const sec = document.createElement('section');
  sec.className = 'settings-group';
  const h = document.createElement('h2');
  h.className = 'settings-group-title';
  h.textContent = titleText;
  sec.appendChild(h);
  return sec;
}

// One labelled setting. `control` sits to the right on wide rows; pass
// `stacked` for controls that need the full width under the label.
function row(label: string, control: HTMLElement, opts: { sub?: string; stacked?: boolean } = {}): HTMLElement {
  const r = document.createElement('div');
  r.className = 'settings-row' + (opts.stacked ? ' settings-row--stacked' : '');

  const text = document.createElement('div');
  text.className = 'settings-row-text';
  const l = document.createElement('div');
  l.className = 'settings-row-label';
  l.textContent = label;
  text.appendChild(l);
  if (opts.sub) {
    const s = document.createElement('div');
    s.className = 'settings-row-sub';
    s.textContent = opts.sub;
    text.appendChild(s);
  }
  r.appendChild(text);
  r.appendChild(control);
  return r;
}

// ── Reusable controls ────────────────────────────────────────────────────────

function segmented<T extends string>(
  options: { value: T; label: string }[],
  current: T,
  onChange: (v: T) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'seg-control';
  wrap.setAttribute('role', 'group');

  const buttons: HTMLButtonElement[] = [];
  const reflect = (active: T) => {
    for (const b of buttons) {
      const on = b.dataset.value === active;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };

  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg-btn';
    btn.dataset.value = opt.value;
    btn.textContent = opt.label;
    btn.addEventListener('click', () => {
      reflect(opt.value);
      onChange(opt.value);
    });
    buttons.push(btn);
    wrap.appendChild(btn);
  }
  reflect(current);
  return wrap;
}

function toggle(current: boolean, onChange: (v: boolean) => void): HTMLElement {
  const label = document.createElement('label');
  label.className = 'switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = current;
  input.addEventListener('change', () => onChange(input.checked));
  const track = document.createElement('span');
  track.className = 'switch-track';
  label.appendChild(input);
  label.appendChild(track);
  return label;
}

// ── Appearance ───────────────────────────────────────────────────────────────

// Board preview colours. These hexes MUST match the [data-board] rules in
// style.css so the swatch shows the real scheme.
const BOARD_PRESETS: { value: BoardColour; label: string; light: string; dark: string }[] = [
  { value: 'wood', label: 'Wood', light: '#eecfa1', dark: '#b58863' },
  { value: 'green', label: 'Green', light: '#ebecd0', dark: '#779556' },
  { value: 'blue', label: 'Blue', light: '#dee3e6', dark: '#8ca2ad' },
  { value: 'grey', label: 'Grey', light: '#dcdcdc', dark: '#909090' },
];

function boardSwatches(current: BoardColour, onChange: (v: BoardColour) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'board-swatches';

  const buttons: HTMLButtonElement[] = [];
  const reflect = (active: BoardColour) => {
    for (const b of buttons) b.classList.toggle('active', b.dataset.value === active);
  };

  for (const p of BOARD_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'board-swatch';
    btn.dataset.value = p.value;
    btn.setAttribute('aria-label', p.label);
    btn.title = p.label;

    const preview = document.createElement('span');
    preview.className = 'board-swatch-preview';
    // A 2×2 square checker, same two-gradient technique as the real board. With
    // background-size 50%, a 50% position offset lands exactly half a tile across.
    const tile =
      `linear-gradient(45deg, ${p.dark} 25%, transparent 25%, transparent 75%, ${p.dark} 75%)`;
    preview.style.backgroundColor = p.light;
    preview.style.backgroundImage = `${tile}, ${tile}`;
    preview.style.backgroundSize = '50% 50%';
    preview.style.backgroundPosition = '0 0, 50% 50%';

    const name = document.createElement('span');
    name.className = 'board-swatch-name';
    name.textContent = p.label;

    btn.appendChild(preview);
    btn.appendChild(name);
    btn.addEventListener('click', () => {
      reflect(p.value);
      onChange(p.value);
    });
    buttons.push(btn);
    wrap.appendChild(btn);
  }
  reflect(current);
  return wrap;
}

function buildAppearanceGroup(): HTMLElement {
  const sec = group('Appearance');

  sec.appendChild(row(
    'Theme',
    segmented<ThemeChoice>(
      [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'auto', label: 'Auto' }],
      getThemeChoice(),
      (v) => setThemeChoice(v),
    ),
    { sub: 'Auto follows your phone’s light/dark setting.' },
  ));

  sec.appendChild(row(
    'Board colours',
    boardSwatches(getBoardColour(), (v) => setBoardColour(v)),
    { stacked: true },
  ));

  sec.appendChild(row(
    'Paper texture',
    toggle(getPaperTexture(), (on) => setPaperTexture(on)),
    { sub: 'The subtle speckle behind the app.' },
  ));

  return sec;
}

// ── Training ─────────────────────────────────────────────────────────────────

function buildTrainingGroup(): HTMLElement {
  const sec = group('Training');

  sec.appendChild(row(
    'Retries before arrow',
    segmented<string>(
      [{ value: '0', label: '0' }, { value: '1', label: '1' }, { value: '2', label: '2' }],
      String(getRetriesBeforeReveal()),
      (v) => setRetriesBeforeReveal(Number(v) as Retries),
    ),
    { sub: 'Wrong tries allowed before the answer arrow shows.' },
  ));

  sec.appendChild(row(
    'Watch-line speed',
    segmented<WatchSpeed>(
      [{ value: 'slow', label: 'Slow' }, { value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }],
      getWatchSpeed(),
      (v) => setWatchSpeed(v),
    ),
    { sub: 'How fast the play button auto-plays a line.' },
  ));

  sec.appendChild(row(
    'Feedback sound',
    toggle(getFeedbackSound(), (on) => {
      setFeedbackSound(on);
      if (on) previewFeedback();
    }),
    { sub: 'A soft tone on right and wrong moves while training.' },
  ));

  sec.appendChild(row(
    'Default training mode',
    segmented<TrainingMode>(
      [{ value: 'due', label: 'Due now' }, { value: 'recent', label: 'Recent' }, { value: 'weakest', label: 'Weakest' }],
      getDefaultTrainingMode(),
      (v) => setDefaultTrainingMode(v),
    ),
    { sub: 'What “Start training” launches from the Today screen.' },
  ));

  return sec;
}

// ── Naming ───────────────────────────────────────────────────────────────────

function buildNamingGroup(): HTMLElement {
  const sec = group('Naming');

  sec.appendChild(row(
    'New line names',
    segmented<NamingMode>(
      [{ value: 'auto', label: 'Auto' }, { value: 'manual', label: 'Manual' }],
      getNamingMode(),
      (v) => setNamingMode(v),
    ),
    { sub: 'Auto names lines from the opening database; Manual lets you name them yourself.' },
  ));

  return sec;
}

// ── User ─────────────────────────────────────────────────────────────────────

function buildUserGroup(): HTMLElement {
  const sec = group('User');

  const userInput = document.createElement('input');
  userInput.type = 'text';
  userInput.className = 'settings-input';
  userInput.autocomplete = 'off';
  userInput.autocapitalize = 'none';
  userInput.spellcheck = false;
  userInput.placeholder = 'your Chess.com username';
  userInput.value = getUsername();
  userInput.addEventListener('change', () => setUsername(userInput.value));
  sec.appendChild(row('Chess.com username', userInput, { stacked: true }));

  // Refresh my games — re-imports ~a year of games from the free Published-Data
  // API into IndexedDB, replacing what's stored. Mirrors the old builder import.
  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'settings-btn';
  refreshBtn.appendChild(Icons.reset(16));
  refreshBtn.appendChild(document.createTextNode('Refresh my games'));

  const status = document.createElement('p');
  status.className = 'settings-note';
  status.setAttribute('aria-live', 'polite');

  void countGames().then((n) => {
    if (n > 0) status.textContent = `${n} game${n === 1 ? '' : 's'} stored on this device.`;
  });

  refreshBtn.addEventListener('click', async () => {
    const user = userInput.value.trim();
    if (!user) {
      status.textContent = 'Enter your Chess.com username first.';
      return;
    }
    setUsername(user);
    refreshBtn.disabled = true;
    status.textContent = 'Looking up your archives…';

    // Re-import from scratch so removed/renamed games don't linger.
    await clearGames();
    const stored: ImportedGame[] = [];
    try {
      const result = await importRecentGames(user, {
        months: MONTHS_BACK,
        onProgress: (p) => {
          status.textContent =
            `Month ${Math.min(p.monthsDone + 1, p.monthsTotal)}/${p.monthsTotal} ` +
            `(${p.label}) — ${p.gamesSoFar} games so far…`;
        },
        onGames: async (batch) => {
          await saveGames(batch);
          stored.push(...batch);
        },
      });
      const s = summariseGames(stored);
      status.textContent = s.total === 0
        ? `No standard games found in the last ${result.monthsFetched} months.`
        : `Imported ${s.total} games from ${result.monthsFetched} months ✓ ` +
          `(${s.white} White / ${s.black} Black).`;
    } catch (err) {
      status.textContent = `Import failed — ${(err as Error).message}`;
    } finally {
      refreshBtn.disabled = false;
    }
  });

  const btnRow = document.createElement('div');
  btnRow.className = 'settings-actions';
  btnRow.appendChild(refreshBtn);
  sec.appendChild(btnRow);
  sec.appendChild(status);

  return sec;
}

// ── Data ─────────────────────────────────────────────────────────────────────

function buildDataGroup(): HTMLElement {
  const sec = group('Data');

  // Export / import — the existing backup section does both.
  sec.appendChild(renderBackupSection(() => { /* nothing else on this screen depends on it */ }));

  // Reset progress — destructive, so it's set apart and confirmed.
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'settings-btn settings-btn--danger';
  resetBtn.appendChild(Icons.reset(16));
  resetBtn.appendChild(document.createTextNode('Reset progress'));

  const status = document.createElement('p');
  status.className = 'settings-note';
  status.setAttribute('aria-live', 'polite');

  resetBtn.addEventListener('click', () => {
    confirmDialog({
      title: 'Reset all progress?',
      body: 'This clears every training score, streak and timed best, and marks all ' +
        'moves as never-trained. Your lines, notes and tags are kept. This can’t be undone.',
      confirmLabel: 'Reset progress',
      danger: true,
      onConfirm: async () => {
        resetBtn.disabled = true;
        status.textContent = 'Resetting…';
        try {
          await resetAllProgress();
          clearTrainingDays();
          clearTimedBest();
          status.textContent = 'Progress reset ✓ — every line is due again.';
        } catch (err) {
          status.textContent = `Reset failed — ${(err as Error).message}`;
        } finally {
          resetBtn.disabled = false;
        }
      },
    });
  });

  const wrap = document.createElement('div');
  wrap.className = 'settings-reset';
  const heading = document.createElement('h3');
  heading.className = 'settings-subheading';
  heading.textContent = 'Reset progress';
  const blurb = document.createElement('p');
  blurb.className = 'settings-row-sub';
  blurb.textContent = 'Start the spaced-repetition schedule over without deleting any lines.';
  wrap.appendChild(heading);
  wrap.appendChild(blurb);
  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  actions.appendChild(resetBtn);
  wrap.appendChild(actions);
  wrap.appendChild(status);
  sec.appendChild(wrap);

  return sec;
}

// ── Confirm dialog ───────────────────────────────────────────────────────────
// Reuses the edit-overlay / edit-sheet look from the builder for consistency.

function confirmDialog(opts: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet';

  const h = document.createElement('h3');
  h.className = 'edit-sheet-title';
  h.textContent = opts.title;
  sheet.appendChild(h);

  const p = document.createElement('p');
  p.className = 'settings-row-sub';
  p.textContent = opts.body;
  sheet.appendChild(p);

  const btnRow = document.createElement('div');
  btnRow.className = 'edit-btn-row';

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = opts.danger ? 'settings-btn settings-btn--danger' : 'settings-btn';
  confirm.textContent = opts.confirmLabel;
  confirm.addEventListener('click', () => {
    close();
    opts.onConfirm();
  });

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'edit-cancel-btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', close);

  btnRow.appendChild(confirm);
  btnRow.appendChild(cancel);
  sheet.appendChild(btnRow);

  function close() {
    overlay.remove();
  }
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}
