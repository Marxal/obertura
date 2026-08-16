// Checks of what the position index changes about saving a line: which tags are
// missing, which of two review records is the better one, and the inheritance
// pass that gives a new line the training it has already had elsewhere.

import { Chess } from 'chess.js';
import type { Line } from './types';
import type { MoveNode } from './tree';
import type { Review } from './scheduler';
import { buildPositionIndex } from './position-index';
import { missingTags, betterReview, inheritReviews, inheritanceNote } from './save-index';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

let nodeSeq = 0;
function line(
  id: string,
  name: string,
  colour: 'white' | 'black',
  sans: string,
  tags: string[] = [],
): Line {
  const chess = new Chess();
  const root: MoveNode = { id: `${id}-root`, san: '', uci: '', fen: START_FEN, children: [] };
  let cursor = root;
  for (const san of sans.split(/\s+/).filter(Boolean)) {
    const m = chess.move(san);
    const node: MoveNode = {
      id: `n${++nodeSeq}`, san: m.san, uci: m.from + m.to + (m.promotion ?? ''),
      fen: chess.fen(), children: [],
    };
    cursor.children.push(node);
    cursor = node;
  }
  return {
    id, name, tags, colour,
    openingName: null, confidence: 0, lastTrained: null, inTraining: true, tree: root,
  };
}

function review(interval: number, reps: number, ease = 2.5): Review {
  return { ease, interval, reps, lapses: 0, due: new Date('2026-01-01T00:00:00Z') };
}

// Put a review record on the nth mainline move (1-based).
function grade(l: Line, ply: number, r: Review): Line {
  let n = l.tree.children[0];
  for (let i = 1; i < ply; i++) n = n.children[0];
  n.review = r;
  return l;
}

function nodeAt(l: Line, ply: number): MoveNode {
  let n = l.tree.children[0];
  for (let i = 1; i < ply; i++) n = n.children[0];
  return n;
}

export function runSaveIndexSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  // ── Missing tags ───────────────────────────────────────────────────────────

  {
    const fresh = line('a', 'Italian', 'white', 'e4 e5', ['vs Erik']);
    const stored = line('b', 'Italian', 'white', 'e4 e5', ['vs Anna']);
    check(
      'a tag the stored line lacks is the offer',
      missingTags(fresh, stored).join() === 'vs Erik',
      JSON.stringify(missingTags(fresh, stored)),
    );
    check(
      'nothing to add when the stored line already has it',
      missingTags(line('a', '', 'white', 'e4', ['vs Anna']), stored).length === 0,
      JSON.stringify(missingTags(line('a', '', 'white', 'e4', ['vs Anna']), stored)),
    );
    check(
      'tag matching ignores case and stray whitespace',
      missingTags(line('a', '', 'white', 'e4', [' VS anna ']), stored).length === 0,
      JSON.stringify(missingTags(line('a', '', 'white', 'e4', [' VS anna ']), stored)),
    );
    check(
      'a tag repeated in the new line is offered once',
      missingTags(line('a', '', 'white', 'e4', ['vs Erik', 'vs erik']), stored).length === 1,
      JSON.stringify(missingTags(line('a', '', 'white', 'e4', ['vs Erik', 'vs erik']), stored)),
    );
    check(
      'the stored line keeping extra tags is not a difference',
      missingTags(stored, line('c', '', 'white', 'e4', ['vs Anna', 'sharp'])).length === 0,
      JSON.stringify(missingTags(stored, line('c', '', 'white', 'e4', ['vs Anna', 'sharp']))),
    );
  }

  // ── Best record ────────────────────────────────────────────────────────────

  {
    check(
      'the longer interval is the better record',
      betterReview(review(6, 2), review(21, 1)).interval === 21,
      String(betterReview(review(6, 2), review(21, 1)).interval),
    );
    check(
      'equal intervals fall through to reps',
      betterReview(review(6, 2), review(6, 4)).reps === 4,
      String(betterReview(review(6, 2), review(6, 4)).reps),
    );
    check(
      'equal intervals and reps fall through to ease',
      betterReview(review(6, 2, 2.1), review(6, 2, 2.6)).ease === 2.6,
      String(betterReview(review(6, 2, 2.1), review(6, 2, 2.6)).ease),
    );
  }

  // ── Inheritance ────────────────────────────────────────────────────────────

  {
    // A drilled Italian, and a new Spanish that shares its first two user moves
    // (1.e4 and 2.Nf3) before parting on move three.
    const italian = line('it', 'Italian', 'white', 'e4 e5 Nf3 Nc6 Bc4 Bc5');
    grade(italian, 1, review(21, 4));  // 1.e4
    grade(italian, 3, review(6, 2));   // 2.Nf3
    grade(italian, 5, review(15, 3));  // 3.Bc4
    const index = buildPositionIndex([italian]);

    const spanish = line('sp', 'Spanish', 'white', 'e4 e5 Nf3 Nc6 Bb5 a6');
    const r = inheritReviews(spanish, index);
    check(
      'the shared user moves inherit and the new one does not',
      r.inherited === 2 && r.userMoves === 3,
      `${r.inherited}/${r.userMoves}`,
    );
    check(
      'the inherited records are the right ones',
      nodeAt(spanish, 1).review?.interval === 21 && nodeAt(spanish, 3).review?.interval === 6,
      `${nodeAt(spanish, 1).review?.interval}/${nodeAt(spanish, 3).review?.interval}`,
    );
    check(
      'the move that diverges stays new',
      nodeAt(spanish, 5).review === undefined,
      JSON.stringify(nodeAt(spanish, 5).review),
    );
    check(
      'opponent moves never inherit — they carry no review record',
      nodeAt(spanish, 2).review === undefined && nodeAt(spanish, 4).review === undefined,
      `${JSON.stringify(nodeAt(spanish, 2).review)} / ${JSON.stringify(nodeAt(spanish, 4).review)}`,
    );
    check(
      'the copy is detached, not shared with the line it came from',
      nodeAt(spanish, 1).review !== nodeAt(italian, 1).review
        && nodeAt(spanish, 1).review!.due !== nodeAt(italian, 1).review!.due,
      'aliased',
    );
    check(
      'the source line is left untouched',
      nodeAt(italian, 1).review?.interval === 21 && nodeAt(italian, 5).review?.interval === 15,
      `${nodeAt(italian, 1).review?.interval}/${nodeAt(italian, 5).review?.interval}`,
    );
  }

  // Two lines know the same move to different depths — take the best (§10).
  {
    const weak = grade(line('w', 'Weak', 'white', 'e4 e5 Nf3'), 1, review(1, 0));
    const strong = grade(line('s', 'Strong', 'white', 'e4 c5 Nf3'), 1, review(37, 5));
    const index = buildPositionIndex([weak, strong]);
    const fresh = line('f', 'Fresh', 'white', 'e4 e6 d4');
    inheritReviews(fresh, index);
    check(
      'where records disagree, the best one is inherited',
      nodeAt(fresh, 1).review?.interval === 37,
      String(nodeAt(fresh, 1).review?.interval),
    );
  }

  // A move already drilled in THIS line keeps its own history.
  {
    const other = grade(line('o', 'Other', 'white', 'e4 e5 Nf3'), 1, review(30, 5));
    const index = buildPositionIndex([other]);
    const mine = grade(line('m', 'Mine', 'white', 'e4 c5 Nf3'), 1, review(2, 1));
    const r = inheritReviews(mine, index);
    check(
      'a move with a record of its own is never overwritten',
      nodeAt(mine, 1).review?.interval === 2 && r.inherited === 0,
      `${nodeAt(mine, 1).review?.interval} inherited=${r.inherited}`,
    );
  }

  // The same moves under the other colour must not hand anything over: the
  // index entry's isUserMove is false there, so it is not an answer at all.
  {
    const black = grade(line('bk', 'Black', 'black', 'e4 e5 Nf3'), 1, review(30, 5));
    const index = buildPositionIndex([black]);
    const white = line('w', 'White', 'white', 'e4 e5 Nf3');
    const r = inheritReviews(white, index);
    check(
      'a white line inherits nothing from a black line’s opponent moves',
      r.inherited === 0 && nodeAt(white, 1).review === undefined,
      `inherited=${r.inherited}`,
    );
  }

  // A transposition inherits: the same move from the same position, reached by
  // a different move order.
  {
    const viaPawn = grade(line('p', 'Queen’s Pawn', 'white', 'd4 d5 Nf3 Nf6 e3'), 5, review(12, 3));
    const index = buildPositionIndex([viaPawn]);
    const viaKnight = line('k', 'Réti', 'white', 'Nf3 d5 d4 Nf6 e3');
    const r = inheritReviews(viaKnight, index);
    check(
      'a move reached by a different move order still inherits',
      r.inherited === 1 && nodeAt(viaKnight, 5).review?.interval === 12,
      `${r.inherited} / ${nodeAt(viaKnight, 5).review?.interval}`,
    );
  }

  // ── The toast sentence ─────────────────────────────────────────────────────

  check(
    'zero inherited says nothing at all',
    inheritanceNote({ inherited: 0, userMoves: 10 }) === null,
    String(inheritanceNote({ inherited: 0, userMoves: 10 })),
  );
  check(
    'the sentence reads as specified',
    inheritanceNote({ inherited: 6, userMoves: 10 }) === '6 of these 10 moves you already know.',
    String(inheritanceNote({ inherited: 6, userMoves: 10 })),
  );

  return results;
}
