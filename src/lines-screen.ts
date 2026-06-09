import type { Line } from './types';
import type { MoveNode } from './tree';
import { Chessground } from 'chessground';
import { getAllLines, saveLine, deleteLine } from './storage';
import { lineIsDue } from './scheduler';
import { Icons } from './icons';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

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

function byLatest(lines: Line[]): Line[] {
  return [...lines].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

interface LinesDeps {
  onOpenLine: (line: Line) => void;
  onAddLine: (colour: 'white' | 'black') => void;
  onStartTraining?: (line: Line) => void;
}

// Pending mini-boards: built first, mounted after the layout exists so
// chessground can read real pixel bounds and place pieces correctly.
type Pending = { el: HTMLElement; fen: string; orientation: 'white' | 'black' };

// The colour filter on the detailed list. Persisted across re-renders so a
// toggle/rename doesn't reset what you were looking at.
type ColourFilter = 'all' | 'white' | 'black';
let detailFilter: ColourFilter = 'all';

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

  const pending: Pending[] = [];

  // Quick view: one carousel of mini-boards per colour.
  for (const colour of ['white', 'black'] as const) {
    container.appendChild(
      buildCarouselSection(colour, allLines.filter(l => l.colour === colour), deps, pending)
    );
  }

  // Detailed list: same page, scrolled below the carousels.
  const detailWrap = document.createElement('section');
  detailWrap.className = 'detail-list';
  container.appendChild(detailWrap);

  // Re-fetch and re-render only the detail list (used after toggle/delete so
  // we don't re-mount every mini-board or jump the scroll back to the top).
  const refreshDetail = async () => {
    const fresh = await getAllLines();
    renderDetailList(detailWrap, fresh, deps, container, refreshDetail);
  };
  renderDetailList(detailWrap, allLines, deps, container, refreshDetail);

  // Mount the static boards once the sections are in the (visible) DOM.
  requestAnimationFrame(() => {
    for (const b of pending) mountMiniBoard(b.el, b.fen, b.orientation);
  });
}

// ── Quick view: carousel ─────────────────────────────────────────────────────

function buildCarouselSection(
  colour: 'white' | 'black',
  lines: Line[],
  deps: LinesDeps,
  pending: Pending[]
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

  // "+ Add new line" — the only entry into the builder for a fresh line.
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
  for (const line of byLatest(lines)) {
    carousel.appendChild(buildMiniCard(line, deps, pending));
  }
  section.appendChild(carousel);

  return section;
}

function buildMiniCard(line: Line, deps: LinesDeps, pending: Pending[]): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'carousel-card';
  card.dataset.lineId = line.id;
  // Tapping a mini-board opens that individual line in the builder.
  card.addEventListener('click', () => deps.onOpenLine(line));

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

// ── Detailed list ────────────────────────────────────────────────────────────

function renderDetailList(
  wrap: HTMLElement,
  allLines: Line[],
  deps: LinesDeps,
  container: HTMLElement,
  refresh: () => void
): void {
  wrap.innerHTML = '';

  const heading = document.createElement('h2');
  heading.className = 'lines-heading';
  heading.textContent = 'All lines';
  wrap.appendChild(heading);

  // Colour filter: All / White / Black.
  wrap.appendChild(buildFilterRow(() => renderDetailList(wrap, allLines, deps, container, refresh)));

  const filtered =
    detailFilter === 'all' ? allLines : allLines.filter(l => l.colour === detailFilter);

  if (filtered.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'lines-empty';
    empty.style.padding = '0 1rem 0.75rem';
    empty.textContent = 'No lines here yet.';
    wrap.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'lines-section';
  // Both colours piled together, newest first.
  for (const line of byLatest(filtered)) {
    list.appendChild(buildDetailCard(line, deps, container, refresh));
  }
  wrap.appendChild(list);
}

function buildFilterRow(onChange: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'dfilter-row';

  const label = document.createElement('span');
  label.className = 'dfilter-label';
  label.textContent = 'Show:';
  row.appendChild(label);

  const opts: { key: ColourFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'white', label: 'White' },
    { key: 'black', label: 'Black' },
  ];

  for (const o of opts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `dfilter-btn${detailFilter === o.key ? ' active' : ''}`;
    btn.textContent = o.label;
    btn.addEventListener('click', () => {
      detailFilter = o.key;
      onChange();
    });
    row.appendChild(btn);
  }

  return row;
}

function buildDetailCard(
  line: Line,
  deps: LinesDeps,
  container: HTMLElement,
  refresh: () => void
): HTMLElement {
  const due = line.inTraining && lineIsDue(line);

  const card = document.createElement('div');
  card.className = 'dline-card';

  // Title gets the whole top row — colour pip + name.
  const titleRow = document.createElement('div');
  titleRow.className = 'dline-title';
  const pip = document.createElement('span');
  pip.className = `colour-pip colour-pip--${line.colour}`;
  pip.setAttribute('aria-hidden', 'true');
  const nameEl = document.createElement('span');
  nameEl.className = 'dline-name';
  nameEl.textContent = line.name || line.openingName || 'Untitled line';
  titleRow.appendChild(pip);
  titleRow.appendChild(nameEl);
  if (due) {
    const dueBadge = document.createElement('span');
    dueBadge.className = 'dline-due';
    dueBadge.textContent = 'Due';
    titleRow.appendChild(dueBadge);
  }
  card.appendChild(titleRow);

  // Opening name (when it differs from the title) + tags.
  if (line.openingName && line.openingName !== nameEl.textContent) {
    const opening = document.createElement('div');
    opening.className = 'dline-opening';
    opening.textContent = line.openingName;
    card.appendChild(opening);
  }

  if (line.tags.length) {
    const tagRow = document.createElement('div');
    tagRow.className = 'dline-tags';
    for (const tag of line.tags) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = tag;
      tagRow.appendChild(chip);
    }
    card.appendChild(tagRow);
  }

  // Stats row: confidence · last-trained · in-training state.
  const stats = document.createElement('div');
  stats.className = 'dline-stats';

  const conf = document.createElement('span');
  conf.className = 'dline-stat';
  conf.textContent = `Confidence ${confidenceDots(line.confidence)}`;
  stats.appendChild(conf);

  stats.appendChild(sepDot());

  const last = document.createElement('span');
  last.className = 'dline-stat';
  last.textContent = line.lastTrained ? `Trained ${relativeDate(line.lastTrained)}` : 'Never trained';
  stats.appendChild(last);

  stats.appendChild(sepDot());

  const state = document.createElement('span');
  state.className = `dline-stat dline-state${line.inTraining ? ' dline-state--on' : ''}`;
  state.textContent = line.inTraining ? 'In training' : 'Not training';
  stats.appendChild(state);

  card.appendChild(stats);

  // Quiet (tonal) actions below: Rename · Open · In-training toggle · Delete.
  const actions = document.createElement('div');
  actions.className = 'dline-actions';

  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.className = 'dline-act';
  renameBtn.textContent = 'Rename';
  renameBtn.addEventListener('click', () =>
    openRenameSheet(line, newName => {
      // Keep the carousel title in sync without re-mounting boards.
      const carouselTitle = container.querySelector<HTMLElement>(
        `.carousel-card[data-line-id="${line.id}"] .carousel-card-title`
      );
      if (carouselTitle) carouselTitle.textContent = newName;
      refresh();
    })
  );
  actions.appendChild(renameBtn);

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'dline-act';
  openBtn.textContent = 'Open';
  openBtn.addEventListener('click', () => deps.onOpenLine(line));
  actions.appendChild(openBtn);

  // The ONE training control: on = in the drill pool, off = excluded but kept
  // (stats and all). No separate pause/remove.
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = `dline-act dline-toggle${line.inTraining ? ' dline-toggle--on' : ''}`;
  toggleBtn.setAttribute('role', 'switch');
  toggleBtn.setAttribute('aria-checked', String(line.inTraining));
  toggleBtn.textContent = line.inTraining ? 'In training: ON' : 'In training: OFF';
  toggleBtn.addEventListener('click', async () => {
    await saveLine({ ...line, inTraining: !line.inTraining });
    refresh();
  });
  actions.appendChild(toggleBtn);

  // Delete — discrete, tap-again-to-confirm. The only full removal.
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'dline-act dline-act--danger';
  deleteBtn.textContent = 'Delete';
  let awaitingConfirm = false;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  deleteBtn.addEventListener('click', async () => {
    if (!awaitingConfirm) {
      awaitingConfirm = true;
      deleteBtn.textContent = 'Tap to confirm';
      deleteBtn.classList.add('confirming');
      resetTimer = setTimeout(() => {
        awaitingConfirm = false;
        deleteBtn.textContent = 'Delete';
        deleteBtn.classList.remove('confirming');
      }, 3000);
      return;
    }
    if (resetTimer) clearTimeout(resetTimer);
    await deleteLine(line.id);
    // Drop the matching carousel card too.
    container
      .querySelector(`.carousel-card[data-line-id="${line.id}"]`)
      ?.remove();
    refresh();
  });
  actions.appendChild(deleteBtn);

  card.appendChild(actions);

  return card;
}

function sepDot(): HTMLElement {
  const sep = document.createElement('span');
  sep.className = 'dline-sep';
  sep.setAttribute('aria-hidden', 'true');
  sep.textContent = '·';
  return sep;
}

// ── Rename sheet (bottom-sheet modal, name only) ─────────────────────────────

function openRenameSheet(line: Line, onSaved: (newName: string) => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet';

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = 'Rename line';
  sheet.appendChild(title);

  const nameLabel = document.createElement('label');
  nameLabel.className = 'edit-label';
  nameLabel.textContent = 'Name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'edit-input';
  nameInput.value = line.name;
  nameInput.placeholder = 'Line name';
  sheet.appendChild(nameLabel);
  sheet.appendChild(nameInput);

  const btnRow = document.createElement('div');
  btnRow.className = 'edit-btn-row';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'edit-save-btn';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    const newName = nameInput.value.trim() || 'Untitled line';
    await saveLine({ ...line, name: newName });
    close();
    onSaved(newName);
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'edit-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', close);

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);
  sheet.appendChild(btnRow);

  function close() {
    overlay.remove();
  }

  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });

  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveBtn.click();
  });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => nameInput.focus());
}
