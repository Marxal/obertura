// Grow your lines — the pure core of the "add one more move" exercise.
//
// THE EXERCISE. Every other part of the daily challenge asks you to remember
// something. This one asks you to WRITE something: it takes a line you have
// genuinely learned, stands at the end of it, and names three moves your
// opponent could play from there that you have no answer to. You pick one and
// add a reply. One move is the whole ask; more is welcome and never required.
//
// WHY IT WAITS FOR MASTERY. A line you are still learning does not need to be
// longer — it needs another run. `lineMastered` (line-status.ts) is the app's
// existing verdict on "this one has stopped teaching you anything": three clean
// runs, 80% recall, every move drilled, and — the part that matters most here —
// `ownMoves > 0`, which is only true when the line's last move is a real leaf
// with nothing saved after it. A line that already continues has nowhere to
// grow, and offering it would be asking for work that is already done.
//
// WHY THE END OF THE LINE IS AN OPPONENT-TO-MOVE POSITION. A repertoire line
// ends on YOUR move: you prepared an answer and stopped. So the position at the
// end is one where they move next — which is exactly the question this exercise
// asks. A line ending on the opponent's move is a different kind of hole (an
// unanswered reply, which is what coverage-gaps.ts is for) and is not offered.
//
// AND WHY IT IS NOT COVERAGE. coverage-gaps.ts deliberately ignores line ends:
// "a line that simply ENDS is a stopping point you chose, not a hole". That is
// the right rule for a report about what your repertoire is MISSING, and it is
// the exact set this exercise works on. The two are complements, and this file
// reuses coverage's evidence machinery (gameReplyIndex, scoutReplyIndex, sanAt)
// rather than growing a second copy of it.
//
// THE THREE SOURCES ARE THE APP'S ESTABLISHED ONES, in the app's established
// order: your own games first, then the bundled opening book, then a scouted
// opponent. A move you have actually faced beats a move a database says is
// popular, every time. No network, no login, no engine — a daily task must
// never be waiting on any of the three.
//
// Pure: lines, games, scouts and the book all come in as plain data, so the
// whole thing runs under Node in grow-line.selftest.ts.

import { Chess } from 'chess.js';
import type { Line } from './types';
import type { MoveNode } from './tree';
import type { ImportedGame } from './import-core';
import { positionKey } from './position-index';
import { lineMastered } from './line-status';
import {
  gameReplyIndex, scoutReplyIndex, sanAt,
  MIN_FACED_GAMES, MIN_SCOUT_GAMES,
  type PositionReplyIndex, type ScoutIndex, type ScoutedOpponent,
} from './coverage-gaps';

/**
 * How deep a line end may be and still be worth growing, in half-moves.
 * Twelve full moves is well past the opening; past it you are writing a
 * middlegame plan, and no source we have knows enough to suggest one. It is
 * also the replay depth the evidence indexes are built to, so raising it costs
 * a longer walk over every imported game.
 */
export const GROW_MAX_PLIES = 24;

/** How many continuations the exercise offers. Three: enough to be a choice,
 * few enough to be a decision rather than a list. */
export const GROW_PICKS = 3;

/**
 * The book's floor: how many named openings have to continue a way before it is
 * worth preparing for.
 *
 * A real opening position has a handful of replies carrying the theory and a
 * long tail of one obscure named line each — at the end of the Ruy López's
 * 4.Ba4, for instance, 468 openings play 4…Nf6, four play 4…Bc5, and then four
 * more moves have exactly one apiece. Offering "prepare for this, 1 opening
 * plays it" beside "468 openings play it" is not a choice, it is padding.
 *
 * The book's OWN main continuation is exempt: deep in a line the whole node may
 * be a single move, and that move is theory rather than a curiosity.
 */
export const MIN_BOOK_LINES = 2;

/** The position at the end of a mastered line, with the path that reaches it. */
export interface GrowSpot {
  line: Line;
  /** The position AFTER the line's last move — the opponent is to move here. */
  fen: string;
  /** The shared position key, so evidence indexed by position finds it. */
  key: string;
  ucis: string[];
  sans: string[];
  /** Half-moves deep (= ucis.length). */
  ply: number;
}

/** Which source put a continuation on the list. */
export type GrowSource = 'games' | 'library' | 'scout';

/** One move they could play from here, and the one line that explains why. */
export interface GrowMove {
  uci: string;
  san: string;
  source: GrowSource;
  reason: string;
  /** The magnitude behind the reason: games faced, openings, or their games. */
  weight: number;
  /** Present only on a scout row. */
  opponentName?: string;
}

/** Everything the ranking knows that isn't in the line itself. */
export interface GrowSources {
  /** positionKey → (uci → games of yours that continued that way). */
  games?: PositionReplyIndex;
  /** positionKey → each scouted opponent's replies there. */
  scouts?: ScoutIndex;
  /** SAN → how many named openings continue that way (the bundled book). */
  book?: Map<string, number>;
}

// ── The spot: where does this line stop? ─────────────────────────────────────

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** A projected line's moves — its tree is a single spine (lines-view.ts). */
function spine(tree: MoveNode): MoveNode[] {
  const out: MoveNode[] = [];
  let node: MoveNode | undefined = tree.children[0];
  while (node) {
    out.push(node);
    node = node.children[0];
  }
  return out;
}

/**
 * The end of this line as a position an opponent is about to move in, or null
 * when the line has no end worth growing: empty, past the depth cap, or ending
 * on the opponent's move (see the header — that is a coverage gap, not this).
 */
export function growSpot(line: Line): GrowSpot | null {
  const path = spine(line.tree);
  const ply = path.length;
  if (ply === 0 || ply > GROW_MAX_PLIES) return null;
  // White moves at even plies, black at odd — the same parity rule the position
  // index uses. Whoever is to move at the END must not be you.
  const toMove: 'white' | 'black' = ply % 2 === 0 ? 'white' : 'black';
  if (toMove === line.colour) return null;
  const fen = path[ply - 1].fen || START_FEN;
  return {
    line,
    fen,
    key: positionKey(fen),
    ucis: path.map(n => n.uci),
    sans: path.map(n => n.san),
    ply,
  };
}

/**
 * Every line ready to grow, strongest first.
 *
 * "Strongest" is deliberate: the exercise's whole claim is "you know this one",
 * so the line it opens on should be the one that claim is truest of. Confidence
 * leads, then runs; the tie-break is the line you have gone longest without
 * training, so a repertoire where everything is equally solid still rotates.
 */
export function growCandidates(lines: Line[]): GrowSpot[] {
  const out: GrowSpot[] = [];
  for (const line of lines) {
    if (!lineMastered(line)) continue;
    const spot = growSpot(line);
    if (spot) out.push(spot);
  }
  return out.sort(compareSpots);
}

function stamp(line: Line): number {
  if (!line.lastTrained) return 0;
  const t = Date.parse(line.lastTrained);
  return Number.isFinite(t) ? t : 0;
}

function compareSpots(a: GrowSpot, b: GrowSpot): number {
  return b.line.confidence - a.line.confidence
    || (b.line.timesTrained ?? 0) - (a.line.timesTrained ?? 0)
    || stamp(a.line) - stamp(b.line)
    || a.line.id.localeCompare(b.line.id);
}

/**
 * Today's lines to grow: the ones available now, then — behind them — the ones
 * resting, soonest back first.
 *
 * A REST IS NEVER A REMOVAL, exactly as everywhere else in the app. Skipping a
 * line stands it aside for a day so tomorrow offers a different one; on a
 * repertoire with a single mastered line, "a different one" doesn't exist, and
 * an empty exercise would be a worse answer than the same line again.
 */
export function pickGrowSpots(
  spots: GrowSpot[],
  count: number,
  dueAt: (lineId: string) => number = () => 0,
  now: number = Date.now(),
): GrowSpot[] {
  const ready = spots.filter(s => dueAt(s.line.id) <= now);
  const resting = spots.filter(s => dueAt(s.line.id) > now)
    .sort((a, b) => dueAt(a.line.id) - dueAt(b.line.id));
  return [...ready, ...resting].slice(0, Math.max(0, count));
}

// ── The continuations: what could they play from here? ───────────────────────

const SOURCE_RANK: Record<GrowSource, number> = { games: 0, library: 1, scout: 2 };

interface Ranked extends GrowMove { rank: number }

/**
 * The moves to prepare for, best-reason first.
 *
 * Each candidate carries ONE reason, from the first source that can vouch for
 * it — never a blended score. "You have faced this 4 times" is a sentence
 * somebody can act on; "0.72" is not.
 *
 * The floors are coverage's, for the same reasons: two games (once is an
 * accident, twice is a thing that happens to you), two for a scouted opponent.
 * The book has no floor beyond being IN the book — a named opening continuing
 * this way is already the floor.
 */
export function growMoves(
  spot: GrowSpot,
  sources: GrowSources = {},
  limit: number = GROW_PICKS,
): GrowMove[] {
  const best = new Map<string, Ranked>();
  const offer = (m: Ranked): void => {
    const prev = best.get(m.uci);
    // First source to reach a move owns its reason; a later, weaker one never
    // overwrites it.
    if (!prev || m.rank < prev.rank) best.set(m.uci, m);
  };

  // 1. Your games — what you have actually faced from here.
  for (const [uci, games] of sources.games?.get(spot.key) ?? []) {
    if (games < MIN_FACED_GAMES) continue;
    const san = sanAt(spot.fen, uci);
    if (!san) continue;
    offer({
      uci, san, source: 'games', weight: games, rank: SOURCE_RANK.games,
      reason: `you have faced this ${games} times`,
    });
  }

  // 2. The bundled opening book — theory's answer, offline and always there.
  const fromBook = [...(sources.book ?? [])]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (let i = 0; i < fromBook.length; i++) {
    const [san, count] = fromBook[i];
    if (i > 0 && count < MIN_BOOK_LINES) continue;   // the tail is noise
    const uci = uciAt(spot.fen, san);
    if (!uci) continue;
    offer({
      uci, san, source: 'library', weight: count, rank: SOURCE_RANK.library,
      reason: count > 1 ? `${count} openings continue this way` : 'the opening book plays this',
    });
  }

  // 3. A scouted opponent — somebody you chose to prepare against.
  for (const scout of sources.scouts?.get(spot.key) ?? []) {
    if (scout.games < MIN_SCOUT_GAMES) continue;
    const san = sanAt(spot.fen, scout.uci);
    if (!san) continue;
    offer({
      uci: scout.uci, san, source: 'scout', weight: scout.games, rank: SOURCE_RANK.scout,
      reason: `${scout.name} plays this`,
      opponentName: scout.name,
    });
  }

  return [...best.values()]
    .sort((a, b) => a.rank - b.rank || b.weight - a.weight || a.san.localeCompare(b.san))
    .slice(0, Math.max(0, limit))
    .map(({ rank: _rank, ...move }) => move);
}

/** The uci for a SAN at a position, or null when it isn't legal there. */
export function uciAt(fen: string, san: string): string | null {
  try {
    const chess = new Chess(fen);
    const m = chess.move(san);
    return m ? m.from + m.to + (m.promotion ?? '') : null;
  } catch {
    return null;
  }
}

// ── Building the evidence ────────────────────────────────────────────────────
//
// Thin wrappers over coverage's index builders, at THIS feature's depth. They
// exist so a caller never has to remember which cap belongs to which feature.

/** Your games, indexed by position — only the ones you played as this colour. */
export function growGameIndex(games: ImportedGame[], colour: 'white' | 'black'): PositionReplyIndex {
  return gameReplyIndex(games.filter(g => g.colour === colour), GROW_MAX_PLIES);
}

/** The scouted opponents' replies, indexed by position. */
export function growScoutIndex(
  opponents: ScoutedOpponent[], colour: 'white' | 'black',
): ScoutIndex {
  return scoutReplyIndex(opponents, colour, GROW_MAX_PLIES);
}

/** One line to grow, with the moves it should prepare for. */
export interface GrowTarget {
  spot: GrowSpot;
  moves: GrowMove[];
}

/**
 * Today's target: the first candidate that actually has something to prepare
 * for.
 *
 * A line whose end position none of the three sources knows anything about is
 * SKIPPED rather than shown empty — "prepare for these moves" with no moves
 * under it is the one way this exercise can be worse than not running. The
 * `bookAt` lookup is a callback because the bundled book is a lazily-imported
 * 1.7 MB dataset: it is consulted per candidate, not loaded per render.
 */
export function firstGrowTarget(
  spots: GrowSpot[],
  sources: (spot: GrowSpot) => GrowSources,
  limit: number = GROW_PICKS,
): GrowTarget | null {
  for (const spot of spots) {
    const moves = growMoves(spot, sources(spot), limit);
    if (moves.length > 0) return { spot, moves };
  }
  return null;
}
