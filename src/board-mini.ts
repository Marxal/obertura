// A tiny, static SVG board miniature drawn straight from a FEN — no chessground
// instance, so a screen full of these (50+ saved lines) stays instant. Squares
// are coloured via CSS classes that read the board-theme variables
// (--board-light / --board-dark), so switching the board colour in Settings
// recolours every miniature live. Pieces are neutral built-in Unicode glyphs:
// the active piece set lives in scoped CSS background-images and only two glyphs
// per set are bundled, so reusing it per-square here isn't cheap.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Solid Unicode chess glyphs, keyed by lowercase piece letter. A trailing
// U+FE0E variation selector asks for text (not emoji) presentation so the glyph
// honours our fill colour instead of becoming a coloured emoji on some phones.
const VS = String.fromCharCode(0xfe0e);
const GLYPHS: Record<string, string> = {
  k: '♚' + VS,
  q: '♛' + VS,
  r: '♜' + VS,
  b: '♝' + VS,
  n: '♞' + VS,
  p: '♟' + VS,
};

// Parse the placement field of a FEN into an 8×8 grid. grid[0] is rank 8 and
// grid[r][0] is the a-file; empty squares are null.
function parsePlacement(fen: string): (string | null)[][] {
  const rows = fen.split(' ')[0].split('/');
  const grid: (string | null)[][] = [];
  for (const row of rows) {
    const cells: (string | null)[] = [];
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        for (let i = 0; i < Number(ch); i++) cells.push(null);
      } else {
        cells.push(ch);
      }
    }
    grid.push(cells);
  }
  return grid;
}

const S = 10; // square size in viewBox units

function rect(x: number, y: number, cls: string): SVGRectElement {
  const r = document.createElementNS(SVG_NS, 'rect');
  r.setAttribute('x', String(x));
  r.setAttribute('y', String(y));
  r.setAttribute('width', String(S));
  r.setAttribute('height', String(S));
  r.setAttribute('class', cls);
  return r;
}

// The centre of a square (e.g. "f3"), in viewBox units, honouring orientation —
// so an arrow drawn on a flipped Black board lands on the right squares.
function squareCentre(square: string, orientation: 'white' | 'black'): { x: number; y: number } {
  const file = square.charCodeAt(0) - 97; // 'a' → 0 … 'h' → 7
  const rank = Number(square[1]);          // 1 … 8
  const gridRow = 8 - rank;                // rank 8 → row 0 (top)
  const gridCol = file;
  const dr = orientation === 'white' ? gridRow : 7 - gridRow;
  const dc = orientation === 'white' ? gridCol : 7 - gridCol;
  return { x: dc * S + S / 2, y: dr * S + S / 2 };
}

// Unique per arrow so each miniature's marker can't collide with another's.
let arrowSeq = 0;

// Draw a single move arrow (from → to) over the board, with a filled arrowhead.
// Colour comes from CSS (.mini-arrow / .mini-arrow-head) so it tracks the theme.
function drawArrow(
  svg: SVGSVGElement,
  from: string,
  to: string,
  orientation: 'white' | 'black',
): void {
  const a = squareCentre(from, orientation);
  const b = squareCentre(to, orientation);

  const id = `mini-arrow-${++arrowSeq}`;
  const defs = document.createElementNS(SVG_NS, 'defs');
  const marker = document.createElementNS(SVG_NS, 'marker');
  marker.setAttribute('id', id);
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '7');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '3.2');
  marker.setAttribute('markerHeight', '3.2');
  marker.setAttribute('orient', 'auto-start-reverse');
  const head = document.createElementNS(SVG_NS, 'path');
  head.setAttribute('d', 'M0,1 L9,5 L0,9 z');
  head.setAttribute('class', 'mini-arrow-head');
  marker.appendChild(head);
  defs.appendChild(marker);
  svg.appendChild(defs);

  // Pull the line's end back from the destination centre so the head sits over
  // the square rather than overshooting it.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const back = S * 0.34;
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(a.x));
  line.setAttribute('y1', String(a.y));
  line.setAttribute('x2', String(b.x - (dx / len) * back));
  line.setAttribute('y2', String(b.y - (dy / len) * back));
  line.setAttribute('class', 'mini-arrow');
  line.setAttribute('marker-end', `url(#${id})`);
  svg.appendChild(line);
}

// Build the miniature for a position, oriented from the given side (Black lines
// show from Black's side, so a black miniature is flipped). An optional arrow
// (from/to squares, e.g. {from:'g1',to:'f3'}) is drawn over the board.
export function buildMiniBoard(
  fen: string,
  orientation: 'white' | 'black',
  arrow?: { from: string; to: string },
): SVGSVGElement {
  const grid = parsePlacement(fen);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${S * 8} ${S * 8}`);
  svg.setAttribute('class', 'mini-board');
  svg.setAttribute('aria-hidden', 'true');

  // A light field under everything; only the dark squares are drawn over it.
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', String(S * 8));
  bg.setAttribute('height', String(S * 8));
  bg.setAttribute('class', 'mini-light');
  svg.appendChild(bg);

  for (let dr = 0; dr < 8; dr++) {
    for (let dc = 0; dc < 8; dc++) {
      // Map the displayed cell back to a board cell, honouring orientation.
      const r = orientation === 'white' ? dr : 7 - dr;
      const c = orientation === 'white' ? dc : 7 - dc;
      const x = dc * S;
      const y = dr * S;

      // Square colour is intrinsic to the board (a8 light, a1 dark), so it's
      // computed from the board cell and stays correct when flipped.
      if ((r + c) % 2 === 1) svg.appendChild(rect(x, y, 'mini-dark'));

      const piece = grid[r]?.[c];
      if (!piece) continue;
      const glyph = GLYPHS[piece.toLowerCase()];
      if (!glyph) continue;
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', String(x + S / 2));
      t.setAttribute('y', String(y + S / 2));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('dominant-baseline', 'central');
      t.setAttribute('font-size', String(S * 0.95));
      t.setAttribute('class', piece === piece.toUpperCase() ? 'mini-wp' : 'mini-bp');
      t.textContent = glyph;
      svg.appendChild(t);
    }
  }

  if (arrow) drawArrow(svg, arrow.from, arrow.to, orientation);

  return svg;
}
