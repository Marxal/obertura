// A runnable, network-free check of the opponent-scouting tree builder — same
// spirit as analysis.selftest.ts. Verifies that games of a colour merge into one
// frequency-sorted tree, that the other colour is excluded, that rare branches
// are pruned on a big enough sample, and that depth is capped.

import { Chess } from 'chess.js';
import { buildOpponentTree, makeOpponent, buildScoutReport } from './scout';
import type { ImportedGame } from './chesscom';
import type { MoveNode } from './tree';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

let gameSeq = 0;
function game(colour: 'white' | 'black', sanLine: string): ImportedGame {
  const chess = new Chess();
  const sans: string[] = [];
  const ucis: string[] = [];
  for (const san of sanLine.split(/\s+/).filter(Boolean)) {
    const m = chess.move(san);
    sans.push(m.san);
    ucis.push(m.from + m.to + (m.promotion ?? ''));
  }
  return {
    id: `g${++gameSeq}`, url: '', endTime: 0,
    timeClass: 'blitz', timeControl: '180', rated: true,
    colour, result: 'win', opponent: 'foe', eco: null, opening: null,
    sans, ucis, plyCount: sans.length,
  };
}

// Depth of the deepest node under a tree root.
function maxDepth(root: MoveNode): number {
  if (root.children.length === 0) return 0;
  return 1 + Math.max(...root.children.map(maxDepth));
}

export function runScoutSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // 1. Only the requested colour is built; the spine merges shared moves.
  const mixed = [
    game('white', 'e4 e5 Nf3'),
    game('white', 'e4 c5 Nf3'),
    game('black', 'd4 Nf6 c4'),
  ];
  const white = buildOpponentTree(mixed, 'white');
  const black = buildOpponentTree(mixed, 'black');
  check(
    'colour filter + shared first move merges',
    white.children.length === 1 && white.children[0].san === 'e4' &&
      white.children[0].children.length === 2 &&
      black.children.length === 1 && black.children[0].san === 'd4',
    `white root kids=${white.children.length} first=${white.children[0]?.san}; black first=${black.children[0]?.san}`,
  );

  // 2. Children are sorted most-played first.
  const weighted = [
    game('white', 'e4 e5'), game('white', 'e4 e5'), game('white', 'e4 e5'),
    game('white', 'd4 d5'),
  ];
  const wt = buildOpponentTree(weighted, 'white');
  check(
    'children sorted by frequency',
    wt.children[0].san === 'e4' && wt.children[1].san === 'd4',
    `order=${wt.children.map(c => c.san).join(',')}`,
  );

  // 3. On a big sample, a one-off branch is pruned but the main line survives.
  const many: ImportedGame[] = [];
  for (let i = 0; i < 12; i++) many.push(game('white', 'e4 e5 Nf3 Nc6'));
  many.push(game('white', 'e4 e5 Nf3 d6')); // single deviation at ply 4
  const pruned = buildOpponentTree(many, 'white');
  const afterNf3 = pruned.children[0]?.children[0]?.children[0];
  check(
    'rare branch pruned, main line kept',
    !!afterNf3 && afterNf3.children.length === 1 && afterNf3.children[0].san === 'Nc6',
    `kids after Nf3 = ${afterNf3?.children.map(c => c.san).join(',')}`,
  );

  // 4. Depth is parameterised: an explicit cap truncates, while the default
  //    (MAP_MAX_PLIES = 60) keeps a 20-ply game whole.
  const longLine =
    'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7'; // 20 plies
  const capped = buildOpponentTree([game('white', longLine)], 'white', 8);
  const full = buildOpponentTree([game('white', longLine)], 'white');
  check(
    'depth cap honours the requested plies',
    maxDepth(capped) === 8 && maxDepth(full) === 20,
    `capped=${maxDepth(capped)} default=${maxDepth(full)}`,
  );

  // 4b. The main line is traced to full depth even where it drops below the prune
  //     threshold: 7 games stop at 1...e5, one carries on deep, and a one-off
  //     first move (d4) is a rare SIDE branch that must still be trimmed.
  const spineGames: ImportedGame[] = [];
  for (let i = 0; i < 7; i++) spineGames.push(game('white', 'e4 e5'));
  spineGames.push(game('white', 'e4 e5 Nf3 Nc6 Bb5')); // lone deep continuation
  spineGames.push(game('white', 'd4 d5'));             // lone shallow sideline
  const spine = buildOpponentTree(spineGames, 'white');
  const deep = spine.children[0]?.children[0]?.children[0]?.children[0]?.children[0];
  check(
    'main line kept deep past the prune threshold; rare sideline trimmed',
    spine.children.length === 1 && spine.children[0].san === 'e4' &&
      maxDepth(spine) === 5 && deep?.san === 'Bb5',
    `roots=${spine.children.map(c => c.san).join(',')} depth=${maxDepth(spine)} tip=${deep?.san}`,
  );

  // 5. makeOpponent records counts and both colour trees.
  const opp = makeOpponent({ platform: 'lichess', username: 'Foe' }, mixed);
  check(
    'makeOpponent builds both trees + count',
    opp.gamesAnalysed === 3 && opp.name === 'Foe' &&
      opp.whiteTree.children.length === 1 && opp.blackTree.children.length === 1,
    `count=${opp.gamesAnalysed} white=${opp.whiteTree.children.length} black=${opp.blackTree.children.length}`,
  );

  // ── Scouting report ─────────────────────────────────────────────────────────
  // A fixed sample with hand-picked records so the weak/strong/recommendation
  // picks are unambiguous. `rep()` only needs colour/opening/result.
  let repSeq = 0;
  const rep = (
    colour: 'white' | 'black',
    opening: string,
    result: ImportedGame['result'],
  ): ImportedGame => ({
    id: `rep${++repSeq}`, url: '', endTime: 0,
    timeClass: 'blitz', timeControl: '180', rated: true,
    colour, result, opponent: 'foe', eco: null, opening,
    sans: [], ucis: [], plyCount: 0,
  });
  // n games of one family/colour/result, batched.
  const batch = (
    n: number, colour: 'white' | 'black', opening: string, result: ImportedGame['result'],
  ): ImportedGame[] => Array.from({ length: n }, () => rep(colour, opening, result));

  // Their games (their perspective). Scores below are what buildScoutReport reads:
  //   Sicilian (black)  1W 0D 5L /6 → 17%   ← weakest
  //   French   (black)  1W 1D 3L /5 → 30%
  //   Queen's Gambit(w) 2W 0D 3L /5 → 40%
  //   Caro-Kann(black)  3W 1D 1L /5 → 70%
  //   Ruy Lopez (white) 4W 0D 1L /5 → 80%
  //   Italian   (white) 5W 0D 1L /6 → 83%   ← strongest
  //   London System(w)  3W 0D 0L /3        ← below the 5-game floor, excluded
  const theirGames: ImportedGame[] = [
    ...batch(1, 'black', 'Sicilian Defense', 'win'), ...batch(5, 'black', 'Sicilian Defense', 'loss'),
    ...batch(1, 'black', 'French Defense', 'win'), ...batch(1, 'black', 'French Defense', 'draw'),
    ...batch(3, 'black', 'French Defense', 'loss'),
    ...batch(2, 'white', 'Queen\'s Gambit', 'win'), ...batch(3, 'white', 'Queen\'s Gambit', 'loss'),
    ...batch(3, 'black', 'Caro-Kann Defense', 'win'), ...batch(1, 'black', 'Caro-Kann Defense', 'draw'),
    ...batch(1, 'black', 'Caro-Kann Defense', 'loss'),
    ...batch(4, 'white', 'Ruy Lopez', 'win'), ...batch(1, 'white', 'Ruy Lopez', 'loss'),
    ...batch(5, 'white', 'Italian Game', 'win'), ...batch(1, 'white', 'Italian Game', 'loss'),
    ...batch(3, 'white', 'London System', 'win'),
  ];

  // My games (my perspective), only in the families I'd actually play against
  // them — the opposite colour to theirs:
  //   Sicilian (white) 4W 1D 1L /6 → 75%   (strong for me → lifts the rec)
  //   French   (white) 1W 0D 4L /5 → 20%   (weak for me → drops the rec)
  //   (no games in Queen's Gambit as black → that rec stays on their weakness)
  const myGames: ImportedGame[] = [
    ...batch(4, 'white', 'Sicilian Defense', 'win'), ...batch(1, 'white', 'Sicilian Defense', 'draw'),
    ...batch(1, 'white', 'Sicilian Defense', 'loss'),
    ...batch(1, 'white', 'French Defense', 'win'), ...batch(4, 'white', 'French Defense', 'loss'),
  ];

  const report = buildScoutReport(theirGames, myGames);

  check(
    'report: weakest three by their score, ascending',
    report.enoughGames &&
      report.weakest.map(r => r.family).join(' < ') ===
        "Sicilian Defense < French Defense < Queen's Gambit" &&
      report.weakest[0].scorePct === 17 && report.weakest[0].games === 6,
    `weakest=${report.weakest.map(r => `${r.family}:${r.scorePct}%`).join(', ')}`,
  );

  check(
    'report: strongest three by their score, descending',
    report.strongest.map(r => r.family).join(' > ') ===
      'Italian Game > Ruy Lopez > Caro-Kann Defense' &&
      report.strongest[0].scorePct === 83,
    `strongest=${report.strongest.map(r => `${r.family}:${r.scorePct}%`).join(', ')}`,
  );

  check(
    'report: under-5-games opening excluded from every group',
    ![...report.weakest, ...report.strongest, ...report.recommendations.map(r => r.their)]
      .some(r => r.family === 'London System'),
    `families=${report.weakest.concat(report.strongest).map(r => r.family).join(',')}`,
  );

  // Recommendations: their weakness leads, my record tips the order.
  //   Sicilian  base 83 + 0.5*(75-50)=+12.5 → 95.5   (top: weak + I'm strong)
  //   Queen's G base 60 + 0 (no data)        → 60.0
  //   French    base 70 + 0.5*(20-50)=-15    → 55.0   (my poor record sinks it)
  const recs = report.recommendations;
  check(
    'report: top recommendation = their weakness lifted by my strong record',
    recs[0].their.family === 'Sicilian Defense' && recs[0].myColour === 'white' &&
      recs[0].mine !== null && recs[0].mine.scorePct === 75,
    `rec0=${recs[0]?.their.family} my=${recs[0]?.mine?.scorePct ?? 'none'}`,
  );
  check(
    'report: my weak record sinks French below no-data Queen\'s Gambit',
    recs[1].their.family === "Queen's Gambit" && recs[1].mine === null &&
      recs[2].their.family === 'French Defense' && recs[2].mine?.scorePct === 20,
    `order=${recs.map(r => r.their.family).join(' > ')}`,
  );
  check(
    'report: no-data recommendation flagged via null mine',
    recs[1].mine === null && recs[1].myColour === 'black',
    `rec1 mine=${recs[1]?.mine === null ? 'null' : 'present'} myColour=${recs[1]?.myColour}`,
  );

  // A thin opponent — nothing reaches 5 games — yields the honest empty report.
  const thin = buildScoutReport([
    ...batch(3, 'white', 'Italian Game', 'win'),
    ...batch(4, 'black', 'Sicilian Defense', 'loss'),
  ], myGames);
  check(
    'report: thin opponent → enoughGames false, all groups empty',
    !thin.enoughGames && thin.weakest.length === 0 &&
      thin.strongest.length === 0 && thin.recommendations.length === 0,
    `enough=${thin.enoughGames} weak=${thin.weakest.length} rec=${thin.recommendations.length}`,
  );

  return results;
}
