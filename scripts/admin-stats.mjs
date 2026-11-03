#!/usr/bin/env node
// The owner's dashboard. `bitostats` (or `npm run admin`) reads who is using Bito
// Chess and opens the result in the browser. The numbers are worked out in
// admin-model.mjs and drawn in admin-page.mjs.
//
// ── WHY IT IS A LOCAL FILE AND NOT A HOSTED PAGE ────────────────────────────
// It reads real account rows. Hosting it anywhere would mean those rows leaving
// this machine to a service that is not in the privacy policy's sub-processor
// table, which would be a disclosure change rather than a build step. So the
// query runs here, the HTML is written here, and nothing is uploaded. The
// output is gitignored for the same reason: it is a file full of user data.
//
// ── AND WHY IT SHELLS OUT TO THE SUPABASE CLI ───────────────────────────────
// There is no key in this script and none in .env for it to read. It runs
// `supabase db query --linked`, which uses the CLI's own stored login — so the
// credential is the one already on this machine, managed by a tool built to
// hold it, and nothing privileged is ever written into the repo. The cost is a
// one-time `supabase login` + `supabase link`; the script says so if either is
// missing.
//
// Two sources, both read-only here:
//   • public.profiles      — one row per account, `stats` written by the app
//                            (src/account-stats.ts). The CURRENT picture.
//   • public.stats_daily   — a copy of each active account's summary per week,
//                            taken by a pg_cron job, Mondays at 03:17 UTC. The HISTORY, which
//                            profiles.stats cannot give because it is
//                            overwritten on every push.
//   • public.metrics       — (name, day, hits) from the anonymous counter. No
//                            identifier, so it can never be joined to the above.
//                            That is the design, not a limitation of this page.
//
// Own accounts are left out of every account number, listed by the start of their
// id in .admin/own-accounts.txt. They stay in the table, marked. The anonymous
// counts can't leave anyone out: Settings has a "leave me out" switch for that.
//
// The funnel lines up counts for the same period. They can't follow one person from
// the landing page to a purchase, by design, so a step compares two counts rather
// than tracking a group. Where visitors come from stays on Umami's own website: its
// API needs a paid plan.
//
// Campaigns are the owner's own notes, one per line in .admin/campaigns.txt:
//   2026-11-05 Reddit r/chess post

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buildModel } from './admin-model.mjs';
import { renderPage, terminalSummary } from './admin-page.mjs';
import { ROOT, query } from './supabase-read.mjs';

const OUT = resolve(ROOT, '.admin/stats.html');

// ── The reads ───────────────────────────────────────────────────────────────

const ownFile = resolve(ROOT, '.admin/own-accounts.txt');
const ownIds = existsSync(ownFile)
  ? readFileSync(ownFile, 'utf-8').split('\n').map((l) => l.trim().toLowerCase()).filter((l) => /^[0-9a-f-]{4,36}$/.test(l))
  : [];
const isOwn = (id) => ownIds.some((own) => String(id).startsWith(own));

// Every account, with its summary flattened out. `stats` is null for anyone
// whose device has not pushed since the summary shipped — which is "hasn't
// opened the app lately", NOT "has done nothing", and the page says so.
const everyone = query(`
  select
    p.id::text                                  as id,
    p.entitled,
    (p.stripe_payment_intent_id is not null)    as bought,
    p.created_at::date::text                    as created,
    p.entitled_at::date::text                   as bought_on,
    p.repertoire_updated_at                     as updated_at,
    (p.stats is not null)                       as reporting,
    coalesce((p.stats->>'lines')::int, 0)                    as lines,
    coalesce((p.stats->>'linesInTraining')::int, 0)          as lines_in_training,
    coalesce((p.stats->>'repertoires')::int, 0)              as repertoires,
    coalesce((p.stats->>'gamesImported')::int, 0)            as games,
    coalesce((p.stats->>'drillsCompleted')::int, 0)          as drills,
    coalesce((p.stats->>'puzzlesSolved')::int, 0)            as puzzles,
    coalesce((p.stats->>'dailyChallengesCompleted')::int, 0) as daily,
    coalesce((p.stats->>'endgamesSolved')::int, 0)           as endgames,
    coalesce((p.stats->>'mistakeDrillsCompleted')::int, 0)   as mistakes,
    coalesce((p.stats->>'currentStreak')::int, 0)            as streak,
    coalesce((p.stats->>'trainingDays')::int, 0)             as training_days,
    coalesce((p.stats->>'onboardingCompleted')::int, 0)      as onboarded,
    p.stats->>'lastActiveDay'                   as last_active,
    p.stats->>'appVersion'                      as version
  from public.profiles p
  order by p.repertoire_updated_at desc nulls last
`);

// The history the snapshot job accumulates. Totals per run across everyone who
// reported that day.
const history = query(`
  select
    day::text                                            as day,
    count(*)                                             as accounts,
    sum(coalesce((stats->>'lines')::int, 0))             as lines,
    sum(coalesce((stats->>'drillsCompleted')::int, 0))   as drills,
    sum(coalesce((stats->>'puzzlesSolved')::int, 0))     as puzzles
  from public.stats_daily
  ${ownIds.length ? `where ${ownIds.map((own) => `id::text not like '${own}%'`).join(' and ')}` : ''}
  group by day
  order by day
`);

// The anonymous counter. Joinable to nothing above, by construction.
const events = query(`
  select name, day::text as day, hits
  from public.metrics
  order by day, name
`);

const dbBytes = Number(query('select pg_database_size(current_database()) as b')[0]?.b ?? 0);

// ── The owner's own notes and files ─────────────────────────────────────────

const campaignFile = resolve(ROOT, '.admin/campaigns.txt');
const campaigns = existsSync(campaignFile)
  ? readFileSync(campaignFile, 'utf-8').split('\n').map((l) => l.trim().match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/)).filter(Boolean)
      .map((m) => ({ day: m[1], note: m[2] })).sort((a, b) => b.day.localeCompare(a.day))
  : [];

const BACKUP_DIR = process.env.BITO_BACKUP_DIR || join(homedir(), 'Bito Backups');
let lastBackupDays = null;
try {
  const newest = readdirSync(BACKUP_DIR).filter((f) => /^bito-backup-.*\.json$/.test(f)).sort().pop();
  if (newest) lastBackupDays = Math.floor((Date.now() - statSync(join(BACKUP_DIR, newest)).mtimeMs) / (24 * 60 * 60 * 1000));
} catch {
  /* No backups yet: the page says so. */
}

// ── The page ────────────────────────────────────────────────────────────────

const model = buildModel({ everyone, history, events, dbBytes, campaigns, lastBackupDays, ownIds });
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, renderPage(model), 'utf-8');

console.log(`\n${terminalSummary(model)}`);
console.log(`  → ${OUT}\n`);

if (!process.argv.includes('--no-open')) {
  try {
    execFileSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [OUT], { stdio: 'ignore' });
  } catch {
    /* no opener — the path is printed above, that's enough. */
  }
}
