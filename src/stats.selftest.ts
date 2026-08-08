// A runnable, network-free check of the Statistics aggregations in stats.ts —
// same spirit as progress.selftest.ts / analysis.selftest.ts. Surfaced in
// Settings → "Run statistics self-test" and in the headless npm run selftest.

import { Chess } from 'chess.js';
import type { ImportedGame } from './chesscom';
import type { Line } from './types';
import type { MoveNode } from './tree';
import { analyseGames, familyKey } from './analysis';
import {
  masteredLines,
  needsWorkMoves,
  lineRecall,
  lineTrainingCount,
  reviewBars,
  moveMemory,
  memoryByOpening,
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

// Build a single-mainline Line, optionally stamping per-move review state (one
// entry per ply, in order) so needsWorkMoves and lineRecall have something to
// rank: `lapses` is the lifetime miss count, `reps` the consecutive clean
// recalls (>0 = remembered last time), `notes` a written reminder.
let lineSeq = 0;
function line(
  colour: 'white' | 'black',
  sanLine: string,
  opts: {
    name?: string;
    openingName?: string | null;
    confidence?: number;
    lapses?: number[];
    reps?: (number | undefined)[];   // holes = opponent plies, left untrained
    notes?: (string | undefined)[];
  } = {},
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
    const lapses = opts.lapses?.[i] ?? 0;
    const reps = opts.reps?.[i];
    // A review block means "drilled at least once" — stamp one whenever either
    // figure is given, so a clean-but-trained move (reps > 0, no lapses) exists.
    if (lapses > 0 || reps !== undefined) {
      node.review = { ease: 2.5, interval: 1, reps: reps ?? 0, lapses, due: new Date() };
    }
    const note = opts.notes?.[i];
    if (note) node.note = note;
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

  // 2b. Each needs-work row carries what a board / Fix it drill needs: the
  //     position BEFORE the move, its uci, and whether a note has been written.
  //     White's first move starts from the initial position.
  const nwDetail = needsWorkMoves([
    line('white', 'e4 e5 Nf3', { lapses: [2, 0, 4], notes: [undefined, undefined, 'develop first'] }),
  ]);
  const first = nwDetail.find(m => m.san === 'e4');
  const third = nwDetail.find(m => m.san === 'Nf3');
  check(
    'needsWorkMoves carries preFen, uci and the note flag',
    !!first && !!third
      && first.preFen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w')
      && first.uci === 'e2e4' && first.hasNote === false
      && third.uci === 'g1f3' && third.hasNote === true
      && third.preFen.includes(' w '),
    nwDetail.map(m => `${m.san}:${m.uci}:${m.hasNote}`).join(' '),
  );

  // 2c. lineRecall ranks the weakest line first and skips untrained ones.
  //     White line, user moves at plies 0, 2, 4.
  //     Shaky line   — two of three user moves missed at their last drill → 33%.
  //     Solid line   — all three remembered → 100%.
  //     Untrained    — no review blocks at all → not listed.
  const recall = lineRecall([
    line('white', 'e4 e5 Nf3 Nc6 Bc4', {
      name: 'Shaky', reps: [0, undefined, 0, undefined, 2], lapses: [3, 0, 5, 0, 0],
    }),
    line('white', 'd4 d5 c4 e6 Nc3', {
      name: 'Solid', reps: [4, undefined, 3, undefined, 2],
    }),
    line('white', 'c4 e5 g3', { name: 'Untrained' }),
  ]);
  check(
    'lineRecall ranks weakest first and skips untrained lines',
    recall.length === 2
      && recall[0].lineName === 'Shaky' && recall[0].memory.recallPct === 33
      && recall[0].memory.trained === 3 && recall[0].lapses === 8
      && recall[1].lineName === 'Solid' && recall[1].memory.recallPct === 100
      && recall[1].lapses === 0,
    recall.map(r => `${r.lineName}:${r.memory.recallPct}%:${r.lapses}x`).join(' '),
  );

  // 2d. Times trained: the stored counter wins; without one we fall back to a
  //     FLOOR from the review blocks (max of reps + lapses across user moves),
  //     so a line drilled before the counter existed doesn't read as zero.
  const counted = line('white', 'e4 e5 Nf3', { reps: [2, undefined, 1] });
  counted.timesTrained = 9;
  const estimated = line('white', 'e4 e5 Nf3', { reps: [2, undefined, 0], lapses: [1, 0, 4] });
  check(
    'lineTrainingCount prefers the counter, else a review-derived floor',
    lineTrainingCount(counted) === 9
      && lineTrainingCount(estimated) === 4          // Nf3: reps 0 + lapses 4
      && lineTrainingCount(line('white', 'e4 e5')) === 0,  // never drilled
    `${lineTrainingCount(counted)} / ${lineTrainingCount(estimated)} / ${lineTrainingCount(line('white', 'e4 e5'))}`,
  );
  check(
    'lineRecall carries the training count',
    lineRecall([counted])[0]?.timesTrained === 9,
    String(lineRecall([counted])[0]?.timesTrained),
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

  // 5b. Move memory: user moves only, split by latest review state. White line
  //     e4 e5 Nf3 → user moves are e4 and Nf3 (2 of 3 plies). Stamp e4 as solid
  //     (reps > 0) and Nf3 as shaky (a graded miss: reps 0, lapses 1); a second
  //     line with no reviews adds 2 untrained user moves.
  const memLineA = line('white', 'e4 e5 Nf3', { openingName: "King's Pawn Game" });
  const memNodes = [memLineA.tree.children[0], memLineA.tree.children[0].children[0].children[0]];
  memNodes[0].review = { ease: 2.5, interval: 6, reps: 2, lapses: 0, due: new Date() };
  memNodes[1].review = { ease: 2.1, interval: 1, reps: 0, lapses: 1, due: new Date() };
  const memLineB = line('black', 'd4 d5 c4 e6', { openingName: "Queen's Gambit Declined" });
  const mem = moveMemory([memLineA, memLineB]);
  check(
    'moveMemory splits user moves into solid / shaky / untrained + recall',
    mem.total === 4 && mem.trained === 2 && mem.solid === 1 && mem.shaky === 1 &&
      mem.recallPct === 50,
    `${mem.solid} solid, ${mem.shaky} shaky, ${mem.total - mem.trained} untrained, recall ${mem.recallPct}%`,
  );
  const memUntrained = moveMemory([memLineB]);
  check(
    'moveMemory with nothing trained keeps recall null',
    memUntrained.total === 2 && memUntrained.trained === 0 && memUntrained.recallPct === null,
    `${memUntrained.total} moves, recall ${String(memUntrained.recallPct)}`,
  );
  const byFam = memoryByOpening([memLineA, memLineB]);
  const kp = byFam.get(`${familyKey("King's Pawn Game")}|white`);
  check(
    'memoryByOpening keys normalised family|colour and tallies per opening',
    byFam.size === 2 && !!kp && kp.total === 2 && kp.solid === 1 && kp.recallPct === 50,
    kp ? `KP white: ${kp.solid}/${kp.trained} solid of ${kp.total}` : 'no bucket',
  );

  // 5b-bis. The join survives the two sources naming the opening differently:
  //     the saved line carries the bundled dataset's colon format ("Pirc
  //     Defense: Classical Variation"), the game the chess.com slug format
  //     (no colon, apostrophes dropped). The memory ring must still find the line.
  const pircLine = line('black', 'e4 d6 d4 Nf6', { openingName: 'Pirc Defense: Classical Variation' });
  const pircGames = [game('Pirc Defense Classical Variation', 'black', 'win', 'e4 d6 d4 Nf6', mar)];
  const pircRows = winRateByOpening(analyseGames(pircGames, [pircLine]).stats, [pircLine]);
  const pirc = pircRows.find(r => r.colour === 'black');
  const qgdLine = line('white', 'd4 d5 c4 e6', { openingName: "Queen's Gambit Declined: Exchange Variation" });
  const qgdGames = [game('Queens Gambit Declined Exchange Variation', 'white', 'win', 'd4 d5 c4 e6', mar)];
  const qgdRows = winRateByOpening(analyseGames(qgdGames, [qgdLine]).stats, [qgdLine]);
  const qgd = qgdRows.find(r => r.colour === 'white');
  check(
    'winRateByOpening joins across colon / slug / apostrophe name formats',
    !!pirc && pirc.lineCount === 1 && pirc.memory.total > 0 &&
      !!qgd && qgd.lineCount === 1 && qgd.memory.total > 0,
    `Pirc ${pirc?.lineCount ?? 0} lines · ${pirc?.memory.total ?? 0} moves; QGD ${qgd?.lineCount ?? 0} lines · ${qgd?.memory.total ?? 0} moves`,
  );

  // 5c. winRateByOpening carries the opening's memory tally along.
  const italianMem = rows.find(r => r.family === 'Italian Game')?.memory;
  check(
    'winRateByOpening joins the memory tally onto each row',
    !!italianMem && italianMem.total === 3 && italianMem.trained === 0,
    italianMem ? `${italianMem.total} moves, ${italianMem.trained} trained` : 'no memory',
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
