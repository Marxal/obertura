import { Chess, type Square } from 'chess.js';
import { registerBrushes } from './board-brushes';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';
import { addMove, goTo, mainline, pathTo, getCurrentNode, reset, isEmpty, serialise, loadTree, removeLastMove, truncateAfterCurrent, setTreeMode, rootNode } from './tree';
import type { Annotation, MoveNode } from './tree';
import { saveLine, getAllLines, getAllGames, getGame, saveGames, deleteLine, deleteGame } from './storage';
import type { ImportedGame } from './import-games';
import { nameForPath } from './openings';
import type { Line } from './types';
import { renderLinesScreen, focusSavedLine } from './lines-screen';
import { renderProgressScreen } from './progress-screen';
import { startPretrainingRun, enrolLineDirectly } from './pretraining';
import { renderTrainScreen, startLineSession, startPositionsSession } from './train-screen';
import { renderExploreScreen } from './explore-screen';
import { renderPuzzlesScreen, startDailyPuzzles } from './puzzles-screen';
import { renderMistakesScreen } from './mistakes-screen';
import { renderEndgameScreen, startDailyEndgamePuzzles } from './endgame-screen';
import {
  renderDailyChallenge,
  pickDailyLines,
  getDaily,
  getDailyConfig,
  activeDailyTasks,
  nextDailyTask,
  markLinesDone,
  markPuzzlesDone,
  markPositionsDone,
  markEndgamesDone,
  markMistakesDone,
  type DailyTaskId,
} from './daily-challenge';
import { collectSpots, pickSpots, type SpotRef } from './mistake-scan';
import { startMistakeSession, type OpenGameCtx } from './mistake-run';
import type { AnalyseRequest as PuzzleAnalyseRequest } from './puzzle-run';
import { renderMyGamesScreen, formatGameDate } from './my-games-screen';
import { opponentTag } from './scout';
import { renderSettingsScreen } from './settings-screen';
import { Engine, setCloudAuthToken, retryCloudNow, type EvalResult, type CloudTopMove } from './engine';
import { EvalPanel } from './eval-panel';
import { createBuilderPanels, type BuilderPanels } from './builder-panels';
import { initTheme } from './theme';
import { initAppearance } from './appearance';
import { initDriveAutoBackup } from './drive-backup';
import { watchSpeedMs, getConfirmRunBeforeTraining, getShowEngineArrows, setShowEngineArrows, getShowMoveClassifications, getEngineAlwaysOn } from './prefs';
import { reviewLine, gradeNode, type ReviewSummary } from './review';
import { renderLineAnalysis, hasReview } from './line-analysis';
import { applyBrilliantTag } from './brilliant';
import { createPawnProgress, type PawnProgress } from './import-progress';
import { askPromotion } from './promotion';
import { initBackNav, setViewBack, pushBack } from './back-nav';
import { showDialog } from './dialog';
import { platformLabel } from './board-explorer';
import { openImportPanel, getGamesSource, IDENTITY_CHANGED_EVENT } from './import-panel';
import { maybeShowIntro } from './onboarding';
import { openStarterPackPicker, type LineSeed } from './onboarding-starter';
import { showOnboardingWizard, wizardStepPending } from './onboarding-wizard';
import { maybeAutoRefreshGames } from './auto-refresh';
import { maybeShowGate } from './gate';
import { showToast } from './toast';
import { Icons, classBoardSvg, CLASS_LABEL } from './icons';
import { mountFab, type FabItem, type FabController } from './fab';
import { importLastGame, hasConnectedAccount, connectedAccount } from './import-last';
import { openBuilderImport } from './builder-import';
import { openEngineSpar, openExploreOpponent, importOpponentFlow } from './explore-screen';
import { formatMove } from './notation';
import { maybeShowSurveyBanner } from './survey';
import { tryCallback as lichessTryCallback, takeReturn as lichessTakeReturn, getAccessToken as lichessAccessToken, connect as lichessConnect } from './lichess-auth';

// Cloud-eval (engine.ts) uses the Lichess token when connected for higher rate
// limits. Wire the getter once, here, so engine.ts needn't import the OAuth code.
setCloudAuthToken(() => lichessAccessToken());

const chess = new Chess();
let cg!: ReturnType<typeof Chessground>;
let engine!: Engine;
let evalPanel!: EvalPanel;
let builderPanels: BuilderPanels | null = null;
let showEngineArrows = getShowEngineArrows();
// The dock's engine toggle (the chip icon in the builder/analyser bottom bar).
// When on, the engine runs, the docked eval bar shows above the bottom bar with
// the top-3 candidate moves, its arrows are drawn on the board, and the played
// moves get their game-review marks. Always starts OFF on a fresh load (the
// engine keeps the worker + battery busy, so it's a deliberate opt-in each
// session); within a session the state is kept in this module var, so leaving
// the builder and coming back preserves it.
let engineOn = false;
let lastEngineResult: EvalResult | null = null;

function legalDests(): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const m of chess.moves({ verbose: true })) {
    const from = m.from as Key;
    if (!dests.has(from)) dests.set(from, []);
    dests.get(from)!.push(m.to as Key);
  }
  return dests;
}

function turnColor(): 'white' | 'black' {
  return chess.turn() === 'w' ? 'white' : 'black';
}

// ── Opening name + line title ──────────────────────────────────────────────
// Names come from the bundled database (openings.ts) — instant and offline, no
// API and no token. The shown title is the user's manual name if they renamed
// this line, otherwise the auto-detected opening name. `detectedName` always
// tracks the database name so a Save can auto-fill the title.

// The auto-detected opening name for the current cursor position ('' if none).
let detectedName = '';
// The user's manual title for this line, or null when auto-naming applies.
let manualTitle: string | null = null;

// FENs of every position along the path to the current node, in order.
function currentPathFens(): string[] {
  return pathTo(getCurrentNode().id).map(n => n.fen);
}
// The SAN / UCI move lists from the start to the current cursor — the inputs the
// carousel's Library and Games slides need to list continuations from here.
function currentPathSans(): string[] {
  return pathTo(getCurrentNode().id).map(n => n.san);
}
function currentPathUcis(): string[] {
  return pathTo(getCurrentNode().id).map(n => n.uci);
}

// The deepest known opening name for the WHOLE line (independent of the cursor),
// used to auto-fill the title on Save.
function detectedNameForLine(): string {
  return nameForPath(mainline().map(n => n.fen)) ?? '';
}

// The title currently in effect: the manual name if set, else the detected one.
function currentTitle(): string {
  return (manualTitle ?? detectedName).trim();
}

// Paint the title row: the live opening name (or the manual override) plus the
// rename control. The rename input, when open, is left alone.
function renderTitle(): void {
  const el = document.getElementById('opening-name')!;
  const pip = document.getElementById('title-pip');
  if (pip) pip.className = `colour-pip colour-pip--${saveColour}`;
  // A fresh line with no moves yet: prompt the first move rather than show
  // an empty "Unnamed line".
  if (isEmpty()) {
    el.textContent = 'Play the first move';
    el.classList.add('opening-name--empty');
    return;
  }
  const title = currentTitle();
  el.textContent = title || 'Unnamed line';
  el.classList.toggle('opening-name--empty', !title);
  // The builder's header mirrors the line name, so keep it live as the opening
  // is detected / renamed while building.
  if (currentView === 'builder') updateHeaderTitle();
}

// Recompute the detected name for the cursor position and repaint the title.
// Every position change runs through here, so it's also where the carousel's
// Library/Games slides are refreshed for the new position.
function updateOpeningName(): void {
  detectedName = nameForPath(currentPathFens()) ?? '';
  renderTitle();
  builderPanels?.render();
}

// ── Tags ────────────────────────────────────────────────────────────────────
// A small fixed set of toggleable suggestion chips, plus any freeform tags the
// user types. The working set lives here and is edited in the edit lightbox
// (opened from the pencil in the title row), then saved with the line.
const SUGGESTED_TAGS = ['aggressive', 'solid', 'gambit', 'sideline', 'main line'] as const;

// The tags currently applied to the line being built/edited.
let currentTags: string[] = [];

// Paint the read-only tag chips shown under the title (hidden when none).
function renderBuilderTags(): void {
  const el = document.getElementById('builder-tags')!;
  el.replaceChildren();
  if (currentTags.length === 0) {
    el.hidden = true;
    refreshSaveButtonState();
    return;
  }
  el.hidden = false;
  for (const t of currentTags) {
    const chip = document.createElement('span');
    chip.className = 'builder-tag';
    chip.textContent = t;
    el.appendChild(chip);
  }
  // Tag edits change what Save would write — re-derive its enabled state.
  refreshSaveButtonState();
}

// A transient one-line hint shown under the title/actions — used when the builder
// is seeded from a trap, to carry the trap's bait/idea across (the card itself
// stays uncluttered). Display-only: it isn't part of the saved Line, and it's
// cleared whenever a fresh line starts (clearBuilder).
let builderDesc = '';

function renderBuilderDesc(): void {
  const el = document.getElementById('builder-desc')!;
  el.replaceChildren();
  const text = builderDesc.trim();
  // In the analyser, "vs <opponent>" gains the opponent's rating (if known) and
  // the game date: "vs Magnus (2830) · 5 Jan 2026".
  const head = text && builderGameRating ? `${text} (${builderGameRating})` : text;
  const meta = [head, builderGameDate].filter(Boolean).join(' · ');
  if (meta) {
    const span = document.createElement('span');
    span.className = 'builder-desc-meta';
    span.textContent = meta;
    el.appendChild(span);
  }
  // A link back to the original game on its platform (chess.com / lichess).
  if (builderGameUrl) {
    const a = document.createElement('a');
    a.className = 'builder-desc-link';
    a.href = builderGameUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = `View on ${platformLabel(builderGameUrl)} ↗`;
    el.appendChild(a);
  }
  el.hidden = !meta && !builderGameUrl;
}

// The edit lightbox — now focused: the pencil opens it on the NAME only, the tag
// icon on the TAGS only, so the two concerns are separate in the title row.
function openEditSheet(focus: 'name' | 'tags' = 'name'): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet';

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = focus === 'tags' ? 'Tags' : 'Rename line';
  sheet.appendChild(title);

  // Name (pencil).
  let nameInput: HTMLInputElement | null = null;
  if (focus === 'name') {
    const nameLabel = document.createElement('label');
    nameLabel.className = 'edit-label';
    nameLabel.textContent = 'Name';
    nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'edit-input';
    nameInput.value = currentTitle();
    nameInput.placeholder = 'Line name';
    sheet.appendChild(nameLabel);
    sheet.appendChild(nameInput);
  }

  // Tags (tag icon): suggested chips + your existing tags + freeform field.
  let chipRow: HTMLElement | null = null;
  let freeInput: HTMLInputElement | null = null;
  // The existing-tags row, once loaded — Done reads its toggled chips too.
  let ownRows: HTMLElement | null = null;
  if (focus === 'tags') {
    const tagsLabel = document.createElement('label');
    tagsLabel.className = 'edit-label';
    tagsLabel.textContent = 'Tags';
    sheet.appendChild(tagsLabel);

    chipRow = document.createElement('div');
    chipRow.className = 'edit-chips';
    const addChip = (tag: string): void => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip';
      chip.textContent = tag;
      if (currentTags.includes(tag)) chip.classList.add('tag-chip--on');
      chip.addEventListener('click', () => chip.classList.toggle('tag-chip--on'));
      chipRow!.appendChild(chip);
    };
    for (const tag of SUGGESTED_TAGS) addChip(tag);
    sheet.appendChild(chipRow);

    // Every tag you've already created — on any line OR any game — as tappable
    // chips, so reusing a tag is a tap, not retyping it (and no near-duplicate
    // spellings). Loaded async; the row only appears when there's something to
    // show.
    const ownRow = document.createElement('div');
    ownRow.className = 'edit-chips edit-chips--own';
    ownRow.hidden = true;
    sheet.appendChild(ownRow);
    void Promise.all([getAllLines(), getAllGames()]).then(([lines, games]) => {
      const known = new Set<string>(SUGGESTED_TAGS);
      const own: string[] = [];
      for (const l of lines) {
        for (const t of l.tags) {
          if (!known.has(t)) { known.add(t); own.push(t); }
        }
      }
      for (const g of games) {
        for (const t of g.tags ?? []) {
          if (!known.has(t)) { known.add(t); own.push(t); }
        }
      }
      // Tags on THIS line that aren't stored anywhere yet still belong here —
      // they'd otherwise only live in the freeform field.
      for (const t of currentTags) {
        if (!known.has(t)) { known.add(t); own.push(t); }
      }
      if (own.length === 0) return;
      own.sort((a, b) => a.localeCompare(b));
      const ownLabel = document.createElement('div');
      ownLabel.className = 'edit-chips-label';
      ownLabel.textContent = 'Your tags';
      ownRow.appendChild(ownLabel);
      for (const t of own) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tag-chip';
        chip.textContent = t;
        if (currentTags.includes(t)) chip.classList.add('tag-chip--on');
        chip.addEventListener('click', () => chip.classList.toggle('tag-chip--on'));
        ownRow.appendChild(chip);
      }
      ownRow.hidden = false;
      ownRows = ownRow;
    });

    freeInput = document.createElement('input');
    freeInput.type = 'text';
    freeInput.className = 'edit-input';
    freeInput.placeholder = 'or type a new tag (comma separated)';
    sheet.appendChild(freeInput);
  }

  const btnRow = document.createElement('div');
  btnRow.className = 'edit-btn-row';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn-primary edit-save-btn';
  saveBtn.textContent = 'Done';
  saveBtn.addEventListener('click', () => {
    if (chipRow && freeInput) {
      const selected = [...chipRow.querySelectorAll('.tag-chip--on')].map(
        c => (c as HTMLElement).textContent!.trim()
      );
      // If the existing-tags row hasn't loaded yet, keep the line's own custom
      // tags as-is rather than silently dropping them.
      const own = ownRows
        ? [...ownRows.querySelectorAll('.tag-chip--on')].map(c => (c as HTMLElement).textContent!.trim())
        : currentTags.filter(t => !SUGGESTED_TAGS.includes(t as typeof SUGGESTED_TAGS[number]));
      const custom = freeInput.value.split(',').map(t => t.trim()).filter(Boolean);
      currentTags = [...new Set([...selected, ...own, ...custom])];
      renderBuilderTags();
    }
    if (nameInput) {
      const val = nameInput.value.trim();
      manualTitle = val ? val : null;
      renderTitle();
    }
    close();
  });
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', close);
  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);
  sheet.appendChild(btnRow);

  // The on-screen keyboard shrinks the visual viewport from the bottom, which
  // would otherwise hide the bottom-anchored sheet's Done button behind it.
  // Lift the overlay's content by the keyboard's height so the buttons stay
  // visible and reachable. Updates live as the keyboard opens/closes.
  const vv = window.visualViewport;
  function syncKeyboardInset() {
    if (!vv) return;
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    overlay.style.paddingBottom = `${inset}px`;
  }
  vv?.addEventListener('resize', syncKeyboardInset);
  vv?.addEventListener('scroll', syncKeyboardInset);

  function close() {
    vv?.removeEventListener('resize', syncKeyboardInset);
    vv?.removeEventListener('scroll', syncKeyboardInset);
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });
  nameInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
  });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    (nameInput ?? freeInput)?.focus();
    syncKeyboardInset();
  });
}

function setupTitleControls(): void {
  document.getElementById('rename-btn')!.addEventListener('click', () => openEditSheet('name'));
  document.getElementById('tags-btn')!.addEventListener('click', () => openEditSheet('tags'));
}

// One clickable move in the strip: the SAN, its annotation chip (if marked)
// and a note dot (if annotated in words too).
function moveSpan(node: MoveNode, activeId: string): HTMLElement {
  const span = document.createElement('span');
  span.className = `move-san${node.id === activeId ? ' active' : ''}`;
  span.addEventListener('click', () => handleMoveClick(node.id));
  span.textContent = formatMove(node.san);
  // Game-review / live-analysis grade in the notation: just the class colour
  // tint (no badge glyph — icons in the strip made the moves read too far
  // apart; the badge still shows on the board square and in the summary table).
  // The error moves keep a stronger wash so mistakes still stand out. Shown when
  // the Settings toggle is on, or whenever the engine is on (it's analysing anyway).
  if (node.classification && (getShowMoveClassifications() || engineOn)) {
    span.classList.add(`class--${node.classification}`);
    span.title = CLASS_LABEL[node.classification];
  }
  if (node.annotation) {
    const chip = document.createElement('span');
    chip.className = `ann-chip ann-${annClass(node.annotation)}`;
    chip.textContent = node.annotation;
    span.appendChild(chip);
  }
  if (node.note) {
    const dot = document.createElement('span');
    dot.className = 'move-note-dot';
    dot.setAttribute('aria-hidden', 'true');
    span.appendChild(dot);
  }
  return span;
}

// The move list is mirrored under several carousel slides — the Line tab plus
// the Library / My-lines panels. One render fills them all, so game-review
// colours show wherever you are without leaving the panel.
const MOVE_LIST_MOUNTS = ['move-list', 'move-list-library', 'move-list-games'];

function renderMoveList() {
  for (const id of MOVE_LIST_MOUNTS) {
    const el = document.getElementById(id);
    if (el) renderMoveListInto(el);
  }
  updateMoveNavButtons();
  refreshReviewButtonState();
  refreshSaveButtonState();
  refreshLineAnalysis();
}

// Analyser only: Save game greys out while there's nothing of yours to save —
// the review itself is stored automatically, so Save is for YOUR variations,
// notes and tag edits. Builder mode (repertoire lines) keeps Save always live.
function refreshSaveButtonState(): void {
  const btn = document.getElementById('header-save') as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = builderMode === 'analyser' && !!analyserGameId && !isBuilderDirty();
}

function renderMoveListInto(el: HTMLElement): void {
  const activeId = getCurrentNode().id;
  el.innerHTML = '';
  // Walk the tree from the root: the main line renders inline, and any branch
  // (a node with more than one child) renders its alternatives as parenthesised
  // variations — PGN style. In single-path builder mode there are no branches, so
  // this produces the same flat list as before.
  renderContinuation(el, rootNode(), 1, activeId, true);

  // Keep the active move centred in the horizontally-scrolling strip. We adjust
  // the strip's own scrollLeft (not scrollIntoView) so it never drags an
  // ancestor — that was snapping the carousel back to the Line tab after a move.
  const activeEl = el.querySelector<HTMLElement>('.move-san.active');
  if (activeEl) {
    const elRect = el.getBoundingClientRect();
    const aRect = activeEl.getBoundingClientRect();
    el.scrollLeft += (aRect.left - elRect.left) - (el.clientWidth - aRect.width) / 2;
  } else {
    el.scrollLeft = 0;
  }
}

// Render `parent`'s main continuation (children[0]) into `container`, then any
// sibling variations (children[1..]) as "(…)" blocks, then recurse down the main
// line. `ply` is the 1-based ply of the move being rendered; `forceNumber` makes
// a black move show its number too (line start / right after a variation).
function renderContinuation(
  container: HTMLElement, parent: MoveNode, ply: number, activeId: string, forceNumber: boolean,
): void {
  if (parent.children.length === 0) return;
  const main = parent.children[0];
  emitMove(container, main, ply, forceNumber, activeId);

  let nextForce = false;
  if (parent.children.length > 1) {
    for (let i = 1; i < parent.children.length; i++) {
      const v = parent.children[i];
      const wrap = document.createElement('span');
      wrap.className = 'move-var';
      wrap.appendChild(document.createTextNode('('));
      emitMove(wrap, v, ply, true, activeId);          // variation's first move: numbered
      renderContinuation(wrap, v, ply + 1, activeId, false);
      wrap.appendChild(document.createTextNode(')'));
      container.appendChild(wrap);
    }
    nextForce = true; // the main line resumes after the variations — re-number it
  }
  renderContinuation(container, main, ply + 1, activeId, nextForce);
}

function emitMove(
  container: HTMLElement, node: MoveNode, ply: number, force: boolean, activeId: string,
): void {
  const white = ply % 2 === 1;
  if (white || force) {
    const num = document.createElement('span');
    num.className = 'move-num';
    num.textContent = white ? `${Math.ceil(ply / 2)}.` : `${Math.ceil(ply / 2)}…`;
    container.appendChild(num);
  }
  container.appendChild(moveSpan(node, activeId));
}

// The "Analyse game" button (Game tab, analyser only) has three states: idle
// ("Analyse game"), running ("Analysing…", disabled) and done ("Game analysed",
// disabled — every mainline move already graded). Driven from renderMoveList so
// it tracks every board change: editing/adding a move drops the done state.
function refreshReviewButtonState(): void {
  const btn = document.getElementById('analyse-game-btn') as HTMLButtonElement | null;
  if (!btn) return;
  btn.hidden = builderMode !== 'analyser';
  if (btn.hidden) return;
  const running = !!reviewAbort;
  const nodes = mainline();
  const analysed = nodes.length > 0 && nodes.every(n => n.classification);
  btn.disabled = running || analysed;
  btn.classList.toggle('is-analysing', running);
  btn.classList.toggle('is-analysed', !running && analysed);
  const lbl = btn.querySelector('.analyse-game-label');
  if (lbl) lbl.textContent = running ? 'Analysing…' : analysed ? 'Game analysed' : 'Analyse game';
}

// ── Move navigation (plain step arrows, not engine arrows) ──────────────────
// The cursor's index within the mainline, or -1 when sitting at the root.
// Navigation follows the ACTIVE path (root → cursor), so the arrows work inside
// a variation too: back = the cursor's parent, forward = its main continuation.
function stepBack(): void {
  const cur = getCurrentNode();
  if (cur.id === 'root') return;
  const path = pathTo(cur.id); // excludes root
  if (path.length <= 1) { goToStart(); return; }
  handleMoveClick(path[path.length - 2].id);
}

function stepForward(): void {
  const next = getCurrentNode().children[0];
  if (next) handleMoveClick(next.id);
}

// Grey out the step arrows at the ends of the active path.
function updateMoveNavButtons(): void {
  const cur = getCurrentNode();
  const atStart = cur.id === 'root';
  const atEnd = cur.children.length === 0;
  const set = (id: string, disabled: boolean) => {
    const b = document.getElementById(id) as HTMLButtonElement | null;
    if (b) b.disabled = disabled;
  };
  set('move-prev', atStart);
  set('move-next', atEnd);
}

function setupMoveNav(): void {
  document.getElementById('move-prev')!.addEventListener('click', stepBack);
  document.getElementById('move-next')!.addEventListener('click', stepForward);
}

// The My games tab's import icon: open the "Import a game" popup — last game /
// browse recent / paste PGN / add manually — and load whatever's chosen onto
// the board (or, for a manual add, save it straight to My games and call
// onManualAdd so the still-visible list refreshes).
function openMyGamesImport(onManualAdd?: () => void): void {
  openBuilderImport({
    onLoadGame: (ucis, colour, description, gameId, endTime, notes) =>
      openImportedGame(ucis, colour, description, gameId, endTime, notes),
    onGamesChanged: () => { builderPanels?.reload(); },
    onManualAdd,
    onSaveLines: saveImportedLines,
  });
}

// Save study chapters (or other seeds) straight to My Lines as un-enrolled
// lines. Skips seeds that can't build a legal line; resolves with the count
// actually saved.
async function saveImportedLines(seeds: LineSeed[], colour: 'white' | 'black'): Promise<number> {
  let saved = 0;
  for (const seed of seeds) {
    const line = lineFromUcis(seed, colour);
    if (!line) continue;
    await saveLine(line);
    saved++;
  }
  if (saved > 0) builderPanels?.reloadLines();
  return saved;
}

// Open a SAVED game (from the My games list) in the analyser. If it already has
// a saved analysis, restore it (variations + review intact); otherwise just lay
// its moves down — grading is on demand now, via the Game tab's "Analyse game"
// button (no automatic review). An optional atFen jumps the cursor to that
// position (the mistake drill opens a game AT the drilled spot).
function openGameForAnalysis(
  game: ImportedGame,
  o: { atFen?: string } = {},
): void {
  const tags = game.tags ?? [];
  if (game.analysis?.tree) {
    buildFromTree(game.analysis.tree, game.colour, `vs ${game.opponent}`, tags, game.endTime);
    builderEngine = game.analysis.engine;
    renderMoveList(); // repaint so the restored review's engine tag shows
  } else {
    buildFromUcis(game.ucis, game.colour, tags, { description: `vs ${game.opponent}`, analyser: true, gameDate: game.endTime });
  }
  analyserGameId = game.id; // after build — clearBuilder resets it to null
  // The opponent's rating and the source link for the Game tab's "vs" line.
  builderGameRating = game.opponentRating;
  builderGameUrl = game.url || undefined;
  renderBuilderDesc();
  // The just-loaded game matches what's stored — only *your* variations/notes make
  // it dirty (the auto-review's classifications are stripped from the snapshot), so
  // an untouched game closes without the save prompt.
  savedSnapshot = builderSnapshot();
  refreshSaveButtonState();
  if (o.atFen) {
    const target = mainline().find(n => n.fen === o.atFen);
    if (target) handleMoveClick(target.id);
  }
}

// ── Training-session hand-off to the analyser ────────────────────────────────
// The mistake drill's "Open full analysis" suspends its overlay and routes
// here: open the game at the drilled position (no auto-review — the user taps
// Analyse if they want grades), swap the header's Save button for "Back to
// train" and blank the opponent name from the title, keeping the top bar
// clean. Tapping the button (or the builder's own back arrow, which lands on
// Train) resumes the session exactly where it was; navigating anywhere else
// discards it cleanly so a hidden overlay can never leak.
let suspendedSession: { resume: () => void; discard: () => void } | null = null;
let sessionReturnChip: HTMLElement | null = null;

function clearSuspendedSession(): void {
  sessionReturnChip?.remove();
  sessionReturnChip = null;
  suspendedSession = null;
}

function openGameFromSession(game: ImportedGame, ctx?: OpenGameCtx): void {
  // Set the flag BEFORE the view swap: showView/updateHeaderTitle read it to
  // hide the Save button and keep the title clean.
  if (ctx) suspendedSession = { resume: ctx.onReturn, discard: ctx.onDiscard };
  openGameForAnalysis(game, { atFen: ctx?.atFen });
  showView('builder');
  if (ctx) mountSessionReturnChip();
}

// "Back to train" in the top bar, exactly where Save normally sits (Save is
// hidden while a session is suspended — see showView).
function mountSessionReturnChip(): void {
  sessionReturnChip?.remove();
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'session-return-chip';
  chip.appendChild(Icons.back(14));
  chip.appendChild(document.createTextNode('Back to train'));
  // Landing on Train is what resumes the session (see showView).
  chip.addEventListener('click', () => showView('train'));
  const save = document.getElementById('header-save');
  if (save && save.parentElement) save.parentElement.insertBefore(chip, save);
  else document.body.appendChild(chip);
  sessionReturnChip = chip;
}

// A puzzle's "Analyse position" (puzzle-run) routes here: lay the puzzle's game
// plus its full solution on the analyser board with the engine on (eval bar +
// candidate arrows) at the position the solver faced, and suspend the puzzle
// session behind the "Back to train" chip exactly like the mistake drill's hand-off.
function openPuzzleFromSession(req: PuzzleAnalyseRequest): void {
  suspendedSession = { resume: req.onReturn, discard: req.onDiscard };
  buildFromUcis(req.ucis, req.colour, [], { description: req.label, analyser: true });
  analyserGameId = null; // no backing game record — Save falls back to Save line
  savedSnapshot = builderSnapshot();
  pendingEngineOn = true;
  showView('builder');
  mountSessionReturnChip();
  const target = mainline().find(n => n.fen === req.atFen);
  if (target) handleMoveClick(target.id);
}

// Open a freshly imported/pasted game (no saved analysis yet) in the analyser.
// Grading is on demand — the Game tab's "Analyse game" button. gameId is set when
// the game is in the store (so a later Save can attach the analysis, and so we can
// read its rating/link for the "vs" line); a pasted PGN has none.
function openImportedGame(ucis: string[], colour: 'white' | 'black', description?: string, gameId?: string, endTime?: number, notes?: Record<number, string>): void {
  buildFromUcis(ucis, colour, [], { description, analyser: true, gameDate: endTime, notes });
  analyserGameId = gameId ?? null; // after build — clearBuilder resets it
  // A stored game carries the opponent rating + source link for the "vs" line.
  builderGameRating = undefined;
  builderGameUrl = undefined;
  if (gameId) void getGame(gameId).then(g => {
    if (!g || analyserGameId !== gameId) return; // moved on to another game
    builderGameRating = g.opponentRating;
    builderGameUrl = g.url || undefined;
    renderBuilderDesc();
  }).catch(() => { /* leave the plain "vs" line */ });
  // Baseline the freshly-opened game so only your own edits trigger the save guard.
  savedSnapshot = builderSnapshot();
  refreshSaveButtonState();
}

// ── Game review / live analysis ─────────────────────────────────────────────
// Grading happens two ways now:
//   • "Analyse game" (the Game tab button) runs a one-off pass over the moves
//     already on the board — the analyser's on-demand grade.
//   • Live analysis grades each new move as it's played; it's switched on with
//     the engine (setEngineOn), so exploring a variation with the engine up
//     grades it. It never re-grades a move it already judged.
let reviewAbort: AbortController | null = null;
// Whether live analysis is currently on (grades new moves as they're played).
let liveAnalysis = false;
// A session-long eval cache shared by the initial pass and the per-move live
// grades, so incremental lookups reuse the cloud/engine answers already fetched.
// Cleared in clearBuilder when a fresh line/game loads.
const liveCache = new Map<string, CloudTopMove[] | null>();
// Which engine the last review used, for the Line-tab "analysed with…" tag.
// 'none' = not analysed yet (the tag is hidden).
let builderEngine: ReviewSummary['engine'] = 'none';
// A slim, non-blocking progress bar pinned to the top of the builder dock while
// a review runs (reuses the import scan's pawn bar).
let reviewProgress: PawnProgress | null = null;

function reviewBar(): PawnProgress {
  if (!reviewProgress) {
    reviewProgress = createPawnProgress();
    reviewProgress.el.classList.add('review-progress');
    document.getElementById('builder-dock')?.prepend(reviewProgress.el);
  }
  return reviewProgress;
}

function setupAnalyseGameButton(): void {
  document.getElementById('analyse-game-btn')?.addEventListener('click', () => {
    void analyseGame();
  });
}

function setLiveAnalysis(on: boolean): void {
  liveAnalysis = on;
  refreshReviewButtonState();
}

// Combine the engine an earlier grade used with a later one's, for the Line-tab
// "analysed with…" tag. 'none' means "nothing new", so it never downgrades a tag.
function mergeReviewEngine(
  a: ReviewSummary['engine'],
  b: ReviewSummary['engine'],
): ReviewSummary['engine'] {
  if (b === 'none') return a;
  if (a === 'none') return b;
  return a === b ? a : 'mixed';
}

// The Game tab's "Analyse game" action: grade the moves on the board now. A tap
// while a pass is mid-flight cancels it (the grades so far are kept).
async function analyseGame(): Promise<void> {
  if (reviewAbort) {
    reviewAbort.abort();
    reviewAbort = null;
    refreshReviewButtonState();
    showToast('Analysis paused.');
    return;
  }
  await runReviewPass();
}

// Grade every not-yet-graded move on the board. A fully-graded line (or an empty
// one) returns at once; otherwise it walks the mainline, filling in grades.
async function runReviewPass(): Promise<void> {
  const nodes = mainline();
  if (!nodes.length || nodes.every((n) => n.classification)) {
    renderMoveList();
    refreshBoardShapes();
    return;
  }

  const ctrl = new AbortController();
  reviewAbort = ctrl;
  refreshReviewButtonState();
  const total = nodes.length;
  const bar = reviewBar();
  bar.start();
  showToast(getShowMoveClassifications() || engineOn
    ? 'Analysing game…'
    : 'Analysing game… (turn on move highlights in Settings to see it)');

  try {
    const summary = await reviewLine(nodes, {
      useEngineFallback: true,
      skipGraded: true,
      cache: liveCache,
      signal: ctrl.signal,
      onProgress: (i) => {
        bar.set(total ? (i + 1) / total : 1);
        renderMoveList();
        refreshBoardShapes();
      },
    });
    builderEngine = mergeReviewEngine(builderEngine, summary.engine);
    if (!ctrl.signal.aborted) {
      showToast('Analysis complete.');
      // A finished review stores itself on the game record, so reopening the
      // game restores the grades without a re-run. Save game stays the way to
      // save YOUR variations, notes and tags.
      void autoStoreAnalysis();
    }
  } catch {
    if (!ctrl.signal.aborted) showToast('Couldn’t finish analysing.');
  } finally {
    if (reviewAbort === ctrl) reviewAbort = null;
    bar.done();
    bar.hide();
    refreshReviewButtonState();
    renderMoveList();
    refreshBoardShapes();
    refreshLineAnalysis();
  }
}

// Quietly persist the current review onto the open game's record (analyser
// only). Reads the fresh record first so a concurrent write (the mistake scan)
// keeps its data; the builder's dirty state is untouched — classifications are
// derived, so this never silently "saves" the user's unsaved edits as theirs.
async function autoStoreAnalysis(): Promise<void> {
  if (builderMode !== 'analyser' || !analyserGameId) return;
  try {
    const game = await getGame(analyserGameId);
    if (!game) return;
    game.analysis = { tree: serialise(), engine: builderEngine, reviewedAt: Date.now() };
    // A brilliant move of your own earns the game an automatic "brilliant" tag,
    // so it surfaces in the My games filters (and feeds the Brilliant-moves
    // exercise). Applied to the fresh record, not the builder's tag set.
    applyBrilliantTag(game);
    await saveGames([game]);
  } catch {
    /* storage hiccup — Save game still covers it */
  }
}

// Grade one freshly-played move when live analysis is on. The board move handlers
// call this so a variation you try gets a grade as soon as you play it. Stale or
// ungradable results are silently dropped — a later toggle fills any gaps.
async function gradeLiveMove(node: MoveNode, parentFen: string): Promise<void> {
  if (!liveAnalysis || node.classification) return;
  try {
    // The SAN path from the start (pathTo excludes the root, so the last entry
    // is this move) — book detection is line-shaped, and the previous move
    // feeds the recapture check.
    const path = pathTo(node.id);
    const r = await gradeNode(node, parentFen, liveCache, {
      useEngineFallback: true,
      sanPath: path.map(n => n.san),
      prevUci: path.length > 1 ? path[path.length - 2].uci : undefined,
    });
    if (!r.graded) return;
    builderEngine = mergeReviewEngine(
      builderEngine,
      r.source === 'cloud' ? 'lichess'
        : r.source === 'remote' ? 'remote'
        : r.source === 'local' ? 'local'
        : 'none',
    );
    renderMoveList();
    refreshBoardShapes();
    refreshLineAnalysis();
  } catch { /* leave it ungraded */ }
}

// The Line-tab analysis block (eval graph + move-type summary + engine tag).
// Shown only for an imported/loaded game ("vs <name>") that's been reviewed.
function refreshLineAnalysis(): void {
  const host = document.getElementById('line-analysis');
  if (!host) return;
  const nodes = mainline();
  const isImportedGame = builderDesc.startsWith('vs ');
  if (!isImportedGame || !(getShowMoveClassifications() || engineOn) || !hasReview(nodes)) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  const opponent = builderDesc.slice(3).trim() || 'Opponent';
  const me = connectedAccount()?.username ?? 'You';
  const whiteName = saveColour === 'white' ? me : opponent;
  const blackName = saveColour === 'white' ? opponent : me;
  host.hidden = false;
  renderLineAnalysis(host, nodes, { whiteName, blackName, engine: builderEngine });
}

// ── Builder carousel (the panels below the board) ───────────────────────────
// A paged, swipeable strip — Line / Book / Games / Engine — sharing the one
// builder board. The tab strip above the step arrows mirrors the active slide
// and jumps to one on tap. The board sits ABOVE the carousel and is a fixed
// square, so swiping slides never moves it.

// Carousel slide indices: 0 Line, 1 Library, 2 My games, 3 Learn, 4 Scouting.
// (The engine is no longer a tab — it's the dock's engine icon and its docked
// eval bar.) Scouting must stay LAST: it's the one slide Settings can hide, and
// the scroll-position→index math only tolerates hiding the final slide.
const LIBRARY_SLIDE = 1;
const SCOUTING_SLIDE = 4;
let activeSlide = 0;
// When opening the builder from an external link, the tab to land on (and an
// opponent to preselect on the Scouting tab). Consumed in showView('builder').
let pendingBuilderSlide: number | null = null;
let pendingScoutOpponentId: string | null = null;
// When opening the builder to analyse (e.g. a puzzle's "Analyse position", or
// Train's "Build with engine"), turn the engine on once we've landed.
let pendingEngineOn = false;

// React to the active slide changing (by tap or swipe): repaint the tabs. The
// engine is no longer tied to a tab — it follows the dock's engine toggle
// (engineOn), so switching slides never starts or stops it.
function onActiveSlide(index: number): void {
  document.querySelectorAll<HTMLElement>('#builder-slide-tabs .slide-tab').forEach(tab => {
    const on = Number(tab.dataset.slide) === index;
    tab.classList.toggle('slide-tab--on', on);
    tab.setAttribute('aria-selected', String(on));
    // With five tabs the strip can overflow on narrow phones — keep the active
    // one in view. block:'nearest' stops the page itself from jumping.
    if (on) tab.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  });
  if (index === activeSlide) return;
  activeSlide = index;
  builderPanels?.setActiveSlide(index);
  // Keep the engine (and its docked eval bar) in sync with the persistent toggle
  // — it was stopped when we left the builder, so re-arm it on the way back in.
  if (evalPanel) evalPanel.setEnabled(engineOn);
  // Repaint the board overlays for the new slide (the active move's grade badge,
  // plus the engine arrows when the engine is on).
  if (cg) refreshBoardShapes();
}

// Repaint the analyser's board overlays in ONE pass: the active move's
// game-review badge AND, while the engine is on, its top-3 candidate arrows.
// Both live in chessground's single autoshapes list, so they must be drawn
// together — doing them in separate setAutoShapes calls made the last one wipe
// the other. The badge disc rides ABOVE the piece (a customSvg autoshape); its
// square wash sits BELOW the piece (a custom highlight) so the piece keeps its
// own colour.
function refreshBoardShapes(): void {
  if (!cg) return;
  const shapes: DrawShape[] = [];

  // 1. The active move's grade badge — shown whenever the Settings toggle is on
  //    or the engine is on (it's analysing anyway), so a played move's grade is
  //    visible on any slide.
  const node = getCurrentNode();
  const showBadge = (getShowMoveClassifications() || engineOn)
    && node.id !== 'root' && !!node.classification && !!node.uci;
  const fromSq = showBadge ? (node.uci.slice(0, 2) as Key) : null;
  const toSq = showBadge ? (node.uci.slice(2, 4) as Key) : null;
  if (toSq) shapes.push({ orig: toSq, customSvg: classBoardSvg(node.classification!) });

  // 2. The engine's candidate arrows. Shown when the engine is on, its arrows
  //    toggle is on, and its result still matches the live position (engine
  //    replies can lag a move behind).
  const result = lastEngineResult;
  const wantEngineArrows = engineOn && showEngineArrows;
  if (wantEngineArrows && engine && engine.isEnabled
      && result && result.fen === chess.fen()) {
    const brushes = ['eng1', 'eng2', 'eng3'];
    result.moves.slice(0, 3).forEach((m, i) => {
      shapes.push({ orig: m.uci.slice(0, 2) as Key, dest: m.uci.slice(2, 4) as Key, brush: brushes[i] });
    });
  }

  cg.setAutoShapes(shapes);
  setReviewSquares(fromSq, toSq, showBadge ? node.classification! : undefined);
}

// Reflect the engine toggle's state on the dock's engine icon (highlighted +
// aria-pressed when on).
function updateEngineDockBtn(): void {
  const btn = document.getElementById('builder-engine');
  if (!btn) return;
  btn.classList.toggle('bar-btn--on', engineOn);
  btn.setAttribute('aria-pressed', String(engineOn));
}

// Turn the engine on/off from the dock's engine icon. On: reveal the docked eval
// bar (top-3 moves + arrows) with its entrance animation, and switch on live
// analysis so the moves you play get their game-review marks (the engine is
// analysing anyway). It does NOT bulk-analyse an existing game — that stays the
// Game tab's "Analyse game" button. Off: hide the eval bar and stop live grading
// (the grades we have are kept). Persisted, so it survives leaving/reloading.
function setEngineOn(on: boolean): void {
  engineOn = on;
  updateEngineDockBtn();
  evalPanel.setEnabled(on);            // fires the eval panel's onToggle (engine + eval bar)
  if (on) {
    engine.evaluate(chess.fen());
    setLiveAnalysis(true);             // grade moves you play from here (no bulk review)
  } else if (liveAnalysis) {
    if (reviewAbort) { reviewAbort.abort(); reviewAbort = null; }
    setLiveAnalysis(false);
  }
  refreshBoardShapes();
}

// Paint (or clear) the review wash on BOTH squares of the graded move — its from
// and to squares — via chessground's custom square highlights, which style the
// <square> element underneath the pieces so the piece keeps its own colour.
function setReviewSquares(from: Key | null, to: Key | null, cls?: string): void {
  const custom = new Map<Key, string>();
  if (cls) {
    if (from) custom.set(from, `review-sq review-sq--${cls}`);
    if (to) custom.set(to, `review-sq review-sq--${cls}`);
  }
  cg.set({ highlight: { custom } });
}

// ── Builder sheet (draggable Google-Maps-style panel) ───────────────────────
// The sheet overlays the lower part of the board and snaps between two states:
//   • default — sits just under the board, which is fully visible.
//   • full    — pulled up over the board, leaving ~15% of it peeking at the top.
// Its HEIGHT (bottom-anchored at the control bar) is what changes; the board
// stays put behind it and the sheet's content scrolls inside. The handle drags
// or taps between states; an overscroll on the content nudges it too; and a tap
// on the peeking board drops back to default.
type SheetState = 'default' | 'full';
let sheetState: SheetState = 'default';

// How much of the board stays visible at the top in the FULL state.
const SHEET_PEEK = 0.15;

function sheetMetrics(dockHOverride?: number): { barH: number; defaultH: number; fullH: number } {
  const board = document.getElementById('board-wrap');
  const dock = document.getElementById('builder-dock');
  // The eval dock animates its own height (animateEvalDock); during that beat the
  // caller passes the FINAL height so the sheet lands where the dock is heading,
  // not on the intermediate frame.
  const barH = dockHOverride ?? dock?.offsetHeight ?? 56;
  const rect = board?.getBoundingClientRect();
  const boardTop = rect?.top ?? 0;
  const boardH = rect?.height ?? 0;
  const barTop = window.innerHeight - barH;
  const fullTop = boardTop + boardH * SHEET_PEEK;       // ~15% of the board peeks
  const defaultTop = boardTop + boardH;                 // board fully shown
  return {
    barH,
    defaultH: Math.max(96, barTop - defaultTop),
    fullH: Math.max(96, barTop - fullTop),
  };
}

// Position the sheet for the given height (bottom-anchored above the bar).
function applySheetHeight(h: number, dockH?: number): void {
  const sheet = document.getElementById('builder-sheet');
  if (!sheet) return;
  sheet.style.bottom = `${dockH ?? sheetMetrics().barH}px`;
  sheet.style.height = `${h}px`;
}

function layoutBuilderSheet(dockH?: number): void {
  if (currentView !== 'builder') return;
  const m = sheetMetrics(dockH);
  applySheetHeight(sheetState === 'full' ? m.fullH : m.defaultH, dockH);
}

// Slide the docked eval bar open/closed by animating its OWN height, and hand the
// sheet above it its final layout in the same beat (the sheet's CSS bottom+height
// transition then animates it in step). Measuring the eval's natural box height
// with transitions suppressed lets us compute the dock's final height up front —
// so the whole dock grows/shrinks smoothly instead of the old instant reveal that
// shoved the bar (and everything above it) up. The eval's content has just been
// cleared by the time we close, so the open height is remembered for that case.
let lastEvalOpenH = 0;
let evalDockSettle: (() => void) | null = null;
function animateEvalDock(open: boolean): void {
  const evalEl = document.getElementById('builder-eval');
  const dockEl = document.getElementById('builder-dock');
  if (!evalEl || !dockEl) { layoutBuilderSheet(); cg?.redrawAll(); return; }

  evalDockSettle?.(); // settle any in-flight toggle before starting a new one

  evalEl.hidden = false;
  evalEl.style.transition = 'none';

  const openH = open
    ? (evalEl.style.height = 'auto', lastEvalOpenH = evalEl.offsetHeight)
    : (lastEvalOpenH || evalEl.offsetHeight);

  // Dock height at the END state → the sheet's final position, set now.
  evalEl.style.height = open ? `${openH}px` : '0px';
  const finalDockH = dockEl.offsetHeight;
  // Commit the START state (the opposite), then restore the CSS transition.
  evalEl.style.height = open ? '0px' : `${openH}px`;
  void evalEl.offsetHeight;
  evalEl.style.transition = '';

  layoutBuilderSheet(finalDockH);
  cg.redrawAll();

  requestAnimationFrame(() => { evalEl.style.height = open ? `${openH}px` : '0px'; });

  const settle = (): void => {
    clearTimeout(timer);
    evalEl.removeEventListener('transitionend', onEnd);
    evalDockSettle = null;
    if (open) {
      evalEl.style.height = 'auto'; // let a longer principal variation reflow freely
    } else {
      evalEl.hidden = true;
      evalEl.style.height = '';
    }
    layoutBuilderSheet();
    cg.redrawAll();
  };
  const onEnd = (e: TransitionEvent): void => {
    if (e.target === evalEl && e.propertyName === 'height') settle();
  };
  // A fallback in case transitionend never fires (e.g. a zero-height change).
  const timer = window.setTimeout(settle, 400);
  evalEl.addEventListener('transitionend', onEnd);
  evalDockSettle = settle;
}

function setSheetState(state: SheetState, animate = true): void {
  sheetState = state;
  const sheet = document.getElementById('builder-sheet');
  const handle = document.getElementById('builder-panel-handle');
  if (!animate) sheet?.classList.add('builder-sheet--dragging');
  handle?.classList.toggle('expanded', state === 'full');
  handle?.setAttribute('aria-expanded', String(state === 'full'));
  handle?.setAttribute('aria-label', state === 'full' ? 'Collapse panel' : 'Expand panel');
  layoutBuilderSheet();
  // Re-enable the height transition after this frame so the next snap animates.
  if (!animate) requestAnimationFrame(() => sheet?.classList.remove('builder-sheet--dragging'));
}

// Snap to whichever state the live height landed nearer.
function snapSheet(metrics: { defaultH: number; fullH: number }): void {
  const sheet = document.getElementById('builder-sheet');
  const h = sheet?.offsetHeight ?? metrics.defaultH;
  const mid = (metrics.defaultH + metrics.fullH) / 2;
  setSheetState(h >= mid ? 'full' : 'default');
}

// Wire the handle (drag/tap), an overscroll on the slide content, and a tap on
// the peeking board to drop back to default.
function setupBuilderPanelHandle(): void {
  const sheet = document.getElementById('builder-sheet');
  const handle = document.getElementById('builder-panel-handle');
  if (!sheet || !handle) return;
  const TAP_SLOP = 6; // movement under this counts as a tap, not a drag

  // Handle drag / tap.
  let dragging = false, startY = 0, startH = 0, moved = 0, m = sheetMetrics();
  handle.addEventListener('pointerdown', e => {
    dragging = true; startY = e.clientY; moved = 0;
    m = sheetMetrics(); startH = sheet.offsetHeight;
    sheet.classList.add('builder-sheet--dragging');
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    moved = startY - e.clientY; // up positive
    applySheetHeight(Math.max(m.defaultH, Math.min(m.fullH, startH + moved)));
  });
  const endHandle = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try { handle.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    sheet.classList.remove('builder-sheet--dragging');
    if (Math.abs(moved) <= TAP_SLOP) setSheetState(sheetState === 'full' ? 'default' : 'full');
    else snapSheet(m);
  };
  handle.addEventListener('pointerup', endHandle);
  handle.addEventListener('pointercancel', endHandle);

  // Content scroll vs. sheet expand. The panel content scrolls independently —
  // a swipe just browses the list without moving the sheet. The sheet only grows
  // when you've run out of list and keep pulling: reaching the BOTTOM and still
  // dragging up expands it; in full, sitting at the TOP and pulling down collapses
  // it. Touch only, so the conditional preventDefault never fights a desktop wheel.
  const track = document.getElementById('builder-carousel');
  if (track) {
    let sY = 0, sX = 0, baseH = 0, baseDy = 0, intercept = false, tm = sheetMetrics();
    const activeEl = () => track.children[activeSlide] as HTMLElement | undefined;
    track.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      sY = e.touches[0].clientY; sX = e.touches[0].clientX;
      tm = sheetMetrics(); intercept = false;
    }, { passive: true });
    track.addEventListener('touchmove', e => {
      if (e.touches.length !== 1) return;
      const dy = sY - e.touches[0].clientY; // up positive
      const dx = sX - e.touches[0].clientX;
      if (!intercept) {
        if (Math.abs(dy) < 8 || Math.abs(dy) <= Math.abs(dx)) return; // not a clear vertical drag
        const el = activeEl();
        const top = el?.scrollTop ?? 0;
        const atTop = top <= 0;
        const atBottom = el ? top + el.clientHeight >= el.scrollHeight - 1 : true;
        // Default: only expand once the list is fully scrolled and you keep going.
        const wantsExpand = sheetState === 'default' && dy > 0 && atBottom;
        // Full: only collapse from the very top of the list, pulling down.
        const wantsCollapse = sheetState === 'full' && dy < 0 && atTop;
        if (!wantsExpand && !wantsCollapse) return;
        intercept = true;
        // Rebase from here so the sheet doesn't jump by however far we scrolled
        // the content first.
        baseDy = dy; baseH = sheet.offsetHeight;
        sheet.classList.add('builder-sheet--dragging');
      }
      e.preventDefault();
      applySheetHeight(Math.max(tm.defaultH, Math.min(tm.fullH, baseH + (dy - baseDy))));
    }, { passive: false });
    const endTouch = () => {
      if (!intercept) return;
      intercept = false;
      sheet.classList.remove('builder-sheet--dragging');
      snapSheet(tm);
    };
    track.addEventListener('touchend', endTouch);
    track.addEventListener('touchcancel', endTouch);
  }

  // The tab strip is also a drag surface for the sheet: a clear vertical swipe up
  // expands it, down collapses it — while horizontal swipes (scrolling the tabs)
  // and taps (switching tabs) pass through untouched.
  const tabs = document.getElementById('builder-slide-tabs');
  if (tabs) {
    let tY = 0, tX = 0, tBaseH = 0, tDrag = false, tmt = sheetMetrics();
    tabs.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      tY = e.touches[0].clientY; tX = e.touches[0].clientX;
      tmt = sheetMetrics(); tDrag = false;
    }, { passive: true });
    tabs.addEventListener('touchmove', e => {
      if (e.touches.length !== 1) return;
      const dy = tY - e.touches[0].clientY; // up positive
      const dx = tX - e.touches[0].clientX;
      if (!tDrag) {
        if (Math.abs(dy) < 8 || Math.abs(dy) <= Math.abs(dx)) return; // let taps / horizontal scroll be
        tDrag = true;
        tBaseH = sheet.offsetHeight;
        sheet.classList.add('builder-sheet--dragging');
      }
      e.preventDefault();
      applySheetHeight(Math.max(tmt.defaultH, Math.min(tmt.fullH, tBaseH + dy)));
    }, { passive: false });
    const endTabs = () => {
      if (!tDrag) return;
      tDrag = false;
      sheet.classList.remove('builder-sheet--dragging');
      snapSheet(tmt);
    };
    tabs.addEventListener('touchend', endTabs);
    tabs.addEventListener('touchcancel', endTabs);
  }

  // Tap the peeking board (only reachable in full) to drop back to default.
  document.getElementById('board-wrap')?.addEventListener('click', () => {
    if (sheetState === 'full') setSheetState('default');
  });
}

function setupBuilderCarousel(): void {
  const track = document.getElementById('builder-carousel')!;

  // Tap a tab → page to that slide.
  document.querySelectorAll<HTMLButtonElement>('#builder-slide-tabs .slide-tab')
    .forEach(tab => tab.addEventListener('click', () => {
      const index = Number(tab.dataset.slide);
      track.scrollTo({ left: index * track.clientWidth, behavior: 'smooth' });
      onActiveSlide(index);
    }));

  // Swipe the strip → keep the active tab in sync. rAF-throttled so the scroll
  // stays smooth.
  let ticking = false;
  track.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const index = Math.round(track.scrollLeft / track.clientWidth);
      onActiveSlide(index);
      ticking = false;
    });
  }, { passive: true });

  window.addEventListener('resize', () => layoutBuilderSheet());
}

// ── Annotation marks ─────────────────────────────────────────────────────────
// The six standard chess symbols, strongest to worst, each with a colour class
// (sage for the strong marks, gold for the speculative ones, brick for the
// blunders). Shown as small chips in the move list and picked from a chip row
// inside the note sheet — tapping the active chip clears the mark.
const ANNOTATIONS: ReadonlyArray<{ symbol: Annotation; cls: string; label: string }> = [
  { symbol: '!!', cls: 'brilliant', label: 'Brilliant move (!!)' },
  { symbol: '!', cls: 'good', label: 'Good move (!)' },
  { symbol: '!?', cls: 'interesting', label: 'Interesting move (!?)' },
  { symbol: '?!', cls: 'dubious', label: 'Dubious move (?!)' },
  { symbol: '?', cls: 'mistake', label: 'Mistake (?)' },
  { symbol: '??', cls: 'blunder', label: 'Blunder (??)' },
];

function annClass(symbol: Annotation): string {
  return ANNOTATIONS.find(a => a.symbol === symbol)!.cls;
}

// ── Move note ────────────────────────────────────────────────────────────────
// Notes are purely manual: a per-move reminder the user types by hand. The
// builder shows a single button under the title row — "Add a note for 3…Nf6"
// when the move has none, or the note text plus an "Edit note" button when it
// does. Tapping opens a small sheet — the annotation marks, a textarea, and
// Save / Cancel. The note and the mark live on the move node and save with the
// line; an empty save deletes the note. Cancel discards both edits.

// Per-move detail refresh. The marks now live inside the note sheet, so all the
// panel shows is the note block, keyed to the selected move.
function renderMoveDetails(): void {
  renderNoteBlock();
}

function renderNoteBlock(): void {
  const block = document.getElementById('note-block')!;
  const display = document.getElementById('note-display')!;
  const btn = document.getElementById('note-btn')!;
  const label = document.getElementById('note-btn-label')!;
  const node = getCurrentNode();
  // The note button lives in the Line tab's action row. At the root there's no
  // move to annotate, so hide the button (Title/Tags stay) and the display.
  if (node.id === 'root') {
    btn.hidden = true;
    block.hidden = true;
    return;
  }
  btn.hidden = false;
  const note = node.note?.trim();
  if (note) {
    display.textContent = note;
    display.hidden = false;
    block.hidden = false;
    label.textContent = 'Edit note';
  } else {
    display.textContent = '';
    display.hidden = true;
    block.hidden = true;
    label.textContent = 'Add note';
  }
}

// Open the note sheet for the selected move, seeded with its current note and
// mark. Both are transactional: tapping a mark and typing edit local state, and
// nothing touches the move until Save. Cancel / backdrop / back gesture discard.
function openNoteSheet(): void {
  const node = getCurrentNode();
  if (node.id === 'root') return;
  let pendingAnn: Annotation | undefined = node.annotation;

  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet';

  const h = document.createElement('h3');
  h.className = 'edit-sheet-title';
  h.textContent = `Note for ${formatMove(node.san)}`;
  sheet.appendChild(h);

  // Annotation marks: one row of chips, the active mark highlighted. Tapping the
  // active mark clears it.
  const marks = document.createElement('div');
  marks.className = 'note-sheet-marks';
  marks.setAttribute('role', 'group');
  marks.setAttribute('aria-label', 'Annotation mark');
  const chips: HTMLButtonElement[] = [];
  const paintMarks = () => {
    for (const chip of chips) {
      const on = chip.dataset.symbol === pendingAnn;
      chip.classList.toggle('ann-pick--on', on);
      chip.setAttribute('aria-pressed', String(on));
    }
  };
  for (const a of ANNOTATIONS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `ann-pick ann-${a.cls}`;
    chip.dataset.symbol = a.symbol;
    chip.textContent = a.symbol;
    chip.setAttribute('aria-label', a.label);
    chip.title = a.label;
    chip.addEventListener('click', () => {
      pendingAnn = pendingAnn === a.symbol ? undefined : a.symbol;
      paintMarks();
    });
    chips.push(chip);
    marks.appendChild(chip);
  }
  paintMarks();
  sheet.appendChild(marks);

  const textarea = document.createElement('textarea');
  textarea.className = 'prompt-sheet-textarea';
  textarea.rows = 3;
  textarea.value = node.note ?? '';
  textarea.placeholder = 'Reminder or plan for this move…';
  sheet.appendChild(textarea);

  const btnRow = document.createElement('div');
  btnRow.className = 'dialog-btn-row';

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  };

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'dialog-btn btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => close());

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'dialog-btn btn-primary';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    const value = textarea.value;
    close();
    void saveNote(value, pendingAnn);
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(saveBtn);
  sheet.appendChild(btnRow);

  const removeBack = pushBack(() => close());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  // Focus after mount so the keyboard opens straight onto the note, cursor at
  // the end of any existing text.
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

// Persist the note (and mark) onto the current move. An empty note value
// deletes it. When the line already lives in storage we write it through
// immediately so it can't be lost; a brand-new line keeps it in memory until
// the header Save.
async function saveNote(value: string, annotation: Annotation | undefined): Promise<void> {
  const node = getCurrentNode();
  if (node.id === 'root') return;
  const trimmed = value.trim();
  node.note = trimmed ? value : undefined;
  node.annotation = annotation;
  renderNoteBlock();
  renderMoveList(); // refresh the note dot and the mark chip in the move strip
  if (loadedLineId) {
    const line = buildCurrentLine();
    await saveLine(line);
    currentTrainingLine = line;
    savedSnapshot = builderSnapshot();
    showToast(trimmed ? 'Note saved ✓' : 'Saved ✓');
  } else if (trimmed) {
    showToast('Note added — Save the line to keep it');
  }
}

function setupNoteBlock(): void {
  document.getElementById('note-btn')!.addEventListener('click', openNoteSheet);
}

// Re-run the engine for the position now on the board. Every path that changes
// the position calls this: it clears the old eval, DROPS the stale result so its
// arrows can't linger a move behind (they blank until the fresh result lands),
// repaints the board overlays (the current move's grade badge), then evaluates.
// Nulling lastEngineResult matters now that arrows show on every tab — a stale
// result would otherwise keep drawing the previous move's arrows.
function reevaluate(): void {
  evalPanel.clear();
  lastEngineResult = null;
  refreshBoardShapes();
  engine.evaluate(chess.fen());
}

function handleMoveClick(nodeId: string) {
  goTo(nodeId);
  const path = pathTo(nodeId);

  chess.reset();
  for (const node of path) {
    chess.move(node.san);
  }

  const last = path[path.length - 1];
  cg.set({
    fen: chess.fen(),
    turnColor: turnColor(),
    movable: {
      color: 'both',
      dests: legalDests(),
    },
    lastMove: last
      ? [last.uci.slice(0, 2) as Key, last.uci.slice(2, 4) as Key]
      : undefined,
  });

  renderMoveList();
  renderMoveDetails();
  updateOpeningName();
  reevaluate();
}

// Play a move given as UCI (e.g. from a clicked engine recommendation) at the
// current position: same effect as making it on the board.
function playUci(uci: string): void {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = (uci[4] as 'q' | 'r' | 'b' | 'n') || 'q';
  const parentFen = chess.fen(); // position before the move, for live grading
  const result = chess.move({ from, to, promotion });
  if (!result) return;

  const fullUci = from + to + (result.promotion ?? '');
  const node = addMove(result.san, fullUci, chess.fen());
  cg.set({
    fen: chess.fen(),
    turnColor: turnColor(),
    movable: { color: 'both', dests: legalDests() },
    lastMove: [from as Key, to as Key],
  });

  renderMoveList();
  renderMoveDetails();
  updateOpeningName();
  reevaluate();
  void gradeLiveMove(node, parentFen);
}

// Commit a board move the user made by dragging: run it through chess.js, add the
// node, and resync the board. Crucially it sets `fen` from chess.js, which is what
// makes en-passant captures and promotions render correctly — chessground only
// slides the dragged piece, so without this the taken pawn would linger and a
// promoted pawn would still look like a pawn.
function commitBoardMove(from: string, to: string, promotion: 'q' | 'r' | 'b' | 'n'): void {
  const parentFen = chess.fen(); // position before the move, for live grading
  const result = chess.move({ from, to, promotion });
  if (!result) return;
  const uci = from + to + (result.promotion ?? '');
  const node = addMove(result.san, uci, chess.fen());
  cg.set({
    fen: chess.fen(),
    turnColor: turnColor(),
    movable: { color: 'both', dests: legalDests() },
    lastMove: [from as Key, to as Key],
  });
  renderMoveList();
  renderMoveDetails();
  updateOpeningName();
  reevaluate();
  void gradeLiveMove(node, parentFen);
}

// Snap the board back to the current chess.js position — used when a promotion is
// cancelled, since chessground has already slid the pawn to the last rank but no
// move has actually been made.
function revertBoard(): void {
  const cur = getCurrentNode();
  const lm = cur.id !== 'root' && cur.uci
    ? [cur.uci.slice(0, 2) as Key, cur.uci.slice(2, 4) as Key] as [Key, Key]
    : undefined;
  cg.set({
    fen: chess.fen(),
    turnColor: turnColor(),
    movable: { color: 'both', dests: legalDests() },
    lastMove: lm,
  });
}

// A pawn reached the last rank: ask which piece it becomes, then commit (or snap
// back if cancelled). Awaits the picker, so the board sits with the pawn on the
// last rank until the user chooses.
async function handleBoardPromotion(from: Key, to: Key, colour: 'white' | 'black'): Promise<void> {
  const role = await askPromotion(boardEl, colour, to, cg.state.orientation);
  if (!role) { revertBoard(); return; }
  commitBoardMove(from, to, role);
}

let saveColour: 'white' | 'black' = 'white';

// 'builder' edits a repertoire line (Save line); 'analyser' explores an imported
// game (Save game, opponent in the title, deviations become variations). Set when
// a game is opened; reset to 'builder' on every fresh/loaded line.
let builderMode: 'builder' | 'analyser' = 'builder';

// The stored game currently open in the analyser, so "Save game" writes the
// analysed tree back onto that record. null when not analysing a saved game.
let analyserGameId: string | null = null;
// The open game's date, shown next to "vs <opponent>" under the board.
let builderGameDate = '';
// The open game's opponent rating and source URL (chess.com / lichess), shown in
// the Game tab's "vs <opponent>" line. Undefined for a pasted/manual game.
let builderGameRating: number | undefined;
let builderGameUrl: string | undefined;

// When a line is loaded from My Lines, stash its id and createdAt so
// a subsequent Save updates the same line instead of creating a duplicate.
let loadedLineId: string | null = null;
let loadedLineCreatedAt: number | undefined;
let loadedLineInTraining = false;

// The currently loaded/saved line — used to preserve training data (confidence,
// schedule, inTraining) when re-saving an existing line.
let currentTrainingLine: Line | null = null;

// The uci path "Save line" (analyser) last saved a new line for, so tapping it
// again at the same unchanged position doesn't create a duplicate. Reset
// whenever the builder loads a different game/line.
let lastSavedLinePath: string | null = null;

// A snapshot of the builder's state as last saved/loaded, for the unsaved-edits
// leave guard. null means "fresh line" — dirty as soon as it has any move. We
// compare a fingerprint of the editable state (name, tags, colour, tree) rather
// than tracking a flag across every mutation, so it can never drift out of sync.
let savedSnapshot: string | null = null;

function builderSnapshot(): string {
  return JSON.stringify({
    name: currentTitle(),
    tags: currentTags,
    colour: saveColour,
    tree: stripDerived(serialise()),
  });
}

// Engine review writes derived fields (classification, evalCp) onto the nodes.
// Those aren't authored edits — they re-compute on every open — so they must not
// make a line/game read as "dirty". Strip them before fingerprinting for the
// leave-guard. serialise() hands back a fresh clone, so mutating it is safe.
function stripDerived(node: MoveNode): MoveNode {
  delete node.classification;
  delete node.evalCp;
  for (const child of node.children) stripDerived(child);
  return node;
}

// True when the builder holds moves that differ from the last saved state.
function isBuilderDirty(): boolean {
  if (isEmpty()) return false;             // nothing worth saving
  if (savedSnapshot === null) return true; // a fresh line that now has moves
  return builderSnapshot() !== savedSnapshot;
}

// Single timer handle for Watch line — prevents stacked playback.
let playbackTimer: ReturnType<typeof setTimeout> | undefined;
// The line currently being watched, and the index of the NEXT move to play.
// Kept across a pause so the button can resume rather than restart.
let playbackMoves: ReturnType<typeof mainline> = [];
let playbackIndex = 0;

// Watch line is an icon-only button (in the bottom bar, next to Flip): a play
// triangle that becomes a pause symbol while a line is playing back.
const PLAY_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="none" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="none" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';

function setWatchPlaying(playing: boolean): void {
  const btn = document.getElementById('watch-btn') as HTMLButtonElement | null;
  if (!btn) return;
  btn.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  btn.classList.toggle('playing', playing);
  // Paused mid-line (moves still queued) offers "Resume"; otherwise "Watch".
  const resumable = !playing && playbackMoves.length > 0 && playbackIndex < playbackMoves.length;
  const label = playing ? 'Pause' : resumable ? 'Resume line' : 'Watch line';
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

// Pause playback but keep the queue, so the button can resume from here.
function pausePlayback(): void {
  if (playbackTimer !== undefined) {
    clearTimeout(playbackTimer);
    playbackTimer = undefined;
  }
  setWatchPlaying(false);
}

// Fully stop and forget the queue (used when leaving the board / loading a line).
function stopPlayback(): void {
  pausePlayback();
  playbackMoves = [];
  playbackIndex = 0;
  setWatchPlaying(false);
}

function goToStart(): void {
  goTo('root');
  chess.reset();
  updateOpeningName();
  cg.set({
    fen: chess.fen(),
    turnColor: 'white',
    movable: { color: 'both', dests: legalDests() },
    lastMove: undefined,
  });
  renderMoveList();
  renderMoveDetails();
  reevaluate();
}

// The header save button reads "Save changes" when editing an existing line,
// and "Save line" for a fresh one — standard create-vs-edit wording.
function updateSaveButtonLabel(): void {
  const analyser = builderMode === 'analyser';
  const label = document.getElementById('header-save-label');
  if (label) {
    label.textContent = analyser ? 'Save game'
      : loadedLineId ? 'Save changes' : 'Save line';
  }

  // The first carousel tab is "Game" for the analyser, "Line" for the builder.
  const firstTab = document.querySelector('#builder-slide-tabs .slide-tab[data-slide="0"]');
  if (firstTab) firstTab.textContent = analyser ? 'Game' : 'Line';

  // The opening-name title makes sense for a repertoire line, not for a game —
  // the game's identity ("vs <opponent>") already shows in the header and below.
  const titleRow = document.querySelector<HTMLElement>('.line-title-row');
  if (titleRow) titleRow.hidden = analyser;

  // The "Analyse game" button is the analyser's manual grade trigger.
  refreshReviewButtonState();

  // The "save this line to my repertoire" action only makes sense in the analyser.
  const saveLineBtn = document.getElementById('save-line-btn');
  if (saveLineBtn) saveLineBtn.hidden = !analyser;

  // Renaming a repertoire line makes sense in builder mode; renaming a game's
  // extracted-line title in the analyser doesn't, so it's builder-only.
  const renameBtn = document.getElementById('rename-btn');
  if (renameBtn) renameBtn.hidden = builderMode === 'analyser';

  // Delete sits at the foot of the Line panel: removes the saved game (analyser)
  // or the saved line (builder). Hidden for a brand-new, never-saved line — there
  // is nothing to delete yet.
  const deleteBtn = document.getElementById('line-delete');
  if (deleteBtn) {
    const canDelete = builderMode === 'analyser' ? !!analyserGameId : !!loadedLineId;
    deleteBtn.hidden = !canDelete;
    const lbl = deleteBtn.querySelector('.line-delete-label');
    if (lbl) lbl.textContent = builderMode === 'analyser' ? 'Delete game' : 'Delete line';
  }

  // Training toggle sits next to Delete: builder mode only (a game has no
  // inTraining concept) and only for a line that's been saved at least once —
  // there's nothing to schedule before that.
  const trainingToggle = document.getElementById('line-training-toggle');
  if (trainingToggle) {
    trainingToggle.hidden = !(builderMode === 'builder' && !!loadedLineId);
    applyLineTrainingToggleState();
  }
}

// Reflect loadedLineInTraining onto the switch's visual state (on/off colour,
// knob position, label text).
function applyLineTrainingToggleState(): void {
  const btn = document.getElementById('line-training-toggle');
  if (!btn) return;
  btn.classList.toggle('dline-toggle--on', loadedLineInTraining);
  btn.setAttribute('aria-checked', String(loadedLineInTraining));
  const lbl = btn.querySelector('.dline-toggle-label');
  if (lbl) lbl.textContent = `Training ${loadedLineInTraining ? 'ON' : 'OFF'}`;
}

// Flip inTraining on the loaded, saved line immediately — no need to hit
// header Save first. Mirrors the same on/off switch used in My Lines
// (lines-screen.ts); only reachable when a saved line is loaded (see the
// visibility guard in updateSaveButtonLabel above).
async function toggleLineTraining(): Promise<void> {
  if (!currentTrainingLine || !loadedLineId) return;
  const next = !loadedLineInTraining;
  const line = { ...currentTrainingLine, inTraining: next };
  await saveLine(line);
  currentTrainingLine = line;
  loadedLineInTraining = next;
  applyLineTrainingToggleState();
}

// The Line-panel delete control: confirm, then remove the saved game (analyser
// mode) or the saved line (builder mode) and leave the builder for the matching
// list. Marking the snapshot clean first keeps the unsaved-edits guard quiet.
function deleteCurrentLineOrGame(): void {
  if (builderMode === 'analyser' && analyserGameId) {
    const id = analyserGameId;
    showDialog({
      title: 'Delete this game?',
      body: 'This game and its saved analysis will be permanently removed from My games. This can’t be undone.',
      buttons: [
        { label: 'Delete', variant: 'danger', onClick: () => {
          void deleteGame(id).then(() => {
            stopPlayback();
            savedSnapshot = builderSnapshot();
            showToast('Game deleted');
            showView('games');
          });
        } },
        { label: 'Cancel', variant: 'secondary' },
      ],
    });
    return;
  }
  if (builderMode === 'builder' && loadedLineId) {
    const id = loadedLineId;
    const label = currentTitle() || 'this line';
    showDialog({
      title: 'Delete this line?',
      body: `“${label}” and all of its training data — confidence, review history and schedule — will be permanently deleted. This can’t be undone.`,
      buttons: [
        { label: 'Delete', variant: 'danger', onClick: () => {
          void deleteLine(id).then(() => {
            stopPlayback();
            savedSnapshot = builderSnapshot();
            showToast('Line deleted');
            showView('lines');
          });
        } },
        { label: 'Cancel', variant: 'secondary' },
      ],
    });
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────

// The four bottom-tab destinations, plus the board screens reached from them.
// "train" is the start view and back-navigation root; "explore" is a v1.2
// placeholder; "builder" shows a chessboard, so it counts as a board screen
// (see BACK_VIEWS below).
type ViewName = 'train' | 'lines' | 'explore' | 'games' | 'progress' | 'builder' | 'settings';
let currentView: ViewName = 'train';

// The global FAB (mounted at boot). Shown on the four main tabs, hidden on the
// full-screen views (builder, settings) — see showView.
let fabController: FabController | null = null;

// Full screens reached from outside the bottom tab bar: the builder (a board) and
// Settings (from the header icon). On these we hide the bottom tab bar and show a
// back arrow instead, freeing the bottom for the screen's own use. (Training and
// Watch run in their own full-screen overlay with its own back button.)
const BACK_VIEWS: ReadonlySet<ViewName> = new Set<ViewName>(['builder', 'settings']);

// The tab to return to when the back arrow exits a full screen. Builder is
// conceptually opened from My Lines; Settings remembers wherever you came from.
let returnView: ViewName = 'lines';

// Set when a "Drill" button elsewhere wants the Train screen to open straight
// into one specific line, rather than the due-session list. Consumed (and
// cleared) the next time the Train view is shown.
let pendingTrainLineId: string | null = null;

// Reset the builder to an empty line of the given colour. Shared by the
// per-colour Add buttons (which preselect the side) and the post-save redirect.
function clearBuilder(colour: 'white' | 'black' = 'white'): void {
  stopPlayback();
  reset();
  chess.reset();
  loadedLineId = null;
  loadedLineCreatedAt = undefined;
  loadedLineInTraining = false;
  currentTrainingLine = null;
  lastSavedLinePath = null;
  currentTags = [];
  saveColour = colour;
  // Fresh, empty line — no snapshot, so it only counts as dirty once a move lands.
  savedSnapshot = null;
  // Fresh line: drop any manual title and clear the auto-detected name.
  manualTitle = null;
  detectedName = '';
  builderDesc = '';
  builderEngine = 'none';
  builderMode = 'builder';
  analyserGameId = null;
  builderGameDate = '';
  builderGameRating = undefined;
  builderGameUrl = undefined;
  // A fresh line/game starts with an empty eval cache. Live grading follows the
  // engine toggle: moves you play get marks while the engine is on.
  liveAnalysis = engineOn;
  liveCache.clear();
  renderTitle();
  renderBuilderTags();
  renderBuilderDesc();
  cg.set({
    fen: chess.fen(),
    orientation: colour,
    turnColor: 'white',
    movable: { color: 'both', dests: legalDests() },
    lastMove: undefined,
  });
  renderMoveList();
  renderMoveDetails();
  updateSaveButtonLabel();
  reevaluate();
  builderPanels?.render(); // reset to the start position's continuations
}

// Open the builder on a fresh line of the given colour (from Home's Add buttons).
function startNewLine(colour: 'white' | 'black'): void {
  clearBuilder(colour);
  showView('builder');
}

// Open the builder on a specific carousel tab (e.g. an external "browse the
// opening library" link lands straight on the Library tab). `fresh` starts a new
// empty line of `colour` first; `engine` turns the engine on once landed.
function openBuilderTab(
  slide: number,
  opts: { fresh?: boolean; colour?: 'white' | 'black'; engine?: boolean } = {},
): void {
  if (opts.fresh) clearBuilder(opts.colour ?? 'white');
  pendingBuilderSlide = slide;
  if (opts.engine) pendingEngineOn = true;
  showView('builder');
}

// Open the builder on the Scouting tab with an opponent preselected — the new
// home for the opponent "board browser" (from the Explore opponent detail).
function scoutInBuilder(opponentId: string, colour: 'white' | 'black' = 'white'): void {
  clearBuilder(colour);
  pendingScoutOpponentId = opponentId;
  pendingBuilderSlide = SCOUTING_SLIDE;
  showView('builder');
}

// Seed the builder with a UCI move list, then open it (from "From my games"
// suggestions, or the Prepare flow). Starts from a clean, unsaved line so a Save
// creates a new one. Optional tags pre-fill the working tag set (used by Prepare
// to stamp the opponent tag).
function buildFromUcis(
  ucis: string[],
  colour: 'white' | 'black',
  tags: string[] = [],
  opts: { description?: string; analyser?: boolean; gameDate?: number; notes?: Record<number, string> } = {},
): void {
  clearBuilder(colour);
  currentTags = [...tags];
  builderDesc = opts.description ?? '';
  builderGameDate = formatGameDate(opts.gameDate);
  // Lay the game's moves down as a single main line first…
  let ply = 0;
  for (const uci of ucis) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = (uci[4] as 'q' | 'r' | 'b' | 'n') || 'q';
    const result = chess.move({ from, to, promotion });
    if (!result) break; // stop on an illegal move rather than corrupt the tree
    const node = addMove(result.san, from + to + (result.promotion ?? ''), chess.fen());
    const note = opts.notes?.[ply++];
    if (note) node.note = note;
  }
  // …then, for the analyser, switch the tree to variation mode so any move the
  // user plays off the main line is kept as a branch rather than overwriting it.
  builderMode = opts.analyser ? 'analyser' : 'builder';
  setTreeMode(opts.analyser ? 'variations' : 'single');
  const last = mainline()[mainline().length - 1];
  cg.set({
    fen: chess.fen(),
    orientation: colour,
    turnColor: turnColor(),
    movable: { color: 'both', dests: legalDests() },
    lastMove: last
      ? [last.uci.slice(0, 2) as Key, last.uci.slice(2, 4) as Key]
      : undefined,
  });
  renderMoveList();
  renderMoveDetails();
  renderBuilderTags();
  renderBuilderDesc();
  updateOpeningName();
  updateSaveButtonLabel();
  reevaluate();
  showView('builder');
}

// Restore a previously-analysed game: load its saved move tree (main line +
// variations + review) straight into the analyser, cursor at the start. Mirrors
// buildFromUcis but from a tree rather than a flat move list.
function buildFromTree(tree: MoveNode, colour: 'white' | 'black', description: string, tags: string[] = [], gameDate?: number): void {
  clearBuilder(colour);
  builderDesc = description;
  builderGameDate = formatGameDate(gameDate);
  currentTags = [...tags];
  loadTree(tree);
  builderMode = 'analyser';
  setTreeMode('variations');
  chess.reset();
  cg.set({
    fen: chess.fen(),
    orientation: colour,
    turnColor: 'white',
    movable: { color: 'both', dests: legalDests() },
    lastMove: undefined,
  });
  renderMoveList();
  renderMoveDetails();
  renderBuilderTags();
  renderBuilderDesc();
  updateOpeningName();
  updateSaveButtonLabel();
  reevaluate();
  showView('builder');
}

// Prepare a reply against a scouted opponent: seed the builder with their move
// sequence, flip the board to MY (answering) colour, and stamp the opponent tag
// so a Save files this line under "vs <name>". The answering colour is the
// opposite of the opponent's map colour — I'm replying to what they play.
function prepareReply(ucis: string[], answeringColour: 'white' | 'black', opponentName: string): void {
  buildFromUcis(ucis, answeringColour, [opponentTag(opponentName)]);
}

// The Explore screen's dependency object, shared by the Explore tab render and by
// the FAB's "Build with the engine" shortcut.
function exploreScreenDeps() {
  return {
    onPrepareReply: prepareReply,
    onOpenLine,
    onOpenInBuilder: (
      ucis: string[],
      colour: 'white' | 'black',
      opts?: { description?: string; notes?: Record<number, string> },
    ) => buildFromUcis(ucis, colour, [], opts),
    // The opponent "board browser" now opens the builder's Scouting tab.
    onScoutInBuilder: (opponentId: string) => scoutInBuilder(opponentId),
    // The Packs tab's Lichess-study browser saves chapters straight to My Lines.
    onSaveLines: saveImportedLines,
  };
}

// Build the FAB's action list fresh on every open. Now that the builder unifies
// the library / my games / scouting browsing, the FAB is just the three ways to
// START a line: a new line, your last game, or a game vs the engine. (Browsing
// the library or your games happens inside the builder's tabs.)
async function buildFabActions(): Promise<FabItem[]> {
  const connected = hasConnectedAccount();
  const items: FabItem[] = [];

  // Listed bottom (closest to the ＋) → top. .fab-menu is column-reverse, so the
  // first item pushed renders nearest the button.

  // 1) New line — one row per colour, each with a pawn token in its colour.
  items.push({
    icon: Icons.pawn(18),
    iconFrame: 'white',
    label: 'New line white',
    onClick: () => startNewLine('white'),
  });
  items.push({
    icon: Icons.pawn(18),
    iconFrame: 'black',
    label: 'New line black',
    onClick: () => startNewLine('black'),
  });

  // 2) Import last game — only with a connected account.
  if (connected) {
    items.push({
      icon: Icons.download(20),
      label: 'Import last game',
      sublabel: 'Open the last game you played',
      onClick: () => { void runImportLastGame(); },
    });
  }

  // 3) Build with the engine — always; top of the menu.
  items.push({
    icon: Icons.gamepad(20),
    label: 'Build with the engine',
    sublabel: 'Play a game, save it as a line',
    onClick: () => { void openEngineSpar(exploreScreenDeps()); },
  });

  return items;
}

// FAB "Import last game": fetch the newest game from the connected account, file
// it with my games (deduped, done inside importLastGame), and open it straight
// into Game Review — the same auto-analysing entry point a My Games import uses
// — rather than the plain empty-board builder.
async function runImportLastGame(): Promise<void> {
  showToast('Fetching your last game…');
  try {
    const game = await importLastGame();
    if (!game) { showToast('No recent game found to import.'); return; }
    openImportedGame(game.ucis, game.colour, `vs ${game.opponent}`, game.id, game.endTime);
  } catch {
    showToast('Couldn’t reach your account — check your connection.');
  }
}

// Build a fresh Line from a flat UCI list, auto-named from the bundled book —
// the same naming the builder's Save uses, without touching the live builder
// tree. Used by the onboarding starter-line flow. Returns null if no legal
// move could be applied.
// Onboarding's one-tap add: turn a starter/suggested line's moves into a saved
// Line and route it through the normal add-to-training flow (learn = the
// watch-then-play confirm run; otherwise enrol directly). Shared by the Train
// onboarding and the starter-pack picker opened from My Lines.
function addStarterLine(
  seed: LineSeed,
  colour: 'white' | 'black',
  learn: boolean,
  onDone: () => void,
  onCancel: () => void,
): void {
  const line = lineFromUcis(seed, colour);
  if (!line) { onCancel(); return; }
  if (learn) addLineToTraining(line, onDone, onCancel);
  else void enrolLineDirectly(line).then(onDone);
}

function lineFromUcis(seed: LineSeed | string[], colour: 'white' | 'black'): Line | null {
  const { ucis, notes, plan, name, tags } = Array.isArray(seed) ? { ucis: seed } as LineSeed : seed;
  const ch = new Chess();
  const root: MoveNode = { id: 'root', san: '', uci: '', fen: ch.fen(), children: [] };
  let cursor = root;
  const fens: string[] = [];
  let i = 0;
  for (const uci of ucis) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = (uci[4] as 'q' | 'r' | 'b' | 'n') || 'q';
    let move;
    try { move = ch.move({ from, to, promotion }); } catch { move = null; }
    if (!move) break; // stop on an illegal move rather than corrupt the tree
    const fen = ch.fen();
    fens.push(fen);
    const node: MoveNode = {
      id: `n${++i}`, san: move.san, uci: from + to + (move.promotion ?? ''), fen, children: [],
    };
    const note = notes?.[i - 1]; // note indices are 0-based plies
    if (note) node.note = note;
    cursor.children.push(node);
    cursor = node;
  }
  if (root.children.length === 0) return null;
  // The middlegame plan rides on the final move's note — the note card and the
  // line's note sheet already surface it right where the line runs out.
  if (plan) cursor.note = cursor.note ? `${cursor.note}\n\nPlan: ${plan}` : `Plan: ${plan}`;
  const opening = nameForPath(fens);
  return {
    id: crypto.randomUUID(),
    name: name ?? opening ?? 'Untitled line',
    tags: tags ?? [],
    colour,
    openingName: opening ?? null,
    confidence: 0,
    lastTrained: null,
    inTraining: false,
    tree: root,
    createdAt: Date.now(),
  };
}

// The full dependency set the My Lines screen needs. Centralised so every
// place that (re)renders it stays in sync.
function linesScreenDeps(): Parameters<typeof renderLinesScreen>[1] {
  return {
    onOpenLine,
    onAddLine: startNewLine,
    onStartTraining: handleStartTraining,
    onBuildLine: buildFromUcis,
    onImportGames: () => openImportPanel({ onImported: () => showView('lines') }),
    onPickStarterPack: () => void openStarterPackPicker(addStarterLine),
  };
}

// Add a line to training, honouring the "Confirm run before training" pref.
// ON (default): run the pre-training confirm drill, enrolling on a clean run.
// OFF: enrol instantly, with no run. The manual add-to-training paths and the
// post-save prompt all funnel through here, so they skip the gate identically.
function addLineToTraining(line: Line, onDone: () => void, onCancel: () => void = () => {}): void {
  if (getConfirmRunBeforeTraining()) {
    startPretrainingRun(line, onDone, onCancel);
  } else {
    void enrolLineDirectly(line).then(onDone);
  }
}

// Drill or enrol a single line by id, from the Progress screen. An in-training
// line drills immediately; a saved line that isn't in training yet runs the
// "add to training" flow (gated by the pref), then returns to Progress.
async function onTrainLine(lineId: string, inTraining: boolean): Promise<void> {
  if (inTraining) {
    pendingTrainLineId = lineId;
    showView('train');
    return;
  }
  const line = (await getAllLines()).find(l => l.id === lineId);
  if (!line) return;
  addLineToTraining(
    line,
    () => showView('progress'), // re-render so the line now reads as in-training
    () => { /* cancelled — stay on Progress */ },
  );
}

function handleStartTraining(line: Line): void {
  addLineToTraining(
    line,
    () => {
      // Re-render lines screen so the "Add to training" button disappears.
      const linesEl = document.getElementById('view-lines')!;
      renderLinesScreen(linesEl, linesScreenDeps());
    },
    () => { /* cancelled — user is already back at the lines screen */ }
  );
}

// The header text: the "Obertura" wordmark on the four main tabs, the screen's
// own title on the inner full screens. The builder shows the line's name (or
// "New line" before it's named); Settings shows "Settings". A modifier class
// swaps the pixel wordmark font for a plain heading on the inner screens.
function updateHeaderTitle(): void {
  const el = document.getElementById('header-title');
  if (!el) return;
  const onTab = !BACK_VIEWS.has(currentView);
  el.textContent =
    currentView === 'builder'
      // Opened from a training session: no opponent name — the top bar stays
      // clean, with just the "Back to train" button on the right.
      ? (suspendedSession ? ''
        : builderMode === 'analyser' ? (builderDesc || 'Unknown')
        : (currentTitle() || 'New line'))
    : currentView === 'settings' ? 'Settings'
    : 'Obertura';
  el.classList.toggle('header-title--screen', !onTab);
}

// The Train screen's four modes as a 2×2 grid of chunky tabs: Openings (the
// training home), Puzzles, Mistake retry (positions from your own games) and
// End game (a placeholder until that round happens). The active pane is
// rendered lazily so each screen's render side effects only run when shown.
type TrainTab = 'openings' | 'puzzles' | 'mistakes' | 'endgame';
let trainTab: TrainTab = 'openings';

// Each mode's colour, used as the active tab fill (white label — all four hues
// keep it readable) and the inactive icon tint. Static across themes, like the
// Practise cards' MODE_ACCENT palette.
const TRAIN_TAB_ACCENT: Record<Exclude<TrainTab, 'openings'>, string> = {
  puzzles: '#c4741d',  // warm orange — the puzzle gold family, pushed toward orange
  mistakes: '#a3492e', // ember — corrective, kin to the review reds
  endgame: '#33677a',  // deep teal — the long game
};

function renderTrainTabbed(host: HTMLElement): void {
  host.innerHTML = '';

  const tabs = document.createElement('div');
  tabs.className = 'lines-tabs train-tabs';
  const mkTab = (tab: TrainTab, label: string, icon: SVGElement, accent?: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lines-tab';
    btn.dataset.tab = tab;
    if (accent) btn.style.setProperty('--tab-accent', accent);
    icon.classList.add('lines-tab-icon');
    btn.appendChild(icon);
    const span = document.createElement('span');
    span.className = 'lines-tab-label';
    span.textContent = label;
    btn.appendChild(span);
    btn.addEventListener('click', () => { if (trainTab !== tab) { trainTab = tab; paint(); } });
    return btn;
  };
  tabs.appendChild(mkTab('openings', 'Openings', Icons.pawn(22)));
  tabs.appendChild(mkTab('puzzles', 'Puzzles', Icons.puzzlePiece(22), TRAIN_TAB_ACCENT.puzzles));
  tabs.appendChild(mkTab('mistakes', 'Middle game', Icons.swords(22), TRAIN_TAB_ACCENT.mistakes));
  tabs.appendChild(mkTab('endgame', 'End game', Icons.flag(22), TRAIN_TAB_ACCENT.endgame));

  // The daily-challenge card sits above the tabs — it spans all the modes, so
  // it's the shared daily face of the Train screen.
  const dailyHost = document.createElement('div');
  dailyHost.className = 'daily-host';
  const openingsPane = document.createElement('div');
  const puzzlesPane = document.createElement('div');
  const mistakesPane = document.createElement('div');
  const endgamePane = document.createElement('div');
  host.append(dailyHost, tabs, openingsPane, puzzlesPane, mistakesPane, endgamePane);

  // (Re)render the daily card from current lines + done state. Called on first
  // paint and after any task completes.
  const renderDaily = async (): Promise<void> => {
    let allLines: Line[];
    let spotRefs: SpotRef[];
    try {
      const [lines, games] = await Promise.all([getAllLines(), getAllGames()]);
      allLines = lines;
      spotRefs = collectSpots(games);
    } catch {
      dailyHost.innerHTML = '';
      return;
    }
    dailyHost.innerHTML = '';

    // The daily config (which tasks + how many of each) and which are actually
    // runnable right now decide the card — and the "Next task →" chain.
    const config = getDailyConfig();
    const dailyLines = pickDailyLines(allLines, config.tasks.lines.count);
    const avail = { hasLines: dailyLines.length > 0, mistakesAvailable: spotRefs.length > 0 };
    const active = activeDailyTasks(config, avail);

    // Each task as a named launcher so the success screens' "Next task →" can
    // chain into any of them. The next task is resolved at CLICK time (the
    // completion screen mounts before the finished task's done flag is set).
    const nextFor = (current: DailyTaskId): { label: string; run: () => void } | undefined => {
      // Offer the button only when some OTHER active task would still be open once
      // this one is done — a "Next task" that closes into nothing misleads.
      const pretend = { ...getDaily(), [current]: true };
      if (!nextDailyTask(pretend, active)) return undefined;
      return {
        label: 'Next task →',
        run: () => {
          const next = nextDailyTask(getDaily(), active);
          if (next) launchers[next]();
        },
      };
    };

    const launchers: Record<DailyTaskId, () => void> = {
      lines: () => {
        // Drill today's lines on the Openings pane; mark that task done when the
        // whole sitting finishes, then refresh the card behind the overlay.
        if (trainTab !== 'openings') { trainTab = 'openings'; paint(); }
        startLineSession(dailyLines, openingsPane,
          () => { markLinesDone(); void renderDaily(); }, nextFor('lines'));
      },
      positions: () => {
        // Same pane, but a stream of single due positions rather than whole lines.
        if (trainTab !== 'openings') { trainTab = 'openings'; paint(); }
        startPositionsSession(allLines, openingsPane, config.tasks.positions.count,
          () => { markPositionsDone(); void renderDaily(); }, nextFor('positions'));
      },
      puzzles: () => {
        void startDailyPuzzles(config.tasks.puzzles.count,
          () => { markPuzzlesDone(); void renderDaily(); }, nextFor('puzzles'),
          openPuzzleFromSession);
      },
      endgames: () => {
        // Rated endgame puzzles (the End game ladder) — its own overlay, no tab
        // switch needed.
        startDailyEndgamePuzzles(config.tasks.endgames.count,
          () => { markEndgamesDone(); void renderDaily(); }, nextFor('endgames'),
          openPuzzleFromSession);
      },
      mistakes: () => {
        // A short mixed set from the scanned spots — runs as its own overlay,
        // so no tab switch is needed.
        startMistakeSession({
          refs: pickSpots(spotRefs, null, config.tasks.mistakes.count),
          modeLabel: 'Daily challenge',
          onComplete: () => { markMistakesDone(); void renderDaily(); },
          onExit: () => { if (trainTab === 'mistakes') paint(); },
          onOpenGame: openGameFromSession,
          nextAction: nextFor('mistakes'),
        });
      },
    };

    const card = renderDailyChallenge({
      config,
      active,
      lines: dailyLines,
      onTrainLines: () => launchers.lines(),
      onRefreshPositions: () => launchers.positions(),
      onSolvePuzzles: () => launchers.puzzles(),
      onSolveEndgames: () => launchers.endgames(),
      mistakeSpotCount: spotRefs.length,
      onFixMistakes: () => launchers.mistakes(),
    });
    if (card) dailyHost.appendChild(card);
  };
  void renderDaily();

  const paint = (): void => {
    // A background wash in the active mode's colour, so each pane carries its
    // identity (see #view-train[data-train-mode] in CSS). The same colour is
    // published as --train-accent so the pane's primary buttons and accents pick
    // it up too — Openings clears it and falls back to the app green.
    host.dataset.trainMode = trainTab;
    const paneAccent = trainTab === 'openings' ? null : TRAIN_TAB_ACCENT[trainTab];
    if (paneAccent) host.style.setProperty('--train-accent', paneAccent);
    else host.style.removeProperty('--train-accent');
    tabs.querySelectorAll<HTMLElement>('.lines-tab').forEach(b => {
      const on = b.dataset.tab === trainTab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-current', on ? 'true' : 'false');
    });
    openingsPane.hidden = trainTab !== 'openings';
    puzzlesPane.hidden = trainTab !== 'puzzles';
    mistakesPane.hidden = trainTab !== 'mistakes';
    endgamePane.hidden = trainTab !== 'endgame';
    if (trainTab === 'openings') {
      renderTrainScreen(openingsPane, {
        focusLineId: pendingTrainLineId ?? undefined,
        onOpenLine,
        onBuildLine: () => startNewLine('white'),
        onImportGames: () => showView('games'),
        onAddStarterLine: addStarterLine,
        onBrowseLibrary: () => openBuilderTab(LIBRARY_SLIDE, { fresh: true, colour: 'white' }),
        onBuildWithEngine: () => openBuilderTab(0, { fresh: true, colour: 'white', engine: true }),
        onSetFabVisible: (visible) => fabController?.setVisible(visible),
      });
      pendingTrainLineId = null;
    } else if (trainTab === 'puzzles') {
      void renderPuzzlesScreen(puzzlesPane, {
        onImportGames: () => showView('games'),
        onBuildLine: () => startNewLine('white'),
        onConnectLichess: () => void lichessConnect(),
        onAnalysePosition: openPuzzleFromSession,
      });
    } else if (trainTab === 'mistakes') {
      void renderMistakesScreen(mistakesPane, {
        onImportGames: () => showView('games'),
        onOpenGame: openGameFromSession,
      });
    } else {
      renderEndgameScreen(endgamePane, {
        onAnalysePosition: openPuzzleFromSession,
        onImportGames: () => showView('games'),
      });
    }
  };
  paint();
}

function showView(view: ViewName): void {
  // A training session suspended behind the analyser: landing back on Train
  // resumes it (after the view has rendered, below); landing anywhere else
  // discards it so its hidden overlay can't linger under a different screen.
  let resumeSuspended: (() => void) | null = null;
  if (suspendedSession && view !== 'builder') {
    const s = suspendedSession;
    clearSuspendedSession();
    if (view === 'train') resumeSuspended = s.resume;
    else s.discard();
  }

  // Entering a full screen (builder/settings) from a tab: remember it so the back
  // arrow returns there.
  if (BACK_VIEWS.has(view) && !BACK_VIEWS.has(currentView)) {
    returnView = currentView;
  }
  currentView = view;
  updateHeaderTitle();

  // The builder owns a back-layer while it's on screen, so the system back
  // gesture runs the save-guard with priority (rather than the less reliable
  // view-level fallback). Drop it the moment we leave for any other screen.
  if (view === 'builder') armBuilderBack();
  else disarmBuilderBack();

  const builderEl = document.getElementById('view-builder')!;
  const linesEl = document.getElementById('view-lines')!;
  const exploreEl = document.getElementById('view-explore')!;
  const gamesEl = document.getElementById('view-games')!;
  const trainEl = document.getElementById('view-train')!;
  const progressEl = document.getElementById('view-progress')!;
  const settingsEl = document.getElementById('view-settings')!;

  builderEl.toggleAttribute('hidden', view !== 'builder');
  linesEl.toggleAttribute('hidden', view !== 'lines');
  exploreEl.toggleAttribute('hidden', view !== 'explore');
  gamesEl.toggleAttribute('hidden', view !== 'games');
  trainEl.toggleAttribute('hidden', view !== 'train');
  progressEl.toggleAttribute('hidden', view !== 'progress');
  settingsEl.toggleAttribute('hidden', view !== 'settings');

  // Full screens swap the bottom tab bar for a back arrow.
  const onBack = BACK_VIEWS.has(view);
  document.getElementById('bottom-nav')!.toggleAttribute('hidden', onBack);
  document.getElementById('nav-back')!.toggleAttribute('hidden', !onBack);
  // The FAB rides along with the bottom nav: on the four main tabs, not the
  // full-screen builder/settings.
  fabController?.setVisible(!onBack);

  // The builder puts Save in the top-right; the settings icon is hidden on both
  // the builder (Save takes its place) and the Settings screen itself. While a
  // training session is suspended behind the analyser, "Back to train" takes
  // Save's spot instead.
  const onBuilder = view === 'builder';
  document.getElementById('header-save')!.toggleAttribute('hidden', !onBuilder || !!suspendedSession);
  document.getElementById('nav-settings')!.toggleAttribute('hidden', onBuilder || view === 'settings');

  document.querySelectorAll<HTMLElement>('#bottom-nav .tab-item').forEach(btn => {
    const active = btn.dataset.view === view;
    btn.classList.toggle('active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });

  if (view === 'lines') {
    renderLinesScreen(linesEl, linesScreenDeps());
  }

  if (view === 'explore') {
    renderExploreScreen(exploreEl, exploreScreenDeps());
  }

  if (view === 'games') {
    void renderMyGamesScreen(gamesEl, {
      onImport: () => openMyGamesImport(() => showView('games')),
      onOpenGame: (g) => openGameForAnalysis(g),
    });
  }

  if (view === 'train') {
    renderTrainTabbed(trainEl);
  }

  if (view === 'progress') {
    renderProgressScreen(progressEl, {
      onTrainLine,
      onOpenLine: (line) => onOpenLine(line),
      onStartTraining: () => showView('train'),
      onBuildLine: () => startNewLine('white'),
      // "Where you leave theory" seeds the builder at the exact fork so the line
      // can be saved and trained.
      onBuildFromMoves: (ucis, colour) => buildFromUcis(ucis, colour),
      // The Your-games empty card opens the shared import flow, returning here.
      onImportGames: () => openImportPanel({ onImported: () => showView('progress') }),
    });
  }

  if (view === 'settings') {
    renderSettingsScreen(settingsEl);
  }

  if (view === 'builder') {
    // Land on the Line tab by default (engine off); an external link can request
    // a different tab via pendingBuilderSlide. Forcing activeSlide to a sentinel
    // makes onActiveSlide run fully (so the engine state is set correctly).
    const slide = pendingBuilderSlide ?? 0;
    pendingBuilderSlide = null;
    if (pendingScoutOpponentId) {
      builderPanels?.selectOpponent(pendingScoutOpponentId);
      pendingScoutOpponentId = null;
    }
    const track = document.getElementById('builder-carousel');
    if (track) track.scrollLeft = slide * track.clientWidth;
    activeSlide = -1;
    onActiveSlide(slide);
    // A hand-off that asked to analyse (a puzzle's "Analyse position", Train's
    // "Build with engine") turns the engine on now that the board is up — and so
    // does the Settings "Engine always on" preference. The dock's engine button
    // still switches it off for the visit.
    if (pendingEngineOn || getEngineAlwaysOn()) { pendingEngineOn = false; setEngineOn(true); }
    // Always land with the board in view and the sheet collapsed to default — a
    // prior visit may have left it pulled up over the board.
    window.scrollTo(0, 0);
    setSheetState('default', false);
    // The sheet/carousel can only be sized once the builder is visible (its
    // slides have zero height while hidden). Re-read games too, in case some
    // were just imported, then repaint the slides for the current position.
    requestAnimationFrame(() => {
      layoutBuilderSheet();
      if (track) track.scrollLeft = slide * track.clientWidth;
      builderPanels?.reload();
      builderPanels?.render();
    });
  } else if (evalPanel && evalPanel.isEnabled) {
    // Leaving the builder for any other screen: stop the engine it was running.
    evalPanel.setEnabled(false);
  }

  // Un-hide the suspended session's overlay only once its home screen is back.
  resumeSuspended?.();
}

function onOpenLine(line: Line, atFen?: string): void {
  stopPlayback();
  loadTree(line.tree);
  loadedLineId = line.id;
  loadedLineCreatedAt = line.createdAt;
  loadedLineInTraining = line.inTraining;

  // Keep the loaded line so a re-save preserves its training data.
  currentTrainingLine = line;
  currentTags = [...line.tags];
  saveColour = line.colour;

  chess.reset();
  cg.set({
    fen: chess.fen(),
    orientation: line.colour,
    turnColor: 'white',
    movable: { color: 'both', dests: legalDests() },
    lastMove: undefined,
  });

  // Prefill the title with the saved name; the cursor sits at the start so the
  // detected name reflects the root until the user steps through the line.
  manualTitle = line.name;
  detectedName = '';
  builderDesc = '';
  // Opening a saved line is always builder mode. Without this, coming straight
  // from a game (analyser mode) leaves builderMode stale, so the header falls
  // back to "Unknown" and the analyser-only "Save line" button lingers until a
  // reload re-derives state.
  builderMode = 'builder';
  renderTitle();
  renderBuilderTags();
  renderBuilderDesc();

  renderMoveList();
  renderMoveDetails();
  updateSaveButtonLabel();
  // Just loaded from storage — the builder matches what's saved.
  savedSnapshot = builderSnapshot();
  showView('builder');

  // Optionally open at a given position — the drill's in-session "Edit" jumps
  // here at the move you were on. The start position is the root, so a START
  // (or unmatched) fen simply stays there.
  if (atFen) {
    const target = mainline().find(n => n.fen === atFen);
    if (target) handleMoveClick(target.id);
  }
}

// Swap the header's generic user icon for your Chess.com picture when one is
// stored (Lichess / no picture keeps the icon). The inline SVG stays in the DOM
// as the fallback — a broken image removes the img and restores the icon.
function applyNavSettingsAvatar(): void {
  const btn = document.getElementById('nav-settings');
  if (!btn) return;
  const url = getGamesSource()?.avatarUrl;
  const existing = btn.querySelector<HTMLImageElement>('img.nav-settings-avatar');
  if (!url) {
    existing?.remove();
    btn.classList.remove('nav-settings--avatar');
    return;
  }
  if (existing && existing.src === url) return;
  const img = document.createElement('img');
  img.className = 'nav-settings-avatar';
  img.src = url;
  img.alt = '';
  img.addEventListener('load', () => btn.classList.add('nav-settings--avatar'));
  img.addEventListener('error', () => {
    img.remove();
    btn.classList.remove('nav-settings--avatar');
  });
  existing?.remove();
  btn.appendChild(img);
}

function setupNav(): void {
  document.querySelectorAll<HTMLElement>('#bottom-nav .tab-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view as ViewName | undefined;
      if (view) guardBuilderLeave(() => showView(view));
    });
  });

  // Back arrow on full screens — stop any playback and return to where we came from.
  document.getElementById('nav-back')!.addEventListener('click', () => {
    guardBuilderLeave(() => { stopPlayback(); showView(returnView); });
  });

  // The header user icon opens Settings.
  document.getElementById('nav-settings')!.addEventListener('click', () => {
    guardBuilderLeave(() => showView('settings'));
  });

  // Tapping the "Obertura" wordmark reloads the app — a quick way to pull the
  // latest deploy. Only active on the main tabs (where it shows the wordmark), so
  // it never bypasses the builder's unsaved-work guard.
  document.getElementById('header-title')!.addEventListener('click', () => {
    if (!BACK_VIEWS.has(currentView)) location.reload();
  });

  // Show your Chess.com picture on the settings button when connected, and keep
  // it in step with every import / auto-refresh.
  applyNavSettingsAvatar();
  window.addEventListener(IDENTITY_CHANGED_EVENT, applyNavSettingsAvatar);

  // The survey's "Back to train" button lands the user on the Train tab.
  window.addEventListener('obertura:gototrain', () => showView('train'));

  // The system back gesture steps back through the app (closing any open sheet
  // first) instead of closing the PWA. Overlays register their own steps; this
  // is the view-level fallback once nothing is open.
  setViewBack(() => {
    // Full screens (builder / settings) return to wherever they were opened from.
    // The builder normally catches the gesture with its own back-layer (see
    // showView / onBuilderBackGesture); this stays a safe fallback.
    if (BACK_VIEWS.has(currentView)) {
      stopPlayback();
      showView(returnView);
      return true;
    }
    // Any other tab steps back to Train, the start view / back-nav root.
    if (currentView !== 'train') {
      stopPlayback();
      showView('train');
      return true;
    }
    // Train with nothing open: let the press through so the app can close.
    return false;
  });
  initBackNav();
}

// ── Builder leave guard ───────────────────────────────────────────────────────
// Leaving the builder with unsaved moves asks "Save this line?" before any
// navigation — back arrow, tab tap, settings, or the system back gesture. Save
// persists then continues; Discard continues without saving; Keep editing stays.

function guardBuilderLeave(proceed: () => void): void {
  if (currentView === 'builder' && isBuilderDirty()) {
    showSaveGuard(proceed);
  } else {
    proceed();
  }
}

// The builder's own back-layer (see showView). It catches the system back
// gesture directly — the same mechanism drills and sheets use — so the guard
// fires on a gesture exactly as it does on the back arrow. The gesture consumes
// the layer, so a "stay" re-arms it for the next press.
let removeBuilderBack: (() => void) | null = null;

function armBuilderBack(): void {
  if (!removeBuilderBack) removeBuilderBack = pushBack(onBuilderBackGesture);
}

function disarmBuilderBack(): void {
  removeBuilderBack?.();
  removeBuilderBack = null;
}

function onBuilderBackGesture(): void {
  // Our layer was just popped by the gesture; forget the stale remover.
  removeBuilderBack = null;
  if (isBuilderDirty()) {
    armBuilderBack(); // stay trapped while the guard is up
    showSaveGuard(() => { stopPlayback(); showView(returnView); });
  } else {
    stopPlayback();
    showView(returnView);
  }
}

function showSaveGuard(proceed: () => void): void {
  // A game analyser ("vs <name>", backed by a game record) phrases this as saving
  // the analysis back onto the game; a hand-built line saves to My Lines.
  const isGame = analyserGameId !== null;
  showDialog({
    title: isGame ? 'Save your analysis?' : 'Save this line?',
    body: isGame
      ? 'You have unsaved changes to this game.'
      : 'You have unsaved moves in this line.',
    buttons: [
      {
        label: 'Save',
        variant: 'primary',
        onClick: () => {
          const done = isGame ? saveGame() : persistCurrentLine();
          void Promise.resolve(done).then(() => proceed());
        },
      },
      { label: 'Discard', variant: 'danger', onClick: proceed },
      { label: 'Keep editing', variant: 'secondary' },
    ],
    // Backdrop tap / back gesture = keep editing (stay put).
  });
}

// ── Save ────────────────────────────────────────────────────────────────────
// Save lives in the header (top-right). On success we confirm with a toast and
// drop the user back on My Lines, where the just-saved line is highlighted and
// can be enrolled in training.

// Assemble a Line from the builder's current working state. Shared by the
// header Save and the quiet note-save, so they can never drift apart.
function buildCurrentLine(): Line {
  const opening = detectedNameForLine();
  const name = currentTitle() || opening || 'Untitled line';
  const isNew = !loadedLineId;
  return {
    id: loadedLineId ?? crypto.randomUUID(),
    name,
    tags: [...currentTags],
    colour: saveColour,
    openingName: opening || null,
    // Preserve training progress on edit; new lines start fresh.
    confidence: isNew ? 0 : (currentTrainingLine?.confidence ?? 0),
    lastTrained: isNew ? null : (currentTrainingLine?.lastTrained ?? null),
    // Preserve inTraining for existing lines; new lines start as false.
    inTraining: isNew ? false : loadedLineInTraining,
    tree: serialise(),
    createdAt: isNew ? Date.now() : (loadedLineCreatedAt ?? Date.now()),
  };
}

// Persist the builder's current state, leaving the builder "clean". Returns the
// saved line (and whether it was newly created), or null when there's nothing to
// save. Shared by the header Save and the leave-guard's Save.
async function persistCurrentLine(): Promise<{ line: Line; isNew: boolean } | null> {
  if (isEmpty()) {
    showToast('Play a move first');
    return null;
  }
  const isNew = !loadedLineId;
  const line = buildCurrentLine();
  // Lock in the auto-named title so it sticks as the manual name.
  manualTitle = line.name;

  await saveLine(line);
  // The My-lines slide reads saved lines from storage; refresh it so a just-saved
  // line shows up in "My saved lines" without leaving the builder.
  builderPanels?.reloadLines();
  loadedLineId = line.id;
  loadedLineCreatedAt = line.createdAt;
  loadedLineInTraining = line.inTraining;
  currentTrainingLine = line;
  // The builder now matches storage — no unsaved edits.
  savedSnapshot = builderSnapshot();
  return { line, isNew };
}

// Game analyser: "Save game" stores the whole analysed tree (main line +
// variations + notes + review) back onto the game's record in the games store, so
// reopening it from My games restores the analysis. Falls back to saving as a
// line when there's no backing game record (e.g. a pasted PGN).
async function saveGame(): Promise<void> {
  if (analyserGameId) {
    const game = await getGame(analyserGameId);
    if (game) {
      game.tags = [...currentTags];
      game.analysis = { tree: serialise(), engine: builderEngine, reviewedAt: Date.now() };
      // Auto-tag a game that contains a brilliant move of your own (see
      // autoStoreAnalysis) — added on top of your saved tags.
      applyBrilliantTag(game);
      await saveGames([game]);
      savedSnapshot = builderSnapshot();
      refreshSaveButtonState();
      showToast('Game saved ✓');
      return;
    }
  }
  const r = await persistCurrentLine();
  if (r) showToast('Game saved ✓');
}

// Game analyser: "Save line" extracts the CURRENT path (root → the move on the
// board) as a fresh repertoire line in My Lines, leaving the game untouched.
async function saveLineFromCurrentPath(): Promise<void> {
  const ucis = pathTo(getCurrentNode().id).map(n => n.uci);
  if (!ucis.length) { showToast('Step to a move first'); return; }
  const path = ucis.join(',');

  // Tapping Save line again at the exact same, unchanged position would create
  // a genuine duplicate (lineFromUcis always mints a fresh id) — skip it rather
  // than silently doubling the line.
  if (path === lastSavedLinePath) {
    showToast('Already saved ✓');
    return;
  }

  const saveBtn = document.getElementById('save-line-btn') as HTMLButtonElement | null;

  const doSave = async (): Promise<void> => {
    // In-flight guard: a rapid double-tap can't fire a second save before this
    // one resolves.
    if (saveBtn) {
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
    }
    try {
      const line = lineFromUcis(ucis, saveColour);
      if (!line) { showToast('Couldn’t build a line here'); return; }
      await saveLine(line);
      lastSavedLinePath = path;
      builderPanels?.reloadLines();
      // Surface the new line on My Lines (highlighted) so the save is unmistakable,
      // then bounce back to the game so more lines can be extracted from it.
      focusSavedLine(line.id);
      showToast('Saved to My Lines ✓', { variant: 'success' });
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  };

  // A line is the opening you want to drill, not the whole game. If the cursor is
  // deep in the game, nudge the user to step back to the move they want to end on
  // rather than saving 40-move "lines".
  if (ucis.length > LONG_LINE_PLIES) {
    showDialog({
      title: 'Save the whole game as a line?',
      body: `You're at move ${Math.ceil(ucis.length / 2)} — that's most of the game. Lines work best as short openings: step back to the move you want the line to end on, then Save line.`,
      buttons: [
        { label: 'Step back first', variant: 'primary' },
        { label: 'Save it anyway', variant: 'secondary', onClick: () => { void doSave(); } },
      ],
    });
    return;
  }
  void doSave();
}

// Surface a saved line on My Lines, highlighted so it's easy to find.
function goToSavedLine(id: string): void {
  focusSavedLine(id);
  showView('lines');
}

// After saving, offer to add the line to training. The primary action depends on
// the "Confirm run before training" pref: a confirm run when ON, an instant
// enrol when OFF. [Just save it] drops the user on My Lines without enrolling.
// A line that's already in training skips the prompt entirely.
function promptAddToTraining(line: Line): void {
  const confirmRun = getConfirmRunBeforeTraining();
  showDialog({
    title: 'Start training this line?',
    body: confirmRun
      ? 'Play it once to confirm the line, then it joins your training.'
      : 'Add this line straight into your training rotation.',
    // Save-only on the left, the primary action on the right (the expected spot).
    buttons: [
      {
        label: 'Just save it',
        variant: 'secondary',
        onClick: () => goToSavedLine(line.id),
      },
      {
        label: confirmRun ? 'Play it once first' : 'Add to training',
        variant: 'primary',
        onClick: () => addLineToTraining(
          line,
          () => goToSavedLine(line.id),
          () => goToSavedLine(line.id),
        ),
      },
    ],
    onDismiss: () => goToSavedLine(line.id),
  });
}

// True when the line's last mainline move was the OPPONENT's, not mine. We drill
// the user's moves, so a line ideally finishes on one of theirs — see the save
// nudge below. (FEN field 2 is whose turn it is now, so the last mover is the
// opposite.)
function lineEndsOnOpponentMove(): boolean {
  const line = mainline();
  if (line.length === 0) return false;
  const lastMover = line[line.length - 1].fen.split(' ')[1] === 'b' ? 'white' : 'black';
  return lastMover !== saveColour;
}

// Drop the trailing opponent move and re-sync the board to the new last move.
function trimLastMove(): void {
  removeLastMove();
  handleMoveClick(getCurrentNode().id);
}

// "Very long line" threshold for the save warning: more than 20 full moves
// (40 plies). Deep imports (capped at 30 moves) and over-long hand-built lines
// trip it; normal repertoire lines don't.
const LONG_LINE_PLIES = 40;

async function saveCurrentLine(): Promise<void> {
  // Editing an EXISTING line whose moves/details have changed: offer to update it
  // in place, or keep the original and branch this off as a new line. A fresh
  // line — or an unchanged one — skips straight to the save.
  if (loadedLineId && isBuilderDirty()) {
    const label = currentTitle() || detectedNameForLine() || 'this line';
    showDialog({
      title: 'Save your changes',
      body: `You’ve changed “${label}”. Update this line, or keep the original and save this as a new line?`,
      buttons: [
        { label: 'Update this line', variant: 'primary', onClick: () => { void continueSave(); } },
        { label: 'Save as new line', variant: 'secondary', onClick: () => { detachAsNewLine(); void continueSave(); } },
        { label: 'Cancel', variant: 'secondary' },
      ],
    });
    return;
  }
  void continueSave();
}

// Save guards that run before the actual save, each a nudge that may show one
// dialog and otherwise falls through to the next step:
//   1. partial save — the board is parked before the line's end ("save up to here?")
//   2. end-on-move  — the line ends on the opponent's move (trim it?)
//   3. long line    — more than 20 moves (save anyway?)
// Split into steps so a choice in one flows cleanly into the next.
async function continueSave(): Promise<void> {
  // 1) Partial save: the cursor sits on a move before the end of the line. Offer
  // to keep only up to the move on the board (e.g. after importing a full game).
  if (getCurrentNode().children.length > 0) {
    showDialog({
      title: 'Save up to here?',
      body: 'You’re viewing a move partway through the line. Save only up to the move on the board, or the whole line?',
      buttons: [
        { label: 'Save up to this move', variant: 'primary', onClick: () => {
          truncateAfterCurrent();
          handleMoveClick(getCurrentNode().id); // re-sync board + move list to the trimmed line
          afterPartialSave();
        } },
        { label: 'Save the whole line', variant: 'secondary', onClick: afterPartialSave },
        { label: 'Cancel', variant: 'secondary' },
      ],
    });
    return;
  }
  afterPartialSave();
}

// Step 2: nudge a line that ends on the opponent's move (never blocks).
function afterPartialSave(): void {
  if (!isEmpty() && lineEndsOnOpponentMove()) {
    showDialog({
      title: 'End on your move?',
      body: 'This line ends on your opponent’s move. Lines usually finish on YOUR move, so the last thing you drill is a move you make.',
      buttons: [
        { label: 'Trim last move', variant: 'primary', onClick: () => { trimLastMove(); afterEndNudge(); } },
        { label: 'Keep as is', variant: 'secondary', onClick: afterEndNudge },
        { label: 'Cancel', variant: 'secondary' },
      ],
    });
    return;
  }
  afterEndNudge();
}

// Step 3: warn on a very long line (harder to drill), then save.
function afterEndNudge(): void {
  if (mainline().length > LONG_LINE_PLIES) {
    const moves = Math.ceil(mainline().length / 2);
    showDialog({
      title: 'That’s a very long line',
      body: `This line is ${moves} moves long. Long lines are harder to drill — save it anyway, or go back to edit?`,
      buttons: [
        { label: 'Save anyway', variant: 'primary', onClick: () => { void finishSave(); } },
        { label: 'Go back to edit', variant: 'secondary' },
      ],
    });
    return;
  }
  void finishSave();
}

// Detach the builder from the saved line it was editing so the next save creates
// a brand-new line (fresh id, no inherited training data) and leaves the original
// untouched. buildCurrentLine then takes its isNew branch.
function detachAsNewLine(): void {
  loadedLineId = null;
  loadedLineCreatedAt = undefined;
  loadedLineInTraining = false;
  currentTrainingLine = null;
}

// Persist + confirm + offer training. Split out so the save nudge can route here
// after the user picks trim / keep.
async function finishSave(): Promise<void> {
  const result = await persistCurrentLine();
  if (!result) return;
  const { line, isNew } = result;
  showToast(isNew ? 'Line saved ✓' : 'Changes saved ✓', { variant: 'success' });
  // Already enrolled — no point asking; just surface it on My Lines.
  if (line.inTraining) {
    goToSavedLine(line.id);
    return;
  }
  promptAddToTraining(line);
}

function setupSaveButton() {
  document.getElementById('header-save')!.addEventListener('click', () => {
    if (builderMode === 'analyser') void saveGame();
    else void saveCurrentLine();
  });
  document.getElementById('save-line-btn')?.addEventListener('click', () => {
    void saveLineFromCurrentPath();
  });
  const deleteBtn = document.getElementById('line-delete');
  if (deleteBtn) {
    deleteBtn.appendChild(Icons.trash(15));
    const lbl = document.createElement('span');
    lbl.className = 'line-delete-label';
    deleteBtn.appendChild(lbl);
    deleteBtn.addEventListener('click', deleteCurrentLineOrGame);
  }
  document.getElementById('line-training-toggle')?.addEventListener('click', () => {
    void toggleLineTraining();
  });
}

// ── Playback controls ─────────────────────────────────────────────────────────
// Flip and play/pause live in the builder's bottom control bar; the watch-line
// SPEED lives in Settings (set via setWatchSpeed there). watchSpeedMs() reads it
// live, so a speed change in Settings takes effect on the very next auto-played
// move.

function setupPlaybackControls(): void {
  const watchBtn = document.getElementById('watch-btn') as HTMLButtonElement;

  // Flip: swap to the other side AND switch which colour this line saves as —
  // building from White and flipping means you're now preparing the Black side.
  // The colour-dependent slides (My games / Scouting) refresh to match.
  document.getElementById('board-flip')!.addEventListener('click', () => {
    cg.toggleOrientation();
    saveColour = saveColour === 'white' ? 'black' : 'white';
    renderTitle();
    builderPanels?.render();
    showToast(`This line will now save as ${saveColour === 'white' ? 'White' : 'Black'}`);
  });

  // Play the next queued move, then schedule the one after at the current speed.
  function playStep(): void {
    if (playbackIndex >= playbackMoves.length) {
      stopPlayback();
      return;
    }
    playbackTimer = setTimeout(() => {
      handleMoveClick(playbackMoves[playbackIndex].id);
      playbackIndex++;
      playStep();
    }, watchSpeedMs());
  }

  watchBtn.addEventListener('click', () => {
    // Already playing → pause (keeps position for a later resume).
    if (playbackTimer !== undefined) {
      pausePlayback();
      return;
    }

    // Fresh start (or restart after a finished run): load the line from the top.
    if (playbackMoves.length === 0 || playbackIndex >= playbackMoves.length) {
      const moves = mainline();
      if (moves.length === 0) return;
      playbackMoves = moves;
      playbackIndex = 0;
      goToStart();
    }
    // Otherwise we're resuming a paused line from playbackIndex.

    setWatchPlaying(true);
    playStep();
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

const boardEl = document.getElementById('board') as HTMLElement;

initTheme();
initAppearance();
setupNav();
// Cloud backup: from now on every repertoire write schedules a debounced
// upload to Drive (inert until connected in Settings — see drive-backup.ts).
initDriveAutoBackup();

// If we've just returned from "Connect to Lichess", complete the OAuth token
// exchange and clean the URL. On a fresh connect we toast and, once the app has
// finished booting, return the builder to the position the user connected from
// (the redirect reloads the page, so we restore from the stashed move path).
let lichessReturn: { ucis: string[]; colour: 'white' | 'black' } | null = null;
let appBooted = false;
void lichessTryCallback().then((justConnected) => {
  if (!justConnected) return;
  showToast('Connected to Lichess');
  lichessReturn = lichessTakeReturn();
  if (lichessReturn) maybeRestoreLichessReturn();
  else builderPanels?.render();
});

// Replay the stashed position once both halves are ready: the OAuth callback has
// resolved AND the app has booted (so cg/builder exist). Called from both sides.
function maybeRestoreLichessReturn(): void {
  if (!appBooted || !lichessReturn) return;
  const { ucis, colour } = lichessReturn;
  lichessReturn = null;
  // Land back on the Library tab — where Connect lives — at the same position.
  pendingBuilderSlide = LIBRARY_SLIDE;
  buildFromUcis(ucis, colour);
}

// Fade out and remove the boot splash once the first screen's data is ready. Tied
// to getAllLines (the Train screen's gating read); a fallback timeout guarantees
// the splash can never get stuck if that read ever hangs.
function hideAppSplashWhenReady(): void {
  const splash = document.getElementById('app-splash');
  if (!splash) return;
  let done = false;
  const reveal = (): void => {
    if (done) return;
    done = true;
    // One more frame so the populated screen has painted under the splash.
    requestAnimationFrame(() => {
      splash.classList.add('app-splash--hide');
      setTimeout(() => splash.remove(), 320);
    });
  };
  void getAllLines().then(reveal, reveal);
  setTimeout(reveal, 3000); // safety net
}

// Stamp the install date on the very first launch — the beta survey banner
// (survey.ts) waits a week from this timestamp before it first appears.
if (!localStorage.getItem('obertura.installedAt')) {
  localStorage.setItem('obertura.installedAt', String(Date.now()));
}

// Beta access gate (gate.ts) — a self-contained invitation gate + install screen
// shown before the app boots. Skips itself when already unlocked or installed,
// so this is a no-op pass-through on every normal launch. Everything below runs
// only once the gate calls back.
maybeShowGate(() => requestAnimationFrame(() => {
  cg = Chessground(boardEl, {
    movable: {
      color: 'both',
      free: false,
      dests: legalDests(),
    },
    draggable: {
      showGhost: true,
    },
    animation: {
      enabled: true,
      duration: 200,
    },
    events: {
      move(from, to) {
        // A pawn landing on the last rank opens the promotion picker instead of
        // silently queening; everything else commits straight away.
        const piece = chess.get(from as Square);
        const promoting = !!piece && piece.type === 'p'
          && ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'));
        if (promoting) {
          void handleBoardPromotion(from as Key, to as Key, piece!.color === 'w' ? 'white' : 'black');
        } else {
          commitBoardMove(from, to, 'q');
        }
      },
    },
  });

  // Decreasing-opacity arrows for the engine's top 3 candidates — same brushes
  // as the spar overlay's "build with engine" mode (spar.ts). Unique keys per
  // board (board-brushes.ts) keep each arrow's head from colliding with another
  // board's marker id, which otherwise drops the arrowhead on hidden-view boards.
  registerBrushes(cg, {
    eng1: { color: '#3a9a5c', opacity: 0.9, lineWidth: 11 },
    eng2: { color: '#3a9a5c', opacity: 0.55, lineWidth: 9 },
    eng3: { color: '#3a9a5c', opacity: 0.38, lineWidth: 8 },
  });

  // Engine + eval panel — must come after cg is available so evaluate() can read chess.fen().
  engine = new Engine(import.meta.env.BASE_URL, (result) => {
    evalPanel.update(result, chess.fen());
    lastEngineResult = result;
    // One repaint keeps the move's grade badge and the engine arrows in sync,
    // whichever tab is showing — neither can wipe the other now.
    refreshBoardShapes();
  });
  evalPanel = new EvalPanel(
    document.getElementById('eval-bar-top')!,
    document.getElementById('eval-controls')!,
    // Starts disabled: the engine is armed by the dock icon (setEngineOn) or, on
    // a builder that opens with it already on, by onActiveSlide — both go through
    // setEnabled, whose onToggle reveals the docked eval bar.
    false,
    (enabled) => {
      if (enabled) {
        engine.enable();
        engine.evaluate(chess.fen());
      } else {
        engine.disable();
        evalPanel.clear();
      }
      // Slide the docked eval bar (it sits above the bottom bar) open or closed by
      // animating its height, keeping the sheet above it in step — so nothing
      // jumps when it appears; it just slides up, and slides back down when off.
      animateEvalDock(enabled);
    },
    (uci) => playUci(uci),
    {
      compact: true,
      showToggle: false,
      // The docked bar's "Lichess off" warning: reset the cloud breaker and
      // re-ask about the position on the board.
      onRetryCloud: () => { retryCloudNow(); void engine.evaluate(chess.fen()); },
    },
  );

  // The dock's engine icon is the one on/off switch for the engine, in both the
  // board builder and the game analyser (they share this dock).
  const engineDockBtn = document.getElementById('builder-engine') as HTMLButtonElement | null;
  engineDockBtn?.addEventListener('click', () => setEngineOn(!engineOn));
  updateEngineDockBtn();

  // Discrete show/hide-arrows toggle, sat right next to the source badge (e.g.
  // "local · d20"). An icon (rather than a text button) keeps the docked row
  // roomy. It only controls whether the engine's top-3 arrows are drawn.
  const evalSourceEl = document.getElementById('eval-source')!;
  const arrowsToggleBtn = document.createElement('button');
  arrowsToggleBtn.type = 'button';
  arrowsToggleBtn.className = 'eval-arrows-toggle';
  arrowsToggleBtn.appendChild(Icons.moveArrow(15));
  const syncArrowsBtn = (): void => {
    arrowsToggleBtn.classList.toggle('is-on', showEngineArrows);
    arrowsToggleBtn.setAttribute('aria-pressed', String(showEngineArrows));
    const label = showEngineArrows ? 'Hide engine arrows' : 'Show engine arrows';
    arrowsToggleBtn.setAttribute('aria-label', label);
    arrowsToggleBtn.title = label;
  };
  syncArrowsBtn();
  arrowsToggleBtn.addEventListener('click', () => {
    showEngineArrows = !showEngineArrows;
    setShowEngineArrows(showEngineArrows);
    syncArrowsBtn();
    refreshBoardShapes();
  });
  evalSourceEl.insertAdjacentElement('afterend', arrowsToggleBtn);

  // The Library / Games carousel slides — they read the live builder position
  // and play a tapped continuation straight onto the line.
  builderPanels = createBuilderPanels({
    libraryEl: document.getElementById('slide-library-content')!,
    gamesEl: document.getElementById('slide-games-content')!,
    scoutingEl: document.getElementById('slide-scouting')!,
    contentEl: document.getElementById('slide-learn')!,
    getSans: currentPathSans,
    getUcis: currentPathUcis,
    getFens: currentPathFens,
    getFen: () => chess.fen(),
    getColour: () => saveColour,
    isAnalyser: () => builderMode === 'analyser',
    onPlay: (uci) => playUci(uci),
    // My games empty-state import button.
    onImportGames: () => openImportPanel({
      onImported: () => { builderPanels?.reload(); builderPanels?.render(); },
    }),
    // Scouting: import a new opponent, and jump to an opponent's full report.
    onImportOpponent: () => importOpponentFlow(() => builderPanels?.reloadOpponents()),
    onOpenOpponentReport: (id: string) => { openExploreOpponent(id); showView('explore'); },
    // My lines "Show tree": open the tapped saved line in the builder.
    onOpenLine,
  });

  setupSaveButton();
  setupPlaybackControls();
  setupTitleControls();
  setupNoteBlock();
  setupMoveNav();
  setupAnalyseGameButton();
  setupBuilderCarousel();
  setupBuilderPanelHandle();

  // Mount the global FAB before the first showView, so its initial visibility is
  // set correctly when we land on Train.
  fabController = mountFab(buildFabActions);

  new ResizeObserver(() => cg.redrawAll()).observe(boardEl);

  // Land on the Train screen — the app's start view. The board (in the builder)
  // was created above while visible, so chessground sized itself correctly
  // before we switch away.
  showView('train');

  // Drop the boot splash once the Train screen's gating data (the lines) has
  // loaded — so the launch shows the app icon rather than a bare "Loading…",
  // then reveals a populated screen. A short fallback guarantees it never sticks.
  hideAppSplashWhenReady();

  // Now that cg/builder exist, replay a "Connect to Lichess" return if one is
  // pending (the OAuth callback may have resolved before boot finished). This
  // overrides the Train landing above, dropping the user back in the builder.
  appBooted = true;
  maybeRestoreLichessReturn();

  // A week after install, invite beta testers to the survey with a slim banner
  // (shown once per session until they submit — see survey.ts).
  maybeShowSurveyBanner();

  // First launch: play the intro, then the setup wizard, landing back on Train
  // when both are done (an import there refreshes Train's view). The intro shows
  // once — see onboarding.ts. If the app rebooted mid-wizard (a Lichess OAuth
  // redirect away and back from the wizard's Connect step), skip straight to
  // resuming the wizard at its stashed step instead of replaying the intro.
  if (wizardStepPending()) {
    showOnboardingWizard({ onFinish: () => showView('train') });
  } else {
    maybeShowIntro({
      onFinish: () => showOnboardingWizard({ onFinish: () => showView('train') }),
    });
  }

  // Weekly games auto-refresh: runs after the first view has rendered, never
  // blocks launch, and stays silent on zero or on failure. New games trigger a
  // toast and re-render the current tab so game-derived views pick them up
  // (Statistics win rates, From-my-games suggestions, scout aggregates) exactly
  // as they would after a manual import.
  void maybeAutoRefreshGames().then((newCount) => {
    if (newCount <= 0) return;
    showToast(`Games refreshed · ${newCount} new`);
    if (currentView !== 'builder') showView(currentView);
  });
}));
