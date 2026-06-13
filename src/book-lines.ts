// Opening "book" lines for engine sparring — the source of the engine's opening
// in the two book modes. Both produce a flat UCI sequence; the spar screen plays
// the engine's own side's moves from it while the game stays on the line, and
// hands over to Stockfish the moment we deviate (see spar.ts).
//
// "Surprise me" draws from the bundled openings library (the same dataset the
// Library browser uses). "From my games" draws from my imported games, so the
// engine replays openings I actually face.

import { Chess } from 'chess.js';
import type { ImportedGame } from './import-core';

// Minimum opening depth a book line must reach to be worth sparring from: 6 full
// moves (12 plies). Anything shorter barely leaves the start position.
export const MIN_BOOK_PLIES = 12;

interface LibEntry { eco: string; name: string; moves: string[] }

let libPromise: Promise<LibEntry[]> | null = null;

// Lazy-load the openings library (the same ~490 KB file the Library browser
// pulls), filtered to entries deep enough to spar from. Cached for the session,
// so "Surprise me" only pays the download once.
export function loadBookLines(): Promise<LibEntry[]> {
  if (!libPromise) {
    libPromise = import('./openings-library.json').then(mod => {
      const raw = (mod.default ?? mod) as LibEntry[];
      return raw.filter(e => e.moves.length >= MIN_BOOK_PLIES);
    });
  }
  return libPromise;
}

// Replay a SAN sequence into a flat UCI list. Stops early (returning what it has)
// if a move ever fails to parse — which shouldn't happen for book data.
function sansToUcis(sans: string[]): string[] {
  const chess = new Chess();
  const ucis: string[] = [];
  for (const san of sans) {
    let m;
    try { m = chess.move(san); } catch { break; }
    ucis.push(m.from + m.to + (m.promotion ?? ''));
  }
  return ucis;
}

// "Surprise me": a weighted-random book line as a UCI sequence. Sampling
// uniformly across the catalogue's entries naturally favours the big, familiar
// families (the Sicilian alone has hundreds of catalogued variations), so the
// engine tends to open with something recognisable. Colour is irrelevant — the
// engine just plays its own side's moves from the line until I deviate.
export function pickBookLine(entries: LibEntry[]): string[] {
  if (entries.length === 0) return [];
  const e = entries[Math.floor(Math.random() * entries.length)];
  return sansToUcis(e.moves);
}

// "From my games": a book line drawn from the openings I face on a given side.
// When I spar as `colour` the engine plays the other side, so we sample from MY
// games where I played `colour` — the moves the engine replays are the ones my
// real opponents chose against me. Weighting is by frequency, for free: a line I
// meet often simply appears in more games.
export function pickGameLine(games: ImportedGame[], colour: 'white' | 'black'): string[] {
  const pool = games.filter(g => g.colour === colour && g.ucis.length >= MIN_BOOK_PLIES);
  if (pool.length === 0) return [];
  const g = pool[Math.floor(Math.random() * pool.length)];
  return [...g.ucis];
}
