// Statistics screen — ONE scrolling page, three stacked blocks, top to bottom:
//
//   1. STREAK HERO   — big daily streak + rolling 7-day strip, with a collapsible
//                      "Times trained this month" calendar tucked inside it.
//   2. TRAINING      — four tappable quick-stat boxes (each opens a sheet of
//                      shortcuts) and the remembered-vs-failed bar with its own
//                      Week / Month / All selector and tap-for-detail.
//   3. YOUR GAMES    — only when games are imported: a discreet account strip with
//                      refresh, win rate by opening × training (board + open),
//                      win rate over time (filterable line graph), and a tabbed
//                      most/best/worst-scoring list. Otherwise one quiet import card.
//
// Game numbers come from analysis.ts + stats.ts; nothing is invented. Where a
// figure isn't tracked (a "first trained this opening" date), the section shows
// an honest empty state instead of a guess.

import type { Line } from './types';
import type { ImportedGame } from './chesscom';
import { getAllGames, getAllLines } from './storage';
import { renderLoadError } from './load-error';
import { currentStreak, trainedToday, getTrainingDays, getReviewLog } from './streak';
import { analyseGames, openingFamily, UNKNOWN_FAMILY, type OpeningStat } from './analysis';
import {
  masteredLines,
  needsWorkMoves,
  reviewBars,
  winRateByOpening,
  winRateOverTime,
  mostPlayedOpenings,
  bestScoringOpenings,
  worstScoringOpenings,
  type NeedsWorkMove,
  type DayBar,
  type OpeningTrainingRow,
  type TrendPoint,
} from './stats';
import { Icons } from './icons';
import { colourPip, buildPositionCard, lineFinalFen, fenFromUcis } from './card-position';
import { userAvatar } from './avatar';
import { getGamesSource, openImportPanel } from './import-panel';
import { buildEmptyState } from './empty-state';
import { pushBack } from './back-nav';
import {
  getShowStreakSection,
  getShowActivitySection,
  getStatsRange,
  setStatsRange,
  getCalendarExpanded,
  setCalendarExpanded,
  type StatsRange,
} from './prefs';

export interface ProgressCallbacks {
  onTrainLine: (lineId: string, inTraining: boolean) => void;
  onOpenLine: (line: Line) => void;
  // Truly-fresh empty-state routes: jump to Train, or open the builder fresh.
  onStartTraining: () => void;
  onBuildLine: () => void;
  // Seed the builder with a UCI move list (used by win-rate-by-opening when I
  // don't yet have a saved line for that opening — build from a representative game).
  onBuildFromMoves: (ucis: string[], colour: 'white' | 'black') => void;
  // Open the import flow (the Your-games empty card links here).
  onImportGames: () => void;
}

export function renderProgressScreen(container: HTMLElement, cb: ProgressCallbacks): void {
  void doRender(container, cb);
}

async function doRender(container: HTMLElement, cb: ProgressCallbacks): Promise<void> {
  container.innerHTML = '<p class="lines-loading">Loading…</p>';
  let games: ImportedGame[];
  let lines: Line[];
  try {
    [games, lines] = await Promise.all([getAllGames(), getAllLines()]);
  } catch (err) {
    renderLoadError(container, err, () => void doRender(container, cb));
    return;
  }
  container.innerHTML = '';

  // Truly fresh — no lines and no games — has no numbers to show yet. One clean
  // empty state beats a wall of zeroes.
  if (lines.length === 0 && games.length === 0) {
    container.appendChild(buildEmptyState({
      icon: Icons.barChart(28),
      line: 'Your numbers start with your first session.',
      cta: { label: 'Start training', onClick: () => cb.onStartTraining() },
      link: { label: 'or build your first line', onClick: () => cb.onBuildLine() },
    }));
    return;
  }

  // 1. Streak hero (kept as it computed; Settings can hide it). The month calendar
  //    rides inside it as a collapsible row.
  if (getShowStreakSection()) renderStreakHero(container);

  // 2. Training region — always shown.
  renderTrainingRegion(container, lines, cb);

  // 3. Your games region — only when games exist, else one quiet import card.
  if (games.length === 0) {
    renderGamesEmpty(container, cb);
  } else {
    renderGamesRegion(container, games, lines, cb);
  }
}

// ── Small helpers ───────────────────────────────────────────────────────────

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDay(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00`);
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
}

function confidenceDots(c: number): string {
  const n = Math.min(Math.max(c, 0), 5);
  return '●'.repeat(n) + '○'.repeat(5 - n);
}

// Green→amber→brick by how good a win rate is — the shared score-bar palette.
function scoreColour(pct: number): string {
  return pct >= 55 ? '#708151' : pct >= 45 ? '#d8961f' : '#b4533a';
}

function regionTitle(container: HTMLElement, text: string): void {
  const h = document.createElement('h2');
  h.className = 'stats-region-title';
  h.textContent = text;
  container.appendChild(h);
}

function statsSection(title: string, meta = ''): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'section';
  const head = document.createElement('div');
  head.className = 'section-head';
  const h = document.createElement('h3');
  h.className = 'section-title';
  h.textContent = title;
  head.appendChild(h);
  if (meta) {
    const m = document.createElement('span');
    m.className = 'section-meta';
    m.textContent = meta;
    head.appendChild(m);
  }
  wrap.appendChild(head);
  return wrap;
}

// A reusable segmented pill row (range selector, colour toggle, scoring tabs).
function buildSegmented<T extends string>(
  opts: [T, string][],
  current: T,
  onChange: (v: T) => void,
  className = 'stats-range',
): HTMLElement {
  const row = document.createElement('div');
  row.className = className;
  row.setAttribute('role', 'tablist');
  for (const [key, label] of opts) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'stats-range-chip' + (key === current ? ' stats-range-chip--on' : '');
    chip.textContent = label;
    chip.setAttribute('aria-pressed', String(key === current));
    chip.addEventListener('click', () => {
      if (chip.classList.contains('stats-range-chip--on')) return;
      row.querySelectorAll('.stats-range-chip').forEach(c => {
        c.classList.remove('stats-range-chip--on');
        c.setAttribute('aria-pressed', 'false');
      });
      chip.classList.add('stats-range-chip--on');
      chip.setAttribute('aria-pressed', 'true');
      onChange(key);
    });
    row.appendChild(chip);
  }
  return row;
}

// ── 1. Streak hero (+ month-calendar accordion) ─────────────────────────────

function renderStreakHero(container: HTMLElement): void {
  const streak = currentStreak();
  const today = trainedToday();

  const hero = document.createElement('div');
  hero.className = 'stats-streak-hero';

  const main = document.createElement('div');
  main.className = 'stats-streak-main';

  const flame = document.createElement('span');
  flame.className = 'stats-streak-flame';
  flame.setAttribute('aria-hidden', 'true');
  flame.textContent = '🔥';
  main.appendChild(flame);

  const num = document.createElement('span');
  num.className = 'stats-streak-num' + (streak === 0 ? ' stats-streak-num--cold' : '');
  num.textContent = String(streak);
  main.appendChild(num);

  const label = document.createElement('span');
  label.className = 'stats-streak-label';
  label.textContent = 'day streak';
  main.appendChild(label);

  hero.appendChild(main);

  // Rolling 7-day strip: the day NUMBER in each dot with its real WEEKDAY LETTER
  // beneath; today is the rightmost dot (subtle ring), trained days get a fill.
  const trainingDays = new Set(getTrainingDays());
  const now = new Date();
  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  const weekGrid = document.createElement('div');
  weekGrid.className = 'stats-week-grid';
  weekGrid.setAttribute('aria-label', 'Last 7 days training');

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = localDateKey(d);
    const trained = trainingDays.has(key);
    const isToday = i === 0;

    const col = document.createElement('div');
    col.className = 'stats-week-col';

    const cell = document.createElement('div');
    cell.className = 'stats-week-cell'
      + (trained ? ' stats-week-cell--on' : '')
      + (isToday ? ' stats-week-cell--today' : '');
    cell.setAttribute('aria-label', `${key}: ${trained ? 'trained' : 'not trained'}`);

    const numEl = document.createElement('span');
    numEl.className = 'stats-week-num';
    numEl.textContent = String(d.getDate());
    cell.appendChild(numEl);
    col.appendChild(cell);

    const dowEl = document.createElement('span');
    dowEl.className = 'stats-week-dow' + (isToday ? ' stats-week-dow--today' : '');
    dowEl.textContent = DOW[d.getDay()];
    col.appendChild(dowEl);

    weekGrid.appendChild(col);
  }
  hero.appendChild(weekGrid);

  const sub = document.createElement('div');
  sub.className = 'stats-streak-sub';
  if (streak === 0) {
    sub.textContent = 'Train today to start a streak';
  } else if (today) {
    sub.textContent = 'Trained today ✓';
    sub.classList.add('stats-streak-sub--done');
  } else {
    sub.textContent = `Train today to keep your ${streak}-day streak going`;
  }
  hero.appendChild(sub);

  // The month calendar rides at the bottom of the hero as a collapsible row.
  appendCalendarAccordion(hero, now, trainingDays);

  container.appendChild(hero);
}

// A tappable "Times trained this month" row that reveals the month calendar;
// the open/closed choice is remembered across visits (default collapsed).
function appendCalendarAccordion(hero: HTMLElement, now: Date, trainingDays: Set<string>): void {
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let trained = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (trainingDays.has(localDateKey(new Date(year, month, d)))) trained++;
  }

  const wrap = document.createElement('div');
  wrap.className = 'stats-activity';

  let expanded = getCalendarExpanded();

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'stats-activity-head' + (expanded ? ' stats-activity-head--open' : '');
  head.setAttribute('aria-expanded', String(expanded));

  const h = document.createElement('span');
  h.className = 'stats-activity-title';
  h.textContent = 'Times trained this month';
  head.appendChild(h);

  const meta = document.createElement('span');
  meta.className = 'stats-activity-meta';
  meta.textContent = `${trained} day${trained !== 1 ? 's' : ''}`;
  head.appendChild(meta);

  const chev = Icons.chevronDown(18);
  chev.classList.add('stats-activity-chev');
  head.appendChild(chev);
  wrap.appendChild(head);

  const cal = buildMonthCalendar(now, trainingDays);
  cal.hidden = !expanded;
  wrap.appendChild(cal);

  head.addEventListener('click', () => {
    expanded = !expanded;
    cal.hidden = !expanded;
    head.classList.toggle('stats-activity-head--open', expanded);
    head.setAttribute('aria-expanded', String(expanded));
    setCalendarExpanded(expanded);
  });

  hero.appendChild(wrap);
}

function buildMonthCalendar(now: Date, trainingDays: Set<string>): HTMLElement {
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayKey = localDateKey(now);
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cal = document.createElement('div');
  cal.className = 'stats-cal';

  const head = document.createElement('div');
  head.className = 'stats-cal-head';
  for (const d of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) {
    const c = document.createElement('span');
    c.className = 'stats-cal-dow';
    c.textContent = d;
    head.appendChild(c);
  }
  cal.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'stats-cal-grid';
  for (let i = 0; i < firstDow; i++) {
    const blank = document.createElement('span');
    blank.className = 'stats-cal-cell stats-cal-cell--blank';
    grid.appendChild(blank);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = localDateKey(new Date(year, month, d));
    const cell = document.createElement('span');
    cell.className = 'stats-cal-cell'
      + (trainingDays.has(key) ? ' stats-cal-cell--on' : '')
      + (key === todayKey ? ' stats-cal-cell--today' : '');
    cell.textContent = String(d);
    grid.appendChild(cell);
  }
  cal.appendChild(grid);
  return cal;
}

// ── 2. Training region ──────────────────────────────────────────────────────

function renderTrainingRegion(container: HTMLElement, lines: Line[], cb: ProgressCallbacks): void {
  regionTitle(container, 'Training');
  renderQuickStats(container, lines, cb);
  if (getShowActivitySection()) renderRememberedFailed(container);
}

// The four quick-stat boxes — each tappable, opening a sheet of shortcuts.
function renderQuickStats(container: HTMLElement, lines: Line[], cb: ProgressCallbacks): void {
  const inTraining = lines.filter(l => l.inTraining);
  const mastered = masteredLines(lines);
  const needs = needsWorkMoves(lines, 50);

  const row = document.createElement('div');
  row.className = 'stats-quick-row';

  row.appendChild(quickBox('lines', Icons.pawn(18), lines.length, 'Lines',
    () => openLinesSheet(cb, 'All lines', lines, 'No saved lines yet.', cb.onBuildLine)));

  row.appendChild(quickBox('training', Icons.zap(18), inTraining.length, 'In training',
    () => openLinesSheet(cb, 'In training', inTraining, 'No lines in training yet.', cb.onStartTraining)));

  row.appendChild(quickBox('mastered', Icons.star(18), mastered.length, 'Mastered',
    () => openLinesSheet(cb, 'Mastered lines', mastered, 'Nothing mastered yet — keep drilling.', cb.onStartTraining)));

  row.appendChild(quickBox('needs', Icons.alert(18), needs.length, 'Needs work',
    () => openNeedsWorkSheet(cb, needs)));

  container.appendChild(row);
}

function quickBox(kind: string, icon: SVGElement, n: number, label: string, onClick: () => void): HTMLElement {
  const cell = document.createElement('button');
  cell.type = 'button';
  cell.className = `stats-quick-cell stats-quick-cell--${kind}`;

  const iconWrap = document.createElement('span');
  iconWrap.className = 'stats-quick-icon';
  iconWrap.appendChild(icon);
  cell.appendChild(iconWrap);

  const numEl = document.createElement('span');
  numEl.className = 'stats-quick-num';
  numEl.textContent = String(n);
  cell.appendChild(numEl);

  const lblEl = document.createElement('span');
  lblEl.className = 'stats-quick-label';
  lblEl.textContent = label;
  cell.appendChild(lblEl);

  cell.addEventListener('click', onClick);
  return cell;
}

// ── Quick-stat lightbox sheets ──────────────────────────────────────────────

function openSheet(title: string, fill: (body: HTMLElement, close: () => void) => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet';

  const h = document.createElement('h3');
  h.className = 'edit-sheet-title';
  h.textContent = title;
  sheet.appendChild(h);

  const body = document.createElement('div');
  body.className = 'stats-sheet-list';
  sheet.appendChild(body);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  };
  const removeBack = pushBack(close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  fill(body, close);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

function openLinesSheet(
  cb: ProgressCallbacks,
  title: string,
  lines: Line[],
  emptyLine: string,
  emptyCta: () => void,
): void {
  openSheet(title, (body, close) => {
    if (lines.length === 0) {
      body.appendChild(buildEmptyState({
        line: emptyLine,
        cta: { label: 'Start training', onClick: () => { close(); emptyCta(); } },
      }));
      return;
    }
    for (const line of [...lines].sort((a, b) => b.confidence - a.confidence)) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'stats-sheet-card';
      card.appendChild(colourPip(line.colour));

      const text = document.createElement('span');
      text.className = 'stats-sheet-text';
      const name = document.createElement('span');
      name.className = 'stats-sheet-name';
      name.textContent = line.name || line.openingName || 'Untitled line';
      text.appendChild(name);
      const meta = document.createElement('span');
      meta.className = 'stats-sheet-meta';
      meta.textContent = `Confidence ${confidenceDots(line.confidence)}`;
      text.appendChild(meta);
      card.appendChild(text);

      const chev = Icons.chevronRight(18);
      chev.classList.add('stats-sheet-chev');
      card.appendChild(chev);

      card.addEventListener('click', () => { close(); cb.onOpenLine(line); });
      body.appendChild(card);
    }
  });
}

function openNeedsWorkSheet(cb: ProgressCallbacks, moves: NeedsWorkMove[]): void {
  openSheet('Needs work', (body, close) => {
    if (moves.length === 0) {
      body.appendChild(buildEmptyState({
        line: 'No missed moves yet — clean run.',
        cta: { label: 'Start training', onClick: () => { close(); cb.onStartTraining(); } },
      }));
      return;
    }
    for (const m of moves) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'stats-sheet-card stats-sheet-card--needs';
      card.appendChild(colourPip(m.colour));

      const text = document.createElement('span');
      text.className = 'stats-sheet-text';
      const name = document.createElement('span');
      name.className = 'stats-sheet-name';
      name.textContent = `${m.moveNumber}. ${m.san} — ${m.lineName}`;
      text.appendChild(name);
      const meta = document.createElement('span');
      meta.className = 'stats-sheet-meta';
      meta.textContent = `Missed ${m.lapses}×`;
      text.appendChild(meta);
      card.appendChild(text);

      const tag = document.createElement('span');
      tag.className = 'stats-sheet-action';
      tag.textContent = 'Drill';
      card.appendChild(tag);

      card.addEventListener('click', () => { close(); cb.onTrainLine(m.lineId, true); });
      body.appendChild(card);
    }
  });
}

// ── Remembered vs failed (per-day two-tone bar, Week / Month / All) ──────────

function renderRememberedFailed(container: HTMLElement): void {
  const section = document.createElement('div');
  section.className = 'section';

  const head = document.createElement('div');
  head.className = 'section-head';
  const h = document.createElement('h3');
  h.className = 'section-title';
  h.textContent = 'Remembered vs failed';
  head.appendChild(h);
  section.appendChild(head);

  let range = getStatsRange();

  const totals = document.createElement('div');
  totals.className = 'stats-rf-totals';
  section.appendChild(totals);

  section.appendChild(buildSegmented<StatsRange>(
    [['week', 'Week'], ['month', 'Month'], ['all', 'All']],
    range,
    r => { range = r; setStatsRange(r); rebuild(); },
  ));

  const chartEl = document.createElement('div');
  section.appendChild(chartEl);

  const detailEl = document.createElement('div');
  detailEl.className = 'stats-rf-detail';
  section.appendChild(detailEl);

  function rebuild(): void {
    const bars = reviewBars(getReviewLog(), range);
    renderRfTotals(totals, bars);
    renderRfChart(chartEl, detailEl, bars, range);
  }
  rebuild();

  container.appendChild(section);
}

function renderRfTotals(el: HTMLElement, bars: DayBar[]): void {
  el.innerHTML = '';
  const r = bars.reduce((n, b) => n + b.remembered, 0);
  const f = bars.reduce((n, b) => n + b.failed, 0);
  el.appendChild(rfPill('remembered', r, 'remembered'));
  el.appendChild(rfPill('failed', f, 'failed'));
}

function rfPill(kind: 'remembered' | 'failed', n: number, label: string): HTMLElement {
  const pill = document.createElement('span');
  pill.className = `stats-rf-pill stats-rf-pill--${kind}`;
  const num = document.createElement('span');
  num.className = 'stats-rf-pill-num';
  num.textContent = String(n);
  pill.appendChild(num);
  const lbl = document.createElement('span');
  lbl.className = 'stats-rf-pill-label';
  lbl.textContent = label;
  pill.appendChild(lbl);
  return pill;
}

function rfDetailText(bar: DayBar): string {
  const total = bar.remembered + bar.failed;
  const label = bar.isToday ? 'Today' : formatDay(bar.day);
  if (total === 0) return `${label} · no training`;
  const acc = Math.round((bar.remembered / total) * 100);
  return `${label} · ${bar.remembered} remembered · ${bar.failed} failed · ${acc}% recall`;
}

function renderRfChart(chartEl: HTMLElement, detailEl: HTMLElement, bars: DayBar[], range: StatsRange): void {
  chartEl.innerHTML = '';
  detailEl.textContent = '';

  const grand = bars.reduce((n, b) => n + b.remembered + b.failed, 0);
  if (grand === 0) {
    const note = document.createElement('p');
    note.className = 'stats-rf-empty';
    note.textContent = 'No training recorded in this range yet. Your drilled moves show up here from now on.';
    chartEl.appendChild(note);
    return;
  }

  const maxTotal = Math.max(...bars.map(b => b.remembered + b.failed), 1);

  const chart = document.createElement('div');
  chart.className = 'stats-rf-bars';
  chart.style.setProperty('--rf-count', String(bars.length));

  let selected: HTMLElement | null = null;
  const select = (col: HTMLElement, bar: DayBar) => {
    if (selected) selected.classList.remove('stats-rf-col--sel');
    selected = col;
    col.classList.add('stats-rf-col--sel');
    detailEl.textContent = rfDetailText(bar);
  };

  for (const b of bars) {
    const col = document.createElement('button');
    col.type = 'button';
    col.className = 'stats-rf-col' + (b.isToday ? ' stats-rf-col--today' : '');

    const stack = document.createElement('div');
    stack.className = 'stats-rf-stack';
    stack.setAttribute('role', 'img');
    stack.setAttribute('aria-label', `${b.day}: ${b.remembered} remembered, ${b.failed} failed`);

    const total = b.remembered + b.failed;
    if (total > 0) {
      const fill = (total / maxTotal) * 100;
      const failedPart = (b.failed / total) * fill;
      const remembered = document.createElement('div');
      remembered.className = 'stats-rf-seg stats-rf-seg--remembered';
      remembered.style.height = `${fill - failedPart}%`;
      const failed = document.createElement('div');
      failed.className = 'stats-rf-seg stats-rf-seg--failed';
      failed.style.height = `${failedPart}%`;
      // column-reverse builds bottom-up: remembered below, failed on top.
      stack.appendChild(remembered);
      stack.appendChild(failed);
    }
    col.appendChild(stack);

    // Week shows a weekday letter under each column; month/all use a sparse tick
    // row instead (per-column labels clip in narrow columns).
    if (range === 'week') {
      const ax = document.createElement('span');
      ax.className = 'stats-rf-axis';
      ax.textContent = b.dow;
      col.appendChild(ax);
    }

    col.addEventListener('click', () => select(col, b));
    chart.appendChild(col);
  }
  chartEl.appendChild(chart);

  if (range !== 'week') chartEl.appendChild(buildRfTicks(bars));

  // Default the detail to today (the last bar).
  const lastIdx = bars.length - 1;
  select(chart.children[lastIdx] as HTMLElement, bars[lastIdx]);
}

// A handful of evenly-spaced day-of-month ticks under a month/all chart, each
// free to size naturally (so two-digit days never clip).
function buildRfTicks(bars: DayBar[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'stats-rf-ticks';
  const n = bars.length;
  const idxs = [...new Set([0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1])];
  for (const i of idxs) {
    const s = document.createElement('span');
    s.className = 'stats-rf-tick';
    s.textContent = String(bars[i].dom);
    row.appendChild(s);
  }
  return row;
}

// ── 3. Your games region ────────────────────────────────────────────────────

function renderGamesEmpty(container: HTMLElement, cb: ProgressCallbacks): void {
  regionTitle(container, 'Your games');
  const card = document.createElement('div');
  card.className = 'stats-games-empty';

  const text = document.createElement('p');
  text.className = 'stats-games-empty-text';
  text.textContent = 'Import your games to see how your repertoire performs.';
  card.appendChild(text);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-primary stats-games-empty-btn';
  btn.appendChild(Icons.download(15));
  btn.appendChild(document.createTextNode('Import your games'));
  btn.addEventListener('click', () => cb.onImportGames());
  card.appendChild(btn);

  container.appendChild(card);
}

function renderGamesRegion(container: HTMLElement, games: ImportedGame[], lines: Line[], cb: ProgressCallbacks): void {
  regionTitle(container, 'Your games');
  renderGamesIdentity(container, cb);

  const analysis = analyseGames(games, lines);

  renderWinRateByOpening(container, analysis.stats, lines, cb);
  renderWinRateOverTime(container, games, analysis.stats);
  renderScoringTabs(container, analysis.stats);
}

// A discreet account strip: avatar + "username on Platform" + a Refresh button
// that reopens the import flow prefilled and re-renders on success.
function renderGamesIdentity(container: HTMLElement, cb: ProgressCallbacks): void {
  const source = getGamesSource();
  const row = document.createElement('div');
  row.className = 'games-refresh-row stats-games-identity';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'games-refresh-btn';
  btn.appendChild(Icons.reset(15));
  btn.appendChild(document.createTextNode(source ? 'Refresh my games' : 'Import my games'));
  btn.addEventListener('click', () => {
    if (source) {
      openImportPanel({
        platform: source.platform,
        username: source.username,
        onImported: () => void doRender(container, cb),
      });
    } else {
      cb.onImportGames();
    }
  });
  row.appendChild(btn);

  const status = document.createElement('span');
  status.className = 'games-refresh-status';
  status.setAttribute('aria-live', 'polite');
  if (source) {
    status.appendChild(userAvatar(source.avatarUrl, 18));
    const who = document.createElement('span');
    who.className = 'games-refresh-who';
    who.textContent = `${source.username} on ${source.platform === 'lichess' ? 'Lichess' : 'Chess.com'}`;
    status.appendChild(who);
  }
  row.appendChild(status);

  container.appendChild(row);
}

// Win rate by opening, beside my training mastery — each row a position card
// with a miniature and an open/build action.
function renderWinRateByOpening(container: HTMLElement, stats: OpeningStat[], lines: Line[], cb: ProgressCallbacks): void {
  const rows = winRateByOpening(stats, lines);
  if (rows.length === 0) return;

  const section = statsSection('Win rate by opening', 'vs your training');
  const intro = document.createElement('p');
  intro.className = 'stats-detail-intro';
  intro.textContent = 'Your real win rate beside how mastered that opening is in training:';
  section.appendChild(intro);

  // .group drops the section box so the cards stand on their own.
  const list = document.createElement('div');
  list.className = 'group';
  for (const r of rows) list.appendChild(openingCard(r, lines, cb));
  section.appendChild(list);

  container.appendChild(section);
}

function openingCard(row: OpeningTrainingRow, lines: Line[], cb: ProgressCallbacks): HTMLElement {
  // My best (most-confident) saved line for this opening, if any.
  const mine = lines
    .filter(l => l.colour === row.colour && openingFamily(l.openingName) === row.family)
    .sort((a, b) => b.confidence - a.confidence);
  const best = mine[0] ?? null;

  const fen = best ? lineFinalFen(best.tree) : (row.repUcis.length > 0 ? fenFromUcis(row.repUcis) : null);
  const openLabel = best ? 'Open line' : 'Build line';
  const open = () => { if (best) cb.onOpenLine(best); else cb.onBuildFromMoves(row.repUcis, row.colour); };

  const { card, titleRow, content } = buildPositionCard({
    fen,
    orientation: row.colour,
    className: 'stats-otr-card',
    ...(fen && { onMiniClick: open, miniLabel: openLabel }),
  });

  titleRow.appendChild(colourPip(row.colour));
  const name = document.createElement('span');
  name.className = 'pcard-name';
  name.textContent = row.family;
  titleRow.appendChild(name);

  content.appendChild(otrLine('Games', winBar(row.scorePct), `${row.scorePct}% · ${row.games}g`));

  const train = document.createElement('div');
  train.className = 'stats-otr-line';
  const tTag = document.createElement('span');
  tTag.className = 'stats-otr-tag';
  tTag.textContent = 'Training';
  train.appendChild(tTag);
  const tVal = document.createElement('span');
  tVal.className = 'stats-otr-train';
  if (row.lineCount === 0) {
    tVal.classList.add('stats-otr-train--none');
    tVal.textContent = 'Not in your lines yet';
  } else {
    tVal.textContent = `${confidenceDots(row.avgConfidence)}  ${row.masteredCount}/${row.lineCount} mastered`;
  }
  train.appendChild(tVal);
  content.appendChild(train);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-secondary stat-card-btn';
  btn.textContent = openLabel;
  btn.addEventListener('click', e => { e.stopPropagation(); open(); });
  content.appendChild(btn);

  return card;
}

function winBar(pct: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'review-score-bar';
  const fill = document.createElement('div');
  fill.className = 'review-score-fill';
  fill.style.width = `${Math.max(4, pct)}%`;
  fill.style.background = scoreColour(pct);
  wrap.appendChild(fill);
  return wrap;
}

function otrLine(tag: string, bar: HTMLElement, meta: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'stats-otr-line';
  const t = document.createElement('span');
  t.className = 'stats-otr-tag';
  t.textContent = tag;
  row.appendChild(t);
  row.appendChild(bar);
  const m = document.createElement('span');
  m.className = 'stats-otr-meta';
  m.textContent = meta;
  row.appendChild(m);
  return row;
}

// Win rate over time — a filterable monthly line graph (inline SVG, no dependency).
function renderWinRateOverTime(container: HTMLElement, games: ImportedGame[], stats: OpeningStat[]): void {
  const section = statsSection('Win rate over time', '');

  // Controls: opening filter (select) + Overall/White/Black toggle.
  let opening = 'all';
  let colour: 'all' | 'white' | 'black' = 'all';

  const controls = document.createElement('div');
  controls.className = 'stats-trend-controls';

  const families: string[] = [];
  const seen = new Set<string>();
  for (const s of stats) {
    if (s.family !== UNKNOWN_FAMILY && !seen.has(s.family)) { seen.add(s.family); families.push(s.family); }
  }

  const select = document.createElement('select');
  select.className = 'stats-trend-select';
  const allOpt = document.createElement('option');
  allOpt.value = 'all';
  allOpt.textContent = 'All openings';
  select.appendChild(allOpt);
  for (const fam of families) {
    const opt = document.createElement('option');
    opt.value = fam;
    opt.textContent = fam;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => { opening = select.value; rebuild(); });
  controls.appendChild(select);

  controls.appendChild(buildSegmented<'all' | 'white' | 'black'>(
    [['all', 'Overall'], ['white', 'White'], ['black', 'Black']],
    colour,
    c => { colour = c; rebuild(); },
  ));
  section.appendChild(controls);

  const chartWrap = document.createElement('div');
  section.appendChild(chartWrap);

  const detail = document.createElement('div');
  detail.className = 'stats-trend-detail';
  section.appendChild(detail);

  const cap = document.createElement('p');
  cap.className = 'stats-trend-caption';
  cap.textContent = 'Monthly score across your imported games. (First-trained dates aren’t tracked, so the line carries no start marker.)';
  section.appendChild(cap);

  function rebuild(): void {
    let gs = games;
    if (colour !== 'all') gs = gs.filter(g => g.colour === colour);
    if (opening !== 'all') gs = gs.filter(g => openingFamily(g.opening) === opening);
    renderTrendChart(chartWrap, detail, winRateOverTime(gs));
  }
  rebuild();

  container.appendChild(section);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function trendDetailText(p: TrendPoint): string {
  const year = new Date(p.startMs).getFullYear();
  return `${p.label} ${year} · ${p.games} game${p.games !== 1 ? 's' : ''} · ${p.wins}-${p.draws}-${p.losses} · ${p.scorePct}%`;
}

function renderTrendChart(chartWrap: HTMLElement, detailEl: HTMLElement, points: TrendPoint[]): void {
  chartWrap.innerHTML = '';
  detailEl.textContent = '';

  if (points.length < 2) {
    const note = document.createElement('p');
    note.className = 'stats-no-games';
    note.textContent = 'Not enough months of games here yet to chart a trend.';
    chartWrap.appendChild(note);
    return;
  }

  const W = 300, H = 120, padX = 10, padTop = 8, padBottom = 22;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'stats-trend');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Win rate over time');

  const x = (i: number) => padX + (i / (points.length - 1)) * innerW;
  const y = (pct: number) => padTop + (1 - pct / 100) * innerH;

  const mid = document.createElementNS(SVG_NS, 'line');
  mid.setAttribute('x1', String(padX));
  mid.setAttribute('x2', String(W - padX));
  mid.setAttribute('y1', String(y(50)));
  mid.setAttribute('y2', String(y(50)));
  mid.setAttribute('class', 'stats-trend-mid');
  svg.appendChild(mid);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.scorePct).toFixed(1)}`).join(' ');
  const poly = document.createElementNS(SVG_NS, 'path');
  poly.setAttribute('d', path);
  poly.setAttribute('class', 'stats-trend-path');
  poly.setAttribute('fill', 'none');
  svg.appendChild(poly);

  // Point radius scales with that month's game volume.
  const vols = points.map(p => p.games);
  const minV = Math.min(...vols), maxV = Math.max(...vols);
  const radius = (g: number) => maxV === minV ? 3.6 : 2.4 + ((g - minV) / (maxV - minV)) * 3.1;

  const labelEvery = points.length > 8 ? 2 : 1;
  const dots: SVGCircleElement[] = [];
  const select = (i: number) => {
    dots.forEach(d => d.classList.remove('stats-trend-dot--sel'));
    dots[i].classList.add('stats-trend-dot--sel');
    detailEl.textContent = trendDetailText(points[i]);
  };

  points.forEach((p, i) => {
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', x(i).toFixed(1));
    dot.setAttribute('cy', y(p.scorePct).toFixed(1));
    dot.setAttribute('r', radius(p.games).toFixed(1));
    dot.setAttribute('class', 'stats-trend-dot');
    dots.push(dot);
    svg.appendChild(dot);

    // A larger transparent hit target so taps are comfortable.
    const hit = document.createElementNS(SVG_NS, 'circle');
    hit.setAttribute('cx', x(i).toFixed(1));
    hit.setAttribute('cy', y(p.scorePct).toFixed(1));
    hit.setAttribute('r', '12');
    hit.setAttribute('fill', 'transparent');
    hit.style.cursor = 'pointer';
    hit.addEventListener('click', () => select(i));
    svg.appendChild(hit);

    if (i % labelEvery === 0) {
      const lbl = document.createElementNS(SVG_NS, 'text');
      lbl.setAttribute('x', x(i).toFixed(1));
      lbl.setAttribute('y', String(H - 6));
      lbl.setAttribute('text-anchor', 'middle');
      lbl.setAttribute('class', 'stats-trend-label');
      lbl.textContent = p.label;
      svg.appendChild(lbl);
    }
  });

  chartWrap.appendChild(svg);
  select(points.length - 1);
}

// Most played / Best scoring / Worst scoring — one tabbed ranked list.
function renderScoringTabs(container: HTMLElement, stats: OpeningStat[]): void {
  const tabs = [
    { key: 'most', label: 'Most played', items: mostPlayedOpenings(stats), val: (s: OpeningStat) => `${s.games}g`, empty: 'No games yet.' },
    { key: 'best', label: 'Best scoring', items: bestScoringOpenings(stats), val: (s: OpeningStat) => `${s.scorePct}%`, empty: 'Play a few more games to rank your best.' },
    { key: 'worst', label: 'Worst scoring', items: worstScoringOpenings(stats), val: (s: OpeningStat) => `${s.scorePct}%`, empty: 'Play a few more games to rank your worst.' },
  ];
  if (tabs.every(t => t.items.length === 0)) return;

  const section = statsSection('Openings', '');

  const listWrap = document.createElement('div');
  let active = 'most';

  const tabRow = buildSegmented(
    tabs.map(t => [t.key, t.label] as [string, string]),
    active,
    key => { active = key; renderList(); },
    'stats-tabs',
  );
  section.appendChild(tabRow);
  section.appendChild(listWrap);

  function renderList(): void {
    const tab = tabs.find(t => t.key === active)!;
    listWrap.innerHTML = '';
    if (tab.items.length === 0) {
      const note = document.createElement('p');
      note.className = 'stats-rank-empty';
      note.textContent = tab.empty;
      listWrap.appendChild(note);
      return;
    }
    const list = document.createElement('div');
    list.className = 'stats-rank-list';
    for (const s of tab.items) {
      const item = document.createElement('div');
      item.className = 'stats-rank-item';
      const name = document.createElement('span');
      name.className = 'stats-rank-name';
      name.appendChild(colourPip(s.colour));
      const t = document.createElement('span');
      t.textContent = s.family;
      name.appendChild(t);
      item.appendChild(name);
      const val = document.createElement('span');
      val.className = 'stats-rank-val';
      val.textContent = tab.val(s);
      item.appendChild(val);
      list.appendChild(item);
    }
    listWrap.appendChild(list);
  }
  renderList();

  container.appendChild(section);
}
