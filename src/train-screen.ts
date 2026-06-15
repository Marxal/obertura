import type { Line } from './types';
import type { MoveNode } from './tree';
import { getAllLines, saveLine } from './storage';
import { startDrill, startPositionsDrill, startTimedDrill } from './drill';
import { selectIndividualPositions } from './individual';
import { Icons } from './icons';
import {
  getTimedBest,
  recordTimedBest,
  getDefaultTrainingMode,
  getShowPausedLines,
  setShowPausedLines,
  TIMED_DURATIONS,
  type TimedMinutes,
} from './prefs';
import { isOpponentTag } from './scout';
import { buildEmptyState } from './empty-state';
import { createFilterBar, type FilterSelection } from './filters';
import { TrainingSession, type SessionItem } from './session';
import {
  userMoveNodes,
  gradeReview,
  newReview,
  qualityFromMisses,
  lineConfidence,
  lineBucket,
  isReviewDue,
  dueLines,
  nextDue,
  describeDue,
  recentlyAddedLines,
  weakestLines,
} from './scheduler';
import {
  recordTrainingDay,
  currentStreak,
  trainedToday,
  recordReviewed,
  reviewedToday,
} from './streak';
import { renderLoadError } from './load-error';
import { buildPositionCard, colourPip, lineFinalFen } from './card-position';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// How the quiet "view line" icon opens a line (in the builder, to step through
// it). An optional atFen opens the builder at that position (used by the drill's
// in-session "Edit" control). Set on every screen entry; held at module scope so
// the many internal doRender(container) calls — which only pass the container —
// keep working.
let onViewLine: ((line: Line, atFen?: string) => void) | null = null;

// The empty-state routes (open the builder; open the import-your-games flow).
// Module scope for the same reason as onViewLine.
let onBuildLine: (() => void) | null = null;
let onImportGames: (() => void) | null = null;

// One missed spot worth revisiting at the end of a session: the position to
// show and the move that should have been played there.
interface Mistake {
  preFen: string;
  expected: MoveNode;
}

// Add a missed position to the review list, de-duplicated by position + answer
// (the same move can be missed twice — e.g. across timed laps — but is only
// worth reviewing once).
function addMistake(
  list: Mistake[],
  keys: Set<string>,
  preFen: string,
  expected: MoveNode,
): void {
  const key = preFen + ' ' + expected.uci;
  if (keys.has(key)) return;
  keys.add(key);
  list.push({ preFen, expected });
}

// ── Screen entry point ──────────────────────────────────────────────────────────

export function renderTrainScreen(
  container: HTMLElement,
  opts: {
    focusLineId?: string;
    autoStart?: boolean;
    onOpenLine?: (line: Line, atFen?: string) => void;
    onBuildLine?: () => void;
    onImportGames?: () => void;
  } = {},
): void {
  onViewLine = opts.onOpenLine ?? null;
  onBuildLine = opts.onBuildLine ?? null;
  onImportGames = opts.onImportGames ?? null;
  void doRender(container, opts.focusLineId, opts.autoStart);
}

async function doRender(
  container: HTMLElement,
  focusLineId?: string,
  autoStart?: boolean,
): Promise<void> {
  container.innerHTML = '<p class="lines-loading">Loading…</p>';
  let allLines: Line[];
  try {
    allLines = await getAllLines();
  } catch (err) {
    renderLoadError(container, err, () => void doRender(container, focusLineId, autoStart));
    return;
  }
  container.innerHTML = '';

  const trainingLines = allLines.filter(l => l.inTraining);

  if (trainingLines.length === 0) {
    renderTrainHead(container);
    renderEmpty(container);
    return;
  }

  // Arrived here from a "Drill" button on another screen: skip the list and
  // drill that one line straight away. When it finishes, the completion panel's
  // "Back to training" returns to the normal (unfocused) Train screen.
  if (focusLineId) {
    const focus = trainingLines.find(l => l.id === focusLineId);
    if (focus) {
      const session = new TrainingSession([focus], { explicit: true });
      runSession(session, container, makeStats());
      return;
    }
  }

  const due = dueLines(trainingLines);

  // Arrived from the Home screen's "Start training": jump straight into a session
  // built from the user's default training mode (Settings), rather than showing
  // the list first. Falls through to the list when the chosen mode has nothing to
  // drill (e.g. "Due now" with nothing due — so the "all caught up" header shows).
  if (autoStart) {
    const session = sessionForDefaultMode(trainingLines, due);
    if (session) {
      runSession(session, container, makeStats());
      return;
    }
  }

  renderTrainHead(container);
  renderHero(container, due, trainingLines);
  renderModeCards(container, trainingLines);
  renderCardList(container, trainingLines, allLines.filter(l => !l.inTraining));
}

// ── Train header (daily streak pill) ──────────────────────────────────────────
//
// The streak pill lives here now — Train is the app's home, so this is the
// daily face of the streak. (The Statistics screen keeps its own streak hero.)

function renderTrainHead(container: HTMLElement): void {
  const head = document.createElement('div');
  head.className = 'train-head';
  head.appendChild(buildStreakPill());
  container.appendChild(head);
}

function buildStreakPill(): HTMLElement {
  const streak = currentStreak();
  const pill = document.createElement('div');
  pill.className = 'streak-pill' + (streak === 0 ? ' streak-pill--cold' : '');

  const flame = document.createElement('span');
  flame.className = 'streak-pill-flame';
  flame.setAttribute('aria-hidden', 'true');
  flame.textContent = '🔥';
  pill.appendChild(flame);

  const label = document.createElement('span');
  label.className = 'streak-pill-label';
  if (streak === 0) {
    label.textContent = 'Start a streak';
    pill.setAttribute('aria-label', 'No training streak yet — train today to start one');
  } else {
    label.textContent = `${streak}-day streak`;
    const todayNote = trainedToday() ? ' Trained today.' : ' Train today to keep it going.';
    pill.setAttribute('aria-label', `${streak}-day training streak.${todayNote}`);
  }
  pill.appendChild(label);

  return pill;
}

// Build the session that "Start training" launches, per the default-mode pref.
// Returns null when the chosen mode has nothing to drill, so the caller can fall
// back to the list/header instead of opening an empty session.
function sessionForDefaultMode(trainingLines: Line[], due: Line[]): TrainingSession | null {
  switch (getDefaultTrainingMode()) {
    case 'recent': {
      const ordered = recentlyAddedLines(trainingLines).slice(0, PICKER_SESSION_CAP);
      return ordered.length ? new TrainingSession(ordered, { explicit: true }) : null;
    }
    case 'weakest': {
      const ordered = weakestLines(trainingLines).slice(0, PICKER_SESSION_CAP);
      return ordered.length ? new TrainingSession(ordered, { explicit: true }) : null;
    }
    default:
      return due.length > 0 ? new TrainingSession(trainingLines) : null;
  }
}

// ── Empty state ───────────────────────────────────────────────────────────────

function renderEmpty(container: HTMLElement): void {
  container.appendChild(buildEmptyState({
    icon: Icons.zap(28),
    line: 'Nothing in training yet.',
    cta: { label: 'Build a line', onClick: () => onBuildLine?.() },
    link: { label: 'or import your games', onClick: () => onImportGames?.() },
  }));
}

// ── Hero: "Due now" · "Reviewed today" ────────────────────────────────────────
//
// The front door. Two compact stats side by side — lines due and today's effort —
// at half the old headline height, with the primary Start button full-width
// below. Same data, calmer footprint. The counts animate up on entry.

// Lines drilled per explicit-mode session, so Fresh/Trouble stay bite-sized.
const PICKER_SESSION_CAP = 12;

function renderHero(container: HTMLElement, due: Line[], allTraining: Line[]): void {
  const hero = document.createElement('div');
  hero.className = 'card train-hero' + (due.length === 0 ? ' train-hero--clear' : '');

  // Two stats in a row: "Due now" and "Reviewed today". Numbers above, labels
  // beneath, each at roughly half the old single big count.
  const stats = document.createElement('div');
  stats.className = 'train-hero-stats';

  const dueNum = document.createElement('span');
  dueNum.className = 'train-hero-stat-num';
  dueNum.textContent = '0';
  stats.appendChild(buildHeroStat('due', dueNum, 'Due now'));
  countUp(dueNum, due.length);

  const revNum = document.createElement('span');
  revNum.className = 'train-hero-stat-num';
  revNum.textContent = '0';
  stats.appendChild(buildHeroStat('reviewed', revNum, 'Reviewed today'));
  countUp(revNum, reviewedToday());

  hero.appendChild(stats);

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'btn-primary train-hero-start';
  if (due.length > 0) {
    start.textContent = 'Start review';
    start.addEventListener('click', () =>
      runSession(new TrainingSession(allTraining), container, makeStats()));
  } else {
    start.textContent = 'All caught up ✓';
    start.disabled = true;
  }
  hero.appendChild(start);

  container.appendChild(hero);
}

// One column of the hero pair: a big-ish number stacked over its label.
function buildHeroStat(kind: 'due' | 'reviewed', num: HTMLElement, label: string): HTMLElement {
  const col = document.createElement('div');
  col.className = `train-hero-stat train-hero-stat--${kind}`;
  col.appendChild(num);
  const lbl = document.createElement('div');
  lbl.className = 'train-hero-stat-label';
  lbl.textContent = label;
  col.appendChild(lbl);
  return col;
}

// ── Mode cards ──────────────────────────────────────────────────────────────────
//
// One clear front door per training mode. Each card carries a line icon, a name,
// a one-line subtitle and a live stat. They replace the old separate buttons and
// the practice picker — same underlying modes, presented as one menu. Room is
// left below for a fifth "Prep" card that arrives with Explore.

function renderModeCards(container: HTMLElement, allTraining: Line[]): void {
  const section = document.createElement('div');
  section.className = 'section mode-cards';

  const label = document.createElement('div');
  label.className = 'section-title';
  label.textContent = 'Practise';
  section.appendChild(label);

  // Quick fixes — the count of due individual moves. Tappable as long as there's
  // anything deep enough to drill (the mode falls back to weak/upcoming moves).
  const duePositions = countDuePositions(allTraining);
  const hasPositions = selectIndividualPositions(allTraining).length > 0;
  section.appendChild(buildModeCard({
    icon: Icons.zap(20),
    name: 'Quick fixes',
    sub: 'single moves you’ve missed',
    stat: duePositions,
    statLabel: duePositions === 1 ? 'due move' : 'due moves',
    disabled: !hasPositions,
    onClick: () => runIndividual(container, allTraining),
  }));

  // Time attack — three timed runs, each with its own personal best.
  section.appendChild(buildTimedCard(container, allTraining, hasPositions));

  // Fresh lines — full runs of the newest lines first.
  section.appendChild(buildModeCard({
    icon: Icons.plus(20),
    name: 'Fresh lines',
    sub: 'full runs of your newest lines',
    onClick: () => runSession(
      new TrainingSession(recentlyAddedLines(allTraining).slice(0, PICKER_SESSION_CAP), { explicit: true }),
      container, makeStats()),
  }));

  // Trouble spots — full runs of the weakest lines first.
  section.appendChild(buildModeCard({
    icon: Icons.trending(20),
    name: 'Trouble spots',
    sub: 'full runs of your weakest lines',
    onClick: () => runSession(
      new TrainingSession(weakestLines(allTraining).slice(0, PICKER_SESSION_CAP), { explicit: true }),
      container, makeStats()),
  }));

  // Prep — full runs of lines prepared against a scouted opponent. Only shown
  // when any opponent-tagged lines are in training.
  const prepLines = allTraining.filter(l => l.tags.some(isOpponentTag));
  if (prepLines.length > 0) {
    section.appendChild(buildModeCard({
      icon: Icons.target(20),
      name: 'Prep',
      sub: 'opponent-tagged lines',
      stat: prepLines.length,
      statLabel: prepLines.length === 1 ? 'line' : 'lines',
      onClick: () => runSession(
        new TrainingSession(prepLines.slice(0, PICKER_SESSION_CAP), { explicit: true }),
        container, makeStats()),
    }));
  }

  container.appendChild(section);
}

// How many individual user-moves are due across the training lines — the live
// stat behind "Quick fixes".
function countDuePositions(lines: Line[], now: Date = new Date()): number {
  let due = 0;
  for (const line of lines) {
    for (const node of userMoveNodes(line.tree, line.colour)) {
      if (isReviewDue(node.review, now)) due++;
    }
  }
  return due;
}

function buildModeCard(o: {
  icon: SVGElement;
  name: string;
  sub: string;
  stat?: number;
  statLabel?: string;
  onClick: () => void;
  disabled?: boolean;
}): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'mode-card' + (o.disabled ? ' mode-card--disabled' : '');
  card.disabled = !!o.disabled;

  const icon = document.createElement('span');
  icon.className = 'mode-card-icon';
  icon.appendChild(o.icon);
  card.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'mode-card-text';
  const name = document.createElement('span');
  name.className = 'mode-card-name';
  name.textContent = o.name;
  const sub = document.createElement('span');
  sub.className = 'mode-card-sub';
  sub.textContent = o.sub;
  text.appendChild(name);
  text.appendChild(sub);
  card.appendChild(text);

  if (o.stat !== undefined) {
    const stat = document.createElement('span');
    stat.className = 'mode-card-stat';
    const num = document.createElement('span');
    num.className = 'mode-card-stat-num';
    num.textContent = '0';
    countUp(num, o.stat);
    const lbl = document.createElement('span');
    lbl.className = 'mode-card-stat-label';
    lbl.textContent = o.statLabel ?? '';
    stat.appendChild(num);
    stat.appendChild(lbl);
    card.appendChild(stat);
  }

  if (!o.disabled) card.addEventListener('click', o.onClick);
  return card;
}

// Time attack: the card body isn't itself tappable — its three duration chips
// are, each starting a run of that length and showing its own personal best.
function buildTimedCard(
  container: HTMLElement,
  allTraining: Line[],
  enabled: boolean,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'mode-card mode-card--timed' + (enabled ? '' : ' mode-card--disabled');

  const head = document.createElement('div');
  head.className = 'mode-card-head';
  const icon = document.createElement('span');
  icon.className = 'mode-card-icon';
  icon.appendChild(Icons.clock(20));
  head.appendChild(icon);
  const text = document.createElement('span');
  text.className = 'mode-card-text';
  const name = document.createElement('span');
  name.className = 'mode-card-name';
  name.textContent = 'Time attack';
  const sub = document.createElement('span');
  sub.className = 'mode-card-sub';
  sub.textContent = 'beat your best in 1, 3 or 5 minutes';
  text.appendChild(name);
  text.appendChild(sub);
  head.appendChild(text);
  card.appendChild(head);

  const chips = document.createElement('div');
  chips.className = 'timed-chips';
  for (const minutes of TIMED_DURATIONS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'timed-chip';
    chip.disabled = !enabled;

    const dur = document.createElement('span');
    dur.className = 'timed-chip-dur';
    dur.textContent = `${minutes}m`;
    chip.appendChild(dur);

    const best = getTimedBest(minutes);
    const bestEl = document.createElement('span');
    bestEl.className = 'timed-chip-best';
    if (best > 0) {
      bestEl.appendChild(document.createTextNode('best '));
      const num = document.createElement('span');
      num.className = 'timed-chip-best-num';
      num.textContent = '0';
      bestEl.appendChild(num);
      countUp(num, best);
    } else {
      bestEl.textContent = '—';
    }
    chip.appendChild(bestEl);

    if (enabled) chip.addEventListener('click', () => runTimed(container, allTraining, minutes));
    chips.appendChild(chip);
  }
  card.appendChild(chips);

  return card;
}

// ── Count-up animation ──────────────────────────────────────────────────────────
//
// A subtle bit of life on screen entry: a number ticks up from 0 to its value
// over half a second, easing to a stop. Honours prefers-reduced-motion (and a
// zero/one target) by just showing the final value.
function countUp(el: HTMLElement, to: number, durationMs = 550): void {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (to <= 1 || reduce) {
    el.textContent = String(to);
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    el.textContent = String(Math.round(eased * to));
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = String(to);
  };
  requestAnimationFrame(step);
}

// ── "In training" list (filter + sort + rows) ────────────────────────────────────
//
// A filter row (colour · status · sort) sits above the list; every choice is
// persisted (prefs.ts) so it survives a reload. Status buckets come straight from
// the scheduler (see lineBucket): Due now / Learning (short intervals or a recent
// miss) / Solid (long intervals). Each row carries the line, a "Train now" primary
// action and two quiet icons — view the line, or remove it from training.

// Persistence key + sort options for the shared filter bar (filters.ts).
const TRAIN_FILTER_KEY = 'obertura.train.filter';
const TRAIN_SORTS = [
  { key: 'weakest', label: 'Weakest' },
  { key: 'oldest', label: 'Oldest trained' },
  { key: 'newest', label: 'Newest' },
  { key: 'name', label: 'A–Z' },
];

// Apply the bar's colour + tag + status selection, then the chosen ordering.
// Tags are OR'd: a line shows if it carries any selected tag (user or opponent).
function viewTrainingLines(lines: Line[], sel: FilterSelection): Line[] {
  let out = lines;
  if (sel.colour !== 'all') out = out.filter(l => l.colour === sel.colour);
  if (sel.tags.length > 0) out = out.filter(l => sel.tags.some(t => l.tags.includes(t)));
  if (sel.status !== 'all') out = out.filter(l => lineBucket(l) === sel.status);
  return sortTrainingLines(out, sel.sort);
}

function sortTrainingLines(lines: Line[], sort: string): Line[] {
  switch (sort) {
    case 'newest':
      return recentlyAddedLines(lines);
    case 'name':
      return [...lines].sort((a, b) =>
        (a.name || 'Untitled line').localeCompare(b.name || 'Untitled line'));
    case 'oldest':
      // Oldest trained first; never-trained lines (no timestamp) lead.
      return [...lines].sort((a, b) => trainedTime(a) - trainedTime(b));
    case 'weakest':
    default:
      return weakestLines(lines);
  }
}

function trainedTime(line: Line): number {
  return line.lastTrained ? new Date(line.lastTrained).getTime() : 0;
}

function renderCardList(container: HTMLElement, trainingLines: Line[], pausedLines: Line[]): void {
  const section = document.createElement('div');
  section.className = 'section';

  // Paused lines (out of training) show by default, dimmed with their switch
  // off; a quiet header toggle hides them. Pausing/resuming flips a card in
  // place — no re-render — so the page never jumps. The toggle just flips a CSS
  // class on the list, so it never re-renders either. State persists.
  let showPaused = getShowPausedLines();

  const head = document.createElement('div');
  head.className = 'section-head';
  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = 'In training';
  head.appendChild(heading);

  // The list itself; paused rows live in it always, shown/hidden via CSS.
  const listEl = document.createElement('div');
  listEl.className = 'train-lines group' + (showPaused ? '' : ' train-lines--hide-paused');

  if (pausedLines.length > 0) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'train-show-paused';
    const syncToggle = () => {
      toggle.classList.toggle('active', showPaused);
      toggle.setAttribute('aria-pressed', String(showPaused));
      toggle.textContent = showPaused ? 'Hide paused' : 'Show paused';
    };
    syncToggle();
    toggle.addEventListener('click', () => {
      showPaused = !showPaused;
      setShowPausedLines(showPaused);
      listEl.classList.toggle('train-lines--hide-paused', !showPaused);
      syncToggle();
      // Rebuild so the "nothing here" note reflects what's now visible; only the
      // list's contents change, so the page doesn't jump.
      rebuildList();
    });
    head.appendChild(toggle);
  }
  section.appendChild(head);

  // The shared two-row filter bar (filters.ts). It owns and persists the
  // selection; we read filter.selection on every rebuild and do the filtering
  // here. My own tags lead the chip row, vs-opponent tags follow, status pills
  // close it.
  // Tag chips cover every shown line — paused included, since they're listed too.
  const allShown = [...trainingLines, ...pausedLines];
  const filter = createFilterBar({
    persistKey: TRAIN_FILTER_KEY,
    sorts: TRAIN_SORTS,
    defaultSort: 'weakest',
    userTags: distinctUserTags(allShown),
    opponentTags: distinctOpponentTags(allShown),
    status: true,
    onChange: () => rebuildList(),
  });

  function rebuildList(): void {
    listEl.innerHTML = '';
    const inTraining = viewTrainingLines(trainingLines, filter.selection);
    // Paused rows are always built; CSS (.train-lines--hide-paused) shows/hides
    // them, and a card flipped to paused settles into view (or out) in place.
    const paused = viewTrainingLines(pausedLines, filter.selection);
    const visible = inTraining.length + (showPaused ? paused.length : 0);
    if (visible === 0) {
      const note = document.createElement('p');
      note.className = 'train-lines-empty';
      note.textContent = 'No lines match these filters.';
      listEl.appendChild(note);
      return;
    }
    // In-training rows first; paused rows follow, dimmed with their switch off.
    for (const line of inTraining) listEl.appendChild(buildTrainRow(line, container));
    for (const line of paused) listEl.appendChild(buildTrainRow(line, container));
  }

  section.appendChild(filter.element);
  rebuildList();
  section.appendChild(listEl);
  container.appendChild(section);
}

// Every distinct opponent tag ("vs <name>") across the training lines, sorted.
function distinctOpponentTags(lines: Line[]): string[] {
  const set = new Set<string>();
  for (const l of lines) for (const t of l.tags) if (isOpponentTag(t)) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

// Every distinct user-authored tag (everything that isn't a "vs <name>" tag).
function distinctUserTags(lines: Line[]): string[] {
  const set = new Set<string>();
  for (const l of lines) for (const t of l.tags) if (!isOpponentTag(t)) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function buildTrainRow(line: Line, container: HTMLElement): HTMLElement {
  const bucket = lineBucket(line);

  // Shared position-card scaffold: title + colour pip on row 1, a miniature on
  // the left of row 2 with the meta + actions on the right. The board respects
  // the same global "show miniatures" Settings toggle as the other listings.
  const { card, titleRow, content } = buildPositionCard({
    fen: lineFinalFen(line.tree),
    orientation: line.colour,
    className: 'train-row' + (bucket !== 'due' ? ' line-card--rested' : ''),
  });

  // Paused rows (revealed by "Show paused") read dimmed, switch off.
  if (!line.inTraining) card.classList.add('train-row--paused');

  // Title row — colour pip + the line name.
  titleRow.appendChild(colourPip(line.colour));
  const nameEl = document.createElement('span');
  nameEl.className = 'pcard-name';
  nameEl.textContent = line.name || 'Untitled line';
  titleRow.appendChild(nameEl);

  // Meta line (status · next due). Colour is already shown by the pip above.
  const meta = document.createElement('div');
  meta.className = 'line-card-meta train-row-meta';

  const statusChip = document.createElement('span');
  statusChip.className = `status-chip status-chip--${bucket}`;
  statusChip.textContent = bucket === 'due' ? 'Due' : bucket === 'learning' ? 'Learning' : 'Solid';
  meta.appendChild(statusChip);

  const dueSpan = document.createElement('span');
  dueSpan.className = 'training-stat';
  dueSpan.textContent = describeDue(nextDue(line));
  meta.appendChild(dueSpan);

  content.appendChild(meta);

  // Actions — a clear primary plus two quiet icons.
  const actions = document.createElement('div');
  actions.className = 'train-row-actions';

  const train = document.createElement('button');
  train.type = 'button';
  train.className = 'btn-primary train-row-train';
  train.textContent = 'Train now';
  train.addEventListener('click', () => {
    const session = new TrainingSession([line], { explicit: true });
    runSession(session, container, makeStats());
  });
  actions.appendChild(train);

  const view = document.createElement('button');
  view.type = 'button';
  view.className = 'dline-icon train-row-view';
  view.setAttribute('aria-label', 'View line');
  view.title = 'View line';
  view.appendChild(Icons.eye(18));
  view.addEventListener('click', () => onViewLine?.(line));
  actions.appendChild(view);

  // The one training control — the exact In-training switch My Lines uses. ON
  // here means "in the drill pool". Flicking it just flips the card in place
  // (dim + switch), exactly like My Lines: no re-render, so the page never
  // jumps. A paused line stays put, dimmed; if paused lines are hidden it slips
  // out via CSS. The switch itself is the (reversible) undo.
  actions.appendChild(buildTrainingSwitch(line, card));

  content.appendChild(actions);

  return card;
}

// The In-training switch, identical in markup to the My Lines control so it
// looks and behaves the same everywhere.
function buildTrainingSwitch(line: Line, row: HTMLElement): HTMLElement {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'dline-toggle train-row-toggle';
  applySwitchState(toggle, row, line.inTraining);

  const sw = document.createElement('span');
  sw.className = 'dline-switch';
  const knob = document.createElement('span');
  knob.className = 'dline-switch-knob';
  sw.appendChild(knob);
  toggle.appendChild(sw);

  const label = document.createElement('span');
  label.className = 'dline-toggle-label';
  toggle.appendChild(label);
  applySwitchLabel(toggle, line.inTraining);

  toggle.addEventListener('click', () => void toggleTraining(line, row, toggle));
  return toggle;
}

// Flip a line in/out of the drill pool, updating its card in place — no
// re-render, so the page keeps its scroll position (matching My Lines).
async function toggleTraining(line: Line, row: HTMLElement, toggle: HTMLElement): Promise<void> {
  const next = !line.inTraining;
  await saveLine({ ...line, inTraining: next });
  line.inTraining = next; // keep the in-memory line in step for repeat flicks
  applySwitchState(toggle, row, next);
  applySwitchLabel(toggle, next);
}

// Paint the switch + its row for the given on/off state. A paused row reads
// dimmed (and, when paused lines are hidden, drops out via CSS).
function applySwitchState(toggle: HTMLElement, row: HTMLElement, inTraining: boolean): void {
  toggle.classList.toggle('dline-toggle--on', inTraining);
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', String(inTraining));
  toggle.setAttribute('aria-label', inTraining ? 'In training' : 'Paused');
  row.classList.toggle('train-row--paused', !inTraining);
}

function applySwitchLabel(toggle: HTMLElement, inTraining: boolean): void {
  const label = toggle.querySelector('.dline-toggle-label');
  if (label) label.textContent = `Training ${inTraining ? 'ON' : 'OFF'}`;
}

// ── Driving a session ───────────────────────────────────────────────────────────

interface LineSessionStat {
  lineName: string;
  openingName: string | null;
  misses: number;
  totalMoves: number;
}

interface SessionStats {
  linesReviewed: number;
  movesMissed: number;
  totalMoves: number;
  lineStats: Map<string, LineSessionStat>;
  // Distinct missed positions, for the end-of-session "try your mistakes" review.
  mistakes: Mistake[];
  mistakeKeys: Set<string>;
}

function makeStats(): SessionStats {
  return {
    linesReviewed: 0,
    movesMissed: 0,
    totalMoves: 0,
    lineStats: new Map(),
    mistakes: [],
    mistakeKeys: new Set(),
  };
}

function runSession(session: TrainingSession, container: HTMLElement, stats: SessionStats): void {
  const item = session.next();
  if (!item) {
    renderSessionComplete(container, stats);
    return;
  }
  runItem(item, session, container, stats);
}

function mainlineOf(tree: MoveNode): MoveNode[] {
  const result: MoveNode[] = [];
  let node = tree.children[0];
  while (node) {
    result.push(node);
    node = node.children[0];
  }
  return result;
}

function runItem(
  item: SessionItem,
  session: TrainingSession,
  container: HTMLElement,
  stats: SessionStats
): void {
  const { line, isResurface } = item;

  // Deep-clone so grading edits don't mutate the queued/in-memory line until we
  // deliberately persist.
  const lineCopy: Line = { ...line, tree: structuredClone(line.tree) };
  const copyMoves = mainlineOf(lineCopy.tree);
  const userNodes = userMoveNodes(lineCopy.tree, lineCopy.colour);

  // Track which user-moves were missed on this pass (one entry per node).
  const missed = new Set<string>();

  function recordMiss(node: MoveNode): void {
    // drill.ts fires this once per node (first wrong attempt) in 'full' mode.
    const idx = copyMoves.findIndex(m => m.id === node.id);
    if (idx >= 0) copyMoves[idx].missedThisSession = true;
    missed.add(node.id);
    // Collect the position for the end-of-session review. Resurfaced passes are
    // pure reinforcement, so they don't add anything new.
    if (!isResurface) {
      const preFen = idx <= 0 ? START_FEN : copyMoves[idx - 1].fen;
      addMistake(stats.mistakes, stats.mistakeKeys, preFen, node);
    }
  }

  startDrill(lineCopy, {
    wrongMoveMode: 'full',
    confirmAbandon: true,
    modeLabel: isResurface ? 'Second look' : 'Training',
    celebrateOnComplete: true,
    completeMessage: isResurface ? 'Got it that time ✓' : 'Line complete',
    // Training is strict: only the move stored in the line is accepted. We
    // deliberately do NOT pass checkAlternative/onExplore here — a sound but
    // off-line move is treated as a plain miss (correct-move arrow as usual).
    recordMiss,
    onCancel: () => void doRender(container),
    // Pause this line out of training mid-drill: persist inTraining=false, drop it
    // from the session, and carry on with whatever's left. Nothing is graded — the
    // clone is simply discarded.
    onPauseLine: () => {
      void saveLine({ ...line, inTraining: false });
      line.inTraining = false;
      runSession(session, container, stats);
    },
    // Edit this line mid-drill: leave the session and open the original line in
    // the builder, at the position on the board. Only offered when the app
    // provides a view-line route.
    onEditLine: onViewLine ? (atFen) => onViewLine!(line, atFen) : undefined,
    // A note added/edited during the drill: persist the clone (its tree, where
    // the note lives) so it survives even if the line isn't finished.
    onNoteEdit: () => { void saveLine(lineCopy); },
    onBeforeComplete: async () => {
      // Resurfaced passes are reinforcement only — they don't re-grade or
      // re-persist, so a clean replay can't inflate the schedule.
      if (isResurface) return;

      const now = new Date();
      for (const node of userNodes) {
        const misses = missed.has(node.id) ? 1 : 0;
        const quality = qualityFromMisses(misses);
        node.review = gradeReview(node.review ?? newReview(now), quality, now);
        node.missedThisSession = false;
      }
      lineCopy.lastTrained = now.toISOString();
      lineCopy.confidence = lineConfidence(lineCopy);
      await saveLine(lineCopy);
      recordReviewed(userNodes.length);
    },
    onComplete: () => {
      if (!isResurface) {
        stats.linesReviewed++;
        stats.movesMissed += missed.size;
        stats.totalMoves += userNodes.length;
        // Accumulate per-line stats; handles the same line appearing twice in
        // an explicit single-line drill session.
        const prev = stats.lineStats.get(line.id);
        if (prev) {
          prev.misses += missed.size;
          prev.totalMoves += userNodes.length;
        } else {
          stats.lineStats.set(line.id, {
            lineName: line.name || 'Untitled',
            openingName: line.openingName,
            misses: missed.size,
            totalMoves: userNodes.length,
          });
        }
      }
      // Missed material comes back later in this same session.
      if (missed.size > 0) session.resurface(line, missed.size);
      runSession(session, container, stats);
    },
  });
}

// ── Individual-moves mode ─────────────────────────────────────────────────────────
//
// A stream of single positions rather than a walk down a line. The positions
// are a blend of scheduled-due and most-missed moves, each one starting
// mid-opening (see individual.ts). A correct move jumps to the next position; a
// wrong one runs the same full wrong-move flow as line training. Every position
// is graded and persisted on its own, reusing the spaced-repetition scheduler.

function runIndividual(container: HTMLElement, trainingLines: Line[]): void {
  // Work on clones so grading edits only persist through saveLine, never the
  // in-memory list.
  const clones = trainingLines.map(l => ({ ...l, tree: structuredClone(l.tree) }));
  const positions = selectIndividualPositions(clones);
  if (positions.length === 0) {
    void doRender(container);
    return;
  }

  const cloneById = new Map(clones.map(c => [c.id, c]));
  // Map each quizzed node back to its line, so a finished position knows what
  // to grade and save.
  const lineByNode = new Map(positions.map(p => [p.expected, cloneById.get(p.lineId)!]));

  const missed = new Set<string>();
  const stats = { reviewed: 0, missed: 0 };
  const mistakes: Mistake[] = [];
  const mistakeKeys = new Set<string>();

  startPositionsDrill(
    positions.map(p => ({ preFen: p.preFen, expected: p.expected, prevUci: p.prevUci, prevFen: p.prevFen })),
    {
      wrongMoveMode: 'full',
      confirmAbandon: true,
      modeLabel: 'Individual moves',
      // Replay the opponent's move into each position so you see how it arose.
      playPrelude: true,
      celebrateOnComplete: true,
      completeMessage: 'Positions cleared ✓',
      // Strict training: no checkAlternative/onExplore — only the stored move
      // is accepted; anything else is a miss.
      recordMiss: (node) => { missed.add(node.id); },
      onStepComplete: (expected) => {
        const line = lineByNode.get(expected);
        if (!line) return;
        const now = new Date();
        const wasMissed = missed.has(expected.id);
        if (wasMissed) {
          const pos = positions.find(p => p.expected === expected);
          if (pos) addMistake(mistakes, mistakeKeys, pos.preFen, expected);
        }
        const quality = qualityFromMisses(wasMissed ? 1 : 0);
        expected.review = gradeReview(expected.review ?? newReview(now), quality, now);
        line.lastTrained = now.toISOString();
        line.confidence = lineConfidence(line);
        void saveLine(line);
        recordReviewed(1);
        stats.reviewed++;
        if (wasMissed) stats.missed++;
      },
      onComplete: () => renderIndividualComplete(container, stats, mistakes),
      onCancel: () => void doRender(container),
    },
  );
}

function renderIndividualComplete(
  container: HTMLElement,
  stats: { reviewed: number; missed: number },
  mistakes: Mistake[],
): void {
  if (stats.reviewed > 0) recordTrainingDay();

  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'section train-completion';

  const doneEl = document.createElement('div');
  doneEl.className = 'train-completion-done';
  doneEl.textContent = 'Positions cleared ✓';
  wrap.appendChild(doneEl);

  const sub = document.createElement('div');
  sub.className = 'train-completion-name';
  sub.textContent = `${stats.reviewed} position${stats.reviewed === 1 ? '' : 's'} drilled`;
  wrap.appendChild(sub);

  const correct = stats.reviewed - stats.missed;
  const statsRow = document.createElement('div');
  statsRow.className = 'summary-stats-row';

  const rightBox = document.createElement('div');
  rightBox.className = 'summary-stat-box summary-stat-box--right';
  const rightVal = document.createElement('div');
  rightVal.className = 'summary-stat-value';
  rightVal.textContent = String(correct);
  const rightLbl = document.createElement('div');
  rightLbl.className = 'summary-stat-label';
  rightLbl.textContent = 'first try';
  rightBox.appendChild(rightVal);
  rightBox.appendChild(rightLbl);
  statsRow.appendChild(rightBox);

  const missBox = document.createElement('div');
  missBox.className = `summary-stat-box ${stats.missed > 0 ? 'summary-stat-box--missed' : 'summary-stat-box--zero'}`;
  const missVal = document.createElement('div');
  missVal.className = 'summary-stat-value';
  missVal.textContent = String(stats.missed);
  const missLbl = document.createElement('div');
  missLbl.className = 'summary-stat-label';
  missLbl.textContent = 'missed';
  missBox.appendChild(missVal);
  missBox.appendChild(missLbl);
  statsRow.appendChild(missBox);

  wrap.appendChild(statsRow);

  const reschedNote = document.createElement('div');
  reschedNote.className = 'train-all-done';
  reschedNote.textContent = stats.missed > 0
    ? 'Missed positions are scheduled to come back sooner.'
    : 'Clean run — every position remembered!';
  wrap.appendChild(reschedNote);

  appendReviewActions(wrap, container, mistakes);

  container.appendChild(wrap);
}

// ── Session-complete panel ──────────────────────────────────────────────────────

function renderSessionComplete(container: HTMLElement, stats: SessionStats): void {
  // A session that reviewed at least one line counts as today's training for
  // the Home-screen streak.
  if (stats.linesReviewed > 0) recordTrainingDay();

  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'section train-completion';

  const doneEl = document.createElement('div');
  doneEl.className = 'train-completion-done';
  doneEl.textContent = 'Session complete ✓';
  wrap.appendChild(doneEl);

  const linesEl = document.createElement('div');
  linesEl.className = 'train-completion-name';
  linesEl.textContent = `${stats.linesReviewed} line${stats.linesReviewed === 1 ? '' : 's'} reviewed`;
  wrap.appendChild(linesEl);

  // Right vs. wrong move counts.
  const correctMoves = stats.totalMoves - stats.movesMissed;
  const statsRow = document.createElement('div');
  statsRow.className = 'summary-stats-row';

  const rightBox = document.createElement('div');
  rightBox.className = 'summary-stat-box summary-stat-box--right';
  const rightVal = document.createElement('div');
  rightVal.className = 'summary-stat-value';
  rightVal.textContent = String(correctMoves);
  const rightLbl = document.createElement('div');
  rightLbl.className = 'summary-stat-label';
  rightLbl.textContent = 'correct';
  rightBox.appendChild(rightVal);
  rightBox.appendChild(rightLbl);
  statsRow.appendChild(rightBox);

  const missBox = document.createElement('div');
  missBox.className = `summary-stat-box ${stats.movesMissed > 0 ? 'summary-stat-box--missed' : 'summary-stat-box--zero'}`;
  const missVal = document.createElement('div');
  missVal.className = 'summary-stat-value';
  missVal.textContent = String(stats.movesMissed);
  const missLbl = document.createElement('div');
  missLbl.className = 'summary-stat-label';
  missLbl.textContent = 'missed';
  missBox.appendChild(missVal);
  missBox.appendChild(missLbl);
  statsRow.appendChild(missBox);

  wrap.appendChild(statsRow);

  if (stats.movesMissed === 0 && stats.linesReviewed > 0) {
    const cleanEl = document.createElement('div');
    cleanEl.className = 'summary-clean-run';
    cleanEl.textContent = 'Clean run — all moves remembered!';
    wrap.appendChild(cleanEl);
  } else if (stats.movesMissed > 0) {
    // Lines with misses, sorted by miss rate (worst first), capped at 5.
    const needsWork = Array.from(stats.lineStats.values())
      .filter(s => s.misses > 0)
      .sort((a, b) => {
        const rateA = a.misses / a.totalMoves;
        const rateB = b.misses / b.totalMoves;
        return rateB !== rateA ? rateB - rateA : b.misses - a.misses;
      })
      .slice(0, 5);

    if (needsWork.length > 0) {
      const sectionHead = document.createElement('div');
      sectionHead.className = 'summary-needs-work-head';
      sectionHead.textContent = 'Needs most work';
      wrap.appendChild(sectionHead);

      for (const ls of needsWork) {
        const row = document.createElement('div');
        row.className = 'summary-line-row';

        const nameEl = document.createElement('div');
        nameEl.className = 'summary-line-name';
        nameEl.textContent = ls.openingName || ls.lineName;

        const missRate = document.createElement('div');
        missRate.className = 'summary-line-miss-rate';
        missRate.textContent = `${ls.misses} of ${ls.totalMoves} missed`;

        const barWrap = document.createElement('div');
        barWrap.className = 'summary-line-bar-wrap';
        const barFill = document.createElement('div');
        barFill.className = 'summary-line-bar-fill';
        barFill.style.width = `${Math.round((ls.misses / ls.totalMoves) * 100)}%`;
        barWrap.appendChild(barFill);

        row.appendChild(nameEl);
        row.appendChild(missRate);
        row.appendChild(barWrap);
        wrap.appendChild(row);
      }
    }

    const reschedNote = document.createElement('div');
    reschedNote.className = 'train-all-done';
    reschedNote.textContent = 'Missed moves are scheduled to come back sooner.';
    wrap.appendChild(reschedNote);
  }

  appendReviewActions(wrap, container, stats.mistakes);

  container.appendChild(wrap);
}

// ── End-of-session review (all modes) ─────────────────────────────────────────
//
// Every completed session ends the same way: if anything was missed, offer to
// drill just those positions ("Try your mistakes again"); otherwise just close.
// The retry reuses the normal teaching drill (arrows + notes), so it doubles as
// a focused fix-up of the exact spots that tripped you up.

function appendReviewActions(
  wrap: HTMLElement,
  container: HTMLElement,
  mistakes: Mistake[],
): void {
  if (mistakes.length > 0) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn-primary train-next-btn';
    retry.textContent = `Try your mistakes again (${mistakes.length})`;
    retry.addEventListener('click', () => runMistakesReview(container, mistakes));
    wrap.appendChild(retry);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn-secondary train-done-btn';
  close.textContent = 'Close training';
  close.addEventListener('click', () => void doRender(container));
  wrap.appendChild(close);
}

// Re-drill a set of missed positions in the normal teaching mode. Whatever's
// still shaky afterwards can be looped through again.
function runMistakesReview(container: HTMLElement, mistakes: Mistake[]): void {
  if (mistakes.length === 0) { void doRender(container); return; }

  const stillMissed = new Set<MoveNode>();

  startPositionsDrill(
    mistakes.map(m => ({ preFen: m.preFen, expected: m.expected })),
    {
      wrongMoveMode: 'full',
      modeLabel: 'Your mistakes',
      celebrateOnComplete: true,
      completeMessage: 'Mistakes reviewed ✓',
      // Strict training: no checkAlternative/onExplore — only the stored move
      // is accepted; anything else is a miss.
      recordMiss: (node) => { stillMissed.add(node); },
      onComplete: () => {
        const again = mistakes.filter(m => stillMissed.has(m.expected));
        renderReviewComplete(container, mistakes.length, again);
      },
      onCancel: () => void doRender(container),
    },
  );
}

function renderReviewComplete(
  container: HTMLElement,
  reviewed: number,
  again: Mistake[],
): void {
  recordTrainingDay();

  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'section train-completion';

  const doneEl = document.createElement('div');
  doneEl.className = 'train-completion-done';
  doneEl.textContent = 'Mistakes reviewed ✓';
  wrap.appendChild(doneEl);

  const sub = document.createElement('div');
  sub.className = 'train-completion-name';
  sub.textContent = `${reviewed} position${reviewed === 1 ? '' : 's'} revisited`;
  wrap.appendChild(sub);

  const note = document.createElement('div');
  note.className = 'train-all-done';
  if (again.length > 0) {
    note.textContent = `Still shaky on ${again.length} — give them another go.`;
  } else {
    note.textContent = 'All cleared — nicely done!';
  }
  wrap.appendChild(note);

  appendReviewActions(wrap, container, again);

  container.appendChild(wrap);
}

// ── Timed mode ────────────────────────────────────────────────────────────────
//
// A countdown (1, 3 or 5 minutes) over individual positions: the goal is as many
// correct as possible. A wrong answer flashes and skips on at once (no
// dwelling); the pool cycles until the clock runs out. The end screen shows the
// score against this duration's personal best, with a "Retry mistakes" drill of
// everything missed.

function runTimed(container: HTMLElement, trainingLines: Line[], minutes: TimedMinutes): void {
  const clones = trainingLines.map(l => ({ ...l, tree: structuredClone(l.tree) }));
  const positions = selectIndividualPositions(clones, { max: 80 });
  if (positions.length === 0) { void doRender(container); return; }

  const mistakes: Mistake[] = [];
  const mistakeKeys = new Set<string>();
  let correct = 0;
  let wrong = 0;

  startTimedDrill(
    positions.map(p => ({ preFen: p.preFen, expected: p.expected, prevUci: p.prevUci, prevFen: p.prevFen })),
    {
      timedMs: minutes * 60 * 1000,
      confirmAbandon: true,
      modeLabel: 'Timed',
      // Mark the opponent's last move so the position reads at a glance (no replay —
      // speed is the point).
      showLastMove: true,
      onTimedResult: (ok, pos) => {
        if (ok) {
          correct++;
        } else {
          wrong++;
          addMistake(mistakes, mistakeKeys, pos.preFen, pos.expected);
        }
      },
      onComplete: () => renderTimedComplete(container, trainingLines, minutes, correct, wrong, mistakes),
      onCancel: () => void doRender(container),
    },
  );
}

function renderTimedComplete(
  container: HTMLElement,
  trainingLines: Line[],
  minutes: TimedMinutes,
  correct: number,
  wrong: number,
  mistakes: Mistake[],
): void {
  if (correct > 0 || wrong > 0) recordTrainingDay();

  const prevBest = getTimedBest(minutes);
  const isNewBest = recordTimedBest(minutes, correct);

  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'section train-completion';

  const doneEl = document.createElement('div');
  doneEl.className = 'train-completion-done';
  doneEl.textContent = "Time's up ⏱";
  wrap.appendChild(doneEl);

  const sub = document.createElement('div');
  sub.className = 'train-completion-name';
  sub.textContent = `${correct} correct in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  wrap.appendChild(sub);

  // Correct vs. mistakes.
  const statsRow = document.createElement('div');
  statsRow.className = 'summary-stats-row';

  const rightBox = document.createElement('div');
  rightBox.className = 'summary-stat-box summary-stat-box--right';
  const rightVal = document.createElement('div');
  rightVal.className = 'summary-stat-value';
  rightVal.textContent = String(correct);
  const rightLbl = document.createElement('div');
  rightLbl.className = 'summary-stat-label';
  rightLbl.textContent = 'correct';
  rightBox.appendChild(rightVal);
  rightBox.appendChild(rightLbl);
  statsRow.appendChild(rightBox);

  const missBox = document.createElement('div');
  missBox.className = `summary-stat-box ${wrong > 0 ? 'summary-stat-box--missed' : 'summary-stat-box--zero'}`;
  const missVal = document.createElement('div');
  missVal.className = 'summary-stat-value';
  missVal.textContent = String(wrong);
  const missLbl = document.createElement('div');
  missLbl.className = 'summary-stat-label';
  missLbl.textContent = 'mistakes';
  missBox.appendChild(missVal);
  missBox.appendChild(missLbl);
  statsRow.appendChild(missBox);

  wrap.appendChild(statsRow);

  // Personal best line.
  const pb = document.createElement('div');
  if (isNewBest && correct > 0) {
    pb.className = 'timed-best timed-best--new';
    pb.textContent = `New personal best! 🎉 (was ${prevBest})`;
  } else {
    pb.className = 'timed-best';
    pb.textContent = prevBest > 0
      ? `Personal best: ${prevBest} — beat it next time`
      : 'Answer one to set your first personal best!';
  }
  wrap.appendChild(pb);

  // Actions: retry mistakes (teaching drill), play again, close.
  if (mistakes.length > 0) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn-primary train-next-btn';
    retry.textContent = `Retry mistakes (${mistakes.length})`;
    retry.addEventListener('click', () => runMistakesReview(container, mistakes));
    wrap.appendChild(retry);
  }

  const again = document.createElement('button');
  again.type = 'button';
  again.className = mistakes.length > 0 ? 'btn-secondary train-done-btn' : 'btn-primary train-next-btn';
  again.textContent = 'Play again';
  again.addEventListener('click', () => runTimed(container, trainingLines, minutes));
  wrap.appendChild(again);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn-secondary train-done-btn';
  close.textContent = 'Close training';
  close.addEventListener('click', () => void doRender(container));
  wrap.appendChild(close);

  container.appendChild(wrap);
}
