import type { Line } from './types';
import { getAllLines, saveLine } from './storage';
import { startDrill } from './drill';

// ── Date helpers ──────────────────────────────────────────────────────────────

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function isSameDay(isoStr: string | null): boolean {
  return !!isoStr && isoStr.slice(0, 10) === todayUTC();
}

function relativeDate(isoStr: string): string {
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? (months === 1 ? '1 month ago' : `${months} months ago`) : isoStr.slice(0, 10);
}

// ── Next-line ordering ────────────────────────────────────────────────────────
// Exported so Task 5 can swap this for the real SM-2 due-logic without
// touching the screen code.

export function nextLineToTrain(lines: Line[]): Line | null {
  const candidates = lines
    .filter(l => l.inTraining && !isSameDay(l.lastTrained))
    .sort((a, b) => {
      // Never-trained (lastTrained === null) counts as oldest (time 0).
      const at = a.lastTrained ? new Date(a.lastTrained).getTime() : 0;
      const bt = b.lastTrained ? new Date(b.lastTrained).getTime() : 0;
      return at - bt;
    });
  return candidates[0] ?? null;
}

// ── Screen entry point ────────────────────────────────────────────────────────

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
    return;
  }

  renderCardList(container, trainingLines);
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

// ── Card list ─────────────────────────────────────────────────────────────────

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

  const doneToday = isSameDay(line.lastTrained);
  if (doneToday) card.classList.add('line-card--done-today');

  const body = document.createElement('button');
  body.type = 'button';
  body.className = 'line-card-body';
  body.addEventListener('click', () => startTrainDrill(line, container));

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

  const dateSpan = document.createElement('span');
  dateSpan.className = doneToday ? 'training-stat training-stat--done' : 'training-stat';
  dateSpan.textContent = doneToday
    ? 'Done today ✓'
    : line.lastTrained
      ? `Last: ${relativeDate(line.lastTrained)}`
      : 'Not yet trained';
  trainingRow.appendChild(dateSpan);

  body.appendChild(nameEl);
  body.appendChild(meta);
  body.appendChild(trainingRow);
  card.appendChild(body);

  return card;
}

// ── Drill entry ───────────────────────────────────────────────────────────────

function startTrainDrill(line: Line, container: HTMLElement): void {
  startDrill(line, {
    completeMessage: 'Line complete',
    onCancel: () => void doRender(container),
    onBeforeComplete: async () => {
      const updated: Line = { ...line, lastTrained: new Date().toISOString() };
      await saveLine(updated);
    },
    onComplete: async () => {
      const freshLines = await getAllLines();
      const updated = freshLines.find(l => l.id === line.id) ?? line;
      renderCompletion(container, updated, freshLines);
    },
  });
}

// ── Completion panel ──────────────────────────────────────────────────────────

function renderCompletion(container: HTMLElement, completedLine: Line, allLines: Line[]): void {
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'train-completion';

  const doneEl = document.createElement('div');
  doneEl.className = 'train-completion-done';
  doneEl.textContent = 'Line complete ✓';
  wrap.appendChild(doneEl);

  const nameEl = document.createElement('div');
  nameEl.className = 'train-completion-name';
  nameEl.textContent = completedLine.name || 'Untitled line';
  wrap.appendChild(nameEl);

  const next = nextLineToTrain(allLines);

  if (next) {
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'train-next-btn';
    nextBtn.textContent = `Next: ${next.name || 'Untitled line'} →`;
    nextBtn.addEventListener('click', () => startTrainDrill(next, container));
    wrap.appendChild(nextBtn);
  } else {
    const allDoneEl = document.createElement('div');
    allDoneEl.className = 'train-all-done';
    allDoneEl.textContent = 'All caught up for today ✓';
    wrap.appendChild(allDoneEl);
  }

  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'train-done-btn';
  doneBtn.textContent = 'Done for now';
  doneBtn.addEventListener('click', () => void doRender(container));
  wrap.appendChild(doneBtn);

  container.appendChild(wrap);
}
