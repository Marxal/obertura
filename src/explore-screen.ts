// The Explore tab — visualizing your play, scouting and engine sparring.
//
// Top to bottom: a "Browse opening library" launcher leads (a bare button, not a
// section), then the agreed Explore order:
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
// (Distinct from explore.ts, the in-board explorer.)

import type { Line } from './types';
import type { ImportedGame } from './chesscom';
import { fetchAvatar } from './chesscom';
import type { MoveNode } from './tree';
import { Icons } from './icons';
import { showDialog } from './dialog';
import { openImportPanel } from './import-panel';
import { openRepertoireMap } from './repertoire-map';
import { openBoardExplorer } from './board-explorer';
import { openLibrary } from './library';
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
  opponentSummary, buildOpponentTree, opponentReachPlies, MIN_REPORT_GAMES,
  MAP_START_PLIES, MAP_STEP_PLIES, MAP_MAX_PLIES,
  type Opponent,
} from './scout';
import { wdlBlock, wdlScoreRow } from './wdl-bar';
import { buildMoveStats, buildRepertoireStatTree } from './move-stats';
import { createFilterBar } from './filters';
import { buildEmptyState } from './empty-state';
import { pushBack } from './back-nav';

const PLATFORM_LABEL = { chesscom: 'Chess.com', lichess: 'Lichess' } as const;
// Most-played list cap before "Show all".
const TOP_OPENINGS = 6;
// How many openings the scouting report shows per group (struggle / score).
const REPORT_PICKS = 3;
// Persistence key for the prepared-lines filter bar (shared across opponents;
// stale tags from another opponent are sanitised away on load).
const PREP_FILTER_KEY = 'obertura.prep.filter';

// Persistence key for the "Their openings" colour filter (All / White / Black),
// shared across opponents — it carries no per-opponent state.
const OPENINGS_FILTER_KEY = 'obertura.scout.openings.filter';

// The scouting report's filters: a colour segment (All / White / Black) and a
// Weakest / Strongest toggle, both shared across opponents.
const REPORT_FILTER_KEY = 'obertura.scout.report.filter';
const REPORT_RANK_KEY = 'obertura.scout.report.rank';
type ReportRank = 'weakest' | 'strongest';

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

  // "Browse opening library" leads the screen — a plain full-width launcher
  // (not a .section card). The ~490 KB dataset is lazy-loaded only on open.
  container.appendChild(libraryButton());

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

// ── Browse opening library (top of Explore, a bare button) ────────────────────

// A standalone full-width launcher, deliberately NOT wrapped in a .section card,
// so it reads as a simple button above the sections. The ~490 KB library dataset
// is lazy-loaded only when it's actually opened, so this is free to render.
function libraryButton(): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'games-refresh-btn library-launch-btn';
  btn.appendChild(Icons.search(15));
  btn.appendChild(document.createTextNode('Browse opening library'));
  btn.addEventListener('click', () => {
    openLibrary((ucis, colour) => exploreDeps?.onOpenInBuilder(ucis, colour));
  });
  return btn;
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
  variant?: 'primary' | 'discrete',
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rmap-entry' + (variant ? ` rmap-entry--${variant}` : '');
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
// show (no lines and no games) so the caller can skip appending it.
//
// Layout: the Board browser leads as the prominent (green) entry, with your
// games tree as a discrete link beneath. The repertoire is no longer its own
// entry — instead, BOTH the board browser and the tree carry a discrete
// "Games / Repertoire" source toggle at the top (next to the White/Black
// toggle), so you switch source from inside. With no games (only saved lines),
// the repertoire tree stands in as the single discrete entry so it stays
// reachable.
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
  desc.textContent = 'Walk your games on the board — switch to your repertoire from inside.';
  section.appendChild(desc);

  const entries = document.createElement('div');
  entries.className = 'rmap-entries';
  section.appendChild(entries);

  const onOpenLine = (line: Line) => exploreDeps?.onOpenLine(line);

  // Per-move W/D/L from MY imported games (my perspective), overlaid on both the
  // games tree and the repertoire tree.
  const myStats = (colour: 'white' | 'black') => ({
    tree: buildMoveStats(games, colour, MAP_MAX_PLIES),
    caption: 'your results',
    games,
  });

  type Source = 'games' | 'repertoire';
  const gamesHas = (c: 'white' | 'black') => games.some(g => g.colour === c);
  const repHas = (c: 'white' | 'black') => lines.some(l => l.colour === c);
  const gamesAny = gamesHas('white') || gamesHas('black');
  const repAny = repHas('white') || repHas('black');

  // Which colours a source can show, and a safe colour to land on when switching
  // source (the source you came in on may not have the colour you were viewing).
  const colourEnabled = (s: Source, c: 'white' | 'black') => (s === 'games' ? gamesHas(c) : repHas(c));
  const colourEnabledMap = (s: Source) => ({ white: colourEnabled(s, 'white'), black: colourEnabled(s, 'black') });
  const firstColour = (s: Source): 'white' | 'black' => (colourEnabled(s, 'white') ? 'white' : 'black');
  const validColour = (s: Source, from: 'white' | 'black') => (colourEnabled(s, from) ? from : firstColour(s));
  const sourceEnabled = { games: gamesAny, repertoire: repAny };

  // Board browser — walk positions with per-move W/D/L. The source toggle swaps
  // the stats tree: your games' results, or your repertoire (with your game
  // results overlaid where you've actually played those moves).
  const openBrowser = (colour: 'white' | 'black', source: Source): void => {
    const isGames = source === 'games';
    openBoardExplorer({
      statsTree: isGames
        ? buildMoveStats(games, colour, MAP_MAX_PLIES)
        : buildRepertoireStatTree(lines, games, colour, MAP_MAX_PLIES),
      caption: isGames ? 'your results' : 'your repertoire',
      colour,
      // No opponent here — still show the strips ("You" below, a generic
      // "Opponent" on top) so the perspective reads the same as a scout browser.
      players: {},
      // "See full game" only makes sense over real games.
      ...(isGames && { games }),
      title: 'Board browser',
      onOpenInBuilder: (ucis, c) => exploreDeps?.onOpenInBuilder(ucis, c),
      colourToggle: { current: colour, enabled: colourEnabledMap(source), onPick: c => openBrowser(c, source) },
      sourceToggle: { current: source, enabled: sourceEnabled, onPick: s => openBrowser(validColour(s, colour), s) },
    });
  };

  // The tree (repertoire-map) for either source. Games: the merged imported-game
  // tree; Repertoire: the saved lines merged. Both overlay your game results
  // when you have games, and both carry the colour + source toggles.
  const openTree = (colour: 'white' | 'black', source: Source): void => {
    const isGames = source === 'games';
    const buildGameLines = (plies: number) =>
      [opponentLine(buildOpponentTree(games, colour, plies, false), colour, 'Your games')];
    const colourLines = isGames ? buildGameLines(MAP_START_PLIES) : lines.filter(l => l.colour === colour);
    const reach = isGames
      ? Math.max(0, ...games.filter(g => g.colour === colour).map(g => g.sans.length))
      : Math.max(0, ...lines.filter(l => l.colour === colour).map(l => treeDepth(l.tree)));
    openRepertoireMap(colourLines, colour, onOpenLine, {
      title: isGames ? 'Your games' : 'Your repertoire',
      ...(isGames && {
        subtitle: `${games.filter(g => g.colour === colour).length} game${
          games.filter(g => g.colour === colour).length !== 1 ? 's' : ''}`,
      }),
      depth: {
        startPlies: MAP_START_PLIES,
        stepPlies: MAP_STEP_PLIES,
        maxPlies: reach,
        atDepth: isGames ? buildGameLines : () => lines.filter(l => l.colour === colour),
      },
      ...(games.length > 0 && { stats: myStats(colour) }),
      ...(isGames && {
        nodeAction: { label: 'Open in builder', onAct: ({ ucis }) => exploreDeps?.onOpenInBuilder(ucis, colour) },
      }),
      colourToggle: { current: colour, enabled: colourEnabledMap(source), onPick: c => openTree(c, source) },
      sourceToggle: { current: source, enabled: sourceEnabled, onPick: s => openTree(validColour(s, colour), s) },
    });
  };

  if (gamesAny) {
    // Board browser leads as the prominent green entry…
    entries.appendChild(mapEntryBtn(Icons.compass(24), 'Board browser',
      `${games.length} game${games.length !== 1 ? 's' : ''}`,
      () => openBrowser(firstColour('games'), 'games'), 'primary'));
    // …with the games tree as a discrete link beneath.
    entries.appendChild(mapEntryBtn(Icons.search(24), 'Your games tree',
      `${games.length} game${games.length !== 1 ? 's' : ''}`,
      () => openTree(firstColour('games'), 'games'), 'discrete'));
  } else if (repAny) {
    // No games yet — keep the repertoire tree reachable as the single entry.
    entries.appendChild(mapEntryBtn(Icons.tree(24), 'Your repertoire tree',
      `${lines.length} line${lines.length !== 1 ? 's' : ''}`,
      () => openTree(firstColour('repertoire'), 'repertoire'), 'discrete'));
  }

  // Nothing to show (no lines and no games)? Tell the caller to drop the section.
  if (!entries.children.length) return null;
  return section;
}

// ── Opponent card ────────────────────────────────────────────────────────────────

// A small round avatar for a scouted player: their Chess.com picture when we
// have one, otherwise a fallback user icon. Used on the opponent card and in
// the detail header so they read as people, not just usernames.
function buildAvatar(opp: Opponent, size: number): HTMLElement {
  if (opp.avatarUrl) {
    const img = document.createElement('img');
    img.className = 'scout-avatar';
    img.src = opp.avatarUrl;
    img.alt = '';
    img.width = size;
    img.height = size;
    img.loading = 'lazy';
    // A broken/blocked image quietly falls back to the icon.
    img.addEventListener('error', () => img.replaceWith(buildAvatarIcon(size)));
    return img;
  }
  return buildAvatarIcon(size);
}

function buildAvatarIcon(size: number): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'scout-avatar scout-avatar--icon';
  wrap.style.width = `${size}px`;
  wrap.style.height = `${size}px`;
  wrap.appendChild(Icons.userCircle(Math.round(size * 0.7)));
  return wrap;
}

function opponentCard(opp: Opponent, container: HTMLElement): HTMLElement {
  const summary = opponentSummary(opp);
  const open = () => openDetail(opp.id, container);

  // A roster card — no board, no opening: just who they are and how they score.
  // The position-card scaffold (with no fen) gives us the title-row + content
  // layout without a miniature, so opponents still read like the app's cards.
  const { card, titleRow, content } = buildPositionCard({
    fen: null,
    className: 'opponent-card',
  });
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  // Title row: avatar + name + platform chip + a chevron pinned right so it
  // reads tappable.
  titleRow.appendChild(buildAvatar(opp, 28));
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

  // Their overall W-D-L bar (the reusable component).
  content.appendChild(wdlBlock({
    wins: summary.wins,
    draws: summary.draws,
    losses: summary.losses,
    scorePct: summary.scorePct,
    games: summary.games,
  }));

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
        // A Chess.com profile picture, when they have one (Lichess has none).
        // Purely cosmetic and non-blocking — a miss just shows the fallback icon.
        const avatarUrl =
          metaInfo.platform === 'chesscom' ? await fetchAvatar(metaInfo.username) : undefined;
        const opp = makeOpponent(metaInfo, games, { avatarUrl });
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
      // Re-fetch the avatar on refresh so a newly-set picture appears; fall back
      // to the one we already had if the lookup turns up nothing.
      const avatarUrl =
        (metaInfo.platform === 'chesscom' ? await fetchAvatar(metaInfo.username) : undefined) ??
        opp.avatarUrl;
      await saveOpponent(makeOpponent(metaInfo, games, { id: opp.id, avatarUrl }));
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
    // My saved lines prepared against this opponent (tagged "vs <name>").
    const tag = opponentTag(opp.name);
    const allLines = await getAllLines();
    const myPrep = allLines.filter(l => l.tags.includes(tag));
    // One analysis pass over their games — the openings list and the scouting
    // report findings are both read off the same OpeningStat[].
    const stats = analyseGames(opp.games, []).stats;

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
    header.appendChild(buildAvatar(opp, 32));
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

    // 2) Scouting report — their overall W-D-L bar, then the two findings
    //    (where they struggle / where they score) tucked in an accordion, each
    //    shown as the same rich card as Their openings.
    bodyWrap.appendChild(reportSection(opp, stats, prepare));

    // 3) My prep against this opponent, when I have any.
    if (myPrep.length > 0) {
      bodyWrap.appendChild(yourPrepSection(myPrep, line => { close(); exploreDeps?.onOpenLine(line); }));
    }

    // 4) Their most-played openings — one list with an All / White / Black
    //    filter (mirrors My Lines), rather than two split colour sections.
    bodyWrap.appendChild(openingsSection(stats, prepare));

    overlay.appendChild(bodyWrap);
    document.body.appendChild(overlay);
  })();
}

// ── Scouting report (their record + a filtered findings list) ─────────────────────

// The report: the opponent's overall W-D-L bar ("Their results" — the one place
// that caption appears, fixing the perspective for the whole detail), then —
// once they have a deep enough sample — a single findings list driven by two
// filters: a colour segment (All / White / Black) and a Weakest / Strongest
// toggle. Each finding is the SAME rich card as "Their openings" (board, moves,
// W-D-L, "Prepare a reply"), fed the matching OpeningStat. With no opening
// reaching the games floor, an honest empty line replaces the list.
function reportSection(opp: Opponent, stats: OpeningStat[], prepare: PrepareFn): HTMLElement {
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

  // Only recognised families with a real sample of their games count — fewer is
  // noise, not a tendency.
  const qualifying = stats.filter(s => s.family !== UNKNOWN_FAMILY && s.games >= MIN_REPORT_GAMES);
  if (qualifying.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'section-desc scout-report-empty';
    empty.textContent = 'Not enough games for a report yet — import more.';
    section.appendChild(empty);
    return section;
  }

  // Colour segment (shared filter bar, no sort/tags) + a Weakest/Strongest
  // toggle riding alongside it on the same row.
  let rank: ReportRank = localStorage.getItem(REPORT_RANK_KEY) === 'strongest' ? 'strongest' : 'weakest';
  const list = document.createElement('div');
  list.className = 'group';

  const filter = createFilterBar({
    persistKey: REPORT_FILTER_KEY,
    onChange: () => rebuildList(),
  });
  filter.element.querySelector('.fbar-top')?.appendChild(
    buildRankSeg(rank, r => { rank = r; localStorage.setItem(REPORT_RANK_KEY, r); rebuildList(); }),
  );
  section.appendChild(filter.element);
  section.appendChild(list);

  function rebuildList(): void {
    list.innerHTML = '';
    const sel = filter.selection;
    const filtered = sel.colour === 'all' ? qualifying : qualifying.filter(s => s.colour === sel.colour);
    const shown = [...filtered].sort(rank === 'weakest'
      ? (a, b) => a.scorePct - b.scorePct || b.games - a.games || a.family.localeCompare(b.family)
      : (a, b) => b.scorePct - a.scorePct || b.games - a.games || a.family.localeCompare(b.family));

    if (shown.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'section-desc';
      empty.textContent = 'No openings on this side.';
      list.appendChild(empty);
      return;
    }

    shown.forEach((stat, i) => {
      const card = openingCard(stat, prepare);
      if (i >= REPORT_PICKS) card.hidden = true;
      list.appendChild(card);
    });

    if (shown.length > REPORT_PICKS) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'btn-secondary scout-show-all';
      more.textContent = `Show all ${shown.length}`;
      more.addEventListener('click', () => {
        for (const c of Array.from(list.children) as HTMLElement[]) c.hidden = false;
        more.remove();
      });
      list.appendChild(more);
    }
  }

  rebuildList();
  return section;
}

// A small two-button Weakest/Strongest segment, styled like the colour segment.
function buildRankSeg(current: ReportRank, onPick: (r: ReportRank) => void): HTMLElement {
  const seg = document.createElement('div');
  seg.className = 'dfilter-seg';
  const opts: { key: ReportRank; label: string }[] = [
    { key: 'weakest', label: 'Weakest' },
    { key: 'strongest', label: 'Strongest' },
  ];
  for (const o of opts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `dfilter-btn${current === o.key ? ' active' : ''}`;
    btn.textContent = o.label;
    btn.addEventListener('click', () => {
      seg.querySelectorAll('.dfilter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onPick(o.key);
    });
    seg.appendChild(btn);
  }
  return seg;
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
      // Face the board from MY answering side (the opposite of their colour),
      // with their avatar/name on top and "You" below.
      orientation: colour === 'white' ? 'black' : 'white',
      players: { opponent: { name: opp.name, avatarUrl: opp.avatarUrl } },
      games: opp.games,
      title: `${opp.name} — board browser`,
      action: { label: 'Prepare a reply', onAct: ({ ucis }) => prepare(ucis, colour) },
      colourToggle: { current: colour, enabled, onPick: openBrowser },
    });
  };
  entries.appendChild(mapEntryBtn(Icons.compass(24), 'Board browser',
    `Walk ${opp.name}’s games on a board`, () => openBrowser(start), 'primary'));

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
        // Preview the position from MY answering side, with their avatar/name.
        perspective: {
          you: colour === 'white' ? 'black' : 'white',
          opponent: { name: opp.name, avatarUrl: opp.avatarUrl },
        },
        colourToggle: { current: colour, enabled, onPick: openTree },
      },
    );
  };
  entries.appendChild(mapEntryBtn(Icons.search(24), 'Their games tree',
    `${opp.gamesAnalysed} game${opp.gamesAnalysed === 1 ? '' : 's'}`, () => openTree(start), 'discrete'));

  return section;
}

// Sort order for an opening list. Mirrors saved lines' sort menu, but over the
// stats we have here: most-played by default, then by their score, then name.
const OPENING_ORDERS: { key: string; label: string }[] = [
  { key: 'played', label: 'Most played' },
  { key: 'weakest', label: 'Weakest' },
  { key: 'strongest', label: 'Strongest' },
  { key: 'name', label: 'Name' },
];

function sortStats(stats: OpeningStat[], mode: string): OpeningStat[] {
  const copy = [...stats];
  switch (mode) {
    case 'weakest':
      return copy.sort((a, b) => a.scorePct - b.scorePct || b.games - a.games);
    case 'strongest':
      return copy.sort((a, b) => b.scorePct - a.scorePct || b.games - a.games);
    case 'name':
      return copy.sort((a, b) => a.family.localeCompare(b.family));
    case 'played':
    default:
      return copy.sort((a, b) => b.games - a.games);
  }
}

// Their most-played openings — both colours in one list, filtered by an
// All / White / Black segment and a sort menu (the shared filter bar, mirroring
// My Lines). Top-N per filter, with a "Show all" reveal.
function openingsSection(stats: OpeningStat[], prepare: PrepareFn): HTMLElement {
  const section = document.createElement('div');
  section.className = 'section';
  const head = document.createElement('div');
  head.className = 'section-head';
  const h = document.createElement('h2');
  h.className = 'section-title';
  h.textContent = 'Their openings';
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
    empty.textContent = 'No openings yet.';
    section.appendChild(empty);
    return section;
  }

  // Colour segment + sort menu (no tags/status) — the same All/White/Black
  // segment and sort dropdown used by saved lines and the prep list.
  const list = document.createElement('div');
  list.className = 'group';
  const filter = createFilterBar({
    persistKey: OPENINGS_FILTER_KEY,
    sorts: OPENING_ORDERS,
    defaultSort: 'played',
    onChange: () => rebuildList(),
  });
  section.appendChild(filter.element);
  section.appendChild(list);

  function rebuildList(): void {
    list.innerHTML = '';
    const sel = filter.selection;
    const filtered = sel.colour === 'all' ? stats : stats.filter(s => s.colour === sel.colour);
    const shown = sortStats(filtered, sel.sort);

    if (shown.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'section-desc';
      empty.textContent = 'No openings on this side.';
      list.appendChild(empty);
      return;
    }

    shown.forEach((stat, i) => {
      const card = openingCard(stat, prepare);
      if (i >= TOP_OPENINGS) card.hidden = true;
      list.appendChild(card);
    });

    if (shown.length > TOP_OPENINGS) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'btn-secondary scout-show-all';
      more.textContent = `Show all ${shown.length}`;
      more.addEventListener('click', () => {
        for (const c of Array.from(list.children) as HTMLElement[]) c.hidden = false;
        more.remove();
      });
      list.appendChild(more);
    }
  }

  rebuildList();
  return section;
}

function openingCard(stat: OpeningStat, prepare: PrepareFn): HTMLElement {
  // The shared position-card scaffold, so each opening shows a miniature of its
  // representative line (gated by the global "show line miniatures" toggle) and
  // reads like the rest of the app's cards.
  const { card, titleRow, content } = buildPositionCard({
    fen: stat.repUcis.length > 0 ? fenFromUcis(stat.repUcis) : null,
    orientation: stat.colour,
    className: 'opening-card',
  });

  // Title row: colour pip + opening family name.
  titleRow.appendChild(colourPip(stat.colour));
  const nameEl = document.createElement('span');
  nameEl.className = 'pcard-name';
  nameEl.textContent = stat.family;
  titleRow.appendChild(nameEl);

  // Played-count chip.
  const metaRow = document.createElement('div');
  metaRow.className = 'line-card-meta';
  const gamesChip = document.createElement('span');
  gamesChip.className = 'review-stat-chip';
  gamesChip.textContent = `Played ${stat.games}×`;
  metaRow.appendChild(gamesChip);
  content.appendChild(metaRow);

  // Their result on this opening, as a slim bar: score% left, the W-D-L split as
  // segments, the bare counts in small text on the right. The perspective is
  // already captioned once up in the scouting report, so no caption repeats here.
  content.appendChild(wdlScoreRow({
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
    content.appendChild(lineEl);
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
  content.appendChild(prepareBtn);

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
