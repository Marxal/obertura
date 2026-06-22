// The Settings screen — every device-local preference in one place, grouped into
// Appearance, Training, Statistics, Add your games, Data, Diagnostics and
// Feedback & about. Each control writes straight to the pref the matching feature
// already reads (theme.ts, appearance.ts, prefs.ts, sound.ts, chesscom.ts), so a
// change takes effect the next time that feature runs.

import { getThemeChoice, setThemeChoice, type ThemeChoice } from './theme';
import {
  getBoardColour,
  setBoardColour,
  getPieceSet,
  setPieceSet,
  type BoardColour,
  type PieceSet,
} from './appearance';
import { PIECE_PREVIEWS } from './pieces/previews';
import {
  getRetriesBeforeReveal,
  setRetriesBeforeReveal,
  type Retries,
  getWatchSpeed,
  setWatchSpeed,
  type WatchSpeed,
  getDefaultTrainingMode,
  setDefaultTrainingMode,
  type TrainingMode,
  getConfirmRunBeforeTraining,
  setConfirmRunBeforeTraining,
  clearTimedBest,
  getShowQuickView,
  setShowQuickView,
  getShowLineMiniatures,
  setShowLineMiniatures,
  getShowStreakSection,
  setShowStreakSection,
  getShowActivitySection,
  setShowActivitySection,
  getScoutingEnabled,
  setScoutingEnabled,
  getIncludeSecondPlatform,
  setIncludeSecondPlatform,
} from './prefs';
import type { Platform } from './import-games';
import { getFeedbackSound, setFeedbackSound, previewFeedback } from './sound';
import {
  openImportPanel,
  getGamesSource,
  platformLabel,
} from './import-panel';
import { countGames, resetAllProgress, eraseAllData } from './storage';
import { getAutoRefreshEnabled, setAutoRefreshEnabled, getLastGamesRefresh } from './auto-refresh';
import { clearTrainingDays, clearReviewedToday, clearReviewLog } from './streak';
import { renderBackupSection, exportBackupNow } from './backup';
import { Icons } from './icons';
import { userAvatar } from './avatar';
import { pushBack } from './back-nav';
import { appendSelfTest } from './selftest-panel';
import { openFeedbackSheet } from './feedback';
import { showIntro } from './onboarding';
import { buildSupportSection } from './support';
import { runStorageSelfTest } from './storage.selftest';
import { runOpeningsSelfTest } from './openings.selftest';
import { runSparSelfTest } from './spar.selftest';
import { runImportSelfTest } from './import.selftest';
import { runTreeSelfTest } from './tree.selftest';
import { runMoveStatsSelfTest } from './move-stats.selftest';
import { runSchedulerSelfTest } from './scheduler.selftest';
import { runAnalysisSelfTest } from './analysis.selftest';
import { runStatsSelfTest } from './stats.selftest';
import { runEngineSelfTest } from './engine.selftest';

export function renderSettingsScreen(container: HTMLElement): void {
  container.innerHTML = '';

  const screen = document.createElement('div');
  screen.className = 'settings-screen';

  // The screen title now lives in the app header (set in showView), so it's not
  // repeated here.

  // "Add your games" always leads the screen — getting your games in is the first
  // thing a new install wants, and the synced account stays handy afterwards. It
  // pops (an accent CTA card) until you've imported, then turns discreet. We learn
  // which only after a quick async count, so build a placeholder now and fill it.
  const userSlot = document.createElement('div');
  screen.appendChild(userSlot);

  screen.appendChild(buildAppearanceGroup());
  screen.appendChild(buildTrainingGroup());
  screen.appendChild(buildStatisticsGroup());
  screen.appendChild(buildExploreGroup());
  screen.appendChild(buildDataGroup());
  screen.appendChild(buildDiagnosticsGroup());
  screen.appendChild(buildAboutGroup());

  container.appendChild(screen);

  void countGames().then((count) => {
    userSlot.appendChild(buildUserGroup(count, () => renderSettingsScreen(container)));
  });
}

// ── Diagnostics ──────────────────────────────────────────────────────────────
// Offline self-tests for the data layer, runnable right on the phone — now the
// single home for every self-test in the app. They tuck behind an "Advanced"
// disclosure (closed by default) so day-to-day Settings stays uncluttered.
// Storage hits the real IndexedDB; openings checks the bundled name database; the
// import parser checks Chess.com PGN parsing; the move-tree, move-stats,
// scheduler and analysis tests cover the pure-logic layers. The scheduler and
// analysis tests used to live inline on the Train and Lines screens — those
// links are gone, and these are the only copies now.

function buildDiagnosticsGroup(): HTMLElement {
  // The whole group is now a collapsed accordion panel, so the old nested
  // "Advanced" disclosure is gone — the self-tests sit directly inside.
  const sec = group('Diagnostics', Icons.search(16));

  const blurb = document.createElement('p');
  blurb.className = 'section-desc';
  blurb.textContent = 'Offline self-tests. Tap one to run it and see pass/fail.';
  sec.appendChild(blurb);

  appendSelfTest(sec, 'Run storage self-test', runStorageSelfTest, '[storage self-test]');
  appendSelfTest(sec, 'Run openings lookup self-test', runOpeningsSelfTest, '[openings self-test]');
  appendSelfTest(sec, 'Run out-of-book self-test', runSparSelfTest, '[spar self-test]');
  appendSelfTest(sec, 'Run import parser self-test', runImportSelfTest, '[import self-test]');
  appendSelfTest(sec, 'Run move-tree self-test', runTreeSelfTest, '[tree self-test]');
  appendSelfTest(sec, 'Run move-stats self-test', runMoveStatsSelfTest, '[move-stats self-test]');
  appendSelfTest(sec, 'Run scheduler self-test', runSchedulerSelfTest, '[scheduler self-test]');
  appendSelfTest(sec, 'Run analysis self-test', runAnalysisSelfTest, '[analysis self-test]');
  appendSelfTest(sec, 'Run statistics self-test', runStatsSelfTest, '[stats self-test]');
  appendSelfTest(sec, 'Run engine castling self-test', runEngineSelfTest, '[engine self-test]');

  return sec;
}

// ── Explore ──────────────────────────────────────────────────────────────────
// A small home for Explore-related preferences. For now just the scouting
// switch, which gates the whole opponent-scouting feature.

function buildExploreGroup(): HTMLElement {
  const sec = group('Explore', Icons.compass(16));

  sec.appendChild(row(
    'Scouting',
    toggle(getScoutingEnabled(), (on) => setScoutingEnabled(on)),
    { sub: 'Scout opponents from their games, on the Explore tab and in the board builder. Off hides it from both — your scouted opponents are kept.' },
  ));

  return sec;
}

// ── Feedback & About ─────────────────────────────────────────────────────────
// The closing group: a way to write to me, and an About sheet with credits,
// support links and the version. About sits at the very bottom of Settings.

function buildAboutGroup(): HTMLElement {
  const sec = staticGroup('Feedback & about', Icons.note(16));

  sec.appendChild(linkRow('Send feedback', openFeedbackSheet, Icons.note(18)));
  // Replay the first-launch intro on demand — the seen-flag stays set, so it
  // doesn't reappear on its own afterwards.
  sec.appendChild(linkRow('Replay intro', () => showIntro(), Icons.play(18)));
  sec.appendChild(linkRow('About', () => {
    window.open('https://marxal.github.io/obertura/docs/', '_blank', 'noopener,noreferrer');
  }, Icons.info(18)));

  // Buy me a coffee — Swish / Card, right below.
  sec.appendChild(buildSupportSection());

  return sec;
}

// A full-width tap row that opens a sheet: an optional leading icon, the label,
// and a trailing chevron.
function linkRow(label: string, onClick: () => void, leading?: SVGElement): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'settings-link-row';

  const left = document.createElement('span');
  left.className = 'settings-link-row-left';
  if (leading) left.appendChild(leading);
  const text = document.createElement('span');
  text.textContent = label;
  left.appendChild(text);
  btn.appendChild(left);

  btn.appendChild(Icons.chevronRight(18));
  btn.addEventListener('click', onClick);
  return btn;
}

// ── Group / row scaffolding ──────────────────────────────────────────────────

// A collapsible group. Every accordion panel shares one `name`, so the browser
// keeps just one open at a time (native exclusive <details> behaviour — no JS).
// They all start closed, so Settings opens as a short, scannable list of titles.
// Each header carries an icon (left) and a chevron (right); rows append straight
// onto the returned <details>, after the summary.
function group(titleText: string, icon: SVGElement): HTMLElement {
  const sec = document.createElement('details');
  sec.className = 'section section--acc';
  sec.setAttribute('name', 'settings-acc');

  const summary = document.createElement('summary');
  summary.className = 'section-title section-summary';

  const left = document.createElement('span');
  left.className = 'section-summary-left';
  left.appendChild(icon);
  const label = document.createElement('span');
  label.textContent = titleText;
  left.appendChild(label);

  summary.appendChild(left);
  summary.appendChild(Icons.chevronRight(16));
  sec.appendChild(summary);
  return sec;
}

// An always-open group (no accordion): the plain section used for the
// "Add your games" card and "Feedback & about", which the user wants permanently
// visible rather than tucked away. Carries the same leading icon as the
// accordion headers, for a consistent row of marks down the screen.
function staticGroup(titleText: string, icon: SVGElement): HTMLElement {
  const sec = document.createElement('section');
  sec.className = 'section';
  const h = document.createElement('h2');
  h.className = 'section-title section-title--icon';
  h.appendChild(icon);
  const label = document.createElement('span');
  label.textContent = titleText;
  h.appendChild(label);
  sec.appendChild(h);
  return sec;
}

// One preference, using the shared .pref-row component. Two layouts, chosen by
// the control:
//   • a SWITCH sits right-aligned on the title line, with the description below
//     spanning the full width (a compact, scannable on/off row).
//   • every other control (segmented pickers, swatches, buttons, fields) keeps
//     the stacked layout: title + optional description, then the control below.
// We tell them apart by the control's own class, so callers pass the same args.
function row(label: string, control: HTMLElement, opts: { sub?: string } = {}): HTMLElement {
  const isSwitch = control.classList.contains('switch');

  const r = document.createElement('div');
  r.className = isSwitch ? 'pref-row pref-row--switch' : 'pref-row';

  const title = document.createElement('div');
  title.className = 'pref-row-title';
  title.textContent = label;

  const sub = opts.sub ? document.createElement('div') : null;
  if (sub) {
    sub.className = 'pref-row-desc';
    sub.textContent = opts.sub!;
  }

  const ctrl = document.createElement('div');
  ctrl.className = 'pref-row-control';
  ctrl.appendChild(control);

  if (isSwitch) {
    // Title and switch share the top line; the description (if any) spans below.
    const head = document.createElement('div');
    head.className = 'pref-row-head';
    head.appendChild(title);
    head.appendChild(ctrl);
    r.appendChild(head);
    if (sub) r.appendChild(sub);
    return r;
  }

  // Stacked: title + description in a text column, control on its own line below.
  const text = document.createElement('div');
  text.className = 'pref-row-text';
  text.appendChild(title);
  if (sub) text.appendChild(sub);
  r.appendChild(text);
  r.appendChild(ctrl);

  return r;
}

// ── Reusable controls ────────────────────────────────────────────────────────

function segmented<T extends string>(
  options: { value: T; label: string }[],
  current: T,
  onChange: (v: T) => void,
  opts: { fullWidth?: boolean } = {},
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = opts.fullWidth ? 'seg-control seg-control--full' : 'seg-control';
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

// The four piece sets, in bundle-first order. cburnett is the bundled default;
// the rest load on demand (see appearance.ts). Licences are recorded in About.
const PIECE_PRESETS: { value: PieceSet; label: string }[] = [
  { value: 'cburnett', label: 'cburnett' },
  { value: 'merida', label: 'Merida' },
  { value: 'chessnut', label: 'Chessnut' },
  { value: 'kiwen-suwi', label: 'Kiwen-Suwi' },
];

// A mini two-square preview (light + dark) with two glyphs from the set, drawn
// from the always-bundled previews module so the picker needs no on-demand load.
function pieceSwatches(current: PieceSet, onChange: (v: PieceSet) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'piece-swatches';

  const buttons: HTMLButtonElement[] = [];
  const reflect = (active: PieceSet) => {
    for (const b of buttons) b.classList.toggle('active', b.dataset.value === active);
  };

  for (const p of PIECE_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'piece-swatch';
    btn.dataset.value = p.value;
    btn.setAttribute('aria-label', p.label);
    btn.title = p.label;

    const preview = document.createElement('span');
    preview.className = 'piece-swatch-preview';
    const glyphs = PIECE_PREVIEWS[p.value];
    for (const [pieceKey, shade] of [['wN', 'light'], ['bQ', 'dark']] as const) {
      const sq = document.createElement('span');
      sq.className = `piece-swatch-sq ${shade}`;
      const img = document.createElement('span');
      img.className = 'piece-swatch-glyph';
      img.style.backgroundImage = `url("${glyphs[pieceKey]}")`;
      sq.appendChild(img);
      preview.appendChild(sq);
    }

    const name = document.createElement('span');
    name.className = 'piece-swatch-name';
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

// The four explicit themes, shown as swatches in the same shape as the board and
// piece pickers. Each preview is the theme's own page colour with its accent-
// coloured icon, so the swatch previews the real theme. These hexes MUST match
// theme.ts / the [data-theme] rules in style.css. "System" is a separate,
// discrete control (see buildThemeRow), not one of these swatches.
const THEME_PRESETS: {
  value: Exclude<ThemeChoice, 'system'>;
  label: string;
  bg: string;
  accent: string;
  icon: (s?: number) => SVGElement;
}[] = [
  { value: 'classic-light', label: 'Light',   bg: '#f1ece1', accent: '#c07a2a', icon: Icons.sun },
  { value: 'classic-dark',  label: 'Dark',    bg: '#211c16', accent: '#d4892c', icon: Icons.moon },
  { value: 'elegant',       label: 'Elegant', bg: '#1e3128', accent: '#dca844', icon: Icons.sparkles },
  { value: 'gamer',         label: 'Gamer',   bg: '#0e1020', accent: '#27e0ff', icon: Icons.gamepad },
];

function themeSwatches(): { element: HTMLElement; reflect: (active: ThemeChoice) => void } {
  const wrap = document.createElement('div');
  wrap.className = 'theme-swatches';

  const buttons: HTMLButtonElement[] = [];
  const reflect = (active: ThemeChoice) => {
    for (const b of buttons) b.classList.toggle('active', b.dataset.value === active);
  };

  for (const p of THEME_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-swatch';
    btn.dataset.value = p.value;
    btn.setAttribute('aria-label', p.label);
    btn.title = p.label;

    const preview = document.createElement('span');
    preview.className = 'theme-swatch-preview';
    preview.style.background = p.bg;
    preview.style.color = p.accent;
    preview.appendChild(p.icon(20));

    const name = document.createElement('span');
    name.className = 'theme-swatch-name';
    name.textContent = p.label;

    btn.appendChild(preview);
    btn.appendChild(name);
    btn.addEventListener('click', () => setTheme(p.value));
    buttons.push(btn);
    wrap.appendChild(btn);
  }

  return { element: wrap, reflect };
}

// "System" follows the OS light/dark setting, so JS — not these swatches — is the
// source of truth for what it resolves to (see theme.ts).
const systemPrefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

// One handle to set the theme and keep the row in sync, shared by the swatches
// and the System pill below.
let setTheme: (choice: ThemeChoice) => void = () => {};

// The Theme row: a swatch grid for the four explicit themes, with a discrete
// "System" pill pinned to the right of the title. Picking a swatch takes an
// explicit theme; tapping System hands the choice back to the phone. When System
// drives, the swatches dim but still highlight whichever theme it resolved to.
function buildThemeRow(): HTMLElement {
  const r = document.createElement('div');
  r.className = 'pref-row';

  const head = document.createElement('div');
  head.className = 'pref-row-head theme-row-head';
  const title = document.createElement('div');
  title.className = 'pref-row-title';
  title.textContent = 'Theme';
  head.appendChild(title);

  const systemBtn = document.createElement('button');
  systemBtn.type = 'button';
  systemBtn.className = 'theme-system-btn';
  systemBtn.textContent = 'System';
  head.appendChild(systemBtn);
  r.appendChild(head);

  const swatches = themeSwatches();
  r.appendChild(swatches.element);

  const sub = document.createElement('div');
  sub.className = 'pref-row-desc';
  sub.textContent =
    'Elegant is a felt-table green; Gamer is a neon-glow dark. System follows your phone’s light/dark setting.';
  r.appendChild(sub);

  const sync = () => {
    const choice = getThemeChoice();
    const onSystem = choice === 'system';
    systemBtn.classList.toggle('active', onSystem);
    systemBtn.setAttribute('aria-pressed', String(onSystem));
    swatches.element.classList.toggle('theme-swatches--system', onSystem);
    swatches.reflect(onSystem ? (systemPrefersDark() ? 'classic-dark' : 'classic-light') : choice);
  };

  setTheme = (choice) => { setThemeChoice(choice); sync(); };
  systemBtn.addEventListener('click', () => setTheme('system'));

  sync();
  return r;
}

function buildAppearanceGroup(): HTMLElement {
  const sec = group('Appearance', Icons.eye(16));

  sec.appendChild(buildThemeRow());

  sec.appendChild(row(
    'Board colours',
    boardSwatches(getBoardColour(), (v) => setBoardColour(v)),
  ));

  sec.appendChild(row(
    'Pieces',
    pieceSwatches(getPieceSet(), (v) => setPieceSet(v)),
    { sub: 'New sets download once, then stay cached.' },
  ));

  sec.appendChild(row(
    'Quick-view carousels',
    toggle(getShowQuickView(), (on) => setShowQuickView(on)),
    { sub: 'The swipe-through board rows at the top of My Lines. Off shows quick add-line buttons instead.' },
  ));

  sec.appendChild(row(
    'Line position miniatures',
    toggle(getShowLineMiniatures(), (on) => setShowLineMiniatures(on)),
    { sub: 'A tiny board on every saved-line and suggestion card, showing where the line ends up.' },
  ));

  return sec;
}

// ── Training ─────────────────────────────────────────────────────────────────

function buildTrainingGroup(): HTMLElement {
  const sec = group('Training', Icons.zap(16));

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

// ── Statistics ───────────────────────────────────────────────────────────────
// Two switches for the Statistics screen's optional sections. The Train-header
// streak pill is independent of both — it always shows.

function buildStatisticsGroup(): HTMLElement {
  const sec = group('Statistics', Icons.barChart(16));

  sec.appendChild(row(
    'Show streak on Statistics',
    toggle(getShowStreakSection(), (on) => setShowStreakSection(on)),
    { sub: 'The big streak counter, 7-day strip and the monthly calendar. The Train-screen streak pill stays either way.' },
  ));

  sec.appendChild(row(
    'Show training activity',
    toggle(getShowActivitySection(), (on) => setShowActivitySection(on)),
    { sub: 'The remembered-vs-failed bar.' },
  ));

  return sec;
}

// ── Add your games ───────────────────────────────────────────────────────────

// This group has two faces. Before any games are imported it's a prominent
// call-to-action (and leads the whole Settings screen). Once connected it shows
// the account you're synced with, when it last synced, how many games are on the
// device, and a quiet Refresh — all driven by the shared import panel.
function buildUserGroup(gameCount: number, refresh: () => void): HTMLElement {
  const sec = staticGroup('Add your games', Icons.download(16));
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

  // ── Connected — discreet once games are in: a compact card with the account,
  // sync date, count, and a small Refresh. The "pop" is for the empty state. ──
  const card = document.createElement('div');
  card.className = 'settings-connected settings-connected--compact';

  const who = document.createElement('div');
  who.className = 'settings-connected-who';
  // Your Chess.com picture (Lichess / no picture → generic icon).
  who.appendChild(userAvatar(source.avatarUrl, 22));
  const handle = document.createElement('span');
  handle.className = 'settings-connected-handle';
  handle.textContent = source.username;
  const plat = document.createElement('span');
  plat.className = 'settings-connected-platform';
  plat.textContent = `on ${platformLabel(source.platform)}`;
  who.appendChild(handle);
  who.appendChild(plat);

  // A small icon-led Refresh sits on the account line itself, keeping the card to
  // two tight rows instead of a full-width action button.
  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'btn-secondary btn-compact settings-connected-refresh';
  refreshBtn.appendChild(Icons.reset(15));
  refreshBtn.appendChild(document.createTextNode('Refresh'));
  refreshBtn.addEventListener('click', openPanel);
  who.appendChild(refreshBtn);
  card.appendChild(who);

  const meta = document.createElement('p');
  meta.className = 'settings-connected-meta';
  meta.textContent =
    `${gameCount} game${gameCount === 1 ? '' : 's'} on this device · ` +
    `synced ${relativeDate(source.syncedAt)}`;
  card.appendChild(meta);

  sec.appendChild(card);

  // A discreet opt-in to pull games from the OTHER platform into the same
  // library. Off by default — most people use a single site. When on, a quiet
  // "Add games from …" button opens the import pre-set to the other platform;
  // the Replace/Add prompt there merges them in.
  const other: Platform = source.platform === 'chesscom' ? 'lichess' : 'chesscom';
  const addSlot = document.createElement('div');

  const renderAddBtn = () => {
    addSlot.innerHTML = '';
    if (!getIncludeSecondPlatform()) return;
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn-secondary';
    addBtn.appendChild(Icons.download(16));
    addBtn.appendChild(document.createTextNode(`Add games from ${platformLabel(other)}`));
    addBtn.addEventListener('click', () => openImportPanel({
      platform: other,
      onImported: () => refresh(),
    }));
    const a = document.createElement('div');
    a.className = 'settings-actions';
    a.appendChild(addBtn);
    addSlot.appendChild(a);
  };

  sec.appendChild(row(
    'Include my other platform',
    toggle(getIncludeSecondPlatform(), (on) => { setIncludeSecondPlatform(on); renderAddBtn(); }),
    { sub: `Also pull games from ${platformLabel(other)} into this same library.` },
  ));
  sec.appendChild(addSlot);
  renderAddBtn();

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

// The quiet line under "Auto-refresh games": "Last refreshed N days ago", or
// "never" before any games have been pulled.
function lastRefreshCaption(): string {
  const iso = getLastGamesRefresh();
  if (!iso) return 'Last refreshed: never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (!Number.isFinite(days) || days <= 0) return 'Last refreshed: today';
  if (days === 1) return 'Last refreshed: yesterday';
  return `Last refreshed: ${days} days ago`;
}

function buildDataGroup(): HTMLElement {
  const sec = group('Data', Icons.save(16));

  // Auto-refresh games — the weekly check. Only does anything once a username
  // has been saved by a previous import (see auto-refresh.ts); the caption
  // underneath reports when games were last pulled.
  const autoRow = row(
    'Auto-refresh games',
    toggle(getAutoRefreshEnabled(), (on) => setAutoRefreshEnabled(on)),
    { sub: 'Checks for new games about once a week, when you open the app.' },
  );
  const caption = document.createElement('div');
  caption.className = 'pref-row-caption';
  caption.textContent = lastRefreshCaption();
  autoRow.appendChild(caption);
  sec.appendChild(autoRow);

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
          clearReviewLog();
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

  // Erase everything — the true nuclear option, kept well clear of Reset
  // progress (which keeps your lines). Two-step, with a back-up-first offer.
  sec.appendChild(buildEraseSubsection());

  return sec;
}

// The "Erase everything" block: a heading, a plain warning, and the button that
// opens the two-step danger dialog. Visually separated from Reset progress so
// the two destructive actions are never confused.
function buildEraseSubsection(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'settings-reset settings-erase';

  const heading = document.createElement('h3');
  heading.className = 'settings-subheading';
  heading.textContent = 'Erase everything';

  const blurb = document.createElement('p');
  blurb.className = 'section-desc';
  blurb.textContent =
    'Delete all your data and start over from scratch — lines, training history, ' +
    'imported games, opponents and preferences. There is no undo.';

  const eraseBtn = document.createElement('button');
  eraseBtn.type = 'button';
  eraseBtn.className = 'btn-danger';
  eraseBtn.appendChild(Icons.trash(16));
  eraseBtn.appendChild(document.createTextNode('Erase everything'));
  eraseBtn.addEventListener('click', openEraseDialog);

  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  actions.appendChild(eraseBtn);

  wrap.appendChild(heading);
  wrap.appendChild(blurb);
  wrap.appendChild(actions);
  return wrap;
}

// ── Erase-everything dialog ────────────────────────────────────────────────────
// A deliberately two-step flow for the one irreversible action in the app.
//
//   Step 1 — explains exactly what goes, and offers a one-tap "export a backup
//            first" right there (the only way any of it comes back), then a
//            Continue that advances rather than erases.
//   Step 2 — the final, danger-styled confirm. Only this actually wipes.
//
// On confirm we empty every IndexedDB store and every obertura.* localStorage
// key, then reload — landing the app in a genuine first-launch state.

function openEraseDialog(): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';

  function close() {
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // Swap the sheet contents in place as we move between steps.
  const setSheet = (sheet: HTMLElement) => {
    overlay.innerHTML = '';
    overlay.appendChild(sheet);
  };

  setSheet(buildEraseStep1(setSheet, close));
  document.body.appendChild(overlay);
}

// Step 1 — what will be erased, plus the back-up-first offer and Continue.
function buildEraseStep1(
  setSheet: (sheet: HTMLElement) => void,
  close: () => void,
): HTMLElement {
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet';

  const h = document.createElement('h3');
  h.className = 'edit-sheet-title';
  h.textContent = 'Erase everything?';
  sheet.appendChild(h);

  const body = document.createElement('p');
  body.className = 'section-desc';
  body.textContent =
    'This permanently deletes everything Obertura keeps on this device: all your ' +
    'lines, every training score and your streak, imported games, scouted ' +
    'opponents, and all preferences. The app returns to a brand-new state.';
  sheet.appendChild(body);

  const warn = document.createElement('p');
  warn.className = 'section-desc';
  warn.textContent =
    'There is no cloud copy. If you might want any of it back, export a backup first.';
  sheet.appendChild(warn);

  const status = document.createElement('p');
  status.className = 'settings-note';
  status.setAttribute('aria-live', 'polite');

  // Export a backup, right here — never closes the dialog.
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'btn-secondary';
  exportBtn.appendChild(Icons.download(16));
  exportBtn.appendChild(document.createTextNode('Export a backup first'));
  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    status.textContent = 'Exporting…';
    try {
      const n = await exportBackupNow();
      status.textContent = `Backup downloaded — ${n} line${n === 1 ? '' : 's'} ✓`;
    } catch (err) {
      status.textContent = `Export failed — ${(err as Error).message}`;
    } finally {
      exportBtn.disabled = false;
    }
  });

  // Continue — advances to the final confirm; does not erase yet.
  const continueBtn = document.createElement('button');
  continueBtn.type = 'button';
  continueBtn.className = 'btn-danger';
  continueBtn.textContent = 'Continue';
  continueBtn.addEventListener('click', () => setSheet(buildEraseStep2(close)));

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'edit-cancel-btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', close);

  const btnRow = document.createElement('div');
  btnRow.className = 'edit-btn-row';
  btnRow.appendChild(continueBtn);
  btnRow.appendChild(cancel);

  sheet.appendChild(exportBtn);
  sheet.appendChild(status);
  sheet.appendChild(btnRow);
  return sheet;
}

// Step 2 — the final danger confirm. This is the only place that erases.
function buildEraseStep2(close: () => void): HTMLElement {
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet';

  const h = document.createElement('h3');
  h.className = 'edit-sheet-title';
  h.textContent = 'Last chance — erase it all?';
  sheet.appendChild(h);

  const body = document.createElement('p');
  body.className = 'section-desc';
  body.textContent =
    'This cannot be undone. The app will close and reopen empty, exactly as if you ' +
    'had just installed it.';
  sheet.appendChild(body);

  const status = document.createElement('p');
  status.className = 'settings-note';
  status.setAttribute('aria-live', 'polite');

  const eraseBtn = document.createElement('button');
  eraseBtn.type = 'button';
  eraseBtn.className = 'btn-danger';
  eraseBtn.textContent = 'Erase everything';
  eraseBtn.addEventListener('click', async () => {
    eraseBtn.disabled = true;
    status.textContent = 'Erasing…';
    try {
      await eraseAllData();
      wipeOberturaLocalStorage();
      // Reload into a true first-launch state — no data, default preferences.
      location.reload();
    } catch (err) {
      status.textContent = `Erase failed — ${(err as Error).message}`;
      eraseBtn.disabled = false;
    }
  });

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'edit-cancel-btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', close);

  const btnRow = document.createElement('div');
  btnRow.className = 'edit-btn-row';
  btnRow.appendChild(eraseBtn);
  btnRow.appendChild(cancel);

  sheet.appendChild(status);
  sheet.appendChild(btnRow);
  return sheet;
}

// Remove every Obertura preference from localStorage. The app's keys all begin
// with "obertura" (both the "obertura." and the older "obertura-" families), so
// a prefix sweep catches them without each module having to expose its keys.
// engineEnabled predates the convention and is cleared explicitly.
function wipeOberturaLocalStorage(): void {
  const doomed: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('obertura')) doomed.push(key);
  }
  for (const key of doomed) localStorage.removeItem(key);
  localStorage.removeItem('engineEnabled');
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
