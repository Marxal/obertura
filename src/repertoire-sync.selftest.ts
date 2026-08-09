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
//     unchanged data" skip would never once fire.
//
// Run via `npm run selftest`.

import type { TestResult } from './selftest-panel';
import {
  syncStateFrom,
  combineRemote,
  fingerprint,
  coreFingerprintOf,
  gamesFingerprintOf,
  type SyncFlags,
} from './sync-core';
import { parseBackup, type BackupFile } from './storage';
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
    splitParsed?.lines.length === 1 && splitParsed?.games?.length === 2,
    `${splitParsed?.lines.length ?? 0} line(s), ${splitParsed?.games?.length ?? 0} game(s)`,
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

  return results;
}
