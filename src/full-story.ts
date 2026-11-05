// The full story — everything we know about one move of one of your games.
//
// WHY IT EXISTS. The exercises can afford two small rows of context under the
// board (spot-context.ts) and no more. But there are a dozen honest things to
// say about a mistake: what your clock was doing all game, how long the
// position had been slipping, whether your own repertoire already answers it,
// how many times this opening has caught you. This is where those live.
//
// WHY IT IS MOSTLY CHARTS. Two lines — your clock through the game and the
// evaluation through the game, both marked at this move — say more at a glance
// than a paragraph, and neither costs anything to draw: the clock trail is what
// the import now keeps (clock.ts) and the eval trail has been sitting unread on
// every scanned game since the mistake scan learned to keep it.
//
// USED TO BE A POPUP behind a button that read "About this move". It now
// renders straight into the run's own scrollable area, right under the two
// small rows spot-context.ts already draws — so the story is there to read by
// scrolling, not a tap (and a whole sheet transition) away. "Analyse game"
// moved out to the run's fixed footer, next to "Next position", since it no
// longer needs a layer of its own to stand in.

import { Icons } from './icons';
import { formatMove } from './notation';
import { showCp } from './eval-chip';
import { formatClock, parseTimeControl, ownClockIndex } from './clock';
import { analysePosition, sanLineToUci, type MoveEval } from './engine';
import { evalBarFill } from './eval-panel';
import { buildLineStrip } from './reply-line-strip';
import { fenAfter } from './which-move';
import {
  spotFacts, repertoireLinkAt, openingRecord, shortLineName, whenLabel,
  type RepertoireLink, type OpeningRecord,
} from './spot-facts';
import { TIME_CLASS_LABELS } from './import-core';
import type { ImportedGame } from './import-core';
import { t } from './i18n';

// The charts are drawn at a fixed viewBox and scaled by CSS — a phone's width
// varies, the shape of the line does not.
const CHART_W = 296;
const CHART_H = 54;

export interface StoryOptions {
  /**
   * Inside a run, whose own head already shows the result as a pill and whose own
   * clock bar shows the time, so the story doesn't say either again.
   */
  inRun?: boolean;
  /** Tapping a game in "this opening" opens it. */
  onOpenGame?: (gameId: string) => void;
}

/**
 * The story — the charts, the repertoire link and the fact tiles.
 *
 * Two homes: the run's own scrollable area, right under the exercise's answer,
 * and the results-row popup (spot-peek.ts), where it sits under the board it
 * is about. One builder, so the two can never drift into saying different
 * things about the same move — `opts` is entirely optional, so a caller with
 * nowhere to plug an interaction into (spot-peek's own read-only mini board)
 * still gets the full content, just not the tap-through.
 *
 * The async facts append themselves when they arrive; a caller that unmounts
 * the element before then simply never sees them (each checks isConnected).
 */
export function buildStoryContent(game: ImportedGame, ply: number, opts: StoryOptions = {}): HTMLElement {
  const host = document.createElement('div');
  host.className = 'fs-story';
  const facts = spotFacts(game, ply);

  const clockChart = buildClockChart(game, ply, opts.inRun);
  if (clockChart) host.appendChild(clockChart);

  const evalChart = buildEvalChart(game, ply);
  if (evalChart) host.appendChild(evalChart);

  const bookSlot = document.createElement('div');
  host.appendChild(bookSlot);
  void repertoireLinkAt(game, ply).then((link) => {
    if (link && bookSlot.isConnected) bookSlot.appendChild(bookCard(link));
  }).catch(() => { /* a bonus, not a dependency */ });

  const tiles = document.createElement('div');
  tiles.className = 'fs-tiles';
  // WHAT THE GAME DID, not what the move cost. "It cost you the game" and "it
  // cost you nothing" both left the actual result to be inferred, which is a
  // strange thing to make someone do about their own game — so the tile names
  // the result outright, in the colour it deserves.
  if (!opts.inRun) tiles.appendChild(tile(t('story.thisGame'), RESULT_WORD[game.result], `fs-tile-v--${game.result}`));
  tiles.appendChild(tile(t('story.timeControl'), timeControlLabel(game)));
  // Both ratings, not the gap between them. The gap is arithmetic anyone can do
  // from the two numbers, and the numbers are the ones you would actually
  // recognise — "1520 vs 1370" says who you were playing at the time.
  if (game.myRating != null && game.opponentRating != null) {
    tiles.appendChild(tile(t('story.ratings'), `${game.myRating} vs ${game.opponentRating}`));
  } else if (game.myRating != null) {
    tiles.appendChild(tile(t('stats.yourRating'), String(game.myRating)));
  } else if (game.opponentRating != null) {
    tiles.appendChild(tile(t('story.theirRating'), String(game.opponentRating)));
  }
  if (facts.wobblesBefore !== null && facts.wobblesBefore > 0) {
    const n = facts.wobblesBefore;
    tiles.appendChild(tile(t('story.beforeThis'), `${n} slip${n === 1 ? '' : 's'}`));
    tiles.appendChild(tile(t('story.move'), String(facts.moveNumber)));
    if (game.opening) tiles.appendChild(wideTile(t('story.opening'), game.opening));
  } else {
    // No slip to pair the move number with, so it rides with the opening: the grid
    // is two across, and a tile alone on a row looks like something went missing.
    tiles.appendChild(game.opening
      ? wideTile(t('story.openingMove', { moveNumber: facts.moveNumber }), game.opening)
      : wideTile(t('story.move'), String(facts.moveNumber)));
  }
  host.appendChild(tiles);

  const recordSlot = document.createElement('div');
  host.appendChild(recordSlot);
  void openingRecord(game).then((record) => {
    if (!record || !recordSlot.isConnected) return;
    recordSlot.appendChild(openingRecordCard(record, opts.onOpenGame));
  }).catch(() => { /* the library may be mid-import; the card just doesn't come */ });

  return host;
}

// ── The charts ────────────────────────────────────────────────────────────────

/**
 * Your clock, move by move, with a dot where this one was. The single most
 * persuasive way to say "you were low on time": a line falling off a cliff
 * needs no sentence under it.
 *
 * Null when the game has no clock trail — an older import, or correspondence.
 */
function buildClockChart(game: ImportedGame, ply: number, quiet = false): HTMLElement | null {
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

  const card = chartCard(t('story.yourClock'), quiet ? '' : t('story.clockLeft', { time: formatClock(clocks[idx]) }), 'fs-note--warn');
  const svg = chartSvg(t('story.clockLabel', { time: formatClock(clocks[idx]) }));
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

  const card = chartCard(t('story.theGame'), swing, 'fs-note--danger');
  const svg = chartSvg(t('story.theEvaluationThroughThe'));
  svg.appendChild(line(0, CHART_H / 2, CHART_W, CHART_H / 2, 'fs-axis'));
  svg.appendChild(path(pts, 'fs-eval-line'));
  const here = pts[Math.min(ply + 1, pts.length - 1)];
  if (here) svg.appendChild(dot(here));
  card.appendChild(svg);
  return card;
}

export interface EngineLineOptions {
  preFen: string;
  best: MoveEval;
  /** The engine's other picks: they count as an answer in the drill too. */
  also?: MoveEval[];
  /** The move that went wrong, for "why it doesn't work". */
  played?: { san: string; uci: string };
  /** Put the position after these moves from `preFen` on the board; none is `preFen`. */
  onPreview: (ucis: string[]) => void;
}

/**
 * The eval bar from the builder's engine dock, for whatever the panel has on the board.
 * It opens on the engine's own figure for the position. Stepping through a line asks
 * local Stockfish about each new position, briefly, once, and a newer step wins.
 */
function buildPanelEvalBar(best: MoveEval): {
  el: HTMLElement;
  show: (fen: string, panel: HTMLElement) => void;
} {
  const el = document.createElement('div');
  el.className = 'eval-bar-wrap fs-engine-bar';
  el.setAttribute('aria-hidden', 'true');
  const track = document.createElement('div');
  track.className = 'eval-bar';
  const fill = document.createElement('div');
  fill.className = 'eval-bar-fill';
  track.appendChild(fill);
  const score = document.createElement('span');
  score.className = 'eval-score';
  el.append(track, score);

  const paint = (m: MoveEval): void => {
    const cp = m.mate !== undefined ? (m.mate > 0 ? 9999 : -9999) : (m.cp ?? 0);
    fill.style.width = `${evalBarFill(cp)}%`;
    score.textContent = m.mate !== undefined
      ? `${m.mate > 0 ? '' : '-'}M${Math.abs(m.mate)}`
      : `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(1)}`;
  };
  paint(best);

  const known = new Map<string, MoveEval>();
  let turn = 0;
  return {
    el,
    show(fen, panel) {
      const mine = ++turn;
      const held = known.get(fen);
      if (held) { paint(held); return; }
      void analysePosition(fen, 12, import.meta.env.BASE_URL, { multiPv: 1, movetimeMs: 500 })
        .then((moves) => {
          if (!moves[0]) return;
          known.set(fen, moves[0]);
          if (mine === turn && panel.isConnected) paint(moves[0]);
        })
        .catch(() => { /* the bar keeps its last figure */ });
    },
  };
}

const PLY_AFTER = (fen: string): number => {
  const parts = fen.split(' ');
  return (Number(parts[5] || 1) - 1) * 2 + (parts[1] === 'b' ? 1 : 0);
};

/**
 * The engine, on demand: a small button beside the verdict, and a panel by the board.
 *
 * Its lines use the move row from Add a missing reply (reply-line-strip.ts): one row
 * that scrolls sideways, with back and forward, and the move on the board lit up.
 * Only one row is "on the board" at a time, so stepping through one clears the other.
 *
 * "Why it doesn't work" is the engine's answer to the move you played. The scan didn't
 * keep that, so it's asked for the first time the panel opens: local Stockfish, a second
 * or so, and nothing leaves the device.
 */
export function placeEngineLine(row: HTMLElement, o: EngineLineOptions): void {
  clearEngineLine(row);

  const panel = document.createElement('div');
  panel.className = 'fs-engine-panel';
  panel.hidden = true;
  const startPly = PLY_AFTER(o.preFen);
  const rows: { clear: () => void }[] = [];
  const bar = buildPanelEvalBar(o.best);
  panel.appendChild(bar.el);
  // Every position the panel puts on the board, with its evaluation following.
  const show = (ucis: string[]): void => {
    o.onPreview(ucis);
    bar.show(ucis.reduce((fen, uci) => fenAfter(fen, uci), o.preFen), panel);
  };

  const lineBlock = (
    heading: string, sans: string[], ucis: string[], prefix: string[], firstPly: number, at: number,
  ): HTMLElement => {
    const block = document.createElement('div');
    block.className = 'fs-engine-block';
    const h = document.createElement('div');
    h.className = 'fs-engine-head';
    h.textContent = heading;
    const strip = buildLineStrip((i) => {
      for (const r of rows) r.clear();
      strip.update(sans, i, Infinity, firstPly);
      show([...prefix, ...ucis.slice(0, i)]);
    });
    strip.update(sans, at, Infinity, firstPly);
    rows.push({ clear: () => strip.update(sans, 0, Infinity, firstPly) });
    block.append(h, strip.el);
    return block;
  };

  const sanLine = o.best.sanLine ?? [o.best.san];
  const ucis = sanLineToUci(o.preFen, sanLine);
  if (ucis.length > 0) {
    panel.appendChild(lineBlock(t('story.theEngineSLine'), sanLine.slice(0, ucis.length), ucis, [], startPly, 0));
  }

  const also = (o.also ?? []).filter(m => m.uci);
  if (also.length > 0) {
    const block = document.createElement('div');
    block.className = 'fs-engine-block fs-engine-also';
    const h = document.createElement('span');
    h.className = 'fs-engine-head';
    h.textContent = t('story.alsoGood');
    block.appendChild(h);
    for (const m of also) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'fs-engine-chip';
      chip.textContent = formatMove(m.san);
      chip.addEventListener('click', () => {
        for (const r of rows) r.clear();
        show([m.uci]);
      });
      block.appendChild(chip);
    }
    panel.appendChild(block);
  }

  let whySlot: HTMLElement | null = null;
  if (o.played) {
    whySlot = document.createElement('div');
    whySlot.className = 'fs-engine-block';
    panel.appendChild(whySlot);
  }
  const askWhy = (): void => {
    const played = o.played;
    const slot = whySlot;
    if (!played || !slot || slot.childElementCount > 0) return;
    const fen = fenAfter(o.preFen, played.uci);
    const heading = `Why ${formatMove(played.san)} doesn’t work`;
    const h = document.createElement('div');
    h.className = 'fs-engine-head';
    h.textContent = heading;
    const wait = document.createElement('div');
    wait.className = 'fs-engine-wait';
    wait.textContent = t('where.looking');
    slot.append(h, wait);
    void analysePosition(fen, 14, import.meta.env.BASE_URL, { multiPv: 1, movetimeMs: 1500 })
      .then((moves) => {
        if (!slot.isConnected) return;
        const answer = moves[0];
        const line = answer?.sanLine ?? (answer ? [answer.san] : []);
        const lineUcis = line.length ? sanLineToUci(fen, line) : [];
        if (lineUcis.length === 0) { slot.replaceChildren(); return; }
        slot.replaceChildren(...lineBlock(
          heading, line.slice(0, lineUcis.length), lineUcis, [played.uci], PLY_AFTER(fen), 0,
        ).childNodes);
      })
      .catch(() => { if (slot.isConnected) slot.replaceChildren(); });
  };

  if (panel.childElementCount === 0) return;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'fs-engine-btn';
  const paint = (): void => {
    toggle.replaceChildren(
      t('story.engine'),
      panel.hidden ? Icons.chevronDown(14) : Icons.chevronUp(14),
    );
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  };
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    paint();
    if (!panel.hidden) askWhy();
  });
  paint();

  row.classList.add('fs-verdict');
  row.append(toggle, panel);
}

export function clearEngineLine(row: HTMLElement): void {
  row.querySelector('.fs-engine-btn')?.remove();
  row.querySelector('.fs-engine-panel')?.remove();
  row.classList.remove('fs-verdict');
}

/** Who and how, before the answer: Home's "Learn from your last games" uses it. */
export function buildGameTiles(game: ImportedGame): HTMLElement {
  const tiles = document.createElement('div');
  tiles.className = 'fs-tiles';
  tiles.appendChild(tile(t('story.opponent'), game.opponent));
  tiles.appendChild(tile(t('story.when'), whenLabel(game.endTime)));
  tiles.appendChild(tile(t('story.timeControl'), timeControlLabel(game)));
  if (game.myRating != null && game.opponentRating != null) {
    tiles.appendChild(tile(t('story.ratings'), `${game.myRating} vs ${game.opponentRating}`));
  } else if (game.opponentRating != null) {
    tiles.appendChild(tile(t('story.theirRating'), String(game.opponentRating)));
  }
  if (game.opening) tiles.appendChild(wideTile(t('story.opening'), game.opening));
  return tiles;
}

/**
 * "This opening" — how many of your games it has caught you in, and where:
 * up to OPENING_RECORD_CAP of the others, newest first, each one a tap into
 * its own analyser when `onOpenGame` is given. The count alone (the old "Nth
 * time" tile) said the fact; this makes it something to act on.
 */
function openingRecordCard(record: OpeningRecord, onOpenGame?: (gameId: string) => void): HTMLElement {
  const card = chartCard(t('story.thisOpening'), `${ordinal(record.count)} time`, 'fs-note--warn');
  const list = document.createElement('div');
  list.className = 'fs-record';
  for (const e of record.entries) {
    const row = document.createElement(onOpenGame ? 'button' : 'div');
    row.className = 'fs-record-row';
    if (onOpenGame) {
      (row as HTMLButtonElement).type = 'button';
      row.addEventListener('click', () => onOpenGame(e.gameId));
    }
    const when = document.createElement('span');
    when.className = 'fs-record-when';
    when.textContent = e.when;
    row.appendChild(when);
    const vs = document.createElement('span');
    vs.className = 'fs-record-vs';
    vs.textContent = `vs ${e.opponent}`;
    row.appendChild(vs);
    const result = document.createElement('span');
    result.className = `fs-record-result fs-record-result--${e.result}`;
    result.textContent = RESULT_WORD[e.result];
    row.appendChild(result);
    if (onOpenGame) row.appendChild(Icons.chevronRight(13));
    list.appendChild(row);
  }
  card.appendChild(list);
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

function wideTile(label: string, value: string): HTMLElement {
  const el = tile(label, value);
  el.classList.add('fs-tile--wide');
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
    : t('story.movesPast', { n: link.movesPast ?? 0, name });
  text.appendChild(head);
  const sub = document.createElement('span');
  sub.className = 'fs-book-sub';
  sub.textContent = link.kind === 'covered'
    ? t('story.youHaveAlreadyWorked')
    : t('story.whereYourPreparationStopped');
  text.appendChild(sub);
  card.appendChild(text);
  return card;
}

// ── Words ─────────────────────────────────────────────────────────────────────

// The result in one word, said rather than implied.
const RESULT_WORD: Record<ImportedGame['result'], string> = {
  loss: t('showcase.lost'),
  win: t('showcase.won'),
  draw: t('story.drawn'),
};

// "5+0 Blitz" — falls back to just the speed for a time control clock.ts
// can't parse (daily/correspondence games have none to parse).
function timeControlLabel(game: ImportedGame): string {
  const tc = parseTimeControl(game.timeControl);
  const speed = TIME_CLASS_LABELS[game.timeClass];
  return tc ? `${tc.baseSec / 60}+${tc.incSec} ${speed}` : speed;
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

