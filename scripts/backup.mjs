#!/usr/bin/env node
// `bitobackup`: saves everything in the live database to a dated file on this Mac.
// Read-only: it never changes the database. See scripts/backup-core.mjs for what
// the file holds, and scripts/restore.mjs for how it goes back.
//
// The file holds emails and login data, so it stays out of the repo, out of
// Time Machine (its copies would outlive the retention below) and readable only
// by this Mac's user. The privacy policy states the retention: only the newest
// KEEP copies survive, which is how a deleted account finally leaves them.

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AUTH_TABLES, BACKUP_FORMAT, SCHEMA_SQL, dataSql } from './backup-core.mjs';
import { ROOT, die, query } from './supabase-read.mjs';

export const KEEP = 8;
const DIR = process.env.BITO_BACKUP_DIR || join(homedir(), 'Bito Backups');
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

const publicTables = query(
  `select tablename from pg_tables where schemaname = 'public' order by tablename`,
).map((r) => r.tablename);

const raw = query(dataSql(publicTables))[0]?.data;
const tables = typeof raw === 'string' ? JSON.parse(raw) : raw;
if (!tables) die('The database returned nothing to save.', 'bitobackup');

const schema = Object.fromEntries(Object.entries(SCHEMA_SQL).map(([k, sql]) => [k, query(sql)]));
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version;
const backup = { format: BACKUP_FORMAT, createdAt: now.toISOString(), appVersion: version, tables, schema };

// Check the file against a fresh count before trusting it, and only then replace
// the old ones. A new account in the gap can make the live count higher, never lower.
const counts = query(`select ${[...AUTH_TABLES, ...publicTables.map((t) => `public.${t}`)]
  .map((t) => `(select count(*) from ${t}) as "${t}"`).join(', ')}`)[0];

mkdirSync(DIR, { recursive: true, mode: 0o700 });
chmodSync(DIR, 0o700);
const file = join(DIR, `bito-backup-${stamp}.json`);
const temp = `${file}.part`;
writeFileSync(temp, JSON.stringify(backup), { mode: 0o600 });
const back = JSON.parse(readFileSync(temp, 'utf-8'));
for (const [t, live] of Object.entries(counts)) {
  const saved = back.tables[t]?.length ?? -1;
  if (saved < 0 || saved > Number(live) || Number(live) - saved > 5) {
    rmSync(temp);
    die(`${t} has ${live} rows live but ${saved} in the file. Nothing was saved. Run it again.`, 'bitobackup');
  }
}
renameSync(temp, file);

// Old copies go only after the new one is safely on disk. Prepared restore files
// hold the same data and are stale by now, so they go too.
const old = readdirSync(DIR).filter((f) => /^bito-backup-.*\.json$/.test(f)).sort().reverse().slice(KEEP);
for (const f of old) rmSync(join(DIR, f));
for (const f of readdirSync(DIR).filter((f) => /^restore-.*\.sql$/.test(f))) rmSync(join(DIR, f));

const mac = process.platform === 'darwin';
if (mac) {
  try {
    execFileSync('tmutil', ['addexclusion', DIR], { stdio: 'ignore' });
  } catch {
    /* Not every Mac has it. The file is still saved. */
  }
}

const mb = (statSync(file).size / 1024 / 1024).toFixed(1);
console.log(`\n  Saved: ${file}`);
console.log(`  ${mb} MB · ${tables['auth.users'].length} accounts · ${tables['public.profiles']?.length ?? 0} profiles · ${tables['public.stats_daily']?.length ?? 0} stats rows · ${tables['public.metrics']?.length ?? 0} event rows`);
console.log(`  Keeping the newest ${KEEP} copies${old.length ? `; removed ${old.length} older` : ''}.`);
if (schema.extras.length) {
  console.log(`  Not saved, rebuild by hand: ${schema.extras.map((e) => e.name).join(', ')}`);
}
if (mac) {
  let vault = '';
  try {
    vault = execFileSync('fdesetup', ['status'], { encoding: 'utf-8' });
  } catch {
    /* Unknown, so say nothing. */
  }
  if (/FileVault is Off/.test(vault)) {
    console.log('\n  This Mac\'s disk is not encrypted, and this file holds emails and login data.');
    console.log('  Turn on FileVault in System Preferences → Security & Privacy.');
  }
}
console.log('');
