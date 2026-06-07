import type { Line } from './types';
import type { MoveNode } from './tree';
import { getAllLines, saveLine } from './storage';
import { startDrill } from './drill';
import { TrainingSession, type SessionItem } from './session';
import {
  userMoveNodes,
  gradeReview,
  newReview,
  qualityFromMisses,
  lineConfidence,
  lineIsDue,
  dueLines,
  nextDue,
  describeDue,
} from './scheduler';
import { runSchedulerSelfTest } from './scheduler.selftest';

// ── Screen entry point ──────────────────────────────────────────────────────────

export function renderTrainScreen(container: HTMLElement): void {
  void doRender(container);
}

async function doRender(container: HTMLElement): Promise<void> {
  container.innerHTML = '<p class="lines-loading">Loading…</p>';
  const allLines = await getAllLines();
  container.innerHTML = '';

  const trainingLines = allLines.filter(l => l.inTraining);

  if (trainingLines.length === 0) {
    renderEmpty(container);
    appendSelfTestLink(container);
    return;
  }

  const due = dueLines(trainingLines);
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

// ── Session header (the "Start review" call to action) ──────────────────────────

function renderSessionHeader(container: HTMLElement, due: Line[], allTraining: Line[]): void {
  const wrap = document.createElement('div');
  wrap.className = 'session-header';

  const count = document.createElement('div');
  count.className = 'session-count';
  count.textContent = due.length > 0
    ? `${due.length} line${due.length === 1 ? '' : 's'} due for review`
    : 'All caught up for now ✓';
  wrap.appendChild(count);

  if (due.length > 0) {
    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'session-start-btn';
    startBtn.textContent = 'Start review session';
    startBtn.addEventListener('click', () => {
      const session = new TrainingSession(allTraining);
      runSession(session, container, { linesReviewed: 0, movesMissed: 0 });
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
    runSession(session, container, { linesReviewed: 0, movesMissed: 0 });
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

interface SessionStats {
  linesReviewed: number;
  movesMissed: number;
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
      }
      // Missed material comes back later in this same session.
      if (missed.size > 0) session.resurface(line, missed.size);
      runSession(session, container, stats);
    },
  });
}

// ── Session-complete panel ──────────────────────────────────────────────────────

function renderSessionComplete(container: HTMLElement, stats: SessionStats): void {
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'train-completion';

  const doneEl = document.createElement('div');
  doneEl.className = 'train-completion-done';
  doneEl.textContent = 'Session complete ✓';
  wrap.appendChild(doneEl);

  const summary = document.createElement('div');
  summary.className = 'train-completion-name';
  const lines = `${stats.linesReviewed} line${stats.linesReviewed === 1 ? '' : 's'} reviewed`;
  summary.textContent = stats.movesMissed === 0
    ? `${lines} · clean run`
    : `${lines} · ${stats.movesMissed} move${stats.movesMissed === 1 ? '' : 's'} to firm up`;
  wrap.appendChild(summary);

  const allDone = document.createElement('div');
  allDone.className = 'train-all-done';
  allDone.textContent = 'Missed moves are scheduled to come back sooner.';
  wrap.appendChild(allDone);

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
