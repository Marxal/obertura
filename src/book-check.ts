// "Is this move opening theory?" for the game reviewer. A move counts as book
// when the game's whole move sequence stays inside the bundled openings library
// (the same 12k-line dataset behind the Library browser), or when the position
// it reaches is itself a named opening (which also catches transpositions that
// re-enter theory by another move order).
//
// The library JSON (~490 KB) is lazy-loaded and the trie built once per session,
// on the first graded move.

import { nameForFen } from './openings';
import { buildBook, loadBookEntries, type BookNode } from './book-tree';

let bookPromise: Promise<BookNode> | null = null;
function getBook(): Promise<BookNode> {
  if (!bookPromise) bookPromise = loadBookEntries().then(buildBook);
  return bookPromise;
}

// Walk the trie tolerating check/mate suffix differences between chess.js SANs
// and the dataset's ("Bb5+" vs "Bb5") — rare, but a mismatch there would
// silently truncate the book at that move.
function inTrie(book: BookNode, sans: string[]): boolean {
  let node: BookNode = book;
  for (const san of sans) {
    const clean = san.replace(/[+#]$/, '');
    const next =
      node.children.get(san) ??
      node.children.get(clean) ??
      node.children.get(clean + '+');
    if (!next) return false;
    node = next;
  }
  return true;
}

/**
 * True when the move ending at `childFen`, reached via `sanPath` (every SAN
 * from the game start, INCLUDING this move), follows the opening library.
 * Path-based, so book ends at the first deviation — but a named position
 * (nameForFen) can bring a transposed line back into book.
 */
export async function isBookMove(sanPath: string[], childFen: string): Promise<boolean> {
  if (nameForFen(childFen)) return true;
  if (!sanPath.length) return false;
  const book = await getBook();
  return inTrie(book, sanPath);
}
