// Inlined Lucide-style icons (stroke="currentColor", fill="none", strokeWidth=2).
// Only the icons the app actually uses — no npm overhead.

import type { MoveClass } from './winprob';

function svg(paths: string, size = 16): SVGSVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '2');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = paths;
  return el;
}

export const Icons = {
  // ── Navigation ──────────────────────────────────────────────────────────────
  build:    (s?: number) => svg(`<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>`, s),
  list:     (s?: number) => svg(`<path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/>`, s),
  zap:      (s?: number) => svg(`<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>`, s),
  search:   (s?: number) => svg(`<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>`, s),
  trending: (s?: number) => svg(`<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>`, s),
  // The Explore and Statistics tab-bar marks (see index.html's #bottom-nav). Kept
  // here so the onboarding intro can teach the menu with the very same glyphs.
  compass:  (s?: number) => svg(`<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>`, s),
  barChart: (s?: number) => svg(`<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>`, s),
  tree:     (s?: number) => svg(`<circle cx="12" cy="19" r="2.5"/><circle cx="6" cy="5" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M18 7.5v2a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2"/><path d="M12 11.5v5"/>`, s),
  // The My Lines tab mark — a chess pawn drawn as a stroked outline (circle head,
  // collar ledge, bell body, flared base) to match the other nav glyphs.
  pawn:     (s?: number) => svg(`<circle cx="12" cy="4.5" r="2.5"/><path d="M9.5 8.5h5"/><path d="M9.5 8.5c0 2.5-1 3.5-2 6.5h9c-1-3-2-4-2-6.5"/><path d="M6 19c.5-2.5 1.5-3 1.5-4h9c0 1 1 1.5 1.5 4z"/>`, s),

  // ── Actions ──────────────────────────────────────────────────────────────────
  save:     (s?: number) => svg(`<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>`, s),
  play:     (s?: number) => svg(`<polygon points="6 3 20 12 6 21 6 3"/>`, s),
  reset:    (s?: number) => svg(`<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>`, s),
  plus:     (s?: number) => svg(`<path d="M5 12h14"/><path d="M12 5v14"/>`, s),
  pencil:   (s?: number) => svg(`<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>`, s),
  trash:    (s?: number) => svg(`<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>`, s),
  back:     (s?: number) => svg(`<path d="m15 18-6-6 6-6"/>`, s),
  reply:    (s?: number) => svg(`<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>`, s),
  chevronRight: (s?: number) => svg(`<path d="m9 18 6-6-6-6"/>`, s),
  chevronDown: (s?: number) => svg(`<path d="m6 9 6 6 6-6"/>`, s),
  eye:      (s?: number) => svg(`<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>`, s),
  flip:     (s?: number) => svg(`<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>`, s),
  download: (s?: number) => svg(`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>`, s),
  // The "connect" mark — Lucide link-2 (a broken chain rejoining).
  link:     (s?: number) => svg(`<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>`, s),
  // A success / confirmation mark — a tick inside a ring.
  checkCircle: (s?: number) => svg(`<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>`, s),
  upload:   (s?: number) => svg(`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>`, s),
  settings: (s?: number) => svg(`<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>`, s),
  order:    (s?: number) => svg(`<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h10"/><path d="M11 8h7"/><path d="M11 12h4"/>`, s),
  clock:    (s?: number) => svg(`<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`, s),
  note:     (s?: number) => svg(`<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`, s),
  // Feedback & about mark — a friendly smiley.
  smile:    (s?: number) => svg(`<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>`, s),
  target:   (s?: number) => svg(`<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>`, s),
  // The Puzzles tab mark — the Lucide "puzzle" jigsaw piece.
  puzzlePiece: (s?: number) => svg(`<path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z"/>`, s),
  // Fallback avatar for a scouted player with no profile picture.
  userCircle: (s?: number) => svg(`<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M6.2 18.6a6 6 0 0 1 11.6 0"/>`, s),
  info:     (s?: number) => svg(`<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>`, s),
  pause:    (s?: number) => svg(`<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>`, s),
  bulb:     (s?: number) => svg(`<path d="M15 14c.2-1 .7-1.7 1.5-2.5C17.7 10.2 18 9 18 7.5a6 6 0 0 0-12 0c0 1.5.3 2.7 1.5 4 .8.8 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>`, s),
  // The Statistics "Mastered" quick-stat mark — a star. Drawn as the usual stroked
  // outline; the mastered box fills it via CSS for the "filled star" read.
  star:     (s?: number) => svg(`<path d="M12 2.6l2.6 5.7 6.2.6-4.7 4.1 1.4 6.1L12 16.9 6.5 19.7l1.4-6.1L3.2 9.5l6.2-.6z"/>`, s),
  // The Statistics "Needs work" mark — a small alert triangle (warning spark).
  alert:    (s?: number) => svg(`<path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>`, s),

  // ── Theme marks (the Appearance theme swatches) ──────────────────────────────
  sun:      (s?: number) => svg(`<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>`, s),
  moon:     (s?: number) => svg(`<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>`, s),
  sparkles: (s?: number) => svg(`<path d="M9.94 14.06A2 2 0 0 0 8.5 12.6l-5.2-1.35a.5.5 0 0 1 0-.96L8.5 8.94A2 2 0 0 0 9.94 7.5l1.35-5.2a.5.5 0 0 1 .96 0l1.35 5.2a2 2 0 0 0 1.44 1.44l5.2 1.35a.5.5 0 0 1 0 .96l-5.2 1.35a2 2 0 0 0-1.44 1.44l-1.35 5.2a.5.5 0 0 1-.96 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>`, s),
  gamepad:  (s?: number) => svg(`<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.152A4 4 0 0 0 17.32 5z"/>`, s),

  // The Game-Review icon in the builder bottom bar — a magnifying glass with
  // sparkles, reading as "AI analysis". The sparkles are filled (overriding the
  // stroke-only default) so they read as little stars next to the lens.
  review:   (s?: number) => svg(`<circle cx="10" cy="11.5" r="6"/><path d="m14.3 15.8 3.7 3.7"/><path d="M18 2l.95 2.25 2.25.95-2.25.95L18 8.4l-.95-2.25-2.25-.95 2.25-.95z" fill="currentColor" stroke="none"/><path d="M21.4 9.3l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" fill="currentColor" stroke="none"/>`, s),
};

// ── Move-classification badges (Game Review) ─────────────────────────────────
// Filled circular badges, Chess.com style: a coloured disc with a white symbol.
// The same glyph is used in the move list (classIcon) and on the board square
// (classBoardSvg). Colours live here and are mirrored in style.css for the
// move-list row tint — keep the two palettes in sync.

// "book" carries no text symbol — it's drawn as a little book glyph (see
// classGlyphMarkup), so its entry here is unused but kept for completeness.
const CLASS_SYMBOL: Record<MoveClass, string> = {
  great: '!',
  best: '★',
  excellent: '✓',
  good: '✓',
  book: '',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
};

// Two distinct greens for the quality moves: best is a vivid green, good a
// clearly less-saturated one, with excellent sitting between them. Book is a
// warm brown (opening theory). Keep these in sync with style.css.
export const CLASS_COLOR: Record<MoveClass, string> = {
  great: '#5c8bb0',
  best: '#5a9e3f',
  excellent: '#7fb05f',
  good: '#a6c08a',
  book: '#9c7248',
  inaccuracy: '#e6b23a',
  mistake: '#e0822f',
  blunder: '#c93636',
};

export const CLASS_LABEL: Record<MoveClass, string> = {
  great: 'Great move',
  best: 'Best move',
  excellent: 'Excellent',
  good: 'Good',
  book: 'Book move',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
};

const BADGE_FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

// The white symbol inside a class disc, centred on (cx,cy). Most classes get a
// text glyph; "book" gets a little two-page book drawn at a scale tied to the
// disc radius `r`, so it stays centred with padding at any badge size.
function classGlyphMarkup(cls: MoveClass, cx: number, cy: number, r: number): string {
  if (cls === 'book') {
    // Book path is authored in a ±3-unit box; scale it to ~0.6× the radius.
    const s = (r * 0.62) / 3;
    return (
      `<g transform="translate(${cx} ${cy}) scale(${s})" fill="#fff" stroke="none">` +
      `<path d="M-0.18 -1.05C-1.05 -1.62 -2.2 -1.7 -3 -1.5V1.02C-2.2 0.82 -1.05 0.9 -0.18 1.46Z"/>` +
      `<path d="M0.18 -1.05C1.05 -1.62 2.2 -1.7 3 -1.5V1.02C2.2 0.82 1.05 0.9 0.18 1.46Z"/>` +
      `</g>`
    );
  }
  const sym = CLASS_SYMBOL[cls];
  const fs = sym.length > 1 ? r : r * 1.25;
  return (
    `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" ` +
    `font-size="${fs}" font-weight="800" fill="#fff" font-family='${BADGE_FONT}'>${sym}</text>`
  );
}

// A small filled badge for the move list. Colour comes from CSS
// (.class-badge--<cls>) for the disc; the symbol is drawn in white.
export function classIcon(cls: MoveClass, size = 14): SVGSVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('aria-hidden', 'true');
  el.classList.add('class-badge', `class-badge--${cls}`);
  el.innerHTML = `<circle cx="12" cy="12" r="12"/>` + classGlyphMarkup(cls, 12, 12, 12);
  return el;
}

// The board badge for chessground's customSvg, drawn in the square's 0..100
// space (so 0,0 is its top-left corner, 100,100 the bottom-right). Two parts:
//   1. a whole-square colour wash, so a blunder square reads red at a glance;
//   2. a small disc tucked into the top-right corner with the class glyph,
//      kept small so the piece underneath stays visible.
export function classBoardSvg(cls: MoveClass): { html: string; center: 'orig' } {
  const color = CLASS_COLOR[cls];
  const cx = 79, cy = 21, r = 16;
  return {
    center: 'orig',
    html:
      `<rect x="0" y="0" width="100" height="100" fill="${color}" opacity="0.5"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="#fff" stroke-width="2.5"/>` +
      classGlyphMarkup(cls, cx, cy, r),
  };
}
