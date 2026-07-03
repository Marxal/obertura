// The bundled catalogue of fundamental endgames for the End game trainer's
// "Classic endgames" list. Pure data + grouping helpers (no DOM), so it can be
// self-tested. Positions live in endgames.json; each one is a textbook ending
// with ≤7 pieces, so the Lichess tablebase can act as the ground-truth judge when
// the trainer plays it out (see endgame-playout.ts).

import RAW from './endgames.json';

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

export const CATEGORY_META: Record<EndgameCategory, { label: string; blurb: string }> = {
  mates: { label: 'Basic checkmates', blurb: 'Force mate with the pieces up.' },
  pawn: { label: 'Pawn endings', blurb: 'Opposition, key squares and the rook-pawn draw.' },
  rook: { label: 'Rook endings', blurb: 'The two you must know: Lucena and Philidor.' },
  queen: { label: 'Queen endings', blurb: 'Convert the queen against a lone pawn.' },
  minor: { label: 'Minor-piece endings', blurb: 'Bishops, knights and the wrong-bishop draw.' },
};

export const LEVEL_META: Record<EndgameLevel, { label: string; rank: number }> = {
  essential: { label: 'Essential', rank: 0 },
  intermediate: { label: 'Intermediate', rank: 1 },
  advanced: { label: 'Advanced', rank: 2 },
};

const ENDGAMES: Endgame[] = RAW as Endgame[];

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
      groups.push({ category, label: meta.label, blurb: meta.blurb, items });
    }
  }
  return groups;
}
