// DOM-free checks of the repertoire run — the mode that walks a book instead of
// replaying its shared openings once per line.
//
// The claim worth proving is the one the mode exists for: a move that six lines
// pass through is asked ONCE, and the plan can say how many repeats that saved.

import { Chess } from 'chess.js';
import type { MoveNode } from './tree';
import { emptyTree, mergePath, makeIdFactory, nodeAtPath, type MergeStep, type Repertoire } from './repertoire';
import { planRepertoireRun, runSavingNote } from './repertoire-run';

export interface TestResult { name: string; pass: boolean; detail: string }

function steps(sans: string): MergeStep[] {
  const chess = new Chess();
  return sans.split(/\s+/).filter(Boolean).map(san => {
    const m = chess.move(san);
    return { san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fen: chess.fen() };
  });
}

function book(colour: 'white' | 'black', id: string, ...lines: string[]): Repertoire {
  const rep: Repertoire = {
    id, name: id, colour, tree: emptyTree(), createdAt: 1000,
  };
  const nextId = makeIdFactory(rep.tree);
  for (const sans of lines) mergePath(rep.tree, steps(sans), nextId);
  return rep;
}

function at(rep: Repertoire, sans: string): MoveNode | null {
  return nodeAtPath(rep.tree, steps(sans).map(s => s.uci));
}

const PAST = new Date('2020-01-01T00:00:00Z');
const FUTURE = new Date('2099-01-01T00:00:00Z');
function reviewed(node: MoveNode, due: Date): void {
  node.review = { ease: 2.5, interval: 10, reps: 3, lapses: 0, due };
}

export function runRepertoireRunSelfTest(): TestResult[] {
  const out: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    out.push({ name, pass, detail });
  };

  // ── The dedupe, which is the whole point ──────────────────────────────────

  {
    // Three lines through 1.d4 d5 2.c4. As line walks that asks 1.d4 and 2.c4
    // three times each; as a run, once each.
    const rep = book('white', 'w',
      'd4 d5 c4 c5 e4', 'd4 d5 c4 e6 Nc3', 'd4 d5 c4 dxc4 e3');
    const plan = planRepertoireRun([rep], { minDepth: 1, includeAll: true, max: 99 });
    const sans = plan.positions.map(p => p.expected.san);
    check(
      'a move several lines pass through is asked once',
      sans.filter(s => s === 'd4').length === 1 && sans.filter(s => s === 'c4').length === 1,
      sans.join(' '),
    );
    // The three lines play d4/c4 in common and then e4, Nc3, e3 — five distinct
    // white moves, asked three times each as line walks.
    check(
      'and every distinct move of the user’s is still asked',
      plan.totalMoves === 5,
      `${plan.totalMoves} moves: ${sans.join(' ')}`,
    );
    check(
      'the plan says what the same material costs as line walks',
      plan.asLineWalks === 9,
      `${plan.asLineWalks} asks across the three lines`,
    );
    check(
      'so the saving is reportable',
      runSavingNote(plan) === '4 repeated moves you’d otherwise answer twice',
      runSavingNote(plan) ?? '(silent)',
    );
  }

  {
    const rep = book('white', 'w', 'e4 e5 Nf3');
    const plan = planRepertoireRun([rep], { minDepth: 1, includeAll: true });
    check(
      'a book with no shared openings reports no saving rather than zero',
      runSavingNote(plan) === null,
      runSavingNote(plan) ?? '(silent)',
    );
  }

  {
    // The saving must compare LIKE WITH LIKE. The opening plies the run skips
    // are excluded from the line-walk figure too, or the sentence would count
    // moves that are never asked at all as repeats it spared you.
    const rep = book('white', 'w',
      'd4 d5 c4 c5 e3', 'd4 d5 c4 e6 Nc3', 'd4 d5 c4 c6 Nf3');
    const plan = planRepertoireRun([rep], { includeAll: true, max: 99 });
    check(
      'the line-walk figure covers exactly the moves the run covers',
      plan.totalMoves === 4 && plan.asLineWalks === 6,
      `${plan.totalMoves} moves vs ${plan.asLineWalks} asks (1.d4 is below the floor for both)`,
    );
    check(
      'so the saving is the repeats actually removed',
      runSavingNote(plan) === '2 repeated moves you’d otherwise answer twice',
      runSavingNote(plan) ?? '(silent)',
    );
  }

  // ── Whose moves, and in what order ────────────────────────────────────────

  {
    const rep = book('white', 'w', 'e4 e5 Nf3 Nc6 Bb5');
    const plan = planRepertoireRun([rep], { minDepth: 1, includeAll: true });
    check(
      'only the user’s moves are asked',
      plan.positions.map(p => p.expected.san).join(' ') === 'e4 Nf3 Bb5',
      plan.positions.map(p => p.expected.san).join(' '),
    );
    check(
      'each is shown from the position it is played from',
      plan.positions[1].preFen === at(rep, 'e4 e5')!.fen,
      'preFen is the parent position',
    );
    check(
      'with the opponent move that led there, for the replay',
      plan.positions[1].prevUci === at(rep, 'e4 e5')!.uci
      && plan.positions[1].prevFen === at(rep, 'e4')!.fen,
      `${plan.positions[1].prevUci}`,
    );
  }

  {
    const rep = book('black', 'b', 'e4 e6 d4 d5');
    const plan = planRepertoireRun([rep], { minDepth: 1, includeAll: true });
    check(
      'in a black book the black moves are the user’s',
      plan.positions.map(p => p.expected.san).join(' ') === 'e6 d5',
      plan.positions.map(p => p.expected.san).join(' '),
    );
    check(
      'and black’s first move opens from the start position',
      plan.positions[0].prevFen === undefined || plan.positions[0].depth === 2,
      `depth ${plan.positions[0].depth}`,
    );
  }

  {
    // Depth-first: down the first line, then back up to the next branch.
    const rep = book('white', 'w', 'd4 d5 c4 c5 e4', 'd4 d5 c4 e6 Nc3', 'e4 e5 Nf3');
    const plan = planRepertoireRun([rep], { minDepth: 1, includeAll: true, max: 99 });
    check(
      'the walk goes down a line and backs up to the last branch',
      plan.positions.map(p => p.expected.san).join(' ') === 'd4 c4 e4 Nc3 e4 Nf3',
      plan.positions.map(p => p.expected.san).join(' '),
    );
  }

  // ── What it leaves out ────────────────────────────────────────────────────

  {
    const rep = book('black', 'b', 'e4 e6 d4 d5 Nc3 Bb4', 'e4 c5 Nf3 d6');
    at(rep, 'e4 e6')!.training = false;
    const plan = planRepertoireRun([rep], { minDepth: 1, includeAll: true, max: 99 });
    check(
      'a paused branch is not asked about',
      !plan.positions.some(p => ['e6', 'd5', 'Bb4'].includes(p.expected.san)),
      plan.positions.map(p => p.expected.san).join(' '),
    );
    check(
      'and it does not count towards what line walks would have cost',
      plan.asLineWalks === 2,
      `${plan.asLineWalks}`,
    );
  }

  {
    const rep = book('white', 'w', 'e4 e5 Nf3');
    rep.archived = true;
    check(
      'a book put aside is skipped entirely',
      planRepertoireRun([rep], { minDepth: 1, includeAll: true }).positions.length === 0,
      'nothing planned',
    );
  }

  {
    const rep = book('white', 'w', 'e4 e5 Nf3 Nc6 Bb5');
    const plan = planRepertoireRun([rep], { includeAll: true });
    check(
      'the opening move or two is too shared to be worth a rep',
      !plan.positions.some(p => p.depth < 3),
      plan.positions.map(p => `${p.expected.san}@${p.depth}`).join(' '),
    );
  }

  {
    const white = book('white', 'w', 'e4 e5 Nf3');
    const black = book('black', 'b', 'e4 e6 d4 d5');
    const plan = planRepertoireRun([white, black], { minDepth: 1, includeAll: true });
    check(
      'several books are walked in turn',
      plan.positions.length === 4,
      `${plan.positions.length} moves`,
    );
    const only = planRepertoireRun([white, black], { minDepth: 1, includeAll: true, repertoireId: 'b' });
    check(
      'and one book can be asked for on its own',
      only.positions.every(p => p.repertoireId === 'b') && only.positions.length === 2,
      `${only.positions.length} moves from the black book`,
    );
  }

  // ── Due, and the fallback that keeps the mode playable ────────────────────

  {
    const rep = book('white', 'w', 'd4 d5 c4 c5 e4', 'd4 d5 c4 e6 Nc3');
    reviewed(at(rep, 'd4')!, FUTURE);
    reviewed(at(rep, 'd4 d5 c4')!, FUTURE);
    reviewed(at(rep, 'd4 d5 c4 c5 e4')!, PAST);
    // Nc3 has no record at all, which counts as due.
    const plan = planRepertoireRun([rep], { minDepth: 1 });
    check(
      'only due moves are asked',
      plan.positions.map(p => p.expected.san).sort().join(' ') === 'Nc3 e4',
      plan.positions.map(p => p.expected.san).join(' '),
    );
    check(
      'and the plan reports how many were due',
      plan.dueMoves === 2 && plan.totalMoves === 4,
      `${plan.dueMoves} of ${plan.totalMoves}`,
    );
  }

  {
    const rep = book('white', 'w', 'd4 d5 c4 c5 e4');
    for (const san of ['d4', 'd4 d5 c4', 'd4 d5 c4 c5 e4']) reviewed(at(rep, san)!, FUTURE);
    const plan = planRepertoireRun([rep], { minDepth: 1 });
    check(
      'with nothing due the run still has something to do',
      plan.positions.length > 0 && plan.dueMoves === 0,
      `${plan.positions.length} moves offered, ${plan.dueMoves} due`,
    );
  }

  {
    const rep = book('white', 'w', 'd4 d5 c4 c5 e4', 'd4 d5 c4 e6 Nc3', 'e4 e5 Nf3');
    const capped = planRepertoireRun([rep], { minDepth: 1, includeAll: true, max: 3 });
    check(
      'a cap keeps the survivors in walk order rather than shuffling them',
      capped.positions.map(p => p.expected.san).join(' ') === 'd4 c4 e4',
      capped.positions.map(p => p.expected.san).join(' '),
    );
  }

  // ── Naming and spacing come from the branch, not from a random line ───────

  {
    const rep = book('white', 'w', 'd4 d5 c4 c5 e4', 'd4 d5 c4 e6 Nc3');
    at(rep, 'd4')!.priority = 'high';
    at(rep, 'd4 d5 c4 e6')!.priority = 'low';
    const plan = planRepertoireRun([rep], { minDepth: 1, includeAll: true, max: 99 });
    const byMove = new Map(plan.positions.map(p => [p.expected.san, p.priority]));
    check(
      'each move takes the priority resolved at its own node',
      byMove.get('d4') === 'high' && byMove.get('Nc3') === 'low' && byMove.get('e4') === 'high',
      [...byMove].map(([s, p]) => `${s}:${p}`).join(' '),
    );
  }

  {
    const rep = book('white', 'w', 'e4 e5 Nf3 Nc6 Bb5');
    at(rep, 'e4')!.label = 'My e4';
    const plan = planRepertoireRun([rep], { minDepth: 1, includeAll: true });
    check(
      'every asked move knows a line it belongs to, by name',
      plan.positions.every(p => p.lineName === 'My e4' && !!p.lineId),
      plan.positions.map(p => p.lineName).join(' | '),
    );
  }

  {
    check(
      'an empty set of books plans nothing rather than throwing',
      planRepertoireRun([]).positions.length === 0,
      'empty',
    );
  }

  return out;
}
