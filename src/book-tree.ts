// The bundled opening book as a trie keyed by SAN. Shared by the Library board
// explorer (library-explorer.ts) and the builder's Library carousel slide
// (builder-panels.ts), so there's one definition of "what does the book play
// next from here".
//
// From any node, `children` are the moves the book plays next, `count` is how
// many named openings run at or below it, and `name`/`eco` are set when an
// opening ends exactly there.

import type { LibraryEntry } from './library';

export interface BookNode {
  children: Map<string, BookNode>;
  count: number;
  name?: string;
  eco?: string;
}

export function buildBook(entries: LibraryEntry[]): BookNode {
  const root: BookNode = { children: new Map(), count: entries.length };
  for (const e of entries) {
    let node = root;
    for (const san of e.moves) {
      let c = node.children.get(san);
      if (!c) {
        c = { children: new Map(), count: 0 };
        node.children.set(san, c);
      }
      c.count++;
      node = c;
    }
    node.name = e.name;
    node.eco = e.eco;
  }
  return root;
}

// Walk the book by a SAN path, returning the node reached or null once the path
// leaves the book.
export function bookNodeAt(book: BookNode, sans: string[]): BookNode | null {
  let n: BookNode | null = book;
  for (const s of sans) n = n ? n.children.get(s) ?? null : null;
  return n;
}

// Lazy-load the full openings library (the same ~490 KB dataset the Library
// browser uses), UNFILTERED — every entry, however short, so continuations show
// from the very first move. Cached for the session.
let entriesPromise: Promise<LibraryEntry[]> | null = null;
export function loadBookEntries(): Promise<LibraryEntry[]> {
  if (!entriesPromise) {
    entriesPromise = import('./openings-library.json')
      .then(mod => (mod.default ?? mod) as LibraryEntry[]);
  }
  return entriesPromise;
}
