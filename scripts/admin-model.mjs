// The owner dashboard's numbers: rows from the database in, what the page shows
// out. No I/O, so the page can be rehearsed with made-up data.
//
// App counts are anonymous, so a step compares two counts for one period rather
// than following a group. Three rules keep those comparisons honest:
//   • Before the new counts have ever fired, their steps say "not counting yet"
//     rather than 0, because a zero would read as failure.
//   • Once they fire, the funnel reaches back no further than that day. Old
//     installs have no visits or scans to compare with.
//   • A change on the period before only shows when that whole period was counted.

const DAY_MS = 24 * 60 * 60 * 1000;
const FOUNDER_SEATS = 100;
const NET_PER_SALE = 9.18; // €12 less 25% VAT and Stripe's fee.
const DB_LIMIT_MB = 500;
const BACKUP_DUE_DAYS = 7;
const MIN_BASE_FOR_DROP = 10;

const n = (v) => Number(v ?? 0);
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);

const METRICS = {
  visits: { label: 'Visited the landing page', stage: 'landing', event: 'landing_visit', isNew: true },
  tries: { label: 'Pressed a try button', stage: 'landing', event: 'landing_try', isNew: true },
  opened: { label: 'Opened the app', stage: 'app', event: 'install' },
  scanned: { label: 'Scanned their games', stage: 'app', event: 'first_games_imported', isNew: true },
  mistakes: { label: 'Mistake scan finished', stage: 'app', event: 'first_scan_done', isNew: true },
  used: { label: 'Used the app', stage: 'app', event: 'first_interaction', isNew: true },
  registered: { label: 'Registered', stage: 'commit' },
  back2: { label: 'Trained again after 2 days', stage: 'app', event: 'return_after_d2' },
  // Counted per launch rather than per device, so these say how often, not how many.
  offer: { label: 'Pro offer shown (times)', stage: 'app', event: 'pro_sheet_shown', times: true },
  checkout: { label: 'Checkout started (times)', stage: 'commit', event: 'checkout_started', times: true },
  bought: { label: 'Bought', stage: 'commit' },
};
const KPIS = [
  { id: 'visits', label: 'Visitors' },
  { id: 'scanned', label: 'Scanned their games' },
  { id: 'used', label: 'Used the app' },
  { id: 'registered', label: 'Registered' },
];
const START_STEPS = ['visits', 'tries', 'opened', 'scanned', 'mistakes', 'used', 'registered'];
const STAY_STEPS = ['used', 'back2', 'offer', 'checkout', 'bought'];
const PERIODS = [
  { key: '7', label: '7 days', long: 'Last 7 days', days: 7 },
  { key: '30', label: '30 days', long: 'Last 30 days', days: 30 },
  { key: 'all', label: 'All time', long: 'All time', days: null },
];
const USAGE = [
  ['Training sessions', 'drill_completed'],
  ['Puzzle sessions', 'puzzle_session'],
  ['Daily challenges', 'daily_completed'],
  ['Game imports', 'games_imported'],
  ['Endgames solved', 'endgame_solved'],
  ['Lines saved', 'line_saved'],
  ['Starter packs added', 'starter_pack_added'],
];
const FEATURES = [
  ['Built lines', 'lines'],
  ['Trained a line', 'drills'],
  ['Imported games', 'games'],
  ['Solved puzzles', 'puzzles'],
  ['Daily challenge', 'daily'],
  ['Endgames', 'endgames'],
  ['Mistake drills', 'mistakes'],
];

export function buildModel({ everyone, history, events, dbBytes, campaigns = [], lastBackupDays = null, ownIds = [], now = Date.now() }) {
  const today = dayStr(now);
  const daysAgo = (d) => dayStr(now - d * DAY_MS);
  const shift = (day, by) => dayStr(Date.parse(`${day}T00:00:00Z`) + by * DAY_MS);
  const isOwn = (id) => ownIds.some((own) => String(id).startsWith(own));
  const accounts = everyone.filter((a) => !isOwn(a.id));
  const reporting = accounts.filter((a) => a.reporting);

  const hits = (name, from = '0000', to = '9999') =>
    events.filter((e) => e.name === name && e.day >= from && e.day < to).reduce((t, e) => t + n(e.hits), 0);
  const countOf = (id, from = '0000', to = '9999') => {
    const m = METRICS[id];
    if (m.event) return hits(m.event, from, to);
    if (id === 'bought') return accounts.filter((a) => a.bought && a.bought_on >= from && a.bought_on < to).length;
    return accounts.filter((a) => a.created >= from && a.created < to).length;
  };
  const daily = (name) => events.filter((e) => e.name === name).map((e) => ({ day: e.day, value: n(e.hits) }));
  const dailyOf = (id) => {
    const m = METRICS[id];
    if (m.event) return daily(m.event);
    if (id === 'bought') return accounts.filter((a) => a.bought && a.bought_on).map((a) => ({ day: a.bought_on, value: 1 }));
    return accounts.filter((a) => a.created).map((a) => ({ day: a.created, value: 1 }));
  };

  const newDays = events.filter((e) => Object.values(METRICS).some((m) => m.isNew && m.event === e.name)).map((e) => e.day).sort();
  const live = newDays.length > 0;
  const countingFrom = live ? newDays[0] : null;
  const counting = (id) => live || !METRICS[id].isNew;

  function weekly(rows, weeks = 12) {
    const monday = (ms) => {
      const d = new Date(ms);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    };
    const first = monday(now) - (weeks - 1) * 7 * DAY_MS;
    const out = Array.from({ length: weeks }, (_, i) => ({ day: dayStr(first + i * 7 * DAY_MS), value: 0 }));
    for (const r of rows) {
      const i = Math.round((monday(Date.parse(`${r.day}T00:00:00Z`)) - first) / (7 * DAY_MS));
      if (i >= 0 && i < weeks) out[i].value += r.value;
    }
    return out;
  }

  // The rows for one funnel. A step that isn't counted yet is skipped when working
  // out the next step's share, so the share still compares two real numbers.
  function funnel(ids, from) {
    let base = null;
    const rows = ids.map((id, i) => {
      const on = counting(id);
      const value = on ? countOf(id, from) : null;
      const row = { id, label: METRICS[id].label, stage: METRICS[id].stage, value, counting: on, prevLabel: base?.label ?? null };
      const comparable = !METRICS[id].times && !(base && METRICS[base.id].times);
      if (on && comparable && base && base.value > 0 && value <= base.value) row.rate = value / base.value;
      // With uncounted steps in between, the share is real but isn't one step's drop.
      row.skipped = on && base !== null && ids[i - 1] !== base.id;
      if (on) base = row;
      return row;
    });
    const candidates = rows.filter((r) => {
      const prev = rows.find((p) => p.label === r.prevLabel);
      return r.rate !== undefined && r.rate < 1 && !r.skipped && prev && prev.value >= MIN_BASE_FOR_DROP;
    });
    const leak = candidates.reduce((worst, r) => (!worst || r.rate < worst.rate ? r : worst), null);
    if (leak) leak.leak = true;
    return { rows, leak };
  }

  const periods = PERIODS.map((p) => {
    const from = p.days ? daysAgo(p.days) : '0000';
    const before = p.days ? daysAgo(p.days * 2) : null;
    const funnelFrom = live && countingFrom > from ? countingFrom : from;
    const kpis = KPIS.map(({ id, label }) => {
      const on = counting(id);
      const value = on ? countOf(id, from) : null;
      const comparable = before && on && (!METRICS[id].isNew || (countingFrom && countingFrom <= before));
      return {
        id,
        label,
        counting: on,
        value,
        delta: comparable ? value - countOf(id, before, from) : null,
        spark: on ? weekly(dailyOf(id)) : null,
      };
    });
    const start = funnel(START_STEPS, funnelFrom);
    const stay = funnel(STAY_STEPS, funnelFrom);
    return {
      ...p,
      kpis,
      start,
      stay,
      funnelSince: live && countingFrom > from ? countingFrom : null,
      story: storyOf(p.long, start),
    };
  });

  function storyOf(long, f) {
    const say = {
      visits: (v) => `${v.toLocaleString('en')} visit${v === 1 ? '' : 's'}`,
      opened: (v) => `${v.toLocaleString('en')} opened the app`,
      scanned: (v) => `${v.toLocaleString('en')} scanned their games`,
      used: (v) => `${v.toLocaleString('en')} used the app`,
      registered: (v) => `${v.toLocaleString('en')} registered`,
    };
    const parts = f.rows.filter((r) => say[r.id] && r.counting).map((r) => say[r.id](r.value));
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] ?? 'nothing yet';
    return `${long}: ${list}.`;
  }

  // Of those who could have by now: first training at least N days ago. A return in
  // the counts' first N days can only be someone who started before counting began,
  // with no start to set it against, so those days don't count. Before the new counts
  // fire, these are the old numbers: opened the app again, against installs.
  const firstDay = live ? countingFrom : events.reduce((d, e) => (e.day < d ? e.day : d), today);
  const startEvent = live ? 'first_interaction' : 'install';
  const retention = [
    ['After 2 days', 'return_after_d2', 2],
    ['After 7 days', 'return_after_d7', 7],
    ['After 30 days', 'return_after_d30', 30],
  ].map(([label, name, days]) => {
    const returned = hits(name, shift(firstDay, days));
    const eligible = hits(startEvent, live ? countingFrom : '0000', daysAgo(days));
    return { label, returned, eligible, share: eligible ? Math.min(returned / eligible, 1) : null };
  });

  const visitRows = daily('landing_visit');
  const dailyVisits = [];
  if (visitRows.length) {
    const firstVisit = visitRows.map((r) => r.day).sort()[0];
    for (let i = 59; i >= 0; i--) {
      const day = daysAgo(i);
      if (day >= firstVisit) dailyVisits.push({ day, value: visitRows.filter((r) => r.day === day).reduce((t, r) => t + r.value, 0) });
    }
  }

  const sumIn = (name, from, to) => hits(name, from, to);
  const campaignRows = campaigns.map((c) => {
    const before = shift(c.day, -7);
    const after = shift(c.day, 7);
    return {
      ...c,
      visitsBefore: sumIn('landing_visit', before, c.day),
      visitsAfter: sumIn('landing_visit', c.day, after),
      openedBefore: sumIn('install', before, c.day),
      openedAfter: sumIn('install', c.day, after),
      partial: after > today,
    };
  });

  const bought = accounts.filter((a) => a.bought).length;
  const dbMb = dbBytes / 1024 / 1024;
  const activeWithin = (d) => reporting.filter((a) => a.last_active && a.last_active >= daysAgo(d)).length;

  const eventTotals = [...events.reduce((m, e) => m.set(e.name, (m.get(e.name) ?? 0) + n(e.hits)), new Map())]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);

  return {
    now,
    live,
    countingFrom,
    periods,
    trends: [
      { id: 'visits', label: 'Visits' },
      { id: 'opened', label: 'Opened the app' },
      { id: 'used', label: 'Used the app' },
      { id: 'registered', label: 'Registered' },
    ].map((t) => ({ ...t, counting: counting(t.id), weeks: counting(t.id) ? weekly(dailyOf(t.id)) : null })),
    dailyVisits,
    campaigns: campaignRows,
    retention,
    usage: USAGE.map(([label, name]) => ({ label, value: hits(name, daysAgo(30)) })),
    business: {
      founders: { bought, seats: FOUNDER_SEATS, net: bought * NET_PER_SALE },
      db: { mb: dbMb, limit: DB_LIMIT_MB, share: dbMb / DB_LIMIT_MB },
      backup: { days: lastBackupDays, due: lastBackupDays == null || lastBackupDays > BACKUP_DUE_DAYS },
      accounts: accounts.length,
      active7: activeWithin(7),
      active30: activeWithin(30),
      ownCount: everyone.length - accounts.length,
    },
    detail: {
      everyone: everyone.map((a) => ({ ...a, own: isOwn(a.id) })),
      adoption: FEATURES.map(([label, key]) => ({
        label,
        count: reporting.filter((a) => n(a[key]) > 0).length,
        share: reporting.length ? reporting.filter((a) => n(a[key]) > 0).length / reporting.length : 0,
      })),
      reportingCount: reporting.length,
      eventTotals,
      opensByDay: daily('app_open').slice(-90),
      history: history.map((h) => ({ day: h.day, lines: n(h.lines), drills: n(h.drills) })),
    },
  };
}
