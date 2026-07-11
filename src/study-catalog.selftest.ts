// Network-free checks for the study-catalogue logic: profile building from
// lines + games (cross-source family naming included), recommendation ranking,
// and the offline search — all against a small fixture index.

import { buildStudyProfile, recommendStudies, searchStudyIndex, type StudyIndexEntry } from './study-catalog';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const INDEX: StudyIndexEntry[] = [
  { id: 'aaaa1111', name: 'Caro-Kann Complete', by: 'alice', likes: 500, chapters: 10, families: ['Caro-Kann Defense'], keys: ['caro-kann defense'] },
  { id: 'bbbb2222', name: 'The London System', by: 'bob', likes: 900, chapters: 5, families: ['London System'], keys: ['london system'] },
  { id: 'cccc3333', name: 'Petroff for Black', by: 'carol', likes: 100, chapters: 4, families: ['Russian Game'], keys: ['russian game', 'petrovs defense', 'petrov defense', 'petroff defense'] },
  { id: 'dddd4444', name: 'Najdorf Deep Dive', by: 'dave', likes: 700, chapters: 12, families: ['Sicilian Defense'], keys: ['sicilian defense'] },
  { id: 'eeee5555', name: 'Opening Traps', by: 'erin', likes: 2000, chapters: 20, families: [], keys: [] },
];

export function runStudyCatalogSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // Profile: lines weigh 3, games weigh 1, keyed via familyKey.
  const profile = buildStudyProfile(
    [{ openingName: 'Caro-Kann Defense: Advance Variation' }],
    [{ opening: 'Caro-Kann Defence' }, { opening: 'Petrovs Defense' }],
  );
  check('line + game accumulate on one family key', profile.get('caro-kann defense') === 4, String(profile.get('caro-kann defense')));
  check('chess.com-style name lands on its key', profile.get('petrovs defense') === 1, String(profile.get('petrovs defense')));
  check('unknown opening contributes nothing', buildStudyProfile([{ openingName: null }], []).size === 0, 'empty expected');

  // Recommendations: profile weight first, likes as tie-break; no match → out.
  const recs = recommendStudies(INDEX, profile);
  check('best-matching family leads', recs[0]?.id === 'aaaa1111', recs[0]?.id ?? 'none');
  check('synonym key matches (Petroff → Russian Game study)', recs[1]?.id === 'cccc3333', recs[1]?.id ?? 'none');
  check('unmatched studies excluded', recs.length === 2, `${recs.length} recs`);
  check('empty profile → no recommendations', recommendStudies(INDEX, new Map()).length === 0, 'empty expected');

  // Likes break ties between equal scores.
  const tied = new Map([['caro-kann defense', 2], ['sicilian defense', 2]]);
  const tie = recommendStudies(INDEX, tied);
  check('likes break score ties', tie[0]?.id === 'dddd4444' && tie[1]?.id === 'aaaa1111', tie.map(e => e.id).join(','));

  // Search: tokens across title/author/family, hyphen/case/apostrophe-tolerant.
  check('search matches across a hyphen', searchStudyIndex(INDEX, 'caro kann')[0]?.id === 'aaaa1111', 'caro kann');
  check('search by author', searchStudyIndex(INDEX, 'alice')[0]?.id === 'aaaa1111', 'alice');
  check('search by family name', searchStudyIndex(INDEX, 'sicilian')[0]?.id === 'dddd4444', 'sicilian');
  check('search is case-insensitive', searchStudyIndex(INDEX, 'LONDON')[0]?.id === 'bbbb2222', 'LONDON');
  check('all tokens must match', searchStudyIndex(INDEX, 'london caro').length === 0, 'no cross-study match');
  const byLikes = searchStudyIndex(INDEX, 'defense');
  check('results sort by likes', byLikes[0]?.id === 'dddd4444' && byLikes[1]?.id === 'aaaa1111', byLikes.map(e => e.id).join(','));
  check('empty query → no results', searchStudyIndex(INDEX, '  ').length === 0, 'empty expected');

  return results;
}
