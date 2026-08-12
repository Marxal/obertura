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
// The Library slide and the Explore slide both ask this question on every move,
// so it lives here instead of once in each.

import { fetchExplorer, type ExplorerCounts, type ExplorerDb } from './lichess-explorer';
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
}

// `allowLive` gates the network call, so a hidden panel never chatters. The
// optional `stillHere` is checked after the await: a caller whose board has
// moved on gets `moves: null` instead of stats for the previous position.
export function resolveExplorerStats(
  fen: string,
  db: ExplorerDb,
  allowLive: boolean,
  stillHere: () => boolean = () => true,
): Promise<ResolvedStats> {
  return bundledStats(fen, db).then(async bundled => {
    if (allowLive && isConnected()) {
      const token = await getAccessToken();
      if (!stillHere()) return { moves: null, liveFailed: false };   // moved on
      const live = await fetchExplorer(fen, db, token);
      if (live === null) return { moves: bundled, liveFailed: true }; // couldn't reach
      if (live.size) return { moves: live, liveFailed: false };
      // live empty: reached, no games here — fall through to bundled, no failure.
    }
    return { moves: bundled, liveFailed: false };
  });
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
