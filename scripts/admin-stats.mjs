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
//   • public.stats_daily   — a copy of every account's summary per day, taken
//                            by a pg_cron job at 03:17 UTC. The HISTORY, which
//                            profiles.stats cannot give because it is
//                            overwritten on every push.
//   • public.metrics       — (name, day, hits) from the anonymous counter. No
//                            identifier, so it can never be joined to the above.
//                            That is the design, not a limitation of this page.
//
// A fourth, optional source: Umami's REST API, for bitochess.com — the landing
// page only. The trainer itself (bitochess.com/app) deliberately sends nothing
// to Umami or any third party (see the privacy policy), so this is the only
// place traffic toward the app shows up at all, and only as a click-through on
// the "Try Bito Chess" button. Off by default; needs UMAMI_API_KEY in .env (see
// readEnvFile below) and degrades to a "not connected, here's how" message
// without it — every account number above still renders.

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, '.admin/stats.html');

// The landing page's Umami website id — public by construction, it's the
// data-website-id attribute sitting in docs/index.html's page source, sent to
// every visitor's browser already.
const UMAMI_WEBSITE_ID = 'a9c7ad59-9e3c-4670-bb1c-0ec9f875c9e1';
const UMAMI_API = 'https://api.umami.is/v1';

// ── The one privileged call ─────────────────────────────────────────────────

function query(sql) {
  let raw;
  try {
    // The CLI's output format defaults on whether stdout is a terminal: JSON
    // when piped (as it was every time this was tested), a pretty ASCII table
    // when run interactively. `--output-format json` pins it regardless of who
    // is running the command from where.
    raw = execFileSync('supabase', ['db', 'query', '--linked', '--output-format', 'json', sql], {
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
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
  // before the JSON starts, and the JSON itself takes one of two shapes: a
  // bare array of rows with `--output-format json`, or (seen when the format
  // was left to auto-detect) an envelope object with a `rows` field and an
  // untrusted-content `warning`. Handle both rather than assume one — never
  // eval, never trust the text as anything but data.
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

function die(message) {
  console.error(`\n  admin-stats: ${message}\n`);
  process.exit(1);
}

// ── Umami (the landing page's visits) ───────────────────────────────────────
//
// A separate, OPTIONAL credential from the Supabase one above — this script
// still runs and still shows every account/sync number without it. The key
// lives in .env (gitignored, never read by anything else — Vite only inlines
// VITE_-prefixed vars into the app bundle, so this name is deliberately bare)
// because Umami Cloud's API has no equivalent of "the CLI's own stored login"
// to borrow the way the Supabase half does.
function readEnvFile() {
  try {
    const text = readFileSync(resolve(ROOT, '.env'), 'utf-8');
    const out = {};
    for (const line of text.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(line);
      if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

const UMAMI_API_KEY = process.env.UMAMI_API_KEY || readEnvFile().UMAMI_API_KEY || '';

let umamiWarned = false;

// Every Umami call funnels through here so a bad key, a rate limit or a network
// hiccup shows up once, as a note on the page, rather than crashing a dashboard
// whose real point is the account numbers above.
async function umami(path, params) {
  if (!UMAMI_API_KEY) return null;
  const url = new URL(`${UMAMI_API}/websites/${UMAMI_WEBSITE_ID}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${UMAMI_API_KEY}` },
    });
    if (!res.ok) {
      if (!umamiWarned) {
        console.error(`  admin-stats: Umami API returned ${res.status} — landing-page section will be skipped.`);
        umamiWarned = true;
      }
      return null;
    }
    return await res.json();
  } catch (err) {
    if (!umamiWarned) {
      console.error(`  admin-stats: Umami API unreachable (${err.message}) — landing-page section will be skipped.`);
      umamiWarned = true;
    }
    return null;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Umami's REST API has no "unit=day" trend endpoint that returns pre-bucketed
// totals — /stats takes a startAt/endAt range and returns one aggregate for it,
// so a day-by-day trend means one call per day. HISTORY_DAYS calls, well under
// the documented rate limit (50 / 15s), and cheap enough to run on every
// `npm run admin`.
const HISTORY_DAYS = 14;

async function umamiHistory(now) {
  const days = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const end = new Date(start.getTime() + DAY_MS);
    days.push({ day: dayKey(start), startAt: start.getTime(), endAt: Math.min(end.getTime(), now.getTime()) });
  }
  const out = [];
  for (const d of days) {
    const stats = await umami('/stats', { startAt: d.startAt, endAt: d.endAt });
    if (!stats) return null; // one failure — stop rather than show a gappy trend
    out.push({ day: d.day, pageviews: metricValue(stats.pageviews), visits: metricValue(stats.visits) });
  }
  return out;
}

function dayKey(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Umami's /stats has returned two different shapes across versions — a flat
// number per field, and `{ value, prev }` for a period-over-period comparison
// — and this was written without a live key to check which one the account
// this script talks to actually gets. Reading either shape safely costs one
// function; guessing wrong costs every tile silently showing 0.
function metricValue(x) {
  if (x && typeof x === 'object') return Number(x.value ?? 0);
  return Number(x ?? 0);
}

// ── The reads ───────────────────────────────────────────────────────────────

// Every account, with its summary flattened out. `stats` is null for anyone
// whose device has not pushed since the summary shipped — which is "hasn't
// opened the app lately", NOT "has done nothing", and the page says so.
const accounts = query(`
  select
    p.id::text                                  as id,
    p.entitled,
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

// The history the snapshot job accumulates. Totals per day across everyone who
// reported that day.
const history = query(`
  select
    day::text                                            as day,
    count(*)                                             as accounts,
    sum(coalesce((stats->>'lines')::int, 0))             as lines,
    sum(coalesce((stats->>'drillsCompleted')::int, 0))   as drills,
    sum(coalesce((stats->>'puzzlesSolved')::int, 0))     as puzzles
  from public.stats_daily
  group by day
  order by day
`);

// The anonymous counter. Joinable to nothing above, by construction.
const events = query(`
  select name, day::text as day, hits
  from public.metrics
  order by day, name
`);

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

// ── Umami (bitochess.com, the landing page only) ───────────────────────────
//
// A separate range from the account/event queries above (which cover
// everything ever recorded): the last 30 days, because Umami holds full
// history and pulling all of it on every run would only get slower over time
// for no benefit — a dashboard refreshed on demand wants recent numbers.
const now = new Date();
const rangeStart = now.getTime() - 30 * DAY_MS;

const umamiStats = await umami('/stats', { startAt: rangeStart, endAt: now.getTime() });
const umamiPages = (await umami('/metrics/expanded', { startAt: rangeStart, endAt: now.getTime(), type: 'path', limit: 8 })) ?? [];
const umamiReferrers = (await umami('/metrics/expanded', { startAt: rangeStart, endAt: now.getTime(), type: 'referrer', limit: 8 })) ?? [];
const umamiCtaEvents = (await umami('/metrics/expanded', { startAt: rangeStart, endAt: now.getTime(), type: 'event', limit: 12 })) ?? [];
const umamiTrend = umamiStats ? await umamiHistory(now) : null;

const umamiConfigured = Boolean(UMAMI_API_KEY);
const umamiOk = Boolean(umamiStats);

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
      return `<div class="bar-row" tabindex="0" title="${esc(r.label)}: ${esc(format(r.value))}">
        <div class="bar-lab">${esc(r.label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${w.toFixed(1)}%"></div></div>
        <div class="bar-val">${esc(format(r.value))}</div>
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
        (r) => `<circle class="dot" cx="${x(r.lines)}" cy="${y(r.drills)}" r="6"><title>${esc(short(r.id))} — ${n(
          r.lines,
        )} lines, ${n(r.drills)} drills</title></circle>`,
      )
      .join('')}
  </svg>`;
}

// A single series over time. Two measures of different scale get two charts,
// never two y-axes on one.
function lineChart(points, label) {
  if (points.length < 2) {
    return `<p class="empty">${esc(label)} — one day recorded so far. A trend needs at least two; the snapshot job adds a day at 03:17 UTC.</p>`;
  }
  const W = 560, H = 200, P = { t: 16, r: 16, b: 32, l: 52 };
  const max = Math.max(...points.map((p) => p.value), 1);
  const x = (i) => P.l + (i / Math.max(points.length - 1, 1)) * (W - P.l - P.r);
  const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(label)} over time">
    ${[0, max / 2, max].map((v) => `<line class="grid" x1="${P.l}" y1="${y(v)}" x2="${W - P.r}" y2="${y(v)}"/>
      <text class="tick" x="${P.l - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`).join('')}
    <path class="line" d="${d}"/>
    ${points.map((p, i) => `<circle class="dot" cx="${x(i)}" cy="${y(p.value)}" r="5"><title>${esc(p.day)}: ${p.value}</title></circle>`).join('')}
    ${points.map((p, i) => (i === 0 || i === points.length - 1
      ? `<text class="tick" x="${x(i)}" y="${H - P.b + 18}" text-anchor="${i ? 'end' : 'start'}">${esc(p.day)}</text>`
      : '')).join('')}
  </svg>`;
}

// The landing-page section: three states, not one. Most of what can go wrong
// here is outside this script entirely (no key yet, a revoked key, Umami down)
// so each gets its own honest message rather than a stack trace or a silently
// empty chart.
function umamiSection() {
  if (!umamiConfigured) {
    return `<p class="empty">Not connected. Generate a key in Umami Cloud → your profile → Settings → API keys, then add to <span class="mono">.env</span> in the project root:</p>
      <p class="mono" style="margin:8px 0 0">UMAMI_API_KEY=your-key-here</p>
      <p class="empty" style="margin-top:8px">.env is gitignored — the key never leaves this machine.</p>`;
  }
  if (!umamiOk) {
    return `<p class="empty">Couldn't reach the Umami API with the key in .env — it may be wrong, revoked, or Umami may be down. Everything else on this page is unaffected.</p>`;
  }
  const visits = metricValue(umamiStats.visits);
  const bounces = metricValue(umamiStats.bounces);
  const bounceRate = visits > 0 ? bounces / visits : 0;
  const ctaTotal = umamiCtaEvents.reduce((t, e) => t + n(e.pageviews ?? e.total), 0);

  return `
    <div class="tiles" style="margin-bottom:16px">
      ${tile(metricValue(umamiStats.pageviews), 'Pageviews')}
      ${tile(metricValue(umamiStats.visitors), 'Visitors')}
      ${tile(visits, 'Visits')}
      ${tile(pct(bounceRate), 'Bounce rate')}
    </div>
    <div class="cols">
      <div>
        <h3>Visits per day</h3>
        ${umamiTrend ? lineChart(umamiTrend.map((d) => ({ day: d.day, value: d.visits })), 'Visits') : '<p class="empty">Trend unavailable this run.</p>'}
      </div>
      <div>
        <h3>Top pages</h3>
        ${barChart(
          umamiPages.map((p) => ({ label: p.name || '/', value: n(p.pageviews) })),
          { format: (v) => String(v) },
        )}
      </div>
    </div>
    <div class="cols" style="margin-top:16px">
      <div>
        <h3>Top referrers</h3>
        ${barChart(
          umamiReferrers.map((r) => ({ label: r.name || '(direct)', value: n(r.pageviews) })),
          { format: (v) => String(v) },
        )}
      </div>
      <div>
        <h3>Button clicks (data-umami-event)</h3>
        <p class="note" style="margin-bottom:8px">"cta-*" rows are click-throughs into the app — the nearest thing to "opened from the landing page" this section can see. ${ctaTotal} total.</p>
        ${barChart(
          umamiCtaEvents.map((e) => ({ label: e.name, value: n(e.pageviews ?? e.total) })),
          { format: (v) => String(v) },
        )}
      </div>
    </div>`;
}

const accountRows = accounts
  .map(
    (a) => `<tr class="${a.reporting ? '' : 'quiet'}">
      <td class="mono">${esc(short(a.id))}</td>
      <td>${a.entitled ? '<span class="pill pill-paid">paid</span>' : ''}</td>
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
  .warn { border-left: 3px solid var(--series); padding-left: 12px; color: var(--ink-2); font-size: 13px; }
</style>

<div class="wrap">
  <header>
    <h1>Bito Chess — owner dashboard</h1>
    <p class="sub">Generated ${esc(new Date().toLocaleString())} · <span class="mono">npm run admin</span> to refresh</p>
  </header>

  <section>
    <div class="tiles">
      ${tile(accounts.length, 'Accounts')}
      ${tile(reporting.length, 'Reporting', `${accounts.length - reporting.length} not seen since the summary shipped`)}
      ${tile(accounts.filter((a) => a.entitled).length, 'Paid')}
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
    <p class="note">From the daily snapshot job — <span class="mono">profiles.stats</span> is overwritten on every push, so this table is the only history there is.</p>
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
    <h2>Landing page (bitochess.com)</h2>
    <p class="note">From Umami, last 30 days. This is the ONE place traffic to the app itself shows up at all: the trainer (bitochess.com/app) deliberately sends nothing to Umami or any third party — see the privacy policy — so page-view numbers exist for the landing page only. The "Try Bito Chess" row below is a click-through count, the closest thing to "how many people opened the app" that this section can see.</p>
    ${umamiSection()}
  </section>

  <section>
    <h2>Every account</h2>
    <p class="note">The table view — everything the charts above are drawn from. A greyed row has not pushed a summary yet, which means "not opened lately", not "has done nothing". Ids are truncated; these numbers are reported by the app and are not proof of anything.</p>
    <div class="scroll">
      <table>
        <thead><tr>
          <th>account</th><th></th><th class="num">lines</th><th class="num">training</th>
          <th class="num">drills</th><th class="num">puzzles</th><th class="num">games</th>
          <th class="num">daily</th><th class="num">endgames</th><th class="num">mistakes</th>
          <th class="num">streak</th><th class="num">days</th><th>version</th><th>last active</th>
        </tr></thead>
        <tbody>${accountRows}</tbody>
      </table>
    </div>
  </section>
</div>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html, 'utf-8');
console.log(`\n  ${accounts.length} accounts · ${reporting.length} reporting · ${history.length} day(s) of history`);
console.log(`  → ${OUT}\n`);

if (!process.argv.includes('--no-open')) {
  try {
    execFileSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [OUT], { stdio: 'ignore' });
  } catch {
    /* no opener — the path is printed above, that's enough. */
  }
}
