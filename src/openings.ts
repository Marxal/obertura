// Opening-name lookups via the Lichess opening explorer.
//
// Host is explorer.lichess.ovh (the public explorer), NOT lichess.org.
// We query by `play` (a comma-separated list of UCI moves from the start)
// rather than by `fen`. This is deliberate: the explorer only matches a FEN
// when its en-passant field is "honest" (a capture is actually possible),
// whereas chess.js always sets the en-passant target after a double pawn
// push. Using `play` sidesteps that mismatch entirely.
//
// AUTH: as of 2026 the explorer no longer serves anonymous requests — they
// return HTTP 401. A free Lichess Personal Access Token (no scopes needed)
// must be sent as `Authorization: Bearer <token>`. We keep the token on the
// device only (localStorage); it is NEVER committed, because this is a
// public static site and Lichess auto-revokes leaked tokens.

const EXPLORER_URL = 'https://explorer.lichess.ovh/lichess';
const TIMEOUT_MS = 4000;
const TOKEN_KEY = 'obertura.lichessToken';

// --- Token storage (device-local) --------------------------------------

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(token: string): void {
  try {
    const t = token.trim();
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode / storage disabled — nothing we can do, lookup stays off */
  }
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Look up the opening name for a line, given its moves as UCI strings from
 * the start position (e.g. ['e2e4', 'e7e5', 'g1f3']).
 *
 * Returns the name (e.g. "Italian Game") or null. Never throws: a failed
 * lookup must not break move entry, so any network error, timeout, or
 * non-200 response resolves to null.
 */
export async function fetchOpeningName(uciMoves: string[]): Promise<string | null> {
  // The start position has no opening — don't bother the API.
  if (uciMoves.length === 0) return null;

  // Short timeout so a hanging request doesn't leave the label stuck.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const play = uciMoves.join(',');
    const url = `${EXPLORER_URL}?play=${play}&moves=0&topGames=0&recentGames=0`;
    const res = await fetch(url, { signal: controller.signal, headers: authHeaders() });
    if (!res.ok) return null;

    // The `opening` field is either { eco, name } or null.
    const data = (await res.json()) as { opening?: { eco: string; name: string } | null };
    return data.opening?.name ?? null;
  } catch {
    // Network error, abort/timeout, or bad JSON — all mean "no name".
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Safety net for any future FEN-based explorer call. NOT used by
 * fetchOpeningName (which queries by `play`), but kept here to document the
 * gotcha and ready to drop in if needed.
 *
 * chess.js sets the en-passant target square after every double pawn push,
 * but the Lichess explorer only matches a FEN when an en-passant capture is
 * actually possible. This takes a FEN and, if the en-passant field is set
 * but no enemy pawn can truly capture en passant, replaces that field with
 * '-' so the FEN matches what the explorer expects.
 */
export function normaliseFenEnPassant(fen: string): string {
  // FEN fields: piece-placement, side-to-move, castling, en-passant, ...
  const parts = fen.split(' ');
  if (parts.length < 4) return fen;

  const [placement, sideToMove, , epSquare] = parts;
  if (epSquare === '-') return fen; // nothing to normalise.

  // Build an 8×8 board from the placement field so we can inspect squares.
  // ranks[0] is rank 8 (top), ranks[7] is rank 1 (bottom); files a–h are 0–7.
  const ranks = placement.split('/');
  if (ranks.length !== 8) return fen;

  const board: string[][] = ranks.map(rank => {
    const row: string[] = [];
    for (const ch of rank) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) row.push('');
      } else {
        row.push(ch);
      }
    }
    return row.length === 8 ? row : []; // malformed → skip
  });
  if (board.some(row => row.length !== 8)) return fen;

  const piece = (file: number, rank: number): string => {
    // rank is 1–8 (chess), file is 0–7 (a–h). Convert to board indices.
    if (rank < 1 || rank > 8 || file < 0 || file > 7) return '';
    return board[8 - rank][file];
  };

  // The en-passant target square, e.g. "e6". The capturing pawn would be the
  // side to move; it must sit on an adjacent file, on the rank just behind
  // the target (from the mover's perspective).
  const epFile = epSquare.charCodeAt(0) - 'a'.charCodeAt(0); // 0–7
  const epRank = Number(epSquare[1]); // 3 or 6

  // If it's White to move, White captures upward: White pawn ('P') sits on
  // rank 5 (one below a rank-6 target). If Black to move, Black pawn ('p')
  // sits on rank 4 (one above a rank-3 target).
  const capturingPawn = sideToMove === 'w' ? 'P' : 'p';
  const captureFromRank = sideToMove === 'w' ? epRank - 1 : epRank + 1;

  const hasCapturer =
    piece(epFile - 1, captureFromRank) === capturingPawn ||
    piece(epFile + 1, captureFromRank) === capturingPawn;

  if (hasCapturer) return fen; // en-passant genuinely available — leave as-is.

  // No real en-passant capture possible: blank the field so the FEN matches.
  parts[3] = '-';
  return parts.join(' ');
}
