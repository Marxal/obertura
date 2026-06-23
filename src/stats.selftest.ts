// A runnable, network-free check of the Statistics aggregations in stats.ts —
// same spirit as progress.selftest.ts / analysis.selftest.ts. Surfaced in
// Settings → "Run statistics self-test" and in the headless npm run selftest.

import { Chess } from 'chess.js';
import type { ImportedGame } from './chesscom';
import type { Line } from './types';
import type { MoveNode } from './tree';
import { analyseGames } from './analysis';
import {
  masteredLines,
  needsWorkMoves,
  reviewBars,
  winRateByOpening,
  winRateOverTime,
  mostPlayedOpenings,
  bestScoringOpenings,
  worstScoringOpenings,
  puzzleTotals,
  puzzleAccuracyByOpening,
} from './stats';
import type { DayOutcome } from './streak';
import type { PuzzleDay, PuzzleOpeningTally } from './puzzle-log';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const DAY = 86400;

// Turn a SAN move list into a compact ImportedGame played at `endTime` (unix s).
let gameSeq = 0;
function game(
  opening: string | null,
  colour: 'white' | 'black',
  result: ImportedGame['result'],
  sanLine: string,
  endTime: number,
): ImportedGame {
  const chess = new Chess();
  const sans: string[] = [];
  const ucis: string[] = [];
  for (const san of sanLine.split(/\s+/).filter(Boolean)) {
    const m = chess.move(san);
    sans.push(m.san);
    ucis.push(m.from + m.to + (m.promotion ?? ''));
  }
  return {
    id: `g${++gameSeq}`, url: '', endTime,
    timeClass: 'blitz', timeControl: '180', rated: true,
    colour, result, opponent: 'foe', eco: null, opening,
    sans, ucis, plyCount: sans.length,
  };
}

// Build a single-mainline Line, optionally stamping per-move lapses (one entry
// per ply, in order) so needsWorkMoves has something to rank.
let lineSeq = 0;
function line(
  colour: 'white' | 'black',
  sanLine: string,
  opts: { name?: string; openingName?: string | null; confidence?: number; lapses?: number[] } = {},
): Line {
  const chess = new Chess();
  const root: MoveNode = { id: 'root', san: '', uci: '', fen: chess.fen(), children: [] };
  let cursor = root;
  let n = 0;
  const sans = sanLine.split(/\s+/).filter(Boolean);
  sans.forEach((san, i) => {
    const m = chess.move(san);
    const node: MoveNode = {
      id: `n${++n}`, san: m.san, uci: m.from + m.to + (m.promotion ?? ''),
      fen: chess.fen(), children: [],
    };
    const lapses = opts.lapses?.[i];
    if (lapses && lapses > 0) {
      node.review = { ease: 2.5, interval: 1, reps: 0, lapses, due: new Date() };
    }
    cursor.children.push(node);
    cursor = node;
  });
  return {
    id: `l${++lineSeq}`, name: opts.name ?? sanLine, tags: [], colour,
    openingName: opts.openingName ?? null,
    confidence: opts.confidence ?? 0,
    lastTrained: null,
    inTraining: true,
    tree: root,
  };
}

export function runStatsSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // 1. Mastered = confidence at the top of the scale.
  const lines = [
    line('white', 'e4 e5 Nf3', { confidence: 5 }),
    line('white', 'd4 d5 c4', { confidence: 3 }),
  ];
  check(
    'masteredLines picks only confidence-5 lines',
    masteredLines(lines).length === 1,
    `${masteredLines(lines).length} mastered of ${lines.length}`,
  );

  // 2. Needs-work ranks the most-lapsed USER move first; opponent moves and
  //    never-missed moves are excluded. White line: plies 0,2,4 are user moves.
  //    Stamp lapses on White's 1st move (1), Black's reply (9 — opponent, ignored)
  //    and White's 2nd move (3).
  const nw = needsWorkMoves([
    line('white', 'e4 e5 Nf3 Nc6 Bc4', { lapses: [1, 9, 3, 0, 0] }),
  ]);
  check(
    'needsWorkMoves ranks user moves by lapses, ignores opponent moves',
    nw.length === 2 && nw[0].lapses === 3 && nw[1].lapses === 1 &&
      nw.every(m => m.colour === 'white'),
    nw.map(m => `${m.san}:${m.lapses}`).join(' '),
  );

  // 3. The day series fills the range with zeroes and marks today; a logged day
  //    surfaces its counts.
  const today = new Date('2026-06-22T12:00:00');
  const log: DayOutcome[] = [{ day: '2026-06-22', remembered: 7, failed: 2 }];
  const week = reviewBars(log, 'week', today);
  const todayBar = week[week.length - 1];
  check(
    'reviewBars spans the week, marks today, fills zeroes',
    week.length === 7 &&
      todayBar.isToday && todayBar.remembered === 7 && todayBar.failed === 2 &&
      week[0].remembered === 0 && week[0].failed === 0,
    `${week.length} bars, today ${todayBar.remembered}/${todayBar.failed}`,
  );
  check(
    'reviewBars range lengths: week=7, month=30',
    reviewBars(log, 'week', today).length === 7 && reviewBars(log, 'month', today).length === 30,
    `week ${reviewBars(log, 'week', today).length}, month ${reviewBars(log, 'month', today).length}`,
  );
  // 'all' spans from the earliest logged day to today (Jun 1 → Jun 22 = 22 days).
  const allLog: DayOutcome[] = [
    { day: '2026-06-01', remembered: 1, failed: 0 },
    { day: '2026-06-22', remembered: 7, failed: 2 },
  ];
  const all = reviewBars(allLog, 'all', today);
  check(
    "reviewBars 'all' spans earliest-logged-day → today",
    all.length === 22 && all[0].day === '2026-06-01' && all[0].remembered === 1 &&
      all[all.length - 1].isToday,
    `${all.length} bars, first ${all[0].day}`,
  );

  // 4. Win rate over time buckets by month, oldest first. Two wins in one month,
  //    one loss the next → 100% then 0%.
  const mar = Date.parse('2026-03-10T00:00:00Z') / 1000;
  const apr = Date.parse('2026-04-10T00:00:00Z') / 1000;
  const trend = winRateOverTime([
    game('Italian Game', 'white', 'win', 'e4 e5 Nf3 Nc6 Bc4', mar),
    game('Italian Game', 'white', 'win', 'e4 e5 Nf3 Nc6 Bc4', mar + DAY),
    game('Italian Game', 'white', 'loss', 'e4 e5 Nf3 Nc6 Bc4', apr),
  ]);
  check(
    'winRateOverTime buckets months oldest-first with W-D-L and score',
    trend.length === 2 && trend[0].scorePct === 100 && trend[0].games === 2 &&
      trend[0].wins === 2 && trend[1].scorePct === 0 && trend[1].losses === 1 &&
      trend[0].startMs < trend[1].startMs,
    trend.map(p => `${p.label} ${p.scorePct}% (${p.wins}-${p.draws}-${p.losses})`).join(' → '),
  );

  // 5. Win-rate-by-opening joins my training mastery onto the games' family.
  const games = [
    game('Italian Game', 'white', 'win', 'e4 e5 Nf3 Nc6 Bc4 Bc5', mar),
    game('Italian Game', 'white', 'loss', 'e4 e5 Nf3 Nc6 Bc4 Bc5', mar + DAY),
  ];
  const myLines = [line('white', 'e4 e5 Nf3 Nc6 Bc4 Bc5', { openingName: 'Italian Game', confidence: 5 })];
  const stats = analyseGames(games, myLines).stats;
  const rows = winRateByOpening(stats, myLines);
  const italian = rows.find(r => r.family === 'Italian Game');
  check(
    'winRateByOpening joins training mastery to the games family',
    !!italian && italian.games === 2 && italian.scorePct === 50 &&
      italian.lineCount === 1 && italian.masteredCount === 1,
    italian ? `${italian.scorePct}% · ${italian.masteredCount}/${italian.lineCount} mastered` : 'no row',
  );

  // 6. Most-played leads with the bigger bucket; best-scoring needs enough games.
  const many = [
    ...Array.from({ length: 5 }, (_, i) => game('Sicilian Defense', 'white', 'win', 'e4 c5 Nf3 d6', mar + i * DAY)),
    ...Array.from({ length: 4 }, (_, i) => game('Italian Game', 'white', 'loss', 'e4 e5 Nf3 Nc6 Bc4', mar + i * DAY)),
  ];
  const allStats = analyseGames(many, []).stats;
  const most = mostPlayedOpenings(allStats);
  const best = bestScoringOpenings(allStats);
  const worst = worstScoringOpenings(allStats);
  check(
    'mostPlayed / bestScoring / worstScoring each lead with the right opening',
    most[0]?.family === 'Sicilian Defense' && best[0]?.family === 'Sicilian Defense' &&
      best[0]?.scorePct === 100 && worst[0]?.family === 'Italian Game' && worst[0]?.scorePct === 0,
    `most ${most[0]?.family}; best ${best[0]?.family} ${best[0]?.scorePct}%; worst ${worst[0]?.family} ${worst[0]?.scorePct}%`,
  );

  // 7. Puzzle totals respect the range and compute accuracy. Today + 10 days ago;
  //    'week' sees only today (8/2 → 80%), 'all' sees both (9/4 → 69%).
  const pToday = new Date('2026-06-22T12:00:00');
  const pDays: PuzzleDay[] = [
    { day: '2026-06-12', solved: 1, failed: 2 },
    { day: '2026-06-22', solved: 8, failed: 2 },
  ];
  const wk = puzzleTotals(pDays, 'week', pToday);
  const allP = puzzleTotals(pDays, 'all', pToday);
  check(
    'puzzleTotals: week window + accuracy',
    wk.solved === 8 && wk.failed === 2 && wk.attempts === 10 && wk.accuracyPct === 80,
    `week ${wk.solved}/${wk.attempts} = ${wk.accuracyPct}%`,
  );
  check(
    'puzzleTotals: all window sums everything',
    allP.solved === 9 && allP.attempts === 13 && allP.accuracyPct === 69,
    `all ${allP.solved}/${allP.attempts} = ${allP.accuracyPct}%`,
  );

  // 8. Accuracy by opening: readable name, accuracy, most-attempted first, and the
  //    `min` floor drops thin samples.
  const byOpening: PuzzleOpeningTally[] = [
    { angle: 'Sicilian_Defense', solved: 6, failed: 4 }, // 10 attempts, 60%
    { angle: 'Caro-Kann_Defense', solved: 2, failed: 0 }, // 2 attempts, 100%
    { angle: 'Italian_Game', solved: 1, failed: 0 },       // 1 attempt
  ];
  const byOp = puzzleAccuracyByOpening(byOpening, 2);
  check(
    'puzzleAccuracyByOpening: name, accuracy, order, min floor',
    byOp.length === 2 && byOp[0].family === 'Sicilian Defense' && byOp[0].accuracyPct === 60 &&
      byOp[1].family === 'Caro-Kann Defense' && byOp[1].accuracyPct === 100,
    byOp.map(r => `${r.family} ${r.accuracyPct}%`).join(', '),
  );

  return results;
}
