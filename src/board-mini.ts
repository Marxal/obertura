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

// Build the miniature for a position, oriented from the given side (Black lines
// show from Black's side, so a black miniature is flipped).
export function buildMiniBoard(fen: string, orientation: 'white' | 'black'): SVGSVGElement {
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

  return svg;
}
