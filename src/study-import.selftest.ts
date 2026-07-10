// Network-free checks for the Lichess study import helpers: URL parsing,
// multi-chapter splitting, comment→ply mapping, and Lichess command-tag
// stripping — all against a canned two-chapter study PGN.

import { parseStudyUrl, splitPgnGames, parseAnnotatedPgn, parseStudyPgn } from './study-import';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const STUDY_PGN = `[Event "My Repertoire: Italian mainline"]
[Site "https://lichess.org/study/aaaabbbb/ccccdddd"]
[Result "*"]

{ Intro comment before move one. }
1. e4 { [%cal Ge2e4] King pawn — best by test. } e5 2. Nf3 { Develops with a threat. [%csl Ge5] } Nc6 3. Bc4 (3. Bb5 { the Spanish }) 3... Bc5 { [%clk 0:03:00] } *

[Event "My Repertoire: Petroff sideline"]
[Site "https://lichess.org/study/aaaabbbb/eeeeffff"]
[Result "*"]

1. e4 e5 2. Nf3 Nf6 3. Nxe5 d6 { The key move order. } 4. Nf3 Nxe4 *`;

export function runStudyImportSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // URL parsing
  const full = parseStudyUrl('https://lichess.org/study/aaaabbbb/ccccdddd');
  check('parses study URL with chapter', full?.studyId === 'aaaabbbb' && full?.chapterId === 'ccccdddd', JSON.stringify(full));
  const bare = parseStudyUrl('  aaaabbbb ');
  check('parses bare study id', bare?.studyId === 'aaaabbbb' && bare?.chapterId === undefined, JSON.stringify(bare));
  const noisy = parseStudyUrl('https://lichess.org/study/aaaabbbb/ccccdddd/black#12');
  check('parses URL with trailing path', noisy?.studyId === 'aaaabbbb' && noisy?.chapterId === 'ccccdddd', JSON.stringify(noisy));
  check('rejects non-study text', parseStudyUrl('1. e4 e5 2. Nf3') === null, 'null expected');

  // Chapter splitting
  const games = splitPgnGames(STUDY_PGN);
  check('splits a study into chapters', games.length === 2, `${games.length} games`);

  // Chapter 1: names, moves, notes
  const ch1 = parseAnnotatedPgn(games[0] ?? '');
  check('chapter name comes from the Event header tail', ch1?.name === 'Italian mainline', ch1?.name ?? 'null');
  check('mainline parsed (variation dropped)', ch1?.sans.join(' ') === 'e4 e5 Nf3 Nc6 Bc4 Bc5', ch1?.sans.join(' ') ?? 'null');
  check('ucis parallel to sans', ch1?.ucis[0] === 'e2e4' && ch1?.ucis.length === 6, ch1?.ucis.join(' ') ?? 'null');
  check('comment lands on its ply, tags stripped', ch1?.notes[0] === 'King pawn — best by test.', JSON.stringify(ch1?.notes));
  check('second comment on its ply', ch1?.notes[2] === 'Develops with a threat.', ch1?.notes[2] ?? 'missing');
  check('clock-only comment produces no note', ch1 !== null && !(5 in ch1.notes), JSON.stringify(ch1?.notes));

  // Chapter 2
  const ch2 = parseAnnotatedPgn(games[1] ?? '');
  check('second chapter parses', ch2?.name === 'Petroff sideline' && ch2?.sans.length === 8, `${ch2?.name} / ${ch2?.sans.length}`);
  check('note on black ply', ch2?.notes[5] === 'The key move order.', JSON.stringify(ch2?.notes));

  // Whole-study helper
  const all = parseStudyPgn(STUDY_PGN);
  check('parseStudyPgn returns every chapter', all.length === 2 && all[0].name === 'Italian mainline', `${all.length} chapters`);

  // Garbage in
  check('unreadable PGN → null', parseAnnotatedPgn('not a pgn at all []') === null, 'null expected');
  check('empty input → no chapters', parseStudyPgn('').length === 0, 'empty expected');

  return results;
}
