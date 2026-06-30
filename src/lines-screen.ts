import type { Line } from './types';
import { Chessground } from 'chessground';
import {
  getAllLines,
  saveLine,
  deleteLine,
  getAllGames,
} from './storage';
import { buildPositionCard, colourPip, lineFinalFen, fenFromUcis } from './card-position';
import { getShowQuickView } from './prefs';
import { Icons } from './icons';
import { userAvatar } from './avatar';
import { pushBack } from './back-nav';
import { analyseGames, countGamesPerLine, openingFamily, TOP_N, type Analysis, type OpeningStat } from './analysis';
import { renderFamilyGroups } from './line-groups';
import { openImportPanel, getGamesSource } from './import-panel';
import { isOpponentTag } from './scout';
import { buildEmptyState } from './empty-state';
import { createFilterBar, type FilterSelection } from './filters';
import type { ImportedGame } from './chesscom';
import { renderLoadError } from './load-error';
import { formatSanLine } from './notation';

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
  // Open the import-your-games flow (the leading "get your openings in" action).
  onImportGames: () => void;
  // Open the starter-pack picker (the curated quick-start route).
  onPickStarterPack: () => void;
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

// Which opening families are expanded in the grouped saved view. Module-level so
// a filter change / refresh keeps the open/closed state across re-renders.
const expandedFamilies = new Set<string>();

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

  // Default landing tab. With no saved lines yet but games already imported, the
  // Saved tab is just an empty state — open straight on "From my games" so the
  // user lands on opening suggestions instead of a blank list. This only nudges
  // away from a still-default Saved tab; an explicit jump to "From my games"
  // (a tab tap or goToGamesTab) sets activeTab = 'games' and is left untouched.
  if (activeTab === 'saved' && allLines.length === 0 && games.length > 0) {
    activeTab = 'games';
  }

  const hasGames = games.length > 0;

  const pending: Pending[] = [];

  // Jump to the "From my games" tab (the empty-state carousels offer it as the
  // quieter alternative to building a line by hand).
  const goToGamesTab = () => {
    activeTab = 'games';
    void doRender(container, deps);
  };

  // Quick view: one carousel of mini-boards per colour, title-only cards, each
  // with its own "Add new line" button in the head. When it's switched off in
  // Settings, no add row appears here — the FAB's "New line" (White | Black) is
  // the way in, so a fresh line is still one tap away.
  if (getShowQuickView()) {
    for (const colour of ['white', 'black'] as const) {
      container.appendChild(
        buildCarouselSection(
          colour,
          allLines.filter(l => l.colour === colour),
          deps,
          pending,
          goToGamesTab,
          hasGames
        )
      );
    }
  }

  // Two prominent tabs: SAVED LINES | FROM MY GAMES.
  const content = document.createElement('section');
  content.className = 'lines-tab-content';

  // A full re-render (used by "Refresh my games" once the import finishes).
  const fullRefresh = () => doRender(container, deps);

  const renderActive = () => {
    if (activeTab === 'saved') {
      renderSavedTab(content, allLines, games, deps, container, goToGamesTab, hasGames);
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
  goToGamesTab: () => void,
  hasGames: boolean
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
      // Importing your games is the fastest way to a repertoire that's actually
      // yours, so it leads; building by hand and the starter packs sit below.
      cta: { label: 'Import my games', onClick: () => deps.onImportGames() },
      secondaryActions: [
        { label: 'Build a line myself', onClick: () => deps.onAddLine(colour) },
        { label: 'Pick a starter pack', onClick: () => deps.onPickStarterPack() },
      ],
      // Once games are imported the games tab shows suggestions, not an import
      // prompt — so point there with matching wording.
      ...(hasGames
        ? { link: { label: 'or see suggestions from your games', onClick: goToGamesTab } }
        : {}),
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
  pending.push({ el: board, fen: lineFinalFen(line.tree), orientation: line.colour });

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

// Line counts per colour and per tag, for the tab/chip count badges.
function countLinesByColour(lines: Line[]): { all: number; white: number; black: number } {
  let white = 0, black = 0;
  for (const l of lines) (l.colour === 'black' ? black++ : white++);
  return { all: lines.length, white, black };
}
function countLinesByTag(lines: Line[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const l of lines) for (const t of l.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
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
  container: HTMLElement,
  goToGamesTab: () => void,
  hasGames: boolean
): void {
  content.innerHTML = '';
  const counts = cachedCounts(games, lines);

  // After a toggle/delete/rename, re-fetch lines and re-render this tab.
  const refresh = async () => {
    const fresh = await getAllLines();
    renderSavedTab(content, fresh, games, deps, container, goToGamesTab, hasGames);
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
    colourCounts: countLinesByColour(lines),
    countsForColour: (colour) => ({
      tagCounts: countLinesByTag(colour === 'all' ? lines : lines.filter(l => l.colour === colour)),
    }),
    group: true,
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
      if (lines.length === 0) {
        list.appendChild(buildEmptyState({
          line: 'No saved lines yet.',
          cta: { label: '+ Add a line', onClick: () => deps.onAddLine('white') },
          link: {
            label: hasGames ? 'or see suggestions from your games' : 'or import from your games',
            onClick: goToGamesTab,
          },
        }));
        return;
      }
      const empty = document.createElement('p');
      empty.className = 'lines-empty';
      empty.textContent = 'No lines here yet.';
      list.appendChild(empty);
      return;
    }
    if (filter.selection.group) {
      // Open the just-saved line's family so its highlighted card shows.
      if (highlightLineId) {
        const hit = shown.find(l => l.id === highlightLineId);
        if (hit) expandedFamilies.add(openingFamily(hit.openingName));
      }
      renderFamilyGroups(
        list,
        shown,
        line => buildDetailCard(line, deps, container, refresh, counts.get(line.id) ?? 0),
        expandedFamilies,
      );
    } else {
      for (const line of shown) {
        list.appendChild(
          buildDetailCard(line, deps, container, refresh, counts.get(line.id) ?? 0)
        );
      }
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
  // Shared position-card scaffold: title row on top, a larger miniature on the
  // left of row 2 with the info + actions on the right.
  const { card, titleRow: titleRowWrap, content } = buildPositionCard({
    fen: lineFinalFen(line.tree),
    orientation: line.colour,
    onMiniClick: () => deps.onOpenLine(line),
    miniLabel: 'Open line',
  });

  // Just saved from the builder: draw attention and scroll it into view.
  const justSaved = line.id === highlightLineId;
  if (justSaved) {
    card.classList.add('dline-card--highlight');
    highlightLineId = null;
    requestAnimationFrame(() =>
      card.scrollIntoView({ block: 'center', behavior: 'smooth' })
    );
  }

  // Title row (row 1) — full width. Tap the title to open the line in the builder.
  const titleRow = document.createElement('button');
  titleRow.type = 'button';
  titleRow.className = 'pcard-title';
  titleRow.appendChild(colourPip(line.colour));
  const nameEl = document.createElement('span');
  nameEl.className = 'pcard-name';
  nameEl.textContent = line.name || line.openingName || 'Untitled line';
  titleRow.appendChild(nameEl);
  // A short-lived "New" chip on the line you just saved, so it's easy to spot.
  if (justSaved) {
    const newBadge = document.createElement('span');
    newBadge.className = 'dline-new-badge';
    newBadge.textContent = 'New';
    titleRow.appendChild(newBadge);
  }
  titleRow.addEventListener('click', () => deps.onOpenLine(line));
  titleRowWrap.appendChild(titleRow);

  // Edit: a quiet, right-aligned twin of the title — opens the rename sheet.
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'dline-icon dline-edit';
  editBtn.setAttribute('aria-label', 'Edit name');
  editBtn.title = 'Edit name';
  editBtn.appendChild(Icons.pencil(16));
  editBtn.addEventListener('click', () =>
    openRenameSheet(line, newName => {
      // Keep the carousel title in sync without re-mounting boards.
      const carouselTitle = container.querySelector<HTMLElement>(
        `.carousel-card[data-line-id="${line.id}"] .carousel-card-title`
      );
      if (carouselTitle) carouselTitle.textContent = newName;
      refresh();
    })
  );
  titleRowWrap.appendChild(editBtn);

  // Card info, stacked beside the board.
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

  content.appendChild(info);

  // Footer: training toggle (+ Due badge) bottom-left, delete bottom-right.
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

  footer.appendChild(footerLeft);

  // Delete sits on the training row, right-aligned (rename lives up in the title row).
  const iconRow = document.createElement('div');
  iconRow.className = 'dline-iconrow';

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
  content.appendChild(footer);

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

  if (games.length === 0) {
    // No games yet: the explanation stays, but Import is the prominent green
    // action — with the same two quick-start routes as the Saved tab below it.
    content.appendChild(buildEmptyState({
      icon: Icons.download(28),
      line: 'No games imported yet',
      body: 'Pull your recent games from Chess.com or Lichess to see which ' +
        'openings you actually play — then this tab suggests the ones you haven’t ' +
        'saved yet.',
      cta: { label: 'Import my games', onClick: () => deps.onImportGames() },
      secondaryActions: [
        { label: 'Build a line myself', onClick: () => deps.onAddLine('white') },
        { label: 'Pick a starter pack', onClick: () => deps.onPickStarterPack() },
      ],
    }));
    return;
  }

  // Refresh button row — available once games exist so badges/suggestions can be
  // redone (and the saved source stays handy).
  content.appendChild(buildRefreshRow(fullRefresh));

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

  // Section + inner .group so the cards sit edge-to-edge (no surrounding box),
  // exactly like Saved lines — `.section:has(.group)` drops the section chrome.
  const sec = document.createElement('div');
  sec.className = 'section';
  const list = document.createElement('div');
  list.className = 'group';
  // Keep the top-6 cap, but reveal the rest inline behind a "Show all".
  suggestions.forEach((stat, i) => {
    const card = suggestionCard(stat, deps);
    if (i >= TOP_N) card.hidden = true;
    list.appendChild(card);
  });
  sec.appendChild(list);
  content.appendChild(sec);

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
  if (source) {
    // Your picture (Chess.com only) next to "username on Platform".
    status.appendChild(userAvatar(source.avatarUrl, 18));
    const who = document.createElement('span');
    who.className = 'games-refresh-who';
    who.textContent = `${source.username} on ${source.platform === 'lichess' ? 'Lichess' : 'Chess.com'}`;
    status.appendChild(who);
  }

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

function suggestionCard(stat: OpeningStat, deps: LinesDeps): HTMLElement {
  // Shared position-card scaffold so suggestions read like the saved-line cards:
  // family name + colour pip on row 1, a larger miniature on the left of row 2
  // with the score, line and Build action stacked on the right.
  const { card, titleRow, content } = buildPositionCard({
    fen: stat.repUcis.length > 0 ? fenFromUcis(stat.repUcis) : null,
    orientation: stat.colour,
    className: 'games-card',
    ...(stat.repUcis.length > 0 && deps.onBuildLine && {
      onMiniClick: () => deps.onBuildLine!(stat.repUcis, stat.colour),
      miniLabel: 'Build this line',
    }),
  });

  // Row 1: colour pip + opening family name.
  titleRow.appendChild(colourPip(stat.colour));
  const nameEl = document.createElement('span');
  nameEl.className = 'pcard-name';
  nameEl.textContent = stat.family;
  titleRow.appendChild(nameEl);

  // Played-count chip.
  const meta = document.createElement('div');
  meta.className = 'stat-card-chips';
  const gamesChip = document.createElement('span');
  gamesChip.className = 'review-stat-chip';
  gamesChip.textContent = `Played ${stat.games}×`;
  meta.appendChild(gamesChip);
  content.appendChild(meta);

  // Score line — bar + "67% · W-D-L".
  const scoreRow = document.createElement('div');
  scoreRow.className = 'review-score-row';
  scoreRow.appendChild(scoreBar(stat.scorePct));
  const scoreText = document.createElement('span');
  scoreText.className = 'review-score-text';
  scoreText.textContent = `${stat.scorePct}% · ${stat.wins}-${stat.draws}-${stat.losses} W-D-L`;
  scoreRow.appendChild(scoreText);
  content.appendChild(scoreRow);

  // The representative line.
  if (stat.repSans.length > 0) {
    const lineEl = document.createElement('div');
    lineEl.className = 'review-moves stat-card-note';
    lineEl.textContent = formatSanLine(stat.repSans);
    content.appendChild(lineEl);
  }

  // The Build action.
  if (stat.repUcis.length > 0 && deps.onBuildLine) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-secondary stat-card-btn';
    btn.textContent = 'Build line';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deps.onBuildLine!(stat.repUcis, stat.colour);
    });
    content.appendChild(btn);
  }

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
    mountMiniBoard(board, lineFinalFen(line.tree), line.colour);
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
