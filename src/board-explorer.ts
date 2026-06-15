// Line browser (board explorer) — a chess.com-style opening explorer.
//
// A full, playable board (in the app's board style) plus, for the current
// position, the opening name and a ranked list of the moves played from here in
// the underlying games, each with its game count and a win/draw/loss bar. You
// walk the line by playing on the board, tapping a reply, or stepping with the
// bottom controls (open in builder / reset / back / forward).
//
// It's purely a reader over a pre-built stats tree (the opponent's games, or
// your own), so it carries no persistence of its own — opened from a map, it
// hands any "open in builder / prepare" action straight back to that map.

import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import type { Api as CgApi } from 'chessground/api';
import { Icons } from './icons';
import { pushBack } from './back-nav';
import { type StatNode, statAt, statScorePct, gameAtPath } from './move-stats';
import { wdlScoreRow } from './wdl-bar';
import { nameForPath } from './openings';
import type { NodeActionContext } from './repertoire-map';
import type { ImportedGame } from './import-core';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface BoardExplorerOptions {
  statsTree: StatNode;            // per-move stats keyed by uci path (their / my games)
  caption: string;               // 'their results' | 'your results' — the perspective
  colour: 'white' | 'black';     // initial board orientation
  // The games behind the stats tree (same perspective). When the walked path
  // pins down exactly one of them, we offer a "See full game" external link.
  games?: ImportedGame[];
  startUcis?: string[];          // open at this position (e.g. the selected map node)
  title?: string;                // header title
  action?: {                     // optional "open in builder / prepare" action
    label: string;
    disabled?: boolean;
    onAct?: (ctx: NodeActionContext) => void;
  };
  // Builder-seed fallback for the primary control. Used when no `action` is
  // supplied (e.g. the repertoire map's Line browser) so the bottom bar can
  // still offer "Open in builder" with the walked move path and colour.
  onOpenInBuilder?: (ucis: string[], colour: 'white' | 'black') => void;
}

export function openBoardExplorer(opts: BoardExplorerOptions): void {
  const chess = new Chess();
  const orientation = opts.colour;

  // The walked line, kept in lockstep with `chess`. fens/lastMoves are indexed by
  // ply (index 0 = the start), so fens[ucis.length] is always the live position.
  const ucis: string[] = [];
  const sans: string[] = [];
  const fens: string[] = [START_FEN];
  const lastMoves: Array<[Key, Key] | undefined> = [undefined];
  // Moves stepped back out of, ready to replay on "forward".
  const forward: Array<{ uci: string; san: string }> = [];

  // Seed at the requested position (a bad uci just stops the seeding early).
  for (const u of opts.startUcis ?? []) {
    if (!playUci(u)) break;
  }

  // ── Overlay scaffolding (shares the map overlay's chrome) ───────────────────
  const overlay = document.createElement('div');
  overlay.className = 'rmap-overlay bx-overlay';

  function close(): void {
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
  back.setAttribute('aria-label', 'Close line browser');
  back.appendChild(Icons.back(20));
  back.addEventListener('click', close);
  const titleEl = document.createElement('h2');
  titleEl.className = 'rmap-title';
  titleEl.textContent = opts.title ?? 'Line browser';
  const badge = document.createElement('span');
  badge.className = 'rmap-title-count';
  badge.textContent = opts.caption;
  header.append(back, titleEl, badge);
  overlay.appendChild(header);

  // Board.
  const boardWrap = document.createElement('div');
  boardWrap.className = 'bx-board-wrap';
  const boardEl = document.createElement('div');
  boardEl.className = 'bx-board';
  boardWrap.appendChild(boardEl);
  overlay.appendChild(boardWrap);

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

  // Opening name.
  const openingEl = document.createElement('div');
  openingEl.className = 'bx-opening';
  overlay.appendChild(openingEl);

  // "See full game" — a discrete external link shown only when the walked line
  // resolves to one identifiable stored game (see gameAtPath). Opens that game's
  // original page on its platform in a new tab; hidden for aggregate positions.
  const fullGame = document.createElement('a');
  fullGame.className = 'bx-full-game';
  fullGame.target = '_blank';
  fullGame.rel = 'noopener noreferrer';
  fullGame.hidden = true;
  overlay.appendChild(fullGame);

  // Reply list.
  const list = document.createElement('div');
  list.className = 'bx-list';
  overlay.appendChild(list);

  // Step controls: open in builder / reset / back / forward.
  const controls = document.createElement('div');
  controls.className = 'bx-controls';

  // Primary control (where "Flip board" used to live): hand the walked line back
  // to the builder. Prefer the caller's contextual action (e.g. an opponent
  // map's "Prepare a reply"); otherwise fall back to the plain builder-seed path.
  let primaryBtn: HTMLButtonElement | null = null;
  if (opts.action) {
    const act = opts.action;
    primaryBtn = navBtn(Icons.build(20), act.label, act.label, () => {
      if (act.disabled) return;
      act.onAct?.({
        fen: chess.fen(),
        san: sans[sans.length - 1] ?? '',
        ucis: [...ucis],
        sans: [...sans],
        colour: opts.colour,
      });
      close();
    });
    primaryBtn.disabled = !!act.disabled;
  } else if (opts.onOpenInBuilder) {
    const seed = opts.onOpenInBuilder;
    primaryBtn = navBtn(Icons.build(20), 'Open in builder', 'Open in builder', () => {
      seed([...ucis], opts.colour);
      close();
    });
  }

  const resetBtn = navBtn(Icons.reset(20), 'Reset', 'Back to start', reset);
  const backBtn = navBtn(Icons.back(20), 'Back', 'Step back', stepBack);
  const fwdBtn = navBtn(Icons.chevronRight(20), 'Forward', 'Step forward', stepForward);
  if (primaryBtn) controls.append(primaryBtn);
  controls.append(resetBtn, backBtn, fwdBtn);
  overlay.appendChild(controls);

  document.body.appendChild(overlay);
  render();

  // ── Move plumbing ───────────────────────────────────────────────────────────

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

  // Apply one move (by uci or san), recording it in the walked line. Returns
  // false if the move was illegal from the current position.
  function playUci(u: string): boolean {
    const m = chess.move({
      from: u.slice(0, 2),
      to: u.slice(2, 4),
      promotion: (u[4] as 'q' | 'r' | 'b' | 'n') || 'q',
    });
    return m ? record(m) : false;
  }
  function playSan(san: string): boolean {
    const m = chess.move(san);
    return m ? record(m) : false;
  }
  function record(m: { from: string; to: string; san: string; promotion?: string }): boolean {
    ucis.push(m.from + m.to + (m.promotion ?? ''));
    sans.push(m.san);
    fens.push(chess.fen());
    lastMoves.push([m.from as Key, m.to as Key]);
    return true;
  }

  function onBoardMove(from: Key, to: Key): void {
    // chessground only offers legal dests, so this resolves; auto-queen on promo.
    if (playUci(from + to)) forward.length = 0;
    render();
  }

  function advance(san: string): void {
    if (playSan(san)) forward.length = 0;
    render();
  }

  function stepBack(): void {
    if (!ucis.length) return;
    chess.undo();
    forward.push({ uci: ucis.pop()!, san: sans.pop()! });
    fens.pop();
    lastMoves.pop();
    render();
  }

  function stepForward(): void {
    const mv = forward.pop();
    if (mv) playSan(mv.san);
    render();
  }

  function reset(): void {
    chess.reset();
    ucis.length = 0;
    sans.length = 0;
    fens.length = 1;        // keep START_FEN
    lastMoves.length = 1;   // keep the leading undefined
    forward.length = 0;
    render();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  function render(): void {
    cg.set({
      fen: chess.fen(),
      turnColor: turnColor(),
      movable: { color: turnColor(), free: false, dests: legalDests() },
      lastMove: lastMoves[lastMoves.length - 1],
    });

    const name = nameForPath(fens);
    openingEl.textContent = name ?? '—';

    renderFullGameLink();

    resetBtn.disabled = backBtn.disabled = ucis.length === 0;
    fwdBtn.disabled = forward.length === 0;

    renderList();
  }

  // Show "See full game ↗" only when this exact position belongs to one stored
  // game (and we were handed the games to check against). Otherwise stay hidden.
  function renderFullGameLink(): void {
    const game = opts.games ? gameAtPath(opts.games, opts.colour, ucis) : null;
    if (!game || !game.url) {
      fullGame.hidden = true;
      fullGame.removeAttribute('href');
      return;
    }
    fullGame.href = game.url;
    fullGame.textContent = `See full game on ${platformLabel(game.url)} ↗`;
    fullGame.hidden = false;
  }

  function renderList(): void {
    list.innerHTML = '';
    const node = statAt(opts.statsTree, ucis);
    const replies = node ? [...node.children.values()] : [];
    replies.sort((a, b) => b.games - a.games || a.san.localeCompare(b.san));

    if (!replies.length) {
      const empty = document.createElement('div');
      empty.className = 'bx-empty';
      empty.textContent = 'No games continue from here.';
      list.appendChild(empty);
      return;
    }

    // Every reply shares the current ply's move number/prefix.
    const ply = ucis.length;
    const num = Math.floor(ply / 2) + 1;
    const prefix = ply % 2 === 0 ? `${num}.` : `${num}…`;

    for (const c of replies) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bx-row';
      row.addEventListener('click', () => advance(c.san));

      const move = document.createElement('span');
      move.className = 'bx-move';
      move.textContent = `${prefix} ${c.san}`;
      row.appendChild(move);

      row.appendChild(wdlScoreRow(
        { wins: c.wins, draws: c.draws, losses: c.losses, scorePct: statScorePct(c), games: c.games },
        `${c.games}`,
      ));

      list.appendChild(row);
    }
  }
}

// Name the platform from a game URL, for the external-link label.
function platformLabel(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('lichess.org')) return 'Lichess';
  if (u.includes('chess.com')) return 'Chess.com';
  return 'the original site';
}

// A stacked icon-over-label step button for the bottom control bar.
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
