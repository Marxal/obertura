// Pure data + types for the Opening-traps feature (no DOM, so it's unit-tested by
// traps.selftest.ts). A "trap" is a famous opening line where the user plays the
// trapping side and the opponent walks into a tempting losing move (the "bait").
// It maps onto a normal repertoire line: the only thing the UI does with a trap
// is seed the builder with its moves, so there's no new runtime here.
//
// The curated data lives in src/traps.json (built by scripts/build-traps.mjs);
// the screen lazy-loads it. trapsForPairs finds the traps relevant to a set of
// (family, colour) pairs — the openings you actually play — for the "For your
// openings" group.

export type TrapLevel = 'Intermediate' | 'Advanced';

export interface Trap {
  name: string;
  level: TrapLevel;
  // Opening family, keyed to match openingFamily() in analysis.ts so a trap can
  // be matched against the openings you actually play.
  family: string;
  // The opponent's tempting wrong move, for the blurb.
  bait: string;
  // One-line "why it wins".
  idea: string;
  source: 'curated' | 'lichess';
  sans: string[];
  ucis: string[];
}

export interface TrapPack {
  id: string;
  title: string;
  colour: 'white' | 'black';
  blurb: string;
  traps: Trap[];
}

// Normalise a family string for matching (case/space-insensitive).
function normFamily(f: string): string {
  return f.trim().toLowerCase();
}

// One (family, colour) you want traps for — "a trap of this colour in this
// family". Surfacing traps for the openings you play uses the colour you play
// them. De-duplicated across overlapping pairs.
export interface TrapWant { family: string; colour: 'white' | 'black'; }

export function trapsForPairs(
  packs: TrapPack[],
  wants: Iterable<TrapWant>,
): { trap: Trap; colour: 'white' | 'black' }[] {
  const want = new Set<string>();
  for (const w of wants) want.add(`${normFamily(w.family)}|${w.colour}`);
  const out: { trap: Trap; colour: 'white' | 'black' }[] = [];
  const seen = new Set<string>();
  for (const pack of packs) {
    for (const trap of pack.traps) {
      if (!want.has(`${normFamily(trap.family)}|${pack.colour}`)) continue;
      if (seen.has(trap.name)) continue;
      seen.add(trap.name);
      out.push({ trap, colour: pack.colour });
    }
  }
  return out;
}
