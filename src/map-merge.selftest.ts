// DOM-free checks of the map merge — above all the loop guards the POSITION
// merge needs and the path merge never did. Real chess.js FENs throughout: the
// whole claim is that two move orders land on the same position key, and a
// hand-written FEN would prove nothing about that.

import { Chess } from 'chess.js';
import type { Line } from './types';
import type { MoveNode } from './tree';
import {
  buildMergedTree, pruneCycles, allNodes, START_FEN, MAX_MAP_PLIES,
  type MapNode,
} from './map-merge';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

let nodeSeq = 0;

// A saved line, exactly the single-path shape the builder writes.
function line(id: string, colour: 'white' | 'black', sans: string): Line {
  const chess = new Chess();
  const root: MoveNode = { id: `${id}-root`, san: '', uci: '', fen: START_FEN, children: [] };
  let cursor = root;
  for (const san of sans.split(/\s+/).filter(Boolean)) {
    const m = chess.move(san);
    const node: MoveNode = {
      id: `n${++nodeSeq}`,
      san: m.san,
      uci: m.from + m.to + (m.promotion ?? ''),
      fen: chess.fen(),
      children: [],
    };
    cursor.children.push(node);
    cursor = node;
  }
  return {
    id, name: id, tags: [], colour,
    openingName: null, confidence: 0, lastTrained: null,
    inTraining: true, tree: root,
  };
}

// Follow the spanning tree by SAN, or null if that road isn't in the map.
function at(root: MapNode, sans: string): MapNode | null {
  let cur: MapNode | null = root;
  for (const san of sans.split(/\s+/).filter(Boolean)) {
    cur = cur ? cur.children.find(c => c.san === san) ?? null : null;
    if (!cur) return null;
  }
  return cur;
}

// Is the spanning tree really a tree? One parent per node, no node reachable
// twice, depth strictly increasing. Returns a complaint or ''.
function treeComplaint(root: MapNode): string {
  const seen = new Set<MapNode>();
  const stack: MapNode[] = [root];
  let steps = 0;
  while (stack.length) {
    if (++steps > 100000) return 'walk did not terminate';
    const n = stack.pop()!;
    if (seen.has(n)) return `node ${n.san || 'root'} reachable twice`;
    seen.add(n);
    for (const c of n.children) {
      if (c.parent !== n) return `child ${c.san} has a different parent`;
      if (c.depth <= n.depth) return `child ${c.san} does not go deeper`;
      stack.push(c);
    }
  }
  return '';
}

export function runMapMergeSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  // ── Path merge is unchanged: two move orders stay two branches ──────────────
  {
    const lines = [
      line('a', 'white', 'd4 Nf6 c4 e6 Nc3'),
      line('b', 'white', 'c4 Nf6 d4 e6 Nc3'),
    ];
    const root = buildMergedTree(lines, Infinity, 'path', 'white');
    check('path: two move orders are two first moves',
      root.children.length === 2, `${root.children.length} first moves`);
    check('path: no node is shared',
      allNodes(root).every(n => n.altIn === 0), 'alt routes recorded in path mode');
  }

  // ── Position merge: a real transposition becomes ONE node ───────────────────
  {
    // 1.d4 Nf6 2.c4 e6 3.Nc3 and 1.c4 Nf6 2.d4 e6 3.Nc3 reach the same position.
    const lines = [
      line('a', 'white', 'd4 Nf6 c4 e6 Nc3 Bb4'),
      line('b', 'white', 'c4 Nf6 d4 e6 Nc3 d5'),
    ];
    const root = buildMergedTree(lines, Infinity, 'position', 'white');
    check('position: still two first moves',
      root.children.length === 2, `${root.children.length} first moves`);

    // The two roads meet as soon as the position coincides — after 1.d4 Nf6 2.c4
    // / 1.c4 Nf6 2.d4 — not where the move lists happen to look alike.
    const meet = at(root, 'd4 Nf6 c4');
    check('position: the transposition is one node',
      !!meet && meet.lineIds.length === 2,
      meet ? `lineIds=${meet.lineIds.join(',')}` : 'node missing');
    check('position: the second route is recorded as an alt edge',
      !!meet && meet.altIn === 1, meet ? `altIn=${meet.altIn}` : 'node missing');
    // The second line joins from ITS 1...Nf6, by a different move (2.d4).
    const viaB = at(root, 'c4 Nf6');
    check('position: the joining node carries the alt edge out',
      !!viaB && viaB.altOut.length === 1 && viaB.altOut[0].to === meet,
      viaB ? `altOut=${viaB.altOut.length}` : 'node missing');
    check('position: the alt route keeps its own move',
      viaB?.altOut[0]?.san === 'd4', `san=${viaB?.altOut[0]?.san}`);
    check('position: the alt edge is a forward join, not a repetition',
      !!viaB && viaB.altOut[0]?.back === false, 'marked as a back edge');
    // Past the merge the two lines continue ONCE, then part where they really do.
    const shared = at(root, 'd4 Nf6 c4 e6 Nc3');
    check('position: the merged node continues once',
      !!shared && shared.lineIds.length === 2 && shared.children.length === 2,
      shared ? `lineIds=${shared.lineIds.length}, children=${shared.children.length}` : 'node missing');
    check('position: the second line has no branch of its own',
      at(root, 'c4 Nf6 d4') === null, 'the second road was drawn twice');
    check('position: the merged map is still a walkable tree',
      treeComplaint(root) === '', treeComplaint(root));
  }

  // ── The loop: a repetition returns to a position already on the map ─────────
  {
    // 1.Nf3 Nf6 2.Ng1 Ng8 is the start position again — same board, same side to
    // move, same castling rights, same en passant. A naive position merge links
    // the start node back under itself and every later walk recurses forever.
    const lines = [line('rep', 'white', 'Nf3 Nf6 Ng1 Ng8 d4 d5')];
    const root = buildMergedTree(lines, Infinity, 'position', 'white');
    check('repetition: the map is finite',
      treeComplaint(root) === '', treeComplaint(root));
    check('repetition: the repeat is an alt edge, not a child',
      at(root, 'Nf3 Nf6 Ng1')?.altOut.some(e => e.to === root && e.back) === true,
      'the return to the start was not recorded as a back edge');
    check('repetition: the start position is not its own descendant',
      root.children.every(c => c !== root), 'root is a child of itself');
    // The continuation after the repetition attaches to the position it belongs
    // to — the start — rather than being dropped.
    check('repetition: the continuation is kept',
      !!at(root, 'd4 d5'), '1.d4 d5 was lost after the repetition');
    check('repetition: the whole line is still one line on every node',
      allNodes(root).every(n => n === root || n.lineIds.includes('rep')),
      'a node lost its line');
  }

  // ── The loop, harder: two lines crossing over each other ───────────────────
  {
    // Line A reaches the Nf3/Nf6 position the plain way. Line B gets there via a
    // knight shuffle, so it arrives at positions A already holds, at a DIFFERENT
    // depth, in both directions.
    const lines = [
      line('a', 'white', 'Nf3 Nf6 d4 d5 c4 e6'),
      line('b', 'white', 'd4 Nf6 Nf3 d5 c4 e6'),
      line('c', 'white', 'Nf3 d5 d4 Nf6 c4 e6'),
    ];
    const root = buildMergedTree(lines, Infinity, 'position', 'white');
    check('cross-over: the map is finite',
      treeComplaint(root) === '', treeComplaint(root));
    const shared = at(root, 'Nf3 Nf6 d4 d5 c4 e6');
    check('cross-over: all three lines meet on one node',
      !!shared && shared.lineIds.length === 3,
      shared ? `lineIds=${shared.lineIds.join(',')}` : 'node missing');
    check('cross-over: nothing had to be severed',
      pruneCycles(root) === 0, 'pruneCycles severed a child edge');
  }

  // ── More than one answer ───────────────────────────────────────────────────
  {
    const lines = [
      line('a', 'white', 'e4 e5 Nf3'),
      line('b', 'white', 'e4 e5 Bc4'),
      line('c', 'white', 'e4 c5 Nf3'),
    ];
    const root = buildMergedTree(lines, Infinity, 'position', 'white');
    const e5 = at(root, 'e4 e5');
    check('answers: two answers to 1...e5 are marked',
      e5?.answers === 2, `answers=${e5?.answers}`);
    const e4 = at(root, 'e4');
    check('answers: an opponent fork is not an answer',
      e4?.answers === 0, `answers=${e4?.answers}`);
    check('answers: the start position counts my one first move',
      root.answers === 1, `answers=${root.answers}`);
    // Black's book: the same map, judged from the other seat.
    const black = buildMergedTree(lines, Infinity, 'position', 'black');
    check('answers: colour decides whose choice it is',
      at(black, 'e4')?.answers === 2 && at(black, 'e4 e5')?.answers === 0,
      `e4=${at(black, 'e4')?.answers}, e4 e5=${at(black, 'e4 e5')?.answers}`);
  }

  // ── An answer reached only by an alt route still counts ────────────────────
  {
    // From 1.d4 Nf6 2.c4 e6 the user has two answers, 3.Nc3 and 3.Nf3 — but the
    // position after 3.Nf3 already exists on the map (line b got there by
    // 1.Nf3 Nf6 2.c4 e6 3.d4), so that second answer leaves as an ALT edge and
    // never appears among the node's children. It still has to count.
    const lines = [
      line('a', 'white', 'd4 Nf6 c4 e6 Nc3'),
      line('b', 'white', 'Nf3 Nf6 c4 e6 d4'),
      line('c', 'white', 'd4 Nf6 c4 e6 Nf3'),
    ];
    const root = buildMergedTree(lines, Infinity, 'position', 'white');
    const shared = at(root, 'd4 Nf6 c4 e6');
    check('answers: the second answer leaves as an alt edge',
      shared?.children.length === 1 && shared?.altOut.length === 1,
      `children=${shared?.children.length}, altOut=${shared?.altOut.length}`);
    check('answers: an alt route out counts towards the answers',
      shared?.answers === 2, `answers=${shared?.answers}`);
  }

  // ── Depth cap ──────────────────────────────────────────────────────────────
  {
    const long = Array.from({ length: 60 }, () => 'Nf3 Nf6 Ng1 Ng8').join(' ');
    const root = buildMergedTree([line('long', 'white', long)], Infinity, 'position', 'white');
    const deepest = allNodes(root).reduce((m, n) => Math.max(m, n.depth), 0);
    check('depth: the map is capped',
      deepest <= MAX_MAP_PLIES, `deepest=${deepest}`);
    check('depth: 240 plies of repetition still terminate',
      treeComplaint(root) === '', treeComplaint(root));
    // Four positions repeated over and over: the merge must not grow past them.
    check('depth: a repetition adds no new nodes',
      allNodes(root).length <= 5, `${allNodes(root).length} nodes`);
  }

  // ── maxPlies still truncates ───────────────────────────────────────────────
  {
    const root = buildMergedTree([line('a', 'white', 'e4 e5 Nf3 Nc6 Bb5')], 4, 'position', 'white');
    check('maxPlies: truncates the position merge too',
      !!at(root, 'e4 e5 Nf3 Nc6') && !at(root, 'e4 e5 Nf3 Nc6 Bb5'),
      'depth limit not applied');
  }

  return results;
}
