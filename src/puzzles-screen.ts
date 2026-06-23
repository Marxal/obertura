// The Puzzles tab. Practise Lichess tactics filtered to the openings you actually
// train. Two sources:
//   • your repertoire — the openings of your saved lines
//   • your games      — the openings that show up in your imported game history
// Both resolve to Lichess opening "angle" keys (puzzles.ts), and we only offer
// openings Lichess actually has a puzzle set for. Tapping one starts a SESSION
// (puzzle-run.ts): a fixed run of 10, or a 3-minute timed sprint. "Mixed" rotates
// across all of them.
//
// Connecting to Lichess isn't required — puzzles are fetched anonymously — but
// connecting tracks your puzzle rating on the Statistics page, so we nudge.

import { getAllLines, getAllGames } from './storage';
import { isConnected, connect } from './lichess-auth';
import { fetchNextPuzzle, toAngleKey, type Difficulty } from './puzzles';
import { openingFamily } from './analysis';
import { startPuzzleSession, type PuzzleMode } from './puzzle-run';
import { recordPuzzleResult } from './puzzle-log';
import { renderLoadError } from './load-error';
import { Icons } from './icons';

export interface PuzzlesScreenDeps {
  onImportGames: () => void;
  onBuildLine: () => void;
}

type Source = 'repertoire' | 'games';
type Mode = 'count' | 'timed';

const SOURCE_KEY = 'obertura.puzzles.source';
const DIFFICULTY_KEY = 'obertura.puzzles.difficulty';
const MODE_KEY = 'obertura.puzzles.mode';

const SESSION_COUNT = 10;
const TIMED_MS = 180_000; // 3 minutes

interface OpeningEntry {
  angle: string;             // Lichess opening key
  family: string;            // display name, e.g. "Sicilian Defense"
  colour?: 'white' | 'black';
  weight: number;            // line / game count, for ordering and the count badge
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
function getMode(): Mode {
  return localStorage.getItem(MODE_KEY) === 'timed' ? 'timed' : 'count';
}
function setMode(m: Mode): void {
  try { localStorage.setItem(MODE_KEY, m); } catch { /* non-critical */ }
}
function modeConfig(): PuzzleMode {
  return getMode() === 'timed'
    ? { kind: 'timed', ms: TIMED_MS }
    : { kind: 'count', count: SESSION_COUNT };
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

// A captioned control row: a small muted label above a segmented control.
function controlGroup(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pz-control';
  const cap = document.createElement('div');
  cap.className = 'pz-control-label';
  cap.textContent = label;
  wrap.appendChild(cap);
  wrap.appendChild(control);
  return wrap;
}

function colourPip(colour: 'white' | 'black'): HTMLElement {
  const pip = document.createElement('span');
  pip.className = `colour-pip colour-pip--${colour}`;
  pip.setAttribute('aria-hidden', 'true');
  return pip;
}

// Launch a session over a set of angle entries; one entry = a single opening,
// many = a "Mixed" rotation. Each fetch picks an entry (so colour matches) and
// the result carries that opening's angle straight through to the stats.
function launch(entries: OpeningEntry[], label: string): void {
  const difficulty = getDifficulty();
  startPuzzleSession({
    modeLabel: label,
    mode: modeConfig(),
    nextPuzzle: async () => {
      const pick = entries[Math.floor(Math.random() * entries.length)];
      const puzzle = await fetchNextPuzzle(pick.angle, { difficulty, colour: pick.colour });
      return puzzle ? { puzzle, angle: pick.angle } : null;
    },
    onResult: (r) => recordPuzzleResult(r.angle, r.solved),
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
    intro.textContent = 'Solve tactics from the openings you train. Pick a source and a session, then choose an opening — or mix them all.';
    root.appendChild(intro);

    // Source — two launcher cards (mirrors Explore), green when selected.
    const sourceRow = document.createElement('div');
    sourceRow.className = 'pz-source-row';
    sourceRow.appendChild(sourceCard('repertoire', 'My repertoire', Icons.tree(22), source === 'repertoire', () => {
      if (source !== 'repertoire') { source = 'repertoire'; setSource('repertoire'); rebuild(); }
    }));
    sourceRow.appendChild(sourceCard('games', 'My games', Icons.gamepad(22), source === 'games', () => {
      if (!hasGames) { deps.onImportGames(); return; }
      if (source !== 'games') { source = 'games'; setSource('games'); rebuild(); }
    }));
    root.appendChild(sourceRow);

    // Difficulty + session controls.
    const diffRow = segmented<Difficulty>(
      [['easier', 'Easier'], ['normal', 'Normal'], ['harder', 'Harder']],
      getDifficulty(),
      (d) => { setDifficulty(d); rebuild(); },
    );
    root.appendChild(controlGroup('Difficulty', diffRow));

    const modeRow = segmented<Mode>(
      [['count', `${SESSION_COUNT} puzzles`], ['timed', '3-min timed']],
      getMode(),
      (m) => { setMode(m); rebuild(); },
    );
    root.appendChild(controlGroup('Session', modeRow));

    // Connection nudge (puzzles still work without it).
    if (!isConnected()) {
      const card = document.createElement('div');
      card.className = 'pz-connect-card';
      const text = document.createElement('div');
      text.className = 'pz-connect-text';
      text.textContent = 'Connect to Lichess to track your puzzle stats and rating on the Statistics page. Puzzles work without it too.';
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

    // Opening list — family rows in the My Lines style (name + count badge).
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
      const count = document.createElement('span');
      count.className = 'pz-opening-count';
      count.textContent = String(e.weight);
      count.title = source === 'repertoire'
        ? `${e.weight} ${e.weight === 1 ? 'line' : 'lines'}`
        : `${e.weight} ${e.weight === 1 ? 'game' : 'games'}`;
      row.appendChild(count);
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

function sourceCard(
  _source: Source,
  label: string,
  icon: SVGSVGElement,
  selected: boolean,
  onPick: () => void,
): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pz-source-card' + (selected ? ' pz-source-card--on' : '');
  btn.setAttribute('aria-pressed', String(selected));
  btn.appendChild(icon);
  const span = document.createElement('span');
  span.textContent = label;
  btn.appendChild(span);
  btn.addEventListener('click', onPick);
  return btn;
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
