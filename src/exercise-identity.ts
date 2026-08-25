// The "from your games" exercises' colours, in one import-free module.
//
// They used to live inside mistakes-screen.ts, which is where the cards that
// wear them are built. That was fine until the exercise overlays started wearing
// them too (run-header.ts): detective-run.ts reaching back to mistakes-screen.ts
// for one hex string would close an import cycle, since mistakes-screen.ts is
// what launches detective-run.ts in the first place.
//
// So the palette sits below both. Nothing is imported here and nothing should
// be: it is a list of colours.

import type { MistakeCategory } from './mistake-scan';

/** The Middle-game pane's ember — every exercise here is tinted with it. */
export const MISTAKE_TINT = '#a3492e';

// The two exercises that read a whole game rather than one position. Their own
// accents, off the four categories' palette because they aren't categories.
export const DETECTIVE_ACCENT = '#6f6ac0';   // indigo — the search
export const WHICH_MOVE_ACCENT = '#5c8bb0';  // steel blue — two moves, one choice

// Per-category accents for the cards, kin to the Practise cards' palette.
export const CATEGORY_ACCENT: Record<MistakeCategory, string> = {
  'opening-blunder': '#b3593b', // ember — it went wrong early
  'punish-opening': '#3f7d8a',  // teal — seize what they hand you
  'missed-win': '#c79a2a',      // gold — the win that got away
  'blunder': '#a94444',         // red — the plain ??
};
