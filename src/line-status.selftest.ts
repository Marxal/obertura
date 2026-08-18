// DOM-free checks of the two things a line card and its popup say about a line.
//
// Both are wording, which is exactly why they are worth pinning: the phrases go
// in front of the user on every screen that lists a line, and the two rules that
// matter are easy to break by accident — a paused line must never be described
// as due, and a line whose moves are all shared must not claim any as its own.

import type { Line } from './types';
import type { MoveNode } from './tree';
import {
  lineStatus, lineShape, lineShapeText, spineLength, lineTraining, lineTrainingText,
  lineMastered,
} from './line-status';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const NOW = new Date('2026-06-01T12:00:00Z');

/** A projected line of `plies` moves, as a spine — the shape every reader walks. */
function line(plies: number, extra: Partial<Line> = {}): Line {
  const root: MoveNode = { id: 'root', san: '', uci: '', fen: START_FEN, children: [] };
  let cursor = root;
  for (let i = 0; i < plies; i++) {
    const node: MoveNode = {
      id: `n${i + 1}`, san: `m${i + 1}`, uci: `a1a${(i % 8) + 1}`, fen: `fen-${i}`, children: [],
    };
    cursor.children = [node];
    cursor = node;
  }
  return {
    id: 'rep-white::n1',
    name: 'A line',
    tags: [],
    colour: 'white',
    openingName: null,
    confidence: 0,
    lastTrained: null,
    inTraining: true,
    tree: root,
    ...extra,
  };
}

/** The user's moves of a white line are the odd plies — index 0, 2, 4… */
function userNodes(l: Line): MoveNode[] {
  const out: MoveNode[] = [];
  let node = l.tree.children[0];
  let i = 0;
  while (node) {
    if (i % 2 === 0) out.push(node);
    node = node.children[0];
    i++;
  }
  return out;
}

function review(dueAt: Date, interval = 5) {
  return { ease: 2.5, interval, reps: 3, lapses: 0, due: dueAt };
}

export function runLineStatusSelfTest(): TestResult[] {
  const out: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string): void => {
    out.push({ name, pass, detail });
  };

  // ── Status ─────────────────────────────────────────────────────────────────

  {
    const fresh = line(6);
    const s = lineStatus(fresh, NOW);
    check(
      'a line never drilled reads as not started, not as due',
      s.tone === 'new' && s.text === 'Not started',
      `${s.tone}: "${s.text}"`,
    );
  }

  {
    const l = line(6);
    const mine = userNodes(l);
    mine[0].review = review(new Date(NOW.getTime() - 86400000));  // overdue
    mine[1].review = review(new Date(NOW.getTime() + 86400000));
    mine[2].review = review(new Date(NOW.getTime() + 86400000));
    const s = lineStatus(l, NOW);
    check(
      'a due line counts how many of its moves are due',
      s.tone === 'due' && s.text === 'Due now · 1 of 3 moves',
      `${s.tone}: "${s.text}"`,
    );
  }

  {
    // THE RULE THAT MATTERS. Every move overdue, but the line is paused — the
    // scheduler will never offer it, so saying "Due now" would be a lie the
    // user could not act on.
    const l = line(6, { inTraining: false });
    for (const n of userNodes(l)) n.review = review(new Date(NOW.getTime() - 86400000));
    const s = lineStatus(l, NOW);
    check(
      'a paused line is never described as due',
      s.tone === 'off' && s.text === 'Paused',
      `${s.tone}: "${s.text}"`,
    );
  }

  {
    const l = line(6);
    // Long intervals on every move: nothing due, and settled enough to be solid.
    for (const n of userNodes(l)) n.review = review(new Date(NOW.getTime() + 30 * 86400000), 40);
    const s = lineStatus(l, NOW);
    check(
      'a settled line reads as solid and says when it next comes round',
      s.tone === 'solid' && s.text === 'Due in 30 days',
      `${s.tone}: "${s.text}"`,
    );
  }

  {
    const l = line(6);
    // Due in future, but one move is still on a short interval — still learning.
    const mine = userNodes(l);
    for (const n of mine) n.review = review(new Date(NOW.getTime() + 3 * 86400000), 40);
    mine[1].review = review(new Date(NOW.getTime() + 2 * 86400000), 2);
    const s = lineStatus(l, NOW);
    check(
      'a line with a move still on a short interval reads as learning',
      s.tone === 'learning',
      `${s.tone}: "${s.text}"`,
    );
  }

  // ── Shape ──────────────────────────────────────────────────────────────────

  {
    const l = line(12, { ownMoves: 3 });
    check(
      'the shape names the length and how much is the line’s own',
      lineShapeText(l) === '12 moves · 3 only here',
      `"${lineShapeText(l)}"`,
    );
  }

  {
    // Prepared moves continue past this line's end, so nothing on it is
    // exclusively its own. "0 only here" is a riddle; the shape stays silent.
    const l = line(12, { ownMoves: 0 });
    check(
      'a line sharing every move claims none of them',
      lineShape(l).ownMoves === null && lineShapeText(l) === '12 moves',
      `"${lineShapeText(l)}"`,
    );
  }

  {
    // A line nothing else touches: every move is its own, and contrasting "12"
    // with "12 only here" says nothing worth the pixels.
    const l = line(12, { ownMoves: 12 });
    check(
      'a line shared with nothing does not contrast itself with itself',
      lineShape(l).ownMoves === null,
      `ownMoves ${lineShape(l).ownMoves}`,
    );
  }

  {
    const l = line(9);
    check(
      'the length is the spine, not the node count',
      spineLength(l.tree) === 9,
      `spineLength ${spineLength(l.tree)}`,
    );
  }

  // ── Training figures ───────────────────────────────────────────────────────

  {
    // Two of the three drilled, one of those two still clean. Recall is read
    // against what has been DRILLED, not against the whole line: the move never
    // asked for hasn't been forgotten.
    const l = line(6, { timesTrained: 4 });
    const mine = userNodes(l);
    mine[0].review = review(new Date(NOW), 5);
    mine[1].review = { ease: 2.5, interval: 1, reps: 0, lapses: 2, due: new Date(NOW) };
    const t = lineTraining(l);
    check(
      'recall counts clean moves against drilled ones, not against the line',
      t.runs === 4 && t.drilled === 2 && t.total === 3 && t.recallPct === 50,
      `runs ${t.runs} drilled ${t.drilled}/${t.total} recall ${t.recallPct}`,
    );
    check(
      'the figures read as one quiet line',
      lineTrainingText(l) === '4 runs · 50% recall',
      `"${lineTrainingText(l)}"`,
    );
  }

  {
    const l = line(6);
    check(
      'a line never trained has no figures to quote',
      lineTrainingText(l) === null,
      `"${lineTrainingText(l)}"`,
    );
  }

  // ── Mastery (the "keep growing" offer) ─────────────────────────────────────

  /** A line drilled clean on every move, `runs` times, with room to grow. */
  const mastered = (extra: Partial<Line> = {}): Line => {
    const l = line(6, { timesTrained: 4, confidence: 4, ownMoves: 3, ...extra });
    for (const n of userNodes(l)) n.review = review(new Date(NOW.getTime() + 30 * 86400000), 40);
    return l;
  };

  check(
    'a line drilled clean, several times over, is ready to grow',
    lineMastered(mastered()),
    'expected mastered',
  );

  check(
    'a paused line is never asked to grow',
    !lineMastered(mastered({ inTraining: false })),
    'expected not mastered',
  );

  check(
    'a line whose prep already continues past its end has nothing to add here',
    !lineMastered(mastered({ ownMoves: 0 })),
    'expected not mastered',
  );

  {
    const l = mastered({ timesTrained: 1 });
    check(
      'one run does not make a line mastered',
      !lineMastered(l),
      'expected not mastered',
    );
  }

  {
    // Every move clean but one never asked for: the line hasn't been round in
    // full, so it hasn't proved anything yet.
    const l = mastered();
    delete userNodes(l)[2].review;
    check(
      'a line with a move never drilled is not mastered',
      !lineMastered(l),
      'expected not mastered',
    );
  }

  return out;
}
