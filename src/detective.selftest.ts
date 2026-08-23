// Pure checks of the Blunder-detective window finder — no network, no engine,
// no storage. It feeds synthetic eval trails to findDetectiveWindows and holds
// it to the one rule the whole exercise rests on: a run contains exactly one
// blunder, and nothing else in it is even arguable.

import {
  findDetectiveWindows,
  chooseDetectiveWindow,
  moveDrop,
  winBefore,
  pickDetective,
  readyDetectiveCount,
  collectDetectiveSpots,
  hashString,
  BLUNDER_DROP,
  QUIET_DROP,
  RUN_MIN_MOVES,
  RUN_MAX_MOVES,
  MIN_START_PLY,
  type DetectiveRef,
  type DetectiveSpot,
} from './detective';
import type { ImportedGame } from './import-core';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

// A flat, dead-level trail of `n` positions — every move costs nothing at all.
function levelTrail(n: number): (number | null)[] {
  return new Array(n).fill(0);
}

/**
 * Drop `win` win-probability at ply `p` of a level trail, in the MOVER's
 * favour-losing direction. The trail is white-perspective, so a black blunder
 * has to move the number the other way — which is exactly the sign bug this
 * whole helper exists to make visible.
 */
function blunderAt(trail: (number | null)[], p: number, cp: number): void {
  const sign = p % 2 === 0 ? 1 : -1;
  for (let i = p + 1; i < trail.length; i++) trail[i] = -sign * cp;
}

function mkGame(id: string, endTime: number, spot?: DetectiveSpot): ImportedGame {
  return {
    id, url: '', endTime,
    timeClass: 'blitz', timeControl: '300', rated: true,
    colour: 'white', result: 'loss', opponent: `opp-${id}`,
    eco: null, opening: null, sans: [], ucis: [], plyCount: 0,
    ...(spot ? { retry: { scannedAt: 1, version: 2, spots: [], detective: spot } } : {}),
  };
}

function mkSpot(id: string, byUser: boolean): DetectiveSpot {
  return {
    id, startPly: 10, plies: 6, blunderPly: 13, byUser,
    preFen: '', playedSan: 'Nxe4', playedUci: 'f6e4',
    best: [], evalBefore: 20, evalAfter: -400,
  };
}

export function runDetectiveSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail: detail || (pass ? 'ok' : 'failed') });
  };

  // ── moveDrop: perspective and gaps ──────────────────────────────────────────
  {
    // White to move at ply 0, eval falls from 0 to −300 → White lost a lot.
    const t = [0, -300];
    const d = moveDrop(t, 0);
    check('a white move that tanks the eval is a white drop',
      (d ?? 0) >= BLUNDER_DROP, `drop=${d?.toFixed(3)}`);
    // The same numbers at ply 1 are BLACK's move — and −300 is good for Black.
    const t2 = [0, 0, -300];
    const d2 = moveDrop(t2, 1);
    check('the same fall is a black GAIN at an odd ply', (d2 ?? 0) < 0, `drop=${d2?.toFixed(3)}`);
    check('a missing eval is never guessed at', moveDrop([null, 0], 0) === null);
    check('a missing eval after the move is null too', moveDrop([0, null], 0) === null);
    check('winBefore reads the mover’s side', (winBefore([300, 0], 0) ?? 0) > 0.5);
    check('winBefore flips for black', (winBefore([0, 300], 1) ?? 1) < 0.5);
  }

  // ── One blunder, cleanly surrounded ────────────────────────────────────────
  {
    const trail = levelTrail(20);
    blunderAt(trail, 9, 500);
    const windows = findDetectiveWindows(trail);
    check('a lone blunder produces runs', windows.length > 0, `${windows.length} runs`);
    check('every run names that blunder', windows.every(w => w.blunderPly === 9));
    check('runs are 4–6 moves',
      windows.every(w => w.plies >= RUN_MIN_MOVES && w.plies <= RUN_MAX_MOVES));
    check('the blunder is never the run’s first move',
      windows.every(w => w.blunderPly > w.startPly));
    check('the blunder is always inside the run',
      windows.every(w => w.blunderPly < w.startPly + w.plies));
    check('no run starts before MIN_START_PLY',
      windows.every(w => w.startPly >= MIN_START_PLY));
    check('the longest run leads', windows[0].plies === RUN_MAX_MOVES);
  }

  // ── Two blunders: only runs that isolate one ───────────────────────────────
  {
    const trail = levelTrail(24);
    blunderAt(trail, 9, 500);
    // The opponent hands it straight back two plies later.
    const sign = 10 % 2 === 0 ? 1 : -1;
    for (let i = 11; i < trail.length; i++) trail[i] = trail[i]! - sign * 900;
    const windows = findDetectiveWindows(trail);
    const bad = windows.filter(w =>
      w.startPly <= 10 && 10 < w.startPly + w.plies && w.blunderPly !== 10);
    check('no run ever contains a second blunder', bad.length === 0,
      `${bad.length} runs held two`);
    for (const w of windows) {
      const others: number[] = [];
      for (let i = w.startPly; i < w.startPly + w.plies; i++) {
        if (i === w.blunderPly) continue;
        others.push(moveDrop(trail, i) ?? 1);
      }
      if (others.some(d => d >= QUIET_DROP)) {
        check('every other move in a run is quiet', false, `run at ${w.startPly} was noisy`);
        break;
      }
    }
    check('every other move in a run is quiet', true);
  }

  // ── Adjacent blunders cancel each other out ────────────────────────────────
  {
    // Two blunders three plies apart: no 4-move run can hold one without the
    // other, so the finder must offer nothing rather than something arguable.
    const trail = levelTrail(20);
    blunderAt(trail, 8, 600);
    const sign = 9 % 2 === 0 ? 1 : -1;
    for (let i = 10; i < trail.length; i++) trail[i] = trail[i]! - sign * 1400;
    const windows = findDetectiveWindows(trail);
    const tooClose = windows.filter(w =>
      w.startPly <= 8 && 8 < w.startPly + w.plies &&
      w.startPly <= 9 && 9 < w.startPly + w.plies);
    check('neighbouring blunders never share a run', tooClose.length === 0);
  }

  // ── A gap in the trail poisons the runs that cross it ──────────────────────
  {
    const trail = levelTrail(20);
    blunderAt(trail, 9, 500);
    trail[6] = null; // the cloud and the engine both missed this one
    const windows = findDetectiveWindows(trail);
    const crossing = windows.filter(w => w.startPly <= 6 && 6 <= w.startPly + w.plies);
    check('a run never spans an unknown position', crossing.length === 0,
      `${crossing.length} runs crossed the gap`);
    check('runs after the gap still exist', windows.length > 0);
  }

  // ── A blunder from an already-lost position isn't one ──────────────────────
  {
    const trail = new Array(20).fill(-900); // white is dead lost throughout
    blunderAt(trail, 8, 3000);              // …and makes it worse on their move
    const windows = findDetectiveWindows(trail);
    check('nothing is offered when the blunderer was already lost', windows.length === 0);
  }

  // ── Below the bar is not a blunder ─────────────────────────────────────────
  {
    const trail = levelTrail(20);
    // A ~15% drop: a mistake, not a blunder.
    blunderAt(trail, 9, 90);
    const drop = moveDrop(trail, 9) ?? 0;
    const windows = findDetectiveWindows(trail);
    check('a drop under the bar is never the answer',
      drop < BLUNDER_DROP && windows.length === 0, `drop=${drop.toFixed(3)}`);
  }

  // ── chooseDetectiveWindow: stable, and spread across a library ─────────────
  {
    const trail = levelTrail(24);
    blunderAt(trail, 11, 500);
    const windows = findDetectiveWindows(trail);
    const a = chooseDetectiveWindow(windows, 'game-abc');
    const b = chooseDetectiveWindow(windows, 'game-abc');
    check('the same game always gets the same run',
      !!a && !!b && a.startPly === b.startPly && a.plies === b.plies);
    const offsets = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const w = chooseDetectiveWindow(windows, `game-${i}`);
      if (w) offsets.add(w.blunderPly - w.startPly);
    }
    check('the blunder does not always sit in the same place', offsets.size > 1,
      `${offsets.size} distinct positions`);
    check('choosing from nothing is null', chooseDetectiveWindow([], 'x') === null);
    check('the hash is stable', hashString('abc') === hashString('abc'));
  }

  // ── pickDetective: alternates sides, respects the rest log ─────────────────
  {
    const refs: DetectiveRef[] = [
      { game: mkGame('g1', 10), spot: mkSpot('g1#d1', true) },
      { game: mkGame('g2', 9), spot: mkSpot('g2#d1', true) },
      { game: mkGame('g3', 8), spot: mkSpot('g3#d1', true) },
      { game: mkGame('g4', 7), spot: mkSpot('g4#d1', false) },
      { game: mkGame('g5', 6), spot: mkSpot('g5#d1', false) },
    ];
    const picked = pickDetective(refs, 4, () => 0, 1000);
    const sides = picked.map(r => r.spot.byUser);
    check('sides alternate while both last',
      sides[0] !== sides[1] && sides[1] !== sides[2] && sides[2] !== sides[3],
      sides.join(','));
    check('a short pool still fills the session', pickDetective(refs, 5, () => 0, 1000).length === 5);

    const due: Record<string, number> = { 'g1#d1': 5000, 'g2#d1': 5000 };
    const rested = pickDetective(refs, 5, id => due[id] ?? 0, 1000);
    check('every fresh case is dealt before any resting one',
      rested.slice(0, 3).every(r => !due[r.spot.id]), rested.map(r => r.spot.id).join(','));
    check('resting cases still fill a session that needs them', rested.length === 5);
    check('ready count ignores the resting ones',
      readyDetectiveCount(refs, id => due[id] ?? 0, 1000) === 3);
  }

  // ── collectDetectiveSpots reads only what the scan stored ─────────────────
  {
    const games = [mkGame('a', 1, mkSpot('a#d5', true)), mkGame('b', 2)];
    const found = collectDetectiveSpots(games);
    check('only scanned games contribute a run',
      found.length === 1 && found[0].spot.id === 'a#d5');
  }

  return results;
}
