// Appearance preferences beyond the light/dark theme: the board colour scheme
// and the piece set. Both are device-local (localStorage) and applied by setting
// a data-* attribute on <html>, which the CSS keys off. A tiny pre-paint snippet
// in index.html applies the same values before first paint so there's no flash of
// the wrong board.

const BOARD_KEY = 'obertura.boardColour';
const BOARD_MANUAL_KEY = 'obertura.boardColourManual';
const PIECE_KEY = 'obertura.pieceSet';

// "wood" is the original/default scheme's internal value (shown to the user as
// "Brown" — see settings-screen.ts). The rest are vendored from lichess:
// green/blue/grey are flat-colour checkers (style.css), the other five are
// photo/pattern textures (public/boards/*).
export type BoardColour =
  | 'wood'
  | 'green'
  | 'blue'
  | 'grey'
  | 'purple-diag'
  | 'wood4'
  | 'newspaper'
  | 'olive'
  | 'blue-marble';

const BOARD_VALUES: BoardColour[] = [
  'wood',
  'green',
  'blue',
  'grey',
  'purple-diag',
  'wood4',
  'newspaper',
  'olive',
  'blue-marble',
];

// ── Piece sets ────────────────────────────────────────────────────────────────
// cburnett is the bundled default (its CSS ships in main.ts). The rest are
// vendored from lichess (src/pieces/*.css) and loaded ON DEMAND the first time
// they're picked, then cached. Each non-default set's CSS is scoped under
// html[data-pieces="<set>"], which out-specifies cburnett's unscoped rules, so
// setting the attribute swaps the pieces everywhere a board renders.
export type PieceSet =
  | 'cburnett'
  | 'maestro'
  | 'california'
  | 'mpchess'
  | 'kiwen-suwi'
  | 'horsey'
  | 'gioco'
  | 'tatiana'
  | 'letter'
  | 'anarcandy';

const PIECE_VALUES: PieceSet[] = [
  'cburnett',
  'maestro',
  'california',
  'mpchess',
  'kiwen-suwi',
  'horsey',
  'gioco',
  'tatiana',
  'letter',
  'anarcandy',
];

// Static map so Vite can split each set's CSS into its own async chunk. The
// import is fired only when a set is first applied; the returned promise is
// cached below so re-selecting never re-imports.
const PIECE_LOADERS: Record<Exclude<PieceSet, 'cburnett'>, () => Promise<unknown>> = {
  maestro: () => import('./pieces/maestro.css'),
  california: () => import('./pieces/california.css'),
  mpchess: () => import('./pieces/mpchess.css'),
  'kiwen-suwi': () => import('./pieces/kiwen-suwi.css'),
  horsey: () => import('./pieces/horsey.css'),
  gioco: () => import('./pieces/gioco.css'),
  tatiana: () => import('./pieces/tatiana.css'),
  letter: () => import('./pieces/letter.css'),
  anarcandy: () => import('./pieces/anarcandy.css'),
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

// Whether the user has ever picked a board colour themselves (via the swatches
// in Settings), as opposed to one set automatically as a theme's default. Once
// true, theme changes must never touch the board colour again. Back-compat: any
// colour stored before this flag existed can only have come from a user's own
// swatch tap (setBoardColour was the only writer), so its presence alone counts
// as manual and we stamp the flag in lazily on first check.
export function hasManualBoardColour(): boolean {
  if (localStorage.getItem(BOARD_MANUAL_KEY) === '1') return true;
  if (localStorage.getItem(BOARD_KEY) !== null) {
    localStorage.setItem(BOARD_MANUAL_KEY, '1');
    return true;
  }
  return false;
}

export function setBoardColour(c: BoardColour): void {
  localStorage.setItem(BOARD_KEY, c);
  localStorage.setItem(BOARD_MANUAL_KEY, '1');
  applyBoardColour(c);
}

// Filenames for the photo/pattern board textures (public/boards/*), keyed by
// their BoardColour value. The flat schemes (wood/green/blue/grey) have none —
// they're drawn from CSS variables only.
const BOARD_TEXTURE_FILES: Partial<Record<BoardColour, string>> = {
  'purple-diag': 'purple-diag.png',
  wood4: 'wood4.jpg',
  newspaper: 'newspaper.svg',
  olive: 'olive.jpg',
  'blue-marble': 'blue-marble.jpg',
};

// Resolves a texture's URL under the app's base path (the site doesn't serve
// from domain root — see vite.config.ts `base`), so plain `/boards/...` would
// 404. Used both to apply the board and to render its swatch preview.
export function boardTextureUrl(c: BoardColour): string | undefined {
  const file = BOARD_TEXTURE_FILES[c];
  return file ? `${import.meta.env.BASE_URL}boards/${file}` : undefined;
}

// Wood is the original/default scheme, so it carries no attribute — the :root
// board variables already describe it. Other schemes set data-board. Texture
// schemes also set --board-image, which the [data-board="..."] cg-board rules
// in style.css read instead of a literal url() (which couldn't know the base
// path at CSS-author time).
export function applyBoardColour(c: BoardColour = getBoardColour()): void {
  if (c === 'wood') delete document.documentElement.dataset.board;
  else document.documentElement.dataset.board = c;

  const texture = boardTextureUrl(c);
  if (texture) document.documentElement.style.setProperty('--board-image', `url('${texture}')`);
  else document.documentElement.style.removeProperty('--board-image');
}

// The four named themes (system isn't one — it resolves to light or dark
// without the user explicitly picking a theme), each with its own default board
// colour. Applied whenever the user picks a theme, but only while they've never
// chosen a board colour of their own (see hasManualBoardColour).
export type NamedTheme = 'classic-light' | 'classic-dark' | 'elegant' | 'gamer';

const THEME_BOARD_DEFAULT: Record<NamedTheme, BoardColour> = {
  'classic-light': 'wood',
  'classic-dark': 'grey',
  elegant: 'green',
  gamer: 'blue',
};

export function applyThemeDefaultBoardColour(theme: NamedTheme): void {
  if (hasManualBoardColour()) return;
  const colour = THEME_BOARD_DEFAULT[theme];
  localStorage.setItem(BOARD_KEY, colour);
  applyBoardColour(colour);
}

// Apply both at boot (theme.ts handles light/dark separately). The piece set may
// need to fetch its on-demand stylesheet; that resolves asynchronously, so a
// non-default set can briefly show as cburnett on a cold open until its
// (browser-cached) chunk lands.
export function initAppearance(): void {
  applyBoardColour();
  void applyPieceSet();
}
