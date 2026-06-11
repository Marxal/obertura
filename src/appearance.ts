// Appearance preferences beyond the light/dark theme: the board colour scheme
// and the page's paper texture. Both are device-local (localStorage) and applied
// by setting a data-* attribute on <html>, which the CSS keys off. A tiny
// pre-paint snippet in index.html applies the same values before first paint so
// there's no flash of the wrong board/texture.

const BOARD_KEY = 'obertura.boardColour';
const PAPER_KEY = 'obertura.paperTexture';
const PIECE_KEY = 'obertura.pieceSet';

export type BoardColour = 'wood' | 'green' | 'blue' | 'grey';

const BOARD_VALUES: BoardColour[] = ['wood', 'green', 'blue', 'grey'];

// ── Piece sets ────────────────────────────────────────────────────────────────
// cburnett is the bundled default (its CSS ships in main.ts). The other three are
// vendored from lichess (src/pieces/*.css) and loaded ON DEMAND the first time
// they're picked, then cached. Each non-default set's CSS is scoped under
// html[data-pieces="<set>"], which out-specifies cburnett's unscoped rules, so
// setting the attribute swaps the pieces everywhere a board renders.
export type PieceSet = 'cburnett' | 'merida' | 'chessnut' | 'kiwen-suwi';

const PIECE_VALUES: PieceSet[] = ['cburnett', 'merida', 'chessnut', 'kiwen-suwi'];

// Static map so Vite can split each set's CSS into its own async chunk. The
// import is fired only when a set is first applied; the returned promise is
// cached below so re-selecting never re-imports.
const PIECE_LOADERS: Record<Exclude<PieceSet, 'cburnett'>, () => Promise<unknown>> = {
  merida: () => import('./pieces/merida.css'),
  chessnut: () => import('./pieces/chessnut.css'),
  'kiwen-suwi': () => import('./pieces/kiwen-suwi.css'),
};

const loaded = new Map<PieceSet, Promise<unknown>>();

function loadPieceCss(set: PieceSet): Promise<unknown> {
  if (set === 'cburnett') return Promise.resolve();
  let p = loaded.get(set);
  if (!p) {
    p = PIECE_LOADERS[set]();
    loaded.set(set, p);
  }
  return p;
}

export function getPieceSet(): PieceSet {
  const v = localStorage.getItem(PIECE_KEY);
  return PIECE_VALUES.includes(v as PieceSet) ? (v as PieceSet) : 'cburnett';
}

export function setPieceSet(s: PieceSet): void {
  localStorage.setItem(PIECE_KEY, s);
  applyPieceSet(s);
}

// Load the set's stylesheet first (when not the bundled default), THEN flip the
// attribute, so we never flash cburnett glyphs while a freshly-picked set's CSS
// is still in flight. cburnett carries no attribute — its unscoped rules apply.
export function applyPieceSet(s: PieceSet = getPieceSet()): Promise<void> {
  if (s === 'cburnett') {
    delete document.documentElement.dataset.pieces;
    return Promise.resolve();
  }
  return loadPieceCss(s).then(() => {
    document.documentElement.dataset.pieces = s;
  });
}

export function getBoardColour(): BoardColour {
  const v = localStorage.getItem(BOARD_KEY);
  return BOARD_VALUES.includes(v as BoardColour) ? (v as BoardColour) : 'wood';
}

export function setBoardColour(c: BoardColour): void {
  localStorage.setItem(BOARD_KEY, c);
  applyBoardColour(c);
}

// Wood is the original/default scheme, so it carries no attribute — the :root
// board variables already describe it. Other schemes set data-board.
export function applyBoardColour(c: BoardColour = getBoardColour()): void {
  if (c === 'wood') delete document.documentElement.dataset.board;
  else document.documentElement.dataset.board = c;
}

// Paper texture is on by default; only an explicit "off" disables it.
export function getPaperTexture(): boolean {
  return localStorage.getItem(PAPER_KEY) !== 'off';
}

export function setPaperTexture(on: boolean): void {
  localStorage.setItem(PAPER_KEY, on ? 'on' : 'off');
  applyPaperTexture(on);
}

export function applyPaperTexture(on: boolean = getPaperTexture()): void {
  if (on) delete document.documentElement.dataset.paper;
  else document.documentElement.dataset.paper = 'off';
}

// Apply all three at boot (theme.ts handles light/dark separately). The piece
// set may need to fetch its on-demand stylesheet; that resolves asynchronously,
// so a non-default set can briefly show as cburnett on a cold open until its
// (browser-cached) chunk lands.
export function initAppearance(): void {
  applyBoardColour();
  applyPaperTexture();
  void applyPieceSet();
}
