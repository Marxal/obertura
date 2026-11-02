// The live boards on Home: a position you can answer, and a line built right there.
//
// TWO BOARDS, ONE COMPONENT. "Add a missing reply" fills holes in your lines and
// "Extend a line you know" goes past the end of a mastered one. Same action, different
// errand, so they are separate blocks that never hide each other.
//
// THE BOX SHOWS WHENEVER THERE IS SOMETHING TO DO, AND AT ONCE. Last visit's top cards
// are drawn straight away (next-reply-cache.ts) while the fresh ranking runs. When it
// arrives it only decides what comes next: the position you're looking at stays, unless
// you haven't touched it and it no longer needs an answer.
//
// A LINE ENDS ON YOUR MOVE. With Auto-reply on, the board answers each move with the
// usual reply so a line can grow here, the middle ground between one move and the
// builder. It pauses after YOUR move to ask: save, keep going, or the builder. When it
// asks depends on the line and on you (usualLineMoves), and it asks early if the known
// replies run out, before leaving it to the engine. A reply you haven't answered is dimmed,
// because Save won't keep it. "Change reply" swaps any reply for one you choose. With
// Auto-reply off you play both sides, as in the builder.
//
// ONE CARD EACH, NOT A CAROUSEL. A swipe track and a board you can play on fight over
// the same finger. "Another position" is the browsing, and swiping the box does the same
// until you've played a move on it (reply-card-swipe.ts).
//
// THE BOARD MUSTN'T TRAP THE PAGE, OR PLAY A MOVE ON THE WAY PAST. See
// reply-board-touch.ts. In short: on a phone a swipe always scrolls, and a piece
// moves by tapping it and then its square.
//
// NO SENTENCES THAT EXPLAIN THE OBVIOUS. The title says what to do and the board shows
// where. Everything else here is a fact about this position.

import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { formatMove } from './notation';
import { lineFigures } from './line-status';
import { buildStatRow } from './position-peek';
import { showToast } from './toast';
import { Icons } from './icons';
import { FREE_TRAINING_LINES } from './entitlement';
import { nameForPath } from './openings';
import { positionKey } from './position-index';
import { MIN_SCOUT_GAMES } from './coverage-gaps';
import {
  answerStats, usualLineMoves, usualReply, points,
  ASK_EVERY_MOVES,
  type NextReplyCard, type ReplyBasis, type UsualReply,
} from './next-reply';
import {
  saveReply, undoReply, type NextReplyLoad, type Ply, type SavedReply,
} from './next-reply-data';
import { restPosition, restedPositions } from './next-reply-log';
import {
  cacheCards, cacheCoverage, cachedCards, cachedCoverage,
} from './next-reply-cache';
import { guardBoardTouches } from './reply-board-touch';
import { attachCardSwipe, type UnderCard } from './reply-card-swipe';
import { buildCoverageMeter, type CoverageMeter } from './reply-coverage-meter';
import { factHeading, factList, meterRow, resultRow, valueRow } from './reply-facts';
import { agoText, summariseFaced, timesText } from './reply-games';
import { openFacedGames } from './reply-games-sheet';
import { buildLineStrip } from './reply-line-strip';
import { buildSuggest, evalText } from './reply-suggest';
import type { ImportedGame } from './import-core';
import type { GrowTarget } from './grow-line';
import type { StatsAt } from './rare-branch';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Long enough to see your own move land before theirs arrives. */
const REPLY_PAUSE_MS = 350;
const ENGINE_REPLY_MS = 700;
const ENGINE_EVAL_MS = 800;
const ENGINE_DEPTH = 12;
/** The engine shares a queue with the background scan, so it may have to wait. */
const ENGINE_GIVE_UP_MS = 8000;
const RETRY_MS = 4000;
const RETRIES = 3;

export interface NextReplyDeps {
  load: () => Promise<NextReplyLoad>;
  /** Open the builder with these moves on the board. */
  onOpenBuilder: (ucis: string[], colour: 'white' | 'black', opponentName?: string) => void;
  /** Open the builder's Grow tab on a mastered line. */
  onGrow: (target: GrowTarget) => void;
  /** Open a game in the analyser, at this position. */
  onOpenGame: (game: ImportedGame, atFen: string) => void;
}

export type ReplyBoardKind = 'reply' | 'extend';

const BOARD: Record<ReplyBoardKind, { title: string; done: string | null }> = {
  reply: { title: 'Add a missing reply', done: 'That’s all for now.' },
  // Nothing to say when it runs out: the block just leaves until you master another.
  extend: { title: 'Extend a line you know', done: null },
};

// ── Getting the box on screen ────────────────────────────────────────────────

function renderWaiting(host: HTMLElement, kind: ReplyBoardKind): void {
  const section = panel(BOARD[kind].title);
  const board = document.createElement('div');
  board.className = 'forgotten-board nr-board nr-board--waiting';
  section.appendChild(board);
  host.replaceChildren(section);
}

/** What a kept card has to work with until the fresh data arrives. */
function emptyLoad(): NextReplyLoad {
  return {
    cards: [],
    extend: [],
    statsAt: () => null,
    faced: { white: new Map(), black: new Map() },
    scouts: { white: new Map(), black: new Map() },
    answered: { white: new Set(), black: new Set() },
    lines: [],
    degraded: false,
  };
}

// One card per board. A new Home render replaces the old one, and the old board's
// document listeners have to go with it.
const teardowns = new Map<ReplyBoardKind, () => void>();

export function mountReplyBoard(host: HTMLElement, deps: NextReplyDeps, kind: ReplyBoardKind): void {
  teardowns.get(kind)?.();
  teardowns.delete(kind);

  let stopped = false;
  let timer = 0;
  let queue: ReplyQueue | null = null;
  teardowns.set(kind, () => {
    stopped = true;
    window.clearTimeout(timer);
    queue?.destroy();
  });

  // Draw what we kept from last time, or at least hold the place. Resting ones wait.
  const kept = cachedCards(kind);
  const rested = restedPositions();
  const now = Date.now();
  const awake = kept?.filter(c => (rested[c.id] ?? 0) <= now) ?? [];
  let drawn = false;
  if (awake.length > 0) {
    try {
      queue = showQueue(host, awake, null, deps, kind);
      drawn = true;
    } catch (err) {
      console.error('[next-reply] kept cards could not be drawn', err);
    }
  }
  if (!drawn && (kept === null ? kind === 'reply' : kept.length > 0)) renderWaiting(host, kind);

  const attempt = (triesLeft: number): void => {
    const again = (): boolean => {
      if (triesLeft <= 0) return false;
      timer = window.setTimeout(() => attempt(triesLeft - 1), RETRY_MS);
      return true;
    };
    void deps.load()
      .then((load) => {
        if (stopped || !host.isConnected) return;
        const cards = kind === 'reply' ? load.cards : load.extend;
        // Couldn't read the statistics, and nothing to show without them: try again.
        if (load.degraded && cards.length === 0 && again()) return;
        if (queue) queue.accept(load, cards);
        else if (cards.length > 0) queue = showQueue(host, cards, load, deps, kind);
        else host.replaceChildren();
        if (!load.degraded && cards.length === 0) cacheCards(kind, []);
      })
      .catch((err) => {
        console.error('[next-reply] load failed', err);
        if (stopped || again()) return;
        if (!queue && host.isConnected) host.replaceChildren();
      });
  };
  // After this frame, so Home is on screen before the work begins.
  timer = window.setTimeout(() => attempt(RETRIES), 30);
}

interface ReplyQueue {
  /** The fresh ranking has arrived. */
  accept: (load: NextReplyLoad, cards: NextReplyCard[]) => void;
  destroy: () => void;
}

/** What a card reads from, swapped from under it when the fresh data arrives. */
interface CardContext {
  load: NextReplyLoad;
  /** Resolves when `load` is the real thing, not the empty stand-in. */
  ready: Promise<void>;
}

function showQueue(
  host: HTMLElement,
  cards: NextReplyCard[],
  load: NextReplyLoad | null,
  deps: NextReplyDeps,
  kind: ReplyBoardKind,
): ReplyQueue {
  let queue = [...cards];
  let visible: DrawnCard | null = null;
  let markReady: () => void = () => {};
  const ctx: CardContext = {
    load: load ?? emptyLoad(),
    ready: load ? Promise.resolve() : new Promise((resolve) => { markReady = resolve; }),
  };
  let real = !!load;

  const meter = kind === 'reply' ? buildCoverageMeter(cachedCoverage(), cacheCoverage) : null;
  if (load) meter?.setStats(load.statsAt);

  const keep = (): void => {
    // Only a real ranking is worth keeping: otherwise a kept card would just keep itself.
    if (real) cacheCards(kind, queue);
  };

  const next = (): void => {
    visible?.destroy();
    visible = null;
    // One bad card must not cost the whole box.
    while (queue[0]) {
      try {
        visible = renderCard(
          host, queue[0], ctx, deps, actions, BOARD[kind].title, meter, () => queue[1] ?? null,
        );
        keep();
        return;
      } catch (err) {
        console.error('[next-reply] card could not be drawn', queue[0].id, err);
        queue = queue.slice(1);
      }
    }
    keep();
    renderDone(host, kind, meter);
  };

  const actions: CardActions = {
    skip(card) {
      restPosition(card.id);
      // To the back, not out: swiping can go round and round.
      queue = [...queue.filter(c => c !== card), card];
      next();
    },
    drop(card) {
      queue = queue.filter(c => c !== card);
      next();
    },
    saved(card, saved) {
      queue = queue.filter(c => c !== card);
      next();
      meter?.refresh();
      showToast(
        saved?.paused
          ? `Line saved, paused: all ${FREE_TRAINING_LINES} free training slots are in use.`
          : 'Line saved',
        {
          variant: 'success',
          ...(saved ? {
            action: {
              label: 'Undo',
              onClick: () => {
                void undoReply(saved).then(() => {
                  if (!host.isConnected) return;
                  queue = [card, ...queue];
                  next();
                  meter?.refresh();
                });
              },
            },
          } : {}),
        },
      );
    },
  };
  next();

  return {
    accept(fresh, freshCards) {
      ctx.load = fresh;
      real = true;
      markReady();
      meter?.setStats(fresh.statsAt);
      const showing = visible?.card ?? null;
      const stillWanted = showing ? freshCards.find(c => c.id === showing.id) : undefined;
      if (showing && stillWanted) {
        // The same position, now with everything the kept copy left out.
        Object.assign(showing, stillWanted);
        queue = [showing, ...freshCards.filter(c => c.id !== showing.id)];
        visible!.refresh();
        keep();
      } else if (showing && visible!.touched()) {
        // Answered elsewhere, but you're mid-line: never pull a board from under you.
        queue = [showing, ...freshCards];
        visible!.refresh();
      } else {
        queue = [...freshCards];
        next();
      }
    },
    destroy() {
      visible?.destroy();
    },
  };
}

interface CardActions {
  skip: (card: NextReplyCard) => void;
  drop: (card: NextReplyCard) => void;
  saved: (card: NextReplyCard, saved: SavedReply | null) => void;
}

interface DrawnCard {
  card: NextReplyCard;
  destroy: () => void;
  /** The data under it has changed. */
  refresh: () => void;
  /** Has a move been played on it? */
  touched: () => boolean;
}

/**
 * The next position, showing underneath while a box is dragged away.
 *
 * Its board sits exactly where this one's is, so when the top card has gone and the real
 * one is drawn, nothing moves. It's a picture: no moves, buttons or facts.
 */
function buildUnderCard(
  host: HTMLElement,
  section: HTMLElement,
  boardEl: HTMLElement,
  coming: NextReplyCard,
  title: string,
): UnderCard {
  const under = panel(title);
  under.classList.add('nr-under');
  under.setAttribute('aria-hidden', 'true');
  const box = boardEl.getBoundingClientRect();
  const frame = section.getBoundingClientRect();
  const boardCopy = document.createElement('div');
  boardCopy.className = 'cg-wrap nr-under-board';
  boardCopy.style.top = `${boardEl.offsetTop}px`;
  boardCopy.style.left = `${box.left - frame.left}px`;
  boardCopy.style.width = `${box.width}px`;
  boardCopy.style.height = `${box.height}px`;
  under.appendChild(boardCopy);
  host.appendChild(under);
  const uci = coming.ucis[coming.ucis.length - 1];
  const cg = Chessground(boardCopy, {
    fen: coming.fen,
    orientation: coming.colour,
    viewOnly: true,
    coordinates: false,
    lastMove: uci ? squares(uci) : undefined,
    animation: { enabled: false },
    drawable: { enabled: false, visible: false },
  });
  return {
    progress(share) {
      under.style.opacity = String(0.55 + 0.45 * share);
      under.style.transform = `scale(${0.96 + 0.04 * share})`;
    },
    remove() {
      cg.destroy();
      under.remove();
    },
  };
}

function renderDone(host: HTMLElement, kind: ReplyBoardKind, meter: CoverageMeter | null): void {
  const { title, done } = BOARD[kind];
  if (!done) {
    host.replaceChildren();
    return;
  }
  const section = panel(title);
  if (meter) section.appendChild(meter.el);
  section.appendChild(paragraph('nr-note', done));
  host.replaceChildren(section);
}

function panel(title: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'fmove-block home-panel nr-panel';
  const head = document.createElement('div');
  head.className = 'fmove-block-head';
  const label = document.createElement('h2');
  label.className = 'fmove-block-title';
  label.textContent = title;
  head.appendChild(label);
  section.appendChild(head);
  return section;
}

function paragraph(className: string, text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

function button(
  label: string, className: string, onClick: () => void, icon?: SVGElement,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  if (icon) b.appendChild(icon);
  b.append(label);
  b.addEventListener('click', onClick);
  return b;
}

function replay(card: NextReplyCard): Ply[] {
  const chess = new Chess();
  return card.ucis.map((uci, i) => {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] as 'q') || undefined });
    return { san: card.sans[i], uci, fen: chess.fen() };
  });
}

function squares(uci: string): [Key, Key] {
  return [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key];
}

function moveLabel(index: number, san: string): string {
  return `${Math.floor(index / 2) + 1}${index % 2 === 0 ? '.' : '...'}${formatMove(san)}`;
}

async function engineReply(fen: string): Promise<UsualReply | null> {
  try {
    const { analysePosition } = await import('./engine');
    const moves = await Promise.race([
      analysePosition(fen, ENGINE_DEPTH, undefined, { multiPv: 1, movetimeMs: ENGINE_REPLY_MS }),
      new Promise<never[]>(resolve => { window.setTimeout(() => resolve([]), ENGINE_GIVE_UP_MS); }),
    ]);
    const top = moves[0];
    return top ? { uci: top.uci, san: top.san, basis: 'engine' } : null;
  } catch {
    return null;
  }
}

// Open or closed stays as you left it, from one card to the next.
let detailsOpen = false;

const AUTO_KEY = 'obertura.replyAuto';

function autoReplyOn(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== 'off';
  } catch {
    return true;
  }
}

function setAutoReply(on: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, on ? 'on' : 'off');
  } catch {
    /* Then it just lasts until the next card. */
  }
}

/** Why the board stopped replying. */
type Stop = 'joined' | 'over' | 'no-reply' | null;

/** Draws one card and returns how to take its board down. */
function renderCard(
  host: HTMLElement,
  card: NextReplyCard,
  ctx: CardContext,
  deps: NextReplyDeps,
  actions: CardActions,
  title: string,
  meter: CoverageMeter | null,
  nextCard: () => NextReplyCard | null,
): DrawnCard {
  const stats = (): StatsAt => ctx.load.statsAt;
  const path = replay(card);
  const base = path.length;
  const mineIsEven = card.colour === 'white';
  const isMine = (index: number): boolean => (index % 2 === 0) === mineIsEven;

  /**
   * The length of the line, in half-moves, at which auto-reply next pauses to ask. You
   * have always played a few yourself first. Worked out when asked, since a kept card is
   * drawn before your lines have been read.
   */
  const firstAsk = (): number => Math.max(
    usualLineMoves(ctx.load.lines, card) * 2 - (mineIsEven ? 1 : 0),
    base + ASK_EVERY_MOVES * 2 - 1,
  );
  let keptGoingUntil = 0;
  const askAt = (): number => keptGoingUntil || firstAsk();

  const chess = new Chess(card.fen);
  const myTurn = mineIsEven ? 'w' : 'b';

  let at = path.length;
  let auto = autoReplyOn();
  let thinking = false;
  let engineThinking = false;
  let asking = false;
  let choosing = false;
  let engineWelcome = false;
  let stop: Stop = null;
  let token = 0;
  const bases = new Map<number, ReplyBasis>();
  const evals = new Map<string, string>();

  const lastMine = (): number => {
    for (let i = path.length - 1; i >= base; i--) if (isMine(i)) return i;
    return -1;
  };
  const canPlay = (): boolean => {
    if (at !== path.length || thinking || asking || stop) return false;
    return !auto || choosing || chess.turn() === myTurn;
  };

  const section = panel(title);
  section.querySelector('.fmove-block-head')!.appendChild(
    button('Another position', 'btn-quiet nr-another', () => actions.skip(card), Icons.shuffle(15)),
  );
  if (meter) section.appendChild(meter.el);

  const boardEl = document.createElement('div');
  boardEl.className = 'forgotten-board cg-wrap nr-board';
  section.appendChild(boardEl);

  const strip = buildLineStrip(i => showAt(i));
  section.appendChild(strip.el);

  const openingEl = paragraph('nr-opening', '');
  section.appendChild(openingEl);

  const saveRow = document.createElement('div');
  saveRow.className = 'nr-actions';
  saveRow.hidden = true;
  section.appendChild(saveRow);

  const actionRow = document.createElement('div');
  actionRow.className = 'nr-actions';
  section.appendChild(actionRow);

  const summaryEl = document.createElement('div');
  summaryEl.className = 'nr-summary';

  const foot = document.createElement('div');
  foot.className = 'nr-foot';
  const autoLabel = document.createElement('label');
  autoLabel.className = 'nr-auto';
  const autoInput = document.createElement('input');
  autoInput.type = 'checkbox';
  autoInput.checked = auto;
  const autoTrack = document.createElement('span');
  autoTrack.className = 'nr-auto-track';
  autoLabel.append(autoInput, autoTrack, 'Auto-reply');
  const moreButton = document.createElement('button');
  moreButton.type = 'button';
  moreButton.className = 'nr-more';
  foot.append(autoLabel, moreButton);
  const detailsEl = document.createElement('div');
  detailsEl.className = 'nr-details';

  host.replaceChildren(section);

  const dests = (): Map<Key, Key[]> => {
    const map = new Map<Key, Key[]>();
    for (const m of chess.moves({ verbose: true })) {
      const from = m.from as Key;
      if (!map.has(from)) map.set(from, []);
      map.get(from)!.push(m.to as Key);
    }
    return map;
  };

  const cg: Api = Chessground(boardEl, {
    fen: card.fen,
    orientation: card.colour,
    turnColor: chess.turn() === 'w' ? 'white' : 'black',
    lastMove: squares(card.ucis[card.ucis.length - 1]),
    check: chess.inCheck(),
    coordinates: false,
    animation: { enabled: true, duration: 150 },
    movable: { free: false, color: undefined, dests: new Map(), showDests: true },
    draggable: { showGhost: true },
    drawable: { enabled: false, visible: true },
    events: { move: (from, to) => onMove(from as Key, to as Key) },
  });
  requestAnimationFrame(() => cg.redrawAll());

  const stopGuard = guardBoardTouches(boardEl, cg);
  const stopSwipe = attachCardSwipe(section, {
    ignore: '.nr-moves, .nr-picks',
    canSwipe: () => path.length === base && !thinking && !cg.state.selected && !cg.state.draggable.current,
    canCommit: () => nextCard() !== null,
    onSwipe: () => actions.skip(card),
    under: () => {
      const coming = nextCard();
      return coming ? buildUnderCard(host, section, boardEl, coming, title) : null;
    },
  });

  const suggest = buildSuggest({
    fen: card.fen,
    colour: card.colour,
    statsAt: stats,
    cg,
    onPlay: (uci) => {
      if (at !== path.length) showAt(path.length);
      if (!canPlay()) return;
      const [from, to] = squares(uci);
      cg.move(from, to);
    },
  });
  const keepGoing = button('Keep going', 'btn-secondary nr-action', () => {
    asking = false;
    // Your next three moves, and the engine is welcome: you've seen the data ran out.
    keptGoingUntil = path.length + ASK_EVERY_MOVES * 2;
    engineWelcome = true;
    paintButtons();
    void replyNow();
  }, Icons.sprout(16));
  actionRow.append(suggest.button, keepGoing, button('Open in builder', 'btn-secondary nr-action', () => {
    if (card.grow && card.grow.moves.length > 0 && path.length === base) deps.onGrow(card.grow);
    else deps.onOpenBuilder(path.map(p => p.uci), card.colour, card.opponentName);
  }, Icons.pencil(16)));
  section.append(suggest.panel, summaryEl, foot, detailsEl);

  autoInput.addEventListener('change', () => {
    auto = autoInput.checked;
    setAutoReply(auto);
    if (auto && !stop && path.length > base && chess.turn() !== myTurn) {
      // On again with their move waiting.
      void replyNow();
      return;
    }
    if (!auto) {
      token++;
      thinking = false;
      engineThinking = false;
      asking = false;
      choosing = false;
    }
    paintButtons();
    showAt(path.length);
  });

  moreButton.addEventListener('click', () => {
    detailsOpen = !detailsOpen;
    paintInfo();
  });

  const fenBefore = (index: number): string => (index === 0 ? START_FEN : path[index - 1].fen);

  const facedAt = (index: number): ImportedGame[] => {
    if (isMine(index)) return [];
    return ctx.load.faced[card.colour].get(positionKey(fenBefore(index)))?.get(path[index].uci) ?? [];
  };

  // ── What we know about the move on the board ───────────────────────────────

  function summaryRow(icon: SVGElement, text: string): HTMLElement {
    const row = document.createElement('p');
    row.className = 'nr-note';
    row.append(icon, text);
    return row;
  }

  function summaryFor(index: number): HTMLElement | null {
    const { san, uci } = path[index];
    const before = fenBefore(index);
    if (isMine(index)) {
      const numbers = answerStats(before, uci, card.colour, stats());
      return numbers ? summaryRow(Icons.book(15), `${numbers.playedPct}% of players choose it`) : null;
    }
    const games = facedAt(index);
    if (games.length > 0) {
      const { last } = summariseFaced(games);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'nr-faced';
      const label = document.createElement('span');
      label.className = 'nr-faced-text';
      const ago = agoText(last);
      label.textContent = ago ? `${timesText(games.length)} · ${ago}` : timesText(games.length);
      row.append(Icons.swords(15), label, Icons.chevronRight(15));
      row.addEventListener('click', () => {
        openFacedGames(games, moveLabel(index, san), game => deps.onOpenGame(game, before));
      });
      return row;
    }
    const scout = ctx.load.scouts[card.colour].get(positionKey(before))
      ?.find(s => s.uci === uci && s.games >= MIN_SCOUT_GAMES);
    if (scout) return summaryRow(Icons.scout(15), `${scout.name} plays this`);
    const numbers = answerStats(before, uci, card.colour, stats());
    if (numbers) return summaryRow(Icons.book(15), `${numbers.playedPct}% of opponents play it`);
    if (bases.get(index) === 'engine') return summaryRow(Icons.cpu(15), 'The engine’s choice');
    return null;
  }

  /** Moves taken off the line take the reason they were played with them. */
  function forgetFrom(index: number): void {
    for (const ply of [...bases.keys()]) if (ply >= index) bases.delete(ply);
  }

  /** Swap the reply on the board for one you choose. What came after it goes too. */
  function changeReply(): void {
    const index = at - 1;
    token++;
    thinking = false;
    engineThinking = false;
    asking = false;
    stop = null;
    choosing = true;
    forgetFrom(index);
    path.length = index;
    chess.load(fenBefore(index));
    suggest.setPosition(chess.fen());
    suggest.open();
    paintButtons();
    showAt(path.length);
  }

  function cancelChoosing(): void {
    choosing = false;
    suggest.close();
    void replyNow();
  }

  function stopNote(): HTMLElement | null {
    if (at !== path.length) return null;
    if (choosing) {
      const row = summaryRow(Icons.reply(15), 'Play their reply, or pick one');
      row.appendChild(button('Cancel', 'btn-quiet nr-inline', cancelChoosing));
      return row;
    }
    if (engineThinking) return summaryRow(Icons.cpu(15), 'Thinking…');
    if (asking) {
      return summaryRow(Icons.checkCircle(15), `${Math.ceil((lastMine() + 1) / 2)} moves deep`);
    }
    if (stop === 'joined') return summaryRow(Icons.checkCircle(15), 'Joins a line you already have');
    if (stop === 'no-reply') return summaryRow(Icons.cpu(15), 'No reply found here');
    return null;
  }

  function movesFacts(index: number, rows: HTMLElement[]): void {
    const { san, uci } = path[index];
    const before = fenBefore(index);
    const numbers = answerStats(before, uci, card.colour, stats());
    const games = facedAt(index);
    if (!numbers && games.length === 0) return;
    if (isMine(index)) {
      if (!numbers) return;
      rows.push(factHeading(`Your ${moveLabel(index, san)}`));
      rows.push(meterRow('Players choose it', numbers.playedPct));
      rows.push(resultRow('It scores', numbers));
      return;
    }
    rows.push(factHeading(`Their ${moveLabel(index, san)}`));
    if (numbers) {
      rows.push(meterRow('Opponents play it', numbers.playedPct));
      rows.push(resultRow('You score', numbers));
    }
    if (games.length > 0) {
      const f = summariseFaced(games);
      rows.push(resultRow('Your games', {
        wins: f.wins,
        draws: f.draws,
        losses: f.losses,
        games: f.games,
        scorePct: Math.round((100 * f.points) / f.games),
      }, `${points(f.points)} of ${f.games}`));
    }
  }

  function paintDetails(): void {
    if (!detailsOpen || at === 0) {
      detailsEl.hidden = true;
      detailsEl.replaceChildren();
      return;
    }
    detailsEl.hidden = false;
    const rows: HTMLElement[] = [];
    const index = at - 1;
    // Just played a move, and they answered: how your move did comes first.
    if (!isMine(index) && index - 1 >= base) movesFacts(index - 1, rows);
    movesFacts(index, rows);

    // How you've been doing on the mastered line this card would extend.
    if (card.line) {
      rows.unshift(factHeading('This line'), buildStatRow(lineFigures(card.line)));
    }

    const fen = fenBefore(at);
    rows.push(factHeading('This position'));
    const asked = evals.get(fen);
    rows.push(valueRow('Evaluation', asked ?? '…'));
    detailsEl.replaceChildren(factList(rows));
    if (asked === undefined) void askEval(fen);
  }

  async function askEval(fen: string): Promise<void> {
    evals.set(fen, '…');
    let value = '–';
    try {
      const { analysePosition } = await import('./engine');
      const moves = await analysePosition(fen, ENGINE_DEPTH, undefined, {
        multiPv: 1, movetimeMs: ENGINE_EVAL_MS,
      });
      if (moves[0]) value = evalText(moves[0].cp, moves[0].mate) || '–';
    } catch {
      value = '–';
    }
    evals.set(fen, value);
    if (section.isConnected && fenBefore(at) === fen) paintDetails();
  }

  function paintInfo(): void {
    const name = nameForPath(path.slice(0, at).map(p => p.fen));
    openingEl.textContent = name ?? '';
    openingEl.hidden = !name;

    const note = stopNote();
    const summary = at > 0 && !choosing ? summaryFor(at - 1) : null;
    // Any reply the line added can be changed; the one the card is about can't.
    const change = !choosing && !thinking && at > base && !isMine(at - 1)
      ? button('Change reply', 'btn-quiet nr-inline', changeReply, Icons.shuffle(14))
      : null;
    summaryEl.replaceChildren(
      ...(note ? [note] : []),
      ...(summary ? [summary] : []),
      ...(change ? [change] : []),
    );
    summaryEl.hidden = !note && !summary && !change;

    moreButton.replaceChildren(
      detailsOpen ? 'Show less' : 'Show more',
      detailsOpen ? Icons.chevronUp(15) : Icons.chevronDown(15),
    );
    moreButton.setAttribute('aria-expanded', String(detailsOpen));
    moreButton.hidden = at === 0;
    paintDetails();
  }

  /**
   * Building: Save is there but quiet. Paused to ask, or playing both sides, it's the
   * thing to do. A line ends on your move, so it saves up to your last one.
   */
  function paintButtons(): void {
    const last = lastMine();
    const canUndo = auto ? last >= 0 : path.length > base;
    saveRow.hidden = !canUndo && last < 0;
    suggest.button.hidden = asking;
    keepGoing.hidden = !asking;
    if (asking) suggest.close();
    if (saveRow.hidden) {
      saveRow.replaceChildren();
      return;
    }
    const children: HTMLElement[] = [];
    if (last >= 0) {
      const prominent = asking || !auto || stop !== null;
      const save = button(
        'Save line',
        `${prominent ? 'btn-primary' : 'btn-secondary'} nr-action nr-save`,
        () => {
          save.disabled = true;
          void saveReply(card, path.slice(base, last + 1)).then((outcome) => {
            if (outcome.status === 'saved') actions.saved(card, outcome.saved);
            else if (outcome.status === 'gone') {
              showToast('This position is no longer in your lines.');
              actions.drop(card);
            } else {
              save.disabled = false;   // the upgrade dialog is up; leave the card as it is
            }
          }).catch(() => { save.disabled = false; });
        },
        Icons.save(16),
      );
      children.push(save);
    }
    if (canUndo) children.push(button('Undo', 'btn-secondary nr-undo', undoMove, Icons.reply(16)));
    saveRow.replaceChildren(...children);
  }

  // Any position along the line. Only the live one, on your move, can be played on.
  function showAt(i: number): void {
    at = i;
    const fen = fenBefore(i);
    const view = new Chess(fen);
    cg.selectSquare(null);
    cg.set({
      fen,
      lastMove: i === 0 ? undefined : squares(path[i - 1].uci),
      turnColor: view.turn() === 'w' ? 'white' : 'black',
      check: view.inCheck(),
      movable: canPlay()
        ? { color: chess.turn() === 'w' ? 'white' : 'black', dests: dests() }
        : { color: undefined, dests: new Map() },
    });
    suggest.showArrows(canPlay());
    // A reply you haven't answered yet isn't part of what Save keeps.
    strip.update(path.map(p => p.san), i, Math.max(lastMine() + 1, base));
    paintInfo();
  }

  // Browsing back leaves a board that can't be played on. Tapping it comes back.
  const onBoardClick = (): void => {
    if (at !== path.length) showAt(path.length);
  };
  boardEl.addEventListener('click', onBoardClick);

  function onMove(from: Key, to: Key): void {
    const before = chess.fen();
    const wasMine = chess.turn() === myTurn;
    const wasChoosing = choosing;
    let move;
    try {
      move = chess.move({ from, to, promotion: 'q' });
    } catch {
      cg.set({ fen: before });
      return;
    }
    path.push({ uci: from + to + (move.promotion ?? ''), san: move.san, fen: chess.fen() });
    if (chess.isGameOver()) stop = 'over';
    else if (!wasMine && ctx.load.answered[card.colour].has(positionKey(chess.fen()))) stop = 'joined';
    else if (wasMine && auto && path.length >= askAt()) asking = true;
    if (wasChoosing) {
      choosing = false;
      suggest.close();
    }
    paintButtons();
    if (stop || asking || !auto || !wasMine) {
      suggest.setPosition(chess.fen());
      showAt(path.length);
      return;
    }
    void replyNow();
  }

  /** The opponent's move, from what's known, and from the engine if nothing is. */
  async function replyNow(): Promise<void> {
    const mine = ++token;
    const started = Date.now();
    const fen = chess.fen();
    thinking = true;
    showAt(path.length);

    // A card kept from last visit can be played before the data arrives. Give that a
    // moment, because the usual reply is better than the engine's.
    await Promise.race([
      ctx.ready,
      new Promise((resolve) => { window.setTimeout(resolve, ENGINE_GIVE_UP_MS); }),
    ]);
    if (mine !== token) return;

    const opponent = card.opponentName;
    let reply = usualReply(fen, card.colour, {
      statsAt: stats(),
      facedAt: (key) => {
        const replies = ctx.load.faced[card.colour].get(key);
        return replies ? new Map([...replies].map(([uci, games]) => [uci, games.length])) : undefined;
      },
      scoutAt: opponent
        ? key => (ctx.load.scouts[card.colour].get(key) ?? [])
          .filter(s => s.name === opponent && s.games >= MIN_SCOUT_GAMES)
        : undefined,
    });
    if (!reply) {
      // The known replies have run out. If you've built a bit, that's a good moment to
      // ask, rather than quietly carrying on with the engine's ideas.
      const yours = path.slice(base).filter((_, i) => isMine(base + i)).length;
      if (!engineWelcome && yours >= ASK_EVERY_MOVES) {
        thinking = false;
        asking = true;
        paintButtons();
        showAt(path.length);
        return;
      }
      engineThinking = true;
      paintInfo();
      reply = await engineReply(fen);
      if (mine !== token) return;
      engineThinking = false;
    }
    const wait = REPLY_PAUSE_MS - (Date.now() - started);
    if (wait > 0) await new Promise(resolve => { window.setTimeout(resolve, wait); });
    if (mine !== token) return;

    thinking = false;
    if (!reply) {
      stop = 'no-reply';
      showAt(path.length);
      return;
    }
    const [from, to] = squares(reply.uci);
    chess.move({ from, to, promotion: (reply.uci[4] as 'q') || undefined });
    path.push({ uci: reply.uci, san: reply.san, fen: chess.fen() });
    bases.set(path.length - 1, reply.basis);
    if (chess.isGameOver()) stop = 'over';
    else if (ctx.load.answered[card.colour].has(positionKey(chess.fen()))) stop = 'joined';
    if (!stop) suggest.setPosition(chess.fen());
    paintButtons();
    showAt(path.length);
  }

  /** Take back your last move and the reply it got, or just the last move if both are yours. */
  function undoMove(): void {
    const last = lastMine();
    const back = auto ? last : path.length - 1;
    if (back < base) return;
    token++;
    thinking = false;
    engineThinking = false;
    asking = false;
    choosing = false;
    stop = null;
    forgetFrom(back);
    path.length = back;
    chess.load(fenBefore(back));
    suggest.setPosition(chess.fen());
    paintButtons();
    showAt(path.length);
  }

  paintButtons();
  showAt(path.length);
  // The end of a mastered line nobody knows anything about: their move comes first.
  if (card.awaitingReply && auto) void replyNow();

  return {
    card,
    destroy() {
      token++;
      stopGuard();
      stopSwipe();
      boardEl.removeEventListener('click', onBoardClick);
      cg.destroy();
    },
    refresh() {
      suggest.refresh();
      paintInfo();
    },
    touched: () => path.length > base,
  };
}
