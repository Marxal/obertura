// Home — a dynamic overview of the whole app.
//
// WHAT IT IS FOR. Every other screen answers one question: what shall I train,
// what is in my book, how am I doing. Home answers "what is going on", and it is
// the only screen that mentions all of them. It is also the screen a returning
// user opens first, so what it shows has to be true TODAY — a figure that never
// moves belongs in the section it describes, not here.
//
// EVERYTHING HERE IS BOARDS. Four blocks, in the order the answers are useful:
// lines ready to grow, the mistakes your last games left behind, then the moves
// you keep missing and the lines that keep slipping. A board you can point at is
// the only summary of a chess position worth putting on an overview.
//
// TWO SHAPES, AND THE DIFFERENCE MATTERS. The first two blocks are FRAMED
// CAROUSELS: one full board at a time, centred in a card, with nothing of the
// next one showing. The last two are BLEEDING STRIPS of small cards, where the
// half-visible next card is exactly the point. A big board you are meant to read
// with another one peeking past it is neither, and read as a mistake.
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

import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import { registerBrushes } from './board-brushes';
import type { Line } from './types';
import type { ImportedGame } from './import-core';
import { Icons, classIcon, CLASS_COLOR, CLASS_LABEL } from './icons';
import { colourPip } from './card-position';
import { formatMove } from './notation';
import { renderForgottenSection } from './forgotten-section';
import { autoScanState, onAutoScanChange, type AutoScanState } from './mistake-autoscan';
import type { GrowTarget } from './grow-line';
import type { MistakeCategory, SpotRef } from './mistake-scan';
import type { BrilliantRef } from './brilliant';
import { CATEGORY_LABEL, CATEGORY_PHRASE, CATEGORY_BADGE } from './mistake-run';
import { CATEGORY_ACCENT } from './exercise-identity';
import { CATEGORIES, CATEGORY_ICON } from './mistakes-screen';

// What a "Fix it" from the carousel deals. Five positions, like every other
// mistake run in the app.
const MISTAKE_SESSION = 5;

// How many cards each strip previews. Five is what the forgotten strips have
// always shown, and a strip is a swipe rather than a list — past five nobody is
// swiping, they are looking for a screen.
const PREVIEW = 5;

export interface HomeDeps {
  /** Open the builder on this line's Grow tab. */
  onGrow: (target: GrowTarget) => void;
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
  /** Mistake spots from your games. */
  spots: SpotRef[];
  /** Your own best moves, ordered by what is ready to be re-found. */
  brilliant: BrilliantRef[];
}

/**
 * Draw everything below the daily card.
 *
 * The grow strip gets a host of its own rather than being drawn here, because
 * its data arrives late (the search loads the bundled opening book) and a second
 * full render would rebuild every board on the screen — twenty-odd inline SVGs
 * of sixty-four squares each — to fill one strip. See fillGrowStrip.
 */
export function renderHomeBody(host: HTMLElement, data: HomeData, deps: HomeDeps): void {
  host.replaceChildren();

  const growHost = document.createElement('div');
  growHost.className = 'home-grow-host';
  host.appendChild(growHost);
  if (data.grow.length > 0) fillGrowStrip(growHost, data.grow, deps);

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

  const paint = (st: AutoScanState): void => {
    // Detached: a newer Home render owns the screen, or the user has left it.
    // Free the subscription rather than idle in it — the same self-cleaning the
    // endgame scan's watcher does.
    if (!strip.isConnected) { done(); return; }
    if (!st.running) { strip.remove(); done(); return; }
    const left = Math.max(0, st.total - st.done);
    text.textContent = left > 0
      ? `Reading your games — ${left} to go`
      : 'Reading your games';
  };
  stop = onAutoScanChange(paint);
  stopScanWatch = stop;
  paint(initial);
  return strip;
}

// The live banner's unsubscribe, module-level so a new render can cancel the
// old one before it makes another.
let stopScanWatch: (() => void) | null = null;

// ── Grow your lines ──────────────────────────────────────────────────────────

/**
 * The lines you have mastered, with the replies you would be preparing for
 * drawn on the board.
 *
 * IT USED TO BE A NOTIFICATION — one card, one line, pinned above three screens
 * and swipeable away. That shape said "here is a thing to dismiss"; a board with
 * the replies drawn on it says "here is a position you know well enough to
 * extend", which is the actual offer.
 *
 * ONE SLIDE AT A TIME, IN A FRAME. It was a bleeding strip of 82%-wide cards
 * with the next one peeking in from the right — two half-read boards side by
 * side, which on a screen whose whole job is "look at this position" is just
 * confusing. It is now the same shape as the mistakes carousel below it: a
 * framed panel, one full board centred in it, dots for the rest.
 */
export function fillGrowStrip(host: HTMLElement, grow: GrowTarget[], deps: HomeDeps): void {
  host.replaceChildren();
  if (grow.length === 0) return;

  const targets = grow.slice(0, PREVIEW);
  const section = buildPanel(
    'Ready to grow', `${grow.length} ${grow.length === 1 ? 'line' : 'lines'}`);

  const track = document.createElement('div');
  track.className = 'forgotten-track mrc-track';
  for (const t of targets) track.appendChild(growSlide(t, deps));
  section.appendChild(track);
  if (targets.length > 1) section.appendChild(buildDots(track, targets.length));

  host.appendChild(section);
  observeBoards(track);
}

/**
 * One line ready to grow: the mastered position with its candidate replies
 * drawn over it, then the line's name and the way in.
 *
 * A REAL CHESSGROUND, not a mini board. The miniature draws Unicode glyphs,
 * because fifty of them on My Lines can't each carry the active piece set's
 * background images — so at full size it showed a piece set nobody chose, next
 * to boards that showed the right one. At one board per panel, built lazily,
 * the real thing costs nothing worth saving.
 */
function growSlide(target: GrowTarget, deps: HomeDeps): HTMLElement {
  const slide = document.createElement('div');
  slide.className = 'forgotten-slide mrc-slide';

  const colour = target.spot.line.colour;
  const board = document.createElement('div') as Deferred;
  board.className = 'forgotten-board cg-wrap';
  board.dataset.board = '';
  board.__build = () => {
    const cg = Chessground(board, {
      fen: target.spot.fen,
      orientation: colour,
      viewOnly: true,
      coordinates: false,
      animation: { enabled: false },
      drawable: { enabled: false, visible: true },
    });
    // The openings green — these are replies to prepare, not mistakes to fix.
    registerBrushes(cg, { grow: { color: '#3e6650', opacity: 0.85, lineWidth: 10 } });
    cg.setAutoShapes(target.moves.map(m => ({
      orig: m.uci.slice(0, 2) as Key,
      dest: m.uci.slice(2, 4) as Key,
      brush: 'grow',
    })));
    requestAnimationFrame(() => cg.redrawAll());
  };
  slide.appendChild(board);

  const body = document.createElement('div');
  body.className = 'forgotten-body';

  const name = document.createElement('div');
  name.className = 'stats-sheet-name home-grow-name';
  name.appendChild(colourPip(colour));
  const label = document.createElement('span');
  label.className = 'stats-sheet-name-text';
  label.textContent = target.spot.line.name;
  name.appendChild(label);
  body.appendChild(name);

  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'btn-primary forgotten-fix-btn';
  go.textContent = 'Prepare a reply';
  go.addEventListener('click', () => deps.onGrow(target));
  body.appendChild(go);

  const hint = document.createElement('div');
  hint.className = 'forgotten-hint';
  hint.textContent = target.moves.length === 1
    ? 'mastered — one reply to answer'
    : `mastered — ${target.moves.length} replies to answer`;
  body.appendChild(hint);

  slide.appendChild(body);
  return slide;
}

// ── The shared panel ─────────────────────────────────────────────────────────

/**
 * The frame both carousels sit in: a titled card, one board wide.
 *
 * Home's other two blocks are STRIPS — rows of small cards that bleed off the
 * screen edge, because "there is more to swipe" is the point of them. These two
 * are single boards you look at, and an unframed board with the next one peeking
 * past it read as neither a strip nor a card. The frame says where the position
 * ends.
 */
function buildPanel(title: string, meta: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'fmove-block home-panel';

  const head = document.createElement('div');
  head.className = 'fmove-block-head';
  const label = document.createElement('h2');
  label.className = 'fmove-block-title';
  label.textContent = title;
  head.appendChild(label);
  const count = document.createElement('span');
  count.className = 'fmove-block-meta';
  count.textContent = meta;
  head.appendChild(count);
  section.appendChild(head);
  return section;
}

/** Which slide you are on, for a carousel whose slides all look alike. */
function buildDots(track: HTMLElement, count: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'home-dots';
  row.setAttribute('aria-hidden', 'true');
  const dots: HTMLElement[] = [];
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('i');
    if (i === 0) dot.className = 'home-dot--on';
    row.appendChild(dot);
    dots.push(dot);
  }
  let raf = 0;
  track.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const idx = Math.min(count - 1,
        Math.max(0, Math.round(track.scrollLeft / (track.clientWidth || 1))));
      dots.forEach((d, i) => d.classList.toggle('home-dot--on', i === idx));
    });
  }, { passive: true });
  return row;
}

// ── From your last games ─────────────────────────────────────────────────────
//
// THE CAROUSEL, BACK. One position at a time — the newest unfixed blunder in
// each category, then your best find — with the four category icons plus the
// brilliancy across the top as both a picker and the position indicator. It sat
// under the Middle game pane until that box was cut to seven exercise cards, and
// it belongs on Home for the same reason the forgotten strips do: it is a thing
// you LOOK at. Tapping still drills it, so it is a way in as well.
//
// ONE BOARD, NOT ONE AND A HALF. Its track used to bleed to the screen edge like
// the strips below it, which let the next slide's board show past the current
// one. See .mrc-section in style.css.
//
// BOARDS ARE BUILT LAZILY. Each slide is a real view-only Chessground, and five
// of them on the app's landing screen is five board instances built before you
// have looked at any of them. An IntersectionObserver builds each one the first
// time its slide comes into view, so a Home paint costs exactly one.

type CarouselSlide =
  | { kind: 'mistake'; cat: MistakeCategory; pool: SpotRef[] }
  | { kind: 'brilliant'; pool: BrilliantRef[] };

function slideIcon(s: CarouselSlide): SVGElement {
  return s.kind === 'brilliant' ? classIcon('brilliant', 20) : CATEGORY_ICON[s.cat]();
}

function slideAccent(s: CarouselSlide): string {
  return s.kind === 'brilliant' ? CLASS_COLOR.brilliant : CATEGORY_ACCENT[s.cat];
}

function slideLabel(s: CarouselSlide): string {
  return s.kind === 'brilliant' ? 'Your brilliant moves' : CATEGORY_LABEL[s.cat];
}

function buildMistakesBlock(data: HomeData, deps: HomeDeps): HTMLElement | null {
  const slides: CarouselSlide[] = [];
  for (const cat of CATEGORIES) {
    // Unfixed, newest first — the lead is the freshest thing worth fixing and
    // the rest chain behind it for "Next position".
    const pool = data.spots
      .filter(r => r.spot.category === cat && !r.spot.fixed)
      .sort((a, b) => (b.game.endTime ?? 0) - (a.game.endTime ?? 0));
    if (pool.length) slides.push({ kind: 'mistake', cat, pool });
  }
  if (data.brilliant.length) slides.push({ kind: 'brilliant', pool: data.brilliant });
  if (slides.length === 0) return null;

  const section = buildPanel('From your last games', `${slides.length} to look at`);
  section.classList.add('mrc-section');

  const tabs = document.createElement('div');
  tabs.className = 'mrc-tabs';
  // The active slide's name, under the icon row — not inside the buttons, so
  // all the icons fit side by side.
  const tabTitle = document.createElement('div');
  tabTitle.className = 'mrc-tab-title';
  const track = document.createElement('div');
  track.className = 'forgotten-track mrc-track';

  const tabEls: HTMLButtonElement[] = [];
  slides.forEach((sl, i) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'mrc-tab' + (i === 0 ? ' mrc-tab--active' : '');
    tab.style.setProperty('--mrc-accent', slideAccent(sl));
    tab.setAttribute('aria-label', slideLabel(sl));
    tab.title = slideLabel(sl);
    tab.appendChild(slideIcon(sl));
    tab.addEventListener('click', () => {
      track.scrollTo({ left: track.clientWidth * i, behavior: 'smooth' });
    });
    tabEls.push(tab);
    tabs.appendChild(tab);
    track.appendChild(sl.kind === 'brilliant'
      ? buildBrilliantSlide(sl.pool, deps)
      : buildMistakeSlide(sl.cat, sl.pool, deps));
  });
  tabTitle.textContent = slideLabel(slides[0]);

  // Keep the active tab + title in sync as the track is swiped.
  let raf = 0;
  track.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const idx = Math.min(slides.length - 1,
        Math.max(0, Math.round(track.scrollLeft / (track.clientWidth || 1))));
      tabEls.forEach((t, i) => t.classList.toggle('mrc-tab--active', i === idx));
      tabTitle.textContent = slideLabel(slides[idx]);
    });
  }, { passive: true });

  section.append(tabs, tabTitle, track);
  observeBoards(track);
  return section;
}

/**
 * Build each slide's board the first time it comes into view.
 *
 * Chessground is not free, and a carousel shows one slide at a time — so five
 * instances on the landing screen is four built for nobody. The builder is
 * parked on the element and called once.
 */
type Deferred = HTMLElement & { __build?: () => void };
function observeBoards(track: HTMLElement): void {
  const pending = [...track.querySelectorAll<Deferred>('[data-board]')];
  if (pending.length === 0) return;
  // No IntersectionObserver (or a detached track): build them all rather than
  // leave a carousel of empty squares.
  if (typeof IntersectionObserver === 'undefined') {
    for (const el of pending) { el.__build?.(); el.__build = undefined; }
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target as Deferred;
      el.__build?.();
      el.__build = undefined;
      io.unobserve(el);
    }
  }, { root: track, rootMargin: '100px' });
  for (const el of pending) io.observe(el);
}

function buildMistakeSlide(
  cat: MistakeCategory, pool: SpotRef[], deps: HomeDeps,
): HTMLElement {
  const ref = pool[0];
  const slide = document.createElement('div');
  slide.className = 'forgotten-slide mrc-slide';

  const { spot, game } = ref;

  // A real (view-only) chessground, with the played mistake drawn in the review
  // palette's blunder red.
  const board = document.createElement('div') as Deferred;
  board.className = 'forgotten-board cg-wrap';
  board.dataset.board = '';
  board.__build = () => {
    const cg = Chessground(board, {
      fen: spot.preFen,
      orientation: game.colour,
      viewOnly: true,
      coordinates: false,
      animation: { enabled: false },
      drawable: { enabled: false, visible: true },
    });
    registerBrushes(cg, { danger: { color: '#c93636', opacity: 0.8, lineWidth: 10 } });
    cg.setAutoShapes([{
      orig: spot.playedUci.slice(0, 2) as Key,
      dest: spot.playedUci.slice(2, 4) as Key,
      brush: 'danger',
    }]);
    requestAnimationFrame(() => cg.redrawAll());
  };
  slide.appendChild(board);

  const body = document.createElement('div');
  body.className = 'forgotten-body';

  // The drill's own story line: "You played [♛xe8 ??] here and blundered."
  const badge = CATEGORY_BADGE[spot.category];
  const intro = document.createElement('div');
  intro.className = 'mr-intro mrc-intro';
  intro.appendChild(document.createTextNode('You played '));
  const chip = document.createElement('span');
  chip.className = `mr-played mr-played--${badge.cls}`;
  chip.textContent = `${formatMove(spot.playedSan)} ${badge.sym}`;
  intro.appendChild(chip);
  intro.appendChild(document.createTextNode(` here and ${CATEGORY_PHRASE[spot.category]}.`));
  body.appendChild(intro);

  const fix = document.createElement('button');
  fix.type = 'button';
  fix.className = 'btn-primary forgotten-fix-btn';
  fix.textContent = 'Fix it';
  fix.addEventListener('click', () => deps.onFixSpots(pool.slice(0, MISTAKE_SESSION), {
    label: CATEGORY_LABEL[cat],
    icon: () => CATEGORY_ICON[cat](18),
    accent: CATEGORY_ACCENT[cat],
  }));
  body.appendChild(fix);

  const hint = document.createElement('div');
  hint.className = 'forgotten-hint';
  hint.textContent = 'find the best move';
  body.appendChild(hint);

  slide.appendChild(body);
  return slide;
}

function buildBrilliantSlide(pool: BrilliantRef[], deps: HomeDeps): HTMLElement {
  const ref = pool[0];
  const slide = document.createElement('div');
  slide.className = 'forgotten-slide mrc-slide';

  const { spot, game } = ref;

  const board = document.createElement('div') as Deferred;
  board.className = 'forgotten-board cg-wrap';
  board.dataset.board = '';
  board.__build = () => {
    const cg = Chessground(board, {
      fen: spot.preFen,
      orientation: game.colour,
      viewOnly: true,
      coordinates: false,
      animation: { enabled: false },
      // The move stays hidden — finding it is the exercise.
      drawable: { enabled: false, visible: false },
    });
    requestAnimationFrame(() => cg.redrawAll());
  };
  slide.appendChild(board);

  const body = document.createElement('div');
  body.className = 'forgotten-body';

  const intro = document.createElement('div');
  intro.className = 'mr-intro mrc-intro';
  intro.appendChild(document.createTextNode('You played a '));
  const chip = document.createElement('span');
  chip.className = `mr-played mr-played--${spot.cls}`;
  chip.textContent = CLASS_LABEL[spot.cls];
  intro.appendChild(chip);
  intro.appendChild(document.createTextNode(' move here.'));
  body.appendChild(intro);

  const fix = document.createElement('button');
  fix.type = 'button';
  fix.className = 'btn-primary forgotten-fix-btn';
  fix.textContent = 'Find it again';
  fix.addEventListener('click', () => deps.onFindBrilliant(pool.slice(0, MISTAKE_SESSION)));
  body.appendChild(fix);

  const hint = document.createElement('div');
  hint.className = 'forgotten-hint';
  hint.textContent = 'find your best move';
  body.appendChild(hint);

  slide.appendChild(body);
  return slide;
}
