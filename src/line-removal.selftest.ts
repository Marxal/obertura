// DOM-free checks of what a removal PROMISES before it happens, and of the
// detach/reattach pair an Undo is built on.
//
// The promises are the point. A remove button is only as trustworthy as the
// sentence above it, so these check the numbers the confirm quotes against the
// tree it is quoting them from — how many moves go, how many lines go with
// them, and the one that matters most: whether the line survives, shorter, or
// disappears.

import { Chess } from 'chess.js';
import type { MoveNode } from './tree';
import {
  detachSubtree, emptyTree, findNode, lineEnds, makeIdFactory, mergePath, moveCount,
  nodeAtPath, reattachSubtree, removeSubtree, type MergeStep, type Repertoire,
} from './repertoire';
import { describeRemoval, removalBody, removalTitle } from './line-removal';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

function steps(sans: string): MergeStep[] {
  const chess = new Chess();
  return sans.split(/\s+/).filter(Boolean).map(san => {
    const m = chess.move(san);
    return { san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fen: chess.fen() };
  });
}

function book(...lines: string[]): Repertoire {
  const rep: Repertoire = {
    id: 'rep-white', name: 'My White lines', colour: 'white',
    tree: emptyTree(), createdAt: 1000,
  };
  const nextId = makeIdFactory(rep.tree);
  for (const sans of lines) mergePath(rep.tree, steps(sans), nextId);
  return rep;
}

function at(rep: Repertoire, sans: string): MoveNode {
  const node = nodeAtPath(rep.tree, steps(sans).map(s => s.uci));
  if (!node) throw new Error(`no node at ${sans}`);
  return node;
}

export function runLineRemovalSelfTest(): TestResult[] {
  const out: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    out.push({ name, pass, detail });
  };

  // ── The trim: one line, and it survives one move shorter ───────────────────

  {
    const rep = book('e4 c5 Nf3 d6');
    const impact = describeRemoval(rep, at(rep, 'e4 c5 Nf3 d6').id);
    check('a leaf removal takes exactly one move', impact?.moves === 1, `${impact?.moves}`);
    check('and ends exactly one line', impact?.lines === 1, `${impact?.lines}`);
    check(
      'the confirm names the move it is about to take',
      impact?.move === '2…d6', `${impact?.move}`,
    );
    // Figurine notation is the default, and these strings are what the user
    // actually reads — so the checks quote them exactly as they will appear.
    check(
      'a trim says where the line will now end',
      impact?.endsAt === '1.e4 c5 2.♞f3', `${impact?.endsAt}`,
    );
    check('a one-line trim needs no confirm', impact?.small === true, `${impact?.small}`);
    check(
      'and the body says so in words',
      !!impact && removalBody(impact, 'My White lines').includes('will end at 1.e4 c5 2.♞f3'),
      impact ? removalBody(impact, 'My White lines') : '',
    );
  }

  // ── The cut: several lines go, and the shared prefix stays ─────────────────

  {
    const rep = book('e4 c5 Nf3 d6', 'e4 c5 Nf3 Nc6', 'e4 e5 Nf3');
    const impact = describeRemoval(rep, at(rep, 'e4 c5').id);
    check('a branch removal counts the whole subtree', impact?.moves === 4, `${impact?.moves}`);
    check('and every line under it', impact?.lines === 2, `${impact?.lines}`);
    check(
      'a multi-line cut is never silent',
      impact?.small === false, `${impact?.small}`,
    );
    check(
      'no line ends above a branch point that keeps other answers',
      impact?.endsAt === null, `${impact?.endsAt}`,
    );
    check(
      'the body promises the moves before it stay',
      !!impact && removalBody(impact, 'My White lines').includes('leading up to it stay'),
      impact ? removalBody(impact, 'My White lines') : '',
    );
    check(
      'the body names the lines that go',
      !!impact && impact.names.length === 2 && impact.more === 0,
      `${impact?.names.join(' | ')} (+${impact?.more})`,
    );
  }

  // Removing a first move takes a whole opening out of the book — there is
  // nothing before it to keep, and the copy must not claim otherwise.
  {
    const rep = book('e4 c5', 'd4 d5');
    const impact = describeRemoval(rep, at(rep, 'e4').id);
    check('a first move is flagged as a whole opening', impact?.wholeOpening === true, `${impact?.wholeOpening}`);
    check(
      'and is never described as leaving earlier moves behind',
      !!impact && !removalBody(impact, 'My White lines').includes('leading up to it stay'),
      impact ? removalBody(impact, 'My White lines') : '',
    );
    check('the title quotes the move', !!impact && removalTitle(impact) === 'Remove 1.e4?', `${impact && removalTitle(impact)}`);
  }

  // Only the first few lines are named; the rest are counted.
  {
    const rep = book('e4 c5 Nf3 d6', 'e4 c5 Nf3 Nc6', 'e4 c5 Nf3 e6', 'e4 c5 Nf3 g6');
    const impact = describeRemoval(rep, at(rep, 'e4 c5 Nf3').id);
    check('every line under the cut is counted', impact?.lines === 4, `${impact?.lines}`);
    check('but only the first few are named', impact?.names.length === 3, `${impact?.names.length}`);
    check('and the remainder is quoted', impact?.more === 1, `${impact?.more}`);
  }

  // A node that isn't in the book (a draft move, or one already gone) has no
  // story to tell, and must say so rather than inventing one.
  {
    const rep = book('e4 c5');
    check('an unknown node describes nothing', describeRemoval(rep, 'nope') === null);
    check('and neither does the root', describeRemoval(rep, rep.tree.id) === null);
  }

  // ── Detach / reattach: the undo ────────────────────────────────────────────

  {
    const rep = book('e4 c5 Nf3 d6', 'e4 e5');
    const node = at(rep, 'e4 c5');
    node.children[0].note = 'the Open Sicilian';
    const before = moveCount(rep.tree);
    const cut = detachSubtree(rep.tree, node.id);
    check('the cut reports what it took', cut?.moves === 3, `${cut?.moves}`);
    check('the tree really lost them', moveCount(rep.tree) === before - 3, `${moveCount(rep.tree)}`);
    check('the sibling line is untouched', !!nodeAtPath(rep.tree, steps('e4 e5').map(s => s.uci)));

    check('reattaching puts it back', !!cut && reattachSubtree(rep.tree, cut));
    check('with every move', moveCount(rep.tree) === before, `${moveCount(rep.tree)}`);
    check(
      'and with the work that was on them',
      at(rep, 'e4 c5 Nf3').note === 'the Open Sicilian',
      `${at(rep, 'e4 c5 Nf3').note}`,
    );
    check(
      'in its original place among its siblings',
      rep.tree.children[0].children[0].uci === steps('e4 c5')[1].uci,
      rep.tree.children[0].children.map(c => c.san).join(','),
    );
    check('and never twice', !!cut && !reattachSubtree(rep.tree, cut));
  }

  // An undo that arrives after the parent has gone must fail rather than
  // resurrect an orphan somewhere unexpected.
  {
    const rep = book('e4 c5 Nf3');
    const cut = detachSubtree(rep.tree, at(rep, 'e4 c5 Nf3').id);
    removeSubtree(rep.tree, at(rep, 'e4').id);
    check('an undo whose parent is gone is refused', !!cut && !reattachSubtree(rep.tree, cut));
    check('and leaves the tree alone', moveCount(rep.tree) === 0, `${moveCount(rep.tree)}`);
  }

  // removeSubtree still answers what it always did, now that detach does the work.
  {
    const rep = book('e4 c5 Nf3 d6');
    check('removeSubtree still counts the moves it took', removeSubtree(rep.tree, at(rep, 'e4 c5').id) === 3);
    check('and a miss still counts nothing', removeSubtree(rep.tree, 'nope') === 0);
    check('the book is left with one line', lineEnds(rep.tree).length === 1, `${lineEnds(rep.tree).length}`);
    check('and the root survives', !!findNode(rep.tree, rep.tree.id));
  }

  return out;
}
