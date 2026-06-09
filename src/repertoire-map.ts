// Repertoire Map — full-repertoire view of all saved lines as one zoomable tree.
//
// openRepertoireMap(lines, onOpenLine)
//
// All lines (white and black) are merged into a single tree from the start
// position. Shared opening moves appear as one node. Tapping a node opens a
// position preview at the bottom; the preview shows the opening name (offline,
// from the bundled database) and a button to open the position in the builder.

import type { Line } from './types';
import type { MoveNode } from './tree';
import { Chessground } from 'chessground';
import type { Api as CgApi } from 'chessground/api';
import type { Key } from 'chessground/types';
import { nameForFen } from './openings';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const SVG_NS = 'http://www.w3.org/2000/svg';

// Node box geometry (all in px)
const NW = 58;   // node width
const NH = 30;   // node height
const HG = 10;   // horizontal gap between sibling subtrees
const VG = 44;   // vertical gap: bottom of parent → top of child
const PAD = 20;  // outer padding around the whole tree

// ── Internal map node ─────────────────────────────────────────────────────────

interface MapNode {
  san: string;
  uci: string;
  fen: string;
  lineIds: string[];    // which Line.ids pass through this node
  children: MapNode[];
  x: number;
  y: number;
}

// Build the merged tree from all lines (both colours merged at the root).
function buildMergedTree(lines: Line[]): MapNode {
  const root: MapNode = {
    san: '', uci: '', fen: START_FEN, lineIds: [],
    children: [], x: 0, y: 0,
  };
  for (const l of lines) mergeInto(root, l.tree, l.id);
  return root;
}

function mergeInto(parent: MapNode, src: MoveNode, lineId: string): void {
  for (const sc of src.children) {
    let ex = parent.children.find(c => c.uci === sc.uci);
    if (!ex) {
      ex = { san: sc.san, uci: sc.uci, fen: sc.fen, lineIds: [], children: [], x: 0, y: 0 };
      parent.children.push(ex);
    }
    if (!ex.lineIds.includes(lineId)) ex.lineIds.push(lineId);
    mergeInto(ex, sc, lineId);
  }
}

// ── Tree layout ───────────────────────────────────────────────────────────────

function subW(n: MapNode): number {
  if (!n.children.length) return NW;
  const total = n.children.reduce((s, c, i) => s + subW(c) + (i ? HG : 0), 0);
  return Math.max(NW, total);
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

// Whose move: FEN second field = 'b' means white just moved, 'w' means black moved.
function movedBy(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'b' ? 'white' : 'black';
}

// ── SVG tree ──────────────────────────────────────────────────────────────────

function buildSVG(
  root: MapNode,
  onSelect: (n: MapNode) => void,
): SVGSVGElement {
  const w = subW(root);
  const svgW = w + 2 * PAD;
  placeNodes(root, PAD, PAD, w);
  const maxY = treeMaxY(root);
  const svgH = maxY + NH + PAD * 2;

  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('width', String(svgW));
  svg.setAttribute('height', String(svgH));
  svg.style.display = 'block';
  svg.style.overflow = 'visible';

  // Root is the start position (no SAN); draw its children directly.
  drawEdges(svg, root, true);
  drawNodes(svg, root, true, onSelect);

  return svg;
}

function drawEdges(parent: SVGElement, n: MapNode, skipCurrent: boolean): void {
  for (const child of n.children) {
    if (!skipCurrent) {
      const x1 = n.x, y1 = n.y + NH, x2 = child.x, y2 = child.y;
      const cy1 = y1 + (y2 - y1) * 0.5;
      const cy2 = y2 - (y2 - y1) * 0.5;
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', `M${x1},${y1} C${x1},${cy1} ${x2},${cy2} ${x2},${y2}`);
      p.setAttribute('class', 'rmap-edge');
      parent.appendChild(p);
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
    const mover = movedBy(n.fen); // 'white' or 'black' just moved
    const cls = [
      'rmap-node',
      `rmap-node--${mover}`,
      isFork ? 'rmap-node--fork' : '',
    ].filter(Boolean).join(' ');

    const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
    g.setAttribute('class', cls);

    // Oversized transparent hit area for reliable finger taps.
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

    // SAN label.
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

  for (const c of n.children) drawNodes(parent, c, false, onSelect);
}

// ── Position preview panel ────────────────────────────────────────────────────

interface Preview {
  el: HTMLElement;
  show(n: MapNode, lines: Line[], onOpenLine: (l: Line) => void): void;
}

function makePreview(): Preview {
  const panel = document.createElement('div');
  panel.className = 'rmap-preview';

  const hint = document.createElement('div');
  hint.className = 'rmap-preview-hint';
  hint.textContent = 'Tap any move to see the position';
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
  let cgMounted = false;

  function show(n: MapNode, lines: Line[], onOpenLine: (l: Line) => void): void {
    hint.hidden = true;
    boardEl.hidden = false;
    info.hidden = false;

    const from = n.uci.slice(0, 2) as Key;
    const to = n.uci.slice(2, 4) as Key;

    // Orient the board based on the first associated line's colour.
    const assocLine = lines.find(l => n.lineIds.includes(l.id));
    const orientation = assocLine?.colour ?? 'white';

    if (!cgMounted) {
      cg = Chessground(boardEl, {
        fen: n.fen, orientation,
        viewOnly: true, coordinates: false,
        drawable: { enabled: false },
        animation: { enabled: false },
        selectable: { enabled: false },
        highlight: { lastMove: true, check: false },
        lastMove: [from, to],
      });
      cgMounted = true;
    } else {
      cg!.set({ fen: n.fen, orientation, lastMove: [from, to] });
    }

    // Rebuild info section.
    info.innerHTML = '';

    const opening = nameForFen(n.fen);
    if (opening) {
      const nameEl = document.createElement('div');
      nameEl.className = 'rmap-preview-opening';
      nameEl.textContent = opening;
      info.appendChild(nameEl);
    }

    const sanEl = document.createElement('div');
    sanEl.className = 'rmap-preview-san';
    sanEl.textContent = n.san;
    info.appendChild(sanEl);

    const meta = document.createElement('div');
    meta.className = 'rmap-preview-meta';
    if (n.children.length > 1) {
      meta.textContent = `${n.children.length} variations`;
    } else if (n.children.length === 0) {
      meta.textContent = 'End of line';
    } else {
      meta.textContent = ' ';
    }
    info.appendChild(meta);

    // "Open in builder" — only when this node belongs to at least one saved line.
    if (assocLine) {
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'rmap-open-btn';
      openBtn.textContent = 'Open in builder';
      openBtn.addEventListener('click', () => onOpenLine(assocLine));
      info.appendChild(openBtn);
    }
  }

  return { el: panel, show };
}

// ── Pinch-zoom + pan ──────────────────────────────────────────────────────────

function initZoomPan(outer: HTMLElement, inner: HTMLElement): void {
  let scale = 1, tx = 0, ty = 0;
  let dragging = false, dragOx = 0, dragOy = 0;
  const ptrs = new Map<number, PointerEvent>();
  let lastPinchDist = 0;

  function apply(): void {
    inner.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }

  outer.addEventListener('pointerdown', e => {
    ptrs.set(e.pointerId, e);
    try { outer.setPointerCapture(e.pointerId); } catch { /* fine */ }
    if (ptrs.size === 1) {
      dragging = true; dragOx = e.clientX - tx; dragOy = e.clientY - ty;
    } else {
      dragging = false;
    }
  }, { passive: true });

  outer.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, e);
    if (ptrs.size >= 2) {
      dragging = false;
      const [a, b] = [...ptrs.values()];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (lastPinchDist > 0) {
        scale = Math.max(0.2, Math.min(4, scale * (dist / lastPinchDist)));
        apply();
      }
      lastPinchDist = dist;
    } else if (ptrs.size === 1 && dragging) {
      tx = e.clientX - dragOx; ty = e.clientY - dragOy; apply();
    }
  }, { passive: true });

  const end = (e: PointerEvent) => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) lastPinchDist = 0;
    if (ptrs.size === 0) dragging = false;
  };
  outer.addEventListener('pointerup', end, { passive: true });
  outer.addEventListener('pointercancel', end, { passive: true });

  outer.addEventListener('wheel', e => {
    e.preventDefault();
    scale = Math.max(0.2, Math.min(4, scale * (e.deltaY < 0 ? 1.12 : 0.9)));
    apply();
  }, { passive: false });
}

// ── Public API ────────────────────────────────────────────────────────────────

// Open the full repertoire map — all lines merged into one zoomable tree.
// onOpenLine is called (and the map closed) when the user taps "Open in builder".
export function openRepertoireMap(
  lines: Line[],
  onOpenLine: (line: Line) => void,
): void {
  if (!lines.length) return;

  const overlay = document.createElement('div');
  overlay.className = 'rmap-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

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
  back.addEventListener('click', () => overlay.remove());

  const titleEl = document.createElement('h2');
  titleEl.className = 'rmap-title';
  titleEl.textContent = 'Repertoire map';

  const countEl = document.createElement('span');
  countEl.className = 'rmap-title-count';
  countEl.textContent = `${lines.length} line${lines.length !== 1 ? 's' : ''}`;

  header.appendChild(back);
  header.appendChild(titleEl);
  header.appendChild(countEl);
  overlay.appendChild(header);

  const root = buildMergedTree(lines);

  if (!root.children.length) {
    const empty = document.createElement('p');
    empty.className = 'rmap-empty';
    empty.textContent = 'No lines saved yet. Build your first line to see the map.';
    overlay.appendChild(empty);
    document.body.appendChild(overlay);
    return;
  }

  // Tree area — zoomable/pannable.
  const treeWrap = document.createElement('div');
  treeWrap.className = 'rmap-tree-wrap';

  const inner = document.createElement('div');
  inner.className = 'rmap-zoom-inner';

  const preview = makePreview();

  const svg = buildSVG(root, n => {
    preview.show(n, lines, line => {
      overlay.remove();
      onOpenLine(line);
    });
  });
  inner.appendChild(svg);
  treeWrap.appendChild(inner);

  overlay.appendChild(treeWrap);
  overlay.appendChild(preview.el);
  document.body.appendChild(overlay);

  initZoomPan(treeWrap, inner);
}
