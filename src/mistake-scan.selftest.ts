// Pure checks of the mistake-retry detection core — no network, no engine, no
// storage. Feeds categorise/detectSpots synthetic eval trails and checks the
// four categories, their priority, the caps and the picking order.

import {
  categorise,
  detectSpots,
  pickSpots,
  collectSpots,
  countRetry,
  unscannedCount,
  needsRetryScan,
  carryTraining,
  RETRY_VERSION,
  replayGame,
  seedCacheFromAnalyses,
  capMistakeGamesForTier,
  MAX_SPOTS_PER_GAME,
} from './mistake-scan';
import type { MistakeSpot, SpotRef, CategoriseCtx } from './mistake-scan';
import { nextDailyTask, type DailyTaskId } from './daily-challenge';
import { flattenCp } from './winprob';
import type { ImportedGame, GameResult } from './import-core';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

// A minimal but type-complete stored game for the picking/counting checks.
function mkGame(id: string, endTime: number, spots?: MistakeSpot[]): ImportedGame {
  return {
    id, url: '', endTime,
    timeClass: 'blitz', timeControl: '300', rated: true,
    colour: 'white', result: 'loss', opponent: `opp-${id}`,
    eco: null, opening: null, sans: [], ucis: [], plyCount: 0,
    ...(spots ? { retry: { scannedAt: 1, version: 1, spots } } : {}),
  };
}

function mkSpot(id: string, category: MistakeSpot['category'], extra?: Partial<MistakeSpot>): MistakeSpot {
  return {
    id, ply: 8, category,
    preFen: 'start', playedSan: 'a3', playedUci: 'a2a3',
    best: [], evalBefore: 0, evalAfter: -400,
    ...extra,
  };
}

export function runMistakeScanSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  // ── categorise: the four flavours ───────────────────────────────────────────
  const cat = (c: Partial<CategoriseCtx> & { before: number; after: number }): string =>
    String(categorise({ ply: 8, result: 'loss', beforeOpp: 0, ...c }));

  check('opening blunder fires', cat({ before: 20, after: -400 }) === 'opening-blunder',
    cat({ before: 20, after: -400 }));
  check('opening blunder needs a lost game',
    cat({ before: 20, after: -400, result: 'win' as GameResult }) === 'null');
  check('opening blunder not from a draw',
    cat({ before: 20, after: -400, result: 'draw' as GameResult }) === 'null');
  check('past the opening the same move is a plain blunder',
    cat({ before: 20, after: -400, ply: 30 }) === 'blunder');

  check('punish-the-opening fires (drop path)',
    cat({ before: 200, after: 30, beforeOpp: 0, result: 'win' as GameResult }) === 'punish-opening');
  check('punish-the-opening fires (advantage-gone path)',
    cat({ before: 160, after: 45, beforeOpp: 0, result: 'win' as GameResult }) === 'punish-opening');
  check('punish needs the opponent gift',
    cat({ before: 200, after: 30, beforeOpp: 180, result: 'win' as GameResult }) === 'null');
  check('punish needs a previous opponent move',
    cat({ before: 200, after: 30, beforeOpp: null, result: 'win' as GameResult }) === 'null');
  check('keeping most of the edge is not a miss',
    cat({ before: 180, after: 140, beforeOpp: 0, result: 'win' as GameResult }) === 'null');

  check('missed win fires anywhere, any result',
    cat({ before: 300, after: 50, ply: 40, result: 'draw' as GameResult, beforeOpp: null }) === 'missed-win');
  check('missed win even in a game you went on to win',
    cat({ before: 400, after: -20, ply: 40, result: 'win' as GameResult, beforeOpp: null }) === 'missed-win');
  check('a held win is not a miss',
    cat({ before: 300, after: 150, ply: 40, result: 'draw' as GameResult, beforeOpp: null }) === 'null');
  check('punish outranks missed-win in the opening',
    cat({ before: 300, after: 40, beforeOpp: 20, result: 'win' as GameResult }) === 'punish-opening');

  check('plain blunder fires', cat({ before: -100, after: -400, ply: 30, beforeOpp: null }) === 'blunder');
  check('blunder needs a roughly equal start',
    cat({ before: -200, after: -800, ply: 30, beforeOpp: null }) === 'null');
  check('blunder needs a lost game',
    cat({ before: -100, after: -400, ply: 30, result: 'win' as GameResult, beforeOpp: null }) === 'null');
  check('a quiet equal move is nothing', cat({ before: 30, after: 10 }) === 'null');

  // Mate sentinels flow through without NaN.
  const mateBefore = flattenCp({ mate: 3 })!;
  check('missed forced mate → missed-win',
    cat({ before: mateBefore, after: -50, ply: 40, result: 'draw' as GameResult, beforeOpp: null }) === 'missed-win');
  const mated = categorise({ ply: 6, result: 'loss', before: 0, after: flattenCp({ mate: -2 })!, beforeOpp: 0 });
  check('blundering into mate classifies (no NaN)', mated === 'opening-blunder', String(mated));

  // ── detectSpots: trail walking ──────────────────────────────────────────────
  // White to train: quiet, quiet, then ply 4 throws the game.
  const whiteTrail = [20, 30, 25, 35, 20, -400, -380];
  const w = detectSpots({ colour: 'white', result: 'loss', trail: whiteTrail });
  check('white trail finds the one bad ply', w.length === 1 && w[0].ply === 4,
    JSON.stringify(w));
  check('white candidate is an opening blunder', w[0]?.category === 'opening-blunder');

  // Black plays the odd plies; the same story flipped (white-persp trail).
  const blackTrail = [20, -20, -25, -20, 400, 420, 410];
  const b = detectSpots({ colour: 'black', result: 'loss', trail: blackTrail });
  check('black trail flips perspective (ply 3)', b.length === 1 && b[0].ply === 3,
    JSON.stringify(b));

  // A null hole in the trail silences that ply instead of guessing.
  const holed = [...whiteTrail];
  holed[5] = null as unknown as number;
  const h = detectSpots({ colour: 'white', result: 'loss', trail: holed as (number | null)[] });
  check('null trail entries are skipped', h.length === 0, JSON.stringify(h));

  // Cap: four disasters, the three worst survive.
  const capTrail = [0, -300, 0, -400, 0, -600, 0, -1000, 0];
  const c = detectSpots({ colour: 'white', result: 'loss', trail: capTrail });
  check(`cap keeps ${MAX_SPOTS_PER_GAME}`, c.length === MAX_SPOTS_PER_GAME, String(c.length));
  check('cap keeps the worst drops first', c[0]?.ply === 6 && !c.some(s => s.ply === 0),
    JSON.stringify(c.map(s => s.ply)));

  // ── pickSpots / collectSpots / counts ───────────────────────────────────────
  const gOld = mkGame('old', 1000, [mkSpot('old#8', 'blunder', { fixed: true, lastTrained: 500 })]);
  const gMid = mkGame('mid', 2000, [mkSpot('mid#8', 'missed-win'), mkSpot('mid#20', 'blunder', { fixed: true, lastTrained: 100 })]);
  const gNew = mkGame('new', 3000, [mkSpot('new#8', 'blunder')]);
  const gUnscanned = mkGame('raw', 4000);
  const refs = collectSpots([gOld, gMid, gNew, gUnscanned]);
  check('collectSpots flattens scanned games', refs.length === 4, String(refs.length));

  const picked = pickSpots(refs, null, 3);
  check('unfixed first, newest game first',
    picked[0]?.spot.id === 'new#8' && picked[1]?.spot.id === 'mid#8',
    JSON.stringify(picked.map(p => p.spot.id)));
  check('fixed top-up is least-recently-trained',
    picked[2]?.spot.id === 'mid#20',
    JSON.stringify(picked.map(p => p.spot.id)));

  const blunders = pickSpots(refs, 'blunder', 5);
  check('category filter holds', blunders.length === 3 && blunders.every(r => r.spot.category === 'blunder'),
    JSON.stringify(blunders.map(p => p.spot.id)));
  check('count caps the picks', pickSpots(refs, null, 2).length === 2);

  // ── The rotation: a session must not deal the same spots every time ─────────
  {
    // Same game, same everything, except that two of the three have been met.
    const g = mkGame('g', 5000, [
      mkSpot('g#2', 'blunder', { attempts: 1, lastTrained: 900 }),
      mkSpot('g#4', 'blunder'),
      mkSpot('g#6', 'blunder', { attempts: 2, lastTrained: 100 }),
    ]);
    const order = pickSpots(collectSpots([g]), null, 3).map(r => r.spot.id);
    check('a spot never met leads', order[0] === 'g#4', order.join(','));
    check('then the one seen longest ago', order[1] === 'g#6', order.join(','));
    check('the one seen most recently comes last', order[2] === 'g#2', order.join(','));
  }

  {
    // Three games, three spots each. A session of three must be three DIFFERENT
    // games, not one game's whole scan.
    const many = [8000, 7000, 6000].map((t, i) => mkGame(`m${i}`, t, [
      mkSpot(`m${i}#2`, 'blunder'), mkSpot(`m${i}#4`, 'blunder'), mkSpot(`m${i}#6`, 'blunder'),
    ]));
    const session = pickSpots(collectSpots(many), null, 3);
    const games = new Set(session.map(r => r.game.id));
    check('a session spreads across games', games.size === 3,
      session.map(r => r.spot.id).join(','));
    const nine = pickSpots(collectSpots(many), null, 9);
    check('and never deals two from one game back to back',
      nine.every((r, i) => i === 0 || nine[i - 1].game.id !== r.game.id),
      nine.map(r => r.spot.id).join(','));
    check('everything is still dealt', nine.length === 9);
  }

  {
    // The complaint, reproduced: answer today's session without fixing anything,
    // and tomorrow's session must be different spots.
    const pool = [9000, 8000, 7000, 6000, 5000].map((t, i) =>
      mkGame(`d${i}`, t, [mkSpot(`d${i}#2`, 'blunder')]));
    const today = pickSpots(collectSpots(pool), null, 2);
    // Every answer stamps lastTrained, fixed or not (recordSpotResult).
    for (const r of today) r.spot.lastTrained = 1000;
    const tomorrow = pickSpots(collectSpots(pool), null, 2);
    const repeated = tomorrow.filter(r => today.some(t => t.spot.id === r.spot.id));
    check('tomorrow deals different spots', repeated.length === 0,
      `today ${today.map(r => r.spot.id)} → tomorrow ${tomorrow.map(r => r.spot.id)}`);
  }

  {
    // The shared rest (spot-rest.ts) outranks all three tiers: a never-met spot
    // that another exercise dealt an hour ago waits behind a spot you already
    // fixed. It still gets dealt when nothing else is left.
    const now = 1_000_000;
    const tomorrow = now + 24 * 60 * 60 * 1000;
    const pool = collectSpots([
      mkGame('r0', 9000, [mkSpot('r0#2', 'blunder')]),
      mkGame('r1', 8000, [mkSpot('r1#2', 'blunder', { fixed: true, lastTrained: 10 })]),
    ]);
    const dueAt = (id: string): number => (id === 'r0#2' ? tomorrow : 0);
    const one = pickSpots(pool, null, 1, dueAt, now).map(r => r.spot.id);
    check('a blunder answered in another exercise waits',
      one[0] === 'r1#2', one.join(','));
    const both = pickSpots(pool, null, 2, dueAt, now).map(r => r.spot.id);
    check('but it is still dealt rather than dropped',
      both.length === 2 && both[1] === 'r0#2', both.join(','));
  }

  const counts = countRetry([gOld, gMid, gNew, gUnscanned]);
  check('counts: spots and fixed', counts.spots === 4 && counts.fixed === 2,
    JSON.stringify(counts));
  check('counts: scanned x of y', counts.scanned === 3 && counts.total === 4);
  check('counts: per-category unfixed', counts.unfixedByCategory['blunder'] === 1
    && counts.unfixedByCategory['missed-win'] === 1, JSON.stringify(counts.unfixedByCategory));
  check('unscannedCount', unscannedCount([gOld, gMid, gNew, gUnscanned]) === 4,
    'scans written under an older version need re-reading too');
  const gCurrent = { ...gNew, retry: { ...gNew.retry!, version: RETRY_VERSION } };
  check('a current scan is not re-read', unscannedCount([gCurrent, gUnscanned]) === 1);
  check('needsRetryScan: never scanned', needsRetryScan(gUnscanned));
  check('needsRetryScan: stale version', needsRetryScan(gNew));
  check('needsRetryScan: current', !needsRetryScan(gCurrent));

  // A re-read must not cost the user what they earned: same ply, same id, so
  // the fixed mark and the attempt count come across.
  {
    const before = [mkSpot('g#4', 'blunder', { fixed: true, attempts: 3, lastTrained: 99 })];
    const after = carryTraining(before, [mkSpot('g#4', 'blunder'), mkSpot('g#9', 'missed-win')]);
    check('a rescan keeps a fixed spot fixed',
      after[0].fixed === true && after[0].attempts === 3 && after[0].lastTrained === 99);
    check('a newly-found spot starts clean', after[1].fixed === undefined);
    check('carryTraining with nothing to carry is a pass-through',
      carryTraining(undefined, after).length === 2);
  }

  // ── seedCacheFromAnalyses (reusing the analyser's saved evals) ──────────────
  const analysedGame = {
    analysis: {
      tree: {
        id: 'root', san: '', uci: '', fen: 'startfen',
        children: [{
          id: 'a', san: 'e4', uci: 'e2e4', fen: 'fen-1', evalCp: 30,
          children: [
            { id: 'b', san: 'e5', uci: 'e7e5', fen: 'fen-2', evalCp: 25, children: [] },
            // A variation (children[1]) — the seed walks the MAINLINE only.
            { id: 'v', san: 'c5', uci: 'c7c5', fen: 'fen-var', evalCp: 40, children: [] },
          ],
        }],
      },
      engine: 'lichess' as const,
      reviewedAt: 1,
    },
  };
  const seedCache = new Map<string, number | null>([['fen-2', -999]]);
  const seeded = seedCacheFromAnalyses([analysedGame, {}], seedCache);
  check('seed: mainline evals land in the cache', seeded === 1 && seedCache.get('fen-1') === 30,
    `seeded=${seeded}`);
  check('seed: existing cache entries win', seedCache.get('fen-2') === -999);
  check('seed: variations and eval-less nodes are skipped',
    !seedCache.has('fen-var') && !seedCache.has('startfen'));

  // ── replayGame ──────────────────────────────────────────────────────────────
  const fools = replayGame({ ucis: ['f2f3', 'e7e5', 'g2g4', 'd8h4'], sans: [] });
  check('replay via ucis', fools !== null && fools.fens.length === 5 && fools.sans[3] === 'Qh4#',
    JSON.stringify(fools?.sans));
  check('replay falls back to SAN', replayGame({ ucis: [], sans: ['e4', 'e5'] })?.fens.length === 3);
  check('garbage moves → null', replayGame({ ucis: ['e2e5'], sans: [] }) === null);

  // ── capMistakeGamesForTier (the free-tier view cap) ─────────────────────────
  {
    // gA is newest with two unfixed spots, gB is older with one unfixed spot.
    const gA = mkGame('a', 3000, [mkSpot('a#1', 'blunder'), mkSpot('a#2', 'blunder')]);
    const gB = mkGame('b', 2000, [mkSpot('b#1', 'blunder')]);
    const beforeSnapshot = JSON.stringify([gA, gB]);
    const originalASpots = gA.retry!.spots;
    const originalBSpots = gB.retry!.spots;

    const capped = capMistakeGamesForTier([gA, gB], 50, 2);
    const visibleIds = capped.games.flatMap(g => g.retry!.spots.map(s => s.id));
    check('cap keeps only the N most recent unfixed spots',
      visibleIds.length === 2 && visibleIds.includes('a#1') && visibleIds.includes('a#2'),
      JSON.stringify(visibleIds));
    check('the oldest game\'s spot is the one hidden', !visibleIds.includes('b#1'));
    check('capped=true once something is actually hidden', capped.capped === true);

    // Clone safety: the source games and their spot arrays are byte-for-byte
    // unchanged, and a trimmed game's spots array is a NEW array, never the
    // one storage holds a reference to.
    check('source games are never mutated', JSON.stringify([gA, gB]) === beforeSnapshot);
    check('gA needed no trimming → returned by reference (nothing to protect)',
      capped.games[0] === gA && capped.games[0].retry!.spots === originalASpots);
    check('gB WAS trimmed → a new game object with a new spots array',
      capped.games[1] !== gB && capped.games[1].retry!.spots !== originalBSpots);
    check('the original gB.retry.spots array is untouched', gB.retry!.spots === originalBSpots
      && gB.retry!.spots.length === 1, JSON.stringify(gB.retry!.spots));

    // Rolling: fixing the newest game's spot frees a slot, and the previously
    // hidden spot (b#1) surfaces on the next render — no re-scan needed.
    gA.retry!.spots[0].fixed = true; // simulates a real drill fix (mutates the fixture, not the cap's output)
    const afterFix = capMistakeGamesForTier([gA, gB], 50, 2);
    const unfixedAfterFix = afterFix.games.flatMap(g => g.retry!.spots.filter(s => !s.fixed).map(s => s.id));
    check('fixing a spot frees a slot for the next one in line',
      unfixedAfterFix.includes('b#1'), JSON.stringify(unfixedAfterFix));
    check('the fixed spot itself stays visible (fixed spots are never hidden)',
      afterFix.games.flatMap(g => g.retry!.spots.map(s => s.id)).includes('a#1'));
    check('cap goes quiet once nothing is left to hide', afterFix.capped === false);

    // The 50-game window itself: a third, much older game beyond the window
    // is dropped entirely and trips `capped` even with room to spare on spots.
    const gOldWindow = mkGame('old-window', 1, [mkSpot('old-window#1', 'blunder', { fixed: true })]);
    const windowed = capMistakeGamesForTier([gA, gB, gOldWindow], 2, 10);
    check('games outside the window are dropped', windowed.games.every(g => g.id !== 'old-window'));
    check('window truncation alone marks capped=true', windowed.capped === true);
  }

  // ── nextDailyTask (the "Next challenge →" chain) ────────────────────────────
  const day = (over: Partial<Record<DailyTaskId, boolean>>) => ({
    lines: false, positions: false, puzzles: false, endgames: false,
    mistakes: false, detective: false, whichMove: false, growLines: false,
    ...over,
  });
  const ALL: DailyTaskId[] = ['lines', 'positions', 'puzzles', 'endgames', 'mistakes'];
  const NO_MISTAKES: DailyTaskId[] = ['lines', 'positions', 'puzzles', 'endgames'];
  check('fresh day starts with lines', nextDailyTask(day({}), ALL) === 'lines');
  check('card order holds', nextDailyTask(day({ lines: true }), ALL) === 'positions');
  check('puzzles after positions', nextDailyTask(day({ lines: true, positions: true }), ALL) === 'puzzles');
  check('endgames after puzzles',
    nextDailyTask(day({ lines: true, positions: true, puzzles: true }), ALL) === 'endgames');
  check('mistakes close the chain',
    nextDailyTask(day({ lines: true, positions: true, puzzles: true, endgames: true }), ALL) === 'mistakes');
  check('inactive tasks are skipped',
    nextDailyTask(day({ lines: true, positions: true, puzzles: true, endgames: true }), NO_MISTAKES) === null);
  check('all done → null',
    nextDailyTask(day({ lines: true, positions: true, puzzles: true, endgames: true, mistakes: true }), ALL) === null);

  // The two from-your-games parts added after the original five sit at the end
  // of the chain, in card order.
  const EVERY: DailyTaskId[] = [...ALL, 'detective', 'whichMove'];
  check('detective follows the mistake retry',
    nextDailyTask(day({ lines: true, positions: true, puzzles: true, endgames: true, mistakes: true }), EVERY)
      === 'detective');
  check('which move closes the chain',
    nextDailyTask(
      day({ lines: true, positions: true, puzzles: true, endgames: true, mistakes: true, detective: true }),
      EVERY) === 'whichMove');

  return results;
}
