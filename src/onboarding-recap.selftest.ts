// Guards the first-run recap's arithmetic (src/onboarding-recap.ts).
//
// This is the screen a stranger sees thirty seconds after arriving, built from
// their own games, so the ways it can quietly go wrong all cost a first
// impression:
//   1. a trunk ending on the OPPONENT's move — the saved line would finish on a
//      move the user never has to play, against the app's whole convention;
//   2. a trunk built from one game's accidents rather than the shared stem;
//   3. three starter lines all in one colour, leaving the other book empty;
//   4. the ten-game floor drifting, so a two-game library gets a confident recap.

import {
  buildRecap,
  hasEnoughGames,
  ownMoveCount,
  pickStarterOpenings,
  trimToOwnMove,
  trunkOf,
  RECAP_MIN_GAMES,
  TRUNK_MAX_OWN_MOVES,
  type RecapGame,
} from './onboarding-recap';
import type { TestResult } from './selftest-panel';

// A game whose moves are given as a UCI string list; sans are faked in step so
// the trunk's san output can be checked against them.
function game(
  colour: 'white' | 'black',
  result: RecapGame['result'],
  ucis: string[],
): RecapGame {
  return { colour, result, ucis, sans: ucis.map(u => `S${u}`) };
}

// 1. e4 e5 2. Nf3 Nc6 3. Bb5 — a white London-ish stem, in UCI.
const E4 = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6'];

export function runOnboardingRecapSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // ── The floor ──────────────────────────────────────────────────────────────
  check(
    'the ten-game floor holds',
    !hasEnoughGames(RECAP_MIN_GAMES - 1) && hasEnoughGames(RECAP_MIN_GAMES),
    `${RECAP_MIN_GAMES - 1} rejected, ${RECAP_MIN_GAMES} accepted`,
  );

  // ── Own-move counting ──────────────────────────────────────────────────────
  check(
    'white\'s own moves round up, black\'s round down',
    ownMoveCount(5, 'white') === 3 && ownMoveCount(5, 'black') === 2,
    `5 plies = ${ownMoveCount(5, 'white')} white / ${ownMoveCount(5, 'black')} black`,
  );

  // ── A trunk always ends on the user's own move ─────────────────────────────
  for (const colour of ['white', 'black'] as const) {
    for (const len of [1, 2, 3, 4, 5, 6]) {
      const trimmed = trimToOwnMove(E4.slice(0, len), colour);
      const endsOwn = trimmed.length === 0
        || (colour === 'white' ? trimmed.length % 2 === 1 : trimmed.length % 2 === 0);
      check(
        `${colour} trunk of ${len} plies ends on their own move`,
        endsOwn,
        `trimmed to ${trimmed.length}`,
      );
    }
  }

  // ── The majority vote finds the shared stem, not one game's accidents ──────
  // Four games agree for four plies, then three play one move and one another.
  const shared = [
    game('white', 'win', [...E4.slice(0, 4), 'f1b5', 'a7a6']),
    game('white', 'loss', [...E4.slice(0, 4), 'f1b5', 'g8f6']),
    game('white', 'win', [...E4.slice(0, 4), 'f1b5', 'f8c5']),
    game('white', 'draw', [...E4.slice(0, 4), 'f1c4', 'f8c5']),
  ];
  const trunk = trunkOf(shared, 'white');
  check(
    'the majority move wins at a split',
    trunk.ucis[4] === 'f1b5',
    `ply 5 = ${trunk.ucis[4]} (3 games played f1b5, 1 played f1c4)`,
  );
  check(
    'the trunk stops where the group truly splits',
    trunk.ucis.length === 5,
    `${trunk.ucis.length} plies — past f1b5 the three games all differ`,
  );
  check(
    'sans stay in step with ucis',
    trunk.sans.length === trunk.ucis.length,
    `${trunk.sans.length} sans for ${trunk.ucis.length} ucis`,
  );

  // A lone game is exempt from the support rule — it is all the evidence there
  // is, so it must still produce a line rather than an empty one.
  const solo = trunkOf([game('white', 'win', E4)], 'white');
  check(
    'a one-game group still yields a trunk',
    solo.ucis.length >= 1,
    `${solo.ucis.length} plies`,
  );

  // ── The depth cap ──────────────────────────────────────────────────────────
  const long = Array.from({ length: 40 }, (_, i) => `m${i}`);
  const deep = trunkOf([game('white', 'win', long), game('white', 'win', long)], 'white');
  check(
    'the trunk never runs past the depth cap',
    ownMoveCount(deep.ucis.length, 'white') <= TRUNK_MAX_OWN_MOVES,
    `${ownMoveCount(deep.ucis.length, 'white')} own moves, cap ${TRUNK_MAX_OWN_MOVES}`,
  );

  // ── The recap itself ───────────────────────────────────────────────────────
  const games: RecapGame[] = [
    ...Array.from({ length: 5 }, () => game('white', 'win', E4)),
    ...Array.from({ length: 3 }, () => game('black', 'loss', E4)),
    ...Array.from({ length: 2 }, () => game('white', 'draw', ['d2d4', 'd7d5', 'c2c4', 'e7e6'])),
  ];
  const named = (g: RecapGame): string =>
    g.ucis[0] === 'e2e4' ? 'Ruy Lopez' : 'Queen\'s Gambit';
  const recap = buildRecap(games, named);

  check(
    'the totals add up',
    recap.total === 10 && recap.white === 7 && recap.black === 3,
    `${recap.total} total, ${recap.white} white, ${recap.black} black`,
  );
  check(
    'the result tally adds up',
    recap.wins + recap.draws + recap.losses === recap.total,
    `${recap.wins}W ${recap.draws}D ${recap.losses}L of ${recap.total}`,
  );
  check(
    'the dominant colour is the one played more',
    recap.dominantColour === 'white',
    `${recap.white} white vs ${recap.black} black → ${recap.dominantColour}`,
  );
  check(
    'the same opening in two colours stays two groups',
    recap.openings.filter(o => o.name === 'Ruy Lopez').length === 2,
    `${recap.openings.filter(o => o.name === 'Ruy Lopez').length} Ruy Lopez groups`,
  );
  check(
    'groups come back most-played first',
    recap.openings.every((o, i) => i === 0 || recap.openings[i - 1].games >= o.games),
    recap.openings.map(o => `${o.name}(${o.colour}) ${o.games}`).join(', '),
  );

  // An unnameable game still counts in the totals but forms no group.
  const withUnnamed = buildRecap(
    [...games, game('white', 'win', ['h2h4', 'h7h5'])],
    g => (g.ucis[0] === 'h2h4' ? null : named(g)),
  );
  check(
    'an unnameable opening counts but forms no group',
    withUnnamed.total === 11
      && withUnnamed.openings.reduce((n, o) => n + o.games, 0) === 10,
    `${withUnnamed.total} games, ${withUnnamed.openings.reduce((n, o) => n + o.games, 0)} grouped`,
  );

  // ── Starter lines span both colours ────────────────────────────────────────
  const picked = pickStarterOpenings(recap, 3);
  check(
    'the starter picks span both colours when both exist',
    new Set(picked.map(o => o.colour)).size === 2,
    picked.map(o => `${o.name} (${o.colour})`).join(', '),
  );
  check(
    'never more picks than asked for',
    pickStarterOpenings(recap, 2).length === 2 && pickStarterOpenings(recap, 0).length === 0,
    `asked 2 → ${pickStarterOpenings(recap, 2).length}, asked 0 → ${pickStarterOpenings(recap, 0).length}`,
  );
  check(
    'asking for more than exist returns what there is, without duplicates',
    (() => {
      const all = pickStarterOpenings(recap, 99);
      return all.length === recap.openings.length && new Set(all).size === all.length;
    })(),
    `${pickStarterOpenings(recap, 99).length} of ${recap.openings.length}`,
  );

  // ── Four picks deal 2 White + 2 Black ──────────────────────────────────────
  // The reason RECAP_STARTER_LINES is 4: an odd count always leaves one book
  // thinner, and the thin one is the half a new user least likely fills in.
  const balancedGames: RecapGame[] = [
    ...Array.from({ length: 8 }, () => game('white', 'win', E4)),
    ...Array.from({ length: 6 }, () => game('white', 'win', ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6'])),
    ...Array.from({ length: 5 }, () => game('black', 'loss', E4)),
    ...Array.from({ length: 4 }, () => game('black', 'draw', ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'g1f3', 'd7d5'])),
  ];
  const balanced = buildRecap(balancedGames, g => (g.ucis[0] === 'e2e4' ? 'King\'s Pawn' : 'Queen\'s Pawn'));
  const four = pickStarterOpenings(balanced, 4);
  const whites = four.filter(o => o.colour === 'white').length;
  const blacks = four.filter(o => o.colour === 'black').length;
  check(
    'four picks split 2 White and 2 Black',
    four.length === 4 && whites === 2 && blacks === 2,
    `${four.length} picked — ${whites}W / ${blacks}B`,
  );

  // One colour only: the other takes every slot rather than the set coming
  // back short.
  const whiteOnly = buildRecap(
    [
      ...Array.from({ length: 6 }, () => game('white', 'win', E4)),
      ...Array.from({ length: 5 }, () => game('white', 'win', ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6'])),
    ],
    g => (g.ucis[0] === 'e2e4' ? 'King\'s Pawn' : 'Queen\'s Pawn'),
  );
  const wOnly = pickStarterOpenings(whiteOnly, 4);
  check(
    'one colour only still fills what it can, without duplicates',
    wOnly.every(o => o.colour === 'white') && new Set(wOnly).size === wOnly.length,
    `${wOnly.length} picks, all white: ${wOnly.every(o => o.colour === 'white')}`,
  );

  // An odd count gives the spare line to the colour they play more.
  const three = pickStarterOpenings(balanced, 3);
  check(
    'an odd count favours the dominant colour',
    three.filter(o => o.colour === balanced.dominantColour).length === 2,
    `dominant ${balanced.dominantColour}: `
      + `${three.filter(o => o.colour === balanced.dominantColour).length} of 3`,
  );

  return results;
}
