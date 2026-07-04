import { firstEndgameSpot, isEndgameToMove, didConvert } from './endgame-scan';

// Checks the pure "from your games" detection core: spotting the first ≤7-piece
// position on your move, and reading whether a game kept the result on offer. The
// storage-backed scanEndgames (network + IndexedDB) isn't exercised here.

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

// A tiny endgame: white K+R+P vs black K (4 pieces), white to move.
const EG_WHITE = '4k3/8/8/8/8/8/4P3/4K1R1 w - - 0 1';

export function runEndgameScanSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  // isEndgameToMove: ≤7 pieces AND the right side to move.
  check('endgame, white to move → true for white', isEndgameToMove(EG_WHITE, 'white') === true);
  check('endgame, white to move → false for black', isEndgameToMove(EG_WHITE, 'black') === false);
  check('full start position → false', isEndgameToMove(
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'white') === false);

  // firstEndgameSpot from the standard start: a normal opening never reaches ≤7.
  const opening = firstEndgameSpot(['e2e4', 'e7e5', 'g1f3', 'b8c6'], 'white');
  check('normal opening → no endgame spot', opening === null, `got ${JSON.stringify(opening)}`);

  // From a near-endgame start, it's found immediately at ply 0 for the side to move.
  const now = firstEndgameSpot([], 'white', EG_WHITE);
  check('already an endgame → ply 0', now?.ply === 0, `got ${JSON.stringify(now)}`);
  check('ply 0 carries the start fen', now?.fen === EG_WHITE);

  // For the side NOT to move with no moves left, there's no spot to hand them.
  const none = firstEndgameSpot([], 'black', EG_WHITE);
  check('never your move → null', none === null, `got ${JSON.stringify(none)}`);

  // After one white move it becomes black's move, still an endgame → ply 1.
  const afterOne = firstEndgameSpot(['g1g2'], 'black', EG_WHITE);
  check('found on the next ply for the other side', afterOne?.ply === 1, `got ${JSON.stringify(afterOne)}`);

  // A malformed move (reached before any match, since black isn't to move at
  // ply 0 here) bails to null rather than throwing.
  const bad = firstEndgameSpot(['zzzz'], 'black', EG_WHITE);
  check('malformed move → null', bad === null, `got ${JSON.stringify(bad)}`);

  // didConvert: a win must be won; a draw is kept by a win or a draw, lost by a loss.
  check('win available, won → converted', didConvert('win', 'win') === true);
  check('win available, drawn → not converted', didConvert('win', 'draw') === false);
  check('win available, lost → not converted', didConvert('win', 'loss') === false);
  check('draw available, drawn → converted', didConvert('draw', 'draw') === true);
  check('draw available, won → converted', didConvert('draw', 'win') === true);
  check('draw available, lost → not converted', didConvert('draw', 'loss') === false);

  return results;
}
