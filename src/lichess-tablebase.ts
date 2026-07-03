// A thin client for the free Lichess 7-piece tablebase (no API key, online, CORS
// enabled). It gives GROUND TRUTH for the End game trainer: for any position with
// ≤7 pieces it returns the exact result (win/draw/loss) plus every legal move
// ranked best-first, so we can both play a perfect defence and judge whether the
// user just threw the result away.
//
//   GET https://tablebase.lichess.org/standard?fen=<fen>
//
// Everything fails soft (returns null): offline, a >7-piece position, a timeout or
// a parse error all just hand back null, and the caller falls back to the local
// Stockfish engine. Modelled on lichess-explorer.ts: an in-memory Map cache for
// the session and a short per-request timeout. NOTE: this host is blocked by the
// build/preview container's egress, so it only reaches the network from the phone
// — exactly like the explorer and cloud eval.

const ENDPOINT = 'https://tablebase.lichess.org/standard';
const TIMEOUT_MS = 3000;

// The tablebase covers standard positions with at most 7 pieces (kings included);
// asking about a bigger position is pointless, so we skip the request entirely.
export const TABLEBASE_MAX_PIECES = 7;

// Lichess's WDL categories, always from the SIDE-TO-MOVE's perspective. The
// "cursed"/"blessed"/"maybe" variants are 50-move-rule and 7-piece-rounding edge
// cases; for training we fold them into plain win/draw/loss (see outcomeOf).
export type TbCategory =
  | 'win' | 'cursed-win' | 'maybe-win'
  | 'draw' | 'unknown'
  | 'blessed-loss' | 'maybe-loss' | 'loss';

export type TbOutcome = 'win' | 'draw' | 'loss' | 'unknown';

// One legal move. Its `category` is from the perspective of the player to move
// AFTER the move (i.e. the opponent), so a `loss` here means the move wins for the
// side that just moved. The API returns moves already sorted best-first for the
// side to move.
export interface TbMove {
  uci: string;
  san: string;
  category: TbCategory;
  dtz: number | null;
  dtm: number | null;
  zeroing: boolean;
  checkmate: boolean;
  stalemate: boolean;
}

export interface TbResult {
  category: TbCategory;          // WDL for the side to move in the queried FEN
  dtz: number | null;
  dtm: number | null;
  checkmate: boolean;
  stalemate: boolean;
  insufficientMaterial: boolean;
  moves: TbMove[];               // sorted best-first for the side to move
}

interface RawMove {
  uci?: string; san?: string; category?: string;
  dtz?: number | null; dtm?: number | null;
  zeroing?: boolean; checkmate?: boolean; stalemate?: boolean;
}
interface RawResult {
  category?: string;
  dtz?: number | null; dtm?: number | null;
  checkmate?: boolean; stalemate?: boolean; insufficient_material?: boolean;
  moves?: RawMove[];
}

// Count the pieces in a FEN's board field — letters only, digits are empty runs.
export function pieceCount(fen: string): number {
  const board = fen.split(' ')[0] ?? '';
  let n = 0;
  for (const ch of board) if (/[a-zA-Z]/.test(ch)) n++;
  return n;
}

// Whether the tablebase can answer for this position at all (piece budget).
export function inTablebaseRange(fen: string): boolean {
  return pieceCount(fen) <= TABLEBASE_MAX_PIECES;
}

// Fold the edge-case categories into a plain win / draw / loss. Cursed wins and
// blessed losses (50-move-rule quirks) and the "maybe" 7-piece roundings are close
// enough to their base outcome for endgame technique.
export function outcomeOf(cat: TbCategory): TbOutcome {
  switch (cat) {
    case 'win': case 'cursed-win': case 'maybe-win': return 'win';
    case 'loss': case 'blessed-loss': case 'maybe-loss': return 'loss';
    case 'draw': return 'draw';
    default: return 'unknown';
  }
}

const KNOWN: ReadonlySet<string> = new Set([
  'win', 'cursed-win', 'maybe-win', 'draw', 'unknown', 'blessed-loss', 'maybe-loss', 'loss',
]);
function asCategory(v: string | undefined): TbCategory {
  return v && KNOWN.has(v) ? (v as TbCategory) : 'unknown';
}

// Session cache — the same position (e.g. a common K+P ending) recurs across a
// drill, and the answer never changes. Only successful, non-null lookups are kept.
const cache = new Map<string, TbResult>();

export function clearTablebaseCache(): void {
  cache.clear();
}

// Look a position up. Returns null (never throws) on anything that isn't a clean
// answer, so the caller can fall back to the local engine.
export async function probeTablebase(fen: string): Promise<TbResult | null> {
  const cached = cache.get(fen);
  if (cached) return cached;
  if (!inTablebaseRange(fen)) return null;

  try {
    const url = `${ENDPOINT}?fen=${encodeURIComponent(fen)}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as RawResult;
    if (typeof data.category !== 'string') return null;

    const moves: TbMove[] = (data.moves ?? []).map((m) => ({
      uci: m.uci ?? '',
      san: m.san ?? '',
      category: asCategory(m.category),
      dtz: m.dtz ?? null,
      dtm: m.dtm ?? null,
      zeroing: m.zeroing === true,
      checkmate: m.checkmate === true,
      stalemate: m.stalemate === true,
    })).filter((m) => m.uci.length >= 4);

    const result: TbResult = {
      category: asCategory(data.category),
      dtz: data.dtz ?? null,
      dtm: data.dtm ?? null,
      checkmate: data.checkmate === true,
      stalemate: data.stalemate === true,
      insufficientMaterial: data.insufficient_material === true,
      moves,
    };
    cache.set(fen, result);
    return result;
  } catch {
    return null; // offline / timeout / CORS / parse error — caller falls back
  }
}

// The optimal move for the side to move (the first the API returns), or null when
// there's no move / no answer. Used to give the engine a perfect defence so the
// user's technique is actually tested.
export function bestMove(result: TbResult): TbMove | null {
  return result.moves[0] ?? null;
}
