// A runnable, network-free check of the opponent-scouting tree builder — same
// spirit as analysis.selftest.ts. Verifies that games of a colour merge into one
// frequency-sorted tree, that the other colour is excluded, that rare branches
// are pruned on a big enough sample, and that depth is capped.

import { Chess } from 'chess.js';
import { buildOpponentTree, makeOpponent } from './scout';
import type { ImportedGame } from './chesscom';
import type { MoveNode } from './tree';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

let gameSeq = 0;
function game(colour: 'white' | 'black', sanLine: string): ImportedGame {
  const chess = new Chess();
  const sans: string[] = [];
  const ucis: string[] = [];
  for (const san of sanLine.split(/\s+/).filter(Boolean)) {
    const m = chess.move(san);
    sans.push(m.san);
    ucis.push(m.from + m.to + (m.promotion ?? ''));
  }
  return {
    id: `g${++gameSeq}`, url: '', endTime: 0,
    timeClass: 'blitz', timeControl: '180', rated: true,
    colour, result: 'win', opponent: 'foe', eco: null, opening: null,
    sans, ucis, plyCount: sans.length,
  };
}

// Depth of the deepest node under a tree root.
function maxDepth(root: MoveNode): number {
  if (root.children.length === 0) return 0;
  return 1 + Math.max(...root.children.map(maxDepth));
}

export function runScoutSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // 1. Only the requested colour is built; the spine merges shared moves.
  const mixed = [
    game('white', 'e4 e5 Nf3'),
    game('white', 'e4 c5 Nf3'),
    game('black', 'd4 Nf6 c4'),
  ];
  const white = buildOpponentTree(mixed, 'white');
  const black = buildOpponentTree(mixed, 'black');
  check(
    'colour filter + shared first move merges',
    white.children.length === 1 && white.children[0].san === 'e4' &&
      white.children[0].children.length === 2 &&
      black.children.length === 1 && black.children[0].san === 'd4',
    `white root kids=${white.children.length} first=${white.children[0]?.san}; black first=${black.children[0]?.san}`,
  );

  // 2. Children are sorted most-played first.
  const weighted = [
    game('white', 'e4 e5'), game('white', 'e4 e5'), game('white', 'e4 e5'),
    game('white', 'd4 d5'),
  ];
  const wt = buildOpponentTree(weighted, 'white');
  check(
    'children sorted by frequency',
    wt.children[0].san === 'e4' && wt.children[1].san === 'd4',
    `order=${wt.children.map(c => c.san).join(',')}`,
  );

  // 3. On a big sample, a one-off branch is pruned but the main line survives.
  const many: ImportedGame[] = [];
  for (let i = 0; i < 12; i++) many.push(game('white', 'e4 e5 Nf3 Nc6'));
  many.push(game('white', 'e4 e5 Nf3 d6')); // single deviation at ply 4
  const pruned = buildOpponentTree(many, 'white');
  const afterNf3 = pruned.children[0]?.children[0]?.children[0];
  check(
    'rare branch pruned, main line kept',
    !!afterNf3 && afterNf3.children.length === 1 && afterNf3.children[0].san === 'Nc6',
    `kids after Nf3 = ${afterNf3?.children.map(c => c.san).join(',')}`,
  );

  // 4. Depth is capped at the map limit (16 plies) even for a long game.
  const longLine =
    'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7';
  const deep = buildOpponentTree([game('white', longLine)], 'white');
  check(
    'depth capped at 16 plies',
    maxDepth(deep) === 16,
    `maxDepth=${maxDepth(deep)}`,
  );

  // 5. makeOpponent records counts and both colour trees.
  const opp = makeOpponent({ platform: 'lichess', username: 'Foe' }, mixed);
  check(
    'makeOpponent builds both trees + count',
    opp.gamesAnalysed === 3 && opp.name === 'Foe' &&
      opp.whiteTree.children.length === 1 && opp.blackTree.children.length === 1,
    `count=${opp.gamesAnalysed} white=${opp.whiteTree.children.length} black=${opp.blackTree.children.length}`,
  );

  return results;
}
