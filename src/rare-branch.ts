// How likely is this reply? The one rule shared by Home's "Your next reply" card
// and by Trim, so one never offers what the other calls rare.
//
// WHY TWO NUMBERS. Measured on the 62 starter-pack lines (2026-11-02):
//
//   - Chance of reaching the END of a line, alone, flags 27 of 62. Every opponent
//     move multiplies it down, so a long main line reads as rare for being long.
//   - The reply's share at its own position, alone, flags 17 of 62, including the
//     Caro-Kann: 8% of games after 1.e4 is a whole defence, not a sideline.
//   - Both together (a small share AND rarely reached) flags 13, and those are the
//     real sidelines, like the London's 5...Qb6.
//
// A REPLY MISSING FROM THE DATA IS UNKNOWN, NOT RARE. The bundled set keeps only
// the top six moves at a position and has whole holes (nothing after 1.e4 c6), so
// "not listed" says nothing. Unknown moves count as certain, which errs towards
// keeping a line: reach is an upper bound, and a bad guess costs a card, not a line.
//
// Pure, so it runs under Node in next-reply.selftest.ts.

import { Chess } from 'chess.js';

/** A reply below this share of games at its position may be rare… */
export const RARE_REPLY_SHARE = 0.15;
/** …if the chance of arriving there at all is also below this. */
export const RARE_REACH = 0.02;
/** Fewer games than this at a position and its percentages mean nothing. */
export const MIN_STATS_GAMES = 50;

export interface MoveCounts { white: number; draws: number; black: number }
export type MoveStats = Map<string, MoveCounts>;
/** The database's moves at a position, or null when it knows nothing there. */
export type StatsAt = (fen: string) => MoveStats | null;

const CASTLING: Record<string, string> = {
  e1h1: 'e1g1', e1a1: 'e1c1', e8h8: 'e8g8', e8a8: 'e8c8',
};

/**
 * Lichess writes castling as king-takes-rook (e1h1); the app and chess.js write
 * the king's real move (e1g1). Only a king makes it castling: a rook on e1 can
 * really go to h1.
 */
export function normaliseCastling(fen: string, uci: string): string {
  const castled = CASTLING[uci];
  if (!castled) return uci;
  try {
    return new Chess(fen).get(uci.slice(0, 2) as 'e1')?.type === 'k' ? castled : uci;
  } catch {
    return uci;
  }
}

function gamesOf(c: MoveCounts): number {
  return c.white + c.draws + c.black;
}

/** A move's share of the games at a position, or null when it can't be known. */
export function shareAt(fen: string, uci: string, statsAt: StatsAt): number | null {
  const stats = statsAt(fen);
  if (!stats) return null;
  let total = 0;
  let mine = 0;
  let listed = false;
  for (const [moveUci, counts] of stats) {
    const n = gamesOf(counts);
    total += n;
    if (normaliseCastling(fen, moveUci) === uci) { mine = n; listed = true; }
  }
  if (!listed || total < MIN_STATS_GAMES) return null;
  return mine / total;
}

export interface ReplyOdds {
  /** The last move's share at its own position, null when unknown. */
  share: number | null;
  /** The chance the opponent walks this whole path, 0 to 1. An upper bound. */
  reach: number;
}

/**
 * The odds of an opponent walking this path. Only their moves count: your own
 * are your choice. `ucis` must end on the opponent's move for `share` to be it.
 */
export function replyOdds(ucis: string[], colour: 'white' | 'black', statsAt: StatsAt): ReplyOdds {
  const chess = new Chess();
  const theirs = colour === 'white' ? 1 : 0;
  let reach = 1;
  let share: number | null = null;
  for (let i = 0; i < ucis.length; i++) {
    share = null;
    if (i % 2 === theirs) {
      share = shareAt(chess.fen(), ucis[i], statsAt);
      if (share !== null) reach *= share;
    }
    try {
      chess.move({
        from: ucis[i].slice(0, 2),
        to: ucis[i].slice(2, 4),
        promotion: (ucis[i][4] as 'q') || undefined,
      });
    } catch {
      break;
    }
  }
  return { share, reach };
}

/** The rule itself. Unknown is never rare. */
export function isRareBranch(odds: ReplyOdds): boolean {
  return odds.share !== null && odds.share < RARE_REPLY_SHARE && odds.reach < RARE_REACH;
}
