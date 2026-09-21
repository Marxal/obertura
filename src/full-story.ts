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
import { formatMove, pvMoveParts } from './notation';
import { showCp } from './eval-chip';
import { formatClock, parseTimeControl, ownClockIndex } from './clock';
import { sanLineToUci, type MoveEval } from './engine';
import {
  spotFacts, repertoireLinkAt, openingRecord, shortLineName,
  type RepertoireLink, type OpeningRecord,
} from './spot-facts';
import { TIME_CLASS_LABELS } from './import-core';
import type { ImportedGame } from './import-core';

// The charts are drawn at a fixed viewBox and scaled by CSS — a phone's width
// varies, the shape of the line does not.
const CHART_W = 296;
const CHART_H = 54;

export interface StoryOptions {
  /**
   * The engine's line at this move (a MistakeSpot/DetectiveSpot/EvalPairSpot's
   * `best[0]` and `preFen`) — rendered as "the engine's idea" when the scan
   * kept more than the one move. Left out entirely by Brilliant Moves, whose
   * spots have no alternative to show (the move you found already was one).
   */
  continuation?: { preFen: string; best: MoveEval };
  /**
   * Tapping a move of the continuation — plays the position up to that point
   * onto the caller's own board, the same way tapping either side of the
   * red/green comparison already flips the board to that move.
   */
  onPreviewLine?: (ucis: string[]) => void;
  /** Tapping a game in "this opening" opens it. */
  onOpenGame?: (gameId: string) => void;
}

/**
 * The story — the charts, the engine's continuation, the repertoire link and
 * the fact tiles.
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

  const clockChart = buildClockChart(game, ply);
  if (clockChart) host.appendChild(clockChart);

  const evalChart = buildEvalChart(game, ply);
  if (evalChart) host.appendChild(evalChart);

  if (opts.continuation) {
    const card = continuationCard(opts.continuation.preFen, opts.continuation.best, opts.onPreviewLine);
    if (card) host.appendChild(card);
  }

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
  tiles.appendChild(tile('This game', RESULT_WORD[game.result], `fs-tile-v--${game.result}`));
  tiles.appendChild(tile('Time control', timeControlLabel(game)));
  // Both ratings, not the gap between them. The gap is arithmetic anyone can do
  // from the two numbers, and the numbers are the ones you would actually
  // recognise — "1520 vs 1370" says who you were playing at the time.
  if (game.myRating != null && game.opponentRating != null) {
    tiles.appendChild(tile('Ratings', `${game.myRating} vs ${game.opponentRating}`));
  } else if (game.myRating != null) {
    tiles.appendChild(tile('Your rating', String(game.myRating)));
  } else if (game.opponentRating != null) {
    tiles.appendChild(tile('Their rating', String(game.opponentRating)));
  }
  if (facts.wobblesBefore !== null && facts.wobblesBefore > 0) {
    const n = facts.wobblesBefore;
    tiles.appendChild(tile('Before this', `${n} slip${n === 1 ? '' : 's'}`));
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

/**
 * "The engine's idea" — not just what it wanted, but what would have
 * followed (MoveEval.sanLine, kept by the scan for exactly this). Each move
 * is its own element: given `onPreview`, tapping one plays the position up to
 * that point onto the caller's board — the same interaction the engine dock's
 * own PV chips already teach (engine-panel.ts), so this reads the position
 * the way opening the analyser would, without leaving the exercise.
 *
 * Null when the scan kept no continuation worth showing — an older scan (no
 * sanLine), or a line that never got past the recommended move itself.
 */
function continuationCard(
  preFen: string, best: MoveEval, onPreview?: (ucis: string[]) => void,
): HTMLElement | null {
  const sanLine = best.sanLine;
  if (!sanLine || sanLine.length < 2) return null;

  // The line can stop early if a stored move turns out illegal at replay (it
  // shouldn't, but a foreign/corrupted record is not worth a crash over) — the
  // two walks are kept in lockstep by capping the SAN side to what replayed.
  const ucis = sanLineToUci(preFen, sanLine);
  const parts = pvMoveParts(sanLine.slice(0, ucis.length), preFen);
  if (parts.length < 2) return null;

  const card = chartCard('The engine’s idea', '', '');
  const row = document.createElement('div');
  row.className = 'fs-pv';
  parts.forEach((p, i) => {
    const chip = document.createElement(onPreview ? 'button' : 'span');
    chip.className = 'fs-pv-move';
    chip.textContent = `${p.prefix}${p.san}`;
    if (onPreview) {
      (chip as HTMLButtonElement).type = 'button';
      const upTo = ucis.slice(0, i + 1);
      chip.addEventListener('click', () => onPreview(upTo));
    }
    row.appendChild(chip);
  });
  card.appendChild(row);
  return card;
}

/**
 * "This opening" — how many of your games it has caught you in, and where:
 * up to OPENING_RECORD_CAP of the others, newest first, each one a tap into
 * its own analyser when `onOpenGame` is given. The count alone (the old "Nth
 * time" tile) said the fact; this makes it something to act on.
 */
function openingRecordCard(record: OpeningRecord, onOpenGame?: (gameId: string) => void): HTMLElement {
  const card = chartCard('This opening', `${ordinal(record.count)} time`, 'fs-note--warn');
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

// The result in one word, said rather than implied.
const RESULT_WORD: Record<ImportedGame['result'], string> = {
  loss: 'Lost',
  win: 'Won',
  draw: 'Drawn',
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

