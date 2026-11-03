#!/usr/bin/env node
// `bitorestore`: prepares a restore from a backup and says exactly what it would
// do. It only reads the live database. It writes a .sql file, and the owner runs
// the one command it prints, so nothing is ever put back by accident.
//
//   bitorestore                          newest backup: add back whatever is missing
//   bitorestore <file>                   the same, from an older backup
//   bitorestore --account <id or email>  only that account
//   bitorestore --account <…> --replace  and overwrite its data with the backup's
//   bitorestore --new-project            rebuild everything in an empty project
//
// Adding back what's missing can't change a row that exists. It can bring back an
// account its owner deleted after the backup was made, which is why this lists the
// accounts first, and why the choice is the owner's.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { buildRestoreSql } from './backup-core.mjs';
import { ROOT, die, query } from './supabase-read.mjs';

const fail = (m) => die(m, 'bitorestore');
const DIR = process.env.BITO_BACKUP_DIR || join(homedir(), 'Bito Backups');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? false : args.splice(i, 1).length > 0;
};
const option = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const [, value] = args.splice(i, 2);
  if (!value) fail(`${name} needs a value.`);
  return value;
};

const account = option('--account');
const replace = flag('--replace');
const withSchema = flag('--new-project');
if (replace && !account) fail('--replace only works together with --account.');
if (withSchema && account) fail('--new-project restores everything, so it can\'t take --account.');
const unknown = args.find((a) => a.startsWith('--'));
if (unknown) fail(`I don't know ${unknown}.`);

let file = args[0] ? (isAbsolute(args[0]) ? args[0] : resolve(process.cwd(), args[0])) : null;
if (!file) {
  let names = [];
  try {
    names = readdirSync(DIR).filter((f) => /^bito-backup-.*\.json$/.test(f)).sort().reverse();
  } catch {
    /* No folder yet: handled below. */
  }
  if (!names.length) fail(`No backups in ${DIR}. Run bitobackup first.`);
  file = join(DIR, names[0]);
}

let backup;
try {
  backup = JSON.parse(readFileSync(file, 'utf-8'));
} catch {
  fail(`Can't read ${file} as a backup.`);
}
const users = backup.tables?.['auth.users'];
if (!users) fail(`${file} is not a Bito backup.`);

let accountIds = null;
if (account) {
  const needle = account.toLowerCase();
  const found = users.filter((u) => u.id === needle || u.id.startsWith(needle) || u.email?.toLowerCase() === needle);
  if (found.length !== 1) fail(`${found.length} accounts in this backup match "${account}". I need exactly one.`);
  accountIds = [found[0].id];
}

const short = (id) => id.slice(0, 8);
console.log(`\n  Backup from ${new Date(backup.createdAt).toLocaleString()}: ${users.length} accounts`);

if (withSchema) {
  console.log('  Rebuilds all tables, rules and permissions, then adds all the data.');
  console.log('  For an EMPTY project only. Link to that project before running it.');
} else {
  const live = new Set(query('select id::text as id from auth.users').map((r) => r.id));
  const scope = accountIds ? users.filter((u) => accountIds.includes(u.id)) : users;
  const missing = scope.filter((u) => !live.has(u.id));
  const onlyLive = users.length ? [...live].filter((id) => !users.some((u) => u.id === id)).length : live.size;
  if (accountIds) {
    const inLive = live.has(accountIds[0]);
    console.log(`  Account ${short(accountIds[0])}: ${inLive ? 'still in the database' : 'missing from the database'}.`);
    if (inLive && !replace) console.log('  Nothing of its data will change. Add --replace to overwrite it with the backup.');
    if (inLive && replace) console.log('  Its repertoire, games and stats will be OVERWRITTEN with the backup\'s copy.');
  } else {
    console.log(`  Live now: ${live.size} accounts. ${onlyLive} newer than the backup will not be touched.`);
    if (missing.length) {
      console.log(`\n  ${missing.length} account(s) would come back:`);
      for (const u of missing) console.log(`    ${short(u.id)}  created ${String(u.created_at).slice(0, 10)}`);
      console.log('\n  If any of these people deleted their account on purpose, restore only the');
      console.log('  ones you need with --account. Bringing back a deleted account breaks the');
      console.log('  privacy policy.');
    } else {
      console.log('  No account is missing. Only missing stats or event rows would be added.');
    }
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = join(DIR, `restore-${stamp}.sql`);
writeFileSync(out, buildRestoreSql(backup, { accountIds, replace, withSchema }), { mode: 0o600 });

console.log('\n  Nothing has changed yet. To do it, run this:\n');
console.log(`  cd "${ROOT}" && supabase db query --linked --file "${out}"\n`);
