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
import { t } from './i18n';

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
    label: t('mid.mateInX'),
    blurb: t('mid.findTheMatingNet'),
    icon: () => Icons.target(16),
    themes: [
      { angle: 'mateIn1', label: t('mid.mateIn1') },
      { angle: 'mateIn2', label: t('mid.mateIn2') },
      { angle: 'mateIn3', label: t('mid.mateIn3') },
      { angle: 'mateIn4', label: t('mid.mateIn4') },
      { angle: 'mateIn5', label: t('mid.mateIn5Or') },
    ],
  },
  {
    id: 'mate-patterns',
    label: t('mid.matePatterns'),
    blurb: t('mid.classicMatesToKnow'),
    icon: () => Icons.sparkles(16),
    themes: [
      { angle: 'backRankMate', label: t('mid.backRankMate') },
      { angle: 'hookMate', label: t('mid.hookMate') },
      { angle: 'smotheredMate', label: t('mid.smotheredMate') },
      { angle: 'arabianMate', label: t('mid.arabianMate') },
      { angle: 'anastasiaMate', label: t('mid.anastasiaSMate') },
      { angle: 'bodenMate', label: t('mid.bodenSMate') },
      { angle: 'doubleBishopMate', label: t('mid.doubleBishopMate') },
      { angle: 'dovetailMate', label: t('mid.dovetailMate') },
    ],
  },
  {
    id: 'tactics',
    // Not "Tactics": that is the name of the whole domain and of its big
    // button, one row above this accordion.
    label: t('mid.tacticalMotifs'),
    blurb: t('mid.forksPinsSkewersAnd'),
    icon: () => Icons.swords(16),
    themes: [
      { angle: 'fork', label: t('mid.fork') },
      { angle: 'pin', label: t('mid.pin') },
      { angle: 'skewer', label: t('mid.skewer') },
      { angle: 'discoveredAttack', label: t('mid.discoveredAttack') },
      { angle: 'doubleCheck', label: t('mid.doubleCheck') },
      { angle: 'deflection', label: t('mid.deflection') },
      { angle: 'attraction', label: t('mid.attraction') },
      { angle: 'sacrifice', label: t('mid.sacrifice') },
      { angle: 'interference', label: t('mid.interference') },
      { angle: 'intermezzo', label: t('mid.zwischenzugInBetween') },
      { angle: 'xRayAttack', label: t('mid.xRayAttack') },
      { angle: 'zugzwang', label: t('mid.zugzwang') },
      { angle: 'hangingPiece', label: t('mid.hangingPiece') },
      { angle: 'trappedPiece', label: t('mid.trappedPiece') },
      { angle: 'advancedPawn', label: t('mid.advancedPawn') },
      { angle: 'capturingDefender', label: t('mid.captureTheDefender') },
    ],
  },
  {
    id: 'length',
    label: t('mid.puzzleLength'),
    blurb: t('mid.fromOneMoversTo'),
    icon: () => Icons.order(16),
    themes: [
      { angle: 'oneMove', label: t('mid.oneMove') },
      { angle: 'short', label: t('mid.shortTwoMoves') },
      { angle: 'long', label: t('mid.longThreeMoves') },
      { angle: 'veryLong', label: t('mid.veryLongFourOr') },
    ],
  },
  {
    id: 'goals',
    label: t('mid.goals'),
    blurb: t('mid.fromEqualisingToMating'),
    icon: () => Icons.flag(16),
    themes: [
      { angle: 'equality', label: t('mid.equality') },
      { angle: 'advantage', label: t('mid.advantage') },
      { angle: 'crushing', label: t('mid.crushing') },
      { angle: 'mate', label: t('reply.pause.mate') },
    ],
  },
];

// Every theme angle in the catalogue, flattened — used to seed the rated mix with
// a broad fallback pool when the user's repertoire is thin (so puzzles vary
// instead of repeating).
export function allThemeAngles(): string[] {
  return PUZZLE_THEME_GROUPS.flatMap((g) => g.themes.map((t) => t.angle));
}
