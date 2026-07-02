// The Mistake retry pane on the Train screen — drills the exact positions from
// your own imported games where you went wrong. This file renders the pane:
// the stats hero, the "Analyse my games" scan (with its progress overlay), and
// the four category cards. The scan itself lives in mistake-scan.ts and the
// solving overlay in mistake-run.ts.

import type { ImportedGame } from './import-core';
import { getAllGames } from './storage';
import { buildEmptyState } from './empty-state';
import { renderLoadError } from './load-error';
import { Icons } from './icons';
import { countUp } from './count-up';
import { pushBack } from './back-nav';
import { createPawnProgress } from './import-progress';
import { buildModeCard } from './train-screen';
import { startMistakeSession, CATEGORY_LABEL } from './mistake-run';
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
  // analysis" route, wired from main.ts exactly like My games' onOpenGame.
  onOpenGame: (game: ImportedGame) => void;
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

    const note = document.createElement('p');
    note.className = 'mr-scan-note';
    note.textContent = 'Known positions come from the Lichess cloud in a blink; fresh ones run the local engine. Stop anytime — every game finished is saved.';
    card.appendChild(note);

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
      removeBack();
      overlay.remove();
      rerender();
    }
  }
}
