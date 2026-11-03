// The owner dashboard's page: the model from admin-model.mjs turned into one
// self-contained HTML file. Your four numbers first, then where people stop, then
// the trend. Everything raw is folded away at the bottom.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => `${Math.round(x * 100)}%`;
const num = (v) => Number(v ?? 0).toLocaleString('en');
const short = (id) => String(id ?? '').slice(0, 8);
const niceDay = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const NOT_YET = 'Starts with the next deploy';

// A 12-week trend inside a tile. Recedes, with the current week as the accent.
function spark(points) {
  const W = 200, H = 40, P = 4;
  const max = Math.max(...points.map((p) => p.value), 1);
  const x = (i) => P + (i / (points.length - 1)) * (W - 2 * P);
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const left = (x(points.length - 1) / W) * 100;
  const top = (y(last.value) / H) * 100;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path class="spark-line" vector-effect="non-scaling-stroke" d="${d}"/></svg>
    <span class="spark-dot" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%"></span>`;
}

function kpi(k, period) {
  if (!k.counting) {
    return `<div class="kpi"><div class="kpi-l">${esc(k.label)}</div><div class="kpi-v kpi-none">–</div><div class="kpi-d">${NOT_YET}</div></div>`;
  }
  const delta = k.delta == null
    ? ''
    : k.delta === 0
      ? '<div class="kpi-d">Same as the period before</div>'
      : `<div class="kpi-d ${k.delta > 0 ? 'up' : 'down'}"><span aria-hidden="true">${k.delta > 0 ? '▲' : '▼'}</span> ${k.delta > 0 ? '+' : '−'}${num(Math.abs(k.delta))} on the period before</div>`;
  const tip = k.spark ? `${k.label}, last 12 weeks: ${k.spark.map((p) => p.value).join(', ')}` : '';
  return `<div class="kpi" tabindex="0" data-tip="${esc(tip)}">
    <div class="kpi-l">${esc(k.label)}</div>
    <div class="kpi-v">${num(k.value)}</div>
    ${delta || `<div class="kpi-d">${esc(period.long)}</div>`}
    ${k.spark ? `<div class="spark-wrap">${spark(k.spark)}</div>` : ''}
  </div>`;
}

// One step per row. The width is the count; the text between rows says how many
// carried on, and the biggest drop is the one thing here allowed to stand out. The
// shade says where the step happens, which says what would have to change.
function funnelChart(f) {
  const max = Math.max(...f.rows.map((r) => r.value ?? 0), 1);
  return `<div class="funnel">${f.rows.map((r) => {
    const link = r.rate === undefined
      ? ''
      : r.skipped
        ? `<div class="link">${pct(r.rate)} of ${esc(r.prevLabel.toLowerCase())}</div>`
        : r.leak
        ? `<div class="link leak"><span aria-hidden="true">▼</span> Biggest drop: ${pct(r.rate)} continue</div>`
        : `<div class="link">${pct(r.rate)} continue</div>`;
    if (!r.counting) {
      return `<div class="step off"><div class="step-l">${esc(r.label)}</div><div class="step-t"></div><div class="step-v">–</div></div>`;
    }
    const w = (r.value / max) * 100;
    return `${link}<div class="step" tabindex="0" data-tip="${esc(r.label)}: ${num(r.value)}">
      <div class="step-l">${esc(r.label)}</div>
      <div class="step-t">${r.value ? `<div class="step-f" style="width:${w.toFixed(1)}%;background:var(--${r.stage})"></div>` : ''}</div>
      <div class="step-v">${num(r.value)}</div>
    </div>`;
  }).join('')}</div>`;
}

function meter(label, value, share, note, tone = '') {
  return `<div class="meter" tabindex="0" data-tip="${esc(label)}: ${esc(value)}">
    <div class="meter-top"><span class="meter-l">${esc(label)}</span><span class="meter-v">${esc(value)}</span></div>
    <div class="meter-t"><div class="meter-f ${tone}" style="width:${Math.max(share * 100, share > 0 ? 1 : 0).toFixed(1)}%"></div></div>
    ${note ? `<div class="meter-n">${esc(note)}</div>` : ''}
  </div>`;
}

function statusLine(label, text, good, note) {
  return `<div class="status">
    <div class="meter-top"><span class="meter-l">${esc(label)}</span>
      <span class="badge ${good ? 'good' : 'warn'}"><span aria-hidden="true">${good ? '✓' : '!'}</span> ${esc(text)}</span></div>
    ${note ? `<div class="meter-n">${note}</div>` : ''}
  </div>`;
}

function bars(rows, format = (v) => num(v), top = null) {
  const max = top ?? Math.max(...rows.map((r) => r.value), 1);
  return `<div class="bars">${rows.map((r) => `<div class="bar" tabindex="0" data-tip="${esc(r.label)}: ${esc(format(r.value))}">
    <div class="bar-l">${esc(r.label)}</div>
    <div class="bar-t">${r.value ? `<div class="bar-f" style="width:${((r.value / max) * 100).toFixed(1)}%"></div>` : ''}</div>
    <div class="bar-v">${esc(format(r.value))}</div></div>`).join('')}</div>`;
}

// Columns per week. The highest and the newest carry a number and the rest are on
// hover. This week is lighter because it isn't over. A tick marks a campaign.
function columns(points, label, marks = []) {
  const W = 300, H = 150, P = { t: 20, r: 2, b: 22, l: 2 };
  const max = Math.max(...points.map((p) => p.value), 1);
  const band = (W - P.l - P.r) / points.length;
  const peak = points.findIndex((p) => p.value === max);
  const base = H - P.b;
  const scale = base - P.t;
  const body = points.map((p, i) => {
    const x = P.l + i * band + 1;
    const w = band - 2;
    const h = p.value ? Math.max((p.value / max) * scale, 2) : 0;
    const r = Math.min(3, h, w / 2);
    const current = i === points.length - 1;
    const named = p.value && (i === peak || current);
    const next = points[i + 1]?.day ?? '9999';
    const marked = marks.filter((m) => m.day >= p.day && m.day < next);
    return `<g class="col" tabindex="0" data-tip="${esc(current ? 'This week so far' : `Week of ${niceDay(p.day)}`)}: ${num(p.value)}${marked.length ? ` · ${esc(marked.map((m) => m.note).join(', '))}` : ''}">
      <rect x="${x}" y="${P.t}" width="${w}" height="${scale}" fill="transparent"/>
      ${h ? `<path class="col-f${current ? ' now' : ''}" d="M${x} ${base}v${-(h - r)}q0 ${-r} ${r} ${-r}h${w - 2 * r}q${r} 0 ${r} ${r}v${h - r}z"/>` : ''}
      ${named ? `<text class="col-v" x="${x + w / 2}" y="${base - h - 5}" text-anchor="middle">${num(p.value)}</text>` : ''}
      ${marked.length ? `<path class="col-m" d="M${x + w / 2 - 4} ${H - 12}h8l-4 -6z"/>` : ''}
    </g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(label)} per week, last 12 weeks">
    <line class="axis" x1="${P.l}" y1="${base}" x2="${W - P.r}" y2="${base}"/>${body}
    <text class="tick" x="${P.l}" y="${H - 1}">${esc(niceDay(points[0].day))}</text>
    <text class="tick" x="${W - P.r}" y="${H - 1}" text-anchor="end">this week</text>
  </svg>`;
}

// A series by day. The hit target is a whole column with a hairline, so nobody has
// to aim at a 2px line. A solid line with a label marks a campaign.
function lineChart(points, label, marks = [], W = 560) {
  if (points.length < 2) return `<p class="empty">${esc(label)}: not enough days yet.</p>`;
  const H = 180, P = { t: 18, r: 12, b: 26, l: 36 };
  const max = Math.max(...points.map((p) => p.value), 1);
  const x = (i) => P.l + (i / (points.length - 1)) * (W - P.l - P.r);
  const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const step = (W - P.l - P.r) / (points.length - 1);
  const flags = marks.map((m) => ({ ...m, i: points.findIndex((p) => p.day === m.day) })).filter((m) => m.i >= 0)
    .map((m) => `<line class="flag" x1="${x(m.i)}" y1="${P.t}" x2="${x(m.i)}" y2="${H - P.b}"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(label)} per day">
    ${[0, max].map((v) => `<line class="grid" x1="${P.l}" y1="${y(v)}" x2="${W - P.r}" y2="${y(v)}"/>
      <text class="tick" x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end">${num(Math.round(v))}</text>`).join('')}
    ${flags}
    <path class="line" d="${d}"/>
    ${points.map((p, i) => `<g class="hit" tabindex="0" data-tip="${esc(niceDay(p.day))}: ${num(p.value)}${marks.filter((m) => m.day === p.day).map((m) => ` · ${esc(m.note)}`).join('')}">
      <rect x="${(x(i) - step / 2).toFixed(1)}" y="${P.t}" width="${Math.max(step, 2).toFixed(1)}" height="${H - P.t - P.b}" fill="transparent"/>
      <line class="hair" x1="${x(i)}" y1="${P.t}" x2="${x(i)}" y2="${H - P.b}"/></g>`).join('')}
    <text class="tick" x="${P.l}" y="${H - 6}">${esc(niceDay(points[0].day))}</text>
    <text class="tick" x="${W - P.r}" y="${H - 6}" text-anchor="end">${esc(niceDay(points[points.length - 1].day))}</text>
  </svg>`;
}

function legend(stages) {
  const names = { landing: 'Landing page', app: 'In the app', commit: 'Signing up and paying' };
  return `<div class="legend">${stages.map((k) => `<span><i style="background:var(--${k})"></i>${names[k]}</span>`).join('')}</div>`;
}

const backupText = (days) => (days == null ? 'None yet' : days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`);

function accountTable(rows) {
  const cell = (a, v) => `<td class="num">${a.reporting ? num(v) : '–'}</td>`;
  return `<div class="scroll"><table>
    <thead><tr><th>account</th><th></th><th>joined</th><th class="num">lines</th><th class="num">drills</th>
      <th class="num">puzzles</th><th class="num">games</th><th class="num">daily</th><th class="num">endgames</th>
      <th class="num">mistakes</th><th class="num">days</th><th>version</th><th>last active</th></tr></thead>
    <tbody>${rows.map((a) => `<tr class="${a.reporting ? '' : 'quiet'}">
      <td class="mono">${esc(short(a.id))}</td>
      <td>${a.own ? '<span class="pill">you</span>' : a.bought ? '<span class="pill paid">bought</span>' : a.entitled ? '<span class="pill">free access</span>' : ''}</td>
      <td class="mono">${esc(a.created ?? '–')}</td>
      ${cell(a, a.lines)}${cell(a, a.drills)}${cell(a, a.puzzles)}${cell(a, a.games)}${cell(a, a.daily)}${cell(a, a.endgames)}${cell(a, a.mistakes)}${cell(a, a.training_days)}
      <td class="mono">${esc(a.version ?? '–')}</td><td class="mono">${esc(a.last_active ?? '–')}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

const CSS = `
  :root {
    color-scheme: light;
    --plane: #f9f9f7; --surface: #fcfcfb;
    --ink: #0b0b0b; --ink-2: #52514e; --muted: #6f6d68;
    --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11,11,11,0.10);
    --series: #2a78d6; --series-soft: #86b6ef; --track: #e9e8e3; --meter-track: #cde2fb;
    --good: #006300; --bad: #b02a2a; --warn-bg: #fef1d3; --warn-ink: #6b4a00; --good-bg: #dcf3dc;
    --leak: #d03b3b; --tip-bg: #0b0b0b; --tip-ink: #f9f9f7;
    --landing: #184f95; --app: #2a78d6; --commit: #6da7ec;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --plane: #0d0d0d; --surface: #1a1a19;
      --ink: #ffffff; --ink-2: #c3c2b7; --muted: #a09e97;
      --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
      --series: #3987e5; --series-soft: #1c5cab; --track: #2c2c2a; --meter-track: #104281;
      --good: #4fc94f; --bad: #f08080; --warn-bg: #3d2f0a; --warn-ink: #fab219; --good-bg: #143314;
      --leak: #ec6a6a; --tip-bg: #ffffff; --tip-ink: #0d0d0d;
      --landing: #9ec5f4; --app: #5598e7; --commit: #256abf;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --plane: #0d0d0d; --surface: #1a1a19;
    --ink: #ffffff; --ink-2: #c3c2b7; --muted: #a09e97;
    --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
    --series: #3987e5; --series-soft: #1c5cab; --track: #2c2c2a; --meter-track: #104281;
    --good: #4fc94f; --bad: #f08080; --warn-bg: #3d2f0a; --warn-ink: #fab219; --good-bg: #143314;
    --leak: #ec6a6a; --tip-bg: #ffffff; --tip-ink: #0d0d0d;
    --landing: #9ec5f4; --app: #5598e7; --commit: #256abf;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--plane); color: var(--ink);
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 28px 20px 64px; }
  header { display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center; justify-content: space-between; margin-bottom: 18px; }
  h1 { font-size: 20px; margin: 0; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 12.5px; margin: 2px 0 0; }
  .switch { display: inline-flex; padding: 3px; background: var(--track); border-radius: 10px; }
  .switch button { border: 0; background: none; font: inherit; font-size: 13px; color: var(--ink-2);
    padding: 6px 14px; min-height: 34px; border-radius: 8px; cursor: pointer; }
  .switch button[aria-pressed="true"] { background: var(--surface); color: var(--ink); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,0.14); }
  .story { font-size: 19px; line-height: 1.35; letter-spacing: -0.01em; margin: 0 0 14px; }
  .notice { display: flex; gap: 10px; background: var(--warn-bg); color: var(--warn-ink); border-radius: 10px;
    padding: 10px 14px; font-size: 13.5px; margin: 0 0 14px; }
  .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
  @media (max-width: 860px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .kpi, section { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
  .kpi { padding: 14px 16px 10px; min-width: 0; outline-offset: 2px; }
  .kpi-l { color: var(--ink-2); font-size: 13px; }
  .kpi-v { font-size: 40px; line-height: 1.15; font-weight: 600; letter-spacing: -0.02em; }
  .kpi-none { color: var(--axis); }
  .kpi-d { color: var(--muted); font-size: 12px; min-height: 18px; }
  .kpi-d.up { color: var(--good); }
  .kpi-d.down { color: var(--bad); }
  .spark-wrap { position: relative; height: 40px; margin-top: 6px; }
  .spark { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .spark-line { fill: none; stroke: var(--series-soft); stroke-width: 2; stroke-linejoin: round; }
  .spark-dot { position: absolute; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; background: var(--series); }
  section { padding: 18px 20px; margin-bottom: 16px; min-width: 0; }
  h2 { font-size: 15px; margin: 0 0 2px; letter-spacing: -0.005em; }
  h3 { font-size: 13px; margin: 0 0 6px; color: var(--ink-2); font-weight: 600; }
  .note { color: var(--muted); margin: 0 0 14px; font-size: 12.5px; }
  .grid-2 { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  .grid-2 > section { margin-bottom: 0; }
  .grid-2 { margin-bottom: 16px; }
  @media (max-width: 860px) { .grid-2 { grid-template-columns: minmax(0, 1fr); } }
  .funnel { display: flex; flex-direction: column; }
  .step { display: grid; grid-template-columns: 180px minmax(0, 1fr) 56px; gap: 12px; align-items: center; padding: 3px 0; outline-offset: 2px; border-radius: 4px; }
  .step-l { font-size: 13.5px; }
  .step-t { background: var(--track); height: 22px; border-radius: 0 4px 4px 0; overflow: hidden; }
  .step-f { height: 100%; min-width: 2px; border-radius: 0 4px 4px 0; }
  .step-v { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; font-size: 15px; }
  .step.off .step-l, .step.off .step-v { color: var(--muted); }
  .step.off .step-t { background: repeating-linear-gradient(135deg, var(--track) 0 6px, transparent 6px 12px); }
  .link { padding-left: 192px; color: var(--muted); font-size: 12px; line-height: 16px; }
  .link.leak { color: var(--leak); font-weight: 600; }
  @media (max-width: 560px) {
    .step { grid-template-columns: minmax(0, 1fr) 50px; }
    .step-l { grid-column: 1 / -1; margin-bottom: -2px; }
    .link { padding-left: 0; }
  }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 12px; color: var(--muted); font-size: 12px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; }
  .meter, .status { padding: 11px 0; border-top: 1px solid var(--border); outline-offset: 2px; }
  .side > :first-of-type { border-top: 0; }
  .meter-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .meter-l { color: var(--ink-2); font-size: 13px; }
  .meter-v { font-weight: 600; font-size: 15px; }
  .meter-t { background: var(--meter-track); height: 8px; border-radius: 4px; margin-top: 6px; overflow: hidden; }
  .meter-f { background: var(--series); height: 100%; border-radius: 4px; }
  .meter-f.warn { background: #fab219; }
  .meter-f.bad { background: #d03b3b; }
  .meter-n { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .badge { font-size: 12.5px; font-weight: 600; padding: 2px 9px; border-radius: 999px; white-space: nowrap; }
  .badge.good { background: var(--good-bg); color: var(--good); }
  .badge.warn { background: var(--warn-bg); color: var(--warn-ink); }
  .back { display: grid; gap: 12px; }
  .back .meter { border: 0; padding: 0; }
  .back .meter-v { font-size: 18px; }
  .trends { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; }
  @media (max-width: 860px) { .trends { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 460px) { .trends { grid-template-columns: minmax(0, 1fr); } }
  .chart { width: 100%; height: auto; display: block; }
  .axis { stroke: var(--axis); stroke-width: 1; }
  .grid { stroke: var(--grid); stroke-width: 1; }
  .tick { fill: var(--muted); font-size: 11px; }
  .col, .hit { outline: none; }
  .col-f { fill: var(--series); }
  .col-f.now { fill: var(--series-soft); }
  .col:hover .col-f, .col:focus .col-f { filter: brightness(1.15); }
  .col-v { fill: var(--ink); font-size: 11.5px; font-weight: 600; }
  .col-m { fill: var(--ink); }
  .line { fill: none; stroke: var(--series); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .hair { stroke: var(--axis); stroke-width: 1; opacity: 0; }
  .hit:hover .hair, .hit:focus .hair { opacity: 1; }
  .flag { stroke: var(--ink-2); stroke-width: 1.5; }
  .empty { color: var(--muted); font-size: 13px; margin: 10px 0; }
  .bars { display: flex; flex-direction: column; gap: 7px; }
  .bar { display: grid; grid-template-columns: 150px minmax(0, 1fr) 44px; gap: 10px; align-items: center; outline-offset: 2px; border-radius: 4px; }
  .bar-l { color: var(--ink-2); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-t { background: var(--track); height: 12px; border-radius: 0 4px 4px 0; overflow: hidden; }
  .bar-f { background: var(--series); height: 100%; min-width: 2px; border-radius: 0 4px 4px 0; }
  .bar-v { text-align: right; font-variant-numeric: tabular-nums; font-size: 13px; }
  details { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; margin-bottom: 10px; }
  summary { cursor: pointer; padding: 13px 20px; font-weight: 600; font-size: 14px; min-height: 44px; }
  .inside { padding: 2px 20px 18px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .scroll { overflow-x: auto; }
  th, td { padding: 7px 10px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; }
  td.wrap-cell { white-space: normal; min-width: 180px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--ink-2); }
  tr.quiet td { color: var(--muted); }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; background: var(--track); }
  .pill.paid { background: var(--good-bg); color: var(--good); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: var(--track); padding: 1px 5px; border-radius: 4px; }
  a { color: inherit; }
  #tip { position: fixed; pointer-events: none; background: var(--tip-bg); color: var(--tip-ink); padding: 5px 9px;
    border-radius: 6px; font-size: 12px; max-width: 340px; z-index: 9; }
`;

const SCRIPT = `
  // The period switch. Every period is already in the page, so this only shows one.
  const buttons = [...document.querySelectorAll('.switch button')];
  function pick(key) {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.key === key));
    for (const el of document.querySelectorAll('[data-period]')) el.hidden = el.dataset.period !== key;
  }
  for (const b of buttons) b.addEventListener('click', () => pick(b.dataset.key));

  // One tooltip for every mark. The text comes from data, so it goes in as text.
  const tip = document.getElementById('tip');
  const show = (el, x, y) => {
    if (!el.dataset.tip) { tip.hidden = true; return; }
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    tip.style.left = Math.max(8, Math.min(x + 12, innerWidth - tip.offsetWidth - 8)) + 'px';
    tip.style.top = Math.max(y - tip.offsetHeight - 10, 8) + 'px';
  };
  const owner = (e) => e.target.closest && e.target.closest('[data-tip]');
  document.addEventListener('pointermove', (e) => {
    const el = owner(e);
    if (el) show(el, e.clientX, e.clientY); else tip.hidden = true;
  });
  document.addEventListener('focusin', (e) => {
    const el = owner(e);
    if (!el) return;
    const r = el.getBoundingClientRect();
    show(el, r.left + r.width / 2, r.top);
  });
  document.addEventListener('focusout', () => { tip.hidden = true; });
`;

export function renderPage(m, { defaultPeriod = '30' } = {}) {
  const b = m.business;
  const db = b.db;
  const periodBlocks = (fn) => m.periods
    .map((p) => `<div data-period="${p.key}"${p.key === defaultPeriod ? '' : ' hidden'}>${fn(p)}</div>`).join('');
  const funnelNote = (p) => {
    const parts = [];
    if (p.funnelSince) parts.push(`Counted since ${niceDay(p.funnelSince)}.`);
    if (!m.live) parts.push('Striped steps start with the next deploy.');
    return parts.join(' ');
  };

  return `<title>Bito Chess stats</title>
<style>${CSS}</style>
<div class="wrap">
  <header>
    <div>
      <h1>Bito Chess</h1>
      <p class="sub">${esc(new Date(m.now).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))} · run <code>bitostats</code> to refresh</p>
    </div>
    <div class="switch" role="group" aria-label="Period">
      ${m.periods.map((p) => `<button type="button" data-key="${p.key}" aria-pressed="${p.key === defaultPeriod}">${esc(p.label)}</button>`).join('')}
    </div>
  </header>

  ${m.live ? '' : '<p class="notice"><span aria-hidden="true">!</span><span>Visitors, scans and first use start counting when the new version goes live.</span></p>'}

  ${periodBlocks((p) => `<p class="story">${esc(p.story)}</p>
    <div class="kpis">${p.kpis.map((k) => kpi(k, p)).join('')}</div>`)}

  <div class="grid-2">
    <section>
      <h2>Where people stop</h2>
      ${periodBlocks((p) => `<p class="note">${esc(funnelNote(p))}</p>${funnelChart(p.start)}`)}
      ${legend(['landing', 'app', 'commit'])}
    </section>
    <section class="side">
      <h2 style="margin-bottom:6px">The business</h2>
      ${meter('Founders', `${num(b.founders.bought)} / ${b.founders.seats}`, b.founders.bought / b.founders.seats, `About €${b.founders.net.toFixed(0)} net so far`)}
      ${meter('Database', `${db.mb.toFixed(1)} MB`, db.share, `of ${db.limit} MB on the free plan`, db.share >= 0.85 ? 'bad' : db.share >= 0.6 ? 'warn' : '')}
      ${statusLine('Last backup', backupText(b.backup.days), !b.backup.due, b.backup.due ? 'Run <code>bitobackup</code>' : '')}
      <div class="meter">
        <div class="meter-top"><span class="meter-l">Accounts</span><span class="meter-v">${num(b.accounts)}</span></div>
        <div class="meter-n">${num(b.active7)} active in 7 days, ${num(b.active30)} in 30${b.ownCount ? '. Yours are left out' : ''}</div>
      </div>
    </section>
  </div>

  <div class="grid-2">
    <section>
      <h2>Staying and paying</h2>
      ${periodBlocks((p) => `<p class="note" style="margin-bottom:10px">${esc(p.long)}${p.funnelSince ? `, since ${niceDay(p.funnelSince)}` : ''}.</p>${funnelChart(p.stay)}`)}
      ${legend(['app', 'commit'])}
    </section>
    <section>
      <h2>Do they come back?</h2>
      <p class="note">${m.live ? 'Of devices that first trained at least that long ago.' : 'Of devices that first opened the app at least that long ago.'} All time.</p>
      <div class="back">${m.retention.map((r) => meter(r.label, r.share == null ? '–' : pct(r.share), r.share ?? 0, `${num(r.returned)} of ${num(r.eligible)}`)).join('')}</div>
    </section>
  </div>

  <section>
    <h2>Week by week</h2>
    <p class="note">Last 12 weeks. This week is lighter because it isn't over.${m.campaigns.length ? ' A triangle marks a campaign.' : ''}</p>
    <div class="trends">${m.trends.map((t) => `<div><h3>${esc(t.label)}</h3>${
      t.counting ? columns(t.weeks, t.label, m.campaigns) : `<p class="empty">${NOT_YET}</p>`
    }</div>`).join('')}</div>
    ${m.dailyVisits.length >= 2 ? `<h3 style="margin-top:20px">Visits per day</h3>${lineChart(m.dailyVisits, 'Visits', m.campaigns, 1060)}` : ''}
    <p class="note" style="margin:12px 0 0">Where visitors come from, their countries and languages: <a href="https://cloud.umami.is">Umami</a>.</p>
  </section>

  <div class="grid-2">
    <section>
      <h2>What gets used</h2>
      <p class="note">Last 30 days. Includes your own devices, unless they're left out in Settings.</p>
      ${bars(m.usage)}
    </section>
    <section>
      <h2>Campaigns</h2>
      ${m.campaigns.length
        ? `<p class="note">Visits in the 7 days before, then the 7 days from that day.</p>
          <div class="scroll"><table><tbody>${m.campaigns.map((c) => `<tr>
            <td class="wrap-cell"><strong>${esc(c.note)}</strong><br><span class="mono">${esc(niceDay(c.day))}${c.partial ? ', still counting' : ''}</span></td>
            <td class="num">${num(c.visitsBefore)} → <strong>${num(c.visitsAfter)}</strong></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="note" style="margin:6px 0 0">To measure a post or a video, add a line to <code>.admin/campaigns.txt</code>:<br><br><code>2026-11-05 Reddit r/chess post</code></p>'}
    </section>
  </div>

  <details>
    <summary>Every account</summary>
    <div class="inside">
      <p class="note">Numbers reported by the app. A grey row hasn't reported yet.</p>
      <h3>Tried each feature, of ${num(m.detail.reportingCount)} reporting</h3>
      <div style="margin-bottom:18px">${bars(m.detail.adoption.map((a) => ({ label: a.label, value: a.count })), (v) => num(v), Math.max(m.detail.reportingCount, 1))}</div>
      ${accountTable(m.detail.everyone)}
    </div>
  </details>
  <details>
    <summary>All event counts</summary>
    <div class="inside">
      <p class="note">Anonymous and all time. These count events, not people.</p>
      ${bars(m.detail.eventTotals.map((e) => ({ label: e.name, value: e.total })))}
      <h3 style="margin-top:20px">App opens per day</h3>
      ${lineChart(m.detail.opensByDay, 'App opens', [], 1060)}
    </div>
  </details>
  <details>
    <summary>Lines and training over time</summary>
    <div class="inside">
      <p class="note">From the weekly snapshot of accounts, leaving yours out.</p>
      <h3>Lines built</h3>
      ${lineChart(m.detail.history.map((h) => ({ day: h.day, value: h.lines })), 'Lines built', [], 1060)}
      <h3 style="margin-top:16px">Drills run</h3>
      ${lineChart(m.detail.history.map((h) => ({ day: h.day, value: h.drills })), 'Drills run', [], 1060)}
    </div>
  </details>
</div>
<div id="tip" hidden></div>
<script>${SCRIPT}</script>
`;
}

// A few lines for the terminal, so the answer is there before the page opens.
export function terminalSummary(m) {
  const week = m.periods[0];
  const parts = week.kpis.map((k) => `${k.label}: ${k.counting ? num(k.value) : '–'}`);
  return `  Last 7 days  ${parts.join('  ·  ')}`;
}
