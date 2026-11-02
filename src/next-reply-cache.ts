// The first few positions of Home's live boards, kept so they appear instantly.
//
// WHY. To know which position is best, every game and position has to be compared, so
// the ranking can't stop early. But it needn't be waited for: last visit's top cards are
// drawn straight away while it runs, and the result only decides what comes next. A
// board you're looking at is never swapped from under you (next-reply-card.ts).
//
// THIS DEVICE ONLY. Listed as private in local-keys.ts, so it never reaches the account
// or a backup. It's just a copy of what the phone can work out again, and syncing it
// would mean an account push for every card saved or skipped.
//
// WHAT'S LEFT OUT. A card's `grow` and `line` hold a whole line, and arrive with the
// fresh data a moment later. The rest of a card is a few short strings.

import type { NextReplyCard } from './next-reply';
import type { CoverageFigures } from './reply-coverage-meter';

const KEY = 'obertura.homeCards';
const VERSION = 1;
const KEEP = 3;

type Kind = 'reply' | 'extend';

interface Stored {
  v: number;
  reply?: NextReplyCard[];
  extend?: NextReplyCard[];
  coverage?: CoverageFigures;
}

function read(): Stored | null {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
    return stored?.v === VERSION ? stored : null;
  } catch {
    return null;
  }
}

function update(change: (stored: Stored) => void): void {
  try {
    const stored = read() ?? { v: VERSION };
    change(stored);
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    /* Full or unavailable: Home just takes a moment to draw next time. */
  }
}

/** Last visit's cards, or null when this box has never been worked out on this phone. */
export function cachedCards(kind: Kind): NextReplyCard[] | null {
  return read()?.[kind] ?? null;
}

export function cacheCards(kind: Kind, cards: NextReplyCard[]): void {
  update((stored) => {
    stored[kind] = cards.slice(0, KEEP).map((card) => {
      const { grow: _grow, line: _line, ...small } = card;
      return small;
    });
  });
}

export function cachedCoverage(): CoverageFigures | null {
  return read()?.coverage ?? null;
}

export function cacheCoverage(figures: CoverageFigures): void {
  update((stored) => { stored.coverage = figures; });
}
