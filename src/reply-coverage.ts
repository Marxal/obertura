// "Covered": how much of what you'd face in the first moves your lines have an answer to.
//
// THE NUMBER. Play a typical game against your book, with the opponent choosing moves
// as often as the database says they do. Of their first six moves, how many, on
// average, do you have an answer to before you are on your own?
//
//   - Their move has an answer: it counts, and the count carries on from there.
//   - Their move has no answer: nothing more counts down that road, and so does a line
//     simply ending. That's what lets a save move the number: both filling a hole and
//     going deeper raise it, and nothing you add can lower it.
//   - Two answers at one position: the better-covered one, since you get to choose.
//   - Transpositions count, because positions are matched and not paths.
//
// WHERE THE DATABASE HAS A HOLE, we know what you've prepared but not how often it
// comes up. The bundled set has nothing after 1.e4 c6, for example. There, your best
// reply earns half its credit, the next a quarter, and so on: giving none would make a
// Caro-Kann player's work invisible, and giving all of it would call a single reply
// complete coverage. Sharing it out evenly would mean a new reply could LOWER the number.
// So the figure is an estimate, and the data rebuild will sharpen it.
//
// Worked out from the book and the bundled statistics. Pure, cheap, nothing stored.

import type { MoveNode } from './tree';
import { keyAfterMove } from './fast-replay';
import { positionKey } from './position-index';
import { MIN_STATS_GAMES, normaliseCastling, type StatsAt } from './rare-branch';

/** How many of the opponent's moves count. Past this you're preparing a middlegame. */
export const COVERAGE_MOVES = 6;
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

interface Book {
  /** Position on your move → the positions your answers lead to. */
  answers: Map<string, string[]>;
  /** Position on their move → the replies you've prepared for. */
  prepared: Map<string, Set<string>>;
}

function readBook(trees: MoveNode[], colour: 'white' | 'black'): Book {
  const book: Book = { answers: new Map(), prepared: new Map() };
  const mine = colour === 'white' ? 0 : 1;
  const walk = (node: MoveNode, fen: string, ply: number): void => {
    if (node.children.length === 0) return;
    const key = positionKey(fen);
    for (const child of node.children) {
      const after = child.fen || fen;
      if (ply % 2 === mine) {
        const list = book.answers.get(key) ?? [];
        if (!list.includes(after)) list.push(after);
        book.answers.set(key, list);
      } else {
        const set = book.prepared.get(key) ?? new Set<string>();
        set.add(child.uci);
        book.prepared.set(key, set);
      }
      walk(child, after, ply + 1);
    }
  };
  for (const tree of trees) walk(tree, tree.fen || START_FEN, 0);
  return book;
}

/** A whole percent, or null when these trees hold nothing of this colour. */
export function coveragePct(
  trees: MoveNode[], colour: 'white' | 'black', statsAt: StatsAt,
): number | null {
  const book = readBook(trees, colour);
  if (book.answers.size === 0) return null;

  // Reached by many paths when lines transpose, and the same answer each time.
  const memo = new Map<string, number>();

  /** The share of their moves from `move` to the last that get answered, 0 to 1. */
  const fromTheirMove = (fen: string, move: number): number => {
    if (move > COVERAGE_MOVES) return 1;
    const memoKey = `${positionKey(fen)}|${move}`;
    const known = memo.get(memoKey);
    if (known !== undefined) return known;

    const left = COVERAGE_MOVES - move + 1;
    const afterReply = (uci: string): number => {
      const key = keyAfterMove(fen, uci);
      const answers = key ? book.answers.get(key) : undefined;
      if (!answers) return 0;
      const best = Math.max(...answers.map(a => fromTheirMove(a, move + 1)));
      return (1 + (left - 1) * best) / left;
    };

    let value = 0;
    const stats = statsAt(fen);
    let total = 0;
    if (stats) for (const c of stats.values()) total += c.white + c.draws + c.black;
    if (stats && total >= MIN_STATS_GAMES) {
      for (const [uci, c] of stats) {
        value += ((c.white + c.draws + c.black) / total) * afterReply(normaliseCastling(fen, uci));
      }
    } else {
      const replies = [...(book.prepared.get(positionKey(fen)) ?? [])]
        .map(afterReply)
        .sort((a, b) => b - a);
      replies.forEach((credit, i) => { value += credit / 2 ** (i + 1); });
    }
    memo.set(memoKey, value);
    return value;
  };

  if (colour === 'black') return Math.round(100 * fromTheirMove(START_FEN, 1));
  const first = book.answers.get(positionKey(START_FEN)) ?? [];
  return Math.round(100 * Math.max(0, ...first.map(a => fromTheirMove(a, 1))));
}
