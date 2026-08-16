// Network-free, DOM-free checks of the training half of the position index:
// the write-through matching rules (§8) and the divert judgement (§9).
//
// Real chess.js FENs throughout, like position-index.selftest.ts — the rules are
// about positions matching across move orders, and hand-written FENs would prove
// nothing about that.

import { Chess } from 'chess.js';
import type { Line } from './types';
import type { MoveNode } from './tree';
import type { Review } from './scheduler';
import { buildPositionIndex } from './position-index';
import { siblingCredits, applyReviewAt, divertTarget } from './train-index';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// A saved line whose tree is a single path — the shape the builder saves.
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

// The FEN a SAN string ends on, and the uci of one SAN played from it.
function fenAfter(sans: string): string {
  const chess = new Chess();
  for (const san of sans.split(/\s+/).filter(Boolean)) chess.move(san);
  return chess.fen();
}

function uciOf(fromSans: string, san: string): string {
  const chess = new Chess(fromSans ? fenAfter(fromSans) : START_FEN);
  const m = chess.move(san);
  return m.from + m.to + (m.promotion ?? '');
}

function mainline(l: Line): MoveNode[] {
  const out: MoveNode[] = [];
  let n = l.tree.children[0];
  while (n) { out.push(n); n = n.children[0]; }
  return out;
}

function review(interval: number, reps: number): Review {
  return { ease: 2.5, interval, reps, lapses: 0, due: new Date('2030-01-01T00:00:00Z') };
}

export function runTrainIndexSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  // ── §8: position AND move together ─────────────────────────────────────────
  //
  // Three White lines meeting after 1.e4 d5 (the Scandinavian): two answer 2.exd5,
  // one plays the surprise 2.Nc3. Drilling exd5 in one line must credit the other
  // exd5 line and leave the Nc3 line completely alone.

  {
    const main = line('main', 'Scandinavian — main line', 'white', 'e4 d5 exd5 Qxd5 Nc3');
    const twin = line('twin', 'Scandinavian — my other file', 'white', 'e4 d5 exd5 Nf6');
    const weapon = line('weapon', 'Scandinavian — surprise weapon', 'white', 'e4 d5 Nc3 dxe4');
    const idx = buildPositionIndex([main, twin, weapon]);

    const after = fenAfter('e4 d5');
    const exd5 = uciOf('e4 d5', 'exd5');
    const nc3 = uciOf('e4 d5', 'Nc3');

    const credits = siblingCredits(idx, after, exd5, 'main');
    check(
      'the same move from the same position is credited in the other line',
      credits.length === 1 && credits[0].lineId === 'twin' && credits[0].san === 'exd5'
        && credits[0].ply === 3,
      JSON.stringify(credits.map(e => [e.lineId, e.san, e.ply])),
    );
    check(
      'a DIFFERENT move from the same position is not touched',
      !credits.some(e => e.lineId === 'weapon'),
      JSON.stringify(credits.map(e => e.lineId)),
    );
    check(
      'and drilling that different move credits only its own twin set',
      siblingCredits(idx, after, nc3, 'weapon').length === 0,
      JSON.stringify(siblingCredits(idx, after, nc3, 'weapon').map(e => e.lineId)),
    );
    check(
      'the line being drilled never credits itself',
      !siblingCredits(idx, after, exd5, 'main').some(e => e.lineId === 'main')
        && siblingCredits(idx, after, exd5, 'twin').map(e => e.lineId).join() === 'main',
      JSON.stringify(siblingCredits(idx, after, exd5, 'twin').map(e => e.lineId)),
    );
  }

  // ── §8: the same move at a DIFFERENT position is a different move ───────────

  {
    // Both lines play Nf3, from two different positions.
    const a = line('a', 'Réti', 'white', 'Nf3 d5 d4');
    const b = line('b', 'Queen’s Pawn', 'white', 'd4 d5 Nf3');
    const idx = buildPositionIndex([a, b]);
    const nf3FromStart = uciOf('', 'Nf3');
    check(
      'the same move played from another position is not credited',
      siblingCredits(idx, START_FEN, nf3FromStart, 'a').length === 0,
      JSON.stringify(siblingCredits(idx, START_FEN, nf3FromStart, 'a').map(e => e.lineId)),
    );
  }

  // ── §8: a genuine transposition IS the same work ───────────────────────────
  //
  // 1.Nf3 d5 2.d4 and 1.d4 d5 2.Nf3 arrive at one position by different roads.
  // The move played there is the same move and must be credited across.

  {
    const viaKnight = line('kn', 'Réti into the Queen’s Pawn', 'white', 'Nf3 d5 d4 Nf6 c4');
    const viaPawn = line('pw', 'Queen’s Pawn', 'white', 'd4 d5 Nf3 Nf6 c4');
    const idx = buildPositionIndex([viaKnight, viaPawn]);
    const shared = fenAfter('Nf3 d5 d4 Nf6');
    const c4 = uciOf('Nf3 d5 d4 Nf6', 'c4');
    const credits = siblingCredits(idx, shared, c4, 'kn');
    check(
      'a move reached by a different move order is still the same work',
      credits.length === 1 && credits[0].lineId === 'pw' && credits[0].ply === 5,
      JSON.stringify(credits.map(e => [e.lineId, e.ply, e.san])),
    );
  }

  // ── §8: opponent moves are never credited ──────────────────────────────────

  {
    const white = line('w', 'Open game', 'white', 'e4 e5 Nf3 Nc6');
    const black = line('bk', 'Open game as Black', 'black', 'e4 e5 Nf3 Nc6');
    const idx = buildPositionIndex([white, black]);
    const e4 = uciOf('', 'e4');
    check(
      '1.e4 in the Black line is the opponent’s move and takes no credit',
      siblingCredits(idx, START_FEN, e4, 'w').length === 0,
      JSON.stringify(idx.entriesAt(START_FEN).map(e => [e.lineId, e.isUserMove])),
    );
    // …and the mirror: the Black line's own …e5 credits nothing in the White line.
    const e5 = uciOf('e4', 'e5');
    check(
      'and the White line’s …e5 is the opponent’s move too',
      siblingCredits(idx, fenAfter('e4'), e5, 'bk').length === 0,
      JSON.stringify(idx.entriesAt(fenAfter('e4')).map(e => [e.lineId, e.isUserMove])),
    );
  }

  // ── §8: parked lines are credited too ──────────────────────────────────────
  //
  // §8 has no training filter — the record is what the user knows, and a line
  // switched back on later should not have to re-learn it. (§9 is the one that
  // filters on inTraining, checked below.)

  {
    const on = line('on', 'Active', 'white', 'e4 e5 Nf3 Nc6 Bc4');
    const off = line('off', 'Parked', 'white', 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3', false);
    const idx = buildPositionIndex([on, off]);
    const after = fenAfter('e4 e5 Nf3 Nc6');
    const bc4 = uciOf('e4 e5 Nf3 Nc6', 'Bc4');
    check(
      'a parked line still takes the write-through',
      siblingCredits(idx, after, bc4, 'on').map(e => e.lineId).join() === 'off',
      JSON.stringify(siblingCredits(idx, after, bc4, 'on').map(e => [e.lineId, e.inTraining])),
    );
  }

  // ── applyReviewAt: addressed by ply + move, and always detached ────────────

  {
    const target = line('t', 'Italian', 'white', 'e4 e5 Nf3 Nc6 Bc4');
    const bc4 = uciOf('e4 e5 Nf3 Nc6', 'Bc4');
    const source = review(15, 3);

    const ok = applyReviewAt(target, 5, bc4, source);
    const node = mainline(target)[4];
    check(
      'the record lands on the move at that ply',
      ok && node.san === 'Bc4' && node.review?.interval === 15 && node.review?.reps === 3,
      `${ok} / ${node.san} / ${JSON.stringify(node.review)}`,
    );

    // Detached: two lines must never share a review object.
    source.interval = 999;
    source.due.setFullYear(1999);
    check(
      'the copy is detached from the record it came from',
      node.review?.interval === 15 && new Date(node.review!.due).getUTCFullYear() === 2030,
      `${node.review?.interval} / ${new Date(node.review!.due).toISOString()}`,
    );

    check(
      'a ply past the end of the line writes nothing',
      applyReviewAt(target, 9, bc4, review(1, 1)) === false,
      '',
    );
    check(
      'a ply holding a different move now writes nothing',
      applyReviewAt(target, 4, bc4, review(1, 1)) === false
        && mainline(target)[3].review === undefined,
      JSON.stringify(mainline(target)[3].review),
    );
  }

  // ── §9: the divert judgement ───────────────────────────────────────────────

  {
    const current = line('cur', 'Italian', 'white', 'e4 e5 Nf3 Nc6 Bc4 Bc5');
    const parked = line('sp', 'Spanish', 'white', 'e4 e5 Nf3 Nc6 Bb5 a6', false);
    const active = line('sc', 'Scotch', 'white', 'e4 e5 Nf3 Nc6 d4 exd4');
    const idx = buildPositionIndex([current, parked, active]);

    const after = fenAfter('e4 e5 Nf3 Nc6');
    const bb5 = uciOf('e4 e5 Nf3 Nc6', 'Bb5');
    const d4 = uciOf('e4 e5 Nf3 Nc6', 'd4');
    const bc4 = uciOf('e4 e5 Nf3 Nc6', 'Bc4');
    const h4 = uciOf('e4 e5 Nf3 Nc6', 'h4');

    const toActive = divertTarget(idx, after, d4, 'cur');
    check(
      'a move belonging to an in-training line offers that line',
      toActive?.lineId === 'sc' && toActive.inTraining === true && toActive.ply === 5,
      JSON.stringify(toActive),
    );
    const toParked = divertTarget(idx, after, bb5, 'cur');
    check(
      'a move belonging to a parked line is reported, marked not-in-training',
      toParked?.lineId === 'sp' && toParked.inTraining === false,
      JSON.stringify(toParked),
    );
    check(
      'a move no line of mine plays here is an ordinary wrong move',
      divertTarget(idx, after, h4, 'cur') === null,
      JSON.stringify(divertTarget(idx, after, h4, 'cur')),
    );
    check(
      'the current line’s own move never offers a divert into itself',
      divertTarget(idx, after, bc4, 'cur') === null,
      JSON.stringify(divertTarget(idx, after, bc4, 'cur')),
    );
  }

  // In-training wins when two lines play the same move here — only an
  // in-training line can be diverted into, so it must be the one named.
  {
    const current = line('cur', 'Italian', 'white', 'e4 e5 Nf3 Nc6 Bc4');
    const parked = line('p', 'Old Spanish notes', 'white', 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4', false);
    const active = line('a', 'Spanish', 'white', 'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6');
    const idx = buildPositionIndex([current, parked, active]);
    const t = divertTarget(idx, fenAfter('e4 e5 Nf3 Nc6'), uciOf('e4 e5 Nf3 Nc6', 'Bb5'), 'cur');
    check(
      'when two lines play it, the in-training one is offered',
      t?.lineId === 'a' && t.inTraining === true,
      JSON.stringify(t),
    );
    check(
      'but the write-through still reaches both of them',
      siblingCredits(idx, fenAfter('e4 e5 Nf3 Nc6'), uciOf('e4 e5 Nf3 Nc6', 'Bb5'), 'cur')
        .map(e => e.lineId).sort().join() === 'a,p',
      JSON.stringify(siblingCredits(
        idx, fenAfter('e4 e5 Nf3 Nc6'), uciOf('e4 e5 Nf3 Nc6', 'Bb5'), 'cur').map(e => e.lineId)),
    );
  }

  // The opponent's move is never a divert either. Drilling a Black line and
  // playing …c5 instead of the saved …e6: a White line stores …c5 as the reply
  // it expects, but that is the OPPONENT's move there and no line of mine to
  // continue in — so it stays an ordinary wrong move.
  {
    const current = line('cur', 'French', 'black', 'e4 e6 d4 d5');
    const other = line('oth', 'My anti-Sicilian', 'white', 'e4 c5 Nf3 d6 Bb5');
    const idx = buildPositionIndex([current, other]);
    const c5 = uciOf('e4', 'c5');
    check(
      'an opponent-move match never offers a divert',
      divertTarget(idx, fenAfter('e4'), c5, 'cur') === null,
      JSON.stringify(idx.entriesAt(fenAfter('e4')).map(e => [e.lineId, e.san, e.isUserMove])),
    );
  }

  return results;
}
