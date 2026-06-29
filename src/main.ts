import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';
import { addMove, goTo, mainline, pathTo, getCurrentNode, reset, isEmpty, serialise, loadTree, removeLastMove, truncateAfterCurrent, setTreeMode, rootNode } from './tree';
import type { Annotation, MoveNode } from './tree';
import { saveLine, getAllLines, getGame, saveGames } from './storage';
import type { ImportedGame } from './import-games';
import { nameForPath } from './openings';
import type { Line } from './types';
import { renderLinesScreen, focusSavedLine } from './lines-screen';
import { renderProgressScreen } from './progress-screen';
import { startPretrainingRun, enrolLineDirectly } from './pretraining';
import { renderTrainScreen, startLineSession } from './train-screen';
import { renderExploreScreen } from './explore-screen';
import { renderPuzzlesScreen, startDailyPuzzles } from './puzzles-screen';
import {
  renderDailyChallenge,
  pickDailyLines,
  markLinesDone,
  markPuzzlesDone,
  DAILY_PUZZLE_GOAL,
} from './daily-challenge';
import { renderMyGamesScreen, formatGameDate } from './my-games-screen';
import { opponentTag } from './scout';
import { renderSettingsScreen } from './settings-screen';
import { Engine, setCloudAuthToken, type EvalResult } from './engine';
import { EvalPanel } from './eval-panel';
import { createBuilderPanels, type BuilderPanels } from './builder-panels';
import { initTheme } from './theme';
import { initAppearance } from './appearance';
import { watchSpeedMs, getConfirmRunBeforeTraining, getScoutingEnabled, getShowEngineArrows, setShowEngineArrows, getShowMoveClassifications } from './prefs';
import { reviewLine, clearClassifications, type ReviewSummary } from './review';
import { renderLineAnalysis, hasReview } from './line-analysis';
import { createPawnProgress, type PawnProgress } from './import-progress';
import { initBackNav, setViewBack, pushBack } from './back-nav';
import { showDialog } from './dialog';
import { openImportPanel, getGamesSource, IDENTITY_CHANGED_EVENT } from './import-panel';
import { maybeShowIntro } from './onboarding';
import { openStarterPackPicker } from './onboarding-starter';
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
    return;
  }
  el.hidden = false;
  for (const t of currentTags) {
    const chip = document.createElement('span');
    chip.className = 'builder-tag';
    chip.textContent = t;
    el.appendChild(chip);
  }
}

// A transient one-line hint shown under the title/actions — used when the builder
// is seeded from a trap, to carry the trap's bait/idea across (the card itself
// stays uncluttered). Display-only: it isn't part of the saved Line, and it's
// cleared whenever a fresh line starts (clearBuilder).
let builderDesc = '';

function renderBuilderDesc(): void {
  const el = document.getElementById('builder-desc')!;
  const text = builderDesc.trim();
  // In the analyser, show the game date next to "vs <opponent>".
  const full = text && builderGameDate ? `${text} · ${builderGameDate}` : (text || builderGameDate);
  el.textContent = full;
  el.hidden = full.length === 0;
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

  // Tags (tag icon): suggested chips + freeform field.
  let chipRow: HTMLElement | null = null;
  let freeInput: HTMLInputElement | null = null;
  if (focus === 'tags') {
    const tagsLabel = document.createElement('label');
    tagsLabel.className = 'edit-label';
    tagsLabel.textContent = 'Tags';
    sheet.appendChild(tagsLabel);

    chipRow = document.createElement('div');
    chipRow.className = 'edit-chips';
    for (const tag of SUGGESTED_TAGS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip';
      chip.textContent = tag;
      if (currentTags.includes(tag)) chip.classList.add('tag-chip--on');
      chip.addEventListener('click', () => chip.classList.toggle('tag-chip--on'));
      chipRow.appendChild(chip);
    }
    sheet.appendChild(chipRow);

    freeInput = document.createElement('input');
    freeInput.type = 'text';
    freeInput.className = 'edit-input';
    freeInput.placeholder = 'your own tags, comma, separated';
    freeInput.value = currentTags
      .filter(t => !SUGGESTED_TAGS.includes(t as typeof SUGGESTED_TAGS[number]))
      .join(', ');
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
      const custom = freeInput.value.split(',').map(t => t.trim()).filter(Boolean);
      currentTags = [...new Set([...selected, ...custom])];
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
  // Game-review grade in the notation: a colour marker, no icon. Every graded
  // move is tinted in its class colour (the full glyphs live on the board
  // badge); the error moves get a stronger marker so mistakes still stand out.
  if (node.classification && getShowMoveClassifications()) {
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
// the Engine / Library / My-lines panels (item 2). One render fills them all, so
// game-review colours show wherever you are without leaving the panel.
const MOVE_LIST_MOUNTS = ['move-list', 'move-list-engine', 'move-list-library', 'move-list-games'];

function renderMoveList() {
  for (const id of MOVE_LIST_MOUNTS) {
    const el = document.getElementById(id);
    if (el) renderMoveListInto(el);
  }
  updateMoveNavButtons();
  refreshReviewButtonState();
  refreshLineAnalysis();
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

// The Analyse button has three looks: default (idle), lit (--on, a review is
// running) and passive (--done, the line on the board has already been graded).
// Driven from renderMoveList so it tracks every board change — editing a move
// adds an ungraded node, which drops the passive look automatically.
function refreshReviewButtonState(): void {
  const btn = document.getElementById('builder-review');
  if (!btn) return;
  if (reviewAbort) { btn.classList.remove('bar-btn--done'); return; }
  const analysed = mainline().some(n => n.classification);
  btn.classList.toggle('bar-btn--done', analysed);
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

// The bar's import icon (next to Flip): open the "Import a game" popup — last
// game / browse recent / paste PGN — and load whatever's chosen onto the board.
// Imports now live on the My games tab (see openMyGamesImport); the builder's own
// import icon was removed.
function openMyGamesImport(): void {
  openBuilderImport({
    onLoadGame: (ucis, colour, description, gameId, endTime) =>
      openImportedGame(ucis, colour, description, gameId, endTime),
    onGamesChanged: () => { builderPanels?.reload(); },
  });
}

// Open a SAVED game (from the My games list) in the analyser. If it already has
// a saved analysis, restore it (variations + review intact) and skip the review;
// otherwise lay its moves down and analyse from scratch.
function openGameForAnalysis(game: ImportedGame): void {
  const tags = game.tags ?? [];
  if (game.analysis?.tree) {
    buildFromTree(game.analysis.tree, game.colour, `vs ${game.opponent}`, tags, game.endTime);
    builderEngine = game.analysis.engine;
    renderMoveList(); // repaint so the restored review's engine tag shows
  } else {
    buildFromUcis(game.ucis, game.colour, tags, { description: `vs ${game.opponent}`, analyser: true, gameDate: game.endTime });
    autoReview();
  }
  analyserGameId = game.id; // after build — clearBuilder resets it to null
  // The just-loaded game matches what's stored — only *your* variations/notes make
  // it dirty (the auto-review's classifications are stripped from the snapshot), so
  // an untouched game closes without the save prompt.
  savedSnapshot = builderSnapshot();
}

// Open a freshly imported/pasted game (no saved analysis yet) in the analyser and
// review it. gameId is set when the game is in the store (so a later Save can
// attach the analysis); a pasted PGN has none.
function openImportedGame(ucis: string[], colour: 'white' | 'black', description?: string, gameId?: string, endTime?: number): void {
  buildFromUcis(ucis, colour, [], { description, analyser: true, gameDate: endTime });
  analyserGameId = gameId ?? null; // after build — clearBuilder resets it
  autoReview();
  // Baseline the freshly-opened game so only your own edits trigger the save guard.
  savedSnapshot = builderSnapshot();
}

function autoReview(): void {
  const btn = document.getElementById('builder-review') as HTMLButtonElement | null;
  if (btn && !reviewAbort) void runGameReview(btn);
}

// ── Game Review (the bottom-bar Review icon) ────────────────────────────────
// Runs a Chess.com-style review over the line currently on the board — works the
// same for a hand-built line and an imported game (both live on this one board).
// Grades paint in as each move resolves; a second tap cancels a run in progress.
let reviewAbort: AbortController | null = null;
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

function setupBuilderReviewButton(): void {
  document.getElementById('builder-review')?.addEventListener('click', (e) => {
    void runGameReview(e.currentTarget as HTMLButtonElement);
  });
}

async function runGameReview(btn: HTMLButtonElement): Promise<void> {
  // A second tap while running cancels.
  if (reviewAbort) {
    reviewAbort.abort();
    reviewAbort = null;
    btn.classList.remove('bar-btn--on');
    showToast('Review stopped.');
    return;
  }

  const nodes = mainline();
  if (!nodes.length) { showToast('No moves to review yet.'); return; }

  const ctrl = new AbortController();
  reviewAbort = ctrl;
  builderEngine = 'none';
  btn.classList.add('bar-btn--on');
  clearClassifications(nodes);
  renderMoveList();
  refreshBoardBadge();
  const total = nodes.length;
  const bar = reviewBar();
  bar.start();
  showToast(getShowMoveClassifications()
    ? 'Reviewing game…'
    : 'Reviewing game… (turn on move highlights in Settings to see it)');

  try {
    const summary = await reviewLine(nodes, {
      useEngineFallback: true,
      signal: ctrl.signal,
      onProgress: (i) => {
        bar.set(total ? (i + 1) / total : 1);
        renderMoveList();
        refreshBoardBadge();
      },
    });
    builderEngine = summary.engine;
    if (!ctrl.signal.aborted) showToast('Game review complete.');
  } catch {
    if (!ctrl.signal.aborted) showToast('Couldn’t finish the review.');
  } finally {
    if (reviewAbort === ctrl) reviewAbort = null;
    btn.classList.remove('bar-btn--on');
    bar.done();
    bar.hide();
    renderMoveList();
    refreshBoardBadge();
  }
}

// The Line-tab analysis block (eval graph + move-type summary + engine tag).
// Shown only for an imported/loaded game ("vs <name>") that's been reviewed.
function refreshLineAnalysis(): void {
  const host = document.getElementById('line-analysis');
  if (!host) return;
  const nodes = mainline();
  const isImportedGame = builderDesc.startsWith('vs ');
  if (!isImportedGame || !getShowMoveClassifications() || !hasReview(nodes)) {
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

// Carousel slide indices: 0 Line, 1 Engine, 2 Library, 3 My games, 4 Scouting.
const LIBRARY_SLIDE = 2;
const ENGINE_SLIDE = 1;
const SCOUTING_SLIDE = 4;
let activeSlide = 0;
// When opening the builder from an external link, the tab to land on (and an
// opponent to preselect on the Scouting tab). Consumed in showView('builder').
let pendingBuilderSlide: number | null = null;
let pendingScoutOpponentId: string | null = null;

// React to the active slide changing (by tap or swipe): repaint the tabs and,
// on the Engine slide, turn the engine on by default so it's ready without a tap.
function onActiveSlide(index: number): void {
  document.querySelectorAll<HTMLElement>('#builder-slide-tabs .slide-tab').forEach(tab => {
    const on = Number(tab.dataset.slide) === index;
    tab.classList.toggle('slide-tab--on', on);
    tab.setAttribute('aria-selected', String(on));
  });
  if (index === activeSlide) return;
  activeSlide = index;
  builderPanels?.setActiveSlide(index);
  // The engine runs only while its tab is showing: on when you land on it, off
  // when you leave. There's no on/off toggle — the tab IS the switch.
  if (evalPanel) evalPanel.setEnabled(index === ENGINE_SLIDE);
  // Suggested-move arrows are an Engine-tab-only thing — leaving the tab swaps
  // them for the move's game-review badge (if any) rather than waiting on the
  // engine to wind down.
  if (index !== ENGINE_SLIDE && cg) refreshBoardBadge();
}

// Draw arrows for the engine's top 3 candidates on the board — gated on the
// Engine tab being the one showing (so they can't linger while you're editing
// a different slide), the engine actually being on, the arrows toggle, and the
// result still matching the live position (engine replies can lag a move).
function drawEngineArrows(result: EvalResult | null): void {
  if (!result || !showEngineArrows || activeSlide !== ENGINE_SLIDE || !engine.isEnabled || result.fen !== chess.fen()) {
    cg.setAutoShapes([]);
    return;
  }
  const brushes = ['eng1', 'eng2', 'eng3'];
  cg.setAutoShapes(result.moves.slice(0, 3).map((m, i) => ({
    orig: m.uci.slice(0, 2) as Key,
    dest: m.uci.slice(2, 4) as Key,
    brush: brushes[i],
  })));
}

// Show the active move's game-review badge on its destination square — the
// non-engine-slide counterpart of the engine arrows. Cleared when classifications
// are off, on the root, on an un-graded move, or while the Engine tab owns the
// board (it draws arrows there instead).
function refreshBoardBadge(): void {
  if (!cg) return;
  const node = getCurrentNode();
  const show = activeSlide !== ENGINE_SLIDE && getShowMoveClassifications()
    && node.id !== 'root' && !!node.classification && !!node.uci;
  if (show) {
    const sq = node.uci.slice(2, 4) as Key;
    // The corner badge rides above the piece (a customSvg autoshape); the square
    // wash sits BELOW the piece (a square highlight) so the piece itself never
    // changes colour — only its square does.
    cg.setAutoShapes([{ orig: sq, customSvg: classBoardSvg(node.classification!) }]);
    setReviewSquare(sq, node.classification!);
  } else {
    // Engine slide owns the autoshapes (its arrows) — leave them; just drop the
    // review wash. Off the engine slide, clear both.
    if (activeSlide !== ENGINE_SLIDE) cg.setAutoShapes([]);
    setReviewSquare(null);
  }
}

// Paint (or clear) the review wash on a single square via chessground's custom
// square highlights, which style the <square> element underneath the pieces.
function setReviewSquare(sq: Key | null, cls?: string): void {
  const custom = new Map<Key, string>();
  if (sq && cls) custom.set(sq, `review-sq review-sq--${cls}`);
  cg.set({ highlight: { custom } });
}

// Show or hide the builder's Scouting tab (and its slide) to match the Settings
// toggle. With scouting off the carousel has four tabs — Line / Library / My
// games / Engine — and the other slides keep their indices, so nothing else
// shifts. Opponents stay in storage; flipping the toggle back brings the tab
// straight back.
function syncScoutingTab(): void {
  const enabled = getScoutingEnabled();
  const tab = document.querySelector<HTMLElement>('#builder-slide-tabs .slide-tab[data-slide="4"]');
  const slide = document.getElementById('slide-scouting');
  if (tab) tab.hidden = !enabled;
  if (slide) slide.hidden = !enabled;
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

function sheetMetrics(): { barH: number; defaultH: number; fullH: number } {
  const board = document.getElementById('board-wrap');
  const dock = document.getElementById('builder-dock');
  const barH = dock?.offsetHeight ?? 56;
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
function applySheetHeight(h: number): void {
  const sheet = document.getElementById('builder-sheet');
  if (!sheet) return;
  sheet.style.bottom = `${sheetMetrics().barH}px`;
  sheet.style.height = `${h}px`;
}

function layoutBuilderSheet(): void {
  if (currentView !== 'builder') return;
  const m = sheetMetrics();
  applySheetHeight(sheetState === 'full' ? m.fullH : m.defaultH);
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

  window.addEventListener('resize', layoutBuilderSheet);
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
  evalPanel.clear();
  refreshBoardBadge();
  engine.evaluate(chess.fen());
}

// Play a move given as UCI (e.g. from a clicked engine recommendation) at the
// current position: same effect as making it on the board.
function playUci(uci: string): void {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = (uci[4] as 'q' | 'r' | 'b' | 'n') || 'q';
  const result = chess.move({ from, to, promotion });
  if (!result) return;

  const fullUci = from + to + (result.promotion ?? '');
  addMove(result.san, fullUci, chess.fen());
  cg.set({
    fen: chess.fen(),
    turnColor: turnColor(),
    movable: { color: 'both', dests: legalDests() },
    lastMove: [from as Key, to as Key],
  });

  renderMoveList();
  renderMoveDetails();
  updateOpeningName();
  evalPanel.clear();
  engine.evaluate(chess.fen());
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

// When a line is loaded from My Lines, stash its id and createdAt so
// a subsequent Save updates the same line instead of creating a duplicate.
let loadedLineId: string | null = null;
let loadedLineCreatedAt: number | undefined;
let loadedLineInTraining = false;

// The currently loaded/saved line — used to preserve training data (confidence,
// schedule, inTraining) when re-saving an existing line.
let currentTrainingLine: Line | null = null;

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
  evalPanel.clear();
  engine.evaluate(chess.fen());
}

// The header save button reads "Save changes" when editing an existing line,
// and "Save line" for a fresh one — standard create-vs-edit wording.
function updateSaveButtonLabel(): void {
  const label = document.getElementById('header-save-label');
  if (label) {
    label.textContent = builderMode === 'analyser' ? 'Save game'
      : loadedLineId ? 'Save changes' : 'Save line';
  }
  // The "save this line to my repertoire" action only makes sense in the analyser.
  const saveLineBtn = document.getElementById('save-line-btn');
  if (saveLineBtn) saveLineBtn.hidden = builderMode !== 'analyser';
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
  evalPanel.clear();
  engine.evaluate(chess.fen());
  builderPanels?.render(); // reset to the start position's continuations
}

// Open the builder on a fresh line of the given colour (from Home's Add buttons).
function startNewLine(colour: 'white' | 'black'): void {
  clearBuilder(colour);
  showView('builder');
}

// Open the builder on a specific carousel tab (e.g. an external "browse the
// opening library" link lands straight on the Library tab). `fresh` starts a new
// empty line of `colour` first.
function openBuilderTab(slide: number, opts: { fresh?: boolean; colour?: 'white' | 'black' } = {}): void {
  if (opts.fresh) clearBuilder(opts.colour ?? 'white');
  pendingBuilderSlide = slide;
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
  opts: { description?: string; analyser?: boolean; gameDate?: number } = {},
): void {
  clearBuilder(colour);
  currentTags = [...tags];
  builderDesc = opts.description ?? '';
  builderGameDate = formatGameDate(opts.gameDate);
  // Lay the game's moves down as a single main line first…
  for (const uci of ucis) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = (uci[4] as 'q' | 'r' | 'b' | 'n') || 'q';
    const result = chess.move({ from, to, promotion });
    if (!result) break; // stop on an illegal move rather than corrupt the tree
    addMove(result.san, from + to + (result.promotion ?? ''), chess.fen());
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
  evalPanel.clear();
  refreshBoardBadge();
  engine.evaluate(chess.fen());
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
  evalPanel.clear();
  refreshBoardBadge();
  engine.evaluate(chess.fen());
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
      opts?: { description?: string },
    ) => buildFromUcis(ucis, colour, [], opts),
    // The opponent "board browser" now opens the builder's Scouting tab.
    onScoutInBuilder: (opponentId: string) => scoutInBuilder(opponentId),
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
// it with my games (deduped), and open it on the board to save as a line.
async function runImportLastGame(): Promise<void> {
  showToast('Fetching your last game…');
  try {
    const game = await importLastGame();
    if (!game) { showToast('No recent game found to import.'); return; }
    // Surface who the game was against, mirroring scouting's "vs <name>".
    buildFromUcis(game.ucis, game.colour, [], { description: `vs ${game.opponent}` });
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
  ucis: string[],
  colour: 'white' | 'black',
  learn: boolean,
  onDone: () => void,
  onCancel: () => void,
): void {
  const line = lineFromUcis(ucis, colour);
  if (!line) { onCancel(); return; }
  if (learn) addLineToTraining(line, onDone, onCancel);
  else void enrolLineDirectly(line).then(onDone);
}

function lineFromUcis(ucis: string[], colour: 'white' | 'black'): Line | null {
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
    cursor.children.push(node);
    cursor = node;
  }
  if (root.children.length === 0) return null;
  const opening = nameForPath(fens);
  return {
    id: crypto.randomUUID(),
    name: opening ?? 'Untitled line',
    tags: [],
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
      ? (builderMode === 'analyser' ? (builderDesc || 'Unknown') : (currentTitle() || 'New line'))
    : currentView === 'settings' ? 'Settings'
    : 'Obertura';
  el.classList.toggle('header-title--screen', !onTab);
}

// The Train screen now has two top tabs (My Lines style): Openings (the training
// home) and Puzzles (what used to be its own bottom-nav tab). The active pane is
// rendered lazily so each screen's render side effects only run when shown.
type TrainTab = 'openings' | 'puzzles';
let trainTab: TrainTab = 'openings';

function renderTrainTabbed(host: HTMLElement): void {
  host.innerHTML = '';

  const tabs = document.createElement('div');
  tabs.className = 'lines-tabs';
  const mkTab = (tab: TrainTab, label: string, icon: SVGElement): HTMLButtonElement => {
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
    btn.addEventListener('click', () => { if (trainTab !== tab) { trainTab = tab; paint(); } });
    return btn;
  };
  tabs.appendChild(mkTab('openings', 'Openings', Icons.zap(18)));
  tabs.appendChild(mkTab('puzzles', 'Puzzles', Icons.puzzlePiece(18)));

  // The daily-challenge card sits above the tabs — it spans both halves (lines and
  // puzzles), so it's the shared daily face of the Train screen.
  const dailyHost = document.createElement('div');
  dailyHost.className = 'daily-host';
  const openingsPane = document.createElement('div');
  const puzzlesPane = document.createElement('div');
  host.append(dailyHost, tabs, openingsPane, puzzlesPane);

  // (Re)render the daily card from current lines + done state. Called on first
  // paint and after either half completes.
  const renderDaily = async (): Promise<void> => {
    let allLines: Line[];
    try {
      allLines = await getAllLines();
    } catch {
      dailyHost.innerHTML = '';
      return;
    }
    dailyHost.innerHTML = '';
    const card = renderDailyChallenge({
      lines: pickDailyLines(allLines),
      onTrainLines: (lines) => {
        // Drill today's lines on the Openings pane; mark the half done when the
        // whole sitting finishes, then refresh the card behind the overlay.
        if (trainTab !== 'openings') { trainTab = 'openings'; paint(); }
        startLineSession(lines, openingsPane, () => { markLinesDone(); void renderDaily(); });
      },
      onSolvePuzzles: () => {
        void startDailyPuzzles(DAILY_PUZZLE_GOAL, () => { markPuzzlesDone(); void renderDaily(); });
      },
    });
    if (card) dailyHost.appendChild(card);
  };
  void renderDaily();

  const paint = (): void => {
    tabs.querySelectorAll<HTMLElement>('.lines-tab').forEach(b => {
      const on = b.dataset.tab === trainTab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-current', on ? 'true' : 'false');
    });
    openingsPane.hidden = trainTab !== 'openings';
    puzzlesPane.hidden = trainTab !== 'puzzles';
    if (trainTab === 'openings') {
      renderTrainScreen(openingsPane, {
        focusLineId: pendingTrainLineId ?? undefined,
        onOpenLine,
        onBuildLine: () => startNewLine('white'),
        onImportGames: () => showView('games'),
        onAddStarterLine: addStarterLine,
        onBrowseLibrary: () => openBuilderTab(LIBRARY_SLIDE, { fresh: true, colour: 'white' }),
        onBuildWithEngine: () => openBuilderTab(ENGINE_SLIDE, { fresh: true, colour: 'white' }),
        onSetFabVisible: (visible) => fabController?.setVisible(visible),
      });
      pendingTrainLineId = null;
    } else {
      void renderPuzzlesScreen(puzzlesPane, {
        onImportGames: () => showView('games'),
        onBuildLine: () => startNewLine('white'),
        onConnectLichess: () => void lichessConnect(),
      });
    }
  };
  paint();
}

function showView(view: ViewName): void {
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
  // the builder (Save takes its place) and the Settings screen itself.
  const onBuilder = view === 'builder';
  document.getElementById('header-save')!.toggleAttribute('hidden', !onBuilder);
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
      onImport: openMyGamesImport,
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
    // Reflect the scouting toggle before we land on a slide, so a hidden
    // Scouting tab can't be the target.
    syncScoutingTab();
    // Land on the Line tab by default (engine off); an external link can request
    // a different tab via pendingBuilderSlide. Forcing activeSlide to a sentinel
    // makes onActiveSlide run fully (so the engine state is set correctly).
    let slide = pendingBuilderSlide ?? 0;
    pendingBuilderSlide = null;
    if (slide === SCOUTING_SLIDE && !getScoutingEnabled()) slide = 0;
    if (pendingScoutOpponentId) {
      builderPanels?.selectOpponent(pendingScoutOpponentId);
      pendingScoutOpponentId = null;
    }
    const track = document.getElementById('builder-carousel');
    if (track) track.scrollLeft = slide * track.clientWidth;
    activeSlide = -1;
    onActiveSlide(slide);
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
      await saveGames([game]);
      savedSnapshot = builderSnapshot();
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

  const doSave = async (): Promise<void> => {
    const line = lineFromUcis(ucis, saveColour);
    if (!line) { showToast('Couldn’t build a line here'); return; }
    await saveLine(line);
    builderPanels?.reloadLines();
    showToast('Saved to My Lines ✓');
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
  showToast(isNew ? 'Line saved ✓' : 'Changes saved ✓');
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
        const result = chess.move({ from, to, promotion: 'q' });
        if (!result) return;
        const uci = from + to + (result.promotion ?? '');
        addMove(result.san, uci, chess.fen());
        cg.set({
          turnColor: turnColor(),
          movable: {
            color: 'both',
            dests: legalDests(),
          },
        });
        renderMoveList();
        renderMoveDetails();
        updateOpeningName();
        evalPanel.clear();
        cg.setAutoShapes([]);
        engine.evaluate(chess.fen());
      },
    },
  });

  // Decreasing-opacity arrows for the engine's top 3 candidates — same brushes
  // as the spar overlay's "build with engine" mode (spar.ts).
  cg.state.drawable.brushes['eng1'] = { key: 'eng1', color: '#3a9a5c', opacity: 0.9, lineWidth: 11 };
  cg.state.drawable.brushes['eng2'] = { key: 'eng2', color: '#3a9a5c', opacity: 0.55, lineWidth: 9 };
  cg.state.drawable.brushes['eng3'] = { key: 'eng3', color: '#3a9a5c', opacity: 0.38, lineWidth: 8 };

  // Engine + eval panel — must come after cg is available so evaluate() can read chess.fen().
  engine = new Engine(import.meta.env.BASE_URL, (result) => {
    evalPanel.update(result, chess.fen());
    lastEngineResult = result;
    // On the Engine tab the result drives the suggestion arrows; elsewhere it
    // must not wipe the move's review badge, so just keep the badge in sync.
    if (activeSlide === ENGINE_SLIDE) drawEngineArrows(result);
    else refreshBoardBadge();
  });
  evalPanel = new EvalPanel(
    document.getElementById('eval-bar-top')!,
    // Eval bar + engine lines both live in the Engine slide, so they only show
    // on that tab. The engine is driven by the tab (no on/off toggle here).
    document.getElementById('eval-controls')!,
    engine.isEnabled,
    (enabled) => {
      if (enabled) {
        engine.enable();
        engine.evaluate(chess.fen());
      } else {
        engine.disable();
        evalPanel.clear();
      }
      // The eval bar shows/hides with the engine inside the slide; re-sync
      // chessground's bounds and re-fit the sheet just in case.
      cg.redrawAll();
      requestAnimationFrame(layoutBuilderSheet);
    },
    (uci) => playUci(uci),
  );
  if (engine.isEnabled) {
    engine.enable();
    engine.evaluate(chess.fen());
  }

  // Discrete "Show arrows / Hide arrows" toggle, sat right next to the source
  // badge (e.g. "local · d20"). The engine itself is switched on/off by the tab;
  // this only controls whether its top-3 suggestions are drawn on the board.
  const evalSourceEl = document.getElementById('eval-source')!;
  const arrowsToggleBtn = document.createElement('button');
  arrowsToggleBtn.type = 'button';
  arrowsToggleBtn.className = 'eval-arrows-toggle';
  arrowsToggleBtn.textContent = showEngineArrows ? 'Hide arrows' : 'Show arrows';
  arrowsToggleBtn.addEventListener('click', () => {
    showEngineArrows = !showEngineArrows;
    setShowEngineArrows(showEngineArrows);
    arrowsToggleBtn.textContent = showEngineArrows ? 'Hide arrows' : 'Show arrows';
    drawEngineArrows(lastEngineResult);
  });
  evalSourceEl.insertAdjacentElement('afterend', arrowsToggleBtn);

  // The Library / Games carousel slides — they read the live builder position
  // and play a tapped continuation straight onto the line.
  builderPanels = createBuilderPanels({
    libraryEl: document.getElementById('slide-library-content')!,
    gamesEl: document.getElementById('slide-games-content')!,
    scoutingEl: document.getElementById('slide-scouting')!,
    getSans: currentPathSans,
    getUcis: currentPathUcis,
    getFen: () => chess.fen(),
    getColour: () => saveColour,
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
  setupBuilderReviewButton();
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
