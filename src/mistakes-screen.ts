// The Mistake retry pane on the Train screen — drills the exact positions from
// your own imported games where you went wrong. This file renders the pane:
// the stats hero, the "Analyse my games" scan (with its progress overlay), and
// the four category cards. The scan itself lives in mistake-scan.ts and the
// solving overlay in mistake-run.ts.

import { Chessground } from 'chessground';
import { registerBrushes } from './board-brushes';
import type { Key } from 'chessground/types';
import type { ImportedGame } from './import-core';
import { getAllGames } from './storage';
import { buildEmptyState } from './empty-state';
import { renderLoadError } from './load-error';
import { Icons } from './icons';
import { countUp } from './count-up';
import { pushBack } from './back-nav';
import { formatMove } from './notation';
import { cloudHealth, type CloudHealth } from './engine';
import { createPawnProgress, createFactsTicker } from './import-progress';
import { buildModeCard } from './train-screen';
import {
  startMistakeSession,
  CATEGORY_LABEL,
  CATEGORY_PHRASE,
  CATEGORY_BADGE,
  type OpenGameCtx,
} from './mistake-run';
import {
  scanGames,
  collectSpots,
  pickSpots,
  countRetry,
  unscannedCount,
} from './mistake-scan';
import type { MistakeCategory, ScanProgress, SpotRef } from './mistake-scan';

// Session size for a category card tap — five positions, like a puzzle run.
const SESSION_SIZE = 5;

// Per-category accents for the cards, kin to the Practise cards' palette.
const CATEGORY_ACCENT: Record<MistakeCategory, string> = {
  'opening-blunder': '#b3593b', // ember — it went wrong early
  'punish-opening': '#3f7d8a',  // teal — seize what they hand you
  'missed-win': '#c79a2a',      // gold — the win that got away
  'blunder': '#a94444',         // red — the plain ??
};

const CATEGORY_SUB: Record<MistakeCategory, string> = {
  'opening-blunder': 'openings that lost you the game',
  'punish-opening': 'chances your opponent handed you',
  'missed-win': 'winning positions you let slip',
  'blunder': 'game-losing moves from level play',
};

const CATEGORY_ICON: Record<MistakeCategory, () => SVGElement> = {
  'opening-blunder': () => Icons.zap(20),
  'punish-opening': () => Icons.target(20),
  'missed-win': () => Icons.star(20),
  'blunder': () => Icons.alert(20),
};

const CATEGORIES: MistakeCategory[] = ['opening-blunder', 'punish-opening', 'missed-win', 'blunder'];

export interface MistakesScreenDeps {
  onImportGames: () => void;
  // Open a game in the full analyser (builder view) — the session's "Open full
  // analysis" route. The ctx carries the position to open at plus the
  // resume/discard hooks for the suspended session (see main.ts).
  onOpenGame: (game: ImportedGame, ctx?: OpenGameCtx) => void;
}

export async function renderMistakesScreen(host: HTMLElement, deps: MistakesScreenDeps): Promise<void> {
  host.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'mistakes-screen';
  host.appendChild(root);

  let games: ImportedGame[];
  try {
    games = await getAllGames();
  } catch (err) {
    renderLoadError(host, err, () => { void renderMistakesScreen(host, deps); });
    return;
  }

  // Everything here trains from your own games, so without an import there is
  // nothing to scan yet — point at the games screen.
  if (games.length === 0) {
    root.appendChild(buildEmptyState({
      icon: Icons.reset(28),
      line: 'Train the exact positions where your games went wrong.',
      body: 'Import your games first — the scan then finds your blunders and missed wins.',
      cta: { label: 'Import my games', onClick: deps.onImportGames },
    }));
    return;
  }

  const rerender = (): void => { void renderMistakesScreen(host, deps); };
  const counts = countRetry(games);
  const refs = collectSpots(games);
  const newGames = unscannedCount(games);

  root.appendChild(renderHero());
  root.appendChild(renderCategoryCards());
  const carousel = renderLatestMistakes();
  if (carousel) root.appendChild(carousel);

  // ── The stats hero + the scan entry point ───────────────────────────────────
  function renderHero(): HTMLElement {
    const hero = document.createElement('div');
    hero.className = 'card train-hero mistakes-hero';

    const stats = document.createElement('div');
    stats.className = 'train-hero-stats';
    stats.appendChild(heroStat('found', counts.spots, 'Spots found'));
    stats.appendChild(heroStat('fixed', counts.fixed, 'Fixed'));
    stats.appendChild(heroStat('scanned', `${counts.scanned}/${counts.total}`, 'Games analysed'));
    hero.appendChild(stats);

    if (newGames > 0) {
      const scan = document.createElement('button');
      scan.type = 'button';
      scan.className = 'btn-primary train-hero-start';
      scan.appendChild(Icons.review(18));
      scan.appendChild(document.createTextNode(
        counts.scanned === 0 ? 'Analyse my games' : `Analyse new games (${newGames})`));
      scan.addEventListener('click', () => { void runScan(); });
      hero.appendChild(scan);

      const note = document.createElement('div');
      note.className = 'mistakes-hero-note';
      note.textContent = counts.scanned === 0
        ? `The engine looks through your ${counts.total === 1 ? 'game' : `${counts.total} games`} for mistakes worth retrying. Stop anytime — progress is saved.`
        : 'Newest first, stop anytime — progress is saved.';
      hero.appendChild(note);
    } else {
      const done = document.createElement('div');
      done.className = 'mistakes-hero-note mistakes-hero-note--done';
      done.textContent = 'All games analysed ✓ — new imports show up here.';
      hero.appendChild(done);
    }

    return hero;
  }

  function heroStat(kind: string, value: number | string, label: string): HTMLElement {
    const col = document.createElement('div');
    col.className = `train-hero-stat train-hero-stat--${kind}`;
    const num = document.createElement('span');
    num.className = 'train-hero-stat-num';
    if (typeof value === 'number') {
      num.textContent = '0';
      countUp(num, value);
    } else {
      num.textContent = value;
    }
    col.appendChild(num);
    const lbl = document.createElement('div');
    lbl.className = 'train-hero-stat-label';
    lbl.textContent = label;
    col.appendChild(lbl);
    return col;
  }

  // ── The four category cards ─────────────────────────────────────────────────
  function renderCategoryCards(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'section mode-cards';

    const label = document.createElement('div');
    label.className = 'section-title';
    label.textContent = 'Retry your mistakes';
    section.appendChild(label);

    for (const cat of CATEGORIES) {
      const pool = refs.filter(r => r.spot.category === cat);
      const unfixed = counts.unfixedByCategory[cat];
      section.appendChild(buildModeCard({
        accent: CATEGORY_ACCENT[cat],
        icon: CATEGORY_ICON[cat](),
        name: CATEGORY_LABEL[cat],
        sub: CATEGORY_SUB[cat],
        stat: pool.length > 0 ? unfixed : undefined,
        statLabel: pool.length > 0 ? 'to fix' : undefined,
        disabled: pool.length === 0,
        disabledReason: counts.scanned === 0
          ? 'Analyse your games first'
          : 'None found in your analysed games',
        onClick: () => startSession(pool, cat),
      }));
    }

    return section;
  }

  function startSession(pool: SpotRef[], cat: MistakeCategory): void {
    startMistakeSession({
      refs: pickSpots(pool, cat, SESSION_SIZE),
      modeLabel: CATEGORY_LABEL[cat],
      onExit: rerender,
      onPlayAgain: () => startSession(pool, cat),
      onOpenGame: deps.onOpenGame,
    });
  }

  // ── "Latest mistakes" board carousel ────────────────────────────────────────
  // One slide per category showing the newest unfixed spot: the position as you
  // had it, the played move as a red arrow, the drill's own story line, and a
  // "Fix it" that drills exactly that position. The nav is icon-only (all four
  // fit in a row); the active category's name reads below the icons.
  function renderLatestMistakes(): HTMLElement | null {
    const slides = CATEGORIES
      .map(cat => ({ cat, ref: latestUnfixed(cat) }))
      .filter((s): s is { cat: MistakeCategory; ref: SpotRef } => !!s.ref);
    if (slides.length === 0) return null;

    const section = document.createElement('div');
    section.className = 'section forgotten-section mrc-section';

    const label = document.createElement('div');
    label.className = 'section-title';
    label.textContent = 'Latest mistakes';
    section.appendChild(label);

    const tabs = document.createElement('div');
    tabs.className = 'mrc-tabs';
    // The active category's name, under the icon row (not inside the buttons, so
    // all four icons fit side by side).
    const tabTitle = document.createElement('div');
    tabTitle.className = 'mrc-tab-title';
    const track = document.createElement('div');
    track.className = 'forgotten-track mrc-track';

    const tabEls: HTMLButtonElement[] = [];
    slides.forEach((s, i) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'mrc-tab' + (i === 0 ? ' mrc-tab--active' : '');
      tab.style.setProperty('--mrc-accent', CATEGORY_ACCENT[s.cat]);
      tab.setAttribute('aria-label', CATEGORY_LABEL[s.cat]);
      tab.title = CATEGORY_LABEL[s.cat];
      tab.appendChild(CATEGORY_ICON[s.cat]());
      tab.addEventListener('click', () => {
        track.scrollTo({ left: track.clientWidth * i, behavior: 'smooth' });
      });
      tabEls.push(tab);
      tabs.appendChild(tab);
      track.appendChild(buildMistakeSlide(s.cat, s.ref));
    });
    tabTitle.textContent = CATEGORY_LABEL[slides[0].cat];

    // Keep the active tab + title in sync as the track is swiped.
    let raf = 0;
    track.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const idx = Math.min(slides.length - 1,
          Math.max(0, Math.round(track.scrollLeft / (track.clientWidth || 1))));
        tabEls.forEach((t, i) => t.classList.toggle('mrc-tab--active', i === idx));
        tabTitle.textContent = CATEGORY_LABEL[slides[idx].cat];
      });
    }, { passive: true });

    section.appendChild(tabs);
    section.appendChild(tabTitle);
    section.appendChild(track);
    return section;
  }

  // The newest unfixed spot in a category (the freshest thing worth fixing).
  function latestUnfixed(cat: MistakeCategory): SpotRef | null {
    const pool = refs
      .filter(r => r.spot.category === cat && !r.spot.fixed)
      .sort((a, b) => b.game.endTime - a.game.endTime);
    return pool[0] ?? null;
  }

  function buildMistakeSlide(cat: MistakeCategory, ref: SpotRef): HTMLElement {
    const slide = document.createElement('div');
    slide.className = 'forgotten-slide mrc-slide';

    const { spot, game } = ref;

    // A real (view-only) chessground, mirroring the forgotten-moves slides, with
    // the played mistake drawn in the review palette's blunder red.
    const board = document.createElement('div');
    board.className = 'forgotten-board cg-wrap';
    slide.appendChild(board);
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
    fix.addEventListener('click', () => {
      startMistakeSession({
        refs: [ref],
        modeLabel: CATEGORY_LABEL[cat],
        onExit: rerender,
        onOpenGame: deps.onOpenGame,
      });
    });
    body.appendChild(fix);

    const hint = document.createElement('div');
    hint.className = 'forgotten-hint';
    hint.textContent = 'find the best move';
    body.appendChild(hint);

    slide.appendChild(body);
    return slide;
  }

  // ── The scan run + its progress overlay ─────────────────────────────────────
  async function runScan(): Promise<void> {
    const ctrl = new AbortController();

    const overlay = document.createElement('div');
    overlay.className = 'pt-overlay mr-scan-overlay';
    const card = document.createElement('div');
    card.className = 'mr-scan-card';
    overlay.appendChild(card);

    const title = document.createElement('div');
    title.className = 'mr-scan-title';
    title.textContent = 'Analysing your games';
    card.appendChild(title);

    const pawn = createPawnProgress();
    card.appendChild(pawn.el);

    const status = document.createElement('div');
    status.className = 'mr-scan-status';
    status.textContent = 'Warming up the engine…';
    card.appendChild(status);

    const opp = document.createElement('div');
    opp.className = 'mr-scan-opp';
    card.appendChild(opp);

    // Live Lichess-cloud status, so it's clear whether the cloud is answering,
    // rate-limited or unreachable (the local engine covers the last two).
    const cloud = document.createElement('div');
    cloud.className = 'mr-scan-cloud';
    card.appendChild(cloud);
    const CLOUD_TEXT: Record<CloudHealth, string> = {
      untested: 'Checking the Lichess cloud…',
      ok: 'Lichess cloud connected ✓',
      limited: 'Lichess rate limit hit — on-device engine for a minute',
      down: 'Lichess unreachable — using the on-device engine',
    };
    const paintCloud = (): void => {
      const h = cloudHealth();
      cloud.textContent = CLOUD_TEXT[h];
      cloud.className = `mr-scan-cloud mr-scan-cloud--${h}`;
    };
    paintCloud();
    const cloudTimer = window.setInterval(paintCloud, 1500);

    const note = document.createElement('p');
    note.className = 'mr-scan-note';
    note.textContent = 'This can take a while — known positions come from the Lichess cloud in a blink, fresh ones run the local engine. Stop anytime — every game finished is saved.';
    card.appendChild(note);

    // The same looping "things about the app" ticker the import wait uses, so
    // there's something to read while the engine works.
    const facts = createFactsTicker();
    card.appendChild(facts.el);

    const stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'btn-secondary mr-scan-stop';
    stop.textContent = 'Stop & keep progress';
    stop.addEventListener('click', () => ctrl.abort());
    card.appendChild(stop);

    document.body.appendChild(overlay);
    pawn.start();
    const removeBack = pushBack(() => ctrl.abort());

    const onProgress = (p: ScanProgress): void => {
      pawn.set(p.gamesDone / Math.max(1, p.gamesTotal));
      status.textContent =
        `Game ${p.gamesDone} of ${p.gamesTotal} · ${p.spotsFound} ${p.spotsFound === 1 ? 'spot' : 'spots'} found`;
      opp.textContent = `vs ${p.opponent}`;
    };

    try {
      await scanGames({ signal: ctrl.signal, onProgress });
      pawn.done();
    } finally {
      clearInterval(cloudTimer);
      facts.stop();
      removeBack();
      overlay.remove();
      rerender();
    }
  }
}
