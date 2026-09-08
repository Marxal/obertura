// What the first run says about YOUR games — the arithmetic, with no DOM, no
// storage and no network in it.
//
// This is the payoff screen's data layer. A stranger types a username, the app
// fetches their games, and this turns that pile into three sentences and three
// lines worth saving: which openings they actually play, how those go, and the
// trunk of moves they play inside each one.
//
// ── IT IS DELIBERATELY ENGINE-FREE ──────────────────────────────────────────
// Everything here is replay + a table lookup, so the whole recap is INSTANT.
// That is the entire reason it exists in this shape. The first draft of this
// round also put a mistake and a brilliancy on the recap, and both come out of
// mistake-scan.ts's engine pass: up to 81 positions a game (SCAN_MAX_PLIES),
// cloud lookups paced at 120ms (CLOUD_DELAY_MS), local Stockfish at depth 8
// after three cloud misses — 15-40 seconds PER GAME, after a WASM download.
// mistake-autoscan.ts exists precisely because that is "a progress bar for ten
// minutes". So the engine half was cut from first run entirely: the background
// autoscan already builds those spots while the user gets on with things, and
// they are waiting whenever the user first reaches Mistake Retry.
//
// Nothing in this file may ever grow an engine call. If a future recap wants
// one, it belongs on a later screen, not this one.
//
// ── THE TRUNK IS THEIR MOVES, NOT A BOOK LINE ───────────────────────────────
// For each opening we walk a MAJORITY VOTE through the games in that group: at
// each ply, the move most of those games actually played, stopping when the
// group thins out or the depth cap bites. That is what makes the saved line
// theirs — it is the shared stem of how this person really plays the London,
// not what a database says the London is. A line built from one game would be
// that game's accidents; a line from the book would not be theirs at all.

import type { GameResult, TimeClass } from './import-core';

// A game as this module needs to see it. Deliberately the bare minimum rather
// than ImportedGame, so the self-test can hand it plain little objects.
export interface RecapGame {
  colour: 'white' | 'black';
  result: GameResult;
  ucis: string[];
  sans: string[];
  /** Which bucket this game was played in — the recap's time-format filter. */
  timeClass?: TimeClass;
}

// Below this many games the recap has nothing honest to say — a handful of
// games is noise, and "you play the London 100% of the time" off two games is a
// lie the user can see through immediately. Under it, first run hands over to
// the manual branch instead.
//
// Ten rather than twenty on purpose: a higher floor pushes more people onto the
// build-it-by-hand path, which is the harder one and the whole thing this round
// exists to stop being the default. Ten is enough for a top opening to be real,
// and the recap adapts to however few clear ones it finds.
export const RECAP_MIN_GAMES = 10;

// How deep a starter line goes, counted in the USER'S OWN moves — the same unit
// onboarding-lines.ts cuts its curated lines by, and for the same reason: a line
// must end on a move the user has to remember, never on the opponent's reply.
// Six is "club player" depth, a little past the curated intermediate cut.
export const TRUNK_MAX_OWN_MOVES = 6;

// A trunk shorter than this teaches nothing — two of your own moves is barely
// an opening — so a group that thins out this fast is dropped rather than
// offered as a line.
export const TRUNK_MIN_OWN_MOVES = 2;

// How many games must still agree on a move for the walk to keep going. Below
// this the group has genuinely split and the shared stem has ended.
const MIN_SUPPORT = 2;

/** One opening the user actually plays, with their own trunk through it. */
export interface OpeningGroup {
  name: string;
  colour: 'white' | 'black';
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** Their shared trunk, ending on one of their own moves. */
  ucis: string[];
  sans: string[];
  /** Percentage of that colour's games this opening accounts for, 0-100. */
  share: number;
}

export interface Recap {
  total: number;
  /** Games per time bucket, for the recap's filter chips. Only non-empty ones. */
  byTimeClass: { timeClass: TimeClass; games: number }[];
  white: number;
  black: number;
  wins: number;
  draws: number;
  losses: number;
  /** Whichever colour they played more; ties go to white. */
  dominantColour: 'white' | 'black';
  /** Every opening group that produced a usable trunk, most-played first. */
  openings: OpeningGroup[];
}

/** Is there enough here for the games-first path to be worth taking? */
export function hasEnoughGames(count: number): boolean {
  return count >= RECAP_MIN_GAMES;
}

// How many of the user's own moves a ply-count represents. White's nth move is
// ply 2n-1, Black's is 2n — so a white prefix rounds up and a black one down.
export function ownMoveCount(plies: number, colour: 'white' | 'black'): number {
  return colour === 'white' ? Math.ceil(plies / 2) : Math.floor(plies / 2);
}

// Trim a prefix so it ends on the USER's move. White plays even indices (ply 0
// is White's first), Black plays odd ones — so a white prefix wants an odd
// length and a black one an even length.
export function trimToOwnMove(ucis: readonly string[], colour: 'white' | 'black'): string[] {
  const out = [...ucis];
  const wantsOdd = colour === 'white';
  if (out.length > 0 && (out.length % 2 === 1) !== wantsOdd) out.pop();
  return out;
}

/**
 * The majority-vote walk described at the top of the file: from a group of
 * games that share an opening, the stem most of them actually played.
 *
 * Stops on any of three things — the depth cap, the games running out of moves,
 * or the group splitting so hard that no single continuation has MIN_SUPPORT
 * behind it. A one-game group is exempt from the support rule, since one game
 * agreeing with itself is the best evidence available.
 */
export function trunkOf(
  games: readonly RecapGame[],
  colour: 'white' | 'black',
  maxOwnMoves = TRUNK_MAX_OWN_MOVES,
): { ucis: string[]; sans: string[] } {
  const ucis: string[] = [];
  const sans: string[] = [];
  let pool = [...games];
  const soloGroup = games.length === 1;

  while (ownMoveCount(ucis.length, colour) < maxOwnMoves) {
    const ply = ucis.length;
    const counts = new Map<string, { n: number; san: string }>();
    for (const g of pool) {
      const uci = g.ucis[ply];
      if (!uci) continue;
      const seen = counts.get(uci);
      if (seen) seen.n++;
      else counts.set(uci, { n: 1, san: g.sans[ply] ?? uci });
    }
    if (counts.size === 0) break;

    // Most-played wins; ties break on the UCI string so the walk is
    // deterministic and the same library always produces the same line.
    let bestUci = '';
    let best = { n: 0, san: '' };
    for (const [uci, entry] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (entry.n > best.n) { best = entry; bestUci = uci; }
    }
    if (best.n < MIN_SUPPORT && !soloGroup) break;

    ucis.push(bestUci);
    sans.push(best.san);
    pool = pool.filter(g => g.ucis[ply] === bestUci);
  }

  const trimmed = trimToOwnMove(ucis, colour);
  return { ucis: trimmed, sans: sans.slice(0, trimmed.length) };
}

/**
 * Turn a library into the recap.
 *
 * `nameOf` is injected rather than imported so this module stays pure and the
 * self-test can name openings without loading the 1.2 MB bundled table. The one
 * real caller passes a function built on openings.ts's openingForPath.
 *
 * Games whose opening cannot be named are counted in the totals — they are
 * still games the person played — but they form no group, because a line called
 * "null" is not something anyone can be offered.
 */
export function buildRecap(
  games: readonly RecapGame[],
  nameOf: (game: RecapGame) => string | null,
  maxOwnMoves = TRUNK_MAX_OWN_MOVES,
): Recap {
  let white = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;

  // Keyed by colour + name, so the same opening played as both colours stays
  // two separate groups — they are two different lines to learn.
  const groups = new Map<string, { name: string; colour: 'white' | 'black'; games: RecapGame[] }>();

  for (const game of games) {
    if (game.colour === 'white') white++;
    if (game.result === 'win') wins++;
    else if (game.result === 'loss') losses++;
    else draws++;

    const name = nameOf(game);
    if (!name) continue;
    const key = `${game.colour}:${name}`;
    const group = groups.get(key);
    if (group) group.games.push(game);
    else groups.set(key, { name, colour: game.colour, games: [game] });
  }

  const black = games.length - white;

  const openings: OpeningGroup[] = [];
  for (const group of groups.values()) {
    const trunk = trunkOf(group.games, group.colour, maxOwnMoves);
    if (ownMoveCount(trunk.ucis.length, group.colour) < TRUNK_MIN_OWN_MOVES) continue;

    let w = 0;
    let d = 0;
    let l = 0;
    for (const g of group.games) {
      if (g.result === 'win') w++;
      else if (g.result === 'loss') l++;
      else d++;
    }
    const ofColour = group.colour === 'white' ? white : black;
    openings.push({
      name: group.name,
      colour: group.colour,
      games: group.games.length,
      wins: w,
      draws: d,
      losses: l,
      ucis: trunk.ucis,
      sans: trunk.sans,
      share: ofColour > 0 ? Math.round((group.games.length / ofColour) * 100) : 0,
    });
  }

  // Most-played first; ties break on name so the order never wobbles between
  // two renders of the same library.
  openings.sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));

  const buckets = new Map<TimeClass, number>();
  for (const g of games) {
    if (!g.timeClass) continue;
    buckets.set(g.timeClass, (buckets.get(g.timeClass) ?? 0) + 1);
  }

  return {
    total: games.length,
    byTimeClass: [...buckets.entries()]
      .map(([timeClass, n]) => ({ timeClass, games: n }))
      .sort((a, b) => b.games - a.games),
    white,
    black,
    wins,
    draws,
    losses,
    dominantColour: white >= black ? 'white' : 'black',
    openings,
  };
}

/**
 * The openings to offer as starter lines.
 *
 * BALANCED ACROSS THE TWO COLOURS, not simply the most-played N. A repertoire is
 * two books, and four White lines would leave the Black one empty on day one —
 * which is exactly the half of the repertoire a new user is least likely to go
 * and fill in themselves. So it deals alternately, best-first from each colour,
 * giving 2 White + 2 Black out of four whenever both colours have that much to
 * offer.
 *
 * When one colour runs dry the other takes the remaining slots, so someone who
 * only ever plays White still gets a full set rather than a short one. Within
 * each colour it is strictly most-played first, so the lines offered are always
 * that colour's best candidates.
 */
export function pickStarterOpenings(recap: Recap, want: number): OpeningGroup[] {
  if (want <= 0) return [];

  const byColour = {
    white: recap.openings.filter(o => o.colour === 'white'),
    black: recap.openings.filter(o => o.colour === 'black'),
  };
  const next = { white: 0, black: 0 };
  const picked: OpeningGroup[] = [];

  // Deal one colour at a time, starting with whichever they play more — so an
  // odd `want` gives the extra line to their dominant colour rather than to
  // whichever happens to be alphabetically first.
  let turn: 'white' | 'black' = recap.dominantColour;
  while (picked.length < want) {
    const other: 'white' | 'black' = turn === 'white' ? 'black' : 'white';
    const from = next[turn] < byColour[turn].length ? turn
      : next[other] < byColour[other].length ? other
        : null;
    if (!from) break; // both colours exhausted
    picked.push(byColour[from][next[from]]);
    next[from]++;
    turn = from === 'white' ? 'black' : 'white';
  }

  // Back into most-played order — the dealing above deliberately ignores
  // popularity across colours, and the screen should not.
  return picked.sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
}
