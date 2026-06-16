// Opponent scouting — the data layer behind the Explore tab's opponents.
//
// An "opponent" is someone you've imported games for, to scout their openings.
// We pull their games with the SAME import as everything else, only from THEIR
// perspective (colour / result / opponent are all about them), then precompute
// two opening MAPS — one over their White games, one over their Black — the
// moment the import finishes, so opening a map later is instant.
//
// Everything (games + the precomputed trees) lives in one IndexedDB record per
// opponent; deleting the record removes every trace of them. There's a hard cap
// of MAX_OPPONENTS so the device never fills with scouting data.

import { Chess } from 'chess.js';
import type { MoveNode } from './tree';
import type { Line } from './types';
import type { ImportedGame, Platform } from './import-core';
import { openingFamily, UNKNOWN_FAMILY } from './analysis';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// At most this many opponents on the device at once (the Explore cap).
export const MAX_OPPONENTS = 10;

// How deep the maps render. They open at MAP_START_PLIES = 10 plies (5 moves)
// and "Go deeper" steps MAP_STEP_PLIES = 10 plies (5 moves) at a time, repeatably,
// up to the data's true reach (capped at MAP_MAX_PLIES = OPENING_PLIES = 60, the
// deepest the stored games keep). Pruning keeps the main lines legible — see
// prune(); old, shallow imports can't reach the deep view — see opponentReachPlies.
export const MAP_START_PLIES = 10;
export const MAP_STEP_PLIES = 10;
export const MAP_MAX_PLIES = 60;

// The persisted opponent record. `games` is the source of truth; `whiteTree`
// and `blackTree` are the precomputed maps (rebuilt on every import / refresh).
export interface Opponent {
  id: string;
  name: string;             // display name = the scouted username
  platform: Platform;
  username: string;
  gamesAnalysed: number;
  refreshedAt: string;      // ISO
  avatarUrl?: string;       // Chess.com profile picture, when they have one
  games: ImportedGame[];
  whiteTree: MoveNode;      // their games as White, merged into a tree
  blackTree: MoveNode;      // their games as Black
}

// ── Build a map tree from games ──────────────────────────────────────────────────

interface BuildNode {
  san: string;
  uci: string;
  fen: string;
  count: number;
  children: Map<string, BuildNode>;  // keyed by child uci
}

// Replay every game of one colour and merge them into a frequency tree, keeping
// only branches played often enough to matter and capping the depth. Returns a
// root MoveNode (empty san/uci, start position) ready for the map renderer.
export function buildOpponentTree(
  games: ImportedGame[],
  colour: 'white' | 'black',
  maxPlies: number = MAP_MAX_PLIES,
  prunable: boolean = true,
): MoveNode {
  const mine = games.filter(g => g.colour === colour);
  const root: BuildNode = { san: '', uci: '', fen: START_FEN, count: mine.length, children: new Map() };

  for (const game of mine) {
    const chess = new Chess();
    let node = root;
    const plies = Math.min(game.ucis.length, maxPlies);
    for (let i = 0; i < plies; i++) {
      const uci = game.ucis[i];
      let mv;
      try {
        mv = chess.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: (uci[4] as 'q' | 'r' | 'b' | 'n') || 'q',
        });
      } catch {
        break; // a malformed move ends this game's contribution early
      }
      if (!mv) break;
      let child = node.children.get(uci);
      if (!child) {
        child = { san: mv.san, uci, fen: chess.fen(), count: 0, children: new Map() };
        node.children.set(uci, child);
      }
      child.count++;
      node = child;
    }
  }

  // Drop rare SIDE branches so the map reads as a repertoire, not a game dump.
  // The threshold scales with the sample; tiny samples keep everything. It's also
  // clamped so the single most-played first move always survives — the map is
  // never pruned down to nothing.
  // When `prunable` is false (the map's "All replies" view), keep every played
  // move so the user sees the opponent's full branching.
  if (prunable) {
    let maxRoot = 0;
    for (const c of root.children.values()) maxRoot = Math.max(maxRoot, c.count);
    const target = mine.length >= 8 ? Math.max(2, Math.ceil(mine.length * 0.05)) : 1;
    const minCount = Math.min(target, Math.max(1, maxRoot));
    prune(root, minCount);
  }

  return toMoveNode(root, { n: 0 });
}

// Keep the single most-played continuation at every node regardless of count, so
// the main line traces all the way to the requested depth; only rarer SIDE lines
// (below minCount, and not the busiest child) are trimmed.
function prune(node: BuildNode, minCount: number): void {
  let top: BuildNode | null = null;
  for (const c of node.children.values()) {
    if (!top || c.count > top.count) top = c;
  }
  for (const [uci, child] of node.children) {
    if (child !== top && child.count < minCount) node.children.delete(uci);
    else prune(child, minCount);
  }
}

// BuildNode → MoveNode, sorting children most-played first so the map's spine
// (which the renderer centres on) is the opponent's main line.
function toMoveNode(node: BuildNode, ctr: { n: number }): MoveNode {
  const kids = [...node.children.values()]
    .sort((a, b) => b.count - a.count || a.san.localeCompare(b.san));
  return {
    id: node.uci ? `o${++ctr.n}` : 'root',
    san: node.san,
    uci: node.uci,
    fen: node.fen,
    children: kids.map(k => toMoveNode(k, ctr)),
  };
}

// ── Build / wrap an opponent ─────────────────────────────────────────────────────

// Assemble an opponent record from a finished import. Pass an existing `id` to
// refresh in place (keeps the same card); omit it to mint a new opponent.
export function makeOpponent(
  meta: { platform: Platform; username: string },
  games: ImportedGame[],
  opts: { id?: string; avatarUrl?: string } = {},
): Opponent {
  return {
    id: opts.id ?? `opp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: meta.username,
    platform: meta.platform,
    username: meta.username,
    gamesAnalysed: games.length,
    refreshedAt: new Date().toISOString(),
    ...(opts.avatarUrl ? { avatarUrl: opts.avatarUrl } : {}),
    games,
    whiteTree: buildOpponentTree(games, 'white'),
    blackTree: buildOpponentTree(games, 'black'),
  };
}

// Wrap a precomputed tree as a synthetic Line so the repertoire-map renderer —
// which speaks in Lines — can draw it unchanged.
export function opponentLine(tree: MoveNode, colour: 'white' | 'black', name: string): Line {
  return {
    id: 'opp-map',
    name,
    tags: [],
    colour,
    openingName: null,
    confidence: 0,
    lastTrained: null,
    inTraining: false,
    tree,
  };
}

// How many of an opponent's games were played as the given colour.
export function colourGameCount(opp: Opponent, colour: 'white' | 'black'): number {
  return opp.games.filter(g => g.colour === colour).length;
}

// The deepest ply an opponent's stored games of one colour actually reach (the
// longest kept move list). This is the true ceiling for "Go deeper": a game
// imported under the old 24-ply cap can never feed a 30-move map, so the map
// uses this to decide whether the deep view is offered or shows the shallow hint.
export function opponentReachPlies(opp: Opponent, colour: 'white' | 'black'): number {
  let max = 0;
  for (const g of opp.games) {
    if (g.colour === colour) max = Math.max(max, g.sans.length);
  }
  return max;
}

// ── Per-opponent aggregates (for the Explore card) ────────────────────────────
//
// One quick read over an opponent's games: their overall W/D/L (results are
// already stored from THEIR perspective, since the scouted username is the one
// the import treats as "me"), the matching score percentage, and their single
// most-played opening family. Recognised families win the headline slot; we
// only fall back to "Unrecognised opening" if that's genuinely all they have.

export interface OpponentSummary {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  scorePct: number;             // their perspective: (wins + draws/2) / games
  topOpening: string | null;    // most-played family, or null if no games
}

export function opponentSummary(opp: Opponent): OpponentSummary {
  let wins = 0, draws = 0, losses = 0;
  const familyCounts = new Map<string, number>();
  for (const g of opp.games) {
    if (g.result === 'win') wins++;
    else if (g.result === 'loss') losses++;
    else draws++;
    const fam = openingFamily(g.opening);
    familyCounts.set(fam, (familyCounts.get(fam) ?? 0) + 1);
  }

  const games = opp.games.length;
  const scorePct = games === 0 ? 0 : Math.round(((wins + draws / 2) / games) * 100);

  // Prefer the most-played RECOGNISED family; only headline an unrecognised one
  // if no named opening was ever tagged.
  let topOpening: string | null = null;
  let best = 0;
  for (const [fam, n] of familyCounts) {
    if (fam === UNKNOWN_FAMILY) continue;
    if (n > best) { best = n; topOpening = fam; }
  }
  if (topOpening === null && familyCounts.size > 0) topOpening = UNKNOWN_FAMILY;

  return { games, wins, draws, losses, scorePct, topOpening };
}

// ── Scouting report: where they struggle / score, and what to play ────────────
//
// A coaching dossier built purely from imported games — theirs, plus my own.
// We group each side's games into recognised opening FAMILIES (folding the
// chess.com micro-labels down the same way analysis.ts does) and keep, per
// family, the colour that side had and their W/D/L from their own perspective.
//
// Only families with a real sample of THEIR games (MIN_REPORT_GAMES) earn a row,
// so a single fluke result never headlines. From those we read off their three
// WEAKEST openings (lowest their-score) and three STRONGEST (highest), then turn
// the weakness into RECOMMENDATIONS: openings I should play against them. Every
// opening they play is reachable — I just take the other colour — so each
// recommendation is ranked by how weak THEY are, nudged by how I score in the
// same family from the side I'd actually be on. Where I've never played it, the
// rank rests on their weakness alone and the row admits it has no data on my side.

// An opening must have at least this many of the opponent's games before it
// earns a report row — fewer is statistical noise, not a tendency.
export const MIN_REPORT_GAMES = 5;
// How many openings each report group shows.
const REPORT_PICKS = 3;
// How far my own record may tip a recommendation: half a point per point my
// family score sits away from an even 50%. Their weakness is the main axis; my
// results only break the tie between similarly soft openings.
const MY_EDGE_WEIGHT = 0.5;

// One opening's record: all games of one family where a player had one colour,
// summed W/D/L from that player's own perspective.
export interface OpeningRecord {
  family: string;
  colour: 'white' | 'black';   // the colour that player had in these games
  games: number;
  wins: number;
  draws: number;
  losses: number;
  scorePct: number;            // (wins + draws/2) / games, rounded
}

// A recommended opening to play against them: their (soft) record, the side I'd
// play it from, and my own record in that family from that side — null when I've
// never played it (the row then carries a "no data on your side" hint).
export interface Recommendation {
  their: OpeningRecord;
  myColour: 'white' | 'black'; // opposite of the colour they played
  mine: OpeningRecord | null;
}

export interface ScoutReport {
  enoughGames: boolean;        // false → the honest "import more" empty state
  weakest: OpeningRecord[];    // their lowest-scoring openings (≤ REPORT_PICKS)
  strongest: OpeningRecord[];  // their highest-scoring openings (≤ REPORT_PICKS)
  recommendations: Recommendation[];
}

function reportScore(wins: number, draws: number, games: number): number {
  return games === 0 ? 0 : Math.round(((wins + draws / 2) / games) * 100);
}

// Group games by recognised family + the colour that player had, tallying W/D/L
// from their perspective. Unrecognised openings are dropped: they bundle
// unrelated lines under one label, so their record would mean nothing.
function recordsByFamily(games: ImportedGame[]): Map<string, OpeningRecord> {
  const map = new Map<string, OpeningRecord>();
  for (const g of games) {
    const family = openingFamily(g.opening);
    if (family === UNKNOWN_FAMILY) continue;
    const key = `${family}|${g.colour}`;
    let rec = map.get(key);
    if (!rec) {
      rec = { family, colour: g.colour, games: 0, wins: 0, draws: 0, losses: 0, scorePct: 0 };
      map.set(key, rec);
    }
    rec.games++;
    if (g.result === 'win') rec.wins++;
    else if (g.result === 'loss') rec.losses++;
    else rec.draws++;
  }
  for (const rec of map.values()) rec.scorePct = reportScore(rec.wins, rec.draws, rec.games);
  return map;
}

// The whole report from one opponent's games and my own imported games. Pure and
// order-independent: it only reads families, colours and results.
export function buildScoutReport(opponentGames: ImportedGame[], myGames: ImportedGame[]): ScoutReport {
  const theirs = recordsByFamily(opponentGames);
  const mine = recordsByFamily(myGames);

  // Only openings with a real sample of THEIR games count.
  const qualifying = [...theirs.values()].filter(r => r.games >= MIN_REPORT_GAMES);
  if (qualifying.length === 0) {
    return { enoughGames: false, weakest: [], strongest: [], recommendations: [] };
  }

  const weakest = [...qualifying]
    .sort((a, b) => a.scorePct - b.scorePct || b.games - a.games || a.family.localeCompare(b.family))
    .slice(0, REPORT_PICKS);

  const strongest = [...qualifying]
    .sort((a, b) => b.scorePct - a.scorePct || b.games - a.games || a.family.localeCompare(b.family))
    .slice(0, REPORT_PICKS);

  // What to play: rank their soft openings by their weakness, nudged by my own
  // record in the family from the side I'd play it (the opposite colour).
  const recommendations = qualifying
    .map(their => {
      const myColour: 'white' | 'black' = their.colour === 'white' ? 'black' : 'white';
      const myRec = mine.get(`${their.family}|${myColour}`) ?? null;
      const base = 100 - their.scorePct;
      const nudge = myRec ? MY_EDGE_WEIGHT * (myRec.scorePct - 50) : 0;
      return { their, myColour, mine: myRec, rank: base + nudge };
    })
    .sort((a, b) =>
      b.rank - a.rank ||
      a.their.scorePct - b.their.scorePct ||
      b.their.games - a.their.games ||
      a.their.family.localeCompare(b.their.family))
    .slice(0, REPORT_PICKS)
    .map(({ their, myColour, mine: myRec }) => ({ their, myColour, mine: myRec }));

  return { enoughGames: true, weakest, strongest, recommendations };
}

// ── Opponent tags ─────────────────────────────────────────────────────────────
//
// A line prepared against a scouted opponent carries a tag like "vs magnus"
// alongside its normal tags. That single string is what the Lines/Train filters
// and the Prep training mode key off — no extra field on the Line.

const OPPONENT_TAG_PREFIX = 'vs ';

// The tag a prepared reply carries for this opponent.
export function opponentTag(name: string): string {
  return `${OPPONENT_TAG_PREFIX}${name}`;
}

// Whether a tag was minted by the Prepare flow (i.e. ties a line to an opponent).
export function isOpponentTag(tag: string): boolean {
  return tag.startsWith(OPPONENT_TAG_PREFIX);
}
