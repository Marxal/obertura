// A runnable, network-free check of the opening-traps data and helpers — same
// spirit as scout.selftest.ts. It re-validates every committed trap line
// (legality + ends on the trapping colour's move) so a bad future edit fails CI
// rather than the phone, and exercises trapsForPairs.

import { Chess } from 'chess.js';
import { trapsForPairs, type TrapPack } from './traps';
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

  // 3. Each trap carries a family + level + bait + idea (used by the card).
  const metaOk = allTraps.every(({ trap }) =>
    !!trap.family && !!trap.level && !!trap.bait && !!trap.idea);
  check('every trap has family/level/bait/idea', metaOk,
    allTraps.filter(({ trap }) => !(trap.family && trap.level && trap.bait && trap.idea))
      .map(({ trap }) => trap.name).join(', ') || 'all present');

  // 4. trapsForPairs matches by (family, colour) and ignores the wrong colour.
  const sample = allTraps[0];
  const fam = sample.trap.family;
  const matched = trapsForPairs(PACKS, [{ family: fam, colour: sample.pack.colour }]);
  const wrongColour = trapsForPairs(PACKS, [{
    family: fam, colour: sample.pack.colour === 'white' ? 'black' : 'white',
  }]);
  check(
    'trapsForPairs matches (family, colour) and filters by colour',
    matched.some(m => m.trap.name === sample.trap.name) &&
      !wrongColour.some(m => m.trap.name === sample.trap.name) &&
      trapsForPairs(PACKS, [{ family: 'No Such Opening', colour: 'white' }]).length === 0,
    `matched=${matched.length} wrongColour=${wrongColour.length}`,
  );

  return results;
}
