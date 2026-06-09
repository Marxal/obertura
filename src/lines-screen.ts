import type { Line } from './types';
import { getAllLines, saveLine, deleteLine } from './storage';
import { Icons } from './icons';

// Phase 3 training will populate confidence and lastTrained.
function relativeDate(isoStr: string): string {
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`;
  return isoStr.slice(0, 10);
}

function confidenceDots(c: number): string {
  if (!c) return '—';
  const n = Math.min(Math.max(c, 0), 5);
  return '●'.repeat(n) + '○'.repeat(5 - n);
}

type SortMode = 'latest' | 'weakest' | 'strongest' | 'name';
let currentSort: SortMode = 'latest';

export function renderLinesScreen(
  container: HTMLElement,
  {
    onOpenLine,
    onStartTraining,
  }: {
    onOpenLine: (line: Line) => void;
    onStartTraining?: (line: Line) => void;
  }
): void {
  doRender(container, onOpenLine, onStartTraining);
}

async function doRender(
  container: HTMLElement,
  onOpenLine: (line: Line) => void,
  onStartTraining?: (line: Line) => void
): Promise<void> {
  container.innerHTML = '<p class="lines-loading">Loading…</p>';
  const allLines = await getAllLines();
  container.innerHTML = '';

  const sortRow = buildSortRow(container, onOpenLine, onStartTraining);
  container.appendChild(sortRow);

  const rerender = () => doRender(container, onOpenLine, onStartTraining);

  for (const colour of ['white', 'black'] as const) {
    container.appendChild(
      buildSection(colour, allLines.filter(l => l.colour === colour), onOpenLine, rerender, onStartTraining)
    );
  }
}

function buildSortRow(
  container: HTMLElement,
  onOpenLine: (line: Line) => void,
  onStartTraining?: (line: Line) => void
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sort-row';

  const label = document.createElement('span');
  label.className = 'sort-label';
  label.textContent = 'Sort:';
  row.appendChild(label);

  const sorts: { key: SortMode; label: string }[] = [
    { key: 'latest', label: 'Latest' },
    { key: 'weakest', label: 'Weakest' },
    { key: 'strongest', label: 'Strongest' },
    { key: 'name', label: 'Name' },
  ];

  for (const s of sorts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `sort-btn${currentSort === s.key ? ' active' : ''}`;
    btn.textContent = s.label;
    btn.addEventListener('click', () => {
      currentSort = s.key;
      doRender(container, onOpenLine, onStartTraining);
    });
    row.appendChild(btn);
  }

  return row;
}

function sortLines(lines: Line[], mode: SortMode): Line[] {
  const copy = [...lines];
  switch (mode) {
    case 'weakest':
      return copy.sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0));
    case 'strongest':
      return copy.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    case 'name':
      return copy.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    case 'latest':
    default:
      return copy.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }
}

function buildSection(
  colour: 'white' | 'black',
  lines: Line[],
  onOpenLine: (line: Line) => void,
  rerender: () => void,
  onStartTraining?: (line: Line) => void
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'lines-section';

  const heading = document.createElement('h2');
  heading.className = 'lines-heading';
  heading.textContent = colour === 'white' ? '○ White' : '● Black';
  section.appendChild(heading);

  if (lines.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'lines-empty';
    empty.textContent = `No ${colour === 'white' ? 'White' : 'Black'} lines yet.`;
    section.appendChild(empty);
    return section;
  }

  for (const line of sortLines(lines, currentSort)) {
    section.appendChild(buildCard(line, onOpenLine, rerender, onStartTraining));
  }
  return section;
}

function buildCard(
  line: Line,
  onOpenLine: (line: Line) => void,
  rerender: () => void,
  onStartTraining?: (line: Line) => void
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'line-card';

  const body = document.createElement('button');
  body.type = 'button';
  body.className = 'line-card-body';
  body.addEventListener('click', () => onOpenLine(line));

  const nameEl = document.createElement('div');
  nameEl.className = 'line-card-name';
  nameEl.textContent = line.name || line.openingName || 'Untitled line';

  const meta = document.createElement('div');
  meta.className = 'line-card-meta';

  const dot = document.createElement('span');
  dot.className = 'strength-dot';
  dot.textContent = '—';
  dot.title = 'Strength: not yet trained';
  meta.appendChild(dot);

  for (const tag of line.tags) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.textContent = tag;
    meta.appendChild(chip);
  }

  const trainingRow = document.createElement('div');
  trainingRow.className = 'line-card-training';
  const confSpan = document.createElement('span');
  confSpan.className = 'training-stat';
  confSpan.textContent = `Confidence: ${confidenceDots(line.confidence)}`;
  const sep = document.createElement('span');
  sep.className = 'training-sep';
  sep.setAttribute('aria-hidden', 'true');
  sep.textContent = '·';
  const dateSpan = document.createElement('span');
  dateSpan.className = 'training-stat';
  dateSpan.textContent = line.lastTrained ? relativeDate(line.lastTrained) : 'Never trained';
  trainingRow.appendChild(confSpan);
  trainingRow.appendChild(sep);
  trainingRow.appendChild(dateSpan);

  body.appendChild(nameEl);
  body.appendChild(meta);
  body.appendChild(trainingRow);
  card.appendChild(body);

  // Training toggle — "Add to training" or "✓ Training" (tap to remove).
  if (line.inTraining) {
    const trainBtn = document.createElement('button');
    trainBtn.type = 'button';
    trainBtn.className = 'card-training-btn card-training-btn--active';
    trainBtn.textContent = '✓ Training';
    trainBtn.title = 'Tap to remove from training';
    trainBtn.addEventListener('click', async e => {
      e.stopPropagation();
      await saveLine({ ...line, inTraining: false });
      rerender();
    });
    card.appendChild(trainBtn);
  } else if (onStartTraining) {
    const trainBtn = document.createElement('button');
    trainBtn.type = 'button';
    trainBtn.className = 'card-training-btn';
    trainBtn.textContent = 'Add to training';
    trainBtn.addEventListener('click', e => {
      e.stopPropagation();
      onStartTraining(line);
    });
    card.appendChild(trainBtn);
  }

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'line-edit-btn';
  editBtn.setAttribute('aria-label', 'Edit line');
  editBtn.appendChild(Icons.pencil(16));
  editBtn.addEventListener('click', e => {
    e.stopPropagation();
    openEditSheet(line, rerender);
  });
  card.appendChild(editBtn);

  return card;
}

function openEditSheet(line: Line, rerender: () => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet';

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = 'Edit line';
  sheet.appendChild(title);

  const nameGroup = document.createElement('div');
  const nameLabel = document.createElement('label');
  nameLabel.className = 'edit-label';
  nameLabel.textContent = 'Name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'edit-input';
  nameInput.value = line.name;
  nameInput.placeholder = 'Line name';
  nameGroup.appendChild(nameLabel);
  nameGroup.appendChild(nameInput);
  sheet.appendChild(nameGroup);

  const tagsGroup = document.createElement('div');
  const tagsLabel = document.createElement('label');
  tagsLabel.className = 'edit-label';
  tagsLabel.textContent = 'Tags (comma-separated)';
  const tagsInput = document.createElement('input');
  tagsInput.type = 'text';
  tagsInput.className = 'edit-input';
  tagsInput.value = line.tags.join(', ');
  tagsInput.placeholder = 'e.g. sicilian, opening';
  tagsGroup.appendChild(tagsLabel);
  tagsGroup.appendChild(tagsInput);
  sheet.appendChild(tagsGroup);

  const btnRow = document.createElement('div');
  btnRow.className = 'edit-btn-row';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'edit-save-btn';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    const updated: Line = {
      ...line,
      name: nameInput.value.trim() || 'Untitled line',
      tags: tagsInput.value
        .split(',')
        .map(t => t.trim())
        .filter(Boolean),
    };
    await saveLine(updated);
    close();
    rerender();
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'edit-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', close);

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);
  sheet.appendChild(btnRow);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'edit-delete-btn';
  deleteBtn.appendChild(Icons.trash(15));
  deleteBtn.appendChild(document.createTextNode('Delete line'));
  let awaitingConfirm = false;
  deleteBtn.addEventListener('click', async () => {
    if (!awaitingConfirm) {
      awaitingConfirm = true;
      deleteBtn.replaceChildren();
      deleteBtn.appendChild(Icons.trash(15));
      deleteBtn.appendChild(document.createTextNode('Tap again to confirm delete'));
      deleteBtn.classList.add('confirming');
      return;
    }
    await deleteLine(line.id);
    close();
    rerender();
  });
  sheet.appendChild(deleteBtn);

  function close() {
    overlay.remove();
  }

  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => nameInput.focus());
}
