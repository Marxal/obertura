// DOM-free checks of the repertoire tree — the model the redesign moved to.
//
// The claims worth proving here are the ones the old flat-line model could not
// make: the same moves are stored once however many lines run through them,
// inherited properties resolve from the nearest ancestor, and "delete this line"
// cuts exactly the moves that belong to it alone.
//
// Real chess.js positions throughout: a hand-written FEN would prove nothing
// about the merge, which matches on UCI and hands FENs to everything downstream.

import { Chess } from 'chess.js';
import type { MoveNode } from './tree';
import {
  START_FEN, emptyTree, mergePath, makeIdFactory, moveCount, linePaths, lineEnds,
  isLineEnd, resolveTraining, resolvePriority, resolveTags, resolveLabel,
  removeSubtree, lineTailStart, lineTailSize, pathToNode, parentOf, nodeAtPath,
  walkPath, isUserMoveAtDepth, userMovesOnPath, findNode, type MergeStep,
} from './repertoire';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

// A path of merge steps from SAN, with real FENs.
function steps(sans: string): MergeStep[] {
  const chess = new Chess();
  return sans.split(/\s+/).filter(Boolean).map(san => {
    const m = chess.move(san);
    return { san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fen: chess.fen() };
  });
}

/** Build a tree from several lines of SAN, in order. */
function tree(...lines: string[]): MoveNode {
  const root = emptyTree();
  const nextId = makeIdFactory(root);
  for (const sans of lines) mergePath(root, steps(sans), nextId);
  return root;
}

/** The node a SAN path arrives at. */
function at(root: MoveNode, sans: string): MoveNode | null {
  return nodeAtPath(root, steps(sans).map(s => s.uci));
}

export function runRepertoireSelfTest(): TestResult[] {
  const out: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    out.push({ name, pass, detail });
  };

  // ── The merge stores shared moves once ─────────────────────────────────────

  {
    const root = tree('d4 d5 c4 c5', 'd4 d5 c4 c5 e4 e5');
    check(
      'extending a line adds only the new moves',
      moveCount(root) === 6,
      `${moveCount(root)} moves stored (want 6)`,
    );
    check(
      'the extended line is ONE line, not two',
      linePaths(root).length === 1,
      `${linePaths(root).length} line(s)`,
    );
  }

  {
    const root = tree('d4 d5 c4 c5', 'd4 d5 c4 e6');
    check(
      'a second answer branches instead of duplicating the opening',
      moveCount(root) === 5,
      `${moveCount(root)} moves stored (want 5: d4 d5 c4 + two replies)`,
    );
    check(
      'two answers make two lines',
      linePaths(root).length === 2,
      `${linePaths(root).length} line(s)`,
    );
    const shared = at(root, 'd4 d5 c4');
    check(
      'the shared prefix is a single node with two children',
      !!shared && shared.children.length === 2,
      `${shared?.children.length ?? 0} children under 1.d4 d5 2.c4`,
    );
  }

  {
    const root = tree('e4 e5 Nf3');
    const before = moveCount(root);
    mergePath(root, steps('e4 e5 Nf3'), makeIdFactory(root));
    check(
      'saving a line you already have changes nothing',
      moveCount(root) === before,
      `${before} → ${moveCount(root)} moves`,
    );
  }

  {
    const root = emptyTree();
    const first = mergePath(root, steps('e4 e5'), makeIdFactory(root));
    const again = mergePath(root, steps('e4 e5 Nf3'), makeIdFactory(root));
    check(
      'merging reports only the moves it actually created',
      first.added.length === 2 && again.added.length === 1,
      `${first.added.length} then ${again.added.length}`,
    );
    check(
      'an existing move keeps its identity when walked onto again',
      again.added[0]?.san === 'Nf3' && first.end.id !== again.end.id,
      'the shared nodes were reused',
    );
  }

  {
    const root = tree('e4 e5');
    const e4 = at(root, 'e4')!;
    e4.review = { ease: 2.5, interval: 6, reps: 2, lapses: 0, due: new Date(0) };
    e4.note = 'the point of the whole thing';
    mergePath(root, steps('e4 e5 Nf3 Nc6'), makeIdFactory(root));
    check(
      'merging through a move never disturbs its review record or note',
      e4.review?.interval === 6 && e4.note === 'the point of the whole thing',
      `interval ${e4.review?.interval}, note ${e4.note ? 'kept' : 'LOST'}`,
    );
  }

  // ── Line ends ──────────────────────────────────────────────────────────────

  {
    const root = tree('d4 d5 c4 c5', 'd4 d5 c4 e6', 'd4 Nf6');
    check('every leaf is a line', lineEnds(root).length === 3, `${lineEnds(root).length} ends`);
    check(
      'line paths run from the first move to the end',
      linePaths(root).every(p => p[0].san === 'd4'),
      'all start at 1.d4',
    );
    check(
      'a repertoire with no moves has no lines at all',
      linePaths(emptyTree()).length === 0,
      'empty tree yields zero lines',
    );
  }

  {
    const root = tree('e4 e5 Nf3 Nc6 Bb5');
    const mid = at(root, 'e4 e5 Nf3')!;
    check('a node with children is not a line end by default', !isLineEnd(mid), 'not an end');
    mid.endpoint = true;
    check('marking a node makes it a line end as well', isLineEnd(mid), 'marked');
    check(
      'a marked node yields its own line AND keeps the longer one',
      linePaths(root).length === 2,
      `${linePaths(root).length} line(s)`,
    );
  }

  // ── Inheritance: the rule that makes a big book manageable ─────────────────

  {
    const root = tree('e4 e6 d4 d5 Nc3 Bb4', 'e4 e6 d4 d5 Nd2 Nf6');
    const french = at(root, 'e4 e6')!;
    french.training = false;
    french.tags = ['French'];
    french.priority = 'low';

    const paths = linePaths(root);
    check(
      'pausing a branch pauses every line under it',
      paths.every(p => resolveTraining(p) === false),
      `${paths.filter(p => !resolveTraining(p)).length} of ${paths.length} paused`,
    );
    check(
      'a branch tag reaches every line below it',
      paths.every(p => resolveTags(p).includes('French')),
      'all tagged French',
    );
    check(
      'priority is inherited too',
      paths.every(p => resolvePriority(p) === 'low'),
      'all low priority',
    );

    // …and a deeper node overrides it.
    const winawer = at(root, 'e4 e6 d4 d5 Nc3 Bb4')!;
    winawer.training = true;
    const winawerPath = pathToNode(root, winawer.id)!;
    const otherPath = paths.find(p => p[p.length - 1] !== winawer)!;
    check(
      'the deepest explicit answer wins',
      resolveTraining(winawerPath) === true && resolveTraining(otherPath) === false,
      'one line re-enabled inside a paused branch',
    );
  }

  {
    const root = tree('d4 Nf6 c4 e6');
    const d4 = at(root, 'd4')!;
    const c4 = at(root, 'd4 Nf6 c4')!;
    d4.tags = ['Queen’s pawn'];
    c4.tags = ['Queen’s Gambit'];
    const path = linePaths(root)[0];
    check(
      'tags accumulate down the path rather than overriding',
      resolveTags(path).length === 2 && resolveTags(path)[0] === 'Queen’s pawn',
      resolveTags(path).join(' + '),
    );
    d4.tags = ['queens gambit', 'Queen’s Gambit'];
    c4.tags = ['QUEEN’S GAMBIT'];
    check(
      'a tag repeated at several depths is counted once',
      resolveTags(linePaths(root)[0]).length === 2,
      resolveTags(linePaths(root)[0]).join(' + '),
    );
  }

  {
    const root = tree('e4 c5 Nf3 d6 d4');
    at(root, 'e4 c5')!.label = 'Sicilian';
    at(root, 'e4 c5 Nf3 d6')!.label = 'Najdorf-ish';
    check(
      'the deepest pinned name is the line’s name',
      resolveLabel(linePaths(root)[0]) === 'Najdorf-ish',
      resolveLabel(linePaths(root)[0]) ?? '(none)',
    );
    check(
      'an unnamed branch inherits nothing and says so',
      resolveLabel([]) === null,
      'no label resolves to null',
    );
  }

  {
    const root = tree('e4 e5');
    check(
      'training defaults to on for a line nobody has touched',
      resolveTraining(linePaths(root)[0]) === true,
      'default is on',
    );
    check(
      'priority defaults to unset (the scheduler reads that as standard)',
      resolvePriority(linePaths(root)[0]) === undefined,
      'undefined',
    );
  }

  // ── Deleting: cutting only what belongs to this line ───────────────────────

  {
    const root = tree('d4 d5 c4 c5', 'd4 d5 c4 e6');
    const end = at(root, 'd4 d5 c4 c5')!;
    const cut = lineTailStart(root, end.id)!;
    check(
      'delete-this-line cuts at the move that made it its own line',
      cut.san === 'c5',
      `cut at ${cut.san}`,
    );
    check(
      'and reports the size honestly before doing it',
      lineTailSize(root, end.id) === 1,
      `${lineTailSize(root, end.id)} move(s)`,
    );
    removeSubtree(root, cut.id);
    check(
      'the moves shared with the neighbour survive',
      moveCount(root) === 4 && !!at(root, 'd4 d5 c4 e6'),
      `${moveCount(root)} moves left, sibling ${at(root, 'd4 d5 c4 e6') ? 'intact' : 'GONE'}`,
    );
  }

  {
    const root = tree('e4 e5 Nf3 Nc6 Bb5 a6');
    const end = at(root, 'e4 e5 Nf3 Nc6 Bb5 a6')!;
    check(
      'a line sharing nothing is cut at its first move',
      lineTailStart(root, end.id)?.san === 'e4',
      lineTailStart(root, end.id)?.san ?? '(none)',
    );
    check(
      'and takes the whole book with it, which is the truth',
      lineTailSize(root, end.id) === 6,
      `${lineTailSize(root, end.id)} moves`,
    );
  }

  {
    const root = tree('d4 d5 c4 c5 e4', 'd4 Nf6');
    const c4 = at(root, 'd4 d5 c4')!;
    c4.endpoint = true;
    const deepEnd = at(root, 'd4 d5 c4 c5 e4')!;
    check(
      'a cut stops at a node that is a line in its own right',
      lineTailStart(root, deepEnd.id)?.san === 'c5',
      lineTailStart(root, deepEnd.id)?.san ?? '(none)',
    );
  }

  {
    const root = tree('d4 d5 c4 c5 e4 e5');
    const removed = removeSubtree(root, at(root, 'd4 d5 c4')!.id);
    check(
      'removing a node counts everything under it',
      removed === 4 && moveCount(root) === 2,
      `${removed} removed, ${moveCount(root)} left`,
    );
    check(
      'removing something that isn’t there is a no-op, not a crash',
      removeSubtree(root, 'no-such-node') === 0,
      'returned 0',
    );
  }

  // ── Navigation helpers ─────────────────────────────────────────────────────

  {
    const root = tree('e4 e5 Nf3');
    const nf3 = at(root, 'e4 e5 Nf3')!;
    check(
      'pathToNode excludes the root and runs in move order',
      pathToNode(root, nf3.id)?.map(n => n.san).join(' ') === 'e4 e5 Nf3',
      pathToNode(root, nf3.id)?.map(n => n.san).join(' ') ?? '(null)',
    );
    check(
      'the root’s own path is empty, and a stranger’s is null',
      pathToNode(root, 'root')?.length === 0 && pathToNode(root, 'nope') === null,
      'empty vs null are different answers',
    );
    check(
      'parentOf walks back up',
      parentOf(root, nf3.id)?.san === 'e5' && parentOf(root, 'root') === null,
      `${parentOf(root, nf3.id)?.san ?? '(none)'}`,
    );
    check(
      'findNode reaches the root as well as the moves',
      findNode(root, 'root') === root && findNode(root, nf3.id) === nf3,
      'both found',
    );
    check(
      'walkPath stops where the book stops',
      walkPath(root, steps('e4 e5 Nf3 Nc6').map(s => s.uci)).length === 3,
      'walked 3 of 4',
    );
    check(
      'nodeAtPath refuses a path the book doesn’t prepare',
      nodeAtPath(root, steps('e4 e5 Nf3 Nc6').map(s => s.uci)) === null,
      'null for an unprepared path',
    );
    check(
      'the root is what an empty path arrives at',
      nodeAtPath(root, []) === root,
      'root',
    );
  }

  // ── Parity: whose move is it? ──────────────────────────────────────────────

  {
    check(
      'white plays the odd depths, black the even ones',
      isUserMoveAtDepth(1, 'white') && !isUserMoveAtDepth(2, 'white') &&
      !isUserMoveAtDepth(1, 'black') && isUserMoveAtDepth(2, 'black'),
      'matches the scheduler’s rule',
    );
    const root = tree('e4 e5 Nf3 Nc6');
    const path = linePaths(root)[0];
    check(
      'user moves on a white path are the white moves',
      userMovesOnPath(path, 'white').map(n => n.san).join(' ') === 'e4 Nf3',
      userMovesOnPath(path, 'white').map(n => n.san).join(' '),
    );
    check(
      'and on a black path, the black ones',
      userMovesOnPath(path, 'black').map(n => n.san).join(' ') === 'e5 Nc6',
      userMovesOnPath(path, 'black').map(n => n.san).join(' '),
    );
  }

  // ── Ids ────────────────────────────────────────────────────────────────────

  {
    const root = tree('e4 e5', 'd4 d5');
    const ids = new Set<string>();
    const walk = (n: MoveNode): void => { ids.add(n.id); n.children.forEach(walk); };
    walk(root);
    check(
      'every node in a book has a distinct id',
      ids.size === moveCount(root) + 1,
      `${ids.size} ids for ${moveCount(root) + 1} nodes`,
    );

    // A factory made from a loaded tree must not re-issue an id already in it.
    const nextId = makeIdFactory(root);
    check(
      'a fresh id factory never collides with the ids already in the tree',
      !ids.has(nextId()) && !ids.has(nextId()),
      'seeded past the highest existing id',
    );
  }

  {
    const root = emptyTree();
    check(
      'a new book starts at the standard position with no moves',
      root.fen === START_FEN && moveCount(root) === 0,
      `${moveCount(root)} moves`,
    );
  }

  return out;
}
