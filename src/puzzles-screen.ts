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
import { isConnected, connect } from './lichess-auth';
import { fetchNextPuzzle, toAngleKey, type Difficulty } from './puzzles';
import { openingFamily } from './analysis';
import { startPuzzleSession, type PuzzleMode } from './puzzle-run';
import { recordPuzzleResult, getPuzzleDays, getPuzzlesByOpening } from './puzzle-log';
import { getPuzzleRating, difficultyForRating, difficultyForStreak } from './puzzle-rating';
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
  for (const [key, label] of opts) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'stats-range-chip' + (key === current ? ' stats-range-chip--on' : '');
    chip.textContent = label;
    chip.addEventListener('click', () => { if (key !== current) onChange(key); });
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
    startPuzzleSession({
      modeLabel: label,
      mode,
      nextPuzzle: async (ctx) => {
        const difficulty: Difficulty = mode.kind === 'timed'
          ? difficultyForStreak(ctx.solved)
          : difficultyForRating(getPuzzleRating());
        const pick = entries[Math.floor(Math.random() * entries.length)];
        const puzzle = await fetchNextPuzzle(pick.angle, { difficulty, colour: pick.colour });
        return puzzle ? { puzzle, angle: pick.angle, family: pick.family } : null;
      },
      onResult: (r) => recordPuzzleResult(r.angle, r.solved),
      onExit: () => { rebuild(); }, // refresh the "today" hero + performance on return
      onPlayAgain: playAgain,
    });
  }

  const rebuild = (): void => {
    root.innerHTML = '';

    // No openings at all on either source → a single empty state.
    if (allEntries.length === 0) {
      root.appendChild(emptyState(hasGames, deps));
      return;
    }

    root.appendChild(renderHero());

    // Connection nudge (puzzles still work without it).
    if (!isConnected()) root.appendChild(connectNudge());

    root.appendChild(renderTimeAttack());
    root.appendChild(renderPractice());
  };

  // ── Today hero (Daily Rated Mix) ────────────────────────────────────────────
  function renderHero(): HTMLElement {
    const days = getPuzzleDays();
    const today = days.find((d) => d.day === todayKey());
    const solvedToday = today?.solved ?? 0;
    const missedToday = today?.failed ?? 0;
    const rating = getPuzzleRating();

    const hero = document.createElement('div');
    hero.className = 'card train-hero pz-hero';

    const stats = document.createElement('div');
    stats.className = 'train-hero-stats';
    stats.appendChild(heroStat('solved', solvedToday, 'Solved today'));
    stats.appendChild(heroStat('missed', missedToday, 'Missed today'));
    stats.appendChild(heroStat('rating', rating, 'Rating'));
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

  function heroStat(kind: string, value: number, label: string): HTMLElement {
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
    countUp(num, value);
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

    // Time + source as two compact segmented rows.
    let time = getTaTime();
    const timeRow = segmented<TaMinutes>(
      [[3, '3 min'], [5, '5 min'], [10, '10 min']],
      time,
      (m) => { time = m; setTaTime(m); },
    );
    section.appendChild(timeRow);

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
      // Performance pill (or a hint to play it) replaces the old target icon.
      row.appendChild(perfPill(perf.get(e.angle)));
      row.addEventListener('click', () =>
        startSession([e], e.family, { kind: 'count', count: DAILY_COUNT }));
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

function connectNudge(): HTMLElement {
  const card = document.createElement('div');
  card.className = 'pz-connect-card';
  const text = document.createElement('div');
  text.className = 'pz-connect-text';
  text.textContent = 'Connect to Lichess to see your full puzzle dashboard on the Statistics page. Puzzles work without it too.';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pz-connect-btn';
  btn.textContent = 'Connect to Lichess';
  btn.addEventListener('click', () => connect());
  card.appendChild(text);
  card.appendChild(btn);
  return card;
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
