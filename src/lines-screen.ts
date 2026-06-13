import type { Line } from './types';
import type { MoveNode } from './tree';
import { Chessground } from 'chessground';
import { Chess } from 'chess.js';
import {
  getAllLines,
  saveLine,
  deleteLine,
  getAllGames,
} from './storage';
import { buildMiniBoard } from './board-mini';
import { getShowQuickView, getShowLineMiniatures } from './prefs';
import { lineIsDue } from './scheduler';
import { Icons } from './icons';
import { pushBack } from './back-nav';
import { analyseGames, countGamesPerLine, TOP_N, type Analysis, type OpeningStat } from './analysis';
import { openImportPanel, getGamesSource } from './import-panel';
import { isOpponentTag } from './scout';
import { buildEmptyState } from './empty-state';
import { createFilterBar, type FilterSelection } from './filters';
import type { ImportedGame } from './chesscom';
import { renderLoadError } from './load-error';

// Game analysis walks every imported game through a merged repertoire tree — at
// a year's worth of games that's a visible hitch on a phone. It was being re-run
// on every render AND every sort-toggle. Cache the result against the exact
// games + lines arrays a render pass was handed: a sort toggle reuses the same
// arrays (cache hit), while a fresh fetch after a toggle/delete/import makes new
// arrays (cache busts), so the cache can never go stale.
let analysisCache: { games: ImportedGame[]; lines: Line[]; result: Analysis } | null = null;
function cachedAnalysis(games: ImportedGame[], lines: Line[]): Analysis {
  if (!analysisCache || analysisCache.games !== games || analysisCache.lines !== lines) {
    analysisCache = { games, lines, result: analyseGames(games, lines) };
  }
  return analysisCache.result;
}

let countsCache: { games: ImportedGame[]; lines: Line[]; result: Map<string, number> } | null = null;
function cachedCounts(games: ImportedGame[], lines: Line[]): Map<string, number> {
  if (!countsCache || countsCache.games !== games || countsCache.lines !== lines) {
    countsCache = { games, lines, result: countGamesPerLine(games, lines) };
  }
  return countsCache.result;
}

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

// The final position of a representative line (a flat UCI list) for a
// suggestion miniature. Replays the moves and returns the FEN; a bad/illegal
// move just stops the walk early, so the miniature shows as far as it got.
function fenFromUcis(ucis: string[]): string {
  const chess = new Chess();
  for (const uci of ucis) {
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
    } catch {
      break;
    }
  }
  return chess.fen();
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

// Persistence keys for the shared two-row filter bar (filters.ts). Each list
// keeps its own remembered selection, device-local.
const LINES_FILTER_KEY = 'obertura.lines.filter';
const GAMES_FILTER_KEY = 'obertura.games.filter';

// Which of the two tabs is showing. Module-level so it survives re-renders.
type TabName = 'saved' | 'games';
let activeTab: TabName = 'saved';

// Set by the builder right after a save: the next saved-lines render highlights
// this line and scrolls it into view, so the user can see where it landed and
// add it to training. Consumed (cleared) once shown.
let highlightLineId: string | null = null;
export function focusSavedLine(id: string): void {
  activeTab = 'saved';
  // Clear the colour + tag filters so a freshly-saved line is never hidden
  // behind them; the chosen sort is left alone.
  clearSavedFilterScope();
  highlightLineId = id;
}

// Reset only the saved list's colour + tag selection in its persisted entry,
// leaving the sort untouched. Used so a just-saved line is always visible.
function clearSavedFilterScope(): void {
  try {
    const raw = localStorage.getItem(LINES_FILTER_KEY);
    const sel = raw ? JSON.parse(raw) : {};
    sel.colour = 'all';
    sel.tags = [];
    localStorage.setItem(LINES_FILTER_KEY, JSON.stringify(sel));
  } catch {
    localStorage.removeItem(LINES_FILTER_KEY);
  }
}

export function renderLinesScreen(
  container: HTMLElement,
  deps: LinesDeps
): void {
  void doRender(container, deps);
}

async function doRender(container: HTMLElement, deps: LinesDeps): Promise<void> {
  container.innerHTML = '<p class="lines-loading">Loading…</p>';
  let allLines: Line[];
  let games: ImportedGame[];
  try {
    [allLines, games] = await Promise.all([getAllLines(), getAllGames()]);
  } catch (err) {
    renderLoadError(container, err, () => void doRender(container, deps));
    return;
  }
  container.innerHTML = '';

  const pending: Pending[] = [];

  // Jump to the "From my games" tab (the empty-state carousels offer it as the
  // quieter alternative to building a line by hand).
  const goToGamesTab = () => {
    activeTab = 'games';
    void doRender(container, deps);
  };

  // Quick view: one carousel of mini-boards per colour, title-only cards. When
  // it's switched off in Settings, the per-colour "Add new line" buttons that
  // live in the carousel heads go with it — so surface a compact inline add row
  // instead, keeping the only entry into the builder reachable.
  if (getShowQuickView()) {
    for (const colour of ['white', 'black'] as const) {
      container.appendChild(
        buildCarouselSection(
          colour,
          allLines.filter(l => l.colour === colour),
          deps,
          pending,
          goToGamesTab
        )
      );
    }
  } else {
    container.appendChild(buildInlineAddRow(deps));
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
  goToGamesTab: () => void
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

  const colourName = colour === 'white' ? 'White' : 'Black';

  // Empty colour: drop the bare note (and the head's small Add button) for the
  // shared empty-state pattern — its CTA is the way in, so no duplicate button.
  if (lines.length === 0) {
    section.appendChild(head);
    section.appendChild(buildEmptyState({
      line: `No ${colourName} lines yet.`,
      cta: { label: `+ Add ${colourName} line`, onClick: () => deps.onAddLine(colour) },
      link: { label: 'or import from your games', onClick: goToGamesTab },
    }));
    return section;
  }

  // "+ Add new line" — the only entry into the builder for a fresh line.
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = `lines-add-btn lines-add-btn--${colour}`;
  addBtn.appendChild(Icons.plus(15));
  addBtn.appendChild(document.createTextNode('Add new line'));
  addBtn.addEventListener('click', () => deps.onAddLine(colour));
  head.appendChild(addBtn);

  section.appendChild(head);

  // Horizontally-scrolling track of mini-board cards.
  const carousel = document.createElement('div');
  carousel.className = 'carousel-track';
  for (const line of byLatest(lines)) {
    carousel.appendChild(buildMiniCard(line, deps, pending));
  }
  section.appendChild(carousel);

  return section;
}

// Shown in place of the carousels when quick view is off: one add-line button
// per colour, so a fresh line is still one tap away.
function buildInlineAddRow(deps: LinesDeps): HTMLElement {
  const section = document.createElement('section');
  section.className = 'section lines-add-row';
  for (const colour of ['white', 'black'] as const) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `lines-add-btn lines-add-btn--${colour}`;
    btn.appendChild(Icons.plus(15));
    btn.appendChild(
      document.createTextNode(colour === 'white' ? 'Add White line' : 'Add Black line')
    );
    btn.addEventListener('click', () => deps.onAddLine(colour));
    section.appendChild(btn);
  }
  return section;
}

function buildMiniCard(
  line: Line,
  deps: LinesDeps,
  pending: Pending[]
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

// ── Saved lines tab ──────────────────────────────────────────────────────────

const SAVED_ORDERS: { key: SortMode; label: string }[] = [
  { key: 'latest', label: 'Latest' },
  { key: 'weakest', label: 'Weakest' },
  { key: 'strongest', label: 'Strongest' },
  { key: 'name', label: 'Name' },
];

// Every distinct opponent tag ("vs <name>") across the lines, sorted.
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

// Apply the bar's colour + tag selection (tags OR'd: a line shows if it carries
// any selected tag), then the chosen ordering.
function viewSavedLines(lines: Line[], sel: FilterSelection): Line[] {
  let out = lines;
  if (sel.colour !== 'all') out = out.filter(l => l.colour === sel.colour);
  if (sel.tags.length > 0) out = out.filter(l => sel.tags.some(t => l.tags.includes(t)));
  return sortLines(out, sel.sort as SortMode);
}

function renderSavedTab(
  content: HTMLElement,
  lines: Line[],
  games: ImportedGame[],
  deps: LinesDeps,
  container: HTMLElement
): void {
  content.innerHTML = '';
  const counts = cachedCounts(games, lines);

  // After a toggle/delete/rename, re-fetch lines and re-render this tab.
  const refresh = async () => {
    const fresh = await getAllLines();
    renderSavedTab(content, fresh, games, deps, container);
  };

  // The shared two-row filter bar (filters.ts): colour + sort on row 1, my own
  // tags then vs-opponent tags on row 2. No status here — the saved list has no
  // Due/Learning/Solid buckets. The bar owns + persists its selection; we read
  // it on each rebuild and do the filtering. Changing a filter rebuilds only the
  // list, so the page keeps its place.
  const filter = createFilterBar({
    persistKey: LINES_FILTER_KEY,
    sorts: SAVED_ORDERS,
    defaultSort: 'latest',
    userTags: distinctUserTags(lines),
    opponentTags: distinctOpponentTags(lines),
    onChange: () => rebuildList(),
  });
  content.appendChild(filter.element);

  const sec = document.createElement('div');
  sec.className = 'section';
  const list = document.createElement('div');
  list.className = 'group';
  sec.appendChild(list);
  content.appendChild(sec);

  function rebuildList(): void {
    list.innerHTML = '';
    const shown = viewSavedLines(lines, filter.selection);
    if (shown.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'lines-empty';
      empty.textContent = lines.length === 0 ? 'No saved lines yet.' : 'No lines here yet.';
      list.appendChild(empty);
      return;
    }
    for (const line of shown) {
      list.appendChild(
        buildDetailCard(line, deps, container, refresh, counts.get(line.id) ?? 0)
      );
    }
  }

  rebuildList();
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

  // Top of the card: an optional position miniature on the left, with the title
  // and info stacked beside it on the right.
  const main = document.createElement('div');
  main.className = 'dline-main';

  if (getShowLineMiniatures()) {
    const mini = document.createElement('div');
    mini.className = 'dline-mini';
    mini.appendChild(buildMiniBoard(finalMainlineFen(line.tree), line.colour));
    main.appendChild(mini);
  }

  const body = document.createElement('div');
  body.className = 'dline-body';

  // Title row — its own line. Tap the title (or the eye beside it) to open the
  // line in the builder.
  const titleRowWrap = document.createElement('div');
  titleRowWrap.className = 'dline-titlerow';

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
  titleRowWrap.appendChild(titleRow);

  // The eye: a quiet, right-aligned twin of the title tap — same action, just a
  // visible affordance for it.
  const eyeBtn = document.createElement('button');
  eyeBtn.type = 'button';
  eyeBtn.className = 'dline-icon dline-eye';
  eyeBtn.setAttribute('aria-label', 'Open line');
  eyeBtn.title = 'Open line';
  eyeBtn.appendChild(Icons.eye(18));
  eyeBtn.addEventListener('click', () => deps.onOpenLine(line));
  titleRowWrap.appendChild(eyeBtn);

  body.appendChild(titleRowWrap);

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

  body.appendChild(info);
  main.appendChild(body);
  card.appendChild(main);

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

const SUGGEST_ORDERS: { key: SuggestSort; label: string }[] = [
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
    return;
  }

  const analysis = cachedAnalysis(games, lines);

  // The shared filter bar — colour + sort only here. Suggestions are openings
  // you haven't saved yet, so they carry no tags and there's no row 2.
  const rerender = () => renderGamesTab(content, games, lines, deps, fullRefresh);
  const filter = createFilterBar({
    persistKey: GAMES_FILTER_KEY,
    sorts: SUGGEST_ORDERS,
    defaultSort: 'played',
    onChange: rerender,
  });
  content.appendChild(filter.element);
  const sel = filter.selection;

  let suggestions = analysis.suggestions;
  if (sel.colour !== 'all') {
    suggestions = suggestions.filter(s => s.colour === sel.colour);
  }
  suggestions = sortSuggestions(suggestions, sel.sort as SuggestSort);

  if (suggestions.length === 0) {
    const emptySection = document.createElement('div');
    emptySection.className = 'section';
    const empty = document.createElement('p');
    empty.className = 'lines-empty';
    empty.textContent =
      analysis.suggestions.length === 0
        ? "Nothing to suggest — you've prepped the openings you play. Nice."
        : "No suggestions for this colour.";
    emptySection.appendChild(empty);
    content.appendChild(emptySection);
    return;
  }

  const intro = document.createElement('p');
  intro.className = 'games-intro';
  intro.textContent = 'Openings you play often but haven’t saved yet. Build one:';
  content.appendChild(intro);

  const list = document.createElement('div');
  list.className = 'section lines-section';
  // Keep the top-6 cap, but reveal the rest inline behind a "Show all".
  suggestions.forEach((stat, i) => {
    const card = suggestionCard(stat, deps);
    if (i >= TOP_N) card.hidden = true;
    list.appendChild(card);
  });
  content.appendChild(list);

  if (suggestions.length > TOP_N) {
    content.appendChild(buildShowAllToggle(list, suggestions.length));
  }
}

// A "Show all N" / "Show fewer" toggle that reveals the cards hidden past the
// top-N cap, collapsing them again on a second tap.
function buildShowAllToggle(list: HTMLElement, total: number): HTMLElement {
  let showingAll = false;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-secondary lines-show-all';
  const setLabel = () => {
    btn.textContent = showingAll ? 'Show fewer' : `Show all ${total}`;
  };
  setLabel();
  btn.addEventListener('click', () => {
    showingAll = !showingAll;
    (Array.from(list.children) as HTMLElement[]).forEach((card, i) => {
      card.hidden = !showingAll && i >= TOP_N;
    });
    setLabel();
  });
  return btn;
}

function buildRefreshRow(fullRefresh: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'games-refresh-row';

  const source = getGamesSource();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'games-refresh-btn';
  btn.appendChild(Icons.reset(15));
  btn.appendChild(document.createTextNode(source ? 'Refresh my games' : 'Import my games'));

  const status = document.createElement('span');
  status.className = 'games-refresh-status';
  status.setAttribute('aria-live', 'polite');
  if (source) status.textContent = `${source.username} on ${source.platform === 'lichess' ? 'Lichess' : 'Chess.com'}`;

  // The shared import panel does the scan/filter/import; on success we re-render
  // the whole screen so badges + suggestions reflect the new games.
  btn.addEventListener('click', () => openImportPanel({
    platform: source?.platform,
    username: source?.username,
    onImported: () => fullRefresh(),
  }));

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
  // Built on the .card + .row component layer, to match My Lines.
  const card = document.createElement('div');
  card.className = 'card stat-card games-card';

  // Row 1: optional position miniature + family name and chips.
  const head = document.createElement('div');
  head.className = 'row games-card-head';

  if (getShowLineMiniatures() && stat.repUcis.length > 0) {
    const mini = document.createElement('div');
    mini.className = 'games-card-mini';
    mini.appendChild(buildMiniBoard(fenFromUcis(stat.repUcis), stat.colour));
    head.appendChild(mini);
  }

  const headText = document.createElement('div');
  headText.className = 'games-card-headtext';
  const nameEl = document.createElement('div');
  nameEl.className = 'stat-card-name';
  nameEl.textContent = stat.family;
  headText.appendChild(nameEl);

  const meta = document.createElement('div');
  meta.className = 'stat-card-chips';
  meta.appendChild(colourChip(stat.colour));
  const gamesChip = document.createElement('span');
  gamesChip.className = 'review-stat-chip';
  gamesChip.textContent = `Played ${stat.games}×`;
  meta.appendChild(gamesChip);
  headText.appendChild(meta);
  head.appendChild(headText);
  card.appendChild(head);

  // Row 2: score line — bar + "67% · W-D-L".
  const scoreRowWrap = document.createElement('div');
  scoreRowWrap.className = 'row stat-card-compare';
  const scoreRow = document.createElement('div');
  scoreRow.className = 'review-score-row';
  scoreRow.appendChild(scoreBar(stat.scorePct));
  const scoreText = document.createElement('span');
  scoreText.className = 'review-score-text';
  scoreText.textContent = `${stat.scorePct}% · ${stat.wins}-${stat.draws}-${stat.losses} W-D-L`;
  scoreRow.appendChild(scoreText);
  scoreRowWrap.appendChild(scoreRow);
  card.appendChild(scoreRowWrap);

  // Row 3: the representative line + the Build action.
  const foot = document.createElement('div');
  foot.className = 'row stat-card-foot';
  const lineEl = document.createElement('div');
  lineEl.className = 'review-moves stat-card-note';
  lineEl.textContent = stat.repSans.length > 0 ? formatSanLine(stat.repSans) : '';
  foot.appendChild(lineEl);

  if (stat.repUcis.length > 0 && deps.onBuildLine) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-secondary stat-card-btn';
    btn.textContent = 'Build line';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deps.onBuildLine!(stat.repUcis, stat.colour);
    });
    foot.appendChild(btn);
  }
  card.appendChild(foot);

  return card;
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
  saveBtn.className = 'btn-primary edit-save-btn';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    const newName = nameInput.value.trim() || 'Untitled line';
    await saveLine({ ...line, name: newName });
    close();
    onSaved(newName);
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', close);

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);
  sheet.appendChild(btnRow);

  function close() {
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);

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
  confirmBtn.className = 'btn-danger delete-confirm-btn';
  confirmBtn.appendChild(Icons.trash(15));
  confirmBtn.appendChild(document.createTextNode('Delete'));
  confirmBtn.addEventListener('click', async () => {
    await deleteLine(line.id);
    close();
    onDeleted();
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', close);

  btnRow.appendChild(confirmBtn);
  btnRow.appendChild(cancelBtn);
  sheet.appendChild(btnRow);

  function close() {
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);

  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}
