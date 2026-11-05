// Move notation preference: plain SAN ("Nf3", "Bxf7") or figurine — the
// "emoji" pieces ("♞f3", "♝xf7"). Device-local (localStorage), like the other
// appearance prefs. A single formatMove() runs at every spot the app prints a
// move, so the whole UI honours the choice from one switch in Settings.
//
// Default is figurine: it reads more like a board and tells pawn moves apart
// from piece moves at a glance.

import { appLocale } from './i18n';

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

// What the letter notation calls each piece, for languages that don't use the English
// letters. Cf3 in Catalan and Spanish, Sf3 in Swedish. PGN never goes through this: it
// stays in English everywhere, as the format requires.
const LETTERS: Record<string, Record<string, string>> = {
  ca: { K: 'R', Q: 'D', R: 'T', B: 'A', N: 'C' },
  es: { K: 'R', Q: 'D', R: 'T', B: 'A', N: 'C' },
  sv: { K: 'K', Q: 'D', R: 'T', B: 'L', N: 'S' },
};

function localLetter(piece: string): string {
  const language = appLocale();
  return (language && LETTERS[language]?.[piece]) ?? piece;
}

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

// Convert ONE SAN move to the chosen notation. Standard writes it in the language's
// own letters; figurine swaps the leading piece letter and any promotion piece (the
// "Q" in "e8=Q") for its glyph. Either way files, ranks, captures, checks, mates and
// castling stay exactly as written.
export function formatMove(san: string, notation: MoveNotation = getMoveNotation()): string {
  if (!san) return san;
  const piece = (letter: string): string => (notation === 'standard' ? localLetter(letter) : FIGURES[letter]);
  // Promotion piece, e.g. e8=Q → e8=♛, also covers "e8=Q+".
  let out = san.replace(/=([KQRBN])/g, (_m, p: string) => '=' + piece(p));
  // Leading piece letter. Castling ("O-O") starts with 'O', so it's left alone.
  const first = out[0];
  if (FIGURES[first]) out = piece(first) + out.slice(1);
  return out;
}

// Moves written inside a sentence: "Nf3", "...Bxf7+", "Nbd2–f1", "e8=Q".
const MOVE_IN_TEXT = /(?<![\p{L}\p{N}])(?:([KQRBN])([a-h]?[1-8]?x?[a-h][1-8](?:=[KQRBN])?[+#]?)|([a-h](?:x[a-h])?[18]=)([KQRBN])([+#]?))(?![\p{L}\p{N}])/gu;
const FIGURE_LETTERS: Record<string, string> = { '♚': 'K', '♛': 'Q', '♜': 'R', '♝': 'B', '♞': 'N' };

/** English letters in a sentence become piece symbols, which mean the same in every language. */
export function movesToSymbols(text: string): string {
  return text.replace(MOVE_IN_TEXT, (_m, piece?: string, rest?: string, pawn?: string, promoted?: string, end?: string) => (
    piece
      ? FIGURES[piece] + (rest ?? '').replace(/=([KQRBN])/, (_p, q: string) => '=' + FIGURES[q])
      : `${pawn}${FIGURES[promoted ?? '']}${end ?? ''}`
  ));
}

// A note, plan or trap's text, for showing. Only ever on the way to the screen: what's
// stored stays as written, and the edit box still shows that.
//
// In English any letters in the sentence are moves, whoever wrote them. Elsewhere the
// letters are left alone, because a Catalan note saying "Re2" means the KING: our own
// translated notes reach this already in symbols (content-language.ts), so nobody's own
// words get turned into the wrong piece.
export function formatMovesInText(text: string, notation: MoveNotation = getMoveNotation()): string {
  const symbols = appLocale() ? text : movesToSymbols(text);
  if (notation === 'figurine') return symbols;
  return symbols.replace(/[♚♛♜♝♞]/g, (figure) => localLetter(FIGURE_LETTERS[figure]));
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

export interface PvMovePart {
  /** "23." / "23…" / "" (a white move past the first needs no number). */
  prefix: string;
  san: string;
}

// A PV/continuation's move numbers, seeded from an arbitrary position's own
// move number and side to move (FEN fields 5 and 1) — so the first move gets
// the right number, "." for white and "…" for black. One move per element,
// for a caller that renders each as its own element (engine-panel.ts's
// tappable PV chips, full-story.ts's continuation card); formatPvLine below
// is the same arithmetic for a caller that just wants the joined string
// (eval-panel.ts's line preview).
export function pvMoveParts(
  sanLine: string[], fen: string, notation: MoveNotation = getMoveNotation(),
): PvMovePart[] {
  const parts = fen.split(' ');
  let moveNo = parseInt(parts[5] ?? '1', 10) || 1;
  let white = (parts[1] ?? 'w') === 'w';
  const out: PvMovePart[] = [];
  for (let i = 0; i < sanLine.length; i++) {
    const prefix = white ? `${moveNo}.` : (i === 0 ? `${moveNo}…` : '');
    out.push({ prefix, san: formatMove(sanLine[i], notation) });
    if (!white) moveNo++;
    white = !white;
  }
  return out;
}

export function formatPvLine(
  sanLine: string[], fen: string, notation: MoveNotation = getMoveNotation(),
): string {
  return pvMoveParts(sanLine, fen, notation).map(p => `${p.prefix}${p.san}`).join(' ');
}
