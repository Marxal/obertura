// Repertoire Map — full-colour view, zoomable tree, arrow navigation.
//
// openRepertoireMap(lines, colour, onOpenLine)
//
// Shows all lines for one colour merged into a tree from the start position.
// Tap a node → position preview slides in at the top (two-column: board + info).
// Arrow buttons (bottom) navigate the tree; ± buttons zoom.

import type { Line } from './types';
import type { MoveNode } from './tree';
import { Chessground } from 'chessground';
import type { Api as CgApi } from 'chessground/api';
import type { Key } from 'chessground/types';
import { nameForFen } from './openings';
import { pushBack } from './back-nav';
import { statScorePct, topReply, type StatNode } from './move-stats';
import { wdlScoreRow } from './wdl-bar';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const NS = 'http://www.w3.org/2000/svg';

// The moves reaching the tapped node, handed to a custom node action so a caller
// (opponent scouting) can prepare a reply from exactly that position.
export interface NodeActionContext {
  fen: string;
  san: string;
  ucis: string[];   // uci path from the start to this node
  sans: string[];   // same path in SAN
  colour: 'white' | 'black';
}

export interface RepertoireMapOptions {
  // Header title — defaults to "White/Black repertoire".
  title?: string;
  // Header badge — defaults to "N lines".
  subtitle?: string;
  // Replaces the default "Open in builder" preview action. When set, the button
  // shows on EVERY node (not just nodes tied to a saved line); pass disabled to
  // surface it as a not-yet-live stub.
  nodeAction?: {
    label: string;
    disabled?: boolean;
    onAct?: (ctx: NodeActionContext) => void;
  };
  // Depth control — the "Go deeper" feature. When set, the map renders only the
  // first `startPlies` plies and offers a quiet "Go deeper" control that reveals
  // `stepPlies` more each click, rebuilding from data already on the phone.
  depth?: MapDepth;
  // Per-move statistics. When set, each node gets a win/draw/loss bar and the tap
  // preview gains games / W-D-L / most-played reply. The `tree` is a UCI-keyed
  // stats lookup (see move-stats.ts); `caption` names whose results these are
  // ("their results" / "your results").
  stats?: { tree: StatNode; caption: string };
}

export interface MapDepth {
  startPlies: number;     // first render depth (10 = 5 moves)
  stepPlies: number;      // added per "Go deeper" click (10 = 5 moves)
  // How deep the underlying data truly reaches. Caps the stepping and drives the
  // shallow "imported at N moves" hint when the data can't deepen at all.
  maxPlies: number;
  // Re-supply the lines to draw at `plies` deep. For the repertoire map this is
  // just the full saved lines (the map truncates); for opponents it rebuilds the
  // pruned tree from stored games. Heavy work is fine — the map calls it behind
  // a spinner, off the paint frame.
  atDepth: (plies: number) => Line[];
  // Opponent maps set this: when the data is too shallow to deepen, the control
  // disables with an "imported at N moves" note instead of vanishing. Repertoire
  // maps leave it false and the control simply hides when there's nothing deeper.
  importHint?: boolean;
}

// Node box geometry
const NW = 56;   // node width
const NH = 30;   // node height
const HG = 10;   // horizontal gap between sibling subtrees
const VG = 44;   // vertical gap: bottom of parent → top of child
const PAD = 20;  // outer padding

// Win/draw/loss bar, pinned to the bottom edge of the node box (below the SAN).
const BAR_M = 6;             // horizontal inset from the box edges
const BAR_H = 3.5;           // bar thickness
const BAR_GAP = 3;           // gap from the box bottom up to the bar

// ── Map node ──────────────────────────────────────────────────────────────────

interface MapNode {
  san: string;
  uci: string;
  fen: string;
  lineIds: string[];
  children: MapNode[];
  parent: MapNode | null;
  x: number;
  y: number;
  svgEl: SVGGElement | null; // set during SVG build
  stats: StatNode | null;    // stamped by attachStats when a stats lookup is set
}

function buildMergedTree(lines: Line[], maxPlies = Infinity): MapNode {
  const root: MapNode = {
    san: '', uci: '', fen: START_FEN, lineIds: [],
    children: [], parent: null, x: 0, y: 0, svgEl: null, stats: null,
  };
  for (const l of lines) mergeInto(root, l.tree, l.id, maxPlies);
  return root;
}

// Stamp each MapNode with its W/D/L stats by descending both trees in lockstep
// (one pass, O(nodes)). A node whose move never appears in the games is left
// null — no bar, no preview stats. The root carries the colour totals.
function attachStats(node: MapNode, stat: StatNode | null): void {
  node.stats = stat;
  for (const c of node.children) {
    attachStats(c, stat ? stat.children.get(c.uci) ?? null : null);
  }
}

// `depthLeft` is the plies still allowed below `parent`; at 0 we stop, which is
// how "Go deeper" truncates a long line to the current render depth.
function mergeInto(parent: MapNode, src: MoveNode, lineId: string, depthLeft: number): void {
  if (depthLeft <= 0) return;
  for (const sc of src.children) {
    let ex = parent.children.find(c => c.uci === sc.uci);
    if (!ex) {
      ex = {
        san: sc.san, uci: sc.uci, fen: sc.fen, lineIds: [],
        children: [], parent, x: 0, y: 0, svgEl: null, stats: null,
      };
      parent.children.push(ex);
    }
    if (!ex.lineIds.includes(lineId)) ex.lineIds.push(lineId);
    mergeInto(ex, sc, lineId, depthLeft - 1);
  }
}

// ── Layout ────────────────────────────────────────────────────────────────────

function subW(n: MapNode): number {
  if (!n.children.length) return NW;
  const tot = n.children.reduce((s, c, i) => s + subW(c) + (i ? HG : 0), 0);
  return Math.max(NW, tot);
}

function placeNodes(n: MapNode, x: number, y: number, w: number): void {
  n.x = x + w / 2;
  n.y = y;
  if (!n.children.length) return;
  const cws = n.children.map(subW);
  const tot = cws.reduce((s, v) => s + v, 0) + HG * (cws.length - 1);
  let cx = x + (w - tot) / 2;
  const cy = y + NH + VG;
  for (let i = 0; i < n.children.length; i++) {
    placeNodes(n.children[i], cx, cy, cws[i]);
    cx += cws[i] + HG;
  }
}

function treeMaxY(n: MapNode): number {
  if (!n.children.length) return n.y;
  return Math.max(...n.children.map(treeMaxY));
}

// FEN field 2: 'b' = black to move, meaning white just played.
function movedBy(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'b' ? 'white' : 'black';
}

// ── SVG ───────────────────────────────────────────────────────────────────────

function buildSVG(
  root: MapNode,
  onTap: (n: MapNode) => void,
): SVGSVGElement {
  const w = subW(root);
  placeNodes(root, PAD, PAD, w);
  const maxY = treeMaxY(root);
  const svgW = w + 2 * PAD;
  const svgH = maxY + NH + PAD * 2;

  const svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
  svg.setAttribute('width', String(svgW));
  svg.setAttribute('height', String(svgH));
  svg.style.display = 'block';
  svg.style.overflow = 'visible';

  // Root is the start position (no SAN) — skip it, draw its children.
  drawEdges(svg, root, true);
  drawNodes(svg, root, true, onTap);
  return svg;
}

// A thin three-segment win/draw/loss bar along the node's bottom edge. Colours
// mirror wdl-bar.ts (sage win, neutral draw, brick loss). Non-interactive so
// taps still land on the node.
function drawStatBar(g: SVGGElement, n: MapNode): void {
  const s = n.stats;
  if (!s) return;
  const total = s.wins + s.draws + s.losses;
  if (total === 0) return;

  const left = n.x - NW / 2 + BAR_M;
  const barW = NW - 2 * BAR_M;
  const top = n.y + NH - BAR_GAP - BAR_H;

  const track = document.createElementNS(NS, 'rect');
  track.setAttribute('x', String(left));
  track.setAttribute('y', String(top));
  track.setAttribute('width', String(barW));
  track.setAttribute('height', String(BAR_H));
  track.setAttribute('rx', '1.5');
  track.setAttribute('class', 'rmap-wdl-track');
  g.appendChild(track);

  let cx = left;
  const seg = (kind: 'win' | 'draw' | 'loss', val: number) => {
    if (val === 0) return;
    const w = (val / total) * barW;
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', String(cx));
    r.setAttribute('y', String(top));
    r.setAttribute('width', String(w));
    r.setAttribute('height', String(BAR_H));
    r.setAttribute('class', `rmap-wdl-seg rmap-wdl-seg--${kind}`);
    g.appendChild(r);
    cx += w;
  };
  seg('win', s.wins);
  seg('draw', s.draws);
  seg('loss', s.losses);
}

function drawEdges(parent: SVGElement, n: MapNode, skip: boolean): void {
  for (const c of n.children) {
    if (!skip) {
      const x1 = n.x, y1 = n.y + NH, x2 = c.x, y2 = c.y;
      const my = (y2 - y1) * 0.5;
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', `M${x1},${y1} C${x1},${y1 + my} ${x2},${y2 - my} ${x2},${y2}`);
      p.setAttribute('class', 'rmap-edge');
      parent.appendChild(p);
    }
    drawEdges(parent, c, false);
  }
}

function drawNodes(
  parent: SVGElement,
  n: MapNode,
  skip: boolean,
  onTap: (n: MapNode) => void,
): void {
  if (!skip) {
    const isFork = n.children.length > 1;
    const mover = movedBy(n.fen);
    const g = document.createElementNS(NS, 'g') as SVGGElement;
    g.setAttribute('class', [
      'rmap-node',
      `rmap-node--${mover}`,
      isFork ? 'rmap-node--fork' : '',
    ].filter(Boolean).join(' '));

    // Enlarged transparent hit area (≈44px tall for reliable taps).
    const hit = document.createElementNS(NS, 'rect');
    hit.setAttribute('x', String(n.x - NW / 2 - 10));
    hit.setAttribute('y', String(n.y - 7));
    hit.setAttribute('width', String(NW + 20));
    hit.setAttribute('height', String(NH + 14));
    hit.setAttribute('rx', '10');
    hit.setAttribute('fill', 'transparent');
    g.appendChild(hit);

    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('x', String(n.x - NW / 2));
    bg.setAttribute('y', String(n.y));
    bg.setAttribute('width', String(NW));
    bg.setAttribute('height', String(NH));
    bg.setAttribute('rx', '7');
    bg.setAttribute('class', 'rmap-node-bg');
    g.appendChild(bg);

    const txt = document.createElementNS(NS, 'text');
    txt.setAttribute('x', String(n.x));
    txt.setAttribute('y', String(n.y + NH / 2 + 5));
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('class', 'rmap-node-text');
    txt.textContent = n.san;
    g.appendChild(txt);

    // No-ops when the node has no stats (e.g. repertoire moves never played).
    drawStatBar(g, n);

    n.svgEl = g;
    g.addEventListener('click', e => {
      e.stopPropagation();
      onTap(n);
    });
    parent.appendChild(g);
  }
  for (const c of n.children) drawNodes(parent, c, false, onTap);
}

// ── Position preview panel ────────────────────────────────────────────────────

interface PreviewController {
  el: HTMLElement;
  show(n: MapNode, lines: Line[], open: (l: Line) => void): void;
}

// The uci/san path from the (invisible) root down to this node.
function nodePath(n: MapNode): { ucis: string[]; sans: string[] } {
  const ucis: string[] = [];
  const sans: string[] = [];
  let cur: MapNode | null = n;
  while (cur && cur.san) {
    ucis.unshift(cur.uci);
    sans.unshift(cur.san);
    cur = cur.parent;
  }
  return { ucis, sans };
}

// The tap-preview stats block: caption, [score% · W/D/L bar · counts], plus the
// most-played reply from this position.
function statsBlock(n: MapNode, caption: string): HTMLElement {
  const s = n.stats!;
  const wrap = document.createElement('div');
  wrap.className = 'rmap-pos-stats';

  const cap = document.createElement('div');
  cap.className = 'wdl-caption';
  cap.textContent = caption;
  wrap.appendChild(cap);

  wrap.appendChild(wdlScoreRow(
    { wins: s.wins, draws: s.draws, losses: s.losses, scorePct: statScorePct(s), games: s.games },
    `${s.games} game${s.games === 1 ? '' : 's'}`,
  ));

  const reply = topReply(s);
  if (reply) {
    const r = document.createElement('div');
    r.className = 'rmap-pos-meta';
    r.textContent = `Most common reply: ${reply.san} (${Math.round((reply.games / s.games) * 100)}%)`;
    wrap.appendChild(r);
  }

  return wrap;
}

function makePreview(
  colour: 'white' | 'black',
  opts: RepertoireMapOptions,
  requestClose: () => void,
): PreviewController {
  const panel = document.createElement('div');
  panel.className = 'rmap-pos-panel';
  panel.hidden = true;

  // Collapse button (top-right).
  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'rmap-pos-collapse';
  collapseBtn.setAttribute('aria-label', 'Hide position');
  collapseBtn.textContent = '×';
  collapseBtn.addEventListener('click', () => { panel.hidden = true; });
  panel.appendChild(collapseBtn);

  // Board column (left).
  const boardCol = document.createElement('div');
  boardCol.className = 'rmap-pos-board-col';
  const boardEl = document.createElement('div');
  boardEl.className = 'rmap-pos-board';
  boardCol.appendChild(boardEl);
  panel.appendChild(boardCol);

  // Info column (right).
  const infoCol = document.createElement('div');
  infoCol.className = 'rmap-pos-info-col';
  panel.appendChild(infoCol);

  let cg: CgApi | null = null;

  function show(n: MapNode, lines: Line[], open: (l: Line) => void): void {
    panel.hidden = false;

    const from = n.uci.slice(0, 2) as Key;
    const to = n.uci.slice(2, 4) as Key;
    const assoc = lines.find(l => n.lineIds.includes(l.id));
    const orient = assoc?.colour ?? colour;

    if (!cg) {
      cg = Chessground(boardEl, {
        fen: n.fen, orientation: orient, viewOnly: true,
        coordinates: false,
        drawable: { enabled: false }, animation: { enabled: false },
        selectable: { enabled: false },
        highlight: { lastMove: true, check: false },
        lastMove: [from, to],
      });
    } else {
      cg.set({ fen: n.fen, orientation: orient, lastMove: [from, to] });
    }

    infoCol.innerHTML = '';

    const opening = nameForFen(n.fen);
    if (opening) {
      const nm = document.createElement('div');
      nm.className = 'rmap-pos-opening';
      nm.textContent = opening;
      infoCol.appendChild(nm);
    }

    const san = document.createElement('div');
    san.className = 'rmap-pos-san';
    san.textContent = n.san;
    infoCol.appendChild(san);

    if (opts.stats && n.stats && n.stats.games > 0) {
      infoCol.appendChild(statsBlock(n, opts.stats.caption));
    }

    if (n.children.length > 1) {
      const v = document.createElement('div');
      v.className = 'rmap-pos-meta';
      v.textContent = `${n.children.length} variations`;
      infoCol.appendChild(v);
    }

    if (opts.nodeAction) {
      // Custom action (e.g. scouting's "Prepare a reply"): on every node.
      const actBtn = document.createElement('button');
      actBtn.type = 'button';
      actBtn.className = 'rmap-pos-open-btn';
      actBtn.textContent = opts.nodeAction.label;
      actBtn.disabled = !!opts.nodeAction.disabled;
      const act = opts.nodeAction;
      actBtn.addEventListener('click', () => {
        const { ucis, sans } = nodePath(n);
        // The action leaves the map (e.g. into the builder), so close first to
        // keep the back-navigation stack tidy and the overlay out of the way.
        if (!act.disabled) requestClose();
        act.onAct?.({ fen: n.fen, san: n.san, ucis, sans, colour });
      });
      infoCol.appendChild(actBtn);
    } else if (assoc) {
      const titleEl = document.createElement('div');
      titleEl.className = 'rmap-pos-line-title';
      titleEl.textContent = assoc.name || assoc.openingName || '';
      if (titleEl.textContent) infoCol.appendChild(titleEl);

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'rmap-pos-open-btn';
      openBtn.textContent = 'Open in builder';
      openBtn.addEventListener('click', () => open(assoc));
      infoCol.appendChild(openBtn);
    }
  }

  return { el: panel, show };
}

// ── Pan + zoom ─────────────────────────────────────────────────────────────────

interface TxState {
  scale: number;
  tx: number;
  ty: number;
}

function applyTx(inner: HTMLElement, state: TxState, animated = false): void {
  if (animated) {
    inner.style.transition = 'transform 0.22s ease-out';
    setTimeout(() => { inner.style.transition = ''; }, 260);
  } else {
    inner.style.transition = '';
  }
  inner.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
}

// Returns a disposer that detaches the window-level listeners. The pan/zoom
// handlers on `outer` go away with the overlay, but the mouse drag tracks moves
// across the whole window, so its `mousemove`/`mouseup` are on `window` and must
// be removed by hand on close — otherwise every open of the map leaks another
// pair that fires for the rest of the session.
function initPanZoom(outer: HTMLElement, inner: HTMLElement, state: TxState): () => void {
  // Touch pan + pinch
  let t0: Touch | null = null;
  let startTx = 0, startTy = 0;
  let lastDist = 0;

  outer.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      t0 = e.touches[0];
      startTx = state.tx; startTy = state.ty;
    }
    lastDist = 0;
  }, { passive: true });

  outer.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (lastDist > 0) {
        state.scale = Math.max(0.15, Math.min(5, state.scale * (d / lastDist)));
        applyTx(inner, state);
      }
      lastDist = d;
    } else if (e.touches.length === 1 && t0) {
      state.tx = startTx + (e.touches[0].clientX - t0.clientX);
      state.ty = startTy + (e.touches[0].clientY - t0.clientY);
      applyTx(inner, state);
    }
  }, { passive: true });

  outer.addEventListener('touchend', () => { lastDist = 0; }, { passive: true });

  // Mouse drag
  let md = false, mx = 0, my = 0, mtx = 0, mty = 0;
  outer.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    md = true; mx = e.clientX; my = e.clientY; mtx = state.tx; mty = state.ty;
    outer.style.cursor = 'grabbing';
  });
  const onMouseMove = (e: MouseEvent) => {
    if (!md) return;
    state.tx = mtx + (e.clientX - mx);
    state.ty = mty + (e.clientY - my);
    applyTx(inner, state);
  };
  const onMouseUp = () => {
    md = false;
    outer.style.cursor = '';
  };
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  // Wheel zoom — faster multiplier for snappier feel
  outer.addEventListener('wheel', e => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.18 : 0.85;
    state.scale = Math.max(0.15, Math.min(5, state.scale * f));
    applyTx(inner, state);
  }, { passive: false });

  return () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };
}

// Centre a node in the visible area (with smooth animation).
function centreNode(node: MapNode, outer: HTMLElement, state: TxState, inner: HTMLElement): void {
  const rect = outer.getBoundingClientRect();
  state.tx = rect.width / 2 - node.x * state.scale;
  state.ty = rect.height / 3 - node.y * state.scale;
  applyTx(inner, state, true);
}

// ── Navigation buttons ────────────────────────────────────────────────────────

interface NavControls {
  container: HTMLElement;
  leftGroup: HTMLElement;   // where the caller drops the quiet "Go deeper" control
  update(n: MapNode | null, forkChoice: Map<MapNode, number>): void;
}

// Chevron glyphs matching the builder's step arrows (same viewBox + stroke), so
// the map's move arrows read as the same control the builder uses.
const CHEVRON: Record<string, string> = {
  left: 'm15 18-6-6 6-6',
  right: 'm9 18 6-6-6-6',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
};

function chevronBtn(dir: keyof typeof CHEVRON, aria: string, handler: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  // Borrow the builder's step-button look (bar-btn--step) for an identical feel.
  b.className = 'rmap-nav-btn bar-btn bar-btn--step';
  b.setAttribute('aria-label', aria);
  b.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none"
    stroke="currentColor" stroke-width="2.25" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true"><path d="${CHEVRON[dir]}"/></svg>`;
  b.disabled = true;
  b.addEventListener('click', handler);
  return b;
}

function makeControls(
  onLeft: () => void,
  onUp: () => void,
  onDown: () => void,
  onRight: () => void,
  onZoomIn: () => void,
  onZoomOut: () => void,
): NavControls {
  const bar = document.createElement('div');
  bar.className = 'rmap-controls';

  // Left group: zoom (and the caller's "Go deeper" control, prepended later).
  const leftGroup = document.createElement('div');
  leftGroup.className = 'rmap-controls-left';

  const zoomGroup = document.createElement('div');
  zoomGroup.className = 'rmap-controls-zoom';
  for (const [t, a, h] of [['−', 'Zoom out', onZoomOut], ['+', 'Zoom in', onZoomIn]]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rmap-zoom-btn';
    b.setAttribute('aria-label', String(a));
    b.textContent = String(t);
    b.addEventListener('click', h as () => void);
    zoomGroup.appendChild(b);
  }
  leftGroup.appendChild(zoomGroup);

  // Right group: the move arrows, in the builder's step style.
  const navGroup = document.createElement('div');
  navGroup.className = 'rmap-controls-nav';
  const leftBtn = chevronBtn('left', 'Previous move', onLeft);
  const upBtn = chevronBtn('up', 'Prev variation', onUp);
  const downBtn = chevronBtn('down', 'Next variation', onDown);
  const rightBtn = chevronBtn('right', 'Next move', onRight);
  navGroup.append(leftBtn, upBtn, downBtn, rightBtn);

  bar.appendChild(leftGroup);
  bar.appendChild(navGroup);

  function update(n: MapNode | null, forkChoice: Map<MapNode, number>): void {
    if (!n) {
      leftBtn.disabled = upBtn.disabled = downBtn.disabled = rightBtn.disabled = true;
      return;
    }
    // ← available if parent exists (and parent has a san — not the invisible root).
    leftBtn.disabled = !n.parent || !n.parent.san;
    // → available if node has any children.
    rightBtn.disabled = n.children.length === 0;
    // ↑/↓ available if we have siblings (parent has multiple children).
    const siblings = n.parent?.children ?? [];
    const idx = siblings.indexOf(n);
    upBtn.disabled = idx <= 0;
    downBtn.disabled = idx >= siblings.length - 1;

    // Show a hint on the → button when there's a fork to navigate.
    if (n.children.length > 1) {
      const ci = forkChoice.get(n) ?? 0;
      rightBtn.title = `Into variation ${ci + 1} of ${n.children.length}`;
    } else {
      rightBtn.title = '';
    }
  }

  return { container: bar, leftGroup, update };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function openRepertoireMap(
  lines: Line[],
  colour: 'white' | 'black',
  onOpenLine: (line: Line) => void,
  opts: RepertoireMapOptions = {},
): void {
  const filtered = lines.filter(l => l.colour === colour);
  if (!filtered.length) return;

  const overlay = document.createElement('div');
  overlay.className = 'rmap-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  // Closing the map (back button, opening a line, or the system back gesture)
  // all route through here so the back-navigation stack stays in sync.
  // Set once initPanZoom runs (below); detaches the window drag listeners.
  let disposePanZoom: (() => void) | null = null;
  function close(): void {
    disposePanZoom?.();
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);

  // Header.
  const header = document.createElement('div');
  header.className = 'rmap-header';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'rmap-back';
  back.setAttribute('aria-label', 'Close map');
  back.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none"
    stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19 12H5M12 5l-7 7 7 7"/></svg>`;
  back.addEventListener('click', close);

  const titleEl = document.createElement('h2');
  titleEl.className = 'rmap-title';
  titleEl.textContent = opts.title ?? (colour === 'white' ? 'White repertoire' : 'Black repertoire');

  const count = document.createElement('span');
  count.className = 'rmap-title-count';
  count.textContent = opts.subtitle ?? `${filtered.length} line${filtered.length !== 1 ? 's' : ''}`;

  header.appendChild(back);
  header.appendChild(titleEl);
  header.appendChild(count);
  overlay.appendChild(header);

  // Tree area (relative-positioned so the preview panel can float inside it).
  const treeArea = document.createElement('div');
  treeArea.className = 'rmap-tree-area';

  // Pan/zoom container.
  const treeWrap = document.createElement('div');
  treeWrap.className = 'rmap-tree-wrap';

  const inner = document.createElement('div');
  inner.className = 'rmap-zoom-inner';

  // Depth control. When set, render only `currentPlies` deep and let "Go deeper"
  // step it 5 moves at a time. The lines are (re)supplied at the current depth by
  // the control: opponents rebuild their pruned tree from stored games, the
  // repertoire hands back its saved lines (the merge truncates). Building from
  // games at the shallow start depth is cheap, so this is fine on first render.
  const depth = opts.depth ?? null;
  let currentPlies = depth ? depth.startPlies : Infinity;

  const currentLines = (): Line[] => (depth ? depth.atDepth(currentPlies) : filtered);

  // Per-move stats. Built once by the caller (UCI-keyed lookup); stamped onto the
  // tree on every (re)build, and always shown when present.
  const statsTree = opts.stats?.tree ?? null;

  let root = buildMergedTree(currentLines(), currentPlies);
  attachStats(root, statsTree);

  if (!root.children.length) {
    const empty = document.createElement('p');
    empty.className = 'rmap-empty';
    empty.textContent = 'No lines saved yet.';
    treeArea.appendChild(empty);
    overlay.appendChild(treeArea);
    document.body.appendChild(overlay);
    return;
  }

  // Navigation state.
  let selected: MapNode | null = null;
  const forkChoice = new Map<MapNode, number>();
  const state: TxState = { scale: 1, tx: 0, ty: 0 };

  // Preview panel.
  const preview = makePreview(colour, opts, close);
  treeArea.appendChild(preview.el);

  // A tiny spinner shown while a "Go deeper" rebuild runs off the paint frame.
  const spinner = document.createElement('div');
  spinner.className = 'rmap-spinner';
  spinner.hidden = true;
  spinner.innerHTML = '<div class="rmap-spinner-ring" aria-label="Building deeper map"></div>';
  treeArea.appendChild(spinner);

  function selectNode(n: MapNode): void {
    selected = n;

    // Update SVG highlight.
    svg.querySelectorAll('.rmap-node--selected')
      .forEach(el => el.classList.remove('rmap-node--selected'));
    n.svgEl?.classList.add('rmap-node--selected');

    // Show preview.
    preview.show(n, filtered, line => {
      close();
      onOpenLine(line);
    });

    // Centre node (with animation).
    centreNode(n, treeWrap, state, inner);

    // Update nav buttons.
    controls.update(n, forkChoice);
  }

  let svg = buildSVG(root, selectNode);
  inner.appendChild(svg);
  treeWrap.appendChild(inner);
  treeArea.appendChild(treeWrap);
  overlay.appendChild(treeArea);

  // Re-centre the view on the first move of the (possibly rebuilt) tree.
  function centreOnFirst(): void {
    requestAnimationFrame(() => {
      if (root.children[0]) {
        const rect = treeWrap.getBoundingClientRect();
        state.tx = rect.width / 2 - root.children[0].x * state.scale;
        state.ty = 60;
        applyTx(inner, state);
      }
    });
  }

  // Find a node by its uci-path from the root, or null if the path doesn't exist.
  function findByUcis(ucis: string[]): MapNode | null {
    let cur: MapNode | null = root;
    for (const u of ucis) {
      cur = cur ? cur.children.find(c => c.uci === u) ?? null : null;
      if (!cur) return null;
    }
    return cur;
  }

  // Swap in a freshly built tree at the current depth (after "Go deeper").
  // Going deeper only adds nodes, so we keep the user's place: re-select the
  // same move (by path) when one was selected, else re-centre on the first move.
  function rebuild(): void {
    const keepPath = selected ? nodePath(selected).ucis : null;
    root = buildMergedTree(currentLines(), currentPlies);
    attachStats(root, statsTree);
    const newSvg = buildSVG(root, selectNode);
    svg.replaceWith(newSvg);
    svg = newSvg;
    forkChoice.clear();
    const restored = keepPath ? findByUcis(keepPath) : null;
    if (restored) {
      selectNode(restored);
    } else {
      selected = null;
      controls.update(null, forkChoice);
      preview.el.hidden = true;
      centreOnFirst();
    }
  }

  function goDeeper(): void {
    if (!depth) return;
    const next = Math.min(currentPlies + depth.stepPlies, depth.maxPlies);
    if (next <= currentPlies) return;  // already at the data's full depth
    currentPlies = next;
    spinner.hidden = false;
    updateDeeper();
    // Let the spinner paint before the (possibly heavy) opponent rebuild.
    requestAnimationFrame(() => setTimeout(() => {
      rebuild();
      spinner.hidden = true;
    }, 0));
  }

  // Arrow + zoom controls.
  const controls = makeControls(
    // ← previous move
    () => {
      if (selected?.parent?.san) selectNode(selected.parent);
    },
    // ↑ previous sibling
    () => {
      if (!selected?.parent) return;
      const siblings = selected.parent.children;
      const idx = siblings.indexOf(selected);
      if (idx > 0) {
        forkChoice.set(selected.parent, idx - 1);
        selectNode(siblings[idx - 1]);
      }
    },
    // ↓ next sibling
    () => {
      if (!selected?.parent) return;
      const siblings = selected.parent.children;
      const idx = siblings.indexOf(selected);
      if (idx < siblings.length - 1) {
        forkChoice.set(selected.parent, idx + 1);
        selectNode(siblings[idx + 1]);
      }
    },
    // → next move
    () => {
      if (!selected?.children.length) return;
      const idx = forkChoice.get(selected) ?? 0;
      const target = selected.children[Math.min(idx, selected.children.length - 1)];
      selectNode(target);
    },
    // zoom in
    () => {
      state.scale = Math.min(5, state.scale * 1.35);
      applyTx(inner, state, true);
    },
    // zoom out
    () => {
      state.scale = Math.max(0.15, state.scale / 1.35);
      applyTx(inner, state, true);
    },
  );

  // The quiet "Go deeper" control sits in the left group of the control bar. It
  // steps 5 moves at a time and retires once the data's full depth is on screen.
  let deeperBtn: HTMLButtonElement | null = null;
  function updateDeeper(): void {
    if (!depth || !deeperBtn) return;
    if (currentPlies >= depth.maxPlies) {
      if (depth.importHint && depth.maxPlies <= depth.startPlies) {
        // Too shallow to deepen at all (an old, shallow import): show the reach.
        deeperBtn.hidden = false;
        deeperBtn.disabled = true;
        deeperBtn.classList.add('rmap-deeper-btn--hint');
        deeperBtn.textContent = `Imported at ${Math.floor(depth.maxPlies / 2)} moves`;
      } else {
        deeperBtn.hidden = true;  // the full depth is already on screen
      }
      return;
    }
    deeperBtn.hidden = false;
    deeperBtn.disabled = false;
    deeperBtn.classList.remove('rmap-deeper-btn--hint');
    const movesLeft = Math.ceil((depth.maxPlies - currentPlies) / 2);
    const step = Math.min(depth.stepPlies / 2, movesLeft);
    deeperBtn.textContent = `Go ${step} move${step === 1 ? '' : 's'} deeper`;
  }
  if (depth) {
    deeperBtn = document.createElement('button');
    deeperBtn.type = 'button';
    deeperBtn.className = 'rmap-deeper-btn';
    deeperBtn.addEventListener('click', goDeeper);
    // A quiet floating pill, top-left of the tree area — out of the way of both
    // the move arrows and the preview panel.
    treeArea.appendChild(deeperBtn);
    updateDeeper();
  }

  overlay.appendChild(controls.container);
  document.body.appendChild(overlay);

  disposePanZoom = initPanZoom(treeWrap, inner, state);

  // Start centred on the first child.
  centreOnFirst();
}
