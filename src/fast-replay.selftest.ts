// fast-replay.ts must say exactly what chess.js says, or games stop matching positions.

import { Chess } from 'chess.js';
import { positionKey } from './position-index';
import { FastBoard, positionKeysAlong, keyAfterMove } from './fast-replay';

export interface TestResult { name: string; pass: boolean; detail?: string }

export function runFastReplaySelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail?: string): void => {
    results.push({ name, pass, detail });
  };

  // A small repeatable random source, so a failure can be reproduced.
  let seed = 20261102;
  const random = (n: number): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed % n;
  };

  // Random games reach castling, en passant, pins and promotions quite often.
  let plies = 0;
  let castles = 0;
  let enPassants = 0;
  let promotions = 0;
  let firstMismatch = '';
  for (let g = 0; g < 60 && !firstMismatch; g++) {
    const chess = new Chess();
    const board = new FastBoard();
    for (let i = 0; i < 100 && !chess.isGameOver(); i++) {
      const moves = chess.moves({ verbose: true });
      // Prefer the special moves so they get tested often.
      const special = moves.filter(m => /[kqep]/.test(m.flags));
      const move = special.length > 0 && random(3) === 0
        ? special[random(special.length)]
        : moves[random(moves.length)];
      chess.move(move);
      if (/[kq]/.test(move.flags)) castles++;
      if (move.flags.includes('e')) enPassants++;
      if (move.flags.includes('p')) promotions++;
      board.play(move.from + move.to + (move.promotion ?? ''));
      plies++;
      if (board.key() !== positionKey(chess.fen())) {
        firstMismatch = `after ${chess.history().join(' ')}: ${board.key()} vs ${positionKey(chess.fen())}`;
        break;
      }
    }
  }
  check('every position matches chess.js', firstMismatch === '', firstMismatch);
  check('the random games really reach castling', castles > 10, String(castles));
  check('…and en passant', enPassants > 3, String(enPassants));
  check('…and promotion', promotions > 3, String(promotions));
  check('…over plenty of moves', plies > 3000, String(plies));

  // A pinned pawn: the double step lands beside it, but it may not capture.
  const pinned = new Chess('1k6/8/8/8/1p6/8/P7/1R2K3 w - - 0 1');
  const pinnedBoard = new FastBoard(pinned.fen());
  pinned.move('a4');
  pinnedBoard.play('a2a4');
  check('a pinned pawn leaves no en passant square',
    pinnedBoard.key() === positionKey(pinned.fen()), `${pinnedBoard.key()} vs ${positionKey(pinned.fen())}`);

  // Lichess writes castling as king-takes-rook.
  const castled = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const lichess = new FastBoard(castled.fen());
  castled.move('O-O');
  lichess.play('e1h1');
  check('king-takes-rook castling is castling', lichess.key() === positionKey(castled.fen()), lichess.key());

  // A rook, not a king, going to the same square is an ordinary move.
  const rookMove = new FastBoard('4k3/8/8/8/8/8/8/4R2R w - - 0 1');
  rookMove.play('e1g1');
  check('a rook sliding along the back rank is not castling',
    rookMove.key() === '4k3/8/8/8/8/8/8/6RR b - -', rookMove.key());

  const opening = ['e2e4', 'e7e5', 'g1f3'];
  const keys = positionKeysAlong(opening, 2);
  check('keys are the positions BEFORE each move', keys.length === 2
    && keys[0] === positionKey(new Chess().fen()), keys.join(' | '));

  const damaged = positionKeysAlong(['e2e4', 'e2e4', 'g1f3'], 10);
  check('a damaged game stops where it breaks', damaged.length === 1, String(damaged.length));

  const after = new Chess();
  after.move('e4');
  check('one move from a position', keyAfterMove(new Chess().fen(), 'e2e4') === positionKey(after.fen()));
  check('an impossible move gives nothing', keyAfterMove(new Chess().fen(), 'e4e5') === null);

  return results;
}
