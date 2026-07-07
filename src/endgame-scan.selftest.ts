import {
  firstEndgameSpot, isEndgameToMove, didConvert, outcomeFromEval,
  SCAN_MAX_PIECES,
} from './endgame-scan';
import { TABLEBASE_MAX_PIECES } from './lichess-tablebase';

// Checks the pure "from your games" detection core: spotting the first endgame
// position (≤10 pieces, with the ≤7 tablebase band as the fallback threshold) on
// your move, reading a clear engine verdict, and whether a game kept the result
// on offer. The storage-backed scanEndgames (engine + network + IndexedDB) isn't
// exercised here.

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

// A tiny endgame: white K+R+P vs black K (4 pieces), white to move.
const EG_WHITE = '4k3/8/8/8/8/8/4P3/4K1R1 w - - 0 1';
// A 9-piece endgame (white K+R+3P vs black K+R+2P): outside tablebase range,
// inside the widened scan range.
const EG_NINE = '4k3/pp6/8/3r4/8/8/PPP4R/4K3 w - - 0 1';

export function runEndgameScanSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  // isEndgameToMove: ≤N pieces AND the right side to move.
  check('endgame, white to move → true for white', isEndgameToMove(EG_WHITE, 'white') === true);
  check('endgame, white to move → false for black', isEndgameToMove(EG_WHITE, 'black') === false);
  check('full start position → false', isEndgameToMove(
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'white') === false);

  // The widened band: 9 pieces is an endgame for the scan (≤10) but NOT for the
  // tablebase threshold (≤7).
  check('scan threshold is wider than the tablebase', SCAN_MAX_PIECES > TABLEBASE_MAX_PIECES);
  check('9 pieces → endgame at scan threshold', isEndgameToMove(EG_NINE, 'white') === true);
  check('9 pieces → not at tablebase threshold',
    isEndgameToMove(EG_NINE, 'white', TABLEBASE_MAX_PIECES) === false);

  // firstEndgameSpot from the standard start: a normal opening never reaches ≤10.
  const opening = firstEndgameSpot(['e2e4', 'e7e5', 'g1f3', 'b8c6'], 'white');
  check('normal opening → no endgame spot', opening === null, `got ${JSON.stringify(opening)}`);

  // From a near-endgame start, it's found immediately at ply 0 for the side to move.
  const now = firstEndgameSpot([], 'white', EG_WHITE);
  check('already an endgame → ply 0', now?.ply === 0, `got ${JSON.stringify(now)}`);
  check('ply 0 carries the start fen', now?.fen === EG_WHITE);

  // A 9-piece start is found at the scan threshold but not at the tablebase one.
  const nine = firstEndgameSpot([], 'white', EG_NINE);
  check('9-piece start found at scan threshold', nine?.ply === 0, `got ${JSON.stringify(nine)}`);
  const nineTight = firstEndgameSpot([], 'white', EG_NINE, TABLEBASE_MAX_PIECES);
  check('9-piece start not found at tablebase threshold', nineTight === null,
    `got ${JSON.stringify(nineTight)}`);

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

  // outcomeFromEval: engine cp/mate values are white-perspective; the verdict is
  // read from YOUR side and only clear margins count.
  check('big white edge → win for white',
    outcomeFromEval({ uci: 'a1a2', san: 'Ra2', cp: 300 }, 'white') === 'win');
  check('big white edge → murky-null for black',
    outcomeFromEval({ uci: 'a1a2', san: 'Ra2', cp: 300 }, 'black') === null);
  check('big black edge → win for black',
    outcomeFromEval({ uci: 'a1a2', san: 'Ra2', cp: -300 }, 'black') === 'win');
  check('level eval → draw either way',
    outcomeFromEval({ uci: 'a1a2', san: 'Ra2', cp: 10 }, 'white') === 'draw' &&
    outcomeFromEval({ uci: 'a1a2', san: 'Ra2', cp: -10 }, 'black') === 'draw');
  check('murky +1.5 → null (falls back to tablebase)',
    outcomeFromEval({ uci: 'a1a2', san: 'Ra2', cp: 150 }, 'white') === null);
  check('losing eval → null',
    outcomeFromEval({ uci: 'a1a2', san: 'Ra2', cp: -300 }, 'white') === null);
  check('mate for you → win',
    outcomeFromEval({ uci: 'a1a2', san: 'Ra2', mate: 3 }, 'white') === 'win');
  check('mate against you → null',
    outcomeFromEval({ uci: 'a1a2', san: 'Ra2', mate: -3 }, 'white') === null);
  check('no eval at all → null',
    outcomeFromEval({ uci: 'a1a2', san: 'Ra2' }, 'white') === null);
  check('no line at all → null', outcomeFromEval(undefined, 'white') === null);

  // didConvert: a win must be won; a draw is kept by a win or a draw, lost by a loss.
  check('win available, won → converted', didConvert('win', 'win') === true);
  check('win available, drawn → not converted', didConvert('win', 'draw') === false);
  check('win available, lost → not converted', didConvert('win', 'loss') === false);
  check('draw available, drawn → converted', didConvert('draw', 'draw') === true);
  check('draw available, won → converted', didConvert('draw', 'win') === true);
  check('draw available, lost → not converted', didConvert('draw', 'loss') === false);

  return results;
}
