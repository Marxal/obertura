// "Why this move?" — a plain-language explanation of a move, composed from data
// the app already has: the opening name, how often the move is played (and how it
// scores) from the opening explorer, and the engine's verdict from Lichess cloud
// eval. No LLM, no prose generation — just deterministic templates over real
// signals, so it never invents anything. The builder shows the result and lets
// you save it as the move's note.
//
// explainMove() is pure (templating only) and self-tested. gatherExplainSignals()
// does the network fetches and feeds it.

import { bundledStats } from './explorer-stats';
import { fetchExplorer, type ExplorerCounts } from './lichess-explorer';
import { cloudTopMoves } from './engine';
import { openingFamily, UNKNOWN_FAMILY } from './analysis';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// How this move's popularity looks in real games (explorer-derived).
export interface PopularitySignal {
  share: number;     // 0..1 — fraction of games that chose this move here
  rank: number;      // 1 = the most popular continuation
  scorePct: number;  // (wins + draws/2)/games for the side to move, 0..100
  games: number;     // games behind this move (for "enough to mean something")
}

// The engine's verdict on this move (Lichess cloud, mover's perspective).
export interface EvalSignal {
  isBest: boolean;        // the engine's #1 move
  withinTop: boolean;     // appears among the cloud's top moves at all
  onlyMove: boolean;      // best is far ahead of the rest (a forced/only move)
  cpAfter?: number;       // eval after this move, + good for the mover (centipawns)
  mateAfter?: number;     // mate distance after, signed for the mover
  deltaToBestCp?: number; // how far behind best, in centipawns (≥ 0)
}

export interface ExplainInput {
  san: string;
  colour: 'white' | 'black';     // who plays this move
  openingName: string | null;
  popularity?: PopularitySignal | null;
  evalSig?: EvalSignal | null;
}

// Build the explanation sentence(s). Always returns something usable.
export function explainMove(input: ExplainInput): string {
  const parts: string[] = [];
  const side = input.colour === 'white' ? 'White' : 'Black';

  // 1) Opening identity (kept brief; skipped when unknown).
  const family = openingFamily(input.openingName);
  if (input.openingName && family !== UNKNOWN_FAMILY) {
    parts.push(`Part of the ${family}.`);
  }

  // 2) Popularity + results from real games.
  const pop = input.popularity;
  if (pop && pop.games > 0) {
    const pct = Math.round(pop.share * 100);
    let line: string;
    if (pop.rank === 1 && pct >= 40) line = `It's the main move here (${pct}% of games)`;
    else if (pop.rank === 1) line = `It's the most common choice here (${pct}% of games)`;
    else if (pct < 5) line = `A rare sideline (${pct}% of games)`;
    else line = `Played in ${pct}% of games`;
    // Add the score only when there are enough games to trust it.
    if (pop.games >= 200) line += `, scoring ${pop.scorePct}% for ${side}`;
    parts.push(line + '.');
  }

  // 3) Engine verdict.
  const ev = input.evalSig;
  if (ev) {
    if (ev.mateAfter !== undefined && ev.mateAfter !== 0) {
      const n = Math.abs(ev.mateAfter);
      parts.push(ev.mateAfter > 0 ? `The engine sees mate in ${n}.` : `The engine says this loses — mate in ${n} against.`);
    } else if (ev.onlyMove && ev.isBest) {
      parts.push('The engine rates it essentially the only move.');
    } else if (ev.isBest) {
      parts.push(`The engine's top choice${evalFlavour(ev.cpAfter, side)}.`);
    } else if (ev.withinTop) {
      const gap = ev.deltaToBestCp != null ? ` (within ${formatCp(ev.deltaToBestCp)} of best)` : '';
      parts.push(`A sound option the engine likes${gap}.`);
    } else if (ev.deltaToBestCp != null && ev.deltaToBestCp >= 80) {
      parts.push(`The engine prefers another move here (about ${formatCp(ev.deltaToBestCp)} better).`);
    }
  }

  if (parts.length === 0) {
    return 'No opening-database or engine data for this position right now — try again once connected to Lichess.';
  }
  return parts.join(' ');
}

// A small qualitative tail for the best move, from the eval after it (mover's
// perspective). Kept modest so it never overclaims.
function evalFlavour(cpAfter: number | undefined, side: string): string {
  if (cpAfter === undefined) return '';
  if (cpAfter >= 200) return `, with a clear advantage for ${side}`;
  if (cpAfter >= 70) return `, keeping an edge for ${side}`;
  if (cpAfter <= -70) return ', though the position is tough';
  return ', holding the balance';
}

// "120" → "1.2". Centipawns to pawns, one decimal.
function formatCp(cp: number): string {
  return (Math.abs(cp) / 100).toFixed(1);
}

// ── Signal gathering (network) ─────────────────────────────────────────────────

// Score% for the side to move, from explorer counts at the parent position.
function scoreFor(counts: ExplorerCounts, colour: 'white' | 'black'): { games: number; scorePct: number } {
  const games = counts.white + counts.draws + counts.black;
  if (games === 0) return { games: 0, scorePct: 0 };
  const wins = colour === 'white' ? counts.white : counts.black;
  return { games, scorePct: Math.round(((wins + counts.draws / 2) / games) * 100) };
}

function popularityFrom(
  map: Map<string, ExplorerCounts>,
  moveUci: string,
  colour: 'white' | 'black',
): PopularitySignal | null {
  const entries = [...map.entries()].map(([uci, c]) => ({ uci, total: c.white + c.draws + c.black, c }));
  const grandTotal = entries.reduce((s, e) => s + e.total, 0);
  if (grandTotal === 0) return null;
  entries.sort((a, b) => b.total - a.total);
  const idx = entries.findIndex(e => e.uci === moveUci);
  if (idx < 0) return null;
  const me = entries[idx];
  const { games, scorePct } = scoreFor(me.c, colour);
  return { share: me.total / grandTotal, rank: idx + 1, scorePct, games };
}

function evalFrom(
  top: { uci: string; cp?: number; mate?: number }[],
  moveUci: string,
): EvalSignal | null {
  if (top.length === 0) return null;
  // cp/mate are in the mover's perspective (Lichess side-to-move).
  const cpOf = (m: { cp?: number; mate?: number }): number =>
    m.mate !== undefined ? (m.mate > 0 ? 100000 - m.mate : -100000 - m.mate) : (m.cp ?? 0);
  const best = top[0];
  const mine = top.find(m => m.uci === moveUci);
  const bestCp = cpOf(best);
  const secondCp = top[1] ? cpOf(top[1]) : undefined;
  return {
    isBest: best.uci === moveUci,
    withinTop: !!mine,
    onlyMove: secondCp !== undefined && bestCp - secondCp >= 150,
    cpAfter: mine?.cp,
    mateAfter: mine?.mate,
    deltaToBestCp: mine ? Math.max(0, bestCp - cpOf(mine)) : undefined,
  };
}

export interface GatherOptions {
  // Lichess bearer token, when connected — lets the live explorer through and
  // raises the cloud-eval rate limit. Optional; everything degrades without it.
  token?: string | null;
}

// Collect the explorer + engine signals for a move played from `parentFen`, then
// hand them to explainMove. parentFen is the position BEFORE the move.
export async function gatherExplainSignals(
  parentFen: string | null,
  moveUci: string,
  san: string,
  colour: 'white' | 'black',
  openingName: string | null,
  opts: GatherOptions = {},
): Promise<ExplainInput> {
  const fen = parentFen && parentFen.trim() ? parentFen : START_FEN;

  // Popularity: prefer the bundled book (instant, offline); fall back to the live
  // explorer when the position isn't in the book and we're connected.
  let popularity: PopularitySignal | null = null;
  try {
    let map = await bundledStats(fen, 'lichess');
    if (!map && opts.token) map = await fetchExplorer(fen, 'lichess', opts.token);
    if (map) popularity = popularityFrom(map, moveUci, colour);
  } catch { /* leave popularity null */ }

  // Engine verdict from Lichess cloud (token raises the rate limit when present).
  let evalSig: EvalSignal | null = null;
  try {
    const top = await cloudTopMoves(fen);
    if (top) evalSig = evalFrom(top, moveUci);
  } catch { /* leave evalSig null */ }

  return { san, colour, openingName, popularity, evalSig };
}
