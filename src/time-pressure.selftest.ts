// A runnable check of the Time pressure core — the ordering, the dealing and
// the scoring. No DOM, no engine, no clock of its own: every "elapsed time"
// here is a number handed in.
//
// The ordering is the part worth guarding. The exercise's whole claim is that
// it opens on the moves you rushed, and that claim is one comparator.

import {
  pressureScore,
  orderByPressure,
  dealRound,
  scoreSolve,
  totalsFor,
  NO_CLOCK_PRESSURE,
  roundMsFor,
  DEFAULT_ROUND_MINUTES,
  MAX_ROUND_MINUTES,
  FAST_MS,
  PER_POSITION_MS,
  SOLVE_POINTS,
  FAST_BONUS,
  type TimePressureEntry,
} from './time-pressure';
import type { SpotRef, MistakeSpot } from './mistake-scan';
import type { ImportedGame } from './import-core';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

function eq(name: string, got: unknown, want: unknown): TestResult {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  return { name, pass: g === w, detail: `got ${g}, wanted ${w}` };
}

const PRE_FEN = 'rn1q1rk1/1p2bppp/p2pbn2/4p3/4P3/1NN1B3/PPP1BPPP/R2Q1RK1 w - - 6 10';

function spot(over: Partial<MistakeSpot> = {}): MistakeSpot {
  return {
    id: 's1',
    ply: 2,
    category: 'blunder',
    preFen: PRE_FEN,
    playedSan: 'f4',
    playedUci: 'f2f4',
    best: [{ uci: 'b3d4', san: 'Nd4', cp: 30 }],
    evalBefore: 30,
    evalAfter: -350,
    ...over,
  };
}

function game(over: Partial<ImportedGame> = {}): ImportedGame {
  return {
    id: 'g1',
    url: 'https://example.invalid/1',
    endTime: 1_000_000,
    timeClass: 'blitz',
    timeControl: '180+0',
    rated: true,
    colour: 'white',
    result: 'loss',
    opponent: 'someone',
    eco: 'B90',
    opening: 'Sicilian',
    sans: ['e4', 'c5', 'Nf3'],
    ucis: ['e2e4', 'c7c5', 'g1f3'],
    plyCount: 3,
    ...over,
  };
}

/** A ref whose move at ply 2 was played with `left` seconds on a 180s clock. */
function refWithClock(id: string, left: number | null, endTime = 1_000_000): SpotRef {
  const clocks = left === null ? undefined : [180, left];
  return {
    game: game({ id, endTime, ...(clocks ? { clocks } : {}) }),
    spot: spot({ id }),
  };
}

export function runTimePressureSelfTest(): TestResult[] {
  const out: TestResult[] = [];

  // ── Pressure ────────────────────────────────────────────────────────────────
  out.push(eq('an empty clock is all the pressure there is',
    Math.round(pressureScore(refWithClock('a', 4)) * 100), 98));
  out.push(eq('half a clock is half the pressure',
    Math.round(pressureScore(refWithClock('b', 90)) * 100), 50));
  out.push(eq('a full clock is no pressure',
    Math.round(pressureScore(refWithClock('c', 180)) * 100), 0));
  out.push(eq('a game with no clocks sits in the middle',
    pressureScore(refWithClock('d', null)), NO_CLOCK_PRESSURE));

  // ── The order ───────────────────────────────────────────────────────────────
  // The claim the exercise makes: the moves you rushed come first, an unknown
  // clock next, and the ones you had time for last.
  const mixed = [
    refWithClock('comfortable', 170),
    refWithClock('unknown', null),
    refWithClock('scramble', 6),
    refWithClock('lowish', 40),
  ];
  out.push(eq('hardest-pressed first, comfortable last',
    orderByPressure(mixed).map(r => r.game.id),
    ['scramble', 'lowish', 'unknown', 'comfortable']));

  // Two positions under identical pressure: the newer game leads, and the
  // ranking is stable (the round's shuffle is dealRound's, below).
  const tied = [
    refWithClock('older', 20, 1_000),
    refWithClock('newer', 20, 9_000),
  ];
  out.push(eq('a tie goes to the newer game',
    orderByPressure(tied).map(r => r.game.id), ['newer', 'older']));
  out.push(eq('and the order is stable across calls',
    orderByPressure(tied).map(r => r.game.id),
    orderByPressure(tied).map(r => r.game.id)));

  // ── Dealing ─────────────────────────────────────────────────────────────────
  // A seeded generator, so a shuffle is a fixed fact the tests can check.
  const seeded = (seed: number) => () => { // mulberry32
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const ids = (refs: SpotRef[]) => refs.map(r => r.spot.id);
  const small = [refWithClock('x', 10), refWithClock('y', 100)];

  out.push(eq('an empty pool deals nothing', dealRound([], 5).length, 0));
  out.push(eq('a big pool is capped', dealRound(
    Array.from({ length: 60 }, (_, i) => refWithClock(`p${i}`, 100 - i)), 40).length, 40));

  // The complaint this fixes: a pool shorter than the round looped in a fixed
  // order. Every position once before any comes back, whatever the shuffle.
  const six = Array.from({ length: 6 }, (_, i) => refWithClock(`s${i}`, 10 + i * 30));
  const dealt = dealRound(six, 20, { random: seeded(7) });
  out.push(eq('the whole pool is dealt before anything repeats',
    new Set(ids(dealt.slice(0, 6))).size, 6));
  out.push(eq('a small pool still fills the round', dealt.length, 20));
  out.push(eq('never the same position twice in a row',
    dealt.every((r, i) => i === 0 || r.spot.id !== dealt[i - 1].spot.id), true));
  const seamsOk = [1, 2, 3, 4, 5, 6, 7, 8].every(seed => {
    const d = dealRound(six.slice(0, 2), 12, { random: seeded(seed) });
    return d.every((r, i) => i === 0 || r.spot.id !== d[i - 1].spot.id);
  });
  out.push(eq('a two-position pool alternates rather than stuttering', seamsOk, true));

  // Shuffled within a pressure band — never across one. A scramble still opens
  // the round; which scramble varies.
  const banded = [
    refWithClock('calm1', 170), refWithClock('calm2', 175),
    refWithClock('rush1', 5), refWithClock('rush2', 8), refWithClock('rush3', 3),
  ];
  const bandOk = [1, 2, 3, 4, 5].every(seed =>
    ids(dealRound(banded, 5, { random: seeded(seed) })).slice(0, 3).every(id => id.startsWith('rush')));
  out.push(eq('the hard-pressed band always opens the round', bandOk, true));
  const openers = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(seed =>
    dealRound(banded, 5, { random: seeded(seed) })[0].spot.id));
  out.push(eq('but not always on the same position', openers.size > 1, true));

  // "Go again": what the last round dealt waits at the back.
  const recentDeal = dealRound(banded, 5, {
    recent: new Set(['rush1', 'rush2', 'rush3']), random: seeded(3),
  });
  out.push(eq('the last round\'s positions go to the back',
    ids(recentDeal).slice(0, 2).sort(), ['calm1', 'calm2']));

  // ── The round's length ──────────────────────────────────────────────────────
  // The daily challenge sets this per part, so a nonsense value must land
  // somewhere sane rather than making a round of zero or of five hours.
  out.push(eq('minutes become milliseconds', roundMsFor(3), 180_000));
  out.push(eq('the default holds for a missing value',
    roundMsFor(0), DEFAULT_ROUND_MINUTES * 60_000));
  out.push(eq('a fraction rounds', roundMsFor(2.4), 120_000));
  out.push(eq('a negative is floored to one minute', roundMsFor(-5), 60_000));
  out.push(eq('a huge value is capped', roundMsFor(999), MAX_ROUND_MINUTES * 60_000));

  // ── Scoring ─────────────────────────────────────────────────────────────────
  out.push(eq('a quick find is worth double', scoreSolve(1_500), SOLVE_POINTS + FAST_BONUS));
  out.push(eq('the bonus is inclusive at the boundary',
    scoreSolve(FAST_MS), SOLVE_POINTS + FAST_BONUS));
  out.push(eq('a slower find still counts', scoreSolve(FAST_MS + 1), SOLVE_POINTS));

  const entries: TimePressureEntry[] = [
    { ref: small[0], outcome: 'found', ms: 1_200, points: 2 },
    { ref: small[1], outcome: 'found', ms: 6_000, points: 1 },
    { ref: small[0], outcome: 'missed', ms: 4_800, points: 0 },
    { ref: small[1], outcome: 'ran-out', ms: PER_POSITION_MS, points: 0 },
  ];
  const t = totalsFor(entries);
  out.push(eq('the score adds the bonuses in', t.score, 3));
  out.push(eq('found', t.found, 2));
  out.push(eq('missed', t.missed, 1));
  out.push(eq('ran out is counted apart from missed', t.ranOut, 1));
  out.push(eq('fast finds are counted', t.fast, 1));
  // The average covers what you ANSWERED. A position you never touched says
  // nothing about how fast you are, and folding its full ten seconds in would
  // drag the number toward the clock rather than toward you.
  out.push(eq('the average ignores the ones the clock took', t.averageMs, 4_000));
  out.push(eq('an empty round has no average', totalsFor([]).averageMs, null));
  out.push(eq('an empty round scores nothing', totalsFor([]).score, 0));

  return out;
}
