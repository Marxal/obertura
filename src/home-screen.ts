// Home — a dynamic overview of the whole app.
//
// WHAT IT IS FOR. Every other screen answers one question: what shall I train,
// what is in my book, how am I doing. Home answers "what is going on", and it is
// the only screen that mentions all of them. It is also the screen a returning
// user opens first, so what it shows has to be true TODAY — a figure that never
// moves belongs in the section it describes, not here.
//
// EVERYTHING HERE IS A STRIP OF BOARDS. Four of them, in the order the answers
// are useful: lines ready to grow, the mistakes your last games left behind, the
// moves you keep missing, the lines that keep slipping. Each is a horizontal
// swipe of the same card — a board, a line of text, a figure — because a board
// you can point at is the only summary of a chess position worth putting on an
// overview, and stacking four blocks of five cards would be six phone screens.
//
// WHAT WAS HERE AND ISN'T. A "Train" section repeating the four doors that are
// one tap away in the tab bar, and a "Your app" list of every nav destination
// with its count — both of them a menu of things Home is supposed to be showing
// you the state of. Home tells you what is waiting; the tab bar is how you get
// anywhere.
//
// The daily-challenge card is NOT built here — it lives in main.ts, because its
// eight launchers reach into every exercise in the app and the `liveDaily`
// indirection has to own them (see the long note above `liveDaily`). main.ts
// renders the card into a host above this body.

import type { Line } from './types';
import type { ImportedGame } from './import-core';
import { Icons } from './icons';
import { buildMiniBoard } from './board-mini';
import { getShowLineMiniatures } from './prefs';
import { colourPip } from './card-position';
import { formatMove } from './notation';
import { renderForgottenSection, buildStrip, buildStripBlock } from './forgotten-section';
import { autoScanState, onAutoScanChange, type AutoScanState } from './mistake-autoscan';
import type { GrowTarget } from './grow-line';
import type { SpotRef } from './mistake-scan';
import { CATEGORY_LABEL } from './mistake-run';

// How many cards each strip previews. Five is what the forgotten strips have
// always shown, and a strip is a swipe rather than a list — past five nobody is
// swiping, they are looking for a screen.
const PREVIEW = 5;

export interface HomeDeps {
  /** Open the builder on this line's Grow tab. */
  onGrow: (target: GrowTarget) => void;
  /** Drill these mistake spots. */
  onFixSpots: (refs: SpotRef[]) => void;
  /** A forgotten move: three reps of it, then the whole line. */
  onFixMove: (
    move: { preFen: string; san: string; colour: 'white' | 'black'; lapses: number },
    lines: Line[],
  ) => void;
  /** Drill one line start to finish (a Forgotten-moves row). */
  onDrillLine: (line: Line) => void;
  /** Open a line in the builder. */
  onOpenLine: (line: Line) => void;
  /** Repaint Home — used after anything here changes the numbers. */
  onRefresh: () => void;
}

export interface HomeData {
  lines: Line[];
  games: ImportedGame[];
  /** Lines ready to be extended, best first. */
  grow: GrowTarget[];
  /** Mistake spots from your games, newest first. */
  spots: SpotRef[];
}

/** Draw everything below the daily card. */
export function renderHomeBody(host: HTMLElement, data: HomeData, deps: HomeDeps): void {
  host.replaceChildren();

  const grow = buildGrowBlock(data, deps);
  if (grow) host.appendChild(grow);

  const mistakes = buildMistakesBlock(data, deps);
  if (mistakes) host.appendChild(mistakes);

  // Forgotten moves and forgotten lines arrive already shaped as blocks of the
  // same kind (forgotten-section.ts owns those cards and the sheets behind them).
  renderForgottenSection(host, data.lines, {
    onFixMove: (m, lines) => deps.onFixMove(
      { preFen: m.preFen, san: m.san, colour: m.colour, lapses: m.lapses }, lines),
    onDrillLine: (line) => deps.onDrillLine(line),
    onOpenLine: (line) => deps.onOpenLine(line),
    onStartTraining: () => deps.onRefresh(),
  });
}

// ── "Reading your games" ─────────────────────────────────────────────────────

/**
 * The scan banner, at the very top of Home and above the daily card.
 *
 * IT IS A NOTIFICATION, and it reads like one: it appears on its own, says one
 * thing, and leaves when it is done. Train has no Analyse button any more — the
 * scan runs itself from boot — so the one thing a user needs is to be told that
 * the empty exercises are filling up rather than broken.
 *
 * The dots animate because a number that only moves every few seconds is
 * indistinguishable from a number that has stopped. Exported so main.ts can put
 * it above the daily card rather than in the body.
 */
export function buildScanBanner(): HTMLElement | null {
  const initial = autoScanState();
  if (!initial.running) return null;

  const strip = document.createElement('div');
  strip.className = 'home-scan';
  strip.setAttribute('role', 'status');

  const icon = document.createElement('span');
  icon.className = 'home-scan-icon';
  icon.appendChild(Icons.review(18));
  strip.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'home-scan-text';
  strip.appendChild(text);

  const dots = document.createElement('span');
  dots.className = 'home-scan-dots';
  dots.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) dots.appendChild(document.createElement('i'));
  strip.appendChild(dots);

  const paint = (st: AutoScanState): void => {
    if (!st.running) { strip.remove(); stop(); return; }
    const left = Math.max(0, st.total - st.done);
    text.textContent = left > 0
      ? `Reading your games — ${left} to go`
      : 'Reading your games';
  };
  const stop = onAutoScanChange(paint);
  paint(initial);
  return strip;
}

// ── Grow your lines ──────────────────────────────────────────────────────────

/**
 * The lines you have mastered, with the replies you would be preparing for
 * drawn on the board.
 *
 * IT USED TO BE A NOTIFICATION — one card, one line, pinned above three screens
 * and swipeable away. That shape said "here is a thing to dismiss"; a strip of
 * boards says "here are three positions you know well enough to extend", which
 * is the actual offer. The arrows are the whole card: they are what you would be
 * answering, and naming three moves in text is a list to read rather than a
 * position to look at.
 */
function buildGrowBlock(data: HomeData, deps: HomeDeps): HTMLElement | null {
  if (data.grow.length === 0) return null;
  return buildStripBlock(
    'Ready to grow',
    `${data.grow.length} ${data.grow.length === 1 ? 'line' : 'lines'}`,
    buildStrip(data.grow.slice(0, PREVIEW).map(t => growCard(t, deps)), null),
  );
}

function growCard(target: GrowTarget, deps: HomeDeps): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'stats-sheet-card stats-forgotten-row';

  const colour = target.spot.line.colour;
  if (getShowLineMiniatures()) {
    const mini = document.createElement('span');
    mini.className = 'stats-forgotten-mini';
    mini.appendChild(buildMiniBoard(target.spot.fen, colour, {
      arrows: target.moves.map(m => m.uci),
    }));
    card.appendChild(mini);
  }

  const text = document.createElement('span');
  text.className = 'stats-sheet-text';

  const name = document.createElement('span');
  name.className = 'stats-sheet-name';
  name.appendChild(colourPip(colour));
  const label = document.createElement('span');
  label.className = 'stats-sheet-name-text';
  label.textContent = target.spot.line.name;
  name.appendChild(label);
  text.appendChild(name);

  const meta = document.createElement('span');
  meta.className = 'stats-sheet-meta';
  // Short and concrete. "You're mastering this line — prepare a reply and make
  // it grow" is the idea; on a card this size the idea has to fit two lines, and
  // the number is what makes it an offer rather than an encouragement.
  meta.textContent = target.moves.length === 1
    ? 'Mastered — answer the reply they play'
    : `Mastered — answer one of ${target.moves.length} replies they play`;
  text.appendChild(meta);
  card.appendChild(text);

  const go = document.createElement('span');
  go.className = 'home-grow-go';
  go.appendChild(Icons.sprout(20));
  card.appendChild(go);

  card.addEventListener('click', () => deps.onGrow(target));
  return card;
}

// ── From your last games ─────────────────────────────────────────────────────

/**
 * The mistakes the scan found, newest first, each on its own board.
 *
 * This is the carousel that used to sit under the Middle game pane. It came off
 * Train when that box was cut to seven exercise cards and nothing else, because
 * it is a thing you LOOK at rather than a thing you start — which is what Home
 * is for. Tapping one drills it, so it is still a way in.
 */
function buildMistakesBlock(data: HomeData, deps: HomeDeps): HTMLElement | null {
  const unfixed = data.spots.filter(r => !r.spot.fixed);
  if (unfixed.length === 0) return null;
  return buildStripBlock(
    'From your last games',
    `${unfixed.length} to fix`,
    buildStrip(
      unfixed.slice(0, PREVIEW).map(r => spotCard(r, deps)),
      unfixed.length > PREVIEW ? seeAllSpots(unfixed, deps) : null,
    ),
  );
}

function spotCard(ref: SpotRef, deps: HomeDeps): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'stats-sheet-card stats-forgotten-row';

  const { spot, game } = ref;
  if (getShowLineMiniatures()) {
    const mini = document.createElement('span');
    mini.className = 'stats-forgotten-mini';
    // The position BEFORE the mistake, with the move you actually played drawn
    // on it — the question, not the answer.
    mini.appendChild(buildMiniBoard(spot.preFen, game.colour, { arrows: [spot.playedUci] }));
    card.appendChild(mini);
  }

  const text = document.createElement('span');
  text.className = 'stats-sheet-text';

  const name = document.createElement('span');
  name.className = 'stats-sheet-name';
  name.appendChild(colourPip(game.colour));
  const label = document.createElement('span');
  label.className = 'stats-sheet-name-text';
  label.textContent = formatMove(spot.playedSan);
  name.appendChild(label);
  text.appendChild(name);

  const meta = document.createElement('span');
  meta.className = 'stats-sheet-meta';
  meta.textContent = `${CATEGORY_LABEL[spot.category]} · vs ${game.opponent || 'unknown'}`;
  text.appendChild(meta);
  card.appendChild(text);

  // How much the move actually cost, in pawns — the one figure that says why
  // this position is on the card rather than one of the other forty.
  const lost = Math.max(0, (spot.evalBefore - spot.evalAfter) / 100);
  const badge = document.createElement('span');
  badge.className = 'stats-miss-count';
  badge.textContent = lost >= 0.1 ? `−${lost.toFixed(1)}` : '';
  card.appendChild(badge);

  card.addEventListener('click', () => deps.onFixSpots([ref]));
  return card;
}

function seeAllSpots(refs: SpotRef[], deps: HomeDeps): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'stats-see-all';
  btn.textContent = `Fix all ${refs.length} →`;
  btn.addEventListener('click', () => deps.onFixSpots(refs.slice(0, 10)));
  return btn;
}
