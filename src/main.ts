import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';
import { addMove, goTo, mainline, pathTo, getCurrentNode, reset, isEmpty, serialise, uciPathTo, loadTree } from './tree';
import { saveLine, getAllLines } from './storage';
import { probeOpeningName, getToken, setToken } from './openings';
import type { Line } from './types';
import { renderLinesScreen } from './lines-screen';
import { renderBranchView } from './branch-view';
import { startPretrainingRun } from './pretraining';

const chess = new Chess();
let cg!: ReturnType<typeof Chessground>;

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
    wSpan.textContent = white.san;
    wSpan.addEventListener('click', () => handleMoveClick(white.id));
    el.appendChild(wSpan);

    if (black) {
      const bSpan = document.createElement('span');
      bSpan.className = `move-san${black.id === activeId ? ' active' : ''}`;
      bSpan.textContent = black.san;
      bSpan.addEventListener('click', () => handleMoveClick(black.id));
      el.appendChild(bSpan);
    }
  }

  redrawBranchView();
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
  updateOpeningName();
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
}

// Show or hide the "Add to training" button based on current saved line state.
function updateTrainingButton(): void {
  const row = document.getElementById('add-training-row');
  if (row) row.hidden = !currentTrainingLine || currentTrainingLine.inTraining;
}

// ── Navigation ────────────────────────────────────────────────────────────────

type ViewName = 'builder' | 'lines';
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

  builderEl.toggleAttribute('hidden', view !== 'builder');
  linesEl.toggleAttribute('hidden', view !== 'lines');

  document.querySelectorAll<HTMLElement>('#main-nav .nav-tab').forEach(btn => {
    const active = btn.dataset.view === view;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  if (view === 'lines') {
    renderLinesScreen(linesEl, { onOpenLine, onStartTraining: handleStartTraining });
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
  renderLineMeta();
  updateTrainingButton();
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
  addTrainingBtn.className = 'add-training-btn';
  addTrainingBtn.textContent = 'Add to training';
  addTrainingRow.appendChild(addTrainingBtn);
  saveForm.insertBefore(addTrainingRow, debugReadout);

  addTrainingBtn.addEventListener('click', () => {
    if (!currentTrainingLine) return;
    startPretrainingRun(
      currentTrainingLine,
      () => {
        // Training complete from builder: hide button, update local state.
        loadedLineInTraining = true;
        currentTrainingLine = currentTrainingLine ? { ...currentTrainingLine, inTraining: true } : null;
        updateTrainingButton();
        saveMsg.textContent = 'Added to training ✓';
      },
      () => { /* cancelled — stay in builder, do nothing */ }
    );
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
        updateOpeningName();
      },
    },
  });

  setupSaveForm();
  setupSettings();
  setupPlaybackControls();
  setupBranchView();

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
    renderLineMeta();
    updateTrainingButton();
  });

  new ResizeObserver(() => cg.redrawAll()).observe(boardEl);
});
