// Move classification — the pure, deterministic core (no network, no DOM, no
// chess.js), self-tested like explain.ts. It turns an engine eval into a
// Chess.com-style move grade.
//
// The model is "expected points" (win%), not raw centipawns: a 100cp swing near
// equality costs far more than the same swing in an already-won game, so we
// measure how much a move drops the mover's *win probability*, not its cp eval.
// That matches how Chess.com / Lichess grade, and avoids the classic bug of
// calling every move in a winning position a "blunder".
//
// All evals here are in the MOVER's perspective at the position BEFORE the move
// (positive = good for the side that is about to move). The reviewer (review.ts)
// is responsible for getting evals into that perspective before calling in.

// The classes, strongest to worst (book sits outside the quality axis).
// "Brilliant" is back, but on a much stricter basis than the old detector that
// fired randomly: it now requires a genuine material sacrifice (a chess.js
// exchange check in move-facts.ts) on top of being the engine's #1 — so it
// errs toward missing a quiet brilliancy rather than inventing one.
export type MoveClass =
  | 'brilliant'   // a sound material sacrifice, and the engine's #1 (!!)
  | 'great'       // the one strong move in a sharp spot (!)
  | 'best'        // the engine's #1 move
  | 'excellent'   // not #1, but essentially as good
  | 'good'        // a small, harmless inaccuracy in eval
  | 'book'        // known opening theory (from the bundled openings library)
  | 'inaccuracy'  // a noticeable slip (?!)
  | 'mistake'     // a real error (?)
  | 'blunder';    // a serious error (??)

// ── Tunable thresholds (one place to adjust the whole feel) ──────────────────
// Win-probability is 0..1; these bands are "expected-points" drops, chosen to
// sit close to Chess.com's feel (≈2% / 5% / 10% / 20%).
const EXCELLENT_MAX = 0.02;   // < 2% drop and not the top move → excellent
const GOOD_MAX = 0.05;        // < 5% → good
const INACCURACY_MAX = 0.10;  // < 10% → inaccuracy
const MISTAKE_MAX = 0.20;     // < 20% → mistake, ≥ 20% → blunder

// "Book" only when the move is genuinely close to best — a book move that is
// actually a blunder in this exact position still gets graded as a blunder.
const BOOK_MAX_LOSS = 0.10;

// "Great": the best move is clearly ahead of the rest — the one move that holds
// or wins a sharp position. Kept honest by the exclusions in classifyMove:
// forced moves, routine recaptures and simply taking hung material all have a
// big gap without being a find.
const GREAT_GAP = 0.12;

// "Brilliant": a real sacrifice that works. The mover must still be OK after
// the move (not sacrificing while lost) and must not have been completely
// winning already (a sac when totally winning isn't daring, it's showing off).
//
// Exported because the mistake scan uses the same two numbers to decide which
// sacrifices are worth asking the engine about (brilliant.ts's candidate pass).
// A cheaper bar there would waste engine time on hung pieces; a stricter one
// would hide brilliancies from the exercise that this very function would go on
// to grade as brilliant.
export const BRILLIANT_MIN_WIN_AFTER = 0.45;
export const BRILLIANT_MAX_WIN_BEFORE = 0.90;

// Logistic centipawn → win% for the side to move. The constant is Lichess's
// accuracy-model fit; cp is clamped implicitly by the mate sentinels below, so
// the exponent never overflows in practice.
export function cpToWin(cp: number): number {
  return 1 / (1 + Math.exp(-0.00368208 * cp));
}

// Collapse an eval {cp?, mate?} to a single centipawn number in the same
// perspective, mapping mate scores to large signed sentinels so all the
// arithmetic (and the negation used to flip perspective) stays finite and
// correctly signed. Returns null when neither field is present.
// Mirrors evalFrom()'s cpOf in explain.ts.
export function flattenCp(e: { cp?: number; mate?: number }): number | null {
  if (e.mate !== undefined) return e.mate > 0 ? 100000 - e.mate : -100000 - e.mate;
  if (e.cp !== undefined) return e.cp;
  return null;
}

export interface ClassifyInput {
  isBest: boolean;          // the played move is the engine's #1
  inBook: boolean;          // the move follows the bundled openings library
  winLoss: number;          // 0..1 expected-points drop vs the best move
  secondBestGap: number;    // win% the best move leads the 2nd best by (≥ 0)
  // Board facts from move-facts.ts (optional — absent means "unknown", which
  // disables the grades that depend on them rather than mis-firing).
  onlyMove?: boolean;         // the mover had exactly one legal move
  trivialRecapture?: boolean; // a capture on the square the opponent just moved to
  freeCapture?: boolean;      // just taking hung material (exchange clearly wins)
  sacrifice?: boolean;        // the move genuinely gives up material
  playedWin?: number;         // mover win% after the played move (0..1)
  bestWin?: number;           // mover win% of the best move (0..1)
}

// The grade. First match wins, so order encodes priority.
export function classifyMove(i: ClassifyInput): MoveClass {
  // Book theory first — an opening-library move is theory, not a "find", even
  // when it's also the engine's standout (or a known trap sacrifice). But never
  // let "book" hide a genuine error in this exact position.
  if (i.inBook && i.winLoss < BOOK_MAX_LOSS) return 'book';

  // Brilliant: the engine's #1 AND a real material sacrifice that keeps the
  // mover OK — checked before "great" because a sound sac usually also carries
  // a wide gap. Forced sacs don't count: there was nothing to find.
  if (
    i.isBest && i.sacrifice && !i.onlyMove &&
    (i.playedWin ?? 0) >= BRILLIANT_MIN_WIN_AFTER &&
    (i.bestWin ?? 1) <= BRILLIANT_MAX_WIN_BEFORE
  ) return 'brilliant';

  // Great: the standout move in a sharp position — best, and clearly ahead of
  // every alternative. Excludes the moves that carry a wide gap without being
  // a find: the only legal move, a routine recapture, or simply taking a piece
  // the opponent hung.
  if (
    i.isBest && i.secondBestGap >= GREAT_GAP &&
    !i.onlyMove && !i.trivialRecapture && !i.freeCapture
  ) return 'great';

  if (i.isBest) return 'best';

  if (i.winLoss < EXCELLENT_MAX) return 'excellent';
  if (i.winLoss < GOOD_MAX) return 'good';
  if (i.winLoss < INACCURACY_MAX) return 'inaccuracy';
  if (i.winLoss < MISTAKE_MAX) return 'mistake';
  return 'blunder';
}
