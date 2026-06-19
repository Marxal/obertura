// Master games explorer — a full-screen, playable board over the free Lichess
// masters opening explorer (FIDE-rated 2200+ OTB games, 1952–now: the closest
// free, no-auth source of "FIDE games"). Unlike the Library board explorer
// (library-explorer.ts), this is NOT gated behind the bundled book: from the very
// first move, every position shows the master continuations AND the real games
// played from here (players, ratings, result, year, link to lichess).
//
// It reuses the online data path (deeperMoves in explorer-api.ts) and the shared
// row rendering (explorer-rows.ts). Reached from the Explore tab's "Master games"
// launcher. Online-only by nature; any failure resolves to a soft message.

import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import type { Api as CgApi } from 'chessground/api';
import { Icons } from './icons';
import { showDialog } from './dialog';
import { pushBack } from './back-nav';
import { nameForPath } from './openings';
import { deeperMoves } from './explorer-api';
import { deeperRow, gameRow } from './explorer-rows';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function openMastersExplorer(
  onOpenInBuilder: (ucis: string[], colour: 'white' | 'black') => void,
): void {
  const chess = new Chess();
  let orientation: 'white' | 'black' = 'white';

  // The walked line, in lockstep with `chess`. fens/lastMoves are indexed by ply
  // (index 0 = start). `forward` holds moves stepped back out of, for redo.
  const ucis: string[] = [];
  const sans: string[] = [];
  const fens: string[] = [START_FEN];
  const lastMoves: Array<[Key, Key] | undefined> = [undefined];
  const forward: string[] = [];

  // Bumped on every renderList so a slow fetch that resolves after the user has
  // moved on can detect it's stale and discard its result.
  let listToken = 0;

  // ── Overlay scaffolding (mirrors openLibrary in library.ts) ──────────────────
  const overlay = document.createElement('div');
  overlay.className = 'rmap-overlay lib-overlay';

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    ro.disconnect();
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);

  const header = document.createElement('div');
  header.className = 'rmap-header';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'rmap-back';
  back.setAttribute('aria-label', 'Close master games');
  back.appendChild(Icons.back(20));
  back.addEventListener('click', close);
  const titleEl = document.createElement('h2');
  titleEl.className = 'rmap-title';
  titleEl.textContent = 'Master games';
  header.appendChild(back);
  header.appendChild(titleEl);
  overlay.appendChild(header);

  // The explorer panel reuses the Library board-explorer's look (.lib-explore).
  const root = document.createElement('div');
  root.className = 'lib-explore';
  overlay.appendChild(root);

  // Board.
  const boardWrap = document.createElement('div');
  boardWrap.className = 'bx-board-wrap';
  const boardEl = document.createElement('div');
  boardEl.className = 'bx-board';
  boardWrap.appendChild(boardEl);
  root.appendChild(boardWrap);

  const cg: CgApi = Chessground(boardEl, {
    fen: fens[fens.length - 1],
    orientation,
    turnColor: turnColor(),
    movable: { color: turnColor(), free: false, dests: legalDests() },
    draggable: { showGhost: true },
    animation: { enabled: true, duration: 180 },
    highlight: { lastMove: true, check: false },
    lastMove: lastMoves[lastMoves.length - 1],
    events: { move: onBoardMove },
  });
  const ro = new ResizeObserver(() => cg.redrawAll());
  ro.observe(boardEl);

  // Opening name for the live position.
  const openingEl = document.createElement('div');
  openingEl.className = 'bx-opening';
  root.appendChild(openingEl);

  // Continuation + games list.
  const list = document.createElement('div');
  list.className = 'bx-list';
  root.appendChild(list);

  // Step controls: flip / reset / back / forward.
  const controls = document.createElement('div');
  controls.className = 'bx-controls';
  const flipBtn = navBtn(Icons.flip(20), 'Flip', 'Flip board', () => {
    orientation = orientation === 'white' ? 'black' : 'white';
    cg.toggleOrientation();
  });
  const resetBtn = navBtn(Icons.reset(20), 'Reset', 'Back to start', reset);
  const backBtn = navBtn(Icons.back(20), 'Back', 'Step back', stepBack);
  const fwdBtn = navBtn(Icons.chevronRight(20), 'Forward', 'Step forward', stepForward);
  controls.append(flipBtn, resetBtn, backBtn, fwdBtn);
  root.appendChild(controls);

  // Open-in-builder action (same flow as the library explorer).
  const actBtn = document.createElement('button');
  actBtn.type = 'button';
  actBtn.className = 'rmap-pos-open-btn bx-action';
  actBtn.textContent = 'Open in builder';
  actBtn.addEventListener('click', () => {
    if (!ucis.length) return;
    showDialog({
      title: 'Open in builder',
      body: 'Which side do you play? The board flips to your colour.',
      buttons: [
        { label: '○ White', variant: 'primary', onClick: () => { close(); onOpenInBuilder([...ucis], 'white'); } },
        { label: '● Black', variant: 'primary', onClick: () => { close(); onOpenInBuilder([...ucis], 'black'); } },
        { label: 'Cancel', variant: 'secondary' },
      ],
    });
  });
  root.appendChild(actBtn);

  document.body.appendChild(overlay);
  render();

  // ── Move plumbing (mirrors library-explorer.ts) ──────────────────────────────

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

  function record(m: { from: string; to: string; san: string; promotion?: string }): void {
    ucis.push(m.from + m.to + (m.promotion ?? ''));
    sans.push(m.san);
    fens.push(chess.fen());
    lastMoves.push([m.from as Key, m.to as Key]);
  }

  function onBoardMove(from: Key, to: Key): void {
    const m = chess.move({ from, to, promotion: 'q' });
    if (m) { record(m); forward.length = 0; }
    render();
  }

  // Walk on by UCI (the explorer's SAN dialect isn't trusted — chess.js resolves
  // the move from the squares itself).
  function advanceUci(uci: string): void {
    const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
    if (m) { record(m); forward.length = 0; }
    render();
  }

  function stepBack(): void {
    if (!ucis.length) return;
    chess.undo();
    forward.push(sans.pop()!);
    ucis.pop();
    fens.pop();
    lastMoves.pop();
    render();
  }

  function stepForward(): void {
    const san = forward.pop();
    if (san) {
      const m = chess.move(san);
      if (m) record(m);
    }
    render();
  }

  function reset(): void {
    chess.reset();
    ucis.length = 0;
    sans.length = 0;
    fens.length = 1;
    lastMoves.length = 1;
    forward.length = 0;
    render();
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  function render(): void {
    cg.set({
      fen: chess.fen(),
      turnColor: turnColor(),
      movable: { color: turnColor(), free: false, dests: legalDests() },
      lastMove: lastMoves[lastMoves.length - 1],
    });

    openingEl.textContent = nameForPath(fens) ?? 'Starting position';

    resetBtn.disabled = backBtn.disabled = ucis.length === 0;
    fwdBtn.disabled = forward.length === 0;
    actBtn.disabled = ucis.length === 0;

    renderList();
  }

  // Ask the online explorer for this position's continuations and master games.
  // Resolves async; the token check drops the result if the user stepped away.
  function renderList(): void {
    list.innerHTML = '';
    const token = ++listToken;
    const fen = chess.fen();

    const status = document.createElement('div');
    status.className = 'bx-empty';
    status.textContent = 'Looking for master games…';
    list.appendChild(status);

    deeperMoves(fen).then(res => {
      if (token !== listToken) return; // the position changed under us
      list.innerHTML = '';

      if (!res.ok) {
        const msg = document.createElement('div');
        msg.className = 'bx-empty';
        msg.textContent = res.reason === 'rate-limited'
          ? 'Couldn’t load — Lichess is rate-limiting. Try again shortly.'
          : `Couldn’t load — offline or unavailable${res.detail ? ` (${res.detail})` : ''}.`;
        list.appendChild(msg);
        return;
      }

      if (!res.moves.length && !res.games.length) {
        const msg = document.createElement('div');
        msg.className = 'bx-empty';
        msg.textContent = 'No master games from this position.';
        list.appendChild(msg);
        return;
      }

      const ply = ucis.length;
      const num = Math.floor(ply / 2) + 1;
      const prefix = ply % 2 === 0 ? `${num}.` : `${num}…`;

      if (res.moves.length) {
        const head = document.createElement('div');
        head.className = 'lib-bx-deep-head';
        head.textContent = 'Continuations';
        list.appendChild(head);
        for (const mv of res.moves) list.appendChild(deeperRow(fen, mv, prefix, advanceUci));
      }

      if (res.games.length) {
        const ghead = document.createElement('div');
        ghead.className = 'lib-bx-deep-head';
        ghead.textContent = 'Master games';
        list.appendChild(ghead);
        for (const g of res.games) list.appendChild(gameRow(g));
      }
    });
  }
}

// A stacked icon-over-label step button, matching the board explorers' controls.
function navBtn(icon: SVGElement, label: string, aria: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'bx-nav-btn';
  b.setAttribute('aria-label', aria);
  b.appendChild(icon);
  const span = document.createElement('span');
  span.textContent = label;
  b.appendChild(span);
  b.addEventListener('click', onClick);
  return b;
}
