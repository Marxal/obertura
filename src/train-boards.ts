// One live board in each Train section, right under its Start card and above
// the exercises (main.ts places it), in the Start card's domain.
//
//   Openings    your most forgotten moves, or a puzzle from your openings until
//               you have missed something
//   Middlegame  learn from your last games
//   Tactics     one puzzle at your rating
//   Endgames    one endgame puzzle at your rating
//
// The first two are Home's own blocks, dealt from the second position on, so Train
// doesn't open on the board Home just showed you. The other two are a taste of the
// rated run above them and never touch the rating (train-puzzle-card.ts).
//
// ONLY THE SHOWING SECTION HAS A BOARD. Four Chessgrounds for one visible panel would be
// three wasted, and a board can't measure itself while hidden, so main.ts builds this
// each time the section changes.

import { buildGamesBlock } from './home-games-card';
import { buildForgottenMovesBlock } from './home-forgotten-card';
import type { HomeData, HomeDeps } from './home-screen';
import { getPuzzleRating, difficultyForRating } from './puzzle-rating';
import { hasPuzzles, toAngleKey } from './puzzles';
import { buildPuzzleBlock } from './train-puzzle-card';
import type { DomainId } from './train-doors';
import { t } from './i18n';

export async function buildTrainBoard(
  domain: DomainId, data: HomeData, deps: HomeDeps,
): Promise<HTMLElement | null> {
  switch (domain) {
    case 'openings': {
      const forgotten = buildForgottenMovesBlock(data.lines, deps, 1);
      if (forgotten) return forgotten;
      const opening = data.lines.map(l => l.openingName).find(n => hasPuzzles(n));
      const angle = opening ? toAngleKey(opening) : null;
      if (!angle) return null;
      return buildPuzzleBlock({
        title: t('open.aPuzzleFromYour'),
        angle,
        difficulty: difficultyForRating(getPuzzleRating()),
      });
    }
    case 'middlegame':
      return buildGamesBlock(data, deps, 1);
    case 'tactics':
      return buildPuzzleBlock({
        title: t('open.aPuzzleAtYour'),
        angle: null,
        difficulty: difficultyForRating(getPuzzleRating()),
      });
    case 'endgames':
      return buildPuzzleBlock({
        title: t('open.anEndgameAtYour'),
        angle: 'endgame',
        difficulty: difficultyForRating(getPuzzleRating('endgame')),
      });
  }
}
