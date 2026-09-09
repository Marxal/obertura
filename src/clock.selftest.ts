// A runnable check of the clock reader (clock.ts) — no network, no DOM.
//
// The fixtures are shaped like the real thing: the Chess.com PGN comment
// format verified against a live archive fetch, and the Lichess centisecond
// array as it arrives from `clocks=true`. What matters most here is the
// arithmetic nobody can see: time SPENT is the previous reading of your own
// side, plus the increment, minus this one — get the increment wrong and every
// move in a 3+2 game looks two seconds slower than it was.

import {
  parseTimeControl,
  clocksFromPgn,
  ownClocks,
  ownClockIndex,
  classifyTiming,
  timeFactsAt,
  formatClock,
  formatTimeFacts,
} from './clock';
import type { ImportedGame } from './import-core';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

function check(name: string, pass: boolean, detail = ''): TestResult {
  return { name, pass, detail };
}

function eq(name: string, got: unknown, want: unknown): TestResult {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  return check(name, g === w, `got ${g}, wanted ${w}`);
}

// A 3+2 blitz game, our user as White. Four plies, so two readings are ours.
const PGN_3PLUS2 =
  '1. e4 {[%clk 0:03:00]} 1... c5 {[%clk 0:02:58]} '
  + '2. Nf3 {[%clk 0:02:55]} 2... d6 {[%clk 0:02:50]}';

function game(over: Partial<ImportedGame> = {}): ImportedGame {
  return {
    id: 'g1',
    url: 'https://example.invalid/1',
    endTime: 1_715_000_000,
    timeClass: 'blitz',
    timeControl: '180+2',
    rated: true,
    colour: 'white',
    result: 'loss',
    opponent: 'someone',
    eco: 'B20',
    opening: 'Sicilian Defence',
    sans: ['e4', 'c5', 'Nf3', 'd6'],
    ucis: ['e2e4', 'c7c5', 'g1f3', 'd7d6'],
    plyCount: 4,
    ...over,
  };
}

export function runClockSelfTest(): TestResult[] {
  const out: TestResult[] = [];

  // ── The time control ────────────────────────────────────────────────────────
  out.push(eq('180+2 parses', parseTimeControl('180+2'), { baseSec: 180, incSec: 2 }));
  out.push(eq('a bare 180 has no increment', parseTimeControl('180'), { baseSec: 180, incSec: 0 }));
  out.push(eq('chess.com daily is refused', parseTimeControl('1/259200'), null));
  out.push(eq('lichess correspondence is refused', parseTimeControl('correspondence'), null));
  out.push(eq('an unknown control is refused', parseTimeControl('-'), null));

  // ── Reading a PGN ───────────────────────────────────────────────────────────
  out.push(eq('every clk comment is read, in move order',
    clocksFromPgn(PGN_3PLUS2), [180, 178, 175, 170]));
  out.push(eq('a PGN with no clocks reads empty', clocksFromPgn('1. e4 e5 2. Nf3'), []));
  out.push(eq('tenths survive', clocksFromPgn('1. e4 {[%clk 0:02:59.9]}'), [179.9]));
  out.push(eq('an hours field is read', clocksFromPgn('1. e4 {[%clk 1:00:30]}'), [3630]));

  // ── Splitting out our own side ──────────────────────────────────────────────
  out.push(eq('white keeps the even plies',
    ownClocks([180, 178, 175, 170], 'white', 4), [180, 175]));
  out.push(eq('black keeps the odd plies',
    ownClocks([180, 178, 175, 170], 'black', 4), [178, 170]));
  out.push(eq('seconds are rounded',
    ownClocks([179.9, 178.4, 175.5, 170], 'white', 4), [180, 176]));
  out.push(eq('a trail that misses moves is dropped whole',
    ownClocks([180, 178], 'white', 4), null));
  out.push(eq('no readings at all is null', ownClocks([], 'white', 4), null));

  out.push(eq('white move 1 is clock index 0', ownClockIndex(0, 'white'), 0));
  out.push(eq('white move 2 is clock index 1', ownClockIndex(2, 'white'), 1));
  out.push(eq('black move 1 is clock index 0', ownClockIndex(1, 'black'), 0));
  out.push(eq('the opponent’s ply has no index of ours', ownClockIndex(1, 'white'), -1));

  // ── The tags ────────────────────────────────────────────────────────────────
  const tc = { baseSec: 180, incSec: 2 };
  out.push(eq('under ten seconds is a scramble', classifyTiming(8, 2, tc), 'scramble'));
  out.push(eq('a fifth of the clock left is low', classifyTiming(30, 3, tc), 'low'));
  out.push(eq('half the clock left is good', classifyTiming(120, 4, tc), 'good'));
  out.push(eq('a long think outranks a comfortable clock',
    classifyTiming(120, 40, tc), 'long'));
  out.push(eq('a snap move with the clock full is rushed',
    classifyTiming(150, 1, tc), 'rushed'));
  out.push(eq('a snap move when already low is still low',
    classifyTiming(20, 1, tc), 'low'));
  out.push(eq('the middle of the clock says nothing',
    classifyTiming(70, 5, tc), 'steady'));
  // Ten seconds is a scramble in a 15+10 game too — that threshold is absolute
  // on purpose, because ten seconds is ten seconds whatever the control.
  out.push(eq('ten seconds is a scramble at any time control',
    classifyTiming(9, 2, { baseSec: 900, incSec: 10 }), 'scramble'));

  // ── The facts for one move ──────────────────────────────────────────────────
  // Our own readings are 180 then 175, and the increment lands on each move:
  // 180 + 2 − 175 = 7 seconds spent on the second one.
  const g = game({ clocks: [180, 175] });
  out.push(eq('time spent adds the increment back',
    timeFactsAt(g, 2)?.spentSec, 7));
  out.push(eq('time left is the reading itself', timeFactsAt(g, 2)?.leftSec, 175));
  // The first move measures against the base time, which is a real before.
  out.push(eq('the first move measures against the base time',
    timeFactsAt(game({ clocks: [178, 170] }), 0)?.spentSec, 4));
  // …unless the clock never started there. A berserked Lichess game begins on
  // half the base with no increment, so move one would otherwise read as a
  // two-and-a-half-minute think.
  out.push(eq('a berserked first move is reported as unknown',
    timeFactsAt(game({ timeControl: '300+3', clocks: [149, 143] }), 0)?.spentSec, null));
  out.push(eq('but its later moves are still measured',
    timeFactsAt(game({ timeControl: '300+3', clocks: [149, 143] }), 2)?.spentSec, 9));
  out.push(eq('the opponent’s ply has no facts', timeFactsAt(g, 1), null));
  out.push(eq('a ply past the trail has no facts', timeFactsAt(g, 8), null));
  out.push(eq('a game with no clocks has no facts', timeFactsAt(game(), 2), null));
  out.push(eq('a correspondence game has no facts',
    timeFactsAt(game({ clocks: [180, 175], timeControl: '1/259200', timeClass: 'daily' }), 2),
    null));

  // Black's own trail is read against black's plies.
  const gb = game({ colour: 'black', clocks: [178, 170] });
  out.push(eq('black’s second move spends from black’s previous reading',
    timeFactsAt(gb, 3)?.spentSec, 10));

  // A no-increment game must not gain two free seconds.
  const g0 = game({ timeControl: '180', clocks: [180, 175] });
  out.push(eq('no increment, no adjustment', timeFactsAt(g0, 2)?.spentSec, 5));

  // A platform's rounding can put the arithmetic marginally under zero; that is
  // a 0-second move, not a negative one.
  const gneg = game({ clocks: [180, 183] });
  out.push(eq('a negative spend is clamped to zero', timeFactsAt(gneg, 2)?.spentSec, 0));

  // ── Reading them out ────────────────────────────────────────────────────────
  out.push(eq('seconds under a minute', formatClock(14), '14s'));
  out.push(eq('minutes and seconds', formatClock(124), '2:04'));
  out.push(eq('a padded second', formatClock(121), '2:01'));
  out.push(eq('both halves are said',
    formatTimeFacts({ leftSec: 124, spentSec: 3, tag: 'good', baseSec: 180 }),
    '2:04 left · 3s spent'));
  out.push(eq('the first move says only what is left',
    formatTimeFacts({ leftSec: 180, spentSec: null, tag: 'good', baseSec: 180 }),
    '3:00 left'));

  return out;
}
