// Network-free checks for the Lichess study import helpers: URL parsing,
// multi-chapter splitting, comment→ply mapping, and Lichess command-tag
// stripping — all against a canned two-chapter study PGN.

import {
  parseStudyUrl, splitPgnGames, parseAnnotatedPgn, parseStudyPgn,
  studyNameFromPgn, shortStudyTag,
} from './study-import';

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

  // Intro comment (before move one) → chapter intro, not a move note
  check('intro comment captured', ch1?.intro === 'Intro comment before move one.', ch1?.intro ?? 'missing');
  check('intro does not leak into move notes', ch1 !== null && !Object.values(ch1.notes).includes('Intro comment before move one.'), JSON.stringify(ch1?.notes));
  check('chapter without intro has none', ch2 !== null && ch2.intro === undefined, ch2?.intro ?? 'undefined');

  // Study title extraction: Event prefix here; StudyName header wins when present
  check('study name from Event prefix', studyNameFromPgn(STUDY_PGN) === 'My Repertoire', studyNameFromPgn(STUDY_PGN) ?? 'null');
  const withHeader = `[Event "Old style: Ch 1"]\n[StudyName "Proper Study Title"]\n\n1. e4 *`;
  check('StudyName header wins', studyNameFromPgn(withHeader) === 'Proper Study Title', studyNameFromPgn(withHeader) ?? 'null');
  check('no title → null', studyNameFromPgn('1. e4 e5 *') === null, 'null expected');

  // ChapterName header wins over the Event tail when present
  const chNamed = parseAnnotatedPgn(`[Event "S: wrong"]\n[ChapterName "Right name"]\n\n1. e4 *`);
  check('ChapterName header names the chapter', chNamed?.name === 'Right name', chNamed?.name ?? 'null');

  // Short study tags
  check('short title kept whole', shortStudyTag('Caro-Kann Basics') === 'Caro-Kann Basics', shortStudyTag('Caro-Kann Basics'));
  const long = shortStudyTag('The Complete Caro-Kann Repertoire for Club Players and Beyond');
  check('long title cut at a word boundary with ellipsis', long.length <= 29 && long.endsWith('…') && !long.includes('Repertoire for'), long);
  check('decorative wrapping trimmed', shortStudyTag('⭐ Sicilian Defense ⭐') === 'Sicilian Defense', shortStudyTag('⭐ Sicilian Defense ⭐'));
  check('empty title falls back', shortStudyTag('★★★') === 'Lichess study', shortStudyTag('★★★'));
  check('same title → same tag', shortStudyTag(' Caro-Kann  Basics ') === shortStudyTag('Caro-Kann Basics'), 'stable expected');

  // Lichess-export quirks that used to kill whole chapters (chess.js accepts
  // neither adjacent comment blocks nor blank lines inside a comment):
  // "{ prose } { [%csl … ] }" on one move, and a multi-paragraph intro.
  const quirky = parseAnnotatedPgn(
    '[Event "Q: Real-world chapter"]\n\n' +
    '{ First paragraph.\n\nSecond paragraph after a blank line. }\n' +
    '1. e4 { King pawn. } { [%csl Ge4][%cal Ge2e4] } e5 2. Nf3 *',
  );
  check('multi-paragraph intro comment parses', quirky?.intro === 'First paragraph. Second paragraph after a blank line.', quirky?.intro ?? 'null');
  check('adjacent comment blocks merge onto the move', quirky?.notes[0] === 'King pawn.', JSON.stringify(quirky?.notes ?? null));
  check('quirky chapter keeps all its moves', quirky?.sans.join(' ') === 'e4 e5 Nf3', quirky?.sans.join(' ') ?? 'null');

  // Garbage in
  check('unreadable PGN → null', parseAnnotatedPgn('not a pgn at all []') === null, 'null expected');
  check('empty input → no chapters', parseStudyPgn('').length === 0, 'empty expected');

  return results;
}
