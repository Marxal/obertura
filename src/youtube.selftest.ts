// Runnable checks for the Learn tab's pure pieces — the search-query builders
// and the deepest-named-opening lookup are string/array-in, string-out, so
// they verify fully offline (the live search itself is checked on the phone).
// Same shape as the other *.selftest.ts files, surfaced in Settings →
// Diagnostics.

import { Chess } from 'chess.js';
import { openingQuery, videoQuery, youtubeSearchUrl, watchUrl } from './youtube';
import { openingForPath } from './openings';
import type { TestResult } from './selftest-panel';

// The FEN of every position along a line, in order — what openingForPath expects.
function pathFens(sans: string[]): string[] {
  const chess = new Chess();
  return sans.map(san => {
    chess.move(san);
    return chess.fen();
  });
}

export function runYoutubeSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string): void => {
    results.push({ name, pass, detail });
  };

  // 1. The opening name flattens its punctuation for a search box.
  const query = openingQuery('Sicilian Defense: Najdorf Variation, English Attack');
  check(
    'opening query flattens punctuation',
    query === 'Sicilian Defense Najdorf Variation English Attack',
    query,
  );

  // 2-3. The video search carries the side the user is building for.
  const white = videoQuery('Caro-Kann Defense', 'white');
  check(
    'video query carries the white perspective',
    white === 'Caro-Kann Defense chess opening for white',
    white,
  );
  const black = videoQuery('Sicilian Defense: Najdorf Variation', 'black');
  check(
    'video query carries the black perspective',
    black === 'Sicilian Defense Najdorf Variation chess opening for black',
    black,
  );

  // 4. The deep link encodes the query.
  const url = youtubeSearchUrl('Caro-Kann Defense chess opening for white');
  check(
    'search URL encodes the query',
    url === 'https://www.youtube.com/results?search_query=Caro-Kann%20Defense%20chess%20opening%20for%20white',
    url,
  );

  // 5. Watch links address the video id.
  const watch = watchUrl('dQw4w9WgXcQ');
  check('watch URL addresses the id', watch === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', watch);

  // 6. openingForPath: the deepest named position AND where it matched, so the
  //    panel can say "named theory ends at move N" past an off-book tail.
  const po = openingForPath(pathFens(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'a5']));
  check(
    'openingForPath reports the deepest named ply',
    po !== null && po.name === 'Italian Game' && po.ply === 5,
    JSON.stringify(po),
  );

  return results;
}
