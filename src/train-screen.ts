import type { Line } from './types';
import type { MoveNode } from './tree';
import { getAllLines, saveLine } from './storage';
import { startDrill } from './drill';
import { Icons } from './icons';
import { isGoodAlternative } from './engine';
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
} from './scheduler';
import { runSchedulerSelfTest } from './scheduler.selftest';
import { recordTrainingDay } from './streak';

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

  if (due.length > 0) {
    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'session-start-btn';
    startBtn.appendChild(Icons.play(17));
    startBtn.appendChild(document.createTextNode('Start review session'));
    startBtn.addEventListener('click', () => {
      const session = new TrainingSession(allTraining);
      runSession(session, container, makeStats());
    });
    wrap.appendChild(startBtn);
  }

  container.appendChild(wrap);
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
}

function makeStats(): SessionStats {
  return { linesReviewed: 0, movesMissed: 0, totalMoves: 0, lineStats: new Map() };
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
    const target = copyMoves.find(m => m.id === node.id);
    if (target) target.missedThisSession = true;
    missed.add(node.id);
  }

  startDrill(lineCopy, {
    wrongMoveMode: 'full',
    completeMessage: isResurface ? 'Got it that time ✓' : 'Line complete',
    checkAlternative: (fen, uci) => isGoodAlternative(fen, uci),
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

  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'train-done-btn';
  doneBtn.textContent = 'Back to training';
  doneBtn.addEventListener('click', () => void doRender(container));
  wrap.appendChild(doneBtn);

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
