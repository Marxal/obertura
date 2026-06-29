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

// The eight classes, strongest to worst (book sits outside the quality axis).
// "Brilliant" and "forced" were removed deliberately: the brilliant detector
// fired too randomly to trust, and "forced" added noise without teaching much.
export type MoveClass =
  | 'great'       // the one strong move in a sharp spot (!)
  | 'best'        // the engine's #1 move
  | 'excellent'   // not #1, but essentially as good
  | 'good'        // a small, harmless inaccuracy in eval
  | 'book'        // known opening theory (from the bundled book)
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
// or wins a sharp position. (No "forced" band any more; a wide gap just reads
// as a great find when the player makes it.)
const GREAT_GAP = 0.10;

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
  inBook: boolean;          // present in the bundled opening book at this position
  winLoss: number;          // 0..1 expected-points drop vs the best move
  secondBestGap: number;    // win% the best move leads the 2nd best by (≥ 0)
}

// The grade. First match wins, so order encodes priority.
export function classifyMove(i: ClassifyInput): MoveClass {
  // Great: the standout move in a sharp position — best, and clearly ahead of
  // every alternative. Only when the player actually found it (isBest).
  if (i.isBest && i.secondBestGap >= GREAT_GAP) return 'great';

  // Book theory — but never let "book" hide a genuine error.
  if (i.inBook && i.winLoss < BOOK_MAX_LOSS) return 'book';

  if (i.isBest) return 'best';

  if (i.winLoss < EXCELLENT_MAX) return 'excellent';
  if (i.winLoss < GOOD_MAX) return 'good';
  if (i.winLoss < INACCURACY_MAX) return 'inaccuracy';
  if (i.winLoss < MISTAKE_MAX) return 'mistake';
  return 'blunder';
}
