import type { Line } from './types';
import {
  getAllLines,
  saveLine,
  deleteLine,
  getAllGames,
} from './storage';
import { requestTrainingSlot } from './entitlement';
import { buildPositionCard, colourPip, lineFinalFen, fenFromUcis } from './card-position';
import { Icons } from './icons';
import { userAvatar } from './avatar';
import { pushBack } from './back-nav';
import { analyseGames, countGamesPerLine, openingFamily, TOP_N, type Analysis, type OpeningStat } from './analysis';
import { renderFamilyGroups, renderVariationGroups } from './line-groups';
import { openImportPanel, getGamesSource } from './import-panel';
import { isOpponentTag } from './scout';
import { buildEmptyState } from './empty-state';
import { buildInlineImport } from './import-inline';
import { createFilterBar, type FilterSelection } from './filters';
import { renderLinesTree, disposeLinesTree } from './lines-tree-view';
import {
  renderRepertoirePicker, loadBookRows, lineInBook, selectedBookId,
  setSelectedBookId, type BookRow,
} from './repertoire-picker';
import { openBranchSheet, openBranchSheetForLine } from './branch-sheet';
import { byNewestFirst, parseLineId } from './lines-view';
import { renderCoverageLauncher, type CoverageSection } from './coverage-section';
import { openCoverageScreen } from './coverage-screen';
import type { ImportedGame } from './chesscom';
import { renderLoadError } from './load-error';
import { formatSanLine } from './notation';
import {
  lineStatus, lineTraining, lineTrainingText, lineMastered,
} from './line-status';
import { openLinePeek } from './line-peek';

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

// The Coverage launcher's handle, so a re-render (tab switch, filter change,
// refresh after a save) detaches the previous one before drawing a new row —
// otherwise a pass still running would paint into a node that has gone.
let coverageLauncher: CoverageSection | null = null;
function disposeCoverageLauncher(): void {
  coverageLauncher?.dispose();
  coverageLauncher = null;
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
      return copy.sort(byNewestFirst);
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
  // "Drill it" from a line's popup: drills an in-training line straight away,
  // and runs the add-to-training flow for one that isn't in the rotation yet.
  onTrainLine?: (lineId: string, inTraining: boolean) => void;
  onAddLine: (colour: 'white' | 'black') => void;
  onStartTraining?: (line: Line) => void;
  // Seed the builder with these UCI moves for the given colour, then open it.
  onBuildLine?: (ucis: string[], colour: 'white' | 'black') => void;
  // The Prepare flow, for a coverage gap's "build from here". Optional so the
  // screen still renders in any host that hasn't wired it.
  onPrepareGap?: (ucis: string[], answeringColour: 'white' | 'black', opponentName?: string) => void;
  // Open the starter-pack picker (the curated quick-start route).
  onPickStarterPack: () => void;
}

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
  let books: BookRow[];
  try {
    [allLines, games, books] = await Promise.all([getAllLines(), getAllGames(), loadBookRows()]);
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

  // Jump to the "From my games" tab (empty states offer it as the quieter
  // alternative to building a line by hand).
  const goToGamesTab = () => {
    activeTab = 'games';
    void doRender(container, deps);
  };

  // Two prominent tabs: SAVED LINES | FROM MY GAMES.
  const content = document.createElement('section');
  content.className = 'lines-tab-content';

  // A full re-render (used by "Refresh my games" once the import finishes).
  const fullRefresh = () => doRender(container, deps);

  const renderActive = () => {
    disposeLinesTree();
    disposeCoverageLauncher();
    if (activeTab === 'saved') {
      renderSavedTab(content, allLines, games, deps, container, goToGamesTab, hasGames, books);
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

  // Backup & restore now lives in Settings → Backup (a device-wide action), so
  // it's no longer duplicated here.
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
// any selected tag) and the search text, then the chosen ordering.
//
// Search matches the line's NAME — which is what the card shows and what the
// user is looking at when they reach for the box — plus its detected opening, so
// typing "sicilian" finds the lines you never renamed. Substring, not prefix:
// half these names start with the family, so a prefix match would mean typing
// "Sicilian Defense: " before "Najdorf" could ever hit.
function viewSavedLines(lines: Line[], sel: FilterSelection): Line[] {
  let out = lines;
  if (sel.colour !== 'all') out = out.filter(l => l.colour === sel.colour);
  if (sel.tags.length > 0) out = out.filter(l => sel.tags.some(t => l.tags.includes(t)));
  if (sel.query) out = out.filter(l => lineMatches(l, sel.query));
  return sortLines(out, sel.sort as SortMode);
}

function lineMatches(line: Line, query: string): boolean {
  return `${line.name} ${line.openingName ?? ''}`.toLowerCase().includes(query);
}

// The one book every one of these lines lives in, or null when they're spread
// across several. Line ids carry their book (lines-view.makeLineId).
function commonBookId(lines: Line[]): string | null {
  let found: string | null = null;
  for (const line of lines) {
    const id = parseLineId(line.id)?.repertoireId;
    if (!id) return null;
    if (found === null) found = id;
    else if (found !== id) return null;
  }
  return found;
}

function renderSavedTab(
  content: HTMLElement,
  allLines: Line[],
  games: ImportedGame[],
  deps: LinesDeps,
  container: HTMLElement,
  goToGamesTab: () => void,
  hasGames: boolean,
  books: BookRow[] = [],
): void {
  content.innerHTML = '';

  // Which book is on screen. A selection pointing at a book that has since been
  // deleted quietly falls back to all of them rather than showing an empty list
  // with no way to understand why.
  let bookId = selectedBookId();
  if (bookId !== 'all' && !books.some(b => b.book.id === bookId)) {
    bookId = 'all';
    setSelectedBookId('all');
  }
  const lines = bookId === 'all' ? allLines : allLines.filter(l => lineInBook(l.id, bookId));
  const counts = cachedCounts(games, lines);

  // After a toggle/delete/rename, re-fetch lines and re-render this tab.
  const refresh = async () => {
    const [fresh, freshBooks] = await Promise.all([getAllLines(), loadBookRows()]);
    renderSavedTab(content, fresh, games, deps, container, goToGamesTab, hasGames, freshBooks);
  };

  // Which book am I looking at — shown only once there is more than one to
  // choose between (see repertoire-picker).
  const pickerHost = document.createElement('div');
  pickerHost.className = 'lines-book-picker';
  content.appendChild(pickerHost);
  renderRepertoirePicker(pickerHost, {
    rows: books,
    selected: bookId,
    onSelect: (id) => {
      setSelectedBookId(id);
      void refresh();
    },
    onChanged: () => { void refresh(); },
  });

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
    search: true,
    searchPlaceholder: 'Search by name',
    group: true,
    // My Lines is the one list that can also draw its lines as a tree.
    groupTree: true,
    onChange: () => rebuildList(),
  });
  content.appendChild(filter.element);

  // The way in to Coverage: one row carrying the positive figure, reading the
  // same report the screen does (coverage-section.ts). Only once there are
  // lines to have gaps in — on an empty repertoire it would be a 0% verdict on
  // nothing. The colour follows the filter bar; with "All" showing, the bigger
  // book wins, since the screen shows one book at a time either way.
  if (lines.length > 0 && deps.onPrepareGap) {
    disposeCoverageLauncher();
    const launchHost = document.createElement('div');
    launchHost.className = 'lines-coverage';
    content.appendChild(launchHost);
    const sel = filter.selection.colour;
    const colour: 'white' | 'black' = sel === 'white' || sel === 'black'
      ? sel
      : lines.filter(l => l.colour === 'black').length > lines.filter(l => l.colour === 'white').length
        ? 'black' : 'white';
    coverageLauncher = renderCoverageLauncher(launchHost, {
      colour,
      onOpen: () => openCoverageScreen({ colour, onPrepare: deps.onPrepareGap! }),
    });
  }

  const sec = document.createElement('div');
  sec.className = 'section';
  const list = document.createElement('div');
  list.className = 'group lines-grid';
  sec.appendChild(list);
  content.appendChild(sec);

  function rebuildList(): void {
    // The tree view holds window-level drag listeners; drop them before the
    // list they belong to is thrown away.
    disposeLinesTree();
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
      empty.textContent = filter.selection.query
        ? `No lines matching “${filter.selection.query}”.`
        : 'No lines here yet.';
      list.appendChild(empty);
      return;
    }
    // A search is "find me this line", and both grouped views answer it with a
    // list of closed families the match is hidden inside. So while there is
    // something typed, the results come back flat — the grouping is still
    // selected and returns the moment the box is cleared.
    const searching = filter.selection.query !== '';

    if (!searching && filter.selection.group === 'tree') {
      // Same screen, same filtered lines — drawn as one position-merged map
      // instead of a list, so lines that transpose meet on a single node.
      // Nothing to highlight in a tree of positions — drop the pending mark so
      // it can't fire on a later switch back to one of the list views.
      highlightLineId = null;
      // Branch actions need to know WHICH book a node belongs to, and a node in
      // a tree drawn from two books at once belongs to neither on its own. So
      // they're offered when the drawn lines share one book — always true once a
      // book is selected, and true of most repertoires under "All" too.
      const book = commonBookId(shown.filter(l =>
        filter.selection.colour === 'all' || l.colour === filter.selection.colour));
      renderLinesTree(
        list, shown, filter.selection.colour, deps.onOpenLine,
        book ? {
          label: 'Branch actions',
          onAct: (ctx) => {
            void openBranchSheet({
              repertoireId: book,
              ucis: ctx.ucis,
              sans: ctx.sans,
              onBuildFrom: deps.onPrepareGap
                ? (ucis) => deps.onPrepareGap!(ucis, ctx.colour)
                : undefined,
              onOpenLine: deps.onOpenLine,
              onChanged: () => { void refresh(); },
            });
          },
        } : undefined,
      );
      return;
    }
    if (!searching && filter.selection.group) {
      const deep = filter.selection.group === 'variation';
      // Open the just-saved line's family so its highlighted card shows.
      if (highlightLineId) {
        const hit = shown.find(l => l.id === highlightLineId);
        if (hit) {
          expandedFamilies.add(deep
            ? (hit.openingName || hit.name || 'Unnamed opening')
            : openingFamily(hit.openingName));
        }
      }
      (deep ? renderVariationGroups : renderFamilyGroups)(
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
  // Tapping the card — the board or the title — opens the line's POPUP, not the
  // builder. Nine times in ten the question is "what is this line, and how is it
  // going?", and answering it used to mean a round trip through the editor with
  // a save guard on the way out. The popup answers it in place and offers the
  // builder as one of its ways on.
  const peek = (): void => openLinePeek({
    line,
    onOpen: (l) => deps.onOpenLine(l),
    onDrill: deps.onTrainLine
      ? (l) => deps.onTrainLine!(l.id, l.inTraining)
      : undefined,
    drillLabel: line.inTraining ? 'Drill line' : 'Add to training',
  });

  const { card, titleRow: titleRowWrap, content } = buildPositionCard({
    fen: lineFinalFen(line.tree),
    orientation: line.colour,
    onMiniClick: peek,
    miniLabel: 'Look at this line',
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
  titleRow.addEventListener('click', peek);
  titleRowWrap.appendChild(titleRow);

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

  // Rows, in the order you'd want to scan them: what this line needs from you,
  // then how it has been going.
  info.appendChild(buildStatusRow(line));
  const training = buildTrainingRow(line);
  if (training) info.appendChild(training);

  // A line that comes back clean, run after run, has stopped teaching anything —
  // the useful next move is more moves, not more reps. The chip says so and
  // opens the builder standing at its end, which is where they'd be added.
  if (lineMastered(line)) {
    const grow = document.createElement('button');
    grow.type = 'button';
    grow.className = 'dline-grow';
    grow.appendChild(Icons.sprout(14));
    const growLabel = document.createElement('span');
    growLabel.textContent = 'Keep growing this line';
    grow.appendChild(growLabel);
    grow.title = 'You know this one — open it and add the next moves';
    grow.addEventListener('click', (e) => { e.stopPropagation(); deps.onOpenLine(line); });
    info.appendChild(grow);
  }

  content.appendChild(info);

  // Footer: one row. The training switch anchors the left; every action on
  // this line lives to its right, in the order each is wanted most: train it,
  // edit it, its settings, delete it. Used to be two rows — the switch above
  // its own line, icons on another below — which cost the card a whole extra
  // line for no reason once both fit side by side.
  const footer = document.createElement('div');
  footer.className = 'dline-footer';

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
  // Only switching ON meets the free-tier cap; switching off is always allowed
  // and frees the slot immediately, so a free user can rotate their ten freely.
  toggleBtn.addEventListener('click', async () => {
    const next = !line.inTraining;
    if (next && !(await requestTrainingSlot())) return;
    await saveLine({ ...line, inTraining: next });
    refresh();
  });
  footer.appendChild(toggleBtn);

  const iconRow = document.createElement('div');
  iconRow.className = 'dline-iconrow';

  // Train — the Train tab's own bolt, so the action reads the same wherever it
  // appears. It drills the line straight away when it's in the rotation, and
  // runs the add-to-training flow when it isn't (the same entry point the
  // line's popup offers).
  if (deps.onTrainLine) {
    const trainBtn = document.createElement('button');
    trainBtn.type = 'button';
    trainBtn.className = 'dline-icon';
    const trainLabel = line.inTraining ? 'Train this line' : 'Add to training';
    trainBtn.setAttribute('aria-label', trainLabel);
    trainBtn.title = trainLabel;
    trainBtn.appendChild(Icons.zap(16));
    trainBtn.addEventListener('click', () => deps.onTrainLine!(line.id, line.inTraining));
    iconRow.appendChild(trainBtn);
  }

  // Edit — straight into the builder, standing at the end of this line. It used
  // to sit up in the title row and open a rename sheet; a line's NAME is the
  // least of what you'd want to change about it, and naming now lives in the
  // options sheet next door with the tags it belongs beside.
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'dline-icon';
  editBtn.setAttribute('aria-label', 'Open in builder');
  editBtn.title = 'Open in builder';
  editBtn.appendChild(Icons.pencil(16));
  editBtn.addEventListener('click', () => deps.onOpenLine(line));
  iconRow.appendChild(editBtn);

  // Everything you can do to this line as a BRANCH — pause it, set how often it
  // comes round, name or tag it, and (the reason this control exists on a card
  // at all) join it onto a line it transposes into. The tree view offers the
  // same sheet, but it merges by position: two roads to one square are drawn as
  // a single node there, which is precisely the node a join cannot be made on.
  const optionsBtn = document.createElement('button');
  optionsBtn.type = 'button';
  optionsBtn.className = 'dline-icon';
  optionsBtn.setAttribute('aria-label', 'Line options');
  optionsBtn.title = 'Line options';
  optionsBtn.appendChild(Icons.settings(16));
  optionsBtn.addEventListener('click', () => {
    void openBranchSheetForLine(line.id, {
      onOpenLine: deps.onOpenLine,
      onChanged: () => refresh(),
    });
  });
  iconRow.appendChild(optionsBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'dline-icon dline-icon--danger';
  deleteBtn.setAttribute('aria-label', 'Delete line');
  deleteBtn.title = 'Delete';
  deleteBtn.appendChild(Icons.trash(16));
  deleteBtn.addEventListener('click', () =>
    openDeletePopup(line, () => refresh())
  );
  iconRow.appendChild(deleteBtn);

  footer.appendChild(iconRow);
  content.appendChild(footer);

  return card;
}

/**
 * Row 1 — what this line wants from you, which is the one thing worth scanning
 * a list of cards for. A coloured dot carries the state (due / learning / solid
 * / paused) so the row reads at a glance, and the words say when.
 *
 * "Confidence ●●●○○ · Trained 3 days ago" used to sit here. Both looked
 * backwards, and on a line never trained it rendered as "Confidence — · Never
 * trained", which reads as something broken rather than as something new.
 */
function buildStatusRow(line: Line): HTMLElement {
  const row = document.createElement('div');
  row.className = 'dline-status';

  const state = lineStatus(line);
  const dot = document.createElement('span');
  dot.className = `dline-dot dline-dot--${state.tone}`;
  dot.setAttribute('aria-hidden', 'true');
  row.appendChild(dot);

  const text = document.createElement('span');
  text.className = `dline-status-text dline-status-text--${state.tone}`;
  text.textContent = state.text;
  row.appendChild(text);

  return row;
}

/**
 * Row 3 — how it has been GOING: how many times it has been round, and how much
 * of it comes back clean. Quiet and last, because it is the answer to a question
 * you only ask once the first two rows have told you what you're looking at.
 *
 * Silent on a line that has never been drilled: "0 runs · — recall" is three
 * pieces of punctuation saying "nothing has happened yet", which the status row
 * has already said in words.
 */
function buildTrainingRow(line: Line): HTMLElement | null {
  const t = lineTraining(line);
  const text = lineTrainingText(line, t);
  if (!text) return null;
  const row = document.createElement('div');
  row.className = 'dline-training';
  row.textContent = text;
  if (t.recallPct !== null) {
    row.title = `${t.drilled} of ${t.total} moves drilled — ${t.recallPct}% of those come back clean`;
  }
  return row;
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
    // No games yet: the import form lands here directly rather than behind a
    // button, with the same two quick-start routes underneath it.
    content.appendChild(buildInlineImport({
      title: 'Import your games',
      body: 'Pull your games from Chess.com or Lichess to see which openings you ' +
        'actually play — this tab then suggests the ones you haven’t saved yet.',
      onImported: () => fullRefresh(),
    }));
    content.appendChild(buildEmptyState({
      line: 'Or start from scratch',
      cta: { label: 'Build a line myself', onClick: () => deps.onAddLine('white') },
      secondaryActions: [
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
  list.className = 'group lines-grid';
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
