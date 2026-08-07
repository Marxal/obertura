// "Is this other move just as good?" — the judge behind the puzzle overlay's
// alternate-move acceptance.
//
// Lichess puzzles ship a single `solution[]`, and puzzle-run.ts used to accept
// nothing else. But some positions have a second move that is genuinely just as
// good (an equally fast mate, or another move that simply doesn't blunder), and
// marking those wrong is unfair. So on the FIRST non-solution move of a puzzle
// we ask the local Stockfish — shallow and time-capped, because the solver is
// sitting there waiting — whether the move they played is equivalent.
//
// The shape follows drill.ts's checkAlternative (ask the engine before
// penalising), with mistake-run.ts's verdict tone (a good move is acknowledged,
// not just waved through). The comparison itself is a pure function so it can be
// self-tested without a WASM worker; only checkPuzzleAlternate() touches the
// engine.
//
// Conservative by design: anything we cannot verify — engine missing, search too
// shallow to rank both moves, a timeout, a promotion we can't read the piece for
// — falls back to "wrong", i.e. exactly the old behaviour.

import { Chess } from 'chess.js';
import { analysePosition, resolveUci, type MoveEval } from './engine';

// The search budget. Depth matches the analyser and the mistake scan's verify
// pass; the movetime cap is what keeps a slow phone honest (the engine stops at
// whichever comes first). MultiPV 3 mirrors isGoodAlternative — a move that is
// truly equal is essentially always in the top three at this depth.
export const ALT_DEPTH = 12;
export const ALT_MOVETIME_MS = 700;
export const ALT_MULTI_PV = 3;
// A hard wall-clock cap on the whole check. The review worker is shared and
// serialised (a background mistake scan can be queued ahead of us), so the
// promise alone is no guarantee of a timely answer.
export const ALT_WALL_MS = 1500;
// How much worse than the puzzle's own move an alternative may be, in
// centipawns, and still count as equivalent. Same default as the cloud-backed
// isGoodAlternative(). Tighten this if alternates start feeling too generous.
export const ALT_TOLERANCE_CP = 30;

// Does this move give checkmate right now? A mate needs no engine — it's the
// fastest possible finish, so it can never be worse than the puzzle's move.
export function deliversMate(fen: string, uci: string): boolean {
  try {
    const ch = new Chess(fen);
    const m = ch.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: (uci[4] as 'q' | 'r' | 'b' | 'n') || 'q',
    });
    return m ? ch.isCheckmate() : false;
  } catch {
    return false;
  }
}

// Is from→to a pawn promotion? Chessground's move event carries no promotion
// piece and the puzzle overlay never asks for one (it replays the solution's
// UCI instead), so we can't build a real UCI for these — skip the check and let
// them fall through to the normal wrong-move path.
export function isPromotionMove(fen: string, from: string, to: string): boolean {
  try {
    return new Chess(fen)
      .moves({ verbose: true })
      .some((m) => m.from === from && m.to === to && !!m.promotion);
  } catch {
    return false;
  }
}

// Puzzles whose whole point is a forced mate ("mateIn2", "backRankMate", …).
// In those, only another mate counts — a move that merely keeps a winning
// position has missed the exercise.
export function isMateThemed(themes: string[]): boolean {
  return themes.some((t) => /mate/i.test(t) && !/stalemate/i.test(t));
}

// A MoveEval's score from the SOLVER's point of view (engine scores are
// white-normalised): positive cp = solver better, positive mate = solver mates
// in that many moves.
function pov(m: MoveEval, solver: 'white' | 'black'): { cp?: number; mate?: number } {
  const s = solver === 'white' ? 1 : -1;
  return {
    cp: m.cp === undefined ? undefined : m.cp * s,
    mate: m.mate === undefined ? undefined : m.mate * s,
  };
}

export interface AlternateInput {
  // Top lines from ONE search of `fen`, white-normalised (what analysePosition
  // and the cloud helpers both return).
  lines: MoveEval[];
  // The position the solver faced, i.e. before either move.
  fen: string;
  // The move actually played, as chessground reports it (from + to).
  userUci: string;
  // The puzzle's own move at this ply (solution[solIndex]).
  officialUci: string;
  solver: 'white' | 'black';
  // Mate-themed puzzle: nothing but a mate is accepted.
  requireMate?: boolean;
  toleranceCp?: number;
}

// The whole decision, from one search. Pure — see puzzle-alt.selftest.ts.
//
// Note what it does NOT do: compare the played move against the engine's own
// #1. At this depth the engine's favourite can differ from a deeply-computed
// puzzle solution, so the played move is measured against the OFFICIAL move's
// score in the same result list. If the official move isn't there, the search
// was too shallow to rank it and we decline to judge.
export function judgeAlternate(input: AlternateInput): boolean {
  const tol = input.toleranceCp ?? ALT_TOLERANCE_CP;
  // The solution's UCI may carry a promotion piece (and Lichess writes castling
  // king-onto-rook); normalise it so it matches the engine's move list.
  const official = (resolveUci(input.fen, input.officialUci)?.uci ?? input.officialUci).slice(0, 4);
  const userUci = input.userUci.slice(0, 4);
  if (userUci === official) return false; // the puzzle's own move — not an alternative

  const at = (uci4: string): MoveEval | undefined =>
    input.lines.find((l) => l.uci.slice(0, 4) === uci4);
  const userLine = at(userUci);
  const officialLine = at(official);
  // Either move missing from the top lines → not verified, so not accepted.
  if (!userLine || !officialLine) return false;

  const u = pov(userLine, input.solver);
  const o = pov(officialLine, input.solver);

  // The played move gets mated (or is mate-for-the-opponent) — never an
  // alternative, whatever the puzzle wanted.
  if (u.mate !== undefined && u.mate <= 0) return false;
  // The puzzle's move forces mate: only an equally fast (or faster) mate matches
  // it. Mate in 3 where the puzzle wanted mate in 2 is a different, worse move.
  if (o.mate !== undefined && o.mate > 0) {
    return u.mate !== undefined && u.mate <= o.mate;
  }
  // The played move mates and the puzzle's move doesn't — strictly better.
  if (u.mate !== undefined) return true;
  if (input.requireMate) return false;
  if (u.cp === undefined || o.cp === undefined) return false;
  return o.cp - u.cp <= tol;
}

// Resolve `p`, or null once `ms` have passed (whichever happens first). Never
// rejects.
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

// The live check: true when `userUci` is as good as the puzzle's move here.
// False on anything unverifiable, so a caller can treat false as "wrong" exactly
// as before.
export async function checkPuzzleAlternate(opts: {
  fen: string;
  userUci: string;
  officialUci: string;
  themes?: string[];
}): Promise<boolean> {
  try {
    // Mate on the board needs no search — instant, and exact.
    if (deliversMate(opts.fen, opts.userUci)) return true;

    const lines = await withDeadline(
      analysePosition(opts.fen, ALT_DEPTH, undefined, {
        multiPv: ALT_MULTI_PV,
        movetimeMs: ALT_MOVETIME_MS,
      }),
      ALT_WALL_MS,
    );
    // Fewer than two lines can't rank two moves against each other.
    if (!lines || lines.length < 2) return false;

    return judgeAlternate({
      lines,
      fen: opts.fen,
      userUci: opts.userUci,
      officialUci: opts.officialUci,
      solver: opts.fen.split(' ')[1] === 'b' ? 'black' : 'white',
      requireMate: isMateThemed(opts.themes ?? []),
    });
  } catch {
    return false;
  }
}
