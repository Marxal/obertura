// The one route to the live database from this machine: the Supabase CLI's own
// stored login, so no key ever sits in the repo or in .env. Used by the owner
// dashboard and by the backup commands. `cwd` is pinned to the repo because the
// CLI finds its project link there, and bitobackup can be run from any folder.

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function die(message, label = 'bito') {
  console.error(`\n  ${label}: ${message}\n`);
  process.exit(1);
}

export function query(sql) {
  let raw;
  try {
    // The CLI's output format defaults on whether stdout is a terminal: JSON
    // when piped, a pretty ASCII table when run interactively. `--output-format
    // json` pins it regardless of who is running the command from where.
    raw = execFileSync('supabase', ['db', 'query', '--linked', '--output-format', 'json', sql], {
      cwd: ROOT,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const text = `${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? ''}`;
    if (/not linked|project ref/i.test(text)) {
      die('The Supabase CLI is not linked to a project.\n\n  supabase link --project-ref <your-ref>\n\nRun `supabase projects list` to find the ref.');
    }
    if (/login|access token|unauthor/i.test(text)) {
      die('The Supabase CLI is not logged in.\n\n  supabase login');
    }
    if (/ENOENT/.test(text)) {
      die('The Supabase CLI is not installed.\n\n  brew install supabase/tap/supabase');
    }
    die(`The query failed.\n\n${text.trim()}`);
  }
  // The CLI sometimes prefixes a status line ("Initialising login role...")
  // before the JSON starts, and the JSON itself takes one of two shapes: a bare
  // array of rows, or an envelope object with a `rows` field and an
  // untrusted-content `warning`. Handle both. Never eval, never trust the text
  // as anything but data.
  const start = raw.search(/[[{]/);
  if (start < 0) die(`Unexpected output from the CLI:\n\n${raw.slice(0, 400)}`);
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start));
  } catch {
    die(`Could not parse the CLI's output:\n\n${raw.slice(0, 400)}`);
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed?.error) die(`Postgres said: ${parsed.error.message ?? JSON.stringify(parsed.error)}`);
  if (Array.isArray(parsed?.rows)) return parsed.rows;
  die(`Unexpected shape from the CLI:\n\n${raw.slice(0, 400)}`);
}
