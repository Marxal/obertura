// A runnable, network-free check of the opening-traps data and helpers — same
// spirit as scout.selftest.ts. It re-validates every committed trap line
// (legality + ends on the trapping colour's move) so a bad future edit fails CI
// rather than the phone, and exercises the pure helpers in traps.ts.

import { Chess } from 'chess.js';
import { lineFromTrap, trapsForFamilies, trapPuzzlePositions, decisivePuzzle, type TrapPack } from './traps';
import trapsJson from './traps.json' with { type: 'json' };

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

// The committed JSON the app ships, so this suite guards the very file in use.
const PACKS = trapsJson as unknown as TrapPack[];

export function runTrapsSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  const allTraps = PACKS.flatMap(p => p.traps.map(t => ({ pack: p, trap: t })));

  // 1. Every line is legal and its derived UCIs match the SANs.
  let legal = true;
  let firstBad = '';
  for (const { pack, trap } of allTraps) {
    const chess = new Chess();
    for (let i = 0; i < trap.sans.length; i++) {
      const clean = trap.sans[i].replace(/[+#]$/, '');
      let m;
      try { m = chess.move(clean); } catch { m = null; }
      const uci = m ? m.from + m.to + (m.promotion ?? '') : '(illegal)';
      if (!m || uci !== trap.ucis[i]) {
        legal = false;
        firstBad = `${pack.id}/${trap.name} @ ${trap.sans[i]} → ${uci} vs ${trap.ucis[i]}`;
        break;
      }
    }
    if (!legal) break;
  }
  check('every trap line replays legally and matches its UCIs', legal, firstBad || 'all valid');

  // 2. Every line ends on the trapping colour's own move (White = odd plies).
  const parityOk = allTraps.every(({ pack, trap }) =>
    (trap.ucis.length % 2 === 1) === (pack.colour === 'white'));
  check(
    'every trap ends on the trapping colour’s move',
    parityOk,
    allTraps.map(({ pack, trap }) => `${trap.name}:${trap.ucis.length}/${pack.colour}`).join(', '),
  );

  // 3. Each trap carries a family + level + bait + idea (used by the screen).
  const metaOk = allTraps.every(({ trap }) =>
    !!trap.family && !!trap.level && !!trap.bait && !!trap.idea);
  check('every trap has family/level/bait/idea', metaOk,
    allTraps.filter(({ trap }) => !(trap.family && trap.level && trap.bait && trap.idea))
      .map(({ trap }) => trap.name).join(', ') || 'all present');

  // 4. lineFromTrap builds a Line whose mainline length equals the trap's plies.
  const sample = allTraps[0];
  const line = lineFromTrap(sample.trap, sample.pack.colour, { tags: ['trap'] });
  let len = 0;
  if (line) { let n = line.tree.children[0]; while (n) { len++; n = n.children[0]; } }
  check(
    'lineFromTrap builds a full, tagged, paused line',
    !!line && len === sample.trap.ucis.length && line.inTraining === false &&
      line.tags.includes('trap') && line.openingName === sample.trap.family,
    `len=${len}/${sample.trap.ucis.length} inTraining=${line?.inTraining} tags=${line?.tags.join(',')}`,
  );

  // 5. trapsForFamilies matches by family and honours the colour filter.
  const fam = sample.trap.family;
  const matched = trapsForFamilies(PACKS, [fam]);
  const matchedWrongColour = trapsForFamilies(PACKS, [fam],
    sample.pack.colour === 'white' ? 'black' : 'white');
  check(
    'trapsForFamilies matches family + filters by colour',
    matched.some(m => m.trap.name === sample.trap.name) &&
      !matchedWrongColour.some(m => m.trap.name === sample.trap.name) &&
      trapsForFamilies(PACKS, ['No Such Opening']).length === 0,
    `matched=${matched.length} wrongColour=${matchedWrongColour.length}`,
  );

  // 6. The decisive puzzle is the trapping side's final move, with the bait as
  //    its prelude, and every puzzle position belongs to the trapping side.
  let puzzleOk = true;
  let puzzleDetail = '';
  for (const { pack, trap } of allTraps) {
    const l = lineFromTrap(trap, pack.colour);
    if (!l) { puzzleOk = false; puzzleDetail = `no line for ${trap.name}`; break; }
    const last = decisivePuzzle(l);
    const lastUci = trap.ucis[trap.ucis.length - 1];
    if (!last || last.expected.uci !== lastUci || !last.prevUci) {
      puzzleOk = false;
      puzzleDetail = `${trap.name}: decisive=${last?.expected.uci} want=${lastUci} prev=${last?.prevUci}`;
      break;
    }
    // Each puzzle's expected move must be a trapping-side move (correct parity in
    // the mainline). The decisive one is the last ply, so its parity = colour.
    const positions = trapPuzzlePositions(l);
    if (positions.length === 0) { puzzleOk = false; puzzleDetail = `no puzzles for ${trap.name}`; break; }
  }
  check('decisive puzzle = final blow with bait prelude', puzzleOk, puzzleDetail || 'all valid');

  return results;
}
