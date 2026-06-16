// Per-move win/draw/loss statistics, keyed by the UCI path from the start.
//
// Both opening maps want the same thing: for any position in the tree, how many
// games reached it and how they went. We get it by replaying each imported
// game's stored move list (sans + ucis run in parallel, so no board replay is
// needed) and tallying its result onto every node along the path.
//
// The result is ALWAYS read from the stored game's perspective — for opponent
// scouting that's the opponent's (the scouted user was "me" at import), for the
// repertoire map it's mine. The caller names the perspective with a caption.
//
// This is a flat lookup table, deliberately UNPRUNED (the rendered tree does its
// own pruning) so every drawn node — however rare — still finds its stats.

import type { ImportedGame } from './import-core';
import type { Line } from './types';
import type { MoveNode } from './tree';

export interface StatNode {
  san: string;
  uci: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  children: Map<string, StatNode>;   // keyed by child uci
}

function blank(san = '', uci = ''): StatNode {
  return { san, uci, games: 0, wins: 0, draws: 0, losses: 0, children: new Map() };
}

function tally(node: StatNode, result: ImportedGame['result']): void {
  node.games++;
  if (result === 'win') node.wins++;
  else if (result === 'loss') node.losses++;
  else node.draws++;
}

// Replay one colour's games into a stats tree, up to `maxPlies` deep. The root
// carries the colour totals (so a first move's frequency is its share of all
// games); each node below carries the tally of games that reached it.
export function buildMoveStats(
  games: ImportedGame[],
  colour: 'white' | 'black',
  maxPlies: number,
): StatNode {
  const root = blank();
  for (const g of games) {
    if (g.colour !== colour) continue;
    tally(root, g.result);
    let node = root;
    const plies = Math.min(g.ucis.length, maxPlies);
    for (let i = 0; i < plies; i++) {
      const uci = g.ucis[i];
      let child = node.children.get(uci);
      if (!child) {
        child = blank(g.sans[i] ?? uci, uci);
        node.children.set(uci, child);
      }
      tally(child, g.result);
      node = child;
    }
  }
  return root;
}

// A stats tree shaped like your REPERTOIRE (the merged saved lines for a
// colour) rather than your games. Each repertoire move carries the W/D/L from
// your games where you've actually played it (overlaid via the games stats
// tree); moves you've prepared but never played stay at zero — so the board
// browser's Repertoire mode shows your lines, with results where they exist.
export function buildRepertoireStatTree(
  lines: Line[],
  games: ImportedGame[],
  colour: 'white' | 'black',
  maxPlies: number,
): StatNode {
  const gameStats = buildMoveStats(games, colour, maxPlies);
  const root = blank();
  // The root carries the colour totals, mirroring buildMoveStats.
  root.games = gameStats.games;
  root.wins = gameStats.wins;
  root.draws = gameStats.draws;
  root.losses = gameStats.losses;

  const path: string[] = [];
  const walk = (children: MoveNode[], dst: StatNode, ply: number): void => {
    if (ply >= maxPlies) return;
    for (const child of children) {
      let node = dst.children.get(child.uci);
      if (!node) {
        node = blank(child.san, child.uci);
        const gs = statAt(gameStats, [...path, child.uci]);
        if (gs) {
          node.games = gs.games;
          node.wins = gs.wins;
          node.draws = gs.draws;
          node.losses = gs.losses;
        }
        dst.children.set(child.uci, node);
      }
      path.push(child.uci);
      walk(child.children, node, ply + 1);
      path.pop();
    }
  };

  for (const line of lines) {
    if (line.colour !== colour) continue;
    walk(line.tree.children, root, 0);
  }
  return root;
}

// Walk the tree by a uci path, returning the node reached or null if the games
// never went that way (an unplayed repertoire move, say).
export function statAt(root: StatNode, ucis: string[]): StatNode | null {
  let node: StatNode | undefined = root;
  for (const u of ucis) {
    node = node.children.get(u);
    if (!node) return null;
  }
  return node ?? null;
}

// Resolve the walked path to a single stored game, or null if it doesn't pin
// down exactly one. A game "passes through" the position when its stored moves
// start with the walked path (same colour). When precisely one of the colour's
// games does so, the view IS that game — so we can offer "See full game". An
// empty path (the start) or any position shared by 2+ games is an aggregate.
export function gameAtPath(
  games: ImportedGame[],
  colour: 'white' | 'black',
  ucis: string[],
): ImportedGame | null {
  if (ucis.length === 0) return null;
  let found: ImportedGame | null = null;
  for (const g of games) {
    if (g.colour !== colour) continue;
    if (g.ucis.length < ucis.length) continue;
    let matches = true;
    for (let i = 0; i < ucis.length; i++) {
      if (g.ucis[i] !== ucis[i]) { matches = false; break; }
    }
    if (!matches) continue;
    if (found) return null; // 2+ games reach here — an aggregate, not one game
    found = g;
  }
  return found;
}

// Score from the named perspective: a win is 1, a draw ½. 0–100, rounded.
export function statScorePct(s: StatNode): number {
  return s.games === 0 ? 0 : Math.round(((s.wins + s.draws / 2) / s.games) * 100);
}

// The most-played continuation from a node (its busiest child), or null if the
// games stopped here. Ties break on the move letters, matching the map's spine.
export function topReply(s: StatNode): StatNode | null {
  let best: StatNode | null = null;
  for (const child of s.children.values()) {
    if (!best || child.games > best.games ||
        (child.games === best.games && child.san.localeCompare(best.san) < 0)) {
      best = child;
    }
  }
  return best;
}
