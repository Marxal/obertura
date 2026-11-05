// "Your most forgotten moves": a live board on Home, phone and desktop alike.
//
// WHY A BOARD. This was a strip of small cards that each opened a popup, so the one
// thing worth doing with a forgotten move, trying to remember it, was two taps away
// and never in the same place. Now the position is simply there, and you play your
// answer on it. What the popup knew moved here too: the same four figures, under the
// board, and its Fix it and Drill line among the buttons.
//
// PLAYING HERE COSTS THE SCHEDULER NOTHING. A right or wrong move on this board is
// feedback, not a graded review, so a look at Home can't reschedule a line behind
// your back. Fix it and Drill line are the two doors that count, and they say so by
// being the same runs they are everywhere else.
//
// ONE POSITION AT A TIME, worst first. "Another position" deals the next; on a phone
// so does swiping the card away (reply-card-swipe.ts), as on the other two boards.

import { openingLabel } from './opening-names';
import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { HINT_COLOR, registerBrushes } from './board-brushes';
import { colourPip } from './card-position';
import type { HomeDeps } from './home-screen';
import { Icons } from './icons';
import { openMoveNoteSheet } from './note-sheet';
import { formatMove } from './notation';
import { buildStatRow } from './position-peek';
import { buildUnderCard } from './next-reply-card';
import { attachCardSwipe } from './reply-card-swipe';
import { guardBoardTouches } from './reply-board-touch';
import { describeDue, mainlineNodes } from './scheduler';
import { playFeedback } from './sound';
import { needsWorkMoves, type NeedsWorkMove } from './stats';
import { saveLine } from './storage';
import type { MoveNode } from './tree';
import type { Line } from './types';
import { t } from './i18n';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const HOW_MANY = 50;

// A new Home render replaces the block, and the old board's listeners go with it.
let destroyCurrent: (() => void) | null = null;

/** The move's node in its line, for its note: matched by position and move. */
function nodeOf(line: Line, m: NeedsWorkMove): MoveNode | null {
  const main = mainlineNodes(line.tree);
  for (let i = 0; i < main.length; i++) {
    const preFen = i === 0 ? START_FEN : main[i - 1].fen;
    if (preFen === m.preFen && main[i].san === m.san) return main[i];
  }
  return null;
}

function button(label: string, icon: SVGElement, onClick: () => void, cls = 'btn-secondary'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `${cls} nr-action`;
  b.append(icon, document.createTextNode(label));
  b.addEventListener('click', onClick);
  return b;
}

/** `startAt` deals past the worst: Train's copy, so it isn't Home's board. */
export function buildForgottenMovesBlock(lines: Line[], deps: HomeDeps, startAt = 0): HTMLElement | null {
  destroyCurrent?.();
  destroyCurrent = null;

  const moves = needsWorkMoves(lines, HOW_MANY);
  if (moves.length === 0) return null;

  // The wrapper is what the next position shows through while a card is dragged away.
  const wrap = document.createElement('div');
  wrap.className = 'nr-swipe-host';
  const section = document.createElement('section');
  section.className = 'fmove-block home-panel nr-panel fm-panel';
  wrap.appendChild(section);

  const head = document.createElement('div');
  head.className = 'fmove-block-head';
  const title = document.createElement('h2');
  title.className = 'fmove-block-title';
  title.textContent = t('home.forgotten.title');
  head.appendChild(title);
  let at = 0;
  let stopCard: (() => void) | null = null;
  const another = button(t('common.anotherPosition'), Icons.shuffle(16), () => deal(at + 1), 'btn-quiet');
  another.classList.remove('nr-action');
  another.classList.add('nr-another');
  another.hidden = moves.length < 2;
  head.appendChild(another);

  const host = document.createElement('div');
  section.append(head, host);

  function deal(next: number): void {
    at = (next + moves.length) % moves.length;
    stopCard?.();
    stopCard = drawCard(wrap, host, section, moves[at], moves[(at + 1) % moves.length], lines, deps,
      moves.length > 1, () => deal(at + 1));
  }
  deal(startAt);

  destroyCurrent = () => stopCard?.();
  return wrap;
}

function drawCard(
  wrap: HTMLElement,
  host: HTMLElement,
  section: HTMLElement,
  m: NeedsWorkMove,
  coming: NeedsWorkMove,
  lines: Line[],
  deps: HomeDeps,
  hasOthers: boolean,
  next: () => void,
): () => void {
  const line = lines.find(l => l.id === m.lineId);

  const body = document.createElement('div');
  body.className = 'nr-card-body';

  const boardEl = document.createElement('div');
  boardEl.className = 'forgotten-board cg-wrap nr-board';

  const intro = document.createElement('div');
  intro.className = 'mr-intro mrc-intro fm-intro';
  intro.append(colourPip(m.colour), document.createTextNode(m.lineName));

  const status = document.createElement('p');
  status.className = 'nr-note';
  status.hidden = true;

  const noteEl = document.createElement('div');
  noteEl.className = 'peek-note';
  noteEl.hidden = true;

  const row = document.createElement('div');
  row.className = 'nr-actions fm-actions';
  const more = document.createElement('div');
  more.className = 'nr-actions fm-actions fm-actions--more';

  const recalled = Math.max(0, m.attempts - m.lapses);
  const pct = m.attempts > 0 ? Math.round((100 * recalled) / m.attempts) : null;
  const stats = buildStatRow([
    {
      value: pct === null ? '—' : `${pct}%`,
      label: t('stat.recall'),
      tone: pct === null ? undefined : pct < 50 ? 'low' : pct < 80 ? 'mid' : 'ok',
    },
    { value: String(m.lapses), label: t('stat.miss', { n: m.lapses }), tone: 'low' },
    { value: String(m.attempts), label: t('stat.asked') },
    { value: String(m.reps), label: t('stat.inARow'), tone: m.reps > 0 ? 'ok' : 'low' },
  ]);
  const foot = document.createElement('p');
  foot.className = 'peek-foot fm-foot';
  foot.textContent = [openingLabel(m.openingName) ?? m.lineName, m.due ? describeDue(m.due) : t('home.forgotten.notScheduled')].join(' · ');

  body.append(boardEl, intro, status, noteEl, row, more, stats, foot);
  host.replaceChildren(body);

  const chess = new Chess(m.preFen);
  const dests = (): Map<Key, Key[]> => {
    const map = new Map<Key, Key[]>();
    for (const v of chess.moves({ verbose: true })) {
      const from = v.from as Key;
      if (!map.has(from)) map.set(from, []);
      map.get(from)!.push(v.to as Key);
    }
    return map;
  };

  let done = false;
  const cg: Api = Chessground(boardEl, {
    fen: m.preFen,
    orientation: m.colour,
    turnColor: m.colour,
    coordinates: false,
    animation: { enabled: true, duration: 150 },
    movable: { free: false, color: m.colour, dests: dests(), showDests: true },
    draggable: { showGhost: true },
    drawable: { enabled: false, visible: true },
    events: { move: (from, to) => onMove(from as Key, to as Key) },
  });
  registerBrushes(cg, { accent: { color: HINT_COLOR, opacity: 0.9, lineWidth: 10 } });
  requestAnimationFrame(() => cg.redrawAll());
  const stopGuard = guardBoardTouches(boardEl, cg);

  const say = (text: string, tone: 'good' | 'bad'): void => {
    status.textContent = text;
    status.hidden = false;
    status.classList.toggle('nr-note--good', tone === 'good');
    status.classList.toggle('nr-note--bad', tone === 'bad');
  };

  // Held back until the move is out: a reminder can give the answer away.
  const showNote = (): void => {
    const note = line ? nodeOf(line, m)?.note : undefined;
    noteEl.textContent = note ?? '';
    noteEl.hidden = !note;
  };

  // The answer is out, so the way on takes its button's place. Once: showing the move
  // and then playing it both come through here.
  let offered = false;
  const offerNext = (): void => {
    if (offered) return;
    offered = true;
    showBtn.hidden = true;
    if (hasOthers) {
      const on = button(t('common.nextPosition'), Icons.chevronRight(16), next, 'btn-primary');
      row.prepend(on);
    }
  };

  const showBtn = button(t('home.forgotten.show'), Icons.eye(16), () => {
    cg.setAutoShapes([{
      orig: m.uci.slice(0, 2) as Key,
      dest: m.uci.slice(2, 4) as Key,
      brush: 'accent',
    }]);
    say(t('home.forgotten.theMove', { move: formatMove(m.san) }), 'good');
    showNote();
    offerNext();
  });
  row.append(
    showBtn,
    button(t('home.forgotten.fix'), Icons.target(16), () => deps.onFixMove(
      { preFen: m.preFen, san: m.san, colour: m.colour, lapses: m.lapses }, lines)),
  );

  if (line) {
    more.append(
      button(t('home.forgotten.drill'), Icons.zap(16), () => deps.onDrillLine(line)),
      button(t('home.forgotten.edit'), Icons.pencil(16), () => deps.onOpenLine(line, m.preFen)),
    );
    const node = nodeOf(line, m);
    if (node) {
      const noteBtn = button(t(node.note ? 'home.note.edit' : 'home.note.add'), Icons.note(16), () => {
        void openMoveNoteSheet({
          node,
          title: t('home.note.for', { move: formatMove(m.san) }),
          placeholder: t('home.note.placeholder'),
          onSave: () => {
            void saveLine(line);
            noteBtn.lastChild!.textContent = t(node.note ? 'home.note.edit' : 'home.note.add');
            if (done) showNote();
          },
        });
      });
      more.appendChild(noteBtn);
    }
  }

  function onMove(from: Key, to: Key): void {
    if (`${from}${to}` !== m.uci.slice(0, 4)) {
      playFeedback('wrong');
      const flash = document.createElement('div');
      flash.className = 'pt-error-flash';
      boardEl.appendChild(flash);
      flash.addEventListener('animationend', () => flash.remove(), { once: true });
      say(t('common.notQuite'), 'bad');
      cg.set({ fen: chess.fen(), turnColor: m.colour, movable: { color: m.colour, dests: dests() } });
      return;
    }
    done = true;
    playFeedback('correct');
    cg.setAutoShapes([]);
    try {
      chess.move({ from, to, promotion: (m.uci[4] as 'q') || undefined });
      cg.set({ fen: chess.fen(), movable: { color: undefined, dests: new Map() } });
    } catch {
      /* The move was legal to get here; the board already shows it. */
    }
    say(t('home.forgotten.thatsIt', { move: formatMove(m.san) }), 'good');
    showNote();
    offerNext();
  }

  const stopSwipe = attachCardSwipe(section, {
    canSwipe: () => !cg.state.selected && !cg.state.draggable.current,
    canCommit: () => hasOthers,
    onSwipe: next,
    under: () => buildUnderCard(wrap, section, boardEl,
      { fen: coming.preFen, colour: coming.colour, ucis: [] }, t('home.forgotten.title')),
  });

  return () => {
    stopSwipe();
    stopGuard();
    cg.destroy();
  };
}
