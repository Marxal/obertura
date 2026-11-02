// The games where you faced a reply: how many, how they went, and how long ago.
//
// By POSITION, like everything else that reads your games, so a game that got there by
// another move order still counts. Only the opponent's moves are filed.
//
// Pure, so the numbers and dates can be tested under Node.

import type { ImportedGame } from './import-core';
import { positionKeysAlong } from './fast-replay';
import { GROW_MAX_PLIES } from './grow-line';

/** Position key → the reply → the games where it was played. */
export type FacedIndex = Map<string, Map<string, ImportedGame[]>>;

export function buildFacedIndex(games: ImportedGame[], colour: 'white' | 'black'): FacedIndex {
  const out: FacedIndex = new Map();
  const theirs = colour === 'white' ? 1 : 0;
  for (const game of games) {
    if (game.colour !== colour) continue;
    const keys = positionKeysAlong(game.ucis, GROW_MAX_PLIES);
    for (let i = theirs; i < keys.length; i += 2) {
      let replies = out.get(keys[i]);
      if (!replies) { replies = new Map(); out.set(keys[i], replies); }
      const list = replies.get(game.ucis[i]);
      if (list) list.push(game);
      else replies.set(game.ucis[i], [game]);
    }
  }
  return out;
}

export interface FacedSummary {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  /** When the most recent of them ended, in epoch SECONDS, like ImportedGame.endTime. */
  last: number;
}

export function summariseFaced(games: ImportedGame[]): FacedSummary {
  const out: FacedSummary = { games: games.length, wins: 0, draws: 0, losses: 0, points: 0, last: 0 };
  for (const game of games) {
    if (game.result === 'win') { out.wins++; out.points += 1; }
    else if (game.result === 'draw') { out.draws++; out.points += 0.5; }
    else out.losses++;
    out.last = Math.max(out.last, game.endTime);
  }
  return out;
}

const DAY_MS = 86_400_000;

/**
 * "today", "3 days ago", "2 weeks ago", "5 months ago", "2 years ago", or nothing for a
 * game with no date. A game's endTime is in SECONDS, while Date.now() is in milliseconds.
 */
export function agoText(endTimeSec: number, now: number = Date.now()): string {
  if (!endTimeSec) return '';
  const days = Math.floor((now - endTimeSec * 1000) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 730) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

export function timesText(n: number): string {
  return n === 1 ? 'Faced once' : n === 2 ? 'Faced twice' : `Faced ${n} times`;
}
