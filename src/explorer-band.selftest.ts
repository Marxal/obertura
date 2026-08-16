// Network-free checks for the explorer's rating band: the band→bucket mapping,
// the "around my level" window, the level inference chain, and — the one that
// matters most — that the request cache key actually varies with the band.
//
// A band that reaches the URL but not the cache key produces plausible-looking
// wrong numbers with no visible symptom, so it gets tested rather than eyeballed.

import {
  ALL_RATINGS, RATING_BUCKETS, aroundBuckets, bandRangeLabel, bucketIndex,
  bucketsFor, explorerFilter, isNarrowed, parseBand,
} from './explorer-bands';
import { levelFromGameList } from './explorer-level';
import type { ImportedGame, TimeClass } from './import-core';

export interface TestResult { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail = ''): TestResult {
  return { name, pass, detail };
}

let seq = 0;
function game(timeClass: TimeClass, myRating: number, endTime: number, rated = true): ImportedGame {
  return {
    id: `g${seq++}`,
    url: '',
    endTime,
    timeClass,
    timeControl: '600',
    rated,
    colour: 'white',
    result: 'win',
    opponent: 'someone',
    myRating,
    eco: null,
    opening: null,
    sans: ['e4'],
    ucis: ['e2e4'],
    plyCount: 1,
  };
}

export function runExplorerBandSelfTest(): TestResult[] {
  const out: TestResult[] = [];

  // ── The API's buckets ──────────────────────────────────────────────────────
  out.push(check(
    'buckets match the API enum',
    RATING_BUCKETS.join(',') === '0,1000,1200,1400,1600,1800,2000,2200,2500',
    RATING_BUCKETS.join(','),
  ));

  // "All ratings" must reproduce the exact string the app sent before bands
  // existed — that is what makes "no regression" a fact rather than a hope.
  out.push(check(
    'all-ratings string is the pre-band request',
    ALL_RATINGS === '0,1000,1200,1400,1600,1800,2000,2200,2500',
    ALL_RATINGS,
  ));

  // ── Fixed bands ────────────────────────────────────────────────────────────
  const fixed: [Parameters<typeof bucketsFor>[0], string][] = [
    ['u1400', '0,1000,1200'],
    ['r1400', '1400,1600'],
    ['r1800', '1800,2000'],
    ['r2200', '2200,2500'],
  ];
  for (const [band, expected] of fixed) {
    const got = (bucketsFor(band, null) ?? []).join(',');
    out.push(check(`band ${band} → ${expected}`, got === expected, got));
  }

  // The bands must tile the range with no gap and no overlap: every bucket in
  // exactly one band, or some ratings would be unreachable through the UI.
  const tiled = fixed.flatMap(([b]) => [...(bucketsFor(b, null) ?? [])]);
  out.push(check(
    'the four fixed bands tile every bucket exactly once',
    tiled.length === RATING_BUCKETS.length
      && tiled.every((v, i) => v === RATING_BUCKETS[i]),
    tiled.join(','),
  ));

  // ── Around my level ────────────────────────────────────────────────────────
  out.push(check('bucketIndex(1520) is the 1400 bucket', bucketIndex(1520) === 3, String(bucketIndex(1520))));
  out.push(check('bucketIndex(999) is the bottom bucket', bucketIndex(999) === 0, String(bucketIndex(999))));
  out.push(check('bucketIndex(3000) clamps to the top bucket',
    bucketIndex(3000) === RATING_BUCKETS.length - 1, String(bucketIndex(3000))));

  out.push(check(
    'around 1520 is 1200–1799 (one bucket either side)',
    aroundBuckets(1520).join(',') === '1200,1400,1600',
    aroundBuckets(1520).join(','),
  ));
  // The window must not fall off either end of the array.
  out.push(check(
    'around 700 clips at the bottom',
    aroundBuckets(700).join(',') === '0,1000',
    aroundBuckets(700).join(','),
  ));
  out.push(check(
    'around 2900 clips at the top',
    aroundBuckets(2900).join(',') === '2200,2500',
    aroundBuckets(2900).join(','),
  ));
  // A rating exactly on a boundary must still get a window around it, not a
  // single bucket — the whole reason for the ±1.
  out.push(check(
    'a rating on a bucket edge still gets three buckets',
    aroundBuckets(1400).length === 3,
    aroundBuckets(1400).join(','),
  ));

  out.push(check(
    'range label spells the span',
    bandRangeLabel('r1400', null) === '1400–1799',
    bandRangeLabel('r1400', null),
  ));
  out.push(check(
    'the top band is open-ended',
    bandRangeLabel('r2200', null) === '2200+',
    bandRangeLabel('r2200', null),
  ));
  out.push(check(
    'my-level range follows the rating',
    bandRangeLabel('mine', 1520) === '1200–1799',
    bandRangeLabel('mine', 1520),
  ));

  // ── The filter, and masters ────────────────────────────────────────────────
  const mastersFilter = explorerFilter('masters', 'r1400', 1520);
  out.push(check(
    'masters never gets a rating filter',
    mastersFilter === null,
    JSON.stringify(mastersFilter),
  ));
  out.push(check(
    'masters is never treated as narrowed',
    !isNarrowed(mastersFilter),
  ));

  // "Around my level" with no level must degrade to the full range, not to an
  // empty or partial filter.
  const noLevel = explorerFilter('lichess', 'mine', null);
  out.push(check(
    'my-level with no rating falls back to every bucket',
    noLevel?.ratings === ALL_RATINGS,
    String(noLevel?.ratings),
  ));
  out.push(check('…and is not reported as narrowed', !isNarrowed(noLevel)));
  out.push(check('a real band IS reported as narrowed',
    isNarrowed(explorerFilter('lichess', 'r1800', null))));

  // ── The cache key ──────────────────────────────────────────────────────────
  // Mirrors lichess-explorer's cacheKey. Keyed on position alone, a band change
  // would serve the previous band's numbers back and look entirely correct.
  const key = (db: 'masters' | 'lichess', band: Parameters<typeof explorerFilter>[1], rating: number | null, fen: string) => {
    const f = explorerFilter(db, band, rating);
    return `${db}|${f?.ratings ?? ''}|${f?.speeds ?? ''}|${fen}`;
  };
  const FEN = 'r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 5';
  out.push(check(
    'two bands at the same position get different cache keys',
    key('lichess', 'r1400', null, FEN) !== key('lichess', 'r2200', null, FEN),
  ));
  out.push(check(
    'a band differs from all-ratings at the same position',
    key('lichess', 'r1400', null, FEN) !== key('lichess', 'all', null, FEN),
  ));
  out.push(check(
    'the two databases still get different keys',
    key('masters', 'all', null, FEN) !== key('lichess', 'all', null, FEN),
  ));
  out.push(check(
    'the same band at the same position is stable (it must still cache)',
    key('lichess', 'r1400', null, FEN) === key('lichess', 'r1400', null, FEN),
  ));
  // Two different ratings that land in the same window must share a key — the
  // key follows the REQUEST, not the user.
  out.push(check(
    'ratings in the same window share a key',
    key('lichess', 'mine', 1450, FEN) === key('lichess', 'mine', 1550, FEN),
  ));
  out.push(check(
    'ratings in different windows do not',
    key('lichess', 'mine', 1450, FEN) !== key('lichess', 'mine', 2300, FEN),
  ));

  // ── Level from games ───────────────────────────────────────────────────────
  out.push(check('no games → no level', levelFromGameList([]) === null));

  // The most-played class wins, even when another class has the newer games.
  const mixed = [
    game('blitz', 1500, 100), game('blitz', 1520, 200), game('blitz', 1510, 300),
    game('rapid', 1900, 400),
  ];
  const fromMixed = levelFromGameList(mixed);
  out.push(check(
    'the most-played time class decides',
    fromMixed?.timeClass === 'blitz' && fromMixed.source === 'games',
    JSON.stringify(fromMixed),
  ));

  // A median, not the last game: one outlier must not move the band.
  const spiky = [
    game('blitz', 1500, 100), game('blitz', 1510, 200), game('blitz', 1490, 300),
    game('blitz', 1505, 400), game('blitz', 900, 500),
  ];
  const fromSpiky = levelFromGameList(spiky);
  out.push(check(
    'one outlier game does not move the level',
    fromSpiky?.rating === 1500,
    String(fromSpiky?.rating),
  ));

  // Unrated games, and games with no rating on them, say nothing about a level.
  out.push(check(
    'unrated games are ignored',
    levelFromGameList([game('blitz', 1500, 100, false)]) === null,
  ));

  // ── Stored value ───────────────────────────────────────────────────────────
  out.push(check('a stored band round-trips', parseBand('r1800') === 'r1800'));
  out.push(check('an unknown stored band is discarded', parseBand('r9999') === null));
  out.push(check('no stored band is null, not "all"', parseBand(null) === null));

  return out;
}
