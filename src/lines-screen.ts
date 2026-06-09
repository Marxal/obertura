import type { Line } from './types';
import type { MoveNode } from './tree';
import { Chessground } from 'chessground';
import {
  getAllLines,
  saveLine,
  deleteLine,
  getAllGames,
  saveGames,
  clearGames,
} from './storage';
import { lineIsDue } from './scheduler';
import { Icons } from './icons';
import { analyseGames, countGamesPerLine, type OpeningStat } from './analysis';
import {
  getUsername,
  importRecentGames,
  MONTHS_BACK,
  type ImportedGame,
} from './chesscom';
import { runAnalysisSelfTest } from './analysis.selftest';

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

type SortMode = 'latest' | 'weakest' | 'strongest' | 'name';

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

// Order options for the "From my games" suggestions.
type SuggestSort = 'played' | 'weakest' | 'name';

function sortSuggestions(stats: OpeningStat[], mode: SuggestSort): OpeningStat[] {
  const copy = [...stats];
  switch (mode) {
    case 'weakest':
      return copy.sort((a, b) => a.scorePct - b.scorePct || b.games - a.games);
    case 'name':
      return copy.sort((a, b) => a.family.localeCompare(b.family));
    case 'played':
    default:
      return copy.sort((a, b) => b.games - a.games || a.family.localeCompare(b.family));
  }
}

interface LinesDeps {
  onOpenLine: (line: Line) => void;
  onAddLine: (colour: 'white' | 'black') => void;
  onStartTraining?: (line: Line) => void;
  // Seed the builder with these UCI moves for the given colour, then open it.
  onBuildLine?: (ucis: string[], colour: 'white' | 'black') => void;
}

// Pending mini-boards: built first, mounted after the layout exists so
// chessground can read real pixel bounds and place pieces correctly.
type Pending = { el: HTMLElement; fen: string; orientation: 'white' | 'black' };

// The colour filter, shared by both tabs. Persisted across re-renders so a
// toggle/rename doesn't reset what you were looking at.
type ColourFilter = 'all' | 'white' | 'black';
let detailFilter: ColourFilter = 'all';
let detailSort: SortMode = 'latest';
let suggestSort: SuggestSort = 'played';

// Which of the two tabs is showing. Module-level so it survives re-renders.
type TabName = 'saved' | 'games';
let activeTab: TabName = 'saved';

// Set by the builder right after a save: the next saved-lines render highlights
// this line and scrolls it into view, so the user can see where it landed and
// add it to training. Consumed (cleared) once shown.
let highlightLineId: string | null = null;
export function focusSavedLine(id: string): void {
  activeTab = 'saved';
  detailFilter = 'all';
  highlightLineId = id;
}

export function renderLinesScreen(
  container: HTMLElement,
  deps: LinesDeps
): void {
  void doRender(container, deps);
}

async function doRender(container: HTMLElement, deps: LinesDeps): Promise<void> {
  container.innerHTML = '<p class="lines-loading">Loading…</p>';
  const [allLines, games] = await Promise.all([getAllLines(), getAllGames()]);
  container.innerHTML = '';

  const playCounts = countGamesPerLine(games, allLines);
  const pending: Pending[] = [];

  // Quick view: one carousel of mini-boards per colour, each with a play badge.
  for (const colour of ['white', 'black'] as const) {
    container.appendChild(
      buildCarouselSection(
        colour,
        allLines.filter(l => l.colour === colour),
        deps,
        pending,
        playCounts
      )
    );
  }

  // Two prominent tabs: SAVED LINES | FROM MY GAMES.
  const content = document.createElement('section');
  content.className = 'lines-tab-content';

  // A full re-render (used by "Refresh my games" once the import finishes).
  const fullRefresh = () => doRender(container, deps);

  const renderActive = () => {
    if (activeTab === 'saved') {
      renderSavedTab(content, allLines, games, deps, container);
    } else {
      renderGamesTab(content, games, allLines, deps, fullRefresh);
    }
  };

  const tabs = buildTabSwitcher(() => {
    updateTabButtons(tabs);
    renderActive();
  });
  container.appendChild(tabs);
  container.appendChild(content);

  updateTabButtons(tabs);
  renderActive();

  // Backup & restore now lives in Settings → Data (a device-wide action), so it's
  // no longer duplicated here.

  // Mount the static boards once the sections are in the (visible) DOM.
  requestAnimationFrame(() => {
    for (const b of pending) mountMiniBoard(b.el, b.fen, b.orientation);
  });
}

// ── Tab switcher (the two important buttons, side by side) ───────────────────

function buildTabSwitcher(onChange: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'lines-tabs';

  const make = (tab: TabName, label: string, icon: SVGElement) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lines-tab';
    btn.dataset.tab = tab;
    icon.classList.add('lines-tab-icon');
    btn.appendChild(icon);
    const span = document.createElement('span');
    span.className = 'lines-tab-label';
    span.textContent = label;
    btn.appendChild(span);
    btn.addEventListener('click', () => {
      if (activeTab === tab) return;
      activeTab = tab;
      onChange();
    });
    return btn;
  };

  row.appendChild(make('saved', 'Saved lines', Icons.list(18)));
  row.appendChild(make('games', 'From my games', Icons.download(18)));
  return row;
}

function updateTabButtons(tabs: HTMLElement): void {
  tabs.querySelectorAll<HTMLElement>('.lines-tab').forEach(btn => {
    const active = btn.dataset.tab === activeTab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-current', active ? 'true' : 'false');
  });
}

// ── Quick view: carousel ─────────────────────────────────────────────────────

function buildCarouselSection(
  colour: 'white' | 'black',
  lines: Line[],
  deps: LinesDeps,
  pending: Pending[],
  playCounts: Map<string, number>
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
    carousel.appendChild(buildMiniCard(line, deps, pending, playCounts.get(line.id) ?? 0));
  }
  section.appendChild(carousel);

  return section;
}

function buildMiniCard(
  line: Line,
  deps: LinesDeps,
  pending: Pending[],
  playCount: number
): HTMLElement {
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

  // Play-count badge from the last import (omitted when zero/unknown).
  if (playCount > 0) {
    const badge = document.createElement('div');
    badge.className = 'carousel-card-badge';
    badge.textContent = `Played ${playCount}×`;
    badge.title = `Played ${playCount} time${playCount === 1 ? '' : 's'} in your games`;
    card.appendChild(badge);
  }

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

// ── Shared controls row: colour filter + order dropdown, on one line ─────────

interface OrderOption<T extends string> {
  key: T;
  label: string;
}

function buildControlsRow<T extends string>(
  currentSort: T,
  orders: OrderOption<T>[],
  onFilterChange: () => void,
  onSortChange: (mode: T) => void
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'dfilter-row';

  // Compact segmented colour filter. White/Black are colour pips (with text
  // labels) so the whole row stays on one line beside the order dropdown.
  const seg = document.createElement('div');
  seg.className = 'dfilter-seg';

  const filters: { key: ColourFilter; label: string; pip?: 'white' | 'black' }[] = [
    { key: 'all', label: 'All' },
    { key: 'white', label: 'White', pip: 'white' },
    { key: 'black', label: 'Black', pip: 'black' },
  ];
  for (const o of filters) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `dfilter-btn${detailFilter === o.key ? ' active' : ''}`;
    if (o.pip) {
      const pip = document.createElement('span');
      pip.className = `colour-pip colour-pip--${o.pip}`;
      pip.setAttribute('aria-hidden', 'true');
      btn.appendChild(pip);
    }
    btn.appendChild(document.createTextNode(o.label));
    btn.setAttribute('aria-label', `Show ${o.label}`);
    btn.addEventListener('click', () => {
      detailFilter = o.key;
      onFilterChange();
    });
    seg.appendChild(btn);
  }
  row.appendChild(seg);

  // Order: an icon + a dropdown showing the active order.
  const orderWrap = document.createElement('div');
  orderWrap.className = 'dorder';

  const orderIcon = Icons.order(16);
  orderIcon.classList.add('dorder-icon');
  orderWrap.appendChild(orderIcon);

  const select = document.createElement('select');
  select.className = 'dorder-select';
  select.setAttribute('aria-label', 'Order');
  for (const o of orders) {
    const opt = document.createElement('option');
    opt.value = o.key;
    opt.textContent = o.label;
    if (currentSort === o.key) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => onSortChange(select.value as T));
  orderWrap.appendChild(select);
  row.appendChild(orderWrap);

  return row;
}

// ── Saved lines tab ──────────────────────────────────────────────────────────

const SAVED_ORDERS: OrderOption<SortMode>[] = [
  { key: 'latest', label: 'Latest' },
  { key: 'weakest', label: 'Weakest' },
  { key: 'strongest', label: 'Strongest' },
  { key: 'name', label: 'Name' },
];

function renderSavedTab(
  content: HTMLElement,
  lines: Line[],
  games: ImportedGame[],
  deps: LinesDeps,
  container: HTMLElement
): void {
  content.innerHTML = '';
  const counts = countGamesPerLine(games, lines);

  // After a toggle/delete/rename, re-fetch lines and re-render this tab.
  const refresh = async () => {
    const fresh = await getAllLines();
    renderSavedTab(content, fresh, games, deps, container);
  };

  const rerender = () => renderSavedTab(content, lines, games, deps, container);
  content.appendChild(
    buildControlsRow(detailSort, SAVED_ORDERS, rerender, mode => {
      detailSort = mode;
      rerender();
    })
  );

  const filtered =
    detailFilter === 'all' ? lines : lines.filter(l => l.colour === detailFilter);

  if (filtered.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'lines-empty';
    empty.style.padding = '0 1rem 0.75rem';
    empty.textContent = lines.length === 0 ? 'No saved lines yet.' : 'No lines here yet.';
    content.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'lines-section';
  for (const line of sortLines(filtered, detailSort)) {
    list.appendChild(
      buildDetailCard(line, deps, container, refresh, counts.get(line.id) ?? 0)
    );
  }
  content.appendChild(list);
}

function buildDetailCard(
  line: Line,
  deps: LinesDeps,
  container: HTMLElement,
  refresh: () => void,
  playCount: number
): HTMLElement {
  const due = line.inTraining && lineIsDue(line);

  const card = document.createElement('div');
  card.className = 'dline-card';

  // Just saved from the builder: draw attention and scroll it into view.
  if (line.id === highlightLineId) {
    card.classList.add('dline-card--highlight');
    highlightLineId = null;
    requestAnimationFrame(() =>
      card.scrollIntoView({ block: 'center', behavior: 'smooth' })
    );
  }

  // Title row — its own line. Tap to open the line in the builder.
  const titleRow = document.createElement('button');
  titleRow.type = 'button';
  titleRow.className = 'dline-open';
  const pip = document.createElement('span');
  pip.className = `colour-pip colour-pip--${line.colour}`;
  pip.setAttribute('aria-hidden', 'true');
  const nameEl = document.createElement('span');
  nameEl.className = 'dline-name';
  nameEl.textContent = line.name || line.openingName || 'Untitled line';
  titleRow.appendChild(pip);
  titleRow.appendChild(nameEl);
  titleRow.addEventListener('click', () => deps.onOpenLine(line));
  card.appendChild(titleRow);

  // Card info, stacked under the title.
  const info = document.createElement('div');
  info.className = 'dline-info';

  if (line.openingName && line.openingName !== nameEl.textContent) {
    const opening = document.createElement('div');
    opening.className = 'dline-opening';
    opening.textContent = line.openingName;
    info.appendChild(opening);
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
    info.appendChild(tagRow);
  }

  // Play-count badge from the last import (omitted when zero/unknown).
  if (playCount > 0) {
    const played = document.createElement('div');
    played.className = 'dline-played';
    played.textContent = `Played ${playCount}× in your games`;
    info.appendChild(played);
  }

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
  info.appendChild(stats);

  card.appendChild(info);

  // Footer: training toggle (+ Due badge) bottom-left, rename/delete bottom-right.
  const footer = document.createElement('div');
  footer.className = 'dline-footer';

  const footerLeft = document.createElement('div');
  footerLeft.className = 'dline-footer-left';

  // The ONE training control: a switch. On = in the drill pool, off = excluded
  // but fully kept (stats and all). No separate pause/remove. Green when ON.
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = `dline-toggle${line.inTraining ? ' dline-toggle--on' : ''}`;
  toggleBtn.setAttribute('role', 'switch');
  toggleBtn.setAttribute('aria-checked', String(line.inTraining));
  const sw = document.createElement('span');
  sw.className = 'dline-switch';
  const knob = document.createElement('span');
  knob.className = 'dline-switch-knob';
  sw.appendChild(knob);
  const toggleLabel = document.createElement('span');
  toggleLabel.className = 'dline-toggle-label';
  toggleLabel.textContent = `Training ${line.inTraining ? 'ON' : 'OFF'}`;
  toggleBtn.appendChild(sw);
  toggleBtn.appendChild(toggleLabel);
  toggleBtn.addEventListener('click', async () => {
    await saveLine({ ...line, inTraining: !line.inTraining });
    refresh();
  });
  footerLeft.appendChild(toggleBtn);

  // Due tag sits right next to the training switch.
  if (due) {
    const dueBadge = document.createElement('span');
    dueBadge.className = 'dline-due';
    dueBadge.textContent = 'Due';
    footerLeft.appendChild(dueBadge);
  }

  footer.appendChild(footerLeft);

  const iconRow = document.createElement('div');
  iconRow.className = 'dline-iconrow';

  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.className = 'dline-icon';
  renameBtn.setAttribute('aria-label', 'Rename line');
  renameBtn.title = 'Rename';
  renameBtn.appendChild(Icons.pencil(16));
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
  iconRow.appendChild(renameBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'dline-icon dline-icon--danger';
  deleteBtn.setAttribute('aria-label', 'Delete line');
  deleteBtn.title = 'Delete';
  deleteBtn.appendChild(Icons.trash(16));
  deleteBtn.addEventListener('click', () =>
    openDeletePopup(line, () => {
      // Drop the matching carousel card too.
      container.querySelector(`.carousel-card[data-line-id="${line.id}"]`)?.remove();
      refresh();
    })
  );
  iconRow.appendChild(deleteBtn);

  footer.appendChild(iconRow);
  card.appendChild(footer);

  return card;
}

function sepDot(): HTMLElement {
  const sep = document.createElement('span');
  sep.className = 'dline-sep';
  sep.setAttribute('aria-hidden', 'true');
  sep.textContent = '·';
  return sep;
}

// ── From my games tab ────────────────────────────────────────────────────────
//
// From the imported-games analysis, surface openings you actually play but have
// no prep for yet, each with a one-tap "Build line" into the builder. A
// "Refresh my games" button re-runs the import so badges and suggestions update.

const SUGGEST_ORDERS: OrderOption<SuggestSort>[] = [
  { key: 'played', label: 'Most played' },
  { key: 'weakest', label: 'Weakest' },
  { key: 'name', label: 'Name' },
];

function renderGamesTab(
  content: HTMLElement,
  games: ImportedGame[],
  lines: Line[],
  deps: LinesDeps,
  fullRefresh: () => void
): void {
  content.innerHTML = '';

  // Refresh button row — always available so badges/suggestions can be redone.
  content.appendChild(buildRefreshRow(fullRefresh));

  if (games.length === 0) {
    const wrap = document.createElement('div');
    wrap.className = 'train-empty';
    const title = document.createElement('p');
    title.className = 'train-empty-title';
    title.textContent = 'No games imported yet';
    wrap.appendChild(title);
    const body = document.createElement('p');
    body.className = 'train-empty-body';
    body.textContent =
      'Import your Chess.com games in Build → Settings (or tap Refresh if your ' +
      'username is already saved). Then this tab suggests openings you play but ' +
      'haven’t saved.';
    wrap.appendChild(body);
    content.appendChild(wrap);
    appendSelfTestLink(content);
    return;
  }

  const analysis = analyseGames(games, lines);

  const rerender = () => renderGamesTab(content, games, lines, deps, fullRefresh);
  content.appendChild(
    buildControlsRow(suggestSort, SUGGEST_ORDERS, rerender, mode => {
      suggestSort = mode;
      rerender();
    })
  );

  let suggestions = analysis.suggestions;
  if (detailFilter !== 'all') {
    suggestions = suggestions.filter(s => s.colour === detailFilter);
  }
  suggestions = sortSuggestions(suggestions, suggestSort);

  if (suggestions.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'lines-empty';
    empty.style.padding = '0 1rem 0.75rem';
    empty.textContent =
      analysis.suggestions.length === 0
        ? 'Nothing to suggest — you’ve prepped the openings you play. Nice.'
        : 'No suggestions for this colour.';
    content.appendChild(empty);
    appendSelfTestLink(content);
    return;
  }

  const intro = document.createElement('p');
  intro.className = 'games-intro';
  intro.textContent = 'Openings you play often but haven’t saved yet. Build one:';
  content.appendChild(intro);

  const list = document.createElement('div');
  list.className = 'lines-section';
  for (const stat of suggestions) {
    list.appendChild(suggestionCard(stat, deps));
  }
  content.appendChild(list);

  appendSelfTestLink(content);
}

function buildRefreshRow(fullRefresh: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'games-refresh-row';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'games-refresh-btn';
  btn.appendChild(Icons.reset(15));
  btn.appendChild(document.createTextNode('Refresh my games'));

  const status = document.createElement('span');
  status.className = 'games-refresh-status';
  status.setAttribute('aria-live', 'polite');

  btn.addEventListener('click', async () => {
    const user = getUsername();
    if (!user) {
      status.textContent = 'Add your Chess.com username in Build → Settings first.';
      return;
    }
    btn.disabled = true;
    status.textContent = 'Refreshing…';
    try {
      // Re-import from scratch so removed/renamed games don't linger.
      await clearGames();
      let total = 0;
      await importRecentGames(user, {
        months: MONTHS_BACK,
        onProgress: p => {
          status.textContent =
            `Month ${Math.min(p.monthsDone + 1, p.monthsTotal)}/${p.monthsTotal} ` +
            `— ${p.gamesSoFar} games…`;
        },
        onGames: async batch => {
          await saveGames(batch);
          total += batch.length;
        },
      });
      status.textContent = `Imported ${total} games ✓`;
      // Re-render the whole screen so badges + suggestions reflect the import.
      fullRefresh();
    } catch (err) {
      status.textContent = `Refresh failed — ${(err as Error).message}`;
      btn.disabled = false;
    }
  });

  row.appendChild(btn);
  row.appendChild(status);
  return row;
}

function colourChip(colour: 'white' | 'black'): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'tag-chip';
  chip.textContent = colour === 'white' ? '○ White' : '● Black';
  return chip;
}

// A win/draw/loss score bar, green→amber→red by how good the score is.
function scoreBar(pct: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'review-score-bar';
  const fill = document.createElement('div');
  fill.className = 'review-score-fill';
  fill.style.width = `${Math.max(4, Math.min(100, pct))}%`;
  fill.style.background = pct >= 55 ? '#2a6b3a' : pct >= 45 ? '#d8961f' : '#c0531f';
  wrap.appendChild(fill);
  return wrap;
}

// "1.e4 e5 2.Nf3 Nc6 3.Bc4" from a flat SAN list.
function formatSanLine(sans: string[]): string {
  let out = '';
  for (let i = 0; i < sans.length; i++) {
    if (i % 2 === 0) out += `${i / 2 + 1}.${sans[i]} `;
    else out += `${sans[i]} `;
  }
  return out.trim();
}

function suggestionCard(stat: OpeningStat, deps: LinesDeps): HTMLElement {
  const card = document.createElement('div');
  card.className = 'line-card review-card';

  const body = document.createElement('div');
  body.className = 'line-card-body review-card-body';

  const nameEl = document.createElement('div');
  nameEl.className = 'line-card-name';
  nameEl.textContent = stat.family;
  body.appendChild(nameEl);

  const meta = document.createElement('div');
  meta.className = 'line-card-meta';
  meta.appendChild(colourChip(stat.colour));
  const gamesChip = document.createElement('span');
  gamesChip.className = 'review-stat-chip';
  gamesChip.textContent = `Played ${stat.games}×`;
  meta.appendChild(gamesChip);
  body.appendChild(meta);

  // Score line: bar + "67% · W-D-L".
  const scoreRow = document.createElement('div');
  scoreRow.className = 'review-score-row';
  scoreRow.appendChild(scoreBar(stat.scorePct));
  const scoreText = document.createElement('span');
  scoreText.className = 'review-score-text';
  scoreText.textContent = `${stat.scorePct}% · ${stat.wins}-${stat.draws}-${stat.losses} W-D-L`;
  scoreRow.appendChild(scoreText);
  body.appendChild(scoreRow);

  // The representative line, so you recognise which variation this is.
  if (stat.repSans.length > 0) {
    const lineEl = document.createElement('div');
    lineEl.className = 'review-moves';
    lineEl.textContent = formatSanLine(stat.repSans);
    body.appendChild(lineEl);
  }

  card.appendChild(body);

  if (stat.repUcis.length > 0 && deps.onBuildLine) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'review-build-btn';
    btn.textContent = 'Build line';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deps.onBuildLine!(stat.repUcis, stat.colour);
    });
    card.appendChild(btn);
  }

  return card;
}

// ── Analysis self-test (verify the maths on the phone, offline) ──────────────

function appendSelfTestLink(container: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'selftest-wrap';

  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'selftest-link';
  link.textContent = 'Run analysis self-test';

  const out = document.createElement('div');
  out.className = 'selftest-output';
  out.hidden = true;

  link.addEventListener('click', () => {
    const results = runAnalysisSelfTest();
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
    console.log('[analysis self-test]', results);
  });

  wrap.appendChild(link);
  wrap.appendChild(out);
  container.appendChild(wrap);
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

  // Mini-board of the line's position so you can recognise what you're naming.
  const boardWrap = document.createElement('div');
  boardWrap.className = 'rename-board';
  const board = document.createElement('div');
  board.className = 'rename-board-inner';
  boardWrap.appendChild(board);
  sheet.appendChild(boardWrap);

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
  requestAnimationFrame(() => {
    mountMiniBoard(board, finalMainlineFen(line.tree), line.colour);
    nameInput.focus();
  });
}

// ── Delete confirmation popup ────────────────────────────────────────────────

function openDeletePopup(line: Line, onDeleted: () => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet';

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = 'Delete this line?';
  sheet.appendChild(title);

  const warn = document.createElement('p');
  warn.className = 'delete-warn';
  const label = line.name || line.openingName || 'this line';
  warn.textContent =
    `“${label}” and all of its training data — confidence, review history and ` +
    `schedule — will be permanently deleted. This can’t be undone.`;
  sheet.appendChild(warn);

  const btnRow = document.createElement('div');
  btnRow.className = 'edit-btn-row';

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'delete-confirm-btn';
  confirmBtn.appendChild(Icons.trash(15));
  confirmBtn.appendChild(document.createTextNode('Delete'));
  confirmBtn.addEventListener('click', async () => {
    await deleteLine(line.id);
    close();
    onDeleted();
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'edit-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', close);

  btnRow.appendChild(confirmBtn);
  btnRow.appendChild(cancelBtn);
  sheet.appendChild(btnRow);

  function close() {
    overlay.remove();
  }

  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}
