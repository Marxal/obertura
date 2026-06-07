import type { MoveNode } from './tree';

export interface BranchViewOptions {
  onSelectNode: (nodeId: string) => void;
  activeNodeId: string;
}

const NODE_W = 56;
const NODE_H = 36;
const COL_GAP = 16;
const ROW_GAP = 8;
const PAD = 12;
const RADIUS = 6;

interface LayoutNode {
  node: MoveNode;
  depth: number;
  row: number;
  children: LayoutNode[];
}

function buildLayout(node: MoveNode, depth: number, counter: { n: number }): LayoutNode {
  const children = node.children.map(child => buildLayout(child, depth + 1, counter));
  let row: number;
  if (children.length === 0) {
    row = counter.n++;
  } else {
    row = children[0].row;
  }
  return { node, depth, row, children };
}

function collectAll(ln: LayoutNode, out: LayoutNode[]): void {
  out.push(ln);
  for (const c of ln.children) collectAll(c, out);
}

function svgEl(tag: string): Element {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

export function renderBranchView(
  container: HTMLElement,
  root: MoveNode,
  { onSelectNode, activeNodeId }: BranchViewOptions
): void {
  container.innerHTML = '';

  if (root.children.length === 0) {
    const p = document.createElement('p');
    p.className = 'branch-empty';
    p.textContent = 'Play a move to see the branch diagram.';
    container.appendChild(p);
    return;
  }

  const counter = { n: 0 };
  // Root sits at depth -1 so its children land at depth 0 (leftmost column)
  const layoutRoot = buildLayout(root, -1, counter);
  const totalRows = Math.max(counter.n, 1);

  const all: LayoutNode[] = [];
  collectAll(layoutRoot, all);
  // Only render nodes at depth 0 and deeper (root itself is invisible)
  const visible = all.filter(ln => ln.depth >= 0);

  const maxDepth = Math.max(...visible.map(ln => ln.depth));
  const totalCols = maxDepth + 1;

  const svgW = PAD * 2 + totalCols * NODE_W + Math.max(0, totalCols - 1) * COL_GAP;
  const svgH = PAD * 2 + totalRows * NODE_H + Math.max(0, totalRows - 1) * ROW_GAP;

  const svg = svgEl('svg');
  svg.setAttribute('width', String(svgW));
  svg.setAttribute('height', String(svgH));
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
  svg.setAttribute('aria-label', 'Branch diagram');
  svg.setAttribute('role', 'img');

  function nodeX(ln: LayoutNode): number {
    return PAD + ln.depth * (NODE_W + COL_GAP);
  }
  function nodeY(ln: LayoutNode): number {
    return PAD + ln.row * (NODE_H + ROW_GAP);
  }

  // Draw connector lines first so they appear behind the boxes
  for (const ln of visible) {
    for (const child of ln.children) {
      const line = svgEl('line');
      line.setAttribute('x1', String(nodeX(ln) + NODE_W));
      line.setAttribute('y1', String(nodeY(ln) + NODE_H / 2));
      line.setAttribute('x2', String(nodeX(child)));
      line.setAttribute('y2', String(nodeY(child) + NODE_H / 2));
      line.setAttribute('stroke', 'rgba(156, 107, 67, 0.35)');
      line.setAttribute('stroke-width', '1.5');
      svg.appendChild(line);
    }
  }

  // Draw node boxes on top of lines
  for (const ln of visible) {
    const x = nodeX(ln);
    const y = nodeY(ln);
    const isActive = ln.node.id === activeNodeId;

    const g = svgEl('g');
    g.setAttribute('cursor', 'pointer');
    g.setAttribute('role', 'button');
    g.setAttribute('tabindex', '0');
    g.setAttribute('aria-label', ln.node.san);
    g.addEventListener('click', () => onSelectNode(ln.node.id));
    g.addEventListener('keydown', (e) => {
      const key = (e as KeyboardEvent).key;
      if (key === 'Enter' || key === ' ') onSelectNode(ln.node.id);
    });

    const rect = svgEl('rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(NODE_W));
    rect.setAttribute('height', String(NODE_H));
    rect.setAttribute('rx', String(RADIUS));
    rect.setAttribute('fill', isActive ? '#ff9b21' : '#faf4e6');
    rect.setAttribute('stroke', isActive ? '#e08800' : '#c9b48f');
    rect.setAttribute('stroke-width', '1');

    const text = svgEl('text');
    text.setAttribute('x', String(x + NODE_W / 2));
    text.setAttribute('y', String(y + NODE_H / 2));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('fill', isActive ? '#fff' : '#3c3225');
    text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
    text.setAttribute('font-size', '12');
    text.setAttribute('font-weight', isActive ? '700' : '500');
    text.setAttribute('pointer-events', 'none');
    text.textContent = ln.node.san;

    g.appendChild(rect);
    g.appendChild(text);
    svg.appendChild(g);
  }

  container.appendChild(svg);
}
