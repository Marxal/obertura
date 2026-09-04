import { Chess, type Square } from 'chess.js';
import { registerBrushes, HINT_COLOR } from './board-brushes';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';
import { addMove, goTo, mainline, pathTo, getCurrentNode, reset, isEmpty, serialise, loadTree, removeLastMove, truncateAfterCurrent, setTreeMode, rootNode, hasMove, currentLineNodes } from './tree';
import {
  openBook, closeBook, activeBook, notePending, pendingCount, hasPending,
  isPending, discardPending, commitPending, currentLine as bookCurrentLine,
  cursorCoverage, pendingBranches, pendingLines, lineForEnd, discardBranch,
  removeManyAndStore,
  planLineRemoval, removeAndStore, restoreAndStore,
} from './builder-book';
import { describeRemoval, removalBody, removalDone, removalTitle } from './line-removal';
import { nodeAtPath, isUserMoveAtDepth, type DetachedSubtree } from './repertoire';
import { openBranchSheet } from './branch-sheet';
import { parseLineId } from './lines-view';
import { selectedBookId } from './repertoire-picker';
import { mainlineNodes, DEFAULT_PRIORITY } from './scheduler';
import type { Annotation, MoveNode } from './tree';
import { saveLine, getAllLines, getLine, getAllGames, getGame, saveGames, deleteLine, deleteGame, purgeRetiredLocalKeys, countGames, getAllOpponents } from './storage';
import type { ImportedGame } from './import-games';
import { nameForPath } from './openings';
import { positionIndex, type DuplicateVerdict } from './position-index';
import { inheritReviews, inheritanceNote, missingTags, type InheritResult } from './save-index';
import type { Line, LinePriority } from './types';
import { renderLinesScreen, focusSavedLine } from './lines-screen';
import { renderProgressScreen } from './progress-screen';
import { startPretrainingRun, enrolLineDirectly } from './pretraining';
import {
  initEntitlement,
  requestTrainingSlot,
  showGoProDialog,
  ENTITLEMENT_CHANGE_EVENT,
} from './entitlement';
import { handlePurchaseReturn } from './checkout';
import { primePricing } from './pricing';
import { renderTrainScreen, startLineSession, startPositionsSession, startMoveFix } from './train-screen';
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
  markDetectiveDone,
  markWhichMoveDone,
  markGrowLinesDone,
  isDailyDone,
  perfectDayEligible,
  type DailyTaskId,
  type DailyConfig,
} from './daily-challenge';
import {
  growCandidates, pickGrowSpots, firstGrowTarget, growGameIndex, growScoutIndex,
  type GrowSources, type GrowSpot,
} from './grow-line';
import { growDueMap, restGrowLine, GROW_SKIP_DAYS, GROW_GROWN_DAYS } from './grow-log';
import { createGrowPanel, type GrowPanel } from './grow-panel';
import { buildBook, bookNodeAt, loadBookEntries } from './book-tree';
import { buildRecap, getDailyLog, localDayKey, markDayComplete, type TaskOutcome } from './daily-recap';
import { showRecapForDay } from './daily-review';
import { showDailyCelebration, showPerfectDayCelebration, showWhenClear } from './daily-celebration';
import { track, trackOnce, trackAppOpen } from './metrics';
import { currentStreak, getTrainingDays } from './streak';
import { masteredLines } from './stats';
import { collectSpots, pickSpots, type SpotRef } from './mistake-scan';
import { startMistakeSession, type OpenGameCtx } from './mistake-run';
import { collectDetectiveSpots, pickDetective, type DetectiveRef } from './detective';
import { startDetectiveSession } from './detective-run';
import { fairPairs, pickWhichMove } from './which-move';
import { startWhichMoveSession } from './which-move-run';
import { detectiveLog, whichMoveLog } from './middle-log';
import { combinedDueAt } from './spot-rest';
import type { AnalyseRequest as PuzzleAnalyseRequest } from './puzzle-run';
import { renderMyGamesScreen, formatGameDate } from './my-games-screen';
import { opponentTag } from './scout';
import { renderSettingsScreen } from './settings-screen';
import { openSettingsLightbox, isSettingsLightboxOpen, closeSettingsLightbox } from './settings-lightbox';
import { userAvatar } from './avatar';
import { Engine, setCloudAuthToken, retryCloudNow, type EvalResult, type CloudTopMove } from './engine';
import { EvalPanel } from './eval-panel';
import { createBuilderPanels, type BuilderPanels } from './builder-panels';
import { showBuilderInfo, builderInfoLabel, type BuilderInfoId } from './builder-info';
import { renderLinePriority, renderLineStats, renderLineStatsEmpty, linePriority } from './line-info';
import { createExplorePanel, type ExplorePanel } from './explore-panel';
import { createEnginePanel, type EnginePanel } from './engine-panel';
import { initTheme } from './theme';
import { initAppearance } from './appearance';
import { watchSpeedMs, getConfirmRunBeforeTraining, getShowEngineArrows, setShowEngineArrows, getEngineAlwaysOn, setOnboardingComplete } from './prefs';
import { reviewLine, gradeNode, type ReviewSummary } from './review';
import { renderLineAnalysis, hasReview } from './line-analysis';
import { applyBrilliantTag } from './brilliant';
import { createPawnProgress, type PawnProgress } from './import-progress';
import { askPromotion } from './promotion';
import { initBackNav, setViewBack, pushBack } from './back-nav';
import { showDialog } from './dialog';
import { openDraftSheet, type DraftSheetLine } from './draft-sheet';
import { platformLabel } from './board-explorer';
import { openImportPanel, getGamesSource, IDENTITY_CHANGED_EVENT } from './import-panel';
import { openStarterPackPicker, type LineSeed, type AddLineMode } from './onboarding-starter';
import { showOnboardingPicker, shouldShowFirstRun } from './onboarding-picker';
import {
  showBuilderIntro,
  showSaveStep,
  showTrainerIntro,
  isBuilderTourOwed,
  markBuilderTourSeen,
  unmarkBuilderTourSeen,
  notifyBuilderMove,
  takeTourResume,
  hasTourResume,
  BUILDER_MOVE_EVENT,
  REPLAY_WALKTHROUGH_EVENT,
  type BuilderIntroDeps,
  type TourEnd,
  type TourResume,
} from './onboarding-tour';
import { showFirstLineSuccess, handleAuthUrlParam, openSignUpSheet } from './onboarding-signup';
import {
  renderFirstSteps,
  shouldShowFirstSteps,
  firstStepsOwnsSlot,
  TRAINING_UNLOCK_LINES,
} from './first-steps';
import { maybeAutoRefreshGames } from './auto-refresh';
import { startAutoScan } from './mistake-autoscan';
import { startEndgameAutoScan } from './endgame-autoscan';
import { openDailyPrefsSheet } from './daily-prefs';
import { maybeShowGate, promptInstallApp, onInstallAvailable } from './gate';
import { showToast } from './toast';
import { Icons, classBoardSvg, CLASS_LABEL } from './icons';
import { mountFab, type FabItem, type FabAction, type FabSplit, type FabController } from './fab';
import { importLastGame, hasConnectedAccount, connectedAccount } from './import-last';
import { openBuilderImport } from './builder-import';
import { openExploreOpponent, openExploreTab, importOpponentFlow } from './explore-screen';
import { formatMove } from './notation';
import {
  tryCallback as lichessTryCallback,
  takeReturn as lichessTakeReturn,
  getAccessToken as lichessAccessToken,
  connect as lichessConnect,
  stashReturn as lichessStashReturn,
  isConnected as isLichessConnected,
} from './lichess-auth';
import { isSupabaseConfigured } from './supabase';
import { initAuth, isPasswordRecovery, PASSWORD_RECOVERY_EVENT } from './auth';
import {
  initAccountSync,
  isAwaitingAccountCopy,
  reportRestoreOnBoot,
  SYNC_PULLED_EVENT,
} from './repertoire-sync';

// Cloud-eval (engine.ts) uses the Lichess token when connected for higher rate
// limits. Wire the getter once, here, so engine.ts needn't import the OAuth code.
setCloudAuthToken(() => lichessAccessToken());

const chess = new Chess();
let cg!: ReturnType<typeof Chessground>;
let engine!: Engine;
let evalPanel!: EvalPanel;
let builderPanels: BuilderPanels | null = null;
let explorePanel: ExplorePanel | null = null;
let enginePanel: EnginePanel | null = null;
let growPanel: GrowPanel | null = null;
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
  // Nothing on the board yet: prompt the first move rather than show an empty
  // "Unnamed line". Inside a book that means a cursor still at the START — the
  // tree is never empty there (it holds every line you own), and the panel would
  // otherwise describe whichever of them happens to be first.
  if (isEmpty() || (inBook() && getCurrentNode().id === 'root')) {
    el.textContent = 'Play the first move';
    el.classList.add('opening-name--empty');
    if (currentView === 'builder') updateHeaderTitle();
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
// position-driven slides are refreshed for the new position.
function updateOpeningName(): void {
  detectedName = nameForPath(currentPathFens()) ?? '';
  renderTitle();
  builderPanels?.render();
  explorePanel?.render();
  // The Grow tab is a readout of where the cursor stands relative to the line
  // end it asked about, so it repaints with every other position-driven panel —
  // and its candidate arrows come and go with the same step.
  growPanel?.render();
  if (cg) refreshBoardShapes();
  // The engine's previous answer belongs to the previous position; drop it so
  // the Engine tab says "analysing…" instead of showing a stale line.
  enginePanel?.clear();
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

/**
 * The tag lightbox: suggested chips, every tag you've already used, and a
 * freeform field.
 *
 * IT USED TO EDIT THE NAME TOO — the "Title" pencil in the Line info row opened
 * the same sheet on a name field. Both went in the same round: a line's name is
 * the opening it reaches, detected and shown right under the row, and the one
 * control almost nobody used was taking a quarter of a four-across action row on
 * a phone. Branches can still be named by hand, from the branch sheet, which is
 * where naming a chunk of your book actually makes sense.
 */
function openEditSheet(): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet';

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = 'Tags';
  sheet.appendChild(title);

  // The existing-tags row, once loaded — Done reads its toggled chips too.
  let ownRows: HTMLElement | null = null;

  const tagsLabel = document.createElement('label');
  tagsLabel.className = 'edit-label';
  tagsLabel.textContent = 'Tags';
  sheet.appendChild(tagsLabel);

  const chipRow = document.createElement('div');
  chipRow.className = 'edit-chips';
  const addChip = (tag: string): void => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tag-chip';
    chip.textContent = tag;
    if (currentTags.includes(tag)) chip.classList.add('tag-chip--on');
    chip.addEventListener('click', () => chip.classList.toggle('tag-chip--on'));
    chipRow.appendChild(chip);
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

  const freeInput = document.createElement('input');
  freeInput.type = 'text';
  freeInput.className = 'edit-input';
  freeInput.placeholder = 'or type a new tag (comma separated)';
  sheet.appendChild(freeInput);

  const btnRow = document.createElement('div');
  btnRow.className = 'edit-btn-row';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn-primary edit-save-btn';
  saveBtn.textContent = 'Done';
  saveBtn.addEventListener('click', () => {
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
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    freeInput.focus();
    syncKeyboardInset();
  });
}

function setupTitleControls(): void {
  // The hand-written title went with the "Title" button: a line is named by the
  // opening it reaches (detected and shown under this row), and the edit sheet
  // is now reached only for tags.
  document.getElementById('tags-btn')!.addEventListener('click', () => openEditSheet());
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
  // The error moves keep a stronger wash so mistakes still stand out.
  if (node.classification) {
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

// The move list is drawn into two places, and they are two different readings
// of it. The persistent STRIP under the tab bar is on screen whatever tab you're
// on: one line, scrolled, active move centred — it is for keeping your place
// while you build. The BOX at the foot of Line info wraps instead of scrolling,
// so the whole sequence can be read at once, which is what that tab is for.
// (It used to be copied into the foot of every list panel as well — the same
// list four times on one screen, each copy costing a panel a chunk of height.)
const MOVE_LIST_MOUNTS = ['move-list-strip', 'move-list-box'];

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
//
// This is also the one function BOTH save-button triggers already reach — every
// move (via renderMoveList) and every tag change (via renderBuilderTags) — so
// the duplicate check hangs off it rather than off either one.
function refreshSaveButtonState(): void {
  const btn = document.getElementById('header-save') as HTMLButtonElement | null;
  if (!btn) return;
  // Inside a book the button is dead only when it has nothing to say: no draft
  // to add, AND no lines running through the position to lead you to. It used to
  // be disabled whenever there was nothing to add, which is what made "3 lines
  // saved" a label you couldn't tap — the button described your book and then
  // refused to show it to you.
  const here = inBook() ? cursorCoverage() : null;
  btn.disabled = inBook()
    ? !hasPending() && (!here || here.lines === 0)
    : builderMode === 'analyser' && !!analyserGameId && !isBuilderDirty();
  // The duplicate check exists to stop a second copy of a line being created.
  // Inside a book that cannot happen, so it isn't asked.
  if (!inBook()) void refreshDuplicateState();
  else applySaveButtonLabel();
}

// ── "You already have this line" ─────────────────────────────────────────────
//
// TRANSPOSITIONS.md §4 and §5. When the line on the board already exists — same
// moves, same colour — saving it would mint a second copy the user can't tell
// apart from the first, and would split their training across the two. So the
// save button TRANSFORMS into the thing they actually want: open the line they
// already have, or, when the only difference is a tag they've just added (the
// Prepare flow: the same line prepared "vs Anna", later "vs Erik"), add that tag
// to it. It never greys out — a dead primary button is a dead end.
//
// EVALUATED ONLY ON AN EXACT WHOLE-LINE MATCH. A line that is merely a PREFIX of
// a stored one leaves the button completely alone, because mid-build is
// indistinguishable from a prefix: every line you type is a prefix of something
// before it is finished, and a primary button that changes its label on every
// move is unusable.

interface SaveDuplicate {
  // 'open'    — same moves, same colour, nothing new to add.
  // 'add-tag' — same moves, same colour, but this build carries tags it lacks.
  kind: 'open' | 'add-tag';
  lineId: string;
  lineName: string;
  tags: string[]; // the missing ones, for 'add-tag'
}

let saveDuplicate: SaveDuplicate | null = null;
// Fingerprint of the state the current answer was computed for, so the lookup is
// skipped while nothing relevant has changed, and a slow answer that arrives
// after another move can be discarded rather than applied to the wrong line.
let saveDuplicateFor = '';

// Cheap key over everything the check depends on: the moves, the colour and the
// tags. Deliberately NOT the name — a rename must not re-run the check, and the
// name is not part of line identity (TRANSPOSITIONS.md §3).
function duplicateFingerprint(): string {
  if (builderMode === 'analyser' || loadedLineId || isEmpty()) return '';
  return `${saveColour}|${mainline().map(n => n.uci).join(' ')}|${[...currentTags].sort().join(',')}`;
}

async function refreshDuplicateState(): Promise<void> {
  const fingerprint = duplicateFingerprint();
  if (fingerprint === saveDuplicateFor) return;
  saveDuplicateFor = fingerprint;

  // Not a fresh build with moves on it (analyser, an existing line being edited,
  // or an empty board) — the button behaves exactly as it always has.
  if (!fingerprint) {
    if (saveDuplicate) { saveDuplicate = null; applySaveButtonLabel(); }
    return;
  }

  const index = await positionIndex();
  // Another move landed while we were reading storage — that render owns the
  // answer now, so drop this one.
  if (duplicateFingerprint() !== fingerprint) return;

  const line = buildCurrentLine();
  const verdict = index.duplicatesOf(line);
  // ONLY an exact whole-line match. extension-shorter is the prefix case and is
  // pointedly ignored here; it gets a toast AFTER a save instead (§6).
  const next = verdict?.relation === 'identical'
    ? await duplicateFor(line, verdict)
    : null;

  // A second check after the await, for the same reason as the first.
  if (duplicateFingerprint() !== fingerprint) return;
  if (sameDuplicate(next, saveDuplicate)) return;
  saveDuplicate = next;
  applySaveButtonLabel();
}

async function duplicateFor(line: Line, verdict: DuplicateVerdict): Promise<SaveDuplicate | null> {
  // Straight from storage rather than any cached list: the tags decide which of
  // the two offers this is, and a stale copy would offer to add a tag the line
  // already has.
  const stored = await getLine(verdict.otherLineId);
  if (!stored) return null;
  const tags = missingTags(line, stored);
  return {
    kind: tags.length > 0 ? 'add-tag' : 'open',
    lineId: stored.id,
    lineName: stored.name || 'your saved line',
    tags,
  };
}

function sameDuplicate(a: SaveDuplicate | null, b: SaveDuplicate | null): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.lineId === b.lineId && a.tags.join() === b.tags.join();
}

// Fit a line's name inside a header button (or a toast) without it running away.
// The CSS ellipsis is the backstop for the last pixel or two; this stops a truly
// long name from squeezing the header title down to nothing first.
function shortLineName(name: string): string {
  return name.length > 22 ? `${name.slice(0, 21).trimEnd()}…` : name;
}

// The save button's text and icon for the current state. Split out of
// updateSaveButtonLabel so the per-move duplicate check can repaint just this
// — updateSaveButtonLabel also rebuilds the slide strip and five other controls.
function applySaveButtonLabel(): void {
  const label = document.getElementById('header-save-label');
  const btn = document.getElementById('header-save');
  if (!label) return;

  // Inside a book the button counts what it is about to add, which is both
  // honest and cheap — "Save line" would suggest a second copy of a line you are
  // in the middle of. The duplicate transforms are meaningless here: adding a
  // move you already have is walking onto it, so there is nothing to warn about.
  const dup = builderMode === 'builder' && !inBook() ? saveDuplicate : null;
  const pending = inBook() ? pendingCount() : 0;
  // Nothing to add means the path on the board is ALREADY PREPARED, and that is
  // worth saying out loud rather than greying out a button that reads "Nothing".
  // It is the answer to "have I done this one?" without leaving the builder.
  const covered = inBook() && pending === 0 ? coveredLabel() : null;
  label.textContent =
    builderMode === 'analyser' ? 'Save game'
    // An empty book, at the start, with nothing played: there is no count to
    // give and no coverage to report, so the button says what to do instead of
    // offering "Add 0 moves".
    : inBook() && pending === 0 && !covered ? 'Play your first move'
    // The guided first line: this button and the walkthrough's own bubble are
    // the same offer, so they say the same word. "Add 6 moves" is the honest
    // label for adding to a book you already have; on somebody's first minute,
    // beside a bubble that says "save it now", it reads as a different action.
    : inBook() && guidedActive ? 'Save line'
    : inBook() ? (covered ?? draftLabel(pending))
    : dup?.kind === 'open' ? 'Already saved — open it'
    : dup?.kind === 'add-tag' ? `Add tag to “${shortLineName(dup.lineName)}”`
    : loadedLineId ? 'Save changes' : 'Save line';

  btn?.classList.toggle('header-save--alt', !!dup);
  btn?.classList.toggle('header-save--covered', !!covered);
  if (btn) setSaveButtonIcon(btn, covered ? 'covered' : dup?.kind ?? null);
  if (btn) setSaveChevron(btn, !!covered);
}

// The covered button states a fact you can now follow ("2 lines from here" opens
// that branch). The chevron is what says so: without it the button reads as a
// status label, which is precisely what it was before it led anywhere.
function setSaveChevron(btn: HTMLElement, show: boolean): void {
  const chev = btn.querySelector<HTMLElement>('.header-save-chev');
  if (!show) { chev?.remove(); return; }
  if (chev) return;
  const el = document.createElement('span');
  el.className = 'header-save-chev';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = '›';
  btn.appendChild(el);
}

/**
 * What the header says when there IS something to add.
 *
 * "Add 3 moves", and those three moves are on screen: the move strip now draws
 * the WHOLE draft — a second answer played off the same position appears there
 * as a parenthesised variation — so the count can never be bigger than what you
 * can see. It used to be able to, which is what the old "2 places" chip beside
 * this label was apologising for.
 */
function draftLabel(pending: number): string {
  return pending === 1 ? 'Add 1 move' : `Add ${pending} moves`;
}

// What the header says when there is nothing to add: how much of the book runs
// through the position on the board.
//
// Three readings, because the same fact means different things depending on
// where you are standing — at the start it describes the whole book, on a leaf
// it says this exact line is done, and in between it says how many of your
// lines carry on from here. Returns null when the book is empty, so a fresh
// book still prompts for a first move rather than announcing "0 lines".
function coveredLabel(): string | null {
  const at = cursorCoverage();
  if (!at || at.lines === 0) return null;
  if (at.atStart) return at.lines === 1 ? '1 line saved' : `${at.lines} lines saved`;
  if (at.atLineEnd && at.lines === 1) return 'Line saved';
  return at.lines === 1 ? '1 line from here' : `${at.lines} lines from here`;
}

// The disk icon is wrong on a button that no longer saves. Swap the glyph rather
// than dropping it, so the control keeps the same shape as it changes meaning.
const SAVE_ICON_PATHS: Record<'save' | 'open' | 'add-tag' | 'covered', string[]> = {
  // A tick: the path on the board is already in the book.
  covered: ['M20 6 9 17l-5-5'],
  save: [
    'M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    'M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7',
    'M7 3v4a1 1 0 0 0 1 1h7',
  ],
  open: ['M15 3h6v6', 'M10 14 21 3', 'M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5'],
  'add-tag': ['M12 5v14', 'M5 12h14'],
};

function setSaveButtonIcon(btn: HTMLElement, kind: 'open' | 'add-tag' | 'covered' | null): void {
  const svg = btn.querySelector('svg');
  if (!svg) return;
  const want = kind ?? 'save';
  if (svg.dataset.icon === want) return;
  svg.dataset.icon = want;
  svg.innerHTML = SAVE_ICON_PATHS[want].map(d => `<path d="${d}"/>`).join('');
}

// The transformed button's action. Returns true when it handled the tap, so the
// normal save flow (and all three of its nudges) is skipped entirely.
function handleDuplicateSaveTap(): boolean {
  const dup = saveDuplicate;
  if (!dup || builderMode !== 'builder') return false;

  void (async () => {
    const stored = await getLine(dup.lineId);
    // Deleted from another screen since the check ran — fall back to a normal
    // save rather than doing nothing, so the tap is never swallowed.
    if (!stored) {
      saveDuplicate = null;
      saveDuplicateFor = '';
      applySaveButtonLabel();
      void saveCurrentLine();
      return;
    }

    if (dup.kind === 'open') {
      onOpenLine(stored);
      showToast('You already have this line');
      return;
    }

    // Add the missing tags to the line that already exists, then open it. No
    // second copy, and no dialog — there is nothing here to decide.
    stored.tags = [...stored.tags, ...dup.tags];
    await saveLine(stored);
    builderPanels?.reloadLines();
    onOpenLine(stored);
    showToast(
      dup.tags.length === 1
        ? `Added “${dup.tags[0]}” to “${stored.name}” ✓`
        : `Added ${dup.tags.length} tags to “${stored.name}” ✓`,
      { variant: 'success' },
    );
  })();
  return true;
}

function renderMoveListInto(el: HTMLElement): void {
  const activeId = getCurrentNode().id;
  el.innerHTML = '';
  // A book is a tree of every line you have; drawing all of it would put the
  // whole repertoire in a strip. Inside a book the strip draws the WORK IN
  // FRONT OF YOU and nothing else: the moves walked to reach the cursor, plus
  // every branch of the open draft — a second answer played off the same
  // position appearing as a parenthesised variation, PGN style.
  //
  // It used to run on past the cursor down the first stored continuation, on
  // the theory that "the line I am standing in" continues to its end. At the
  // start position that theory picks a line at random, which is why opening the
  // builder on a brand-new line showed moves somebody had already written. Now
  // a fresh cursor with no draft draws nothing, and the strip folds away.
  if (inBook()) {
    renderContinuation(el, rootNode(), 1, activeId, true, draftPathNodes());
    centreActive(el);
    return;
  }
  // Walk the tree from the root: the main line renders inline, and any branch
  // (a node with more than one child) renders its alternatives as parenthesised
  // variations — PGN style. In single-path builder mode there are no branches, so
  // this produces the same flat list as before.
  renderContinuation(el, rootNode(), 1, activeId, true);

  // Keep the active move centred in the horizontally-scrolling strip. We adjust
  // the strip's own scrollLeft (not scrollIntoView) so it never drags an
  // ancestor — that was snapping the carousel back to the Line tab after a move.
  centreActive(el);
}

/**
 * The nodes the strip is allowed to draw inside a book.
 *
 * Two things, unioned: the path walked to the cursor (how you got where you are)
 * and every branch of the open draft — its added moves, and the prepared moves
 * it hangs off, so a draft started three moves back still reads as one sequence.
 * Everything else in the book is somebody else's line as far as this strip is
 * concerned.
 */
function draftPathNodes(): Set<string> {
  const ids = new Set<string>();
  // The walked line, not just the path behind the cursor: stepping back must
  // not rub out the moves you are about to step forward onto again.
  for (const node of pathTo(builderTipId)) ids.add(node.id);
  for (const node of pathTo(getCurrentNode().id)) ids.add(node.id);
  for (const branch of pendingBranches()) {
    for (const node of branch.from) ids.add(node.id);
    for (const node of branch.moves) ids.add(node.id);
  }
  return ids;
}

// Keep the active move centred in the horizontally-scrolling strip. The Line
// info BOX wraps instead of scrolling, so there is nothing to centre there —
// it falls out of this on the width check.
function centreActive(el: HTMLElement): void {
  if (el.scrollWidth <= el.clientWidth) { el.scrollLeft = 0; return; }
  const activeEl = el.querySelector<HTMLElement>('.move-san.active');
  if (!activeEl) { el.scrollLeft = 0; return; }
  const elRect = el.getBoundingClientRect();
  const aRect = activeEl.getBoundingClientRect();
  el.scrollLeft += (aRect.left - elRect.left) - (el.clientWidth - aRect.width) / 2;
}

// Render `parent`'s main continuation (children[0]) into `container`, then any
// sibling variations (children[1..]) as "(…)" blocks, then recurse down the main
// line. `ply` is the 1-based ply of the move being rendered; `forceNumber` makes
// a black move show its number too (line start / right after a variation).
function renderContinuation(
  container: HTMLElement, parent: MoveNode, ply: number, activeId: string, forceNumber: boolean,
  visible?: Set<string>,
): void {
  // `visible` is the book's filter: only these nodes exist as far as this walk
  // is concerned. Without it (the analyser, a single-path build) the whole tree
  // is drawn, exactly as before.
  const children = visible
    ? parent.children.filter(c => visible.has(c.id))
    : parent.children;
  if (children.length === 0) return;
  const main = children[0];
  emitMove(container, main, ply, forceNumber, activeId);

  let nextForce = false;
  if (children.length > 1) {
    for (let i = 1; i < children.length; i++) {
      const v = children[i];
      const wrap = document.createElement('span');
      wrap.className = 'move-var';
      wrap.appendChild(document.createTextNode('('));
      emitMove(wrap, v, ply, true, activeId);          // variation's first move: numbered
      renderContinuation(wrap, v, ply + 1, activeId, false, visible);
      wrap.appendChild(document.createTextNode(')'));
      container.appendChild(wrap);
    }
    nextForce = true; // the main line resumes after the variations — re-number it
  }
  renderContinuation(container, main, ply + 1, activeId, nextForce, visible);
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
  const span = moveSpan(node, activeId);
  // A move played onto the board but not yet added to the book. Marked here
  // rather than at the call site, so it shows wherever the strip draws it —
  // including inside a parenthesised draft variation.
  if (inBook() && isPending(node.id)) span.classList.add('move-san--draft');
  container.appendChild(span);
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
/**
 * The deepest node the cursor has stood at along the current walk.
 *
 * WHY THIS EXISTS. Inside a book, "forward" used to mean `children[0]` — the
 * first continuation stored under the cursor. At the start of a book that is
 * whichever line happens to be first, so tapping Forward played a line the user
 * had never chosen, one move at a time. Forward now follows the line you
 * actually walked: the tip is remembered, stepping back keeps it, and stepping
 * somewhere else replaces it.
 *
 * The move strip reads the same tip, which is why stepping back does not make
 * the moves ahead of you disappear from it.
 */
let builderTipId = 'root';

function resetBuilderTip(): void {
  builderTipId = 'root';
}

/** Remember where the cursor now is, keeping the tip when it's still ahead. */
function noteCursorAt(nodeId: string): void {
  if (nodeId === builderTipId) return;
  if (nodeId === 'root') return;                      // the root is under every tip
  if (pathTo(builderTipId).some(n => n.id === nodeId)) return;  // still on the way there
  builderTipId = nodeId;                              // a different walk starts here
}

/**
 * The continuation Forward should take: the next move of the walked line, plus
 * — inside a book — any draft branch, since the strip draws those too.
 *
 * Outside a book (the analyser, a seeded single-path build) the tree IS the one
 * thing on screen, so the main continuation is the honest answer, exactly as
 * before.
 */
function nextVisibleNode(): MoveNode | null {
  const cur = getCurrentNode();
  if (!inBook()) return cur.children[0] ?? null;
  const visible = draftPathNodes();
  return cur.children.find(c => visible.has(c.id)) ?? null;
}

function stepBack(): void {
  const cur = getCurrentNode();
  if (cur.id === 'root') return;
  const path = pathTo(cur.id); // excludes root
  if (path.length <= 1) { goToStart(); return; }
  handleMoveClick(path[path.length - 2].id);
}

function stepForward(): void {
  const next = nextVisibleNode();
  if (next) handleMoveClick(next.id);
}

/** Straight to the end of the line on screen — the mirror of the rewind. */
function stepToEnd(): void {
  let last: MoveNode | null = null;
  let guard = 0;
  for (let next = nextVisibleNode(); next && guard < 400; guard++) {
    last = next;
    goTo(next.id);
    next = nextVisibleNode();
  }
  if (last) handleMoveClick(last.id);
}

// Grey out the step arrows at the ends of the active path.
function updateMoveNavButtons(): void {
  const cur = getCurrentNode();
  const atStart = cur.id === 'root';
  // "At the end" is the end of the line ON SCREEN, not of whatever the tree
  // stores under the cursor — see nextVisibleNode.
  const atEnd = !nextVisibleNode();
  const set = (id: string, disabled: boolean) => {
    const b = document.getElementById(id) as HTMLButtonElement | null;
    if (b) b.disabled = disabled;
  };
  set('move-start', atStart);
  set('move-prev', atStart);
  set('move-next', atEnd);
  set('move-end', atEnd);
}

function setupMoveNav(): void {
  // Rewind: the one control the bar was missing. Walking back to the start took
  // as many taps as there were moves, which on a twenty-move game is a joke.
  document.getElementById('move-start')!.addEventListener('click', () => {
    stopPlayback();
    goToStart();
    refreshBuilderLineState();
  });
  // …and its mirror: straight to the end of the line on screen.
  document.getElementById('move-end')!.addEventListener('click', () => {
    stopPlayback();
    stepToEnd();
  });
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
    onGamesChanged: () => { builderPanels?.reload(); void refreshGamesOnDevice(); },
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
  // The full pass, not just the save button: `analyserGameId` is only set two
  // lines above (the build clears it), and it is what decides whether the Game
  // tab offers "Delete game" at all. Running only refreshSaveButtonState here
  // left that button hidden on every game opened from My games.
  updateSaveButtonLabel();
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
  showToast('Analysing game…');

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
  if (!isImportedGame || !hasReview(nodes)) {
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
// A paged, swipeable strip sharing the one builder board. The tab strip above
// it mirrors the active slide and jumps to one on tap. The board sits ABOVE the
// carousel and is a fixed square, so swiping slides never moves it.
//
// Slides are addressed by NAME, not by a hard-coded index, because the builder
// and the analyser show a different set in a different order: the analyser puts
// the game itself first and has no Explore tab (there is nothing to explore on a
// game that has already been played). applyBuilderSlideOrder() reorders the DOM
// to match, so "visual order" and "DOM order" stay the same thing and the
// scroll-position→index maths needs to know nothing about any of this.
type SlideId = 'grow' | 'explore' | 'library' | 'mylines' | 'line' | 'engine';

const SLIDE_ELEMENT: Record<SlideId, string> = {
  grow: 'slide-grow',
  explore: 'slide-explore',
  library: 'slide-library',
  mylines: 'slide-games',
  line: 'slide-line',
  engine: 'slide-engine',
};

const BUILDER_SLIDES: SlideId[] = ['explore', 'library', 'mylines', 'line', 'engine'];
// The daily challenge's "grow a line" part: the ordinary builder with one extra
// tab in front, holding the brief. Every other tab is exactly as it always is —
// the point of running the exercise IN the builder is that all of them are
// there (grow-panel.ts). The tab exists only while a line is being grown; there
// is nothing for it to say otherwise.
const GROW_SLIDES: SlideId[] = ['grow', 'explore', 'library', 'mylines', 'line', 'engine'];
// The analyser keeps its game first and drops Explore — curated "what could you
// play here" suggestions are for a line you're building, not a game you played.
const ANALYSER_SLIDES: SlideId[] = ['line', 'library', 'mylines', 'engine'];

let slideOrder: SlideId[] = BUILDER_SLIDES;
let activeSlide = 0;

// The visual (= DOM) index of a slide in the CURRENT order, or -1 when this mode
// doesn't show it.
function slideIndex(id: SlideId): number {
  return slideOrder.indexOf(id);
}

function slideIdAt(index: number): SlideId | null {
  return slideOrder[index] ?? null;
}

// When opening the builder from an external link, the tab to land on (and an
// opponent to preselect in My lines → My opponents). Consumed in
// showView('builder').
let pendingBuilderSlide: SlideId | null = null;
let pendingScoutOpponentId: string | null = null;
// When opening the builder to analyse (e.g. a puzzle's "Analyse position", or
// Train's "Build with engine"), turn the engine on once we've landed.
let pendingEngineOn = false;

// Put the slides — and the tab strip above them — into the order this mode
// wants, hiding the ones it doesn't show. Reordering the real DOM nodes (rather
// than juggling flex `order`) keeps every index the carousel computes from
// scrollLeft honest, and the sections carry their own contents and listeners
// with them.
function applyBuilderSlideOrder(): void {
  const order = builderMode === 'analyser' ? ANALYSER_SLIDES
    : growPanel?.target() ? GROW_SLIDES
    : BUILDER_SLIDES;
  slideOrder = order;

  const track = document.getElementById('builder-carousel');
  const tabs = document.getElementById('builder-slide-tabs');
  if (!track || !tabs) return;

  // Every slide that isn't in this mode's order is hidden and parked at the end,
  // so it can't take part in the scroll maths.
  for (const id of Object.keys(SLIDE_ELEMENT) as SlideId[]) {
    const el = document.getElementById(SLIDE_ELEMENT[id]);
    if (el) el.hidden = !order.includes(id);
  }
  for (const id of order) {
    const el = document.getElementById(SLIDE_ELEMENT[id]);
    if (el) track.appendChild(el);
  }
  for (const id of Object.keys(SLIDE_ELEMENT) as SlideId[]) {
    if (order.includes(id)) continue;
    const el = document.getElementById(SLIDE_ELEMENT[id]);
    if (el) track.appendChild(el);
  }

  tabs.replaceChildren();
  order.forEach((id, i) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'slide-tab' + (i === activeSlide ? ' slide-tab--on' : '');
    tab.dataset.slide = String(i);
    tab.dataset.slideId = id;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(i === activeSlide));
    tab.textContent = slideTabLabel(id);
    tabs.appendChild(tab);
  });

  // Switching between builder and analyser renames the Line tab without moving
  // the active index, so the info control's name is refreshed here too.
  syncBuilderInfoLabel();
}

// ── The sheet's info control ─────────────────────────────────────────────────
//
// One button, bottom right of the sheet, whose dialog follows whichever slide is
// showing. Five buttons — one absolutely positioned inside each scrolling panel —
// would be five things to keep out of the way of five different layouts; this is
// one, outside the carousel, so it can't scroll away with a panel's content.

// Which explanation the button opens for a slide. The Line tab is two different
// tabs depending on the mode ("Line info" building, "Game" analysing), and it
// owes a different explanation in each.
function infoIdFor(id: SlideId): BuilderInfoId | 'library' {
  if (id === 'library') return 'library';
  if (id === 'grow') return 'grow';
  if (id === 'line') return builderMode === 'analyser' ? 'game' : 'line';
  return id;
}

function setupBuilderInfo(): void {
  const btn = document.getElementById('builder-info');
  if (!btn) return;
  btn.appendChild(Icons.info(16));
  btn.addEventListener('click', () => {
    const slide = slideIdAt(activeSlide);
    if (!slide) return;
    const id = infoIdFor(slide);
    // The Library's explanation is the opening-database dialog, which carries
    // the Lichess connect/disconnect buttons — it belongs with the panel that
    // owns that state, not with the static copy in builder-info.ts.
    if (id === 'library') { builderPanels?.showLibraryInfo(); return; }
    showBuilderInfo(id);
  });
  syncBuilderInfoLabel();
}

function syncBuilderInfoLabel(): void {
  const btn = document.getElementById('builder-info');
  const slide = slideIdAt(activeSlide);
  if (!btn || !slide) return;
  const label = builderInfoLabel(infoIdFor(slide));
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

// The analyser's first tab names the game it's showing, not a repertoire line.
function slideTabLabel(id: SlideId): string {
  switch (id) {
    case 'grow': return 'Grow line';
    case 'explore': return 'Explore';
    case 'library': return 'Library';
    case 'mylines': return 'My lines';
    case 'line': return builderMode === 'analyser' ? 'Game' : 'Line info';
    case 'engine': return 'Engine';
  }
}

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
  // Mark which slide is showing. Below the desktop breakpoint this class has no
  // styling at all (the carousel pages horizontally, as always); at/above it,
  // it's what the two-column panel shows instead of paging — same slide index,
  // different presentation. See the $desktop-board block in style.css.
  document.querySelectorAll<HTMLElement>('#builder-carousel .builder-slide').forEach((slide, i) => {
    slide.classList.toggle('builder-slide--active', i === index);
  });
  if (index === activeSlide) return;
  activeSlide = index;
  syncBuilderInfoLabel();
  const id = slideIdAt(index);
  if (id) builderPanels?.setActiveSlide(id);
  explorePanel?.setActive(id === 'explore');
  enginePanel?.setActive(id === 'engine');

  // The Engine tab owns the engine while it's showing: it switches it on, and
  // the docked quick engine goes away underneath it. The dock is the same bar
  // and the same three moves in miniature — two copies of one answer on one
  // screen, one of them costing the board its pixels. Set the flag BEFORE
  // enabling, so the dock never animates open just to be closed again.
  quickEngineHidden = id === 'engine';
  if (id === 'engine' && !engineOn) setEngineOn(true);
  // Keep the engine (and its docked eval bar) in sync with the persistent toggle
  // — it was stopped when we left the builder, so re-arm it on the way back in.
  if (evalPanel) evalPanel.setEnabled(engineOn);
  syncEvalDock();
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

  // 1. The active move's grade badge — shown whenever a played move has one, so
  //    it's visible on any slide.
  const node = getCurrentNode();
  const showBadge = node.id !== 'root' && !!node.classification && !!node.uci;
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

  // 3. The grow exercise's candidate replies, drawn where they'd happen. Only
  //    while the cursor is still standing at the end of the line — once one has
  //    been played the question is answered, and three arrows over the position
  //    you are now thinking about would be three arrows in the way.
  growPanel?.arrows().slice(0, 3).forEach((m, i) => {
    shapes.push({
      orig: m.uci.slice(0, 2) as Key,
      dest: m.uci.slice(2, 4) as Key,
      brush: `grow${i + 1}`,
    });
  });

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
  // The Engine tab shares the one switch with the dock icon, so it repaints
  // whichever of the two was thrown.
  if (on) enginePanel?.render(); else enginePanel?.clear();
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

// The default sheet never shrinks below this. The board is now sized (in CSS) to
// leave room for the sheet, but don't assume that held on every viewport shape:
// on a very short/landscape screen the board can still be tall relative to the
// space, and we'd rather cover the bottom of the board a little than collapse the
// sheet to just its handle.
const SHEET_DEFAULT_MIN = 120;

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
  const barTop = window.innerHeight - barH;             // y of the dock's top edge
  const fullTop = boardTop + boardH * SHEET_PEEK;       // ~15% of the board peeks
  // Default state: the sheet sits just under the board. Clamp to the board's
  // bottom OR to a line that keeps a usable minimum sheet — whichever is higher —
  // so an unexpectedly tall board can't push the default sheet down to nothing.
  const defaultTop = Math.min(boardTop + boardH, barTop - SHEET_DEFAULT_MIN);
  return {
    barH,
    defaultH: Math.max(96, barTop - defaultTop),
    fullH: Math.max(96, barTop - fullTop),
  };
}

// Above DESKTOP_NAV_BREAKPOINT the sheet isn't a sheet — it's the static
// right-hand column of the builder's two-column grid (see the $desktop-board
// block in style.css). Every drag/snap/layout path below checks this and bows
// out, so none of that machinery ever runs at desktop width.
function isDesktopBoard(): boolean {
  return desktopNavQuery.matches;
}

// Position the sheet for the given height (bottom-anchored above the bar).
function applySheetHeight(h: number, dockH?: number): void {
  if (isDesktopBoard()) return;
  const sheet = document.getElementById('builder-sheet');
  if (!sheet) return;
  sheet.style.bottom = `${dockH ?? sheetMetrics().barH}px`;
  sheet.style.height = `${h}px`;
}

function layoutBuilderSheet(dockH?: number): void {
  if (currentView !== 'builder') return;
  // At desktop width the grid owns the sheet's box. Drop any inline height /
  // bottom a previous (narrower) layout wrote, so the CSS can take over — this
  // is the ONE place that normalises it, which is why every entry point
  // (showView, setSheetState, animateEvalDock, resize) routes through here.
  if (isDesktopBoard()) {
    const sheet = document.getElementById('builder-sheet');
    if (sheet) { sheet.style.height = ''; sheet.style.bottom = ''; }
    return;
  }
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
// True while the Engine tab is showing: the docked quick engine is suppressed
// even though the engine itself is running.
let quickEngineHidden = false;

// Bring the docked eval bar into line with "is the engine on, and are we allowed
// to show it here?" — the one call every path that could change either goes
// through.
function syncEvalDock(): void {
  animateEvalDock(engineOn && !quickEngineHidden);
}

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
  if (!animate) sheet?.classList.add('builder-sheet--dragging');
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

// The sheet's gestures. There is no grabber to drag any more — it cost a row of
// pixels at the top of the panel to say something the panel already does when
// you swipe it, and those pixels come off the board. The sheet grows when you
// run out of list and keep pulling, when you swipe up on the tab strip, and
// collapses on a tap of the peeking board.
function setupBuilderSheetGestures(): void {
  const sheet = document.getElementById('builder-sheet');
  if (!sheet) return;

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
      if (e.touches.length !== 1 || isDesktopBoard()) return;
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
      if (e.touches.length !== 1 || isDesktopBoard()) return;
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
  // Nothing overlays the board at desktop width, so there's nothing to drop.
  document.getElementById('board-wrap')?.addEventListener('click', () => {
    if (!isDesktopBoard() && sheetState === 'full') setSheetState('default');
  });
}

// Page the carousel to a slide, as tapping its tab would. Lifted out of the tab
// handler so the builder walkthrough can open the panel each of its steps is
// about — a bubble naming the Library while the Line panel is showing teaches
// the user to distrust the bubbles.
function goToBuilderSlide(index: number): void {
  const track = document.getElementById('builder-carousel');
  if (!track) return;
  track.scrollTo({ left: index * track.clientWidth, behavior: 'smooth' });
  onActiveSlide(index);
}

// Page to a slide by name. A slide this mode doesn't show is a no-op rather than
// a jump to slide -1 (the analyser has no Explore tab).
function showBuilderSlide(id: SlideId): void {
  const index = slideIndex(id);
  if (index >= 0) goToBuilderSlide(index);
}

function setupBuilderCarousel(): void {
  const track = document.getElementById('builder-carousel')!;

  // Tap a tab → page to that slide. Delegated, because the strip is rebuilt
  // whenever the slide order changes (builder ⇄ analyser).
  document.getElementById('builder-slide-tabs')?.addEventListener('click', e => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('.slide-tab');
    if (!tab || (tab as HTMLButtonElement).disabled) return;
    goToBuilderSlide(Number(tab.dataset.slide));
  });

  // Swipe the strip → keep the active tab in sync. rAF-throttled so the scroll
  // stays smooth. Above the breakpoint the strip isn't the switcher (only the
  // active slide renders, and the track can't scroll horizontally) — and the
  // browser forcing scrollLeft to 0 as the layout changes would otherwise fire
  // this and snap the panel back to the first tab.
  let ticking = false;
  track.addEventListener('scroll', () => {
    if (ticking || isDesktopBoard()) return;
    ticking = true;
    requestAnimationFrame(() => {
      const index = Math.round(track.scrollLeft / track.clientWidth);
      onActiveSlide(index);
      ticking = false;
    });
  }, { passive: true });

  window.addEventListener('resize', () => layoutBuilderSheet());

  // Dragging a desktop window across the breakpoint swaps the builder between
  // the two-column grid and the phone sheet without a view change, so redo the
  // bits that only run on entry: re-lay-out the sheet (which also strips or
  // restores its inline height), re-seat the carousel at the active slide —
  // the paged strip is at scrollLeft 0 while desktop CSS hides it — and tell
  // chessground its bounds moved.
  desktopNavQuery.addEventListener('change', () => {
    if (currentView !== 'builder') return;
    layoutBuilderSheet();
    if (!isDesktopBoard()) track.scrollLeft = activeSlide * track.clientWidth;
    cg?.redrawAll();
  });
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
  // The note BUTTON lives in the Line tab's action row, which the analyser
  // gives over to "Open in builder" / "Save line" — so it's builder-only, and
  // only once there's a move to annotate. The note DISPLAY below is not: an
  // imported game carries its own per-move notes, and they still show.
  btn.hidden = node.id === 'root' || builderMode === 'analyser';
  if (node.id === 'root') {
    block.hidden = true;
    return;
  }
  // Not while the line is playing itself through. A note appearing and vanishing
  // under a board that's moving on its own re-lays the panel out on every ply —
  // the watch is for seeing the SHAPE of the line, and the notes are still one
  // tap away the moment it stops.
  const note = playbackTimer ? undefined : node.note?.trim();
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
  noteCursorAt(nodeId);
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
  refreshBuilderLineState();
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
  const existed = hasMove(result.san);
  const node = addMove(result.san, fullUci, chess.fen());
  noteCursorAt(node.id);
  if (!existed) notePending(node.id);
  cg.set({
    fen: chess.fen(),
    turnColor: turnColor(),
    movable: { color: 'both', dests: legalDests() },
    lastMove: [from as Key, to as Key],
  });

  renderMoveList();
  renderMoveDetails();
  updateOpeningName();
  // Playing a move moves you between lines of the book exactly as navigating
  // does, so the panel that describes "the line I am in" has to catch up. It
  // used to run on navigation only, which left the Line tab (and the header
  // title) describing the line you had just branched away from.
  refreshBuilderLineState();
  reevaluate();
  notifyBuilderMove();
  // Explore's auto-reply answers a move that was PLAYED, never one that was
  // navigated to — so it hangs off these two funnels rather than off a render.
  explorePanel?.movePlayed();
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
  const existed = hasMove(result.san);
  const node = addMove(result.san, uci, chess.fen());
  noteCursorAt(node.id);
  if (!existed) notePending(node.id);
  cg.set({
    fen: chess.fen(),
    turnColor: turnColor(),
    movable: { color: 'both', dests: legalDests() },
    lastMove: [from as Key, to as Key],
  });
  renderMoveList();
  renderMoveDetails();
  updateOpeningName();
  // Playing a move moves you between lines of the book exactly as navigating
  // does, so the panel that describes "the line I am in" has to catch up. It
  // used to run on navigation only, which left the Line tab (and the header
  // title) describing the line you had just branched away from.
  refreshBuilderLineState();
  reevaluate();
  notifyBuilderMove();
  // Explore's auto-reply answers a move that was PLAYED, never one that was
  // navigated to — so it hangs off these two funnels rather than off a render.
  explorePanel?.movePlayed();
  void gradeLiveMove(node, parentFen);
}

/**
 * Take the move on the board back off the line — Explore's "Another reply".
 *
 * A move the auto-reply just played is a DRAFT, so taking it back means dropping
 * it out of the tree entirely; that is what makes swapping a reply free rather
 * than something that leaves a rejected branch behind. A move that is already in
 * the book is somebody's saved line and is left alone: the cursor simply walks
 * back, and the next reply lands as a new sibling.
 *
 * False when there is nothing to take back (the board is at the start).
 */
function takeBackLastMove(): boolean {
  const node = getCurrentNode();
  if (node.id === 'root') return false;
  const path = pathTo(node.id);
  const parentId = path.length > 1 ? path[path.length - 2].id : 'root';
  const wasDraft = inBook() && isPending(node.id);
  if (wasDraft) discardBranch(node.id);
  handleMoveClick(parentId);
  if (wasDraft) updateSaveButtonLabel();
  return true;
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

// ── Standing inside a repertoire ─────────────────────────────────────────────
//
// The builder loads a whole book (see builder-book.ts): moves you already have
// are there to walk, and a move you don't have is an addition held as a draft
// until you commit it. The seeded flows — the onboarding walkthrough, "prepare a
// reply", a line extracted from a game — still lay ONE line down in the old
// single-path mode and merge into the book when saved, so they are unaffected.
// `inBook()` is what tells the two apart.
function inBook(): boolean {
  return builderMode === 'builder' && activeBook() !== null;
}

// Re-derive everything the builder shows ABOUT the current line from wherever
// the cursor now stands. In a book the cursor moves between lines constantly, so
// this runs on every board change rather than only when a line is loaded.
function refreshBuilderLineState(): void {
  if (!inBook()) return;
  const line = bookCurrentLine();
  const wasUnsaved = loadedLineId === null;
  currentTrainingLine = line;
  loadedLineId = line?.id ?? null;
  loadedLineCreatedAt = line?.createdAt;
  // A line that isn't in the book yet states an INTENT to train, which is the
  // same thing the toggle has always said before a first save — and moving
  // between two unsaved positions must not quietly switch that intent back on,
  // or "just save it" would be undone by playing one more move.
  loadedLineInTraining = line ? line.inTraining : (wasUnsaved ? loadedLineInTraining : true);
  workingPriority = line?.priority ?? DEFAULT_PRIORITY;
  currentTags = line ? [...line.tags] : [];
  manualTitle = line?.name ?? null;
  renderTitle();
  renderBuilderTags();
  applyLineTrainingToggleState();
  refreshLineInfoBlocks();
}

// Open a book on the board and stand at the start (or wherever `then` puts us).
async function enterBuilderBook(
  colour: 'white' | 'black', then?: () => void, bookId?: string,
): Promise<void> {
  // Default to whichever book My Lines is showing, so building a line lands in
  // the book the user is looking at rather than always in the colour's default.
  // openBook ignores an id of the wrong colour, so this is safe to pass blindly.
  const wanted = bookId ?? selectedBookId();
  await openBook(colour, wanted === 'all' ? undefined : wanted);
  saveColour = colour;
  builderMode = 'builder';
  resetBuilderTip();
  chess.reset();
  cg.set({
    fen: chess.fen(),
    orientation: colour,
    turnColor: 'white',
    movable: { color: 'both', dests: legalDests() },
    lastMove: undefined,
  });
  handleMoveClick('root');
  then?.();
  updateSaveButtonLabel();
  builderPanels?.render();
  // A Black book opens with White to move, so with Explore's auto-reply on the
  // opponent owes a move before the user has played anything. Only from the
  // start — a `then` that walked the cursor somewhere has its own plans.
  if (getCurrentNode().id === 'root') explorePanel?.openedAtStart();
}

// Commit the draft. The working tree is already the merged result — a move
// played onto a branch you had became a child of the node that was there — so
// this stores it rather than reconciling anything.
async function commitBook(intents?: Map<string, boolean>): Promise<void> {
  // Read BEFORE the write, because committing repaints every one of these — and
  // because the draft is what knows which lines are NEW. Their end-node ids
  // survive the write unchanged, which is how each one is found again after it.
  //
  // Standing inside a book, the header button ADDS moves rather than saving a
  // line — which is right, but it meant the whole tail of the old save flow
  // never ran: the confirm run (the trainer) stopped opening after a new line,
  // and the Line info toggle's "Just save it" stopped being honoured, because a
  // freshly grown branch inherits training from its ancestors (DEFAULT_TRAINING)
  // whatever the toggle said. Both are picked back up below.
  const drafted = pendingLines();
  // What each line asked for: the confirm sheet's switches when it was shown,
  // and the Line info toggle when the draft was a single line and went straight
  // through.
  const wants = intents ?? new Map(drafted.map(l => [l.endId, loadedLineInTraining]));

  const { moves, roots } = await commitPending();
  if (moves === 0) { showToast('Nothing new to add'); return; }
  repaintAfterBookWrite();
  // An add is only as cheap as it is reversible, and this one is exactly
  // reversible: the roots name the branches just written, and nothing else can
  // have grown under them in the seconds the toast is up.
  showToast(moves === 1 ? 'Added 1 move ✓' : `Added ${moves} moves ✓`, {
    variant: 'success',
    action: { label: 'Undo', onClick: () => void undoBookCommit(roots, moves) },
  });

  // A grow session ends the moment moves land — the whole ask was "add one".
  // Its new branch skips the confirm run: the exercise is already an interruption
  // to the daily challenge, and ending it by drilling the line you just wrote
  // (and landing on My Lines afterwards) puts two screens between the user and
  // the next part of their day. Save it and move on is what the part promises.
  const growing = moves > 0 && !!growPanel?.target();
  await settleNewBookLines(drafted.map(l => l.endId), wants, { confirmRuns: !growing });
  if (growing) finishGrowSession();
}

/**
 * The tail of the save flow, for every line a commit just finished.
 *
 * Two jobs, and the second is what makes a multi-line add feel like one action:
 *
 *  • "Store, don't train" means exactly that. A new branch resolves `training`
 *    from its ancestors, so it lands IN training whatever the switch said; when
 *    the switch said no, write the explicit off (which is what the My Lines
 *    switch writes) rather than leaving the user with a line they asked not to
 *    drill.
 *  • Everything still in training gets its confirm run — one clean run before a
 *    line joins the schedule, which is what "added to training" has always
 *    meant. Several new lines get several runs, back to back, so adding three
 *    at once is three runs rather than a silent enrolment. Skipped entirely when
 *    the user has switched that pref off, exactly as the old path skipped it.
 */
async function settleNewBookLines(
  endIds: string[],
  wants: Map<string, boolean>,
  opts: { confirmRuns?: boolean } = {},
): Promise<void> {
  const queue: Line[] = [];
  for (const endId of endIds) {
    const line = lineForEnd(endId);
    if (!line) continue;                       // built past since, or never landed
    if (wants.get(endId) === false) {
      if (line.inTraining) await saveLine({ ...line, inTraining: false });
      continue;
    }
    if (line.inTraining) queue.push(line);
  }
  repaintAfterBookWrite();
  if (opts.confirmRuns === false) return;
  if (!queue.length || !getConfirmRunBeforeTraining()) return;
  runConfirmRuns(queue);
}

/**
 * The confirm runs for a batch of new lines, one after another.
 *
 * Backing out of a run stops the whole queue AND takes that line out of
 * training: cancelling "add it to training" has to mean the line is not in
 * training, and being asked the same question three more times after saying no
 * once is not a queue, it is a nag. The lines already run keep their place, and
 * any not yet reached stay in the book, in training, unconfirmed.
 */
function runConfirmRuns(lines: Line[]): void {
  let i = 0;
  // The last line reached, so the queue's end can land on My Lines with it
  // highlighted rather than leaving the builder sitting behind a finished run.
  let lastLine: Line | null = null;
  const step = (): void => {
    const line = lines[i++];
    if (!line) {
      if (lastLine) goToSavedLine(lastLine.id); else repaintAfterBookWrite();
      return;
    }
    lastLine = line;
    startPretrainingRun(
      line,
      step,
      () => {
        void (async () => {
          const current = lineForEnd(parseLineId(line.id)?.endNodeId ?? '') ?? line;
          if (current.inTraining) await saveLine({ ...current, inTraining: false });
          repaintAfterBookWrite();
        })();
      },
      {
        // The only way through this run is "Add without playing" — there is
        // nothing here to abandon that skipping doesn't already cover, so a
        // louder "End session" beside it would just be a second, competing way
        // out. The back gesture still works either way.
        hideExit: true,
        ...(lines.length > 1
          ? { completeMessage: `Line ${i} of ${lines.length} confirmed — added to training` }
          : {}),
      },
    );
  };
  step();
}

/** Take back the moves a commit just wrote. */
async function undoBookCommit(roots: string[], moves: number): Promise<void> {
  const removed = await removeManyAndStore(roots);
  repaintAfterBookWrite();
  handleMoveClick(getCurrentNode().id);
  showToast(removed > 0
    ? (moves === 1 ? 'Move taken back' : `${moves} moves taken back`)
    : 'Nothing to take back');
}

/** Everything that has to catch up after the book on disk changed. */
function repaintAfterBookWrite(): void {
  builderPanels?.reloadLines();
  refreshBuilderLineState();
  updateSaveButtonLabel();
  renderMoveList();
}

// ── Removing moves from the book ─────────────────────────────────────────────
//
// Until now the builder could only ADD. Taking a move back out meant leaving for
// My Lines and finding it again, so in practice nobody did — the book only ever
// grew. These three functions are the whole removal path in the builder, and
// they all go through line-removal.ts so the numbers quoted here are the same
// ones the branch sheet quotes.

/**
 * The trash on a "My saved lines" row: take out the continuation played from the
 * position on the board, and everything after it.
 */
function removeContinuationFromHere(uci: string): void {
  const book = activeBook();
  if (!book) return;
  const node = nodeAtPath(book.tree, [...currentPathUcis(), uci]);
  if (!node) { showToast('That move isn’t in this book'); return; }
  askThenRemove(node.id);
}

/**
 * Remove a move, asking first only when it is worth asking about.
 *
 * A TRIM — one line, which survives ending a move earlier — just happens, and
 * the toast offers to put it back. A CUT that ends several lines stops and names
 * them first. Both are undoable: the dialog is there so nobody is SURPRISED, not
 * because one of them can't be recovered.
 *
 * Confirming everything is what teaches people to tap through confirmations, at
 * which point the dialog protects nothing and the genuinely wide cut goes
 * through as easily as the trim.
 */
function askThenRemove(nodeId: string): void {
  const book = activeBook();
  if (!book) return;
  const impact = describeRemoval(book, nodeId);
  if (!impact) { showToast('Nothing to remove here'); return; }
  if (impact.small) { void applyRemoval(nodeId); return; }
  showDialog({
    title: removalTitle(impact),
    body: removalBody(impact, book.name),
    buttons: [
      { label: 'Remove', variant: 'danger', onClick: () => { void applyRemoval(nodeId); } },
      { label: 'Cancel', variant: 'secondary' },
    ],
  });
}

async function applyRemoval(nodeId: string): Promise<void> {
  const cut = await removeAndStore(nodeId);
  stopPlayback();
  repaintAfterBookWrite();
  // The cursor may have been standing inside what just went; tree.ts walks it
  // back out to the parent, and this re-syncs the board and strip to wherever
  // it landed.
  handleMoveClick(getCurrentNode().id);
  if (!cut) { showToast('Nothing to remove here'); return; }
  showToast(removalDone(cut.moves), {
    action: { label: 'Undo', onClick: () => void undoRemoval(cut) },
  });
}

/**
 * Put a removal back. This is the reason removal can be offered in more places
 * at all: re-playing the moves would NOT bring back their review history, and
 * re-attaching the very subtree that was taken does.
 */
async function undoRemoval(cut: DetachedSubtree): Promise<void> {
  const ok = await restoreAndStore(cut);
  repaintAfterBookWrite();
  handleMoveClick(getCurrentNode().id);
  if (ok) showToast('Moves put back ✓', { variant: 'success' });
  else showToast('Those moves can’t be put back now');
}

// ── The header button inside a book ──────────────────────────────────────────

/**
 * With a draft open the button adds it, exactly as it always has. With nothing
 * to add it used to be a dead tap: the label became a status line ("3 lines
 * saved", "2 lines from here") and tapping it answered "Nothing new to add",
 * which is true and useless.
 *
 * A button that describes your book should take you to the thing it describes.
 * At the start position that is the book itself, so it goes to My Lines. Deeper
 * in, it is the branch you are standing on, so it opens the branch sheet — where
 * that branch can be named, tagged, paused, prioritised or removed.
 *
 * The start position deliberately does NOT open the sheet. There the "branch" is
 * the entire repertoire, and its remove button would sit one tap from the
 * header.
 */
function handleBookHeaderTap(): void {
  if (hasPending()) { addFromHeader(); return; }
  const at = cursorCoverage();
  if (!at || at.lines === 0) { showToast('Play a move to start a line'); return; }
  if (at.atStart) { showView('lines'); return; }
  openBranchSheetHere();
}

/**
 * The branch sheet for the position on the board.
 *
 * The sheet writes straight to storage, so the builder's in-memory book and the
 * tree on the board are stale the moment it changes anything — and a later
 * commit from here would write the stale copy back, resurrecting whatever it
 * removed. So the book is re-opened afterwards and the cursor walked back to
 * where it was, as far as the book still goes: the branch the user was standing
 * on may be exactly the one they just removed.
 */
function openBranchSheetHere(): void {
  const book = activeBook();
  if (!book) return;
  const ucis = currentPathUcis();
  void openBranchSheet({
    repertoireId: book.id,
    ucis,
    sans: currentPathSans(),
    onSeeInLines: () => showView('lines'),
    onOpenLine,
    onChanged: () => { void rereadBookAfterBranchEdit(book.id, ucis); },
  });
}

async function rereadBookAfterBranchEdit(bookId: string, ucis: string[]): Promise<void> {
  await openBook(saveColour, bookId);
  const node = nodeAtPath(rootNode(), ucis);
  handleMoveClick(node ? node.id : 'root');
  repaintAfterBookWrite();
}

/**
 * The header's add action.
 *
 * ONE line goes straight in — that is the ordinary case and it stays one tap,
 * with the Line info switch deciding whether it trains. SEVERAL lines stop and
 * show themselves first: two lines are two decisions (train this one, just
 * store that one, drop the third), and "Add 7 moves" is not where you make
 * them.
 */
function addFromHeader(): void {
  const drafted = pendingLines();
  if (drafted.length <= 1) { void commitBook(); return; }
  openDraftConfirm(drafted);
}

/**
 * The lines the draft is about to add, as the sheet knows them — named by the
 * opening they reach, with the whole line quoted so it can be recognised, and
 * carrying the training intent the switches will edit.
 */
function draftSheetLines(drafted: ReturnType<typeof pendingLines>): DraftSheetLine[] {
  return drafted.map(line => ({
    endId: line.endId,
    cutId: line.cutId,
    name: nameForPath(line.nodes.map(n => n.fen)) ?? notate(line.nodes),
    moves: notate(line.nodes),
    added: line.added,
    // A new line means to be trained unless said otherwise — the same default
    // the Line info switch carries.
    training: true,
  }));
}

/** The confirm sheet, from the header. (The way OUT builds its own — it has a
 *  "proceed" to run afterwards and a discard-everything button of its own.) */
function openDraftConfirm(drafted: ReturnType<typeof pendingLines>): void {
  const lines = draftSheetLines(drafted);
  openDraftSheet({
    lines,
    onAddAll: () => {
      const wants = new Map(lines.map(l => [l.endId, l.training]));
      void commitBook(wants);
    },
    onRemove: (cutId) => { discardBranch(cutId); afterDraftEdit(); },
    onGoTo: (endId) => handleMoveClick(endId),
    onKeepEditing: () => { /* stay put — the back layer is already re-armed */ },
  });
}

/** "1.e4 e5 2.Nf3" — a line's moves, numbered from the first. */
function notate(nodes: MoveNode[]): string {
  return nodes.map((node, i) => {
    const white = i % 2 === 0;
    const number = Math.floor(i / 2) + 1;
    return white ? `${number}.${formatMove(node.san)}` : formatMove(node.san);
  }).join(' ');
}

/** A branch was dropped from the draft — the tree and every count moved. */
function afterDraftEdit(): void {
  updateSaveButtonLabel();
  renderMoveList();
  handleMoveClick(getCurrentNode().id);
}

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
// On a SAVED line this mirrors line.inTraining. On an unsaved one it's an
// INTENT: the Line info toggle is on by default for a new line, and what it says
// at save time decides whether the line goes straight into the enrolment path.
// A new line is never written with inTraining already true — enrolment has to go
// through addLineToTraining, which is where the free-tier cap and the confirm
// run live.
let loadedLineInTraining = true;
// The priority the Line info control is showing. Working state, so it can be set
// on a line that hasn't been saved yet; buildCurrentLine stamps it on the save.
let workingPriority: LinePriority = DEFAULT_PRIORITY;

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
  // In a book, "dirty" is exactly the draft: walking around your own repertoire
  // changes nothing, so only uncommitted moves count.
  if (inBook()) return hasPending();
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

// The bar's Watch/Pause button is GONE — the bottom bar is four navigation
// controls now (start · end · back · forward), and a line that plays itself is
// what the trainer's watch step is for. The playback machinery stays, because
// the guided first run still plays its line in (startPlaybackFromStart), and
// this is what used to paint the button: kept as a no-op-safe hook so every
// caller reads the same.
function setWatchPlaying(_playing: boolean): void {
  /* no button to paint any more */
}

// Fires once when a playback reaches the end of its line under its own steam —
// not when it's paused, and not when it's abandoned. The guided first run uses
// it to start coaching only once the line has finished playing itself in.
let playbackDone: (() => void) | null = null;

// Pause playback but keep the queue, so the button can resume from here.
function pausePlayback(): void {
  if (playbackTimer !== undefined) {
    clearTimeout(playbackTimer);
    playbackTimer = undefined;
  }
  setWatchPlaying(false);
  // Playback suppresses the note block (see renderNoteBlock); the moves have
  // stopped, so put the current move's note back.
  renderMoveDetails();
}

// Fully stop and forget the queue (used when leaving the board / loading a line).
function stopPlayback(): void {
  pausePlayback();
  playbackMoves = [];
  playbackIndex = 0;
  playbackDone = null;
  setWatchPlaying(false);
}

// Play the next queued move, then schedule the one after at the current speed.
function playStep(): void {
  if (playbackIndex >= playbackMoves.length) {
    // Grab the callback before stopPlayback clears it — reaching the end is the
    // one path that's allowed to fire it.
    const done = playbackDone;
    stopPlayback();
    done?.();
    return;
  }
  playbackTimer = setTimeout(() => {
    handleMoveClick(playbackMoves[playbackIndex].id);
    playbackIndex++;
    playStep();
  }, watchSpeedMs());
}

// Rewind to the start of the current line and watch it through. This is the
// Watch button's own behaviour, lifted out so the guided first run can play its
// line in exactly the same way — same speed pref, same stepping, same pause
// button — rather than growing a second animation loop beside it.
function startPlaybackFromStart(onDone?: () => void): void {
  // Inside a book, mainline() is the book's FIRST line, not the one you are
  // looking at — so Watch used to play somebody else's line back at you from
  // wherever you were standing. The line the cursor is in is the one to watch.
  const moves = inBook() ? currentLineNodes() : mainline();
  if (moves.length === 0) { onDone?.(); return; }
  playbackMoves = moves;
  playbackIndex = 0;
  playbackDone = onDone ?? null;
  goToStart();
  setWatchPlaying(true);
  playStep();
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
  // The label itself (including the "you already have this line" transform)
  // lives in applySaveButtonLabel, so the per-move duplicate check can repaint
  // it without dragging the rest of this function along.
  applySaveButtonLabel();

  // The analyser and the builder show a different set of tabs, in a different
  // order — rebuild the strip (and the slides under it) for this mode.
  applyBuilderSlideOrder();

  // The opening-name title makes sense for a repertoire line, not for a game —
  // the game's identity ("vs <opponent>") already shows in the header and below.
  const titleRow = document.querySelector<HTMLElement>('.line-title-row');
  if (titleRow) titleRow.hidden = analyser;

  // The "Analyse game" button is the analyser's manual grade trigger.
  refreshReviewButtonState();

  // The action row is one row of four, and which four depends on the mode.
  //
  //   builder  — Training · Tags · Note · Delete. What you do TO a line.
  //   analyser — Open in builder · Save line · Delete. A game isn't a line you
  //              train or tag; it's a thing you take lines out of, so the two
  //              middle slots become the two ways out of it.
  const setHidden = (id: string, hidden: boolean): void => {
    const el = document.getElementById(id);
    if (el) el.hidden = hidden;
  };
  setHidden('save-line-btn', !analyser);
  setHidden('open-builder-btn', !analyser);
  setHidden('tags-btn', analyser);
  // The note button also depends on WHERE the cursor is (there is no move to
  // annotate at the start), so renderNoteBlock owns it entirely — including
  // taking it away in the analyser.
  renderNoteBlock();

  // Delete: the saved game (analyser) or the saved line (builder). Icon-only —
  // the label is on the button's accessible name — so four controls fit a phone
  // width. Hidden for a brand-new, never-saved line: nothing to delete yet.
  const deleteBtn = document.getElementById('line-delete');
  if (deleteBtn) {
    const canDelete = analyser ? !!analyserGameId : !!loadedLineId;
    deleteBtn.hidden = !canDelete;
    const label = analyser ? 'Delete game' : 'Delete line';
    deleteBtn.setAttribute('aria-label', label);
    deleteBtn.title = label;
  }

  // Training toggle leads the row: builder mode only (a game has no inTraining
  // concept), but shown from the very first move rather than only once the line
  // is saved — deciding how a line will be trained is part of building it, not
  // an afterthought a modal asks about later.
  const trainingToggle = document.getElementById('line-training-toggle');
  if (trainingToggle) {
    trainingToggle.hidden = analyser;
    applyLineTrainingToggleState();
  }

  refreshLineInfoBlocks();
}

// The Line info tab's two extra blocks — training priority, and how the line has
// actually been going. Both are shown from the first move: setting up how a line
// will be trained belongs with building it, not with a modal afterwards. On an
// unsaved line the stats block shows what it will hold rather than four zeros
// pretending to be measurements.
function refreshLineInfoBlocks(): void {
  const prioEl = document.getElementById('line-priority');
  const statsEl = document.getElementById('line-stats');
  const building = builderMode === 'builder';
  const line = building && loadedLineId ? currentTrainingLine : null;

  if (prioEl) {
    prioEl.hidden = !building;
    if (building) {
      renderLinePriority(prioEl, {
        priority: workingPriority,
        onChange: (p) => { void setLinePriority(p); },
      });
    }
  }

  if (!statsEl) return;
  statsEl.hidden = !building;
  if (!building) return;
  if (!line) { renderLineStatsEmpty(statsEl); return; }

  const target = line;
  // The games are read lazily and only for this panel — the stats block is the
  // only thing in the builder that needs the whole imported set.
  void getAllGames().then(games => {
    // The user may have moved on to another line while the read was in flight;
    // only paint if this is still the line on screen.
    if (currentTrainingLine?.id !== target.id) return;
    renderLineStats(statsEl, {
      line: target,
      games,
      onGoToMove: (m) => goToMoveByUci(m.uci),
    });
  }).catch(() => { /* no games: the block simply reports zero faced */ });
}

// Set the priority. On a saved line it's persisted straight away — like the
// training toggle beside it, there's no reason to make the user hit Save for a
// scheduling preference. On an unsaved one it's held until the save stamps it.
async function setLinePriority(priority: LinePriority): Promise<void> {
  workingPriority = priority;
  if (!currentTrainingLine || !loadedLineId) return;
  const line = { ...currentTrainingLine, priority };
  await saveLine(line);
  currentTrainingLine = line;
  builderPanels?.reloadLines();
}

// Jump the board to the position BEFORE a move in the current line, from the
// "where it breaks" list. Matched on uci along the mainline — the stats rows
// carry no node id.
function goToMoveByUci(uci: string): void {
  const nodes = mainlineNodes(rootNode());
  const target = nodes.find(n => n.uci === uci);
  if (!target) return;
  handleMoveClick(target.id);
}

// Reflect loadedLineInTraining onto the switch's visual state (on/off colour,
// knob position, label text). On an unsaved line the switch states an INTENT
// rather than a fact, and says so — "Training ON" on a line that isn't in
// training yet would be a small lie.
function applyLineTrainingToggleState(): void {
  const btn = document.getElementById('line-training-toggle');
  if (!btn) return;
  btn.classList.toggle('dline-toggle--on', loadedLineInTraining);
  btn.setAttribute('aria-checked', String(loadedLineInTraining));
  const lbl = btn.querySelector('.dline-toggle-label');
  if (!lbl) return;
  // Short enough for a quarter of a phone's width — this control shares its row
  // with three others now. The full sentence lives on the button's own name,
  // which is where a screen reader and a long-press both look for it.
  const saved = !!loadedLineId;
  lbl.textContent = saved
    ? `Training ${loadedLineInTraining ? 'ON' : 'OFF'}`
    : (loadedLineInTraining ? 'Train it' : 'Just save');
  const full = saved
    ? (loadedLineInTraining ? 'In training — tap to pause it' : 'Paused — tap to put it back in training')
    : (loadedLineInTraining
      ? 'This line goes into training when you add it — tap to just save it'
      : 'This line is saved without going into training — tap to train it');
  btn.setAttribute('aria-label', full);
  btn.title = full;
}

// Flip inTraining on the loaded, saved line immediately — no need to hit
// header Save first. Mirrors the same on/off switch used in My Lines
// (lines-screen.ts); only reachable when a saved line is loaded (see the
// visibility guard in updateSaveButtonLabel above).
async function toggleLineTraining(): Promise<void> {
  // Not saved yet: the switch is an intent, so flipping it writes nothing and
  // costs no training slot. The cap is checked when the line is actually
  // enrolled, at the end of the save.
  if (!currentTrainingLine || !loadedLineId) {
    loadedLineInTraining = !loadedLineInTraining;
    applyLineTrainingToggleState();
    return;
  }
  const next = !loadedLineInTraining;
  // Switching ON meets the free-tier cap; switching off never does, and frees
  // the slot straight away.
  if (next && !(await requestTrainingSlot())) return;
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
  if (inBook() && loadedLineId) {
    const plan = planLineRemoval();
    if (!plan) return;
    const label = currentTitle() || 'this line';
    // The honest number: only the moves that belong to THIS line go. The ones it
    // shares with its neighbours stay, which is the thing the old flat model
    // could not promise.
    const moves = plan.moves === 1 ? '1 move' : `${plan.moves} moves`;
    showDialog({
      title: 'Delete this line?',
      body: `This removes ${moves} from “${label}”, along with their review history. Moves it shares with your other lines stay. This can’t be undone.`,
      buttons: [
        // Through the shared path, so deleting a line from here is undoable
        // too — it takes the same moves, and losing their review history to a
        // mis-tap is the same loss wherever the tap happened.
        { label: 'Delete', variant: 'danger', onClick: () => { void applyRemoval(plan.from.id); } },
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

// At/above this width the left sidebar (#side-nav) replaces the bottom tab
// bar (#bottom-nav) — see syncNavVisibility. Kept in sync with the
// $desktop-nav media query in style.css; same discipline as theme.ts /
// index.html's pre-paint script — update both on change.
const DESKTOP_NAV_BREAKPOINT = 960;

// How long after launch the background mistake scan is allowed to start. Long
// enough that the first screen, the weekly refresh and any sync have all had the
// device to themselves first — nothing here is urgent, and the whole point is
// that nobody is waiting for it.
const AUTO_SCAN_DELAY_MS = 8000;
const desktopNavQuery = window.matchMedia(`(min-width: ${DESKTOP_NAV_BREAKPOINT}px)`);

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
  resetBuilderTip();
  reset();
  chess.reset();
  loadedLineId = null;
  loadedLineCreatedAt = undefined;
  // A line you sat down to build is a line you mean to learn, so the toggle
  // starts on and the priority control is live before the first save.
  loadedLineInTraining = true;
  workingPriority = DEFAULT_PRIORITY;
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
  // Whatever comes next re-opens the book if it wants one (enterBuilderBook).
  // Leaving it closed here is what keeps the seeded single-line flows — the
  // walkthrough, "prepare a reply", a line pulled out of a game — behaving
  // exactly as they did.
  closeBook();
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
  // …and stand inside that colour's repertoire, so everything already prepared
  // is there to walk rather than a blank board to start over on.
  void enterBuilderBook(colour);
}

// ── The guided line ──────────────────────────────────────────────────────────
//
// Picked a style card (or a starter-pack line) → the builder opens with that
// line already laid down. From here on it is an ORDINARY builder session: the
// tree is a normal single-mode tree, a divergent move truncates exactly as it
// always does, Save is the same Save. The only difference is that the save
// routes straight into the confirm run instead of asking whether you'd like to
// train it.
//
// THE SEQUENCE, which is most of the design:
//   1. the builder opens with the line laid down,
//   2. (first device visit only) the board REWINDS two of the user's own moves
//      and the walkthrough asks them to play one, arrow and all,
//   3. the panels, one bubble each, with that panel open behind it, then the
//      engine, switched on for the step that names it,
//   4. the board again, for the last move of the line,
//   5. Save.
//
// The line used to PLAY ITSELF IN between steps 2 and 3, and the user watched.
// Watching is what the trainer is for; the builder is where you put moves down,
// and the fastest way to learn that is to put one down.
//
// Step 5 used to be a "coach strip" in the builder's dock that cycled three
// sentences on a timer. Two teaching devices saying overlapping things in
// different voices, one of which moved on whether or not you'd read it. It's
// gone; the bubble does its job, in one voice, and waits.
let guidedActive = false;

// Are there imported games on this device? A cached answer, because the
// walkthrough's bubbles are built synchronously and IndexedDB is not. Refreshed
// at boot and after anything that could have changed it (an import, a wipe).
let gamesOnDevice = false;

function refreshGamesOnDevice(): Promise<void> {
  return countGames()
    .then(n => { gamesOnDevice = n > 0; })
    .catch(() => { /* storage off — the bubble simply keeps offering the import */ });
}

// The walkthrough's shared wiring: which panel each step opens, and the two
// connects it offers (Lichess on the Library step, the games import on My
// lines). `after` is the caller's continuation — it runs on whatever exit the
// walkthrough takes, and exactly once, including the exit that goes via the
// import sheet (which is why it waits for that sheet to close). It is handed a
// TourEnd, because "did the walkthrough get as far as offering the save?" is
// something only the walkthrough knows and the ending has to act on.
function builderIntroDeps(
  after: (end: TourEnd) => void,
  o: { startStep?: number } = {},
): BuilderIntroDeps {
  let ran = false;
  const once = (end: TourEnd): void => { if (!ran) { ran = true; after(end); } };
  return {
    onDone: once,
    showSlide: showBuilderSlide,
    isLichessConnected: isLichessConnected,
    // Games on the device turn the My-lines bubble's "Import my games" into a
    // "Games imported" pill. A bubble is painted synchronously, so this reads a
    // cached flag rather than IndexedDB — refreshGamesOnDevice keeps it honest.
    hasImportedGames: () => gamesOnDevice,
    // The user's own half of the line — what the "two more moves" bubble counts.
    // With auto-reply on, the opponent's answers are on the line too, and
    // counting those would let one move of theirs finish the step.
    ownMoveCount: () => mainline().filter(
      (_, i) => isUserMoveAtDepth(i + 1, saveColour)).length,
    // The first bubble asks for one move and promises an answer back. This is
    // what keeps that promise — and the panel it belongs to is opened with it,
    // because Explore only answers while it is the slide on screen.
    setAutoReply: (on) => {
      explorePanel?.setAutoReply(on);
      // A BLACK first line opens with White to move, so the opponent owes a move
      // before the user has played anything. clearBuilder already handles that —
      // but it runs when the builder opens, which is before this switch is
      // thrown, so the Black walkthrough would otherwise sit on an empty board
      // asking for "your first move" with White still to play.
      if (on && getCurrentNode().id === 'root') explorePanel?.openedAtStart();
    },
    goToLineEnd: endGuidedWalkthrough,
    onSave: () => { void saveCurrentLine(); },
    // Back off the first bubble: there's nothing behind the builder on a first
    // run, so it goes right back to the screen the line was picked on.
    onRestart: () => {
      guidedActive = false;
      clearBuilder(saveColour);
      // The walkthrough marked itself seen when it started; going back to the
      // start screen means it hasn't been, so the next pick gets it again.
      unmarkBuilderTourSeen();
      showView('train');
      showFirstRunPicker();
    },
    // Where the cursor and the title are, for the Lichess round-trip: the whole
    // line goes into lichess-auth's stash, this says where in it we were.
    cursorPly: () => pathTo(getCurrentNode().id).length,
    lineName: () => manualTitle ?? '',
    // Stash the WHOLE line before the OAuth redirect (not just the path to the
    // cursor — the walkthrough sits mid-line, and the moves after it are the
    // rest of the user's first line).
    onConnectLichess: () => {
      lichessStashReturn(mainline().map(n => n.uci), saveColour);
      void lichessConnect();
    },
    // The import sheet takes the whole screen, so the walkthrough steps aside
    // and comes back to the same bubble once the sheet closes — whether or not
    // anything was imported.
    onImportGames: (resume) => openImportPanel({
      onImported: () => { builderPanels?.reload(); builderPanels?.render(); },
      // Before the walkthrough comes back, so the bubble it returns to already
      // knows whether the import happened.
      onClose: () => void refreshGamesOnDevice().then(resume),
    }),
    startStep: o.startStep,
  };
}

// One curated line, opened guided. `cut`-shaped rather than LineCut-shaped so
// starter-pack lines (which have no level and no cut arithmetic) can use it too.
interface GuidedLine {
  ucis: string[];
  colour: 'white' | 'black';
  // What to CALL it in the walkthrough and on the saved line: the curated name,
  // not the book's. "This is the French Defense: Steinitz Variation, Boleslavsky
  // Variation" is not a sentence anyone wants read to them on their first minute.
  name: string;
  ownMoves: number;
  notes?: Record<number, string>;
  // Straight off the first-run picker, which only appears with no saved lines
  // and onboarding unfinished. It's what lets a walkthrough that was SKIPPED
  // last time be offered once more (see isBuilderTourOwed).
  firstRun?: boolean;
}

function startGuidedLine(line: GuidedLine): void {
  // Lays the whole line down and opens the builder with the cursor at its end —
  // the same call "From my games" uses.
  buildFromUcis(line.ucis, line.colour, [], { notes: line.notes });
  // Keep the curated name rather than letting the book rename it on save.
  manualTitle = line.name;
  renderTitle();
  guidedActive = true;

  // Rewind and watch it play itself in, using the builder's own Watch playback
  // (so it honours the watch-speed pref and can be paused mid-flight), then ask
  // what to do with it. The save step runs on EVERY guided line: it's what
  // replaced the coach strip, and a pack line opened months later needs the
  // prompt just as much.
  //
  // The WALKTHROUGH no longer runs here. It is an empty-board sequence now —
  // "play your first move", then two more — and none of that means anything on
  // a board that already has the whole line on it. Someone who arrives by a
  // pack rather than by the first-run screen gets this, and can take the
  // walkthrough from Get started or Settings whenever they want it.
  startPlaybackFromStart(() => {
    if (!guidedActive) return;
    showSaveStep({ onSave: () => { void saveCurrentLine(); } });
  });
}

// However the walkthrough ends — its last button, Skip, the back gesture — the
// board goes back to the whole line with the cursor at the end of it, so the
// user is left looking at a finished line rather than a rewound one. The engine
// goes back off with it: the walkthrough switched it on to talk about it, which
// isn't the same as the user asking for it.
function endGuidedWalkthrough(): void {
  setEngineOn(false);
  const line = mainline();
  if (line.length > 0) handleMoveClick(line[line.length - 1].id);
  refreshBoardShapes();
}

// The same ending for an empty-board first line, which has no line to land on
// and waits for the user's own moves before offering the save.
//
// UNLESS the walkthrough already offered it. Its last bubble IS the save step —
// the same title, the same two buttons — so re-arming the standalone one here
// answered "Add more moves" with the very bubble the user had just dismissed.
// The Save button in the header is lit and named by then; nothing is lost by
// letting them get on with it.
function endEmptyBoardWalkthrough(end: TourEnd = { saveOffered: false }): void {
  setEngineOn(false);
  if (end.saveOffered) return;
  armEmptyBoardSaveStep();
}

// How many moves an EMPTY-board first line waits before the save prompt shows
// up. Someone who opted out of the curated lines has nothing to watch play in,
// so there's no "the line has landed" moment to hang the prompt on — three moves
// down is the point where there is visibly a line on the board to save.
const EMPTY_BOARD_SAVE_AFTER = 3;

// The empty-board first line: no line to watch, so the save step waits for the
// user to put a few moves down themselves. It's the same guided ending as a
// curated line — save routes straight into the confirm run — because it's the
// same first line.
function armEmptyBoardSaveStep(): void {
  const check = (): void => {
    if (!guidedActive || mainline().length < EMPTY_BOARD_SAVE_AFTER) return;
    document.removeEventListener(BUILDER_MOVE_EVENT, check);
    showSaveStep({ onSave: () => { void saveCurrentLine(); } });
  };
  document.addEventListener(BUILDER_MOVE_EVENT, check);
  // The walkthrough is playable while it's on screen, so the three moves may
  // already be down by the time it ends.
  check();
}

// FIRST VISIT: the picker. One screen — colour, depth, style — and then the
// guided first line. No beta code, no carousel, no setup wizard, no account: a
// visitor should be looking at their own saved line inside a minute.
//
// It's a function rather than a one-off at boot because the walkthrough can come
// BACK here: Back on its first bubble is "I picked the wrong line", and the only
// honest answer to that is the screen the line was picked on.
function showFirstRunPicker(): void {
  showOnboardingPicker({
    // One question answered, and straight to an empty board of that colour with
    // the walkthrough on it. The walkthrough is the first line: the coach-marks
    // ask for the moves, auto-reply answers them, and the last bubble saves —
    // which routes into the confirm run exactly as any other save does.
    onStart: (colour) => {
      setOnboardingComplete();
      // NOT hooked to setOnboardingComplete itself: train-screen.ts calls that
      // on every render once the goal is reached, so counting there would count
      // repaints. This is the one place a person actually finishes first run.
      trackOnce('onboarding_complete');
      startNewLine(colour);
      guidedActive = true;
      // The bubbles point at live controls, so they wait for the builder to
      // have laid itself out.
      setTimeout(() => {
        if (!isBuilderTourOwed({ firstRun: true })) { armEmptyBoardSaveStep(); return; }
        markBuilderTourSeen();
        showBuilderIntro(builderIntroDeps(endEmptyBoardWalkthrough));
      }, 450);
    },
    // Only where accounts exist — in the internal build the line would be a
    // dead end, so the picker's foot simply doesn't grow one.
    // …and it opens the sheet in SIGN-IN mode, because the line says "I already
    // have an account" and the person tapping it does.
    onSignIn: isSupabaseConfigured ? () => openSignUpSheet('signin') : undefined,
    // The picker is the first screen on a first visit, so it clears the boot
    // splash itself rather than depending on the boot order to have done it.
    onShown: hideAppSplash,
  });
}

// Settings → Feedback & about → "Replay walkthrough": the same guided
// empty-board first line "Build my own" starts, minus the picker — a fresh
// line, forced straight into the coach-marks rather than gated on whether the
// walkthrough has already been shown.
function replayBuilderWalkthrough(): void {
  startNewLine('white');
  guidedActive = true;
  setTimeout(() => {
    markBuilderTourSeen();
    showBuilderIntro(builderIntroDeps(endEmptyBoardWalkthrough));
  }, 450);
}

// A starter-pack (or suggested) line, opened the same way the first-run line is:
// walkthrough if it's owed, then the builder, then the builder's own Save. The
// pack sheet closes itself before calling this — see onboarding-starter.ts.
function openSeedInBuilder(seed: LineSeed, colour: 'white' | 'black'): void {
  startGuidedLine({
    ucis: seed.ucis,
    colour,
    name: seed.name ?? 'New line',
    // The moves the USER has to remember: their own half of the line.
    ownMoves: colour === 'white'
      ? Math.ceil(seed.ucis.length / 2)
      : Math.floor(seed.ucis.length / 2),
    notes: withPlanNote(seed),
  });
}

// A pack line's middlegame plan rides on the final move's note — the same place
// lineFromUcis puts it, so a line opened in the builder carries exactly what a
// line added straight to training would have.
function withPlanNote(seed: LineSeed): Record<number, string> | undefined {
  if (!seed.plan || seed.ucis.length === 0) return seed.notes;
  const last = seed.ucis.length - 1;
  const notes = { ...(seed.notes ?? {}) };
  const existing = notes[last];
  notes[last] = existing ? `${existing}\n\nPlan: ${seed.plan}` : `Plan: ${seed.plan}`;
  return notes;
}

function endGuided(): void {
  guidedActive = false;
}

// Open the builder on My lines → My opponents with an opponent preselected —
// the home for the opponent "board browser" (from the Explore opponent detail).
function scoutInBuilder(opponentId: string, colour: 'white' | 'black' = 'white'): void {
  clearBuilder(colour);
  pendingScoutOpponentId = opponentId;
  pendingBuilderSlide = 'mylines';
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

// A coverage gap's "build from here" — the SAME mechanism, reached from the
// Coverage screen and the builder's My lines panel. The moves passed end with
// the reply that has no answer, so the builder opens with it already on the
// board and the next move to make is the answer. A gap that came from a scouted
// opponent goes through prepareReply so it carries their tag, exactly as
// preparing from their map does; anything else is a plain seeded build.
function prepareGap(ucis: string[], answeringColour: 'white' | 'black', opponentName?: string): void {
  if (opponentName) prepareReply(ucis, answeringColour, opponentName);
  else buildFromUcis(ucis, answeringColour);
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
    // The opponent "board browser" opens the builder's My lines → My opponents.
    onScoutInBuilder: (opponentId: string) => scoutInBuilder(opponentId),
    // The Packs tab's Lichess-study browser saves chapters straight to My Lines.
    onSaveLines: saveImportedLines,
    // The Coverage tab's rows: seed the builder at the unanswered reply.
    onPrepareGap: prepareGap,
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

  return items;
}

// The Get-started checklist's "Install the app". One tap, the browser's own
// install dialog, done — the row is only ever shown when gate.ts is holding a
// real prompt to fire (canInstallApp), so there is no instructions fallback to
// write. Either outcome re-renders Train: accepted means the row has served its
// purpose, dismissed means the prompt is spent and can't be offered again.
function installApp(): void {
  void promptInstallApp().then((outcome) => {
    if (outcome === 'accepted') showToast('Installed ✓', { variant: 'success' });
    showView('train');
  });
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
  mode: AddLineMode,
  onDone: () => void,
  onCancel: () => void,
): void {
  // 'build' never touches storage here: it hands the moves to the BUILDER and
  // lets the builder's own Save create the line, exactly as the first-run line
  // does. Anything else would save it twice.
  if (mode === 'build') { openSeedInBuilder(seed, colour); onDone(); return; }

  const line = lineFromUcis(seed, colour);
  if (!line) { onCancel(); return; }
  // 'save' is the bulk path's overflow: the line still lands in My Lines, just
  // not in the training rotation. lineFromUcis already builds it un-enrolled, so
  // there is nothing to switch off — and nothing here can ever pause a line that
  // was already in training.
  if (mode === 'save') { void saveLine(line).then(onDone); return; }
  if (mode === 'learn') addLineToTraining(line, onDone, onCancel);
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
    // A line's popup offers "Drill line" / "Add to training" — the same entry
    // point the Progress screen's Drill uses, so both behave identically.
    onTrainLine: (lineId, inTraining) => void onTrainLine(lineId, inTraining),
    onBuildLine: buildFromUcis,
    onPickStarterPack: () => void openStarterPackPicker(addStarterLine),
    // "Which openings do I play that I haven't saved?" moved to Explore.
    onSeeMyOpenings: () => { openExploreTab('openings'); showView('explore'); },
  };
}

// Add a line to training, honouring the "Confirm run before training" pref.
// ON (default): run the pre-training confirm drill, enrolling on a clean run.
// OFF: enrol instantly, with no run. The manual add-to-training paths and the
// post-save prompt all funnel through here, so they skip the gate identically.
//
// This is also THE chokepoint for the free tier's training cap. Every deliberate
// single-line add arrives here — the post-save prompt, My Lines, the Progress
// screen's Drill, and onboarding's one-at-a-time adds — so one check covers them
// all. requestTrainingSlot shows the upsell itself when it says no; we just take
// the cancel path, leaving the line saved and untouched. Bulk adds do NOT come
// through here (see addSequentially): they get a toast, not a price tag.
function addLineToTraining(
  line: Line,
  onDone: () => void,
  onCancel: () => void = () => {},
  opts: {
    forceConfirmRun?: boolean;
    completeMessage?: string;
    beforeWatch?: (start: () => void, skip: () => void) => void;
    firstMoveHint?: string;
    hideExit?: boolean;
  } = {},
): void {
  void requestTrainingSlot().then((allowed) => {
    if (!allowed) { onCancel(); return; }
    if (opts.forceConfirmRun || getConfirmRunBeforeTraining()) {
      startPretrainingRun(line, onDone, onCancel, {
        completeMessage: opts.completeMessage,
        beforeWatch: opts.beforeWatch,
        firstMoveHint: opts.firstMoveHint,
        hideExit: opts.hideExit,
      });
    } else {
      void enrolLineDirectly(line).then(onDone);
    }
  });
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

// The header text: the "bito chess" wordmark on the four main tabs, the screen's
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
    : 'bito chess';
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

// Everything on today's daily challenge is done. Stamp the day, gather the recap
// and show the celebration — once the finishing task's own results screen has
// closed, so the two don't stack. A day without a single wrong move (on a
// challenge big enough to be worth winning) gets the rare promotion popup
// instead; nothing anywhere else hints at it, which is the whole point.
function celebrateDaily(config: DailyConfig, active: DailyTaskId[], allLines: Line[]): void {
  // Only the first completion of the day celebrates — replaying a finished task
  // later on shouldn't pop it again.
  if (!markDayComplete()) return;
  // markDayComplete() is already the once-per-day gate, so a plain track() here
  // cannot double-count a replayed task later the same day.
  track('daily_completed');

  const training = allLines.filter((l) => l.inTraining);
  const recap = buildRecap({
    log: getDailyLog(),
    today: localDayKey(),
    streak: currentStreak(),
    trainingDays: getTrainingDays(),
    linesMastered: masteredLines(training).length,
    linesInTraining: training.length,
  });
  const perfect = recap.perfect && perfectDayEligible(config, active);

  showWhenClear(() => {
    if (perfect) showPerfectDayCelebration(recap);
    else showDailyCelebration(recap);
  });
}

/**
 * THE LIVE DAILY CHALLENGE — repaint + launch, always pointing at the Train
 * screen that is actually on screen.
 *
 * showView('train') calls renderTrainTabbed, which rebuilds the whole Train
 * screen from scratch: new panes, a new daily host, a new renderDaily closure.
 * Anything holding the OLD closures is then writing into detached nodes.
 *
 * That is not hypothetical. Finish the last puzzle of the daily challenge, tap
 * Analyse, come back via "Back to train" (which rebuilds Train), then tap "See
 * results": the puzzle overlay is still the one from before, so its onComplete
 * ticked the task off in storage and repainted a card that was no longer in the
 * document — the visible card sat there un-ticked. The "Next challenge →" chain
 * was worse: it rendered the next session into a detached pane, so nothing
 * happened at all.
 *
 * So a suspended session reaches the daily challenge through here instead, and
 * the newest render always owns it.
 */
let liveDaily: {
  repaint: () => void;
  launch: (id: DailyTaskId) => void;
} | null = null;

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
  // The Openings pane carries a class so CSS can give it its own desktop layout
  // (two columns above $desktop-nav — see .train-pane-openings in style.css).
  const openingsPane = document.createElement('div');
  openingsPane.className = 'train-pane-openings';
  const puzzlesPane = document.createElement('div');
  const mistakesPane = document.createElement('div');
  const endgamePane = document.createElement('div');
  host.append(dailyHost, tabs, openingsPane, puzzlesPane, mistakesPane, endgamePane);

  // This render's launchers, filled in once renderDaily has read the data it
  // needs. Held in a box rather than captured so `liveDaily` below can be set
  // SYNCHRONOUSLY — a suspended session resuming onto a freshly-built Train
  // screen must not be able to reach the previous screen's closures in the tick
  // before the async render lands. A launch asked for before the data is in is
  // remembered and run the moment it is.
  const launcher: {
    run: ((id: DailyTaskId) => void) | null;
    pending: DailyTaskId | null;
  } = { run: null, pending: null };

  // (Re)render the daily card from current lines + done state. Called on first
  // paint and after any task completes.
  const renderDaily = async (): Promise<void> => {
    let allLines: Line[];
    let spotRefs: SpotRef[];
    let pairRefs: SpotRef[];
    let detectiveRefs: DetectiveRef[];
    let gameCount: number;
    try {
      const [lines, games] = await Promise.all([getAllLines(), getAllGames()]);
      allLines = lines;
      gameCount = games.length;
      spotRefs = collectSpots(games);
      // The two newer from-your-games parts read the same scan: one takes the
      // runs it found, the other the spots that make a fair two-move question.
      detectiveRefs = collectDetectiveSpots(games);
      pairRefs = fairPairs(spotRefs);
    } catch {
      dailyHost.innerHTML = '';
      return;
    }
    dailyHost.innerHTML = '';

    // The Get-started checklist (first-steps.ts) has two positions in this slot.
    // Before there's a repertoire to have a daily challenge ABOUT it takes the
    // slot outright; past the training unlock the daily card comes back and the
    // checklist rides underneath it, compact, until it's hidden or retired.
    const showSteps = shouldShowFirstSteps();
    const buildSteps = (): HTMLElement => renderFirstSteps({
        lineCount: allLines.length,
        gameCount,
        // Adding from a pack repaints the picker itself; showView('train')
        // rebuilds this card and the pane behind it so the bar climbs too.
        onPickStarterPack: () => void openStarterPackPicker(
          (seed, colour, mode, onDone, onCancel) => addStarterLine(
            seed, colour, mode,
            () => {
              onDone();
              // A 'build' add has just moved the user INTO the builder — coming
              // back here would throw them straight out of it again. Every other
              // mode leaves them on Train, where the bar needs to climb.
              if (mode !== 'build') showView('train');
            },
            onCancel),
        ),
        onBuildLine: () => startNewLine('white'),
        // "Play the engine" is the engine BUILDER — a game against Stockfish you
        // can hand to the builder at any point (the same flow the FAB and Explore
        // open). It used to open an ordinary empty builder with the eval bar
        // switched on, which is an analysis aid, not a way to get a line.
        onImportGames: () => openImportPanel({ onImported: () => showView('train') }),
        onConnectLichess: () => void lichessConnect(),
        // The same replay Settings offers, in the one place a user who skipped
        // the walkthrough is actually looking.
        onWalkthrough: () => replayBuilderWalkthrough(),
        onSignIn: () => openSignUpSheet(),
        onInstallApp: installApp,
        // The same offer the training cap makes, asked for rather than run
        // into. One pitch, one price, one place to wire the checkout.
        onGoPro: () => showGoProDialog(),
        onHide: () => showView('train'),
    });

    // Under the three-line goal the checklist LEADS — "how do I get lines" is
    // the question that has to be answered before a daily challenge means
    // anything — and the daily card follows it in its locked, introducing face
    // (see daily-challenge.ts). Past the unlock the two swap over: the daily
    // card leads and the checklist is appended after it, at the end of this
    // function.
    const stepsLead = showSteps && firstStepsOwnsSlot(allLines.length);
    if (stepsLead) dailyHost.appendChild(buildSteps());

    // The daily config (which tasks + how many of each) and which are actually
    // runnable right now decide the card — and the "Next challenge →" chain.
    const config = getDailyConfig();
    const dailyLines = pickDailyLines(allLines, config.tasks.lines.count);
    const avail = {
      hasLines: dailyLines.length > 0,
      mistakesAvailable: spotRefs.length > 0,
      detectiveAvailable: detectiveRefs.length > 0,
      whichMoveAvailable: pairRefs.length > 0,
      // Cheap on purpose: "is any line mastered, ending on their move". Whether
      // we know anything to prepare for THERE needs the bundled opening book,
      // which is a lazily-imported 1.7 MB dataset — far too much to load on
      // every repaint of the Train screen. The launcher does that part, and
      // clears the row itself in the rare case it comes up empty.
      growAvailable: growCandidates(allLines).length > 0,
    };
    const active = activeDailyTasks(config, avail);

    // Each part as a named launcher so the success screens' "Next challenge →"
    // can chain into any of them. The next one is resolved at CLICK time (the
    // completion screen mounts before the finished part's done flag is set).
    const nextFor = (current: DailyTaskId): { label: string; run: () => void } | undefined => {
      // Offer the button only when some OTHER active part would still be open
      // once this one is done — a "Next challenge" that closes into nothing
      // misleads.
      const pretend = { ...getDaily(), [current]: true };
      if (!nextDailyTask(pretend, active)) return undefined;
      return {
        label: 'Next challenge →',
        run: () => {
          const next = nextDailyTask(getDaily(), active);
          // Through liveDaily, not `launchers`: this button can be tapped after
          // a trip through the analyser rebuilt the Train screen, and the
          // launchers captured here would then render into detached panes.
          if (next) liveDaily?.launch(next);
        },
      };
    };

    // Every task ends the same way: tick it off (filing how it went), refresh the
    // card behind the overlay, and — if that was the last one — celebrate.
    const finish = (mark: (o: TaskOutcome) => void) => (outcome: TaskOutcome): void => {
      mark(outcome);
      // Same reason as above: repaint whichever daily card is on screen NOW.
      liveDaily?.repaint();
      if (isDailyDone(config, avail)) celebrateDaily(config, active, allLines);
    };

    const launchers: Record<DailyTaskId, () => void> = {
      lines: () => {
        // Drill today's lines on the Openings pane; mark that task done when the
        // whole sitting finishes, then refresh the card behind the overlay.
        if (trainTab !== 'openings') { trainTab = 'openings'; paint(); }
        startLineSession(dailyLines, openingsPane, finish(markLinesDone), nextFor('lines'),
          'Daily challenge');
      },
      positions: () => {
        // Same pane, but a stream of single due positions rather than whole lines.
        if (trainTab !== 'openings') { trainTab = 'openings'; paint(); }
        startPositionsSession(allLines, openingsPane, config.tasks.positions.count,
          finish(markPositionsDone), nextFor('positions'), 'Daily challenge');
      },
      puzzles: () => {
        void startDailyPuzzles(config.tasks.puzzles.count,
          finish(markPuzzlesDone), nextFor('puzzles'),
          openPuzzleFromSession);
      },
      endgames: () => {
        // Rated endgame puzzles (the End game ladder) — its own overlay, no tab
        // switch needed.
        startDailyEndgamePuzzles(config.tasks.endgames.count,
          finish(markEndgamesDone), nextFor('endgames'),
          openPuzzleFromSession);
      },
      mistakes: () => {
        // A short mixed set from the scanned spots — runs as its own overlay,
        // so no tab switch is needed.
        const done = finish(markMistakesDone);
        startMistakeSession({
          // Read the shared rest at LAUNCH, not when the card was built: the
          // row above this one may have just answered some of these blunders
          // under a different exercise's name.
          refs: pickSpots(spotRefs, null, config.tasks.mistakes.count,
            combinedDueAt({})),
          // The header names the EXERCISE; "Daily challenge" is the framing
          // above it (run-header.ts), so a chained run always says what it
          // just handed you.
          contextLabel: 'Daily challenge',
          onComplete: (s) => done({ right: s.solved, wrong: Math.max(0, s.completed - s.solved) }),
          onExit: () => { if (trainTab === 'mistakes') paint(); },
          onOpenGame: openGameFromSession,
          nextAction: nextFor('mistakes'),
        });
      },
      detective: () => {
        // "Find the blunder in these six moves" — one case by default, because
        // one case is a whole exercise.
        const done = finish(markDetectiveDone);
        const dueAt = combinedDueAt(detectiveLog.dueMap());
        startDetectiveSession({
          refs: pickDetective(detectiveRefs, config.tasks.detective.count, dueAt),
          contextLabel: 'Daily challenge',
          onComplete: (s) => done({ right: s.solved, wrong: Math.max(0, s.completed - s.solved) }),
          onExit: () => { if (trainTab === 'mistakes') paint(); },
          onOpenGame: openGameFromSession,
          nextAction: nextFor('detective'),
        });
      },
      growLines: () => {
        // The one part that leaves the trainer: it opens the builder, because
        // adding a move is building. finish() is captured and called later,
        // from the commit (or the skip) — see startGrowLine.
        void startGrowLine(allLines, finish(markGrowLinesDone), nextFor('growLines'));
      },
      whichMove: () => {
        // The quick one: two moves, pick the good one.
        const done = finish(markWhichMoveDone);
        const dueAt = combinedDueAt(whichMoveLog.dueMap());
        startWhichMoveSession({
          refs: pickWhichMove(pairRefs, config.tasks.whichMove.count, dueAt),
          contextLabel: 'Daily challenge',
          onComplete: (s) => done({ right: s.solved, wrong: Math.max(0, s.completed - s.solved) }),
          onExit: () => { if (trainTab === 'mistakes') paint(); },
          onOpenGame: openGameFromSession,
          nextAction: nextFor('whichMove'),
        });
      },
    };

    launcher.run = (id) => launchers[id]();
    if (launcher.pending) {
      const queued = launcher.pending;
      launcher.pending = null;
      launchers[queued]();
    }

    const card = renderDailyChallenge({
      config,
      active,
      lines: dailyLines,
      savedLineCount: allLines.length,
      onTrainLines: () => launchers.lines(),
      onRefreshPositions: () => launchers.positions(),
      onSolvePuzzles: () => launchers.puzzles(),
      onSolveEndgames: () => launchers.endgames(),
      mistakeSpotCount: spotRefs.length,
      onFixMistakes: () => launchers.mistakes(),
      onCatchBlunders: () => launchers.detective(),
      onWhichMove: () => launchers.whichMove(),
      onGrowLine: () => launchers.growLines(),
      // The finished card reopens today's popup rather than losing its figures
      // to the tap that dismissed it.
      onReplayRecap: () => { void showRecapForDay(localDayKey(), localDayKey(), allLines); },
      // The locked card only needs its own way to a line when the checklist
      // above isn't already offering two louder ones.
      onBuildLine: stepsLead ? undefined : () => startNewLine('white'),
      // The gear in the card's corner: the same rows Settings shows, opened
      // from the thing they configure. Repaint after, so turning a task off (or
      // the whole challenge) shows on the card immediately.
      onOpenPrefs: () => openDailyPrefsSheet(() => { void renderDaily(); }),
    });
    if (card) dailyHost.appendChild(card);

    // Past the training unlock the checklist keeps its place, under the daily
    // card rather than instead of it: import, Lichess, an account and installing
    // are the easiest things in the app to put off forever, and clearing the
    // line goal is no reason for them to vanish. It goes when the user hides it
    // or when they've done one of the two that matter — see first-steps.ts.
    if (showSteps && !stepsLead) dailyHost.appendChild(buildSteps());
  };
  // This Train screen is now the live one — see liveDaily's note.
  liveDaily = {
    repaint: () => { void renderDaily(); },
    launch: (id) => {
      if (launcher.run) launcher.run(id);
      else launcher.pending = id; // the first render is still reading; run it after
    },
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
        onOpenGame: openGameFromSession,
      });
    } else {
      renderEndgameScreen(endgamePane, {
        onAnalysePosition: openPuzzleFromSession,
      });
    }
  };
  paint();
}

// Shows #bottom-nav below DESKTOP_NAV_BREAKPOINT and #side-nav at or above it;
// both stay hidden on full-screen views (builder/settings), where the back
// arrow takes over. Called from showView() on every navigation, and from the
// matchMedia listener in setupNav() so a live resize across the breakpoint
// (not just a view change) swaps the two.
function syncNavVisibility(): void {
  const onBack = BACK_VIEWS.has(currentView);
  const isDesktop = desktopNavQuery.matches;
  document.getElementById('bottom-nav')!.toggleAttribute('hidden', onBack || isDesktop);
  document.getElementById('side-nav')!.toggleAttribute('hidden', onBack || !isDesktop);
  // The FAB rides along with whichever nav is showing: visible on the five
  // main tabs, hidden on the full-screen builder/settings.
  fabController?.setVisible(!onBack);
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
  // A CSS hook for rules that must reach OUTSIDE the view's own element — the
  // builder's desktop grid needs `main` to drop the sidebar gutter it reserves,
  // and `main` is the parent. Same discipline as data-theme / data-board.
  document.documentElement.dataset.view = view;
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

  // Full screens swap the primary nav (bottom tab bar, or the sidebar at
  // desktop width) for a back arrow.
  const onBack = BACK_VIEWS.has(view);
  document.getElementById('nav-back')!.toggleAttribute('hidden', !onBack);
  syncNavVisibility();

  // The builder puts Save in the top-right; the settings icon is hidden on both
  // the builder (Save takes its place) and the Settings screen itself. While a
  // training session is suspended behind the analyser, "Back to train" takes
  // Save's spot instead.
  const onBuilder = view === 'builder';
  document.getElementById('header-save')!.toggleAttribute('hidden', !onBuilder || !!suspendedSession);
  document.getElementById('nav-settings')!.toggleAttribute('hidden', onBuilder || view === 'settings');

  document.querySelectorAll<HTMLElement>('#bottom-nav .tab-item, #side-nav .side-item').forEach(btn => {
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
      // A forgotten-move row: three reps of that move, then the full line, then
      // back to a freshly-read Statistics so the counts reflect the drill.
      onFixMove: (move, lines) => startMoveFix(
        { preFen: move.preFen, san: move.san, colour: move.colour, count: move.lapses },
        lines,
        () => showView('progress'),
      ),
    });
  }

  if (view === 'settings') {
    renderSettingsScreen(settingsEl);
  }

  if (view === 'builder') {
    // Land on the first tab by default (Explore in the builder, Game in the
    // analyser, engine off); an external link can request a different tab via
    // pendingBuilderSlide. Forcing activeSlide to a sentinel makes onActiveSlide
    // run fully (so the engine state is set correctly).
    applyBuilderSlideOrder();
    const requested = pendingBuilderSlide ? slideIndex(pendingBuilderSlide) : -1;
    const slide = requested >= 0 ? requested : 0;
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
      explorePanel?.reload();
      explorePanel?.render();
      enginePanel?.render();
    });
  } else {
    // Leaving the builder for any other screen: stop the engine it was running,
    // and stand the grow brief down. The daily row is deliberately NOT ticked
    // off — walking away from it isn't doing it, and the card still offers it.
    if (evalPanel && evalPanel.isEnabled) evalPanel.setEnabled(false);
    if (growPanel?.target()) { growDone = null; growNext = undefined; endGrowSession(); }
  }

  // Un-hide the suspended session's overlay only once its home screen is back.
  resumeSuspended?.();
}

// ── Grow your lines ──────────────────────────────────────────────────────────
//
// The daily challenge's one CREATIVE part: stand at the end of a line you have
// mastered and add an answer to something you'd meet next. The choosing and the
// ranking are grow-line.ts (pure); the brief is grow-panel.ts (the extra tab);
// this is the wiring — open the book at the right node, hand the panel a target,
// and notice when the job is done.
//
// It deliberately does NOT run as a session overlay like every other part. See
// the header of grow-panel.ts: adding a move is building, and the builder is
// where the tools are.

/** The node the exercise is standing at, so "back to the end" has somewhere to go. */
let growEndNodeId: string | null = null;
/**
 * Today's tick-it-off, captured at LAUNCH.
 *
 * Every other part finishes inside the Train screen, where `finish()` is still
 * in scope. This one finishes in the builder — possibly minutes later, after a
 * trip round the Library and the engine — so the callback has to be held rather
 * than looked up. Cleared as soon as it is used: the row is done once.
 */
let growDone: ((o: TaskOutcome) => void) | null = null;
/**
 * …and the part of the day to move on to once it is, captured at the same
 * moment and for the same reason. Undefined when this was the last open part —
 * the challenge is then done, and the card says so on the way back.
 */
let growNext: { label: string; run: () => void } | undefined;

/**
 * Open the builder on a line worth growing, with the brief on its own tab.
 *
 * The three evidence sources are read ONCE here rather than on every Train
 * repaint — the opening book is a lazily-imported 1.7 MB dataset, and the game
 * index is a replay of every imported game — which is exactly why the daily
 * card's availability check (growAvailable) asks a cheaper question and leaves
 * this to the tap.
 */
async function startGrowLine(
  lines: Line[],
  done: (o: TaskOutcome) => void,
  next?: { label: string; run: () => void },
): Promise<void> {
  // Ordered, not trimmed. The part grows ONE line (dailyCountCeiling), but the
  // first candidate may be a position none of the sources knows anything about
  // — and the answer to that is the next candidate, not an empty exercise.
  const candidates = growCandidates(lines);
  const spots = pickGrowSpots(candidates, candidates.length, growAt());
  if (spots.length === 0) { growNothingToDo(done); return; }

  const colour = spots[0].line.colour;
  const [games, opponents, entries] = await Promise.all([
    getAllGames(), getAllOpponents(), loadBookEntries(),
  ]);
  const book = buildBook(entries);
  // One index per colour, and every candidate we look at is that colour's —
  // pickGrowSpots is ordered, so mixing colours would mean rebuilding the index
  // mid-search for no gain. Candidates of the other colour simply wait a day.
  const gameIndex = growGameIndex(games, colour);
  const scoutIndex = growScoutIndex(
    opponents.map(o => ({ name: o.name, games: o.games })), colour,
  );
  const sources = (spot: GrowSpot): GrowSources => ({
    games: gameIndex,
    scouts: scoutIndex,
    book: bookReplies(book, spot),
  });

  const target = firstGrowTarget(spots.filter(s => s.line.colour === colour), sources);
  if (!target) { growNothingToDo(done); return; }

  const line = target.spot.line;
  const parsed = parseLineId(line.id);
  if (!parsed) { growNothingToDo(done); return; }

  growDone = done;
  growNext = next;
  growEndNodeId = parsed.endNodeId;
  // Before showView: the tab strip is built from whether a target is set.
  growPanel?.setTarget(target);

  stopPlayback();
  builderMode = 'builder';
  manualTitle = line.name;
  detectedName = '';
  builderDesc = '';
  renderBuilderDesc();
  pendingBuilderSlide = 'grow';
  showView('builder');
  await enterBuilderBook(line.colour, () => handleMoveClick(parsed.endNodeId), parsed.repertoireId);
}

/** SAN → how many named openings continue that way, at this spot. */
function bookReplies(book: ReturnType<typeof buildBook>, spot: GrowSpot): Map<string, number> {
  const node = bookNodeAt(book, spot.sans);
  const out = new Map<string, number>();
  if (!node) return out;
  for (const [san, child] of node.children) out.set(san, child.count);
  return out;
}

// Availability said there was a mastered line; the sources say they know
// nothing about where it ends. Rare, and not the user's fault, so the row
// clears rather than sitting there un-clearable for the rest of the day.
function growNothingToDo(done: (o: TaskOutcome) => void): void {
  showToast('Nothing new to prepare at the end of your lines today');
  done({ right: 0, wrong: 0 });
  growDone = null;
  growNext = undefined;
}

/** The rest log as the lookup every picker in the app takes. */
function growAt(): (lineId: string) => number {
  const map = growDueMap();
  return (id: string): number => map[id] ?? 0;
}

/**
 * A commit landed while the exercise was running — that IS the exercise.
 *
 * Not checked against the grown branch: standing in the grow builder and adding
 * moves to the book is the job, wherever in the book they went. A stricter test
 * would fail the honest case where someone answers the reply and then fixes a
 * neighbouring line while they're in there.
 *
 * It ends by leaving the builder, because the builder was never the
 * destination: the row came from the daily card and the day carries on there.
 * The next part is launched straight away where there is one — the same
 * "Next challenge →" chain every other part offers, taken automatically because
 * this one has no completion screen to put a button on.
 */
function finishGrowSession(): void {
  const target = growPanel?.target();
  if (!target) return;
  // A grown line usually drops out of the pool on its own — its new moves have
  // never been drilled, so it stops being "mastered" until it is learned again.
  // The rest covers the case where it doesn't: a branch grown into material
  // already in training can come back mastered within days.
  restGrowLine(target.spot.line.id, GROW_GROWN_DAYS);
  endGrowSession();
  growDone?.({ right: 0, wrong: 0 });
  growDone = null;
  const next = growNext;
  growNext = undefined;
  showView('train');
  liveDaily?.repaint();
  // After showView, so the launcher it reaches is the freshly-rendered Train
  // screen's own (liveDaily queues it if that render is still in flight).
  next?.run();
}

/** "Skip for today": stand this line aside, clear the row, go back to Train. */
function skipGrowLine(): void {
  const target = growPanel?.target();
  if (!target) return;
  restGrowLine(target.spot.line.id, GROW_SKIP_DAYS);
  endGrowSession();
  growDone?.({ right: 0, wrong: 0 });
  growDone = null;
  // A skip clears the row but does NOT pull the next part up: skipping is
  // saying "not now", and answering it with another exercise would be the app
  // arguing. The card is there when they want it.
  growNext = undefined;
  liveDaily?.repaint();
  showToast('Skipped — a different line tomorrow');
  showView('train');
}

/**
 * Put the builder's tab strip back the way it was.
 *
 * Every way out of the exercise leaves the builder (a finished grow goes to the
 * next part of the day, a skip goes back to the card), so there is nothing to
 * scroll to here — the strip is simply rebuilt for the next visit.
 */
function endGrowSession(): void {
  growEndNodeId = null;
  growPanel?.setTarget(null);
  applyBuilderSlideOrder();
}

function onOpenLine(line: Line, atFen?: string): void {
  stopPlayback();
  // A saved line is a path through a book, so opening one means opening the book
  // and standing at the end of that path — with every neighbouring line still
  // there beside it, which is the whole difference from the old builder.
  const endId = parseLineId(line.id)?.endNodeId;
  if (endId) {
    builderMode = 'builder';
    manualTitle = line.name;
    detectedName = '';
    builderDesc = '';
    renderBuilderDesc();
    showView('builder');
    // A saved line names its own book in its id — open THAT one, never whichever
    // book the list happened to be filtered to.
    void enterBuilderBook(line.colour, () => {
      handleMoveClick(endId);
      if (atFen) {
        const target = currentLineNodes().find(n => n.fen === atFen);
        if (target) handleMoveClick(target.id);
      }
    }, parseLineId(line.id)?.repertoireId);
    return;
  }

  loadTree(line.tree);
  loadedLineId = line.id;
  loadedLineCreatedAt = line.createdAt;
  loadedLineInTraining = line.inTraining;
  workingPriority = linePriority(line);

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

// The desktop sidebar's five destinations — same views, order and icons as
// #bottom-nav's static markup in index.html, built here (rather than
// hardcoded HTML) so it can reuse Icons.
const SIDE_NAV_ITEMS: ReadonlyArray<{ view: ViewName; label: string; icon: () => SVGSVGElement }> = [
  { view: 'train', label: 'Train', icon: () => Icons.zap(22) },
  { view: 'lines', label: 'My Lines', icon: () => Icons.pawn(22) },
  { view: 'explore', label: 'Explore', icon: () => Icons.compass(22) },
  { view: 'games', label: 'My games', icon: () => Icons.build(22) },
  { view: 'progress', label: 'Statistics', icon: () => Icons.barChart(22) },
];

// The sidebar carries the app's identity at desktop width, so the header can
// disappear entirely on the five tab screens: the wordmark sits at the top, the
// five destinations in the middle, and the user/settings entry is pinned to the
// bottom.
function buildSideNav(): void {
  const nav = document.getElementById('side-nav')!;

  // Wordmark — same lower-case "bito chess" the header shows, same font (see
  // .side-brand in style.css). Static text, not a control: the header wordmark's
  // tap-to-reload is a phone gesture, and a stray desktop click reloading the
  // app would be a nasty surprise.
  const brand = document.createElement('div');
  brand.className = 'side-brand';
  brand.textContent = 'bito chess';
  nav.appendChild(brand);

  const items = document.createElement('div');
  items.className = 'side-nav-items';
  for (const item of SIDE_NAV_ITEMS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'side-item';
    btn.dataset.view = item.view;
    btn.appendChild(item.icon());
    const label = document.createElement('span');
    label.textContent = item.label;
    btn.appendChild(label);
    items.appendChild(btn);
  }
  nav.appendChild(items);

  nav.appendChild(buildSideCreate());
  void refreshSideCreate();

  nav.appendChild(buildSideUser());
}

// Desktop's stand-in for the FAB: the same speed-dial actions (buildFabActions),
// laid out as plain always-visible buttons instead of a popover, since there's
// no bottom-right corner to float over on a sidebar layout. Sits between the
// five destinations and the settings entry. Rebuilt fresh each time (same as
// the FAB menu) so "Import last game" reflects the live connected-account
// state; see refreshSideCreate().
function buildSideCreate(): HTMLElement {
  const section = document.createElement('div');
  section.className = 'side-create';
  section.id = 'side-create';

  const title = document.createElement('div');
  title.className = 'side-create-title';
  title.textContent = 'Create a new line';
  section.appendChild(title);

  const list = document.createElement('div');
  list.className = 'side-create-items';
  list.id = 'side-create-items';
  section.appendChild(list);

  return section;
}

// Rebuild #side-create-items from buildFabActions() — the exact same list,
// same onClick handlers, the FAB's speed-dial offers. Called on mount and
// whenever the connected-account state might have changed (mirrors
// applySideUserAvatar's IDENTITY_CHANGED_EVENT hook).
async function refreshSideCreate(): Promise<void> {
  const list = document.getElementById('side-create-items');
  if (!list) return;
  const items = await buildFabActions();
  list.innerHTML = '';
  for (const item of items) {
    list.appendChild(item.kind === 'split' ? sideCreateSplitRow(item) : sideCreateActionRow(item));
  }
}

function sideCreateActionRow(item: FabAction): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'side-create-item';
  const ic = document.createElement('span');
  ic.className = 'side-create-icon' + (item.iconFrame ? ` side-create-icon--token-${item.iconFrame}` : '');
  ic.appendChild(item.icon);
  row.appendChild(ic);
  row.appendChild(sideCreateText(item.label, item.sublabel));
  row.addEventListener('click', item.onClick);
  return row;
}

function sideCreateSplitRow(item: FabSplit): HTMLElement {
  const row = document.createElement('div');
  row.className = 'side-create-item side-create-item--split';
  row.appendChild(sideCreateText(item.label));
  const split = document.createElement('span');
  split.className = 'side-create-split';
  for (const [side, cls] of [[item.left, 'side-create-split-white'], [item.right, 'side-create-split-black']] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'side-create-split-btn ' + cls;
    b.textContent = side.label;
    b.addEventListener('click', side.onClick);
    split.appendChild(b);
  }
  row.appendChild(split);
  return row;
}

function sideCreateText(label: string, sublabel?: string): HTMLElement {
  const text = document.createElement('span');
  text.className = 'side-create-text';
  const main = document.createElement('span');
  main.className = 'side-create-label';
  main.textContent = label;
  text.appendChild(main);
  if (sublabel) {
    const sub = document.createElement('span');
    sub.className = 'side-create-sub';
    sub.textContent = sublabel;
    text.appendChild(sub);
  }
  return text;
}

// The bottom entry: avatar + label, opening Settings. There are no accounts yet
// (nothing in the app stores a display name — the only identity we hold is the
// connected games source), so the label is simply "Settings" and the avatar
// falls back to a generic user icon. The shape is the one an account would want
// though: when names land, sideUserLabel() returns the account name and the
// existing "Settings" text moves to a sub-label under it — no restructuring.
function buildSideUser(): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'side-user';
  btn.id = 'side-user';
  btn.appendChild(userAvatar(getGamesSource()?.avatarUrl, 28));
  const label = document.createElement('span');
  label.className = 'side-user-label';
  label.textContent = sideUserLabel();
  btn.appendChild(label);
  return btn;
}

// What the sidebar's bottom entry is called. No account system exists, so it's
// the destination's name; a later round returns the signed-in name here.
function sideUserLabel(): string {
  return 'Settings';
}

// Keep the sidebar entry's avatar in step with the connected games source (the
// same picture the header's settings button shows), rebuilding just the avatar.
function applySideUserAvatar(): void {
  const btn = document.getElementById('side-user');
  if (!btn) return;
  btn.firstChild?.remove();
  btn.prepend(userAvatar(getGamesSource()?.avatarUrl, 28));
}

// Settings has two shapes. At desktop width the sidebar owns the app's identity
// and there's no header to title a full screen, so Settings opens as a centred
// lightbox over the current tab (see settings-lightbox.ts). Below the
// breakpoint it stays exactly what it has always been: a swapped-in full-screen
// view with the back arrow.
function openSettings(): void {
  if (desktopNavQuery.matches) openSettingsLightbox();
  else showView('settings');
}

function setupNav(): void {
  buildSideNav();
  // desktopNavQuery.matches flips on a live resize without a view change
  // (e.g. dragging a window wider), so re-run the same swap showView() does.
  desktopNavQuery.addEventListener('change', () => {
    // Dropping below the breakpoint with the desktop lightbox open: hand over
    // to the full-screen view, so we never sit in a modal on a phone-width
    // screen. (Widening the other way leaves an already-open full-screen
    // Settings alone — it still has its header and back arrow.)
    if (!desktopNavQuery.matches && isSettingsLightboxOpen()) {
      closeSettingsLightbox();
      showView('settings');
      return;
    }
    syncNavVisibility();
  });

  document.querySelectorAll<HTMLElement>('#bottom-nav .tab-item, #side-nav .side-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view as ViewName | undefined;
      if (view) guardBuilderLeave(() => showView(view));
    });
  });

  // Back arrow on full screens — stop any playback and return to where we came from.
  document.getElementById('nav-back')!.addEventListener('click', () => {
    guardBuilderLeave(() => { stopPlayback(); showView(returnView); });
  });

  // The header user icon (phones) and the sidebar's bottom entry (desktop) both
  // open Settings — as a full screen or a lightbox, whichever the width calls for.
  document.getElementById('nav-settings')!.addEventListener('click', () => {
    guardBuilderLeave(openSettings);
  });
  document.getElementById('side-user')!.addEventListener('click', () => {
    guardBuilderLeave(openSettings);
  });

  // Tapping the "bito chess" wordmark reloads the app — a quick way to pull the
  // latest deploy. Only active on the main tabs (where it shows the wordmark), so
  // it never bypasses the builder's unsaved-work guard.
  document.getElementById('header-title')!.addEventListener('click', () => {
    if (!BACK_VIEWS.has(currentView)) location.reload();
  });

  // Show your Chess.com picture on the settings button when connected, and keep
  // it in step with every import / auto-refresh.
  applyNavSettingsAvatar();
  applySideUserAvatar();
  window.addEventListener(IDENTITY_CHANGED_EVENT, () => {
    applyNavSettingsAvatar();
    applySideUserAvatar();
    void refreshSideCreate();
  });

  // Settings → Feedback & about → "Replay walkthrough": open the builder on a
  // fresh line and force the coach-marks, the same way "Build my own" does for
  // a first-time visitor.
  window.addEventListener(REPLAY_WALKTHROUGH_EVENT, () => replayBuilderWalkthrough());

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
  // Inside a book there is no "this line" to save — there are N moves you have
  // played and not yet added. Discard removes them from the working tree, so
  // leaving really does leave the repertoire as it was.
  if (inBook()) {
    const n = pendingCount();
    const drafted = pendingLines();
    // More than one line built: the old dialog offered a single "Discard" that
    // threw away everything at once, having named none of it. Show the lines
    // instead, and let one be dropped — or added and trained — without taking
    // the others with it.
    if (drafted.length > 1) {
      const lines = draftSheetLines(drafted);
      openDraftSheet({
        lines,
        leaving: true,
        onAddAll: () => {
          const wants = new Map(lines.map(l => [l.endId, l.training]));
          void commitBook(wants).then(() => proceed());
        },
        onRemove: (cutId) => { discardBranch(cutId); afterDraftEdit(); },
        onGoTo: (endId) => handleMoveClick(endId),
        onDiscardAll: () => { discardPending(); proceed(); },
        onKeepEditing: () => { /* stay put — the back layer is already re-armed */ },
      });
      return;
    }
    showDialog({
      title: 'Add these moves?',
      body: n === 1
        ? 'You’ve played one move that isn’t in your repertoire yet.'
        : `You’ve played ${n} moves that aren’t in your repertoire yet.`,
      buttons: [
        {
          label: n === 1 ? 'Add it' : 'Add them',
          variant: 'primary',
          onClick: () => { void commitPending().then(() => proceed()); },
        },
        { label: 'Discard', variant: 'danger', onClick: () => { discardPending(); proceed(); } },
        { label: 'Keep editing', variant: 'secondary' },
      ],
    });
    return;
  }
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
    // Preserve the run counter and the training priority across an edit —
    // rebuilding the line from the board must not reset how often it comes
    // round, or how many times it has been drilled.
    timesTrained: isNew ? undefined : currentTrainingLine?.timesTrained,
    // The Line info control is live before the first save, so its value is the
    // source of truth for both a new line and an edited one.
    priority: workingPriority,
  };
}

// What the position index had to say about the line as it went in — computed
// BEFORE the write, while the index still describes the repertoire without it.
interface SaveIndexOutcome {
  inherit: InheritResult;
  overlap: DuplicateVerdict | null;
}

// Persist the builder's current state, leaving the builder "clean". Returns the
// saved line (and whether it was newly created), or null when there's nothing to
// save. Shared by the header Save and the leave-guard's Save.
async function persistCurrentLine(): Promise<
  { line: Line; isNew: boolean; index: SaveIndexOutcome } | null
> {
  if (isEmpty()) {
    showToast('Play a move first');
    return null;
  }
  const isNew = !loadedLineId;
  const line = buildCurrentLine();
  // Lock in the auto-named title so it sticks as the manual name.
  manualTitle = line.name;

  // Everything the index has to say, read while it still describes the
  // repertoire WITHOUT this line, and applied before the write:
  //
  //  • inheritReviews gives every user move the training it has already had in
  //    another line (TRANSPOSITIONS.md §7). It runs here, ahead of the write and
  //    therefore ahead of the enrolment path, so the confirm run and the
  //    scheduler both see the inherited state rather than a line of new moves.
  //  • the overlap verdict is what the extension toast reports afterwards (§6).
  const index = await positionIndex();
  const outcome: SaveIndexOutcome = {
    inherit: inheritReviews(line, index),
    overlap: index.duplicatesOf(line),
  };
  // buildCurrentLine serialises a CLONE, so inheritReviews wrote onto the copy
  // being stored and the builder's live tree is untouched — which is what we
  // want: `line` is the object the enrolment path below receives, so the confirm
  // run and the scheduler get the inherited records, and the board doesn't move.
  // Take back the line AS STORED. A new line is built here with a fresh UUID,
  // but the id it actually gets is derived from the book and the node its last
  // move landed on (lines-view.makeLineId) — so the object we built is not the
  // object that exists, and anything downstream that looks a line up by id (the
  // "just saved" highlight on My Lines, a second save of the same line) was
  // quietly missing.
  const stored = await saveLine(line);
  // The My-lines slide reads saved lines from storage; refresh it so a just-saved
  // line shows up in "My saved lines" without leaving the builder.
  builderPanels?.reloadLines();
  loadedLineId = stored.id;
  loadedLineCreatedAt = stored.createdAt;
  loadedLineInTraining = stored.inTraining;
  workingPriority = linePriority(stored);
  currentTrainingLine = stored;
  // A line that has just been saved for the first time gains the controls that
  // only make sense on a saved line — the training toggle, the priority, the
  // stats — so the panel has to be told.
  updateSaveButtonLabel();
  // The builder now matches storage — no unsaved edits.
  savedSnapshot = builderSnapshot();
  return { line: stored, isNew, index: outcome };
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

/**
 * Game analyser: "Open in builder" hands the CURRENT path (root → the move on
 * the board) to the builder as a line to carry on with, instead of filing it
 * straight to My Lines. Same handoff the board browser makes — the moves land
 * as an ordinary build that merges into your book when you save it.
 */
function openCurrentPathInBuilder(): void {
  const ucis = pathTo(getCurrentNode().id).map(n => n.uci);
  if (!ucis.length) { showToast('Step to a move first'); return; }
  buildFromUcis(ucis, saveColour);
  showToast('Carry on from here');
}

// Surface a saved line on My Lines, highlighted so it's easy to find.
function goToSavedLine(id: string): void {
  focusSavedLine(id);
  showView('lines');
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
//
// EXCEPT ON THE GUIDED FIRST LINE, where it is taken silently. Auto-reply is on
// throughout the walkthrough — that is what makes "play a move, get an answer"
// true — so the line ALWAYS ends on the opponent's reply, and a first-timer
// pressing "Save line" would meet a three-button modal adjudicating a rule they
// have never heard of, every single time. Trimming is the answer the dialog
// itself recommends, so on the first line it is simply applied.
function afterPartialSave(): void {
  if (guidedActive && !isEmpty() && lineEndsOnOpponentMove()) {
    trimLastMove();
    afterEndNudge();
    return;
  }
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
  // A branched-off line is a new line: same default intent as any other.
  loadedLineInTraining = true;
  currentTrainingLine = null;
}

// Persist + confirm + offer training. Split out so the save nudge can route here
// after the user picks trim / keep.
async function finishSave(): Promise<void> {
  // The Line info toggle's answer, read BEFORE the save — persisting a new line
  // resets the flag to the stored (false) value, and it's the intent we want.
  const wantsTraining = loadedLineInTraining;
  const result = await persistCurrentLine();
  if (!result) return;
  const { line, isNew, index } = result;

  // Only a NEW line counts. An edit re-saved is not a line being built, and the
  // analyser's "Save line" is deliberately not counted at all — it extracts a
  // path from a game, which is a different act with a different intent.
  if (isNew) track('line_saved');

  // One toast for the save, carrying the inheritance sentence when there is one
  // (TRANSPOSITIONS.md §7) — silent at zero, because "0 of these 10 moves you
  // already know" is noise.
  const note = inheritanceNote(index.inherit);
  const saved = isNew ? 'Line saved ✓' : 'Changes saved ✓';
  showToast(note ? `${saved} — ${note}` : saved, { variant: 'success' });

  // …then, queued behind it, the overlap notice (§6). Both are toasts on
  // purpose: an extension is worth knowing about and never worth blocking on.
  showExtensionNotice(line, index.overlap);
  // Already enrolled — no point asking; just surface it on My Lines.
  if (line.inTraining) {
    goToSavedLine(line.id);
    return;
  }
  // The guided first line goes STRAIGHT into the confirm run. No "start training
  // this line?" dialog: they were told to save it two beats ago, and a modal
  // asking whether they meant it is exactly the friction this first run exists
  // to remove.
  if (guidedActive) {
    finishGuidedSave(line);
    return;
  }
  // Everyone else answered the question on the panel while they were building.
  // Off means off; on goes straight into the enrolment path, which is where the
  // free-tier cap and the confirm run live. The old "Start training this line?"
  // dialog asked something that had already been decided.
  if (!wantsTraining) {
    goToSavedLine(line.id);
    return;
  }
  addLineToTraining(line, () => goToSavedLine(line.id), () => goToSavedLine(line.id), { hideExit: true });
}

// TRANSPOSITIONS.md §6 — the line just saved overlaps one already stored, and
// silently keeping a line plus a truncated copy of it is how a repertoire rots.
// Never blocks the save, and never blocks the enrolment behind it: it's a toast
// with one optional action, queued behind the save confirmation.
//
// The two directions are deliberately not symmetrical. Where the new line
// CONTAINS an older one, the older one is now redundant and removing it is
// offered — behind a confirm, because it's a delete. Where the new line is
// contained BY a longer one, nothing is offered but the name and a way to look
// at it: the longer line is the user's work and this code doesn't get to touch
// it. `divergent` and `identical` say nothing at all — neither is a problem.
function showExtensionNotice(line: Line, overlap: DuplicateVerdict | null): void {
  if (!overlap) return;

  if (overlap.relation === 'extension-longer') {
    const shorterId = overlap.otherLineId;
    const shorter = overlap.otherLineName || 'an older line';
    showToast(`This continues “${shortLineName(shorter)}”, which you already have.`, {
      action: {
        label: 'Remove it',
        onClick: () => showDialog({
          title: 'Remove the shorter line?',
          body: `“${shorter}” is the first ${overlap.sharedPlies} half-moves of the line you just saved, so everything in it is now covered by “${line.name}”. Removing it also removes its training history.`,
          buttons: [
            {
              label: 'Remove it', variant: 'danger', onClick: () => {
                void deleteLine(shorterId).then(() => {
                  builderPanels?.reloadLines();
                  showToast(`Removed “${shorter}” ✓`, { variant: 'success' });
                });
              },
            },
            { label: 'Keep both', variant: 'secondary' },
          ],
        }),
      },
    });
    return;
  }

  if (overlap.relation === 'extension-shorter') {
    const longerId = overlap.otherLineId;
    const longer = overlap.otherLineName || 'a longer line';
    showToast(`“${shortLineName(longer)}” already contains this line.`, {
      action: {
        label: 'Open it',
        onClick: () => {
          void getLine(longerId).then(l => { if (l) onOpenLine(l); });
        },
      },
    });
  }
}

// Save → "here's what the trainer does" → confirm run → "it's in training" →
// the one sign-up ask. The whole point of the guided run is that this happens in
// one unbroken movement.
//
// The one thing that IS interrupted is the hand-off to the trainer. The confirm
// run auto-plays the line and then silently waits for the user to play it back;
// with no warning, that pause reads as the app having frozen. One card that says
// "watch it, then play it" turns the same twenty seconds into a game.
//
// It shows ON THE TRAINER, not before it, and as a coach-mark on the board
// rather than a card in the middle of the screen: the trainer mounts first,
// board and all, and `beforeWatch` holds the moves at the start position until
// the bubble's one button is pressed. Nothing is being decided there, so there
// is nothing to decline.
function finishGuidedSave(line: Line): void {
  endGuided();

  // "Skip this time" on the trainer's introduction, as opposed to backing out of
  // a run that had already started. Both land in onCancel; only one of them is
  // the user saying "I'm done setting up, let me look around".
  let skipped = false;

  void getAllLines().then(all => addLineToTraining(
    line,
    () => {
      showView('train');
      // Land on the hub, then mark the moment: a centred success card with the
      // celebrating pawn, what to do next, and — only here, straight after
      // something that went well — the one account ask we ever make. It no-ops
      // into a plain well-done card when there are no accounts to make or the
      // user is already signed in.
      showFirstLineSuccess();
    },
    () => {
      // Skipped the run on purpose: the line is saved and in training, so this
      // IS the end of the first run — hub, and the card that says so.
      if (skipped) { showView('train'); showFirstLineSuccess(); return; }
      // Cancelled the run (or the cap said no): the line is saved either way, so
      // land on it rather than dropping them somewhere they didn't ask for.
      goToSavedLine(line.id);
    },
    {
      // The confirm run IS the payoff here, so it runs even for someone who has
      // turned it off in Settings — which on a true first visit is nobody.
      forceConfirmRun: true,
      // Don't promise a review tomorrow that the training lock won't deliver:
      // below the unlock, the true next step is more lines.
      completeMessage: trainingUnlockedMessage(all.length),
      // A coach-mark on the board, not a card in the middle of the screen: a
      // card explains the app, a bubble on the board explains THE BOARD — which
      // is the thing about to move. Any exit starts the run, so a back gesture
      // can't leave a mounted trainer frozen — except the explicit "Skip this
      // time", which is someone saying they'd rather go and look around. The
      // line is saved and in training either way.
      beforeWatch: (start, skip) => showTrainerIntro({
        onStart: start,
        onSkip: () => { skipped = true; skip(); },
      }),
      // Once the line has played itself through, the first move is asked for by
      // name and shown with an arrow — the one place in the app where we give
      // the answer away, because there is nothing to remember yet.
      firstMoveHint: 'Play the first move of the line',
    },
  ));
}

// What the confirm run says when it lands, given how many lines are now saved.
// Below the training lock the honest next step is more lines, not "see you
// tomorrow" — Train won't have a session for them tomorrow either way.
function trainingUnlockedMessage(lineCount: number): string {
  const left = TRAINING_UNLOCK_LINES - lineCount;
  if (left <= 0) return 'It’s in training. It’ll come back tomorrow, before you forget it.';
  return left === 1
    ? 'Learned. One more line and your daily training opens up.'
    : `Learned. ${left} more lines and your daily training opens up.`;
}

function setupSaveButton() {
  document.getElementById('header-save')!.addEventListener('click', () => {
    if (builderMode === 'analyser') { void saveGame(); return; }
    // The guided first line has ONE ending, and this button is part of it.
    // Standing inside a book the header ordinarily ADDS moves — which commits
    // them and then runs a bare confirm run: no trainer introduction, no
    // success card, no account offer, and a walkthrough bubble left sitting on
    // top of it. Under the walkthrough it means what the bubble beside it
    // means, and goes down the same path the bubble's Save does.
    if (guidedActive && inBook() && hasPending()) { void saveCurrentLine(); return; }
    if (inBook()) { handleBookHeaderTap(); return; }
    // The line on the board already exists: open it, or add the tag that's new.
    // Handled here rather than inside saveCurrentLine so it short-circuits the
    // whole save flow — none of the three nudges apply to a line we aren't
    // saving. (TRANSPOSITIONS.md §4/§5.)
    if (handleDuplicateSaveTap()) return;
    void saveCurrentLine();
  });
  document.getElementById('save-line-btn')?.addEventListener('click', () => {
    void saveLineFromCurrentPath();
  });
  // The analyser's other way out: take the moves up to the cursor into the
  // builder and carry on building from there, rather than filing them straight
  // as a line. Same handoff the board browser's "Open in builder" makes.
  document.getElementById('open-builder-btn')?.addEventListener('click', openCurrentPathInBuilder);
  const deleteBtn = document.getElementById('line-delete');
  if (deleteBtn) {
    deleteBtn.appendChild(Icons.trash(16));
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
  // Flip: swap to the other side AND switch which colour this line saves as —
  // building from White and flipping means you're now preparing the Black side.
  document.getElementById('board-flip')!.addEventListener('click', () => {
    void flipBuilderColour();
  });

}

/**
 * Turn the board round and change the colour this line saves as.
 *
 * The second half is the point: the sides of a chess position are not
 * interchangeable, and looking at one from the other side is nearly always the
 * moment you decide to prepare THAT side instead. So the flip carries the work
 * across rather than just re-drawing it.
 *
 * INSIDE A BOOK that means moving to the other colour's book, because a book
 * holds one colour and nothing else. The moves on the board come along: the path
 * is replayed into the new book, walking onto whatever it already has and
 * leaving the rest as a draft — exactly what playing those moves by hand would
 * have produced. Without the replay the flip would silently empty the board.
 */
async function flipBuilderColour(): Promise<void> {
  stopPlayback();
  const next: 'white' | 'black' = saveColour === 'white' ? 'black' : 'white';
  const ucis = inBook() ? currentPathUcis() : [];

  cg.toggleOrientation();
  saveColour = next;

  if (inBook()) {
    // A new book, then the same moves played into it. openBook resets the tree
    // and the cursor, so everything below rebuilds from the replayed path.
    await openBook(next, selectedBookId() === 'all' ? undefined : selectedBookId());
    resetBuilderTip();
    chess.reset();
    goTo('root');
    for (const uci of ucis) {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = (uci[4] as 'q' | 'r' | 'b' | 'n') || 'q';
      const result = chess.move({ from, to, promotion });
      if (!result) break;
      const existed = hasMove(result.san);
      const node = addMove(result.san, from + to + (result.promotion ?? ''), chess.fen());
      noteCursorAt(node.id);
      if (!existed) notePending(node.id);
    }
    handleMoveClick(getCurrentNode().id);
  }

  renderTitle();
  updateSaveButtonLabel();
  builderPanels?.render();
  explorePanel?.render();
  // Colour is half of line identity, so flipping can make the line on the board
  // stop (or start) matching one already saved.
  refreshSaveButtonState();
  refreshBoardShapes();
  showToast(`This line will now save as ${next === 'white' ? 'White' : 'Black'}`);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

const boardEl = document.getElementById('board') as HTMLElement;

initTheme();
initAppearance();
setupNav();

// Accounts: pick up an existing session (and finish an OAuth sign-in, an email
// confirmation or a password-reset link if this load is the return leg of one)
// so Settings can render the Account section already signed in. Only ever runs
// on a build with Supabase configured — the internal GitHub Pages build has no
// env vars, so this is skipped entirely and nothing about that build changes.
// Never blocks boot, never throws.
//
// Sync registers FIRST: it listens for the sign-in that initAuth is about to
// report, and a listener added afterwards would miss it. It is its own no-op on
// a build without Supabase (see repertoire-sync.ts). Entitlement listens for the
// same event — it fetches the account's plan once per sign-in — so it registers
// alongside, before initAuth, for exactly the same reason.
initAccountSync();
initEntitlement();
if (isSupabaseConfigured) void initAuth();

// A password-reset link signs you in and then leaves you looking at an app that
// seems perfectly normal, with no hint that a new password was the point. So the
// "choose a new password" sheet is put in front of it — both if the recovery was
// already detected while auth.ts was completing the URL (the usual case, which
// fires before this listener could exist) and if Supabase raises it later.
if (isSupabaseConfigured) {
  const openRecovery = (): void => {
    if (!isPasswordRecovery()) return;
    void import('./account-ui').then(m => m.openNewPasswordSheet());
  };
  window.addEventListener(PASSWORD_RECOVERY_EVENT, openRecovery);
  setTimeout(openRecovery, 0);
}

// One-time cleanup of the retired Google Drive backup's device flags. Drive is
// gone (ROADMAP.md), but a phone that once had it connected still carries its
// keys, and they would otherwise sit there forever.
purgeRetiredLocalKeys();

// Fetch what the unlock costs, once, in the background. Nothing waits on it: the
// paywall paints from the cached or built-in number and corrects itself if this
// lands later (pricing.ts). Doing it at boot rather than on the first paywall
// open means the Stripe price id is almost always in hand before anyone taps buy,
// which is the difference between a checkout that opens instantly and one that
// makes a round trip first. Its own no-op on a build without Supabase.
primePricing();

// If we've just returned from "Connect to Lichess", complete the OAuth token
// exchange and clean the URL. On a fresh connect we toast and, once the app has
// finished booting, return the builder to the position the user connected from
// (the redirect reloads the page, so we restore from the stashed move path).
let lichessReturn: { ucis: string[]; colour: 'white' | 'black' } | null = null;
let tourReturn: TourResume | null = null;
// Read HERE, at module scope, before any promise callback can consume the stash:
// the boot sequence below needs to know a walkthrough is coming back before it
// decides whether to offer the first-run picker, and the two run in an order
// nothing guarantees.
const tourResumePending = hasTourResume();
let appBooted = false;
void lichessTryCallback().then((justConnected) => {
  // BACKING OUT OF LICHESS IS NOT LEAVING THE WALKTHROUGH. The connect redirects
  // the whole page away; someone who reads the Lichess login screen and presses
  // back comes home with no `?code=`, so none of the success path below used to
  // run — and the walkthrough, which had stashed exactly where it was, was
  // dropped on the floor. The user landed in a half-built line with no bubbles
  // and no way to get them back. The stash is read on BOTH paths now (it is
  // one-shot and expires after ten minutes, so an abandoned connect from
  // yesterday still can't resurrect anything).
  tourReturn = takeTourResume();
  if (justConnected) showToast('Connected to Lichess');
  if (justConnected || tourReturn) lichessReturn = lichessTakeReturn();
  if (lichessReturn || tourReturn) maybeRestoreLichessReturn();
  else if (justConnected) builderPanels?.render();
});

// Replay the stashed position (and the stashed walkthrough step) once both halves
// are ready: the OAuth callback has resolved AND the app has booted, so cg and the
// builder exist. Called from both sides. Either stash on its own is enough —
// abandoning the connect loses the position but not the walkthrough.
function maybeRestoreLichessReturn(): void {
  if (!appBooted || (!lichessReturn && !tourReturn)) return;
  if (lichessReturn) {
    const { ucis, colour } = lichessReturn;
    // Land back on the Library tab — where Connect lives — at the same position.
    pendingBuilderSlide = 'library';
    buildFromUcis(ucis, colour);
  }
  lichessReturn = null;

  // Connected from inside the first-run walkthrough: pick it back up where it
  // was, on the Library step, which now reads as connected. Without this a
  // connect mid-walkthrough would silently end the walkthrough — and with it the
  // guided first line, which is why the continuation is restored too.
  //
  // This is the ONLY place a Lichess connect redirects anyone into the builder:
  // Settings' connect (and the wizard's) stashes nothing, so it comes back to
  // the screen it left.
  const resume = tourReturn;
  tourReturn = null;
  if (!resume) return;
  // A walkthrough only runs on the first line, so picking one back up means we
  // are still in it — including the guided save that ends it.
  guidedActive = true;
  // The curated name doesn't survive a page load with the move list, so it's
  // stashed alongside the step and put back here.
  if (resume.name) { manualTitle = resume.name; renderTitle(); }
  // And the cursor goes back where the walkthrough left it — mid-line, on the
  // position the next bubble is about to talk about.
  const line = mainline();
  if (resume.cursor !== undefined && resume.cursor > 0 && resume.cursor <= line.length) {
    handleMoveClick(line[resume.cursor - 1].id);
  } else if (resume.cursor === 0) {
    goToStart();
  }

  // The walkthrough only ever runs on an empty-board first line now, so there is
  // one ending: wait for the moves, then offer the save, exactly as the
  // unbroken run would have.
  setTimeout(
    () => showBuilderIntro(builderIntroDeps(endEmptyBoardWalkthrough, { startStep: resume.step })),
    450,
  );
}

// Fade out and remove the boot splash. Safe to call any number of times from
// anywhere — the first call wins, the rest are no-ops. Every path that puts
// something on screen (the app booting, or the beta gate rendering) calls this,
// so the splash can never outlive the thing it was covering.
let appSplashHidden = false;
function hideAppSplash(): void {
  if (appSplashHidden) return;
  appSplashHidden = true;
  const splash = document.getElementById('app-splash');
  if (!splash) return;
  // One more frame so whatever is underneath has painted before we fade.
  requestAnimationFrame(() => {
    splash.classList.add('app-splash--hide');
    setTimeout(() => splash.remove(), 320);
  });
}

// The app-boot trigger: drop the splash once the first screen's data is ready.
// Tied to getAllLines (the Train screen's gating read); a fallback timeout
// guarantees the splash can never get stuck if that read ever hangs.
function hideAppSplashWhenReady(): void {
  void getAllLines().then(hideAppSplash, hideAppSplash);
  setTimeout(hideAppSplash, 3000); // safety net
}

// Beta access gate (gate.ts) — a self-contained invitation gate + install screen
// shown before the app boots. Skips itself when already unlocked or installed,
// so this is a no-op pass-through on every normal launch. Everything below runs
// only once the gate calls back.
//
// The second argument runs instead, the moment the gate puts itself on screen:
// the gate is then the first thing the user sees, so the splash must clear right
// there rather than waiting on a pass that may never happen.
maybeShowGate(() => requestAnimationFrame(() => {
  // The app is really starting: stamp the install date if this profile has
  // none, count one cold launch, and count any retention milestone this launch
  // just crossed. Inside the gate callback, so a beta-code screen nobody gets
  // past is never counted as an open. A complete no-op on the GitHub Pages
  // build — see src/metrics.ts.
  trackAppOpen();

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

  // Decreasing-opacity arrows for the engine's top 3 candidates. Unique keys per
  // board (board-brushes.ts) keep each arrow's head from colliding with another
  // board's marker id, which otherwise drops the arrowhead on hidden-view boards.
  registerBrushes(cg, {
    eng1: { color: '#3a9a5c', opacity: 0.9, lineWidth: 11 },
    eng2: { color: '#3a9a5c', opacity: 0.55, lineWidth: 9 },
    eng3: { color: '#3a9a5c', opacity: 0.38, lineWidth: 8 },
    // The grow exercise's three candidate replies. HINT_COLOR, because these
    // are "the app is pointing at this" arrows rather than an engine opinion —
    // and because it is the one hue no board scheme uses (board-brushes.ts).
    // Descending weight mirrors the order of the tiles on the panel.
    grow1: { color: HINT_COLOR, opacity: 0.85, lineWidth: 11 },
    grow2: { color: HINT_COLOR, opacity: 0.55, lineWidth: 9 },
    grow3: { color: HINT_COLOR, opacity: 0.38, lineWidth: 8 },
  });

  // Engine + eval panel — must come after cg is available so evaluate() can read chess.fen().
  engine = new Engine(import.meta.env.BASE_URL, (result) => {
    evalPanel.update(result, chess.fen());
    enginePanel?.update(result);
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
      // It stays shut on the Engine tab, which shows the same thing full size.
      animateEvalDock(enabled && !quickEngineHidden);
    },
    (uci) => playUci(uci),
    {
      compact: true,
      showToggle: false,
      // No "cloud · d38" tag on the quick engine: three moves, an eval each and
      // the bar. Where the number came from is the Engine tab's story.
      showSource: false,
      // The docked bar's "Lichess off" warning: reset the cloud breaker and
      // re-ask about the position on the board.
      onRetryCloud: () => { retryCloudNow(); void engine.evaluate(chess.fen()); },
    },
  );

  // The Engine tab — the same engine, given a whole panel: eval bar, depth
  // readout, three walkable principal variations and a depth control.
  enginePanel = createEnginePanel({
    el: document.getElementById('slide-engine')!,
    getFen: () => chess.fen(),
    isOn: () => engineOn,
    onPlayLine: (ucis) => { for (const u of ucis) playUci(u); },
    onRetryCloud: () => { retryCloudNow(); void engine.evaluate(chess.fen()); },
  });

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

  // The Library / My-lines carousel slides — they read the live builder position
  // and play a tapped continuation straight onto the line.
  builderPanels = createBuilderPanels({
    libraryEl: document.getElementById('slide-library-content')!,
    gamesEl: document.getElementById('slide-games-content')!,
    getSans: currentPathSans,
    getUcis: currentPathUcis,
    getFen: () => chess.fen(),
    getColour: () => saveColour,
    getEditingLineId: () => loadedLineId,
    onPlay: (uci) => playUci(uci),
    // My games empty-state import button.
    onImportGames: () => openImportPanel({
      onImported: () => { builderPanels?.reload(); builderPanels?.render(); explorePanel?.reload(); },
    }),
    // My opponents: import a new opponent, and jump to an opponent's full report.
    onImportOpponent: () => importOpponentFlow(() => builderPanels?.reloadOpponents()),
    onOpenOpponentReport: (id: string) => { openExploreOpponent(id); showView('explore'); },
    // My lines "Show tree": open the tapped saved line in the builder.
    onOpenLine,
    // My saved lines: the trash on a continuation row. Only while a book is
    // open — the analyser is looking at somebody's game, not at your book.
    canRemoveLines: () => inBook(),
    onRemoveContinuation: removeContinuationFromHere,
  });

  // The Grow line slide — the daily challenge's brief, beside the tools that
  // answer it. Only ever populated by startGrowLine below.
  growPanel = createGrowPanel({
    el: document.getElementById('slide-grow')!,
    getUcis: currentPathUcis,
    getSans: currentPathSans,
    onPlay: (uci) => playUci(uci),
    onBackToEnd: () => { if (growEndNodeId) handleMoveClick(growEndNodeId); },
    onCommit: addFromHeader,
    onSkip: skipGrowLine,
    hasDraft: () => inBook() && hasPending(),
  });

  // The Explore slide — three curated moves for the position on the board.
  explorePanel = createExplorePanel({
    el: document.getElementById('slide-explore')!,
    getSans: currentPathSans,
    getUcis: currentPathUcis,
    getFen: () => chess.fen(),
    getColour: () => saveColour,
    onPlay: (uci) => playUci(uci),
    onImportGames: () => openImportPanel({
      onImported: () => { builderPanels?.reload(); builderPanels?.render(); explorePanel?.reload(); },
    }),
    onTakeBack: takeBackLastMove,
  });

  setupSaveButton();
  setupBuilderInfo();
  setupPlaybackControls();
  setupTitleControls();
  setupNoteBlock();
  setupMoveNav();
  setupAnalyseGameButton();
  setupBuilderCarousel();
  setupBuilderSheetGestures();

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

  // Chrome decides whether the app is installable a beat after boot, so the
  // Get-started checklist's install row is usually asked for BEFORE the answer
  // is yes. Repaint Train when the prompt lands, rather than making the user
  // navigate away and back to see the row appear.
  onInstallAvailable(() => { if (currentView === 'train') showView('train'); });

  // Now that cg/builder exist, replay a "Connect to Lichess" return if one is
  // pending (the OAuth callback may have resolved before boot finished). This
  // overrides the Train landing above, dropping the user back in the builder.
  appBooted = true;
  maybeRestoreLichessReturn();

  // A "Sign up" link from the marketing site (?auth=signup) opens the sheet
  // directly, whatever else is going on.
  handleAuthUrlParam();

  // Coming back from a checkout (?purchased=1). The payment is already done by
  // now, but the webhook that grants access may not have landed yet, so this
  // starts a short poll rather than reading the flag once. Silent unless it
  // finds something — a URL someone typed by hand shows nothing at all.
  handlePurchaseReturn();

  // The cap is drawn into screens at render time (the Train hub's "9 of 10"
  // counter, the coaching-cap notices, the Go-pro CTA in Settings), so a flag
  // that flips while a screen is already up leaves stale furniture behind —
  // most visibly, a price tag in front of somebody who has just paid. Repaint
  // the current view when the answer actually changes. The event only fires on
  // a real change, so this is not a render loop.
  window.addEventListener(ENTITLEMENT_CHANGE_EVENT, () => {
    // The builder holds unsaved work in the DOM; re-rendering it under the user
    // would be a far worse bug than a stale counter on a screen they aren't
    // looking at. It shows no cap furniture anyway.
    if (currentView === 'builder') return;
    showView(currentView);
  });

  // FIRST VISIT: the picker. One screen — colour, depth, style — and then the
  // guided first line. No beta code, no carousel, no setup wizard, no account:
  // a visitor should be looking at their own saved line inside a minute.
  //
  // It only appears on a genuinely empty install (no lines AND onboarding never
  // finished), so an existing user sees none of this.
  // If the last thing this device did was take a copy down from an account and
  // reload, say so now — the page that fetched it is gone.
  reportRestoreOnBoot();

  const offerFirstRun = (): void => {
    // A walkthrough returning from the Lichess round-trip owns the screen. The
    // picker is the question that STARTED that walkthrough, and this device
    // still has no saved lines — so without this guard the colour question came
    // back up over the resumed bubbles, which is a second first run stacked on
    // top of the first one, still in progress.
    if (tourResumePending) return;
    void shouldShowFirstRun().then((show) => {
      if (show) showFirstRunPicker();
    });
  };
  // ONE THING GOES FIRST on a phone that has just signed in: the account's copy
  // has to land. Until this device has reconciled, an empty database means "we
  // haven't looked yet", not "this person is new" — and running the walkthrough
  // there is exactly the second-device confusion this guard exists to stop. The
  // sync fires SYNC_PULLED_EVENT when the reconcile finishes, whether it found a
  // copy or not, so somebody who signed up before building anything still gets
  // their first run a moment later. The timeout is the offline case: a copy we
  // can't reach must not cost a new user their onboarding.
  if (isAwaitingAccountCopy()) {
    let offered = false;
    const once = (): void => {
      if (offered) return;
      offered = true;
      offerFirstRun();
    };
    window.addEventListener(SYNC_PULLED_EVENT, once);
    window.setTimeout(once, 8000);
  } else {
    offerFirstRun();
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
  }).finally(() => {
    // …and then read whatever games are now on the device for mistakes, quietly
    // (mistake-autoscan.ts). It used to sit behind an "Analyse my games" button
    // that asked for ten minutes up front, which is a question almost nobody
    // says yes to — so the Middle game pane stayed empty for people who had
    // imported hundreds of games. Deliberately last and deliberately delayed:
    // launch, the first paint and any refresh above all come first, and the
    // engine worker is left alone until the app has settled.
    window.setTimeout(() => {
      startAutoScan();
      // …and the End game tab's own pass behind it. It queues itself on the
      // mistake pass finishing (endgame-autoscan.ts), so this only puts it in
      // the queue — it never competes for the worker.
      startEndgameAutoScan();
    }, AUTO_SCAN_DELAY_MS);
  });
  // One cheap count, so anything painted synchronously (the walkthrough's
  // bubbles) knows whether this device has games without awaiting IndexedDB.
  void refreshGamesOnDevice();
}), hideAppSplash);
