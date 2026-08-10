// The eight curated first lines, and the arithmetic that turns one into
// something the picker and the builder can use.
//
// The JSON stores each line once, in full, as SAN. A LEVEL is a truncation of
// it, measured in THE USER'S OWN moves — 3 for "Starting out", 5 for "Club
// player", 7 for "Deep prep", capped where a line is shorter. Truncating by the
// user's own moves is what guarantees a cut always ends on a move they have to
// remember: White's nth move is ply 2n−1, Black's is ply 2n. That matches how
// the builder nudges you to finish a line, so a line saved from onboarding looks
// exactly like one built by hand.
//
// Everything is replayed through chess.js once, lazily, and cached: a cut is
// then just a slice of the cached arrays. The picker asks for up to 24 of these
// (8 lines × 3 levels) while the user flicks between segments, so they must be
// free after the first look.

import { Chess } from 'chess.js';
import { nameForPath } from './openings';
import data from './onboarding-lines.json';

export type OnboardingStyle = 'solid' | 'sharp' | 'classical' | 'wild';
export type OnboardingLevel = 'beginner' | 'intermediate' | 'advanced';
export type OnboardingColour = 'white' | 'black';

export interface OnboardingLine {
  style: OnboardingStyle;
  colour: OnboardingColour;
  name: string;
  blurb: string;
  moves: string[];
  cuts: Record<OnboardingLevel, number>;
}

const LINES = (data as { lines: OnboardingLine[] }).lines;

// The order the 2×2 grid reads in, so the cards never shuffle between renders.
export const STYLE_ORDER: OnboardingStyle[] = ['solid', 'sharp', 'classical', 'wild'];

export const STYLE_LABELS: Record<OnboardingStyle, string> = {
  solid: 'Solid',
  sharp: 'Sharp',
  classical: 'Classical',
  wild: 'Wild',
};

// The level control's labels. The move count is a caption under each, and it's
// the nominal count — a line that's shorter says so on its own card instead.
export const LEVELS: { value: OnboardingLevel; label: string; moves: number }[] = [
  { value: 'beginner', label: 'Starting out', moves: 3 },
  { value: 'intermediate', label: 'Club player', moves: 5 },
  { value: 'advanced', label: 'Deep prep', moves: 7 },
];

// One line, truncated to a level: everything the picker and the builder need.
export interface LineCut {
  line: OnboardingLine;
  level: OnboardingLevel;
  // How many of the user's own moves this cut holds (may be below the level's
  // nominal count when the curated line is shorter).
  ownMoves: number;
  sans: string[];
  ucis: string[];
  fens: string[];
  finalFen: string;
  // Always non-null in practice — the self-test asserts every cut resolves —
  // but typed honestly so a future edit to the JSON can't crash the picker.
  openingName: string | null;
}

interface Replayed {
  sans: string[];
  ucis: string[];
  fens: string[];
}

const replayCache = new Map<OnboardingLine, Replayed>();

// Replay a curated line through chess.js, collecting the UCI and FEN of every
// ply. Stops at the first illegal move rather than throwing: a typo in the JSON
// should shorten a card, never take the first-run screen down with it.
function replay(line: OnboardingLine): Replayed {
  const cached = replayCache.get(line);
  if (cached) return cached;

  const chess = new Chess();
  const out: Replayed = { sans: [], ucis: [], fens: [] };
  for (const san of line.moves) {
    let move;
    try { move = chess.move(san); } catch { move = null; }
    if (!move) break;
    out.sans.push(move.san);
    out.ucis.push(move.from + move.to + (move.promotion ?? ''));
    out.fens.push(chess.fen());
  }
  replayCache.set(line, out);
  return out;
}

// How many plies a level keeps. The user's nth move is ply 2n−1 as White and
// 2n as Black, and the count is clamped to what the line actually holds.
export function cutPlies(line: OnboardingLine, level: OnboardingLevel): number {
  const available = replay(line).sans.length;
  const maxOwn = line.colour === 'white'
    ? Math.ceil(available / 2)
    : Math.floor(available / 2);
  const own = Math.min(line.cuts[level], maxOwn);
  const plies = line.colour === 'white' ? own * 2 - 1 : own * 2;
  return Math.max(0, Math.min(available, plies));
}

export function cutFor(line: OnboardingLine, level: OnboardingLevel): LineCut {
  const full = replay(line);
  const plies = cutPlies(line, level);
  const fens = full.fens.slice(0, plies);
  return {
    line,
    level,
    ownMoves: line.colour === 'white' ? Math.ceil(plies / 2) : Math.floor(plies / 2),
    sans: full.sans.slice(0, plies),
    ucis: full.ucis.slice(0, plies),
    fens,
    finalFen: fens[fens.length - 1] ?? new Chess().fen(),
    openingName: nameForPath(fens),
  };
}

// The four cards for one colour, in STYLE_ORDER. Any style missing from the
// JSON is simply absent rather than a hole in the grid.
export function linesFor(colour: OnboardingColour): OnboardingLine[] {
  return STYLE_ORDER
    .map(style => LINES.find(l => l.colour === colour && l.style === style))
    .filter((l): l is OnboardingLine => !!l);
}

export function allOnboardingLines(): OnboardingLine[] {
  return LINES;
}
