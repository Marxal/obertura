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
import { openInfoSheet, buildInfoButton } from './info-sheet';
import {
  autoScanState, onAutoScanChange, startAutoScan,
  suspendAutoScan, resumeAutoScan, getAutoScanEnabled,
  type AutoScanState,
} from './mistake-autoscan';
import { showToast } from './toast';
import { showDialog } from './dialog';
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
  resetMistakeScans,
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

// The mixed run at the top of the pane: how many mistake positions it deals from
// across the four categories, and how many brilliant finds it closes with. The
// two halves are two different exercises (find a better move / find the move you
// found), so they run back to back rather than shuffled into one another — the
// same shape the daily challenge uses for its two halves.
const MIX_MISTAKES = 8;
const MIX_BRILLIANT = 3;

// Brilliancies are scarce. Below this many of your own, the card pools the
// engine's "great" grade in with them so the exercise has something to deal;
// once you have a proper collection it narrows to the real thing.
const BRILLIANT_ONLY_FROM = 10;

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

// What the five exercises here actually are. The card subtitles are one short
// line each — enough to tell them apart in a menu, not enough to say where the
// positions come from or why a "blunder" and an "opening blunder" are two
// different cards. That answer lives one tap away rather than on every card.
function openMistakeInfo(): void {
  openInfoSheet({
    title: 'From your games',
    intro: 'Every position here is one you actually played. The engine reads your imported '
      + 'games, marks the moves where the evaluation swung, and hands the position back to '
      + 'you as it was — before you played the move.',
    entries: [
      {
        icon: Icons.sparkles(18), accent: CATEGORY_ACCENT['punish-opening'],
        label: 'Your games mix',
        detail: 'The button at the top. It deals from all four mistake cards in turn and '
          + 'finishes on your best moves, so you get a spread of your own game rather than '
          + 'having to pick a category first.',
      },
      {
        icon: Icons.zap(18), accent: CATEGORY_ACCENT['opening-blunder'],
        label: CATEGORY_LABEL['opening-blunder'],
        detail: 'Mistakes inside the first dozen moves — the ones a line in your repertoire '
          + 'would have prevented. The most useful card here, because these repeat.',
      },
      {
        icon: Icons.target(18), accent: CATEGORY_ACCENT['punish-opening'],
        label: CATEGORY_LABEL['punish-opening'],
        detail: 'Your OPPONENT went wrong in the opening and you let it go. Same positions, '
          + 'other side of the board: find the move that punishes it.',
      },
      {
        icon: Icons.star(18), accent: CATEGORY_ACCENT['missed-win'],
        label: CATEGORY_LABEL['missed-win'],
        detail: 'Positions where you were winning and the win slipped. Anywhere in the game, '
          + 'not just the opening.',
      },
      {
        icon: Icons.alert(18), accent: CATEGORY_ACCENT['blunder'],
        label: CATEGORY_LABEL['blunder'],
        detail: 'Game-losing moves from a level position — the plain ??, wherever it landed.',
      },
      {
        icon: classIcon('brilliant', 18), accent: CLASS_COLOR.brilliant,
        label: 'Your brilliant moves',
        detail: 'The opposite exercise: moves the engine graded brilliant (!!) or great (!) '
          + 'when you played them. Find them again. Once you have ten brilliancies of your '
          + 'own the card narrows to those alone. Solved ones rest a while, then come back.',
      },
    ],
    footnote: 'A card stays greyed out until the scan has found something for it. A spot you '
      + 'get right is marked fixed and goes to the back of its queue — it only comes round '
      + 'again once the unfixed ones have run out, and the "to fix" count never counts it. '
      + 'A brilliant move you re-find rests for a few days and then returns, longer each '
      + 'time you find it again.',
  });
}

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
  //
  // WHICH FINDS. A brilliant (!!) is rare — plenty of people have two in a
  // hundred games — so a card that only ever offered those would be a card with
  // nothing on it. Below BRILLIANT_ONLY_FROM of them the engine's "great" grade
  // is pooled in to make an exercise; at or above it the card is brilliancies
  // only, because by then there are enough of the real thing to fill a session
  // and mixing greats in would dilute it.
  const allGems = collectBrilliantSpots(games);
  const trueGems = allGems.filter(g => g.spot.cls === 'brilliant');
  const gemsOnly = trueGems.length >= BRILLIANT_ONLY_FROM;
  const dueMap = brilliantDueMap();
  const brilliantRefs = orderBrilliant(gemsOnly ? trueGems : allGems, id => dueMap[id] ?? 0);
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
    const foundNum = heroStat('found', counts.spots, 'Spots found');
    const scannedNum = heroStat('scanned', counts.scanned, 'Games analysed');
    stats.appendChild(foundNum.col);
    stats.appendChild(heroStat('fixed', counts.fixed, 'Fixed').col);
    // Just the count of games actually analysed — not "scanned/total", which
    // read as if the whole library were being added up.
    stats.appendChild(scannedNum.col);
    hero.appendChild(stats);

    // ── Your games mix ───────────────────────────────────────────────────────
    //
    // The front door this pane never had. Every other Train tab opens with one
    // wide button that just starts something — Puzzle rated mix, All endgame
    // puzzles — and this one opened with a menu of five cards and asked you to
    // choose a category first. Choosing between "Missed wins" and "Blunders" is
    // a decision about your own games that a first-timer has no basis for, and
    // the cards are still there for anyone who does. This deals from all of
    // them: mistake positions round-robin across the four categories, then your
    // brilliant finds to close on.
    const mix = buildMixButton();
    if (mix) hero.appendChild(mix);

    if (newGames > 0) {
      // The scan runs on its own now (mistake-autoscan.ts), so this is a LIVE
      // STATUS first and a button second. Watching it is optional: leaving the
      // screen doesn't stop it, and the spots appear on their own next time you
      // look. The button stays for someone who wants to sit and watch it — and
      // it is the only route when the background pass has been turned off.
      const live = document.createElement('div');
      live.className = 'mistakes-autoscan';
      hero.appendChild(live);

      const scan = document.createElement('button');
      scan.type = 'button';
      scan.className = 'btn-secondary train-hero-start mistakes-scan-now';
      scan.appendChild(Icons.review(18));
      scan.appendChild(document.createTextNode(
        counts.scanned === 0 ? 'Analyse my games now' : `Analyse new games (${newGames})`));
      scan.addEventListener('click', () => { void runScan(); });

      const note = document.createElement('div');
      note.className = 'mistakes-hero-note';
      hero.appendChild(note);

      // One painter for both faces so they can't drift: running says what it is
      // doing, idle says what is waiting and offers the button.
      const paintScanState = (st: AutoScanState): void => {
        live.replaceChildren();
        // The figures above, plus whatever this pass has turned up so far. They
        // are re-read from disk on the rebuild that follows the pass.
        foundNum.num.textContent = String(counts.spots + (st.running ? st.spots : 0));
        scannedNum.num.textContent = String(counts.scanned + (st.running ? st.done : 0));
        if (st.running) {
          const bar = document.createElement('div');
          bar.className = 'mistakes-autoscan-bar';
          const fill = document.createElement('span');
          fill.className = 'mistakes-autoscan-fill';
          fill.style.width = `${Math.round((st.done / Math.max(1, st.total)) * 100)}%`;
          bar.appendChild(fill);
          live.appendChild(bar);

          const label = document.createElement('div');
          label.className = 'mistakes-autoscan-label';
          label.textContent = st.opponent
            ? `Analysing in the background — game ${st.done} of ${st.total}, vs ${st.opponent}`
            : `Analysing in the background — game ${st.done} of ${st.total}`;
          live.appendChild(label);

          scan.remove();
          const carryOn = 'Carry on with anything else — this keeps going, and every game '
            + 'finished is saved.';
          note.textContent = st.spots > 0
            ? `${st.spots} ${st.spots === 1 ? 'spot' : 'spots'} found so far. ${carryOn}`
            : carryOn;
          return;
        }

        // Idle. Either it has not got to these games yet, or it is switched off.
        hero.insertBefore(scan, note);
        note.textContent = getAutoScanEnabled()
          ? `${newGames} ${newGames === 1 ? 'game is' : 'games are'} still to read. This happens `
            + 'on its own while the app is open — the button just makes it happen now.'
          : entitled
            ? `The engine looks through your ${counts.total === 1 ? 'game' : `${counts.total} games`} for mistakes worth retrying. Stop anytime — progress is saved.`
            : `The engine looks through your ${Math.min(counts.total, FREE_MISTAKE_GAME_WINDOW)} most recent games for mistakes worth retrying. Stop anytime — progress is saved.`;
      };

      paintScanState(autoScanState());
      // Live while the pane is mounted. The next render of this screen replaces
      // the nodes above, so the listener is dropped the moment its host goes.
      const stopWatching = onAutoScanChange((st) => {
        if (!hero.isConnected) { stopWatching(); return; }
        // A pass that has just finished has left new spots on disk; the whole
        // pane is built from those, so it is rebuilt rather than patched.
        if (!st.running && st.done > 0) { rerender(); return; }
        paintScanState(st);
      });
      // Nothing waiting means nothing to start; anything else nudges the pass
      // along, which is a no-op when it is already running.
      startAutoScan();
    } else {
      // Nothing to say beyond the fact. "New imports are read automatically" was
      // an explanation of a background job nobody asked about, printed under a
      // line that had already reported the job was finished.
      //
      // The one thing worth offering here is the way BACK: read them all again.
      // The engine improves, the scan's rules change, and a spot you fixed
      // months ago is worth being asked once more — but with the pane reporting
      // "all analysed" there was no route to any of that short of deleting your
      // games. It sits as a bare word beside the line, not a button: it is a
      // long job and a discard, and it asks first.
      const done = document.createElement('div');
      done.className = 'mistakes-hero-note mistakes-hero-note--done';
      const doneText = document.createElement('span');
      doneText.textContent = 'All games analysed';
      done.appendChild(doneText);
      done.appendChild(buildResetLink());
      hero.appendChild(done);
    }

    if (capResult.capped) {
      hero.appendChild(buildCapNotice(`Showing your ${FREE_MISTAKE_SPOTS} most recent mistakes`));
    }

    return hero;
  }

  // "Reset" beside the all-analysed line: read every game again from scratch.
  //
  // It is a DISCARD, so it asks first and says exactly what goes — the spots and
  // the fixed marks — and exactly what doesn't: the games themselves, their
  // saved analysis, and so the brilliant-move finds, which come from the
  // analysis rather than from this scan.
  function buildResetLink(): HTMLElement {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'mistakes-reset-link';
    reset.textContent = 'Reset';
    reset.addEventListener('click', () => showDialog({
      title: 'Analyse every game again?',
      body: `This clears the ${counts.spots} ${counts.spots === 1 ? 'spot' : 'spots'} found so `
        + `far and the ${counts.fixed} marked fixed, then reads all `
        + `${counts.scanned} ${counts.scanned === 1 ? 'game' : 'games'} from scratch.\n\n`
        + 'Your games, their analysis and your brilliant moves are untouched. The new scan '
        + 'runs in the background — you can carry on with anything else.',
      buttons: [
        {
          label: 'Analyse again',
          variant: 'danger',
          onClick: () => { void runReset(); },
        },
        { label: 'Cancel', variant: 'secondary' },
      ],
    }));
    return reset;
  }

  async function runReset(): Promise<void> {
    // Stop the background pass before the wipe, or it would be halfway through
    // writing a result for a game we are about to clear.
    suspendAutoScan();
    try {
      await resetMistakeScans();
      // Don't promise a background pass to someone who has turned it off in
      // Settings — for them the button on this card is the whole of it.
      showToast(getAutoScanEnabled()
        ? 'Starting again — analysing your games'
        : 'Scan cleared — press Analyse my games to read them again');
    } catch {
      showToast('Couldn’t reset the scan');
    } finally {
      resumeAutoScan();
      rerender();
    }
  }

  // The wide launch button, or null when the scan has not turned anything up
  // yet — a primary button that can only tell you there is nothing to do is
  // worse than no button.
  function buildMixButton(): HTMLElement | null {
    const spots = mixSpots();
    const gems = brilliantRefs.slice(0, MIX_BRILLIANT);
    if (spots.length === 0 && gems.length === 0) return null;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-primary train-hero-start mistakes-mix-btn';
    btn.appendChild(Icons.sparkles(18));
    btn.appendChild(document.createTextNode('Your games mix'));
    btn.addEventListener('click', () => startMix());
    return btn;
  }

  // The mistake half of the mix: deal round-robin across the four categories so
  // a library heavy in one of them doesn't fill the whole run with it. Each
  // category's own order is pickSpots's — unfixed and newest first, solved ones
  // behind them — so a spot you have already fixed only turns up once the
  // unfixed ones in its category have run out.
  function mixSpots(): SpotRef[] {
    const queues = CATEGORIES.map(cat =>
      pickSpots(refs.filter(r => r.spot.category === cat), cat, MIX_MISTAKES));
    const out: SpotRef[] = [];
    for (let round = 0; out.length < MIX_MISTAKES; round++) {
      let dealt = false;
      for (const q of queues) {
        if (round >= q.length) continue;
        out.push(q[round]);
        dealt = true;
        if (out.length >= MIX_MISTAKES) break;
      }
      if (!dealt) break;
    }
    return out;
  }

  // Mistakes, then the brilliancies as the run's last stretch — handed over by
  // the results screen's primary button, the way the daily challenge passes from
  // its puzzle half to its endgame half. Either half alone is still a mix worth
  // running when the other is empty.
  function startMix(): void {
    const spots = mixSpots();
    const gems = brilliantRefs.slice(0, MIX_BRILLIANT);
    if (spots.length === 0) { startBrilliant(brilliantRefs, MIX_BRILLIANT); return; }

    startMistakeSession({
      refs: spots,
      modeLabel: 'Your games mix',
      onExit: rerender,
      onPlayAgain: () => startMix(),
      onOpenGame: deps.onOpenGame,
      nextAction: gems.length > 0
        ? { label: 'Now your best moves', run: () => startBrilliant(brilliantRefs, MIX_BRILLIANT) }
        : undefined,
    });
  }

  // Returns the column AND its number, so a hero watching the background pass
  // can keep the figures honest — "0 spots found" over "36 spots found so far"
  // is the sort of contradiction that makes people distrust a whole screen.
  function heroStat(
    kind: string,
    value: number | string,
    label: string,
  ): { col: HTMLElement; num: HTMLElement } {
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
    return { col, num };
  }

  // ── The four category cards ─────────────────────────────────────────────────
  function renderCategoryCards(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'section mode-cards';

    const head = document.createElement('div');
    head.className = 'section-head-row';
    const label = document.createElement('div');
    label.className = 'section-title';
    label.textContent = 'From your games';
    head.appendChild(label);
    head.appendChild(buildInfoButton('About these exercises', openMistakeInfo));
    section.appendChild(head);

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
      sub: gemsOnly ? 'find your brilliancies again' : 'find your best moves again',
      stat: brilliantRefs.length > 0 ? brilliantRefs.length : undefined,
      statLabel: brilliantRefs.length > 0 ? 'to find' : undefined,
      disabled: brilliantRefs.length === 0,
      disabledReason: 'Analyse your games to find your brilliant moves',
      onClick: () => startBrilliant(brilliantRefs),
    }));

    return section;
  }

  function startBrilliant(pool: BrilliantRef[], count = SESSION_SIZE): void {
    // pool is already ordered (available gems first); take a session's worth.
    startBrilliantSession({
      refs: pool.slice(0, count),
      onExit: rerender,
      onPlayAgain: () => startBrilliant(pool, count),
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
    // The button and the background pass would otherwise queue on the same
    // engine worker and each make the other look stuck. The manual one wins:
    // it has someone watching it.
    suspendAutoScan();
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
      // Hand the engine back. If the user stopped early, the background pass
      // picks up from exactly where they left it.
      resumeAutoScan();
      rerender();
    }
  }
}
