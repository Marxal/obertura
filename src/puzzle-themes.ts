// The bundled catalogue of Lichess puzzle themes for the Puzzles screen's
// "Practice by theme" accordion. Each theme is a Lichess puzzle "angle" (the same
// slot the opening keys use — see puzzles.ts fetchNextPuzzle), so a themed run is
// just a normal rated puzzle session pointed at one theme. Pure data + icons, no
// DOM and no network — the screen sits on top of this.
//
// The angle keys are Lichess's own theme ids (https://lichess.org/training/themes):
// mateInX, the named mating patterns, the tactical motifs, the length buckets and
// the goal buckets. Kept to the ones with plenty of puzzles so a run never starves.

import { Icons } from './icons';

export interface PuzzleTheme {
  angle: string; // Lichess puzzle theme id (fetchNextPuzzle angle)
  label: string; // display name
}

export interface PuzzleThemeGroup {
  id: string;
  label: string;
  blurb: string;
  icon: () => SVGElement;
  themes: PuzzleTheme[];
}

export const PUZZLE_THEME_GROUPS: PuzzleThemeGroup[] = [
  {
    id: 'mate-in',
    label: 'Mate in X',
    blurb: 'Forced checkmates — find the mating net in a set number of moves.',
    icon: () => Icons.target(16),
    themes: [
      { angle: 'mateIn1', label: 'Mate in 1' },
      { angle: 'mateIn2', label: 'Mate in 2' },
      { angle: 'mateIn3', label: 'Mate in 3' },
      { angle: 'mateIn4', label: 'Mate in 4' },
      { angle: 'mateIn5', label: 'Mate in 5 or more' },
    ],
  },
  {
    id: 'mate-patterns',
    label: 'Mate patterns',
    blurb: 'The classic mating shapes worth knowing on sight.',
    icon: () => Icons.sparkles(16),
    themes: [
      { angle: 'backRankMate', label: 'Back-rank mate' },
      { angle: 'hookMate', label: 'Hook mate' },
      { angle: 'smotheredMate', label: 'Smothered mate' },
      { angle: 'arabianMate', label: 'Arabian mate' },
      { angle: 'anastasiaMate', label: "Anastasia's mate" },
      { angle: 'bodenMate', label: "Boden's mate" },
      { angle: 'doubleBishopMate', label: 'Double bishop mate' },
      { angle: 'dovetailMate', label: 'Dovetail mate' },
    ],
  },
  {
    id: 'tactics',
    label: 'Tactics',
    blurb: 'The everyday motifs — forks, pins, skewers and the rest.',
    icon: () => Icons.swords(16),
    themes: [
      { angle: 'fork', label: 'Fork' },
      { angle: 'pin', label: 'Pin' },
      { angle: 'skewer', label: 'Skewer' },
      { angle: 'discoveredAttack', label: 'Discovered attack' },
      { angle: 'doubleCheck', label: 'Double check' },
      { angle: 'deflection', label: 'Deflection' },
      { angle: 'attraction', label: 'Attraction' },
      { angle: 'sacrifice', label: 'Sacrifice' },
      { angle: 'interference', label: 'Interference' },
      { angle: 'intermezzo', label: 'Zwischenzug (in-between)' },
      { angle: 'xRayAttack', label: 'X-ray attack' },
      { angle: 'zugzwang', label: 'Zugzwang' },
      { angle: 'hangingPiece', label: 'Hanging piece' },
      { angle: 'trappedPiece', label: 'Trapped piece' },
      { angle: 'advancedPawn', label: 'Advanced pawn' },
      { angle: 'capturingDefender', label: 'Capture the defender' },
    ],
  },
  {
    id: 'length',
    label: 'Puzzle length',
    blurb: 'From one-movers to deep calculations.',
    icon: () => Icons.order(16),
    themes: [
      { angle: 'oneMove', label: 'One-move' },
      { angle: 'short', label: 'Short — two moves' },
      { angle: 'long', label: 'Long — three moves' },
      { angle: 'veryLong', label: 'Very long — four or more' },
    ],
  },
  {
    id: 'goals',
    label: 'Goals',
    blurb: 'What the puzzle asks of you — from equalising to checkmate.',
    icon: () => Icons.flag(16),
    themes: [
      { angle: 'equality', label: 'Equality' },
      { angle: 'advantage', label: 'Advantage' },
      { angle: 'crushing', label: 'Crushing' },
      { angle: 'mate', label: 'Checkmate' },
    ],
  },
];

// Every theme angle in the catalogue, flattened — used to seed the rated mix with
// a broad fallback pool when the user's repertoire is thin (so puzzles vary
// instead of repeating).
export function allThemeAngles(): string[] {
  return PUZZLE_THEME_GROUPS.flatMap((g) => g.themes.map((t) => t.angle));
}
