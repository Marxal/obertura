// Blunder detective — the pure core of the "find the blunder" exercise.
//
// THE EXERCISE. You are shown a short run of moves from one of your own games —
// four to six of them — and asked which one is the blunder. It might be yours,
// it might be your opponent's, and nothing on the board says which: that is the
// whole game. Once you have caught it you are asked to play what should have
// been played instead.
//
// THE ONE HARD RULE. A run must contain EXACTLY ONE blunder. A second one — or
// even a move bad enough to argue about — turns a puzzle with an answer into a
// disagreement with the app, and the user is right and the app is wrong. So the
// finder below is deliberately strict: one move over the blunder line, and every
// other move in the run comfortably under the MISTAKE line (not merely under the
// blunder line). A run that can't clear that bar is not offered at all.
//
// HOW SURE IS THAT. The blunder itself is re-checked by the engine at the
// analyser's depth before the run is stored, so the answer is never the cheap
// pass's opinion alone. The other moves are judged on the cheap pass only —
// re-searching five more positions per game is not worth it — which is why the
// bar they have to clear (QUIET_DROP) is less than half the bar the blunder has
// to pass (BLUNDER_DROP): a move would have to be mis-read by a wide margin to
// sneak in as a second candidate.
//
// WHERE THE NUMBERS COME FROM. The mistake scan (mistake-scan.ts) already walks
// every game building an eval per position — the "trail" — to find your own
// mistakes. It now keeps that trail, which is what makes this exercise nearly
// free: the trail covers BOTH sides' moves, so opponent blunders were always in
// there, they were just being thrown away. The finder here is pure arithmetic
// over the trail; the scan pays for one engine look at the chosen blunder, to
// confirm it and to learn the move that should have been played.
//
// No DOM, no engine, no storage here — detective.selftest.ts covers the lot.

import { cpToWin } from './winprob';
import type { MoveEval } from './engine';
import type { ImportedGame } from './import-core';

// ── Tunables ─────────────────────────────────────────────────────────────────

/** The run's length, in moves shown. Six is the target; four the floor. */
export const RUN_MAX_MOVES = 6;
export const RUN_MIN_MOVES = 4;

/**
 * How bad the one blunder must be, as a win-probability drop. A touch above the
 * grader's own 0.20 boundary (winprob.ts) on purpose: a move sitting exactly on
 * the line is arguable, and this exercise has no room for arguable.
 */
export const BLUNDER_DROP = 0.22;

/**
 * How quiet every OTHER move in the run must be. This is the grader's
 * inaccuracy/mistake boundary — so nothing else in the run is even a "?", let
 * alone a second candidate answer.
 */
export const QUIET_DROP = 0.10;

/**
 * The blunderer must have had something to lose: a position already this far
 * gone (win probability) can't be blundered away in any way worth training.
 */
export const MIN_WIN_BEFORE = 0.25;

/** Don't start a run on the first moves of a game — that's book, not detection. */
export const MIN_START_PLY = 2;

// ── Stored shape ─────────────────────────────────────────────────────────────

/**
 * One detective run, stored on the game record (ImportedGame.retry.detective).
 * Everything the exercise needs except the moves themselves, which are replayed
 * from the game — a run is a window into a game we already hold.
 *
 * Evals are in the BLUNDERER's perspective (positive = good for whoever played
 * the blunder), mate-flattened, exactly like MistakeSpot's.
 */
export interface DetectiveSpot {
  id: string;          // `${gameId}#d${blunderPly}`
  startPly: number;    // 0-based ply the run opens on
  plies: number;       // how many moves it shows (RUN_MIN_MOVES..RUN_MAX_MOVES)
  blunderPly: number;  // the one blunder, inside [startPly, startPly + plies)
  byUser: boolean;     // yours, or your opponent's
  preFen: string;      // the position before the blunder — where the answer is played
  playedSan: string;   // the blunder…
  playedUci: string;
  best: MoveEval[];    // …and what should have been played (top-3, best first)
  evalBefore: number;  // blunderer-perspective cp before the blunder
  evalAfter: number;   // …and after it
}

/** A run plus the game it came from — every caller needs both. */
export interface DetectiveRef {
  game: ImportedGame;
  spot: DetectiveSpot;
}

// ── Finding a run (pure) ─────────────────────────────────────────────────────

/** A candidate run, before the engine has confirmed anything. */
export interface DetectiveWindow {
  startPly: number;
  plies: number;
  blunderPly: number;
  drop: number;        // the blunder's win-probability drop, from the trail
}

/**
 * The win-probability a move cost the side that played it, from a WHITE-
 * perspective eval trail (`trail[i]` = eval of the position before ply i, so
 * `trail[i + 1]` is the eval after ply i). Null when either end is missing — the
 * scan leaves gaps where neither the cloud nor the engine answered, and a gap is
 * never guessed at.
 */
export function moveDrop(trail: (number | null)[], ply: number): number | null {
  const before = trail[ply];
  const after = trail[ply + 1];
  if (before === null || before === undefined) return null;
  if (after === null || after === undefined) return null;
  // Even ply = White moved. Flip to the mover's own perspective so a "drop" is
  // always "this player made their own position worse".
  const sign = ply % 2 === 0 ? 1 : -1;
  return cpToWin(sign * before) - cpToWin(sign * after);
}

/** The mover's win probability before their move — "did they have anything to lose". */
export function winBefore(trail: (number | null)[], ply: number): number | null {
  const before = trail[ply];
  if (before === null || before === undefined) return null;
  return cpToWin((ply % 2 === 0 ? 1 : -1) * before);
}

/**
 * Every run this game can offer, best (biggest blunder) first.
 *
 * For each blunder in the trail we try every window that contains it, longest
 * first, keeping only those where every other move is quiet and no eval is
 * missing. The blunder is never the run's FIRST move: a run has to open on
 * something ordinary, or there is nothing to browse before the answer.
 */
export function findDetectiveWindows(trail: (number | null)[]): DetectiveWindow[] {
  const lastPly = trail.length - 2; // the last ply with an eval on both sides
  const out: DetectiveWindow[] = [];

  for (let b = MIN_START_PLY; b <= lastPly; b++) {
    const drop = moveDrop(trail, b);
    if (drop === null || drop < BLUNDER_DROP) continue;
    const before = winBefore(trail, b);
    if (before === null || before < MIN_WIN_BEFORE) continue;

    for (let len = RUN_MAX_MOVES; len >= RUN_MIN_MOVES; len--) {
      // Offsets that keep at least one move ahead of the blunder, and at least
      // one after it where the run is long enough to afford both.
      for (let offset = 1; offset <= len - 1; offset++) {
        const start = b - offset;
        if (start < MIN_START_PLY) continue;
        if (start + len - 1 > lastPly) continue;
        if (!isCleanWindow(trail, start, len, b)) continue;
        out.push({ startPly: start, plies: len, blunderPly: b, drop });
      }
    }
  }

  // Biggest blunder first (the clearest exercise); ties keep the longest run,
  // then the earliest start, so the order is stable for a given game.
  out.sort((a, b) => b.drop - a.drop || b.plies - a.plies || a.startPly - b.startPly);
  return out;
}

/** Is every move in this window but `blunderPly` comfortably quiet — and known? */
function isCleanWindow(
  trail: (number | null)[],
  start: number,
  len: number,
  blunderPly: number,
): boolean {
  for (let i = start; i < start + len; i++) {
    const d = moveDrop(trail, i);
    if (d === null) return false;              // a gap could be hiding anything
    if (i === blunderPly) continue;
    if (d >= QUIET_DROP) return false;         // a second candidate answer
  }
  return true;
}

/**
 * Pick ONE run out of the candidates, for a given game.
 *
 * The biggest blunder wins, but WHERE it sits inside the run is chosen by a hash
 * of the game id rather than by rule. Centre it every time and the exercise
 * teaches "accuse the middle move"; put it last every time and it teaches
 * "accuse the last one". A hash keeps it stable for a game (the same run every
 * time you meet it) while spreading it across a library.
 */
export function chooseDetectiveWindow(
  windows: DetectiveWindow[],
  seed: string,
): DetectiveWindow | null {
  if (windows.length === 0) return null;
  const best = windows.filter(w => w.blunderPly === windows[0].blunderPly);
  // Prefer the longest runs available for that blunder, then spread the
  // blunder's place inside them.
  const longest = best.filter(w => w.plies === best[0].plies);
  return longest[hashString(seed) % longest.length];
}

/** A small, stable string hash (FNV-1a). Same input, same run, forever. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ── Reading the stored runs back ─────────────────────────────────────────────

/** Every scanned game's run, flattened into session-ready refs. */
export function collectDetectiveSpots(games: ImportedGame[]): DetectiveRef[] {
  const out: DetectiveRef[] = [];
  for (const game of games) {
    const spot = game.retry?.detective;
    if (spot) out.push({ game, spot });
  }
  return out;
}

/**
 * Deal a session's worth.
 *
 * Two rules, in this order. First, a case you have already cracked rests a while
 * (`dueAt`, from middle-log.ts) and every fresh case is dealt before any resting
 * one — meeting a run you solved on Tuesday while an unseen one waits is the
 * fastest way to make the exercise feel like a repeat.
 *
 * Second, WITHIN each of those groups the two sides alternate: a session of five
 * where the blunder was yours every time teaches the answer without anyone
 * having to look at the board.
 */
export function pickDetective(
  refs: DetectiveRef[],
  count: number,
  dueAt: (id: string) => number = () => 0,
  now: number = Date.now(),
): DetectiveRef[] {
  const newest = (a: DetectiveRef, b: DetectiveRef): number => b.game.endTime - a.game.endTime;
  const soonest = (a: DetectiveRef, b: DetectiveRef): number => dueAt(a.spot.id) - dueAt(b.spot.id);

  const ready = refs.filter(r => dueAt(r.spot.id) <= now).sort(newest);
  const resting = refs.filter(r => dueAt(r.spot.id) > now).sort(soonest);

  const out = alternateSides(ready, count);
  if (out.length < count) out.push(...alternateSides(resting, count - out.length));
  return out;
}

/** Deal from one group, swapping sides each time while both sides last. */
function alternateSides(pool: DetectiveRef[], count: number): DetectiveRef[] {
  const mine = pool.filter(r => r.spot.byUser);
  const theirs = pool.filter(r => !r.spot.byUser);
  // Start on whichever side has more waiting, so the tail is as mixed as the
  // pool allows rather than ending in a run of whichever side is deeper.
  let takeMine = mine.length >= theirs.length;
  const out: DetectiveRef[] = [];
  while (out.length < count && (mine.length || theirs.length)) {
    const from = takeMine ? mine : theirs;
    const other = takeMine ? theirs : mine;
    const next = from.shift() ?? other.shift();
    if (!next) break;
    out.push(next);
    takeMine = !takeMine;
  }
  return out;
}

/** How many runs are available right now (not resting) — the card's badge. */
export function readyDetectiveCount(
  refs: DetectiveRef[],
  dueAt: (id: string) => number,
  now: number = Date.now(),
): number {
  return refs.filter(r => dueAt(r.spot.id) <= now).length;
}
