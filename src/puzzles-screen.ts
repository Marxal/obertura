// The Puzzles tab. Practise Lichess tactics filtered to the openings you actually
// train. Two sources:
//   • your repertoire — the openings of your saved lines
//   • your games      — the openings that show up in your imported game history
// Both resolve to Lichess opening "angle" keys (puzzles.ts), and we only offer
// openings Lichess actually has a puzzle set for. Tapping one opens the solver
// (puzzle-run.ts); "Mixed" rotates across all of them.
//
// Connecting to Lichess isn't required — anonymous puzzles work — but with the
// puzzle:read token Lichess skips puzzles you've already seen, so we nudge.

import { getAllLines, getAllGames } from './storage';
import { isConnected, connect, getAccessToken } from './lichess-auth';
import { fetchNextPuzzle, toAngleKey, type Difficulty } from './puzzles';
import { openingFamily } from './analysis';
import { startPuzzleRun } from './puzzle-run';
import { recordPuzzleResult } from './puzzle-log';
import { renderLoadError } from './load-error';
import { Icons } from './icons';

export interface PuzzlesScreenDeps {
  onImportGames: () => void;
  onBuildLine: () => void;
}

type Source = 'repertoire' | 'games';

const SOURCE_KEY = 'obertura.puzzles.source';
const DIFFICULTY_KEY = 'obertura.puzzles.difficulty';

interface OpeningEntry {
  angle: string;             // Lichess opening key
  family: string;            // display name, e.g. "Sicilian Defense"
  colour?: 'white' | 'black';
  weight: number;            // line / game count, for ordering
}

function getSource(): Source {
  return localStorage.getItem(SOURCE_KEY) === 'games' ? 'games' : 'repertoire';
}
function setSource(s: Source): void {
  try { localStorage.setItem(SOURCE_KEY, s); } catch { /* non-critical */ }
}
function getDifficulty(): Difficulty {
  const v = localStorage.getItem(DIFFICULTY_KEY);
  return v === 'easier' || v === 'harder' ? v : 'normal';
}
function setDifficulty(d: Difficulty): void {
  try { localStorage.setItem(DIFFICULTY_KEY, d); } catch { /* non-critical */ }
}

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

// Small segmented control (mirrors the Statistics range chips).
function segmented<T extends string>(opts: [T, string][], current: T, onChange: (v: T) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'stats-range';
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

// Launch the solver over a set of angle entries; one entry = a single opening,
// many = a "Mixed" rotation. Each fetch picks an entry (so colour matches) and we
// attribute the result to that opening for the stats.
function launch(entries: OpeningEntry[], label: string): void {
  let lastAngle: string | null = null;
  const difficulty = getDifficulty();
  startPuzzleRun({
    modeLabel: label,
    nextPuzzle: async () => {
      const pick = entries[Math.floor(Math.random() * entries.length)];
      lastAngle = pick.angle;
      const token = await getAccessToken();
      return fetchNextPuzzle(pick.angle, { difficulty, colour: pick.colour, token });
    },
    onResult: (r) => recordPuzzleResult(lastAngle, r.solved),
    onExit: () => { /* overlay tears itself down */ },
  });
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
  // If the user picked "games" before importing any, fall back to repertoire.
  let source = getSource();
  if (source === 'games' && !hasGames) source = 'repertoire';

  const rebuild = (): void => {
    root.innerHTML = '';

    // Intro.
    const intro = document.createElement('p');
    intro.className = 'pz-intro';
    intro.textContent = 'Solve tactics from the openings you train. Pick an opening, or mix them all.';
    root.appendChild(intro);

    // Source toggle.
    const sourceRow = segmented<Source>(
      [['repertoire', 'My repertoire'], ['games', 'My games']],
      source,
      (s) => {
        if (s === 'games' && !hasGames) { deps.onImportGames(); return; }
        source = s; setSource(s); rebuild();
      },
    );
    root.appendChild(sourceRow);

    // Difficulty toggle.
    const diffRow = segmented<Difficulty>(
      [['easier', 'Easier'], ['normal', 'Normal'], ['harder', 'Harder']],
      getDifficulty(),
      (d) => { setDifficulty(d); },
    );
    diffRow.classList.add('pz-difficulty');
    root.appendChild(diffRow);

    // Connection nudge (puzzles still work without it).
    if (!isConnected()) {
      const card = document.createElement('div');
      card.className = 'pz-connect-card';
      const text = document.createElement('div');
      text.className = 'pz-connect-text';
      text.textContent = 'Connect to Lichess so puzzles you’ve already solved don’t repeat — and to track your puzzle rating on the Statistics page.';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pz-connect-btn';
      btn.textContent = 'Connect to Lichess';
      btn.addEventListener('click', () => connect());
      card.appendChild(text);
      card.appendChild(btn);
      root.appendChild(card);
    }

    // Build the opening entries for the chosen source.
    const entries = source === 'repertoire'
      ? entriesFrom(lines.map((l) => ({ opening: l.openingName, colour: l.colour })))
      : entriesFrom(games.map((g) => ({ opening: g.opening, colour: g.colour })));

    if (entries.length === 0) {
      root.appendChild(emptyState(source, hasGames, deps));
      return;
    }

    // "Mixed" card — rotate across every opening.
    const mixed = document.createElement('button');
    mixed.type = 'button';
    mixed.className = 'pz-mixed-card';
    mixed.appendChild(Icons.sparkles(20));
    const mixedText = document.createElement('span');
    mixedText.textContent = `Mixed — all ${entries.length} ${entries.length === 1 ? 'opening' : 'openings'}`;
    mixed.appendChild(mixedText);
    mixed.addEventListener('click', () => launch(entries, 'Mixed puzzles'));
    root.appendChild(mixed);

    // Opening list.
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
      const go = document.createElement('span');
      go.className = 'pz-opening-go';
      go.appendChild(Icons.target(18));
      row.appendChild(go);
      row.addEventListener('click', () => launch([e], e.family));
      list.appendChild(row);
    }
    root.appendChild(list);
  };

  rebuild();
}

function emptyState(source: Source, hasGames: boolean, deps: PuzzlesScreenDeps): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pz-empty';
  const msg = document.createElement('p');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pz-connect-btn';

  if (source === 'games' && !hasGames) {
    msg.textContent = 'Import your games to practise puzzles from the openings you actually play.';
    btn.textContent = 'Import games';
    btn.addEventListener('click', deps.onImportGames);
  } else if (source === 'games') {
    msg.textContent = 'None of your games’ openings have a Lichess puzzle set yet. Try “My repertoire”, or import more games.';
    btn.textContent = 'Import more games';
    btn.addEventListener('click', deps.onImportGames);
  } else {
    msg.textContent = 'Save some opening lines first — then practise puzzles from those openings.';
    btn.textContent = 'Build a line';
    btn.addEventListener('click', deps.onBuildLine);
  }
  wrap.appendChild(msg);
  wrap.appendChild(btn);
  return wrap;
}
