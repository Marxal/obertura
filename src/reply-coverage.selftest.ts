// The coverage number has one promise that matters: saving can only raise it.

import { Chess } from 'chess.js';
import type { MoveNode } from './tree';
import { coveragePct, COVERAGE_MOVES } from './reply-coverage';
import { mergePath } from './repertoire';
import { positionKey } from './position-index';
import type { MoveCounts, MoveStats, StatsAt } from './rare-branch';

export interface TestResult { name: string; pass: boolean; detail?: string }

const START = new Chess().fen();

function emptyTree(): MoveNode {
  return { id: 'root', san: '', uci: '', fen: START, children: [] } as unknown as MoveNode;
}

function add(tree: MoveNode, sans: string[]): void {
  const chess = new Chess();
  const steps = sans.map((san) => {
    const m = chess.move(san);
    return { san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fen: chess.fen() };
  });
  let n = 0;
  mergePath(tree, steps, () => `n${Date.now()}${n++}${sans.join('')}`);
}

function fenAfter(sans: string[]): string {
  const chess = new Chess();
  for (const san of sans) chess.move(san);
  return chess.fen();
}

function statsFrom(table: Array<[string[], Array<[string, number]>]>): StatsAt {
  const byKey = new Map<string, MoveStats>();
  for (const [sans, moves] of table) {
    const chess = new Chess(fenAfter(sans));
    const map: MoveStats = new Map<string, MoveCounts>();
    for (const [san, games] of moves) {
      const m = new Chess(chess.fen()).move(san);
      map.set(m.from + m.to + (m.promotion ?? ''), { white: games, draws: 0, black: 0 });
    }
    byKey.set(positionKey(chess.fen()), map);
  }
  return (fen) => byKey.get(positionKey(fen)) ?? null;
}

export function runReplyCoverageSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail?: string): void => {
    results.push({ name, pass, detail });
  };
  const noStats: StatsAt = () => null;

  check('no lines of this colour, no number', coveragePct([emptyTree()], 'white', noStats) === null);

  // After 1.e4: e5 is played 60%, c5 40%.
  const stats = statsFrom([
    [['e4'], [['e5', 60], ['c5', 40]]],
    [['e4', 'e5', 'Nf3'], [['Nc6', 100]]],
    [['e4', 'c5', 'Nf3'], [['d6', 100]]],
  ]);

  const one = emptyTree();
  add(one, ['e4', 'e5', 'Nf3']);
  const a = coveragePct([one], 'white', stats)!;
  // 60% answer the first move, and then the line ends: 0.6 × 1/6.
  check('one answered reply counts its share of one move in six', a === 10, String(a));

  add(one, ['e4', 'c5', 'Nf3']);
  const b = coveragePct([one], 'white', stats)!;
  check('filling a hole raises it', b > a && b === 17, `${a} → ${b}`);

  add(one, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  const c = coveragePct([one], 'white', stats)!;
  check('going deeper raises it', c > b, `${b} → ${c}`);

  // A second answer you never need shouldn't cost anything.
  add(one, ['d4', 'd5', 'c4']);
  const d = coveragePct([one], 'white', stats)!;
  check('adding another first move can’t lower it', d >= c, `${c} → ${d}`);

  // A hole in the database: partial credit, not nothing and not everything.
  const hole = emptyTree();
  add(hole, ['e4', 'c6', 'd4']);
  const h = coveragePct([hole], 'white', noStats)!;
  check('an unknown position gets some credit, but not all', h > 0 && h < 50, String(h));

  // The promise: a new reply in a hole can't lower the number, however shallow it is.
  const deepThenShallow = emptyTree();
  add(deepThenShallow, ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'Be2', 'c5', 'O-O']);
  const beforeShallow = coveragePct([deepThenShallow], 'white', noStats)!;
  add(deepThenShallow, ['e4', 'c6', 'd4', 'g6', 'Nc3']);
  const afterShallow = coveragePct([deepThenShallow], 'white', noStats)!;
  check('a short new reply in a hole can’t lower it', afterShallow >= beforeShallow,
    `${beforeShallow} → ${afterShallow}`);

  // Transposition: reached by another move order, the answer still counts.
  const transposed = emptyTree();
  add(transposed, ['d4', 'Nf6', 'c4', 'e6', 'Nc3']);
  add(transposed, ['c4', 'e6', 'd4', 'Nf6', 'Nc3']);
  const t = coveragePct([transposed], 'white', noStats)!;
  check('transposing lines still work out', t > 0, String(t));

  // Black starts on their move, and a full book reaches 100.
  const full = emptyTree();
  const line: string[] = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5'];
  add(full, line);
  const fullStats = statsFrom(line.flatMap((san, i): Array<[string[], Array<[string, number]>]> =>
    (i % 2 === 0 ? [[line.slice(0, i), [[san, 100]]]] : [])));
  check(`every one of ${COVERAGE_MOVES} moves answered is 100`,
    coveragePct([full], 'black', fullStats) === 100, String(coveragePct([full], 'black', fullStats)));

  return results;
}
