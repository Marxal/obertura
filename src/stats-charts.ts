// The one line-chart renderer behind every Statistics trend (game rating,
// puzzle rating, endgame rating, win rate). Inline SVG, no dependency, themed
// entirely through CSS variables:
//
//   • a monotone-cubic line (no overshoot — the curve never invents values
//     beyond the data) over a soft area wash that fades to transparent,
//   • recessive hairline y-gridlines with clean tick values, plus an optional
//     reference baseline (e.g. the 50% mark on a win-rate chart),
//   • tap anywhere to select the nearest point: a crosshair + ringed dot mark
//     it and the detail line below the chart reads out the exact numbers,
//   • the newest point always carries an end-dot so "where am I now" pops.
//
// One svg text-size caveat: like the app's earlier charts this stretches to the
// container (preserveAspectRatio none), so labels distort a little on very wide
// screens — acceptable on the phones this is built for.

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface ChartPoint {
  value: number;
  // A short label for the detail line / x-axis ("12 Mar", "Sep").
  label: string;
}

export interface LineChartOpts {
  ariaLabel: string;
  // Force the y-domain (e.g. [0, 100] for a percentage); default fits the data.
  domain?: [number, number];
  // Draw a reference hairline at this value (must sit inside the domain).
  baseline?: number;
  // Format a y-tick value ("1.6k", "50%"). Default: String(v).
  yFmt?: (v: number) => string;
  // Sparse x labels: which point indices get a label, and its text.
  xTicks?: { i: number; text: string }[];
  // The read-out under the chart for a selected point index. Omitting it (and
  // detailEl) still renders the selection marks.
  detailFor?: (i: number) => string;
  // Fires on every selection; userTap distinguishes the initial auto-select.
  onSelect?: (i: number, userTap: boolean) => void;
}

let chartSeq = 0; // unique gradient ids per render

// Monotone-cubic tangents (Fritsch–Carlson), so the curve stays inside the
// data's envelope — a rating that never hit 1700 must not look like it did.
function tangentsFor(xs: number[], ys: number[]): number[] {
  const n = xs.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / ((xs[i + 1] - xs[i]) || 1));
  const m: number[] = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return m;
}

function curvePath(xs: number[], ys: number[]): string {
  const n = xs.length;
  if (n === 2) return `M${xs[0].toFixed(1)},${ys[0].toFixed(1)} L${xs[1].toFixed(1)},${ys[1].toFixed(1)}`;
  const m = tangentsFor(xs, ys);
  let d = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (xs[i + 1] - xs[i]) / 3;
    d += ` C${(xs[i] + dx).toFixed(1)},${(ys[i] + m[i] * dx).toFixed(1)}` +
      ` ${(xs[i + 1] - dx).toFixed(1)},${(ys[i + 1] - m[i + 1] * dx).toFixed(1)}` +
      ` ${xs[i + 1].toFixed(1)},${ys[i + 1].toFixed(1)}`;
  }
  return d;
}

// Up to `want` clean tick values inside [lo, hi] (1/2/5 × 10ⁿ steps).
function niceTicks(lo: number, hi: number, want = 3): number[] {
  const span = hi - lo;
  if (span <= 0) return [lo];
  const raw = span / want;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = mag;
  for (const mult of [1, 2, 5, 10]) {
    if (mag * mult >= raw) { step = mag * mult; break; }
  }
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out.slice(0, want + 1);
}

export function renderLineChart(host: HTMLElement, points: ChartPoint[], opts: LineChartOpts): void {
  host.innerHTML = '';
  if (points.length < 2) return; // callers gate + show their own empty note

  const W = 320, H = 128, padL = 30, padR = 12, padTop = 10, padBottom = 18;
  const innerW = W - padL - padR;
  const innerH = H - padTop - padBottom;

  const values = points.map(p => p.value);
  let lo: number, hi: number;
  if (opts.domain) {
    [lo, hi] = opts.domain;
  } else {
    lo = Math.min(...values);
    hi = Math.max(...values);
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.14;
    lo -= pad;
    hi += pad;
  }

  const x = (i: number): number => padL + (i / (points.length - 1)) * innerW;
  const y = (v: number): number => padTop + (1 - (v - lo) / (hi - lo)) * innerH;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'stats-lc');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', opts.ariaLabel);

  // Area gradient — currentColor with fading opacity, so it re-tints per theme.
  const id = `stats-lc-grad-${++chartSeq}`;
  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.innerHTML =
    `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="currentColor" stop-opacity="0.22"/>` +
    `<stop offset="1" stop-color="currentColor" stop-opacity="0.02"/>` +
    `</linearGradient>`;
  svg.appendChild(defs);

  // Recessive y-gridlines + tick values (skipping any tick that would collide
  // with the baseline's own line).
  for (const tick of niceTicks(lo, hi)) {
    if (opts.baseline !== undefined && Math.abs(tick - opts.baseline) < (hi - lo) / 40) continue;
    const gy = y(tick).toFixed(1);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(padL));
    line.setAttribute('x2', String(W - padR));
    line.setAttribute('y1', gy);
    line.setAttribute('y2', gy);
    line.setAttribute('class', 'stats-lc-grid');
    svg.appendChild(line);
    const lbl = document.createElementNS(SVG_NS, 'text');
    lbl.setAttribute('x', String(padL - 4));
    lbl.setAttribute('y', gy);
    lbl.setAttribute('text-anchor', 'end');
    lbl.setAttribute('dominant-baseline', 'central');
    lbl.setAttribute('class', 'stats-lc-ylabel');
    lbl.textContent = (opts.yFmt ?? String)(tick);
    svg.appendChild(lbl);
  }

  if (opts.baseline !== undefined) {
    const by = y(opts.baseline).toFixed(1);
    const base = document.createElementNS(SVG_NS, 'line');
    base.setAttribute('x1', String(padL));
    base.setAttribute('x2', String(W - padR));
    base.setAttribute('y1', by);
    base.setAttribute('y2', by);
    base.setAttribute('class', 'stats-lc-baseline');
    svg.appendChild(base);
  }

  const xs = points.map((_, i) => x(i));
  const ys = values.map(v => y(v));
  const curve = curvePath(xs, ys);

  const area = document.createElementNS(SVG_NS, 'path');
  area.setAttribute(
    'd',
    `${curve} L${xs[xs.length - 1].toFixed(1)},${(H - padBottom).toFixed(1)} L${xs[0].toFixed(1)},${(H - padBottom).toFixed(1)} Z`,
  );
  area.setAttribute('fill', `url(#${id})`);
  area.setAttribute('stroke', 'none');
  svg.appendChild(area);

  const line = document.createElementNS(SVG_NS, 'path');
  line.setAttribute('d', curve);
  line.setAttribute('fill', 'none');
  line.setAttribute('class', 'stats-lc-line');
  svg.appendChild(line);

  // Per-point dots only while they stay readable; a dense series is just the line.
  if (points.length <= 16) {
    points.forEach((_, i) => {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', xs[i].toFixed(1));
      dot.setAttribute('cy', ys[i].toFixed(1));
      dot.setAttribute('r', '3');
      dot.setAttribute('class', 'stats-lc-dot');
      svg.appendChild(dot);
    });
  }

  // The newest value always carries an end-dot with a surface ring.
  const endDot = document.createElementNS(SVG_NS, 'circle');
  endDot.setAttribute('cx', xs[xs.length - 1].toFixed(1));
  endDot.setAttribute('cy', ys[ys.length - 1].toFixed(1));
  endDot.setAttribute('r', '4');
  endDot.setAttribute('class', 'stats-lc-enddot');
  svg.appendChild(endDot);

  // Sparse x labels.
  for (const t of opts.xTicks ?? []) {
    if (t.i < 0 || t.i >= points.length) continue;
    const lbl = document.createElementNS(SVG_NS, 'text');
    lbl.setAttribute('x', xs[t.i].toFixed(1));
    lbl.setAttribute('y', String(H - 5));
    lbl.setAttribute('text-anchor', t.i === 0 ? 'start' : t.i === points.length - 1 ? 'end' : 'middle');
    lbl.setAttribute('class', 'stats-lc-xlabel');
    lbl.textContent = t.text;
    svg.appendChild(lbl);
  }

  // Selection marks: a crosshair + ringed dot, moved on tap; the whole svg is
  // the hit target (far friendlier than pixel-hunting the dots on a phone).
  const cross = document.createElementNS(SVG_NS, 'line');
  cross.setAttribute('y1', String(padTop));
  cross.setAttribute('y2', String(H - padBottom));
  cross.setAttribute('class', 'stats-lc-cross');
  svg.appendChild(cross);
  const selDot = document.createElementNS(SVG_NS, 'circle');
  selDot.setAttribute('r', '4.5');
  selDot.setAttribute('class', 'stats-lc-seldot');
  svg.appendChild(selDot);

  const detail = document.createElement('div');
  detail.className = 'stats-trend-detail';

  const select = (i: number, userTap: boolean): void => {
    const cx = xs[i].toFixed(1);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    selDot.setAttribute('cx', cx);
    selDot.setAttribute('cy', ys[i].toFixed(1));
    if (opts.detailFor) detail.textContent = opts.detailFor(i);
    opts.onSelect?.(i, userTap);
  };

  svg.addEventListener('pointerdown', (e) => {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const vx = ((e.clientX - rect.left) / rect.width) * W; // viewBox x
    const frac = (vx - padL) / innerW;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(frac * (points.length - 1))));
    select(i, true);
  });

  host.appendChild(svg);
  if (opts.detailFor) host.appendChild(detail);
  select(points.length - 1, false);
}

// ── W-D-L record strip ────────────────────────────────────────────────────────
// A single part-to-whole bar: wins · draws · losses, with a 2px surface gap
// between segments and the counts spelled out beside a swatch underneath (so
// identity never rides on colour alone).

export function renderRecordStrip(
  host: HTMLElement,
  r: { wins: number; draws: number; losses: number },
): void {
  host.innerHTML = '';
  const total = r.wins + r.draws + r.losses;
  if (total === 0) return;

  const bar = document.createElement('div');
  bar.className = 'stats-wdl-bar';
  const seg = (kind: 'win' | 'draw' | 'loss', n: number): void => {
    if (n === 0) return;
    const s = document.createElement('div');
    s.className = `stats-wdl-seg stats-wdl-seg--${kind}`;
    s.style.flexGrow = String(n);
    bar.appendChild(s);
  };
  seg('win', r.wins);
  seg('draw', r.draws);
  seg('loss', r.losses);
  host.appendChild(bar);

  const legend = document.createElement('div');
  legend.className = 'stats-wdl-legend';
  const item = (kind: 'win' | 'draw' | 'loss', label: string, n: number): void => {
    const el = document.createElement('span');
    el.className = 'stats-wdl-item';
    const sw = document.createElement('span');
    sw.className = `stats-wdl-swatch stats-wdl-seg--${kind}`;
    sw.setAttribute('aria-hidden', 'true');
    el.appendChild(sw);
    const txt = document.createElement('span');
    txt.textContent = `${n} ${label} · ${Math.round((100 * n) / total)}%`;
    el.appendChild(txt);
    legend.appendChild(el);
  };
  item('win', 'won', r.wins);
  item('draw', 'drew', r.draws);
  item('loss', 'lost', r.losses);
  host.appendChild(legend);
}
