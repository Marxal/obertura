// Repertoire Map — two views reachable from Statistics:
//
//   openLineMap(line)            — branching diagram for a single opening
//   openColourMap(lines, colour) — zoomable/pannable tree of all lines for one colour
//
// Both open as a full-screen overlay. Tapping a node shows a mini chessboard
// at that position in a panel along the bottom.

import type { Line } from './types';
import type { MoveNode } from './tree';
import { Chessground } from 'chessground';
import type { Api as CgApi } from 'chessground/api';
import type { Key } from 'chessground/types';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const SVG_NS = 'http://www.w3.org/2000/svg';

// Node box geometry
const NW = 56;   // node width
const NH = 30;   // node height
const HG = 10;   // horizontal gap between sibling subtrees
const VG = 42;   // vertical gap: bottom of level N → top of level N+1
const PAD = 18;  // outer padding around the whole tree

// ── Internal node ─────────────────────────────────────────────────────────────

interface MapNode {
  san: string;
  uci: string;
  fen: string;
  children: MapNode[];
  x: number;
  y: number;
}

function fromMoveNode(n: MoveNode): MapNode {
  return {
    san: n.san, uci: n.uci, fen: n.fen,
    children: n.children.map(fromMoveNode),
    x: 0, y: 0,
  };
}

// Merge all lines into one tree: nodes with the same uci at the same position
// are shared, so repeated opening moves appear only once.
function buildMergedTree(lines: Line[]): MapNode {
  const root: MapNode = { san: '', uci: '', fen: START_FEN, children: [], x: 0, y: 0 };
  for (const l of lines) mergeInto(root, l.tree);
  return root;
}

function mergeInto(parent: MapNode, src: MoveNode): void {
  for (const sc of src.children) {
    let ex = parent.children.find(c => c.uci === sc.uci);
    if (!ex) {
      ex = { san: sc.san, uci: sc.uci, fen: sc.fen, children: [], x: 0, y: 0 };
      parent.children.push(ex);
    }
    mergeInto(ex, sc);
  }
}

// ── Layout ────────────────────────────────────────────────────────────────────

// Minimum width this subtree needs (horizontal space).
function subW(n: MapNode): number {
  if (!n.children.length) return NW;
  const total = n.children.reduce((s, c, i) => s + subW(c) + (i ? HG : 0), 0);
  return Math.max(NW, total);
}

// Assign x/y to every node. x is centre; y is top edge.
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

// Deepest y-coordinate reached by any leaf.
function treeMaxY(n: MapNode): number {
  if (!n.children.length) return n.y;
  return Math.max(...n.children.map(treeMaxY));
}

// ── SVG construction ──────────────────────────────────────────────────────────

function buildSVG(
  root: MapNode,
  skipRoot: boolean,
  onSelect: (n: MapNode) => void,
): SVGSVGElement {
  const totalW = subW(root);
  const svgW = totalW + 2 * PAD;
  placeNodes(root, PAD, PAD, totalW);
  const maxY = treeMaxY(root);
  const svgH = maxY + NH + PAD * 2;

  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('width', String(svgW));
  svg.setAttribute('height', String(svgH));
  svg.style.display = 'block';
  svg.style.overflow = 'visible';

  drawEdges(svg, root, skipRoot);
  drawNodes(svg, root, skipRoot, onSelect);

  return svg;
}

function drawEdges(parent: SVGElement, n: MapNode, skipCurrent: boolean): void {
  for (const child of n.children) {
    if (!skipCurrent) {
      // Curved connector: cubic bezier from parent-bottom-centre to child-top-centre.
      const x1 = n.x;
      const y1 = n.y + NH;
      const x2 = child.x;
      const y2 = child.y;
      const cy1 = y1 + (y2 - y1) * 0.45;
      const cy2 = y2 - (y2 - y1) * 0.45;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', `M${x1},${y1} C${x1},${cy1} ${x2},${cy2} ${x2},${y2}`);
      path.setAttribute('class', 'rmap-edge');
      parent.appendChild(path);
    }
    drawEdges(parent, child, false);
  }
}

function drawNodes(
  parent: SVGElement,
  n: MapNode,
  skip: boolean,
  onSelect: (n: MapNode) => void,
): void {
  if (!skip) {
    const isFork = n.children.length > 1;
    const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
    g.setAttribute('class', 'rmap-node' + (isFork ? ' rmap-node--fork' : ''));

    // Oversized transparent hit-area for reliable tapping on mobile.
    const hit = document.createElementNS(SVG_NS, 'rect');
    hit.setAttribute('x', String(n.x - NW / 2 - 10));
    hit.setAttribute('y', String(n.y - 7));
    hit.setAttribute('width', String(NW + 20));
    hit.setAttribute('height', String(NH + 14));
    hit.setAttribute('rx', '10');
    hit.setAttribute('fill', 'transparent');
    g.appendChild(hit);

    // Visible background.
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', String(n.x - NW / 2));
    bg.setAttribute('y', String(n.y));
    bg.setAttribute('width', String(NW));
    bg.setAttribute('height', String(NH));
    bg.setAttribute('rx', '7');
    bg.setAttribute('class', 'rmap-node-bg');
    g.appendChild(bg);

    // SAN text.
    const txt = document.createElementNS(SVG_NS, 'text');
    txt.setAttribute('x', String(n.x));
    txt.setAttribute('y', String(n.y + NH / 2 + 5));
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('class', 'rmap-node-text');
    txt.textContent = n.san;
    g.appendChild(txt);

    g.addEventListener('click', e => {
      e.stopPropagation();
      parent.querySelectorAll('.rmap-node--selected')
        .forEach(el => el.classList.remove('rmap-node--selected'));
      g.classList.add('rmap-node--selected');
      onSelect(n);
    });

    parent.appendChild(g);
  }

  for (const child of n.children) {
    drawNodes(parent, child, false, onSelect);
  }
}

// ── Position preview panel ────────────────────────────────────────────────────

interface Preview {
  el: HTMLElement;
  show(n: MapNode): void;
}

function makePreview(colour: 'white' | 'black'): Preview {
  const panel = document.createElement('div');
  panel.className = 'rmap-preview';
  panel.hidden = true;

  // Placeholder shown before any node is selected.
  const hint = document.createElement('div');
  hint.className = 'rmap-preview-hint';
  hint.textContent = 'Tap a move to see the position';
  panel.appendChild(hint);

  const boardEl = document.createElement('div');
  boardEl.className = 'rmap-preview-board';
  boardEl.hidden = true;
  panel.appendChild(boardEl);

  const info = document.createElement('div');
  info.className = 'rmap-preview-info';
  info.hidden = true;
  panel.appendChild(info);

  let cg: CgApi | null = null;

  function show(n: MapNode): void {
    panel.hidden = false;
    hint.hidden = true;
    boardEl.hidden = false;
    info.hidden = false;

    const from = n.uci.slice(0, 2) as Key;
    const to = n.uci.slice(2, 4) as Key;

    if (!cg) {
      cg = Chessground(boardEl, {
        fen: n.fen,
        orientation: colour,
        viewOnly: true,
        coordinates: false,
        drawable: { enabled: false },
        animation: { enabled: false },
        selectable: { enabled: false },
        highlight: { lastMove: true, check: false },
        lastMove: [from, to],
      });
    } else {
      cg.set({ fen: n.fen, lastMove: [from, to] });
    }

    info.innerHTML = '';
    const sanEl = document.createElement('div');
    sanEl.className = 'rmap-preview-san';
    sanEl.textContent = n.san;
    info.appendChild(sanEl);

    if (n.children.length > 1) {
      const varEl = document.createElement('div');
      varEl.className = 'rmap-preview-meta';
      varEl.textContent = `${n.children.length} variations`;
      info.appendChild(varEl);
    } else if (n.children.length === 0) {
      const endEl = document.createElement('div');
      endEl.className = 'rmap-preview-meta';
      endEl.textContent = 'End of line';
      info.appendChild(endEl);
    }
  }

  return { el: panel, show };
}

// ── Pinch-zoom + pan (whole-colour view) ──────────────────────────────────────

function initZoomPan(outer: HTMLElement, inner: HTMLElement): void {
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let isDragging = false;
  let dragOx = 0;
  let dragOy = 0;
  const ptrs = new Map<number, PointerEvent>();
  let lastPinchDist = 0;

  function apply(): void {
    inner.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }

  outer.addEventListener('pointerdown', e => {
    ptrs.set(e.pointerId, e);
    outer.setPointerCapture(e.pointerId);
    if (ptrs.size === 1) {
      isDragging = true;
      dragOx = e.clientX - tx;
      dragOy = e.clientY - ty;
    } else {
      isDragging = false;
    }
  }, { passive: true });

  outer.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, e);

    if (ptrs.size >= 2) {
      isDragging = false;
      const [a, b] = [...ptrs.values()];
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (lastPinchDist > 0) {
        const factor = dist / lastPinchDist;
        scale = Math.max(0.25, Math.min(3, scale * factor));
        apply();
      }
      lastPinchDist = dist;
    } else if (ptrs.size === 1 && isDragging) {
      tx = e.clientX - dragOx;
      ty = e.clientY - dragOy;
      apply();
    }
  }, { passive: true });

  const end = (e: PointerEvent) => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) lastPinchDist = 0;
    if (ptrs.size === 0) isDragging = false;
  };
  outer.addEventListener('pointerup', end, { passive: true });
  outer.addEventListener('pointercancel', end, { passive: true });

  // Mouse-wheel zoom for desktop/trackpad.
  outer.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    scale = Math.max(0.25, Math.min(3, scale * factor));
    apply();
  }, { passive: false });
}

// ── Empty-tree guard ──────────────────────────────────────────────────────────

function renderEmpty(container: HTMLElement, msg: string): void {
  const p = document.createElement('p');
  p.className = 'rmap-empty';
  p.textContent = msg;
  container.appendChild(p);
}

// ── Overlay builder ───────────────────────────────────────────────────────────

function openOverlay(
  title: string,
  root: MapNode,
  colour: 'white' | 'black',
  zoomable: boolean,
): void {
  const overlay = document.createElement('div');
  overlay.className = 'rmap-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  // Header row.
  const header = document.createElement('div');
  header.className = 'rmap-header';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'rmap-back';
  backBtn.setAttribute('aria-label', 'Close map');
  // Back-arrow SVG.
  backBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none"
    stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19 12H5M12 5l-7 7 7 7"/></svg>`;
  backBtn.addEventListener('click', () => overlay.remove());

  const titleEl = document.createElement('h2');
  titleEl.className = 'rmap-title';
  titleEl.textContent = title;

  header.appendChild(backBtn);
  header.appendChild(titleEl);
  overlay.appendChild(header);

  // Tree area.
  const treeWrap = document.createElement('div');
  treeWrap.className = zoomable ? 'rmap-tree-wrap rmap-tree-wrap--zoomable' : 'rmap-tree-wrap';

  const preview = makePreview(colour);

  if (root.children.length === 0) {
    renderEmpty(treeWrap, 'No moves in this line yet.');
    overlay.appendChild(treeWrap);
    overlay.appendChild(preview.el);
    document.body.appendChild(overlay);
    return;
  }

  if (zoomable) {
    // Zoom/pan: inner div receives the transform.
    const inner = document.createElement('div');
    inner.className = 'rmap-zoom-inner';
    const svg = buildSVG(root, true, n => preview.show(n));
    inner.appendChild(svg);
    treeWrap.appendChild(inner);
    overlay.appendChild(treeWrap);
    overlay.appendChild(preview.el);
    document.body.appendChild(overlay);
    initZoomPan(treeWrap, inner);
  } else {
    // Plain scrollable container for the per-opening tree.
    const svg = buildSVG(root, true, n => preview.show(n));
    treeWrap.appendChild(svg);
    overlay.appendChild(treeWrap);
    overlay.appendChild(preview.el);
    document.body.appendChild(overlay);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

// Open the per-opening variation tree for a single saved line.
export function openLineMap(line: Line): void {
  const root = fromMoveNode(line.tree);
  openOverlay(
    `${line.name || line.openingName || 'Line'} — variations`,
    root,
    line.colour,
    false,
  );
}

// Open the zoomable whole-colour navigator merging all lines of one colour.
export function openColourMap(lines: Line[], colour: 'white' | 'black'): void {
  const filtered = lines.filter(l => l.colour === colour);
  if (!filtered.length) return;
  const root = buildMergedTree(filtered);
  openOverlay(
    colour === 'white' ? 'White repertoire map' : 'Black repertoire map',
    root,
    colour,
    true,
  );
}
