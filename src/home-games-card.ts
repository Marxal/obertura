// "Learn from your last games": live boards, so the answer can be played right here.
//
// SWIPING MOVES BETWEEN THE KINDS OF MOVE. Each slide is one category (the newest unfixed
// blunder of that kind, or your best find), with the icons across the top as the picker.
// It's a scrolling track, so a sideways swipe across a board is just the track moving:
// these boards only take tapped moves (reply-board-touch.ts). The other two big boxes
// deal a card when swiped; this one doesn't, because here swiping already means this.
// "Another position" deals the next one of the same kind.
//
// THE ANSWER IS PLAYED ON THE BOARD, graded by the same stored engine picks as the
// drill: any of the three is right, the best just gets a cleaner message. No engine runs
// here, so a position costs nothing. The result goes through recordSpotResult like any
// drill, which is what marks it fixed. "Drill" still opens the full session, with its
// explanations and comparisons.
//
// BOARDS ARE BUILT LAZILY, each the first time its slide comes into view, so opening Home
// costs one Chessground rather than five.

import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { HINT_COLOR, registerBrushes } from './board-brushes';
import { recordBrilliantSeen, recordBrilliantSolved } from './brilliant-log';
import type { BrilliantRef } from './brilliant';
import { burstConfetti } from './confetti';
import { CATEGORY_ACCENT } from './exercise-identity';
import type { HomeData, HomeDeps } from './home-screen';
import { Icons, classIcon, CLASS_COLOR, CLASS_LABEL } from './icons';
import { CATEGORY_BADGE, CATEGORY_LABEL, CATEGORY_PHRASE } from './mistake-run';
import { recordSpotResult, type MistakeCategory, type SpotRef } from './mistake-scan';
import { CATEGORIES, CATEGORY_ICON } from './mistakes-screen';
import { formatMove } from './notation';
import { guardBoardTouches } from './reply-board-touch';
import { playFeedback } from './sound';
import { restSpot } from './spot-rest';

/** What "Drill" deals. Five positions, like every other mistake run in the app. */
const DRILL_SIZE = 5;

type Slide =
  | { kind: 'mistake'; cat: MistakeCategory; pool: SpotRef[]; at: number }
  | { kind: 'brilliant'; pool: BrilliantRef[]; at: number };

function slideIcon(s: Slide): SVGElement {
  return s.kind === 'brilliant' ? classIcon('brilliant', 20) : CATEGORY_ICON[s.cat]();
}

function slideAccent(s: Slide): string {
  return s.kind === 'brilliant' ? CLASS_COLOR.brilliant : CATEGORY_ACCENT[s.cat];
}

function slideLabel(s: Slide): string {
  return s.kind === 'brilliant' ? 'Your brilliant moves' : CATEGORY_LABEL[s.cat];
}

function actionButton(
  label: string, className: string, onClick: () => void, icon?: SVGElement,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  if (icon) b.appendChild(icon);
  b.append(label);
  b.addEventListener('click', onClick);
  return b;
}

function textOf(className: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = className;
  return p;
}

// A new Home render replaces the box, and the old boards' document listeners go with it.
let destroyCurrent: (() => void) | null = null;

export function buildGamesBlock(data: HomeData, deps: HomeDeps): HTMLElement | null {
  destroyCurrent?.();
  destroyCurrent = null;

  const slides: Slide[] = [];
  for (const cat of CATEGORIES) {
    const pool = data.spots
      .filter(r => r.spot.category === cat && !r.spot.fixed)
      .sort((a, b) => (b.game.endTime ?? 0) - (a.game.endTime ?? 0));
    if (pool.length) slides.push({ kind: 'mistake', cat, pool, at: 0 });
  }
  if (data.brilliant.length) slides.push({ kind: 'brilliant', pool: data.brilliant.slice(), at: 0 });
  if (slides.length === 0) return null;

  const section = document.createElement('section');
  section.className = 'fmove-block home-panel mrc-section nr-panel';

  const head = document.createElement('div');
  head.className = 'fmove-block-head';
  const label = document.createElement('h2');
  label.className = 'fmove-block-title';
  label.textContent = 'Learn from your last games';
  head.append(label, actionButton('Another position', 'btn-quiet nr-another', () => another(active), Icons.shuffle(15)));
  section.appendChild(head);

  const tabs = document.createElement('div');
  tabs.className = 'mrc-tabs';
  const tabTitle = document.createElement('div');
  tabTitle.className = 'mrc-tab-title';
  const track = document.createElement('div');
  track.className = 'forgotten-track mrc-track';
  section.append(tabs, tabTitle, track);

  let active = 0;

  interface Drawn { el: HTMLElement; card: DrawnGameCard | null; answered: boolean }
  const drawn = new Map<Slide, Drawn>();

  const paintTabs = (): void => {
    // One category has nothing to pick from.
    tabs.hidden = slides.length < 2;
    tabs.replaceChildren(...slides.map((slide, i) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `mrc-tab${i === active ? ' mrc-tab--active' : ''}`;
      tab.style.setProperty('--mrc-accent', slideAccent(slide));
      tab.setAttribute('aria-label', slideLabel(slide));
      tab.title = slideLabel(slide);
      tab.appendChild(slideIcon(slide));
      tab.addEventListener('click', () => {
        track.scrollTo({ left: track.clientWidth * i, behavior: 'smooth' });
      });
      return tab;
    }));
    tabTitle.textContent = slideLabel(slides[active]);
  };

  function draw(slide: Slide): void {
    const place = drawn.get(slide);
    if (!place) return;
    place.card?.destroy();
    place.answered = false;
    place.card = drawCard(place.el, slide, deps, {
      solved: () => { place.answered = true; },
      next: () => another(slides.indexOf(slide)),
      hasOthers: () => slide.pool.length > 1 || slides.length > 1,
    });
  }

  /** The next one of this kind, or on to the next kind if this one has run out. */
  function another(index: number): void {
    const slide = slides[index];
    const place = drawn.get(slide);
    if (!slide || !place) return;
    if (place.answered) {
      // Done with it: out of the deck, not just past it.
      slide.pool.splice(slide.at, 1);
      slide.at -= 1;
    }
    if (slide.pool.length === 0) {
      removeSlide(index);
      return;
    }
    if (slide.pool.length === 1 && !place.answered && slides.length > 1) {
      // Nothing else of this kind: "another" can only mean another kind.
      track.scrollTo({ left: track.clientWidth * ((index + 1) % slides.length), behavior: 'smooth' });
      return;
    }
    slide.at = (slide.at + 1) % slide.pool.length;
    draw(slide);
  }

  function removeSlide(index: number): void {
    const [gone] = slides.splice(index, 1);
    const place = drawn.get(gone);
    place?.card?.destroy();
    place?.el.remove();
    drawn.delete(gone);
    if (slides.length === 0) {
      section.remove();
      return;
    }
    active = Math.min(index, slides.length - 1);
    track.scrollTo({ left: track.clientWidth * active });
    paintTabs();
  }

  for (const slide of slides) {
    const el = document.createElement('div');
    el.className = 'forgotten-slide mrc-slide';
    track.appendChild(el);
    drawn.set(slide, { el, card: null, answered: false });
  }
  paintTabs();

  // Keep the active tab and title in step as the track is swiped.
  let raf = 0;
  track.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const index = Math.min(slides.length - 1,
        Math.max(0, Math.round(track.scrollLeft / (track.clientWidth || 1))));
      if (index === active) return;
      active = index;
      paintTabs();
    });
  }, { passive: true });

  // Each board the first time its slide comes into view.
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      io.unobserve(entry.target);
      const slide = slides.find(s => drawn.get(s)?.el === entry.target);
      if (slide && !drawn.get(slide)?.card) draw(slide);
    }
  }, { root: track, rootMargin: '100px' });
  for (const place of drawn.values()) io.observe(place.el);

  destroyCurrent = () => {
    io.disconnect();
    for (const place of drawn.values()) place.card?.destroy();
    drawn.clear();
  };
  return section;
}

interface DrawnGameCard {
  destroy: () => void;
}

interface CardCallbacks {
  solved: () => void;
  next: () => void;
  hasOthers: () => boolean;
}

/** The bits a mistake and a brilliant find don't share. */
interface Question {
  game: SpotRef['game'];
  preFen: string;
  /** The move you played, drawn in red, for a mistake. Hidden for a find: that's the answer. */
  showPlayed?: string;
  intro: () => HTMLElement;
  /** The answer, and whether this try is it. */
  bestUci: string;
  judge: (uci4: string) => { uci: string; kind: 'best' | 'alt' } | null;
  praise: (kind: 'best' | 'alt') => string;
  record: (clean: boolean) => void;
  drill: () => void;
}

function mistakeQuestion(slide: Extract<Slide, { kind: 'mistake' }>, deps: HomeDeps): Question {
  const { spot, game } = slide.pool[slide.at];
  const best = spot.best[0];
  return {
    game,
    preFen: spot.preFen,
    showPlayed: spot.playedUci,
    intro: () => {
      const badge = CATEGORY_BADGE[spot.category];
      const intro = document.createElement('div');
      intro.className = 'mr-intro mrc-intro';
      const chip = document.createElement('span');
      chip.className = `mr-played mr-played--${badge.cls}`;
      chip.textContent = `${formatMove(spot.playedSan)} ${badge.sym}`;
      intro.append('You played ', chip, ` here and ${CATEGORY_PHRASE[spot.category]}.`);
      return intro;
    },
    bestUci: best?.uci ?? '',
    judge: (uci4) => {
      if (best && best.uci.slice(0, 4) === uci4) return { uci: best.uci, kind: 'best' };
      const alt = spot.best.slice(1, 3).find(m => m.uci.slice(0, 4) === uci4);
      return alt ? { uci: alt.uci, kind: 'alt' } : null;
    },
    praise: (kind) => (kind === 'best'
      ? 'The engine’s move ✓'
      : `Good move ✓ Even stronger: ${best ? formatMove(best.san) : ''}`),
    record: (clean) => {
      void recordSpotResult(game.id, spot.id, clean);
      restSpot(spot.id);
    },
    drill: () => deps.onFixSpots(slide.pool.slice(slide.at, slide.at + DRILL_SIZE), {
      label: CATEGORY_LABEL[slide.cat],
      icon: () => CATEGORY_ICON[slide.cat](18),
      accent: CATEGORY_ACCENT[slide.cat],
    }),
  };
}

function brilliantQuestion(slide: Extract<Slide, { kind: 'brilliant' }>, deps: HomeDeps): Question {
  const ref: BrilliantRef = slide.pool[slide.at];
  const { spot, game } = ref;
  return {
    game,
    preFen: spot.preFen,
    intro: () => {
      const intro = document.createElement('div');
      intro.className = 'mr-intro mrc-intro';
      const chip = document.createElement('span');
      chip.className = `mr-played mr-played--${spot.cls}`;
      chip.textContent = CLASS_LABEL[spot.cls];
      intro.append('You played a ', chip, ' move here.');
      return intro;
    },
    bestUci: spot.playedUci,
    judge: uci4 => (spot.playedUci.slice(0, 4) === uci4
      ? { uci: spot.playedUci, kind: 'best' }
      : null),
    praise: () => 'That’s the one ✓',
    record: (clean) => {
      if (clean) recordBrilliantSolved(spot.id);
      else recordBrilliantSeen(spot.id);
    },
    drill: () => deps.onFindBrilliant(slide.pool.slice(slide.at, slide.at + DRILL_SIZE)),
  };
}

function drawCard(
  host: HTMLElement, slide: Slide, deps: HomeDeps, callbacks: CardCallbacks,
): DrawnGameCard {
  const q = slide.kind === 'brilliant' ? brilliantQuestion(slide, deps) : mistakeQuestion(slide, deps);

  const body = document.createElement('div');
  body.className = 'nr-card-body';

  const boardEl = document.createElement('div');
  boardEl.className = 'forgotten-board cg-wrap nr-board';

  const introEl = q.intro();
  const statusEl = textOf('nr-note');
  statusEl.hidden = true;
  const row = document.createElement('div');
  row.className = 'nr-actions';
  body.append(boardEl, introEl, statusEl, row);
  host.replaceChildren(body);

  const chess = new Chess(q.preFen);
  const legal = (): Map<Key, Key[]> => {
    const map = new Map<Key, Key[]>();
    for (const m of chess.moves({ verbose: true })) {
      const from = m.from as Key;
      if (!map.has(from)) map.set(from, []);
      map.get(from)!.push(m.to as Key);
    }
    return map;
  };

  let clean = true;
  let hintStage = 0;

  const cg: Api = Chessground(boardEl, {
    fen: q.preFen,
    orientation: q.game.colour,
    turnColor: q.game.colour,
    coordinates: false,
    animation: { enabled: true, duration: 150 },
    movable: { free: false, color: q.game.colour, dests: legal(), showDests: true },
    draggable: { showGhost: true },
    drawable: { enabled: false, visible: true },
    events: { move: (from, to) => onMove(from as Key, to as Key) },
  });
  registerBrushes(cg, {
    danger: { color: '#c93636', opacity: 0.8, lineWidth: 10 },
    accent: { color: HINT_COLOR, opacity: 0.9, lineWidth: 10 },
  });
  requestAnimationFrame(() => cg.redrawAll());
  const stopGuard = guardBoardTouches(boardEl, cg);

  const paintShapes = (): void => {
    const shapes = [];
    if (q.showPlayed && hintStage === 0) {
      shapes.push({
        orig: q.showPlayed.slice(0, 2) as Key,
        dest: q.showPlayed.slice(2, 4) as Key,
        brush: 'danger',
      });
    }
    if (q.bestUci && hintStage === 1) shapes.push({ orig: q.bestUci.slice(0, 2) as Key, brush: 'accent' });
    if (q.bestUci && hintStage === 2) {
      shapes.push({
        orig: q.bestUci.slice(0, 2) as Key,
        dest: q.bestUci.slice(2, 4) as Key,
        brush: 'accent',
      });
    }
    cg.setAutoShapes(shapes);
  };
  paintShapes();

  const say = (text: string, tone: 'good' | 'bad'): void => {
    statusEl.textContent = text;
    statusEl.hidden = false;
    statusEl.classList.toggle('nr-note--good', tone === 'good');
    statusEl.classList.toggle('nr-note--bad', tone === 'bad');
  };

  const hintButton = actionButton('Hint', 'btn-secondary nr-action', () => {
    clean = false;
    hintStage += 1;
    if (hintStage >= 2) hintButton.hidden = true;
    paintShapes();
  }, Icons.bulb(16));
  row.append(
    hintButton,
    actionButton('Drill', 'btn-secondary nr-action', q.drill, Icons.target(16)),
  );

  function onMove(from: Key, to: Key): void {
    const verdict = q.judge(`${from}${to}`);
    if (!verdict) {
      clean = false;
      playFeedback('wrong');
      const flash = document.createElement('div');
      flash.className = 'pt-error-flash';
      boardEl.appendChild(flash);
      flash.addEventListener('animationend', () => flash.remove(), { once: true });
      say('Not quite, try again', 'bad');
      cg.set({ fen: chess.fen(), turnColor: q.game.colour, movable: { color: q.game.colour, dests: legal() } });
      paintShapes();
      return;
    }
    solve(verdict);
  }

  function solve(verdict: { uci: string; kind: 'best' | 'alt' }): void {
    q.record(clean);
    callbacks.solved();
    const from = verdict.uci.slice(0, 2) as Key;
    const to = verdict.uci.slice(2, 4) as Key;
    try {
      chess.move({ from, to, promotion: (verdict.uci[4] as 'q') || undefined });
    } catch { /* the stored move should always replay; the board still shows the try */ }
    cg.set({
      fen: chess.fen(),
      lastMove: [from, to],
      turnColor: chess.turn() === 'w' ? 'white' : 'black',
      movable: { color: undefined, dests: new Map() },
    });
    cg.setAutoShapes(verdict.kind === 'alt' && q.bestUci
      ? [{ orig: q.bestUci.slice(0, 2) as Key, dest: q.bestUci.slice(2, 4) as Key, brush: 'accent' }]
      : []);
    playFeedback('correct');
    if (clean) burstConfetti(boardEl);
    say(q.praise(verdict.kind), 'good');
    row.replaceChildren(actionButton(
      callbacks.hasOthers() ? 'Next position' : 'Done',
      'btn-primary nr-action',
      callbacks.next,
    ));
  }

  return {
    destroy() {
      stopGuard();
      cg.destroy();
    },
  };
}
