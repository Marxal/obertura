import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';
import { addMove, goTo, mainline, pathTo, getCurrentNode, reset, isEmpty, serialise, uciPathTo, loadTree, fenBefore } from './tree';
import { saveLine, getAllLines, saveGames, countGames, clearGames } from './storage';
import { probeOpeningName, getToken, setToken } from './openings';
import {
  getUsername,
  setUsername,
  importRecentGames,
  summariseGames,
  MONTHS_BACK,
  type ImportedGame,
} from './chesscom';
import { runChesscomSelfTest } from './chesscom.selftest';
import { explainMove, describeGrade } from './explain';
import type { Line } from './types';
import { renderLinesScreen } from './lines-screen';
import { renderReviewScreen } from './review-screen';
import { renderBranchView } from './branch-view';
import { startPretrainingRun } from './pretraining';
import { renderTrainScreen } from './train-screen';
import { Engine, gradeMove } from './engine';
import { EvalPanel } from './eval-panel';

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

// Opening-name lookup. Debounced so rapid moves fire one request, and
// race-guarded so a slow older request can't overwrite a newer result.
let openingTimer: ReturnType<typeof setTimeout> | undefined;
let openingRequestId = 0;

function updateOpeningName() {
  if (openingTimer) clearTimeout(openingTimer);
  openingTimer = setTimeout(async () => {
    const reqId = ++openingRequestId;
    // TEMPORARY DIAGNOSTIC: probe reports why a lookup is empty.
    const { name, debug } = await probeOpeningName(uciPathTo());
    // Ignore stale results: only apply if this is still the latest request.
    if (reqId !== openingRequestId) return;
    const el = document.getElementById('opening-name')!;
    el.textContent = name ?? debug;
    console.log('[opening]', debug);
  }, 350);
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

function renderExplanation(): void {
  const el = document.getElementById('move-explanation')!;
  const node = getCurrentNode();

  // Bump the request id so any in-flight grade for a previous move is ignored.
  gradeRequestId++;

  if (node.id === 'root' || node.note?.trim()) {
    el.hidden = true;
    el.replaceChildren();
    return;
  }

  // Engine off: nothing instructive to say, so just invite turning it on.
  if (!engine.isEnabled) {
    const prompt = document.createElement('span');
    prompt.className = 'explanation-hint';
    prompt.textContent = 'Turn on the engine to explain this move.';
    el.replaceChildren(prompt);
    el.hidden = false;
    return;
  }

  const text = explainMove(fenBefore(node.id), node.san);
  if (!text) {
    el.hidden = true;
    el.replaceChildren();
    return;
  }

  // Verdict slot sits first (filled async); description shows instantly below it.
  const verdictEl = document.createElement('div');
  verdictEl.className = 'explanation-verdict';
  verdictEl.hidden = true;

  const textEl = document.createElement('div');
  textEl.className = 'explanation-text';
  textEl.textContent = text;

  const actions = document.createElement('div');
  actions.className = 'explanation-actions';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'explanation-add-note';
  addBtn.textContent = 'Add to my note';
  addBtn.addEventListener('click', () => adoptExplanationAsNote());
  actions.appendChild(addBtn);

  el.replaceChildren(verdictEl, textEl, actions);
  el.hidden = false;

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
  (document.getElementById('move-note-input') as HTMLTextAreaElement).value = note;
  renderMoveList();
  renderExplanation();
}

let treeViewMode: 'list' | 'branches' = 'list';

function redrawBranchView(): void {
  if (treeViewMode !== 'branches') return;
  const container = document.getElementById('branch-view')!;
  if (!container) return;
  renderBranchView(container, serialise(), {
    onSelectNode: handleMoveClick,
    activeNodeId: getCurrentNode().id,
  });
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

  redrawBranchView();
}

// ── Note panel ────────────────────────────────────────────────────────────────

function renderNotePanel(): void {
  const panel = document.getElementById('note-panel')!;
  const label = document.getElementById('note-panel-label')!;
  const textarea = document.getElementById('move-note-input') as HTMLTextAreaElement;
  const node = getCurrentNode();
  if (node.id === 'root') {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  label.textContent = `Note for ${node.san}`;
  textarea.value = node.note ?? '';
  renderExplanation();
}

function setupNotePanel(): void {
  const textarea = document.getElementById('move-note-input') as HTMLTextAreaElement;
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
  document.getElementById('save-msg')!.textContent = '';
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

// Metadata from the loaded line for the builder readout.
// Phase 3 training will populate confidence and lastTrained.
let loadedLineMeta: { confidence: number; lastTrained: string | null } | null = null;

// The most recently saved line — drives the "Add to training" button visibility.
let currentTrainingLine: Line | null = null;

// Single timer handle for Watch line — prevents stacked playback.
let playbackTimer: ReturnType<typeof setTimeout> | undefined;

function relativeDate(isoStr: string): string {
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`;
  return isoStr.slice(0, 10);
}

function confidenceDots(c: number): string {
  if (!c) return '—';
  const n = Math.min(Math.max(c, 0), 5);
  return '●'.repeat(n) + '○'.repeat(5 - n);
}

function renderLineMeta(): void {
  const el = document.getElementById('line-meta')!;
  if (!loadedLineMeta) {
    el.hidden = true;
    return;
  }
  const { confidence, lastTrained } = loadedLineMeta;
  const dateText = lastTrained ? relativeDate(lastTrained) : 'Never trained';
  el.textContent = `Confidence: ${confidenceDots(confidence)} · ${dateText}`;
  el.hidden = false;
}

function stopPlayback(): void {
  if (playbackTimer !== undefined) {
    clearTimeout(playbackTimer);
    playbackTimer = undefined;
  }
  const watchBtn = document.getElementById('watch-btn') as HTMLButtonElement | null;
  if (watchBtn) {
    watchBtn.textContent = 'Watch line';
    watchBtn.classList.remove('playing');
  }
}

function goToStart(): void {
  goTo('root');
  chess.reset();
  openingRequestId++;
  document.getElementById('opening-name')!.textContent = '';
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

// Sync the training toggle in the builder panel with the current line state.
function updateTrainingButton(): void {
  const row = document.getElementById('add-training-row');
  const btn = document.getElementById('add-training-btn') as HTMLButtonElement | null;
  if (!row) return;
  row.hidden = !currentTrainingLine;
  if (!btn || !currentTrainingLine) return;
  if (currentTrainingLine.inTraining) {
    btn.textContent = '✓ In training';
    btn.classList.add('add-training-btn--active');
  } else {
    btn.textContent = 'Add to training';
    btn.classList.remove('add-training-btn--active');
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────

type ViewName = 'builder' | 'lines' | 'train' | 'review';
let currentView: ViewName = 'builder';

function handleStartTraining(line: Line): void {
  startPretrainingRun(
    line,
    () => {
      // Re-render lines screen so the "Add to training" button disappears.
      const linesEl = document.getElementById('view-lines')!;
      renderLinesScreen(linesEl, { onOpenLine, onStartTraining: handleStartTraining });
    },
    () => { /* cancelled — user is already back at the lines screen */ }
  );
}

function showView(view: ViewName): void {
  currentView = view;
  const builderEl = document.getElementById('view-builder')!;
  const linesEl = document.getElementById('view-lines')!;
  const trainEl = document.getElementById('view-train')!;
  const reviewEl = document.getElementById('view-review')!;

  builderEl.toggleAttribute('hidden', view !== 'builder');
  linesEl.toggleAttribute('hidden', view !== 'lines');
  trainEl.toggleAttribute('hidden', view !== 'train');
  reviewEl.toggleAttribute('hidden', view !== 'review');

  document.querySelectorAll<HTMLElement>('#main-nav .nav-tab').forEach(btn => {
    const active = btn.dataset.view === view;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  if (view === 'lines') {
    renderLinesScreen(linesEl, { onOpenLine, onStartTraining: handleStartTraining });
  }

  if (view === 'train') {
    renderTrainScreen(trainEl);
  }

  if (view === 'review') {
    renderReviewScreen(reviewEl, { onBuildLine });
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
  loadedLineMeta = { confidence: line.confidence, lastTrained: line.lastTrained };

  // Set the training button state for the loaded line.
  currentTrainingLine = line;

  chess.reset();
  cg.set({
    fen: chess.fen(),
    turnColor: 'white',
    movable: { color: 'both', dests: legalDests() },
    lastMove: undefined,
  });

  // Prefill save form with the loaded line's metadata.
  (document.getElementById('line-name') as HTMLInputElement).value = line.name;
  (document.getElementById('line-tags') as HTMLInputElement).value = line.tags.join(', ');

  saveColour = line.colour;
  document.querySelectorAll<HTMLElement>('#colour-toggle button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.colour === line.colour);
  });

  document.getElementById('save-msg')!.textContent = '';
  openingRequestId++;
  document.getElementById('opening-name')!.textContent = '';

  renderMoveList();
  renderNotePanel();
  renderLineMeta();
  updateTrainingButton();
  showView('builder');
}

// Seed the builder from the Review screen: start a fresh line of the given
// colour, replay the supplied UCI moves onto the board and move tree, then show
// the builder. Used to turn a finding ("you play this a lot", "you left prep
// here") into prep — the board lands exactly where you need to start working.
function onBuildLine(ucis: string[], colour: 'white' | 'black'): void {
  stopPlayback();
  reset();
  chess.reset();

  // A new line, not an edit of an existing one.
  loadedLineId = null;
  loadedLineCreatedAt = undefined;
  loadedLineInTraining = false;
  loadedLineMeta = null;
  currentTrainingLine = null;

  (document.getElementById('line-name') as HTMLInputElement).value = '';
  (document.getElementById('line-tags') as HTMLInputElement).value = '';

  saveColour = colour;
  document.querySelectorAll<HTMLElement>('#colour-toggle button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.colour === colour);
  });

  // Replay the seed moves. chess.js validates each; addMove records the tree.
  let lastFrom: Key | undefined;
  let lastTo: Key | undefined;
  for (const uci of ucis) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = (uci[4] as 'q' | 'r' | 'b' | 'n') || 'q';
    const move = chess.move({ from, to, promotion });
    if (!move) break; // defensive: stop at the first move that doesn't fit
    addMove(move.san, from + to + (move.promotion ?? ''), chess.fen());
    lastFrom = from as Key;
    lastTo = to as Key;
  }

  document.getElementById('save-msg')!.textContent = '';
  openingRequestId++;
  document.getElementById('opening-name')!.textContent = '';

  cg.set({
    fen: chess.fen(),
    turnColor: turnColor(),
    movable: { color: 'both', dests: legalDests() },
    lastMove: lastFrom && lastTo ? [lastFrom, lastTo] : undefined,
  });

  renderMoveList();
  renderNotePanel();
  renderLineMeta();
  updateTrainingButton();
  updateOpeningName();
  evalPanel.clear();
  engine.evaluate(chess.fen());

  showView('builder');
}

function setupNav(): void {
  document.querySelectorAll<HTMLElement>('#main-nav .nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view as ViewName | undefined;
      if (view) showView(view);
    });
  });
}

// ── Debug readout ─────────────────────────────────────────────────────────────

async function refreshDebugReadout() {
  const all = await getAllLines();
  const el = document.getElementById('debug-readout')!;
  el.textContent = `${all.length} line${all.length === 1 ? '' : 's'} saved`;
}

// ── Save form ─────────────────────────────────────────────────────────────────

function setupSaveForm() {
  const saveForm = document.getElementById('save-form')!;
  const nameInput = document.getElementById('line-name') as HTMLInputElement;
  const tagsInput = document.getElementById('line-tags') as HTMLInputElement;
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
  const saveMsg = document.getElementById('save-msg')!;
  const debugReadout = document.getElementById('debug-readout')!;
  const toggle = document.getElementById('colour-toggle')!;

  // "Add to training" row — hidden until a line is saved and inTraining is false.
  const addTrainingRow = document.createElement('div');
  addTrainingRow.id = 'add-training-row';
  addTrainingRow.hidden = true;
  const addTrainingBtn = document.createElement('button');
  addTrainingBtn.type = 'button';
  addTrainingBtn.id = 'add-training-btn';
  addTrainingBtn.className = 'add-training-btn';
  addTrainingBtn.textContent = 'Add to training';
  addTrainingRow.appendChild(addTrainingBtn);
  saveForm.insertBefore(addTrainingRow, debugReadout);

  addTrainingBtn.addEventListener('click', async () => {
    if (!currentTrainingLine) return;
    if (currentTrainingLine.inTraining) {
      // Remove from training — flip the flag and save; SM-2 data is kept intact.
      const updated: Line = { ...currentTrainingLine, inTraining: false };
      await saveLine(updated);
      loadedLineInTraining = false;
      currentTrainingLine = updated;
      updateTrainingButton();
      saveMsg.textContent = 'Removed from training';
    } else {
      startPretrainingRun(
        currentTrainingLine,
        () => {
          loadedLineInTraining = true;
          currentTrainingLine = currentTrainingLine ? { ...currentTrainingLine, inTraining: true } : null;
          updateTrainingButton();
          saveMsg.textContent = 'Added to training ✓';
        },
        () => { /* cancelled — stay in builder */ }
      );
    }
  });

  // White / Black segmented control.
  toggle.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      saveColour = btn.dataset.colour as 'white' | 'black';
      toggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  saveBtn.addEventListener('click', async () => {
    if (isEmpty()) {
      saveMsg.textContent = 'Play a move first';
      return;
    }

    const tags = tagsInput.value
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const isNew = !loadedLineId;
    const id = loadedLineId ?? crypto.randomUUID();
    const line: Line = {
      id,
      name: nameInput.value.trim() || 'Untitled line',
      tags,
      colour: saveColour,
      openingName: null,
      confidence: 0,
      lastTrained: null,
      // Preserve inTraining for existing lines; new lines start as false.
      inTraining: isNew ? false : loadedLineInTraining,
      tree: serialise(),
      createdAt: isNew ? Date.now() : (loadedLineCreatedAt ?? Date.now()),
    };

    await saveLine(line);
    loadedLineId = id;
    loadedLineCreatedAt = line.createdAt;
    currentTrainingLine = line;
    saveMsg.textContent = 'Saved ✓';
    updateTrainingButton();
    await refreshDebugReadout();
  });

  // Show the persisted count on load — confirms data survived an app restart.
  refreshDebugReadout();
}

// ── Settings ──────────────────────────────────────────────────────────────────

function setupSettings() {
  const tokenInput = document.getElementById('lichess-token') as HTMLInputElement;
  const tokenMsg = document.getElementById('token-msg')!;

  // Prefill from device storage so it survives reloads.
  tokenInput.value = getToken();
  tokenMsg.textContent = getToken() ? 'Token saved on this device ✓' : '';

  tokenInput.addEventListener('change', () => {
    setToken(tokenInput.value);
    tokenMsg.textContent = getToken() ? 'Token saved on this device ✓' : 'Token cleared';
    // Re-run the lookup for the current line now that auth changed.
    updateOpeningName();
  });
}

// ── Chess.com import ────────────────────────────────────────────────────────────
// Pull ~a year of games from the free Published-Data API, parse the PGNs with
// chess.js, and store the compact records in IndexedDB. Each month is persisted
// as it arrives, so a long import never holds the whole year in memory at once.

function setupImport(): void {
  const userInput = document.getElementById('chesscom-user') as HTMLInputElement;
  const importBtn = document.getElementById('import-btn') as HTMLButtonElement;
  const status = document.getElementById('import-status')!;
  const summary = document.getElementById('import-summary')!;

  // Prefill the saved username and show how many games are already stored.
  userInput.value = getUsername();
  countGames().then(n => {
    if (n > 0) summary.textContent = `${n} game${n === 1 ? '' : 's'} stored on this device.`;
  });

  userInput.addEventListener('change', () => setUsername(userInput.value));

  importBtn.addEventListener('click', async () => {
    const user = userInput.value.trim();
    if (!user) {
      status.textContent = 'Enter your Chess.com username first.';
      return;
    }
    setUsername(user);

    importBtn.disabled = true;
    summary.textContent = '';
    status.textContent = 'Looking up your archives…';

    // Re-import from scratch so removed/renamed games don't linger. Records are
    // keyed by game id, so this is just to keep the store clean.
    await clearGames();

    const stored: ImportedGame[] = [];
    try {
      const result = await importRecentGames(user, {
        months: MONTHS_BACK,
        onProgress: p => {
          status.textContent =
            `Month ${Math.min(p.monthsDone + 1, p.monthsTotal)}/${p.monthsTotal} ` +
            `(${p.label}) — ${p.gamesSoFar} games so far…`;
        },
        // Persist each month's batch immediately, then drop it from memory.
        onGames: async batch => {
          await saveGames(batch);
          stored.push(...batch);
        },
      });

      const s = summariseGames(stored);
      if (s.total === 0) {
        status.textContent = `No standard games found in the last ${result.monthsFetched} months.`;
      } else {
        status.textContent = `Imported ${s.total} games from ${result.monthsFetched} months ✓`;
        summary.innerHTML = '';
        const line1 = document.createElement('div');
        line1.textContent =
          `${s.byTimeClass.bullet} bullet · ${s.byTimeClass.blitz} blitz · ` +
          `${s.byTimeClass.rapid} rapid · ${s.byTimeClass.daily} daily`;
        const line2 = document.createElement('div');
        line2.textContent =
          `${s.white} as White / ${s.black} as Black · ` +
          `W-L-D ${s.wins}-${s.losses}-${s.draws}`;
        summary.appendChild(line1);
        summary.appendChild(line2);
      }
    } catch (err) {
      status.textContent = `Import failed — ${(err as Error).message}`;
    } finally {
      importBtn.disabled = false;
    }
  });

  setupImportSelfTest();
}

// Offline parser self-test — mirrors the scheduler self-test on the Train screen.
function setupImportSelfTest(): void {
  const link = document.getElementById('import-selftest-link') as HTMLButtonElement;
  const out = document.getElementById('import-selftest-output')!;

  link.addEventListener('click', () => {
    const results = runChesscomSelfTest();
    out.hidden = false;
    out.innerHTML = '';

    const passed = results.filter(r => r.pass).length;
    const head = document.createElement('div');
    head.className = `selftest-head ${passed === results.length ? 'ok' : 'fail'}`;
    head.textContent = `${passed}/${results.length} checks passed`;
    out.appendChild(head);

    for (const r of results) {
      const row = document.createElement('div');
      row.className = `selftest-row ${r.pass ? 'ok' : 'fail'}`;
      row.textContent = `${r.pass ? '✓' : '✗'} ${r.name} — ${r.detail}`;
      out.appendChild(row);
    }
    console.log('[chesscom self-test]', results);
  });
}

// ── Playback controls ─────────────────────────────────────────────────────────

function setupPlaybackControls(): void {
  const lastPosBtn = document.getElementById('last-pos-btn') as HTMLButtonElement;
  const watchBtn = document.getElementById('watch-btn') as HTMLButtonElement;

  lastPosBtn.addEventListener('click', () => {
    const moves = mainline();
    if (moves.length === 0) return;
    handleMoveClick(moves[moves.length - 1].id);
  });

  watchBtn.addEventListener('click', () => {
    if (playbackTimer !== undefined) {
      stopPlayback();
      return;
    }

    const moves = mainline();
    if (moves.length === 0) return;

    watchBtn.textContent = 'Stop';
    watchBtn.classList.add('playing');
    goToStart();

    function playStep(index: number): void {
      if (index >= moves.length) {
        watchBtn.textContent = 'Watch line';
        watchBtn.classList.remove('playing');
        playbackTimer = undefined;
        return;
      }
      playbackTimer = setTimeout(() => {
        handleMoveClick(moves[index].id);
        playStep(index + 1);
      }, 700);
    }

    playStep(0);
  });
}

// ── Branch view toggle ────────────────────────────────────────────────────────

function setupBranchView(): void {
  const linePanel = document.getElementById('line-panel')!;
  const moveList = document.getElementById('move-list')!;

  const toggleRow = document.createElement('div');
  toggleRow.id = 'tree-toggle';
  const listBtn = document.createElement('button');
  listBtn.type = 'button';
  listBtn.id = 'toggle-list';
  listBtn.className = 'tree-tab active';
  listBtn.textContent = 'List';
  const branchBtn = document.createElement('button');
  branchBtn.type = 'button';
  branchBtn.id = 'toggle-branches';
  branchBtn.className = 'tree-tab';
  branchBtn.textContent = 'Branches';
  toggleRow.appendChild(listBtn);
  toggleRow.appendChild(branchBtn);
  linePanel.insertBefore(toggleRow, moveList);

  const branchContainer = document.createElement('div');
  branchContainer.id = 'branch-view';
  branchContainer.hidden = true;
  moveList.insertAdjacentElement('afterend', branchContainer);

  listBtn.addEventListener('click', () => {
    treeViewMode = 'list';
    moveList.hidden = false;
    branchContainer.hidden = true;
    listBtn.classList.add('active');
    branchBtn.classList.remove('active');
  });

  branchBtn.addEventListener('click', () => {
    treeViewMode = 'branches';
    moveList.hidden = true;
    branchContainer.hidden = false;
    listBtn.classList.remove('active');
    branchBtn.classList.add('active');
    redrawBranchView();
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

const boardEl = document.getElementById('board') as HTMLElement;

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
        document.getElementById('save-msg')!.textContent = '';
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

  setupSaveForm();
  setupSettings();
  setupImport();
  setupPlaybackControls();
  setupBranchView();
  setupNotePanel();

  document.getElementById('reset-btn')!.addEventListener('click', () => {
    stopPlayback();
    reset();
    chess.reset();
    loadedLineId = null;
    loadedLineCreatedAt = undefined;
    loadedLineInTraining = false;
    loadedLineMeta = null;
    currentTrainingLine = null;
    (document.getElementById('line-name') as HTMLInputElement).value = '';
    (document.getElementById('line-tags') as HTMLInputElement).value = '';
    // Reset colour toggle to White.
    saveColour = 'white';
    document.querySelectorAll<HTMLElement>('#colour-toggle button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.colour === 'white');
    });
    document.getElementById('save-msg')!.textContent = '';
    // Clear the opening label and invalidate any in-flight lookup.
    openingRequestId++;
    document.getElementById('opening-name')!.textContent = '';
    cg.set({
      fen: chess.fen(),
      turnColor: 'white',
      movable: {
        color: 'both',
        dests: legalDests(),
      },
      lastMove: undefined,
    });
    renderMoveList();
    renderNotePanel();
    renderLineMeta();
    updateTrainingButton();
    evalPanel.clear();
    engine.evaluate(chess.fen());
  });

  new ResizeObserver(() => cg.redrawAll()).observe(boardEl);
});
