// Pure checks of Which move's fairness rules and dealing order — no
// network, no engine, no storage. The whole point of which-move.ts is that a
// two-answer question must have an indefensible wrong answer, so most of what
// is checked here is what it REFUSES to ask.

import { isFairPair, fairPairs, pickWhichMove, readyWhichMoveCount, MIN_GAP } from './which-move';
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
  playedUci?: string;
  best?: { uci: string; san: string }[];
  before?: number;
  after?: number;
}): SpotRef {
  const spot: MistakeSpot = {
    id: o.id,
    ply: 20,
    category: 'blunder',
    preFen: '',
    playedSan: 'Qxe8',
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

  return results;
}
