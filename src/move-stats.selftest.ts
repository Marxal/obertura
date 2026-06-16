// Network-free checks for the per-move stats lookup (move-stats.ts). Same spirit
// as scout.selftest.ts: build games from SAN lines, then assert the W/D/L tree.

import { Chess } from 'chess.js';
import { buildMoveStats, buildRepertoireStatTree, statAt, statScorePct, topReply, gameAtPath } from './move-stats';
import type { ImportedGame } from './import-core';
import type { MoveNode } from './tree';
import type { Line } from './types';

export interface TestResult { name: string; pass: boolean; detail: string }

let seq = 0;
function game(
  colour: 'white' | 'black',
  sanLine: string,
  result: ImportedGame['result'],
): ImportedGame {
  const chess = new Chess();
  const sans: string[] = [];
  const ucis: string[] = [];
  for (const san of sanLine.split(/\s+/).filter(Boolean)) {
    const m = chess.move(san);
    sans.push(m.san);
    ucis.push(m.from + m.to + (m.promotion ?? ''));
  }
  return {
    id: `g${++seq}`, url: '', endTime: 0,
    timeClass: 'blitz', timeControl: '180', rated: true,
    colour, result, opponent: 'foe', eco: null, opening: null,
    sans, ucis, plyCount: sans.length,
  };
}

// A single-path Line from a SAN line, for repertoire-stat-tree tests.
function line(colour: 'white' | 'black', sanLine: string): Line {
  const chess = new Chess();
  const root: MoveNode = { id: 'root', san: '', uci: '', fen: chess.fen(), children: [] };
  let node = root;
  for (const san of sanLine.split(/\s+/).filter(Boolean)) {
    const m = chess.move(san);
    const child: MoveNode = {
      id: `n${++seq}`, san: m.san, uci: m.from + m.to + (m.promotion ?? ''),
      fen: chess.fen(), children: [],
    };
    node.children.push(child);
    node = child;
  }
  return {
    id: `l${++seq}`, name: sanLine, tags: [], colour,
    openingName: null, confidence: 0, lastTrained: null, inTraining: false,
    tree: root,
  };
}

export function runMoveStatsSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // A sample: three White games down 1.e4 e5 (2 wins, 1 loss), one White game
  // down 1.d4, and a Black game that must be excluded from the White tree.
  const games = [
    game('white', 'e4 e5 Nf3', 'win'),
    game('white', 'e4 e5 Nf3', 'win'),
    game('white', 'e4 e5 Bc4', 'loss'),
    game('white', 'd4 d5', 'draw'),
    game('black', 'e4 e5 Nf3', 'win'),
  ];

  const root = buildMoveStats(games, 'white', 40);

  // 1. Root carries the colour totals; the other colour is excluded.
  check(
    'root totals = white games only',
    root.games === 4 && root.wins === 2 && root.draws === 1 && root.losses === 1,
    `games=${root.games} w=${root.wins} d=${root.draws} l=${root.losses}`,
  );

  // 2. Tallies accumulate along a shared path: 1.e4 reached by 3 games (2W/1L).
  const e4 = statAt(root, [games[0].ucis[0]]);
  const afterE5 = statAt(root, games[0].ucis.slice(0, 2));
  check(
    'shared path tallies accumulate',
    !!e4 && e4.games === 3 && e4.wins === 2 && e4.losses === 1 &&
      !!afterE5 && afterE5.games === 3,
    `e4=${e4?.games} (${e4?.wins}/${e4?.draws}/${e4?.losses})`,
  );

  // 3. A move that splits: after 1.e4 e5, Nf3 (2W) and Bc4 (1L) are siblings.
  const nf3 = statAt(root, games[0].ucis.slice(0, 3));
  const bc4 = statAt(root, games[2].ucis.slice(0, 3));
  check(
    'sibling moves tallied apart',
    !!nf3 && nf3.games === 2 && nf3.wins === 2 && !!bc4 && bc4.losses === 1,
    `Nf3=${nf3?.games}W${nf3?.wins} Bc4=${bc4?.games}L${bc4?.losses}`,
  );

  // 4. statAt returns null for a path the games never took.
  check(
    'unplayed path → null',
    statAt(root, ['a2a4']) === null,
    `got ${statAt(root, ['a2a4'])}`,
  );

  // 5. topReply picks the busiest child (Nf3, 2 games, over Bc4's 1).
  const reply = topReply(afterE5!);
  check(
    'topReply is the busiest continuation',
    reply?.san === 'Nf3' && reply?.games === 2,
    `reply=${reply?.san} (${reply?.games})`,
  );

  // 6. statScorePct: after 1.e4, 2 wins + 1 loss over 3 = 67%.
  check(
    'score% counts a win 1, draw ½',
    statScorePct(e4!) === 67,
    `score=${statScorePct(e4!)}`,
  );

  // 7. maxPlies caps how deep games are recorded.
  const shallow = buildMoveStats(games, 'white', 2);
  check(
    'maxPlies caps recorded depth',
    statAt(shallow, games[0].ucis.slice(0, 2)) !== null &&
      statAt(shallow, games[0].ucis.slice(0, 3)) === null,
    `depth-3 present=${statAt(shallow, games[0].ucis.slice(0, 3)) !== null}`,
  );

  // 8. gameAtPath pins down a single stored game once the path is unique to it.
  //    games[2] (Bc4) is the only White game down 1.e4 e5 Bc4, so it resolves;
  //    the shared 1.e4 e5 prefix (3 games) and the empty start do not.
  const withUrls = games.map((g, i) => ({ ...g, url: `https://chess.com/game/${i}` }));
  const unique = gameAtPath(withUrls, 'white', withUrls[2].ucis.slice(0, 3));
  const shared = gameAtPath(withUrls, 'white', withUrls[0].ucis.slice(0, 2));
  check(
    'gameAtPath resolves a unique line to its game',
    unique?.id === withUrls[2].id && unique?.url === 'https://chess.com/game/2',
    `unique=${unique?.id} url=${unique?.url}`,
  );
  check(
    'gameAtPath returns null for a shared (aggregate) position',
    shared === null,
    `shared=${shared}`,
  );

  // 9. The start position (empty path) is always an aggregate — never one game.
  check(
    'gameAtPath returns null at the start',
    gameAtPath(withUrls, 'white', []) === null,
    `start=${gameAtPath(withUrls, 'white', [])}`,
  );

  // 10. Colour is respected: the lone Black game resolves only under 'black'.
  const blackOnly = gameAtPath(withUrls, 'black', withUrls[4].ucis.slice(0, 3));
  check(
    'gameAtPath respects colour perspective',
    blackOnly?.id === withUrls[4].id &&
      gameAtPath(withUrls, 'white', withUrls[4].ucis.slice(0, 1))?.id !== withUrls[4].id,
    `blackOnly=${blackOnly?.id}`,
  );

  // 11. buildRepertoireStatTree: the tree is shaped like the REPERTOIRE, with
  //     your game W/D/L overlaid where you've played those moves, and zeros on
  //     prepared-but-unplayed moves.
  //     Repertoire: 1.e4 e5 Nf3 (played in games: 2W) and 1.e4 e5 Bc4 (1L), plus
  //     a prepared-but-never-played 1.e4 e5 Nc3.
  const rep = [
    line('white', 'e4 e5 Nf3'),
    line('white', 'e4 e5 Bc4'),
    line('white', 'e4 e5 Nc3'),
  ];
  const repTree = buildRepertoireStatTree(rep, games, 'white', 40);
  // The mainline uci path of a single-path Line (root → children[0] chain).
  const mainPath = (l: Line): string[] => {
    const ucis: string[] = [];
    let n: MoveNode | undefined = l.tree.children[0];
    while (n) { ucis.push(n.uci); n = n.children[0]; }
    return ucis;
  };
  const repNf3 = statAt(repTree, mainPath(rep[0]));   // e4 e5 Nf3 — played 2W
  const repNc3 = statAt(repTree, mainPath(rep[2]));   // e4 e5 Nc3 — prepared, unplayed
  check(
    'repertoire tree overlays game results on played moves',
    !!repNf3 && repNf3.games === 2 && repNf3.wins === 2,
    `Nf3=${repNf3?.games}W${repNf3?.wins}`,
  );
  check(
    'repertoire tree keeps prepared-but-unplayed moves at zero',
    !!repNc3 && repNc3.games === 0 && repNc3.san === 'Nc3',
    `Nc3 present=${!!repNc3} games=${repNc3?.games}`,
  );

  return results;
}
