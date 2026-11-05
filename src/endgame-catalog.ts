// The bundled catalogue of fundamental endgames for the End game trainer's
// "Classic endgames" list. Pure data + grouping helpers (no DOM), so it can be
// self-tested. Positions live in endgames.json; each one is a textbook ending
// with ≤7 pieces, so the Lichess tablebase can act as the ground-truth judge when
// the trainer plays it out (see endgame-playout.ts).

import RAW from './endgames.json';
import { t, type MessageKey } from './i18n';

export type EndgameCategory = 'mates' | 'pawn' | 'rook' | 'queen' | 'minor';
export type EndgameLevel = 'essential' | 'intermediate' | 'advanced';
export type EndgameGoal = 'win' | 'draw';

export interface Endgame {
  id: string;
  category: EndgameCategory;
  level: EndgameLevel;
  name: string;
  fen: string;                    // side to move === youPlay
  youPlay: 'white' | 'black';     // the side you're driving (board orientation)
  goal: EndgameGoal;              // the result you must reach / hold
  idea: string;                   // one-line teaching note
}

// Display metadata. CATEGORY_ORDER fixes the list order; LEVEL_META.rank sorts
// positions within a category from gentlest to hardest.
export const CATEGORY_ORDER: EndgameCategory[] = ['mates', 'pawn', 'rook', 'queen', 'minor'];

// A trailing U+FE0E asks phones for the text (not emoji) glyph, so the symbol
// honours our colour — same trick as the board miniatures (board-mini.ts).
const VS = String.fromCharCode(0xfe0e);
export const CATEGORY_META: Record<EndgameCategory, { label: string; blurb: string; symbol: string }> = {
  mates: { label: t('mid.basicCheckmates'), blurb: t('mid.forceMateWithThe'), symbol: '♚' + VS },
  pawn: { label: t('mid.pawnEndings'), blurb: t('mid.oppositionKeySquaresAnd'), symbol: '♟' + VS },
  rook: { label: t('mid.rookEndings'), blurb: t('mid.theTwoYouMust'), symbol: '♜' + VS },
  queen: { label: t('mid.queenEndings'), blurb: t('mid.convertTheQueenAgainst'), symbol: '♛' + VS },
  minor: { label: t('mid.minorPieceEndings'), blurb: t('mid.bishopsKnightsAndThe'), symbol: '♞' + VS },
};

export const LEVEL_META: Record<EndgameLevel, { label: string; rank: number }> = {
  essential: { label: t('mid.essential'), rank: 0 },
  intermediate: { label: t('open.tag.intermediate'), rank: 1 },
  advanced: { label: t('open.tag.advanced'), rank: 2 },
};

// The name and idea are sentences like any other, so they live in the dictionaries
// (`endgame.<id>.name`, `endgame.<id>.idea`). The file holds the chess.
const ENDGAMES: Endgame[] = (RAW as Omit<Endgame, 'name' | 'idea'>[]).map((e) => ({
  ...e,
  name: t(`endgame.${e.id}.name` as MessageKey),
  idea: t(`endgame.${e.id}.idea` as MessageKey),
}));

export function allEndgames(): Endgame[] {
  return ENDGAMES;
}

export function getEndgame(id: string): Endgame | undefined {
  return ENDGAMES.find((e) => e.id === id);
}

export interface EndgameGroup {
  category: EndgameCategory;
  label: string;
  blurb: string;
  symbol: string;
  items: Endgame[];
}

// The catalogue grouped by category in CATEGORY_ORDER, each group's items sorted
// by level then name. Empty categories are dropped so the screen only shows
// sections that have positions.
export function endgamesByCategory(): EndgameGroup[] {
  const groups: EndgameGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const items = ENDGAMES
      .filter((e) => e.category === category)
      .sort((a, b) =>
        LEVEL_META[a.level].rank - LEVEL_META[b.level].rank || a.name.localeCompare(b.name));
    if (items.length) {
      const meta = CATEGORY_META[category];
      groups.push({ category, label: meta.label, blurb: meta.blurb, symbol: meta.symbol, items });
    }
  }
  return groups;
}
