// The Tactics box on the Train screen. Lichess puzzles, drawn from the openings
// you actually play, in four shapes:
//   • The DOOR — Daily Rated Mix, the flagship. Mixed puzzles from your
//     repertoire AND your games, a 10-puzzle run that moves your personal puzzle
//     rating. The only rated mode, and the figure on the door is that rating.
//   • Time attack — 3 minutes, 3 mistakes and you're out, difficulty ramping as
//     you solve. Two pools, one card each: your own openings, and Satisfying
//     Traps (the Lichess `opening` theme). Casual; own personal best.
//   • Practice by opening — drill a single opening; each row shows your accuracy.
//   • Themes — rated puzzles on one motif, straight from Lichess.
// Openings resolve to Lichess "angle" keys (puzzles.ts); we only offer openings
// Lichess actually has a puzzle set for. Connecting to Lichess isn't required —
// puzzles are fetched anonymously — but it adds the richer Lichess dashboard on
// the Statistics page, so we still nudge.
//
// GONE FROM HERE: the "today" hero (solved / missed / rating, over the wide
// start button). The button is the door now and the rating is its figure, which
// left the hero saying only how many you solved today — a Home figure, not a
// Train one.

import { getAllLines, getAllGames } from './storage';
import { fetchNextPuzzle, toAngleKey, type Difficulty } from './puzzles';
import { openingFamily } from './analysis';
import { startPuzzleSession, type PuzzleMode, type PuzzleDraw, type AnalyseRequest } from './puzzle-run';
import { recordPuzzleResult, getPuzzlesByOpening } from './puzzle-log';
import { reviewResult, takeDueRepeat } from './puzzle-repeat';
import { getPuzzleRating, difficultyForRating, difficultyForStreak, difficultyStep, targetRatingForStreak } from './puzzle-rating';
import { track } from './metrics';
import type { TaskOutcome } from './daily-recap';
import { renderLoadError } from './load-error';
import { buildEmptyState, type EmptyStateAction } from './empty-state';
import { isConnected, LICHESS_CONNECT_BLURB } from './lichess-auth';
import { Icons } from './icons';
import { openInfoSheet, buildInfoButton } from './info-sheet';
import { buildDoor, buildBox, boxBody, buildAccordion, DOMAIN_ACCENT } from './train-doors';
import { buildModeCard } from './train-screen';
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

// Time attack's one length. TA_TIMES and the per-length records stay exactly as
// they were on disk — nothing reads the 5 and 10-minute bests now, and putting
// the lengths back would be a one-line change here rather than a migration.
const TA_DEFAULT: TaMinutes = 3;
// Every length a record could have been set at. Only TA_DEFAULT is playable now,
// but "Reset progress" still has to clear all three or an old 10-minute best
// would survive a reset for ever.
const TA_TIMES: readonly TaMinutes[] = [3, 5, 10];
// The traps pool: one synthetic entry pointed at the Lichess `opening` theme, so
// it works with an empty repertoire. It was built inline in the old Time Attack
// card; the tile needs it too, so it lives up here now.
const TRAP_ENTRY: OpeningEntry = { angle: TRAP_ANGLE, family: 'Opening trap', weight: 1 };

// This domain's colour — the door, the tiles and the readouts. Every exercise
// here wears it, so no tile needs a domainAccent of its own.
const TACTICS_ACCENT = DOMAIN_ACCENT.tactics;

// What the five tactics surfaces are, in the words a tile has no room for.
function openTacticsInfo(): void {
  openInfoSheet({
    title: 'Tactics',
    intro: 'Lichess puzzles, drawn from the openings you actually play. Only the first '
      + 'one is rated.',
    entries: [
      {
        icon: Icons.puzzlePiece(18), accent: TACTICS_ACCENT,
        label: 'Tactics (the big button)',
        detail: `${DAILY_COUNT} puzzles mixed from your repertoire AND your games, and the `
          + 'only mode that moves your puzzle rating. The set gets harder as you solve.',
      },
      {
        icon: Icons.clock(18), accent: TACTICS_ACCENT,
        label: 'Time attack',
        detail: `${TA_DEFAULT} minutes against the clock over the openings you play — three `
          + 'mistakes and the run is over. Casual: it has its own personal best and never '
          + 'touches your rating.',
      },
      {
        icon: Icons.clock(18), accent: TACTICS_ACCENT,
        label: 'Traps',
        detail: 'The same timed run over Lichess\u2019s opening-phase puzzles, which is where '
          + 'most traps live. It needs no repertoire, so it is the one to play on a fresh '
          + 'install.',
      },
      {
        icon: Icons.trending(18), accent: TACTICS_ACCENT,
        label: 'By opening',
        detail: 'In the drawer below: one row per opening you play, each showing how well you '
          + 'have solved its tactics. Tapping a row drills that opening alone.',
      },
      {
        icon: Icons.sparkles(18), accent: TACTICS_ACCENT,
        label: 'Themes',
        detail: 'Also in the drawer: rated puzzles on a single motif — forks, pins, back-rank '
          + 'and the rest — straight from Lichess. These DO move your rating.',
      },
    ],
    footnote: 'Puzzles are fetched anonymously, so none of this needs a Lichess account. '
      + 'Connecting one adds the richer Lichess dashboard on the Statistics page.',
  });
}

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


// ── Small UI helpers ──────────────────────────────────────────────────────────

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
    // The session's framing above the exercise's name in the run header.
    contextLabel?: string;
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
    contextLabel: hooks.contextLabel,
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
      // ONE count per session, not per puzzle. Counting each solve would mean
      // twenty-odd requests a sitting for a number that says the same thing.
      if (s.completed > 0) track('puzzle_session');
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

  runMixedPuzzleSession(allEntries, 'Puzzles', { kind: 'count', count, rated: true }, {
    contextLabel: 'Daily challenge',
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
  // `host` is this domain's slice of the Train room, `display: contents` — see
  // train-doors.ts. Everything appended goes straight into the shared grid and
  // finds its band from its own class, so there is no wrapper element.
  host.innerHTML = '';
  const root = host;

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

  const rebuild = (): void => {
    root.innerHTML = '';

    // No openings at all on either source → the empty state for the opening-based
    // modes, but the theme accordion still works (it needs no repertoire), so
    // offer it below so there's always something to solve.
    if (allEntries.length === 0) {
      // No repertoire and no games: the rated mix has nothing to build a set
      // from, so the door says why and the themes — which need neither — stay
      // available in the box underneath it.
      root.appendChild(buildDoor({
        domain: 'tactics',
        icon: Icons.puzzlePiece(26),
        name: 'Tactics',
        sub: `${DAILY_COUNT} rated puzzles from the openings you play`,
        disabled: true,
        disabledReason: 'Save a line or import your games first',
      }));
      const box = buildBox('tactics', 'More puzzles');
      const body = boxBody(box);
      body.appendChild(emptyState(hasGames, deps));
      for (const group of PUZZLE_THEME_GROUPS) body.appendChild(renderThemeGroup(group));
      root.appendChild(box);
      return;
    }

    // The door: the Daily Rated Mix, which was already this pane's wide button.
    // The only rated mode here, so it is the one whose number moves.
    root.appendChild(buildDoor({
      domain: 'tactics',
      icon: Icons.puzzlePiece(26),
      name: 'Tactics',
      sub: `${DAILY_COUNT} rated puzzles from your openings and games`,
      stat: getPuzzleRating(),
      statLabel: 'rating',
      onClick: () => startSession(
        allEntries, 'Puzzle rated mix',
        { kind: 'count', count: DAILY_COUNT, rated: true },
        { repeatAllAngles: true }),
    }));

    // ONE list, top to bottom: the two timed runs you can start outright, then
    // every catalogue you can pick from. They used to be three separate sections
    // with their own titles and blurbs ("Time Attack", "Practice by theme", and
    // an openings group with a segmented source toggle buried inside it), which
    // is three headings and a control to read before you can choose anything.
    // Nine rows in one column is the same content, scannable in one pass.
    const box = buildBox('tactics', 'More puzzles',
      buildInfoButton('About the puzzle modes', openTacticsInfo));
    const body = boxBody(box);

    const timed = document.createElement('div');
    timed.className = 'mode-cards';
    timed.appendChild(timedCard('openings', 'Time attack',
      `${TA_DEFAULT} minutes on your openings — 3 mistakes and you’re out`));
    timed.appendChild(timedCard('traps', 'Satisfying traps',
      `${TA_DEFAULT} minutes of opening tactics — no repertoire needed`));
    body.appendChild(timed);

    // The two sources, split. They were one accordion with a segmented toggle
    // inside it, which hid half of what the app offers behind a control you had
    // to open something else to find.
    if (hasGames) body.appendChild(openingsAccordion('games'));
    body.appendChild(openingsAccordion('repertoire'));

    for (const group of PUZZLE_THEME_GROUPS) body.appendChild(renderThemeGroup(group));
    root.appendChild(box);
  };

  // ── The timed cards ─────────────────────────────────────────────────────────
  //
  // Time attack is ONE length now, like its opposite number on the Openings
  // side: three minutes, which was already this screen's default. Its two pools
  // were a toggle inside one card and are two cards here, because "my openings"
  // and "traps" are different things to practise rather than a setting. The 5
  // and 10-minute records stay on disk, unread.
  function timedCard(source: TaSource, name: string, sub: string): HTMLElement {
    const best = getTaBest(source, TA_DEFAULT);
    return buildModeCard({
      accent: TACTICS_ACCENT,
      icon: Icons.clock(20),
      name,
      sub,
      stat: best > 0 ? best : undefined,
      statLabel: best > 0 ? 'best' : undefined,
      onClick: () => startSession(
        source === 'traps' ? [TRAP_ENTRY] : allEntries,
        source === 'traps' ? 'Time Attack — Traps' : 'Time Attack — Openings',
        { kind: 'timed', ms: TA_DEFAULT * 60_000, maxMistakes: 3 },
        { taSource: source }),
    });
  }

  // One source's openings, as a collapsible list. There are two of these — your
  // repertoire and your games — where there used to be one accordion with a
  // segmented toggle inside it. Splitting them costs one row and means the whole
  // offer is visible without opening anything.
  function openingsAccordion(source: Source): HTMLElement {
    const entries = source === 'repertoire' ? repEntries : gameEntries;
    const list = document.createElement('div');

    if (entries.length === 0) {
      const msg = document.createElement('p');
      msg.className = 'pz-ta-desc';
      msg.textContent = source === 'games'
        ? 'None of your games’ openings have a Lichess puzzle set yet.'
        : 'Save some opening lines first to practise their puzzles.';
      list.appendChild(msg);
    } else {
      // Accuracy per opening (from past app puzzle results), for the pill.
      const perf = new Map<string, { pct: number; attempts: number }>();
      for (const o of getPuzzlesByOpening()) {
        const attempts = o.solved + o.failed;
        perf.set(o.angle, { pct: attempts ? Math.round((100 * o.solved) / attempts) : 0, attempts });
      }

      const rows = document.createElement('div');
      rows.className = 'pz-list pz-theme-list';
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
        row.appendChild(perfPill(perf.get(e.angle)));
        row.addEventListener('click', () =>
          startSession([e], e.family, { kind: 'count', count: PRACTICE_COUNT }));
        rows.appendChild(row);
      }
      list.appendChild(rows);
    }

    return buildAccordion({
      icon: source === 'games' ? Icons.scout(18) : Icons.pawn(18),
      label: source === 'games' ? 'Based on my games' : 'Based on my repertoire',
      sub: entries.length > 0
        ? `${entries.length} ${entries.length === 1 ? 'opening' : 'openings'}, each with its own accuracy`
        : 'nothing here yet',
      accent: TACTICS_ACCENT,
      body: list,
    });
  }

  function renderThemeGroup(group: PuzzleThemeGroup): HTMLElement {
    const list = document.createElement('div');
    list.className = 'pz-list pz-theme-list';
    for (const theme of group.themes) list.appendChild(themeRow(theme));
    return buildAccordion({
      icon: group.icon(),
      label: group.label,
      sub: group.blurb,
      accent: TACTICS_ACCENT,
      body: list,
    });
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
