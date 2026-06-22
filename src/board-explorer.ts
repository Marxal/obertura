// Board browser (formerly "Line browser") — a chess.com-style opening explorer.
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
import { formatMove } from './notation';
import { getGamesSource } from './import-panel';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface BoardExplorerOptions {
  statsTree: StatNode;            // per-move stats keyed by uci path (their / my games)
  caption: string;               // 'their results' | 'your results' — the perspective
  colour: 'white' | 'black';     // the games' colour (drives "Prepare a reply")
  // Board orientation. Defaults to `colour`. Opponent browsers pass MY answering
  // side here (the opposite of the opponent's colour) so I study the line from
  // the seat I'll actually play it from.
  orientation?: 'white' | 'black';
  // Player strips around the board (opponent on top, "You" on the bottom) so the
  // perspective reads at a glance. Pass `{}` (no opponent) for your-own-games
  // browsers — the top strip then shows a generic "Opponent".
  players?: { opponent?: { name: string; avatarUrl?: string } };
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
  // supplied (e.g. the standalone Board browser) so the bottom bar can still
  // offer "Open in builder" with the walked move path and colour.
  onOpenInBuilder?: (ucis: string[], colour: 'white' | 'black') => void;
  // White/Black toggle — when set, a segmented control sits under the header.
  // The browser reads one colour's games at a time; picking the other colour
  // closes this browser and reopens it for that colour (so the caller rebuilds
  // the colour-specific stats tree). Mirrors the repertoire map's colour toggle.
  colourToggle?: {
    current: 'white' | 'black';
    enabled: { white: boolean; black: boolean };
    onPick: (colour: 'white' | 'black') => void;
  };
  // Source toggle — a discrete "Games / Repertoire" segmented control sitting
  // next to the colour toggle. Picking the other source closes this browser and
  // reopens it with the other stats tree (the caller rebuilds it). Mirrors the
  // colour toggle's close-then-reopen contract.
  sourceToggle?: {
    current: 'games' | 'repertoire';
    enabled: { games: boolean; repertoire: boolean };
    onPick: (source: 'games' | 'repertoire') => void;
  };
}

export function openBoardExplorer(opts: BoardExplorerOptions): void {
  const chess = new Chess();
  const orientation = opts.orientation ?? opts.colour;

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
  back.setAttribute('aria-label', 'Close board browser');
  back.appendChild(Icons.back(20));
  back.addEventListener('click', close);
  const titleEl = document.createElement('h2');
  titleEl.className = 'rmap-title';
  titleEl.textContent = opts.title ?? 'Board browser';
  const badge = document.createElement('span');
  badge.className = 'rmap-title-count';
  // Set live by renderList() to the games reaching the current position.
  badge.textContent = 'games 0';
  header.append(back, titleEl, badge);
  overlay.appendChild(header);

  // White/Black toggle (under the header) — when the caller wired it. Picking
  // the other side closes this browser; the caller reopens it for that colour.
  // A discrete Games/Repertoire source toggle rides alongside it on the same row.
  if (opts.colourToggle || opts.sourceToggle) {
    overlay.appendChild(buildTopToggles(opts, close));
  }

  // Player strips (opponent on top, "You" on the bottom) bracket the board so
  // the perspective is unmistakable — the board is oriented to MY side.
  if (opts.players) {
    overlay.appendChild(playerStrip(opts.players.opponent));
  }

  // Board.
  const boardWrap = document.createElement('div');
  boardWrap.className = 'bx-board-wrap';
  const boardEl = document.createElement('div');
  boardEl.className = 'bx-board';
  boardWrap.appendChild(boardEl);
  overlay.appendChild(boardWrap);

  if (opts.players) {
    overlay.appendChild(playerStrip('you'));
  }

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
    primaryBtn = navBtn(Icons.reply(20), act.label, act.label, () => {
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
    primaryBtn = navBtn(Icons.reply(20), 'Open in builder', 'Open in builder', () => {
      seed([...ucis], opts.colour);
      close();
    });
  }
  // The primary action stands out in brass — it's the one button that leaves the
  // browser for the builder.
  if (primaryBtn) primaryBtn.classList.add('bx-nav-btn--accent');

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
    // Badge shows the games reaching THIS position (total at the start, fewer as
    // the line narrows, 0 once off the games tree).
    badge.textContent = `games ${node?.games ?? 0}`;
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
      move.textContent = `${prefix} ${formatMove(c.san)}`;
      row.appendChild(move);

      row.appendChild(wdlScoreRow(
        { wins: c.wins, draws: c.draws, losses: c.losses, scorePct: statScorePct(c), games: c.games },
        `${c.games}`,
      ));

      list.appendChild(row);
    }
  }
}

// The top toggle row: a prominent White/Black segment plus, when wired, a
// discrete Games/Repertoire source segment. Both reuse the map's look. Picking
// a different option closes this browser first (keeping the back stack
// balanced), then hands off to the caller's onPick, which reopens it.
function buildTopToggles(opts: BoardExplorerOptions, close: () => void): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'rmap-colour-toggle';

  if (opts.colourToggle) {
    const t = opts.colourToggle;
    bar.appendChild(buildSeg(
      [{ id: 'white', label: '○ White' }, { id: 'black', label: '● Black' }],
      t.current, t.enabled, close, t.onPick,
    ));
  }
  if (opts.sourceToggle) {
    const t = opts.sourceToggle;
    bar.appendChild(buildSeg(
      [{ id: 'games', label: 'Games' }, { id: 'repertoire', label: 'Repertoire' }],
      t.current, t.enabled, close, t.onPick, 'rmap-source-seg',
    ));
  }
  return bar;
}

// A generic segmented control (reused for both the colour and source toggles).
function buildSeg<T extends string>(
  options: { id: T; label: string }[],
  current: T,
  enabled: Record<T, boolean>,
  close: () => void,
  onPick: (id: T) => void,
  extraClass?: string,
): HTMLElement {
  const seg = document.createElement('div');
  seg.className = 'rmap-view-seg' + (extraClass ? ` ${extraClass}` : '');
  seg.setAttribute('role', 'group');
  for (const o of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rmap-view-btn';
    b.textContent = o.label;
    const on = o.id === current;
    b.classList.toggle('rmap-view-btn--on', on);
    b.setAttribute('aria-pressed', String(on));
    if (!enabled[o.id]) {
      b.disabled = true;
    } else if (!on) {
      b.addEventListener('click', () => { close(); onPick(o.id); });
    }
    seg.appendChild(b);
  }
  return seg;
}

// Name the platform from a game URL, for the external-link label.
export function platformLabel(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('lichess.org')) return 'Lichess';
  if (u.includes('chess.com')) return 'Chess.com';
  return 'the original site';
}

// A compact player strip that brackets the board. Pass the opponent (avatar +
// name) for the top strip, or 'you' for the near strip. A missing/absent
// opponent shows a generic user icon + "Opponent", so the perspective still
// reads even with no one scouted.
function playerStrip(who: { name: string; avatarUrl?: string } | undefined | 'you'): HTMLElement {
  const strip = document.createElement('div');
  strip.className = 'bx-player' + (who === 'you' ? ' bx-player--you' : '');

  const isYou = who === 'you';
  // For "you", read your connected identity: the handle for either platform,
  // your picture for Chess.com (Lichess has none → generic icon).
  const me = isYou ? getGamesSource() : null;
  const name = isYou ? (me?.username ? `@${me.username}` : 'You') : (who?.name ?? 'Opponent');
  const avatarUrl = isYou ? me?.avatarUrl : who?.avatarUrl;

  strip.appendChild(playerAvatar(avatarUrl, 22));
  const label = document.createElement('span');
  label.className = 'bx-player-name';
  label.textContent = name;
  strip.appendChild(label);
  return strip;
}

// A small round avatar: the player's picture when we have one, otherwise the
// fallback user icon (mirrors explore-screen's buildAvatar, kept local here).
function playerAvatar(url: string | undefined, size: number): HTMLElement {
  if (url) {
    const img = document.createElement('img');
    img.className = 'bx-player-avatar';
    img.src = url;
    img.alt = '';
    img.width = size;
    img.height = size;
    img.loading = 'lazy';
    img.addEventListener('error', () => img.replaceWith(playerAvatarIcon(size)));
    return img;
  }
  return playerAvatarIcon(size);
}

function playerAvatarIcon(size: number): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'bx-player-avatar bx-player-avatar--icon';
  wrap.style.width = `${size}px`;
  wrap.style.height = `${size}px`;
  wrap.appendChild(Icons.userCircle(Math.round(size * 0.7)));
  return wrap;
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
