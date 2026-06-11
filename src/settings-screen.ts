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
  getConfirmRunBeforeTraining,
  setConfirmRunBeforeTraining,
  clearTimedBest,
} from './prefs';
import { getFeedbackSound, setFeedbackSound, previewFeedback } from './sound';
import {
  openImportPanel,
  getGamesSource,
  platformLabel,
} from './import-panel';
import { countGames, resetAllProgress } from './storage';
import { clearTrainingDays, clearReviewedToday } from './streak';
import { renderBackupSection } from './backup';
import { Icons } from './icons';
import { pushBack } from './back-nav';
import { appendSelfTest } from './selftest-panel';
import { runStorageSelfTest } from './storage.selftest';
import { runOpeningsSelfTest } from './openings.selftest';
import { runImportSelfTest } from './import.selftest';

export function renderSettingsScreen(container: HTMLElement): void {
  container.innerHTML = '';

  const screen = document.createElement('div');
  screen.className = 'settings-screen';

  const title = document.createElement('h1');
  title.className = 'settings-title';
  title.textContent = 'Settings';
  screen.appendChild(title);

  // The User group leads the screen until you've imported games — getting your
  // games in is the first thing a new install wants. Once connected it drops
  // back to its usual spot below Naming. We learn which only after a quick async
  // count, so build a placeholder now and slot it in once we know.
  const userSlotTop = document.createElement('div');
  screen.appendChild(userSlotTop);

  screen.appendChild(buildAppearanceGroup());
  screen.appendChild(buildTrainingGroup());
  screen.appendChild(buildNamingGroup());
  const userSlotMid = document.createElement('div');
  screen.appendChild(userSlotMid);
  screen.appendChild(buildDataGroup());
  screen.appendChild(buildDiagnosticsGroup());

  container.appendChild(screen);

  void countGames().then((count) => {
    const connected = count > 0;
    const group = buildUserGroup(count, () => renderSettingsScreen(container));
    (connected ? userSlotMid : userSlotTop).appendChild(group);
  });
}

// ── Diagnostics ──────────────────────────────────────────────────────────────
// Offline self-tests for the data layer, runnable right on the phone. Storage
// hits the real IndexedDB (round-tripping a throwaway line), openings checks the
// bundled name database, and the import parser checks Chess.com PGN parsing over
// a fixed game sample. The scheduler / analysis / progress self-tests live on
// their own screens (Train, Lines, Stats).

function buildDiagnosticsGroup(): HTMLElement {
  const sec = group('Diagnostics');

  const blurb = document.createElement('p');
  blurb.className = 'section-desc';
  blurb.textContent = 'Offline checks of the data layer. Tap one to run it and see pass/fail.';
  sec.appendChild(blurb);

  appendSelfTest(sec, 'Run storage self-test', runStorageSelfTest, '[storage self-test]');
  appendSelfTest(sec, 'Run openings lookup self-test', runOpeningsSelfTest, '[openings self-test]');
  appendSelfTest(sec, 'Run import parser self-test', runImportSelfTest, '[import self-test]');

  return sec;
}

// ── Group / row scaffolding ──────────────────────────────────────────────────

function group(titleText: string): HTMLElement {
  const sec = document.createElement('section');
  sec.className = 'section';
  const h = document.createElement('h2');
  h.className = 'section-title';
  h.textContent = titleText;
  sec.appendChild(h);
  return sec;
}

// One preference, using the shared .pref-row component: title (+ optional
// description) stacked in a column, with the control on its own line below.
// Every Settings row has this same shape.
function row(label: string, control: HTMLElement, opts: { sub?: string } = {}): HTMLElement {
  const r = document.createElement('div');
  r.className = 'pref-row';

  const text = document.createElement('div');
  text.className = 'pref-row-text';
  const l = document.createElement('div');
  l.className = 'pref-row-title';
  l.textContent = label;
  text.appendChild(l);
  if (opts.sub) {
    const s = document.createElement('div');
    s.className = 'pref-row-desc';
    s.textContent = opts.sub;
    text.appendChild(s);
  }
  r.appendChild(text);

  const ctrl = document.createElement('div');
  ctrl.className = 'pref-row-control';
  ctrl.appendChild(control);
  r.appendChild(ctrl);

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
    'Confirm run before training',
    toggle(getConfirmRunBeforeTraining(), (on) => setConfirmRunBeforeTraining(on)),
    { sub: 'Do one clean run before a line joins training. Off adds it straight away.' },
  ));

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

// The User group has two faces. Before any games are imported it's a prominent
// call-to-action (and leads the whole Settings screen). Once connected it shows
// the account you're synced with, when it last synced, how many games are on the
// device, and a quiet Refresh — all driven by the shared import panel.
function buildUserGroup(gameCount: number, refresh: () => void): HTMLElement {
  const sec = group('Your games');
  const source = getGamesSource();

  // Open the panel pre-filled with the connected account (or the last-used one),
  // then re-render Settings so the connected card and counts update.
  const openPanel = () => openImportPanel({
    platform: source?.platform,
    username: source?.username,
    onImported: () => refresh(),
  });

  if (gameCount === 0 || !source) {
    // ── Not connected — make it pop ──
    const card = document.createElement('div');
    card.className = 'settings-connect-card';

    const heading = document.createElement('h3');
    heading.className = 'settings-connect-title';
    heading.textContent = 'Import your games';
    card.appendChild(heading);

    const blurb = document.createElement('p');
    blurb.className = 'settings-connect-desc';
    blurb.textContent =
      'Pull your recent games from Chess.com or Lichess to see which openings ' +
      'you actually play, where you score badly, and what to prep next.';
    card.appendChild(blurb);

    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'btn-primary settings-connect-btn';
    cta.appendChild(Icons.download(16));
    cta.appendChild(document.createTextNode('Import my games'));
    cta.addEventListener('click', openPanel);
    card.appendChild(cta);

    sec.appendChild(card);
    return sec;
  }

  // ── Connected — show the account, sync date, count, and a quiet Refresh ──
  const card = document.createElement('div');
  card.className = 'settings-connected';

  const who = document.createElement('div');
  who.className = 'settings-connected-who';
  const handle = document.createElement('span');
  handle.className = 'settings-connected-handle';
  handle.textContent = source.username;
  const plat = document.createElement('span');
  plat.className = 'settings-connected-platform';
  plat.textContent = `on ${platformLabel(source.platform)}`;
  who.appendChild(handle);
  who.appendChild(plat);
  card.appendChild(who);

  const meta = document.createElement('p');
  meta.className = 'settings-connected-meta';
  meta.textContent =
    `${gameCount} game${gameCount === 1 ? '' : 's'} on this device · ` +
    `synced ${relativeDate(source.syncedAt)}`;
  card.appendChild(meta);

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'btn-secondary';
  refreshBtn.appendChild(Icons.reset(16));
  refreshBtn.appendChild(document.createTextNode('Refresh my games'));
  refreshBtn.addEventListener('click', openPanel);

  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  actions.appendChild(refreshBtn);
  card.appendChild(actions);

  sec.appendChild(card);
  return sec;
}

// "synced 2 days ago" from an ISO timestamp.
function relativeDate(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(diff) || diff < 0) return 'just now';
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return iso.slice(0, 10);
}

// ── Data ─────────────────────────────────────────────────────────────────────

function buildDataGroup(): HTMLElement {
  const sec = group('Data');

  // Export / import — the existing backup section does both.
  sec.appendChild(renderBackupSection(() => { /* nothing else on this screen depends on it */ }));

  // Reset progress — destructive, so it's set apart and confirmed.
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'btn-danger';
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
          clearReviewedToday();
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
  blurb.className = 'section-desc';
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
  p.className = 'section-desc';
  p.textContent = opts.body;
  sheet.appendChild(p);

  const btnRow = document.createElement('div');
  btnRow.className = 'edit-btn-row';

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = opts.danger ? 'btn-danger' : 'btn-secondary';
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
    removeBack();
  }
  const removeBack = pushBack(close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}
