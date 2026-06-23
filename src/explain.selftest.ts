import { explainMove } from './explain';

// Pure checks of the explanation templating — no network. The signal-gathering
// (gatherExplainSignals) hits Lichess and isn't exercised here.

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

export function runExplainSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  // Main, popular, engine-best move with a decent sample → opening, "main move",
  // a score, and "top choice".
  const main = explainMove({
    san: 'Nf3',
    colour: 'white',
    openingName: 'Italian Game',
    popularity: { share: 0.62, rank: 1, scorePct: 54, games: 5000 },
    evalSig: { isBest: true, withinTop: true, onlyMove: false, cpAfter: 35 },
  });
  check(
    'main line: opening + popularity + score + engine',
    /Italian Game/.test(main) && /main move/.test(main) && /62%/.test(main) &&
      /54% for White/.test(main) && /top choice/i.test(main),
    main,
  );

  // The only move.
  const only = explainMove({
    san: 'Qxe5',
    colour: 'black',
    openingName: null,
    popularity: null,
    evalSig: { isBest: true, withinTop: true, onlyMove: true },
  });
  check('only move phrasing', /only move/i.test(only), only);

  // A rare sideline the engine dislikes.
  const side = explainMove({
    san: 'a6',
    colour: 'white',
    openingName: 'Bird Opening',
    popularity: { share: 0.02, rank: 7, scorePct: 41, games: 30 },
    evalSig: { isBest: false, withinTop: false, onlyMove: false, deltaToBestCp: 130 },
  });
  check(
    'rare sideline: no score (thin sample) + engine prefers another',
    /rare sideline/i.test(side) && /2%/.test(side) && !/scoring/.test(side) &&
      /prefers another move/.test(side) && /1\.3/.test(side),
    side,
  );

  // A sound alternative within the top.
  const alt = explainMove({
    san: 'Bb5',
    colour: 'white',
    openingName: null,
    popularity: null,
    evalSig: { isBest: false, withinTop: true, onlyMove: false, deltaToBestCp: 20 },
  });
  check('sound alternative within top', /sound option/i.test(alt) && /0\.2/.test(alt), alt);

  // Mate seen.
  const mate = explainMove({
    san: 'Qh7#',
    colour: 'white',
    openingName: null,
    popularity: null,
    evalSig: { isBest: true, withinTop: true, onlyMove: false, mateAfter: 1 },
  });
  check('mate phrasing', /mate in 1/i.test(mate), mate);

  // Nothing at all → honest fallback.
  const none = explainMove({ san: 'h3', colour: 'white', openingName: null, popularity: null, evalSig: null });
  check('empty signals → fallback', /No opening-database or engine data/.test(none), none);

  return results;
}
