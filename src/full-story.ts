// The full story — everything we know about one move of one of your games,
// behind the button that used to say "Analyse".
//
// WHY IT EXISTS. The exercises can afford two small rows of context under the
// board (spot-context.ts) and no more. But there are a dozen honest things to
// say about a mistake: what your clock was doing all game, how long the
// position had been slipping, whether your own repertoire already answers it,
// how many times this opening has caught you. Layering them behind one tap
// keeps the exercise an exercise and still gives the moment somewhere to go.
//
// WHY IT IS MOSTLY CHARTS. Two lines — your clock through the game and the
// evaluation through the game, both marked at this move — say more at a glance
// than a paragraph, and neither costs anything to draw: the clock trail is what
// the import now keeps (clock.ts) and the eval trail has been sitting unread on
// every scanned game since the mistake scan learned to keep it.
//
// "Analyse game" lives here now rather than beside "Next position". It is the
// deepest thing you can do with a position and the least often wanted, so it
// belongs at the bottom of the layer you opened on purpose — not competing for
// the thumb with the button that continues the run.

import { pushBack } from './back-nav';
import { Icons } from './icons';
import { formatMove } from './notation';
import { showCp } from './eval-chip';
import { formatClock, parseTimeControl, ownClockIndex } from './clock';
import {
  spotFacts, repertoireLinkAt, timesWrongInOpening, shortLineName,
  type RepertoireLink,
} from './spot-facts';
import { TIME_CLASS_LABELS } from './import-core';
import type { ImportedGame } from './import-core';

// The charts are drawn at a fixed viewBox and scaled by CSS — a phone's width
// varies, the shape of the line does not.
const CHART_W = 296;
const CHART_H = 54;

export interface FullStoryOptions {
  game: ImportedGame;
  /** 0-based ply of the move in question — always one of yours. */
  ply: number;
  /** The move as played, for the title. */
  playedSan: string;
  /**
   * Open the whole game in the analyser at this position. Omitted where the
   * caller has nowhere to hand off to, and the button then isn't drawn.
   */
  onAnalyse?: () => void;
}

/**
 * Open the sheet. Closes on the backdrop, on "Close", and on the back gesture,
 * exactly like every other sheet in the app.
 */
export function openFullStory(opts: FullStoryOptions): void {
  const { game, ply } = opts;
  const facts = spotFacts(game, ply);

  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet fs-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');

  // ── Head: which move, out of which game ───────────────────────────────────
  const title = document.createElement('h3');
  title.className = 'edit-sheet-title fs-title';
  title.textContent = `Move ${facts.moveNumber} · ${formatMove(opts.playedSan)}`;
  sheet.appendChild(title);

  const sub = document.createElement('p');
  sub.className = 'fs-sub';
  sub.textContent = [
    `vs ${game.opponent}`,
    timeControlLabel(game),
    facts.when,
  ].filter(Boolean).join(' · ');
  sheet.appendChild(sub);

  // ── The two charts ────────────────────────────────────────────────────────
  const clockChart = buildClockChart(game, ply);
  if (clockChart) sheet.appendChild(clockChart);

  const evalChart = buildEvalChart(game, ply);
  if (evalChart) sheet.appendChild(evalChart);

  // ── The repertoire link, when there is one ────────────────────────────────
  const bookSlot = document.createElement('div');
  sheet.appendChild(bookSlot);
  void repertoireLinkAt(game, ply).then((link) => {
    if (link && bookSlot.isConnected) bookSlot.appendChild(bookCard(link));
  }).catch(() => { /* a bonus, not a dependency */ });

  // ── The tiles ─────────────────────────────────────────────────────────────
  const tiles = document.createElement('div');
  tiles.className = 'fs-tiles';
  tiles.appendChild(tile('It cost you', costValue(game), `fs-tile-v--${game.result}`));
  if (facts.ratingGap !== null && facts.ratingGap !== 0) {
    const gap = Math.abs(facts.ratingGap);
    tiles.appendChild(tile('Rating gap', `${gap} ${facts.ratingGap > 0 ? 'up' : 'down'}`));
  }
  if (facts.wobblesBefore !== null && facts.wobblesBefore > 0) {
    const n = facts.wobblesBefore;
    tiles.appendChild(tile('Before this', `${n} slip${n === 1 ? '' : 's'}`));
  }
  sheet.appendChild(tiles);

  // The repeat count reads every stored game, so it lands late — and only when
  // it is more than one, since "1st time" is not a finding.
  void timesWrongInOpening(game).then((times) => {
    if (!times || !tiles.isConnected) return;
    tiles.appendChild(tile('In this opening', `${ordinal(times)} time`, 'fs-tile-v--warn'));
  }).catch(() => { /* the library may be mid-import; the tile just doesn't come */ });

  // ── Actions ───────────────────────────────────────────────────────────────
  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  }

  const row = document.createElement('div');
  row.className = 'dialog-btn-row';
  if (opts.onAnalyse) {
    const analyse = document.createElement('button');
    analyse.type = 'button';
    analyse.className = 'dialog-btn btn-secondary';
    analyse.appendChild(Icons.review(16));
    analyse.appendChild(document.createTextNode('Analyse game'));
    analyse.addEventListener('click', () => { close(); opts.onAnalyse?.(); });
    row.appendChild(analyse);
  }
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'dialog-btn btn-primary';
  done.textContent = 'Close';
  done.addEventListener('click', close);
  row.appendChild(done);
  sheet.appendChild(row);

  const removeBack = pushBack(close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

// ── The charts ────────────────────────────────────────────────────────────────

/**
 * Your clock, move by move, with a dot where this one was. The single most
 * persuasive way to say "you were low on time": a line falling off a cliff
 * needs no sentence under it.
 *
 * Null when the game has no clock trail — an older import, or correspondence.
 */
function buildClockChart(game: ImportedGame, ply: number): HTMLElement | null {
  const clocks = game.clocks;
  if (!clocks || clocks.length < 3) return null;
  const tc = parseTimeControl(game.timeControl);
  if (!tc) return null;
  const idx = ownClockIndex(ply, game.colour);
  if (idx < 0 || idx >= clocks.length) return null;

  // Scaled to the highest reading rather than the base time: an increment game
  // can climb above its own base, and a line that leaves the top of the chart
  // reads as a bug.
  const top = Math.max(tc.baseSec, ...clocks);
  const points = clocks.map((sec, i) => {
    const x = (i / Math.max(1, clocks.length - 1)) * CHART_W;
    const y = CHART_H - 8 - (sec / top) * (CHART_H - 14);
    return { x, y };
  });

  const card = chartCard('Your clock', `${formatClock(clocks[idx])} left here`, 'fs-note--warn');
  const svg = chartSvg(`Your clock through the game, ${formatClock(clocks[idx])} left at this move`);
  svg.appendChild(line(0, CHART_H - 8, CHART_W, CHART_H - 8, 'fs-axis'));
  svg.appendChild(path(points, 'fs-clock-line'));
  svg.appendChild(dot(points[idx]));
  card.appendChild(svg);
  return card;
}

/**
 * The evaluation through the game, from your side, with the same move marked.
 * Read off the mistake scan's stored trail, which nothing has drawn until now.
 */
function buildEvalChart(game: ImportedGame, ply: number): HTMLElement | null {
  const trail = game.retry?.trail;
  if (!trail || trail.length < 4) return null;

  // The trail is white-perspective centipawns; clamp to ±600 so one mate score
  // doesn't flatten the whole line into the middle of the chart.
  const CLAMP = 600;
  const pts: { x: number; y: number }[] = [];
  for (let p = 0; p < trail.length; p++) {
    const raw = trail[p];
    if (raw == null) continue;
    const mine = game.colour === 'white' ? raw : -raw;
    const clamped = Math.max(-CLAMP, Math.min(CLAMP, mine));
    pts.push({
      x: (p / Math.max(1, trail.length - 1)) * CHART_W,
      // +CLAMP at the top, −CLAMP at the bottom, level through the middle.
      y: (CHART_H / 2) - (clamped / CLAMP) * (CHART_H / 2 - 6),
    });
  }
  if (pts.length < 4) return null;

  const before = trail[ply];
  const after = trail[ply + 1];
  const swing = before != null && after != null
    ? `${showCp(game.colour === 'white' ? before : -before)} → ${showCp(game.colour === 'white' ? after : -after)}`
    : '';

  const card = chartCard('The game', swing, 'fs-note--danger');
  const svg = chartSvg('The evaluation through the game, dropping at this move');
  svg.appendChild(line(0, CHART_H / 2, CHART_W, CHART_H / 2, 'fs-axis'));
  svg.appendChild(path(pts, 'fs-eval-line'));
  const here = pts[Math.min(ply + 1, pts.length - 1)];
  if (here) svg.appendChild(dot(here));
  card.appendChild(svg);
  return card;
}

// ── Small builders ────────────────────────────────────────────────────────────

function chartCard(label: string, note: string, noteCls: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'fs-card';
  const head = document.createElement('div');
  head.className = 'fs-card-head';
  const l = document.createElement('span');
  l.className = 'fs-card-label';
  l.textContent = label;
  head.appendChild(l);
  if (note) {
    const n = document.createElement('span');
    n.className = `fs-note ${noteCls}`;
    n.textContent = note;
    head.appendChild(n);
  }
  card.appendChild(head);
  return card;
}

function chartSvg(label: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${CHART_W} ${CHART_H}`);
  svg.setAttribute('class', 'fs-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  return svg;
}

function path(points: { x: number; y: number }[], cls: string): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  el.setAttribute('points', points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
  el.setAttribute('class', cls);
  return el;
}

function line(x1: number, y1: number, x2: number, y2: number, cls: string): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  el.setAttribute('x1', String(x1));
  el.setAttribute('y1', String(y1));
  el.setAttribute('x2', String(x2));
  el.setAttribute('y2', String(y2));
  el.setAttribute('class', cls);
  return el;
}

function dot(at: { x: number; y: number }): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  el.setAttribute('cx', at.x.toFixed(1));
  el.setAttribute('cy', at.y.toFixed(1));
  el.setAttribute('r', '4');
  el.setAttribute('class', 'fs-dot');
  return el;
}

function tile(label: string, value: string, valueCls = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = 'fs-tile';
  const l = document.createElement('div');
  l.className = 'fs-tile-l';
  l.textContent = label;
  el.appendChild(l);
  const v = document.createElement('div');
  v.className = `fs-tile-v ${valueCls}`.trim();
  v.textContent = value;
  el.appendChild(v);
  return el;
}

function bookCard(link: RepertoireLink): HTMLElement {
  const card = document.createElement('div');
  card.className = 'fs-book';
  card.appendChild(Icons.book(17));
  const text = document.createElement('span');
  text.className = 'fs-book-text';
  const head = document.createElement('span');
  head.className = 'fs-book-head';
  const name = shortLineName(link.lineName);
  head.textContent = link.kind === 'covered'
    ? `Your ${name} plays ${formatMove(link.san ?? '')} here`
    : `${link.movesPast} move${link.movesPast === 1 ? '' : 's'} past your ${name}`;
  text.appendChild(head);
  const sub = document.createElement('span');
  sub.className = 'fs-book-sub';
  sub.textContent = link.kind === 'covered'
    ? 'You have already worked this out'
    : 'Where your preparation stopped';
  text.appendChild(sub);
  card.appendChild(text);
  return card;
}

// ── Words ─────────────────────────────────────────────────────────────────────

function timeControlLabel(game: ImportedGame): string {
  const tc = parseTimeControl(game.timeControl);
  const speed = TIME_CLASS_LABELS[game.timeClass].toLowerCase();
  return tc ? `${tc.baseSec / 60}+${tc.incSec} ${speed}` : speed;
}

function costValue(game: ImportedGame): string {
  if (game.result === 'loss') return 'the game';
  if (game.result === 'win') return 'nothing';
  return 'a draw';
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

// Re-exported so the exercises can label their button with the same words the
// sheet answers to, without importing the label from four places.
export const FULL_STORY_LABEL = 'The full story';
