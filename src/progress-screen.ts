// Statistics screen — "is the training working, and where should I focus?"
//
// Sections, top to bottom:
//   1. Streak hero  — big daily streak + rolling 7-day strip, with the 28-day
//                     training-activity heatmap tucked inside as an accordion row
//   2. Quick stats  — total lines / in training / mastered (compact)
//   3. Win Rate     — per-opening win rate bars (when games are imported)
//   4. Needs Attention — lines that need work (cross-referenced with Chess.com)
//   5. Opening Detail — existing before/after drill cards
//
// The opening Maps used to live here; they moved to the Explore tab (Phase 6).

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
import { Icons } from './icons';
import { openLibrary } from './library';
import { buildEmptyState } from './empty-state';
import {
  getShowStreakSection,
  getShowActivitySection,
  getActivityExpanded,
  setActivityExpanded,
} from './prefs';

export interface ProgressCallbacks {
  onTrainLine: (lineId: string, inTraining: boolean) => void;
  onOpenLine: (line: Line) => void;
  // Empty-state routes: jump to the Train tab, or open the builder on a fresh line.
  onStartTraining: () => void;
  onBuildLine: () => void;
  // Seed the builder with a move sequence (from the opening library), oriented
  // to the chosen colour — backs the "Browse opening library" button up top.
  onOpenInBuilder: (ucis: string[], colour: 'white' | 'black') => void;
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

  // "Browse opening library" leads the screen — a plain full-width button (no
  // card box), always present, even before there are any numbers to show.
  renderLibraryButton(container, cb);

  // Truly fresh — no lines and no games — has no numbers to show yet. One clean
  // empty state beats a wall of zeroes (cold streak, 0/0/0 stats, no-games note).
  if (lines.length === 0 && games.length === 0) {
    container.appendChild(buildEmptyState({
      icon: Icons.barChart(28),
      line: 'Your numbers start with your first session.',
      cta: { label: 'Start training', onClick: () => cb.onStartTraining() },
      link: { label: 'or build your first line', onClick: () => cb.onBuildLine() },
    }));
    return;
  }

  const report = crossReference(games, lines);

  // Two sections are switchable from Settings → Statistics. The activity heatmap
  // now lives as an accordion row inside the streak hero; if the streak card is
  // hidden but the heatmap stays on, it gets a lightweight card of its own so the
  // toggle still works. The Train-header streak pill is separate and unaffected
  // by either toggle.
  const showStreak = getShowStreakSection();
  const showActivity = getShowActivitySection();
  if (showStreak) {
    renderStreakHero(container, showActivity);
  } else if (showActivity) {
    renderActivitySolo(container);
  }

  renderQuickStats(container, lines);

  const needsAttention = computeNeedsAttention(lines, report);

  // Win rate (or its no-games placeholder) → Needs attention → Opening detail.
  if (report.items.length > 0) {
    renderWinRates(container, report);
  } else {
    renderNoGamesNote(container, games.length);
  }

  if (needsAttention.length > 0) {
    renderNeedsAttention(container, needsAttention, cb);
  }

  if (report.items.length > 0) {
    renderOpeningDetail(container, report, cb);
  }
}

// ── Browse opening library (top of screen, a bare button) ─────────────────────

// A standalone full-width button, deliberately NOT wrapped in a .section card,
// so it reads as a simple launcher above the stats. The ~490 KB library dataset
// is lazy-loaded only when it's actually opened, so this is free to render.
function renderLibraryButton(container: HTMLElement, cb: ProgressCallbacks): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'games-refresh-btn stats-library-btn';
  btn.appendChild(Icons.search(15));
  btn.appendChild(document.createTextNode('Browse opening library'));
  btn.addEventListener('click', () => {
    openLibrary((ucis, colour) => cb.onOpenInBuilder(ucis, colour));
  });
  container.appendChild(btn);
}

// ── Local date helper ─────────────────────────────────────────────────────────

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── 1. Streak hero ────────────────────────────────────────────────────────────

function renderStreakHero(container: HTMLElement, showActivity: boolean): void {
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

  // Rolling 7-day strip: the day NUMBER in each dot with its real WEEKDAY LETTER
  // beneath it; today is the rightmost dot (subtle ring), trained days get a sage
  // fill. (Streak counting itself is untouched — see streak.ts.)
  const trainingDays = new Set(getTrainingDays());
  const now = new Date();

  // Sun..Sat single-letter labels, indexed by Date.getDay().
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

  // The 28-day activity heatmap rides at the bottom of the hero as an accordion.
  if (showActivity) renderActivityAccordion(hero);

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

// ── Training activity accordion (28-day heatmap) ──────────────────────────────
//
// A tappable row ("Training activity" + chevron) that reveals a 28-day heatmap.
// Default collapsed; the open/closed choice is remembered across visits. The grid
// is a 7-column CSS grid that fills the card's full width — cells size themselves
// from the container — so it never reads as a narrow rectangle. Normally it rides
// at the bottom of the streak hero; renderActivitySolo gives it its own card when
// the streak hero is switched off.
function renderActivityAccordion(parent: HTMLElement): void {
  const trainingDays = new Set(getTrainingDays());
  const now = new Date();

  // Count trained days in the window
  let trainedCount = 0;
  for (let i = 0; i < 28; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    if (trainingDays.has(localDateKey(d))) trainedCount++;
  }

  const wrap = document.createElement('div');
  wrap.className = 'stats-activity';

  let expanded = getActivityExpanded();

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'stats-activity-head' + (expanded ? ' stats-activity-head--open' : '');
  head.setAttribute('aria-expanded', String(expanded));

  const h = document.createElement('span');
  h.className = 'stats-activity-title';
  h.textContent = 'Training activity';
  head.appendChild(h);

  const meta = document.createElement('span');
  meta.className = 'stats-activity-meta';
  meta.textContent = `${trainedCount} of 28 days`;
  head.appendChild(meta);

  const chev = Icons.chevronDown(18);
  chev.classList.add('stats-activity-chev');
  head.appendChild(chev);
  wrap.appendChild(head);

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
  wrap.appendChild(grid);

  head.addEventListener('click', () => {
    expanded = !expanded;
    grid.hidden = !expanded;
    head.classList.toggle('stats-activity-head--open', expanded);
    head.setAttribute('aria-expanded', String(expanded));
    setActivityExpanded(expanded);
  });

  parent.appendChild(wrap);
}

// When the streak hero is hidden but the activity toggle stays on, the heatmap
// still needs a home — give it a lightweight card of its own.
function renderActivitySolo(container: HTMLElement): void {
  const card = document.createElement('div');
  card.className = 'stats-streak-hero stats-activity-solo';
  renderActivityAccordion(card);
  container.appendChild(card);
}

// ── 4. Needs Attention ────────────────────────────────────────────────────────

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

  // .group drops the section's box so the cards never read as boxes-in-a-box.
  const list = document.createElement('div');
  list.className = 'stats-attention-list group';

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

// ── 3. Win rate by opening ────────────────────────────────────────────────────

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

// ── 5. Opening detail (per-line before/after cards) ───────────────────────────

function renderOpeningDetail(container: HTMLElement, report: ProgressReport, cb: ProgressCallbacks): void {
  const section = statsSection(
    'Opening Detail',
    `${report.linkedLines} line${report.linkedLines !== 1 ? 's' : ''} linked`,
  );

  const intro = document.createElement('div');
  intro.className = 'stats-detail-intro';
  intro.textContent = 'Win rate before vs since you last drilled each line:';
  section.appendChild(intro);

  // .group drops the section's box so the per-line cards stand on their own.
  const list = document.createElement('div');
  list.className = 'group';
  for (const item of report.items) {
    list.appendChild(progressCard(item, cb));
  }
  section.appendChild(list);

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

