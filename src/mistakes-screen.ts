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
import { buildInlineImport } from './import-inline';
import { renderLoadError } from './load-error';
import { Icons, classIcon, CLASS_LABEL, CLASS_COLOR } from './icons';
import { countUp } from './count-up';
import { pushBack } from './back-nav';
import { formatMove } from './notation';
import { cloudHealth, type CloudHealth } from './engine';
import { createPawnProgress, createFactsTicker } from './import-progress';
import { buildModeCard } from './train-screen';
import { showToast } from './toast';
import {
  isEntitled, buildCapNotice, FREE_MISTAKE_GAME_WINDOW, FREE_MISTAKE_SPOTS,
} from './entitlement';
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
  capMistakeGamesForTier,
} from './mistake-scan';
import type { MistakeCategory, RetryCounts, ScanProgress, SpotRef } from './mistake-scan';
import { startBrilliantSession } from './brilliant-run';
import {
  collectBrilliantSpots,
  orderBrilliant,
  type BrilliantRef,
} from './brilliant';
import { brilliantDueMap } from './brilliant-log';

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

  let allGames: ImportedGame[];
  try {
    allGames = await getAllGames();
  } catch (err) {
    renderLoadError(host, err, () => { void renderMistakesScreen(host, deps); });
    return;
  }

  // Everything here trains from your own games, so without an import there is
  // nothing to scan yet — and the import form itself is what the screen shows,
  // rather than a button that opens one.
  if (allGames.length === 0) {
    // .mistakes-screen has no side padding of its own — every block inside it
    // brings its own gutter (see .mistakes-hero). So does this one, otherwise
    // the import box runs edge to edge while everything else on Train is inset.
    const empty = document.createElement('div');
    empty.className = 'mistakes-empty';
    const line = document.createElement('p');
    line.className = 'empty-state-line';
    line.textContent = 'Train the exact positions where your games went wrong.';
    empty.appendChild(line);
    empty.appendChild(buildInlineImport({
      title: 'Import your games',
      body: 'The scan then finds your blunders, your missed wins and the chances your opponents handed you.',
      onImported: () => { void renderMistakesScreen(host, deps); },
    }));
    root.appendChild(empty);
    return;
  }

  const entitled = isEntitled();
  // Free tier: a view-only cap (games/spots on disk are never touched) — the
  // 50 most recent games, and a rolling top 10 unfixed spots (fixed spots are
  // never hidden). `games` below drives every stat, card and carousel, so the
  // cap holds everywhere with no further branching.
  const capResult = entitled
    ? { games: allGames, capped: false }
    : capMistakeGamesForTier(allGames, FREE_MISTAKE_GAME_WINDOW, FREE_MISTAKE_SPOTS);
  const games = capResult.games;

  const rerender = (): void => { void renderMistakesScreen(host, deps); };
  // "Games analysed" stays the TRUE lifetime count (never windowed) so an
  // existing tester's history never reads as having vanished; only the spot
  // counts/cards/carousel below are capped.
  const spotCounts = countRetry(games);
  const { scanned, total } = entitled ? spotCounts : countRetry(allGames);
  const counts: RetryCounts = { ...spotCounts, scanned, total };
  const refs = collectSpots(games);
  // Order the brilliant finds so the carousel + session loop through them:
  // freshly-solved gems rest a while, then resurface (brilliant-log.ts).
  const dueMap = brilliantDueMap();
  const brilliantRefs = orderBrilliant(collectBrilliantSpots(games), id => dueMap[id] ?? 0);
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
    // Just the count of games actually analysed — not "scanned/total", which
    // read as if the whole library were being added up.
    stats.appendChild(heroStat('scanned', counts.scanned, 'Games analysed'));
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
        ? entitled
          ? `The engine looks through your ${counts.total === 1 ? 'game' : `${counts.total} games`} for mistakes worth retrying. Stop anytime — progress is saved.`
          : `The engine looks through your ${Math.min(counts.total, FREE_MISTAKE_GAME_WINDOW)} most recent games for mistakes worth retrying. Stop anytime — progress is saved.`
        : 'Newest first, stop anytime — progress is saved.';
      hero.appendChild(note);
    } else {
      const done = document.createElement('div');
      done.className = 'mistakes-hero-note mistakes-hero-note--done';
      done.textContent = 'All games analysed ✓ — new imports show up here.';
      hero.appendChild(done);
    }

    if (capResult.capped) {
      hero.appendChild(buildCapNotice(`Showing your ${FREE_MISTAKE_SPOTS} most recent mistakes`));
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
    label.textContent = 'From your games';
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

    // Your brilliant moves — the flip side of the mistake cards: find again the
    // best moves you already found. Sourced from analysed games (the review's
    // brilliant/great grades), not the mistake scan.
    section.appendChild(buildModeCard({
      accent: CLASS_COLOR.brilliant,
      icon: classIcon('brilliant', 20),
      name: 'Your brilliant moves',
      sub: 'find your best moves again',
      stat: brilliantRefs.length > 0 ? brilliantRefs.length : undefined,
      statLabel: brilliantRefs.length > 0 ? 'to find' : undefined,
      disabled: brilliantRefs.length === 0,
      disabledReason: 'Analyse your games to find your brilliant moves',
      onClick: () => startBrilliant(brilliantRefs),
    }));

    return section;
  }

  function startBrilliant(pool: BrilliantRef[]): void {
    // pool is already ordered (available gems first); take a session's worth.
    startBrilliantSession({
      refs: pool.slice(0, SESSION_SIZE),
      onExit: rerender,
      onPlayAgain: () => startBrilliant(pool),
      onOpenGame: deps.onOpenGame,
    });
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
    const slides: CarouselSlide[] = [];
    for (const cat of CATEGORIES) {
      const pool = unfixedPool(cat);
      if (pool.length) slides.push({ kind: 'mistake', cat, pool });
    }
    // The brilliant/great finds, one slide leading with the next one to re-find
    // (the move stays hidden — finding it is the exercise). Tapping in chains
    // through the rest so a solve rolls straight on to the next.
    if (brilliantRefs.length) slides.push({ kind: 'brilliant', pool: brilliantRefs });
    if (slides.length === 0) return null;

    const section = document.createElement('div');
    section.className = 'section forgotten-section mrc-section';

    const label = document.createElement('div');
    label.className = 'section-title';
    label.textContent = 'Latest games';
    section.appendChild(label);

    const tabs = document.createElement('div');
    tabs.className = 'mrc-tabs';
    // The active slide's name, under the icon row (not inside the buttons, so
    // all the icons fit side by side).
    const tabTitle = document.createElement('div');
    tabTitle.className = 'mrc-tab-title';
    const track = document.createElement('div');
    track.className = 'forgotten-track mrc-track';

    const tabEls: HTMLButtonElement[] = [];
    slides.forEach((s, i) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'mrc-tab' + (i === 0 ? ' mrc-tab--active' : '');
      tab.style.setProperty('--mrc-accent', slideAccent(s));
      tab.setAttribute('aria-label', slideLabel(s));
      tab.title = slideLabel(s);
      tab.appendChild(slideIcon(s));
      tab.addEventListener('click', () => {
        track.scrollTo({ left: track.clientWidth * i, behavior: 'smooth' });
      });
      tabEls.push(tab);
      tabs.appendChild(tab);
      track.appendChild(s.kind === 'brilliant'
        ? buildBrilliantSlide(s.pool)
        : buildMistakeSlide(s.cat, s.pool));
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

    section.appendChild(tabs);
    section.appendChild(tabTitle);
    section.appendChild(track);
    return section;
  }

  // One carousel slide: either the newest unfixed mistake in a category, or the
  // newest brilliant/great find. Each carries its own tab icon, accent and name.
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

  // A brilliant/great find as a carousel slide — the board sits at the position
  // before your move with NOTHING drawn (the move is the answer), and "Find it
  // again" drills it, then chains on through the rest of the finds so a solve
  // rolls straight to the next one (never forcing an End session after one).
  function buildBrilliantSlide(pool: BrilliantRef[]): HTMLElement {
    const ref = pool[0];
    const slide = document.createElement('div');
    slide.className = 'forgotten-slide mrc-slide';

    const { spot, game } = ref;

    const board = document.createElement('div');
    board.className = 'forgotten-board cg-wrap';
    slide.appendChild(board);
    const cg = Chessground(board, {
      fen: spot.preFen,
      orientation: game.colour,
      viewOnly: true,
      coordinates: false,
      animation: { enabled: false },
      drawable: { enabled: false, visible: false },
    });
    requestAnimationFrame(() => cg.redrawAll());

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
    fix.addEventListener('click', () => {
      startBrilliantSession({
        refs: pool.slice(0, SESSION_SIZE),
        onExit: rerender,
        onOpenGame: deps.onOpenGame,
      });
    });
    body.appendChild(fix);

    const hint = document.createElement('div');
    hint.className = 'forgotten-hint';
    hint.textContent = 'find your best move';
    body.appendChild(hint);

    slide.appendChild(body);
    return slide;
  }

  // The unfixed spots in a category, newest first — the lead is the freshest
  // thing worth fixing, and the rest chain behind it for "Next position".
  function unfixedPool(cat: MistakeCategory): SpotRef[] {
    return refs
      .filter(r => r.spot.category === cat && !r.spot.fixed)
      .sort((a, b) => b.game.endTime - a.game.endTime);
  }

  function buildMistakeSlide(cat: MistakeCategory, pool: SpotRef[]): HTMLElement {
    const ref = pool[0];
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
        refs: pool.slice(0, SESSION_SIZE),
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
      const result = await scanGames({
        signal: ctrl.signal,
        onProgress,
        cap: entitled ? undefined : { windowGames: FREE_MISTAKE_GAME_WINDOW, maxUnfixed: FREE_MISTAKE_SPOTS },
      });
      // A cap already met before scanning anything burns zero cloud calls, but
      // that also looks like the button did nothing — say so explicitly rather
      // than silently closing the overlay.
      if (result.capped && result.scanned === 0 && !result.aborted) {
        showToast(`You're at ${FREE_MISTAKE_SPOTS} mistakes — fix some to find more, or unlock full history.`);
      }
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
