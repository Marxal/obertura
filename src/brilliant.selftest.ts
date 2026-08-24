// Pure checks of the Brilliant-moves exercise source — no DOM, no engine, no
// storage. Builds games with synthetic analysis trees and checks that only YOUR
// brilliant/great moves are pulled out, the auto-tag fires only on a brilliant,
// and the session picking/latest order is right.

import { Chess } from 'chess.js';
import {
  gameBrilliantSpots,
  gameFinds,
  candidatePlies,
  hasUserBrilliant,
  applyBrilliantTag,
  collectBrilliantSpots,
  pickBrilliantSpots,
  latestBrilliant,
  orderBrilliant,
  BRILLIANT_TAG,
} from './brilliant';
import type { ImportedGame } from './import-core';
import type { MoveNode } from './tree';
import type { MoveClass } from './winprob';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Build a mainline-only analysis tree from a list of per-ply grades. Fens are
// placeholders ("fen0", "fen1", …) — gameBrilliantSpots only threads them, never
// parses them, so the preFen check still means something.
function mkTree(plies: (MoveClass | undefined)[]): MoveNode {
  const root: MoveNode = { id: 'root', san: '', uci: '', fen: START_FEN, children: [] };
  let cursor = root;
  plies.forEach((cls, i) => {
    const node: MoveNode = {
      id: `n${i}`,
      san: `m${i}`,
      uci: `u${i}`,
      fen: `fen${i}`,
      children: [],
      ...(cls ? { classification: cls } : {}),
    };
    cursor.children = [node];
    cursor = node;
  });
  return root;
}

function mkGame(id: string, endTime: number, colour: 'white' | 'black', plies: (MoveClass | undefined)[], analysed = true): ImportedGame {
  return {
    id, url: '', endTime,
    timeClass: 'blitz', timeControl: '300', rated: true,
    colour, result: 'win', opponent: `opp-${id}`,
    eco: null, opening: null, sans: [], ucis: [], plyCount: plies.length,
    ...(analysed ? { analysis: { tree: mkTree(plies), engine: 'lichess', reviewedAt: 1 } } : {}),
  };
}

export function runBrilliantSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  // ── gameBrilliantSpots: only YOUR brilliant/great moves ─────────────────────
  // White: ply 0 great, ply 1 (Black) brilliant → ignored, ply 2 brilliant.
  const g = mkGame('g', 100, 'white', ['great', 'brilliant', 'brilliant', 'mistake']);
  const spots = gameBrilliantSpots(g);
  check('picks only the user side', spots.length === 2, JSON.stringify(spots.map(s => s.ply)));
  check('ply 0 is the great move', spots[0]?.cls === 'great' && spots[0]?.ply === 0);
  check('ply 2 is the brilliant move', spots[1]?.cls === 'brilliant' && spots[1]?.ply === 2);
  check('first move preFen is the start position', spots[0]?.preFen === START_FEN, spots[0]?.preFen);
  check('later move preFen is the prior node fen', spots[1]?.preFen === 'fen1', spots[1]?.preFen);
  check('played move carries san + uci', spots[1]?.playedSan === 'm2' && spots[1]?.playedUci === 'u2');

  // Black's brilliancies: parity flips to odd plies.
  const gb = mkGame('gb', 100, 'black', ['brilliant', 'brilliant', undefined, 'great']);
  const bspots = gameBrilliantSpots(gb);
  check('black picks odd plies only', bspots.length === 2 && bspots[0].ply === 1 && bspots[1].ply === 3,
    JSON.stringify(bspots.map(s => s.ply)));

  // An unanalysed game yields nothing.
  check('no analysis → no spots', gameBrilliantSpots(mkGame('x', 1, 'white', ['brilliant'], false)).length === 0);

  // ── the auto-tag ────────────────────────────────────────────────────────────
  check('hasUserBrilliant true when you played one', hasUserBrilliant(g));
  check('great alone is not enough to tag',
    !hasUserBrilliant(mkGame('gg', 1, 'white', ['great', undefined])));
  check("opponent's brilliancy doesn't tag you",
    !hasUserBrilliant(mkGame('go', 1, 'white', [undefined, 'brilliant'])));

  const tagGame = mkGame('t', 1, 'white', ['brilliant']);
  check('applyBrilliantTag adds the tag', applyBrilliantTag(tagGame) && tagGame.tags?.includes(BRILLIANT_TAG) === true);
  check('applyBrilliantTag is idempotent', applyBrilliantTag(tagGame) === false && tagGame.tags?.length === 1);
  const noTag = mkGame('n', 1, 'white', ['great']);
  check('no brilliant → no tag added', applyBrilliantTag(noTag) === false && (noTag.tags ?? []).length === 0);
  const keepTag = mkGame('k', 1, 'white', ['brilliant']);
  keepTag.tags = ['mine'];
  applyBrilliantTag(keepTag);
  check('applyBrilliantTag keeps existing tags', keepTag.tags?.includes('mine') === true && keepTag.tags?.includes(BRILLIANT_TAG) === true);

  // ── collect + pick + latest ─────────────────────────────────────────────────
  const older = mkGame('old', 10, 'white', ['great']);
  const newer = mkGame('new', 20, 'white', ['brilliant', undefined, 'brilliant']);
  const all = collectBrilliantSpots([older, newer]);
  check('collect flattens every game', all.length === 3, String(all.length));

  const picked = pickBrilliantSpots(all, 2);
  check('pick puts brilliancies first', picked.every(r => r.spot.cls === 'brilliant'),
    JSON.stringify(picked.map(r => r.spot.cls)));

  const latest = latestBrilliant(all);
  check('latest is from the newest game', latest?.game.id === 'new', latest?.game.id);
  check('latestBrilliant null on empty', latestBrilliant([]) === null);

  // ── orderBrilliant: loop, resting solved gems ───────────────────────────────
  const now = 1_000_000;
  // Nothing suppressed → brilliancies lead (both from 'new'), then the great.
  const openOrder = orderBrilliant(all, () => 0, now);
  check('order leads with brilliancies', openOrder[0].spot.cls === 'brilliant' && openOrder[1].spot.cls === 'brilliant',
    JSON.stringify(openOrder.map(r => r.spot.cls)));
  check('order sinks the great last', openOrder[2].spot.cls === 'great');

  // Rest both brilliancies (the 'new' spots) → the available great leads instead.
  const suppressed = new Set(['new#b0', 'new#b2']);
  const restOrder = orderBrilliant(all, id => suppressed.has(id) ? now + 5000 : 0, now);
  check('order surfaces the still-available find first', restOrder[0].game.id === 'old' && restOrder[0].spot.cls === 'great',
    restOrder[0].spot.id);

  // All rested → the one coming back soonest leads.
  const dueById: Record<string, number> = { 'new#b0': now + 300, 'new#b2': now + 100, 'old#b0': now + 200 };
  const allRested = orderBrilliant(all, id => dueById[id] ?? 0, now);
  check('all rested → soonest-back leads', allRested[0].spot.id === 'new#b2', allRested[0].spot.id);

  // ── gameFinds: the two sources, merged ─────────────────────────────────────
  {
    const g = mkGame('both', 10, 'white', ['brilliant', undefined, undefined]);
    g.retry = {
      scannedAt: 1, version: 2, spots: [],
      brilliant: [
        // The same move the analysis already graded — must not appear twice.
        { id: 'both#b0', ply: 0, cls: 'great', preFen: 'x', playedSan: 'a', playedUci: 'a1a2' },
        { id: 'both#b2', ply: 2, cls: 'brilliant', preFen: 'y', playedSan: 'b', playedUci: 'b1b2' },
      ],
    };
    const finds = gameFinds(g);
    check('both sources are read', finds.length === 2, JSON.stringify(finds.map(f => f.id)));
    check('the same move is never listed twice',
      finds.filter(f => f.id === 'both#b0').length === 1);
    check('the analysis grade wins on a clash',
      finds.find(f => f.id === 'both#b0')?.cls === 'brilliant');
    check('a scan find earns the auto-tag', hasUserBrilliant(g));

    const scanOnly = mkGame('scan', 11, 'white', [], false);
    scanOnly.retry = {
      scannedAt: 1, version: 2, spots: [],
      brilliant: [{ id: 'scan#b4', ply: 4, cls: 'brilliant', preFen: 'z', playedSan: 'c', playedUci: 'c1c2' }],
    };
    check('a game with no saved analysis still has its finds',
      gameFinds(scanOnly).length === 1);
    check('…and they reach the exercise',
      collectBrilliantSpots([scanOnly]).length === 1);
  }

  // ── candidatePlies: which sacrifices are worth an engine look ──────────────
  {
    // 6.Nxf7 in the Fried Liver — a real sacrifice (knight for a pawn, king
    // recaptures) at ply 10, played by White.
    const SANS = ['e4','e5','Nf3','Nc6','Bc4','Nf6','Ng5','d5','exd5','Nxd5','Nxf7'];
    const ch = new Chess();
    const fens = [ch.fen()];
    const ucis: string[] = [];
    for (const san of SANS) {
      const m = ch.move(san);
      ucis.push(m.from + m.to + (m.promotion ?? ''));
      fens.push(ch.fen());
    }
    const level = (): (number | null)[] => new Array(SANS.length + 1).fill(0);

    const cands = candidatePlies({ colour: 'white', fens, ucis, trail: level() });
    check('a real sacrifice is a candidate',
      cands.length === 1 && cands[0].ply === 10, JSON.stringify(cands));
    check('and it knows what was given up', (cands[0]?.given ?? 0) >= 2, String(cands[0]?.given));

    const tanked = level();
    tanked[11] = -600; // the sacrifice simply lost material
    check('a piece merely hung is not a candidate',
      candidatePlies({ colour: 'white', fens, ucis, trail: tanked }).length === 0);

    const won = level();
    for (let i = 0; i <= 10; i++) won[i] = 900; // already completely winning
    check('a sacrifice from a won position is not a candidate',
      candidatePlies({ colour: 'white', fens, ucis, trail: won }).length === 0);

    check('the other side’s moves are never candidates',
      candidatePlies({ colour: 'black', fens, ucis, trail: level() }).length === 0);

    const gap = level();
    gap[11] = null; // the scan couldn't evaluate the position after it
    check('an unevaluated ply is skipped, not guessed',
      candidatePlies({ colour: 'white', fens, ucis, trail: gap }).length === 0);

    check('maxPly stops the walk',
      candidatePlies({ colour: 'white', fens, ucis, trail: level(), maxPly: 8 }).length === 0);
  }

  return results;
}
