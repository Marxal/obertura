// Statistics screen — ONE scrolling page, three stacked blocks, top to bottom:
//
//   1. STREAK HERO   — big daily streak + rolling 7-day strip. Unchanged.
//   2. TRAINING      — a time selector (Today/Week/Month) driving the
//                      remembered-vs-failed bar, four tappable quick-stat boxes
//                      (each opens a sheet of shortcuts), and the month "did I
//                      show up?" calendar.
//   3. YOUR GAMES    — only when games are imported: win rate by opening × my
//                      training, win rate over time, where I leave theory, and
//                      most-played vs best-scoring. Otherwise one quiet import card.
//
// Game numbers come from analysis.ts + stats.ts; nothing is invented. Where a
// figure isn't tracked (a "first trained this opening" date), the section shows
// an honest empty state instead of a guess.

import type { Line } from './types';
import type { ImportedGame } from './chesscom';
import { getAllGames, getAllLines } from './storage';
import { renderLoadError } from './load-error';
import { currentStreak, trainedToday, getTrainingDays, getReviewLog } from './streak';
import { analyseGames, type Deviation, type OpeningStat } from './analysis';
import {
  masteredLines,
  needsWorkMoves,
  reviewBars,
  winRateByOpening,
  winRateOverTime,
  mostPlayedOpenings,
  bestScoringOpenings,
  type NeedsWorkMove,
  type OpeningTrainingRow,
  type TrendPoint,
} from './stats';
import { Icons } from './icons';
import { colourPip } from './card-position';
import { buildEmptyState } from './empty-state';
import { pushBack } from './back-nav';
import { getShowStreakSection, getShowActivitySection, getStatsRange, setStatsRange, type StatsRange } from './prefs';

export interface ProgressCallbacks {
  onTrainLine: (lineId: string, inTraining: boolean) => void;
  onOpenLine: (line: Line) => void;
  // Truly-fresh empty-state routes: jump to Train, or open the builder fresh.
  onStartTraining: () => void;
  onBuildLine: () => void;
  // Seed the builder with a UCI move list (used by "Where you leave theory" to
  // drop you at the exact fork so you can save + train it).
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

  // 1. Streak hero (kept exactly as it computed; Settings can hide it).
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

// ── Local date helper ─────────────────────────────────────────────────────────

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function confidenceDots(c: number): string {
  const n = Math.min(Math.max(c, 0), 5);
  return '●'.repeat(n) + '○'.repeat(5 - n);
}

// Green→amber→brick by how good a win rate is — the shared score-bar palette.
function scoreColour(pct: number): string {
  return pct >= 55 ? '#708151' : pct >= 45 ? '#d8961f' : '#b4533a';
}

// ── Region + section scaffolds ─────────────────────────────────────────────────

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

// ── 1. Streak hero ──────────────────────────────────────────────────────────

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

  container.appendChild(hero);
}

// ── 2. Training region ──────────────────────────────────────────────────────

function renderTrainingRegion(container: HTMLElement, lines: Line[], cb: ProgressCallbacks): void {
  regionTitle(container, 'Training');

  const showActivity = getShowActivitySection();
  let range = getStatsRange();

  // The time selector drives the remembered-vs-failed bar below (the region's one
  // genuinely time-series view); the four quick boxes are current-state shortcuts
  // and the calendar is always this month, so neither needs re-rendering on change.
  let rebuildBar: (() => void) | null = null;
  if (showActivity) {
    container.appendChild(buildRangeChips(range, r => {
      range = r;
      setStatsRange(r);
      rebuildBar?.();
    }));
  }

  // Four tappable quick-stat boxes.
  renderQuickStats(container, lines, cb);

  if (showActivity) {
    const barWrap = document.createElement('div');
    container.appendChild(barWrap);
    rebuildBar = () => {
      barWrap.innerHTML = '';
      renderRememberedFailed(barWrap, range);
    };
    rebuildBar();

    renderCalendar(container);
  }
}

// The Today / Week / Month chips.
function buildRangeChips(current: StatsRange, onChange: (r: StatsRange) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'stats-range';
  row.setAttribute('role', 'tablist');
  const opts: [StatsRange, string][] = [['today', 'Today'], ['week', 'Week'], ['month', 'Month']];
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

// A bottom-sheet lightbox (same chrome as the rename/edit sheets), with a title
// and a body the caller fills. Returns nothing; closing is wired to backdrop tap
// and the system back gesture.
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

// A sheet listing lines, each a shortcut that opens that line's preview. Empty
// is never a dead-end: it offers the relevant CTA instead.
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

// A sheet of the moves you fail most. Each card drills the line it lives in.
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

// ── Remembered vs failed (per-day two-tone stacked bar) ──────────────────────

function renderRememberedFailed(container: HTMLElement, range: StatsRange): void {
  const bars = reviewBars(getReviewLog(), range);
  const totalR = bars.reduce((n, b) => n + b.remembered, 0);
  const totalF = bars.reduce((n, b) => n + b.failed, 0);

  const section = statsSection('Remembered vs failed',
    totalR + totalF > 0 ? `${totalR} remembered · ${totalF} failed` : '');

  // Legend.
  const legend = document.createElement('div');
  legend.className = 'stats-rf-legend';
  legend.appendChild(legendItem('remembered', 'Remembered'));
  legend.appendChild(legendItem('failed', 'Failed'));
  section.appendChild(legend);

  if (totalR + totalF === 0) {
    const note = document.createElement('p');
    note.className = 'stats-rf-empty';
    note.textContent = range === 'today'
      ? 'No moves reviewed today yet. Finish a drill and it shows here.'
      : 'No training recorded in this range yet. Your drilled moves show up here from now on.';
    section.appendChild(note);
    container.appendChild(section);
    return;
  }

  const maxTotal = Math.max(...bars.map(b => b.remembered + b.failed), 1);

  const chart = document.createElement('div');
  chart.className = 'stats-rf-bars';
  chart.style.setProperty('--rf-count', String(bars.length));

  bars.forEach((b, i) => {
    const col = document.createElement('div');
    col.className = 'stats-rf-col' + (b.isToday ? ' stats-rf-col--today' : '');

    const stack = document.createElement('div');
    stack.className = 'stats-rf-stack';
    stack.setAttribute('role', 'img');
    stack.setAttribute('aria-label',
      `${b.day}: ${b.remembered} remembered, ${b.failed} failed`);

    const total = b.remembered + b.failed;
    if (total > 0) {
      // Heights are a fraction of the tallest day, so the busiest day fills the
      // track and the rest read proportionally.
      const fill = (total / maxTotal) * 100;
      const failedPart = (b.failed / total) * fill;
      const rememberedPart = fill - failedPart;
      const fail = document.createElement('div');
      fail.className = 'stats-rf-seg stats-rf-seg--failed';
      fail.style.height = `${failedPart}%`;
      const remembered = document.createElement('div');
      remembered.className = 'stats-rf-seg stats-rf-seg--remembered';
      remembered.style.height = `${rememberedPart}%`;
      // Failed sits on top of remembered (stack builds bottom-up via column-reverse).
      stack.appendChild(remembered);
      stack.appendChild(fail);
    }
    col.appendChild(stack);

    // Axis label: weekday letters for a week, sparse day numbers for a month,
    // "Today" for the single-day view.
    const showLabel = range === 'today' || range === 'week'
      || i === 0 || i === bars.length - 1 || b.dom % 5 === 0;
    const axis = document.createElement('span');
    axis.className = 'stats-rf-axis';
    axis.textContent = !showLabel ? '' : range === 'today' ? 'Today' : range === 'week' ? b.dow : String(b.dom);
    col.appendChild(axis);

    chart.appendChild(col);
  });
  section.appendChild(chart);

  container.appendChild(section);
}

function legendItem(kind: 'remembered' | 'failed', label: string): HTMLElement {
  const item = document.createElement('span');
  item.className = 'stats-rf-legend-item';
  const swatch = document.createElement('span');
  swatch.className = `stats-rf-swatch stats-rf-swatch--${kind}`;
  item.appendChild(swatch);
  item.appendChild(document.createTextNode(label));
  return item;
}

// ── Month calendar ("times trained this month") ──────────────────────────────

function renderCalendar(container: HTMLElement): void {
  const trainingDays = new Set(getTrainingDays());
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayKey = localDateKey(now);

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let trainedThisMonth = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (trainingDays.has(localDateKey(new Date(year, month, d)))) trainedThisMonth++;
  }

  const section = statsSection('Times trained this month',
    `${trainedThisMonth} day${trainedThisMonth !== 1 ? 's' : ''}`);

  const head = document.createElement('div');
  head.className = 'stats-cal-head';
  for (const d of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) {
    const c = document.createElement('span');
    c.className = 'stats-cal-dow';
    c.textContent = d;
    head.appendChild(c);
  }
  section.appendChild(head);

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
  section.appendChild(grid);

  container.appendChild(section);
}

// ── 3. Your games region ────────────────────────────────────────────────────

// No games imported: the whole region collapses to one quiet card.
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

  const analysis = analyseGames(games, lines);

  renderWinRateByOpening(container, analysis.stats, lines);
  renderWinRateOverTime(container, games);
  renderLeaveTheory(container, analysis.deviations, lines.length, cb);
  renderRankLists(container, analysis.stats);
}

// Win rate by opening, beside my training mastery for that opening.
function renderWinRateByOpening(container: HTMLElement, stats: OpeningStat[], lines: Line[]): void {
  const rows = winRateByOpening(stats, lines);
  if (rows.length === 0) return;

  const section = statsSection('Win rate by opening', 'vs your training');

  const intro = document.createElement('p');
  intro.className = 'stats-detail-intro';
  intro.textContent = 'Your real win rate beside how mastered that opening is in training:';
  section.appendChild(intro);

  for (const r of rows) section.appendChild(openingTrainingRow(r));
  container.appendChild(section);
}

function openingTrainingRow(r: OpeningTrainingRow): HTMLElement {
  const row = document.createElement('div');
  row.className = 'stats-otr';

  const name = document.createElement('div');
  name.className = 'stats-otr-name';
  name.appendChild(colourPip(r.colour));
  const nameText = document.createElement('span');
  nameText.textContent = r.family;
  name.appendChild(nameText);
  row.appendChild(name);

  // Win-rate bar + score.
  const winRow = document.createElement('div');
  winRow.className = 'stats-otr-line';
  const tag = document.createElement('span');
  tag.className = 'stats-otr-tag';
  tag.textContent = 'Games';
  winRow.appendChild(tag);
  const barWrap = document.createElement('div');
  barWrap.className = 'review-score-bar';
  const fill = document.createElement('div');
  fill.className = 'review-score-fill';
  fill.style.width = `${Math.max(4, r.scorePct)}%`;
  fill.style.background = scoreColour(r.scorePct);
  barWrap.appendChild(fill);
  winRow.appendChild(barWrap);
  const meta = document.createElement('span');
  meta.className = 'stats-otr-meta';
  meta.textContent = `${r.scorePct}% · ${r.games}g`;
  winRow.appendChild(meta);
  row.appendChild(winRow);

  // Training side.
  const trainRow = document.createElement('div');
  trainRow.className = 'stats-otr-line';
  const tTag = document.createElement('span');
  tTag.className = 'stats-otr-tag';
  tTag.textContent = 'Training';
  trainRow.appendChild(tTag);
  const trainVal = document.createElement('span');
  trainVal.className = 'stats-otr-train';
  if (r.lineCount === 0) {
    trainVal.classList.add('stats-otr-train--none');
    trainVal.textContent = 'Not in your lines yet';
  } else {
    trainVal.textContent = `${confidenceDots(r.avgConfidence)}  ${r.masteredCount}/${r.lineCount} mastered`;
  }
  trainRow.appendChild(trainVal);
  row.appendChild(trainRow);

  return row;
}

// Win rate over time — a monthly line graph (inline SVG, no dependency).
function renderWinRateOverTime(container: HTMLElement, games: ImportedGame[]): void {
  const points = winRateOverTime(games);
  const section = statsSection('Win rate over time', '');

  if (points.length < 2) {
    const note = document.createElement('p');
    note.className = 'stats-no-games';
    note.textContent = 'Not enough months of games yet to chart a trend — check back after a few more.';
    section.appendChild(note);
    container.appendChild(section);
    return;
  }

  section.appendChild(buildTrendChart(points));

  // Honest note: we don't track WHEN an opening was first trained, so there's no
  // "started training here" marker to place on the line.
  const cap = document.createElement('p');
  cap.className = 'stats-trend-caption';
  cap.textContent = 'Monthly score across your imported games.';
  section.appendChild(cap);

  container.appendChild(section);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function buildTrendChart(points: TrendPoint[]): SVGSVGElement {
  const W = 300, H = 120, padX = 8, padTop = 8, padBottom = 22;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'stats-trend');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Win rate over time');

  const x = (i: number) => padX + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (pct: number) => padTop + (1 - pct / 100) * innerH;

  // 50% reference line.
  const mid = document.createElementNS(SVG_NS, 'line');
  mid.setAttribute('x1', String(padX));
  mid.setAttribute('x2', String(W - padX));
  mid.setAttribute('y1', String(y(50)));
  mid.setAttribute('y2', String(y(50)));
  mid.setAttribute('class', 'stats-trend-mid');
  svg.appendChild(mid);

  // The line itself.
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.scorePct).toFixed(1)}`).join(' ');
  const poly = document.createElementNS(SVG_NS, 'path');
  poly.setAttribute('d', path);
  poly.setAttribute('class', 'stats-trend-path');
  poly.setAttribute('fill', 'none');
  svg.appendChild(poly);

  // Dots + month labels (label every point when few, else sparsely).
  const labelEvery = points.length > 8 ? 2 : 1;
  points.forEach((p, i) => {
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', x(i).toFixed(1));
    dot.setAttribute('cy', y(p.scorePct).toFixed(1));
    dot.setAttribute('r', '2.6');
    dot.setAttribute('class', 'stats-trend-dot');
    svg.appendChild(dot);

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

  return svg;
}

// Where my real games leave my saved lines.
function renderLeaveTheory(container: HTMLElement, deviations: Deviation[], lineCount: number, cb: ProgressCallbacks): void {
  const top = deviations.slice(0, 6);
  const section = statsSection('Where you leave theory', top.length > 0 ? `${top.length} spot${top.length !== 1 ? 's' : ''}` : '');

  if (top.length === 0) {
    const note = document.createElement('p');
    note.className = 'stats-no-games';
    note.textContent = lineCount === 0
      ? 'Save the openings you play to see where your real games leave your prep.'
      : 'Your games stay inside your prep in the openings on file — nothing leaves theory.';
    section.appendChild(note);
    container.appendChild(section);
    return;
  }

  const list = document.createElement('div');
  list.className = 'group';
  for (const dev of top) list.appendChild(leaveTheoryCard(dev, cb));
  section.appendChild(list);
  container.appendChild(section);
}

function leaveTheoryCard(dev: Deviation, cb: ProgressCallbacks): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card stats-theory-card';

  const body = document.createElement('div');
  body.className = 'stats-theory-body';

  const title = document.createElement('div');
  title.className = 'stats-theory-title';
  const expected = dev.expected.length > 0 ? dev.expected.join(' / ') : '—';
  title.textContent = dev.side === 'you'
    ? `Move ${dev.moveNumber}: you played ${dev.actual} (your line: ${expected})`
    : `Move ${dev.moveNumber}: opponent played ${dev.actual} — outside your prep`;
  body.appendChild(title);

  const sub = document.createElement('div');
  sub.className = 'stats-theory-sub';
  const score = dev.count > 0 ? Math.round(((dev.wins + dev.draws / 2) / dev.count) * 100) : 0;
  sub.textContent = `${dev.family} · ${dev.count} game${dev.count !== 1 ? 's' : ''} · ${score}% · ${dev.wins}-${dev.draws}-${dev.losses}`;
  body.appendChild(sub);

  card.appendChild(body);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-secondary stats-theory-btn';
  btn.textContent = 'Drill this';
  btn.addEventListener('click', () => cb.onBuildFromMoves(dev.prefixUcis, dev.colour));
  card.appendChild(btn);

  return card;
}

// Most played vs best scoring — two short ranked lists.
function renderRankLists(container: HTMLElement, stats: OpeningStat[]): void {
  const most = mostPlayedOpenings(stats);
  const best = bestScoringOpenings(stats);
  if (most.length === 0 && best.length === 0) return;

  const section = statsSection('Most played vs best scoring', '');

  const cols = document.createElement('div');
  cols.className = 'stats-rank';
  cols.appendChild(rankColumn('Most played', most, s => `${s.games}g`));
  cols.appendChild(rankColumn('Best scoring', best, s => `${s.scorePct}%`,
    'Play a few more games to rank your best openings.'));
  section.appendChild(cols);

  container.appendChild(section);
}

function rankColumn(title: string, items: OpeningStat[], value: (s: OpeningStat) => string, emptyNote?: string): HTMLElement {
  const col = document.createElement('div');
  col.className = 'stats-rank-col';

  const h = document.createElement('div');
  h.className = 'stats-rank-title';
  h.textContent = title;
  col.appendChild(h);

  if (items.length === 0) {
    const note = document.createElement('p');
    note.className = 'stats-rank-empty';
    note.textContent = emptyNote ?? 'Nothing yet.';
    col.appendChild(note);
    return col;
  }

  const list = document.createElement('div');
  list.className = 'stats-rank-list';
  for (const s of items) {
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
    val.textContent = value(s);
    item.appendChild(val);
    list.appendChild(item);
  }
  col.appendChild(list);
  return col;
}
