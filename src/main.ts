import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';
import { addMove, goTo, mainline, pathTo, getCurrentNode, reset, isEmpty, serialise, loadTree, fenBefore } from './tree';
import type { Annotation, MoveNode } from './tree';
import { saveLine, getAllLines } from './storage';
import { nameForPath } from './openings';
import { explainMove, describeGrade } from './explain';
import type { Line } from './types';
import { renderLinesScreen, focusSavedLine } from './lines-screen';
import { renderProgressScreen } from './progress-screen';
import { startPretrainingRun, enrolLineDirectly } from './pretraining';
import { renderTrainScreen } from './train-screen';
import { renderExploreScreen } from './explore-screen';
import { renderSettingsScreen } from './settings-screen';
import { Engine, gradeMove } from './engine';
import { EvalPanel } from './eval-panel';
import { initTheme } from './theme';
import { initAppearance } from './appearance';
import { watchSpeedMs, getConfirmRunBeforeTraining } from './prefs';
import { initBackNav, setViewBack, pushBack } from './back-nav';
import { showDialog } from './dialog';

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
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
  });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    nameInput.focus();
    syncKeyboardInset();
  });
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

// One clickable move in the strip: the SAN, its annotation chip (if marked)
// and a note dot (if annotated in words too).
function moveSpan(node: MoveNode, activeId: string): HTMLElement {
  const span = document.createElement('span');
  span.className = `move-san${node.id === activeId ? ' active' : ''}`;
  span.addEventListener('click', () => handleMoveClick(node.id));
  span.textContent = node.san;
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

    el.appendChild(moveSpan(white, activeId));
    if (black) el.appendChild(moveSpan(black, activeId));
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

// Grey out the step arrows at the ends of the line.
function updateMoveNavButtons(): void {
  const moves = mainline();
  const idx = moveIndex();
  const atStart = idx < 0;
  const atEnd = moves.length === 0 || idx === moves.length - 1;
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

// ── Annotation marks ─────────────────────────────────────────────────────────
// The six standard chess symbols, strongest to worst, each with a colour class
// (sage for the strong marks, gold for the speculative ones, brick for the
// blunders). Shown as small chips in the move list and picked from a chip row
// in the note panel — tapping the active chip clears the mark.
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

// Build the six picker chips once; renderAnnotationPicker just toggles which
// one reads as selected for the current move.
function setupAnnotationPicker(): void {
  const row = document.getElementById('annotation-picker')!;
  for (const a of ANNOTATIONS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `ann-pick ann-${a.cls}`;
    chip.dataset.symbol = a.symbol;
    chip.textContent = a.symbol;
    chip.setAttribute('aria-label', a.label);
    chip.title = a.label;
    chip.addEventListener('click', () => {
      const node = getCurrentNode();
      if (node.id === 'root') return;
      node.annotation = node.annotation === a.symbol ? undefined : a.symbol;
      renderAnnotationPicker();
      renderMoveList();
    });
    row.appendChild(chip);
  }
}

function renderAnnotationPicker(): void {
  const current = getCurrentNode().annotation;
  document.querySelectorAll<HTMLElement>('#annotation-picker .ann-pick').forEach(chip => {
    const on = chip.dataset.symbol === current;
    chip.classList.toggle('ann-pick--on', on);
    chip.setAttribute('aria-pressed', String(on));
  });
}

// ── Note panel ────────────────────────────────────────────────────────────────

// Open or collapse the note editor for the current move. Open = textarea +
// Save button visible; collapsed = just the pencil. Kept as one place so the
// pencil, the Save button and a fresh render all agree on the state.
//
// Annotation marks ride with the editor: they only show while a note is being
// written (or already exists), never on their own.
function setNoteEditing(editing: boolean): void {
  const textarea = document.getElementById('move-note-input') as HTMLTextAreaElement;
  const writeBtn = document.getElementById('note-write-btn')!;
  const doneBtn = document.getElementById('note-done-btn')!;
  const annRow = document.getElementById('annotate-row')!;
  textarea.hidden = !editing;
  writeBtn.hidden = editing;
  doneBtn.hidden = !editing;
  annRow.hidden = !editing;
}

function renderNotePanel(): void {
  const panel = document.getElementById('note-panel')!;
  const annRow = document.getElementById('annotate-row')!;
  const annLabel = document.getElementById('annotate-label')!;
  const label = document.getElementById('note-panel-label')!;
  const textarea = document.getElementById('move-note-input') as HTMLTextAreaElement;
  const node = getCurrentNode();
  if (node.id === 'root') {
    panel.hidden = true;
    annRow.hidden = true;
    return;
  }
  // Keep the annotation picker's label and selection in step with the move, but
  // its visibility is owned by setNoteEditing — the marks only appear alongside
  // the note editor, never on their own.
  annLabel.textContent = `Mark ${node.san}`;
  renderAnnotationPicker();

  panel.hidden = false;
  label.textContent = `Note for ${node.san}`;
  textarea.value = node.note ?? '';
  // Compact by default: the editor (and the annotation marks) stay collapsed
  // until there's a note to show or the user taps the pencil to write one.
  setNoteEditing(!!node.note?.trim());
  renderExplanation();
}

function setupNotePanel(): void {
  const textarea = document.getElementById('move-note-input') as HTMLTextAreaElement;
  const writeBtn = document.getElementById('note-write-btn')!;
  const addBtn = document.getElementById('note-add-btn')!;
  const doneBtn = document.getElementById('note-done-btn')!;

  // Pencil: reveal the editor for a move with no note yet.
  writeBtn.addEventListener('click', () => {
    setNoteEditing(true);
    textarea.focus();
  });

  // "+": adopt the engine's suggestion as the starting note.
  addBtn.addEventListener('click', () => adoptExplanationAsNote());

  // Save: dismiss the keyboard, persist (if the line is already saved) and
  // confirm with a discreet toast so the note clearly "took". An empty note
  // collapses the editor back to the pencil.
  doneBtn.addEventListener('click', () => { void finishNote(); });

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

// Confirm the current note: collapse the keyboard, persist it durably when the
// line already lives in storage, and toast a confirmation.
async function finishNote(): Promise<void> {
  const textarea = document.getElementById('move-note-input') as HTMLTextAreaElement;
  textarea.blur();
  const node = getCurrentNode();
  const hasNote = !!node.note?.trim();
  if (!hasNote) {
    // Nothing written — quietly fold the editor away again.
    setNoteEditing(false);
    return;
  }
  // An already-saved line persists immediately so the note can't be lost by
  // leaving without a second Save. A brand-new line keeps it in memory until
  // the header Save writes the whole line.
  if (loadedLineId) {
    const line = buildCurrentLine();
    await saveLine(line);
    currentTrainingLine = line;
    savedSnapshot = builderSnapshot();
    showToast('Note saved ✓');
  } else {
    showToast('Note added — Save the line to keep it');
  }
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
    tree: serialise(),
  });
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
  // Fresh, empty line — no snapshot, so it only counts as dirty once a move lands.
  savedSnapshot = null;
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

function showView(view: ViewName): void {
  // Entering a full screen (builder/settings) from a tab: remember it so the back
  // arrow returns there.
  if (BACK_VIEWS.has(view) && !BACK_VIEWS.has(currentView)) {
    returnView = currentView;
  }
  currentView = view;

  // The builder owns a back-layer while it's on screen, so the system back
  // gesture runs the save-guard with priority (rather than the less reliable
  // view-level fallback). Drop it the moment we leave for any other screen.
  if (view === 'builder') armBuilderBack();
  else disarmBuilderBack();

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
      onOpenLine,
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
  // Just loaded from storage — the builder matches what's saved.
  savedSnapshot = builderSnapshot();
  showView('builder');
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
  showDialog({
    title: 'Save this line?',
    body: 'You have unsaved moves in this line.',
    buttons: [
      {
        label: 'Save',
        variant: 'primary',
        onClick: () => { void persistCurrentLine().then(() => proceed()); },
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
  loadedLineId = line.id;
  loadedLineCreatedAt = line.createdAt;
  loadedLineInTraining = line.inTraining;
  currentTrainingLine = line;
  // The builder now matches storage — no unsaved edits.
  savedSnapshot = builderSnapshot();
  return { line, isNew };
}

// Surface a saved line on My Lines, highlighted so it's easy to find.
function goToSavedLine(id: string): void {
  focusSavedLine(id);
  showView('lines');
}

// After saving, offer to add the line to training. The primary action depends on
// the "Confirm run before training" pref: a confirm run when ON, an instant
// enrol when OFF. Either way [Later] just drops the user on My Lines, as before.
// A line that's already in training skips the prompt entirely.
function promptAddToTraining(line: Line): void {
  const confirmRun = getConfirmRunBeforeTraining();
  showDialog({
    title: 'Add to training now?',
    body: confirmRun
      ? 'Do one clean run to confirm the line, then it joins your training.'
      : 'Add this line straight into your training rotation.',
    // Later on the left, the primary action on the right (the expected spot).
    buttons: [
      {
        label: 'Later',
        variant: 'secondary',
        onClick: () => goToSavedLine(line.id),
      },
      {
        label: confirmRun ? 'Confirm run' : 'Add to training',
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

async function saveCurrentLine(): Promise<void> {
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
    void saveCurrentLine();
  });
}

// ── Playback controls ─────────────────────────────────────────────────────────
// Flip and play/pause live in the builder's bottom control bar; the watch-line
// SPEED lives in Settings (set via setWatchSpeed there). watchSpeedMs() reads it
// live, so a speed change in Settings takes effect on the very next auto-played
// move.

function setupPlaybackControls(): void {
  const watchBtn = document.getElementById('watch-btn') as HTMLButtonElement;

  // Flip: a temporary, view-only swap to the other side. It does NOT change
  // the line's saved colour — reopening or resetting restores the correct one.
  document.getElementById('board-flip')!.addEventListener('click', () => cg.toggleOrientation());

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
  );
  if (engine.isEnabled) {
    engine.enable();
    engine.evaluate(chess.fen());
  }

  setupSaveButton();
  setupPlaybackControls();
  setupTitleControls();
  setupNotePanel();
  setupAnnotationPicker();
  setupMoveNav();

  new ResizeObserver(() => cg.redrawAll()).observe(boardEl);

  // Land on the Train screen — the app's start view. The board (in the builder)
  // was created above while visible, so chessground sized itself correctly
  // before we switch away.
  showView('train');
});
