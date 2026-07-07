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
  puzzleTotals,
  puzzleAccuracyByOpening,
  type NeedsWorkMove,
  type DayBar,
  type OpeningTrainingRow,
  type TrendPoint,
} from './stats';
import { getPuzzleDays, getPuzzlesByOpening } from './puzzle-log';
import { getPuzzleRating, getRatingHistory, getBestCleanStreak, type RatingPoint } from './puzzle-rating';
import { Icons } from './icons';
import { colourPip, buildPositionCard, lineFinalFen, fenFromUcis } from './card-position';
import { userAvatar } from './avatar';
import { getGamesSource, openImportPanel, platformLabel } from './import-panel';
import { buildEmptyState } from './empty-state';
import { pushBack } from './back-nav';
import { formatMove } from './notation';
import { renderLineChart, renderRecordStrip, type ChartPoint } from './stats-charts';
import {
  getLiveRatings, cachedLiveRatings, fetchLichessRatingHistory, ratingSeriesFromGames,
  dominantTimeClass, clipHistory, TIME_CLASS_ORDER,
  type LiveRatings, type RatingHistoryPoint,
} from './rating-stats';
import { TIME_CLASS_LABELS, type TimeClass } from './import-core';
import { endgamesByCategory } from './endgame-catalog';
import { getEndgameProgress } from './endgame-progress';
import { collectEndgameSpots } from './endgame-scan';
import {
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

  // 1. Streak hero. The month calendar rides inside it as a collapsible row.
  renderStreakHero(container);

  // 2. Training region — always shown.
  renderTrainingRegion(container, lines, cb);

  // 2b. Puzzles region — only when there's something to show (local activity or a
  //     connected Lichess account), so a never-used feature doesn't add zeroes.
  renderPuzzlesRegion(container);

  // 2c. Endgames region — the endgame-puzzle ladder, the classics you've
  //     mastered and the endgames mined from your games. Skipped until any of
  //     those has data.
  renderEndgamesRegion(container, games);

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

// "12 Mar" from a "YYYY-MM-DD" key — the compact x-axis form.
function shortDay(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00`);
  return `${d.getDate()} ${MONTH[d.getMonth()]}`;
}

// First / middle / last x-labels for a series — all a small line chart needs.
function sparseTicks(labels: string[]): { i: number; text: string }[] {
  const n = labels.length;
  if (n < 2) return [];
  const idxs = n > 4 ? [0, Math.floor(n / 2), n - 1] : [0, n - 1];
  return [...new Set(idxs)].map(i => ({ i, text: labels[i] }));
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

// Make a chart browse like a carousel: a horizontal swipe on `el` steps the
// Week / Month / All chips (which stay put as the indicator, like the
// forgotten-moves tabs). Swiping left moves to the next, wider range; the
// chips' own click handlers do the actual switch, so tap and swipe can never
// disagree.
function attachRangeSwipe(el: HTMLElement, chipRow: HTMLElement): void {
  let x0: number | null = null;
  let y0 = 0;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { x0 = null; return; }
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0;
    const dy = t.clientY - y0;
    x0 = null;
    // A deliberate horizontal swipe only — vertical scrolling passes through.
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    const chips = [...chipRow.querySelectorAll<HTMLElement>('.stats-range-chip')];
    const i = chips.findIndex(c => c.classList.contains('stats-range-chip--on'));
    const next = i + (dx < 0 ? 1 : -1);
    if (i >= 0 && next >= 0 && next < chips.length) chips[next].click();
  }, { passive: true });
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
  regionTitle(container, 'Openings');
  renderQuickStats(container, lines, cb);
  // The most-forgotten-move board now lives on the Openings (training) screen,
  // as a per-window carousel with a "Fix it" drill.
  renderRememberedFailed(container);
}

// ── Puzzles region ───────────────────────────────────────────────────────────
//
// Your own on-device puzzle stats: the rating (with its trend), solved/accuracy
// totals, and accuracy-by-opening. All local — no Lichess account needed.

// The puzzle rating block's range filter (Week / Month / All) — kept local to
// this screen, though it now matches the shared StatsRange set.
type PzStatsRange = 'week' | 'month' | 'all';
const PZ_STATS_RANGE_KEY = 'obertura.puzzles.statsRange';
function getPzStatsRange(): PzStatsRange {
  const v = localStorage.getItem(PZ_STATS_RANGE_KEY);
  return v === 'week' || v === 'month' ? v : 'all';
}
function setPzStatsRange(r: PzStatsRange): void {
  try { localStorage.setItem(PZ_STATS_RANGE_KEY, r); } catch { /* non-critical */ }
}
// Earliest day string (inclusive, "YYYY-MM-DD") in a range, or null for "all".
// Day strings compare lexicographically, so a string cutoff is enough.
function pzRangeCutoff(range: PzStatsRange, now: Date = new Date()): string | null {
  if (range === 'all') return null;
  const back = range === 'week' ? 6 : 29; // inclusive of today
  const d = new Date(now);
  d.setDate(d.getDate() - back);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function renderPuzzlesRegion(container: HTMLElement): void {
  const days = getPuzzleDays();
  const byOpening = getPuzzlesByOpening();
  const history = getRatingHistory();
  // Nothing solved yet → no region at all.
  if (days.length === 0 && history.length === 0) return;

  regionTitle(container, 'Puzzles');

  // Puzzle rating with its evolution over time, plus the solved/accuracy totals —
  // one integrated block sharing a single Week / Month / 90 days / All filter. The
  // graph sits on top, the range chips below it, the totals beneath those.
  if (history.length > 0) {
    const section = statsSection('Puzzle rating');

    // Four boxes up top: current rating + best clean run (both range-independent),
    // plus Solved + Accuracy for the selected range. Tapping a day on the chart
    // swaps rating/solved/accuracy to that single day.
    const totals = document.createElement('div');
    totals.className = 'pz-stat-row pz-stat-row--four';
    const ratingCell = puzzleStatCell(Icons.star(18), String(getPuzzleRating()), 'Your rating');
    const streakCell = puzzleStatCell(Icons.zap(18), String(getBestCleanStreak()), 'Best run');
    const solvedCell = puzzleStatCell(Icons.target(18), '0', 'Solved');
    const accCell = puzzleStatCell(Icons.sparkles(18), '—', 'Accuracy');
    totals.appendChild(ratingCell);
    totals.appendChild(streakCell);
    totals.appendChild(solvedCell);
    totals.appendChild(accCell);
    section.appendChild(totals);

    const chartHost = document.createElement('div');
    chartHost.className = 'pz-rating-chart';
    section.appendChild(chartHost);

    // Range chips sit at the bottom (like "Remembered moves over time"); the
    // chart itself swipes between ranges like a carousel.
    let range = getPzStatsRange();
    const rangeChips = buildSegmented<PzStatsRange>(
      [['week', 'Week'], ['month', 'Month'], ['all', 'All']],
      range,
      (r) => { range = r; setPzStatsRange(r); fill(); },
    );
    section.appendChild(rangeChips);
    attachRangeSwipe(chartHost, rangeChips);

    const setCellValue = (cell: HTMLElement, value: string): void => {
      const num = cell.querySelector('.stats-quick-num');
      if (num) num.textContent = value;
    };

    // Tapping a day on the rating line: show that day's rating, solved and accuracy
    // in the boxes (best run stays — it's an all-time figure).
    const onSelectDay = (p: RatingPoint): void => {
      setCellValue(ratingCell, String(p.rating));
      const d = days.find((x) => x.day === p.day);
      const solved = d?.solved ?? 0;
      const attempts = (d?.solved ?? 0) + (d?.failed ?? 0);
      setCellValue(solvedCell, String(solved));
      setCellValue(accCell, attempts ? `${Math.round((100 * solved) / attempts)}%` : '—');
    };

    const fill = (): void => {
      const cutoff = pzRangeCutoff(range);
      // Rating line, clipped to the range (needs ≥2 points to chart).
      chartHost.innerHTML = '';
      const pts = cutoff ? history.filter((p) => p.day >= cutoff) : history;
      if (pts.length >= 2) {
        renderLineChart(chartHost, pts.map((p) => ({ value: p.rating, label: shortDay(p.day) })), {
          ariaLabel: 'Puzzle rating over time',
          xTicks: sparseTicks(pts.map((p) => shortDay(p.day))),
          detailFor: (i) => `${formatDay(pts[i].day)} · rated ${pts[i].rating}`,
          onSelect: (i, userTap) => { if (userTap) onSelectDay(pts[i]); },
        });
      } else {
        const note = document.createElement('p');
        note.className = 'stats-no-games';
        note.textContent = 'Not enough rated days in this range yet to chart a trend.';
        chartHost.appendChild(note);
      }
      // Reset the rating box to the live current rating (a prior day-tap may have
      // left a past value showing), then the range solved + accuracy.
      setCellValue(ratingCell, String(getPuzzleRating()));
      let solved = 0, attempts = 0;
      for (const d of days) {
        if (cutoff && d.day < cutoff) continue;
        solved += d.solved;
        attempts += d.solved + d.failed;
      }
      const accPct = attempts ? Math.round((100 * solved) / attempts) : 0;
      setCellValue(solvedCell, String(solved));
      setCellValue(accCell, attempts ? `${accPct}%` : '—');
    };
    fill();

    container.appendChild(section);
  } else if (days.length > 0) {
    // No rated history yet (casual play only) — just the solved totals, as before.
    let range: StatsRange = getStatsRange();
    const section = statsSection('Solved');
    section.appendChild(buildSegmented<StatsRange>(
      [['week', 'Week'], ['month', 'Month'], ['all', 'All']],
      range,
      (r) => { range = r; setStatsRange(r); fillTotals(); },
    ));
    const body = document.createElement('div');
    const fillTotals = (): void => {
      body.innerHTML = '';
      const t = puzzleTotals(days, range);
      const row = document.createElement('div');
      row.className = 'pz-stat-row';
      row.appendChild(puzzleStatCell(Icons.target(18), String(t.solved), 'Solved'));
      row.appendChild(puzzleStatCell(Icons.sparkles(18), t.attempts ? `${t.accuracyPct}%` : '—', 'Accuracy'));
      body.appendChild(row);
    };
    fillTotals();
    section.appendChild(body);
    container.appendChild(section);
  }

  // Accuracy by opening — which trained openings you're sharp or shaky in.
  const opRows = puzzleAccuracyByOpening(byOpening, 1);
  if (opRows.length > 0) {
    const section = statsSection('Accuracy by opening');
    for (const r of opRows.slice(0, 8)) {
      section.appendChild(otrLine(r.family, winBar(r.accuracyPct), `${r.accuracyPct}% · ${r.attempts}`));
    }
    container.appendChild(section);
  }
}

// ── Endgames region ───────────────────────────────────────────────────────────
//
// Three endgame stories in one region: the endgame-puzzle rating ladder (its
// own Elo, separate from the openings-puzzle one), the classic-endgames
// checklist, and the endgames mined from your imported games. Skipped entirely
// until any of them has data.

function renderEndgamesRegion(container: HTMLElement, games: ImportedGame[]): void {
  const history = getRatingHistory('endgame');
  const progress = getEndgameProgress();
  const spots = collectEndgameSpots(games);
  const hasLadder = history.length > 0;
  const hasPractice = Object.keys(progress).length > 0;
  if (!hasLadder && !hasPractice && spots.length === 0) return;

  regionTitle(container, 'Endgames');

  // Endgame puzzles: rating + best run tiles, and the rating line underneath.
  if (hasLadder) {
    const section = statsSection('Endgame puzzles');
    const tiles = document.createElement('div');
    tiles.className = 'pz-stat-row';
    tiles.appendChild(puzzleStatCell(Icons.flag(18), String(getPuzzleRating('endgame')), 'Endgame rating'));
    tiles.appendChild(puzzleStatCell(Icons.zap(18), String(getBestCleanStreak('endgame')), 'Best run'));
    section.appendChild(tiles);

    if (history.length >= 2) {
      const chartHost = document.createElement('div');
      chartHost.className = 'pz-rating-chart';
      renderLineChart(chartHost, history.map(p => ({ value: p.rating, label: shortDay(p.day) })), {
        ariaLabel: 'Endgame puzzle rating over time',
        xTicks: sparseTicks(history.map(p => shortDay(p.day))),
        detailFor: i => `${formatDay(history[i].day)} · rated ${history[i].rating}`,
      });
      section.appendChild(chartHost);
    }
    container.appendChild(section);
  }

  // Practice: the classics checklist as a meter, and the from-your-games tally.
  const classicIds = endgamesByCategory().flatMap(g => g.items.map(item => item.id));
  const classicsSolved = classicIds.filter(id => progress[id]?.solved).length;
  const playedSpots = spots.filter(ref =>
    (progress[`game:${ref.game.id}:${ref.spot.ply}`]?.attempts ?? 0) > 0).length;
  const slipped = spots.filter(ref => !ref.spot.converted).length;

  if (classicsSolved > 0 || spots.length > 0) {
    const section = statsSection('Endgame practice');

    if (classicIds.length > 0) {
      section.appendChild(meterRow(
        'Classic endgames',
        classicsSolved,
        classicIds.length,
        `${classicsSolved} of ${classicIds.length} solved`,
      ));
    }
    if (spots.length > 0) {
      section.appendChild(meterRow(
        'From your games',
        playedSpots,
        spots.length,
        `${playedSpots} of ${spots.length} played out`,
      ));
      const cap = document.createElement('p');
      cap.className = 'stats-trend-caption';
      cap.textContent = slipped > 0
        ? `${slipped} of those endgames had a result you let slip in the game — the best ones to replay.`
        : 'You converted every endgame the scan found — nothing was let slip.';
      section.appendChild(cap);
    }
    container.appendChild(section);
  }
}

// A labelled progress meter: name + count on one line, the fill bar beneath.
// The track is a lighter step of the same accent, so the state reads across
// the whole bar.
function meterRow(label: string, done: number, total: number, caption: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'stats-meter';

  const head = document.createElement('div');
  head.className = 'stats-meter-head';
  const name = document.createElement('span');
  name.className = 'stats-meter-label';
  name.textContent = label;
  head.appendChild(name);
  const meta = document.createElement('span');
  meta.className = 'stats-meter-meta';
  meta.textContent = caption;
  head.appendChild(meta);
  wrap.appendChild(head);

  const track = document.createElement('div');
  track.className = 'stats-meter-track';
  track.setAttribute('role', 'img');
  track.setAttribute('aria-label', `${label}: ${caption}`);
  const fill = document.createElement('div');
  fill.className = 'stats-meter-fill';
  fill.style.width = `${total > 0 ? Math.round((100 * done) / total) : 0}%`;
  track.appendChild(fill);
  wrap.appendChild(track);

  return wrap;
}

// A display-only stat cell, sharing the training quick-box look but holding a
// string value (so "80%" works as well as a count).
function puzzleStatCell(icon: SVGElement, value: string, label: string): HTMLElement {
  const cell = document.createElement('div');
  cell.className = 'stats-quick-cell stats-quick-cell--readonly';
  const numEl = document.createElement('span');
  numEl.className = 'stats-quick-num';
  numEl.textContent = value;
  cell.appendChild(numEl);
  const iconWrap = document.createElement('span');
  iconWrap.className = 'stats-quick-icon';
  iconWrap.appendChild(icon);
  cell.appendChild(iconWrap);
  const lblEl = document.createElement('span');
  lblEl.className = 'stats-quick-label';
  lblEl.textContent = label;
  cell.appendChild(lblEl);
  return cell;
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

  row.appendChild(quickBox('training', Icons.zap(18), inTraining.length, 'Training',
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

  // Visual order: number first, then icon, then label (DOM order = column order).
  const numEl = document.createElement('span');
  numEl.className = 'stats-quick-num';
  numEl.textContent = String(n);
  cell.appendChild(numEl);

  const iconWrap = document.createElement('span');
  iconWrap.className = 'stats-quick-icon';
  iconWrap.appendChild(icon);
  cell.appendChild(iconWrap);

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
      name.textContent = `${m.moveNumber}. ${formatMove(m.san)} — ${m.lineName}`;
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
  h.textContent = 'Remembered moves over time';
  head.appendChild(h);
  section.appendChild(head);

  let range = getStatsRange();

  const totals = document.createElement('div');
  totals.className = 'stats-rf-totals';
  section.appendChild(totals);

  const chartEl = document.createElement('div');
  chartEl.className = 'stats-rf-chart';
  section.appendChild(chartEl);

  const detailEl = document.createElement('div');
  detailEl.className = 'stats-rf-detail';
  section.appendChild(detailEl);

  // Range chips sit below the chart + caption: they drive only this chart, not
  // the four quick boxes above. The chart itself also swipes between ranges,
  // carousel-style.
  const rangeChips = buildSegmented<StatsRange>(
    [['week', 'Week'], ['month', 'Month'], ['all', 'All']],
    range,
    r => { range = r; setStatsRange(r); rebuild(); },
  );
  section.appendChild(rangeChips);
  attachRangeSwipe(chartEl, rangeChips);

  function rebuild(): void {
    const bars = reviewBars(getReviewLog(), range);
    // The pills default to the whole range; tapping a day swaps them to that day.
    const r = bars.reduce((n, b) => n + b.remembered, 0);
    const f = bars.reduce((n, b) => n + b.failed, 0);
    renderRfTotals(totals, r, f);
    renderRfChart(chartEl, detailEl, bars, range, (bar) => renderRfTotals(totals, bar.remembered, bar.failed));
  }
  rebuild();

  container.appendChild(section);
}

// The remembered / failed / recall pills. Shows whatever counts it's handed — the
// range aggregate by default, or a single tapped day's numbers.
function renderRfTotals(el: HTMLElement, remembered: number, failed: number): void {
  el.innerHTML = '';
  const total = remembered + failed;
  const recall = total ? Math.round((remembered / total) * 100) : 0;
  el.appendChild(rfPill('remembered', String(remembered), 'remembered'));
  el.appendChild(rfPill('failed', String(failed), 'failed'));
  el.appendChild(rfPill('recall', `${recall}%`, 'recall'));
}

function rfPill(kind: 'remembered' | 'failed' | 'recall', value: string, label: string): HTMLElement {
  const pill = document.createElement('span');
  pill.className = `stats-rf-pill stats-rf-pill--${kind}`;
  const num = document.createElement('span');
  num.className = 'stats-rf-pill-num';
  num.textContent = value;
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

function renderRfChart(
  chartEl: HTMLElement,
  detailEl: HTMLElement,
  bars: DayBar[],
  range: StatsRange,
  onPick: (bar: DayBar) => void,
): void {
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

    col.addEventListener('click', () => { select(col, b); onPick(b); });
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

  renderRatingSection(container, games);
  renderRecordSection(container, games);
  renderWinRateByOpening(container, analysis.stats, lines, cb);
  renderWinRateOverTime(container, games, analysis.stats);
  renderScoringTabs(container, analysis.stats);
}

// ── Your rating (current + over time, per time class) ─────────────────────────
//
// Live current ratings come from the account's platform (Chess.com stats API /
// Lichess user API), cached so the screen paints instantly and works offline
// with the last-seen numbers. The history line uses Lichess's rating-history
// API when the account is a Lichess one; for Chess.com it's built from the
// ratings your imported games carry (each refresh extends it).

// Rating-chart range — remembered like the other selectors.
type RatingRange = '3m' | 'year' | 'all';
const RATING_RANGE_KEY = 'obertura.stats.ratingRange';
const RATING_RANGE_DAYS: Record<RatingRange, number | null> = { '3m': 92, year: 366, all: null };
function getRatingRange(): RatingRange {
  const v = localStorage.getItem(RATING_RANGE_KEY);
  return v === '3m' || v === 'all' ? v : 'year';
}
function setRatingRange(r: RatingRange): void {
  try { localStorage.setItem(RATING_RANGE_KEY, r); } catch { /* non-critical */ }
}

// "12 Mar" (or "Mar ’25" once a series spans years) from an epoch-ms day.
function historyLabel(ms: number, spanDays: number): string {
  const d = new Date(ms);
  return spanDays > 330
    ? `${MONTH[d.getMonth()]} ’${String(d.getFullYear() % 100).padStart(2, '0')}`
    : `${d.getDate()} ${MONTH[d.getMonth()]}`;
}

// Chip labels for the time classes ("Classical / Daily" is too long for a chip).
const SHORT_CLASS_LABEL: Record<TimeClass, string> = {
  bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', daily: 'Daily',
};

function renderRatingSection(container: HTMLElement, games: ImportedGame[]): void {
  const source = getGamesSource();
  const cachedLive = source ? cachedLiveRatings(source.platform, source.username) : null;

  // Which time classes are worth a chip: any with imported games or a live rating.
  const classesWithGames = new Set(games.map(g => g.timeClass));
  const chipClasses = TIME_CLASS_ORDER.filter(tc =>
    classesWithGames.has(tc) || cachedLive?.classes[tc]);
  if (chipClasses.length === 0) return;

  const section = statsSection('Your rating', source ? `on ${platformLabel(source.platform)}` : '');

  let tc: TimeClass = dominantTimeClass(games, cachedLive);
  if (!chipClasses.includes(tc)) tc = chipClasses[0];
  let live: LiveRatings | null = cachedLive;
  let lichessHistory: Partial<Record<TimeClass, RatingHistoryPoint[]>> | null = null;
  let range = getRatingRange();

  // Time-class chips (only when there's a choice to make).
  if (chipClasses.length > 1) {
    section.appendChild(buildSegmented<TimeClass>(
      chipClasses.map(c => [c, SHORT_CLASS_LABEL[c]] as [TimeClass, string]),
      tc,
      c => { tc = c; fill(); },
    ));
  }

  // Three tiles: current rating · peak · games played (site numbers when the
  // platform provides them, your imported games otherwise).
  const tiles = document.createElement('div');
  tiles.className = 'pz-stat-row pz-stat-row--rating';
  const currentCell = puzzleStatCell(Icons.trending(18), '—', 'Current rating');
  const peakCell = puzzleStatCell(Icons.star(18), '—', 'Peak');
  const gamesCell = puzzleStatCell(Icons.grid2x2(18), '—', 'Games');
  tiles.appendChild(currentCell);
  tiles.appendChild(peakCell);
  tiles.appendChild(gamesCell);
  section.appendChild(tiles);

  const chartHost = document.createElement('div');
  chartHost.className = 'stats-rating-chart';
  section.appendChild(chartHost);

  const rangeChips = buildSegmented<RatingRange>(
    [['3m', '3 months'], ['year', 'Year'], ['all', 'All']],
    range,
    r => { range = r; setRatingRange(r); fill(); },
  );
  section.appendChild(rangeChips);
  attachRangeSwipe(chartHost, rangeChips);

  const setCell = (cell: HTMLElement, value: string): void => {
    const num = cell.querySelector('.stats-quick-num');
    if (num) num.textContent = value;
  };

  // The full series for the active class, before range clipping: Lichess's API
  // history when we have it, else the imported games' own ratings.
  const seriesFor = (c: TimeClass): RatingHistoryPoint[] => {
    const fromApi = lichessHistory?.[c];
    if (fromApi && fromApi.length >= 2) return fromApi;
    return ratingSeriesFromGames(games, c);
  };

  const fill = (): void => {
    const liveClass = live?.classes[tc];
    const full = seriesFor(tc);
    const clipped = clipHistory(full, RATING_RANGE_DAYS[range]);

    // Tiles: live numbers when the platform gave them, series fallbacks otherwise.
    const latest = full.length ? full[full.length - 1].rating : undefined;
    const current = liveClass?.rating ?? latest;
    setCell(currentCell, current !== undefined ? String(current) : '—');
    const seriesPeak = full.length ? Math.max(...full.map(p => p.rating)) : undefined;
    const peak = liveClass?.best ?? (seriesPeak !== undefined && current !== undefined
      ? Math.max(seriesPeak, current) : seriesPeak);
    setCell(peakCell, peak !== undefined ? String(peak) : '—');
    const playedHere = games.filter(g => g.timeClass === tc).length;
    setCell(gamesCell, String(liveClass?.games ?? playedHere));

    // The chart.
    chartHost.innerHTML = '';
    if (clipped.length >= 2) {
      const spanDays = (clipped[clipped.length - 1].ms - clipped[0].ms) / 86_400_000;
      const pts: ChartPoint[] = clipped.map(p => ({ value: p.rating, label: historyLabel(p.ms, spanDays) }));
      renderLineChart(chartHost, pts, {
        ariaLabel: `${TIME_CLASS_LABELS[tc]} rating over time`,
        xTicks: sparseTicks(pts.map(p => p.label)),
        detailFor: i => `${historyLabel(clipped[i].ms, 0)} ${new Date(clipped[i].ms).getFullYear()} · rated ${clipped[i].rating}`,
      });
    } else {
      const note = document.createElement('p');
      note.className = 'stats-no-games';
      note.textContent = source?.platform === 'lichess'
        ? 'Not enough rating history here yet to chart a trend.'
        : 'Ratings ride along with imported games — refresh (or re-import) your games to fill this chart.';
      chartHost.appendChild(note);
    }
  };
  fill();

  // Freshen the live numbers + (for Lichess) the full history in the background;
  // repaint in place when they land. Both fail soft to what's already painted.
  if (source) {
    void getLiveRatings(source.platform, source.username).then(l => {
      if (l && section.isConnected) { live = l; fill(); }
    });
    if (source.platform === 'lichess') {
      void fetchLichessRatingHistory(source.username).then(h => {
        if (h && section.isConnected) { lichessHistory = h; fill(); }
      });
    }
  }

  container.appendChild(section);
}

// ── Record (W-D-L across the imported games) ──────────────────────────────────
function renderRecordSection(container: HTMLElement, games: ImportedGame[]): void {
  let wins = 0, draws = 0, losses = 0;
  for (const g of games) {
    if (g.result === 'win') wins++;
    else if (g.result === 'draw') draws++;
    else losses++;
  }
  if (wins + draws + losses === 0) return;

  const section = statsSection('Record', `${games.length} imported game${games.length === 1 ? '' : 's'}`);
  const host = document.createElement('div');
  renderRecordStrip(host, { wins, draws, losses });
  section.appendChild(host);
  container.appendChild(section);
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

  const cap = document.createElement('p');
  cap.className = 'stats-trend-caption';
  cap.textContent = 'Monthly score across your imported games — tap the line for any month’s record.';
  section.appendChild(cap);

  function rebuild(): void {
    let gs = games;
    if (colour !== 'all') gs = gs.filter(g => g.colour === colour);
    if (opening !== 'all') gs = gs.filter(g => openingFamily(g.opening) === opening);
    renderTrendChart(chartWrap, winRateOverTime(gs));
  }
  rebuild();

  container.appendChild(section);
}

function trendDetailText(p: TrendPoint): string {
  const year = new Date(p.startMs).getFullYear();
  return `${p.label} ${year} · ${p.games} game${p.games !== 1 ? 's' : ''} · ${p.wins}-${p.draws}-${p.losses} · ${p.scorePct}%`;
}

function renderTrendChart(chartWrap: HTMLElement, points: TrendPoint[]): void {
  chartWrap.innerHTML = '';

  if (points.length < 2) {
    const note = document.createElement('p');
    note.className = 'stats-no-games';
    note.textContent = 'Not enough months of games here yet to chart a trend.';
    chartWrap.appendChild(note);
    return;
  }

  // Fit the axis to the data but always keep the 50% break-even line in view —
  // the one reference that makes a win-rate line readable at a glance.
  const pcts = points.map(p => p.scorePct);
  const lo = Math.max(0, Math.min(...pcts, 45) - 6);
  const hi = Math.min(100, Math.max(...pcts, 55) + 6);

  renderLineChart(chartWrap, points.map(p => ({ value: p.scorePct, label: p.label })), {
    ariaLabel: 'Win rate over time',
    domain: [lo, hi],
    baseline: 50,
    yFmt: v => `${Math.round(v)}%`,
    xTicks: sparseTicks(points.map(p => p.label)),
    detailFor: i => trendDetailText(points[i]),
  });
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
