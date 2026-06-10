import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';
import { addMove, goTo, mainline, pathTo, getCurrentNode, reset, isEmpty, serialise, loadTree, fenBefore } from './tree';
import { saveLine, getAllLines } from './storage';
import { nameForPath } from './openings';
import { explainMove, describeGrade } from './explain';
import type { Line } from './types';
import { renderLinesScreen, focusSavedLine } from './lines-screen';
import { renderProgressScreen } from './progress-screen';
import { startPretrainingRun } from './pretraining';
import { renderTrainScreen } from './train-screen';
import { renderExploreScreen } from './explore-screen';
import { renderSettingsScreen } from './settings-screen';
import { Engine, gradeMove } from './engine';
import { EvalPanel } from './eval-panel';
import { initTheme } from './theme';
import { initAppearance } from './appearance';
import { watchSpeedMs } from './prefs';
import { initBackNav, setViewBack, pushBack } from './back-nav';

const chess = new Chess();
let cg!: ReturnType<typeof Chessground>;
let engine!: Engine;
let evalPanel!: EvalPanel;

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
}

// Recompute the detected name for the cursor position and repaint the title.
function updateOpeningName(): void {
  detectedName = nameForPath(currentPathFens()) ?? '';
  renderTitle();
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

// The edit lightbox: rename the line and toggle/enter tags in one place. Opened
// from the pencil in the title row. Replaces the old inline rename field.
function openEditSheet(): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet';

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = 'Name & tags';
  sheet.appendChild(title);

  // Name.
  const nameLabel = document.createElement('label');
  nameLabel.className = 'edit-label';
  nameLabel.textContent = 'Name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'edit-input';
  nameInput.value = currentTitle();
  nameInput.placeholder = 'Line name';
  sheet.appendChild(nameLabel);
  sheet.appendChild(nameInput);

  // Suggested-tag chips.
  const tagsLabel = document.createElement('label');
  tagsLabel.className = 'edit-label';
  tagsLabel.textContent = 'Tags';
  sheet.appendChild(tagsLabel);

  const chipRow = document.createElement('div');
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

  // Freeform tags — seeded with any current tags that aren't suggestion chips.
  const freeInput = document.createElement('input');
  freeInput.type = 'text';
  freeInput.className = 'edit-input';
  freeInput.placeholder = 'your own tags, comma, separated';
  freeInput.value = currentTags
    .filter(t => !SUGGESTED_TAGS.includes(t as typeof SUGGESTED_TAGS[number]))
    .join(', ');
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
    const custom = freeInput.value.split(',').map(t => t.trim()).filter(Boolean);
    currentTags = [...new Set([...selected, ...custom])];
    const val = nameInput.value.trim();
    manualTitle = val ? val : null;
    renderTitle();
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

  function close() {
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
  });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => nameInput.focus());
}

function setupTitleControls(): void {
  document.getElementById('rename-btn')!.addEventListener('click', openEditSheet);
}

// ── "Why this move" explanation ─────────────────────────────────────────────
// Shown only when the engine is on — the engine verdict is what makes the
// description worth reading. The user's own note always overrides it: when a
// note exists the panel hides (the note editor below is the truth).
//
// Structure inside #move-explanation, engine ON:
//   .explanation-verdict  — async engine grade (good / mistake / …), shown first
//   .explanation-text     — instant, offline, chess.js description of the move
//   .explanation-actions  — "Add to my note" button
// Engine OFF: a single quiet prompt to turn the engine on.

// Race guard for the async grade: a slow older grade must never overwrite a
// newer move's verdict.
let gradeRequestId = 0;

// Show or hide the "+" note icon — it adopts the engine suggestion, so it only
// makes sense while a suggestion is actually on screen.
function setNoteAddVisible(visible: boolean): void {
  const btn = document.getElementById('note-add-btn');
  if (btn) btn.hidden = !visible;
}

function renderExplanation(): void {
  const el = document.getElementById('move-explanation')!;
  const node = getCurrentNode();

  // Bump the request id so any in-flight grade for a previous move is ignored.
  gradeRequestId++;

  if (node.id === 'root' || node.note?.trim()) {
    el.hidden = true;
    el.replaceChildren();
    setNoteAddVisible(false);
    return;
  }

  // Engine off: nothing instructive to say, so just invite turning it on.
  if (!engine.isEnabled) {
    const prompt = document.createElement('span');
    prompt.className = 'explanation-hint';
    prompt.textContent = 'Turn on the engine to explain this move.';
    el.replaceChildren(prompt);
    el.hidden = false;
    setNoteAddVisible(false);
    return;
  }

  const text = explainMove(fenBefore(node.id), node.san);
  if (!text) {
    el.hidden = true;
    el.replaceChildren();
    setNoteAddVisible(false);
    return;
  }

  // Verdict slot sits first (filled async); description shows instantly below it.
  const verdictEl = document.createElement('div');
  verdictEl.className = 'explanation-verdict';
  verdictEl.hidden = true;

  const textEl = document.createElement('div');
  textEl.className = 'explanation-text';
  textEl.textContent = text;

  el.replaceChildren(verdictEl, textEl);
  el.hidden = false;
  // A suggestion is on screen and the move has no note yet — offer the "+".
  setNoteAddVisible(true);

  // Grade the move against Lichess cloud's best line (its own request,
  // independent of the eval-panel flow).
  const reqId = gradeRequestId;
  const nodeId = node.id;
  gradeMove(fenBefore(node.id), node.uci).then(grade => {
    // Stale guard: same request, still the same selected move, still no note.
    if (reqId !== gradeRequestId) return;
    const current = getCurrentNode();
    if (current.id !== nodeId || current.note?.trim()) return;
    if (!grade) {
      // The engine can't grade this position (it's off the known map). The
      // offline description here is usually too vague to be worth showing, so
      // replace the whole panel with an honest nudge to annotate it yourself.
      textEl.textContent = 'This is new territory — add your own notes.';
      textEl.classList.add('explanation-newground');
      return;
    }
    verdictEl.textContent = describeGrade(grade);
    verdictEl.className = `explanation-verdict verdict-${grade.classification}`;
    verdictEl.hidden = false;
  });
}

// Copy the generated explanation (description + verdict, if shown) into the
// move's note. It then becomes the user's editable override — the generated
// panel hides and the note editor takes over, seeded with this text.
function adoptExplanationAsNote(): void {
  const node = getCurrentNode();
  if (node.id === 'root') return;
  const verdictEl = document.querySelector('#move-explanation .explanation-verdict:not([hidden])');
  const textEl = document.querySelector('#move-explanation .explanation-text');
  const parts = [verdictEl?.textContent, textEl?.textContent].filter(Boolean);
  const note = parts.join(' ').trim();
  if (!note) return;
  node.note = note;
  renderMoveList();
  // Note now exists: the panel switches to the editor and hides the icons.
  renderNotePanel();
}

function renderMoveList() {
  const moves = mainline();
  const activeId = getCurrentNode().id;
  const el = document.getElementById('move-list')!;
  el.innerHTML = '';

  for (let i = 0; i < moves.length; i += 2) {
    const white = moves[i];
    const black = moves[i + 1];
    const num = i / 2 + 1;

    const numSpan = document.createElement('span');
    numSpan.className = 'move-num';
    numSpan.textContent = `${num}.`;
    el.appendChild(numSpan);

    const wSpan = document.createElement('span');
    wSpan.className = `move-san${white.id === activeId ? ' active' : ''}`;
    wSpan.addEventListener('click', () => handleMoveClick(white.id));
    wSpan.textContent = white.san;
    if (white.note) {
      const dot = document.createElement('span');
      dot.className = 'move-note-dot';
      dot.setAttribute('aria-hidden', 'true');
      wSpan.appendChild(dot);
    }
    el.appendChild(wSpan);

    if (black) {
      const bSpan = document.createElement('span');
      bSpan.className = `move-san${black.id === activeId ? ' active' : ''}`;
      bSpan.addEventListener('click', () => handleMoveClick(black.id));
      bSpan.textContent = black.san;
      if (black.note) {
        const dot = document.createElement('span');
        dot.className = 'move-note-dot';
        dot.setAttribute('aria-hidden', 'true');
        bSpan.appendChild(dot);
      }
      el.appendChild(bSpan);
    }
  }

  // Keep the active move visible in the horizontally-scrolling strip.
  const activeEl = el.querySelector<HTMLElement>('.move-san.active');
  if (activeEl) {
    activeEl.scrollIntoView({ block: 'nearest', inline: 'center' });
  } else {
    el.scrollLeft = 0;
  }

  updateMoveNavButtons();
}

// ── Move navigation (plain step arrows, not engine arrows) ──────────────────
// The cursor's index within the mainline, or -1 when sitting at the root.
function moveIndex(): number {
  const id = getCurrentNode().id;
  return mainline().findIndex(n => n.id === id);
}

function stepBack(): void {
  const idx = moveIndex();
  if (idx <= 0) { goToStart(); return; }
  handleMoveClick(mainline()[idx - 1].id);
}

function stepForward(): void {
  const moves = mainline();
  const idx = moveIndex();
  if (idx >= moves.length - 1) return;
  handleMoveClick(moves[idx + 1].id);
}

function goToEnd(): void {
  const moves = mainline();
  if (moves.length === 0) return;
  handleMoveClick(moves[moves.length - 1].id);
}

// Grey out the step/jump buttons at the ends of the line.
function updateMoveNavButtons(): void {
  const moves = mainline();
  const idx = moveIndex();
  const atStart = idx < 0;
  const atEnd = moves.length === 0 || idx === moves.length - 1;
  const set = (id: string, disabled: boolean) => {
    const b = document.getElementById(id) as HTMLButtonElement | null;
    if (b) b.disabled = disabled;
  };
  set('move-first', atStart);
  set('move-prev', atStart);
  set('move-next', atEnd);
  set('move-last', atEnd);
}

function setupMoveNav(): void {
  document.getElementById('move-first')!.addEventListener('click', goToStart);
  document.getElementById('move-prev')!.addEventListener('click', stepBack);
  document.getElementById('move-next')!.addEventListener('click', stepForward);
  document.getElementById('move-last')!.addEventListener('click', goToEnd);
}

// ── Note panel ────────────────────────────────────────────────────────────────

function renderNotePanel(): void {
  const panel = document.getElementById('note-panel')!;
  const label = document.getElementById('note-panel-label')!;
  const textarea = document.getElementById('move-note-input') as HTMLTextAreaElement;
  const writeBtn = document.getElementById('note-write-btn')!;
  const node = getCurrentNode();
  if (node.id === 'root') {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  label.textContent = `Note for ${node.san}`;
  textarea.value = node.note ?? '';
  // Compact by default: the editor stays collapsed until there's a note to
  // show or the user taps the pencil to write one.
  const hasNote = !!node.note?.trim();
  textarea.hidden = !hasNote;
  writeBtn.hidden = hasNote;
  renderExplanation();
}

function setupNotePanel(): void {
  const textarea = document.getElementById('move-note-input') as HTMLTextAreaElement;
  const writeBtn = document.getElementById('note-write-btn')!;
  const addBtn = document.getElementById('note-add-btn')!;

  // Pencil: reveal the editor for a move with no note yet.
  writeBtn.addEventListener('click', () => {
    textarea.hidden = false;
    writeBtn.hidden = true;
    textarea.focus();
  });

  // "+": adopt the engine's suggestion as the starting note.
  addBtn.addEventListener('click', () => adoptExplanationAsNote());

  textarea.addEventListener('input', () => {
    const node = getCurrentNode();
    if (node.id === 'root') return;
    const val = textarea.value;
    node.note = val.trim() ? val : undefined;
    // Update note dot indicator without clobbering the textarea.
    renderMoveList();
    // A note overrides the generated text: refresh so it hides (or, once the
    // note is cleared, reappears).
    renderExplanation();
  });
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
  renderNotePanel();
  updateOpeningName();
  evalPanel.clear();
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
  renderNotePanel();
  updateOpeningName();
  evalPanel.clear();
  engine.evaluate(chess.fen());
}

let saveColour: 'white' | 'black' = 'white';

// When a line is loaded from My Lines, stash its id and createdAt so
// a subsequent Save updates the same line instead of creating a duplicate.
let loadedLineId: string | null = null;
let loadedLineCreatedAt: number | undefined;
let loadedLineInTraining = false;

// The currently loaded/saved line — used to preserve training data (confidence,
// schedule, inTraining) when re-saving an existing line.
let currentTrainingLine: Line | null = null;

// Single timer handle for Watch line — prevents stacked playback.
let playbackTimer: ReturnType<typeof setTimeout> | undefined;
// The line currently being watched, and the index of the NEXT move to play.
// Kept across a pause so the button can resume rather than restart.
let playbackMoves: ReturnType<typeof mainline> = [];
let playbackIndex = 0;

// Watch line is an icon-only button (next to Flip): a play triangle that becomes
// a pause symbol while a line is playing back.
const PLAY_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="none" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="none" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';

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
  renderNotePanel();
  evalPanel.clear();
  engine.evaluate(chess.fen());
}

// The header save button reads "Save changes" when editing an existing line,
// and "Save line" for a fresh one — standard create-vs-edit wording.
function updateSaveButtonLabel(): void {
  const label = document.getElementById('header-save-label');
  if (label) label.textContent = loadedLineId ? 'Save changes' : 'Save line';
}

// A small transient toast for confirmations ("Line saved ✓").
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(message: string): void {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('toast--show');
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast!.classList.remove('toast--show'), 2200);
}

// ── Navigation ────────────────────────────────────────────────────────────────

// The four bottom-tab destinations, plus the board screens reached from them.
// "train" is the start view and back-navigation root; "explore" is a v1.2
// placeholder; "builder" shows a chessboard, so it counts as a board screen
// (see BACK_VIEWS below).
type ViewName = 'train' | 'lines' | 'explore' | 'progress' | 'builder' | 'settings';
let currentView: ViewName = 'train';

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
  // Fresh line: drop any manual title and clear the auto-detected name.
  manualTitle = null;
  detectedName = '';
  renderTitle();
  renderBuilderTags();
  cg.set({
    fen: chess.fen(),
    orientation: colour,
    turnColor: 'white',
    movable: { color: 'both', dests: legalDests() },
    lastMove: undefined,
  });
  renderMoveList();
  renderNotePanel();
  updateSaveButtonLabel();
  evalPanel.clear();
  engine.evaluate(chess.fen());
}

// Open the builder on a fresh line of the given colour (from Home's Add buttons).
function startNewLine(colour: 'white' | 'black'): void {
  clearBuilder(colour);
  showView('builder');
}

// Seed the builder with a UCI move list, then open it (from "From my games"
// suggestions). Starts from a clean, unsaved line so a Save creates a new one.
function buildFromUcis(ucis: string[], colour: 'white' | 'black'): void {
  clearBuilder(colour);
  for (const uci of ucis) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = (uci[4] as 'q' | 'r' | 'b' | 'n') || 'q';
    const result = chess.move({ from, to, promotion });
    if (!result) break; // stop on an illegal move rather than corrupt the tree
    addMove(result.san, from + to + (result.promotion ?? ''), chess.fen());
  }
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
  renderNotePanel();
  updateOpeningName();
  evalPanel.clear();
  engine.evaluate(chess.fen());
  showView('builder');
}

// The full dependency set the My Lines screen needs. Centralised so every
// place that (re)renders it stays in sync.
function linesScreenDeps(): Parameters<typeof renderLinesScreen>[1] {
  return {
    onOpenLine,
    onAddLine: startNewLine,
    onStartTraining: handleStartTraining,
    onBuildLine: buildFromUcis,
  };
}

// Drill or enrol a single line by id, from the Progress screen. An in-training
// line drills immediately; a saved line that isn't in training yet runs the
// "confirm & add to training" flow, then returns to Progress.
async function onTrainLine(lineId: string, inTraining: boolean): Promise<void> {
  if (inTraining) {
    pendingTrainLineId = lineId;
    showView('train');
    return;
  }
  const line = (await getAllLines()).find(l => l.id === lineId);
  if (!line) return;
  startPretrainingRun(
    line,
    () => showView('progress'), // re-render so the line now reads as in-training
    () => { /* cancelled — stay on Progress */ },
  );
}

function handleStartTraining(line: Line): void {
  startPretrainingRun(
    line,
    () => {
      // Re-render lines screen so the "Add to training" button disappears.
      const linesEl = document.getElementById('view-lines')!;
      renderLinesScreen(linesEl, linesScreenDeps());
    },
    () => { /* cancelled — user is already back at the lines screen */ }
  );
}

function showView(view: ViewName): void {
  // Entering a full screen (builder/settings) from a tab: remember it so the back
  // arrow returns there.
  if (BACK_VIEWS.has(view) && !BACK_VIEWS.has(currentView)) {
    returnView = currentView;
  }
  currentView = view;

  const builderEl = document.getElementById('view-builder')!;
  const linesEl = document.getElementById('view-lines')!;
  const exploreEl = document.getElementById('view-explore')!;
  const trainEl = document.getElementById('view-train')!;
  const progressEl = document.getElementById('view-progress')!;
  const settingsEl = document.getElementById('view-settings')!;

  builderEl.toggleAttribute('hidden', view !== 'builder');
  linesEl.toggleAttribute('hidden', view !== 'lines');
  exploreEl.toggleAttribute('hidden', view !== 'explore');
  trainEl.toggleAttribute('hidden', view !== 'train');
  progressEl.toggleAttribute('hidden', view !== 'progress');
  settingsEl.toggleAttribute('hidden', view !== 'settings');

  // Full screens swap the bottom tab bar for a back arrow.
  const onBack = BACK_VIEWS.has(view);
  document.getElementById('bottom-nav')!.toggleAttribute('hidden', onBack);
  document.getElementById('nav-back')!.toggleAttribute('hidden', !onBack);

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
    renderExploreScreen(exploreEl);
  }

  if (view === 'train') {
    renderTrainScreen(trainEl, {
      focusLineId: pendingTrainLineId ?? undefined,
    });
    pendingTrainLineId = null;
  }

  if (view === 'progress') {
    renderProgressScreen(progressEl, {
      onTrainLine,
      onOpenLine: (line) => onOpenLine(line),
    });
  }

  if (view === 'settings') {
    renderSettingsScreen(settingsEl);
  }

  if (view === 'builder') {
    engine.evaluate(chess.fen());
  }
}

function onOpenLine(line: Line): void {
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
  renderTitle();
  renderBuilderTags();

  renderMoveList();
  renderNotePanel();
  updateSaveButtonLabel();
  showView('builder');
}

function setupNav(): void {
  document.querySelectorAll<HTMLElement>('#bottom-nav .tab-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view as ViewName | undefined;
      if (view) showView(view);
    });
  });

  // Back arrow on full screens — stop any playback and return to where we came from.
  document.getElementById('nav-back')!.addEventListener('click', () => {
    stopPlayback();
    showView(returnView);
  });

  // The header user icon opens Settings.
  document.getElementById('nav-settings')!.addEventListener('click', () => {
    showView('settings');
  });

  // The system back gesture steps back through the app (closing any open sheet
  // first) instead of closing the PWA. Overlays register their own steps; this
  // is the view-level fallback once nothing is open.
  setViewBack(() => {
    // Full screens (builder / settings) return to wherever they were opened from.
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

// ── Save ────────────────────────────────────────────────────────────────────
// Save lives in the header (top-right). On success we confirm with a toast and
// drop the user back on My Lines, where the just-saved line is highlighted and
// can be enrolled in training.

async function saveCurrentLine(): Promise<void> {
  if (isEmpty()) {
    showToast('Play a move first');
    return;
  }

  // Tags are edited in the lightbox; use the working set as-is.
  const tags = [...currentTags];

  // Auto-naming (default): the title is the manual name if the user renamed,
  // otherwise the opening name from the bundled database for the whole line.
  const opening = detectedNameForLine();
  const name = currentTitle() || opening || 'Untitled line';
  manualTitle = name;

  const isNew = !loadedLineId;
  const id = loadedLineId ?? crypto.randomUUID();
  const line: Line = {
    id,
    name,
    tags,
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

  await saveLine(line);
  loadedLineId = id;
  loadedLineCreatedAt = line.createdAt;
  currentTrainingLine = line;

  showToast(isNew ? 'Line saved ✓' : 'Changes saved ✓');
  // Surface the saved line on My Lines, highlighted so it's easy to find and
  // add to training.
  focusSavedLine(id);
  showView('lines');
}

function setupSaveButton() {
  document.getElementById('header-save')!.addEventListener('click', () => {
    void saveCurrentLine();
  });
}

// ── Playback controls ─────────────────────────────────────────────────────────
// The board carries only the play/pause button now; the watch-line SPEED lives in
// Settings (set via setWatchSpeed there). watchSpeedMs() reads it live, so a speed
// change in Settings takes effect on the very next auto-played move.

function setupPlaybackControls(): void {
  const watchBtn = document.getElementById('watch-btn') as HTMLButtonElement;

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

requestAnimationFrame(() => {
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
        renderNotePanel();
        updateOpeningName();
        evalPanel.clear();
        engine.evaluate(chess.fen());
      },
    },
  });

  // Engine + eval panel — must come after cg is available so evaluate() can read chess.fen().
  engine = new Engine(import.meta.env.BASE_URL, (result) => {
    evalPanel.update(result, chess.fen());
  });
  evalPanel = new EvalPanel(
    document.getElementById('eval-bar-top')!,
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
      // The explanation panel is engine-gated, so refresh it on toggle.
      renderExplanation();
    },
    (uci) => playUci(uci),
    // Flip: a temporary, view-only swap to the other side. It does NOT change
    // the line's saved colour — reopening or resetting restores the correct one.
    () => cg.toggleOrientation(),
  );
  if (engine.isEnabled) {
    engine.enable();
    engine.evaluate(chess.fen());
  }

  setupSaveButton();
  setupPlaybackControls();
  setupTitleControls();
  setupNotePanel();
  setupMoveNav();

  new ResizeObserver(() => cg.redrawAll()).observe(boardEl);

  // Land on the Train screen — the app's start view. The board (in the builder)
  // was created above while visible, so chessground sized itself correctly
  // before we switch away.
  showView('train');
});
