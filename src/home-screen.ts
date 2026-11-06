// Home — a dynamic overview of the whole app.
//
// WHAT IT IS FOR. Every other screen answers one question: what shall I train,
// what is in my book, how am I doing. Home answers "what is going on", and it is
// the only screen that mentions all of them. It is also the screen a returning
// user opens first, so what it shows has to be true TODAY — a figure that never
// moves belongs in the section it describes, not here.
//
// EVERYTHING HERE IS BOARDS, AND EVERY TITLE IS A THING TO DO. Add a missing reply,
// learn from your last games, your most forgotten moves, then extend a line you know,
// with a strip of forgotten lines at the foot on a phone. A title names the action; how many are waiting goes beside
// it. A board you can point at is the only summary of a chess position worth putting
// on an overview.
//
// TWO SHAPES, AND THE DIFFERENCE MATTERS. Big blocks are FRAMED: one full board at a
// time, centred in a card, with nothing of the next one showing. The two reply boards
// and the games box are live. The forgotten blocks are BLEEDING STRIPS
// of small cards, where the half-visible next card is exactly the point. A big board
// you are meant to read with another one peeking past it is neither, and read as a
// mistake.
//
// THE TWO REPLY BOARDS ARE KEPT APART, top and bottom. Next to each other they look
// like one thing twice, and extending is the reward once the repairs are done.
//
// WHAT WAS HERE AND ISN'T. A "Train" section repeating the four doors that are
// one tap away in the tab bar, and a "Your app" list of every nav destination
// with its count — both of them menus of the things Home is supposed to be
// showing you the state of. Home tells you what is waiting; the tab bar is how
// you get anywhere.
//
// The daily-challenge card is NOT built here — it lives in main.ts, because its
// eight launchers reach into every exercise in the app and the `liveDaily`
// indirection has to own them (see the long note above `liveDaily`). main.ts
// renders the card into a host above this body.

import type { Line } from './types';
import type { ImportedGame } from './import-core';
import { Icons } from './icons';
import { buildGamesBlock } from './home-games-card';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import { registerBrushes, HINT_COLOR } from './board-brushes';
import { buildSupportNote } from './support-note';
import { renderForgottenLines } from './forgotten-section';
import { buildForgottenMovesBlock } from './home-forgotten-card';
import { autoScanState, onAutoScanChange, type AutoScanState } from './mistake-autoscan';
import { isAnalysisPending } from './game-analysis';
import type { SpotRef } from './mistake-scan';
import type { BrilliantRef } from './brilliant';
import { t } from './i18n';

export interface HomeDeps {
  /** Drill these mistake spots, wearing the exercise's own name and colour. */
  onFixSpots: (
    refs: SpotRef[],
    mode?: { label: string; icon: () => SVGElement; accent: string },
  ) => void;
  /** Re-find these best moves. */
  onFindBrilliant: (refs: BrilliantRef[]) => void;
  /** A forgotten move: three reps of it, then the whole line. */
  onFixMove: (
    move: { preFen: string; san: string; colour: 'white' | 'black'; lapses: number },
    lines: Line[],
  ) => void;
  /** Drill one line start to finish (a Forgotten-moves row). */
  onDrillLine: (line: Line) => void;
  /** Open a line in the builder, at this position if there is one. */
  onOpenLine: (line: Line, atFen?: string) => void;
  /** Repaint Home — used after anything here changes the numbers. */
  onRefresh: () => void;
}

export interface HomeData {
  lines: Line[];
  games: ImportedGame[];
  /** Mistake spots from your games. */
  spots: SpotRef[];
  /** Your own best moves, ordered by what is ready to be re-found. */
  brilliant: BrilliantRef[];
}

/**
 * Draw everything below the daily card.
 *
 * The reply card gets a host of its own rather than being drawn here, because its
 * data arrives late (it loads the opening statistics) and a second full render would
 * rebuild every board on the screen to fill one card. See next-reply-card.ts.
 */
export function renderHomeBody(host: HTMLElement, data: HomeData, deps: HomeDeps): void {
  host.replaceChildren();

  const nextHost = document.createElement('div');
  nextHost.className = 'home-next-host';
  host.appendChild(nextHost);

  const mistakes = buildGamesBlock(data, deps);
  if (mistakes) host.appendChild(mistakes);

  const forgotten = buildForgottenMovesBlock(data.lines, deps);
  if (forgotten) host.appendChild(forgotten);

  const extendHost = document.createElement('div');
  extendHost.className = 'home-extend-host';
  host.appendChild(extendHost);

  // A strip at the foot on a phone, and not on a desktop (desktop.css): a line isn't
  // something you can answer on a board, and Home has enough boards without it.
  renderForgottenLines(host, data.lines, {
    onFixMove: (mv, lines) => deps.onFixMove(
      { preFen: mv.preFen, san: mv.san, colour: mv.colour, lapses: mv.lapses }, lines),
    onDrillLine: (line) => deps.onDrillLine(line),
    onOpenLine: (line) => deps.onOpenLine(line),
    onStartTraining: () => deps.onRefresh(),
  });

  const previews = buildHomePreviews(data, !mistakes);
  if (previews) host.appendChild(previews);

  const support = buildSupportNote();
  if (support) host.appendChild(support);
}

// ── What is coming, for someone with nothing to show yet ────────────────────
//
// Home is made of boards from your own games and lines, so a new user's desktop was
// half a window of nothing. A phone doesn't feel that: its one column is simply
// shorter. So a desktop shows each block that isn't there yet, under its real title,
// on a dimmed board, with what fills it. One line each and no buttons: Get started,
// beside these, holds the actions, and two sets would compete.
//
// A preview steps aside as its real block arrives. The games one is decided here;
// the other two by CSS, since one of them arrives late (.home-next-host) and the other
// knows its own data. Real positions, checked with Stockfish at depth 16.
function buildHomePreviews(data: HomeData, noGamesBlock: boolean): HTMLElement | null {
  if (!window.matchMedia('(min-width: 960px)').matches) return null;
  if (data.games.length > 0 && data.lines.length >= 3) return null;

  const wrap = document.createElement('div');
  wrap.className = 'home-previews';

  const card = (
    kind: string, title: string, note: string, fen: string,
    colour: 'white' | 'black', arrow?: string,
  ): void => {
    const el = document.createElement('section');
    el.className = `home-preview home-preview--${kind}`;
    const h = document.createElement('h2');
    h.className = 'home-preview-title';
    h.textContent = title;
    const board = document.createElement('div');
    board.className = 'home-preview-board';
    // A real, view-only board rather than a miniature: the miniatures draw
    // Unicode glyphs (cheap for a list of fifty), which at this size read as a
    // different piece set from the boards these previews stand in for.
    const cgEl = document.createElement('div');
    cgEl.className = 'cg-wrap';
    board.appendChild(cgEl);
    // After it is in the document: Chessground measures itself as it starts.
    requestAnimationFrame(() => {
      if (!cgEl.isConnected) return;
      const cg = Chessground(cgEl, {
        fen,
        orientation: colour,
        viewOnly: true,
        coordinates: false,
        animation: { enabled: false },
        drawable: { enabled: false, visible: true },
      });
      if (arrow) {
        registerBrushes(cg, { hint: { color: HINT_COLOR, opacity: 0.9, lineWidth: 10 } });
        cg.setAutoShapes([{
          orig: arrow.slice(0, 2) as Key, dest: arrow.slice(2, 4) as Key, brush: 'hint',
        }]);
      }
    });
    const line = document.createElement('p');
    line.className = 'home-preview-note';
    line.appendChild(Icons.lock(13));
    line.appendChild(document.createTextNode(note));
    el.append(h, board, line);
    wrap.appendChild(el);
  };

  // Open Ruy Lopez, the Tarrasch trap: 11...Qd7?? (+3.3).
  if (noGamesBlock) {
    card('games', t('home.games.title'),
      t(data.games.length > 0 ? 'home.soon.reading' : 'home.soon.games'),
      'r4rk1/2pqbppp/p1n1b3/1p1pP3/3Nn3/1BP5/PP3PPP/RNBQR1K1 w - - 5 12', 'black', 'd8d7');
  }
  // Najdorf, English Attack, after 8.f3 (White about +0.6).
  card('reply', t('reply.missing.title'), t('home.soon.lines'),
    'rn1qkb1r/1p3ppp/p2pbn2/4p3/4P3/1NN1BP2/PPP3PP/R2QKB1R b KQkq - 0 8', 'black', 'b8c6');
  // King's Indian, Mar del Plata, after 9...Ne7 (White about +0.6).
  card('forgotten', t('home.forgotten.title'), t('home.soon.training'),
    'r1bq1rk1/ppp1npbp/3p1np1/3Pp3/2P1P3/2N2N2/PP2BPPP/R1BQ1RK1 w - - 1 9', 'white');
  return wrap;
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
  // ONE SUBSCRIPTION, EVER. This used to subscribe per render and unsubscribe
  // only when the pass finished — so every visit to Home during a scan left a
  // live listener writing into a detached banner, and `publish` fires once per
  // game read. With four hundred games to go that is hundreds of dead DOM
  // writes a minute, and it is exactly what "the app feels laggy" was.
  stopScanWatch?.();
  stopScanWatch = null;

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

  let stop: (() => void) | null = null;
  const done = (): void => {
    stop?.();
    // Only if this banner is still the live one — a newer render may already
    // have replaced the module handle with its own.
    if (stopScanWatch === stop) stopScanWatch = null;
  };

  const write = (st: AutoScanState): void => {
    const left = Math.max(0, st.total - st.done);
    const progress = left > 0
      ? t('home.analysis.left', { n: left, time: timeLeftLabel(st, left) })
      : t('home.analysis.running');
    // The promise only while it's still owed (game-analysis.ts).
    text.textContent = isAnalysisPending()
      ? `${progress} ${t('home.analysis.promise')}`
      : progress;
  };
  const paint = (st: AutoScanState): void => {
    // Detached: a newer Home render owns the screen, or the user has left it.
    // Free the subscription rather than idle in it — the same self-cleaning the
    // endgame scan's watcher does.
    if (!strip.isConnected) { done(); return; }
    if (!st.running) { strip.remove(); done(); return; }
    write(st);
  };
  // The first paint is written directly, NOT through paint(): the strip isn't
  // in the document until the caller mounts it, so paint's isConnected check
  // read it as detached — unsubscribed on the spot and left the banner blank
  // for the whole scan.
  write(initial);
  stop = onAutoScanChange(paint);
  stopScanWatch = stop;
  return strip;
}

// The live banner's unsubscribe, module-level so a new render can cancel the
// old one before it makes another.
let stopScanWatch: (() => void) | null = null;

// What a game usually costs until this pass has timed a few of its own. Games
// take 15 to 40 seconds, and most of that is waiting on the network, so the
// phone's speed says little about it.
const TYPICAL_MS_PER_GAME = 25_000;
const GAMES_BEFORE_TRUSTING_PACE = 3;

// Where the timing started. Module-level because every Home render builds a new
// banner, and the pace shouldn't start over each time.
let paceFrom: { at: number; done: number } | null = null;

/** "about 10 min": rounded on purpose, because it's an estimate that moves. */
function timeLeftLabel(st: AutoScanState, left: number): string {
  const now = Date.now();
  if (!paceFrom || st.done < paceFrom.done) paceFrom = { at: now, done: st.done };
  const read = st.done - paceFrom.done;
  const perGame = read >= GAMES_BEFORE_TRUSTING_PACE
    ? (now - paceFrom.at) / read
    : TYPICAL_MS_PER_GAME;
  const minutes = Math.round((left * perGame) / 60_000);
  if (minutes < 1) return t('home.analysis.underMinute');
  if (minutes < 60) return t('home.analysis.minutes', { minutes });
  const hours = Math.round(minutes / 60);
  return t('home.analysis.hours', { n: hours });
}
