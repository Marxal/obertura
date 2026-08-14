// The Puzzles tab. Practise Lichess tactics from the openings you actually train,
// shaped around three modes:
//   • Daily Rated Mix — the flagship. Mixed puzzles from your repertoire AND your
//     games, a 10-puzzle run that moves your personal puzzle rating. The only
//     rated mode. Fronted by a "today" hero card (mirrors the Training hero).
//   • Time Attack — 3 / 5 / 10 min against the clock, 3 mistakes and you're out,
//     difficulty ramping as you solve. Two sources, each with its own per-length
//     records: "From My Openings" (your repertoire + games) and "Satisfying Traps"
//     (the Lichess `opening` theme). Casual.
//   • Practice by opening — drill a single opening; each row shows your accuracy.
// Openings resolve to Lichess "angle" keys (puzzles.ts); we only offer openings
// Lichess actually has a puzzle set for. Connecting to Lichess isn't required —
// puzzles are fetched anonymously — but it adds the richer Lichess dashboard on
// the Statistics page, so we still nudge.

import { getAllLines, getAllGames } from './storage';
import { fetchNextPuzzle, toAngleKey, type Difficulty } from './puzzles';
import { openingFamily } from './analysis';
import { startPuzzleSession, type PuzzleMode, type PuzzleDraw, type AnalyseRequest } from './puzzle-run';
import { recordPuzzleResult, getPuzzleDays, getPuzzlesByOpening } from './puzzle-log';
import { reviewResult, takeDueRepeat } from './puzzle-repeat';
import { getPuzzleRating, difficultyForRating, difficultyForStreak, difficultyStep, targetRatingForStreak } from './puzzle-rating';
import { countUp } from './count-up';
import type { TaskOutcome } from './daily-recap';
import { renderLoadError } from './load-error';
import { buildEmptyState, type EmptyStateAction } from './empty-state';
import { isConnected, LICHESS_CONNECT_BLURB } from './lichess-auth';
import { Icons } from './icons';
import { PUZZLE_THEME_GROUPS, type PuzzleTheme, type PuzzleThemeGroup } from './puzzle-themes';

export interface PuzzlesScreenDeps {
  onImportGames: () => void;
  onBuildLine: () => void;
  onConnectLichess: () => void;
  // Open a finished puzzle in the full analyser (engine on) — wired from
  // main.ts, which owns the builder + the suspended-session hand-off.
  onAnalysePosition?: (req: AnalyseRequest) => void;
}

type Source = 'repertoire' | 'games';
// Time Attack now has just two pools: your own openings (the old "Mixed" — every
// opening in your repertoire and games) and "Satisfying Traps". Lichess has no
// real "opening trap" puzzle set, so Traps draws the genuine `opening` theme
// (opening-phase tactics — where most traps live); see TRAP_ANGLE below.
type TaSource = 'openings' | 'traps';
type TaMinutes = 3 | 5 | 10;

// The Lichess puzzle theme behind "Satisfying Traps". `opening` is a real theme
// that filters to opening-phase tactics; `openingTrap` is NOT a Lichess theme
// (the API silently returns random puzzles for unknown angles), so we don't use
// it. Swap this single constant if we ever build a curated trap set.
const TRAP_ANGLE = 'opening';

const PRACTICE_SOURCE_KEY = 'obertura.puzzles.practiceSource';
const TA_SOURCE_KEY = 'obertura.puzzles.taSource';
const TA_TIME_KEY = 'obertura.puzzles.taTime';

const DAILY_COUNT = 10;
// Practice-by-opening runs a shorter, focused set than the Daily Rated Mix.
const PRACTICE_COUNT = 5;
// A themed run (Practice by theme) — a focused, rated set on one Lichess theme.
const THEME_COUNT = 8;

interface OpeningEntry {
  angle: string;             // Lichess opening key
  family: string;            // display name, e.g. "Sicilian Defense"
  colour?: 'white' | 'black';
  weight: number;            // line / game count, for ordering and the count badge
}

// ── Small persisted prefs ─────────────────────────────────────────────────────
function getPracticeSource(): Source {
  return localStorage.getItem(PRACTICE_SOURCE_KEY) === 'games' ? 'games' : 'repertoire';
}
function setPracticeSource(s: Source): void {
  try { localStorage.setItem(PRACTICE_SOURCE_KEY, s); } catch { /* non-critical */ }
}
function getTaSource(): TaSource {
  return localStorage.getItem(TA_SOURCE_KEY) === 'traps' ? 'traps' : 'openings';
}
function setTaSource(s: TaSource): void {
  try { localStorage.setItem(TA_SOURCE_KEY, s); } catch { /* non-critical */ }
}
function getTaTime(): TaMinutes {
  const v = Number(localStorage.getItem(TA_TIME_KEY));
  return v === 5 || v === 10 ? (v as TaMinutes) : 3;
}
function setTaTime(m: TaMinutes): void {
  try { localStorage.setItem(TA_TIME_KEY, String(m)); } catch { /* non-critical */ }
}

const TA_TIMES: readonly TaMinutes[] = [3, 5, 10];
const TA_SOURCES: readonly TaSource[] = ['openings', 'traps'];
const TA_BEST_PREFIX = 'obertura.puzzles.taBest.';

// Personal best for a Time Attack length, tracked independently per source so
// Openings and Traps each keep their own 3/5/10-minute records. The most puzzles
// solved in one run of that source + duration.
function bestKey(source: TaSource, m: TaMinutes): string {
  return `${TA_BEST_PREFIX}${source}.${m}`;
}
function getTaBest(source: TaSource, m: TaMinutes): number {
  let raw = localStorage.getItem(bestKey(source, m));
  // Bests used to be un-namespaced (one slot per length, openings-only). Fold any
  // legacy value into the Openings source so old records survive the refactor.
  if (raw === null && source === 'openings') raw = localStorage.getItem(TA_BEST_PREFIX + m);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
function recordTaBest(source: TaSource, m: TaMinutes, score: number): boolean {
  if (score > getTaBest(source, m)) {
    try { localStorage.setItem(bestKey(source, m), String(score)); } catch { /* non-critical */ }
    return true;
  }
  return false;
}

// Forget every Time Attack best — part of "Reset progress" in Settings. Clears
// both sources plus the legacy un-namespaced slots.
export function clearTaBest(): void {
  for (const m of TA_TIMES) {
    try { localStorage.removeItem(TA_BEST_PREFIX + m); } catch { /* non-critical */ }
    for (const s of TA_SOURCES) {
      try { localStorage.removeItem(bestKey(s, m)); } catch { /* non-critical */ }
    }
  }
}

// ── Pure helpers ────────────────────────────────────────────────────────────
// Collapse a list of (openingName, colour) into distinct angle entries, most
// frequent first. Names with no Lichess puzzle set are dropped.
function entriesFrom(items: { opening: string | null; colour: 'white' | 'black' }[]): OpeningEntry[] {
  const map = new Map<string, OpeningEntry>();
  for (const { opening, colour } of items) {
    const angle = toAngleKey(opening);
    if (!angle) continue;
    const existing = map.get(angle);
    if (existing) existing.weight++;
    else map.set(angle, { angle, family: openingFamily(opening), colour, weight: 1 });
  }
  return [...map.values()].sort((a, b) => b.weight - a.weight);
}

function todayKey(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// ── Small UI helpers ──────────────────────────────────────────────────────────
// A compact segmented control (mirrors the Statistics range chips).
function segmented<T extends string | number>(opts: [T, string][], current: T, onChange: (v: T) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'stats-range pz-segmented';
  row.setAttribute('role', 'tablist');
  let selected = current;
  for (const [key, label] of opts) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'stats-range-chip' + (key === current ? ' stats-range-chip--on' : '');
    chip.textContent = label;
    chip.addEventListener('click', () => {
      if (key === selected) return;
      selected = key;
      // Move the selected highlight ourselves — callers that don't rebuild still
      // see the chip update (and a full rebuild simply re-creates the row).
      for (const c of row.children) c.classList.remove('stats-range-chip--on');
      chip.classList.add('stats-range-chip--on');
      onChange(key);
    });
    row.appendChild(chip);
  }
  return row;
}

function colourPip(colour: 'white' | 'black'): HTMLElement {
  const pip = document.createElement('span');
  pip.className = `colour-pip colour-pip--${colour}`;
  pip.setAttribute('aria-hidden', 'true');
  return pip;
}

// The shared session runner (module-level so the daily challenge can launch the
// same rated run as the Puzzles screen). Difficulty is adaptive: rated/practice
// tracks your rating, Time Attack ramps with the running solved count. Count modes
// weave in a few due repeats (puzzle-repeat.ts) before drawing fresh puzzles.
function runMixedPuzzleSession(
  entries: OpeningEntry[],
  label: string,
  mode: PuzzleMode,
  hooks: {
    taSource?: TaSource;
    onExit: () => void;
    onPlayAgain?: () => void;
    // Handed the run's summary so the daily challenge can file how it went.
    onComplete?: (summary: { solved: number; completed: number; timed: boolean }) => void;
    nextAction?: { label: string; run: () => void };
    onAnalysePosition?: (req: AnalyseRequest) => void;
    // Count modes: override the adaptive difficulty per puzzle ordinal (0-based
    // draw index) — the daily challenge's easy → medium → hard ladder.
    difficultyFor?: (ordinal: number) => Difficulty;
    // Let due repeats from ANY angle weave back in, not just this session's
    // openings. The rated mix + daily challenge set this so theme puzzles you've
    // practised resurface too — variety even with a thin repertoire.
    repeatAllAngles?: boolean;
  },
): void {
  if (entries.length === 0) return;
  const taSource = hooks.taSource ?? 'openings';

  // Per-session state for the repeat queue: which openings are in scope, the
  // repeats already served (so we don't re-show one mid-run), and a cap so a
  // session stays mostly fresh (~a third may be due repeats).
  const angleSet = new Set(entries.map((e) => e.angle));
  const servedRepeats = new Set<string>();
  let repeatsServed = 0;
  // How many puzzles this session has drawn — feeds hooks.difficultyFor.
  let drawn = 0;

  const drawFresh = async (ctx: { solved: number }, ordinal: number): Promise<PuzzleDraw | null> => {
    const pick = entries[Math.floor(Math.random() * entries.length)];
    // Time Attack: keep the level climbing. Fetch a few candidates and take the
    // first at/above a rising floor, so ratings trend up instead of bouncing.
    if (mode.kind === 'timed') {
      const floor = targetRatingForStreak(ctx.solved) - 50;
      let best: PuzzleDraw | null = null;
      for (let i = 0; i < 3; i++) {
        const p = await fetchNextPuzzle(pick.angle, { difficulty: difficultyForStreak(ctx.solved), colour: pick.colour });
        if (!p) break;
        const cand: PuzzleDraw = { puzzle: p, angle: pick.angle, family: pick.family };
        if (p.rating >= floor) return cand;
        if (!best || p.rating > best.puzzle.rating) best = cand;
      }
      return best;
    }
    // Count modes (Daily Mix / Practice): difficulty tracks your rating, unless
    // the caller ladders it per ordinal (daily challenge).
    const difficulty = hooks.difficultyFor?.(ordinal) ?? difficultyForRating(getPuzzleRating());
    const puzzle = await fetchNextPuzzle(pick.angle, { difficulty, colour: pick.colour });
    return puzzle ? { puzzle, angle: pick.angle, family: pick.family } : null;
  };

  startPuzzleSession({
    modeLabel: label,
    mode,
    onAnalysePosition: hooks.onAnalysePosition,
    nextPuzzle: async (ctx) => {
      const ordinal = drawn++;
      if (mode.kind === 'count') {
        const cap = Math.floor(mode.count / 3);
        // A laddered session (daily challenge) skips the repeat queue — every
        // slot has a deliberate difficulty.
        if (!hooks.difficultyFor && repeatsServed < cap) {
          const due = takeDueRepeat(servedRepeats, hooks.repeatAllAngles ? null : angleSet);
          if (due) {
            servedRepeats.add(due.puzzle.id);
            repeatsServed++;
            return { puzzle: due.puzzle, angle: due.angle, family: due.family, repeat: true };
          }
        }
      }
      return drawFresh(ctx, ordinal);
    },
    onResult: (r) => {
      recordPuzzleResult(r.angle, r.solved);
      reviewResult(r.puzzle, r.angle, r.family, r.solved);
    },
    onComplete: (s) => {
      if (mode.kind === 'timed') recordTaBest(taSource, (mode.ms / 60_000) as TaMinutes, s.solved);
      hooks.onComplete?.(s);
    },
    onExit: hooks.onExit,
    onPlayAgain: hooks.onPlayAgain,
    nextAction: hooks.nextAction,
  });
}

// Launch the daily challenge's puzzle half: a short rated run (the same engine and
// pool as the Daily Rated Mix, just a smaller count). `onComplete` fires when the
// run reaches its results — i.e. the half is done. Resolves to false when there's
// nothing to draw from (no openings in the repertoire/games yet).
export async function startDailyPuzzles(
  count: number,
  onComplete: (outcome: TaskOutcome) => void,
  nextAction?: { label: string; run: () => void },
  onAnalysePosition?: (req: AnalyseRequest) => void,
): Promise<boolean> {
  let lines: Awaited<ReturnType<typeof getAllLines>>;
  let games: Awaited<ReturnType<typeof getAllGames>>;
  try {
    [lines, games] = await Promise.all([getAllLines(), getAllGames()]);
  } catch {
    return false;
  }
  const items = [
    ...lines.map((l) => ({ opening: l.openingName, colour: l.colour })),
    ...games.map((g) => ({ opening: g.opening, colour: g.colour })),
  ];
  const allEntries = entriesFrom(items);
  if (allEntries.length === 0) return false;

  // Easy → medium → hard, anchored to your rating: one band below it, your own
  // band, one band above. Extra slots (a bigger goal) stay at the top band.
  const rating = getPuzzleRating();
  const ladder: Difficulty[] = [
    difficultyStep(rating, -1),
    difficultyStep(rating, 0),
    difficultyStep(rating, 1),
  ];

  runMixedPuzzleSession(allEntries, 'Daily challenge', { kind: 'count', count, rated: true }, {
    onExit: () => { /* the daily card refreshes itself via onComplete */ },
    onComplete: (s) => onComplete({ right: s.solved, wrong: Math.max(0, s.completed - s.solved) }),
    nextAction,
    onAnalysePosition,
    repeatAllAngles: true,
    difficultyFor: (ordinal) => ladder[Math.min(ordinal, ladder.length - 1)],
  });
  return true;
}

export async function renderPuzzlesScreen(host: HTMLElement, deps: PuzzlesScreenDeps): Promise<void> {
  host.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'pz-screen';
  host.appendChild(root);

  let lines: Awaited<ReturnType<typeof getAllLines>>;
  let games: Awaited<ReturnType<typeof getAllGames>>;
  try {
    [lines, games] = await Promise.all([getAllLines(), getAllGames()]);
  } catch (err) {
    renderLoadError(host, err, () => { void renderPuzzlesScreen(host, deps); });
    return;
  }

  const hasGames = games.length > 0;
  const repItems = lines.map((l) => ({ opening: l.openingName, colour: l.colour }));
  const gameItems = games.map((g) => ({ opening: g.opening, colour: g.colour }));
  const repEntries = entriesFrom(repItems);
  const gameEntries = entriesFrom(gameItems);
  const allEntries = entriesFrom([...repItems, ...gameItems]);

  // Launch a session over a set of angle entries; one entry = a single opening,
  // many = a "Mixed" rotation. Wraps the shared runner with this screen's hooks:
  // replay restarts the same session, and exiting refreshes the screen.
  function startSession(
    entries: OpeningEntry[],
    label: string,
    mode: PuzzleMode,
    opts: { taSource?: TaSource; repeatAllAngles?: boolean } = {},
  ): void {
    runMixedPuzzleSession(entries, label, mode, {
      taSource: opts.taSource ?? 'openings',
      repeatAllAngles: opts.repeatAllAngles,
      onExit: () => { rebuild(); }, // refresh the "today" hero + performance on return
      onPlayAgain: () => startSession(entries, label, mode, opts),
      onAnalysePosition: deps.onAnalysePosition,
    });
  }

  // The hero's count-up should only play once, on the first paint of the screen.
  // Later rebuilds (switching the Practice source, returning from a session) just
  // set the final numbers so they don't re-animate from zero on every tap.
  let firstRender = true;

  const rebuild = (): void => {
    root.innerHTML = '';

    // No openings at all on either source → the empty state for the opening-based
    // modes, but the theme accordion still works (it needs no repertoire), so
    // offer it below so there's always something to solve.
    if (allEntries.length === 0) {
      root.appendChild(emptyState(hasGames, deps));
      root.appendChild(renderThemes());
      return;
    }

    root.appendChild(renderHero(firstRender));
    root.appendChild(renderTimeAttack());
    root.appendChild(renderThemes());
    firstRender = false;
  };

  // ── Today hero (Daily Rated Mix) ────────────────────────────────────────────
  function renderHero(animate: boolean): HTMLElement {
    const days = getPuzzleDays();
    const today = days.find((d) => d.day === todayKey());
    const solvedToday = today?.solved ?? 0;
    const missedToday = today?.failed ?? 0;
    const rating = getPuzzleRating();

    const hero = document.createElement('div');
    hero.className = 'card train-hero pz-hero';

    const stats = document.createElement('div');
    stats.className = 'train-hero-stats';
    stats.appendChild(heroStat('solved', solvedToday, 'Solved today', animate));
    stats.appendChild(heroStat('missed', missedToday, 'Missed today', animate));
    stats.appendChild(heroStat('rating', rating, 'Rating', animate));
    hero.appendChild(stats);

    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'btn-primary train-hero-start pz-hero-start';
    start.appendChild(Icons.sparkles(18));
    start.appendChild(document.createTextNode('Puzzle rated mix'));
    start.addEventListener('click', () =>
      startSession(allEntries, 'Puzzle rated mix', { kind: 'count', count: DAILY_COUNT, rated: true },
        { repeatAllAngles: true }));
    hero.appendChild(start);

    const note = document.createElement('div');
    note.className = 'pz-hero-note';
    note.textContent = `${DAILY_COUNT} puzzles based on your repertoire and games`;
    hero.appendChild(note);

    return hero;
  }

  function heroStat(kind: string, value: number, label: string, animate: boolean): HTMLElement {
    const col = document.createElement('div');
    col.className = `train-hero-stat train-hero-stat--${kind}`;
    const num = document.createElement('span');
    num.className = 'train-hero-stat-num';
    num.textContent = '0';
    col.appendChild(num);
    const lbl = document.createElement('div');
    lbl.className = 'train-hero-stat-label';
    lbl.textContent = label;
    col.appendChild(lbl);
    if (animate) countUp(num, value);
    else num.textContent = String(value);
    return col;
  }

  // ── Time Attack ─────────────────────────────────────────────────────────────
  function renderTimeAttack(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'section pz-ta';

    const title = document.createElement('div');
    title.className = 'section-title section-title--icon';
    title.appendChild(Icons.clock(16));
    title.appendChild(document.createTextNode('Time Attack'));
    section.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'pz-ta-desc';
    desc.textContent = 'Beat the clock — 3 mistakes and you’re out. Puzzles get harder as you go.';
    section.appendChild(desc);

    // Source state is read first: the per-length bests under each time chip belong
    // to the active source (Openings vs Traps), so switching source re-labels them.
    let time = getTaTime();
    let taSource = getTaSource();

    // Time as chips that each show this length's personal best (mirrors the
    // Training Time-attack card); the source toggle sits in a row below.
    const chips = document.createElement('div');
    chips.className = 'timed-chips pz-ta-times';
    const chipEls: HTMLButtonElement[] = [];
    const bestEls: { m: TaMinutes; el: HTMLSpanElement }[] = [];

    // Paint a chip's "best N" label for the active source (— when there's none).
    // Animate the count only on first paint; source switches just set the number.
    const paintBest = (el: HTMLSpanElement, value: number, animate: boolean): void => {
      el.textContent = '';
      if (value > 0) {
        el.appendChild(document.createTextNode('best '));
        const num = document.createElement('span');
        num.className = 'timed-chip-best-num';
        if (animate) { num.textContent = '0'; countUp(num, value); }
        else num.textContent = String(value);
        el.appendChild(num);
      } else {
        el.textContent = '—';
      }
    };
    const refreshBests = (animate: boolean): void => {
      for (const { m, el } of bestEls) paintBest(el, getTaBest(taSource, m), animate);
    };

    for (const m of TA_TIMES) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'timed-chip' + (m === time ? ' timed-chip--on' : '');

      const dur = document.createElement('span');
      dur.className = 'timed-chip-dur';
      dur.textContent = `${m}m`;
      chip.appendChild(dur);

      const bestEl = document.createElement('span');
      bestEl.className = 'timed-chip-best';
      chip.appendChild(bestEl);
      bestEls.push({ m, el: bestEl });

      chip.addEventListener('click', () => {
        time = m;
        setTaTime(m);
        for (const c of chipEls) c.classList.remove('timed-chip--on');
        chip.classList.add('timed-chip--on');
      });
      chipEls.push(chip);
      chips.appendChild(chip);
    }
    section.appendChild(chips);
    refreshBests(true);

    // Two pill toggles: your own openings vs the trap-flavoured `opening` theme.
    // Same pill styling as the old segmented source row, now with a glyph each.
    const sourceRow = document.createElement('div');
    sourceRow.className = 'stats-range pz-segmented pz-ta-source';
    sourceRow.setAttribute('role', 'tablist');
    const sourceDefs: [TaSource, string, () => SVGSVGElement][] = [
      ['openings', 'From My Openings', () => Icons.pawn(15)],
      ['traps', 'Satisfying Traps', () => Icons.alert(15)],
    ];
    const sourceEls: HTMLButtonElement[] = [];
    for (const [key, label, icon] of sourceDefs) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'stats-range-chip pz-ta-source-chip' + (key === taSource ? ' stats-range-chip--on' : '');
      pill.appendChild(icon());
      const txt = document.createElement('span');
      txt.textContent = label;
      pill.appendChild(txt);
      pill.addEventListener('click', () => {
        if (key === taSource) return;
        taSource = key;
        setTaSource(key);
        for (const p of sourceEls) p.classList.remove('stats-range-chip--on');
        pill.classList.add('stats-range-chip--on');
        refreshBests(false); // swap the chip bests to the newly-selected source
      });
      sourceEls.push(pill);
      sourceRow.appendChild(pill);
    }
    section.appendChild(sourceRow);

    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'btn-primary pz-ta-start';
    start.textContent = 'Start Time Attack';
    start.addEventListener('click', () => {
      const mode: PuzzleMode = { kind: 'timed', ms: time * 60_000, maxMistakes: 3 };
      if (taSource === 'traps') {
        // One synthetic entry pointed at the Lichess `opening` theme — no opening
        // family/colour, so it works even with an empty repertoire.
        const trapEntry: OpeningEntry = { angle: TRAP_ANGLE, family: 'Opening trap', weight: 1 };
        startSession([trapEntry], 'Time Attack — Traps', mode, { taSource: 'traps' });
      } else {
        startSession(allEntries, 'Time Attack — Openings', mode, { taSource: 'openings' });
      }
    });
    section.appendChild(start);

    return section;
  }

  // ── Practice by opening (now a group inside Practice by theme) ───────────────
  // The opening drills live as the first accordion of the theme section, with two
  // tabs for where the openings come from: your repertoire or your games.
  function renderOpeningsGroup(): HTMLElement {
    const details = document.createElement('details');
    details.className = 'section section--acc pz-theme-acc';

    const summary = document.createElement('summary');
    summary.className = 'section-title section-summary';
    const left = document.createElement('span');
    left.className = 'section-summary-left';
    left.appendChild(Icons.pawn(16));
    const label = document.createElement('span');
    label.textContent = 'Your openings';
    left.appendChild(label);
    summary.appendChild(left);
    summary.appendChild(Icons.chevronRight(16));
    details.appendChild(summary);

    const blurb = document.createElement('div');
    blurb.className = 'eg-group-blurb';
    blurb.textContent = 'Drill the tactics of one opening at a time; each row shows your accuracy there.';
    details.appendChild(blurb);

    let source = getPracticeSource();
    if (source === 'games' && !hasGames) source = 'repertoire';

    const listWrap = document.createElement('div');

    // Source tabs only when there are games to switch to. Switching only
    // re-fills the list, so the open accordion never snaps shut.
    if (hasGames) {
      const toggle = segmented<Source>(
        [['repertoire', 'Based on my repertoire'], ['games', 'Based on my games']],
        source,
        (s) => { source = s; setPracticeSource(s); fillList(); },
      );
      toggle.classList.add('pz-practice-source');
      details.appendChild(toggle);
    }
    details.appendChild(listWrap);

    const fillList = (): void => {
      listWrap.innerHTML = '';
      const entries = source === 'repertoire' ? repEntries : gameEntries;
      if (entries.length === 0) {
        const msg = document.createElement('p');
        msg.className = 'pz-ta-desc';
        msg.textContent = source === 'games'
          ? 'None of your games’ openings have a Lichess puzzle set yet.'
          : 'Save some opening lines first to practise their puzzles.';
        listWrap.appendChild(msg);
        return;
      }

      // Accuracy per opening (from past app puzzle results), for the performance pill.
      const perf = new Map<string, { pct: number; attempts: number }>();
      for (const o of getPuzzlesByOpening()) {
        const attempts = o.solved + o.failed;
        perf.set(o.angle, { pct: attempts ? Math.round((100 * o.solved) / attempts) : 0, attempts });
      }

      const list = document.createElement('div');
      list.className = 'pz-list pz-theme-list';
      for (const e of entries) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'pz-opening-row';
        if (e.colour) row.appendChild(colourPip(e.colour));
        const name = document.createElement('span');
        name.className = 'pz-opening-name';
        name.textContent = e.family;
        row.appendChild(name);
        // How many puzzles you've done here (hidden until you've played some).
        const attempts = perf.get(e.angle)?.attempts ?? 0;
        if (attempts > 0) {
          const count = document.createElement('span');
          count.className = 'pz-opening-count';
          count.textContent = `${attempts} done`;
          row.appendChild(count);
        }
        // Performance pill (or a hint to play it) replaces the old target icon.
        row.appendChild(perfPill(perf.get(e.angle)));
        row.addEventListener('click', () =>
          startSession([e], e.family, { kind: 'count', count: PRACTICE_COUNT }));
        list.appendChild(row);
      }
      listWrap.appendChild(list);
    };
    fillList();

    return details;
  }

  // ── Practice by theme (Lichess puzzle themes) ────────────────────────────────
  // An accordion of rated theme runs — mate-in-X, the mating patterns, tactical
  // motifs, length and goal buckets — each a Lichess puzzle theme. Rated on the
  // general puzzle ladder (like the mix), so solving them moves your rating and
  // feeds the repeat queue. Mirrors the End game screen's classic-endgame
  // accordion, so the two screens read the same. Your own openings lead the
  // section as its first group.
  function renderThemes(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'section pz-themes';

    const title = document.createElement('div');
    title.className = 'section-title section-title--icon';
    title.appendChild(Icons.puzzlePiece(16));
    title.appendChild(document.createTextNode('Practice by theme'));
    section.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'pz-ta-desc';
    desc.textContent = 'Rated puzzles on a single theme, straight from Lichess — they move your puzzle rating and mix into your rated runs.';
    section.appendChild(desc);

    if (allEntries.length > 0) section.appendChild(renderOpeningsGroup());
    for (const group of PUZZLE_THEME_GROUPS) section.appendChild(renderThemeGroup(group));
    return section;
  }

  function renderThemeGroup(group: PuzzleThemeGroup): HTMLElement {
    const details = document.createElement('details');
    details.className = 'section section--acc pz-theme-acc';

    const summary = document.createElement('summary');
    summary.className = 'section-title section-summary';
    const left = document.createElement('span');
    left.className = 'section-summary-left';
    left.appendChild(group.icon());
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
    list.className = 'pz-list pz-theme-list';
    for (const theme of group.themes) list.appendChild(themeRow(theme));
    details.appendChild(list);
    return details;
  }

  function themeRow(theme: PuzzleTheme): HTMLElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'pz-opening-row pz-theme-row';
    const name = document.createElement('span');
    name.className = 'pz-opening-name';
    name.textContent = theme.label;
    row.appendChild(name);
    const go = document.createElement('span');
    go.className = 'pz-theme-go';
    go.setAttribute('aria-hidden', 'true');
    go.appendChild(Icons.play(13));
    row.appendChild(go);
    // A rated run on this one theme — general ladder, so it counts toward your
    // puzzle rating and joins the repeat pool the rated mix draws from.
    row.addEventListener('click', () =>
      startSession(
        [{ angle: theme.angle, family: theme.label, weight: 1 }],
        theme.label,
        { kind: 'count', count: THEME_COUNT, rated: true },
      ));
    return row;
  }

  rebuild();
}

// A small accuracy pill: a tinted bar + percentage, or a muted "Play" prompt when
// the opening hasn't been attempted yet.
function perfPill(p: { pct: number; attempts: number } | undefined): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'pz-perf';
  if (!p || p.attempts === 0) {
    wrap.classList.add('pz-perf--empty');
    wrap.textContent = 'Play';
    return wrap;
  }
  const tier = p.pct >= 80 ? 'good' : p.pct >= 50 ? 'ok' : 'weak';
  wrap.classList.add(`pz-perf--${tier}`);
  const bar = document.createElement('span');
  bar.className = 'pz-perf-bar';
  const fill = document.createElement('span');
  fill.className = 'pz-perf-fill';
  fill.style.width = `${p.pct}%`;
  bar.appendChild(fill);
  wrap.appendChild(bar);
  const pct = document.createElement('span');
  pct.className = 'pz-perf-pct';
  pct.textContent = `${p.pct}%`;
  wrap.appendChild(pct);
  return wrap;
}

function emptyState(hasGames: boolean, deps: PuzzlesScreenDeps): HTMLElement {
  const line = hasGames
    ? 'None of your openings have a Lichess puzzle set yet. Try saving more lines or importing more games.'
    : 'Save some opening lines or import your games — then practise puzzles from the openings you actually play.';
  const buildOrImport: EmptyStateAction = hasGames
    ? { label: 'Import more games', onClick: deps.onImportGames }
    : { label: 'Build a line', onClick: deps.onBuildLine };

  // Not connected: Connecting is the headline action (it powers the puzzle
  // dashboard), with the same pitch the wizard uses; build/import fall to second.
  if (!isConnected()) {
    return buildEmptyState({
      icon: Icons.puzzlePiece(28),
      line,
      body: LICHESS_CONNECT_BLURB,
      cta: { label: 'Connect to Lichess', onClick: deps.onConnectLichess },
      secondaryActions: [buildOrImport],
    });
  }

  return buildEmptyState({
    icon: Icons.puzzlePiece(28),
    line,
    cta: buildOrImport,
  });
}
