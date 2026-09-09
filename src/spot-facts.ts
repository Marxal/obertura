// What we can honestly say about ONE move out of one of your games, beyond the
// engine's verdict on it — the material behind the context strip under the
// reveal and the full-story sheet behind it.
//
// Everything here is DERIVED at read time from things already stored: the
// game's own fields, the clock trail (clock.ts), the mistake scan's eval trail,
// and the repertoire's position index. Nothing new is persisted and no scan has
// to be re-run when a rule here changes — which is the whole reason the facts
// live in their own module rather than being baked into a spot.
//
// The cheap half is synchronous (spotFacts). The two answers that need to read
// the rest of your data — does your repertoire cover this position, and how
// often has this opening caught you out — are async and are only asked for by
// the sheet, never by the strip.

import { Chess } from 'chess.js';
import { timeFactsAt, type TimeFacts } from './clock';
import { cpToWin } from './winprob';
import { positionIndex } from './position-index';
import { getAllGames } from './storage';
import type { ImportedGame, GameResult } from './import-core';

// A drop this big in win probability is a wobble worth counting. It is the
// scan's own "failed to punish" boundary (mistake-scan.ts's WIN_DROP_PUNISH),
// deliberately: a number that means "a real mistake" in one place should not
// mean something else in another.
export const WOBBLE_DROP = 0.10;

// How many of your own moves have to match one of your lines before we will
// say the game "followed" it. One move is every game that starts 1.e4, and two
// is most of them; three means the game really was in your preparation.
export const MIN_FOLLOWED_MOVES = 3;

/** Whether the move in question was a mistake or one of your good ones. */
export type SpotTone = 'mistake' | 'brilliancy';

export interface SpotFacts {
  /** 1-based full-move number, as a person counts them. */
  moveNumber: number;
  /** "Today" / "3 days ago" / "Last week" / "In March". */
  when: string;
  result: GameResult;
  /** "you lost this one" / "you won anyway" / "it ended in a draw". */
  costLine: string;
  /** Null when the game has no usable clock trail — see clock.ts. */
  time: TimeFacts | null;
  /** Your rating minus theirs, or null when the platform gave neither. */
  ratingGap: number | null;
  /**
   * How many of your own moves had already gone wrong in this game before this
   * one. Null when the game has no eval trail (an unscanned or v1 game).
   */
  wobblesBefore: number | null;
}

// ── When ──────────────────────────────────────────────────────────────────────

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * A game's date as one short phrase. Day-grained on purpose: the exact minute
 * of a blitz game three weeks ago is noise, and "3 days ago" is the part that
 * makes the position feel like yours.
 */
export function whenLabel(endTimeSec: number, now = Date.now()): string {
  if (!endTimeSec) return '';
  const then = endTimeSec * 1000;
  const days = Math.floor((now - then) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'Last week';
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  const d = new Date(then);
  const sameYear = new Date(now).getFullYear() === d.getFullYear();
  return sameYear ? `In ${MONTHS[d.getMonth()]}` : `In ${d.getFullYear()}`;
}

/**
 * What the move cost, in the only currency the game record knows: the result.
 *
 * The wording turns on what kind of move it was, because "anyway" points at
 * the surprise. After a blunder, winning is the surprise ("you won anyway");
 * after a brilliancy, losing is ("you lost anyway"). Saying "you won anyway"
 * under someone's best move of the month would read as a shrug at it.
 */
export function costLine(result: GameResult, tone: SpotTone = 'mistake'): string {
  if (result === 'draw') return 'it ended in a draw';
  if (tone === 'brilliancy') {
    return result === 'win' ? 'you won this one' : 'you lost anyway';
  }
  return result === 'loss' ? 'you lost this one' : 'you won anyway';
}

// ── The slide ─────────────────────────────────────────────────────────────────

/**
 * How many of YOUR moves before `ply` dropped the position by more than a
 * wobble, read off the mistake scan's eval trail. It is what turns "you
 * blundered" into "you had been drifting for three moves" — context the engine
 * numbers on their own never give.
 *
 * The trail is white-perspective; drops are measured in your own.
 */
export function wobblesBefore(game: ImportedGame, ply: number): number | null {
  const trail = game.retry?.trail;
  if (!trail || trail.length === 0) return null;
  const mine = game.colour === 'white' ? 0 : 1;
  let count = 0;
  for (let p = mine; p < ply; p += 2) {
    const before = trail[p];
    const after = trail[p + 1];
    if (before == null || after == null) continue;
    const winBefore = game.colour === 'white' ? cpToWin(before) : 1 - cpToWin(before);
    const winAfter = game.colour === 'white' ? cpToWin(after) : 1 - cpToWin(after);
    if (winBefore - winAfter >= WOBBLE_DROP) count++;
  }
  return count;
}

// ── The cheap half ────────────────────────────────────────────────────────────

/** Everything the strip needs, with no storage read and no await. */
export function spotFacts(
  game: ImportedGame, ply: number, tone: SpotTone = 'mistake', now = Date.now(),
): SpotFacts {
  const gap = game.myRating != null && game.opponentRating != null
    ? game.myRating - game.opponentRating
    : null;
  return {
    moveNumber: Math.floor(ply / 2) + 1,
    when: whenLabel(game.endTime, now),
    result: game.result,
    costLine: costLine(game.result, tone),
    time: timeFactsAt(game, ply),
    ratingGap: gap,
    wobblesBefore: wobblesBefore(game, ply),
  };
}

// ── The repertoire link ───────────────────────────────────────────────────────

export interface RepertoireLink {
  /**
   * 'covered'  — one of your lines has an answer at this very position, and it
   *              is not the move you played. The strongest thing this app can
   *              say about a mistake: you have already worked this out.
   * 'past-end' — the game followed one of your lines and then ran off the end
   *              of it. The mistake is where your preparation stopped.
   */
  kind: 'covered' | 'past-end';
  lineName: string;
  /** What your line plays here — 'covered' only. */
  san?: string;
  /** How many of your own moves past the end of the line — 'past-end' only. */
  movesPast?: number;
}

/**
 * Does your repertoire have anything to say about the position before `ply`?
 *
 * Walks the game once, keeping the lines whose moves match the ones you
 * actually played. That matching matters: without it, every game that opens
 * 1.e4 would claim to have "followed" every e4 line you own, and the answer
 * would be noise dressed as insight.
 *
 * Returns null when there is nothing honest to report — no repertoire, a game
 * that never followed one of your lines, or a line that agrees with the move
 * you played (in which case the mistake is not a preparation problem).
 */
export async function repertoireLinkAt(
  game: ImportedGame, ply: number,
): Promise<RepertoireLink | null> {
  if (ply <= 0 || ply > game.ucis.length) return null;
  const index = await positionIndex();
  if (index.entryCount === 0) return null;

  const chess = new Chess();
  // Walked one ply at a time, rebuilding the position as we go — the same walk
  // the scan does. `followed` counts YOUR moves that one of your lines plays.
  let followed = 0;
  let followedToPly = -1;
  let followedName = '';

  for (let p = 0; p < ply; p++) {
    const mine = game.colour === 'white' ? p % 2 === 0 : p % 2 === 1;
    if (mine) {
      const played = game.ucis[p];
      const match = index.entriesAt(chess.fen())
        .find(e => e.isUserMove && e.colour === game.colour && e.uci === played);
      if (match) {
        followed++;
        followedToPly = p;
        followedName = match.lineName;
      }
    }
    try {
      chess.move(game.sans[p]);
    } catch {
      return null; // a game we can't replay tells us nothing
    }
  }

  // The position the mistake was played from.
  const here = index.entriesAt(chess.fen())
    .filter(e => e.isUserMove && e.colour === game.colour);
  const different = here.find(e => e.uci !== game.ucis[ply]);
  if (different) {
    return { kind: 'covered', lineName: different.lineName, san: different.san };
  }
  // Your line agrees with what you played, so preparation is not the story.
  if (here.length > 0) return null;

  if (followed < MIN_FOLLOWED_MOVES) return null;
  // Counted in YOUR moves, which is how a person counts "moves past the book".
  const movesPast = Math.max(1, Math.round((ply - followedToPly) / 2));
  return { kind: 'past-end', lineName: followedName, movesPast };
}

// ── The repeat ────────────────────────────────────────────────────────────────

/**
 * How many of your games hold a scanned mistake in the SAME opening as this
 * one, this game included. "3rd time" is the fact that turns a position into a
 * reason to go and fix a line.
 *
 * Matched on the ECO code rather than the opening name: names carry variation
 * detail that splits what is really one opening ("Sicilian Defense" vs
 * "Sicilian Defense: Najdorf, English Attack"), and the code is the level a
 * person means when they say "this opening keeps catching me out".
 */
export async function timesWrongInOpening(game: ImportedGame): Promise<number | null> {
  const eco = game.eco;
  if (!eco) return null;
  const games = await getAllGames();
  let count = 0;
  for (const g of games) {
    if (g.eco !== eco) continue;
    if (g.colour !== game.colour) continue;
    if (g.retry?.spots?.length) count++;
  }
  return count > 1 ? count : null;
}
