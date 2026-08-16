// The rating band the opening explorer's numbers are filtered to, and the one
// place that turns a human band into the Lichess API's fixed rating buckets.
//
// WHY THIS IS ITS OWN FILE. The label ("1400–1800") and the API value
// ("ratings=1400,1600") have to agree, forever. Keeping them side by side in one
// table is the only way that stays true — and the FILTER OBJECT built here is
// the same value that becomes both the request's query string and its cache key
// (see lichess-explorer.ts), so a band can never reach the network without also
// reaching the key.
//
// THE API, VERIFIED (Lichess's own OpenAPI spec + lila-openingexplorer source):
//
//   • /lichess takes `ratings` and `speeds`. `ratings` is a comma-separated list
//     of BUCKET LOWER BOUNDS from a fixed enum. Each bucket runs from its value
//     up to the next one — 0 covers 0–999, 1000 covers 1000–1199, … and 2500 is
//     open-ended (it swallows the server's internal 2800/3200 groups).
//
//   • A game's bucket is chosen by the AVERAGE of BOTH players' ratings, not by
//     one player's. So "1400–1800" means "games played at that level", not
//     "games where somebody rated 1400–1800 played". Close enough to be useful;
//     different enough that the info dialog says so.
//
//   • /masters takes NEITHER. Its only date filters are `since`/`until` in
//     YEARS. And because the server ignores unknown query parameters rather than
//     rejecting them, sending `ratings` to /masters returns HTTP 200 with
//     UNFILTERED numbers — a silent lie. That is why the band is never sent for
//     masters (explorerFilter returns null) and why the control is disabled
//     there rather than merely ignored.

// The API's fixed buckets, lowest bound first. Do not reorder: the "around my
// level" window walks this array by index.
export const RATING_BUCKETS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500] as const;

// Every bucket — the widest possible sample, and byte-for-byte the string the
// app has always sent. Picking "All ratings" therefore reproduces the exact
// pre-band request, which is what makes "no regression" checkable rather than
// hopeful.
export const ALL_RATINGS = RATING_BUCKETS.join(',');

// Every speed. There is deliberately no speed CONTROL: narrowing the sample by
// something the user can't see is how numbers change for invisible reasons. See
// the round notes in ROADMAP.md.
export const ALL_SPEEDS = 'ultraBullet,bullet,blitz,rapid,classical,correspondence';

// The six bands the UI offers. 'mine' is the only one that needs a rating to
// resolve; without one it degrades to 'all'.
export type ExplorerBand = 'all' | 'u1400' | 'r1400' | 'r1800' | 'r2200' | 'mine';

export const BANDS: readonly ExplorerBand[] = ['all', 'u1400', 'r1400', 'r1800', 'r2200', 'mine'];

// The fixed bands, as bucket lower bounds. 'mine' is absent: it's computed from
// the user's rating (aroundBuckets below).
const FIXED: Record<Exclude<ExplorerBand, 'mine'>, readonly number[]> = {
  all: RATING_BUCKETS,
  u1400: [0, 1000, 1200],       // 0 – 1399
  r1400: [1400, 1600],          // 1400 – 1799
  r1800: [1800, 2000],          // 1800 – 2199
  r2200: [2200, 2500],          // 2200 and up
};

// The full label, for the info dialog, Settings and aria-labels.
export function bandLabel(band: ExplorerBand): string {
  switch (band) {
    case 'u1400': return 'Under 1400';
    case 'r1400': return '1400–1800';
    case 'r1800': return '1800–2200';
    case 'r2200': return '2200+';
    case 'mine': return 'Around my level';
    default: return 'All ratings';
  }
}

// The short label for the segmented strip next to the database toggle, where six
// options share a phone's width.
export function bandShort(band: ExplorerBand): string {
  switch (band) {
    case 'u1400': return '<1400';
    case 'r1400': return '1400–1800';
    case 'r1800': return '1800–2200';
    case 'r2200': return '2200+';
    case 'mine': return 'My level';
    default: return 'All';
  }
}

// Which bucket a rating falls in, as an index into RATING_BUCKETS. Anything at
// or above 2500 lands in the open-ended top bucket.
export function bucketIndex(rating: number): number {
  let i = 0;
  for (let n = 0; n < RATING_BUCKETS.length; n++) {
    if (rating >= RATING_BUCKETS[n]) i = n;
  }
  return i;
}

// "Around my level" = the bucket you're in, PLUS ONE EITHER SIDE.
//
// A single bucket would make 1399 and 1401 different players, and at the edge of
// a bucket most of the games nearest your strength would sit just outside the
// filter. One bucket either way is a genuine window (roughly ±300 in the middle
// of the range) that never lands on a boundary, and it keeps the sample big
// enough that deep positions still have games in them.
export function aroundBuckets(rating: number): number[] {
  const i = bucketIndex(rating);
  const from = Math.max(0, i - 1);
  const to = Math.min(RATING_BUCKETS.length - 1, i + 1);
  return RATING_BUCKETS.slice(from, to + 1);
}

// The rating span a band actually covers, in words — "1200–1799", "2200+". Used
// for the quiet caption under the control, so "Around my level" is never a
// number the user can't see.
export function bandRangeLabel(band: ExplorerBand, rating: number | null): string {
  const buckets = bucketsFor(band, rating);
  if (!buckets || buckets.length === RATING_BUCKETS.length) return 'all ratings';
  const low = buckets[0];
  const topIndex = RATING_BUCKETS.indexOf(buckets[buckets.length - 1] as typeof RATING_BUCKETS[number]);
  // The last bucket is open-ended, so a band that reaches it has no upper edge.
  if (topIndex === RATING_BUCKETS.length - 1) return `${low}+`;
  return `${low}–${RATING_BUCKETS[topIndex + 1] - 1}`;
}

// The buckets a band resolves to, or null when it can't resolve ('mine' with no
// known rating) — in which case the caller falls back to the full range.
export function bucketsFor(band: ExplorerBand, rating: number | null): readonly number[] | null {
  if (band === 'mine') return rating === null ? null : aroundBuckets(rating);
  return FIXED[band];
}

// What actually goes on the wire. `ratings` and `speeds` are the final,
// already-serialised query values — the request and the cache key are both built
// from these exact strings, so they cannot disagree.
export interface ExplorerFilter {
  ratings: string;
  speeds: string;
}

export const ALL_FILTER: ExplorerFilter = { ratings: ALL_RATINGS, speeds: ALL_SPEEDS };

// The filter for a database + band + rating.
//
// Returns NULL for masters — not an all-ratings filter, but "this database has
// no rating dimension at all". The caller must then send no rating parameters,
// because masters would accept and silently ignore them.
export function explorerFilter(
  db: 'masters' | 'lichess',
  band: ExplorerBand,
  rating: number | null,
): ExplorerFilter | null {
  if (db === 'masters') return null;
  const buckets = bucketsFor(band, rating) ?? RATING_BUCKETS;
  return { ratings: buckets.join(','), speeds: ALL_SPEEDS };
}

// Is this filter a real narrowing, or just the full range spelled out? The whole
// labelling rule downstream hangs off this: only a NARROWED request may have its
// results described as being "at your level".
export function isNarrowed(filter: ExplorerFilter | null): boolean {
  return !!filter && filter.ratings !== ALL_RATINGS;
}

// Parse a stored band, tolerating anything unexpected (a hand-edited value, a
// key from a future version) by falling back to the widest, safest answer.
export function parseBand(raw: string | null): ExplorerBand | null {
  return raw && (BANDS as readonly string[]).includes(raw) ? raw as ExplorerBand : null;
}
