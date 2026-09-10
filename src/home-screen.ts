// Home — a dynamic overview of the whole app.
//
// WHAT IT IS FOR. Every other screen answers one question: what shall I train,
// what is in my book, how am I doing. Home answers "what is going on", and it is
// the only screen that mentions all of them. It is also the screen a returning
// user opens first, so what it shows has to be true TODAY — a figure that never
// moves belongs in the section it describes, not here.
//
// WHAT IT IS NOT. Not a second Train menu. The four training entries here are
// one compact row that carries each domain's live figure and lands you on Train;
// Train is where the doors and the boxes are. The rule that keeps the two apart:
// **Home has one card per section of the app, Train has one door per kind of
// training.** If Home ever starts listing exercises, it has become Train.
//
// The daily-challenge card is NOT built here — it lives in main.ts, because its
// eight launchers reach into every exercise in the app and the `liveDaily`
// indirection has to own them (see the long note above `liveDaily`). main.ts
// renders the card into a host above this body.

import type { Line } from './types';
import type { ImportedGame } from './import-core';
import { Icons } from './icons';
import { DOMAIN_ACCENT } from './train-doors';
import { renderForgottenSection } from './forgotten-section';
import { formatGameDate } from './my-games-screen';
import { currentStreak } from './streak';
import { autoScanState, onAutoScanChange, type AutoScanState } from './mistake-autoscan';

export interface HomeDeps {
  /** Land on one of the tabs. */
  onOpenView: (view: 'train' | 'explore' | 'games' | 'progress') => void;
  /** A forgotten move: three reps of it, then the whole line. */
  onFixMove: (
    move: { preFen: string; san: string; colour: 'white' | 'black'; lapses: number },
    lines: Line[],
  ) => void;
  /** Drill one line start to finish (a Forgotten-moves row). */
  onDrillLine: (line: Line) => void;
  /** Open a line in the builder. */
  onOpenLine: (line: Line) => void;
  /** Open a game in the analyser. */
  onOpenGame: (game: ImportedGame) => void;
  /** Repaint Home — used after anything here changes the numbers. */
  onRefresh: () => void;
}

export interface HomeData {
  lines: Line[];
  games: ImportedGame[];
  /** Moves due through the repertoire run — the Openings door's figure. */
  dueMoves: number;
  /** Lines due, counted the other way. */
  dueLines: number;
  /** Mistake spots found but not yet fixed — the Middlegame door's figure. */
  spotsToFix: number;
  puzzleRating: number;
  endgameRating: number;
}

/**
 * Draw everything below the daily card. Called on every Home paint; the
 * autoscan strip subscribes and unsubscribes with it.
 */
export function renderHomeBody(host: HTMLElement, data: HomeData, deps: HomeDeps): void {
  host.replaceChildren();

  host.appendChild(buildTrainRow(data, deps));

  // The scan banner needs no heading — it is one sentence that says what it is,
  // and it is only here at all while the pass is running.
  const scan = buildScanStrip();
  if (scan) host.appendChild(scan);

  // Forgotten moves and forgotten lines, each its own titled block with its own
  // count. They used to be one boxed card behind a Moves/Lines toggle, which
  // framed them twice over and kept half of the answer hidden; they arrive here
  // already shaped as Home sections (forgotten-section.ts).
  renderForgottenSection(host, data.lines, {
    onFixMove: (m, lines) => deps.onFixMove(
      { preFen: m.preFen, san: m.san, colour: m.colour, lapses: m.lapses }, lines),
    onDrillLine: (line) => deps.onDrillLine(line),
    onOpenLine: (line) => deps.onOpenLine(line),
    onStartTraining: () => deps.onRefresh(),
  });

  host.appendChild(buildSections(data, deps));
}

// ── The four training entries ────────────────────────────────────────────────

// WHY THESE LAND ON TRAIN RATHER THAN STARTING A SESSION. Each domain's
// flagship is launched from inside that domain's own screen, with that screen's
// data in hand — the mix needs the scanned spots, the repertoire run needs the
// books. Reaching those from here would mean four more modules loaded on every
// Home paint to save one tap. The daily card above is the one-tap route, and it
// deals from all four.
function buildTrainRow(data: HomeData, deps: HomeDeps): HTMLElement {
  const section = buildSection('Train', () => deps.onOpenView('train'));

  const grid = document.createElement('div');
  grid.className = 'home-train-grid';

  const tile = (
    domain: keyof typeof DOMAIN_ACCENT,
    icon: SVGElement,
    name: string,
    stat: number,
    statLabel: string,
  ): HTMLElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'home-train-tile';
    btn.style.setProperty('--mode-accent', DOMAIN_ACCENT[domain]);

    const ic = document.createElement('span');
    ic.className = 'home-train-icon';
    ic.appendChild(icon);
    btn.appendChild(ic);

    const label = document.createElement('span');
    label.className = 'home-train-name';
    label.textContent = name;
    btn.appendChild(label);

    const fig = document.createElement('span');
    fig.className = 'home-train-fig';
    // A zero is not worth printing at this size — it reads as a broken figure
    // rather than as "nothing to do". The label alone says what the tile is.
    fig.textContent = stat > 0 ? `${stat} ${statLabel}` : statLabel;
    btn.appendChild(fig);

    btn.addEventListener('click', () => deps.onOpenView('train'));
    return btn;
  };

  grid.append(
    tile('openings', Icons.pawn(20), 'Openings', data.dueMoves, 'due'),
    tile('middlegame', Icons.swords(20), 'Middlegame', data.spotsToFix, 'to fix'),
    tile('tactics', Icons.puzzlePiece(20), 'Tactics', data.puzzleRating, 'rating'),
    tile('endgames', Icons.flag(20), 'Endgames', data.endgameRating, 'rating'),
  );
  section.appendChild(grid);
  return section;
}

/**
 * "Your games are being read", while the background pass is actually running.
 *
 * This is the whole of what the Middlegame pane's scan hero left behind. Train
 * has no Analyse button any more — the scan runs itself from boot — so the one
 * thing a user still needs is to be told, once, that the empty exercises are
 * filling up rather than broken. It subscribes for as long as it is on screen
 * and takes itself down when the pass finishes.
 */
function buildScanStrip(): HTMLElement | null {
  const initial = autoScanState();
  if (!initial.running) return null;

  const strip = document.createElement('div');
  strip.className = 'home-scan';

  const icon = document.createElement('span');
  icon.className = 'home-scan-icon';
  icon.appendChild(Icons.review(18));
  strip.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'home-scan-text';
  strip.appendChild(text);

  const paint = (st: AutoScanState): void => {
    if (!st.running) { strip.remove(); stop(); return; }
    const left = Math.max(0, st.total - st.done);
    text.textContent = left > 0
      ? `Reading your games — ${left} to go`
      : 'Reading your games…';
  };
  const stop = onAutoScanChange(paint);
  paint(initial);
  return strip;
}

// ── One row per section of the app ───────────────────────────────────────────

function buildSections(data: HomeData, deps: HomeDeps): HTMLElement {
  const section = buildSection('Your app');

  const list = document.createElement('div');
  list.className = 'home-rows';

  const inTraining = data.lines.filter(l => l.inTraining).length;
  list.appendChild(buildRow(
    Icons.pawn(20), 'Openings',
    data.lines.length === 0
      ? 'build your first line, or add one from a pack'
      : `${data.lines.length} saved · ${inTraining} in training`,
    () => deps.onOpenView('explore'),
  ));

  const last = data.games[0];
  list.appendChild(buildRow(
    Icons.build(20), 'My games',
    data.games.length === 0
      ? 'import your games to unlock half the app'
      : last
        ? `${data.games.length} games · last vs ${last.opponent || 'unknown'}${
          formatGameDate(last.endTime) ? ` · ${formatGameDate(last.endTime)}` : ''}`
        : `${data.games.length} games`,
    () => deps.onOpenView('games'),
  ));

  const streak = currentStreak();
  list.appendChild(buildRow(
    Icons.barChart(20), 'Statistics',
    streak > 0 ? `${streak}-day streak` : 'your numbers start with your first session',
    () => deps.onOpenView('progress'),
  ));

  section.appendChild(list);
  return section;
}

// ── Shared chrome ────────────────────────────────────────────────────────────

function buildSection(title: string, onOpen?: () => void): HTMLElement {
  const section = document.createElement('section');
  section.className = 'home-section';

  const head = document.createElement('div');
  head.className = 'home-section-head';
  const label = document.createElement('h2');
  label.className = 'home-section-title';
  label.textContent = title;
  head.appendChild(label);
  if (onOpen) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'home-section-more';
    more.textContent = 'Open';
    more.appendChild(Icons.chevronRight(15));
    more.addEventListener('click', onOpen);
    head.appendChild(more);
  }
  section.appendChild(head);
  return section;
}

function buildRow(icon: SVGElement, name: string, sub: string, onClick: () => void): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'home-row';

  const ic = document.createElement('span');
  ic.className = 'home-row-icon';
  ic.appendChild(icon);
  row.appendChild(ic);

  const text = document.createElement('span');
  text.className = 'home-row-text';
  const label = document.createElement('span');
  label.className = 'home-row-name';
  label.textContent = name;
  const desc = document.createElement('span');
  desc.className = 'home-row-sub';
  desc.textContent = sub;
  text.append(label, desc);
  row.appendChild(text);

  const chev = document.createElement('span');
  chev.className = 'home-row-chev';
  chev.appendChild(Icons.chevronRight(16));
  row.appendChild(chev);

  row.addEventListener('click', onClick);
  return row;
}
