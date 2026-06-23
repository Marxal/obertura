import { toAngleKey, openingAngles, puzzleSetup, hasPuzzles } from './puzzles';
import type { Puzzle } from './puzzles';

// Runnable checks for the puzzle logic — angle-key mapping and the position
// replay. Network calls (fetchNextPuzzle / dashboard) aren't exercised here; this
// covers the pure pieces, in the same zero-framework style as the other suites.

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

function makePuzzle(over: Partial<Puzzle>): Puzzle {
  return {
    id: 'test',
    rating: 1500,
    plays: 0,
    solution: [],
    themes: [],
    initialPly: 0,
    pgn: '',
    gameId: 'g',
    ...over,
  };
}

export function runPuzzlesSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  // ── Angle-key mapping ──────────────────────────────────────────────────────
  const cases: [string | null, string | null][] = [
    ['Sicilian Defense: Najdorf Variation', 'Sicilian_Defense'],
    ['Italian Game', 'Italian_Game'],
    ["Queen's Gambit Declined: Exchange Variation", 'Queens_Gambit_Declined'],
    ['Ruy Lopez', 'Ruy_Lopez'],
    ['Caro-Kann Defense', 'Caro-Kann_Defense'],
    ['Réti Opening', 'Reti_Opening'],
    ['Bird Opening', 'Bird_Opening'],
    ["King's Indian Defense: Sämisch Variation", 'Kings_Indian_Defense'],
    ['Totally Made Up Opening XYZ', null],
    [null, null],
  ];
  for (const [name, expect] of cases) {
    const got = toAngleKey(name);
    check(`angle: ${name ?? 'null'} → ${expect ?? 'null'}`, got === expect, `got ${got ?? 'null'}`);
  }

  // Longest-prefix wins: the declined variation must not collapse to the bare key.
  check(
    'angle: QGD is more specific than QG',
    toAngleKey("Queen's Gambit Declined: Albin Countergambit") === 'Queens_Gambit_Declined',
    `got ${toAngleKey("Queen's Gambit Declined: Albin Countergambit")}`,
  );

  // hasPuzzles convenience.
  check('hasPuzzles: known opening', hasPuzzles('Sicilian Defense') === true);
  check('hasPuzzles: unknown opening', hasPuzzles('Totally Made Up Opening XYZ') === false);

  // openingAngles dedups and preserves order, dropping unmapped names.
  const angles = openingAngles([
    'Sicilian Defense: Najdorf',
    'Italian Game',
    'Sicilian Defense: Dragon', // same family — should dedup
    'Totally Made Up Opening XYZ', // unmapped — should drop
    null,
  ]);
  check(
    'openingAngles: dedup + order + drop',
    angles.length === 2 && angles[0] === 'Sicilian_Defense' && angles[1] === 'Italian_Game',
    `got [${angles.join(', ')}]`,
  );

  // ── Position replay ────────────────────────────────────────────────────────
  // Game: 1.e4 e5 2.Nf3 Nc6 (4 plies, white to move). Real puzzles set
  // initialPly to pgnPlies - 1 (the pgn is truncated to the puzzle), so the whole
  // pgn must be replayed. The opponent's setup move is Bc4 (f1c4); after it, black
  // is the solver.
  const p = makePuzzle({
    pgn: 'e4 e5 Nf3 Nc6',
    initialPly: 3,
    solution: ['f1c4', 'g8f6', 'b1c3'],
  });
  const setup = puzzleSetup(p);
  check('setup: builds', setup !== null);
  if (setup) {
    check('setup: fen is the pre-setup position (white to move)', / w /.test(setup.fen), setup.fen);
    check('setup: setupMove is solution[0]', setup.setupMove === 'f1c4');
    check('setup: solver plays the other colour', setup.solverColour === 'black', setup.solverColour);
  }

  // A nonsense setup move yields null rather than throwing.
  const bad = puzzleSetup(makePuzzle({ pgn: 'e4 e5', initialPly: 1, solution: ['a1a8'] }));
  check('setup: illegal setup move → null', bad === null);

  return results;
}
