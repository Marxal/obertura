// Statistics screen — "is the training working, and where should I focus?"
//
// Sections:
//   1. Streak hero  — big daily streak + 7-day mini grid
//   2. Quick stats  — total lines / in training / mastered
//   3. Activity     — 28-day training calendar
//   4. Mastery      — confidence-level bar chart
//   5. Needs Attention — lines that need work (cross-referenced with Chess.com)
//   6. Win Rate     — per-opening win rate bars (when games are imported)
//   7. Opening Detail — existing before/after drill cards
//   8. Self-test link

import type { Line } from './types';
import { getAllGames, getAllLines } from './storage';
import {
  crossReference,
  type ProgressReport,
  type LineProgress,
  type ProgressWindow,
  type ProgressVerdict,
} from './progress';
import { runProgressSelfTest } from './progress.selftest';
import { currentStreak, trainedToday, getTrainingDays } from './streak';
import { openLineMap, openColourMap } from './repertoire-map';

export interface ProgressCallbacks {
  onTrainLine: (lineId: string, inTraining: boolean) => void;
}

// Cached so any card builder can look up a full Line by id when opening the map.
let _lines: Line[] = [];

export function renderProgressScreen(container: HTMLElement, cb: ProgressCallbacks): void {
  void doRender(container, cb);
}

async function doRender(container: HTMLElement, cb: ProgressCallbacks): Promise<void> {
  container.innerHTML = '<p class="lines-loading">Loading…</p>';
  const [games, lines] = await Promise.all([getAllGames(), getAllLines()]);
  container.innerHTML = '';
  _lines = lines;

  const report = crossReference(games, lines);

  // Streak + quick stats always shown regardless of game/line state.
  renderStreakHero(container);
  renderQuickStats(container, lines);
  renderActivityGrid(container);

  if (lines.length > 0) {
    renderConfidenceChart(container, lines);
    renderRepertoireMapSection(container, lines);
  }

  const needsAttention = computeNeedsAttention(lines, report);
  if (needsAttention.length > 0) {
    renderNeedsAttention(container, needsAttention, cb);
  }

  if (report.items.length > 0) {
    renderWinRates(container, report);
    renderOpeningDetail(container, report, cb);
  } else {
    renderNoGamesNote(container, games.length);
  }

  appendSelfTestLink(container);
}

// ── Local date helper ─────────────────────────────────────────────────────────

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── 1. Streak hero ────────────────────────────────────────────────────────────

function renderStreakHero(container: HTMLElement): void {
  const streak = currentStreak();
  const today = trainedToday();

  const hero = document.createElement('div');
  hero.className = 'stats-streak-hero';

  // Main: flame + big number + "day streak" label
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
  label.textContent = streak === 1 ? 'day streak' : 'day streak';
  main.appendChild(label);

  hero.appendChild(main);

  // 7-day mini grid (day letter + filled/empty dot)
  const trainingDays = new Set(getTrainingDays());
  const now = new Date();
  const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  const weekGrid = document.createElement('div');
  weekGrid.className = 'stats-week-grid';
  weekGrid.setAttribute('aria-label', 'Last 7 days training');

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = localDateKey(d);
    const trained = trainingDays.has(key);

    const cell = document.createElement('div');
    cell.className = 'stats-week-cell' + (trained ? ' stats-week-cell--on' : '');
    cell.setAttribute('aria-label', `${key}: ${trained ? 'trained' : 'not trained'}`);

    const dot = document.createElement('span');
    dot.className = 'stats-week-dot';
    cell.appendChild(dot);

    const letter = document.createElement('span');
    letter.className = 'stats-week-letter';
    letter.textContent = DAY_LETTERS[d.getDay()];
    cell.appendChild(letter);

    weekGrid.appendChild(cell);
  }
  hero.appendChild(weekGrid);

  // Subtext
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

// ── 2. Quick stats row ────────────────────────────────────────────────────────

function renderQuickStats(container: HTMLElement, lines: Line[]): void {
  const total = lines.length;
  const inTraining = lines.filter(l => l.inTraining).length;
  const mastered = lines.filter(l => l.confidence >= 5).length;

  const row = document.createElement('div');
  row.className = 'stats-quick-row';

  const stats: [number, string][] = [
    [total, 'Lines'],
    [inTraining, 'Training'],
    [mastered, 'Mastered'],
  ];

  for (const [n, lbl] of stats) {
    const cell = document.createElement('div');
    cell.className = 'stats-quick-cell';

    const numEl = document.createElement('span');
    numEl.className = 'stats-quick-num';
    numEl.textContent = String(n);
    cell.appendChild(numEl);

    const lblEl = document.createElement('span');
    lblEl.className = 'stats-quick-label';
    lblEl.textContent = lbl;
    cell.appendChild(lblEl);

    row.appendChild(cell);
  }

  container.appendChild(row);
}

// ── 3. Training activity (28-day grid) ────────────────────────────────────────

function renderActivityGrid(container: HTMLElement): void {
  const trainingDays = new Set(getTrainingDays());
  const now = new Date();

  // Count trained days in the window
  let trainedCount = 0;
  for (let i = 27; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    if (trainingDays.has(localDateKey(d))) trainedCount++;
  }

  const section = statsSection('Training Activity', `${trainedCount} of 28 days`);

  const grid = document.createElement('div');
  grid.className = 'stats-activity-grid';
  grid.setAttribute('aria-label', 'Training activity last 28 days');

  for (let i = 27; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = localDateKey(d);
    const trained = trainingDays.has(key);

    const cell = document.createElement('div');
    cell.className = 'stats-activity-cell' + (trained ? ' stats-activity-cell--on' : '');
    cell.setAttribute('title', key);
    grid.appendChild(cell);
  }

  section.appendChild(grid);
  container.appendChild(section);
}

// ── 4. Confidence distribution bar chart ─────────────────────────────────────

function renderConfidenceChart(container: HTMLElement, lines: Line[]): void {
  const counts: number[] = [0, 0, 0, 0, 0, 0]; // index = confidence level 0..5
  for (const line of lines) {
    const c = Math.min(5, Math.max(0, Math.round(line.confidence)));
    counts[c]++;
  }
  const maxCount = Math.max(1, ...counts);

  const section = statsSection('Line Mastery', `${lines.length} line${lines.length !== 1 ? 's' : ''}`);
  const chart = document.createElement('div');
  chart.className = 'stats-conf-chart';

  for (let level = 5; level >= 0; level--) {
    const row = document.createElement('div');
    row.className = 'stats-conf-row';

    const dotsEl = document.createElement('span');
    dotsEl.className = 'stats-conf-dots';
    // Two-tone: filled circles + empty circles
    const filled = document.createElement('span');
    filled.className = 'stats-conf-filled';
    filled.textContent = '●'.repeat(level);
    const empty = document.createElement('span');
    empty.className = 'stats-conf-empty';
    empty.textContent = '○'.repeat(5 - level);
    dotsEl.appendChild(filled);
    dotsEl.appendChild(empty);
    row.appendChild(dotsEl);

    const barWrap = document.createElement('div');
    barWrap.className = 'stats-conf-bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'stats-conf-bar';
    bar.style.width = (counts[level] / maxCount * 100) + '%';
    if (level === 0 && counts[level] > 0) bar.classList.add('stats-conf-bar--new');
    barWrap.appendChild(bar);
    row.appendChild(barWrap);

    const cntEl = document.createElement('span');
    cntEl.className = 'stats-conf-count';
    cntEl.textContent = String(counts[level]);
    row.appendChild(cntEl);

    chart.appendChild(row);
  }

  section.appendChild(chart);
  container.appendChild(section);
}

// ── 4b. Repertoire Map section ────────────────────────────────────────────────

function renderRepertoireMapSection(container: HTMLElement, lines: Line[]): void {
  const section = statsSection('Repertoire Map', '');

  const row = document.createElement('div');
  row.className = 'rmap-trigger-row';

  for (const colour of ['white', 'black'] as const) {
    const colourLines = lines.filter(l => l.colour === colour);
    if (!colourLines.length) continue;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rmap-trigger-btn';

    // Colour pip + label + count
    const pip = document.createElement('span');
    pip.className = `colour-pip colour-pip--${colour}`;
    pip.setAttribute('aria-hidden', 'true');
    btn.appendChild(pip);
    btn.appendChild(document.createTextNode(
      `${colour === 'white' ? 'White' : 'Black'} (${colourLines.length})`
    ));

    btn.addEventListener('click', () => openColourMap(colourLines, colour));
    row.appendChild(btn);
  }

  if (!row.children.length) return;
  section.appendChild(row);
  container.appendChild(section);
}

// ── 5. Needs Attention ────────────────────────────────────────────────────────

interface AttentionItem {
  lineId: string;
  title: string;
  reason: string;
  severity: 'danger' | 'warn';
  inTraining: boolean;
}

function computeNeedsAttention(lines: Line[], report: ProgressReport): AttentionItem[] {
  const items: AttentionItem[] = [];
  const seen = new Set<string>();

  // 1. Lines whose Chess.com win rate dropped after drilling — most urgent
  for (const item of report.items) {
    if (item.verdict === 'declined') {
      seen.add(item.lineId);
      const pts = Math.abs(item.delta ?? 0);
      items.push({
        lineId: item.lineId,
        title: item.title,
        reason: `Win rate dropped ${pts} pts since last drill`,
        severity: 'danger',
        inTraining: item.inTraining,
      });
    }
  }

  // 2. In-training lines with low confidence (≤1 out of 5)
  for (const line of lines) {
    if (!line.inTraining || seen.has(line.id)) continue;
    if (line.confidence <= 1) {
      seen.add(line.id);
      const named = line.name?.trim() && line.name !== 'Untitled line';
      items.push({
        lineId: line.id,
        title: named ? line.name.trim() : (line.openingName ?? 'Unnamed line'),
        reason: 'Low confidence — drill to build it up',
        severity: 'warn',
        inTraining: true,
      });
    }
  }

  return items;
}

function renderNeedsAttention(container: HTMLElement, items: AttentionItem[], cb: ProgressCallbacks): void {
  const section = statsSection(
    'Needs Attention',
    `${items.length} line${items.length !== 1 ? 's' : ''}`,
  );

  const list = document.createElement('div');
  list.className = 'stats-attention-list';

  for (const item of items) {
    const card = document.createElement('div');
    card.className = `stats-attention-card stats-attention-card--${item.severity}`;

    const body = document.createElement('div');
    body.className = 'stats-attention-body';

    const titleEl = document.createElement('div');
    titleEl.className = 'stats-attention-title';
    titleEl.textContent = item.title;
    body.appendChild(titleEl);

    const reasonEl = document.createElement('div');
    reasonEl.className = `stats-attention-reason stats-attention-reason--${item.severity}`;
    reasonEl.textContent = item.reason;
    body.appendChild(reasonEl);

    card.appendChild(body);

    const mapBtn = document.createElement('button');
    mapBtn.type = 'button';
    mapBtn.className = 'rmap-line-btn';
    mapBtn.textContent = 'Map';
    mapBtn.addEventListener('click', e => {
      e.stopPropagation();
      const line = _lines.find(l => l.id === item.lineId);
      if (line) openLineMap(line);
    });
    card.appendChild(mapBtn);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'review-build-btn';
    btn.textContent = item.inTraining ? 'Drill' : 'Add';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      cb.onTrainLine(item.lineId, item.inTraining);
    });
    card.appendChild(btn);

    list.appendChild(card);
  }

  section.appendChild(list);
  container.appendChild(section);
}

// ── 6. Win rate by opening ────────────────────────────────────────────────────

function renderWinRates(container: HTMLElement, report: ProgressReport): void {
  // Aggregate all games per opening family across before + after windows
  const families = new Map<string, { games: number; wins: number; draws: number; losses: number }>();
  for (const item of report.items) {
    const agg = families.get(item.family) ?? { games: 0, wins: 0, draws: 0, losses: 0 };
    for (const w of [item.before, item.after]) {
      agg.games += w.games;
      agg.wins += w.wins;
      agg.draws += w.draws;
      agg.losses += w.losses;
    }
    families.set(item.family, agg);
  }

  const sorted = [...families.entries()]
    .sort((a, b) => b[1].games - a[1].games)
    .slice(0, 6);

  if (sorted.length === 0) return;

  const section = statsSection(
    'Win Rate by Opening',
    `${report.totalLinkedGames} game${report.totalLinkedGames !== 1 ? 's' : ''} linked`,
  );

  for (const [family, stats] of sorted) {
    const scorePct = stats.games === 0 ? 0
      : Math.round(((stats.wins + stats.draws / 2) / stats.games) * 100);

    const row = document.createElement('div');
    row.className = 'stats-winrate-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'stats-winrate-name';
    nameEl.textContent = family;
    row.appendChild(nameEl);

    const barWrap = document.createElement('div');
    barWrap.className = 'review-score-bar';
    const fill = document.createElement('div');
    fill.className = 'review-score-fill';
    fill.style.width = `${Math.max(4, scorePct)}%`;
    fill.style.background =
      scorePct >= 55 ? '#2a6b3a' : scorePct >= 45 ? '#d8961f' : '#c0531f';
    barWrap.appendChild(fill);
    row.appendChild(barWrap);

    const meta = document.createElement('span');
    meta.className = 'stats-winrate-meta';
    meta.textContent = `${scorePct}% · ${stats.games}g`;
    row.appendChild(meta);

    section.appendChild(row);
  }

  container.appendChild(section);
}

// ── 7. Opening detail (per-line before/after cards) ───────────────────────────

function renderOpeningDetail(container: HTMLElement, report: ProgressReport, cb: ProgressCallbacks): void {
  const section = statsSection(
    'Opening Detail',
    `${report.linkedLines} line${report.linkedLines !== 1 ? 's' : ''} linked`,
  );

  const intro = document.createElement('div');
  intro.className = 'stats-detail-intro';
  intro.textContent = 'Win rate before vs since you last drilled each line:';
  section.appendChild(intro);

  for (const item of report.items) {
    section.appendChild(progressCard(item, cb));
  }

  container.appendChild(section);
}

// ── No games note ─────────────────────────────────────────────────────────────

function renderNoGamesNote(container: HTMLElement, gameCount: number): void {
  const section = statsSection('Win Rate by Opening', '');
  const note = document.createElement('div');
  note.className = 'stats-no-games';
  note.textContent = gameCount === 0
    ? 'Import your Chess.com games (Settings → Import) to see win rates and which openings need work.'
    : 'None of your imported games match a saved line yet. Build the openings you actually play to unlock cross-referencing.';
  section.appendChild(note);
  container.appendChild(section);
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function statsSection(title: string, meta: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'stats-section';

  const head = document.createElement('div');
  head.className = 'stats-section-head';

  const h = document.createElement('h2');
  h.className = 'stats-section-title';
  h.textContent = title;
  head.appendChild(h);

  if (meta) {
    const m = document.createElement('span');
    m.className = 'stats-section-meta';
    m.textContent = meta;
    head.appendChild(m);
  }

  wrap.appendChild(head);
  return wrap;
}

// ── Verdict badge ────────────────────────────────────────────────────────────────

const VERDICT_LABEL: Record<ProgressVerdict, string> = {
  improved: '↑ Improving',
  declined: '↓ Slipping',
  steady: '→ Holding steady',
  'too-soon': 'Too soon to tell',
  untrained: 'Not drilled yet',
};

function verdictBadge(item: LineProgress): HTMLElement {
  const badge = document.createElement('span');
  badge.className = `progress-verdict progress-verdict--${item.verdict}`;
  let text = VERDICT_LABEL[item.verdict];
  if (item.delta !== null && (item.verdict === 'improved' || item.verdict === 'declined')) {
    const sign = item.delta > 0 ? '+' : '';
    text += ` ${sign}${item.delta} pts`;
  }
  badge.textContent = text;
  return badge;
}

// ── Colour chip ───────────────────────────────────────────────────────────────

function colourChip(colour: 'white' | 'black'): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'tag-chip';
  chip.textContent = colour === 'white' ? '○ White' : '● Black';
  return chip;
}

function confidenceDots(c: number): string {
  const n = Math.min(Math.max(c, 0), 5);
  return '●'.repeat(n) + '○'.repeat(5 - n);
}

// One before/after score row: label + bar + "57% · 4-1-2"
function windowRow(label: string, w: ProgressWindow, muted: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'progress-window';

  const tag = document.createElement('span');
  tag.className = 'progress-window-label';
  tag.textContent = label;
  row.appendChild(tag);

  const bar = document.createElement('div');
  bar.className = 'review-score-bar';
  const fill = document.createElement('div');
  fill.className = 'review-score-fill';
  if (w.games === 0) {
    fill.style.width = '0%';
  } else {
    fill.style.width = `${Math.max(4, Math.min(100, w.scorePct))}%`;
    fill.style.background = muted
      ? '#b8a17f'
      : w.scorePct >= 55 ? '#2a6b3a' : w.scorePct >= 45 ? '#d8961f' : '#c0531f';
  }
  bar.appendChild(fill);
  row.appendChild(bar);

  const text = document.createElement('span');
  text.className = 'review-score-text';
  text.textContent = w.games === 0
    ? 'no games'
    : `${w.scorePct}% · ${w.wins}-${w.draws}-${w.losses}`;
  row.appendChild(text);

  return row;
}

// ── Per-line card (Opening Detail section) ────────────────────────────────────

function progressCard(item: LineProgress, cb: ProgressCallbacks): HTMLElement {
  const card = document.createElement('div');
  card.className = 'line-card review-card';

  const body = document.createElement('div');
  body.className = 'line-card-body review-card-body';

  const head = document.createElement('div');
  head.className = 'progress-card-head';
  const nameEl = document.createElement('div');
  nameEl.className = 'line-card-name';
  nameEl.textContent = item.title;
  head.appendChild(nameEl);
  head.appendChild(verdictBadge(item));
  body.appendChild(head);

  const meta = document.createElement('div');
  meta.className = 'line-card-meta';
  meta.appendChild(colourChip(item.colour));
  if (item.family && item.family !== item.title) {
    const fam = document.createElement('span');
    fam.className = 'review-stat-chip';
    fam.textContent = item.family;
    meta.appendChild(fam);
  }
  const conf = document.createElement('span');
  conf.className = 'review-stat-chip';
  conf.textContent = `Confidence ${confidenceDots(item.confidence)}`;
  meta.appendChild(conf);
  if (item.inTraining) {
    const prep = document.createElement('span');
    prep.className = 'review-stat-chip review-stat-chip--prepped';
    prep.textContent = '✓ in training';
    meta.appendChild(prep);
  }
  body.appendChild(meta);

  const compare = document.createElement('div');
  compare.className = 'progress-compare';
  if (item.verdict === 'untrained') {
    compare.appendChild(windowRow('So far', item.before, true));
  } else {
    compare.appendChild(windowRow('Before', item.before, false));
    compare.appendChild(windowRow('Since', item.after, false));
  }
  body.appendChild(compare);

  const note = document.createElement('div');
  note.className = 'review-dev-score';
  note.textContent = verdictSentence(item);
  body.appendChild(note);

  card.appendChild(body);

  // Small "Map" button to open this line's variation tree.
  const mapBtn = document.createElement('button');
  mapBtn.type = 'button';
  mapBtn.className = 'rmap-line-btn';
  mapBtn.textContent = 'Map';
  mapBtn.addEventListener('click', e => {
    e.stopPropagation();
    const line = _lines.find(l => l.id === item.lineId);
    if (line) openLineMap(line);
  });
  card.appendChild(mapBtn);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'review-build-btn';
  btn.textContent = item.inTraining ? 'Drill' : 'Add';
  btn.addEventListener('click', e => {
    e.stopPropagation();
    cb.onTrainLine(item.lineId, item.inTraining);
  });
  card.appendChild(btn);

  return card;
}

function verdictSentence(item: LineProgress): string {
  switch (item.verdict) {
    case 'improved':
      return `Up ${item.delta} points since you drilled it — keep it in rotation.`;
    case 'declined':
      return `Down ${Math.abs(item.delta ?? 0)} points since your last drill — worth a fresh look.`;
    case 'steady':
      return 'About the same before and after — holding, not moving.';
    case 'too-soon':
      return 'Not enough games on one side yet — play a few more, then check back.';
    case 'untrained':
      return item.inTraining
        ? "In training but not drilled yet — that's your baseline above."
        : 'Add this line to training to start tracking whether drilling helps.';
  }
}

// ── Progress self-test link ───────────────────────────────────────────────────

function appendSelfTestLink(container: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'selftest-wrap';

  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'selftest-link';
  link.textContent = 'Run progress self-test';

  const out = document.createElement('div');
  out.className = 'selftest-output';
  out.hidden = true;

  link.addEventListener('click', () => {
    const results = runProgressSelfTest();
    out.hidden = false;
    out.innerHTML = '';

    const passed = results.filter(r => r.pass).length;
    const head = document.createElement('div');
    head.className = `selftest-head ${passed === results.length ? 'ok' : 'fail'}`;
    head.textContent = `${passed}/${results.length} checks passed`;
    out.appendChild(head);

    for (const r of results) {
      const row = document.createElement('div');
      row.className = `selftest-row ${r.pass ? 'ok' : 'fail'}`;
      row.textContent = `${r.pass ? '✓' : '✗'} ${r.name} — ${r.detail}`;
      out.appendChild(row);
    }
    console.log('[progress self-test]', results);
  });

  wrap.appendChild(link);
  wrap.appendChild(out);
  container.appendChild(wrap);
}
