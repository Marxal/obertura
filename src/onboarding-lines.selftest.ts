// Guards the eight curated first-run lines (src/onboarding-lines.json).
//
// These are the very first thing a new visitor sees, and they're hand-written
// SAN, so the three ways they can silently rot each get a check:
//   1. an illegal move — the line would just stop short on the card;
//   2. a cut landing on the OPPONENT's move — the saved line would end on a move
//      the user never has to play, against the app's whole convention;
//   3. a cut that resolves no opening name — the card would have a blank title.
// Every line is checked at every level, so editing the JSON can't quietly break
// one of the twelve cards.

import { Chess } from 'chess.js';
import { allOnboardingLines, cutFor, LEVELS, linesFor, STYLE_ORDER } from './onboarding-lines';
import type { TestResult } from './selftest-panel';

export function runOnboardingLinesSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  const lines = allOnboardingLines();

  // The grid is 2×2 per colour, so both colours must offer all four styles.
  for (const colour of ['white', 'black'] as const) {
    const got = linesFor(colour);
    check(
      `${colour} offers all four styles`,
      got.length === STYLE_ORDER.length,
      `${got.length} of ${STYLE_ORDER.length}: ${got.map(l => l.style).join(', ')}`,
    );
  }

  for (const line of lines) {
    const label = `${line.colour} ${line.style} (${line.name})`;

    // 1. Every move in the full line is legal from the start position.
    const chess = new Chess();
    let illegal: string | null = null;
    for (const san of line.moves) {
      try {
        chess.move(san);
      } catch {
        illegal = san;
        break;
      }
    }
    check(
      `${label} is legal`,
      illegal === null,
      illegal ? `illegal move: ${illegal}` : `${line.moves.length} plies`,
    );
    if (illegal) continue;

    for (const level of LEVELS) {
      const cut = cutFor(line, level.value);

      // 2. The cut ends on the user's own move: White's are odd plies, Black's
      //    are even ones. A cut of zero plies would also be wrong here.
      const plies = cut.sans.length;
      const endsOnOwnMove = plies > 0
        && (line.colour === 'white' ? plies % 2 === 1 : plies % 2 === 0);
      check(
        `${label} · ${level.value} ends on the user's move`,
        endsOnOwnMove,
        `${plies} plies, ${cut.ownMoves} own moves`,
      );

      // 3. The cut resolves an opening name — the card's title.
      check(
        `${label} · ${level.value} resolves a name`,
        cut.openingName !== null,
        cut.openingName ?? 'no name',
      );

      // The cut never claims more of the user's moves than the level asked for.
      check(
        `${label} · ${level.value} is within its level`,
        cut.ownMoves <= level.moves && cut.ownMoves > 0,
        `${cut.ownMoves} own moves (level asks ${level.moves})`,
      );
    }
  }

  return results;
}
