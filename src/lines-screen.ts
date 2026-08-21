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

import { openBranchSheet, openBranchSheetForLine } from './branch-sheet';
import { byNewestFirst, parseLineId } from './lines-view';
import type { ImportedGame } from './chesscom';
import { renderLoadError } from './load-error';
import { formatSanLine } from './notation';
import {
  lineStatus, lineTraining, lineTrainingText, lineMastered,
} from './line-status';
import { openLinePeek } from './line-peek';
import { addedLabel, addedExact } from './line-info';

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

interface LinesDeps {
  onOpenLine: (line: Line) => void;
  // "Drill it" from a line's popup: drills an in-training line straight away,
  // and runs the add-to-training flow for one that isn't in the rotation yet.
  onTrainLine?: (lineId: string, inTraining: boolean) => void;
  onAddLine: (colour: 'white' | 'black') => void;
  onStartTraining?: (line: Line) => void;
  // Seed the builder with these UCI moves for the given colour, then open it.
  onBuildLine?: (ucis: string[], colour: 'white' | 'black') => void;
  // Open the starter-pack picker (the curated quick-start route).
  onPickStarterPack: () => void;
  // Jump to Explore → Openings — where "which openings do I play that I haven't
  // saved?" moved to. Optional so the screen still renders in any host that
  // hasn't wired it.
  onSeeMyOpenings?: () => void;
}

// Persistence keys for the shared two-row filter bar (filters.ts). Each list
// keeps its own remembered selection, device-local.
const LINES_FILTER_KEY = 'obertura.lines.filter';
const GAMES_FILTER_KEY = 'obertura.games.filter';

// Which opening families are expanded in the grouped saved view. Module-level so
// a filter change / refresh keeps the open/closed state across re-renders.
const expandedFamilies = new Set<string>();

// Set by the builder right after a save: the next saved-lines render highlights
// this line and scrolls it into view, so the user can see where it landed and
// add it to training. Consumed (cleared) once shown.
let highlightLineId: string | null = null;
export function focusSavedLine(id: string): void {
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

  // NO TAB BAR. This screen had two — Saved lines and "From my games" — and the
  // second was never really about your lines: it read your GAMES and offered
  // openings you hadn't saved yet, which is a question about what you don't
  // have. It has moved to Explore, merged with the Recommended tab it
  // duplicated. With one tab left, a tab bar is a title with extra steps, so the
  // screen is simply the list and gets that row back.
  const content = document.createElement('section');
  content.className = 'lines-tab-content';
  container.appendChild(content);

  renderSavedTab(content, allLines, games, deps, container);

  // Backup & restore lives in Settings → Backup (a device-wide action), so it's
  // not duplicated here.
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
): void {
  content.innerHTML = '';

  // EVERY saved line, always. This screen used to open with a book picker whose
  // answer HID lines — pick the White book and half your repertoire vanishes,
  // which on a screen called My Lines reads as data loss — and which asked a
  // question most people have only one answer to. Making and managing books is a
  // setup decision and lives in Settings → Repertoires now; the colour segment
  // on the filter bar, which people actually use, is what narrows this list.
  const lines = allLines;
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
          secondaryActions: [
            { label: 'Pick a starter pack', onClick: () => deps.onPickStarterPack() },
          ],
          // The openings-from-your-games route now lives on Explore, so the
          // quiet alternative points there rather than at a tab that has gone.
          ...(deps.onSeeMyOpenings && {
            link: { label: 'or see the openings you play', onClick: deps.onSeeMyOpenings },
          }),
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
              // "Build from here" is a plain seeded build — the same thing the
              // coverage rows' Prepare does when there is no opponent to tag.
              onBuildFrom: deps.onBuildLine
                ? (ucis) => deps.onBuildLine!(ucis, ctx.colour)
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

    // The end of the list is where "and now what?" gets asked, and until now the
    // answer was to scroll all the way back up and find the + button. One more
    // line is the single most useful thing anyone can do from here, so the list
    // ends by offering it.
    //
    // Not on the tree (it draws its own surface and has its own controls
    // underneath) and not on an empty list, which already leads with the offer.
    list.appendChild(buildMoreLinesRow(deps));
  }

  rebuildList();
}

// The tail of the saved list: build another line, or take one from a pack. A
// quiet pair — this is a footer, not a call to action competing with the lines
// above it.
function buildMoreLinesRow(deps: LinesDeps): HTMLElement {
  const row = document.createElement('div');
  row.className = 'lines-more';

  const build = document.createElement('button');
  build.type = 'button';
  build.className = 'btn-secondary lines-more-btn';
  build.appendChild(Icons.plus(16));
  const label = document.createElement('span');
  label.textContent = 'Create more lines';
  build.appendChild(label);
  build.addEventListener('click', () => deps.onAddLine('white'));
  row.appendChild(build);

  const packs = document.createElement('button');
  packs.type = 'button';
  packs.className = 'lines-more-link';
  packs.textContent = 'or pick a starter pack';
  packs.addEventListener('click', () => deps.onPickStarterPack());
  row.appendChild(packs);

  return row;
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

  // When the line was added — the one fact on the card that never changes, and
  // the one that tells an old forgotten line from one made last night.
  const added = addedLabel(line.createdAt);
  if (added) {
    const when = document.createElement('div');
    when.className = 'dline-added';
    when.textContent = added;
    when.title = addedExact(line.createdAt);
    info.appendChild(when);
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

  // Footer: its OWN section, full card width, below the board+info row rather
  // than squeezed into the narrow content column beside the board. The
  // training switch anchors the left; every action on this line lives to its
  // right, in the order each is wanted most: train it,
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
  // Appended to the CARD, not the content column — a sibling of the board+info
  // row rather than a child squeezed beside the board, so it spans the whole
  // card and finally has room for the switch's full label at full size.
  card.appendChild(footer);

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
