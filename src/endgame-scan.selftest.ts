import {
  firstEndgameSpot, isEndgameToMove, didConvert, outcomeFromEval,
  capEndgameGamesForTier, endgameSpotId,
  SCAN_MAX_PIECES,
} from './endgame-scan';
import type { EndgameSpot } from './endgame-scan';
import { TABLEBASE_MAX_PIECES } from './lichess-tablebase';
import type { EndgameProgress } from './endgame-progress';
import type { ImportedGame } from './import-core';

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

// A minimal but type-complete stored game for the free-tier cap checks.
function mkGame(id: string, endTime: number, spots?: EndgameSpot[]): ImportedGame {
  return {
    id, url: '', endTime,
    timeClass: 'blitz', timeControl: '300', rated: true,
    colour: 'white', result: 'loss', opponent: `opp-${id}`,
    eco: null, opening: null, sans: [], ucis: [], plyCount: 0,
    ...(spots ? { endgame: { scannedAt: 1, version: 1, spots } } : {}),
  };
}

function mkSpot(ply: number, outcome: EndgameSpot['outcome'] = 'win'): EndgameSpot {
  return { ply, fen: 'start', youPlay: 'white', outcome, converted: false };
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

  // ── capEndgameGamesForTier (the free-tier view cap) ──────────────────────────
  {
    // gA is newest with two unplayed spots (ply 10, 20), gB is older with one
    // unplayed spot (ply 30). No play-out records at all yet.
    const gA = mkGame('a', 3000, [mkSpot(10), mkSpot(20)]);
    const gB = mkGame('b', 2000, [mkSpot(30)]);
    const noProgress: EndgameProgress = {};
    const beforeSnapshot = JSON.stringify([gA, gB]);
    const originalASpots = gA.endgame!.spots;
    const originalBSpots = gB.endgame!.spots;

    const capped = capEndgameGamesForTier([gA, gB], 50, 2, noProgress);
    const visibleIds = capped.games.flatMap(g => g.endgame!.spots.map(s => endgameSpotId(g.id, s.ply)));
    check('cap keeps only the N most recent unplayed spots',
      visibleIds.length === 2 && visibleIds.includes(endgameSpotId('a', 10)) && visibleIds.includes(endgameSpotId('a', 20)),
      JSON.stringify(visibleIds));
    check('the oldest game\'s spot is the one hidden', !visibleIds.includes(endgameSpotId('b', 30)));
    check('capped=true once something is actually hidden', capped.capped === true);

    // Clone safety, same guarantee as capMistakeGamesForTier.
    check('source games are never mutated', JSON.stringify([gA, gB]) === beforeSnapshot);
    check('gA needed no trimming → returned by reference',
      capped.games[0] === gA && capped.games[0].endgame!.spots === originalASpots);
    check('gB WAS trimmed → a new game object with a new spots array',
      capped.games[1] !== gB && capped.games[1].endgame!.spots !== originalBSpots);
    check('the original gB.endgame.spots array is untouched',
      gB.endgame!.spots === originalBSpots && gB.endgame!.spots.length === 1);

    // Rolling: playing out gA's ply-10 spot at least once frees a slot, and
    // the previously hidden gB spot surfaces — no re-scan needed.
    const playedOnce: EndgameProgress = {
      [endgameSpotId('a', 10)]: { solved: false, attempts: 1, lastTrained: 1 },
    };
    const afterPlay = capEndgameGamesForTier([gA, gB], 50, 2, playedOnce);
    const idsAfterPlay = afterPlay.games.flatMap(g => g.endgame!.spots.map(s => endgameSpotId(g.id, s.ply)));
    check('playing a spot frees a slot for the next one in line',
      idsAfterPlay.includes(endgameSpotId('b', 30)), JSON.stringify(idsAfterPlay));
    check('the played spot itself stays visible (played ones are never hidden)',
      idsAfterPlay.includes(endgameSpotId('a', 10)));
    check('cap goes quiet once nothing is left to hide', afterPlay.capped === false);

    // The game window itself: a third, much older game beyond the window is
    // dropped entirely and trips `capped` even with room to spare on spots.
    const gOldWindow = mkGame('old-window', 1, [mkSpot(5)]);
    const windowed = capEndgameGamesForTier([gA, gB, gOldWindow], 2, 10, noProgress);
    check('games outside the window are dropped', windowed.games.every(g => g.id !== 'old-window'));
    check('window truncation alone marks capped=true', windowed.capped === true);
  }

  return results;
}
