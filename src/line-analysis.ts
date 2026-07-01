// The Line-tab analysis block, shown only for an imported/loaded game once it
// has been reviewed: a discrete "analysed with…" tag, a small eval graph that
// tracks the engine score across the game, and a condensed move-type summary
// table (one column per grade, a row of counts for each player).
//
// All inputs are already on the board's move nodes (classification + evalCp,
// written by review.ts) — this module is pure presentation, no network.

import type { MoveNode } from './tree';
import type { MoveClass } from './winprob';
import { classIcon, CLASS_LABEL, CLASS_COLOR } from './icons';
import { gameAccuracy } from './accuracy';
import type { ReviewSummary } from './review';

export interface LineAnalysisOpts {
  whiteName: string;
  blackName: string;
  engine: ReviewSummary['engine'];
}

// Grades in display order, best → worst. The summary table and the graph legend
// both walk this, so a column never jumps around between games.
const ORDER: MoveClass[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder',
];

// Only dramatic swings get a dot on the graph (blunders and the brilliant/great
// finds), so the curve stays readable.
const KEY_MOMENTS = new Set<MoveClass>(['blunder', 'great', 'brilliant']);

const ENGINE_LABEL: Record<ReviewSummary['engine'], string> = {
  lichess: 'Lichess cloud (Stockfish)',
  local: 'Stockfish (on device)',
  mixed: 'Lichess cloud + Stockfish',
  none: 'the engine',
};

// True when there's anything worth drawing — at least one graded move.
export function hasReview(nodes: MoveNode[]): boolean {
  return nodes.some(n => n.classification);
}

// Render the whole block into `host` (cleared first). Caller decides when to
// show it (imported game + reviewed); this just paints.
export function renderLineAnalysis(host: HTMLElement, nodes: MoveNode[], opts: LineAnalysisOpts): void {
  host.innerHTML = '';

  // The engine tag only appears once a review has actually named an engine —
  // during an in-progress run the graph paints but the tag stays hidden.
  if (opts.engine !== 'none') {
    const tag = document.createElement('div');
    tag.className = 'la-engine-tag';
    tag.textContent = `Analysed with ${ENGINE_LABEL[opts.engine]}`;
    host.appendChild(tag);
  }

  host.appendChild(buildGraph(nodes));
  host.appendChild(buildSummary(nodes, opts));
}

// ── Eval graph ───────────────────────────────────────────────────────────────

const W = 320, H = 70, PAD = 6, MID = H / 2;
const CLAMP = 800; // ±8 pawns; mate sentinels and runaway evals clamp to here.
let graphSeq = 0;   // unique clip-path ids per render

function clampCp(cp: number): number {
  return Math.max(-CLAMP, Math.min(CLAMP, cp));
}

function buildGraph(nodes: MoveNode[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'la-graph';

  // Points: the even start (0,0) then every move that carries an eval.
  const pts: { x: number; cp: number }[] = [{ x: 0, cp: 0 }];
  nodes.forEach((n, i) => {
    if (n.evalCp !== undefined) pts.push({ x: i + 1, cp: clampCp(n.evalCp) });
  });
  if (pts.length < 2) { wrap.hidden = true; return wrap; }

  const maxX = nodes.length;
  const px = (x: number) => (maxX === 0 ? 0 : (x / maxX) * W);
  const py = (cp: number) => MID - (cp / CLAMP) * (MID - PAD);

  const curve = pts.map((p, i) => `${i ? 'L' : 'M'}${px(p.x).toFixed(1)},${py(p.cp).toFixed(1)}`).join(' ');
  const area =
    `M${px(pts[0].x).toFixed(1)},${MID} ` +
    pts.map(p => `L${px(p.x).toFixed(1)},${py(p.cp).toFixed(1)}`).join(' ') +
    ` L${px(pts[pts.length - 1].x).toFixed(1)},${MID} Z`;

  const id = `la-clip-${++graphSeq}`;
  const dots = nodes
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.classification && KEY_MOMENTS.has(n.classification) && n.evalCp !== undefined)
    .map(({ n, i }) =>
      `<circle cx="${px(i + 1).toFixed(1)}" cy="${py(clampCp(n.evalCp!)).toFixed(1)}" r="3.4" ` +
      `fill="${CLASS_COLOR[n.classification!]}" stroke="#fff" stroke-width="1.4"/>`)
    .join('');

  wrap.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="la-graph-svg" aria-hidden="true">` +
    `<defs>` +
    `<clipPath id="${id}-top"><rect x="0" y="0" width="${W}" height="${MID}"/></clipPath>` +
    `<clipPath id="${id}-bot"><rect x="0" y="${MID}" width="${W}" height="${H - MID}"/></clipPath>` +
    `</defs>` +
    // White-advantage area (above the midline) light; Black-advantage dark.
    `<path d="${area}" fill="#eef1f4" clip-path="url(#${id}-top)"/>` +
    `<path d="${area}" fill="#222831" clip-path="url(#${id}-bot)"/>` +
    `<line x1="0" y1="${MID}" x2="${W}" y2="${MID}" class="la-graph-mid"/>` +
    `<path d="${curve}" fill="none" class="la-graph-curve"/>` +
    dots +
    `</svg>`;
  return wrap;
}

// ── Move-type summary table ──────────────────────────────────────────────────

function countByClass(nodes: MoveNode[], even: boolean): Map<MoveClass, number> {
  const m = new Map<MoveClass, number>();
  nodes.forEach((n, i) => {
    if (!n.classification) return;
    if ((i % 2 === 0) !== even) return; // even ply = White's move
    m.set(n.classification, (m.get(n.classification) ?? 0) + 1);
  });
  return m;
}

function buildSummary(nodes: MoveNode[], opts: LineAnalysisOpts): HTMLElement {
  const white = countByClass(nodes, true);
  const black = countByClass(nodes, false);
  const rows = ORDER.filter(c => (white.get(c) ?? 0) + (black.get(c) ?? 0) > 0);

  const table = document.createElement('div');
  table.className = 'la-summary';
  if (!rows.length) { table.hidden = true; return table; }

  // Vertical layout: one ROW per grade (icon + name), and a column for each
  // player — so the player names get the full column width to breathe.
  // Columns: grade label (flexes) | White | Black.
  table.style.gridTemplateColumns = '1fr auto auto';

  const cell = (cls: string, content?: Node | string): HTMLElement => {
    const el = document.createElement('div');
    el.className = cls;
    if (typeof content === 'string') el.textContent = content;
    else if (content) el.appendChild(content);
    return el;
  };

  const count = (n: number, c: MoveClass): HTMLElement => {
    const el = cell('la-cell la-count', String(n));
    el.style.color = CLASS_COLOR[c];
    if (!n) el.classList.add('la-count--zero');
    return el;
  };

  // Header row — the two player names.
  table.appendChild(cell('la-cell la-corner'));
  table.appendChild(cell('la-cell la-player', opts.whiteName));
  table.appendChild(cell('la-cell la-player', opts.blackName));

  // Accuracy row (Lichess model, computed from the stored evals) — first, so
  // the headline number sits right under each player's name.
  const acc = gameAccuracy(nodes.map(n => n.evalCp));
  if (acc.white !== null || acc.black !== null) {
    table.appendChild(cell('la-cell la-grade la-accuracy-label', 'Accuracy'));
    const accCell = (v: number | null): HTMLElement =>
      cell('la-cell la-count la-accuracy', v === null ? '—' : v.toFixed(1));
    table.appendChild(accCell(acc.white));
    table.appendChild(accCell(acc.black));
  }

  // One row per grade: icon + name, then each player's count.
  for (const c of rows) {
    const label = cell('la-cell la-grade');
    label.appendChild(classIcon(c, 18));
    const name = document.createElement('span');
    name.textContent = CLASS_LABEL[c];
    label.appendChild(name);
    table.appendChild(label);
    table.appendChild(count(white.get(c) ?? 0, c));
    table.appendChild(count(black.get(c) ?? 0, c));
  }

  return table;
}
