import type { Line } from './types';
import type { MoveNode } from './tree';
import { Chessground } from 'chessground';
import { getAllLines, saveLine, deleteLine } from './storage';
import { Icons } from './icons';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

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

// The position a mini-board should show. Ideally the opening's "key named
// position" — but pinning that down means an online lookup per line, which
// isn't cheap. So we use the final mainline position: walk first-children to
// the end of the tree and take that FEN. Empty lines fall back to the start.
function finalMainlineFen(tree: MoveNode): string {
  let node: MoveNode | undefined = tree.children[0];
  let fen = START_FEN;
  while (node) {
    fen = node.fen;
    node = node.children[0];
  }
  return fen;
}

type SortMode = 'latest' | 'weakest' | 'strongest' | 'name';
let currentSort: SortMode = 'latest';

interface LinesDeps {
  onOpenLine: (line: Line) => void;
  onAddLine: (colour: 'white' | 'black') => void;
  onStartTraining?: (line: Line) => void;
}

export function renderLinesScreen(
  container: HTMLElement,
  deps: LinesDeps
): void {
  void doRender(container, deps);
}

async function doRender(container: HTMLElement, deps: LinesDeps): Promise<void> {
  container.innerHTML = '<p class="lines-loading">Loading…</p>';
  const allLines = await getAllLines();
  container.innerHTML = '';

  // Pending mini-boards: built now, mounted after the layout exists so
  // chessground can read real pixel bounds and place pieces correctly.
  const pending: { el: HTMLElement; fen: string; orientation: 'white' | 'black' }[] = [];

  for (const colour of ['white', 'black'] as const) {
    container.appendChild(
      buildCarouselSection(
        container,
        colour,
        allLines.filter(l => l.colour === colour),
        deps,
        pending
      )
    );
  }

  // Mount the static boards once the sections are in the (visible) DOM.
  requestAnimationFrame(() => {
    for (const b of pending) mountMiniBoard(b.el, b.fen, b.orientation);
  });
}

// ── Carousel screen ─────────────────────────────────────────────────────────

function buildCarouselSection(
  container: HTMLElement,
  colour: 'white' | 'black',
  lines: Line[],
  deps: LinesDeps,
  pending: { el: HTMLElement; fen: string; orientation: 'white' | 'black' }[]
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'carousel-section';

  // Heading row: colour pip + name, with the Add button beside it.
  const head = document.createElement('div');
  head.className = 'carousel-head';

  const title = document.createElement('div');
  title.className = 'carousel-head-title';
  const pip = document.createElement('span');
  pip.className = `colour-pip colour-pip--${colour}`;
  pip.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.textContent = colour === 'white' ? 'White' : 'Black';
  title.appendChild(pip);
  title.appendChild(name);
  head.appendChild(title);

  // "+ Add new line" — the only entry into the builder from this screen.
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = `lines-add-btn lines-add-btn--${colour}`;
  addBtn.appendChild(Icons.plus(15));
  addBtn.appendChild(document.createTextNode('Add new line'));
  addBtn.addEventListener('click', () => deps.onAddLine(colour));
  head.appendChild(addBtn);

  section.appendChild(head);

  if (lines.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'lines-empty';
    empty.textContent = `No ${colour === 'white' ? 'White' : 'Black'} lines yet.`;
    section.appendChild(empty);
    return section;
  }

  // Horizontally-scrolling track of mini-board cards.
  const carousel = document.createElement('div');
  carousel.className = 'carousel-track';
  for (const line of sortLines(lines, 'latest')) {
    carousel.appendChild(buildMiniCard(container, line, deps, pending));
  }
  section.appendChild(carousel);

  // "View more" → the detailed list (task 3.2).
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'carousel-more';
  more.textContent = 'View more →';
  more.addEventListener('click', () => renderDetail(container, colour, lines, deps));
  section.appendChild(more);

  return section;
}

function buildMiniCard(
  container: HTMLElement,
  line: Line,
  deps: LinesDeps,
  pending: { el: HTMLElement; fen: string; orientation: 'white' | 'black' }[]
): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'carousel-card';
  // Tapping a card opens the detailed list for its colour (task 3.2). The
  // builder is reached only via "Add new line".
  card.addEventListener('click', () => renderDetailFromLine(container, line, deps));

  const board = document.createElement('div');
  board.className = 'carousel-board';
  card.appendChild(board);
  pending.push({ el: board, fen: finalMainlineFen(line.tree), orientation: line.colour });

  const titleEl = document.createElement('div');
  titleEl.className = 'carousel-card-title';
  titleEl.textContent = line.name || line.openingName || 'Untitled line';
  card.appendChild(titleEl);

  return card;
}

// A static, non-interactive chessground board at the given position.
function mountMiniBoard(el: HTMLElement, fen: string, orientation: 'white' | 'black'): void {
  Chessground(el, {
    fen,
    orientation,
    viewOnly: true,
    coordinates: false,
    drawable: { enabled: false },
    animation: { enabled: false },
    selectable: { enabled: false },
    highlight: { lastMove: false, check: false },
  });
}

// ── Detailed list (View more target — task 3.2 will flesh this out) ──────────

// Re-fetch all lines of a colour, then render the detail list. Used when a card
// is tapped (we only have the one line in hand).
async function renderDetailFromLine(
  container: HTMLElement,
  line: Line,
  deps: LinesDeps
): Promise<void> {
  const all = await getAllLines();
  renderDetail(container, line.colour, all.filter(l => l.colour === line.colour), deps);
}

function renderDetail(
  container: HTMLElement,
  colour: 'white' | 'black',
  lines: Line[],
  deps: LinesDeps
): void {
  container.innerHTML = '';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'detail-back';
  back.appendChild(Icons.back(18));
  back.appendChild(document.createTextNode('My Lines'));
  back.addEventListener('click', () => doRender(container, deps));
  container.appendChild(back);

  const heading = document.createElement('h2');
  heading.className = 'lines-heading';
  heading.textContent = colour === 'white' ? 'White lines' : 'Black lines';
  container.appendChild(heading);

  const rerender = () => renderDetail(container, colour, lines, deps);

  container.appendChild(buildSortRow(() => {
    renderDetail(container, colour, lines, deps);
  }));

  if (lines.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'lines-empty';
    empty.textContent = `No ${colour === 'white' ? 'White' : 'Black'} lines yet.`;
    container.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'lines-section';
  for (const line of sortLines(lines, currentSort)) {
    list.appendChild(buildCard(line, deps.onOpenLine, rerender, deps.onStartTraining));
  }
  container.appendChild(list);
}

function buildSortRow(onChange: () => void): HTMLElement {
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
      onChange();
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
