// Pro's scan sync: two devices must agree, and must stop pushing once they do.

import {
  buildScanPayload, canonical, mergeLogs, mergeRetry, parseScanPayload, planScanMerge,
  scanFingerprint, type ScanPayload,
} from './scan-sync-core';
import type { GameRetry, MistakeSpot } from './mistake-scan';

interface TestResult { name: string; pass: boolean; detail: string }

const spot = (id: string, over: Partial<MistakeSpot> = {}): MistakeSpot => ({
  id, ply: 4, category: 'blunder', preFen: 'x', playedSan: 'a', playedUci: 'a',
  best: [], evalBefore: 0, evalAfter: 0, ...over,
});
const retry = (scannedAt: number, spots: MistakeSpot[], version = 2): GameRetry =>
  ({ scannedAt, version, spots, trail: [] });
const game = (id: string, r?: GameRetry) => ({ id, endTime: 1000, ...(r ? { retry: r } : {}) });
const payload = (games: Record<string, GameRetry>, resetAt = 0): ScanPayload =>
  ({ v: 1, resetAt, games, logs: {} });

export function runScanSyncSelfTest(): TestResult[] {
  const out: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => { out.push({ name, pass, detail }); };

  check('key order doesn’t change the text', canonical({ a: 1, b: 2 }) === canonical({ b: 2, a: 1 }));

  // ── Merging one game ──────────────────────────────────────────────────────
  const fixedHere = retry(100, [spot('s', { fixed: true, attempts: 2, lastTrained: 50 })]);
  const newerThere = retry(200, [spot('s', { attempts: 1, lastTrained: 70 })]);
  const merged = mergeRetry(fixedHere, newerThere)!;
  check('a fix on either device counts', merged.spots[0].fixed === true);
  check('attempts take the higher', merged.spots[0].attempts === 2);
  check('the later training date wins', merged.spots[0].lastTrained === 70);
  check('the later scan is the base', merged.scannedAt === 200);
  check('newer rules beat a later scan',
    mergeRetry(retry(900, [], 1), retry(100, [], 2))!.version === 2);
  check('both directions give the same answer',
    canonical(mergeRetry(fixedHere, newerThere)) === canonical(mergeRetry(newerThere, fixedHere)));
  check('merging twice changes nothing',
    canonical(mergeRetry(merged, newerThere)) === canonical(merged));
  check('results for a game only one side has are kept',
    mergeRetry(undefined, newerThere)!.scannedAt === 200 && mergeRetry(fixedHere, undefined)!.scannedAt === 100);

  // ── A new device takes everything and owes nothing ────────────────────────
  const account = payload({ g1: fixedHere });
  const fresh = planScanMerge([game('g1')], {}, 0, account);
  check('a new device takes the account’s results', fresh.changed[0]?.retry?.spots[0].fixed === true);
  check('and owes no push for them', fresh.ahead === false);

  // ── Local work is owed, and settles ───────────────────────────────────────
  const localOnly = planScanMerge([game('g1', fixedHere), game('g2', newerThere)], {}, 0, account);
  check('a game scanned only here is owed', localOnly.ahead === true);
  const inStep = planScanMerge(
    [game('g1', fixedHere)], {}, 0,
    JSON.parse(JSON.stringify(account)) as ScanPayload,
  );
  check('identical copies change nothing', inStep.changed.length === 0 && inStep.ahead === false);

  // ── THE PING-PONG. Fewer games on this device must not start a fight. ─────
  const moreOnAccount = payload({ g1: fixedHere, other: newerThere });
  const fewer = planScanMerge([game('g1', fixedHere)], {}, 0, moreOnAccount);
  check('fewer games here is not "ahead"', fewer.ahead === false);
  check('and is noted, so results can be taken when the game arrives', fewer.unknownGames === true);

  // ── A reset holds ─────────────────────────────────────────────────────────
  const trained = retry(100, [spot('s', { fixed: true, attempts: 3, lastTrained: 500 })]);
  const afterReset = planScanMerge([game('g1', trained)], {}, 0, payload({}, 600));
  const cleared = afterReset.changed[0]?.retry?.spots[0];
  check('a reset elsewhere clears old progress here', cleared !== undefined && !cleared.fixed && !cleared.attempts);
  const trainedAfter = retry(100, [spot('s', { fixed: true, lastTrained: 700 })]);
  check('progress made after the reset survives',
    planScanMerge([game('g1', trainedAfter)], {}, 0, payload({}, 600)).changed.length === 0);
  const staleAccount = planScanMerge([game('g1')], {}, 600, payload({ g1: trained }));
  check('an old copy can’t bring back progress reset here',
    !staleAccount.changed[0]?.retry?.spots[0].fixed);
  check('and this device owes the reset', staleAccount.ahead === true);

  // ── Rest logs ─────────────────────────────────────────────────────────────
  const logs = mergeLogs(
    { 'obertura.spotRest': { a: 10, b: 50 }, 'obertura.detectiveLog': { c: { due: 5, step: 1 } } },
    { 'obertura.spotRest': { a: 30, b: 20 }, 'obertura.detectiveLog': { c: { due: 9, step: 0 } } },
  );
  check('the later rest wins', logs['obertura.spotRest'].a === 30 && logs['obertura.spotRest'].b === 50);
  check('ladder records compare by date',
    (logs['obertura.detectiveLog'].c as { due: number }).due === 9);
  const big = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i]));
  const trimmed = mergeLogs({ 'obertura.spotRest': big }, {})['obertura.spotRest'];
  check('a log stays within its cap', Object.keys(trimmed).length === 400 && trimmed.k499 === 499);
  check('unknown keys don’t travel', !('obertura.other' in mergeLogs({ 'obertura.other': { a: 1 } }, {})));
  const logsLocal = planScanMerge([], { 'obertura.spotRest': { a: 5 } }, 0, payload({}));
  check('a log entry only here is owed', logsLocal.ahead === true);

  // ── Payload ───────────────────────────────────────────────────────────────
  const built = buildScanPayload(
    [game('g1', fixedHere), game('g2'), { id: 'g3', endTime: 1, retry: newerThere }], {}, 0,
  );
  check('only scanned games go up', Object.keys(built.games).join() === 'g1,g3');
  const many = Array.from({ length: 600 }, (_, i) => game(`m${i}`, retry(1, [])));
  check('only the games the account syncs go up',
    Object.keys(buildScanPayload(many, {}, 0).games).length === 500);
  check('the fingerprint ignores key order',
    scanFingerprint(payload({ a: fixedHere })) === scanFingerprint(
      JSON.parse(canonical(payload({ a: fixedHere }))) as ScanPayload));
  check('a foreign value is refused', parseScanPayload({ v: 2, games: {} }) === null && parseScanPayload('x') === null);
  check('a real payload is read', parseScanPayload(account)?.games.g1 !== undefined);

  return out;
}
