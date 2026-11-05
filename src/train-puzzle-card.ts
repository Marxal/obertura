// One live puzzle on a board, at the foot of Train's Tactics and Endgames.
//
// A TASTE, NOT A RUN. It is the same Lichess puzzle a rated run deals, at your level,
// but it never touches your rating or the run's logs: the Start card above it is the
// rated door, and a board you can poke at between things shouldn't cost you points.
//
// One fetch per board, kept until solved, so flipping between sections doesn't spend
// Lichess's goodwill. Offline, the block just isn't there.

import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { HINT_COLOR, registerBrushes } from './board-brushes';
import { burstConfetti } from './confetti';
import { Icons } from './icons';
import { fetchNextPuzzle, puzzleSetup, type Difficulty, type Puzzle } from './puzzles';
import { buildUnderCard } from './next-reply-card';
import { attachCardSwipe } from './reply-card-swipe';
import { guardBoardTouches } from './reply-board-touch';
import { playFeedback } from './sound';
import { t } from './i18n';

const REPLY_MS = 350;

export interface PuzzleCardOptions {
  title: string;
  angle: string | null;
  difficulty: Difficulty;
}

const waiting = new Map<string, Puzzle>();
let destroyCurrent: (() => void) | null = null;

function action(label: string, icon: SVGElement | null, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  if (icon) b.appendChild(icon);
  b.append(label);
  b.addEventListener('click', onClick);
  return b;
}

/** Resolves to the block, or null when there's no puzzle to be had. */
export async function buildPuzzleBlock(o: PuzzleCardOptions): Promise<HTMLElement | null> {
  destroyCurrent?.();
  destroyCurrent = null;
  const key = o.title;

  const fetchOne = async (): Promise<Puzzle | null> => {
    const held = waiting.get(key);
    if (held) return held;
    const fresh = await fetchNextPuzzle(o.angle, { difficulty: o.difficulty });
    if (fresh) waiting.set(key, fresh);
    return fresh;
  };
  const first = await fetchOne();
  if (!first) return null;

  const wrap = document.createElement('div');
  wrap.className = 'nr-swipe-host';
  const section = document.createElement('section');
  section.className = 'fmove-block home-panel nr-panel tp-panel';
  wrap.appendChild(section);
  const head = document.createElement('div');
  head.className = 'fmove-block-head';
  const title = document.createElement('h2');
  title.className = 'fmove-block-title';
  title.textContent = o.title;
  head.append(title, action(t('mid.anotherPuzzle'), Icons.shuffle(16), 'btn-quiet nr-another', () => void another()));
  const host = document.createElement('div');
  section.append(head, host);

  let stop: (() => void) | null = null;
  const show = (p: Puzzle): void => {
    stop?.();
    stop = drawPuzzle(wrap, host, section, o.title, p, () => { waiting.delete(key); }, () => void another());
  };
  async function another(): Promise<void> {
    waiting.delete(key);
    const next = await fetchOne();
    if (next && section.isConnected) show(next);
  }
  show(first);
  destroyCurrent = () => stop?.();
  return wrap;
}

function drawPuzzle(
  wrap: HTMLElement, host: HTMLElement, section: HTMLElement, title: string, puzzle: Puzzle, onSolved: () => void, next: () => void,
): () => void {
  const setup = puzzleSetup(puzzle);
  if (!setup) { window.setTimeout(next, 0); return () => {}; }

  const body = document.createElement('div');
  body.className = 'nr-card-body';
  const boardEl = document.createElement('div');
  boardEl.className = 'forgotten-board cg-wrap nr-board';
  const intro = document.createElement('div');
  intro.className = 'mr-intro mrc-intro';
  intro.textContent = t(setup.solverColour === 'white' ? 'mid.whiteRated' : 'mid.blackRated', { rating: puzzle.rating });
  const status = document.createElement('p');
  status.className = 'nr-note';
  status.hidden = true;
  const row = document.createElement('div');
  row.className = 'nr-actions';
  body.append(boardEl, intro, status, row);
  host.replaceChildren(body);

  const chess = new Chess(setup.fen);
  let step = 0;
  let hintStage = 0;
  let replyTimer = 0;

  const dests = (): Map<Key, Key[]> => {
    const map = new Map<Key, Key[]>();
    for (const m of chess.moves({ verbose: true })) {
      const from = m.from as Key;
      if (!map.has(from)) map.set(from, []);
      map.get(from)!.push(m.to as Key);
    }
    return map;
  };
  const say = (text: string, tone: 'good' | 'bad'): void => {
    status.textContent = text;
    status.hidden = false;
    status.classList.toggle('nr-note--good', tone === 'good');
    status.classList.toggle('nr-note--bad', tone === 'bad');
  };

  const cg: Api = Chessground(boardEl, {
    fen: setup.fen,
    orientation: setup.solverColour,
    turnColor: setup.solverColour,
    coordinates: false,
    animation: { enabled: true, duration: 150 },
    movable: { free: false, color: setup.solverColour, dests: dests(), showDests: true },
    draggable: { showGhost: true },
    drawable: { enabled: false, visible: true },
    events: { move: (from, to) => onMove(from as Key, to as Key) },
  });
  registerBrushes(cg, { accent: { color: HINT_COLOR, opacity: 0.9, lineWidth: 10 } });
  requestAnimationFrame(() => cg.redrawAll());
  const stopGuard = guardBoardTouches(boardEl, cg);

  const paintHint = (): void => {
    const uci = setup.solution[step];
    if (!uci || hintStage === 0) { cg.setAutoShapes([]); return; }
    cg.setAutoShapes(hintStage === 1
      ? [{ orig: uci.slice(0, 2) as Key, brush: 'accent' }]
      : [{ orig: uci.slice(0, 2) as Key, dest: uci.slice(2, 4) as Key, brush: 'accent' }]);
  };
  const hintBtn = action(t('common.hint'), Icons.bulb(16), 'btn-secondary nr-action', () => {
    hintStage = Math.min(2, hintStage + 1);
    hintBtn.replaceChildren(Icons.bulb(16), hintStage === 2 ? t('mid.showingTheMove') : t('home.forgotten.show'));
    hintBtn.disabled = hintStage === 2;
    paintHint();
  });
  row.append(hintBtn);

  const playUci = (uci: string): void => {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  };

  function finish(): void {
    onSolved();
    playFeedback('correct');
    burstConfetti(boardEl);
    say(t('mid.solved13'), 'good');
    cg.set({ movable: { color: undefined, dests: new Map() } });
    row.replaceChildren(action(t('mid.nextPuzzle'), Icons.chevronRight(16), 'btn-primary nr-action', next));
  }

  function onMove(from: Key, to: Key): void {
    const want = setup!.solution[step];
    if (`${from}${to}` !== want.slice(0, 4)) {
      playFeedback('wrong');
      const flash = document.createElement('div');
      flash.className = 'pt-error-flash';
      boardEl.appendChild(flash);
      flash.addEventListener('animationend', () => flash.remove(), { once: true });
      say(t('common.notQuite'), 'bad');
      cg.set({ fen: chess.fen(), turnColor: setup!.solverColour, movable: { color: setup!.solverColour, dests: dests() } });
      paintHint();
      return;
    }
    status.hidden = true;
    playUci(want);
    cg.set({ fen: chess.fen(), lastMove: [from, to] });
    step++;
    hintStage = 0;
    hintBtn.replaceChildren(Icons.bulb(16), t('common.hint'));
    hintBtn.disabled = false;
    cg.setAutoShapes([]);
    const reply = setup!.solution[step];
    if (!reply) { finish(); return; }
    cg.set({ movable: { color: undefined, dests: new Map() } });
    replyTimer = window.setTimeout(() => {
      playUci(reply);
      step++;
      cg.set({
        fen: chess.fen(),
        lastMove: [reply.slice(0, 2) as Key, reply.slice(2, 4) as Key],
        turnColor: setup!.solverColour,
        movable: { color: setup!.solverColour, dests: dests() },
      });
      if (!setup!.solution[step]) finish();
    }, REPLY_MS);
  }

  const stopSwipe = attachCardSwipe(section, {
    canSwipe: () => !cg.state.selected && !cg.state.draggable.current,
    canCommit: () => true,
    onSwipe: next,
    // The next puzzle isn't fetched until it's asked for, so an empty board stands in.
    under: () => buildUnderCard(wrap, section, boardEl, { fen: '8/8/8/8/8/8/8/8 w - - 0 1', colour: 'white', ucis: [] }, title),
  });

  return () => {
    window.clearTimeout(replyTimer);
    stopSwipe();
    stopGuard();
    cg.destroy();
  };
}
