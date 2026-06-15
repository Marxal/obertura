// The Explore tab — visualizing your play, scouting and engine sparring.
//
// Sections, top to bottom (the agreed Explore order):
//   1. Visualize your play — see your games and repertoire on the board:
//        • Board browser  — walk positions on a board, with your games' W/D/L
//                           (formerly the "Line browser"); White/Black toggle.
//        • Your games tree — what you actually play, from imported games.
//        • Your repertoire tree — your saved lines as a merged tree.
//   2. Scout opponents — scout imported opponents; tapping one opens a full-screen
//                       DETAIL view with their most-played openings per colour and
//                       their auto-built opening maps. "Add opponent" and a
//                       per-opponent "Refresh" reuse the one import panel, pointed
//                       at a scouting sink instead of "my games".
//   3. Build with the engine — a casual game against the local engine.
//
// (The opening library moved to the Statistics tab. Distinct from explore.ts,
// the in-board explorer.)

import type { Line } from './types';
import type { ImportedGame } from './chesscom';
import type { MoveNode } from './tree';
import { Icons } from './icons';
import { showDialog } from './dialog';
import { openImportPanel } from './import-panel';
import { openRepertoireMap } from './repertoire-map';
import { openBoardExplorer } from './board-explorer';
import { openSpar, type SparSaveFn, type SparMode } from './spar';
import { loadBookLines, pickBookLine, pickGameLine } from './book-lines';
import {
  analyseGames, UNKNOWN_FAMILY, MIN_GAMES_WEAK, WEAK_SCORE_PCT, type OpeningStat,
} from './analysis';
import { buildPositionCard, colourPip, fenFromUcis } from './card-position';
import {
  getAllLines, getAllGames, getAllOpponents, getOpponent, saveOpponent, deleteOpponent, deleteLine,
  countOpponents,
} from './storage';
import {
  MAX_OPPONENTS, makeOpponent, opponentLine, colourGameCount, opponentTag, isOpponentTag,
  opponentSummary, buildScoutReport, buildOpponentTree, opponentReachPlies,
  MAP_START_PLIES, MAP_STEP_PLIES, MAP_MAX_PLIES,
  type Opponent, type ScoutReport, type OpeningRecord, type Recommendation,
} from './scout';
import { wdlBlock, wdlScoreRow } from './wdl-bar';
import { buildMoveStats } from './move-stats';
import { createFilterBar } from './filters';
import { buildEmptyState } from './empty-state';
import { pushBack } from './back-nav';

const PLATFORM_LABEL = { chesscom: 'Chess.com', lichess: 'Lichess' } as const;
// Most-played list cap before "Show all".
const TOP_OPENINGS = 6;
// Persistence key for the prepared-lines filter bar (shared across opponents;
// stale tags from another opponent are sanitised away on load).
const PREP_FILTER_KEY = 'obertura.prep.filter';

// What the Explore tab hands back to the app shell (main.ts): seed the builder
// with a prepared reply, or open one of my saved lines. Held at module scope —
// like train-screen's onViewLine — so the many internal re-renders (which only
// pass a container) keep working.
export interface ExploreDeps {
  // Open the builder seeded with the opponent's moves, flipped to my answering
  // colour, tagged to the opponent.
  onPrepareReply: (ucis: string[], answeringColour: 'white' | 'black', opponentName: string) => void;
  // Open a saved line in the builder/line view.
  onOpenLine: (line: Line) => void;
  // Seed the builder with a move sequence (from the opening library), oriented
  // to the chosen colour. No opponent tag — this is a plain reference line.
  onOpenInBuilder: (ucis: string[], colour: 'white' | 'black') => void;
  // Persist a game sparred against the engine as a new auto-named line, then run
  // the post-save "add to training" flow (see spar.ts / main.ts).
  onSparSave: SparSaveFn;
}

let exploreDeps: ExploreDeps | null = null;

// Returns the rebuild promise so callers that must wait for a fresh list (the
// delete flow) can await it before revealing the screen; everyone else ignores
// it and renders fire-and-forget.
export function renderExploreScreen(container: HTMLElement, deps?: ExploreDeps): Promise<void> {
  if (deps) exploreDeps = deps;
  return buildScreen(container);
}

async function buildScreen(container: HTMLElement): Promise<void> {
  container.innerHTML = '';

  // Everything the screen needs, fetched once up front so the sections render in
  // the agreed order without round-trips: my games + lines feed "Visualize your
  // play", the opponents feed scouting, and the games count gates spar's "From
  // my games" mode and the bottom recommendations.
  const [opponents, lines, games] = await Promise.all([
    getAllOpponents(), getAllLines(), getAllGames(),
  ]);
  // Newest refresh first, so the one you just touched leads.
  opponents.sort((a, b) => b.refreshedAt.localeCompare(a.refreshedAt));
  const hasGames = games.length > 0;

  // 1) Visualize your play — board browser + your games / repertoire trees.
  const visualize = visualizeSection(lines, games);
  if (visualize) container.appendChild(visualize);

  // 2) Scout opponents.
  container.appendChild(scoutSection(opponents, container));

  // 3) Build with the engine.
  container.appendChild(sparSection(hasGames));

  // 4) Recommended lines to try — games-gated, at the very bottom. Only when
  //    games are imported, and only if there's actually something worth nudging.
  if (hasGames) {
    const recs = recommendationsSection(games, lines);
    if (recs) container.appendChild(recs);
  }
}

// ── Scout opponents ────────────────────────────────────────────────────────────

function scoutSection(opponents: Opponent[], container: HTMLElement): HTMLElement {
  const section = document.createElement('div');
  section.className = 'section';

  const head = document.createElement('div');
  head.className = 'section-head';
  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = 'Scout opponents';
  head.appendChild(heading);
  const meta = document.createElement('span');
  meta.className = 'section-meta';
  meta.textContent = `${opponents.length} / ${MAX_OPPONENTS}`;
  head.appendChild(meta);
  section.appendChild(head);

  // No opponents yet: the shared empty-state pattern carries the way in (its CTA
  // is the add-opponent flow), so the standalone description + Add button are
  // dropped here to avoid doubling up.
  if (opponents.length === 0) {
    section.appendChild(buildEmptyState({
      icon: Icons.target(28),
      line: 'Scout your first opponent.',
      cta: { label: 'Add opponent', onClick: () => addOpponent(container) },
    }));
    return section;
  }

  const desc = document.createElement('p');
  desc.className = 'section-desc';
  desc.textContent =
    'Import an opponent’s games to scout their openings and build a map of what they play.';
  section.appendChild(desc);

  // Add-opponent button.
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'games-refresh-btn scout-add-btn';
  addBtn.appendChild(Icons.plus(15));
  addBtn.appendChild(document.createTextNode('Add opponent'));
  addBtn.addEventListener('click', () => addOpponent(container));
  section.appendChild(addBtn);

  const list = document.createElement('div');
  list.className = 'group';
  for (const opp of opponents) list.appendChild(opponentCard(opp, container));
  section.appendChild(list);

  return section;
}

// ── Spar with the engine ─────────────────────────────────────────────────────

// Friendly difficulty names mapped to Stockfish's UCI Skill Level (0–20), each
// with a think-time budget. The top two levels actually get time to think; the
// easy levels stay snappy (skill, not time, is what makes them easy).
const SPAR_LEVELS = [
  { id: 'casual', label: 'Casual', skill: 3, movetime: 300 },
  { id: 'club', label: 'Club', skill: 8, movetime: 300 },
  { id: 'strong', label: 'Strong', skill: 14, movetime: 900 },
  { id: 'master', label: 'Master', skill: 20, movetime: 1400 },
] as const;

// Remembered across re-renders so the picker keeps its last setting.
let sparColour: 'white' | 'black' = 'white';
let sparLevelId: (typeof SPAR_LEVELS)[number]['id'] = 'club';

// The engine-opening mode is persisted device-local (tiny, like the library
// view mode in library.ts), so the picker survives a reload.
const SPAR_MODE_KEY = 'obertura.spar.mode';
function getSparMode(): SparMode {
  const v = localStorage.getItem(SPAR_MODE_KEY);
  return v === 'surprise' || v === 'games' || v === 'engine' ? v : 'surprise';
}
let sparMode: SparMode = getSparMode();

// A launcher card for a casual game against the local engine. The settings
// (level, side, engine opening) and the Play button now live in a bottom sheet
// so the Explore landing stays clean; this section is just the front door.
function sparSection(hasGames: boolean): HTMLElement {
  // A persisted "From my games" with no games left falls back to Surprise me.
  if (sparMode === 'games' && !hasGames) sparMode = 'surprise';

  const section = document.createElement('div');
  section.className = 'section';

  const head = document.createElement('div');
  head.className = 'section-head';
  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = 'Build with the engine';
  head.appendChild(heading);
  section.appendChild(head);

  const desc = document.createElement('p');
  desc.className = 'section-desc';
  desc.textContent =
    'Play a casual game against the engine from the start, then save the moves as a new line whenever you like.';
  section.appendChild(desc);

  // The front door: a single primary that opens the settings sheet.
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'btn-primary spar-start-btn';
  openBtn.appendChild(Icons.play(15));
  openBtn.appendChild(document.createTextNode('Build with the engine'));
  openBtn.addEventListener('click', () => openSparSheet(hasGames));
  section.appendChild(openBtn);

  return section;
}

// The settings bottom sheet: Level / Play-as / Engine-opening pickers plus the
// Play button. The pickers mutate the same persisted module state as before, so
// the chosen settings survive between opens and reloads.
function openSparSheet(hasGames: boolean): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet spar-sheet';

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = 'Build with the engine';
  sheet.appendChild(title);

  // Level picker.
  sheet.appendChild(sparPickerRow('Level',
    SPAR_LEVELS.map(l => ({ value: l.id, label: l.label })),
    sparLevelId,
    (v) => { sparLevelId = v as typeof sparLevelId; }));

  // Play-as side picker.
  sheet.appendChild(sparPickerRow('Play as', [
    { value: 'white', label: '○ White' },
    { value: 'black', label: '● Black' },
  ], sparColour, (v) => { sparColour = v as 'white' | 'black'; }));

  // Engine-opening picker — its own full-width row, since the labels are long.
  sheet.appendChild(sparModeRow(hasGames));

  // The Play button: close the sheet as the spar board opens, so the back stack
  // stays tidy. startSpar runs the chosen settings exactly as before.
  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'btn-primary spar-start-btn';
  startBtn.appendChild(Icons.play(15));
  startBtn.appendChild(document.createTextNode('Play'));
  startBtn.addEventListener('click', () => { void startSpar(startBtn, close); });
  sheet.appendChild(startBtn);

  document.body.appendChild(overlay);
  overlay.appendChild(sheet);
}

// Build the engine opening for the chosen mode, then open the spar board. For
// "Surprise me" we draw a fresh random book line per game; for "From my games"
// we sample a line from my imported games on the side I'm sparring.
async function startSpar(startBtn: HTMLButtonElement, onLaunch?: () => void): Promise<void> {
  if (!exploreDeps) return;
  const level = SPAR_LEVELS.find(l => l.id === sparLevelId) ?? SPAR_LEVELS[1];

  let nextBookLine: (() => string[]) | undefined;
  if (sparMode === 'surprise') {
    // The library file is lazy-loaded; guard against a double-tap while it lands.
    startBtn.disabled = true;
    try {
      const entries = await loadBookLines();
      nextBookLine = () => pickBookLine(entries);
    } finally {
      startBtn.disabled = false;
    }
  } else if (sparMode === 'games') {
    const games = await getAllGames();
    const colour = sparColour;
    nextBookLine = () => pickGameLine(games, colour);
  }

  // Dismiss the settings sheet just as the spar board opens.
  onLaunch?.();

  openSpar({
    colour: sparColour,
    skill: level.skill,
    movetimeMs: level.movetime,
    levelLabel: level.label,
    mode: sparMode,
    nextBookLine,
    onSparSave: exploreDeps.onSparSave,
  });
}

// The engine-opening picker: a full-width segmented control with a one-line hint
// beneath. "From my games" is disabled (with an explaining hint) until games are
// imported. The choice is persisted.
function sparModeRow(hasGames: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'spar-mode-row';

  const lab = document.createElement('span');
  lab.className = 'spar-picker-label';
  lab.textContent = 'Engine opening';
  row.appendChild(lab);

  const seg = document.createElement('div');
  seg.className = 'seg-control seg-control--full';
  seg.setAttribute('role', 'group');

  const hint = document.createElement('p');
  hint.className = 'spar-mode-hint';

  const opts: { value: SparMode; label: string; disabled: boolean }[] = [
    { value: 'surprise', label: 'Surprise me', disabled: false },
    { value: 'games', label: 'From my games', disabled: !hasGames },
    { value: 'engine', label: 'Pure engine', disabled: false },
  ];
  const buttons: HTMLButtonElement[] = [];
  const reflect = () => {
    for (const b of buttons) {
      const on = b.dataset.value === sparMode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    // When there are no games, the disabled option is the thing worth explaining.
    hint.textContent = !hasGames
      ? '“From my games” needs imported games — import some in My games first.'
      : sparMode === 'surprise' ? 'The engine opens with a random recognisable book line.'
      : sparMode === 'games' ? 'The engine opens with an opening from your imported games.'
      : 'No book — the engine plays its own moves from the first move.';
  };

  for (const opt of opts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg-btn';
    btn.dataset.value = opt.value;
    btn.textContent = opt.label;
    if (opt.disabled) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => {
        sparMode = opt.value;
        localStorage.setItem(SPAR_MODE_KEY, sparMode);
        reflect();
      });
    }
    buttons.push(btn);
    seg.appendChild(btn);
  }
  reflect();

  row.appendChild(seg);
  row.appendChild(hint);
  return row;
}

// A labelled segmented control (reusing the settings .seg-control look).
function sparPickerRow(
  label: string,
  options: { value: string; label: string }[],
  current: string,
  onChange: (v: string) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'spar-picker-row';

  const lab = document.createElement('span');
  lab.className = 'spar-picker-label';
  lab.textContent = label;
  row.appendChild(lab);

  const seg = document.createElement('div');
  seg.className = 'seg-control';
  seg.setAttribute('role', 'group');
  const buttons: HTMLButtonElement[] = [];
  const reflect = (active: string) => {
    for (const b of buttons) {
      const on = b.dataset.value === active;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };
  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg-btn';
    btn.dataset.value = opt.value;
    btn.textContent = opt.label;
    btn.addEventListener('click', () => { reflect(opt.value); onChange(opt.value); });
    buttons.push(btn);
    seg.appendChild(btn);
  }
  reflect(current);
  row.appendChild(seg);
  return row;
}

// ── Visualize your play (board browser + your games / repertoire trees) ───────
//
// Three ways to see YOUR play on the board:
//   • Board browser — walk positions on a real board with your games' per-move
//     W/D/L (formerly the "Line browser"); a White/Black toggle flips the side.
//   • Your games tree — what you actually play, from imported games (like an
//     opponent map, but yours).
//   • Your repertoire tree — your saved lines merged into one tree.
// The data wiring — buildMoveStats for per-move W/D/L, the depth configs, and the
// opponent-tree builder for the games map — is carried over intact. (Opponent
// maps stay inside the scouting detail view, untouched.)

// Plies in a line's longest variation (root has no move, so its children are
// ply 1). Drives whether the repertoire map can "Go deeper" than the default.
function treeDepth(node: MoveNode): number {
  if (!node.children.length) return 0;
  return 1 + Math.max(...node.children.map(treeDepth));
}

// A single full-width entry (icon + title + count + chevron) for a map type.
// Opens the Tree; the White/Black choice now lives INSIDE, at the top of the
// opened tree, rather than as a pre-split pair of buttons out here.
function mapEntryBtn(
  icon: SVGElement,
  title: string,
  countText: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rmap-entry';
  icon.classList.add('rmap-entry-icon');
  btn.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'rmap-entry-text';
  const titleEl = document.createElement('span');
  titleEl.className = 'rmap-entry-title';
  titleEl.textContent = title;
  text.appendChild(titleEl);
  const count = document.createElement('span');
  count.className = 'rmap-entry-count';
  count.textContent = countText;
  text.appendChild(count);
  btn.appendChild(text);

  const chev = Icons.chevronRight(18);
  chev.classList.add('rmap-entry-chevron');
  btn.appendChild(chev);

  btn.addEventListener('click', onClick);
  return btn;
}

// Build the Visualize-your-play section, or return null when there's nothing to
// show (no lines and no games) so the caller can skip appending it. Three
// entries: a standalone Board browser, your games tree, your repertoire tree.
// The colour choice lives INSIDE each (a White/Black toggle at the top).
function visualizeSection(lines: Line[], games: ImportedGame[]): HTMLElement | null {
  const section = document.createElement('div');
  section.className = 'section';

  const head = document.createElement('div');
  head.className = 'section-head';
  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = 'Visualize your play';
  head.appendChild(heading);
  section.appendChild(head);

  const desc = document.createElement('p');
  desc.className = 'rmap-section-desc';
  desc.textContent = 'See your games and repertoire on the board.';
  section.appendChild(desc);

  const entries = document.createElement('div');
  entries.className = 'rmap-entries';
  section.appendChild(entries);

  const onOpenLine = (line: Line) => exploreDeps?.onOpenLine(line);

  // Per-move W/D/L from MY imported games (my perspective), shared by the maps
  // and the board browser.
  const myStats = (colour: 'white' | 'black') => ({
    tree: buildMoveStats(games, colour, MAP_MAX_PLIES),
    caption: 'your results',
    games,
  });

  const gamesHas = (c: 'white' | 'black') => games.some(g => g.colour === c);
  const repHas = (c: 'white' | 'black') => lines.some(l => l.colour === c);

  // 1) Board browser — walk positions on a board with your games' per-move
  //    W/D/L. Standalone (no map underneath), so "Open in builder" lands cleanly
  //    on the builder; a White/Black toggle reopens it for the other side.
  if (gamesHas('white') || gamesHas('black')) {
    const openBrowser = (colour: 'white' | 'black'): void => {
      openBoardExplorer({
        statsTree: buildMoveStats(games, colour, MAP_MAX_PLIES),
        caption: 'your results',
        colour,
        games,
        title: 'Board browser',
        onOpenInBuilder: (ucis, c) => exploreDeps?.onOpenInBuilder(ucis, c),
        colourToggle: { current: colour, enabled: { white: gamesHas('white'), black: gamesHas('black') }, onPick: openBrowser },
      });
    };
    entries.appendChild(mapEntryBtn(Icons.compass(24), 'Board browser',
      'Walk your games on a board',
      () => openBrowser(gamesHas('white') ? 'white' : 'black')));
  }

  // 2) Your games tree — what you actually play, from imported games (like an
  //    opponent map, but yours). Colour toggles inside too.
  if (gamesHas('white') || gamesHas('black')) {
    const openGames = (colour: 'white' | 'black'): void => {
      const colourGames = games.filter(g => g.colour === colour);
      const reach = Math.max(0, ...colourGames.map(g => g.sans.length));
      const buildLines = (plies: number) =>
        [opponentLine(buildOpponentTree(games, colour, plies, false), colour, 'Your games')];
      openRepertoireMap(buildLines(MAP_START_PLIES), colour, onOpenLine, {
        title: 'Your games',
        subtitle: `${colourGames.length} game${colourGames.length !== 1 ? 's' : ''}`,
        depth: { startPlies: MAP_START_PLIES, stepPlies: MAP_STEP_PLIES, maxPlies: reach, atDepth: buildLines },
        stats: myStats(colour),
        nodeAction: { label: 'Open in builder', onAct: ({ ucis }) => exploreDeps?.onOpenInBuilder(ucis, colour) },
        colourToggle: { current: colour, enabled: { white: gamesHas('white'), black: gamesHas('black') }, onPick: openGames },
      });
    };
    entries.appendChild(mapEntryBtn(Icons.search(24), 'Your games tree',
      `${games.length} game${games.length !== 1 ? 's' : ''}`,
      () => openGames(gamesHas('white') ? 'white' : 'black')));
  }

  // 3) Your repertoire tree — the saved lines as one merged tree. The White/Black
  //    toggle sits at the top of the opened tree (defaulting to White).
  if (repHas('white') || repHas('black')) {
    const openRep = (colour: 'white' | 'black'): void => {
      const colourLines = lines.filter(l => l.colour === colour);
      const reach = Math.max(0, ...colourLines.map(l => treeDepth(l.tree)));
      openRepertoireMap(colourLines, colour, onOpenLine, {
        title: 'Your repertoire',
        depth: { startPlies: MAP_START_PLIES, stepPlies: MAP_STEP_PLIES, maxPlies: reach, atDepth: () => colourLines },
        ...(games.length > 0 && { stats: myStats(colour) }),
        colourToggle: { current: colour, enabled: { white: repHas('white'), black: repHas('black') }, onPick: openRep },
      });
    };
    entries.appendChild(mapEntryBtn(Icons.tree(24), 'Your repertoire tree',
      `${lines.length} line${lines.length !== 1 ? 's' : ''}`,
      () => openRep(repHas('white') ? 'white' : 'black')));
  }

  // Nothing to show (no lines and no games)? Tell the caller to drop the section.
  if (!entries.children.length) return null;
  return section;
}

// ── Opponent card ────────────────────────────────────────────────────────────────

// A few cheap-ish highlights for an opponent card, from one analysis pass over
// their games: a representative position (their most-played opening) for the
// miniature, and their clearest weakness (lowest-scoring opening that's still
// genuinely below even) for an at-a-glance prep nudge.
interface OpponentHighlights {
  fen: string | null;
  topUcis: string[];
  topColour: 'white' | 'black';
  weak: OpeningStat | null;
}
function opponentHighlights(opp: Opponent): OpponentHighlights {
  const stats = analyseGames(opp.games, []).stats;
  const top = [...stats].filter(s => s.repUcis.length > 0).sort((a, b) => b.games - a.games)[0] ?? null;
  const weak = stats
    .filter(s => s.family !== UNKNOWN_FAMILY && s.games >= MIN_GAMES_WEAK && s.scorePct < WEAK_SCORE_PCT)
    .sort((a, b) => a.scorePct - b.scorePct)[0] ?? null;
  return {
    fen: top ? fenFromUcis(top.repUcis) : null,
    topUcis: top?.repUcis ?? [],
    topColour: top?.colour ?? 'white',
    weak,
  };
}

function opponentCard(opp: Opponent, container: HTMLElement): HTMLElement {
  const summary = opponentSummary(opp);
  const hl = opponentHighlights(opp);
  const open = () => openDetail(opp.id, container);

  // Position-card scaffold so opponents read like the rest of the app's cards,
  // with a miniature of their most-played opening. Tapping the miniature jumps
  // straight to preparing a reply against that line (item 7/8); tapping the rest
  // of the card opens their full dossier.
  const { card, titleRow, content } = buildPositionCard({
    fen: hl.fen,
    orientation: hl.topColour,
    className: 'opponent-card',
    ...(hl.fen && hl.topUcis.length > 0 && {
      onMiniClick: () =>
        exploreDeps?.onPrepareReply(hl.topUcis, hl.topColour === 'white' ? 'black' : 'white', opp.name),
      miniLabel: `Prepare a reply vs ${opp.name}`,
    }),
  });
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  // Title row: name + platform chip + a chevron pinned right so it reads tappable.
  const nameEl = document.createElement('span');
  nameEl.className = 'pcard-name';
  nameEl.textContent = opp.name;
  titleRow.appendChild(nameEl);
  const plat = document.createElement('span');
  plat.className = 'tag-chip opponent-card-platform';
  plat.textContent = PLATFORM_LABEL[opp.platform];
  titleRow.appendChild(plat);
  const chevron = Icons.chevronRight(18);
  chevron.classList.add('scout-card-chevron');
  titleRow.appendChild(chevron);

  // Their most-played opening.
  const openingEl = document.createElement('div');
  openingEl.className = 'scout-card-opening';
  openingEl.textContent = summary.topOpening ?? 'No openings yet';
  content.appendChild(openingEl);

  // Their overall W-D-L bar (the reusable component).
  content.appendChild(wdlBlock({
    wins: summary.wins,
    draws: summary.draws,
    losses: summary.losses,
    scorePct: summary.scorePct,
    games: summary.games,
  }));

  // A clearest-weakness nudge — the single most useful scouting line at a glance.
  if (hl.weak) {
    const weakEl = document.createElement('div');
    weakEl.className = 'opponent-card-weak';
    weakEl.textContent = `Struggles: ${hl.weak.family} · ${hl.weak.scorePct}%`;
    content.appendChild(weakEl);
  }

  // Meta: games analysed + when last refreshed.
  const meta = document.createElement('div');
  meta.className = 'opponent-card-meta';
  meta.textContent =
    `${summary.games} game${summary.games === 1 ? '' : 's'} · refreshed ${timeAgo(opp.refreshedAt)}`;
  content.appendChild(meta);

  return card;
}

// ── Add / refresh flows (the shared import panel, scouting sink) ──────────────────

function addOpponent(container: HTMLElement): void {
  void (async () => {
    if (await countOpponents() >= MAX_OPPONENTS) {
      showDialog({
        title: 'Opponent limit reached',
        body: `You can scout up to ${MAX_OPPONENTS} opponents. Delete one to make room first.`,
        buttons: [{ label: 'OK', variant: 'primary' }],
      });
      return;
    }
    let addedId: string | null = null;
    openImportPanel({
      title: 'Scout an opponent',
      username: '',
      rememberUser: false,
      save: async (games, metaInfo) => {
        const opp = makeOpponent(metaInfo, games);
        await saveOpponent(opp);
        addedId = opp.id;
      },
      onImported: () => {
        renderExploreScreen(container);
        if (addedId) openDetail(addedId, container);
      },
    });
  })();
}

function refreshOpponent(opp: Opponent, container: HTMLElement, onDone: () => void): void {
  openImportPanel({
    title: `Refresh ${opp.name}`,
    platform: opp.platform,
    username: opp.username,
    rememberUser: false,
    save: async (games, metaInfo) => {
      await saveOpponent(makeOpponent(metaInfo, games, { id: opp.id }));
    },
    onImported: () => {
      renderExploreScreen(container);
      onDone();
    },
  });
}

// ── Detail view (full-screen overlay) ────────────────────────────────────────────

function openDetail(id: string, container: HTMLElement): void {
  void (async () => {
    const opp = await getOpponent(id);
    if (!opp) { renderExploreScreen(container); return; }
    // My saved lines prepared against this opponent (tagged "vs <name>"), plus
    // my own imported games — the report ranks recommendations against how I
    // actually score in each opening family.
    const tag = opponentTag(opp.name);
    const [allLines, myGames] = await Promise.all([getAllLines(), getAllGames()]);
    const myPrep = allLines.filter(l => l.tags.includes(tag));
    const report = buildScoutReport(opp.games, myGames);

    const overlay = document.createElement('div');
    overlay.className = 'rmap-overlay scout-detail';

    let closed = false;
    function close(): void {
      if (closed) return;
      closed = true;
      overlay.remove();
      removeBack();
    }
    const removeBack = pushBack(close);

    // Header.
    const header = document.createElement('div');
    header.className = 'rmap-header';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'rmap-back';
    back.setAttribute('aria-label', 'Close opponent');
    back.appendChild(Icons.back(20));
    back.addEventListener('click', close);
    const titleEl = document.createElement('h2');
    titleEl.className = 'rmap-title';
    titleEl.textContent = opp.name;
    const badge = document.createElement('span');
    badge.className = 'rmap-title-count';
    badge.textContent = PLATFORM_LABEL[opp.platform];
    header.appendChild(back);
    header.appendChild(titleEl);
    header.appendChild(badge);
    overlay.appendChild(header);

    // Scrollable body.
    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'scout-detail-body';

    // Summary + actions.
    const summary = document.createElement('p');
    summary.className = 'section-desc scout-summary';
    summary.textContent = `${opp.gamesAnalysed} game${opp.gamesAnalysed === 1 ? '' : 's'} analysed · refreshed ${timeAgo(opp.refreshedAt)}`;
    bodyWrap.appendChild(summary);

    const actions = document.createElement('div');
    actions.className = 'scout-actions';
    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'btn-secondary';
    refreshBtn.appendChild(Icons.reset(15));
    refreshBtn.appendChild(document.createTextNode('Refresh'));
    refreshBtn.addEventListener('click', () => {
      refreshOpponent(opp, container, () => { close(); openDetail(id, container); });
    });
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-danger';
    deleteBtn.appendChild(Icons.trash(15));
    deleteBtn.appendChild(document.createTextNode('Delete'));
    // Delete. The games and the scouting maps always go; the only choice is what
    // happens to the prepared lines tagged against this opponent. Refresh the
    // list FIRST and only then drop the detail overlay, so the back of the deck
    // is already fresh — never the stale list the old ordering flashed.
    const removeOpponent = (alsoDeleteLines: boolean) => {
      void (async () => {
        if (alsoDeleteLines) await Promise.all(myPrep.map(l => deleteLine(l.id)));
        await deleteOpponent(id);
        await renderExploreScreen(container);
        close();
      })();
    };
    deleteBtn.addEventListener('click', () => {
      // No prep against them — a plain two-button confirm.
      if (myPrep.length === 0) {
        showDialog({
          title: `Delete ${opp.name}?`,
          body: 'This removes their imported games and scouting maps from this device.',
          buttons: [
            { label: 'Delete', variant: 'danger', onClick: () => removeOpponent(false) },
            { label: 'Cancel', variant: 'secondary' },
          ],
        });
        return;
      }
      // They have prepared lines — offer to keep them (still useful, tagged) or
      // sweep them away too, with a live count.
      const n = myPrep.length;
      const them = n === 1 ? 'it' : 'them';
      showDialog({
        title: `Delete ${opp.name}?`,
        body: `Their games and scouting maps will be removed. You have ${n} prepared line${n === 1 ? '' : 's'} tagged “vs ${opp.name}” — keep ${them} in My Lines, or delete ${them} too?`,
        buttons: [
          { label: `Keep my ${n} line${n === 1 ? '' : 's'}`, variant: 'primary', onClick: () => removeOpponent(false) },
          { label: 'Delete the lines too', variant: 'danger', onClick: () => removeOpponent(true) },
          { label: 'Cancel', variant: 'secondary' },
        ],
      });
    });
    actions.appendChild(refreshBtn);
    actions.appendChild(deleteBtn);
    bodyWrap.appendChild(actions);

    // Prepare a reply: leave the detail (and any open map) for the builder,
    // seeded with the opponent's moves and flipped to MY answering colour —
    // the opposite of the colour they played in this map/opening.
    const prepare = (ucis: string[], opponentColour: 'white' | 'black') => {
      close();
      exploreDeps?.onPrepareReply(ucis, opponentColour === 'white' ? 'black' : 'white', opp.name);
    };

    // 1) Visualize their games — at the top (mirrors the Explore tab's
    //    "Visualize your play"): a Board browser and their games tree, both
    //    pointed at THEIR games and handing "Prepare a reply" back here.
    bodyWrap.appendChild(visualizeOpponentSection(opp, prepare));

    // 2) Scouting report — their overall W-D-L bar, then the three findings
    //    (where they struggle / score / what to play) tucked in an accordion.
    bodyWrap.appendChild(reportSection(opp, report));

    // 3) My prep against this opponent, when I have any.
    if (myPrep.length > 0) {
      bodyWrap.appendChild(yourPrepSection(myPrep, line => { close(); exploreDeps?.onOpenLine(line); }));
    }

    // 4) Their most-played openings, per colour.
    const analysis = analyseGames(opp.games, []);
    bodyWrap.appendChild(openingsSection(
      'Their openings as White',
      analysis.stats.filter(s => s.colour === 'white'),
      prepare,
    ));
    bodyWrap.appendChild(openingsSection(
      'Their openings as Black',
      analysis.stats.filter(s => s.colour === 'black'),
      prepare,
    ));

    overlay.appendChild(bodyWrap);
    document.body.appendChild(overlay);
  })();
}

// ── Scouting report (their record + an accordion of findings) ─────────────────────

// The report: the opponent's overall W-D-L bar ("Their results" — the one place
// that caption appears, fixing the perspective for the whole detail), then —
// once they have a deep enough sample — the three findings groups (where they
// struggle / score / what to play) tucked inside a "Scouting report" accordion,
// collapsed by default to keep the dossier scannable. With no opening reaching
// the games floor, an honest empty line replaces the accordion.
function reportSection(opp: Opponent, report: ScoutReport): HTMLElement {
  const section = document.createElement('div');
  section.className = 'section';

  const head = document.createElement('div');
  head.className = 'section-head';
  const h = document.createElement('h2');
  h.className = 'section-title';
  h.textContent = 'Their results';
  head.appendChild(h);
  section.appendChild(head);

  const summary = opponentSummary(opp);
  section.appendChild(wdlBlock({
    wins: summary.wins,
    draws: summary.draws,
    losses: summary.losses,
    scorePct: summary.scorePct,
    games: summary.games,
  }));

  if (!report.enoughGames) {
    const empty = document.createElement('p');
    empty.className = 'section-desc scout-report-empty';
    empty.textContent = 'Not enough games for a report yet — import more.';
    section.appendChild(empty);
    return section;
  }

  // The three findings live in a collapsible "Scouting report" accordion.
  const { wrap, body } = makeAccordion('Scouting report');
  body.appendChild(reportGroup('Where they struggle',
    report.weakest.map(r => recordRow(r))));
  body.appendChild(reportGroup('Where they score',
    report.strongest.map(r => recordRow(r))));
  body.appendChild(reportGroup('What to play',
    report.recommendations.map(rec => recommendationRow(rec))));
  section.appendChild(wrap);

  return section;
}

// A simple collapsible accordion (header button + chevron + hidden body),
// collapsed by default. Used for the scouting-report findings.
function makeAccordion(title: string, startOpen = false): { wrap: HTMLElement; body: HTMLElement } {
  const wrap = document.createElement('div');
  wrap.className = 'scout-accordion';

  let open = startOpen;
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'scout-accordion-head' + (open ? ' scout-accordion-head--open' : '');
  head.setAttribute('aria-expanded', String(open));

  const t = document.createElement('span');
  t.className = 'scout-accordion-title';
  t.textContent = title;
  head.appendChild(t);

  const chev = Icons.chevronDown(18);
  chev.classList.add('scout-accordion-chev');
  head.appendChild(chev);
  wrap.appendChild(head);

  const body = document.createElement('div');
  body.className = 'scout-accordion-body';
  body.hidden = !open;
  wrap.appendChild(body);

  head.addEventListener('click', () => {
    open = !open;
    body.hidden = !open;
    head.classList.toggle('scout-accordion-head--open', open);
    head.setAttribute('aria-expanded', String(open));
  });

  return { wrap, body };
}

// One titled cluster of report rows.
function reportGroup(title: string, rows: HTMLElement[]): HTMLElement {
  const group = document.createElement('div');
  group.className = 'scout-report-group';

  const label = document.createElement('div');
  label.className = 'scout-report-group-title';
  label.textContent = title;
  group.appendChild(label);

  const list = document.createElement('div');
  list.className = 'group';
  for (const row of rows) list.appendChild(row);
  group.appendChild(list);
  return group;
}

// A compact report row: the opening name + games count on the top line, their
// W-D-L bar below. `extra`, when given, hangs a small line under the bar.
function recordRow(rec: OpeningRecord, extra?: HTMLElement): HTMLElement {
  const card = document.createElement('div');
  card.className = 'line-card review-card scout-report-row';

  const body = document.createElement('div');
  body.className = 'line-card-body review-card-body';

  const headRow = document.createElement('div');
  headRow.className = 'scout-report-row-head';
  const nameEl = document.createElement('div');
  nameEl.className = 'line-card-name';
  nameEl.textContent = rec.family;
  headRow.appendChild(nameEl);
  const gamesChip = document.createElement('span');
  gamesChip.className = 'review-stat-chip';
  gamesChip.textContent = `${rec.games} game${rec.games === 1 ? '' : 's'}`;
  headRow.appendChild(gamesChip);
  body.appendChild(headRow);

  // Their record as a slim bar; the perspective is captioned once up top, so no
  // caption repeats here.
  body.appendChild(wdlScoreRow({
    wins: rec.wins,
    draws: rec.draws,
    losses: rec.losses,
    scorePct: rec.scorePct,
    games: rec.games,
  }));

  if (extra) body.appendChild(extra);

  card.appendChild(body);
  return card;
}

// A "what to play" row: the opponent's (weak) record, plus a small line giving
// the side I'd play and my own score in the family — or admitting I have none.
function recommendationRow(rec: Recommendation): HTMLElement {
  const sideWord = rec.myColour === 'white' ? 'White' : 'Black';
  const note = document.createElement('div');
  note.className = 'scout-report-mine';
  if (rec.mine) {
    note.textContent =
      `Play ${sideWord} · you score ${rec.mine.scorePct}% here ` +
      `(${rec.mine.wins}-${rec.mine.draws}-${rec.mine.losses})`;
  } else {
    note.classList.add('scout-report-mine--nodata');
    note.textContent = `Play ${sideWord} · no data on your side`;
  }
  return recordRow(rec.their, note);
}

// ── Your prep (my saved lines tagged to this opponent) ────────────────────────────

function yourPrepSection(lines: Line[], onOpen: (line: Line) => void): HTMLElement {
  const section = document.createElement('div');
  section.className = 'section';
  const head = document.createElement('div');
  head.className = 'section-head';
  const h = document.createElement('h2');
  h.className = 'section-title';
  h.textContent = 'Your prep';
  head.appendChild(h);
  const m = document.createElement('span');
  m.className = 'section-meta';
  m.textContent = `${lines.length} line${lines.length === 1 ? '' : 's'}`;
  head.appendChild(m);
  section.appendChild(head);

  // The shared filter bar (filters.ts). These lines are all prepared against the
  // one opponent, so there's no opponent-tag group, no status and no sort — just
  // colour on row 1 and any of my own tags on row 2. The bar drops empty groups.
  const list = document.createElement('div');
  list.className = 'group';

  const filter = createFilterBar({
    persistKey: PREP_FILTER_KEY,
    userTags: distinctUserTags(lines),
    onChange: () => rebuildList(),
  });
  section.appendChild(filter.element);
  section.appendChild(list);

  function rebuildList(): void {
    list.innerHTML = '';
    const sel = filter.selection;
    let shown = sel.colour === 'all' ? lines : lines.filter(l => l.colour === sel.colour);
    if (sel.tags.length > 0) shown = shown.filter(l => sel.tags.some(t => l.tags.includes(t)));

    if (shown.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'section-desc';
      empty.textContent = 'No prep matches these filters.';
      list.appendChild(empty);
      return;
    }

    for (const line of shown) list.appendChild(prepCard(line, onOpen));
  }

  rebuildList();
  return section;
}

// Every distinct user-authored tag (everything that isn't a "vs <name>" tag).
function distinctUserTags(lines: Line[]): string[] {
  const set = new Set<string>();
  for (const l of lines) for (const t of l.tags) if (!isOpponentTag(t)) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function prepCard(line: Line, onOpen: (line: Line) => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'line-card';
  const body = document.createElement('div');
  body.className = 'line-card-body';
  body.setAttribute('role', 'button');
  body.tabIndex = 0;
  const open = () => onOpen(line);
  body.addEventListener('click', open);
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  const nameEl = document.createElement('div');
  nameEl.className = 'line-card-name';
  nameEl.textContent = line.name || line.openingName || 'Untitled line';
  body.appendChild(nameEl);

  const metaRow = document.createElement('div');
  metaRow.className = 'line-card-meta';
  metaRow.appendChild(chip(line.colour === 'white' ? '○ White' : '● Black'));
  if (line.openingName && line.openingName !== nameEl.textContent) {
    metaRow.appendChild(chip(line.openingName));
  }
  body.appendChild(metaRow);

  card.appendChild(body);
  return card;
}

// Seed a prepared reply from the opponent's move sequence; the colour passed is
// the colour THEY played (the answering side is the opposite).
type PrepareFn = (ucis: string[], opponentColour: 'white' | 'black') => void;

// Visualize their games — a Board browser + their games tree, mirroring the
// Explore tab's "Visualize your play" but pointed at THIS opponent's games. Both
// hand "Prepare a reply" back through `prepare`, and each carries its own
// White/Black toggle (greying out a side they never played).
function visualizeOpponentSection(opp: Opponent, prepare: PrepareFn): HTMLElement {
  const section = document.createElement('div');
  section.className = 'section';
  const head = document.createElement('div');
  head.className = 'section-head';
  const h = document.createElement('h2');
  h.className = 'section-title';
  h.textContent = `Visualize ${opp.name}’s games`;
  head.appendChild(h);
  section.appendChild(head);

  const entries = document.createElement('div');
  entries.className = 'rmap-entries';
  section.appendChild(entries);

  const has = (c: 'white' | 'black') => colourGameCount(opp, c) > 0;
  if (!has('white') && !has('black')) {
    const empty = document.createElement('p');
    empty.className = 'section-desc';
    empty.textContent = 'No games to visualize yet.';
    section.appendChild(empty);
    return section;
  }
  const start: 'white' | 'black' = has('white') ? 'white' : 'black';
  const enabled = { white: has('white'), black: has('black') };

  // Board browser — walk their positions with their per-move W/D/L; "Prepare a
  // reply" hands the walked line back (flipped to my answering colour).
  const openBrowser = (colour: 'white' | 'black'): void => {
    openBoardExplorer({
      statsTree: buildMoveStats(opp.games, colour, MAP_MAX_PLIES),
      caption: 'their results',
      colour,
      games: opp.games,
      title: `${opp.name} — board browser`,
      action: { label: 'Prepare a reply', onAct: ({ ucis }) => prepare(ucis, colour) },
      colourToggle: { current: colour, enabled, onPick: openBrowser },
    });
  };
  entries.appendChild(mapEntryBtn(Icons.compass(24), 'Board browser',
    `Walk ${opp.name}’s games on a board`, () => openBrowser(start)));

  // Their games tree — the auto-built opponent map, colour toggling inside.
  const openTree = (colour: 'white' | 'black'): void => {
    const games = colourGameCount(opp, colour);
    openRepertoireMap(
      // The map rebuilds the pruned tree from stored games at each depth (see
      // `atDepth`); this line is just the seed used for preview association.
      [opponentLine(buildOpponentTree(opp.games, colour, MAP_START_PLIES, false), colour, opp.name)],
      colour,
      () => { /* opponent maps have no "open in builder" */ },
      {
        title: `${opp.name} — ${colour === 'white' ? 'White' : 'Black'}`,
        subtitle: `${games} game${games === 1 ? '' : 's'}`,
        // Prepare a reply from any node: seed the builder with the path to it.
        nodeAction: { label: 'Prepare a reply', onAct: ({ ucis }) => prepare(ucis, colour) },
        depth: {
          startPlies: MAP_START_PLIES,
          stepPlies: MAP_STEP_PLIES,
          maxPlies: opponentReachPlies(opp, colour),
          // Feed the FULL (unpruned) tree so the map's "All replies" view shows
          // every move they played; "Frequent" prunes it by stats.
          atDepth: plies => [opponentLine(buildOpponentTree(opp.games, colour, plies, false), colour, opp.name)],
          importHint: true,
        },
        // Per-move W/D/L from THEIR perspective (the scouted user was "me" at
        // import), built to the deep limit so the deeper view has stats too.
        stats: { tree: buildMoveStats(opp.games, colour, MAP_MAX_PLIES), caption: 'their results', games: opp.games },
        colourToggle: { current: colour, enabled, onPick: openTree },
      },
    );
  };
  entries.appendChild(mapEntryBtn(Icons.search(24), 'Their games tree',
    `${opp.gamesAnalysed} game${opp.gamesAnalysed === 1 ? '' : 's'}`, () => openTree(start)));

  return section;
}

// One colour's most-played openings: top N, with a "Show all" reveal.
function openingsSection(title: string, stats: OpeningStat[], prepare: PrepareFn): HTMLElement {
  const section = document.createElement('div');
  section.className = 'section';
  const head = document.createElement('div');
  head.className = 'section-head';
  const h = document.createElement('h2');
  h.className = 'section-title';
  h.textContent = title;
  head.appendChild(h);
  if (stats.length > 0) {
    const m = document.createElement('span');
    m.className = 'section-meta';
    m.textContent = `${stats.length} opening${stats.length === 1 ? '' : 's'}`;
    head.appendChild(m);
  }
  section.appendChild(head);

  if (stats.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'section-desc';
    empty.textContent = 'No games on this side yet.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('div');
  list.className = 'group';
  stats.forEach((stat, i) => {
    const card = openingCard(stat, prepare);
    if (i >= TOP_OPENINGS) card.hidden = true;
    list.appendChild(card);
  });
  section.appendChild(list);

  if (stats.length > TOP_OPENINGS) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'btn-secondary scout-show-all';
    more.textContent = `Show all ${stats.length}`;
    more.addEventListener('click', () => {
      for (const c of Array.from(list.children) as HTMLElement[]) c.hidden = false;
      more.remove();
    });
    section.appendChild(more);
  }
  return section;
}

function openingCard(stat: OpeningStat, prepare: PrepareFn): HTMLElement {
  const card = document.createElement('div');
  card.className = 'line-card review-card';

  const body = document.createElement('div');
  body.className = 'line-card-body review-card-body';

  const nameEl = document.createElement('div');
  nameEl.className = 'line-card-name';
  nameEl.textContent = stat.family;
  body.appendChild(nameEl);

  const metaRow = document.createElement('div');
  metaRow.className = 'line-card-meta';
  const gamesChip = document.createElement('span');
  gamesChip.className = 'review-stat-chip';
  gamesChip.textContent = `Played ${stat.games}×`;
  metaRow.appendChild(gamesChip);
  body.appendChild(metaRow);

  // Their result on this opening, as a slim bar: score% left, the W-D-L split as
  // segments, the bare counts in small text on the right. The perspective is
  // already captioned once up in the scouting report, so no caption repeats here.
  body.appendChild(wdlScoreRow({
    wins: stat.wins,
    draws: stat.draws,
    losses: stat.losses,
    scorePct: stat.scorePct,
    games: stat.games,
  }));

  if (stat.repSans.length > 0) {
    const lineEl = document.createElement('div');
    lineEl.className = 'review-moves';
    lineEl.textContent = formatSanLine(stat.repSans);
    body.appendChild(lineEl);
  }

  // Prepare a reply against this opening's representative line.
  const prepareBtn = document.createElement('button');
  prepareBtn.type = 'button';
  prepareBtn.className = 'btn-secondary scout-prepare';
  prepareBtn.textContent = 'Prepare a reply';
  if (stat.repUcis.length === 0) {
    prepareBtn.disabled = true;
    prepareBtn.title = 'No moves to seed from';
  } else {
    prepareBtn.addEventListener('click', () => prepare(stat.repUcis, stat.colour));
  }
  body.appendChild(prepareBtn);

  card.appendChild(body);
  return card;
}

// ── Recommended lines to try (games-gated) ───────────────────────────────────
//
// Once games are imported, surface up to 4 openings per colour worth building a
// solid line for. HEURISTIC: openings you reach OFTEN ENOUGH to matter
// (≥ MIN_GAMES_WEAK games) but UNDER-PERFORM in (score under WEAK_SCORE_PCT, i.e.
// below even). That's the honest "you keep playing this and keep losing — go prep
// a solid line" signal. Worst score leads; ties break on most games. We require a
// recognised family (so the card has a real name) and a representative line (so
// "Build line" has moves to seed). This reuses analysis.ts's existing per-opening
// stats untouched — no extra signal was needed for a decent pick. (A future
// refinement could weight how *recent* the losses are, or down-rank openings
// you've since prepped; both would need analysis to expose more than it does now.)
function recommendedFor(stats: OpeningStat[], colour: 'white' | 'black'): OpeningStat[] {
  return stats
    .filter(s =>
      s.colour === colour &&
      s.family !== UNKNOWN_FAMILY &&
      s.repUcis.length > 0 &&
      s.games >= MIN_GAMES_WEAK &&
      s.scorePct < WEAK_SCORE_PCT)
    .sort((a, b) => a.scorePct - b.scorePct || b.games - a.games)
    .slice(0, 4);
}

// The section element, or null when there's nothing worth recommending (so the
// caller can omit it entirely). Only ever reached when games are imported.
function recommendationsSection(games: ImportedGame[], lines: Line[]): HTMLElement | null {
  const analysis = analyseGames(games, lines);
  const white = recommendedFor(analysis.stats, 'white');
  const black = recommendedFor(analysis.stats, 'black');
  if (white.length === 0 && black.length === 0) return null;

  const section = document.createElement('div');
  section.className = 'section';

  const head = document.createElement('div');
  head.className = 'section-head';
  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = 'Recommended lines to try';
  head.appendChild(heading);
  section.appendChild(head);

  const desc = document.createElement('p');
  desc.className = 'section-desc';
  desc.textContent =
    'Openings you play a lot but score poorly in — build a solid line and train it.';
  section.appendChild(desc);

  if (white.length > 0) {
    section.appendChild(reportGroup('As White', white.map(recommendationCard)));
  }
  if (black.length > 0) {
    section.appendChild(reportGroup('As Black', black.map(recommendationCard)));
  }
  return section;
}

// One recommendation, built on the shared position-card scaffold so it reads
// exactly like the From-my-games suggestion cards: family + colour pip on row 1,
// a miniature (honouring the global toggle) on the left of row 2 with the score,
// line and Build action on the right. "Build line" reuses the same builder seed
// path as those suggestions (onOpenInBuilder → buildFromUcis in main.ts).
function recommendationCard(stat: OpeningStat): HTMLElement {
  const { card, titleRow, content } = buildPositionCard({
    fen: fenFromUcis(stat.repUcis),
    orientation: stat.colour,
    className: 'games-card',
    onMiniClick: () => exploreDeps?.onOpenInBuilder(stat.repUcis, stat.colour),
    miniLabel: 'Build this line',
  });

  titleRow.appendChild(colourPip(stat.colour));
  const nameEl = document.createElement('span');
  nameEl.className = 'pcard-name';
  nameEl.textContent = stat.family;
  titleRow.appendChild(nameEl);

  const meta = document.createElement('div');
  meta.className = 'stat-card-chips';
  const gamesChip = document.createElement('span');
  gamesChip.className = 'review-stat-chip';
  gamesChip.textContent = `Played ${stat.games}×`;
  meta.appendChild(gamesChip);
  content.appendChild(meta);

  // Score line — bar + "42% · W-D-L".
  const scoreRow = document.createElement('div');
  scoreRow.className = 'review-score-row';
  scoreRow.appendChild(scoreBar(stat.scorePct));
  const scoreText = document.createElement('span');
  scoreText.className = 'review-score-text';
  scoreText.textContent = `${stat.scorePct}% · ${stat.wins}-${stat.draws}-${stat.losses} W-D-L`;
  scoreRow.appendChild(scoreText);
  content.appendChild(scoreRow);

  if (stat.repSans.length > 0) {
    const lineEl = document.createElement('div');
    lineEl.className = 'review-moves stat-card-note';
    lineEl.textContent = formatSanLine(stat.repSans);
    content.appendChild(lineEl);
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-secondary stat-card-btn';
  btn.textContent = 'Build line';
  btn.addEventListener('click', e => {
    e.stopPropagation();
    exploreDeps?.onOpenInBuilder(stat.repUcis, stat.colour);
  });
  content.appendChild(btn);

  return card;
}

// A win/draw/loss score bar, green→amber→red by how good the score is. (Same
// shape as the From-my-games suggestion cards in lines-screen.)
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

// ── Small shared helpers ──────────────────────────────────────────────────────────

function chip(text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'tag-chip';
  el.textContent = text;
  return el;
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

// "just now" / "3h ago" / "5d ago" from an ISO timestamp.
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
