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
import type { ImportedGame } from './chesscom';
import { getAllGames, getAllLines } from './storage';
import { renderLoadError } from './load-error';
import {
  crossReference,
  type ProgressReport,
  type LineProgress,
  type ProgressWindow,
  type ProgressVerdict,
} from './progress';
import { currentStreak, trainedToday, getTrainingDays } from './streak';
import { openRepertoireMap } from './repertoire-map';
import { DEFAULT_MAP_PLIES, DEEP_MAP_PLIES } from './scout';
import type { MoveNode } from './tree';
import { Icons } from './icons';
import {
  getShowStreakSection,
  getShowActivitySection,
  getActivityExpanded,
  setActivityExpanded,
} from './prefs';

export interface ProgressCallbacks {
  onTrainLine: (lineId: string, inTraining: boolean) => void;
  onOpenLine: (line: Line) => void;
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

  const report = crossReference(games, lines);

  // Two sections are switchable from Settings → Statistics. The Train-header
  // streak pill is separate and unaffected by either toggle.
  if (getShowStreakSection()) renderStreakHero(container);
  renderQuickStats(container, lines);
  if (getShowActivitySection()) renderActivityGrid(container);

  if (lines.length > 0) {
    renderConfidenceChart(container, lines);
    renderRepertoireMapSection(container, lines, cb);
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

  // 7-day mini strip: the day NUMBER in each cell; trained days get a sage fill,
  // today gets a subtle ring. (Streak counting itself is untouched — see streak.ts.)
  const trainingDays = new Set(getTrainingDays());
  const now = new Date();

  const weekGrid = document.createElement('div');
  weekGrid.className = 'stats-week-grid';
  weekGrid.setAttribute('aria-label', 'Last 7 days training');

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = localDateKey(d);
    const trained = trainingDays.has(key);
    const isToday = i === 0;

    const cell = document.createElement('div');
    cell.className = 'stats-week-cell'
      + (trained ? ' stats-week-cell--on' : '')
      + (isToday ? ' stats-week-cell--today' : '');
    cell.setAttribute('aria-label', `${key}: ${trained ? 'trained' : 'not trained'}`);

    const numEl = document.createElement('span');
    numEl.className = 'stats-week-num';
    numEl.textContent = String(d.getDate());
    cell.appendChild(numEl);

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
  for (let i = 0; i < 28; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    if (trainingDays.has(localDateKey(d))) trainedCount++;
  }

  const section = document.createElement('div');
  section.className = 'section';

  // A tappable head with a chevron: the grid collapses behind it, default
  // collapsed, and we remember the choice across visits.
  let expanded = getActivityExpanded();

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'stats-activity-head' + (expanded ? ' stats-activity-head--open' : '');
  head.setAttribute('aria-expanded', String(expanded));

  const h = document.createElement('h2');
  h.className = 'section-title';
  h.textContent = 'Training Activity';
  head.appendChild(h);

  const meta = document.createElement('span');
  meta.className = 'section-meta stats-activity-meta';
  meta.textContent = `${trainedCount} of 28 days`;
  head.appendChild(meta);

  const chev = Icons.chevronDown(18);
  chev.classList.add('stats-activity-chev');
  head.appendChild(chev);
  section.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'stats-activity-grid';
  grid.setAttribute('aria-label', 'Training activity last 28 days');
  grid.hidden = !expanded;

  // Today sits top-left, counting back to 27 days ago at the bottom-right.
  for (let i = 0; i < 28; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = localDateKey(d);
    const trained = trainingDays.has(key);

    const cell = document.createElement('div');
    cell.className = 'stats-activity-cell'
      + (trained ? ' stats-activity-cell--on' : '')
      + (i === 0 ? ' stats-activity-cell--today' : '');
    cell.setAttribute('title', key);
    grid.appendChild(cell);
  }
  section.appendChild(grid);

  head.addEventListener('click', () => {
    expanded = !expanded;
    grid.hidden = !expanded;
    head.classList.toggle('stats-activity-head--open', expanded);
    head.setAttribute('aria-expanded', String(expanded));
    setActivityExpanded(expanded);
  });

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

// Plies in a line's longest variation (root has no move, so its children are
// ply 1). Drives whether the repertoire map can "Go deeper" than the default.
function treeDepth(node: MoveNode): number {
  if (!node.children.length) return 0;
  return 1 + Math.max(...node.children.map(treeDepth));
}

function renderRepertoireMapSection(
  container: HTMLElement,
  lines: Line[],
  cb: ProgressCallbacks,
): void {
  const section = statsSection('Repertoire Map', '');

  const desc = document.createElement('p');
  desc.className = 'rmap-section-desc';
  desc.textContent = 'See your preparation as a branching tree. Tap any move to explore the position and navigate to the builder.';
  section.appendChild(desc);

  const btnRow = document.createElement('div');
  btnRow.className = 'rmap-colour-btns';

  for (const colour of ['white', 'black'] as const) {
    const colourLines = lines.filter(l => l.colour === colour);
    if (!colourLines.length) continue;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `rmap-colour-btn rmap-colour-btn--${colour}`;

    // Branching-tree glyph: a trunk splitting into variations (line icon).
    const icon = Icons.tree(36);
    icon.classList.add('rmap-colour-btn-icon');
    btn.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'rmap-colour-btn-label';
    label.textContent = colour === 'white' ? 'White' : 'Black';
    btn.appendChild(label);

    const lineCount = document.createElement('span');
    lineCount.className = 'rmap-colour-btn-count';
    lineCount.textContent = `${colourLines.length} line${colourLines.length !== 1 ? 's' : ''}`;
    btn.appendChild(lineCount);

    // Lines can run any length; the map shows 20 moves by default and steps to
    // 30 on "Go deeper" — same defaults as the opponent maps, from the full saved
    // trees already on the phone.
    const reach = Math.max(0, ...colourLines.map(l => treeDepth(l.tree)));
    btn.addEventListener('click', () => openRepertoireMap(colourLines, colour, cb.onOpenLine, {
      depth: {
        defaultPlies: DEFAULT_MAP_PLIES,
        deeperPlies: DEEP_MAP_PLIES,
        maxPlies: reach,
        atDepth: () => colourLines,
      },
    }));
    btnRow.appendChild(btn);
  }

  if (!btnRow.children.length) return;
  section.appendChild(btnRow);
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
      scorePct >= 55 ? '#708151' : scorePct >= 45 ? '#d8961f' : '#b4533a';
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
  wrap.className = 'section';

  const head = document.createElement('div');
  head.className = 'section-head';

  const h = document.createElement('h2');
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
      : w.scorePct >= 55 ? '#708151' : w.scorePct >= 45 ? '#d8961f' : '#b4533a';
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
  // Built on the .card + .row component layer, same as My Lines.
  const card = document.createElement('div');
  card.className = 'card stat-card';

  // Row 1: title + verdict badge.
  const head = document.createElement('div');
  head.className = 'row stat-card-head';
  const nameEl = document.createElement('div');
  nameEl.className = 'stat-card-name';
  nameEl.textContent = item.title;
  head.appendChild(nameEl);
  head.appendChild(verdictBadge(item));
  card.appendChild(head);

  // Row 2: colour / family / confidence / in-training chips.
  const meta = document.createElement('div');
  meta.className = 'row stat-card-chips';
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
  card.appendChild(meta);

  // Row 3: before/after compare bars.
  const compareRow = document.createElement('div');
  compareRow.className = 'row stat-card-compare';
  const compare = document.createElement('div');
  compare.className = 'progress-compare';
  if (item.verdict === 'untrained') {
    compare.appendChild(windowRow('So far', item.before, true));
  } else {
    compare.appendChild(windowRow('Before', item.before, false));
    compare.appendChild(windowRow('Since', item.after, false));
  }
  compareRow.appendChild(compare);
  card.appendChild(compareRow);

  // Row 4: plain-language verdict + the Drill/Add action.
  const foot = document.createElement('div');
  foot.className = 'row stat-card-foot';
  const note = document.createElement('div');
  note.className = 'stat-card-note';
  note.textContent = verdictSentence(item);
  foot.appendChild(note);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-secondary stat-card-btn';
  btn.textContent = item.inTraining ? 'Drill' : 'Add';
  btn.addEventListener('click', e => {
    e.stopPropagation();
    cb.onTrainLine(item.lineId, item.inTraining);
  });
  foot.appendChild(btn);
  card.appendChild(foot);

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

