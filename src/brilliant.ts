// Brilliant Moves — the "find it again" exercise source. Where the Mistake scan
// (mistake-scan.ts) finds where your games went WRONG, this finds where they
// went RIGHT: the brilliant (!!) and great (!) moves YOU played.
//
// TWO SOURCES, AND WHY THERE ARE TWO. The original one is a game's SAVED
// ANALYSIS: review.ts writes a `classification` onto every mainline move, so a
// game you have opened in the analyser and reviewed already holds its finds —
// no engine, no network, a pure walk over the stored tree.
//
// The catch was that almost nobody has those. A saved analysis only exists once
// you open a game in the analyser and press Analyse game, one game at a time,
// while the pane's "games analysed" figure counts the BACKGROUND MISTAKE SCAN —
// so the screen could honestly say "400 games analysed" and "no brilliant moves
// found", which is a contradiction from every angle except the code's. The scan
// now looks for them too (candidatePlies below feeds it), and its finds are
// stored on the game record beside the mistake spots. collectBrilliantSpots
// reads both and de-duplicates.
//
// Three jobs:
//   • collectBrilliantSpots / gameBrilliantSpots — flatten a game's finds into
//     session-ready "find it again" positions, from either source.
//   • candidatePlies — the scan's cheap pre-filter: which of your moves are
//     worth asking the engine about at all.
//   • hasUserBrilliant / applyBrilliantTag — the automatic "brilliant" game tag.

import { moveFacts, SEE_MATERIAL_MARGIN } from './move-facts';
import { cpToWin, BRILLIANT_MIN_WIN_AFTER, BRILLIANT_MAX_WIN_BEFORE } from './winprob';
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
// Reads both sources, so a game the scan found one in is tagged even though it
// has never been opened in the analyser.
export function hasUserBrilliant(game: ImportedGame): boolean {
  return gameFinds(game).some(s => s.cls === 'brilliant');
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

/**
 * Every find a game holds, from both sources: the ones read off a saved analysis
 * and the ones the mistake scan verified. Ids are `${gameId}#b${ply}` in both,
 * so the same move found twice is one spot — and the analysis wins, because it
 * carries the reviewer's own grade for that exact move.
 */
export function gameFinds(game: ImportedGame): BrilliantSpot[] {
  const fromAnalysis = gameBrilliantSpots(game);
  const scanned = game.retry?.brilliant ?? [];
  if (scanned.length === 0) return fromAnalysis;
  const seen = new Set(fromAnalysis.map(s => s.id));
  return [...fromAnalysis, ...scanned.filter(s => !seen.has(s.id))];
}

// Flatten every game's finds into session-ready refs.
export function collectBrilliantSpots(games: ImportedGame[]): BrilliantRef[] {
  const out: BrilliantRef[] = [];
  for (const game of games) {
    for (const spot of gameFinds(game)) out.push({ game, spot });
  }
  return out;
}

// ── The scan's candidate pass (pure) ─────────────────────────────────────────

/**
 * Which of YOUR moves in a game are worth asking the engine about.
 *
 * A brilliancy is a real material sacrifice that works, so the filter is exactly
 * that, and it costs nothing but chess.js: the move must give up material (the
 * same SEE test the analyser's grader uses), it must not be the only legal move,
 * and — this is the part that does the work — the position must still be FINE
 * afterwards. Amateur games are full of pieces given away by accident, and every
 * one of them passes a sacrifice test; almost none of them survives "and you
 * were still alright after it".
 *
 * `trail` is the mistake scan's cheap eval pass (WHITE-perspective, trail[i] =
 * before ply i), which the scan has already paid for. Plies it couldn't evaluate
 * are skipped rather than guessed at.
 *
 * Ordered by material given up, most first — if only a couple can be verified,
 * they should be the spectacular ones.
 */
export interface BrilliantCandidate {
  ply: number;
  given: number;   // material handed over, in pawns (positive)
}

export function candidatePlies(o: {
  colour: 'white' | 'black';
  fens: string[];               // fens[i] = the position before ply i
  ucis: string[];
  trail: (number | null)[];
  maxPly?: number;
}): BrilliantCandidate[] {
  const userParity = o.colour === 'white' ? 0 : 1;
  const last = Math.min(o.ucis.length, o.maxPly ?? o.ucis.length, o.trail.length - 1);
  const out: BrilliantCandidate[] = [];

  for (let i = userParity; i < last; i += 2) {
    const before = o.trail[i];
    const after = o.trail[i + 1];
    if (before === null || before === undefined) continue;
    if (after === null || after === undefined) continue;
    // Into the mover's own perspective.
    const sign = i % 2 === 0 ? 1 : -1;
    const winBefore = cpToWin(sign * before);
    const winAfter = cpToWin(sign * after);
    if (winAfter < BRILLIANT_MIN_WIN_AFTER) continue;   // it simply lost material
    if (winBefore > BRILLIANT_MAX_WIN_BEFORE) continue; // already completely winning

    const fen = o.fens[i];
    const uci = o.ucis[i];
    if (!fen || !uci) continue;
    const facts = moveFacts(fen, uci, i > 0 ? o.ucis[i - 1] : undefined);
    if (facts.onlyMove) continue;
    if (facts.seeNet === null || facts.seeNet > -SEE_MATERIAL_MARGIN) continue;

    out.push({ ply: i, given: -facts.seeNet });
  }

  out.sort((a, b) => b.given - a.given || a.ply - b.ply);
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

// Order the finds for the carousel + a session so the exercise loops instead of
// repeating one gem. `dueAt` gives the epoch ms a spot resurfaces after a clean
// re-find (0 = available now — see brilliant-log.ts). Available spots lead
// (brilliancies first, then newest game); already-solved ones sink, ordered by
// which comes back soonest — so once you've cleared them all the nearest-due one
// is still what shows next.
export function orderBrilliant(
  refs: BrilliantRef[],
  dueAt: (id: string) => number,
  now: number = Date.now(),
): BrilliantRef[] {
  const rank = (r: BrilliantRef): number => (r.spot.cls === 'brilliant' ? 0 : 1);
  return refs.slice().sort((a, b) => {
    const da = dueAt(a.spot.id), db = dueAt(b.spot.id);
    const sa = da > now, sb = db > now; // suppressed (resting) ?
    if (sa !== sb) return sa ? 1 : -1;  // available before suppressed
    if (sa) return da - db;             // both resting: soonest back leads
    return rank(a) - rank(b) || b.game.endTime - a.game.endTime;
  });
}
