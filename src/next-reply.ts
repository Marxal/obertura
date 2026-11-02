// "Your next reply": the positions worth answering next, one small step at a time.
//
// A CARD IS ONE THING: a position in your repertoire where the opponent has just
// played a reply you have no answer to. It is the same whether it came from a
// coverage gap or from the end of a mastered line, and that is why the board can
// be live: there is always exactly one move wanted, and it is yours.
//
// THE ORDER is your games, a scouted opponent, then the database. What you have
// actually faced beats what is popular. Mastered lines ready for one more move are
// the same kind of card on a board of their own: fixing a hole and extending what
// you know are different errands, so one never queues behind the other.
//
// WITHIN YOUR GAMES, OFTEN AND RECENTLY BOTH COUNT. Each game a reply happened in scores
// by its age (gameWeight): about 1 today, 0.63 after a month, and never below 0.25. So
// ten games from last year (2.5) still beat two from last week (1.8), and three from
// this week beat them. A reply faced once only makes the list while it's fresh.
//
// PAST THE END OF A LINE COUNTS, IF IT KEEPS HAPPENING. Coverage calls a line's end a
// stopping point you chose, which is right for a report of what's missing. But if you
// stopped at move 4 and keep meeting the same reply there, you'd want to know. Twice is
// the bar. A mastered line's end goes to its own board instead.
//
// HOLES COME SHALLOW FIRST, because the most-reached hole is the most useful one.
// Saved alone, that would fill the book with two-move lines, so the board answers each
// move you play with the usual reply (usualReply) and the line grows right there.
//
// Coverage's floors decide what counts as a gap (coverage-gaps.ts) and
// rare-branch.ts removes what Trim would call a sideline. Two things are added:
//
//   - Paused branches yield nothing. You said you don't want to train those.
//   - A reply that TRANSPOSES into a position you already answer isn't a hole, so
//     it isn't offered. Coverage's per-position check can't see those.
//
// Pure: everything arrives as plain data, so it runs in next-reply.selftest.ts.
// Nothing here is stored, and the database's all-ratings numbers are said as such.

import { Chess } from 'chess.js';
import type { Line } from './types';
import type { MoveNode } from './tree';
import type { ImportedGame } from './import-core';
import { GROW_MAX_PLIES, growSpot, spine, type GrowTarget } from './grow-line';
import { lineMastered } from './line-status';
import { positionKey } from './position-index';
import { positionKeysAlong } from './fast-replay';
import { buildFacedIndex, type FacedIndex } from './reply-games';
import {
  buildCoverageReport, opponentSpots, MAX_GAP_PLIES, MAX_GAPS_PER_POSITION, MIN_FACED_GAMES,
  type ExplorerReplies, type ScoutedOpponent,
} from './coverage-gaps';
import {
  isRareBranch, normaliseCastling, replyOdds, MIN_STATS_GAMES, type StatsAt,
} from './rare-branch';

export type ReplySource = 'games' | 'scout' | 'library' | 'mastered';

export interface GameScore { points: number; games: number; wins: number; draws: number; losses: number }

export interface NextReplyCard {
  /** Position and reply: the same id a coverage gap has. */
  id: string;
  colour: 'white' | 'black';
  /** The moves to the position, ending with the reply you have to answer. */
  ucis: string[];
  sans: string[];
  /** The position after those moves. */
  fen: string;
  /**
   * The moves end on YOUR move, because nothing knows what comes next: the end of a
   * mastered line past every source. The board asks the engine for their reply.
   */
  awaitingReply?: boolean;
  source: ReplySource;
  /** Games you have faced it in. */
  faced?: number;
  /** Those games, weighted by how recent they are: what ranks your-games cards. */
  relevance?: number;
  /** How those games went, when there are enough to say. */
  score?: GameScore;
  /** The reply's share at its position, as a whole percent. */
  sharePct?: number;
  /** The chance of the opponent walking this far, for ranking. */
  reach?: number;
  opponentName?: string;
  /** The end of a mastered line, for "Extend a line you know". */
  extend?: boolean;
  /** Goes past where a line stopped, so that stop isn't an end any more. */
  pastEnd?: boolean;
  /** That mastered line, whose training figures the card shows. */
  line?: Line;
  /** Which mastered line, when the builder's Grow tab can open on it. */
  grow?: GrowTarget;
}

/** What a game is worth once it's old: a reply you meet all the time still matters. */
export const OLD_GAME_WEIGHT = 0.25;
/** How quickly the rest of a game's weight fades. */
export const RECENCY_HALF_LIFE_DAYS = 30;
/** A reply faced only once makes the list for this long. Once is usually an accident. */
export const RECENT_ONCE_DAYS = 14;
/** A reply going badly counts for this much more. */
export const POOR_BOOST = 1.25;

const DAY_MS = 86_400_000;

function ageInDays(endTimeSec: number, now: number): number {
  return Math.max(0, (now - endTimeSec * 1000) / DAY_MS);
}

/** How much one game counts, from 1 today down towards OLD_GAME_WEIGHT. */
export function gameWeight(endTimeSec: number, now: number): number {
  const fading = 0.5 ** (ageInDays(endTimeSec, now) / RECENCY_HALF_LIFE_DAYS);
  return OLD_GAME_WEIGHT + (1 - OLD_GAME_WEIGHT) * fading;
}

/** Fewer games than this and a score is an anecdote. */
export const MIN_SCORED_GAMES = 3;
/** At or under this share of the points, the reason says how it has been going. */
export const POOR_SCORE = 0.4;
/** A queue is never going to be walked further than this in one sitting. */
export const MAX_CARDS = 40;
/** Auto-reply first pauses to ask about saving once the line is this many of your moves. */
export const LINE_ASK_MOVES = 5;
/** You have played at least this many yourself before it asks, and again each "Keep going". */
export const ASK_EVERY_MOVES = 3;
/** However you build, it won't pause sooner or later than this. */
export const MIN_ASK_MOVES = 4;
export const MAX_ASK_MOVES = 12;
/** Fewer lines than this and they say nothing about how you build. */
const MIN_LINES_TO_LEARN = 3;

export interface NextReplyInput {
  lines: Line[];
  games: ImportedGame[];
  opponents: ScoutedOpponent[];
  statsAt: StatsAt;
  grow: GrowTarget[];
  /** Card id → epoch ms it comes back. */
  rested: Record<string, number>;
  /** Already built by the caller, who needs it too. Built here if not. */
  faced?: Record<'white' | 'black', FacedIndex>;
  now?: number;
}

const COLOURS = ['white', 'black'] as const;

export function buildNextReplies(input: NextReplyInput): NextReplyCard[] {
  const now = input.now ?? Date.now();
  const faced = input.faced ?? {
    white: buildFacedIndex(input.games, 'white'),
    black: buildFacedIndex(input.games, 'black'),
  };
  const cards = new Map<string, NextReplyCard>();
  for (const colour of COLOURS) {
    for (const card of gapCards(input, colour, faced[colour], now)) cards.set(card.id, card);
  }
  // A gap already explains itself better than the mastered card would.
  for (const card of extendCards(input)) if (!cards.has(card.id)) cards.set(card.id, card);

  for (const card of cards.values()) {
    const pipe = card.id.lastIndexOf('|');
    const games = faced[card.colour].get(card.id.slice(0, pipe))?.get(card.id.slice(pipe + 1));
    if (games) card.relevance = games.reduce((sum, g) => sum + gameWeight(g.endTime, now), 0);
  }

  const waiting = [...cards.values()]
    .filter(c => (input.rested[c.id] ?? 0) <= now)
    .sort(compareCards);
  // Capped apart: they are two boards, and a long list of holes mustn't push every
  // mastered line off the end of one queue.
  const ordered = [
    ...waiting.filter(c => !c.extend).slice(0, MAX_CARDS),
    ...waiting.filter(c => c.extend).slice(0, MAX_CARDS),
  ];
  addScores(ordered, input.games);
  return ordered.sort(compareCards);
}

const TIER: Record<ReplySource, number> = { games: 0, scout: 1, library: 2, mastered: 3 };

function rankOf(card: NextReplyCard): number {
  return (card.relevance ?? 0) * (isPoor(card.score) ? POOR_BOOST : 1);
}

function compareCards(a: NextReplyCard, b: NextReplyCard): number {
  return TIER[a.source] - TIER[b.source]
    // How often AND how lately, with a nudge for the replies going badly.
    || rankOf(b) - rankOf(a)
    // How often you'd actually get there, not how popular it is once you do:
    // otherwise a forced recapture at move nine outranks a whole missing defence.
    || (b.reach ?? 0) - (a.reach ?? 0)
    || a.ucis.length - b.ucis.length
    || a.id.localeCompare(b.id);
}

function isPoor(score: GameScore | undefined): boolean {
  return !!score && score.games >= MIN_SCORED_GAMES && score.points / score.games <= POOR_SCORE;
}

function gapCards(
  input: NextReplyInput, colour: 'white' | 'black', faced: FacedIndex, now: number,
): NextReplyCard[] {
  const { lines, games, opponents, statsAt } = input;
  const own = lines.filter(l => l.colour === colour);
  if (own.length === 0) return [];

  // Answers count from every line, paused ones too: a reply answered in a paused
  // line isn't a hole. Offers only come from positions you are training.
  const active = new Map(
    opponentSpots(own.filter(l => l.inTraining), colour, MAX_GAP_PLIES).map(s => [s.key, s]),
  );
  if (active.size === 0) return [];

  const explorer = new Map<string, ExplorerReplies>();
  for (const spot of opponentSpots(own, colour, MAX_GAP_PLIES)) {
    const stats = statsAt(spot.fen);
    if (!stats) continue;
    const replies = new Map<string, number>();
    let total = 0;
    for (const [uci, c] of stats) {
      const n = c.white + c.draws + c.black;
      if (n <= 0) continue;
      replies.set(normaliseCastling(spot.fen, uci), n);
      total += n;
    }
    if (total >= MIN_STATS_GAMES) explorer.set(spot.key, { games: replies, total, coverage: 'all' });
  }

  const report = buildCoverageReport(own, colour, { games, opponents, explorer }, { limit: Infinity });
  const answered = answeredPositions(own, colour);

  const out: NextReplyCard[] = [];
  for (const gap of report.gaps) {
    const spot = active.get(gap.key);
    if (!spot) continue;                     // only in a paused branch

    const after = positionAfter(spot.fen, gap.uci);
    if (!after || answered.has(positionKey(after))) continue;

    const ucis = [...spot.ucis, gap.uci];
    const sans = [...spot.sans, gap.san];
    const odds = replyOdds(ucis, colour, statsAt);
    if (gap.source === 'library' && isRareBranch(odds)) continue;

    out.push({
      id: gap.id,
      colour,
      ucis,
      sans,
      fen: after,
      source: gap.source,
      reach: odds.reach,
      ...(gap.source === 'games' ? { faced: gap.weight } : {}),
      ...(gap.source === 'library' ? { sharePct: gap.weight } : {}),
      ...(gap.opponentName ? { opponentName: gap.opponentName } : {}),
    });
  }

  // Coverage asks for two games, because once is usually an accident. Unless it was
  // just now: the game you played this morning is the one you remember.
  const byId = new Map(out.map(c => [c.id, c]));
  for (const spot of active.values()) {
    for (const [uci, played] of faced.get(spot.key) ?? []) {
      if (played.length !== 1 || spot.prepared.has(uci)) continue;
      if (ageInDays(played[0].endTime, now) > RECENT_ONCE_DAYS) continue;
      const id = `${spot.key}|${uci}`;
      const known = byId.get(id);
      if (known) {
        known.source = 'games';
        known.faced = 1;
        continue;
      }
      const after = positionAfter(spot.fen, uci);
      const san = sanOf(spot.fen, uci);
      if (!after || !san || answered.has(positionKey(after))) continue;
      out.push({
        id,
        colour,
        ucis: [...spot.ucis, uci],
        sans: [...spot.sans, san],
        fen: after,
        source: 'games',
        faced: 1,
      });
    }
  }

  // Replies you keep meeting past where a line of yours stops.
  for (const line of own) {
    if (!line.inTraining || lineMastered(line)) continue;
    const spot = growSpot(line);
    if (!spot) continue;
    const often = [...(faced.get(spot.key) ?? [])]
      .filter(([, played]) => played.length >= MIN_FACED_GAMES)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .slice(0, MAX_GAPS_PER_POSITION);
    for (const [uci, played] of often) {
      const id = `${spot.key}|${uci}`;
      if (byId.has(id)) continue;
      const after = positionAfter(spot.fen, uci);
      const san = sanOf(spot.fen, uci);
      if (!after || !san || answered.has(positionKey(after))) continue;
      const card: NextReplyCard = {
        id,
        colour,
        ucis: [...spot.ucis, uci],
        sans: [...spot.sans, san],
        fen: after,
        source: 'games',
        faced: played.length,
        pastEnd: true,
      };
      out.push(card);
      byId.set(id, card);
    }
  }
  return out;
}

/** Positions on your move that you already have an answer to, in any line. */
export function answeredPositions(lines: Line[], colour: 'white' | 'black'): Set<string> {
  const mine = colour === 'white' ? 0 : 1;
  const out = new Set<string>();
  const walk = (node: MoveNode, ply: number): void => {
    if (node.children.length > 0 && ply % 2 === mine && node.fen) out.add(positionKey(node.fen));
    for (const child of node.children) walk(child, ply + 1);
  };
  for (const line of lines) walk(line.tree, 0);
  return out;
}

function positionAfter(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    chess.move({
      from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] as 'q') || undefined,
    });
    return chess.fen();
  } catch {
    return null;
  }
}

/**
 * The ends of mastered lines. Every one of them yields a card: being mastered is reason
 * enough, so when no source knows the position the engine supplies their reply.
 */
function extendCards(input: NextReplyInput): NextReplyCard[] {
  const out: NextReplyCard[] = [];
  for (const target of input.grow) {
    const { spot } = target;
    const colour = spot.line.colour;
    const theirs = colour === 'white' ? 'black' : 'white';
    const known = target.moves[0];
    const top = known ? null : movesAt(spot.fen, theirs, input.statsAt)?.[0];
    const uci = known?.uci ?? top?.uci;
    const san = known?.san ?? (uci ? sanOf(spot.fen, uci) : null);
    const after = uci ? positionAfter(spot.fen, uci) : null;
    if (uci && san && after) {
      out.push({
        id: `${spot.key}|${uci}`,
        colour,
        ucis: [...spot.ucis, uci],
        sans: [...spot.sans, san],
        fen: after,
        source: known?.source === 'games' ? 'games' : known?.source === 'scout' ? 'scout' : 'mastered',
        ...(known?.source === 'games' ? { faced: known.weight } : {}),
        ...(known?.opponentName ? { opponentName: known.opponentName } : {}),
        extend: true,
        line: spot.line,
        ...(known ? { grow: target } : {}),
      });
    } else {
      out.push({
        id: `${spot.key}|end`,
        colour,
        ucis: spot.ucis,
        sans: spot.sans,
        fen: spot.fen,
        source: 'mastered',
        extend: true,
        line: spot.line,
        awaitingReply: true,
      });
    }
  }

  // A mastered line that stops on THEIR move already asks the question.
  for (const line of input.lines) {
    if (!lineMastered(line)) continue;
    const path = spine(line.tree);
    const ply = path.length;
    if (ply === 0 || ply > GROW_MAX_PLIES) continue;
    const toMove = ply % 2 === 0 ? 'white' : 'black';
    if (toMove !== line.colour) continue;
    const end = path[ply - 1];
    out.push({
      id: `${positionKey(path[ply - 2]?.fen || new Chess().fen())}|${end.uci}`,
      colour: line.colour,
      ucis: path.map(n => n.uci),
      sans: path.map(n => n.san),
      fen: end.fen,
      source: 'mastered',
      extend: true,
      line,
    });
  }
  return out;
}

/**
 * How the games that reached each of your-games cards went.
 *
 * By POSITION, like the count on the card, so a game that got there by another
 * move order still counts. Only the cards that will be shown are looked up, and
 * only as deep as the deepest of them.
 */
function addScores(cards: NextReplyCard[], games: ImportedGame[]): void {
  const wanted = new Map<string, NextReplyCard>();
  let maxPly = 0;
  for (const card of cards) {
    if (card.source !== 'games') continue;
    wanted.set(card.id, card);
    maxPly = Math.max(maxPly, card.ucis.length);
  }
  if (wanted.size === 0) return;

  const tally = new Map<string, GameScore>();
  for (const game of games) {
    const keys = positionKeysAlong(game.ucis, maxPly);
    for (let i = 0; i < keys.length; i++) {
      const id = `${keys[i]}|${game.ucis[i]}`;
      const card = wanted.get(id);
      if (!card || card.colour !== game.colour) continue;
      const t = tally.get(id) ?? { points: 0, games: 0, wins: 0, draws: 0, losses: 0 };
      t.games++;
      t.points += game.result === 'win' ? 1 : game.result === 'draw' ? 0.5 : 0;
      if (game.result === 'win') t.wins++;
      else if (game.result === 'draw') t.draws++;
      else t.losses++;
      tally.set(id, t);
    }
  }
  for (const [id, score] of tally) {
    const card = wanted.get(id);
    if (card && score.games >= MIN_SCORED_GAMES) card.score = score;
  }
}

// ── The words ────────────────────────────────────────────────────────────────

/** "3...d5", from the moves that reach it. */
export function replyLabel(card: NextReplyCard): string {
  const ply = card.ucis.length - 1;
  const number = Math.floor(ply / 2) + 1;
  return `${number}${ply % 2 === 0 ? '.' : '...'}${card.sans[ply]}`;
}

export function points(n: number): string {
  const whole = Math.floor(n);
  return n === whole ? String(n) : whole === 0 ? '½' : `${whole}½`;
}

/** A move's numbers in the database, from your side of the board. */
export interface MoveNumbers {
  uci: string;
  playedPct: number;
  scorePct: number;
  wins: number;
  draws: number;
  losses: number;
  games: number;
}

/** Every move the database lists here, most played first. Null: too little to say. */
function movesAt(fen: string, colour: 'white' | 'black', statsAt: StatsAt): MoveNumbers[] | null {
  const stats = statsAt(fen);
  if (!stats) return null;
  let total = 0;
  for (const c of stats.values()) total += c.white + c.draws + c.black;
  if (total < MIN_STATS_GAMES) return null;
  const out: MoveNumbers[] = [];
  for (const [moveUci, c] of stats) {
    const games = c.white + c.draws + c.black;
    if (games === 0) continue;
    const wins = colour === 'white' ? c.white : c.black;
    const losses = colour === 'white' ? c.black : c.white;
    out.push({
      uci: normaliseCastling(fen, moveUci),
      playedPct: Math.round((100 * games) / total),
      scorePct: Math.round((100 * (wins + c.draws / 2)) / games),
      wins,
      draws: c.draws,
      losses,
      games,
    });
  }
  return out.sort((a, b) => b.games - a.games);
}

/** How one move does here, or null when the database doesn't list it. */
export function answerStats(
  fen: string, uci: string, colour: 'white' | 'black', statsAt: StatsAt,
): MoveNumbers | null {
  return movesAt(fen, colour, statsAt)?.find(m => m.uci === uci) ?? null;
}

/** "Suggest moves": the most played moves here, with their SAN. */
export function topMoves(
  fen: string, colour: 'white' | 'black', statsAt: StatsAt, max = 3,
): Array<MoveNumbers & { san: string }> {
  const out: Array<MoveNumbers & { san: string }> = [];
  for (const move of movesAt(fen, colour, statsAt) ?? []) {
    if (out.length >= max) break;
    const san = sanOf(fen, move.uci);
    if (san) out.push({ ...move, san });
  }
  return out;
}

function sanOf(fen: string, uci: string): string | null {
  try {
    return new Chess(fen).move({
      from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] as 'q') || undefined,
    }).san;
  } catch {
    return null;
  }
}

/**
 * When auto-reply should first pause to ask about saving, in your moves.
 *
 * It depends on the line and on you, so it's read from how you build: the usual length of
 * your lines in this same opening (the same first two moves), or across this colour if
 * there are too few, or LINE_ASK_MOVES for someone with hardly any lines yet.
 */
export function usualLineMoves(lines: Line[], card: { colour: 'white' | 'black'; ucis: string[] }): number {
  const own = lines
    .filter(l => l.colour === card.colour)
    .map(l => spine(l.tree).map(n => n.uci))
    .filter(path => path.length > 0);
  const opening = card.ucis.slice(0, 2).join(' ');
  const same = own.filter(path => path.slice(0, 2).join(' ') === opening);
  const sample = same.length >= MIN_LINES_TO_LEARN ? same : own;
  if (sample.length < MIN_LINES_TO_LEARN) return LINE_ASK_MOVES;
  const moves = sample.map(path => Math.ceil(path.length / 2)).sort((a, b) => a - b);
  const median = moves[Math.floor((moves.length - 1) / 2)];
  return Math.min(MAX_ASK_MOVES, Math.max(MIN_ASK_MOVES, median));
}

/** Why the board played a reply. */
export type ReplyBasis = 'games' | 'scout' | 'database' | 'engine';

export interface UsualReply { uci: string; san: string; basis: ReplyBasis }

export interface ReplySources {
  statsAt: StatsAt;
  /** Position key → uci → how many of your games went that way. */
  facedAt: (key: string) => Map<string, number> | undefined;
  /** The opponent you are preparing for: their moves come before anyone else's. */
  scoutAt?: (key: string) => Array<{ uci: string; games: number }>;
}

/**
 * What the opponent plays next, while the board builds a line with you.
 *
 * What you have faced comes first, then the opponent you're preparing for, then the
 * database, then a reply you've met only once. Null means nobody knows, which is the
 * engine's cue.
 */
export function usualReply(
  fen: string, colour: 'white' | 'black', sources: ReplySources,
): UsualReply | null {
  const key = positionKey(fen);
  const playable = (uci: string, basis: ReplyBasis): UsualReply | null => {
    const san = sanOf(fen, uci);
    return san ? { uci, san, basis } : null;
  };
  const best = <T extends { uci: string }>(list: T[], weight: (m: T) => number): T | undefined =>
    [...list].sort((a, b) => weight(b) - weight(a) || a.uci.localeCompare(b.uci))[0];

  const faced = [...(sources.facedAt(key) ?? [])].map(([uci, games]) => ({ uci, games }));
  const mostFaced = best(faced, m => m.games);
  if (mostFaced && mostFaced.games >= MIN_FACED_GAMES) {
    const reply = playable(mostFaced.uci, 'games');
    if (reply) return reply;
  }
  const scouted = best(sources.scoutAt?.(key) ?? [], m => m.games);
  if (scouted) {
    const reply = playable(scouted.uci, 'scout');
    if (reply) return reply;
  }
  const theirs = colour === 'white' ? 'black' : 'white';
  const usual = movesAt(fen, theirs, sources.statsAt)?.[0];
  if (usual) {
    const reply = playable(usual.uci, 'database');
    if (reply) return reply;
  }
  return mostFaced ? playable(mostFaced.uci, 'games') : null;
}
