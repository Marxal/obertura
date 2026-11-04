// What the app does, beside "Where do you play?" on a desktop.
//
// THE SCREEN'S JOB IS THE IMPORT, so nothing here competes with it: the only controls
// browse these cards. It answers the one thing the form can't, "what do I get for
// typing my username?", by walking the path the import starts: your games are read,
// your openings appear, your mistakes turn into exercises.
//
// NATIVE, NOT THE MARKETING VIDEO. The 30-second loop is portrait, 1.8MB and can't be
// browsed or translated. These are real boards and real words.
//
// THE POSITIONS ARE SIMPLE ON PURPOSE. The rest of the app's examples use serious
// openings for 1700-2000 players, but these go by in seconds beside a form, so each
// has to be understood at a glance, by anyone. All checked with Stockfish:
//   3...Nf6?? allows 4.Qxf7# (3...g6 is best); Rd8 is mate on the back rank;
//   3.Qxe5+?? loses the queen to Nxe5 (+6.2 for Black); 2...Qh4 is mate.
//
// THE TIMER IS THE PROGRESS BAR. When its animation ends the next card comes up, so
// pausing the bar on hover pauses the cards, and with reduced motion, which has no
// animation, the cards simply wait for the arrows.

import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { registerBrushes } from './board-brushes';
import { colourPip } from './card-position';
import { Icons } from './icons';

const GAMES: { opening: string; colour: 'white' | 'black'; result: 'Won' | 'Lost' | 'Drew' }[] = [
  { opening: 'Italian Game', colour: 'white', result: 'Won' },
  { opening: 'Caro-Kann', colour: 'black', result: 'Lost' },
  { opening: 'London System', colour: 'white', result: 'Drew' },
  { opening: 'Scandinavian', colour: 'black', result: 'Won' },
];

const OPENINGS: { name: string; colour: 'white' | 'black'; score: number; state: string }[] = [
  { name: 'Italian Game', colour: 'white', score: 58, state: 'Line saved' },
  { name: 'London System', colour: 'white', score: 61, state: 'Line saved' },
  { name: 'Caro-Kann', colour: 'black', score: 44, state: 'No line yet' },
  { name: 'Scandinavian', colour: 'black', score: 37, state: 'No line yet' },
];

function gamesVisual(): HTMLElement {
  const list = document.createElement('div');
  list.className = 'where-sc-list';
  GAMES.forEach((g, i) => {
    const row = document.createElement('div');
    row.className = 'where-sc-row where-sc-row--in';
    row.style.setProperty('--i', String(i));
    const name = document.createElement('span');
    name.className = 'where-sc-row-name';
    name.textContent = g.opening;
    const result = document.createElement('span');
    result.className = `where-sc-result where-sc-result--${g.result.toLowerCase()}`;
    result.textContent = g.result;
    row.append(colourPip(g.colour), name, result);
    list.appendChild(row);
  });
  return list;
}

function openingsVisual(): HTMLElement {
  const list = document.createElement('div');
  list.className = 'where-sc-list';
  OPENINGS.forEach((o, i) => {
    const row = document.createElement('div');
    row.className = 'where-sc-row where-sc-row--in where-sc-row--opening';
    row.style.setProperty('--i', String(i));
    const name = document.createElement('span');
    name.className = 'where-sc-row-name';
    name.textContent = o.name;
    const state = document.createElement('span');
    state.className = 'where-sc-state' + (o.state === 'No line yet' ? ' where-sc-state--todo' : '');
    state.textContent = o.state;
    const bar = document.createElement('span');
    bar.className = 'where-sc-bar';
    const fill = document.createElement('span');
    fill.style.width = `${o.score}%`;
    bar.appendChild(fill);
    const pct = document.createElement('span');
    pct.className = 'where-sc-pct';
    pct.textContent = `${o.score}%`;
    row.append(colourPip(o.colour), name, state, bar, pct);
    list.appendChild(row);
  });
  return list;
}

// This screen's boards, so the window coming back to desktop width can redraw them.
const boards: Api[] = [];

interface Arrow { from: string; to: string; brush: 'bad' | 'good' }

function boardVisual(
  fen: string,
  orientation: 'white' | 'black',
  arrows: Arrow[],
  chips: { text: string; tone?: 'bad' | 'good' }[],
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'where-sc-board';
  const boardEl = document.createElement('div');
  boardEl.className = 'cg-wrap';
  wrap.appendChild(boardEl);

  const foot = document.createElement('div');
  foot.className = 'where-sc-chips';
  for (const c of chips) {
    const chip = document.createElement('span');
    chip.className = `where-sc-chip${c.tone ? ` where-sc-chip--${c.tone}` : ''}`;
    chip.textContent = c.text;
    foot.appendChild(chip);
  }
  wrap.appendChild(foot);

  // After it is in the document: Chessground measures itself as it starts.
  requestAnimationFrame(() => {
    const cg = Chessground(boardEl, {
      fen,
      orientation,
      viewOnly: true,
      coordinates: false,
      animation: { enabled: false },
      drawable: { enabled: false, visible: true },
    });
    registerBrushes(cg, {
      bad: { color: '#d64a3a', opacity: 0.9, lineWidth: 10 },
      good: { color: '#2f9e57', opacity: 0.9, lineWidth: 10 },
    });
    cg.setAutoShapes(arrows.map(a => ({ orig: a.from as Key, dest: a.to as Key, brush: a.brush })));
    boards.push(cg);
  });
  return wrap;
}

export function buildWhereShowcase(): { el: HTMLElement; redraw: () => void } {
  boards.length = 0;
  const el = document.createElement('div');
  el.className = 'where-art';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-roledescription', 'carousel');
  el.setAttribute('aria-label', 'What Bito does with your games');

  const scenes: { title: string; sub: string; visual: () => HTMLElement }[] = [
    { title: 'Reads your games', sub: 'From Chess.com or Lichess', visual: gamesVisual },
    { title: 'Shows the openings you play', sub: 'Your score in each, and what you have no line for', visual: openingsVisual },
    {
      title: 'Fix your mistakes',
      sub: 'Your own positions, until you find the better move',
      visual: () => boardVisual('r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3', 'black',
        [{ from: 'g8', to: 'f6', brush: 'bad' }, { from: 'g7', to: 'g6', brush: 'good' }],
        [{ text: 'You played Nf6??', tone: 'bad' }, { text: 'Better: g6', tone: 'good' }]),
    },
    {
      title: 'Which move',
      sub: 'Two moves, one of them yours',
      visual: () => boardVisual('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 'white',
        [{ from: 'd1', to: 'd8', brush: 'good' }, { from: 'h2', to: 'h3', brush: 'bad' }],
        [{ text: 'Rd8#', tone: 'good' }, { text: 'h3', tone: 'bad' }]),
    },
    {
      title: 'Blunder detective',
      sub: 'Find the blunder, yours or theirs',
      visual: () => boardVisual('r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3', 'white',
        [{ from: 'h5', to: 'e5', brush: 'bad' }],
        [{ text: '2.Qh5' }, { text: '2…Nc6' }, { text: '3.Qxe5+??', tone: 'bad' }]),
    },
    {
      title: 'Time pressure',
      sub: '20 seconds a position, 2 minutes',
      visual: () => boardVisual('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2', 'black',
        [{ from: 'd8', to: 'h4', brush: 'good' }],
        [{ text: '0:18', tone: 'bad' }, { text: 'Qh4#', tone: 'good' }]),
    },
  ];

  const stage = document.createElement('div');
  stage.className = 'where-sc-stage';
  const sceneEls = scenes.map((s, i) => {
    const scene = document.createElement('div');
    scene.className = 'where-sc-scene';
    scene.setAttribute('role', 'group');
    scene.setAttribute('aria-label', `${i + 1} of ${scenes.length}: ${s.title}`);
    const head = document.createElement('div');
    head.className = 'where-sc-head';
    const h = document.createElement('p');
    h.className = 'where-sc-title';
    h.textContent = s.title;
    const sub = document.createElement('p');
    sub.className = 'where-sc-sub';
    sub.textContent = s.sub;
    head.append(h, sub);
    scene.append(head, s.visual());
    stage.appendChild(scene);
    return scene;
  });

  const controls = document.createElement('div');
  controls.className = 'where-sc-controls';
  const arrow = (label: string, icon: SVGElement, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'where-sc-arrow';
    b.setAttribute('aria-label', label);
    b.appendChild(icon);
    b.addEventListener('click', onClick);
    return b;
  };
  const steps = document.createElement('div');
  steps.className = 'where-sc-steps';
  const stepEls = scenes.map((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'where-sc-step';
    b.setAttribute('aria-label', s.title);
    b.addEventListener('click', () => show(i));
    // The next card when the bar fills; `animationend` is the only clock.
    b.addEventListener('animationend', () => { if (i === at) show(i + 1); });
    steps.appendChild(b);
    return b;
  });
  controls.append(
    arrow('Previous', Icons.chevronLeft(20), () => show(at - 1)),
    steps,
    arrow('Next', Icons.chevronRight(20), () => show(at + 1)),
  );
  el.append(stage, controls);

  let at = 0;
  function show(i: number): void {
    at = (i + scenes.length) % scenes.length;
    sceneEls.forEach((s, k) => {
      s.classList.toggle('where-sc-scene--on', k === at);
      s.setAttribute('aria-hidden', String(k !== at));
    });
    stepEls.forEach((s, k) => {
      s.classList.toggle('where-sc-step--on', k === at);
      s.classList.toggle('where-sc-step--done', k < at);
      if (k === at) s.setAttribute('aria-current', 'true');
      else s.removeAttribute('aria-current');
    });
  }
  show(0);
  return { el, redraw: () => requestAnimationFrame(() => boards.forEach(cg => cg.redrawAll())) };
}
