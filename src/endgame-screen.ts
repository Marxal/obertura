// The End game tab. Three pillars, top to bottom:
//   • Endgame puzzles — rated Lichess puzzles filtered to endgame themes, on their
//     OWN rating ladder. A wide "all endgames" button plus a row of piece-symbol
//     shortcuts (rook / pawn / queen / minor). Reuses the whole puzzle-run engine.
//   • Classic endgames — a curated list of fundamentals (endgame-catalog.ts) you
//     play out against the engine, judged by the Lichess tablebase
//     (endgame-playout.ts). Grouped by theme in collapsible accordions; each solve
//     banks a best time, so the list is a beat-the-clock ladder.
//   • From your games — endgames you actually reached, found by a scan over your
//     imported games (endgame-scan.ts) and played out the same way.

import { Icons } from './icons';
import { fetchNextPuzzle } from './puzzles';
import {
  startPuzzleSession, type PuzzleDraw, type AnalyseRequest,
} from './puzzle-run';
import { getPuzzleRating, getBestCleanStreak, difficultyForRating } from './puzzle-rating';
import { buildPositionCard, colourPip } from './card-position';
import { countUp } from './count-up';
import {
  endgamesByCategory, type Endgame, type EndgameGroup, type EndgameCategory,
  LEVEL_META,
} from './endgame-catalog';
import { getEndgameProgress, type EndgameProgress } from './endgame-progress';
import { startEndgamePlayout } from './endgame-playout';
import { getAllGames } from './storage';
import type { ImportedGame } from './import-core';
import {
  scanEndgames, collectEndgameSpots, unscannedEndgameCount,
  type EndgameSpotRef, type EndgameScanProgress,
} from './endgame-scan';
import { createPawnProgress, createFactsTicker } from './import-progress';
import { pushBack } from './back-nav';
import { Chessground } from 'chessground';

export interface EndgameScreenDeps {
  // Open a finished puzzle in the full analyser (Engine tab) — wired from main.ts.
  onAnalysePosition?: (req: AnalyseRequest) => void;
  // Send the user to the Games screen to import (the "From your games" empty state).
  onImportGames: () => void;
}

// A puzzle-theme filter → a Lichess "angle". 'minor' alternates bishop/knight so
// both minor-piece flavours show up. See the confirmed angles in puzzles.ts.
type PuzzleTheme = 'all' | 'rook' | 'pawn' | 'queen' | 'minor';
const THEME_LABEL: Record<PuzzleTheme, string> = {
  all: 'All endgames', rook: 'Rook', pawn: 'Pawn', queen: 'Queen', minor: 'Minor piece',
};
// The specific themes, as piece-symbol shortcuts under the wide "all" button. A
// trailing U+FE0E asks for the text (not emoji) glyph — same trick as board-mini.
const VS = String.fromCharCode(0xfe0e);
const SPECIFIC_THEMES: { theme: Exclude<PuzzleTheme, 'all'>; symbol: string }[] = [
  { theme: 'rook', symbol: '♜' + VS },
  { theme: 'pawn', symbol: '♟' + VS },
  { theme: 'queen', symbol: '♛' + VS },
  { theme: 'minor', symbol: '♞' + VS },
];
const PUZZLE_COUNT = 8;
// Cap the "From your games" carousel so a big library doesn't spin up dozens of
// boards; the most instructive (let-slip first, then recent) lead.
const FROM_GAMES_MAX = 10;

// Resolve a theme to the angle for one fetch (minor alternates each draw).
function angleFor(theme: PuzzleTheme): string {
  switch (theme) {
    case 'rook': return 'rookEndgame';
    case 'pawn': return 'pawnEndgame';
    case 'queen': return 'queenEndgame';
    case 'minor': return Math.random() < 0.5 ? 'bishopEndgame' : 'knightEndgame';
    default: return 'endgame';
  }
}

// A rated endgame-puzzle run: fixed count, difficulty tracking YOUR endgame rating,
// scored on the 'endgame' ladder. Mirrors the openings runner but single-angle.
function runEndgamePuzzles(theme: PuzzleTheme, deps: EndgameScreenDeps, onExit: () => void): void {
  startPuzzleSession({
    modeLabel: `Endgame puzzles — ${THEME_LABEL[theme]}`,
    mode: { kind: 'count', count: PUZZLE_COUNT, rated: true },
    ratingScope: 'endgame',
    onAnalysePosition: deps.onAnalysePosition,
    nextPuzzle: async (): Promise<PuzzleDraw | null> => {
      const angle = angleFor(theme);
      const difficulty = difficultyForRating(getPuzzleRating('endgame'));
      const puzzle = await fetchNextPuzzle(angle, { difficulty });
      return puzzle ? { puzzle, angle } : null;
    },
    onExit,
    onPlayAgain: () => runEndgamePuzzles(theme, deps, onExit),
  });
}

// A best-time mark as m:ss.
function formatTime(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// A best-time chip (only shown once a time exists).
function bestTimeChip(ms: number): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'eg-best';
  chip.appendChild(Icons.clock(13));
  const t = document.createElement('span');
  t.textContent = `Best ${formatTime(ms)}`;
  chip.appendChild(t);
  chip.setAttribute('aria-label', `Best time ${formatTime(ms)}`);
  return chip;
}

// A muted stand-in shown before any time is set — an invitation to race.
function placeholderBest(): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'eg-best eg-best--none';
  chip.appendChild(Icons.clock(13));
  const t = document.createElement('span');
  t.textContent = 'Not timed';
  chip.appendChild(t);
  return chip;
}

// Best guess at a from-games position's category (for the synthesized Endgame).
function guessCategory(fen: string): EndgameCategory {
  const board = fen.split(' ')[0];
  if (/[Qq]/.test(board)) return 'queen';
  if (/[Rr]/.test(board)) return 'rook';
  if (/[BbNn]/.test(board)) return 'minor';
  if (/[Pp]/.test(board)) return 'pawn';
  return 'mates';
}

export function renderEndgameScreen(host: HTMLElement, deps: EndgameScreenDeps): void {
  host.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'eg-screen';
  host.appendChild(root);

  let firstRender = true;
  // Imported games for the "From your games" section, loaded once (null = loading).
  let games: ImportedGame[] | null = null;
  let loadingGames = false;
  // Set when a scan bailed because the tablebase was unreachable — a gentle nudge.
  let lastScanUnreachable = false;

  function ensureGames(): void {
    if (games !== null || loadingGames) return;
    loadingGames = true;
    void getAllGames()
      .then((g) => { games = g; loadingGames = false; rebuild(); })
      .catch(() => { games = []; loadingGames = false; rebuild(); });
  }

  const rebuild = (): void => {
    root.innerHTML = '';
    root.appendChild(renderPuzzles(firstRender));
    root.appendChild(renderFromGames());
    root.appendChild(renderClassics());
    firstRender = false;
  };

  // ── Endgame puzzles ─────────────────────────────────────────────────────────
  function renderPuzzles(animate: boolean): HTMLElement {
    const hero = document.createElement('div');
    hero.className = 'card train-hero eg-hero pz-hero';

    const stats = document.createElement('div');
    stats.className = 'train-hero-stats';
    stats.appendChild(heroStat('rating', getPuzzleRating('endgame'), 'Endgame rating', animate));
    stats.appendChild(heroStat('run', getBestCleanStreak('endgame'), 'Best run', animate));
    hero.appendChild(stats);

    // The wide "all endgames" button.
    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'btn-primary train-hero-start eg-hero-start';
    start.appendChild(Icons.puzzlePiece(18));
    start.appendChild(document.createTextNode('Solve endgame puzzles'));
    start.addEventListener('click', () => runEndgamePuzzles('all', deps, rebuild));
    hero.appendChild(start);

    // Piece-symbol shortcuts to each specific theme, on one row.
    const pieces = document.createElement('div');
    pieces.className = 'eg-piece-row';
    for (const { theme, symbol } of SPECIFIC_THEMES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'eg-piece-btn';
      btn.textContent = symbol;
      btn.setAttribute('aria-label', `${THEME_LABEL[theme]} endgames`);
      btn.addEventListener('click', () => runEndgamePuzzles(theme, deps, rebuild));
      pieces.appendChild(btn);
    }
    hero.appendChild(pieces);

    const note = document.createElement('div');
    note.className = 'pz-hero-note';
    note.textContent = `${PUZZLE_COUNT} rated puzzles — a ladder just for endgames`;
    hero.appendChild(note);

    return hero;
  }

  function heroStat(kind: string, value: number, label: string, animate: boolean): HTMLElement {
    const col = document.createElement('div');
    col.className = `train-hero-stat train-hero-stat--${kind}`;
    const num = document.createElement('span');
    num.className = 'train-hero-stat-num';
    num.textContent = animate ? '0' : String(value);
    col.appendChild(num);
    const lbl = document.createElement('div');
    lbl.className = 'train-hero-stat-label';
    lbl.textContent = label;
    col.appendChild(lbl);
    if (animate) countUp(num, value);
    return col;
  }

  // ── Classic endgames ────────────────────────────────────────────────────────
  // Play a classic, chaining "Next endgame" through the group's items in order.
  function launchClassic(items: Endgame[], index: number): void {
    const next = items[index + 1];
    startEndgamePlayout(items[index], {
      onExit: rebuild,
      onNext: next ? () => launchClassic(items, index + 1) : undefined,
    });
  }

  function renderClassics(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'eg-classics';

    // Header: title + an (i) toggle that reveals the intro text (Fix 5).
    const head = document.createElement('div');
    head.className = 'eg-section-head';
    const title = document.createElement('div');
    title.className = 'section-title section-title--icon';
    title.appendChild(Icons.flag(16));
    title.appendChild(document.createTextNode('Classic endgames'));
    head.appendChild(title);
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'eg-info-btn';
    info.appendChild(Icons.info(16));
    info.setAttribute('aria-label', 'About classic endgames');
    info.setAttribute('aria-expanded', 'false');
    head.appendChild(info);
    wrap.appendChild(head);

    const desc = document.createElement('p');
    desc.className = 'pz-ta-desc eg-info-text';
    desc.textContent = 'The fundamentals every player should know. Load one and play it out against the engine — then race your own best time.';
    desc.hidden = true;
    info.addEventListener('click', () => {
      desc.hidden = !desc.hidden;
      info.setAttribute('aria-expanded', String(!desc.hidden));
    });
    wrap.appendChild(desc);

    const progress = getEndgameProgress();
    // Accordions start closed, so the classic list is a short, scannable stack.
    for (const group of endgamesByCategory()) wrap.appendChild(renderGroup(group, progress));
    return wrap;
  }

  function renderGroup(group: EndgameGroup, progress: EndgameProgress): HTMLElement {
    const details = document.createElement('details');
    details.className = 'section section--acc eg-acc';

    const summary = document.createElement('summary');
    summary.className = 'section-title section-summary';
    const left = document.createElement('span');
    left.className = 'section-summary-left eg-acc-left';
    const sym = document.createElement('span');
    sym.className = 'eg-acc-symbol';
    sym.textContent = group.symbol;
    sym.setAttribute('aria-hidden', 'true');
    left.appendChild(sym);
    const label = document.createElement('span');
    label.textContent = group.label;
    left.appendChild(label);
    summary.appendChild(left);
    summary.appendChild(Icons.chevronRight(16));
    details.appendChild(summary);

    const blurb = document.createElement('div');
    blurb.className = 'eg-group-blurb';
    blurb.textContent = group.blurb;
    details.appendChild(blurb);

    const list = document.createElement('div');
    list.className = 'eg-list';
    // Chain "Next endgame" through this group's items in order.
    group.items.forEach((eg, i) => {
      list.appendChild(renderCard(eg, progress[eg.id]?.bestMs, () => launchClassic(group.items, i)));
    });
    details.appendChild(list);
    return details;
  }

  function renderCard(eg: Endgame, bestMs: number | undefined, onPlay: () => void): HTMLElement {
    const { card, titleRow, content } = buildPositionCard({
      fen: eg.fen,
      orientation: eg.youPlay,
      className: 'eg-card',
      onMiniClick: onPlay,
      miniLabel: `Play ${eg.name}`,
    });

    titleRow.appendChild(colourPip(eg.youPlay));
    const name = document.createElement('span');
    name.className = 'pcard-title eg-card-name';
    name.textContent = eg.name;
    titleRow.appendChild(name);
    const level = document.createElement('span');
    level.className = `eg-level eg-level--${eg.level}`;
    level.textContent = LEVEL_META[eg.level].label;
    titleRow.appendChild(level);

    // Content column beside the board: Win/Draw and best time each on their own
    // row (Fix 2), so the play button below can stand out.
    const goalRow = document.createElement('div');
    goalRow.className = 'eg-card-row';
    const goal = document.createElement('span');
    goal.className = `eg-goal-chip eg-goal-chip--${eg.goal}`;
    goal.textContent = eg.goal === 'win' ? 'Win' : 'Draw';
    goalRow.appendChild(goal);
    content.appendChild(goalRow);

    const bestRow = document.createElement('div');
    bestRow.className = 'eg-card-row eg-card-best-row';
    if (bestMs) bestRow.appendChild(bestTimeChip(bestMs));
    else bestRow.appendChild(placeholderBest());
    content.appendChild(bestRow);

    // A prominent, full-width play button spanning the whole card (Fix 2).
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'btn-primary eg-card-play';
    play.appendChild(Icons.play(16));
    play.appendChild(document.createTextNode('Play'));
    play.addEventListener('click', onPlay);
    card.appendChild(play);

    return card;
  }

  // ── From your games ───────────────────────────────────────────────────────────
  // A swipeable carousel — one endgame at a time, like the Latest-mistakes and
  // Forgotten-moves carousels (Fix 1). Sits above the Classic endgames.
  function renderFromGames(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'section forgotten-section eg-fg-section';

    const title = document.createElement('div');
    title.className = 'section-title section-title--icon';
    title.appendChild(Icons.sparkles(16));
    title.appendChild(document.createTextNode('From your games'));
    section.appendChild(title);

    ensureGames();
    const gs = games; // narrow the mutable closure var once

    if (gs === null) {
      const loading = document.createElement('p');
      loading.className = 'pz-ta-desc';
      loading.textContent = 'Loading your games…';
      section.appendChild(loading);
      return section;
    }

    if (gs.length === 0) {
      const msg = document.createElement('p');
      msg.className = 'pz-ta-desc';
      msg.textContent = 'Import your games and this finds the endgames you actually reached — play them out against the engine.';
      section.appendChild(msg);
      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'btn-primary eg-scan-btn';
      cta.appendChild(Icons.play(16));
      cta.appendChild(document.createTextNode('Import games'));
      cta.addEventListener('click', () => deps.onImportGames());
      section.appendChild(cta);
      return section;
    }

    const unscanned = unscannedEndgameCount(gs);
    if (unscanned > 0) {
      const scan = document.createElement('button');
      scan.type = 'button';
      scan.className = 'btn-primary eg-scan-btn';
      scan.appendChild(Icons.sparkles(16));
      scan.appendChild(document.createTextNode(`Scan my games (${unscanned})`));
      scan.addEventListener('click', () => { void runScan(); });
      section.appendChild(scan);
    }

    if (lastScanUnreachable) {
      const warn = document.createElement('p');
      warn.className = 'eg-scan-warn';
      warn.textContent = 'Couldn’t reach the endgame tablebase — connect to the internet and scan again.';
      section.appendChild(warn);
    }

    // Ordered spots: the ones you didn't convert first, then most-recent games.
    const progress = getEndgameProgress();
    const spots = collectEndgameSpots(gs).sort((a, b) => {
      if (a.spot.converted !== b.spot.converted) return a.spot.converted ? 1 : -1;
      return b.game.endTime - a.game.endTime;
    });

    if (spots.length === 0) {
      if (unscanned === 0 && !lastScanUnreachable) {
        const none = document.createElement('p');
        none.className = 'pz-ta-desc eg-fromgames-none';
        none.textContent = 'No playable endgames found in your games yet.';
        section.appendChild(none);
      }
      return section;
    }

    // The swipe track: one board per slide (capped), plus dot indicators that
    // stay in sync with the scroll position.
    const shown = spots.slice(0, FROM_GAMES_MAX);
    const track = document.createElement('div');
    track.className = 'forgotten-track eg-fg-track';
    const dots = document.createElement('div');
    dots.className = 'eg-fg-dots';
    const dotEls: HTMLButtonElement[] = [];

    shown.forEach((ref, i) => {
      track.appendChild(buildSpotSlide(ref, progress, () => launchSpot(shown, i)));
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'eg-fg-dot' + (i === 0 ? ' eg-fg-dot--active' : '');
      dot.setAttribute('aria-label', `Endgame ${i + 1} of ${shown.length}`);
      dot.addEventListener('click', () => track.scrollTo({ left: track.clientWidth * i, behavior: 'smooth' }));
      dotEls.push(dot);
      dots.appendChild(dot);
    });

    let raf = 0;
    track.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const idx = Math.min(shown.length - 1,
          Math.max(0, Math.round(track.scrollLeft / (track.clientWidth || 1))));
        dotEls.forEach((d, i) => d.classList.toggle('eg-fg-dot--active', i === idx));
      });
    }, { passive: true });

    section.appendChild(track);
    if (shown.length > 1) section.appendChild(dots);
    if (spots.length > shown.length) {
      const more = document.createElement('p');
      more.className = 'eg-fg-more';
      more.textContent = `Showing ${shown.length} of ${spots.length} — the most instructive first.`;
      section.appendChild(more);
    }
    return section;
  }

  function spotId(ref: EndgameSpotRef): string {
    return `game:${ref.game.id}:${ref.spot.ply}`;
  }

  function spotToEndgame(ref: EndgameSpotRef): Endgame {
    const { game, spot } = ref;
    return {
      id: spotId(ref),
      category: guessCategory(spot.fen),
      level: spot.outcome === 'win' ? 'intermediate' : 'advanced',
      name: `vs ${game.opponent}`,
      fen: spot.fen,
      youPlay: spot.youPlay,
      goal: spot.outcome,
      idea: spot.outcome === 'win'
        ? 'You had a winning endgame here — can you convert it against best defence?'
        : 'This was holdable — draw it against best play.',
    };
  }

  function launchSpot(ordered: EndgameSpotRef[], index: number): void {
    const next = ordered[index + 1];
    startEndgamePlayout(spotToEndgame(ordered[index]), {
      onExit: rebuild,
      onNext: next ? () => launchSpot(ordered, index + 1) : undefined,
    });
  }

  // One carousel slide: a full-width board of the position, then who it was
  // against, the result you could have reached, and a "Play it out" button.
  function buildSpotSlide(ref: EndgameSpotRef, progress: EndgameProgress, onPlay: () => void): HTMLElement {
    const { game, spot } = ref;
    const slide = document.createElement('div');
    slide.className = 'forgotten-slide eg-fg-slide';

    const board = document.createElement('div');
    board.className = 'forgotten-board cg-wrap';
    slide.appendChild(board);
    const cg = Chessground(board, {
      fen: spot.fen,
      orientation: spot.youPlay,
      viewOnly: true,
      coordinates: false,
      animation: { enabled: false },
      drawable: { enabled: false, visible: false },
    });
    requestAnimationFrame(() => cg.redrawAll());

    const body = document.createElement('div');
    body.className = 'forgotten-body eg-fg-body';

    const who = document.createElement('div');
    who.className = 'eg-fg-who';
    who.appendChild(colourPip(spot.youPlay));
    const whoName = document.createElement('span');
    whoName.textContent = `vs ${game.opponent}`;
    who.appendChild(whoName);
    body.appendChild(who);

    const meta = document.createElement('div');
    meta.className = 'eg-fg-meta';
    const goal = document.createElement('span');
    goal.className = `eg-goal-chip eg-goal-chip--${spot.outcome}`;
    goal.textContent = spot.outcome === 'win' ? 'Win was there' : 'Draw was there';
    meta.appendChild(goal);
    if (!spot.converted) {
      const slip = document.createElement('span');
      slip.className = 'eg-slip';
      slip.textContent = 'Let slip';
      meta.appendChild(slip);
    }
    const best = progress[spotId(ref)]?.bestMs;
    if (best) meta.appendChild(bestTimeChip(best));
    body.appendChild(meta);

    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'btn-primary forgotten-fix-btn';
    play.textContent = spot.outcome === 'win' ? 'Convert it' : 'Hold the draw';
    play.addEventListener('click', onPlay);
    body.appendChild(play);

    slide.appendChild(body);
    return slide;
  }

  // ── The scan run + its progress overlay (mirrors mistakes-screen.ts) ──────────
  async function runScan(): Promise<void> {
    const ctrl = new AbortController();

    const overlay = document.createElement('div');
    overlay.className = 'pt-overlay mr-scan-overlay';
    const card = document.createElement('div');
    card.className = 'mr-scan-card';
    overlay.appendChild(card);

    const title = document.createElement('div');
    title.className = 'mr-scan-title';
    title.textContent = 'Finding your endgames';
    card.appendChild(title);

    const pawn = createPawnProgress();
    card.appendChild(pawn.el);

    const status = document.createElement('div');
    status.className = 'mr-scan-status';
    status.textContent = 'Reading your games…';
    card.appendChild(status);

    const opp = document.createElement('div');
    opp.className = 'mr-scan-opp';
    card.appendChild(opp);

    const note = document.createElement('p');
    note.className = 'mr-scan-note';
    note.textContent = 'Each game is checked against the Lichess endgame tablebase. Stop anytime — every game finished is saved.';
    card.appendChild(note);

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

    const onProgress = (p: EndgameScanProgress): void => {
      pawn.set(p.gamesDone / Math.max(1, p.gamesTotal));
      status.textContent =
        `Game ${p.gamesDone} of ${p.gamesTotal} · ${p.found} ${p.found === 1 ? 'endgame' : 'endgames'} found`;
      opp.textContent = `vs ${p.opponent}`;
    };

    try {
      const result = await scanEndgames({ signal: ctrl.signal, onProgress });
      lastScanUnreachable = result.unreachable;
      pawn.done();
    } finally {
      facts.stop();
      removeBack();
      overlay.remove();
      // Reload the games so freshly-scanned results show, then repaint.
      games = null;
      rebuild();
    }
  }

  rebuild();
}
