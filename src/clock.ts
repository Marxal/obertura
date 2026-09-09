// Per-move clock times from your imported games — the "you were low on time
// here" half of the from-your-games exercises.
//
// WHERE THE DATA COMES FROM. Both platforms hand it over with the games we
// already download, so this costs no extra request:
//   • Chess.com writes a {[%clk 0:02:59.9]} comment after every move of every
//     LIVE game, inside the PGN we already parse.
//   • Lichess writes nothing unless asked; `clocks=true` adds a `clocks` array
//     of centiseconds, one entry per ply, to the JSON we already stream.
//
// WHAT WE KEEP. Only YOUR OWN readings, rounded to whole seconds
// (ImportedGame.clocks). That is ~190 bytes a game against ~370 for both
// sides, and the second side answers no question this app asks. Everything
// below — time spent, the tag, the chart in the full-story sheet — is derived
// from those numbers at render time, so nothing else is stored and no scan has
// to be re-run when the rules here change.
//
// DAILY GAMES ARE EXCLUDED, deliberately. Chess.com's daily PGNs carry a
// [%clk] too, but it is not a clock in the sense meant here: a 3-day game
// shows readings like 2:27:20 that jump up and down between moves. Nothing
// honest can be said about time pressure in correspondence chess, so
// clocksFromPgn's callers skip the whole bucket (see chesscom.ts).
//
// Pure: strings and numbers in, numbers out. No DOM, no storage, no engine —
// exercised offline by clock.selftest.ts.

import type { ImportedGame } from './import-core';

// ── The time control ──────────────────────────────────────────────────────────

export interface TimeControl {
  baseSec: number;
  incSec: number;
}

/**
 * Read a platform time-control string. Both platforms use "180+2" for live
 * games (Lichess is built that way in lichess.ts; Chess.com writes it natively,
 * with a bare "180" when there is no increment).
 *
 * Returns null for anything that is not a live clock — "-", Chess.com's daily
 * "1/259200", Lichess's "correspondence" — which is what keeps correspondence
 * games out of every calculation here.
 */
export function parseTimeControl(raw: string): TimeControl | null {
  const s = (raw ?? '').trim();
  if (!s || s === '-' || s === 'correspondence') return null;
  if (s.includes('/')) return null; // chess.com daily: "1/259200"
  const m = /^(\d+)(?:\+(\d+))?$/.exec(s);
  if (!m) return null;
  const baseSec = Number(m[1]);
  if (!Number.isFinite(baseSec) || baseSec <= 0) return null;
  return { baseSec, incSec: Number(m[2] ?? 0) || 0 };
}

// ── Reading the clocks off a game ─────────────────────────────────────────────

// "0:02:59.9" / "2:27:20" / "0:14" → seconds. Returns null for anything else.
function clkToSeconds(raw: string): number | null {
  const parts = raw.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isFinite(n) || n < 0) return null;
    total = total * 60 + n;
  }
  return total;
}

/**
 * Every {[%clk …]} reading in a PGN, in move order, as seconds — one per ply
 * for a Chess.com live game. An empty array means the PGN carried none, which
 * is the normal case for imports from before this existed.
 */
export function clocksFromPgn(pgn: string): number[] {
  const out: number[] = [];
  const re = /\[%clk\s+([0-9:.]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pgn)) !== null) {
    const secs = clkToSeconds(m[1]);
    if (secs === null) return []; // one bad reading and the whole run is suspect
    out.push(secs);
  }
  return out;
}

/**
 * Keep only the readings for the side the user played, rounded to whole
 * seconds — the stored shape (ImportedGame.clocks).
 *
 * `all` is one reading per ply, so white's are the even indices and black's the
 * odd ones. A run that doesn't cover the whole game is dropped rather than
 * stored half-length: a chart with a missing tail would lie about when the
 * clock ran down, and every caller here treats "no clocks" gracefully.
 */
export function ownClocks(
  all: number[], colour: 'white' | 'black', plyCount: number,
): number[] | null {
  if (all.length === 0 || all.length !== plyCount) return null;
  const first = colour === 'white' ? 0 : 1;
  const out: number[] = [];
  for (let i = first; i < all.length; i += 2) out.push(Math.round(all[i]));
  return out.length ? out : null;
}

/**
 * Which entry of `game.clocks` belongs to the move at `ply` (0-based, counting
 * both sides). Returns -1 when that ply is the opponent's move — we only store
 * our own side, so there is nothing to show.
 */
export function ownClockIndex(ply: number, colour: 'white' | 'black'): number {
  const mine = colour === 'white' ? ply % 2 === 0 : ply % 2 === 1;
  if (!mine) return -1;
  return Math.floor(ply / 2);
}

// ── What we say about a move's timing ─────────────────────────────────────────

// The six tags, worst-pressure first. 'steady' is the silent one: it means the
// clock has nothing to say about this move, and the strip renders no row at all
// rather than a shrug.
export type TimeTag = 'scramble' | 'low' | 'long' | 'rushed' | 'good' | 'steady';

export interface TimeFacts {
  /** Seconds left on your clock after the move. */
  leftSec: number;
  /**
   * Seconds you spent on it, or null when the arithmetic can't be trusted —
   * see timeFactsAt for the one case that produces it (a berserked game, where
   * the clock never started at the base time we think it did).
   */
  spentSec: number | null;
  tag: TimeTag;
  /** The game's base time, for the chart's scale. */
  baseSec: number;
}

// The thresholds, in one place. All are fractions of the game's BASE time, so
// they mean the same thing in a 1+0 bullet game and a 15+10 rapid one — except
// SCRAMBLE_ABS, which is absolute because ten seconds is ten seconds.
export const SCRAMBLE_ABS_SEC = 10;   // under this = a scramble, whatever the control
export const SCRAMBLE_FRACTION = 0.05;
export const LOW_FRACTION = 0.20;     // under a fifth of your clock = low
export const COMFORTABLE_FRACTION = 0.50; // over half = good on time
export const LONG_THINK_FRACTION = 0.20;  // a fifth of the whole clock on one move
export const RUSHED_MAX_SEC = 1;      // played in a second or less…
// …while this much of the clock was still there. "Rushed it" is the inverse
// lesson and the useful one: it is not that you had no time, it is that you had
// time and didn't use it.
export const RUSHED_MIN_LEFT_FRACTION = 0.50;

/**
 * Classify one move's timing. Precedence matters and is deliberate: being in a
 * scramble outranks everything (it explains the move), then being low, then how
 * long the move itself took. "Good on time" is last because it is the least
 * interesting thing that can be true.
 */
export function classifyTiming(leftSec: number, spentSec: number | null, tc: TimeControl): TimeTag {
  const { baseSec } = tc;
  if (leftSec <= SCRAMBLE_ABS_SEC || leftSec <= baseSec * SCRAMBLE_FRACTION) return 'scramble';
  if (leftSec <= baseSec * LOW_FRACTION) return 'low';
  if (spentSec !== null && spentSec >= baseSec * LONG_THINK_FRACTION) return 'long';
  if (
    spentSec !== null
    && spentSec <= RUSHED_MAX_SEC
    && leftSec >= baseSec * RUSHED_MIN_LEFT_FRACTION
  ) return 'rushed';
  if (leftSec >= baseSec * COMFORTABLE_FRACTION) return 'good';
  return 'steady';
}

/**
 * Everything the strip and the sheet need about the timing of ONE move, or null
 * when we can't say: no clocks stored (an older import), a correspondence game,
 * the opponent's move, or a ply past the end of what we kept.
 */
export function timeFactsAt(game: ImportedGame, ply: number): TimeFacts | null {
  const clocks = game.clocks;
  if (!clocks || clocks.length === 0) return null;
  const tc = parseTimeControl(game.timeControl);
  if (!tc) return null;
  const idx = ownClockIndex(ply, game.colour);
  if (idx < 0 || idx >= clocks.length) return null;

  const leftSec = clocks[idx];
  // What was on the clock before the move: the previous reading of YOUR side,
  // or the base time for your very first move. The increment is added back
  // because BOTH platforms apply it to the reading they write — verified
  // against a live Chess.com archive, where an instant first move on a 180+1
  // shows 180.9. Without it every move in an increment game would look `inc`
  // seconds slower than it was.
  const beforeSec = idx === 0 ? tc.baseSec : clocks[idx - 1];
  const raw = beforeSec + tc.incSec - leftSec;
  // The exception is a BERSERKED Lichess game: the player starts on half the
  // base time with no increment, so the first move appears to have swallowed
  // most of the clock. Nothing tells us it was berserked from the fields we
  // store, so an implausible first spend is reported as unknown rather than as
  // a two-minute think. Every later move is fine — those measure one real
  // reading against another.
  const implausibleFirst = idx === 0 && raw > tc.baseSec / 2;
  // Clamped otherwise: a platform's rounding can make a fast move come out
  // fractionally negative, and nothing spends longer than the whole clock.
  const spentSec = implausibleFirst ? null : Math.max(0, Math.min(raw, tc.baseSec));

  return { leftSec, spentSec, tag: classifyTiming(leftSec, spentSec, tc), baseSec: tc.baseSec };
}

// ── Reading them out ──────────────────────────────────────────────────────────

export const TIME_TAG_LABEL: Record<TimeTag, string> = {
  scramble: 'Time scramble',
  low: 'Low on time',
  long: 'Long think',
  rushed: 'Rushed it',
  good: 'Good on time',
  steady: '',
};

/** A clock reading as a person says it: "2:04", "14s". */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** "2:04 left · 3s spent" — the right-hand half of the strip's clock row. */
export function formatTimeFacts(facts: TimeFacts): string {
  const left = `${formatClock(facts.leftSec)} left`;
  if (facts.spentSec === null) return left;
  return `${left} · ${formatClock(facts.spentSec)} spent`;
}
