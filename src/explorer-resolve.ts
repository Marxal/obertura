// One place to answer "how has this position scored in real games?".
//
// There are two sources and they layer: a bundled statistics set for the most
// common positions (instant, offline, no login) and — once the user has
// connected a Lichess account — the live opening explorer, which reaches every
// position but can be blocked, rate-limited or simply slow.
//
// The rule is the same wherever the answer is used: the bundled set is the
// floor, live data only ever REPLACES it when it actually arrives with
// something. A live fetch that couldn't be reached is reported as `liveFailed`
// so a caller can say so, rather than letting a silent degrade to built-in data
// look like "this position is unexplored".
//
// THE RATING BAND ADDS TWO MORE WAYS TO BE WRONG, and both get their own field
// rather than being folded into the two above:
//
//   `coverage` — what the returned numbers ACTUALLY describe. The bundled set
//     has no rating dimension at all, so it is always 'all'. A caller labels
//     from this field and never from the user's preference: that is what makes
//     "unfiltered numbers presented as filtered" impossible rather than merely
//     unlikely. Ask for 1400–1800, have the live fetch fail, and you get bundled
//     numbers marked 'all' — which the UI must then describe as all-ratings.
//
//   `bandEmpty` — we reached the explorer, with a narrow band, and this position
//     has no games AT THIS LEVEL. Deep positions do this routinely. It is not
//     "unexplored" and it is not a failure, so it can be neither the frontier
//     note nor `liveFailed`; the caller offers to widen the band instead.
//
// A band that comes back empty deliberately does NOT fall through to the bundled
// set. The position plainly has games at other levels, and showing those
// unlabelled — right where the user just asked for their own level — is the one
// lie this module exists to prevent.
//
// The Library slide and the Explore slide both ask this question on every move,
// so it lives here instead of once in each.

import { fetchExplorer, type ExplorerCounts, type ExplorerDb } from './lichess-explorer';
import { isNarrowed, type ExplorerFilter } from './explorer-bands';
import { bundledStats } from './explorer-stats';
import { isConnected, getAccessToken } from './lichess-auth';

export interface ResolvedStats {
  // The stats to render — live when it answered, else bundled. Null when the
  // caller's position moved on mid-fetch and the answer is stale.
  moves: Map<string, ExplorerCounts> | null;
  // True ONLY when we're connected and the live fetch couldn't be reached (an
  // error, an abort, a block). An empty "reached, but no games here" answer is
  // not a failure.
  liveFailed: boolean;
  // What `moves` describes: the requested rating band, or every rating.
  coverage: 'band' | 'all';
  // Reached the explorer with a narrow band; no games here at that level.
  bandEmpty: boolean;
}

// `allowLive` gates the network call, so a hidden panel never chatters. The
// optional `stillHere` is checked after the await: a caller whose board has
// moved on gets `moves: null` instead of stats for the previous position.
// `filter` is the rating band, or null for a database that has no such notion.
export function resolveExplorerStats(
  fen: string,
  db: ExplorerDb,
  allowLive: boolean,
  stillHere: () => boolean = () => true,
  filter: ExplorerFilter | null = null,
): Promise<ResolvedStats> {
  const narrowed = isNarrowed(filter);
  return bundledStats(fen, db).then(async bundled => {
    if (allowLive && isConnected()) {
      const token = await getAccessToken();
      if (!stillHere()) return stale();                                 // moved on
      const live = await fetchExplorer(fen, db, token, filter);
      if (live === null) return { moves: bundled, liveFailed: true, coverage: 'all' as const, bandEmpty: false };
      if (live.size) {
        return { moves: live, liveFailed: false, coverage: narrowed ? 'band' as const : 'all' as const, bandEmpty: false };
      }
      // Reached, no games here. With a narrow band that's a statement about the
      // LEVEL, not about the position — say so instead of quietly widening.
      if (narrowed) {
        return { moves: new Map<string, ExplorerCounts>(), liveFailed: false, coverage: 'band' as const, bandEmpty: true };
      }
      // Unfiltered and empty: past the database's reach — fall through to
      // bundled, no failure.
    }
    return { moves: bundled, liveFailed: false, coverage: 'all' as const, bandEmpty: false };
  });
}

function stale(): ResolvedStats {
  return { moves: null, liveFailed: false, coverage: 'all', bandEmpty: false };
}

// Orient Lichess's white/draws/black counts to one side's own perspective, with
// a score%. Shared so "how did MY side do here" reads the same everywhere.
export function orientCounts(
  c: ExplorerCounts,
  colour: 'white' | 'black',
): { wins: number; draws: number; losses: number; scorePct: number; games: number } {
  const wins = colour === 'white' ? c.white : c.black;
  const losses = colour === 'white' ? c.black : c.white;
  const games = wins + c.draws + losses;
  const scorePct = games ? Math.round(((wins + c.draws / 2) / games) * 100) : 0;
  return { wins, draws: c.draws, losses, scorePct, games };
}
