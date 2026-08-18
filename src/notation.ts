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

// Guarded because the modules that print moves are also read by the pure-logic
// self-tests, which run under Node with no localStorage at all — and because a
// browser in private mode can throw here rather than return null.
export function getMoveNotation(): MoveNotation {
  try {
    return localStorage.getItem(KEY) === 'standard' ? 'standard' : 'figurine';
  } catch {
    return 'figurine';
  }
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

// "2…c5" — one move with its number, given its 1-based ply (the first move of
// the game is ply 1). White's moves take a dot, Black's an ellipsis, so a single
// move quoted on its own still says whose it is and when it happens.
export function numberedMove(san: string, ply: number, notation: MoveNotation = getMoveNotation()): string {
  const n = Math.ceil(ply / 2);
  return `${n}${ply % 2 === 1 ? '.' : '…'}${formatMove(san, notation)}`;
}
