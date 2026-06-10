// Appearance preferences beyond the light/dark theme: the board colour scheme
// and the page's paper texture. Both are device-local (localStorage) and applied
// by setting a data-* attribute on <html>, which the CSS keys off. A tiny
// pre-paint snippet in index.html applies the same values before first paint so
// there's no flash of the wrong board/texture.

const BOARD_KEY = 'obertura.boardColour';
const PAPER_KEY = 'obertura.paperTexture';

export type BoardColour = 'wood' | 'green' | 'blue' | 'grey';

const BOARD_VALUES: BoardColour[] = ['wood', 'green', 'blue', 'grey'];

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

// Apply both at boot (theme.ts handles light/dark separately).
export function initAppearance(): void {
  applyBoardColour();
  applyPaperTexture();
}
