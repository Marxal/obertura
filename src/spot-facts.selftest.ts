// A runnable check of the pure half of spot-facts.ts — the date phrasing, the
// cost line, and the slide counted off the scan's eval trail.
//
// The two async answers (the repertoire link, the repeat count) read the
// position index and IndexedDB, so they stay phone-only like the storage suite.

import { whenLabel, costLine, wobblesBefore, spotFacts } from './spot-facts';
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

const NOW = Date.UTC(2026, 8, 9, 12, 0, 0); // 9 September 2026, midday
const daysAgo = (n: number): number => Math.floor((NOW - n * 86_400_000) / 1000);

function game(over: Partial<ImportedGame> = {}): ImportedGame {
  return {
    id: 'g1',
    url: 'https://example.invalid/1',
    endTime: daysAgo(3),
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

export function runSpotFactsSelfTest(): TestResult[] {
  const out: TestResult[] = [];

  // ── When ────────────────────────────────────────────────────────────────────
  out.push(eq('today', whenLabel(daysAgo(0), NOW), 'Today'));
  out.push(eq('yesterday', whenLabel(daysAgo(1), NOW), 'Yesterday'));
  out.push(eq('a few days', whenLabel(daysAgo(3), NOW), '3 days ago'));
  out.push(eq('last week', whenLabel(daysAgo(9), NOW), 'Last week'));
  out.push(eq('a few weeks', whenLabel(daysAgo(21), NOW), '3 weeks ago'));
  out.push(eq('an older game names its month', whenLabel(daysAgo(120), NOW), 'In May'));
  out.push(eq('a game from another year names the year',
    whenLabel(daysAgo(500), NOW), 'In 2025'));
  out.push(eq('a game with no timestamp says nothing', whenLabel(0, NOW), ''));

  // ── The cost ────────────────────────────────────────────────────────────────
  out.push(eq('a loss', costLine('loss'), 'you lost this one'));
  out.push(eq('a win', costLine('win'), 'you won anyway'));
  out.push(eq('a draw', costLine('draw'), 'it ended in a draw'));
  // "Anyway" points at the surprise, so it changes sides with the kind of move.
  out.push(eq('a brilliancy in a won game', costLine('win', 'brilliancy'), 'you won this one'));
  out.push(eq('a brilliancy in a lost game', costLine('loss', 'brilliancy'), 'you lost anyway'));

  // ── The slide ───────────────────────────────────────────────────────────────
  // A white game whose trail drops hard on white's second move (ply 2): +0.2 to
  // −3.0 is well past a wobble, while ply 0 barely moves.
  const trail = [20, 15, 30, -300, -290, -300, -295];
  const g = game({ retry: { scannedAt: 0, version: 2, spots: [], trail } });
  out.push(eq('the earlier wobble is counted', wobblesBefore(g, 4), 1));
  out.push(eq('a move with nothing before it has no wobbles', wobblesBefore(g, 0), 0));
  out.push(eq('an unscanned game has no answer', wobblesBefore(game(), 4), null));

  // The same trail read from BLACK's side: white's collapse at ply 3 is black's
  // gain, so black has no wobbles of their own to answer for.
  const gb = game({ colour: 'black', retry: { scannedAt: 0, version: 2, spots: [], trail } });
  out.push(eq('a drop against the opponent is not your wobble', wobblesBefore(gb, 5), 0));

  // ── The whole cheap read ────────────────────────────────────────────────────
  const facts = spotFacts(game({ myRating: 1500, opponentRating: 1350 }), 4, 'mistake', NOW);
  out.push(eq('the move number is how a person counts', facts.moveNumber, 3));
  out.push(eq('the rating gap is from your side', facts.ratingGap, 150));
  out.push(eq('a game with one rating missing has no gap',
    spotFacts(game({ myRating: 1500 }), 4, 'mistake', NOW).ratingGap, null));
  out.push(eq('a game with no clocks has no timing', facts.time, null));

  return out;
}
