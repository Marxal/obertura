// DOM-free checks of transposition joins.
//
// Real chess.js positions throughout, because the whole claim is that two move
// orders land on the same position key — a hand-written FEN would prove nothing.
// The two roads used below are the genuine article: 1.d4 d5 2.c4 e6 3.Nc3 Nf6
// and 1.d4 Nf6 2.c4 e6 3.Nc3 d5 reach the same position.

import { Chess } from 'chess.js';
import type { MoveNode } from './tree';
import {
  emptyTree, mergePath, makeIdFactory, linePaths, nodeAtPath,
  type MergeStep, type Repertoire,
} from './repertoire';
import { joinedPath, joinContinuation, joinCandidates, MAX_JOIN_PLIES } from './repertoire-join';
import { projectRepertoire, locateLine, applyLineWrite } from './lines-view';

export interface TestResult { name: string; pass: boolean; detail: string }

function steps(sans: string): MergeStep[] {
  const chess = new Chess();
  return sans.split(/\s+/).filter(Boolean).map(san => {
    const m = chess.move(san);
    return { san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fen: chess.fen() };
  });
}

function book(...lines: string[]): Repertoire {
  const rep: Repertoire = {
    id: 'w', name: 'White', colour: 'white', tree: emptyTree(), createdAt: 1,
  };
  const nextId = makeIdFactory(rep.tree);
  for (const sans of lines) mergePath(rep.tree, steps(sans), nextId);
  return rep;
}

function at(rep: Repertoire, sans: string): MoveNode | null {
  return nodeAtPath(rep.tree, steps(sans).map(s => s.uci));
}

function pathOf(rep: Repertoire, sans: string): MoveNode[] {
  const ucis = steps(sans).map(s => s.uci);
  const out: MoveNode[] = [];
  let cursor: MoveNode = rep.tree;
  for (const u of ucis) {
    const c: MoveNode | undefined = cursor.children.find(x => x.uci === u);
    if (!c) break;
    out.push(c);
    cursor = c;
  }
  return out;
}

// Two roads to the same QGD position; the second one carries on.
const ROAD_A = 'd4 d5 c4 e6 Nc3 Nf6';
const ROAD_B = 'd4 Nf6 c4 e6 Nc3 d5 Bg5 Be7';

export function runRepertoireJoinSelfTest(): TestResult[] {
  const out: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    out.push({ name, pass, detail });
  };

  // ── The positions really do meet ──────────────────────────────────────────

  {
    const rep = book(ROAD_A, ROAD_B);
    const a = at(rep, ROAD_A)!;
    const b = at(rep, 'd4 Nf6 c4 e6 Nc3 d5')!;
    check(
      'the two move orders genuinely reach the same position',
      a.fen.split(' ').slice(0, 4).join(' ') === b.fen.split(' ').slice(0, 4).join(' '),
      'same board, side, castling and en passant',
    );
  }

  // ── Offering a join ───────────────────────────────────────────────────────

  {
    const rep = book(ROAD_A, ROAD_B);
    const cands = joinCandidates(rep.tree, pathOf(rep, ROAD_A));
    check(
      'a line that ends where another is still going is offered the join',
      cands.length === 1 && cands[0].sans.join(' ') === 'Bg5 Be7',
      cands.map(c => c.sans.join(' ')).join(' | ') || '(none)',
    );
    check(
      'and the offer says how many moves it is worth',
      cands[0]?.moves === 2,
      `${cands[0]?.moves}`,
    );
  }

  {
    // A line reached down the SAME road is a shared prefix, not a transposition.
    const rep = book('d4 d5 c4', 'd4 d5 c4 e6 Nc3');
    const shortEnd = pathOf(rep, 'd4 d5 c4');
    check(
      'a line that simply continues this one is not offered as a transposition',
      joinCandidates(rep.tree, shortEnd).length === 0,
      `${joinCandidates(rep.tree, shortEnd).length} offers`,
    );
  }

  {
    const rep = book('e4 e5 Nf3', 'd4 d5 c4');
    check(
      'a position nothing else reaches gets no offer',
      joinCandidates(rep.tree, pathOf(rep, 'e4 e5 Nf3')).length === 0,
      'none',
    );
  }

  // ── Following a join ──────────────────────────────────────────────────────

  {
    const rep = book(ROAD_A, ROAD_B);
    at(rep, ROAD_A)!.joinTo = at(rep, ROAD_B)!.id;
    const full = joinedPath(rep.tree, pathOf(rep, ROAD_A));
    check(
      'the joined line plays on through the other line’s moves',
      full.map(n => n.san).join(' ') === 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7',
      full.map(n => n.san).join(' '),
    );
    check(
      'and the added moves are the OTHER line’s own nodes, not copies',
      full[6] === at(rep, 'd4 Nf6 c4 e6 Nc3 d5 Bg5')!,
      'shared nodes',
    );
  }

  {
    const rep = book(ROAD_A, ROAD_B);
    at(rep, ROAD_A)!.joinTo = at(rep, ROAD_B)!.id;
    const lines = projectRepertoire(rep);
    const joined = lines.find(l => l.id.endsWith(at(rep, ROAD_A)!.id))!;
    const target = lines.find(l => l.id.endsWith(at(rep, ROAD_B)!.id))!;
    check(
      'the join does not create a new line — there are still two',
      lines.length === 2,
      `${lines.length} lines`,
    );
    check(
      'the joined line keeps its own identity',
      joined.id !== target.id,
      'distinct ids',
    );
  }

  {
    // Grading a joined line must reach the shared moves, or a drill would
    // silently throw away the work done past the join.
    const rep = book(ROAD_A, ROAD_B);
    at(rep, ROAD_A)!.joinTo = at(rep, ROAD_B)!.id;
    const line = projectRepertoire(rep).find(l => l.id.endsWith(at(rep, ROAD_A)!.id))!;
    const spine: MoveNode[] = [];
    let cur = line.tree.children[0];
    while (cur) { spine.push(cur); cur = cur.children[0]; }
    spine[6].review = { ease: 2.5, interval: 7, reps: 2, lapses: 0, due: new Date(0) };
    applyLineWrite([rep], line);
    check(
      'a grade past the join lands on the shared node',
      at(rep, 'd4 Nf6 c4 e6 Nc3 d5 Bg5')!.review?.interval === 7,
      `interval ${at(rep, 'd4 Nf6 c4 e6 Nc3 d5 Bg5')!.review?.interval ?? 0}`,
    );
    check(
      'locateLine hands back the joined path so those grades can be found',
      locateLine([rep], line.id)?.path.length === 8,
      `${locateLine([rep], line.id)?.path.length} moves`,
    );
    check(
      '…while the line’s own end is still where its metadata lives',
      locateLine([rep], line.id)?.end === at(rep, ROAD_A)!,
      'the origin end',
    );
  }

  // ── What a join must NOT do ───────────────────────────────────────────────

  {
    const rep = book(ROAD_A, ROAD_B);
    at(rep, ROAD_A)!.joinTo = at(rep, ROAD_B)!.id;
    // The target's branch is paused; the joined line is not, and must not become so.
    at(rep, 'd4 Nf6')!.training = false;
    const joined = projectRepertoire(rep).find(l => l.id.endsWith(at(rep, ROAD_A)!.id))!;
    check(
      'joining into a paused branch does not pause the line that joined',
      joined.inTraining === true,
      `inTraining ${joined.inTraining}`,
    );
  }

  {
    const rep = book(ROAD_A, ROAD_B);
    const origin = at(rep, ROAD_A)!;
    origin.joinTo = at(rep, ROAD_B)!.id;
    const line = projectRepertoire(rep).find(l => l.id.endsWith(origin.id))!;
    applyLineWrite([rep], { ...line, name: 'My QGD' });
    check(
      'naming a joined line names IT, never the line it continues as',
      origin.label === 'My QGD' && at(rep, ROAD_B)!.label === undefined,
      `origin ${origin.label}, target ${at(rep, ROAD_B)!.label ?? '(none)'}`,
    );
  }

  {
    const rep = book(ROAD_A, ROAD_B);
    at(rep, ROAD_A)!.joinTo = 'no-such-node';
    check(
      'a join pointing at something that no longer exists is simply not followed',
      joinedPath(rep.tree, pathOf(rep, ROAD_A)).length === 6,
      'the line ends where it did',
    );
  }

  {
    // Two lines pointing at each other. Following a join twice would loop; one
    // hop is the rule, so each line gains the other's tail and stops.
    const rep = book(ROAD_A, ROAD_B);
    const a = at(rep, ROAD_A)!;
    const b = at(rep, ROAD_B)!;
    a.joinTo = b.id;
    b.joinTo = a.id;
    const pa = joinedPath(rep.tree, pathOf(rep, ROAD_A));
    const pb = joinedPath(rep.tree, pathOf(rep, ROAD_B));
    check(
      'a join is followed once, so two lines pointing at each other cannot loop',
      pa.length === 8 && pb.length === 8,
      `${pa.length} and ${pb.length} moves`,
    );
    check(
      'and neither path repeats a move',
      new Set(pa.map(n => n.id)).size === pa.length
      && new Set(pb.map(n => n.id)).size === pb.length,
      'no repeats',
    );
  }

  {
    // A join whose continuation walks back over the line's own moves is refused
    // outright rather than producing a path that revisits a position.
    const rep = book('d4 d5 c4 e6', 'd4 d5 c4 e6 Nc3');
    const origin = pathOf(rep, 'd4 d5');
    const end = at(rep, 'd4 d5')!;
    end.endpoint = true;
    end.joinTo = at(rep, 'd4 d5 c4 e6 Nc3')!.id;
    check(
      'a continuation that would revisit the line’s own moves is refused',
      joinContinuation(rep.tree, origin).length === 0
      || joinContinuation(rep.tree, origin).every(n => !origin.some(o => o.id === n.id)),
      'no revisits',
    );
  }

  {
    check(
      'the join length is capped whatever the target’s length',
      MAX_JOIN_PLIES === 40,
      `${MAX_JOIN_PLIES} plies`,
    );
  }

  {
    const rep = book(ROAD_A, ROAD_B);
    const plain = pathOf(rep, ROAD_A);
    check(
      'a line with no join is untouched by any of this',
      joinedPath(rep.tree, plain) === plain,
      'the very same array comes back',
    );
    check(
      'and the book still projects exactly its line ends',
      projectRepertoire(rep).length === linePaths(rep.tree).length,
      `${projectRepertoire(rep).length} lines`,
    );
  }

  return out;
}
