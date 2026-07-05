// Runnable checks for the Learn tab's pure builders — Wikibooks titles/URLs,
// Lichess slugs and search queries are all string-in/string-out, so they verify
// fully offline (the only part of the content layer the build container can
// exercise; the live fetches are checked on the phone). Same shape as the other
// *.selftest.ts files, surfaced in Settings → Diagnostics.

import { Chess } from 'chess.js';
import {
  wikibooksTitle, wikibooksUrl, lichessOpeningUrl, lichessAnalysisUrl,
  openingQuery, exactQuery,
} from './content-sources';
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

export function runContentSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string): void => {
    results.push({ name, pass, detail });
  };

  // 1. Wikibooks page title, in the book's exact format.
  const title = wikibooksTitle(['e4', 'c5', 'Nf3', 'd6']);
  check(
    'wikibooks title follows the book format',
    title === 'Chess Opening Theory/1. e4/1...c5/2. Nf3/2...d6',
    title,
  );

  // 2. The URL form underscores white moves and keeps black's dots.
  const url = wikibooksUrl(['e4', 'c5', 'Nf3', 'd6']);
  check(
    'wikibooks URL underscores the spaces',
    url === 'https://en.wikibooks.org/wiki/Chess_Opening_Theory/1._e4/1...c5/2._Nf3/2...d6',
    url,
  );

  // 3. A check keeps its + mark (percent-encoded) — e.g. the Moscow's 3.Bb5+.
  const moscow = wikibooksUrl(['e4', 'c5', 'Nf3', 'd6', 'Bb5+']);
  check('a checking move keeps its + in the URL', moscow.endsWith('/3._Bb5%2B'), moscow);

  // 4. Lichess opening slugs: colon dropped, spaces underscored.
  const naj = lichessOpeningUrl('Sicilian Defense: Najdorf Variation');
  check(
    'lichess slug drops the colon',
    naj === 'https://lichess.org/opening/Sicilian_Defense_Najdorf_Variation',
    String(naj),
  );

  // 5. Apostrophes vanish (King's → Kings), matching lichess's own slugs.
  const kid = lichessOpeningUrl("King's Indian Defense");
  check(
    'lichess slug drops apostrophes',
    kid === 'https://lichess.org/opening/Kings_Indian_Defense',
    String(kid),
  );

  // 6. A comma sub-variation links its parent page (the deep slug rarely exists).
  const adams = lichessOpeningUrl('Sicilian Defense: Najdorf Variation, Adams Attack');
  check(
    'a comma sub-variation links the parent page',
    adams === 'https://lichess.org/opening/Sicilian_Defense_Najdorf_Variation',
    String(adams),
  );

  // 7. Diacritics flatten (Grünfeld → Grunfeld).
  const grunfeld = lichessOpeningUrl('Grünfeld Defense');
  check(
    'diacritics flatten in the slug',
    grunfeld === 'https://lichess.org/opening/Grunfeld_Defense',
    String(grunfeld),
  );

  // 8. Search queries flatten the name's punctuation.
  const query = openingQuery('Sicilian Defense: Najdorf Variation, English Attack');
  check(
    'search query flattens punctuation',
    query === 'Sicilian Defense Najdorf Variation English Attack',
    query,
  );

  // 9. The exact-position query numbers the moves and leads with the name.
  const exact = exactQuery(['e4', 'c5', 'Nf3', 'd6'], 'Sicilian Defense');
  check(
    'exact query numbers the moves',
    exact === 'Sicilian Defense 1. e4 c5 2. Nf3 d6',
    exact,
  );

  // 10. …and caps at 12 half-moves so the string stays a plausible search.
  const long = exactQuery(Array.from({ length: 20 }, (_, i) => `m${i + 1}`));
  check(
    'exact query caps at 12 half-moves',
    long.includes('6. m11 m12') && !long.includes('m13'),
    long,
  );

  // 11. The analysis deep link underscores the FEN (slashes stay).
  const fen = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
  const analysis = lichessAnalysisUrl(fen);
  check(
    'analysis link underscores the FEN',
    analysis === 'https://lichess.org/analysis/rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR_w_KQkq_-_0_2',
    analysis,
  );

  // 12. openingForPath: the deepest named position AND where it matched, so the
  //     panel can say "named theory ends at move N" past an off-book tail.
  const po = openingForPath(pathFens(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'a5']));
  check(
    'openingForPath reports the deepest named ply',
    po !== null && po.name === 'Italian Game' && po.ply === 5,
    JSON.stringify(po),
  );

  return results;
}
