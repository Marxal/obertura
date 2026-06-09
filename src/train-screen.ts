import type { Line } from './types';
import type { MoveNode } from './tree';
import { getAllLines, saveLine } from './storage';
import { startDrill, startPositionsDrill, startTimedDrill } from './drill';
import { selectIndividualPositions } from './individual';
import { openExplorer } from './explore';
import { Icons } from './icons';
import { isGoodAlternative } from './engine';
import { getTimedBest, recordTimedBest } from './prefs';
import { TrainingSession, type SessionItem } from './session';
import {
  userMoveNodes,
  gradeReview,
  newReview,
  qualityFromMisses,
  lineConfidence,
  lineIsDue,
  isReviewDue,
  dueLines,
  nextDue,
  describeDue,
  recentlyAddedLines,
  weakestLines,
} from './scheduler';
import { runSchedulerSelfTest } from './scheduler.selftest';
import { recordTrainingDay } from './streak';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

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
  opts: { focusLineId?: string; autoStart?: boolean } = {},
): void {
  void doRender(container, opts.focusLineId, opts.autoStart);
}

async function doRender(
  container: HTMLElement,
  focusLineId?: string,
  autoStart?: boolean,
): Promise<void> {
  container.innerHTML = '<p class="lines-loading">Loading…</p>';
  const allLines = await getAllLines();
  container.innerHTML = '';

  const trainingLines = allLines.filter(l => l.inTraining);

  if (trainingLines.length === 0) {
    renderEmpty(container);
    appendSelfTestLink(container);
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

  // Arrived from the Home screen's "Start training": jump straight into the due
  // session rather than showing the list first. Falls through to the list when
  // nothing is due (so the "all caught up" header still shows).
  if (autoStart && due.length > 0) {
    const session = new TrainingSession(trainingLines);
    runSession(session, container, makeStats());
    return;
  }

  renderSessionHeader(container, due, trainingLines);
  renderCardList(container, trainingLines);
  appendSelfTestLink(container);
}

// ── Empty state ───────────────────────────────────────────────────────────────

function renderEmpty(container: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'train-empty';

  const title = document.createElement('p');
  title.className = 'train-empty-title';
  title.textContent = 'No lines in training yet';
  wrap.appendChild(title);

  const body = document.createElement('p');
  body.className = 'train-empty-body';
  body.textContent = 'Go to My Lines, open a line, and tap "Add to training" to get started.';
  wrap.appendChild(body);

  container.appendChild(wrap);
}

// ── Session header (due preview + "Start review" call to action) ─────────────

function renderSessionHeader(container: HTMLElement, due: Line[], allTraining: Line[]): void {
  const wrap = document.createElement('div');
  wrap.className = 'session-header';

  // Count individual user-move positions across all training lines.
  const now = new Date();
  let totalPositions = 0;
  let duePositions = 0;
  for (const line of allTraining) {
    const nodes = userMoveNodes(line.tree, line.colour);
    totalPositions += nodes.length;
    duePositions += nodes.filter(n => isReviewDue(n.review, now)).length;
  }
  const masteredPositions = totalPositions - duePositions;
  const masteryPct = totalPositions > 0 ? (masteredPositions / totalPositions) * 100 : 100;

  const count = document.createElement('div');
  count.className = 'session-count';
  count.textContent = due.length > 0
    ? `${due.length} line${due.length === 1 ? '' : 's'} due for review`
    : 'All caught up for now ✓';
  wrap.appendChild(count);

  // Progress bar — fills as positions are mastered (100 % = fully up to date).
  const barWrap = document.createElement('div');
  barWrap.className = 'session-progress-bar';
  const barFill = document.createElement('div');
  barFill.className = 'session-progress-fill' + (due.length === 0 ? ' session-progress-fill--done' : '');
  barFill.style.width = `${Math.round(masteryPct)}%`;
  barWrap.appendChild(barFill);
  wrap.appendChild(barWrap);

  // Sub-label: how many individual positions need attention.
  if (totalPositions > 0) {
    const posLabel = document.createElement('div');
    posLabel.className = 'session-pos-label';
    posLabel.textContent = duePositions > 0
      ? `${duePositions} of ${totalPositions} position${totalPositions === 1 ? '' : 's'} need a look`
      : `${totalPositions} position${totalPositions === 1 ? '' : 's'} all up to date`;
    wrap.appendChild(posLabel);
  }

  renderPracticePicker(wrap, due, allTraining, container);

  // Individual-moves mode: a stream of single positions (due + weakest moves),
  // each starting mid-opening. Offered whenever there's anything deep enough to
  // drill, even when no full line is due.
  const individual = selectIndividualPositions(allTraining);
  if (individual.length > 0) {
    const indBtn = document.createElement('button');
    indBtn.type = 'button';
    indBtn.className = 'session-individual-btn';
    indBtn.appendChild(Icons.zap(16));
    indBtn.appendChild(document.createTextNode(
      `Fix individual moves (${individual.length})`,
    ));
    indBtn.addEventListener('click', () => runIndividual(container, allTraining));
    wrap.appendChild(indBtn);

    // Timed challenge — a 3-minute speed run over the same individual positions.
    const best = getTimedBest();
    const timedBtn = document.createElement('button');
    timedBtn.type = 'button';
    timedBtn.className = 'session-timed-btn';
    timedBtn.appendChild(Icons.clock(16));
    timedBtn.appendChild(document.createTextNode(
      best > 0 ? `Timed challenge · best ${best}` : 'Timed challenge',
    ));
    timedBtn.addEventListener('click', () => runTimed(container, allTraining));
    wrap.appendChild(timedBtn);
  }

  container.appendChild(wrap);
}

// ── Practice picker (choose what a session loads) ────────────────────────────────
//
// Three cheap, engine-free ways to build today's session:
//   • Due now        — the spaced-repetition queue (what's actually scheduled).
//   • Recently added — your newest lines first (drill what you just built).
//   • Weakest        — the lines you miss most, hardest first.
// "Due now" reflects the real due set; the other two are explicit walks through
// the repertoire in their chosen order, capped so a session stays bite-sized.

const PICKER_SESSION_CAP = 12;

function renderPracticePicker(
  wrap: HTMLElement,
  due: Line[],
  allTraining: Line[],
  container: HTMLElement,
): void {
  const picker = document.createElement('div');
  picker.className = 'session-picker';

  const label = document.createElement('div');
  label.className = 'session-picker-label';
  label.textContent = 'Practise';
  picker.appendChild(label);

  const start = (session: TrainingSession) => runSession(session, container, makeStats());

  // Due now — the scheduled queue. Disabled when nothing is due.
  picker.appendChild(buildOption({
    icon: Icons.play(18),
    title: 'Due now',
    sub: due.length > 0
      ? `${due.length} line${due.length === 1 ? '' : 's'} scheduled`
      : 'Nothing due — all caught up',
    primary: true,
    disabled: due.length === 0,
    onClick: () => start(new TrainingSession(allTraining)),
  }));

  // Recently added — newest first.
  picker.appendChild(buildOption({
    icon: Icons.plus(18),
    title: 'Recently added',
    sub: 'Your newest lines first',
    onClick: () => {
      const ordered = recentlyAddedLines(allTraining).slice(0, PICKER_SESSION_CAP);
      start(new TrainingSession(ordered, { explicit: true }));
    },
  }));

  // Weakest — most-missed first.
  picker.appendChild(buildOption({
    icon: Icons.trending(18),
    title: 'Weakest',
    sub: 'The moves you miss most',
    onClick: () => {
      const ordered = weakestLines(allTraining).slice(0, PICKER_SESSION_CAP);
      start(new TrainingSession(ordered, { explicit: true }));
    },
  }));

  wrap.appendChild(picker);
}

function buildOption(o: {
  icon: SVGElement;
  title: string;
  sub: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'practice-option'
    + (o.primary ? ' practice-option--primary' : '')
    + (o.disabled ? ' practice-option--disabled' : '');
  btn.disabled = !!o.disabled;

  const iconWrap = document.createElement('span');
  iconWrap.className = 'practice-option-icon';
  iconWrap.appendChild(o.icon);

  const text = document.createElement('span');
  text.className = 'practice-option-text';
  const title = document.createElement('span');
  title.className = 'practice-option-title';
  title.textContent = o.title;
  const sub = document.createElement('span');
  sub.className = 'practice-option-sub';
  sub.textContent = o.sub;
  text.appendChild(title);
  text.appendChild(sub);

  btn.appendChild(iconWrap);
  btn.appendChild(text);
  if (!o.disabled) btn.addEventListener('click', o.onClick);
  return btn;
}

// ── Card list (browse every training line) ──────────────────────────────────────

function renderCardList(container: HTMLElement, trainingLines: Line[]): void {
  const heading = document.createElement('h2');
  heading.className = 'train-heading';
  heading.textContent = 'Training lines';
  container.appendChild(heading);

  for (const line of trainingLines) {
    container.appendChild(buildTrainCard(line, container));
  }
}

function buildTrainCard(line: Line, container: HTMLElement): HTMLElement {
  const card = document.createElement('div');
  card.className = 'line-card';

  const isDue = lineIsDue(line);
  if (!isDue) card.classList.add('line-card--rested');

  const body = document.createElement('button');
  body.type = 'button';
  body.className = 'line-card-body';
  // Tapping a card drills just that line (a one-line practice session).
  body.addEventListener('click', () => {
    const session = new TrainingSession([line], { explicit: true });
    runSession(session, container, makeStats());
  });

  const nameEl = document.createElement('div');
  nameEl.className = 'line-card-name';
  nameEl.textContent = line.name || 'Untitled line';

  const meta = document.createElement('div');
  meta.className = 'line-card-meta';

  const colourChip = document.createElement('span');
  colourChip.className = 'tag-chip';
  colourChip.textContent = line.colour === 'white' ? '○ White' : '● Black';
  meta.appendChild(colourChip);

  for (const tag of line.tags) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.textContent = tag;
    meta.appendChild(chip);
  }

  const trainingRow = document.createElement('div');
  trainingRow.className = 'line-card-training';

  const dueSpan = document.createElement('span');
  dueSpan.className = isDue ? 'training-stat training-stat--due' : 'training-stat';
  dueSpan.textContent = describeDue(nextDue(line));
  trainingRow.appendChild(dueSpan);

  body.appendChild(nameEl);
  body.appendChild(meta);
  body.appendChild(trainingRow);
  card.appendChild(body);

  return card;
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
    modeLabel: isResurface ? 'Second look' : 'Training',
    hideTitleUntilComplete: true,
    celebrateOnComplete: true,
    completeMessage: isResurface ? 'Got it that time ✓' : 'Line complete',
    checkAlternative: (fen, uci) => isGoodAlternative(fen, uci),
    onExplore: (fenAfter, label, orientation) => openExplorer(fenAfter, { label, orientation, onClose: () => {} }),
    recordMiss,
    onCancel: () => void doRender(container),
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
    positions.map(p => ({ preFen: p.preFen, expected: p.expected })),
    {
      wrongMoveMode: 'full',
      modeLabel: 'Individual moves',
      hideTitleUntilComplete: true,
      celebrateOnComplete: true,
      completeMessage: 'Positions cleared ✓',
      checkAlternative: (fen, uci) => isGoodAlternative(fen, uci),
      onExplore: (fenAfter, label, orientation) => openExplorer(fenAfter, { label, orientation, onClose: () => {} }),
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
  wrap.className = 'train-completion';

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
  wrap.className = 'train-completion';

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
    retry.className = 'train-next-btn';
    retry.textContent = `Try your mistakes again (${mistakes.length})`;
    retry.addEventListener('click', () => runMistakesReview(container, mistakes));
    wrap.appendChild(retry);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'train-done-btn';
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
      hideTitleUntilComplete: true,
      celebrateOnComplete: true,
      completeMessage: 'Mistakes reviewed ✓',
      checkAlternative: (fen, uci) => isGoodAlternative(fen, uci),
      onExplore: (fenAfter, label, orientation) =>
        openExplorer(fenAfter, { label, orientation, onClose: () => {} }),
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
  wrap.className = 'train-completion';

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
// A 3-minute countdown over individual positions: the goal is as many correct
// as possible. A wrong answer flashes and skips on at once (no dwelling); the
// pool cycles until the clock runs out. The end screen shows the score against
// a stored personal best, with a "Retry mistakes" drill of everything missed.

const TIMED_DURATION_MS = 3 * 60 * 1000;

function runTimed(container: HTMLElement, trainingLines: Line[]): void {
  const clones = trainingLines.map(l => ({ ...l, tree: structuredClone(l.tree) }));
  const positions = selectIndividualPositions(clones, { max: 80 });
  if (positions.length === 0) { void doRender(container); return; }

  const mistakes: Mistake[] = [];
  const mistakeKeys = new Set<string>();
  let correct = 0;
  let wrong = 0;

  startTimedDrill(
    positions.map(p => ({ preFen: p.preFen, expected: p.expected })),
    {
      timedMs: TIMED_DURATION_MS,
      modeLabel: 'Timed',
      hideTitleUntilComplete: true,
      onTimedResult: (ok, pos) => {
        if (ok) {
          correct++;
        } else {
          wrong++;
          addMistake(mistakes, mistakeKeys, pos.preFen, pos.expected);
        }
      },
      onComplete: () => renderTimedComplete(container, trainingLines, correct, wrong, mistakes),
      onCancel: () => void doRender(container),
    },
  );
}

function renderTimedComplete(
  container: HTMLElement,
  trainingLines: Line[],
  correct: number,
  wrong: number,
  mistakes: Mistake[],
): void {
  if (correct > 0 || wrong > 0) recordTrainingDay();

  const prevBest = getTimedBest();
  const isNewBest = recordTimedBest(correct);

  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'train-completion';

  const doneEl = document.createElement('div');
  doneEl.className = 'train-completion-done';
  doneEl.textContent = "Time's up ⏱";
  wrap.appendChild(doneEl);

  const sub = document.createElement('div');
  sub.className = 'train-completion-name';
  sub.textContent = `${correct} correct in 3 minutes`;
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
    retry.className = 'train-next-btn';
    retry.textContent = `Retry mistakes (${mistakes.length})`;
    retry.addEventListener('click', () => runMistakesReview(container, mistakes));
    wrap.appendChild(retry);
  }

  const again = document.createElement('button');
  again.type = 'button';
  again.className = mistakes.length > 0 ? 'train-done-btn' : 'train-next-btn';
  again.textContent = 'Play again';
  again.addEventListener('click', () => runTimed(container, trainingLines));
  wrap.appendChild(again);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'train-done-btn';
  close.textContent = 'Close training';
  close.addEventListener('click', () => void doRender(container));
  wrap.appendChild(close);

  container.appendChild(wrap);
}

// ── Scheduler self-test (a phone-friendly way to verify the maths) ──────────────

function appendSelfTestLink(container: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'selftest-wrap';

  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'selftest-link';
  link.textContent = 'Run scheduler self-test';

  const out = document.createElement('div');
  out.className = 'selftest-output';
  out.hidden = true;

  link.addEventListener('click', () => {
    const results = runSchedulerSelfTest();
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
    // Also dump to the console for desktop inspection.
    console.log('[scheduler self-test]', results);
  });

  wrap.appendChild(link);
  wrap.appendChild(out);
  container.appendChild(wrap);
}
