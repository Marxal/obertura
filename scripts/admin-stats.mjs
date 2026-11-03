#!/usr/bin/env node
// The owner's dashboard. `npm run admin` → a chart-shaped read of who is using
// Bito Chess, opened in the browser.
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
// counts can't leave anyone out: Settings has a "don't count me" switch for that.
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
const accounts = everyone.filter((a) => !isOwn(a.id));

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

// ── Shaping ─────────────────────────────────────────────────────────────────

const reporting = accounts.filter((a) => a.reporting);
const n = (v) => Number(v ?? 0);
const sum = (rows, key) => rows.reduce((t, r) => t + n(r[key]), 0);

// The question the whole column exists to answer. "Trains" is deliberately
// drills > 0 rather than any activity: enrolling a line is building, running it
// is training, and the gap between those two is the thing worth seeing.
const builders = reporting.filter((a) => n(a.drills) === 0);
const trainers = reporting.filter((a) => n(a.drills) > 0);

// Which features are touched at all, as a share of accounts that report. Order
// is fixed so the bars do not reshuffle between runs — a chart that reorders
// itself is unreadable across two glances.
const FEATURES = [
  ['Built lines', (a) => n(a.lines) > 0],
  ['Trained a line', (a) => n(a.drills) > 0],
  ['Imported games', (a) => n(a.games) > 0],
  ['Solved puzzles', (a) => n(a.puzzles) > 0],
  ['Daily challenge', (a) => n(a.daily) > 0],
  ['Endgames', (a) => n(a.endgames) > 0],
  ['Mistake drills', (a) => n(a.mistakes) > 0],
];
const adoption = FEATURES.map(([label, test]) => ({
  label,
  count: reporting.filter(test).length,
  share: reporting.length ? reporting.filter(test).length / reporting.length : 0,
}));

const eventTotals = [...events.reduce((m, e) => m.set(e.name, (m.get(e.name) ?? 0) + n(e.hits)), new Map())]
  .map(([name, hits]) => ({ name, hits }))
  .sort((a, b) => b.hits - a.hits);

const opensByDay = events.filter((e) => e.name === 'app_open').map((e) => ({ day: e.day, value: n(e.hits) }));

const DAY_MS = 24 * 60 * 60 * 1000;
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
const today = dayStr(Date.now());
const daysAgo = (d) => dayStr(Date.now() - d * DAY_MS);

// Counts of one app event between two days, end not included.
function hitsBetween(name, from, to = '9999') {
  return events.filter((e) => e.name === name && e.day >= from && e.day < to).reduce((t, e) => t + n(e.hits), 0);
}

// The funnel's newest steps began on this day. Earlier days would set old installs
// against steps that weren't being counted, so no period reaches back past it.
const FUNNEL_FROM = '2026-11-03';
const accountsFrom = (from) => accounts.filter((a) => a.created >= from).length;

function funnel(days) {
  const cutoff = daysAgo(days);
  const from = cutoff > FUNNEL_FROM ? cutoff : FUNNEL_FROM;
  const steps = [
    ['Visited the landing page', hitsBetween('landing_visit', from)],
    ['Pressed a try button', hitsBetween('landing_try', from)],
    ['Opened the app', hitsBetween('install', from)],
    ['Imported games', hitsBetween('first_games_imported', from)],
    ['Scanned for mistakes', hitsBetween('first_scan_done', from)],
    ['Used the app', hitsBetween('first_interaction', from)],
    ['Registered', accountsFrom(from)],
    ['Back after 2 days', hitsBetween('return_after_d2', from)],
    ['Saw the Pro offer', hitsBetween('pro_sheet_shown', from)],
    ['Started checkout', hitsBetween('checkout_started', from)],
    ['Bought', hitsBetween('purchase_confirmed', from)],
  ];
  return steps.map(([label, value], i) => ({ label, value, prev: i ? steps[i - 1][1] : null }));
}

// Too few people before a step says nothing, so the note needs at least 10.
function biggestDrop(steps) {
  let worst = null;
  for (const s of steps) {
    if (s.prev == null || s.prev < 10) continue;
    const rate = s.value / s.prev;
    if (rate <= 1 && (!worst || rate < worst.rate)) worst = { ...s, rate };
  }
  return worst;
}

const funnelWeek = funnel(7);
const funnelMonth = funnel(30);
const drop = biggestDrop(funnelMonth);
const dropFrom = drop ? funnelMonth[funnelMonth.findIndex((s) => s.label === drop.label) - 1].label : '';
const asked = hitsBetween('counts_asked', FUNNEL_FROM);

// Of those who could have come back by now: installs at least N days old. A return
// in the counter's first N days can only be someone who installed before counting
// began, with no install to set it against, so those days don't count. Small
// numbers swing wildly here, so the page shows both counts next to the share.
const firstCountedDay = events.reduce((d, e) => (e.day < d ? e.day : d), today);
function retention(name, afterDays) {
  const returned = hitsBetween(name, dayStr(Date.parse(`${firstCountedDay}T00:00:00Z`) + afterDays * DAY_MS));
  const eligible = hitsBetween('install', '0000', daysAgo(afterDays));
  return { returned, eligible };
}

// Monday-based weeks, oldest first, with empty weeks kept so gaps look like gaps.
function weekly(rows, weeks = 12) {
  const monday = (ms) => {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  };
  const first = monday(Date.now()) - (weeks - 1) * 7 * DAY_MS;
  const out = Array.from({ length: weeks }, (_, i) => ({ day: dayStr(first + i * 7 * DAY_MS), value: 0 }));
  for (const r of rows) {
    const i = Math.round((monday(Date.parse(`${r.day}T00:00:00Z`)) - first) / (7 * DAY_MS));
    if (i >= 0 && i < weeks) out[i].value += r.value;
  }
  return out;
}
const dailyEvent = (name) => events.filter((e) => e.name === name).map((e) => ({ day: e.day, value: n(e.hits) }));
const newAccountDays = accounts.filter((a) => a.created).map((a) => ({ day: a.created, value: 1 }));
const visitDays = dailyEvent('landing_visit');

const campaignFile = resolve(ROOT, '.admin/campaigns.txt');
const campaigns = existsSync(campaignFile)
  ? readFileSync(campaignFile, 'utf-8').split('\n').map((l) => l.trim().match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/)).filter(Boolean)
      .map((m) => ({ day: m[1], note: m[2] })).sort((a, b) => b.day.localeCompare(a.day))
  : [];
const shiftDay = (day, by) => dayStr(Date.parse(`${day}T00:00:00Z`) + by * DAY_MS);
const sumDays = (rows, from, to) => rows.filter((r) => r.day >= from && r.day < to).reduce((t, r) => t + r.value, 0);

// The week before against the week from that day on.
const campaignRows = campaigns.map((c) => {
  const before = shiftDay(c.day, -7);
  const after = shiftDay(c.day, 7);
  return {
    ...c,
    visitsBefore: sumDays(visitDays, before, c.day),
    visitsAfter: sumDays(visitDays, c.day, after),
    installsBefore: hitsBetween('install', before, c.day),
    installsAfter: hitsBetween('install', c.day, after),
    partial: after > today,
  };
});

const bought = accounts.filter((a) => a.bought).length;
const FOUNDER_SEATS = 100;
const NET_PER_SALE = 9.18; // €12 less 25% VAT and Stripe's fee.
const DB_LIMIT_MB = 500;

const BACKUP_DIR = process.env.BITO_BACKUP_DIR || join(homedir(), 'Bito Backups');
let lastBackupDays = null;
try {
  const newest = readdirSync(BACKUP_DIR).filter((f) => /^bito-backup-.*\.json$/.test(f)).sort().pop();
  if (newest) lastBackupDays = Math.floor((Date.now() - statSync(join(BACKUP_DIR, newest)).mtimeMs) / DAY_MS);
} catch {
  /* No backups yet: the tile says so. */
}
const backupLabel = lastBackupDays == null ? 'none' : lastBackupDays === 0 ? 'today' : `${lastBackupDays}d ago`;

// ── Rendering ───────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => `${Math.round(x * 100)}%`;
const short = (id) => String(id ?? '').slice(0, 8);

// A stat tile. Not a one-bar bar chart — a single current number is a number.
function tile(value, label, note) {
  return `<div class="tile"><div class="tile-v">${esc(value)}</div><div class="tile-l">${esc(label)}</div>${
    note ? `<div class="tile-n">${esc(note)}</div>` : ''
  }</div>`;
}

// Horizontal bars, one hue. The job is "compare magnitude", so it is sequential
// by the book: no categorical palette, no legend, the title names the series.
// Every bar is directly labelled, so nothing depends on reading a length.
function barChart(rows, { max, format }) {
  if (!rows.length) return '<p class="empty">Nothing to show yet.</p>';
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  return `<div class="bars">${rows
    .map((r) => {
      const w = top > 0 ? (r.value / top) * 100 : 0;
      return `<div class="bar-row" tabindex="0" data-tip="${esc(r.label)}: ${esc(format(r.value, r))}">
        <div class="bar-lab">${esc(r.label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${w.toFixed(1)}%"></div></div>
        <div class="bar-val">${esc(format(r.value, r))}</div>
      </div>`;
    })
    .join('')}</div>`;
}

// Lines built (x) against drills run (y): the build-vs-train question as a
// picture. A point on the floor is somebody who built and never trained, which
// is exactly the shape worth being able to see at a glance.
function scatter(rows) {
  if (rows.length < 2) {
    return `<p class="empty">Needs at least two reporting accounts to be worth plotting. ${
      rows.length ? 'One so far.' : 'None so far.'
    } The table below has everything.</p>`;
  }
  const W = 560, H = 300, P = { t: 16, r: 16, b: 40, l: 52 };
  const maxX = Math.max(...rows.map((r) => n(r.lines)), 1);
  const maxY = Math.max(...rows.map((r) => n(r.drills)), 1);
  const x = (v) => P.l + (n(v) / maxX) * (W - P.l - P.r);
  const y = (v) => H - P.b - (n(v) / maxY) * (H - P.t - P.b);
  const ticks = (mx) => [0, mx / 2, mx].map((v) => Math.round(v));
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Lines built against drills completed, one dot per account">
    ${ticks(maxY).map((v) => `<line class="grid" x1="${P.l}" y1="${y(v)}" x2="${W - P.r}" y2="${y(v)}"/>
      <text class="tick" x="${P.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    ${ticks(maxX).map((v) => `<text class="tick" x="${x(v)}" y="${H - P.b + 18}" text-anchor="middle">${v}</text>`).join('')}
    <line class="axis" x1="${P.l}" y1="${H - P.b}" x2="${W - P.r}" y2="${H - P.b}"/>
    <text class="axlab" x="${(P.l + W - P.r) / 2}" y="${H - 6}" text-anchor="middle">lines built</text>
    <text class="axlab" transform="translate(14 ${(P.t + H - P.b) / 2}) rotate(-90)" text-anchor="middle">drills completed</text>
    ${rows
      .map(
        (r) => `<circle class="dot" tabindex="0" cx="${x(r.lines)}" cy="${y(r.drills)}" r="6" data-tip="${esc(short(r.id))}: ${n(
          r.lines,
        )} lines, ${n(r.drills)} drills"></circle>`,
      )
      .join('')}
  </svg>`;
}

// A single series over time. Two measures of different scale get two charts,
// never two y-axes on one. The hit target is a whole column, with a hairline, so
// nobody has to aim at a 2px line. `marks` draws dashed lines on campaign days.
function lineChart(points, label, marks = [], W = 560) {
  if (points.length < 2) {
    return `<p class="empty">${esc(label)}: not enough days yet for a trend.</p>`;
  }
  const H = 200, P = { t: 16, r: 16, b: 32, l: 52 };
  const max = Math.max(...points.map((p) => p.value), 1);
  const x = (i) => P.l + (i / Math.max(points.length - 1, 1)) * (W - P.l - P.r);
  const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const step = (W - P.l - P.r) / Math.max(points.length - 1, 1);
  const showDots = points.length <= 30;
  const marked = marks
    .map((m) => ({ ...m, i: points.findIndex((p) => p.day >= m.day) }))
    .filter((m) => m.i >= 0)
    .map((m) => `<line class="mark" x1="${x(m.i)}" y1="${P.t}" x2="${x(m.i)}" y2="${H - P.b}" data-tip="${esc(m.day)}: ${esc(m.note)}"></line>`)
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(label)} over time">
    ${[0, max / 2, max].map((v) => `<line class="grid" x1="${P.l}" y1="${y(v)}" x2="${W - P.r}" y2="${y(v)}"/>
      <text class="tick" x="${P.l - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`).join('')}
    <path class="line" d="${d}"/>
    ${showDots ? points.map((p, i) => `<circle class="dot" cx="${x(i)}" cy="${y(p.value)}" r="4"/>`).join('') : ''}
    ${points.map((p, i) => `<g class="hit" tabindex="0" data-tip="${esc(p.day)}: ${p.value}">
      <rect x="${(x(i) - step / 2).toFixed(1)}" y="${P.t}" width="${Math.max(step, 2).toFixed(1)}" height="${H - P.t - P.b}" fill="transparent"/>
      <line class="hair" x1="${x(i)}" y1="${P.t}" x2="${x(i)}" y2="${H - P.b}"/></g>`).join('')}
    ${marked}
    ${points.map((p, i) => (i === 0 || i === points.length - 1
      ? `<text class="tick" x="${x(i)}" y="${H - P.b + 18}" text-anchor="${i ? 'end' : 'start'}">${esc(p.day)}</text>`
      : '')).join('')}
  </svg>`;
}

// Columns per week. A one-hue magnitude chart: the newest and the highest weeks
// carry a number, and the rest are on hover.
function columns(points, label) {
  const W = 560, H = 170, P = { t: 22, r: 8, b: 26, l: 8 };
  const max = Math.max(...points.map((p) => p.value), 1);
  const band = (W - P.l - P.r) / points.length;
  const peak = points.findIndex((p) => p.value === max);
  const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(label)} per week">
    <line class="axis" x1="${P.l}" y1="${H - P.b}" x2="${W - P.r}" y2="${H - P.b}"/>
    ${points.map((p, i) => {
      const bx = P.l + i * band + 2;
      const bw = Math.max(band - 4, 2);
      const h = Math.max(H - P.b - y(p.value), p.value ? 2 : 0);
      const labelled = p.value && (i === peak || i === points.length - 1);
      return `<g class="col" tabindex="0" data-tip="Week of ${esc(p.day)}: ${p.value}">
        <rect x="${bx}" y="${P.t}" width="${bw}" height="${H - P.t - P.b}" fill="transparent"/>
        ${h ? `<path class="bar-mark" d="M${bx} ${H - P.b}v${-(h - Math.min(4, h))}q0 ${-Math.min(4, h)} ${Math.min(4, bw / 2)} ${-Math.min(4, h)}h${bw - 2 * Math.min(4, bw / 2)}q${Math.min(4, bw / 2)} 0 ${Math.min(4, bw / 2)} ${Math.min(4, h)}v${h - Math.min(4, h)}z"/>` : ''}
        ${labelled ? `<text class="col-val" x="${bx + bw / 2}" y="${H - P.b - h - 6}" text-anchor="middle">${p.value}</text>` : ''}
      </g>`;
    }).join('')}
    <text class="tick" x="${P.l}" y="${H - 8}">${esc(points[0].day)}</text>
    <text class="tick" x="${W - P.r}" y="${H - 8}" text-anchor="end">${esc(points[points.length - 1].day)}</text>
  </svg>`;
}

const funnelFormat = (value, row) =>
  row.prev != null && row.prev > 0 && value <= row.prev ? `${value} · ${pct(value / row.prev)}` : String(value);
const funnelChart = (steps) => `<div class="funnel">${barChart(steps, { format: funnelFormat })}</div>`;

const change = (now, before) => {
  if (!before && !now) return 'none in the 7 days before either';
  const d = now - before;
  return `${d > 0 ? '+' : ''}${d} on the 7 days before`;
};
const lastWeek = (name) => hitsBetween(name, daysAgo(7));
const prevWeek = (name) => hitsBetween(name, daysAgo(14), daysAgo(7));
const accountsBetween = (from, to = '9999') => accounts.filter((a) => a.created >= from && a.created < to).length;
const activeWithin = (d) => reporting.filter((a) => a.last_active && a.last_active >= daysAgo(d)).length;

const retentionTile = (label, name, days) => {
  const r = retention(name, days);
  return tile(r.eligible ? pct(Math.min(r.returned / r.eligible, 1)) : '–', label, `${r.returned} of ${r.eligible} installs old enough`);
};

const campaignSection = `<section>
    <h2>Campaigns</h2>
    ${campaignRows.length
      ? `<div class="scroll"><table>
          <thead><tr><th>day</th><th>what</th>
            <th class="num">visits, 7 days before</th><th class="num">7 days from then</th>
            <th class="num">installs, 7 days before</th><th class="num">7 days from then</th></tr></thead>
          <tbody>${campaignRows.map((c) => `<tr>
            <td class="mono">${esc(c.day)}</td><td>${esc(c.note)}${c.partial ? ' <span class="pill">still counting</span>' : ''}</td>
            <td class="num">${c.visitsBefore}</td><td class="num">${c.visitsAfter}</td>
            <td class="num">${c.installsBefore}</td><td class="num">${c.installsAfter}</td></tr>`).join('')}</tbody>
        </table></div>`
      : '<p class="note" style="margin-bottom:0">Add one line per thing you do to <span class="mono">.admin/campaigns.txt</span>, like <span class="mono">2026-11-05 Reddit r/chess post</span>. Each gets a before and after here, and a dashed line on the chart.</p>'}
  </section>`;

const accountRows = everyone
  .map(
    (a) => `<tr class="${a.reporting ? '' : 'quiet'}">
      <td class="mono">${esc(short(a.id))}</td>
      <td>${isOwn(a.id) ? '<span class="pill">you</span>' : a.bought ? '<span class="pill pill-paid">bought</span>' : a.entitled ? '<span class="pill">free access</span>' : ''}</td>
      <td class="mono">${esc(a.created ?? '—')}</td>
      <td class="num">${a.reporting ? n(a.lines) : '—'}</td>
      <td class="num">${a.reporting ? n(a.lines_in_training) : '—'}</td>
      <td class="num">${a.reporting ? n(a.drills) : '—'}</td>
      <td class="num">${a.reporting ? n(a.puzzles) : '—'}</td>
      <td class="num">${a.reporting ? n(a.games) : '—'}</td>
      <td class="num">${a.reporting ? n(a.daily) : '—'}</td>
      <td class="num">${a.reporting ? n(a.endgames) : '—'}</td>
      <td class="num">${a.reporting ? n(a.mistakes) : '—'}</td>
      <td class="num">${a.reporting ? n(a.streak) : '—'}</td>
      <td class="num">${a.reporting ? n(a.training_days) : '—'}</td>
      <td class="mono">${esc(a.version ?? '—')}</td>
      <td class="mono">${esc(a.last_active ?? '—')}</td>
    </tr>`,
  )
  .join('');

const html = `<title>Bito Chess — owner dashboard</title>
<style>
  :root {
    color-scheme: light;
    --plane: #f9f9f7; --surface: #fcfcfb;
    --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
    --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11,11,11,0.10);
    --series: #2a78d6; --track: #e9e8e3; --good: #0ca30c;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --plane: #0d0d0d; --surface: #1a1a19;
      --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
      --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
      --series: #3987e5; --track: #2c2c2a; --good: #0ca30c;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--plane); color: var(--ink);
    font: 14px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 32px 20px 64px; }
  header { margin-bottom: 28px; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .sub { color: var(--ink-2); margin: 0; }
  h2 { font-size: 15px; margin: 0 0 4px; letter-spacing: -0.005em; }
  h3 { font-size: 13px; margin: 0 0 4px; color: var(--ink-2); font-weight: 600; }
  .note { color: var(--muted); margin: 0 0 16px; font-size: 13px; }
  section { background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 20px; margin-bottom: 20px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .tile { background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 14px 16px; }
  .tile-v { font-size: 30px; line-height: 1.1; letter-spacing: -0.02em; }
  .tile-l { color: var(--ink-2); font-size: 13px; margin-top: 2px; }
  .tile-n { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media (max-width: 860px) { .cols { grid-template-columns: 1fr; } }
  .bars { display: flex; flex-direction: column; gap: 8px; }
  .bar-row { display: grid; grid-template-columns: 140px 1fr 56px; gap: 10px;
    align-items: center; border-radius: 6px; outline-offset: 2px; }
  .bar-lab { color: var(--ink-2); font-size: 13px; }
  .bar-track { background: var(--track); border-radius: 4px; height: 14px; overflow: hidden; }
  .bar-fill { background: var(--series); height: 100%; border-radius: 4px; min-width: 2px; }
  .bar-val { text-align: right; font-variant-numeric: tabular-nums; color: var(--ink-2); font-size: 13px; }
  .chart { width: 100%; height: auto; display: block; }
  .grid { stroke: var(--grid); stroke-width: 1; }
  .axis { stroke: var(--axis); stroke-width: 1; }
  .tick, .axlab { fill: var(--muted); font-size: 11px; }
  .line { fill: none; stroke: var(--series); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .dot { fill: var(--series); stroke: var(--surface); stroke-width: 2; }
  .empty { color: var(--muted); font-size: 13px; margin: 8px 0 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .scroll { overflow-x: auto; }
  th, td { padding: 7px 10px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--ink-2); }
  tr.quiet td { color: var(--muted); }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; }
  .pill-paid { background: color-mix(in srgb, var(--good) 16%, transparent); color: var(--good); }
  .bar-mark { fill: var(--series); }
  .col:hover .bar-mark, .col:focus .bar-mark, .bar-row:hover .bar-fill { filter: brightness(1.15); }
  .col-val { fill: var(--ink-2); font-size: 11px; font-variant-numeric: tabular-nums; }
  .hair { stroke: var(--axis); stroke-width: 1; opacity: 0; }
  .hit:hover .hair, .hit:focus .hair { opacity: 1; }
  .hit, .col { outline: none; }
  .mark { stroke: var(--ink-2); stroke-width: 1.5; stroke-dasharray: 4 3; }
  .funnel .bar-row { grid-template-columns: 170px 1fr 74px; }
  .bar-lab { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #tip { position: fixed; pointer-events: none; background: var(--ink); color: var(--plane); padding: 4px 8px;
    border-radius: 6px; font-size: 12px; font-variant-numeric: tabular-nums; max-width: 320px; z-index: 9; }
  .warn { border-left: 3px solid var(--series); padding-left: 12px; color: var(--ink-2); font-size: 13px; }
</style>

<div class="wrap">
  <header>
    <h1>Bito Chess — owner dashboard</h1>
    <p class="sub">Generated ${esc(new Date().toLocaleString())} · <span class="mono">npm run admin</span> to refresh</p>
  </header>

  <section>
    <h2>Last 7 days</h2>
    <p class="note">Compared with the 7 days before.</p>
    <div class="tiles">
      ${tile(lastWeek('landing_visit'), 'Landing visits', change(lastWeek('landing_visit'), prevWeek('landing_visit')))}
      ${tile(lastWeek('install'), 'Opened the app', change(lastWeek('install'), prevWeek('install')))}
      ${tile(lastWeek('onboarding_complete'), 'Finished first run', change(lastWeek('onboarding_complete'), prevWeek('onboarding_complete')))}
      ${tile(accountsBetween(daysAgo(7)), 'New accounts', change(accountsBetween(daysAgo(7)), accountsBetween(daysAgo(14), daysAgo(7))))}
      ${tile(activeWithin(7), 'Active accounts', `${activeWithin(30)} in the last 30 days`)}
    </div>
    <div class="tiles" style="margin-top:12px">
      ${tile(`${bought} / ${FOUNDER_SEATS}`, 'Founders', `about €${(bought * NET_PER_SALE).toFixed(0)} net so far`)}
      ${tile(`${(dbBytes / 1024 / 1024).toFixed(1)} MB`, 'Database', `of ${DB_LIMIT_MB} MB on the free plan`)}
      ${tile(backupLabel, 'Last backup', lastBackupDays == null || lastBackupDays > 7 ? 'run bitobackup' : '')}
    </div>
  </section>

  <section>
    <h2>From visit to purchase</h2>
    <p class="note">Counts since ${FUNNEL_FROM}; each percentage compares with the step above. From “Opened the app” on, only devices that allowed counting appear, except Registered, which comes from the accounts. The question was shown ${asked} time${asked === 1 ? '' : 's'}. ${
      drop ? `Biggest drop in 30 days: ${esc(dropFrom)} → ${esc(drop.label)}, ${pct(drop.rate)} continue.` : ''
    }</p>
    <div class="cols">
      <div><h3>Last 7 days</h3>${funnelChart(funnelWeek)}</div>
      <div><h3>Last 30 days</h3>${funnelChart(funnelMonth)}</div>
    </div>
  </section>

  <section>
    <h2>Week by week</h2>
    <p class="note">The last 12 weeks.</p>
    <div class="cols">
      <div><h3>Landing visits</h3>${columns(weekly(visitDays), 'Landing visits')}</div>
      <div><h3>Opened the app</h3>${columns(weekly(dailyEvent('install')), 'Opened the app')}</div>
      <div><h3>Finished first run</h3>${columns(weekly(dailyEvent('onboarding_complete')), 'Finished first run')}</div>
      <div><h3>New accounts</h3>${columns(weekly(newAccountDays), 'New accounts')}</div>
    </div>
    <h3 style="margin-top:20px">Landing visits per day</h3>
    ${lineChart(visitDays.slice(-90), 'Landing visits', campaignRows, 1060)}
    <p class="note" style="margin:12px 0 0">Where visitors come from, their countries and languages: <a href="https://cloud.umami.is">Umami</a>.</p>
  </section>

  ${campaignSection}

  <section>
    <h2>Do they come back?</h2>
    <p class="note">Anonymous counts, so these are shares of installs rather than a followed group, and small numbers swing a lot.</p>
    <div class="tiles">
      ${retentionTile('After 2 days', 'return_after_d2', 2)}
      ${retentionTile('After 7 days', 'return_after_d7', 7)}
      ${retentionTile('After 30 days', 'return_after_d30', 30)}
    </div>
  </section>

  <section>
    <h2>All time</h2>
    <div class="tiles">
      ${tile(accounts.length, 'Accounts', ownIds.length ? 'not counting yours' : '')}
      ${tile(reporting.length, 'Reporting', `${accounts.length - reporting.length} not seen since the summary shipped`)}
      ${tile(accounts.filter((a) => a.entitled).length, 'Full access', `${bought} bought`)}
      ${tile(sum(reporting, 'lines'), 'Lines built', 'across all accounts')}
      ${tile(sum(reporting, 'drills'), 'Drills run')}
      ${tile(sum(reporting, 'puzzles'), 'Puzzles solved')}
    </div>
  </section>

  <section>
    <h2>Do they train, or only build?</h2>
    <p class="note">One dot per reporting account. A dot on the floor built lines and has never run one.</p>
    <div class="cols">
      <div>${scatter(reporting)}</div>
      <div>
        <div class="tiles">
          ${tile(trainers.length, 'Train', 'have run at least one drill')}
          ${tile(builders.length, 'Build only', 'lines enrolled, no drill yet')}
        </div>
        <p class="warn" style="margin-top:16px">
          ${
            reporting.length === 0
              ? 'No account has pushed a summary yet.'
              : `${pct(trainers.length / reporting.length)} of reporting accounts have trained at least once.`
          }
        </p>
      </div>
    </div>
  </section>

  <section>
    <h2>Which features get used at all</h2>
    <p class="note">Share of the ${reporting.length} reporting account${
      reporting.length === 1 ? ' that has' : 's that have'
    } touched each one at least once.</p>
    ${barChart(adoption.map((a) => ({ label: a.label, value: a.share })), { max: 1, format: (v) => pct(v) })}
  </section>

  <section>
    <h2>Over time</h2>
    <p class="note">From the weekly snapshot job — <span class="mono">profiles.stats</span> is overwritten on every push, so this table is the only history there is.</p>
    <div class="cols">
      <div>
        <h3>Lines built, all accounts</h3>
        ${lineChart(history.map((h) => ({ day: h.day, value: n(h.lines) })), 'Lines built')}
      </div>
      <div>
        <h3>Drills run, all accounts</h3>
        ${lineChart(history.map((h) => ({ day: h.day, value: n(h.drills) })), 'Drills run')}
      </div>
    </div>
  </section>

  <section>
    <h2>Anonymous event counts</h2>
    <p class="note">From <span class="mono">public.metrics</span>. No identifier of any kind, so these can never be joined to the accounts above — they count events, never people.</p>
    <div class="cols">
      <div>${barChart(eventTotals.map((e) => ({ label: e.name, value: e.hits })), { format: (v) => String(v) })}</div>
      <div>
        <h3>App opens per day</h3>
        ${lineChart(opensByDay, 'App opens')}
      </div>
    </div>
  </section>

  <section>
    <h2>Every account</h2>
    <p class="note">The table view — everything the charts above are drawn from. A greyed row has not pushed a summary yet, which means "not opened lately", not "has done nothing". Ids are truncated; these numbers are reported by the app and are not proof of anything.</p>
    <div class="scroll">
      <table>
        <thead><tr>
          <th>account</th><th></th><th>joined</th><th class="num">lines</th><th class="num">training</th>
          <th class="num">drills</th><th class="num">puzzles</th><th class="num">games</th>
          <th class="num">daily</th><th class="num">endgames</th><th class="num">mistakes</th>
          <th class="num">streak</th><th class="num">days</th><th>version</th><th>last active</th>
        </tr></thead>
        <tbody>${accountRows}</tbody>
      </table>
    </div>
  </section>
</div>
<div id="tip" hidden></div>
<script>
  // One tooltip for every mark. The text comes from data, so it goes in as text.
  const tip = document.getElementById('tip');
  const place = (x, y) => {
    tip.style.left = Math.min(x + 12, innerWidth - tip.offsetWidth - 8) + 'px';
    tip.style.top = Math.max(y - tip.offsetHeight - 10, 8) + 'px';
  };
  const show = (el, x, y) => { tip.textContent = el.dataset.tip; tip.hidden = false; place(x, y); };
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el) show(el, e.clientX, e.clientY); else tip.hidden = true;
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    show(el, r.left + r.width / 2, r.top);
  });
  document.addEventListener('focusout', () => { tip.hidden = true; });
</script>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html, 'utf-8');
console.log(`\n  ${accounts.length} accounts${ownIds.length ? ' (without yours)' : ''} · ${reporting.length} reporting · ${history.length} day(s) of history`);
console.log(`  → ${OUT}\n`);

if (!process.argv.includes('--no-open')) {
  try {
    execFileSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [OUT], { stdio: 'ignore' });
  } catch {
    /* no opener — the path is printed above, that's enough. */
  }
}
