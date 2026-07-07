// A runnable, network-free check of the game-analysis logic — same spirit as
// import.selftest.ts and scheduler.selftest.ts. The "From my games" tab on My
// Lines has a "Run analysis self-test" link that calls this and shows pass/fail,
// so the grouping, scoring, and "left my prep" diff can be verified on the
// phone, offline.

import { Chess } from 'chess.js';
import { analyseGames, openingFamily, familyKey, UNKNOWN_FAMILY } from './analysis';
import type { ImportedGame } from './chesscom';
import type { Line } from './types';
import type { MoveNode } from './tree';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

// ── Tiny builders so the fixtures read like chess, not bookkeeping ───────────────

// Turn a SAN move list ("e4 e5 Nf3 …") into a compact ImportedGame.
let gameSeq = 0;
function game(
  opening: string | null,
  colour: 'white' | 'black',
  result: ImportedGame['result'],
  sanLine: string,
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
    id: `g${++gameSeq}`, url: '', endTime: 0,
    timeClass: 'blitz', timeControl: '180', rated: true,
    colour, result, opponent: 'foe', eco: null, opening,
    sans, ucis, plyCount: sans.length,
  };
}

// Build a single-mainline repertoire Line from a SAN move list.
function line(colour: 'white' | 'black', sanLine: string): Line {
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
    id: `l${colour}${n}`, name: sanLine, tags: [], colour,
    openingName: null, confidence: 0, lastTrained: null, inTraining: false, tree: root,
  };
}

export function runAnalysisSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // 1. Family folding collapses deep names but keeps short ones.
  check(
    'opening names fold to a family',
    openingFamily('Sicilian Defense Najdorf Variation Main Line') === 'Sicilian Defense' &&
      openingFamily("King's Indian Defense Saemisch") === "King's Indian Defense" &&
      openingFamily('Ruy Lopez') === 'Ruy Lopez' &&
      openingFamily(null) === UNKNOWN_FAMILY,
    `${openingFamily('Sicilian Defense Najdorf Variation')} / ${openingFamily('Ruy Lopez')} / ${openingFamily(null)}`,
  );

  // 1b. Colon names (the bundled dataset's "Family: Variation" format) fold to
  //     the same family as their colon-free chess.com counterparts.
  check(
    'colon-format names fold to the same family',
    openingFamily('Pirc Defense: Classical Variation') === 'Pirc Defense' &&
      openingFamily('Sicilian Defense: Najdorf Variation') === 'Sicilian Defense' &&
      openingFamily("Queen's Gambit Declined: Exchange Variation") === "Queen's Gambit" &&
      openingFamily('Ruy Lopez: Berlin Defense') === 'Ruy Lopez',
    `${openingFamily('Pirc Defense: Classical Variation')} / ${openingFamily('Ruy Lopez: Berlin Defense')}`,
  );

  // 1c. familyKey joins across sources: apostrophes dropped by chess.com URL
  //     slugs and Defence/Defense spellings land on the same key.
  check(
    'familyKey joins slug and dataset names',
    familyKey('Queens Gambit Declined Exchange Variation') ===
      familyKey("Queen's Gambit Declined: Exchange Variation") &&
      familyKey('Caro-Kann Defence') === familyKey('Caro-Kann Defense: Advance Variation') &&
      familyKey(null) === UNKNOWN_FAMILY,
    `${familyKey('Queens Gambit Declined')} / ${familyKey('Caro-Kann Defence')}`,
  );

  // 2. Grouping + scoring: 3 Italian games (2 wins, 1 loss) as White → one
  //    bucket, 3 games, score (2 + 0)/3 = 67 %.
  const italian = [
    game('Italian Game Classical Variation', 'white', 'win', 'e4 e5 Nf3 Nc6 Bc4'),
    game('Italian Game Two Knights Defense', 'white', 'win', 'e4 e5 Nf3 Nc6 Bc4 Nf6'),
    game('Italian Game', 'white', 'loss', 'e4 e5 Nf3 Nc6 Bc4 Bc5'),
  ];
  const aItalian = analyseGames(italian, []);
  const itStat = aItalian.stats.find(s => s.family === 'Italian Game');
  check(
    'groups a family and scores it',
    aItalian.stats.length === 1 &&
      !!itStat && itStat.games === 3 && itStat.wins === 2 && itStat.losses === 1 &&
      itStat.scorePct === 67,
    itStat ? `${itStat.games} games, ${itStat.wins}-${itStat.losses}-${itStat.draws}, ${itStat.scorePct}%` : 'no Italian bucket',
  );

  // 3. Draws count as half a point: 1 win + 2 draws over 3 games → 67 %.
  const drawy = [
    game('Caro-Kann Defense', 'black', 'win', 'e4 c6'),
    game('Caro-Kann Defense', 'black', 'draw', 'e4 c6'),
    game('Caro-Kann Defense', 'black', 'draw', 'e4 c6'),
  ];
  const ck = analyseGames(drawy, []).stats[0];
  check(
    'draws score as half a point',
    ck.scorePct === 67 && ck.draws === 2,
    `${ck.scorePct}% with ${ck.draws} draws`,
  );

  // 4. No repertoire → the opening becomes a suggestion (played ≥ 2 times).
  const sugg = analyseGames(italian, []);
  check(
    'un-prepped opening is suggested',
    sugg.suggestions.some(s => s.family === 'Italian Game') &&
      !itStatHasRep(sugg.stats),
    `suggestions: ${sugg.suggestions.map(s => s.family).join(', ') || 'none'}`,
  );

  // 5. With a matching repertoire line, the same opening is NOT suggested and is
  //    flagged hasRepertoire.
  const rep = [line('white', 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3')];
  const withRep = analyseGames(italian, rep);
  const itWithRep = withRep.stats.find(s => s.family === 'Italian Game')!;
  check(
    'matching repertoire marks coverage and drops the suggestion',
    itWithRep.hasRepertoire === true &&
      !withRep.suggestions.some(s => s.family === 'Italian Game'),
    `hasRepertoire=${itWithRep.hasRepertoire}, suggested=${withRep.suggestions.some(s => s.family === 'Italian Game')}`,
  );

  // 6. "Left my prep": prep is 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3, but in one game
  //    you played 4.d3 instead of 4.c3 — a deviation by YOU at ply 6 (move 4).
  const offPrep = [
    game('Italian Game', 'white', 'loss', 'e4 e5 Nf3 Nc6 Bc4 Bc5 d3'),
    game('Italian Game', 'white', 'loss', 'e4 e5 Nf3 Nc6 Bc4 Bc5 d3 Nf6'),
  ];
  const devAnalysis = analyseGames(offPrep, rep);
  const dev = devAnalysis.deviations[0];
  check(
    'detects where you left your own prep',
    !!dev && dev.side === 'you' && dev.moveNumber === 4 &&
      dev.actual === 'd3' && dev.expected.includes('c3') && dev.count === 2,
    dev ? `${dev.side} at move ${dev.moveNumber}: ${dev.actual} vs prep ${dev.expected.join('/')} ×${dev.count}` : 'no deviation found',
  );

  // 7. The deviation carries the in-book prefix so "Build" can seed the board to
  //    the exact spot the prep ran out (6 plies here).
  check(
    'deviation keeps the in-book prefix for building',
    !!dev && dev.prefixUcis.length === 6 && dev.prefixUcis[0] === 'e2e4',
    dev ? `prefix ${dev.prefixUcis.length} plies [${dev.prefixUcis.join(' ')}]` : 'no deviation',
  );

  // 8. Opponent leaving your prep is attributed to them, not you. Prep covers
  //    1.e4 e5 2.Nf3, but the opponent answers 1...c5 — off your prep at ply 1.
  const oppOff = [game('Sicilian Defense', 'white', 'loss', 'e4 c5 Nf3')];
  const oppAnalysis = analyseGames(oppOff, [line('white', 'e4 e5 Nf3')]);
  const oppDev = oppAnalysis.deviations[0];
  check(
    'opponent deviations are blamed on the opponent',
    !!oppDev && oppDev.side === 'opponent' && oppDev.actual === 'c5',
    oppDev ? `${oppDev.side} played ${oppDev.actual}` : 'no deviation',
  );

  // 9. Staying entirely in book yields no deviation.
  const inBook = [game('Italian Game', 'white', 'win', 'e4 e5 Nf3 Nc6 Bc4 Bc5')];
  const clean = analyseGames(inBook, [line('white', 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3')]);
  check(
    'a game that stays in book has no deviation',
    clean.deviations.length === 0,
    `${clean.deviations.length} deviations`,
  );

  // 10. "Weakest" surfaces only sufficiently-sampled, sub-even openings.
  const weakSet = [
    game('French Defense', 'black', 'loss', 'e4 e6'),
    game('French Defense', 'black', 'loss', 'e4 e6'),
    game('French Defense', 'black', 'loss', 'e4 e6'),
    game('French Defense', 'black', 'win', 'e4 e6'),
    game('Pirc Defense', 'black', 'loss', 'e4 d6'), // only 1 game — too few to flag
  ];
  const weak = analyseGames(weakSet, []);
  check(
    'weakest list needs enough games and a sub-even score',
    weak.weakest.length === 1 && weak.weakest[0].family === 'French Defense' &&
      weak.weakest[0].scorePct === 25,
    weak.weakest.map(w => `${w.family} ${w.scorePct}%`).join(', ') || 'none',
  );

  return results;
}

function itStatHasRep(stats: { family: string; hasRepertoire: boolean }[]): boolean {
  return stats.some(s => s.family === 'Italian Game' && s.hasRepertoire);
}
