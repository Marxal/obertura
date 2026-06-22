// Move notation preference: plain SAN ("Nf3", "Bxf7") or figurine — the
// "emoji" pieces ("♞f3", "♝xf7"). Device-local (localStorage), like the other
// appearance prefs. A single formatMove() runs at every spot the app prints a
// move, so the whole UI honours the choice from one switch in Settings.
//
// Default is figurine: it reads more like a board and tells pawn moves apart
// from piece moves at a glance.

const KEY = 'obertura.moveNotation';

export type MoveNotation = 'standard' | 'figurine';

// Neutral chess figurines (the solid glyphs, legible on light and dark) keyed by
// SAN piece letter. Pawns carry no letter in SAN, so they're never substituted.
const FIGURES: Record<string, string> = {
  K: '♚',
  Q: '♛',
  R: '♜',
  B: '♝',
  N: '♞',
};

export function getMoveNotation(): MoveNotation {
  return localStorage.getItem(KEY) === 'standard' ? 'standard' : 'figurine';
}

export function setMoveNotation(n: MoveNotation): void {
  localStorage.setItem(KEY, n);
}

// Convert ONE SAN move to the chosen notation. Standard returns it untouched;
// figurine swaps the leading piece letter and any promotion piece (the "Q" in
// "e8=Q") for its glyph, leaving files, ranks, captures, checks, mates and
// castling exactly as written.
export function formatMove(san: string, notation: MoveNotation = getMoveNotation()): string {
  if (notation === 'standard' || !san) return san;
  // Promotion piece, e.g. e8=Q → e8=♛, also covers "e8=Q+".
  let out = san.replace(/=([KQRBN])/g, (_m, p: string) => '=' + FIGURES[p]);
  // Leading piece letter. Castling ("O-O") starts with 'O', so it's left alone.
  const first = out[0];
  if (FIGURES[first]) out = FIGURES[first] + out.slice(1);
  return out;
}

// "1.e4 e5 2.♞f3 ♞c6" — a flat SAN list rendered with move numbers, honouring
// the notation choice. The single home for what used to be a per-screen copy on
// My Lines, Explore, Traps, the library and onboarding.
export function formatSanLine(sans: string[], notation: MoveNotation = getMoveNotation()): string {
  let out = '';
  for (let i = 0; i < sans.length; i++) {
    const mv = formatMove(sans[i], notation);
    out += i % 2 === 0 ? `${i / 2 + 1}.${mv} ` : `${mv} `;
  }
  return out.trim();
}
