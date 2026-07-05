// Brilliant Moves — the "find it again" exercise source. Where the Mistake scan
// (mistake-scan.ts) finds where your games went WRONG, this finds where they
// went RIGHT: the brilliant (!!) and great (!) moves YOU played, read straight
// off a game's saved analysis. review.ts writes a `classification` onto every
// mainline move, so once a game has been analysed the finds are already there —
// no engine, no network, pure walks over the stored tree.
//
// Two jobs:
//   • collectBrilliantSpots / gameBrilliantSpots — flatten analysed games into
//     session-ready "find it again" positions.
//   • hasUserBrilliant / applyBrilliantTag — the automatic "brilliant" game tag.

import type { ImportedGame } from './import-core';
import type { MoveNode } from './tree';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// The tag stamped on a game that contains a user-side brilliant move. Lower-case
// to sit beside the user's own freeform tags in the My games filters.
export const BRILLIANT_TAG = 'brilliant';

// The two grades this exercise celebrates — a genuine find worth replaying.
export type BrilliantClass = 'brilliant' | 'great';

// One "find it again" position, derived on the fly from a game's analysis. The
// answer IS the move you played (a brilliant/great is the engine's pick), so the
// drill just asks you to play it again.
export interface BrilliantSpot {
  id: string;            // `${gameId}#b${ply}`
  ply: number;           // 0-based mainline index of YOUR move
  cls: BrilliantClass;
  preFen: string;        // the position before your move (the drill position)
  playedSan: string;     // the move you found…
  playedUci: string;
}

// A spot plus the game it came from — sessions and cards need both.
export interface BrilliantRef {
  game: ImportedGame;
  spot: BrilliantSpot;
}

// Walk a game's analysed mainline and pull out YOUR brilliant/great moves. Even
// mainline index = White's move; a move is yours when its side matches the side
// you played. Returns [] for an unanalysed game (no tree). The parent position
// (preFen) is the root's start position for the first move, else the previous
// node's fen.
export function gameBrilliantSpots(game: ImportedGame): BrilliantSpot[] {
  const tree = game.analysis?.tree;
  if (!tree) return [];
  const out: BrilliantSpot[] = [];
  const userParity = game.colour === 'white' ? 0 : 1;
  let node: MoveNode | undefined = tree.children[0];
  let preFen = tree.fen || START_FEN;
  let ply = 0;
  while (node) {
    if (
      ply % 2 === userParity && node.uci &&
      (node.classification === 'brilliant' || node.classification === 'great')
    ) {
      out.push({
        id: `${game.id}#b${ply}`,
        ply,
        cls: node.classification,
        preFen,
        playedSan: node.san,
        playedUci: node.uci,
      });
    }
    preFen = node.fen;
    node = node.children[0];
    ply++;
  }
  return out;
}

// Does this game contain a user-side BRILLIANT move? Great alone doesn't earn
// the tag — a brilliant (a sound sacrifice, the engine's #1) is the real gem.
export function hasUserBrilliant(game: ImportedGame): boolean {
  return gameBrilliantSpots(game).some(s => s.cls === 'brilliant');
}

// Add the automatic "brilliant" tag to a game that contains a user-side
// brilliant move, in place. Returns true when the tag was actually added (so a
// caller can decide whether a save is worth it). Idempotent.
export function applyBrilliantTag(game: ImportedGame): boolean {
  if (!hasUserBrilliant(game)) return false;
  const tags = game.tags ?? [];
  if (tags.includes(BRILLIANT_TAG)) return false;
  game.tags = [...tags, BRILLIANT_TAG];
  return true;
}

// Flatten every analysed game's finds into session-ready refs.
export function collectBrilliantSpots(games: ImportedGame[]): BrilliantRef[] {
  const out: BrilliantRef[] = [];
  for (const game of games) {
    for (const spot of gameBrilliantSpots(game)) out.push({ game, spot });
  }
  return out;
}

// Pick a session's worth: newest game first, and brilliants ahead of greats so
// the best finds lead. A stable pick — the same games always sort the same way.
export function pickBrilliantSpots(refs: BrilliantRef[], count: number): BrilliantRef[] {
  const rank = (r: BrilliantRef): number => (r.spot.cls === 'brilliant' ? 0 : 1);
  return refs
    .slice()
    .sort((a, b) => rank(a) - rank(b) || b.game.endTime - a.game.endTime)
    .slice(0, count);
}

// The newest brilliant/great find, for the "Latest games" carousel slide.
export function latestBrilliant(refs: BrilliantRef[]): BrilliantRef | null {
  const pool = refs.slice().sort((a, b) => b.game.endTime - a.game.endTime);
  return pool[0] ?? null;
}
