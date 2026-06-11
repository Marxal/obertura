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

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// At most this many opponents on the device at once (the Explore cap).
export const MAX_OPPONENTS = 10;

// How deep the scouting map goes — 16 plies = 8 full moves, deep enough to read
// a repertoire without drowning the map in one-off middlegame branches.
const MAP_PLIES = 16;

// The persisted opponent record. `games` is the source of truth; `whiteTree`
// and `blackTree` are the precomputed maps (rebuilt on every import / refresh).
export interface Opponent {
  id: string;
  name: string;             // display name = the scouted username
  platform: Platform;
  username: string;
  gamesAnalysed: number;
  refreshedAt: string;      // ISO
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
export function buildOpponentTree(games: ImportedGame[], colour: 'white' | 'black'): MoveNode {
  const mine = games.filter(g => g.colour === colour);
  const root: BuildNode = { san: '', uci: '', fen: START_FEN, count: mine.length, children: new Map() };

  for (const game of mine) {
    const chess = new Chess();
    let node = root;
    const plies = Math.min(game.ucis.length, MAP_PLIES);
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

  // Drop rare branches so the map reads as a repertoire, not a game dump. The
  // threshold scales with the sample; tiny samples keep everything. It's also
  // clamped so the single most-played first move always survives — the map is
  // never pruned down to nothing.
  let maxRoot = 0;
  for (const c of root.children.values()) maxRoot = Math.max(maxRoot, c.count);
  const target = mine.length >= 8 ? Math.max(2, Math.ceil(mine.length * 0.05)) : 1;
  const minCount = Math.min(target, Math.max(1, maxRoot));
  prune(root, minCount);

  return toMoveNode(root, { n: 0 });
}

function prune(node: BuildNode, minCount: number): void {
  for (const [uci, child] of node.children) {
    if (child.count < minCount) node.children.delete(uci);
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
  opts: { id?: string } = {},
): Opponent {
  return {
    id: opts.id ?? `opp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: meta.username,
    platform: meta.platform,
    username: meta.username,
    gamesAnalysed: games.length,
    refreshedAt: new Date().toISOString(),
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
