// The End game tab. Two pillars, replacing the old "Coming soon" placeholder:
//   • Endgame puzzles — rated Lichess puzzles filtered to endgame themes, on their
//     OWN rating ladder (separate from the openings puzzle rating). Reuses the
//     whole puzzle-run engine; we just feed it endgame angles and a rating scope.
//   • Classic endgames — a curated list of fundamentals (endgame-catalog.ts) you
//     play out against the engine, judged by the Lichess tablebase
//     (endgame-playout.ts). Grouped by theme, ticked as you master them.
//
// "Endgames from your own games" is a later round (see ROADMAP); a quiet teaser
// footer points at it.

import { Icons } from './icons';
import { fetchNextPuzzle } from './puzzles';
import {
  startPuzzleSession, type PuzzleDraw, type AnalyseRequest,
} from './puzzle-run';
import { getPuzzleRating, getBestCleanStreak, difficultyForRating } from './puzzle-rating';
import { buildPositionCard, colourPip } from './card-position';
import { countUp } from './count-up';
import {
  endgamesByCategory, allEndgames, LEVEL_META,
  type Endgame, type EndgameGroup,
} from './endgame-catalog';
import { getEndgameProgress, isEndgameSolved, solvedCount } from './endgame-progress';
import { startEndgamePlayout } from './endgame-playout';

export interface EndgameScreenDeps {
  // Open a finished puzzle in the full analyser (Engine tab) — wired from main.ts.
  onAnalysePosition?: (req: AnalyseRequest) => void;
}

// A puzzle-theme filter → a Lichess "angle". 'minor' alternates bishop/knight so
// both minor-piece flavours show up. See the confirmed angles in puzzles.ts.
type PuzzleTheme = 'all' | 'rook' | 'pawn' | 'queen' | 'minor';
const THEME_LABEL: Record<PuzzleTheme, string> = {
  all: 'All endgames', rook: 'Rook', pawn: 'Pawn', queen: 'Queen', minor: 'Minor piece',
};
const THEME_ORDER: PuzzleTheme[] = ['all', 'rook', 'pawn', 'queen', 'minor'];
const THEME_KEY = 'obertura.endgame.puzzleTheme';
const PUZZLE_COUNT = 8;

function getTheme(): PuzzleTheme {
  const v = localStorage.getItem(THEME_KEY) as PuzzleTheme | null;
  return v && THEME_ORDER.includes(v) ? v : 'all';
}
function setTheme(t: PuzzleTheme): void {
  try { localStorage.setItem(THEME_KEY, t); } catch { /* non-critical */ }
}

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

export function renderEndgameScreen(host: HTMLElement, deps: EndgameScreenDeps): void {
  host.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'eg-screen';
  host.appendChild(root);

  let firstRender = true;

  const rebuild = (): void => {
    root.innerHTML = '';
    root.appendChild(renderPuzzles(firstRender));
    root.appendChild(renderClassics());
    root.appendChild(renderFooter());
    firstRender = false;
  };

  // ── Endgame puzzles ─────────────────────────────────────────────────────────
  function renderPuzzles(animate: boolean): HTMLElement {
    const section = document.createElement('div');
    section.className = 'section eg-puzzles';

    const hero = document.createElement('div');
    hero.className = 'card train-hero eg-hero';

    const stats = document.createElement('div');
    stats.className = 'train-hero-stats';
    stats.appendChild(heroStat('rating', getPuzzleRating('endgame'), 'Endgame rating', animate));
    stats.appendChild(heroStat('run', getBestCleanStreak('endgame'), 'Best run', animate));
    hero.appendChild(stats);

    // Theme chips.
    let theme = getTheme();
    const chips = document.createElement('div');
    chips.className = 'stats-range pz-segmented eg-theme-row';
    chips.setAttribute('role', 'tablist');
    const chipEls: HTMLButtonElement[] = [];
    for (const t of THEME_ORDER) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'stats-range-chip' + (t === theme ? ' stats-range-chip--on' : '');
      chip.textContent = THEME_LABEL[t];
      chip.addEventListener('click', () => {
        theme = t; setTheme(t);
        for (const c of chipEls) c.classList.remove('stats-range-chip--on');
        chip.classList.add('stats-range-chip--on');
      });
      chipEls.push(chip);
      chips.appendChild(chip);
    }
    hero.appendChild(chips);

    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'btn-primary train-hero-start eg-hero-start';
    start.appendChild(Icons.puzzlePiece(18));
    start.appendChild(document.createTextNode('Solve endgame puzzles'));
    start.addEventListener('click', () => runEndgamePuzzles(theme, deps, rebuild));
    hero.appendChild(start);

    const note = document.createElement('div');
    note.className = 'pz-hero-note';
    note.textContent = `${PUZZLE_COUNT} rated puzzles — a ladder just for endgames`;
    hero.appendChild(note);

    section.appendChild(hero);
    return section;
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
  // Launch a position, chaining "Next endgame" to the next unsolved one anywhere.
  function launch(eg: Endgame): void {
    startEndgamePlayout(eg, {
      onExit: rebuild,
      onNext: () => {
        const next = nextUnsolved();
        if (next) launch(next); else rebuild();
      },
    });
  }
  function nextUnsolved(): Endgame | undefined {
    return allEndgames().find((e) => !isEndgameSolved(e.id));
  }

  function renderClassics(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'section eg-classics';

    const title = document.createElement('div');
    title.className = 'section-title section-title--icon';
    title.appendChild(Icons.flag(16));
    title.appendChild(document.createTextNode('Classic endgames'));
    wrap.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'pz-ta-desc';
    desc.textContent = 'The fundamentals every player should know. Load one and play it out against the engine.';
    wrap.appendChild(desc);

    const progress = getEndgameProgress();
    for (const group of endgamesByCategory()) {
      wrap.appendChild(renderGroup(group, progress));
    }
    return wrap;
  }

  function renderGroup(group: EndgameGroup, progress: ReturnType<typeof getEndgameProgress>): HTMLElement {
    const sec = document.createElement('div');
    sec.className = 'eg-group';

    const head = document.createElement('div');
    head.className = 'eg-group-head';
    const name = document.createElement('div');
    name.className = 'eg-group-name';
    name.textContent = group.label;
    head.appendChild(name);
    const done = solvedCount(group.items.map((e) => e.id));
    const count = document.createElement('span');
    count.className = 'eg-group-count';
    count.textContent = `${done} / ${group.items.length}`;
    if (done === group.items.length) count.classList.add('eg-group-count--all');
    head.appendChild(count);
    sec.appendChild(head);

    const blurb = document.createElement('div');
    blurb.className = 'eg-group-blurb';
    blurb.textContent = group.blurb;
    sec.appendChild(blurb);

    const list = document.createElement('div');
    list.className = 'eg-list';
    for (const eg of group.items) list.appendChild(renderCard(eg, progress[eg.id]?.solved === true));
    sec.appendChild(list);
    return sec;
  }

  function renderCard(eg: Endgame, solved: boolean): HTMLElement {
    const { card, titleRow, content } = buildPositionCard({
      fen: eg.fen,
      orientation: eg.youPlay,
      className: 'eg-card' + (solved ? ' eg-card--solved' : ''),
      onMiniClick: () => launch(eg),
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
    if (solved) {
      const tick = document.createElement('span');
      tick.className = 'eg-tick';
      tick.appendChild(Icons.checkCircle(18));
      tick.setAttribute('aria-label', 'Solved');
      titleRow.appendChild(tick);
    }

    const idea = document.createElement('p');
    idea.className = 'eg-card-idea';
    idea.textContent = eg.idea;
    content.appendChild(idea);

    const row = document.createElement('div');
    row.className = 'eg-card-actions';
    const goal = document.createElement('span');
    goal.className = `eg-goal-chip eg-goal-chip--${eg.goal}`;
    goal.textContent = eg.goal === 'win' ? 'Win' : 'Draw';
    row.appendChild(goal);
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'btn-primary eg-play-btn';
    play.appendChild(Icons.play(16));
    play.appendChild(document.createTextNode(solved ? 'Play again' : 'Play'));
    play.addEventListener('click', () => launch(eg));
    row.appendChild(play);
    content.appendChild(row);

    return card;
  }

  // ── Teaser for the next round ─────────────────────────────────────────────────
  function renderFooter(): HTMLElement {
    const foot = document.createElement('div');
    foot.className = 'eg-footer';
    foot.appendChild(Icons.sparkles(15));
    const txt = document.createElement('span');
    txt.textContent = 'Coming later: endgames pulled from the games you actually play.';
    foot.appendChild(txt);
    return foot;
  }

  rebuild();
}
