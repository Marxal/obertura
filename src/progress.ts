// Cross-reference imported-game results with training progress.
//
// The Review tab answers "where do I score badly?". This answers the next
// question: "is drilling actually helping?" — does grinding an opening in the
// trainer move the needle on my real games over time?
//
// We can answer it purely from data already on the device, with no new history
// log to wait for:
//   • imported games carry the date they were played (endTime) and the result;
//   • each saved line carries the date it was last drilled (lastTrained).
//
// So for every line you train, we link the games that belong to its prep and
// split them at the drill date: games played BEFORE you last drilled it vs.
// games played SINCE. If the "since" score beats the "before" score, the
// drilling is paying off. If it sank, the prep needs another look (or the line
// itself is the problem, not your memory of it).
//
// LINKING games to a line is by moves, not names — saved lines rarely carry an
// opening name (it's looked up live), so we replay each game through the line's
// tree and call it a match if the game followed the prep for enough plies. A
// game can sit inside several lines' prep; it's assigned to the deepest match so
// it's only counted once.

import type { ImportedGame } from './chesscom';
import type { Line } from './types';
import type { MoveNode } from './tree';
import { openingFamily, UNKNOWN_FAMILY } from './analysis';

// ── Tunables ─────────────────────────────────────────────────────────────────
// A game links to a line only if it followed the prep this many plies (capped
// to whatever the game actually has). Deep enough that "1.e4" alone never links
// every e4 game to every e4 line, shallow enough that real prep matches.
export const LINK_PLIES = 6;
// Below this, a match is too shallow to trust (move 1 is shared by too much).
export const MIN_LINK_DEPTH = 3;
// Each side of the before/after split needs at least this many games before we
// dare call a trend — one game either way is noise, not a signal.
export const MIN_WINDOW = 3;
// Score swing (percentage points) that counts as a real move, not wobble.
export const IMPROVE_THRESHOLD = 8;

// ── Output shapes ──────────────────────────────────────────────────────────────

export interface ProgressWindow {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  scorePct: number; // (wins + draws/2) / games * 100, rounded; 0 when no games
}

// improved / declined / steady once both windows have enough games to compare;
// too-soon when one side is too thin; untrained when the line was never drilled.
export type ProgressVerdict =
  | 'improved'
  | 'declined'
  | 'steady'
  | 'too-soon'
  | 'untrained';

export interface LineProgress {
  lineId: string;
  title: string;             // the card heading (line name, or the opening family)
  family: string;            // modal opening family across the linked games
  colour: 'white' | 'black';
  inTraining: boolean;
  confidence: number;        // 0–5, the line's current training confidence
  lastTrained: string | null;
  totalGames: number;        // games linked to this line
  before: ProgressWindow;    // games played before the last drill
  after: ProgressWindow;     // games played since the last drill
  delta: number | null;      // after.scorePct − before.scorePct, when comparable
  verdict: ProgressVerdict;
}

export interface ProgressReport {
  trackedLines: number;      // lines currently in training
  linkedLines: number;       // lines with at least one game linked to them
  totalLinkedGames: number;  // games attributed to some line's prep
  items: LineProgress[];     // one row per linked line, best stories first
}

// ── Game → line linking (by moves) ─────────────────────────────────────────────

// How many plies of `ucis` the line's tree can follow before it runs out.
// Branches are allowed: at each step we take whichever child matches the game.
function matchDepth(tree: MoveNode, ucis: string[], limit: number): number {
  let node = tree;
  let depth = 0;
  const stop = Math.min(ucis.length, limit);
  for (let i = 0; i < stop; i++) {
    const next = node.children.find(c => c.uci === ucis[i]);
    if (!next) break;
    node = next;
    depth++;
  }
  return depth;
}

// A match counts if the game stayed in the prep for MIN_LINK_DEPTH plies AND for
// as deep as we asked (min of LINK_PLIES and the game's own length). The second
// clause stops a long prep from "linking" a game that only shared its first
// couple of moves.
function linkDepth(line: Line, game: ImportedGame): number {
  if (line.colour !== game.colour) return 0;
  const need = Math.min(LINK_PLIES, game.ucis.length);
  const depth = matchDepth(line.tree, game.ucis, LINK_PLIES);
  if (depth < MIN_LINK_DEPTH || depth < need) return 0;
  return depth;
}

// ── Scoring ────────────────────────────────────────────────────────────────────

function emptyWindow(): ProgressWindow {
  return { games: 0, wins: 0, draws: 0, losses: 0, scorePct: 0 };
}

function tally(w: ProgressWindow, r: ImportedGame['result']): void {
  if (r === 'win') w.wins++;
  else if (r === 'loss') w.losses++;
  else w.draws++;
  w.games++;
}

function finishWindow(w: ProgressWindow): void {
  w.scorePct = w.games === 0
    ? 0
    : Math.round(((w.wins + w.draws / 2) / w.games) * 100);
}

// Modal opening family across a clutch of games — the line's own name is the
// user's title, but the games tell us which opening it actually is.
function modalFamily(games: ImportedGame[]): string {
  const counts = new Map<string, number>();
  for (const g of games) {
    const fam = openingFamily(g.opening);
    counts.set(fam, (counts.get(fam) ?? 0) + 1);
  }
  let best = UNKNOWN_FAMILY;
  let bestN = -1;
  for (const [fam, n] of counts) {
    // Prefer a recognised family even if a few games came back unlabelled.
    const score = fam === UNKNOWN_FAMILY ? n - 0.5 : n;
    if (score > bestN) { bestN = score; best = fam; }
  }
  return best;
}

function verdictFor(
  before: ProgressWindow,
  after: ProgressWindow,
  lastTrained: string | null,
): { verdict: ProgressVerdict; delta: number | null } {
  if (!lastTrained) return { verdict: 'untrained', delta: null };
  if (before.games < MIN_WINDOW || after.games < MIN_WINDOW) {
    return { verdict: 'too-soon', delta: null };
  }
  const delta = after.scorePct - before.scorePct;
  if (delta >= IMPROVE_THRESHOLD) return { verdict: 'improved', delta };
  if (delta <= -IMPROVE_THRESHOLD) return { verdict: 'declined', delta };
  return { verdict: 'steady', delta };
}

// ── The report ──────────────────────────────────────────────────────────────────

export function crossReference(
  games: ImportedGame[],
  lines: Line[],
): ProgressReport {
  // Assign each game to the line whose prep it follows deepest (so overlapping
  // repertoires never double-count a game).
  const linked = new Map<string, ImportedGame[]>();
  for (const game of games) {
    let bestLine: Line | null = null;
    let bestDepth = 0;
    for (const line of lines) {
      const d = linkDepth(line, game);
      if (d > bestDepth) { bestDepth = d; bestLine = line; }
    }
    if (bestLine) {
      const arr = linked.get(bestLine.id) ?? [];
      arr.push(game);
      linked.set(bestLine.id, arr);
    }
  }

  const items: LineProgress[] = [];
  for (const line of lines) {
    const mine = linked.get(line.id);
    if (!mine || mine.length === 0) continue;

    const cutoff = line.lastTrained ? new Date(line.lastTrained).getTime() : null;
    const before = emptyWindow();
    const after = emptyWindow();
    for (const g of mine) {
      // endTime is unix *seconds*; lastTrained is an ISO string (ms).
      if (cutoff !== null && g.endTime * 1000 >= cutoff) tally(after, g.result);
      else tally(before, g.result);
    }
    finishWindow(before);
    finishWindow(after);

    const family = modalFamily(mine);
    const named = line.name && line.name.trim() && line.name !== 'Untitled line';
    const { verdict, delta } = verdictFor(before, after, line.lastTrained);

    items.push({
      lineId: line.id,
      title: named ? line.name.trim() : family,
      family,
      colour: line.colour,
      inTraining: line.inTraining,
      confidence: line.confidence,
      lastTrained: line.lastTrained,
      totalGames: mine.length,
      before,
      after,
      delta,
      verdict,
    });
  }

  // Lines you're actively drilling first; within that, the ones with the most
  // games behind them (the most trustworthy stories) lead.
  items.sort((a, b) =>
    Number(b.inTraining) - Number(a.inTraining) ||
    b.totalGames - a.totalGames ||
    a.title.localeCompare(b.title),
  );

  return {
    trackedLines: lines.filter(l => l.inTraining).length,
    linkedLines: items.length,
    totalLinkedGames: items.reduce((n, it) => n + it.totalGames, 0),
    items,
  };
}
