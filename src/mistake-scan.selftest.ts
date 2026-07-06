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
  replayGame,
  seedCacheFromAnalyses,
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

  const counts = countRetry([gOld, gMid, gNew, gUnscanned]);
  check('counts: spots and fixed', counts.spots === 4 && counts.fixed === 2,
    JSON.stringify(counts));
  check('counts: scanned x of y', counts.scanned === 3 && counts.total === 4);
  check('counts: per-category unfixed', counts.unfixedByCategory['blunder'] === 1
    && counts.unfixedByCategory['missed-win'] === 1, JSON.stringify(counts.unfixedByCategory));
  check('unscannedCount', unscannedCount([gOld, gMid, gNew, gUnscanned]) === 1);

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

  // ── nextDailyTask (the daily "Next task →" chain) ───────────────────────────
  const day = (over: Partial<Record<DailyTaskId, boolean>>) =>
    ({ lines: false, positions: false, puzzles: false, endgames: false, mistakes: false, ...over });
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

  return results;
}
