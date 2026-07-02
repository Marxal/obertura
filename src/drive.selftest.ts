// A runnable check of the Drive backup module's pure parts, no test framework —
// same spirit as the other *.selftest.ts files. The network and OAuth sides
// can't run headless, so this covers what CAN go quietly wrong: the multipart
// upload body Drive parses, picking the right file out of a listing, and the
// backup JSON surviving the Drive round-trip through parseBackup. Surfaced in
// Settings → Diagnostics and in the headless `npm run selftest`.

import type { TestResult } from './selftest-panel';
import { buildMultipartBody, pickNewestBackup } from './drive-backup';
import { parseBackup, type BackupFile } from './storage';
import type { Line } from './types';

export function runDriveSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // ── Multipart body ─────────────────────────────────────────────────────────
  const boundary = 'obertura-test';
  const metadata = { name: 'obertura-backup.json', parents: ['appDataFolder'] };
  const content = '{"format":"obertura-backup"}';
  const body = buildMultipartBody(metadata, content, boundary);

  const parts = body.split(`--${boundary}`);
  check(
    'multipart body has two parts and a closing delimiter',
    parts.length === 4 && body.endsWith(`--${boundary}--`),
    `${parts.length - 2} part(s), ends "${body.slice(-boundary.length - 4)}"`,
  );
  check(
    'metadata part carries the file name and appDataFolder parent',
    parts[1]?.includes('"name":"obertura-backup.json"') === true &&
      parts[1]?.includes('"appDataFolder"') === true,
    parts[1]?.trim().split('\r\n').pop() ?? '(missing)',
  );
  check(
    'content part carries the backup JSON verbatim',
    parts[2]?.includes(content) === true,
    parts[2]?.trim().split('\r\n').pop() ?? '(missing)',
  );
  check(
    'headers and payloads are separated by blank lines (CRLF)',
    body.includes('Content-Type: application/json; charset=UTF-8\r\n\r\n') &&
      body.includes('Content-Type: application/json\r\n\r\n'),
    'both parts declare a JSON content type followed by CRLF CRLF',
  );

  // ── Picking the newest backup from a files.list response ──────────────────
  const picked = pickNewestBackup([
    { id: 'old', name: 'obertura-backup.json', modifiedTime: '2026-01-01T00:00:00Z' },
    { id: 'stranger', name: 'something-else.json', modifiedTime: '2026-12-31T00:00:00Z' },
    { id: 'new', name: 'obertura-backup.json', modifiedTime: '2026-06-01T00:00:00Z' },
  ]);
  check(
    'newest correctly-named backup wins the listing',
    picked?.id === 'new',
    `picked ${picked?.id ?? 'nothing'}`,
  );
  check(
    'an empty listing yields null (no backup yet)',
    pickNewestBackup([]) === null,
    String(pickNewestBackup([])),
  );

  // ── Round-trip: what we upload is what a restore parses ───────────────────
  const line: Line = {
    id: 'l1',
    name: 'Italian Game',
    tags: ['e4'],
    colour: 'white',
    openingName: 'Italian Game',
    confidence: 2,
    lastTrained: null,
    inTraining: true,
    tree: {
      id: 'root',
      san: '',
      uci: '',
      fen: 'start',
      children: [
        {
          id: 'n1',
          san: 'e4',
          uci: 'e2e4',
          fen: 'fen-e4',
          children: [],
          review: { ease: 2.5, interval: 3, reps: 2, lapses: 0, due: new Date('2026-07-01T00:00:00Z') },
        },
      ],
    } as Line['tree'],
    createdAt: 1750000000000,
  };
  const file: BackupFile = {
    format: 'obertura-backup',
    version: 1,
    exportedAt: '2026-07-01T12:00:00.000Z',
    lines: [line],
  };
  // JSON.stringify is exactly what uploadBackupToDrive sends to Drive.
  const restored = parseBackup(JSON.stringify(file));
  const restoredDue = restored.lines[0]?.tree.children[0]?.review?.due;
  check(
    'backup JSON survives the Drive round-trip',
    restored.lines.length === 1 && restored.lines[0].name === 'Italian Game',
    `${restored.lines.length} line(s), first "${restored.lines[0]?.name}"`,
  );
  check(
    'review due dates come back as real Dates',
    restoredDue instanceof Date && restoredDue.toISOString() === '2026-07-01T00:00:00.000Z',
    restoredDue instanceof Date ? restoredDue.toISOString() : typeof restoredDue,
  );

  return results;
}
