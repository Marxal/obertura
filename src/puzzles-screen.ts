// The Puzzles tab. Practise Lichess tactics from the openings you actually train,
// shaped around three modes:
//   • Daily Rated Mix — the flagship. Mixed puzzles from your repertoire AND your
//     games, a 10-puzzle run that moves your personal puzzle rating. The only
//     rated mode. Fronted by a "today" hero card (mirrors the Training hero).
//   • Time Attack — 3 / 5 / 10 min against the clock, 3 mistakes and you're out,
//     difficulty ramping as you solve. Source pick (Mixed by default). Casual.
//   • Practice by opening — drill a single opening; each row shows your accuracy.
// Openings resolve to Lichess "angle" keys (puzzles.ts); we only offer openings
// Lichess actually has a puzzle set for. Connecting to Lichess isn't required —
// puzzles are fetched anonymously — but it adds the richer Lichess dashboard on
// the Statistics page, so we still nudge.

import { getAllLines, getAllGames } from './storage';
import { fetchNextPuzzle, toAngleKey } from './puzzles';
import { openingFamily } from './analysis';
import { startPuzzleSession, type PuzzleMode, type PuzzleDraw } from './puzzle-run';
import { recordPuzzleResult, getPuzzleDays, getPuzzlesByOpening } from './puzzle-log';
import { reviewResult, takeDueRepeat } from './puzzle-repeat';
import { getPuzzleRating, difficultyForRating, difficultyForStreak, targetRatingForStreak } from './puzzle-rating';
import { countUp } from './count-up';
import { renderLoadError } from './load-error';
import { Icons } from './icons';

export interface PuzzlesScreenDeps {
  onImportGames: () => void;
  onBuildLine: () => void;
}

type Source = 'repertoire' | 'games';
type TaSource = 'repertoire' | 'games' | 'mixed';
type TaMinutes = 3 | 5 | 10;

const PRACTICE_SOURCE_KEY = 'obertura.puzzles.practiceSource';
const TA_SOURCE_KEY = 'obertura.puzzles.taSource';
const TA_TIME_KEY = 'obertura.puzzles.taTime';

const DAILY_COUNT = 10;
// Practice-by-opening runs a shorter, focused set than the Daily Rated Mix.
const PRACTICE_COUNT = 5;

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
  const v = localStorage.getItem(TA_SOURCE_KEY);
  return v === 'repertoire' || v === 'games' ? v : 'mixed';
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
const TA_BEST_PREFIX = 'obertura.puzzles.taBest.';

// Personal best for a Time Attack length — the most puzzles solved in one run of
// this duration. One slot per length, mirroring the Training timed bests.
function getTaBest(m: TaMinutes): number {
  const n = Number(localStorage.getItem(TA_BEST_PREFIX + m));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
function recordTaBest(m: TaMinutes, score: number): boolean {
  if (score > getTaBest(m)) {
    try { localStorage.setItem(TA_BEST_PREFIX + m, String(score)); } catch { /* non-critical */ }
    return true;
  }
  return false;
}

// Forget every Time Attack best — part of "Reset progress" in Settings.
export function clearTaBest(): void {
  for (const m of TA_TIMES) {
    try { localStorage.removeItem(TA_BEST_PREFIX + m); } catch { /* non-critical */ }
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
  // many = a "Mixed" rotation. Difficulty is adaptive: rated/practice tracks your
  // rating, Time Attack ramps with the running solved count.
  function startSession(entries: OpeningEntry[], label: string, mode: PuzzleMode): void {
    if (entries.length === 0) return;
    const playAgain = (): void => startSession(entries, label, mode);

    // Per-session state for the repeat queue: which openings are in scope, the
    // repeats already served (so we don't re-show one mid-run), and a cap so a
    // session stays mostly fresh (~a third may be due repeats).
    const angleSet = new Set(entries.map((e) => e.angle));
    const servedRepeats = new Set<string>();
    let repeatsServed = 0;

    const drawFresh = async (ctx: { solved: number }): Promise<PuzzleDraw | null> => {
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
      // Count modes (Daily Mix / Practice): difficulty tracks your rating.
      const puzzle = await fetchNextPuzzle(pick.angle, { difficulty: difficultyForRating(getPuzzleRating()), colour: pick.colour });
      return puzzle ? { puzzle, angle: pick.angle, family: pick.family } : null;
    };

    startPuzzleSession({
      modeLabel: label,
      mode,
      nextPuzzle: async (ctx) => {
        // Count modes weave in a few due repeats before drawing fresh puzzles.
        if (mode.kind === 'count') {
          const cap = Math.floor(mode.count / 3);
          if (repeatsServed < cap) {
            const due = takeDueRepeat(servedRepeats, angleSet);
            if (due) {
              servedRepeats.add(due.puzzle.id);
              repeatsServed++;
              return { puzzle: due.puzzle, angle: due.angle, family: due.family, repeat: true };
            }
          }
        }
        return drawFresh(ctx);
      },
      onResult: (r) => {
        recordPuzzleResult(r.angle, r.solved);
        reviewResult(r.puzzle, r.angle, r.family, r.solved);
      },
      onComplete: (s) => {
        if (mode.kind === 'timed') recordTaBest((mode.ms / 60_000) as TaMinutes, s.solved);
      },
      onExit: () => { rebuild(); }, // refresh the "today" hero + performance on return
      onPlayAgain: playAgain,
    });
  }

  // The hero's count-up should only play once, on the first paint of the screen.
  // Later rebuilds (switching the Practice source, returning from a session) just
  // set the final numbers so they don't re-animate from zero on every tap.
  let firstRender = true;

  const rebuild = (): void => {
    root.innerHTML = '';

    // No openings at all on either source → a single empty state.
    if (allEntries.length === 0) {
      root.appendChild(emptyState(hasGames, deps));
      return;
    }

    root.appendChild(renderHero(firstRender));
    root.appendChild(renderTimeAttack());
    root.appendChild(renderPractice());
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
    start.appendChild(document.createTextNode('Daily Rated Mix'));
    start.addEventListener('click', () =>
      startSession(allEntries, 'Daily Rated Mix', { kind: 'count', count: DAILY_COUNT, rated: true }));
    hero.appendChild(start);

    const note = document.createElement('div');
    note.className = 'pz-hero-note';
    note.textContent = `${DAILY_COUNT} mixed puzzles from your repertoire and games · the only rated run`;
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

    // Time as chips that each show this length's personal best (mirrors the
    // Training Time-attack card); source stays a compact segmented row below.
    let time = getTaTime();
    const chips = document.createElement('div');
    chips.className = 'timed-chips pz-ta-times';
    const chipEls: HTMLButtonElement[] = [];
    for (const m of TA_TIMES) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'timed-chip' + (m === time ? ' timed-chip--on' : '');

      const dur = document.createElement('span');
      dur.className = 'timed-chip-dur';
      dur.textContent = `${m}m`;
      chip.appendChild(dur);

      const best = getTaBest(m);
      const bestEl = document.createElement('span');
      bestEl.className = 'timed-chip-best';
      if (best > 0) {
        bestEl.appendChild(document.createTextNode('best '));
        const num = document.createElement('span');
        num.className = 'timed-chip-best-num';
        num.textContent = '0';
        bestEl.appendChild(num);
        countUp(num, best);
      } else {
        bestEl.textContent = '—';
      }
      chip.appendChild(bestEl);

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

    let taSource = getTaSource();
    if (taSource === 'games' && !hasGames) taSource = 'mixed';
    const sourceOpts: [TaSource, string][] = hasGames
      ? [['mixed', 'Mixed'], ['repertoire', 'Repertoire'], ['games', 'Games']]
      : [['mixed', 'Mixed'], ['repertoire', 'Repertoire']];
    const sourceRow = segmented<TaSource>(sourceOpts, taSource, (s) => { taSource = s; setTaSource(s); });
    sourceRow.classList.add('pz-ta-source');
    section.appendChild(sourceRow);

    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'btn-primary pz-ta-start';
    start.textContent = 'Start Time Attack';
    start.addEventListener('click', () => {
      const pool = taSource === 'repertoire' ? repEntries
        : taSource === 'games' ? gameEntries
        : allEntries;
      const entries = pool.length ? pool : allEntries;
      const label = taSource === 'mixed' ? 'Time Attack — Mixed'
        : taSource === 'games' ? 'Time Attack — Games' : 'Time Attack — Repertoire';
      startSession(entries, label, { kind: 'timed', ms: time * 60_000, maxMistakes: 3 });
    });
    section.appendChild(start);

    return section;
  }

  // ── Practice by opening ──────────────────────────────────────────────────────
  function renderPractice(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'section pz-practice';

    const title = document.createElement('div');
    title.className = 'section-title';
    title.appendChild(document.createTextNode('Practice by opening'));
    section.appendChild(title);

    let source = getPracticeSource();
    if (source === 'games' && !hasGames) source = 'repertoire';

    // Source toggle only when there are games to switch to.
    if (hasGames) {
      const toggle = segmented<Source>(
        [['repertoire', 'My repertoire'], ['games', 'My games']],
        source,
        (s) => { setPracticeSource(s); rebuild(); },
      );
      toggle.classList.add('pz-practice-source');
      section.appendChild(toggle);
    }

    const entries = source === 'repertoire' ? repEntries : gameEntries;
    if (entries.length === 0) {
      const msg = document.createElement('p');
      msg.className = 'pz-ta-desc';
      msg.textContent = source === 'games'
        ? 'None of your games’ openings have a Lichess puzzle set yet.'
        : 'Save some opening lines first to practise their puzzles.';
      section.appendChild(msg);
      return section;
    }

    // Accuracy per opening (from past app puzzle results), for the performance pill.
    const perf = new Map<string, { pct: number; attempts: number }>();
    for (const o of getPuzzlesByOpening()) {
      const attempts = o.solved + o.failed;
      perf.set(o.angle, { pct: attempts ? Math.round((100 * o.solved) / attempts) : 0, attempts });
    }

    const list = document.createElement('div');
    list.className = 'pz-list';
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
    section.appendChild(list);
    return section;
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
  const wrap = document.createElement('div');
  wrap.className = 'pz-empty';
  const msg = document.createElement('p');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pz-connect-btn';

  if (!hasGames) {
    msg.textContent = 'Save some opening lines or import your games — then practise puzzles from the openings you actually play.';
    btn.textContent = 'Build a line';
    btn.addEventListener('click', deps.onBuildLine);
  } else {
    msg.textContent = 'None of your openings have a Lichess puzzle set yet. Try saving more lines or importing more games.';
    btn.textContent = 'Import more games';
    btn.addEventListener('click', deps.onImportGames);
  }
  wrap.appendChild(msg);
  wrap.appendChild(btn);
  return wrap;
}
