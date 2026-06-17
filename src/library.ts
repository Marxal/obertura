// The opening Library — a browsable reference over the bundled opening book.
//
// openLibrary(onOpenInBuilder) opens a full-screen overlay with TWO ways to
// browse the ~3,700 named openings, switched by a toggle at the top:
//   • Stacked (default) — a search field (by name or ECO) over a flat list,
//     results grouped by family. This is the original library, untouched.
//   • Visual — a collapsible map-style tree of the whole book: ~150 FAMILY
//     nodes (Sicilian Defense, Ruy Lopez, …) that expand on tap into their
//     named variations. No search; you scan and drill down instead.
// The chosen mode is remembered device-locally.
//
// Both modes share the same leaf action: tapping an opening opens the DETAIL
// view — name + ECO, a board, and the move sequence you can step through.
// "Open in builder" asks White or Black, then hands the moves back to the app
// shell to seed the builder, flipped to side.
//
// On reuse: the repertoire-map renderer draws a pan/zoom SVG tree of CHESS
// MOVES (one position per node), rendered all at once with no expand-on-tap.
// The book is grouped by family NAME and must collapse/expand to stay sane at
// 3,700 entries, so that renderer doesn't fit — the Visual tree below is a
// small purpose-built accordion instead.
//
// SCOPE: this is a reference, not an explorer — no transpositions, no stats.
// Simple in-memory filtering (Stacked) and one level of family grouping
// (Visual).
//
// The dataset (src/openings-library.json) is produced alongside the naming
// lookup by scripts/build-openings.mjs. It's LAZY-LOADED — a dynamic import so
// the ~490 KB file only downloads when the Library is first opened.

import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api as CgApi } from 'chessground/api';
import type { Key } from 'chessground/types';
import { Icons } from './icons';
import { showDialog } from './dialog';
import { pushBack } from './back-nav';
import { createLibraryExplorer, type LibraryExplorer } from './library-explorer';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Cap rendered rows so a broad/empty search can't spray thousands of nodes onto
// a phone. The count line always reports the true total of matches.
const MAX_RENDERED = 250;

export interface LibraryEntry {
  eco: string;
  name: string;
  moves: string[]; // SAN sequence
}

// A search-indexed entry: the lowercased "name eco" haystack is built once so
// filtering on every keystroke is a single string includes per opening.
interface IndexedEntry extends LibraryEntry {
  haystack: string;
}

// Cached across opens — load and index the dataset at most once per session.
let libraryPromise: Promise<IndexedEntry[]> | null = null;

function loadLibrary(): Promise<IndexedEntry[]> {
  if (!libraryPromise) {
    libraryPromise = import('./openings-library.json').then(mod => {
      const raw = (mod.default ?? mod) as LibraryEntry[];
      return raw.map(e => ({ ...e, haystack: `${e.name} ${e.eco}`.toLowerCase() }));
    });
  }
  return libraryPromise;
}

// The family is the part before the first colon ("French Defense: Alapin
// Gambit" → "French Defense"); the variation is what follows ("Alapin Gambit"),
// or "Main line" when the name is just the family.
function familyOf(name: string): string {
  const i = name.indexOf(':');
  return i === -1 ? name : name.slice(0, i).trim();
}
function variationOf(name: string): string {
  const i = name.indexOf(':');
  return i === -1 ? 'Main line' : name.slice(i + 1).trim();
}

// Which browse mode the library opens in — remembered device-local (tiny, like
// the prefs in prefs.ts). Three ways to browse the same book:
//   board → interactive playable board over the book (the default).
//   list  → the searchable flat list, grouped by family (the original library).
//   moves → the collapsible family tree.
type LibMode = 'board' | 'list' | 'moves';
const LIB_MODE_KEY = 'obertura.library.viewMode';
function getLibMode(): LibMode {
  // Migrate the earlier two-mode names (stacked/visual) on read.
  const v = localStorage.getItem(LIB_MODE_KEY);
  if (v === 'list' || v === 'stacked') return 'list';
  if (v === 'moves' || v === 'visual') return 'moves';
  return 'board';
}
function setLibMode(mode: LibMode): void {
  localStorage.setItem(LIB_MODE_KEY, mode);
}

// ── Public entry point ──────────────────────────────────────────────────────

export function openLibrary(onOpenInBuilder: (ucis: string[], colour: 'white' | 'black') => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'rmap-overlay lib-overlay';

  let closed = false;
  // Built lazily the first time Board mode is shown; torn down on close.
  let explorer: LibraryExplorer | null = null;
  function close(): void {
    if (closed) return;
    closed = true;
    explorer?.destroy();
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);

  // Opening a line in the builder must also dismiss the library overlay itself —
  // it's a full-screen opaque overlay (z-index 200), so without this the builder
  // opens *behind* it and nothing appears to happen. close() also tears down the
  // board-mode explorer. The detail view closes its own overlay first; closing an
  // already-removed overlay again is a no-op.
  const openInBuilder = (ucis: string[], colour: 'white' | 'black'): void => {
    close();
    onOpenInBuilder(ucis, colour);
  };

  // Header.
  const header = document.createElement('div');
  header.className = 'rmap-header';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'rmap-back';
  back.setAttribute('aria-label', 'Close library');
  back.appendChild(Icons.back(20));
  back.addEventListener('click', close);
  const titleEl = document.createElement('h2');
  titleEl.className = 'rmap-title';
  titleEl.textContent = 'Opening library';
  const countBadge = document.createElement('span');
  countBadge.className = 'rmap-title-count';
  countBadge.textContent = '…';
  header.appendChild(back);
  header.appendChild(titleEl);
  header.appendChild(countBadge);
  overlay.appendChild(header);

  // Mode toggle — Board (interactive board) / List (search list) / Moves (family
  // tree). Remembered; Board is the default.
  let mode: LibMode = getLibMode();
  // Assigned once the dataset loads; the toggle calls it to repaint the body.
  let render: () => void = () => {};

  const modeBar = document.createElement('div');
  modeBar.className = 'lib-mode-bar';
  const seg = document.createElement('div');
  seg.className = 'lib-mode-seg';
  const modeDefs: { id: LibMode; label: string }[] = [
    { id: 'board', label: 'Board' },
    { id: 'list', label: 'List' },
    { id: 'moves', label: 'Moves' },
  ];
  const modeBtns = modeDefs.map(m => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lib-mode-btn' + (m.id === mode ? ' lib-mode-btn--on' : '');
    b.textContent = m.label;
    b.setAttribute('aria-pressed', String(m.id === mode));
    b.addEventListener('click', () => {
      if (m.id === mode) return;
      mode = m.id;
      setLibMode(mode);
      modeBtns.forEach((bb, i) => {
        const on = modeDefs[i].id === mode;
        bb.classList.toggle('lib-mode-btn--on', on);
        bb.setAttribute('aria-pressed', String(on));
      });
      render();
    });
    seg.appendChild(b);
    return b;
  });
  modeBar.appendChild(seg);
  overlay.appendChild(modeBar);

  // Search field (Stacked only — hidden in Visual mode).
  const searchWrap = document.createElement('div');
  searchWrap.className = 'lib-search-wrap';
  const searchIcon = document.createElement('span');
  searchIcon.className = 'lib-search-icon';
  searchIcon.appendChild(Icons.search(17));
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'lib-search-input';
  input.placeholder = 'Search name or ECO (e.g. Najdorf, C60)';
  input.autocapitalize = 'off';
  input.autocomplete = 'off';
  input.spellcheck = false;
  searchWrap.appendChild(searchIcon);
  searchWrap.appendChild(input);
  overlay.appendChild(searchWrap);

  // Results.
  const results = document.createElement('div');
  results.className = 'lib-results';
  const loading = document.createElement('p');
  loading.className = 'lib-status';
  loading.textContent = 'Loading library…';
  results.appendChild(loading);
  overlay.appendChild(results);

  document.body.appendChild(overlay);

  // Family expansion state for the Visual tree, kept across mode switches so a
  // re-open of Visual within the session lands where you left it.
  const expanded = new Set<string>();

  void loadLibrary().then(entries => {
    if (closed) return;
    countBadge.textContent = `${entries.length}`;

    const renderStacked = () => {
      const q = input.value.trim().toLowerCase();
      const matches = q ? entries.filter(e => e.haystack.includes(q)) : entries;
      renderResults(results, matches, q, entry => openDetail(entry, openInBuilder));
    };

    render = () => {
      // Search field only in List; results area in List/Moves; board panel in Board.
      searchWrap.hidden = mode !== 'list';
      results.hidden = mode === 'board';
      if (explorer) explorer.el.hidden = mode !== 'board';

      if (mode === 'board') {
        if (!explorer) {
          explorer = createLibraryExplorer(entries, openInBuilder);
          overlay.appendChild(explorer.el);
        }
        // The board needs a layout pass before chessground can size itself, so
        // redraw once it's actually visible.
        requestAnimationFrame(() => explorer?.redraw());
      } else if (mode === 'moves') {
        renderFamilyTree(results, entries, expanded, entry => openDetail(entry, openInBuilder));
      } else {
        renderStacked();
      }
    };

    // Filtering 3,700 entries on a string includes is sub-millisecond, so render
    // straight on input — no debounce needed, and it stays responsive on a phone.
    input.addEventListener('input', () => { if (mode === 'list') renderStacked(); });
    render();
    if (mode === 'list') input.focus();
  }).catch(() => {
    if (closed) return;
    loading.textContent = 'Could not load the library. Check your connection and try again.';
  });
}

// ── Results list ────────────────────────────────────────────────────────────

function renderResults(
  container: HTMLElement,
  matches: IndexedEntry[],
  query: string,
  onOpen: (entry: IndexedEntry) => void,
): void {
  container.innerHTML = '';

  // Count line.
  const count = document.createElement('p');
  count.className = 'lib-status';
  if (matches.length === 0) {
    count.textContent = query ? `No openings match “${query}”.` : 'No openings.';
    container.appendChild(count);
    return;
  }
  const shown = Math.min(matches.length, MAX_RENDERED);
  count.textContent = shown < matches.length
    ? `Showing ${shown} of ${matches.length} openings — keep typing to narrow.`
    : `${matches.length} opening${matches.length === 1 ? '' : 's'}`;
  container.appendChild(count);

  // Group by family, preserving the dataset's order (roughly ECO order). Cap the
  // number of rendered ROWS, not families, so the list can't balloon.
  const groups = new Map<string, IndexedEntry[]>();
  let rendered = 0;
  for (const e of matches) {
    if (rendered >= MAX_RENDERED) break;
    const fam = familyOf(e.name);
    if (!groups.has(fam)) groups.set(fam, []);
    groups.get(fam)!.push(e);
    rendered++;
  }

  for (const [family, entries] of groups) {
    const group = document.createElement('div');
    group.className = 'lib-group';

    const head = document.createElement('div');
    head.className = 'lib-group-head';
    const famName = document.createElement('span');
    famName.className = 'lib-group-name';
    famName.textContent = family;
    head.appendChild(famName);
    const famCount = document.createElement('span');
    famCount.className = 'lib-group-count';
    famCount.textContent = `${entries.length}`;
    head.appendChild(famCount);
    group.appendChild(head);

    for (const e of entries) group.appendChild(resultRow(e, onOpen));
    container.appendChild(group);
  }
}

function resultRow(entry: IndexedEntry, onOpen: (entry: IndexedEntry) => void): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'lib-row';
  row.addEventListener('click', () => onOpen(entry));

  const eco = document.createElement('span');
  eco.className = 'lib-row-eco';
  eco.textContent = entry.eco;
  row.appendChild(eco);

  const text = document.createElement('span');
  text.className = 'lib-row-text';
  const variation = document.createElement('span');
  variation.className = 'lib-row-variation';
  variation.textContent = variationOf(entry.name);
  text.appendChild(variation);
  const moves = document.createElement('span');
  moves.className = 'lib-row-moves';
  moves.textContent = formatSanLine(entry.moves);
  text.appendChild(moves);
  row.appendChild(text);

  return row;
}

// ── Visual mode: collapsible family tree ─────────────────────────────────────
//
// One node per family (Sicilian Defense, Ruy Lopez, …), in the dataset's order
// (so it matches the Stacked groups). Each family is collapsed by default and
// expands on tap into its variations — the same rows the Stacked list shows.
// Variation rows are filled lazily, only when their family is first opened, so
// a big family like the Sicilian (380+ lines) costs nothing until you ask.

function renderFamilyTree(
  container: HTMLElement,
  entries: IndexedEntry[],
  expanded: Set<string>,
  onOpen: (entry: IndexedEntry) => void,
): void {
  container.innerHTML = '';

  // Group by family, preserving dataset order (Map keeps insertion order).
  const groups = new Map<string, IndexedEntry[]>();
  for (const e of entries) {
    const fam = familyOf(e.name);
    if (!groups.has(fam)) groups.set(fam, []);
    groups.get(fam)!.push(e);
  }

  const count = document.createElement('p');
  count.className = 'lib-status';
  count.textContent = `${groups.size} families · ${entries.length} openings — tap a family to expand`;
  container.appendChild(count);

  for (const [family, fents] of groups) {
    const fam = document.createElement('div');
    fam.className = 'lib-fam';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'lib-fam-head';

    const chev = document.createElement('span');
    chev.className = 'lib-fam-chev';
    chev.setAttribute('aria-hidden', 'true');
    chev.appendChild(Icons.chevronRight(18));
    head.appendChild(chev);

    const name = document.createElement('span');
    name.className = 'lib-fam-name';
    name.textContent = family;
    head.appendChild(name);

    const cnt = document.createElement('span');
    cnt.className = 'lib-fam-count';
    cnt.textContent = `${fents.length}`;
    head.appendChild(cnt);

    const kids = document.createElement('div');
    kids.className = 'lib-fam-kids';
    kids.hidden = true;

    const setOpen = (open: boolean): void => {
      head.classList.toggle('lib-fam-head--open', open);
      head.setAttribute('aria-expanded', String(open));
      kids.hidden = !open;
      // Fill the variation rows the first time this family opens.
      if (open && !kids.childElementCount) {
        for (const e of fents) kids.appendChild(resultRow(e, onOpen));
      }
    };
    setOpen(expanded.has(family));

    head.addEventListener('click', () => {
      const open = !expanded.has(family);
      if (open) expanded.add(family); else expanded.delete(family);
      setOpen(open);
    });

    fam.appendChild(head);
    fam.appendChild(kids);
    container.appendChild(fam);
  }
}

// ── Detail view (board + step-through) ──────────────────────────────────────

function openDetail(
  entry: LibraryEntry,
  onOpenInBuilder: (ucis: string[], colour: 'white' | 'black') => void,
): void {
  // Replay the SAN sequence once: a FEN and last-move pair per ply (index 0 is
  // the start position), plus the UCI path used to seed the builder.
  const chess = new Chess();
  const fens: string[] = [START_FEN];
  const lastMoves: Array<[Key, Key] | undefined> = [undefined];
  const ucis: string[] = [];
  for (const san of entry.moves) {
    const m = chess.move(san);
    fens.push(chess.fen());
    lastMoves.push([m.from as Key, m.to as Key]);
    ucis.push(m.from + m.to + (m.promotion ?? ''));
  }

  let cursor = entry.moves.length; // start at the final position
  let orientation: 'white' | 'black' = 'white';

  const overlay = document.createElement('div');
  overlay.className = 'rmap-overlay lib-detail';

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
  back.setAttribute('aria-label', 'Back to library');
  back.appendChild(Icons.back(20));
  back.addEventListener('click', close);
  const titleEl = document.createElement('h2');
  titleEl.className = 'rmap-title';
  titleEl.textContent = entry.name;
  const ecoBadge = document.createElement('span');
  ecoBadge.className = 'rmap-title-count';
  ecoBadge.textContent = entry.eco;
  header.appendChild(back);
  header.appendChild(titleEl);
  header.appendChild(ecoBadge);
  overlay.appendChild(header);

  // Board.
  const boardWrap = document.createElement('div');
  boardWrap.className = 'lib-board-wrap';
  const boardEl = document.createElement('div');
  boardEl.className = 'lib-board';
  boardWrap.appendChild(boardEl);
  overlay.appendChild(boardWrap);

  const cg: CgApi = Chessground(boardEl, {
    fen: fens[cursor],
    orientation,
    viewOnly: true,
    coordinates: false,
    drawable: { enabled: false },
    animation: { enabled: true, duration: 180 },
    highlight: { lastMove: true, check: false },
    lastMove: lastMoves[cursor],
  });
  const ro = new ResizeObserver(() => cg.redrawAll());
  ro.observe(boardEl);

  // Move list (tappable; current ply highlighted).
  const moveList = document.createElement('div');
  moveList.className = 'lib-movelist';
  overlay.appendChild(moveList);

  // Step controls.
  const controls = document.createElement('div');
  controls.className = 'lib-controls';
  const firstBtn = navBtn('⏮', 'Start', () => setCursor(0));
  const prevBtn = navBtn('←', 'Previous move', () => setCursor(cursor - 1));
  const nextBtn = navBtn('→', 'Next move', () => setCursor(cursor + 1));
  const lastBtn = navBtn('⏭', 'End', () => setCursor(entry.moves.length));
  controls.append(firstBtn, prevBtn, nextBtn, lastBtn);
  overlay.appendChild(controls);

  // Open-in-builder action.
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'rmap-pos-open-btn lib-open-btn';
  openBtn.textContent = 'Open in builder';
  openBtn.addEventListener('click', () => {
    showDialog({
      title: 'Open in builder',
      body: 'Which side do you play? The board flips to your colour.',
      buttons: [
        { label: '○ White', variant: 'primary', onClick: () => { close(); onOpenInBuilder(ucis, 'white'); } },
        { label: '● Black', variant: 'primary', onClick: () => { close(); onOpenInBuilder(ucis, 'black'); } },
        { label: 'Cancel', variant: 'secondary' },
      ],
    });
  });
  overlay.appendChild(openBtn);

  document.body.appendChild(overlay);

  function setCursor(i: number): void {
    cursor = Math.max(0, Math.min(entry.moves.length, i));
    cg.set({ fen: fens[cursor], lastMove: lastMoves[cursor] });
    renderControls();
    renderMoveList();
  }

  function renderControls(): void {
    firstBtn.disabled = prevBtn.disabled = cursor === 0;
    lastBtn.disabled = nextBtn.disabled = cursor === entry.moves.length;
  }

  function renderMoveList(): void {
    moveList.innerHTML = '';
    if (entry.moves.length === 0) {
      const note = document.createElement('span');
      note.className = 'lib-movelist-empty';
      note.textContent = 'Starting position';
      moveList.appendChild(note);
      return;
    }
    for (let i = 0; i < entry.moves.length; i++) {
      if (i % 2 === 0) {
        const num = document.createElement('span');
        num.className = 'lib-move-num';
        num.textContent = `${i / 2 + 1}.`;
        moveList.appendChild(num);
      }
      const ply = i + 1; // cursor value that lands on this move
      const m = document.createElement('button');
      m.type = 'button';
      m.className = 'lib-move' + (cursor === ply ? ' lib-move--current' : '');
      m.textContent = entry.moves[i];
      m.addEventListener('click', () => setCursor(ply));
      moveList.appendChild(m);
    }
    // Keep the current move in view as you step.
    moveList.querySelector('.lib-move--current')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  renderControls();
  renderMoveList();
}

// ── Small helpers ───────────────────────────────────────────────────────────

function navBtn(label: string, aria: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'lib-nav-btn';
  b.setAttribute('aria-label', aria);
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// "1.e4 e5 2.Nf3 Nc6" from a flat SAN list.
function formatSanLine(sans: string[]): string {
  let out = '';
  for (let i = 0; i < sans.length; i++) {
    if (i % 2 === 0) out += `${i / 2 + 1}.${sans[i]} `;
    else out += `${sans[i]} `;
  }
  return out.trim();
}
