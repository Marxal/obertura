// A thin client for the free Lichess Puzzle API, plus the logic that maps the
// user's openings onto Lichess "angle" keys. Pure (no DOM) so it can be
// self-tested; the screen and the solving overlay sit on top of this.
//
// Endpoints (all on https://lichess.org):
//   GET /api/puzzle/next?angle=&difficulty=&color=  → one puzzle (the next one)
//   GET /api/puzzle/dashboard/{days}                → your puzzle results (auth)
//
// `next` is called ANONYMOUSLY (no Authorization header): adding the Bearer token
// turns it into a non-simple CORS request that Lichess's puzzle endpoint won't
// preflight from the browser, so the fetch throws and no puzzle ever loads.
// Avoiding repeats is handled locally instead (puzzle-log's seen-id ring). The
// dashboard still needs the token. We always fail soft (return null) on any
// network/CORS/parse error, exactly like lichess-explorer.

import { Chess } from 'chess.js';
import { openingFamily } from './analysis';
import OPENING_ANGLES from './puzzle-openings.json';

const LICHESS = 'https://lichess.org';

export type Difficulty = 'easiest' | 'easier' | 'normal' | 'harder' | 'hardest';

// One puzzle, flattened from Lichess's { game, puzzle } response into the bits we
// actually use. `solution` and the moves are UCI; `pgn` is the game's movetext
// (space-separated SAN, no headers) up to the puzzle position.
export interface Puzzle {
  id: string;
  rating: number;
  plays: number;
  solution: string[];
  themes: string[];
  initialPly: number;
  pgn: string;
  gameId: string;
}

interface PuzzleResponse {
  game?: { id?: string; pgn?: string };
  puzzle?: {
    id?: string;
    rating?: number;
    plays?: number;
    solution?: string[];
    themes?: string[];
    initialPly?: number;
  };
}

export interface NextOptions {
  difficulty?: Difficulty;
  colour?: 'white' | 'black';
}

// Fetch the next puzzle for an angle (an opening key or theme, or null for any).
// Always anonymous — see the header note: the token would break CORS here.
export async function fetchNextPuzzle(
  angle: string | null,
  opts: NextOptions = {},
): Promise<Puzzle | null> {
  try {
    const url = new URL(`${LICHESS}/api/puzzle/next`);
    if (angle) url.searchParams.set('angle', angle);
    if (opts.difficulty) url.searchParams.set('difficulty', opts.difficulty);
    if (opts.colour) url.searchParams.set('color', opts.colour);

    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = (await res.json()) as PuzzleResponse;
    const p = data.puzzle;
    if (!p?.id || !p.solution?.length || data.game?.pgn === undefined) return null;
    return {
      id: p.id,
      rating: p.rating ?? 0,
      plays: p.plays ?? 0,
      solution: p.solution,
      themes: p.themes ?? [],
      initialPly: p.initialPly ?? 0,
      pgn: data.game.pgn,
      gameId: data.game.id ?? '',
    };
  } catch {
    return null;
  }
}

// ── Puzzle position ──────────────────────────────────────────────────────────
//
// Lichess convention (verified against /api/puzzle/next): the `game.pgn` is
// truncated to exactly the puzzle, so it has `initialPly + 1` plies and ENDS with
// the opponent's blunder. Replaying the WHOLE pgn reaches the position the solver
// faces, with the SOLVER to move. solution[0] is the solver's own first move; the
// opponent replies solution[1], the solver plays solution[2], and so on. So the
// solver owns the EVEN indices (0, 2, 4…) and the odd indices are auto-played
// opponent replies. The board is oriented to the solver.

export interface PuzzleSetup {
  // FEN after replaying the whole pgn — the solver is to move here.
  fen: string;
  // The side the solver plays (to move in `fen`).
  solverColour: 'white' | 'black';
  // The full solution in UCI. The solver owns the even indices (0, 2, 4…); the
  // odd indices are auto-played opponent replies.
  solution: string[];
}

const FROM = (uci: string): { from: string; to: string; promotion?: string } => ({
  from: uci.slice(0, 2),
  to: uci.slice(2, 4),
  promotion: uci.length > 4 ? uci[4] : undefined,
});

// Build the solver's starting position. Returns null if the PGN/solution can't be
// replayed (corrupt data) — the caller skips to the next puzzle.
export function puzzleSetup(puzzle: Puzzle): PuzzleSetup | null {
  try {
    const game = new Chess();
    game.loadPgn(puzzle.pgn);
    const moves = game.history({ verbose: true });

    const board = new Chess();
    // Play the whole pgn (initialPly + 1 plies); the solver is now to move and
    // solution[0] is their first move.
    const plies = Math.min(puzzle.initialPly + 1, moves.length);
    for (let i = 0; i < plies; i++) board.move(moves[i].san);
    const fen = board.fen();
    const solverColour = board.turn() === 'w' ? 'white' : 'black';

    // Sanity-check that the solver's first move is legal here (rejects corrupt
    // data without mutating the returned position).
    if (!puzzle.solution[0] || !board.move(FROM(puzzle.solution[0]))) return null;

    return { fen, solverColour, solution: puzzle.solution };
  } catch {
    return null;
  }
}

// ── Opening → angle key ────────────────────────────────────────────────────────

// Lichess puzzle openings are family-level keys (e.g. "Sicilian_Defense"). We
// match the user's opening name to one by collapsing both to letters+digits only
// (folding accents, apostrophes, hyphens, spaces and underscores away) and taking
// the LONGEST key whose collapsed form is a prefix of the collapsed name — so
// "Queen's Gambit Declined: …" prefers Queens_Gambit_Declined over Queens_Gambit.
function collapse(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining accent marks
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const ANGLE_INDEX: { slug: string; norm: string }[] = (OPENING_ANGLES as string[])
  .map((slug) => ({ slug, norm: collapse(slug) }))
  .sort((a, b) => b.norm.length - a.norm.length);

// The Lichess puzzle angle for an opening name, or null when no puzzle set covers
// it. Tries the full name first, then the opening family.
export function toAngleKey(openingName: string | null): string | null {
  if (!openingName) return null;
  for (const candidate of [openingName, openingFamily(openingName)]) {
    const norm = collapse(candidate);
    if (!norm) continue;
    for (const { slug, norm: key } of ANGLE_INDEX) {
      if (norm.startsWith(key)) return slug;
    }
  }
  return null;
}

// Does any Lichess puzzle set cover this opening? (For showing/hiding entries.)
export function hasPuzzles(openingName: string | null): boolean {
  return toAngleKey(openingName) !== null;
}

// Turn a set of opening names into the distinct angle keys that have puzzles,
// keeping first-seen order so the caller's sort is preserved.
export function openingAngles(names: (string | null)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const key = toAngleKey(name);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

// ── Puzzle dashboard (your Lichess puzzle results — needs the token) ────────────

export interface ThemeResult {
  theme: string;
  nb: number;          // puzzles attempted in this theme
  performance: number; // rating-like performance number
}

export interface PuzzleDashboard {
  days: number;
  nb: number;          // total puzzles solved in the window
  performance: number; // overall performance
  themes: ThemeResult[];
}

interface DashboardResponse {
  days?: number;
  global?: { nb?: number; performance?: number };
  themes?: Record<string, { theme?: string; results?: { nb?: number; performance?: number } }>;
}

export async function fetchPuzzleDashboard(
  days: number,
  token: string | null,
): Promise<PuzzleDashboard | null> {
  if (!token) return null;
  try {
    const res = await fetch(`${LICHESS}/api/puzzle/dashboard/${days}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as DashboardResponse;
    const themes: ThemeResult[] = Object.entries(data.themes ?? {}).map(([key, t]) => ({
      theme: t.theme ?? key,
      nb: t.results?.nb ?? 0,
      performance: t.results?.performance ?? 0,
    }));
    return {
      days: data.days ?? days,
      nb: data.global?.nb ?? 0,
      performance: data.global?.performance ?? 0,
      themes,
    };
  } catch {
    return null;
  }
}
