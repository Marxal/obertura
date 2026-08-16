// Network-free, DOM-free checks of the position index. Real chess.js FENs
// throughout — the whole point of the module is that positions match across
// different move orders, and a hand-written FEN would prove nothing about that.

import { Chess } from 'chess.js';
import type { Line } from './types';
import type { MoveNode } from './tree';
import { buildPositionIndex, positionKey } from './position-index';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Turn a SAN string into a saved Line whose tree is a single path — exactly the
// shape the builder saves.
let nodeSeq = 0;
function line(
  id: string,
  name: string,
  colour: 'white' | 'black',
  sans: string,
  inTraining = true,
): Line {
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
    id, name, tags: [], colour,
    openingName: null, confidence: 0, lastTrained: null,
    inTraining, tree: root,
  };
}

// The FEN a SAN string ends on — for asserting things about chess.js directly.
function fenAfter(sans: string): string {
  const chess = new Chess();
  for (const san of sans.split(/\s+/).filter(Boolean)) chess.move(san);
  return chess.fen();
}

export function runPositionIndexSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  // ── The key itself ─────────────────────────────────────────────────────────

  check(
    'key drops the halfmove and fullmove clocks',
    positionKey('8/8/8/8/8/8/8/K6k w - - 17 42') === '8/8/8/8/8/8/8/K6k w - -',
    positionKey('8/8/8/8/8/8/8/K6k w - - 17 42'),
  );

  // The convention this module inherits from openings.ts, asserted against the
  // real chess.js rather than trusted: the en-passant field appears ONLY when an
  // en-passant capture is genuinely available.
  const epLegal = fenAfter('e4 a6 e5 d5');       // exd6 is on
  const epNotLegal = fenAfter('Nf3 d5 d4');      // d2-d4 double-step, nothing can take
  check(
    'chess.js sets the ep square when the capture is legal',
    epLegal.split(' ')[3] === 'd6',
    epLegal,
  );
  check(
    'chess.js leaves it "-" after a double-step with no capture available',
    epNotLegal.split(' ')[3] === '-',
    epNotLegal,
  );

  // ── Identical lines ────────────────────────────────────────────────────────

  {
    const a = line('a', 'Italian', 'white', 'e4 e5 Nf3 Nc6 Bc4');
    const b = line('b', 'Something else entirely', 'white', 'e4 e5 Nf3 Nc6 Bc4');
    b.tags = ['sharp'];
    const idx = buildPositionIndex([a, b]);
    const v = idx.duplicatesOf(a);
    check(
      'identical moves are identical regardless of name and tags',
      v?.relation === 'identical' && v.otherLineId === 'b',
      JSON.stringify(v),
    );
  }

  // ── Prefix / extension ─────────────────────────────────────────────────────

  {
    const short = line('short', 'Italian stub', 'white', 'e4 e5 Nf3');
    const long = line('long', 'Italian', 'white', 'e4 e5 Nf3 Nc6 Bc4 Bc5');
    const idx = buildPositionIndex([short, long]);
    const fromLong = idx.duplicatesOf(long);
    const fromShort = idx.duplicatesOf(short);
    check(
      'the longer line reads as extension-longer',
      fromLong?.relation === 'extension-longer' && fromLong.otherLineId === 'short'
        && fromLong.sharedPlies === 3,
      JSON.stringify(fromLong),
    );
    check(
      'the shorter line reads as extension-shorter',
      fromShort?.relation === 'extension-shorter' && fromShort.otherLineId === 'long'
        && fromShort.sharedPlies === 3,
      JSON.stringify(fromShort),
    );
  }

  // ── Divergent, and no relation at all ──────────────────────────────────────

  {
    const italian = line('it', 'Italian', 'white', 'e4 e5 Nf3 Nc6 Bc4');
    const spanish = line('sp', 'Spanish', 'white', 'e4 e5 Nf3 Nc6 Bb5');
    const london = line('lo', 'London', 'white', 'd4 d5 Bf4');
    const idx = buildPositionIndex([italian, spanish, london]);
    const v = idx.duplicatesOf(italian);
    check(
      'lines that share an opening then part are divergent',
      v?.relation === 'divergent' && v.otherLineId === 'sp' && v.sharedPlies === 4,
      JSON.stringify(v),
    );
    check(
      'a line sharing no first move has no relation',
      idx.duplicatesOf(london) === null,
      JSON.stringify(idx.duplicatesOf(london)),
    );
  }

  // ── Both colours: same moves must NOT match ────────────────────────────────

  {
    const white = line('w', 'Open game', 'white', 'e4 e5 Nf3 Nc6');
    const black = line('bk', 'Open game', 'black', 'e4 e5 Nf3 Nc6');
    const idx = buildPositionIndex([white, black]);
    check(
      'the same moves saved under both colours are not duplicates',
      idx.duplicatesOf(white) === null && idx.duplicatesOf(black) === null,
      `${JSON.stringify(idx.duplicatesOf(white))} / ${JSON.stringify(idx.duplicatesOf(black))}`,
    );
    check(
      'and they do not transpose into each other either',
      idx.transpositionsFor(white).length === 0,
      JSON.stringify(idx.transpositionsFor(white)),
    );
    // The parity rule: in a white line the user's moves are the even plies.
    const atStart = idx.entriesAt(START_FEN);
    check(
      "1.e4 is the white line's own move and the black line's opponent move",
      atStart.length === 2
        && atStart.find(e => e.lineId === 'w')?.isUserMove === true
        && atStart.find(e => e.lineId === 'bk')?.isUserMove === false,
      JSON.stringify(atStart.map(e => [e.lineId, e.isUserMove])),
    );
    check(
      'siblingAnswers only offers moves the user actually plays',
      idx.siblingAnswers(START_FEN, 'w').length === 0
        && idx.siblingAnswers(START_FEN, 'bk').map(e => e.lineId).join() === 'w',
      JSON.stringify(idx.siblingAnswers(START_FEN, 'bk').map(e => e.lineId)),
    );
  }

  // ── A genuine transposition by move order ──────────────────────────────────
  //
  // 1.Nf3 d5 2.d4 and 1.d4 d5 2.Nf3 reach the same position by different roads.
  // It doubles as the en-passant guard: the first line's last move is the d2-d4
  // DOUBLE-STEP, the second's is a knight move, so a key that carried the
  // en-passant square unconditionally would read "d3" on one side and "-" on the
  // other and the transposition would never be found.

  {
    const viaKnight = line('kn', 'Réti into the Queen’s Pawn', 'white', 'Nf3 d5 d4');
    const viaPawn = line('pw', 'Queen’s Pawn', 'white', 'd4 d5 Nf3 Nf6');
    const idx = buildPositionIndex([viaKnight, viaPawn]);

    check(
      'the two roads really do produce the same position key',
      positionKey(fenAfter('Nf3 d5 d4')) === positionKey(fenAfter('d4 d5 Nf3')),
      `${positionKey(fenAfter('Nf3 d5 d4'))} vs ${positionKey(fenAfter('d4 d5 Nf3'))}`,
    );

    const t = idx.transpositionsFor(viaKnight);
    check(
      'the transposition is found once, at the right plies',
      t.length === 1 && t[0].otherLineId === 'pw' && t[0].ply === 3 && t[0].otherPly === 3
        && t[0].san === 'Nf6',
      JSON.stringify(t),
    );
    check(
      'a shared opening prefix is not reported as a transposition',
      !t.some(x => x.ply === 0),
      JSON.stringify(t.map(x => x.ply)),
    );
    check(
      'the lines are not duplicates of each other (different first moves)',
      idx.duplicatesOf(viaKnight) === null,
      JSON.stringify(idx.duplicatesOf(viaKnight)),
    );
  }

  // ── An en-passant position must not block a match ──────────────────────────
  //
  // The sharpest form of the guard: 1.e4 e6 2.d4 and 1.d4 e6 2.e4 reach the same
  // position, and BOTH arrive on a pawn double-step — to different squares. A
  // key that carried the en-passant square unconditionally would read "d3" on
  // one side and "e3" on the other and never match. Neither capture is actually
  // available (Black has no pawn on the fourth rank), so chess.js writes "-" for
  // both and the transposition is found.

  {
    const a = line('epa', 'French via 1.e4', 'white', 'e4 e6 d4');
    const b = line('epb', 'French via 1.d4', 'white', 'd4 e6 e4 d5');
    const idx = buildPositionIndex([a, b]);
    const shared = fenAfter('e4 e6 d4');
    const other = fenAfter('d4 e6 e4');
    check(
      'two different double-steps reach one position and neither records an ep square',
      shared.split(' ')[3] === '-' && other.split(' ')[3] === '-'
        && shared.split(' ')[0] === other.split(' ')[0],
      `${shared} / ${other}`,
    );
    check(
      'both lines are filed under the same key despite the double-steps',
      positionKey(shared) === positionKey(other),
      `${positionKey(shared)} / ${positionKey(other)}`,
    );
    const t = idx.transpositionsFor(a);
    check(
      'the en-passant position transposes rather than blocking',
      t.length === 1 && t[0].key === positionKey(shared) && t[0].san === 'd5'
        && t[0].ply === 3 && t[0].otherPly === 3,
      JSON.stringify(t.map(x => [x.ply, x.otherPly, x.san])),
    );
    check(
      'siblingAnswers finds nothing there — …d5 is the opponent’s move',
      idx.siblingAnswers(shared, 'epa').length === 0
        && idx.entriesAt(shared).map(e => e.san).join() === 'd5',
      JSON.stringify(idx.entriesAt(shared).map(e => [e.san, e.isUserMove])),
    );
  }

  // ── Entries carry the node the review record lives on ──────────────────────

  {
    const l = line('r', 'Scotch', 'white', 'e4 e5 Nf3 Nc6 d4');
    const idx = buildPositionIndex([l]);
    const after4 = fenAfter('e4 e5 Nf3 Nc6');
    const entry = idx.entriesAt(after4)[0];
    entry.node.review = { ease: 2.5, interval: 6, reps: 2, lapses: 0, due: new Date(0) };
    // The tree's own fifth node must see the write — entries hold a reference,
    // which is what lets a write-through credit the same move in other lines.
    let n = l.tree.children[0];
    for (let i = 0; i < 4; i++) n = n.children[0];
    check(
      'an entry holds a live reference to its MoveNode',
      entry.san === 'd4' && entry.ply === 5 && entry.isUserMove && n.review?.reps === 2,
      `${entry.san}/${entry.ply}/${n.review?.reps}`,
    );
  }

  // ── In-training lines sort first among sibling answers ─────────────────────

  {
    const off = line('off', 'Parked', 'white', 'e4 e5 Nf3 Nc6 Bb5', false);
    const on = line('on', 'Active', 'white', 'e4 e5 Nf3 Nc6 Bc4', true);
    const idx = buildPositionIndex([off, on]);
    const answers = idx.siblingAnswers(fenAfter('e4 e5 Nf3 Nc6'), 'none');
    check(
      'in-training lines lead the sibling answers',
      answers.map(e => e.lineId).join() === 'on,off',
      JSON.stringify(answers.map(e => [e.lineId, e.inTraining])),
    );
  }

  return results;
}
