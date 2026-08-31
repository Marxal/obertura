// The shared rest log's pure half: the key that collapses three exercises'
// ids onto one blunder, and the combined due-date lookup every picker takes.
//
// The store itself is localStorage, so it isn't exercised here — what is
// exercised is the thing that was actually broken, which is that Blunder
// detective, Which move and the mistake drill each had their own idea of what
// they had already asked you. All three pickers are fed one shared map below
// and must agree to leave the same blunder alone.

import { restKey, combinedDueAt } from './spot-rest';
import { pickSpots, type MistakeSpot, type SpotRef } from './mistake-scan';
import { pickWhichMove } from './which-move';
import { pickDetective, type DetectiveRef, type DetectiveSpot } from './detective';
import type { ImportedGame } from './import-core';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const NOW = 1_000_000;
const DAY = 24 * 60 * 60 * 1000;

function mkGame(id: string, endTime: number): ImportedGame {
  return {
    id, url: '', endTime,
    timeClass: 'blitz', timeControl: '300', rated: true,
    colour: 'white', result: 'loss', opponent: `opp-${id}`,
    eco: null, opening: null, sans: [], ucis: [], plyCount: 0,
  };
}

// A mistake spot that also makes a FAIR two-move question (which-move.ts):
// a clear best move that isn't the one played, and a wide gap either side.
function mkSpot(gameId: string, ply: number): SpotRef {
  const spot: MistakeSpot = {
    id: `${gameId}#${ply}`, ply, category: 'blunder',
    preFen: '', playedSan: 'Qxe8', playedUci: 'd1e8',
    best: [{ uci: 'g1f3', san: 'Nf3', cp: 0 }],
    evalBefore: 30, evalAfter: -400,
  };
  return { game: mkGame(gameId, 1000 + ply), spot };
}

function mkCase(gameId: string, ply: number, byUser = true): DetectiveRef {
  const spot: DetectiveSpot = {
    id: `${gameId}#d${ply}`, startPly: ply - 2, plies: 4, blunderPly: ply, byUser,
    preFen: '', playedSan: 'Qxe8', playedUci: 'd1e8',
    best: [{ uci: 'g1f3', san: 'Nf3', cp: 0 }],
    evalBefore: 30, evalAfter: -400,
  };
  return { game: mkGame(gameId, 1000 + ply), spot };
}

export function runSpotRestSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail: detail || (pass ? 'ok' : 'failed') });
  };

  // ── The key ────────────────────────────────────────────────────────────────
  check('a mistake spot id is already the shared key',
    restKey('abc123#14') === 'abc123#14', restKey('abc123#14'));
  check('a detective run collapses onto the same key',
    restKey('abc123#d14') === 'abc123#14', restKey('abc123#d14'));
  check('so does a brilliant find',
    restKey('abc123#b14') === 'abc123#14', restKey('abc123#b14'));
  check('two plies of one game stay apart',
    restKey('abc123#d14') !== restKey('abc123#d16'));
  check('two games stay apart',
    restKey('abc#14') !== restKey('abd#14'));
  check('a manual game id survives the round trip',
    restKey('manual-1712345#d7') === 'manual-1712345#7', restKey('manual-1712345#d7'));
  check('an id with no ply is passed through',
    restKey('nothing-like-an-id') === 'nothing-like-an-id');

  // ── The combined lookup ────────────────────────────────────────────────────
  {
    const own = { 'g#d4': NOW + 5 * DAY };
    const shared = { 'g#8': NOW + 2 * DAY };
    const dueAt = combinedDueAt(own, shared);
    check('the mode’s own rest still counts',
      dueAt('g#d4') === NOW + 5 * DAY, String(dueAt('g#d4')));
    check('a shared rest reaches an id the mode has never seen',
      dueAt('g#d8') === NOW + 2 * DAY, String(dueAt('g#d8')));
    check('untouched ids are available',
      dueAt('g#d12') === 0, String(dueAt('g#d12')));
    check('the longer of the two wins',
      combinedDueAt({ 'g#4': NOW + DAY }, { 'g#4': NOW + 9 * DAY })('g#4') === NOW + 9 * DAY);
  }

  // ── The bug: one blunder, three doors ──────────────────────────────────────
  //
  // Game "dup" ply 8 is the blunder that kept coming round. It is a detective
  // case, a two-move question and a mistake to fix all at once. Answer it in
  // one of them and the other two must deal something else.
  {
    const shared = { 'dup#8': NOW + DAY };

    const spots = [mkSpot('dup', 8), mkSpot('other', 8)];
    const dealtSpots = pickSpots(spots, null, 1, combinedDueAt({}, shared), NOW)
      .map(r => r.spot.id);
    check('the mistake drill skips a blunder answered elsewhere',
      dealtSpots[0] === 'other#8', dealtSpots.join(','));

    const dealtPairs = pickWhichMove(spots, 1, combinedDueAt({}, shared), NOW)
      .map(r => r.spot.id);
    check('Which move skips it too', dealtPairs[0] === 'other#8', dealtPairs.join(','));

    const cases = [mkCase('dup', 8), mkCase('other', 8, false)];
    const dealtCases = pickDetective(cases, 1, combinedDueAt({}, shared), NOW)
      .map(r => r.spot.id);
    check('and so does Blunder detective',
      dealtCases[0] === 'other#d8', dealtCases.join(','));
  }

  // ── …but a rest is never a removal ─────────────────────────────────────────
  {
    const shared = { 'only#8': NOW + DAY };
    const solo = [mkSpot('only', 8)];
    check('a resting spot is still dealt when it is all there is',
      pickSpots(solo, null, 2, combinedDueAt({}, shared), NOW).length === 1);
    check('a resting question is still dealt when it is all there is',
      pickWhichMove(solo, 2, combinedDueAt({}, shared), NOW).length === 1);
    check('a resting case is still dealt when it is all there is',
      pickDetective([mkCase('only', 8)], 2, combinedDueAt({}, shared), NOW).length === 1);
  }

  // ── An expired rest is no rest ─────────────────────────────────────────────
  {
    const shared = { 'dup#8': NOW - DAY };
    const spots = [mkSpot('dup', 8), mkSpot('other', 8)];
    const ids = pickSpots(spots, null, 2, combinedDueAt({}, shared), NOW).map(r => r.spot.id);
    check('yesterday’s rest does not hold today',
      ids.length === 2 && ids.includes('dup#8'), ids.join(','));
  }

  return results;
}
