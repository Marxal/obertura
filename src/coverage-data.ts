// The impure half of coverage gaps: reading the device, and the EXPLORER BUDGET.
//
// coverage-gaps.ts does the arithmetic on plain data. This file is the only
// thing that touches storage or the network, and it exists mostly to enforce one
// rule:
//
// THE EXPLORER IS ASKED ABOUT AT MOST `LIVE_BUDGET` POSITIONS PER COMPUTATION,
// SHALLOWEST FIRST, ONE AT A TIME.
//
// A repertoire of any size has far more opponent-to-move positions than that —
// sixty lines at the twelve-ply cap is a couple of hundred — and lichess-explorer.ts
// keeps a SINGLE in-flight request that any newer one aborts, so they cannot be
// fired in parallel either. Two hundred sequential round trips is a minute of
// waiting and a rate limit, for numbers that mostly repeat what your own games
// already said. So the budget spends the live requests where they buy the most:
// the shallowest positions, which are the ones you actually reach most often.
//
// Everything past the budget still gets the BUNDLED statistics set (local, free,
// instant) — which has no rating dimension, so those rows are labelled
// all-ratings and never as "at your level". That labelling comes from the
// `coverage` field explorer-resolve.ts returns, exactly as everywhere else.
//
// The result is memoised per colour and thrown away whenever the lines or games
// change, because the builder's My lines panel re-renders on every move and must
// not re-run this each time. Nothing is persisted: the memo is a variable.

import { getAllLines, getAllGames, getAllOpponents, onLinesChanged, onGamesChanged } from './storage';
import { resolveExplorerStats } from './explorer-resolve';
import { explorerFilter, bandRangeLabel, type ExplorerBand } from './explorer-bands';
import { activeBand, cachedMyLevel, resolveMyLevel, type MyLevel } from './explorer-level';
import { isConnected } from './lichess-auth';
import {
  buildCoverageReport, opponentSpots, MAX_GAP_PLIES, MAX_GAPS,
  type CoverageReport, type ExplorerReplies, type GapEvidence,
} from './coverage-gaps';

/** How many positions may be asked of the LIVE explorer in one computation. */
export const LIVE_BUDGET = 24;

/** What the live half of the pass managed to do — the screen says so out loud. */
export interface LiveReach {
  connected: boolean;
  /** Positions we asked the live explorer about. */
  asked: number;
  /** Opponent-to-move positions in the repertoire (after the depth cap). */
  positions: number;
  /** True when at least one live fetch couldn't be reached. */
  failed: boolean;
  /** The band those requests were made at, and its span in words. */
  band: ExplorerBand;
  bandLabel: string;
}

export interface CoverageLoad {
  report: CoverageReport;
  live: LiveReach;
  /** False while the explorer pass is still running. */
  complete: boolean;
}

export interface LoadOptions {
  maxPlies?: number;
  /** Called with the instant, games-and-scouts-only answer before the network. */
  onPartial?: (load: CoverageLoad) => void;
  /** Checked after every await; false abandons the pass. */
  stillHere?: () => boolean;
}

// ── The memo ─────────────────────────────────────────────────────────────────
//
// Keyed by colour, dropped whenever the repertoire or the games change. The
// builder repaints its My lines panel on every move; without this, every move
// would re-replay the games and re-spend the budget.

interface Memo { load: CoverageLoad; pending: Promise<CoverageLoad> | null }
const memo = new Map<string, Memo>();
let subscribed = false;

function subscribe(): void {
  if (subscribed) return;
  subscribed = true;
  onLinesChanged(() => memo.clear());
  onGamesChanged(() => memo.clear());
}

/** Drop what's remembered — for an erase, and for the self-test's peace of mind. */
export function resetCoverage(): void {
  memo.clear();
}

/** The last computed answer for this colour, if there is one. No work, no await. */
export function cachedCoverage(colour: 'white' | 'black'): CoverageLoad | null {
  return memo.get(memoKey(colour))?.load ?? null;
}

/**
 * The report for one colour: read the device, paint what's instant, then spend
 * the explorer budget and paint again.
 *
 * Repeated calls while a pass is running share it rather than starting a second
 * one — the builder can ask on every move without stacking requests.
 */
export async function loadCoverage(
  colour: 'white' | 'black',
  opts: LoadOptions = {},
): Promise<CoverageLoad> {
  subscribe();
  const key = memoKey(colour);
  const existing = memo.get(key);
  if (existing) {
    if (existing.load.complete) return existing.load;
    if (existing.pending) return existing.pending;
  }

  const pending = compute(colour, opts);
  memo.set(key, { load: existing?.load ?? emptyLoad(colour), pending });
  const done = await pending;
  memo.set(key, { load: done, pending: null });
  return done;
}

// The key carries the CONNECTION STATE as well as the colour, so connecting
// Lichess mid-session doesn't keep serving the answer worked out while we could
// only see the bundled set — the rows would still say "all ratings" when we can
// now do better. Disconnecting invalidates it the same way.
function memoKey(colour: 'white' | 'black'): string {
  return `${colour}|${isConnected() ? 'live' : 'offline'}`;
}

function emptyLoad(colour: 'white' | 'black'): CoverageLoad {
  return {
    report: buildCoverageReport([], colour),
    live: { connected: false, asked: 0, positions: 0, failed: false, band: 'all', bandLabel: 'all ratings' },
    complete: false,
  };
}

async function compute(colour: 'white' | 'black', opts: LoadOptions): Promise<CoverageLoad> {
  // ONE report per colour, always at the full cap. The two homes then show as
  // many of its rows as they have room for — a memo built at the builder's
  // three-row cap would be served to the screen as "you have three gaps".
  const limit = MAX_GAPS;
  const maxPlies = opts.maxPlies ?? MAX_GAP_PLIES;
  const stillHere = opts.stillHere ?? (() => true);

  const [lines, games, opponents] = await Promise.all([
    getAllLines().catch(() => []),
    getAllGames().catch(() => []),
    getAllOpponents().catch(() => []),
  ]);

  const evidence: GapEvidence = {
    games,
    opponents: opponents.map(o => ({ name: o.name, games: o.games })),
  };

  const spots = opponentSpots(lines, colour, maxPlies);
  let level: MyLevel | null = cachedMyLevel();
  let { band } = activeBand(level);

  const live: LiveReach = {
    connected: isConnected(),
    asked: 0,
    positions: spots.length,
    failed: false,
    band,
    bandLabel: bandRangeLabel(band, level?.rating ?? null),
  };

  // The instant answer: your games and your scouts, no network at all.
  const partial: CoverageLoad = {
    report: buildCoverageReport(lines, colour, evidence, { limit, maxPlies }),
    live,
    complete: false,
  };
  opts.onPartial?.(partial);
  if (!spots.length) return { ...partial, complete: true };

  // The band the requests go out at. Resolving the level may read the account,
  // so it happens once, here, and the resolved value is passed down — never
  // re-read deeper in the stack (the rule lichess-explorer.ts's cache key
  // exists to enforce).
  const resolved = await resolveMyLevel().catch(() => null);
  if (resolved) {
    level = resolved;
    band = activeBand(level).band;
    live.band = band;
    live.bandLabel = bandRangeLabel(band, level?.rating ?? null);
  }
  if (!stillHere()) return partial;

  // ALWAYS the Lichess database, never masters, whatever the Library slide is
  // set to: the question here is "what do opponents at my level actually play",
  // and masters carries no rating dimension at all.
  const filter = explorerFilter('lichess', band, level?.rating ?? null);

  const explorer = new Map<string, ExplorerReplies>();
  for (let i = 0; i < spots.length; i++) {
    if (!stillHere()) return partial;
    const spot = spots[i];
    // Past the budget we still consult the bundled set — it costs one local map
    // lookup — but ask for nothing live.
    const allowLive = live.connected && i < LIVE_BUDGET;
    if (allowLive) live.asked++;
    const res = await resolveExplorerStats(spot.fen, 'lichess', allowLive, stillHere, filter);
    if (res.liveFailed) live.failed = true;
    if (!res.moves || res.moves.size === 0) continue;
    const gamesByUci = new Map<string, number>();
    let total = 0;
    for (const [uci, c] of res.moves) {
      const n = c.white + c.draws + c.black;
      if (n <= 0) continue;
      gamesByUci.set(uci, n);
      total += n;
    }
    if (total > 0) explorer.set(spot.key, { games: gamesByUci, total, coverage: res.coverage });
  }
  if (!stillHere()) return partial;

  return {
    report: buildCoverageReport(lines, colour, { ...evidence, explorer }, { limit, maxPlies }),
    live,
    complete: true,
  };
}

/**
 * One quiet sentence about how far the live check reached, or null when there is
 * nothing worth saying. Never claims more than `LiveReach` actually did.
 */
export function liveReachNote(live: LiveReach): string | null {
  if (!live.connected) {
    return 'Built-in opening data only — connect Lichess to check these against games at your level.';
  }
  if (live.failed && live.asked > 0) {
    return 'Couldn’t reach Lichess for some positions — those rows fall back to built-in, all-ratings data.';
  }
  if (live.positions > live.asked) {
    return `Checked the ${live.asked} shallowest positions against ${live.bandLabel}; the deeper ${live.positions - live.asked} use built-in, all-ratings data.`;
  }
  return `Checked against Lichess games at ${live.bandLabel}.`;
}
