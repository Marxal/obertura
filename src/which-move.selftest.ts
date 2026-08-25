// Pure checks of Which move's fairness rules and dealing order — no
// network, no engine, no storage. The whole point of which-move.ts is that a
// two-answer question must have an indefensible wrong answer, so most of what
// is checked here is what it REFUSES to ask.

import {
  isFairPair, fairPairs, pickWhichMove, readyWhichMoveCount, explainPair, MIN_GAP,
} from './which-move';
import type { MistakeSpot, SpotRef } from './mistake-scan';
import type { ImportedGame } from './import-core';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

function mkGame(id: string, endTime: number): ImportedGame {
  return {
    id, url: '', endTime,
    timeClass: 'blitz', timeControl: '300', rated: true,
    colour: 'white', result: 'loss', opponent: `opp-${id}`,
    eco: null, opening: null, sans: [], ucis: [], plyCount: 0,
  };
}

function mkRef(o: {
  id: string;
  gameId?: string;
  endTime?: number;
  preFen?: string;
  playedSan?: string;
  playedUci?: string;
  best?: { uci: string; san: string }[];
  before?: number;
  after?: number;
}): SpotRef {
  const spot: MistakeSpot = {
    id: o.id,
    ply: 20,
    category: 'blunder',
    preFen: o.preFen ?? '',
    playedSan: o.playedSan ?? 'Qxe8',
    playedUci: o.playedUci ?? 'd1e8',
    best: (o.best ?? [{ uci: 'g1f3', san: 'Nf3' }]).map(m => ({ ...m, cp: 0 })),
    evalBefore: o.before ?? 30,
    evalAfter: o.after ?? -400,
  };
  return { game: mkGame(o.gameId ?? o.id, o.endTime ?? 1), spot };
}

export function runWhichMoveSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail: detail || (pass ? 'ok' : 'failed') });
  };

  // ── Fairness ───────────────────────────────────────────────────────────────
  check('a clear blunder against a clear best move is fair',
    isFairPair(mkRef({ id: 'a' })));

  check('a spot with no engine move is never asked',
    !isFairPair(mkRef({ id: 'b', best: [] })));

  check('the two moves must differ',
    !isFairPair(mkRef({ id: 'c', playedUci: 'g1f3' })));

  check('the played move must not be one of the engine’s other picks',
    !isFairPair(mkRef({
      id: 'd',
      playedUci: 'd1e8',
      best: [{ uci: 'g1f3', san: 'Nf3' }, { uci: 'd1e8', san: 'Qxe8' }],
    })));

  check('a promotion is compared on the square, not the piece',
    !isFairPair(mkRef({
      id: 'e', playedUci: 'e7e8q', best: [{ uci: 'e7e8r', san: 'e8=R' }],
    })));

  {
    // A hair's-breadth difference is not a question anyone should be marked on.
    const close = mkRef({ id: 'f', before: 20, after: 0 });
    check('two near-equal moves are never asked', !isFairPair(close),
      `gap under ${MIN_GAP}`);
    const wide = mkRef({ id: 'g', before: 20, after: -300 });
    check('a real drop is asked', isFairPair(wide));
  }

  check('fairPairs keeps only the fair ones',
    fairPairs([mkRef({ id: 'h' }), mkRef({ id: 'i', best: [] })]).length === 1);

  // ── Dealing ───────────────────────────────────────────────────────────────
  {
    const refs = [
      mkRef({ id: 'g1#1', gameId: 'g1', endTime: 10 }),
      mkRef({ id: 'g1#2', gameId: 'g1', endTime: 10 }),
      mkRef({ id: 'g2#1', gameId: 'g2', endTime: 9 }),
      mkRef({ id: 'g3#1', gameId: 'g3', endTime: 8 }),
    ];
    const picked = pickWhichMove(refs, 3, () => 0, 1000);
    check('newest game leads', picked[0].spot.id === 'g1#1');
    const backToBack = picked.some((r, i) => i > 0 && picked[i - 1].game.id === r.game.id);
    check('never two questions from one game in a row', !backToBack,
      picked.map(r => r.game.id).join(','));

    const short = pickWhichMove(refs.slice(0, 2), 2, () => 0, 1000);
    check('a one-game pool still fills the session', short.length === 2);

    const due: Record<string, number> = { 'g1#1': 9000, 'g1#2': 9000 };
    const rested = pickWhichMove(refs, 4, id => due[id] ?? 0, 1000);
    check('answered questions sink to the back',
      rested.slice(0, 2).every(r => !due[r.spot.id]), rested.map(r => r.spot.id).join(','));
    check('the ready count skips the resting ones',
      readyWhichMoveCount(refs, id => due[id] ?? 0, 1000) === 2);
    check('an unfair spot never counts as ready',
      readyWhichMoveCount([...refs, mkRef({ id: 'junk', best: [] })], () => 0, 1000) === 4);
  }

  // ── The "why" under each answer ────────────────────────────────────────────
  //
  // Every clause has to be DERIVED. The one thing worse than a bare number is a
  // sentence that sounds authoritative and is made up.
  {
    // A hung queen, on a real board: after 1.e4 e5 2.Nf3, Black plays ...Qg5??
    // and Nxg5 simply takes it. The static exchange on g5 is what the clause
    // reads, so this is the fact, not an opinion.
    const afterNf3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
    const hang = explainPair(mkRef({
      id: 'hang',
      preFen: afterNf3,
      playedSan: 'Qg5', playedUci: 'd8g5',
      best: [{ uci: 'b8c6', san: 'Nc6' }],
      before: 20, after: -800,
    }).spot);
    check('a losing exchange is named, with its square',
      hang.played === 'hangs material on g5', hang.played);
    check('…and the engine’s move is credited with keeping it',
      hang.best === 'keeps the material', hang.best);

    // Mate scores are sentinels, not numbers to print.
    const mated = explainPair(mkRef({
      id: 'mated', before: 60, after: -100000,
    }).spot);
    check('walking into mate says so', mated.played === 'allows mate', mated.played);
    const mating = explainPair(mkRef({
      id: 'mating', before: 100000, after: -300,
    }).spot);
    check('a forced mate missed says so', mating.best === 'forces mate', mating.best);

    // No board and no material verdict: the clause falls back to the swing,
    // which is still something the stored evals actually say.
    const won = explainPair(mkRef({ id: 'won', before: 600, after: 0 }).spot);
    check('throwing away a won position is named',
      won.played === 'throws away a won position', won.played);
    check('…and the alternative kept you winning',
      won.best === 'keeps you winning', won.best);

    const level = explainPair(mkRef({ id: 'level', before: 10, after: -500 }).spot);
    check('a level position gone wrong says you are losing',
      level.played === 'leaves you losing', level.played);
    check('…and the engine’s move held the balance',
      level.best === 'holds the balance', level.best);

    check('a spot with no engine move says nothing about it',
      explainPair(mkRef({ id: 'none', best: [] }).spot).best === '');
    check('an unreadable position never crashes the clause',
      explainPair(mkRef({ id: 'nofen', preFen: 'not a fen' }).spot).played.length > 0);
  }

  return results;
}
