// Turn a pile of imported Chess.com games into a coaching report.
//
// Three questions, answered purely from data already on the device (no network):
//   1. WHICH openings do I actually play, and how often?       → group by family
//   2. WHERE do I score badly?                                  → win/draw/loss %
//   3. WHERE did I leave my prep, and what should I add?        → diff vs. my tree
//
// "Family" grouping: chess.com tags games with very specific opening names
// ("Sicilian Defense Najdorf Variation Main Line …"). Counting those verbatim
// scatters a handful of games across dozens of micro-labels, so every score is
// statistical noise. We fold each name down to its opening *family* ("Sicilian
// Defense") so the buckets are big enough to mean something.
//
// "Left theory" is measured against YOUR OWN repertoire, not abstract book
// theory — the point of the trainer is your prep. We merge all your saved lines
// of a colour into one tree, then replay each game through it. The first move
// that steps off the tree (while the tree still had a move to offer) is where
// you left your prep. If it was your move, that's a hole in your discipline; if
// it was the opponent's, that's a hole in your coverage. Both are worth knowing.

import type { ImportedGame } from './chesscom';
import type { Line } from './types';
import type { MoveNode } from './tree';

// ── Tunables ────────────────────────────────────────────────────────────────────
export const UNKNOWN_FAMILY = 'Unrecognised opening';
// How deep a representative "here's the line" sample we keep for the Build button.
export const REP_PLIES = 10;
// Plies used to decide "do I already have prep that reaches this opening?".
export const COVERAGE_PLIES = 6;
// A score % only means something with a few games behind it.
export const MIN_GAMES_WEAK = 4;
// Below an even score (50 %) counts as "scoring badly".
export const WEAK_SCORE_PCT = 50;
// An opening must show up at least this often before we nag you to prep it.
export const MIN_GAMES_SUGGEST = 2;
// List caps so the report stays scannable on a phone.
export const TOP_N = 6;
export const MAX_DEVIATIONS = 10;

// ── Output shapes ────────────────────────────────────────────────────────────────

export interface OpeningStat {
  key: string;                  // family + colour, unique per row
  family: string;               // display name, e.g. "Italian Game"
  colour: 'white' | 'black';
  games: number;
  wins: number;
  losses: number;
  draws: number;
  scorePct: number;             // (wins + draws/2) / games * 100, rounded
  hasRepertoire: boolean;       // your prep already reaches this opening
  repUcis: string[];            // a representative line, UCI, for the Build button
  repSans: string[];            // same line in SAN, for display
}

export interface Deviation {
  key: string;
  family: string;
  colour: 'white' | 'black';
  ply: number;                  // 0-based ply of the move that left prep
  moveNumber: number;           // 1-based full-move number
  side: 'you' | 'opponent';     // whose move stepped off the tree
  actual: string;               // SAN actually played
  expected: string[];           // SAN(s) your prep offered instead
  count: number;                // games sharing this exact deviation
  wins: number;                 // W/L/D in those games (your perspective)
  losses: number;
  draws: number;
  prefixUcis: string[];         // in-book moves up to the deviation, for Build
}

/**
 * What an opening you play needs from you. THE reason Explore's Recommended and
 * My Lines' "From my games" became one list: they were two filters over this
 * same question, and they overlapped on exactly the case that matters most.
 *
 *  · 'none' — you play it and have no line for it. Build one.
 *  · 'weak' — you have a line and are still losing with it. The old
 *             Recommended tab could not say this: it never checked
 *             hasRepertoire, so it told you to "Build line" for openings you
 *             had already prepared, where the useful answer is to go and look
 *             at the line you have.
 *  · 'ok'   — prepared, and holding up. Worth showing: without it the list is
 *             a page of problems, and there is no way to see that the work you
 *             did is working.
 */
export type OpeningNeed = 'none' | 'weak' | 'ok';

export interface OpeningRow extends OpeningStat {
  need: OpeningNeed;
  /**
   * How much this opening is costing you: games × (100 − score). Most-played
   * and worst-scoring leads, which is the order both old lists were reaching
   * for with a filter and a cap.
   */
  attention: number;
}

export interface Analysis {
  totalGames: number;
  stats: OpeningStat[];         // every family, most-played first
  mostPlayed: OpeningStat[];
  weakest: OpeningStat[];       // scoring under even, enough games behind it
  openings: OpeningRow[];       // every recognised opening you play, ranked
  deviations: Deviation[];      // where you left your prep, most frequent first
}

/**
 * Every recognised opening you have played enough of, each labelled with what
 * it needs and ranked by how much it is costing you. Pure, uncapped: the caller
 * filters and caps.
 */
export function rankOpenings(stats: OpeningStat[]): OpeningRow[] {
  return stats
    .filter(s => s.family !== UNKNOWN_FAMILY && s.games >= MIN_GAMES_SUGGEST)
    .map(s => ({ ...s, need: openingNeed(s), attention: s.games * (100 - s.scorePct) }))
    // Attention first; among equals the more-played opening leads, then by name
    // so the order never wobbles between renders.
    .sort((a, b) => b.attention - a.attention || b.games - a.games
      || a.family.localeCompare(b.family));
}

function openingNeed(s: OpeningStat): OpeningNeed {
  if (!s.hasRepertoire) return 'none';
  // "Losing with it" needs the same floor the weakest list uses — a 0% score
  // over two games is noise, not a verdict on your prep.
  if (s.games >= MIN_GAMES_WEAK && s.scorePct < WEAK_SCORE_PCT) return 'weak';
  return 'ok';
}

// ── Opening-name → family ────────────────────────────────────────────────────────

// Words that mark the "head" of an opening family. We keep everything up to and
// including the first one, so "King's Indian Defense Saemisch …" → "King's
// Indian Defense" and "Queen's Gambit Declined …" → "Queen's Gambit".
const HEAD_WORDS = new Set([
  'Game', 'Defense', 'Defence', 'Gambit', 'Opening', 'Attack', 'System',
]);

export function openingFamily(name: string | null): string {
  if (!name) return UNKNOWN_FAMILY;
  // The bundled lichess dataset writes "Family: Variation" — everything after
  // the colon is variation detail, and the colon glued to the last family word
  // ("Defense:") used to hide it from the head-word scan below.
  const head = name.split(':')[0];
  const words = head.split(/\s+/).filter(Boolean);
  if (words.length === 0) return UNKNOWN_FAMILY;
  for (let i = 0; i < words.length; i++) {
    if (HEAD_WORDS.has(words[i])) return words.slice(0, i + 1).join(' ');
  }
  // No structural head word (e.g. "Ruy Lopez", "Bird's") — first two words.
  return words.slice(0, Math.min(2, words.length)).join(' ');
}

// Join key for matching a family across data sources. Chess.com opening names
// come from URL slugs, which drop apostrophes ("Queens Gambit"), while the
// bundled dataset keeps them ("Queen's Gambit") — and British/American
// spellings differ. Comparing keys instead of display names lets a saved line
// find its opening's game stats regardless of where each name came from.
// The bare normalisation step of familyKey, shared with the study catalogue's
// free-text search (study-catalog.ts) so "what counts as the same family name"
// lives in exactly one place. scripts/build-study-index.mjs mirrors it (plain
// Node, can't import TS) — keep the two in step.
export function normalizeFamilyText(s: string): string {
  return s.toLowerCase().replace(/['’]/g, '').replace(/defence/g, 'defense');
}

export function familyKey(name: string | null): string {
  const family = openingFamily(name);
  if (family === UNKNOWN_FAMILY) return UNKNOWN_FAMILY;
  return normalizeFamilyText(family);
}

function scorePct(wins: number, draws: number, games: number): number {
  if (games === 0) return 0;
  return Math.round(((wins + draws / 2) / games) * 100);
}

// ── Merged repertoire tree (all your lines of one colour, by UCI) ────────────────

interface MergeNode {
  san: string;                        // SAN of the move reaching this node
  children: Map<string, MergeNode>;   // keyed by child UCI
}

function newMergeNode(san = ''): MergeNode {
  return { san, children: new Map() };
}

// Fold every saved line of a colour into one tree so a game can be replayed
// against the union of all your prep at once.
function buildMergedTree(lines: Line[], colour: 'white' | 'black'): MergeNode {
  const root = newMergeNode();
  for (const line of lines) {
    if (line.colour !== colour) continue;
    graft(root, line.tree);
  }
  return root;
}

function graft(into: MergeNode, treeRoot: MoveNode): void {
  const walk = (node: MergeNode, src: MoveNode): void => {
    for (const child of src.children) {
      let next = node.children.get(child.uci);
      if (!next) {
        next = newMergeNode(child.san);
        node.children.set(child.uci, next);
      }
      walk(next, child);
    }
  };
  walk(into, treeRoot);
}

// How many plies of `ucis` the tree can follow before it runs out.
function matchedDepth(root: MergeNode, ucis: string[], limit: number): number {
  let node = root;
  let depth = 0;
  for (const uci of ucis.slice(0, limit)) {
    const next = node.children.get(uci);
    if (!next) break;
    node = next;
    depth++;
  }
  return depth;
}

// ── Per-game accumulation ────────────────────────────────────────────────────────

interface Bucket {
  family: string;
  colour: 'white' | 'black';
  games: number;
  wins: number;
  losses: number;
  draws: number;
  // Most-common opening prefix wins the "representative line" slot.
  seqCounts: Map<string, number>;
  seqSample: Map<string, { ucis: string[]; sans: string[] }>;
}

// Key a game by its first few moves so the representative line is the one you
// reach most often, not whichever game happened to sort first.
const SEQ_KEY_PLIES = 6;

function tallyResult(b: { wins: number; losses: number; draws: number }, r: ImportedGame['result']): void {
  if (r === 'win') b.wins++;
  else if (r === 'loss') b.losses++;
  else b.draws++;
}

export function analyseGames(games: ImportedGame[], lines: Line[]): Analysis {
  const merged = {
    white: buildMergedTree(lines, 'white'),
    black: buildMergedTree(lines, 'black'),
  };

  const buckets = new Map<string, Bucket>();
  const devs = new Map<string, Deviation>();

  for (const game of games) {
    const family = openingFamily(game.opening);
    const key = `${family}|${game.colour}`;

    // ── 1 & 2: group + score ──
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        family, colour: game.colour, games: 0, wins: 0, losses: 0, draws: 0,
        seqCounts: new Map(), seqSample: new Map(),
      };
      buckets.set(key, bucket);
    }
    bucket.games++;
    tallyResult(bucket, game.result);

    const seqKey = game.ucis.slice(0, SEQ_KEY_PLIES).join(',');
    bucket.seqCounts.set(seqKey, (bucket.seqCounts.get(seqKey) ?? 0) + 1);
    if (!bucket.seqSample.has(seqKey)) {
      bucket.seqSample.set(seqKey, {
        ucis: game.ucis.slice(0, REP_PLIES),
        sans: game.sans.slice(0, REP_PLIES),
      });
    }

    // ── 3: where did this game leave the prep? ──
    const dev = findDeviation(game, merged[game.colour], family);
    if (dev) {
      const dk = `${family}|${game.colour}|${dev.ply}|${dev.actual}`;
      const existing = devs.get(dk);
      if (existing) {
        existing.count++;
        tallyResult(existing, game.result);
        for (const e of dev.expected) {
          if (!existing.expected.includes(e)) existing.expected.push(e);
        }
      } else {
        devs.set(dk, {
          key: dk, family, colour: game.colour,
          ply: dev.ply, moveNumber: Math.floor(dev.ply / 2) + 1, side: dev.side,
          actual: dev.actual, expected: dev.expected,
          count: 1, wins: 0, losses: 0, draws: 0,
          prefixUcis: dev.prefixUcis,
        });
        tallyResult(devs.get(dk)!, game.result);
      }
    }
  }

  // ── Finalise opening stats ──
  const stats: OpeningStat[] = [];
  for (const b of buckets.values()) {
    // Pick the modal opening prefix as the representative line.
    let bestSeq = '';
    let bestCount = -1;
    for (const [seq, n] of b.seqCounts) {
      if (n > bestCount) { bestCount = n; bestSeq = seq; }
    }
    const sample = b.seqSample.get(bestSeq) ?? { ucis: [], sans: [] };
    const depth = matchedDepth(merged[b.colour], sample.ucis, COVERAGE_PLIES);
    const hasRepertoire = depth >= 3 && depth >= Math.min(COVERAGE_PLIES, sample.ucis.length);

    stats.push({
      key: `${b.family}|${b.colour}`,
      family: b.family,
      colour: b.colour,
      games: b.games,
      wins: b.wins,
      losses: b.losses,
      draws: b.draws,
      scorePct: scorePct(b.wins, b.draws, b.games),
      hasRepertoire,
      repUcis: sample.ucis,
      repSans: sample.sans,
    });
  }
  stats.sort((a, b) => b.games - a.games || a.family.localeCompare(b.family));

  const recognised = (s: OpeningStat) => s.family !== UNKNOWN_FAMILY;

  const mostPlayed = stats.slice(0, TOP_N);

  const weakest = stats
    .filter(s => s.games >= MIN_GAMES_WEAK && s.scorePct < WEAK_SCORE_PCT)
    .sort((a, b) => a.scorePct - b.scorePct || b.games - a.games)
    .slice(0, TOP_N);

  // Full list, uncapped: Explore's Openings tab shows the top TOP_N and reveals
  // the rest behind a "Show all". (mostPlayed / weakest keep their caps below.)
  const openings = rankOpenings(stats);

  const deviations = [...devs.values()]
    .sort((a, b) => b.count - a.count || a.ply - b.ply)
    .slice(0, MAX_DEVIATIONS);

  return { totalGames: games.length, stats, mostPlayed, weakest, openings, deviations };
}

// ── Per-line play counts ─────────────────────────────────────────────────────────
//
// "Played N times in your games": for each saved line, how many imported games
// actually went down it. A game counts if it follows the line's tree either all
// the way to a leaf (you played the whole line) OR through the opening — at least
// LINE_PLAY_PLIES of agreement — even if deep theory later diverged. That keeps
// the badge meaningful for long lines, where opponents rarely follow to the end.

// Plies of agreement that still count a game as "having played" a line.
export const LINE_PLAY_PLIES = COVERAGE_PLIES;

export function countGamesPerLine(games: ImportedGame[], lines: Line[]): Map<string, number> {
  const counts = new Map<string, number>();
  // Build each line's tree once, then pour every game of that colour through it.
  const trees = lines.map(line => {
    const root = newMergeNode();
    graft(root, line.tree);
    return { id: line.id, colour: line.colour, root };
  });
  for (const t of trees) counts.set(t.id, 0);

  for (const game of games) {
    for (const t of trees) {
      if (t.colour !== game.colour) continue;
      if (gameFollowsLine(t.root, game.ucis)) {
        counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function gameFollowsLine(root: MergeNode, ucis: string[]): boolean {
  if (root.children.size === 0) return false; // an empty line matches nothing
  let node = root;
  for (let ply = 0; ply < ucis.length; ply++) {
    const next = node.children.get(ucis[ply]);
    if (!next) return false;                      // game stepped off the line
    node = next;
    if (node.children.size === 0) return true;    // reached a leaf — whole line played
    if (ply + 1 >= LINE_PLAY_PLIES) return true;  // stayed on the line through the opening
  }
  return false; // game ended before the line did
}

// Replay one game through the merged tree; return the first move that left prep
// while the tree still had a move on offer, or null if the game stayed in book
// (or your prep simply ran out — that's "past book", not a deviation).
function findDeviation(
  game: ImportedGame,
  root: MergeNode,
  _family: string,
): { ply: number; side: 'you' | 'opponent'; actual: string; expected: string[]; prefixUcis: string[] } | null {
  let node = root;
  const userIsWhite = game.colour === 'white';

  for (let ply = 0; ply < game.ucis.length; ply++) {
    const next = node.children.get(game.ucis[ply]);
    if (next) { node = next; continue; }

    // Off the tree. If the tree had nothing more to say, we're simply past book.
    if (node.children.size === 0) return null;

    const whiteToMove = ply % 2 === 0;
    const side: 'you' | 'opponent' = whiteToMove === userIsWhite ? 'you' : 'opponent';
    return {
      ply,
      side,
      actual: game.sans[ply] ?? game.ucis[ply],
      expected: [...node.children.values()].map(c => c.san).filter(Boolean),
      prefixUcis: game.ucis.slice(0, ply),
    };
  }
  return null;
}
