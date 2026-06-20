// Pure data + helpers for the Opening-traps feature (no DOM, so it's unit-tested
// by traps.selftest.ts). A "trap" is a famous opening line where the user plays
// the trapping side and the opponent walks into a tempting losing move; it maps
// onto a normal Line, so the existing drill/positions engines practise and quiz
// it with no new runtime.
//
// The curated data lives in src/traps.json (built by scripts/build-traps.mjs);
// the screen lazy-loads it. These helpers turn a trap into a trainable Line, find
// the traps relevant to a set of opening families (for the "openings you play" /
// "vs this opponent" sections), and derive the find-the-winning-move puzzle
// positions.

import { Chess } from 'chess.js';
import type { Line } from './types';
import type { MoveNode } from './tree';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export type TrapLevel = 'Intermediate' | 'Advanced';

export interface Trap {
  name: string;
  level: TrapLevel;
  // Opening family, keyed to match openingFamily() in analysis.ts so a trap can
  // be matched against the openings you (or a scouted opponent) actually play.
  family: string;
  // The opponent's tempting wrong move, for the blurb.
  bait: string;
  // One-line "why it wins".
  idea: string;
  source: 'curated' | 'lichess';
  sans: string[];
  ucis: string[];
}

export interface TrapPack {
  id: string;
  title: string;
  colour: 'white' | 'black';
  blurb: string;
  traps: Trap[];
}

// A single find-the-move puzzle: the board rests at preFen and the user must
// play `expected`. prevUci/prevFen carry the opponent's previous move so the
// drill can animate the bait in (DrillOptions.playPrelude). Matches the shape
// startPositionsDrill consumes.
export interface PuzzlePosition {
  preFen: string;
  expected: MoveNode;
  prevUci?: string;
  prevFen?: string;
}

// First ply we'll ever quiz as a puzzle — skip the trivial opening moves so a
// puzzle always lands on a real decision (mirrors individual.ts).
const MIN_PUZZLE_PLY_INDEX = 4;

// Build a transient (unsaved) Line from a trap. Replays the UCIs into a move
// tree; the caller decides whether to drill it (no save) or persist it. Returns
// null if no legal move could be applied. Mirrors lineFromUcis in main.ts but
// names the line from the trap rather than the opening book.
export function lineFromTrap(
  trap: Trap,
  colour: 'white' | 'black',
  opts: { tags?: string[]; inTraining?: boolean } = {},
): Line | null {
  const ch = new Chess();
  const root: MoveNode = { id: 'root', san: '', uci: '', fen: ch.fen(), children: [] };
  let cursor = root;
  let i = 0;
  for (const uci of trap.ucis) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = (uci[4] as 'q' | 'r' | 'b' | 'n') || 'q';
    let move;
    try { move = ch.move({ from, to, promotion }); } catch { move = null; }
    if (!move) break;
    const node: MoveNode = {
      id: `n${++i}`, san: move.san, uci: from + to + (move.promotion ?? ''), fen: ch.fen(), children: [],
    };
    cursor.children.push(node);
    cursor = node;
  }
  if (root.children.length === 0) return null;
  return {
    id: crypto.randomUUID(),
    name: trap.name,
    tags: opts.tags ?? [],
    colour,
    openingName: trap.family,
    confidence: 0,
    lastTrained: null,
    inTraining: opts.inTraining ?? false,
    tree: root,
    createdAt: Date.now(),
  };
}

// The mainline nodes of a Line's tree (children[0] all the way down). Local copy
// so this module stays DOM/scheduler-free for the self-test.
function mainline(tree: MoveNode): MoveNode[] {
  const out: MoveNode[] = [];
  let node: MoveNode | undefined = tree.children[0];
  while (node) {
    out.push(node);
    node = node.children[0];
  }
  return out;
}

// Normalise a family string for matching (case/space-insensitive).
function normFamily(f: string): string {
  return f.trim().toLowerCase();
}

// Every trap (flattened, with its pack colour) whose family is in `families`.
// Used to surface traps for the openings you play, or to set against a scouted
// opponent. `colour`, when given, keeps only traps you'd spring from that side.
export function trapsForFamilies(
  packs: TrapPack[],
  families: Iterable<string>,
  colour?: 'white' | 'black',
): { trap: Trap; colour: 'white' | 'black' }[] {
  const want = new Set([...families].map(normFamily));
  const out: { trap: Trap; colour: 'white' | 'black' }[] = [];
  for (const pack of packs) {
    if (colour && pack.colour !== colour) continue;
    for (const trap of pack.traps) {
      if (want.has(normFamily(trap.family))) out.push({ trap, colour: pack.colour });
    }
  }
  return out;
}

// One (family, colour) you want traps for — "a trap of this colour in this
// family". Surfacing traps for the openings you play uses the colour you play
// them; setting traps against an opponent uses the OPPOSITE colour to theirs
// (you answer the side they're on). De-duplicated across overlapping pairs.
export interface TrapWant { family: string; colour: 'white' | 'black'; }

export function trapsForPairs(
  packs: TrapPack[],
  wants: Iterable<TrapWant>,
): { trap: Trap; colour: 'white' | 'black' }[] {
  const want = new Set<string>();
  for (const w of wants) want.add(`${normFamily(w.family)}|${w.colour}`);
  const out: { trap: Trap; colour: 'white' | 'black' }[] = [];
  const seen = new Set<string>();
  for (const pack of packs) {
    for (const trap of pack.traps) {
      if (!want.has(`${normFamily(trap.family)}|${pack.colour}`)) continue;
      if (seen.has(trap.name)) continue;
      seen.add(trap.name);
      out.push({ trap, colour: pack.colour });
    }
  }
  return out;
}

// The find-the-winning-move puzzles for a trap line: one position per move the
// trapping side plays (from MIN_PUZZLE_PLY_INDEX on), each carrying the
// opponent's previous move so the bait can be replayed in. The last entry is the
// decisive blow. Mirrors candidatesFor in individual.ts.
export function trapPuzzlePositions(line: Line): PuzzlePosition[] {
  const nodes = mainline(line.tree);
  const out: PuzzlePosition[] = [];
  for (let i = MIN_PUZZLE_PLY_INDEX; i < nodes.length; i++) {
    const isUserMove = line.colour === 'white' ? i % 2 === 0 : i % 2 === 1;
    if (!isUserMove) continue;
    out.push({
      preFen: i >= 1 ? nodes[i - 1].fen : START_FEN,
      expected: nodes[i],
      prevUci: i >= 1 ? nodes[i - 1].uci : undefined,
      prevFen: i >= 2 ? nodes[i - 2].fen : undefined,
    });
  }
  return out;
}

// Just the decisive blow — the trapping side's final move — as a single puzzle.
// Used for "puzzle this pack" / timed runs, one shot per trap.
export function decisivePuzzle(line: Line): PuzzlePosition | null {
  const all = trapPuzzlePositions(line);
  return all.length ? all[all.length - 1] : null;
}
