import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';
import { addMove, goTo, mainline, pathTo, getCurrentNode, reset, isEmpty, serialise, loadTree, removeLastMove, truncateAfterCurrent } from './tree';
import type { Annotation, MoveNode } from './tree';
import { saveLine, getAllLines, countGames } from './storage';
import { nameForPath } from './openings';
import type { Line } from './types';
import { renderLinesScreen, focusSavedLine } from './lines-screen';
import { renderProgressScreen } from './progress-screen';
import { startPretrainingRun, enrolLineDirectly } from './pretraining';
import { renderTrainScreen } from './train-screen';
import { renderExploreScreen } from './explore-screen';
import { opponentTag } from './scout';
import { renderSettingsScreen } from './settings-screen';
import { Engine } from './engine';
import { EvalPanel } from './eval-panel';
import { createBuilderPanels, type BuilderPanels } from './builder-panels';
import { initTheme } from './theme';
import { initAppearance } from './appearance';
import { watchSpeedMs, getConfirmRunBeforeTraining } from './prefs';
import { initBackNav, setViewBack, pushBack } from './back-nav';
import { showDialog } from './dialog';
import { openImportPanel, getGamesSource, IDENTITY_CHANGED_EVENT } from './import-panel';
import { openLibrary } from './library';
import { maybeShowIntro } from './onboarding';
import { maybeAutoRefreshGames } from './auto-refresh';
import { maybeShowGate } from './gate';
import { showToast } from './toast';
import { Icons } from './icons';
import { mountFab, type FabItem, type FabController } from './fab';
import { importLastGame, hasConnectedAccount } from './import-last';
import { openEngineSpar, openMyGamesBrowser } from './explore-screen';

const chess = new Chess();
let cg!: ReturnType<typeof Chessground>;
let engine!: Engine;
let evalPanel!: EvalPanel;
let builderPanels: BuilderPanels | null = null;

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

// ── Builder carousel (the panels below the board) ───────────────────────────
// A paged, swipeable strip — Line / Book / Games / Engine — sharing the one
// builder board. The tab strip above the step arrows mirrors the active slide
// and jumps to one on tap. The board sits ABOVE the carousel and is a fixed
// square, so swiping slides never moves it.

const ENGINE_SLIDE = 3;
let activeSlide = 0;

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
}

// Fit the carousel into the space left between the board and the bottom dock, so
// each slide scrolls internally and the dock (tabs + arrows) stays pinned. Done
// in JS rather than CSS math so it's exact regardless of header/board heights.
function sizeBuilderCarousel(): void {
  const track = document.getElementById('builder-carousel');
  const dock = document.getElementById('builder-dock');
  if (!track || !dock || currentView !== 'builder') return;
  const top = track.getBoundingClientRect().top;
  const h = window.innerHeight - top - dock.offsetHeight;
  if (h > 0) track.style.height = `${h}px`;
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

  window.addEventListener('resize', sizeBuilderCarousel);
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
  h.textContent = `Note for ${node.san}`;
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
  renderMoveDetails();
  evalPanel.clear();
  engine.evaluate(chess.fen());
}

// The header save button reads "Save changes" when editing an existing line,
// and "Save line" for a fresh one — standard create-vs-edit wording.
function updateSaveButtonLabel(): void {
  const label = document.getElementById('header-save-label');
  if (label) label.textContent = loadedLineId ? 'Save changes' : 'Save line';
}

// ── Navigation ────────────────────────────────────────────────────────────────

// The four bottom-tab destinations, plus the board screens reached from them.
// "train" is the start view and back-navigation root; "explore" is a v1.2
// placeholder; "builder" shows a chessboard, so it counts as a board screen
// (see BACK_VIEWS below).
type ViewName = 'train' | 'lines' | 'explore' | 'progress' | 'builder' | 'settings';
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

// Seed the builder with a UCI move list, then open it (from "From my games"
// suggestions, or the Prepare flow). Starts from a clean, unsaved line so a Save
// creates a new one. Optional tags pre-fill the working tag set (used by Prepare
// to stamp the opponent tag).
function buildFromUcis(ucis: string[], colour: 'white' | 'black', tags: string[] = []): void {
  clearBuilder(colour);
  currentTags = [...tags];
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
  renderMoveDetails();
  renderBuilderTags();
  updateOpeningName();
  evalPanel.clear();
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
// the FAB's "Build with the engine" / "Browse my games" shortcuts (which open
// those Explore flows from any tab).
function exploreScreenDeps() {
  return {
    onPrepareReply: prepareReply,
    onOpenLine,
    onOpenInBuilder: (ucis: string[], colour: 'white' | 'black') => buildFromUcis(ucis, colour),
  };
}

// Build the FAB's action list fresh on every open so it reflects the live account
// / games state. New line and the create flows are always there; "Import last
// game" needs a connected account; the games slot is a board browser when games
// exist, or a games-import prompt when they don't.
async function buildFabActions(): Promise<FabItem[]> {
  const gamesCount = await countGames();
  const connected = hasConnectedAccount();
  const items: FabItem[] = [];

  // Listed bottom (closest to the ＋) → top. .fab-menu is column-reverse, so the
  // first item pushed renders nearest the button.

  // 1) New line — always; colour is the action via the White | Black split.
  items.push({
    kind: 'split',
    label: 'New line',
    left: { label: 'White', onClick: () => startNewLine('white') },
    right: { label: 'Black', onClick: () => startNewLine('black') },
  });

  // 2) Import last game — only with a connected account.
  if (connected) {
    items.push({
      icon: Icons.clock(20),
      label: 'Import last game',
      sublabel: 'Open your most recent game',
      onClick: () => { void runImportLastGame(); },
    });
  }

  // 3) Browse my games (with games) / Import my games (without) — same slot.
  if (gamesCount > 0) {
    items.push({
      icon: Icons.compass(20),
      label: 'Browse my games',
      sublabel: 'Walk your games on a board',
      onClick: () => { void openMyGamesBrowser(exploreScreenDeps()); },
    });
  } else {
    items.push({
      icon: Icons.download(20),
      label: 'Import my games',
      sublabel: 'From Lichess or Chess.com',
      onClick: () => openImportPanel({
        onImported: () => { if (currentView === 'explore') showView('explore'); },
      }),
    });
  }

  // 4) Opening library — always.
  items.push({
    icon: Icons.search(20),
    label: 'Opening library',
    sublabel: 'Start from a named opening',
    onClick: () => openLibrary((ucis, colour) => buildFromUcis(ucis, colour)),
  });

  // 5) Build with the engine — always; top of the menu.
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
    buildFromUcis(game.ucis, game.colour);
  } catch {
    showToast('Couldn’t reach your account — check your connection.');
  }
}

// Build a fresh Line from a flat UCI list, auto-named from the bundled book —
// the same naming the builder's Save uses, without touching the live builder
// tree. Used by the onboarding starter-line flow. Returns null if no legal
// move could be applied.
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
    currentView === 'builder' ? (currentTitle() || 'New line')
    : currentView === 'settings' ? 'Settings'
    : 'Obertura';
  el.classList.toggle('header-title--screen', !onTab);
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

  if (view === 'train') {
    renderTrainScreen(trainEl, {
      focusLineId: pendingTrainLineId ?? undefined,
      onOpenLine,
      onBuildLine: () => startNewLine('white'),
      onImportGames: () => openImportPanel({ onImported: () => showView('train') }),
      // Onboarding's one-tap add: turn a starter/suggested line's moves into a
      // saved Line and route it through the normal add-to-training flow (learn =
      // the watch-then-play confirm run; otherwise enrol directly).
      onAddStarterLine: (ucis, colour, learn, onDone, onCancel) => {
        const line = lineFromUcis(ucis, colour);
        if (!line) { onCancel(); return; }
        if (learn) addLineToTraining(line, onDone, onCancel);
        else void enrolLineDirectly(line).then(onDone);
      },
      // Onboarding's quieter routes: the opening-library browser (seeds the
      // builder) and the Explore screen, home of "play the engine" sparring.
      onBrowseLibrary: () => openLibrary((ucis, colour) => buildFromUcis(ucis, colour)),
      onBuildWithEngine: () => showView('explore'),
      onSetFabVisible: (visible) => fabController?.setVisible(visible),
    });
    pendingTrainLineId = null;
  }

  if (view === 'progress') {
    renderProgressScreen(progressEl, {
      onTrainLine,
      onOpenLine: (line) => onOpenLine(line),
      onStartTraining: () => showView('train'),
      onBuildLine: () => startNewLine('white'),
    });
  }

  if (view === 'settings') {
    renderSettingsScreen(settingsEl);
  }

  if (view === 'builder') {
    // Always land on the Line tab with the engine off; entering the Engine tab
    // is what turns it on. Forcing activeSlide to a sentinel makes onActiveSlide
    // run its leave-branch and disable the engine.
    const track = document.getElementById('builder-carousel');
    if (track) track.scrollLeft = 0;
    activeSlide = -1;
    onActiveSlide(0);
    // The carousel can only be sized once the builder is visible (its slides have
    // zero height while hidden). Re-read games too, in case some were just
    // imported, then repaint the slides for the current position.
    requestAnimationFrame(() => {
      sizeBuilderCarousel();
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
  renderTitle();
  renderBuilderTags();

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

  // Show your Chess.com picture on the settings button when connected, and keep
  // it in step with every import / auto-refresh.
  applyNavSettingsAvatar();
  window.addEventListener(IDENTITY_CHANGED_EVENT, applyNavSettingsAvatar);

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
      // The eval bar sits under the board and shows/hides with the engine, so
      // re-fit the carousel to the new gap and re-sync chessground's bounds.
      cg.redrawAll();
      requestAnimationFrame(sizeBuilderCarousel);
    },
    (uci) => playUci(uci),
  );
  if (engine.isEnabled) {
    engine.enable();
    engine.evaluate(chess.fen());
  }

  // The Library / Games carousel slides — they read the live builder position
  // and play a tapped continuation straight onto the line.
  builderPanels = createBuilderPanels({
    libraryEl: document.getElementById('slide-library')!,
    gamesEl: document.getElementById('slide-games')!,
    getSans: currentPathSans,
    getUcis: currentPathUcis,
    getFen: () => chess.fen(),
    getColour: () => saveColour,
    onPlay: (uci) => playUci(uci),
  });

  setupSaveButton();
  setupPlaybackControls();
  setupTitleControls();
  setupNoteBlock();
  setupMoveNav();
  setupBuilderCarousel();

  // Mount the global FAB before the first showView, so its initial visibility is
  // set correctly when we land on Train.
  fabController = mountFab(buildFabActions);

  new ResizeObserver(() => cg.redrawAll()).observe(boardEl);

  // Land on the Train screen — the app's start view. The board (in the builder)
  // was created above while visible, so chessground sized itself correctly
  // before we switch away.
  showView('train');

  // First launch: play the intro over the top, landing back on Train when it's
  // done (an import there refreshes Train's view). Shows once — see onboarding.ts.
  maybeShowIntro({ onFinish: () => showView('train') });

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
