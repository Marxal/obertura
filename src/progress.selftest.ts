// A runnable, network-free check of the win-rate ↔ training cross-reference —
// same spirit as analysis.selftest.ts. The Progress screen has a "Run progress
// self-test" link that calls this and shows pass/fail, so the game-to-line
// linking and the before/after split can be verified right on the phone.

import { Chess } from 'chess.js';
import { crossReference, MIN_WINDOW } from './progress';
import type { ImportedGame } from './chesscom';
import type { Line } from './types';
import type { MoveNode } from './tree';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

// One day in seconds, for placing games before/after a drill date.
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

// Build a single-mainline Line from a SAN move list, with training metadata.
let lineSeq = 0;
function line(
  colour: 'white' | 'black',
  sanLine: string,
  opts: { name?: string; lastTrained?: string | null; inTraining?: boolean; confidence?: number } = {},
): Line {
  const chess = new Chess();
  const root: MoveNode = { id: 'root', san: '', uci: '', fen: chess.fen(), children: [] };
  let cursor = root;
  let n = 0;
  for (const san of sanLine.split(/\s+/).filter(Boolean)) {
    const m = chess.move(san);
    const node: MoveNode = {
      id: `n${++n}`, san: m.san, uci: m.from + m.to + (m.promotion ?? ''),
      fen: chess.fen(), children: [],
    };
    cursor.children.push(node);
    cursor = node;
  }
  return {
    id: `l${++lineSeq}`, name: opts.name ?? sanLine, tags: [], colour,
    openingName: null,
    confidence: opts.confidence ?? 0,
    lastTrained: opts.lastTrained ?? null,
    inTraining: opts.inTraining ?? false,
    tree: root,
  };
}

// A drill date, plus games comfortably before and after it.
const TRAINED_AT = '2026-03-01T00:00:00.000Z';
const trainedSec = Date.parse(TRAINED_AT) / 1000;
const before = (d: number) => trainedSec - d * DAY;
const after = (d: number) => trainedSec + d * DAY;

export function runProgressSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // 1. A game that follows a line's prep deeply enough links to it; a different
  //    opening does not.
  const italianLine = [line('white', 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3', { inTraining: true })];
  const mixedGames = [
    game('Italian Game', 'white', 'win', 'e4 e5 Nf3 Nc6 Bc4 Bc5', before(10)),
    game('Sicilian Defense', 'white', 'loss', 'e4 c5 Nf3 d6', before(10)),
  ];
  const linked = crossReference(mixedGames, italianLine);
  check(
    'links games to a line by moves, ignores other openings',
    linked.items.length === 1 && linked.items[0].totalGames === 1 &&
      linked.totalLinkedGames === 1,
    `${linked.linkedLines} line(s), ${linked.totalLinkedGames} game(s) linked`,
  );

  // 2. The before/after split lands games on the right side of the drill date,
  //    and the verdict reads "improved" when the later score is clearly better.
  //    Before: 1 win, 3 losses = 25%. After: 3 wins, 1 loss = 75%.
  const drilled = [
    line('white', 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3', { lastTrained: TRAINED_AT, inTraining: true, confidence: 4 }),
  ];
  const span = (col: 'win' | 'loss', when: number) =>
    game('Italian Game', 'white', col, 'e4 e5 Nf3 Nc6 Bc4 Bc5', when);
  const improving = [
    span('loss', before(40)), span('loss', before(30)), span('loss', before(20)), span('win', before(10)),
    span('win', after(10)), span('win', after(20)), span('win', after(30)), span('loss', after(40)),
  ];
  const imp = crossReference(improving, drilled);
  const it = imp.items[0];
  check(
    'splits games at the drill date and scores each side',
    !!it && it.before.games === 4 && it.before.scorePct === 25 &&
      it.after.games === 4 && it.after.scorePct === 75,
    it ? `before ${it.before.scorePct}% (${it.before.games}), after ${it.after.scorePct}% (${it.after.games})` : 'no item',
  );
  check(
    'verdict is "improved" when the later score jumps',
    !!it && it.verdict === 'improved' && it.delta === 50,
    it ? `${it.verdict}, delta ${it.delta}` : 'no item',
  );

  // 3. The reverse: a clear drop reads "declined".
  const declining = [
    span('win', before(40)), span('win', before(30)), span('win', before(20)),
    span('loss', after(10)), span('loss', after(20)), span('loss', after(30)),
  ];
  const dec = crossReference(declining, drilled)?.items[0];
  check(
    'verdict is "declined" when results sink after drilling',
    !!dec && dec.verdict === 'declined' && dec.before.scorePct === 100 && dec.after.scorePct === 0,
    dec ? `${dec.verdict}: ${dec.before.scorePct}% → ${dec.after.scorePct}%` : 'no item',
  );

  // 4. Too few games on one side → "too-soon", no false trend.
  const thin = [
    span('win', before(20)), span('loss', before(10)),
    span('win', after(10)),
  ];
  const tooSoon = crossReference(thin, drilled)?.items[0];
  check(
    'a thin side yields "too-soon", not a verdict',
    !!tooSoon && tooSoon.verdict === 'too-soon' && tooSoon.delta === null &&
      tooSoon.after.games < MIN_WINDOW,
    tooSoon ? `${tooSoon.verdict}, after games ${tooSoon.after.games}` : 'no item',
  );

  // 5. A never-drilled line (lastTrained null) → "untrained"; all games count as
  //    "before" so there's a baseline waiting for the first drill.
  const untrainedLine = [line('white', 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3', { lastTrained: null, inTraining: true })];
  const baseline = crossReference(
    [span('win', before(10)), span('loss', before(20))],
    untrainedLine,
  ).items[0];
  check(
    'an undrilled line is "untrained" with a before-baseline',
    !!baseline && baseline.verdict === 'untrained' && baseline.before.games === 2 &&
      baseline.after.games === 0,
    baseline ? `${baseline.verdict}, before ${baseline.before.games}, after ${baseline.after.games}` : 'no item',
  );

  // 6. Overlapping prep: a game is assigned to the line it follows DEEPEST, so
  //    it's counted once. Both lines start 1.e4 e5 2.Nf3 Nc6; only the Italian
  //    continues 3.Bc4 Bc5, which the game plays.
  const overlap = [
    line('white', 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3', { name: 'Italian', inTraining: true }),
    line('white', 'e4 e5 Nf3 Nc6 Bb5 a6', { name: 'Ruy Lopez', inTraining: true }),
  ];
  const oneGame = [game('Italian Game', 'white', 'win', 'e4 e5 Nf3 Nc6 Bc4 Bc5', before(5))];
  const assigned = crossReference(oneGame, overlap);
  const italianRow = assigned.items.find(i => i.title === 'Italian');
  check(
    'overlapping prep counts a game once, to its deepest match',
    assigned.totalLinkedGames === 1 && !!italianRow && italianRow.totalGames === 1 &&
      !assigned.items.some(i => i.title === 'Ruy Lopez'),
    `linked once to ${italianRow ? italianRow.title : '—'}`,
  );

  // 7. Display title falls back to the opening family when the line is untitled.
  const untitled = [line('white', 'e4 e5 Nf3 Nc6 Bc4 Bc5', { name: 'Untitled line', inTraining: true })];
  const fam = crossReference(
    [game('Italian Game Classical', 'white', 'win', 'e4 e5 Nf3 Nc6 Bc4 Bc5', before(5))],
    untitled,
  ).items[0];
  check(
    'an untitled line shows its opening family instead',
    !!fam && fam.title === 'Italian Game' && fam.family === 'Italian Game',
    fam ? `title "${fam.title}"` : 'no item',
  );

  // 8. A shallow shared move (only 1.e4) does not link — otherwise every e4 game
  //    would attach to every e4 line.
  const shallow = crossReference(
    [game('Scandinavian Defense', 'white', 'win', 'e4 d5 exd5', before(5))],
    [line('white', 'e4 e5 Nf3 Nc6 Bc4 Bc5', { inTraining: true })],
  );
  check(
    'a one-move overlap is too shallow to link',
    shallow.linkedLines === 0 && shallow.totalLinkedGames === 0,
    `${shallow.totalLinkedGames} game(s) linked`,
  );

  return results;
}
