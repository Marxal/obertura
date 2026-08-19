// A runnable check of the account-sync module's pure parts, no test framework —
// same spirit as the other *.selftest.ts files. Supabase, auth and IndexedDB
// can't run headless, so this covers the three pieces that CAN go quietly wrong
// and that no amount of tapping around on a phone would reveal:
//
//   • the status flag precedence (syncStateFrom) — a wrong order here doesn't
//     crash, it just tells the user a comforting lie about whether their data is
//     safe, which is the worst possible failure for this feature;
//   • reassembling the two columns (combineRemote), including the migration case
//     where an older row still carries its games inside the core blob;
//   • the change fingerprint (fingerprint / coreFingerprintOf) — in particular
//     that it ignores `exportedAt`, since if it didn't, the "don't re-upload
//     unchanged data" skip would never once fire;
//   • the synced games' diet (gamesForSync) — that the derived engine output is
//     really gone, that the 500-game cap keeps the RIGHT games, and above all
//     that the fingerprint is taken over the slimmed payload, because a
//     fingerprint that still noticed a saved analysis would re-upload the whole
//     library after every scan and undo the point of the diet entirely.
//
// Run via `npm run selftest`.

import type { TestResult } from './selftest-panel';
import {
  syncStateFrom,
  combineRemote,
  fingerprint,
  coreFingerprintOf,
  gamesFingerprintOf,
  gamesForSync,
  partsToPull,
  anyPart,
  shouldApplyRemoteLocal,
  payloadBytes,
  SYNC_GAME_LIMIT,
  type SyncFlags,
} from './sync-core';
import {
  parseBackup,
  localKeyPart,
  partsInBackup,
  describeBackup,
  type BackupFile,
} from './storage';
import type { Line } from './types';

// A signed-in device that has reconciled and pushed successfully — the baseline
// each state case below perturbs by exactly one field.
const SETTLED: SyncFlags = {
  configured: true,
  userId: 'user-1',
  claimedAccount: 'user-1',
  failed: false,
  pending: false,
  lastSync: '2026-08-09T10:00:00.000Z',
};

function line(id: string): Line {
  return {
    id,
    name: 'Italian Game',
    tags: [],
    colour: 'white',
    openingName: null,
    confidence: 0,
    lastTrained: null,
    inTraining: true,
    tree: { id: 'root', san: '', uci: '', fen: 'startpos', children: [] },
  };
}

function coreBlob(overrides: Partial<BackupFile> = {}): BackupFile {
  return {
    format: 'obertura-backup',
    version: 2,
    exportedAt: '2026-08-09T10:00:00.000Z',
    lines: [line('a')],
    local: { 'obertura.puzzleRating': '1500' },
    ...overrides,
  };
}

// The derived extras the diet drops: engine output, stapled onto a game by the
// analyser and the mistake scan.
const ANALYSIS = {
  tree: { id: 'root', san: '', uci: '', fen: 'startpos', children: [] },
  engine: 'local',
  reviewedAt: 1,
};
const RETRY = {
  scannedAt: 1,
  version: 1,
  spots: [
    {
      id: 'g1#12',
      ply: 12,
      category: 'blunder',
      preFen: 'startpos',
      playedSan: 'Bxf7+',
      playedUci: 'c4f7',
      best: [],
      evalBefore: 40,
      evalAfter: -300,
      fixed: true,
      attempts: 3,
    },
  ],
};
// The endgame scan, by contrast, STAYS — it's ~1% of the payload.
const ENDGAME = {
  scannedAt: 1,
  version: 2,
  spots: [{ ply: 70, fen: 'startpos', youPlay: 'white', outcome: 'win', converted: false }],
};

// One stored game, with whatever extras a case needs bolted on.
function gameRow(id: string, endTime: number, extras: Record<string, unknown> = {}) {
  return {
    id,
    endTime,
    url: `https://example.test/${id}`,
    colour: 'white',
    result: 'win',
    opponent: 'someone',
    sans: ['e4', 'e5'],
    ucis: ['e2e4', 'e7e5'],
    plyCount: 2,
    ...extras,
  };
}

// A library of `n` games, newest last (IndexedDB hands them back in id order,
// not date order — which is exactly why gamesForSync sorts).
function library(n: number, extras: (i: number) => Record<string, unknown> = () => ({})) {
  return Array.from({ length: n }, (_, i) =>
    gameRow(`g${String(i).padStart(4, '0')}`, 1_700_000_000 + i * 3600, extras(i)),
  );
}

export function runRepertoireSyncSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // ── Flag precedence ────────────────────────────────────────────────────────

  check(
    'a settled device reads as synced',
    syncStateFrom(SETTLED) === 'synced',
    syncStateFrom(SETTLED),
  );
  check(
    'an unconfigured build is off even with a user and a claim',
    syncStateFrom({ ...SETTLED, configured: false }) === 'off',
    syncStateFrom({ ...SETTLED, configured: false }),
  );
  check(
    'signed out is off, whatever the flags say',
    syncStateFrom({ ...SETTLED, userId: null, pending: true, failed: true }) === 'off',
    syncStateFrom({ ...SETTLED, userId: null, pending: true, failed: true }),
  );
  check(
    'failed outranks pending',
    syncStateFrom({ ...SETTLED, failed: true, pending: true }) === 'failed',
    syncStateFrom({ ...SETTLED, failed: true, pending: true }),
  );
  // The case the precedence exists for: a first sign-in that couldn't reach
  // Supabase must SAY it failed, not sit there looking like it hasn't got round
  // to it yet.
  check(
    'a failed first sign-in reads as failed, not never',
    syncStateFrom({ ...SETTLED, claimedAccount: null, lastSync: null, failed: true }) === 'failed',
    syncStateFrom({ ...SETTLED, claimedAccount: null, lastSync: null, failed: true }),
  );
  check(
    'pending outranks an unreconciled account',
    syncStateFrom({ ...SETTLED, claimedAccount: null, lastSync: null, pending: true }) === 'pending',
    syncStateFrom({ ...SETTLED, claimedAccount: null, lastSync: null, pending: true }),
  );
  check(
    'a fresh sign-in with nothing up yet is never',
    syncStateFrom({ ...SETTLED, claimedAccount: null, lastSync: null }) === 'never',
    syncStateFrom({ ...SETTLED, claimedAccount: null, lastSync: null }),
  );
  // Switching accounts must not inherit the previous account's "synced".
  check(
    'a claim for a different user is never, not synced',
    syncStateFrom({ ...SETTLED, claimedAccount: 'user-2' }) === 'never',
    syncStateFrom({ ...SETTLED, claimedAccount: 'user-2' }),
  );
  check(
    'claimed but never pushed is never, not synced',
    syncStateFrom({ ...SETTLED, lastSync: null }) === 'never',
    syncStateFrom({ ...SETTLED, lastSync: null }),
  );

  // ── Reassembling the two columns ───────────────────────────────────────────

  check(
    'an empty account yields null (nothing to restore)',
    combineRemote(null, null) === null && combineRemote(undefined, undefined) === null,
    'null and undefined both mean "no copy yet"',
  );

  const split = combineRemote(coreBlob(), [{ id: 'g1' }, { id: 'g2' }]);
  const splitParsed = split ? parseBackup(split) : null;
  check(
    'core + games columns reassemble into one valid backup',
    splitParsed?.lines?.length === 1 && splitParsed?.games?.length === 2,
    `${splitParsed?.lines?.length ?? 0} line(s), ${splitParsed?.games?.length ?? 0} game(s)`,
  );
  check(
    'the app-state snapshot survives reassembly',
    splitParsed?.local?.['obertura.puzzleRating'] === '1500',
    splitParsed?.local?.['obertura.puzzleRating'] ?? '(missing)',
  );

  // The migration case: a row written before the split has its games INSIDE the
  // core blob and nothing in the games column. Those games must survive.
  const legacy = combineRemote(coreBlob({ games: [{ id: 'old1' }, { id: 'old2' }] } as Partial<BackupFile>), null);
  const legacyParsed = legacy ? parseBackup(legacy) : null;
  check(
    'a pre-split row keeps the games stored inside its blob',
    legacyParsed?.games?.length === 2,
    `${legacyParsed?.games?.length ?? 0} game(s) recovered`,
  );
  // And once the games column is populated it wins, so the first post-migration
  // push actually takes effect instead of being shadowed by the stale copy.
  const upgraded = combineRemote(
    coreBlob({ games: [{ id: 'stale' }] } as Partial<BackupFile>),
    [{ id: 'fresh1' }, { id: 'fresh2' }, { id: 'fresh3' }],
  );
  const upgradedParsed = upgraded ? parseBackup(upgraded) : null;
  check(
    'the games column overrides a stale copy left in the blob',
    upgradedParsed?.games?.length === 3 && upgradedParsed?.games?.[0]?.id === 'fresh1',
    `${upgradedParsed?.games?.length ?? 0} game(s), first is ${upgradedParsed?.games?.[0]?.id ?? '(none)'}`,
  );
  check(
    'an empty games column leaves a games-free blob games-free',
    (() => {
      const text = combineRemote(coreBlob(), []);
      return text !== null && parseBackup(text).games === undefined;
    })(),
    'no phantom empty games array',
  );
  check(
    'a jsonb value handed back as a string still reassembles',
    (() => {
      const text = combineRemote(JSON.stringify(coreBlob()), [{ id: 'g1' }]);
      return text !== null && parseBackup(text).games?.length === 1;
    })(),
    'string core parsed, games spliced in',
  );
  check(
    'a non-JSON core is passed through for parseBackup to reject',
    (() => {
      const text = combineRemote('not json at all', null);
      if (text === null) return false;
      try {
        parseBackup(text);
        return false; // should have thrown
      } catch {
        return true;
      }
    })(),
    'garbage reaches the friendly validator rather than throwing here',
  );

  // ── Change fingerprint ────────────────────────────────────────────────────

  check(
    'the same text fingerprints the same',
    fingerprint('abc') === fingerprint('abc'),
    fingerprint('abc'),
  );
  check(
    'different text fingerprints differently',
    fingerprint('abc') !== fingerprint('abd'),
    `${fingerprint('abc')} vs ${fingerprint('abd')}`,
  );
  // Transposition is what a weak single hash misses, and it's exactly what a
  // reordered lines array looks like.
  check(
    'transposed content fingerprints differently',
    fingerprint('ab') !== fingerprint('ba'),
    `${fingerprint('ab')} vs ${fingerprint('ba')}`,
  );
  check(
    'the empty string has a fingerprint (no crash, no special case)',
    typeof fingerprint('') === 'string' && fingerprint('') !== fingerprint('a'),
    fingerprint(''),
  );

  // THE one that matters for the skip working at all: exportBackup restamps
  // exportedAt on every call, so a fingerprint that noticed it would report
  // "changed" every single time and no push would ever be skipped.
  check(
    'the core fingerprint ignores exportedAt',
    coreFingerprintOf(coreBlob()) ===
      coreFingerprintOf(coreBlob({ exportedAt: '2027-01-01T00:00:00.000Z' })),
    'restamping the export time alone is not a change',
  );
  check(
    'the core fingerprint notices a changed line',
    coreFingerprintOf(coreBlob()) !== coreFingerprintOf(coreBlob({ lines: [line('b')] })),
    'a different line id is a change',
  );
  check(
    'the core fingerprint notices a changed app-state snapshot',
    coreFingerprintOf(coreBlob()) !==
      coreFingerprintOf(coreBlob({ local: { 'obertura.puzzleRating': '1600' } })),
    'a new puzzle rating is a change',
  );
  check(
    'the core fingerprint notices a dropped snapshot',
    coreFingerprintOf(coreBlob()) !== coreFingerprintOf(coreBlob({ local: undefined })),
    'losing the snapshot is a change, not a no-op',
  );
  // The games half is fingerprinted over the array alone; an added game must
  // register or an import would never reach the account.
  check(
    'the games fingerprint notices an added game',
    gamesFingerprintOf([{ id: 'g1' }]) !== gamesFingerprintOf([{ id: 'g1' }, { id: 'g2' }]),
    'importing a game is a change',
  );
  check(
    'an empty games library fingerprints stably',
    gamesFingerprintOf([]) === gamesFingerprintOf([]) &&
      gamesFingerprintOf([]) !== gamesFingerprintOf([{ id: 'g1' }]),
    gamesFingerprintOf([]),
  );

  // ── The synced games' diet ────────────────────────────────────────────────

  const fat = gameRow('g1', 1_700_000_000, { analysis: ANALYSIS, retry: RETRY, endgame: ENDGAME, tags: ['sharp'] });
  const [slim] = gamesForSync([fat]) as Record<string, unknown>[];

  check(
    'a saved analysis is stripped from the synced copy',
    !('analysis' in slim),
    'analysis is derived — the engine can rebuild it from the moves',
  );
  check(
    'a mistake scan is stripped from the synced copy',
    !('retry' in slim),
    'retry spots are derived too',
  );
  check(
    'the endgame scan and the game itself survive',
    'endgame' in slim &&
      (slim.tags as string[])?.[0] === 'sharp' &&
      (slim.sans as string[])?.length === 2 &&
      slim.opponent === 'someone',
    'only the two heavy derived fields go — nothing else',
  );
  check(
    'stripping does not mutate the stored game',
    'analysis' in fat && 'retry' in fat,
    'the device keeps its analyses; only the upload loses them',
  );
  check(
    'a game with no extras is passed through untouched',
    gamesForSync([gameRow('g1', 1)])[0] !== undefined &&
      JSON.stringify(gamesForSync([gameRow('g1', 1)])[0]) === JSON.stringify(gameRow('g1', 1)),
    'no gratuitous copying for the common case',
  );

  // The cap keeps the RECENT games — dropping the wrong end would sync a
  // decade-old archive and leave last week's play behind.
  const many = gamesForSync(library(SYNC_GAME_LIMIT + 120)) as Record<string, unknown>[];
  check(
    `the synced games are capped at ${SYNC_GAME_LIMIT}`,
    many.length === SYNC_GAME_LIMIT,
    `${SYNC_GAME_LIMIT + 120} games in, ${many.length} out`,
  );
  check(
    'the cap keeps the newest games, not the first ones stored',
    many[0]?.id === 'g0619' && many[many.length - 1]?.id === 'g0120',
    `newest kept: ${String(many[0]?.id)}, oldest kept: ${String(many[many.length - 1]?.id)}`,
  );

  // Order has to be a function of the CONTENT, not of the order IndexedDB
  // happened to hand things back in — otherwise the fingerprint changes for no
  // reason and every push re-uploads an unchanged library.
  check(
    'the same library in a different order fingerprints the same',
    gamesFingerprintOf(library(20)) === gamesFingerprintOf([...library(20)].reverse()),
    'sorted newest-first before hashing',
  );
  check(
    'games sharing a timestamp still sort deterministically',
    gamesFingerprintOf([gameRow('b', 5), gameRow('a', 5)]) ===
      gamesFingerprintOf([gameRow('a', 5), gameRow('b', 5)]),
    'the id tiebreak settles it',
  );
  check(
    'slimming is idempotent',
    JSON.stringify(gamesForSync(gamesForSync(library(5, () => ({ analysis: ANALYSIS }))))) ===
      JSON.stringify(gamesForSync(library(5, () => ({ analysis: ANALYSIS })))),
    'so a downloaded copy and a local library agree',
  );

  // ── The fingerprint after the diet ────────────────────────────────────────
  //
  // THE test of this whole round. Analysing a game rewrites it in IndexedDB and
  // fires the games notifier, but changes nothing that syncs. If the fingerprint
  // noticed, every analysis would re-upload the entire games column.
  const plain = library(30);
  check(
    'saving an analysis does not change the games fingerprint',
    gamesFingerprintOf(plain) ===
      gamesFingerprintOf(library(30, (i) => (i === 3 ? { analysis: ANALYSIS } : {}))),
    'the push is skipped, as it should be',
  );
  check(
    'a mistake scan does not change the games fingerprint either',
    gamesFingerprintOf(plain) ===
      gamesFingerprintOf(library(30, (i) => (i === 7 ? { retry: RETRY } : {}))),
    'scanning is free, sync-wise',
  );
  // …but everything that DOES sync must still register, or a real change would
  // silently never leave the phone.
  check(
    'an endgame scan still changes the fingerprint',
    gamesFingerprintOf(plain) !==
      gamesFingerprintOf(library(30, (i) => (i === 7 ? { endgame: ENDGAME } : {}))),
    'it is synced, so it counts as a change',
  );
  check(
    'editing a game’s tags still changes the fingerprint',
    gamesFingerprintOf(plain) !==
      gamesFingerprintOf(library(30, (i) => (i === 2 ? { tags: ['sharp'] } : {}))),
    'user data, therefore a change',
  );
  check(
    'importing a game still changes the fingerprint',
    gamesFingerprintOf(plain) !== gamesFingerprintOf(library(31)),
    'a new game reaches the account',
  );
  // Beyond the cap, nothing is synced, so nothing can count as a change.
  check(
    'a change to a game past the cap is not a change to sync',
    gamesFingerprintOf(library(SYNC_GAME_LIMIT + 5)) ===
      gamesFingerprintOf(library(SYNC_GAME_LIMIT + 5, (i) => (i === 0 ? { tags: ['old'] } : {}))),
    'old games stay local, so editing one costs no upload',
  );

  // After a `replace` restore the device holds exactly what the account holds —
  // but re-analysed locally, it must STILL match, or the restore would be
  // followed by a pointless full re-upload.
  const remoteCopy = gamesForSync(library(40));
  check(
    'a restored copy matches the local library’s fingerprint',
    gamesFingerprintOf(remoteCopy) === gamesFingerprintOf(library(40)),
    'nothing goes back up after a replace',
  );
  check(
    'and still matches once those games are analysed locally',
    gamesFingerprintOf(remoteCopy) ===
      gamesFingerprintOf(library(40, () => ({ analysis: ANALYSIS, retry: RETRY }))),
    'local engine work never re-uploads the library',
  );

  // ── The ceiling ───────────────────────────────────────────────────────────

  check(
    'payloadBytes counts bytes, not characters',
    payloadBytes('é') === 4 && payloadBytes('e') === 3 && payloadBytes({ a: 1 }) === 7,
    `an accented character costs ${payloadBytes('é') - payloadBytes('e')} byte more than a plain one`,
  );
  check(
    'payloadBytes survives undefined without inventing a size',
    payloadBytes(undefined) === 0,
    'JSON.stringify(undefined) is not the string "undefined" here',
  );
  // The diet's whole job is to keep a full library nowhere near the wall.
  const fullBytes = payloadBytes(gamesForSync(library(SYNC_GAME_LIMIT, () => ({ analysis: ANALYSIS, retry: RETRY }))));
  check(
    'a full, heavily-analysed library stays far under the ceiling',
    fullBytes < 1024 * 1024,
    `${SYNC_GAME_LIMIT} slimmed games ≈ ${Math.round(fullBytes / 1024)} KB`,
  );

  // ── Deciding what to download ─────────────────────────────────────────────
  //
  // This is the comparison that makes cross-device sync possible at all, and
  // the one that was missing: the old module pulled once per device and pushed
  // for ever after, so a second phone could never learn anything.

  const T1 = '2026-08-19T10:00:00.000Z';
  const T2 = '2026-08-19T10:05:00.000Z';

  check(
    'nothing to pull when both stamps are the ones we last saw',
    !anyPart(partsToPull({ core: T1, games: T1 }, { core: T1, games: T1 })),
    'an idle poll costs two timestamps and no blob',
  );
  check(
    'a newer core stamp pulls the core and only the core',
    (() => {
      const parts = partsToPull({ core: T2, games: T1 }, { core: T1, games: T1 });
      return parts.core && !parts.games;
    })(),
    'editing a line on the other phone must not re-download the games',
  );
  check(
    'a newer games stamp pulls the games and only the games',
    (() => {
      const parts = partsToPull({ core: T1, games: T2 }, { core: T1, games: T1 });
      return parts.games && !parts.core;
    })(),
    'importing games on the other phone must not re-download the lines',
  );
  check(
    'a half we have never seen is always worth a look',
    (() => {
      const parts = partsToPull({ core: T1, games: T1 }, { core: null, games: null });
      return parts.core && parts.games;
    })(),
    'the first launch after signing in',
  );
  check(
    'a half the account has never held is never fetched',
    !anyPart(partsToPull({ core: null, games: null }, { core: null, games: null })),
    'an empty account row costs nothing',
  );
  check(
    'an OLDER remote stamp is not a reason to pull',
    !anyPart(partsToPull({ core: T1, games: T1 }, { core: T2, games: T2 })),
    'our own push is newer — downloading it back would be a round trip for nothing',
  );

  // ── Whose statistics win ──────────────────────────────────────────────────

  check(
    'the account\u2019s snapshot applies when it is newer than our last push',
    shouldApplyRemoteLocal({ remoteCoreStamp: T2, lastPushedCoreStamp: T1, localDirty: false }),
    'the other device trained more recently',
  );
  check(
    'it does not apply when our own push is the newer one',
    !shouldApplyRemoteLocal({ remoteCoreStamp: T1, lastPushedCoreStamp: T2, localDirty: false }),
    'we are the most recent writer',
  );
  check(
    'and NEVER applies while this device has unpushed changes',
    !shouldApplyRemoteLocal({ remoteCoreStamp: T2, lastPushedCoreStamp: T1, localDirty: true }),
    'the guard that keeps last-write-wins from being lossy',
  );
  check(
    'a first sign-in takes the account\u2019s snapshot',
    shouldApplyRemoteLocal({ remoteCoreStamp: T1, lastPushedCoreStamp: null, localDirty: false }),
    'nothing local to weigh it against',
  );

  // ── Which localStorage keys are statistics ────────────────────────────────
  //
  // Getting this wrong doesn't crash: it files a streak under "settings", and
  // an "export my statistics" quietly leaves it out.

  check(
    'training history, streaks, ratings and bests are statistics',
    ['obertura-review-log', 'obertura-training-days', 'obertura.puzzleRating',
      'obertura.timedBest.blitz', 'obertura.endgameProgress', 'obertura.brilliantLog']
      .every((k) => localKeyPart(k) === 'stats'),
    'the things training earns',
  );
  check(
    'board, pieces, filters and onboarding flags are settings',
    ['obertura.pieceSet', 'obertura.boardColour', 'obertura.lines.filter',
      'obertura.onboardingComplete', 'obertura.moveNotation']
      .every((k) => localKeyPart(k) === 'settings'),
    'the things preference sets',
  );

  // ── Partial backups ───────────────────────────────────────────────────────

  const linesOnly = parseBackup(JSON.stringify({
    format: 'obertura-backup',
    version: 4,
    exportedAt: T1,
    parts: ['lines'],
    repertoires: [{ id: 'r1', name: 'White', colour: 'white', tree: { san: '', uci: '', fen: 'x', children: [] } }],
  }));
  check(
    'a lines-only export parses and reports only lines',
    partsInBackup(linesOnly).join(',') === 'lines',
    describeBackup(linesOnly),
  );

  const statsOnly = parseBackup(JSON.stringify({
    format: 'obertura-backup',
    version: 4,
    exportedAt: T1,
    parts: ['stats'],
    local: { 'obertura.puzzleRating': '1500' },
  }));
  check(
    'a statistics-only export parses even with no repertoire at all',
    partsInBackup(statsOnly).join(',') === 'stats',
    'the old parser rejected this outright with \u201cmissing its repertoire\u201d',
  );

  check(
    'a file with nothing in it is still refused',
    (() => {
      try {
        parseBackup(JSON.stringify({ format: 'obertura-backup', version: 4, exportedAt: T1 }));
        return false;
      } catch {
        return true;
      }
    })(),
    'partial is fine; empty is a mistake worth naming',
  );

  check(
    'an old file with no parts list is read from the fields it has',
    (() => {
      const legacy = parseBackup(JSON.stringify({
        format: 'obertura-backup',
        version: 3,
        exportedAt: T1,
        repertoires: [{ id: 'r1', name: 'White', colour: 'white', tree: { san: '', uci: '', fen: 'x', children: [] } }],
        games: [{ id: 'g1', endTime: 1 }],
        local: { 'obertura.pieceSet': 'maestro' },
      }));
      return partsInBackup(legacy).join(',') === 'lines,games,settings';
    })(),
    'every file written before partial exports existed',
  );

  return results;
}
