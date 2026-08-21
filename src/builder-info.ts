// One sentence-and-a-bit per builder tab, behind the small (i) at the bottom
// right of the sheet.
//
// WHY IT EXISTS. The builder is five panels deep and every one of them answers a
// different question from the same board position. Which panel answers which was
// only ever discoverable by opening them all — the first-run walkthrough says it
// once, and then it is gone for good. This is the same explanation, permanently
// one tap away, in the corner rather than in the way.
//
// KEEP THESE SHORT. Two short paragraphs at the very most: what this tab shows,
// and what you can do on it. Anything longer is a manual, and nobody reads a
// manual from a phone in the middle of building a line.
//
// The Library tab is the exception and isn't here: its (i) is builder-panels.ts's
// showDbInfo, which has to carry the Lichess connect/disconnect buttons as well
// as the explanation.

import { showDialog } from './dialog';

export type BuilderInfoId = 'explore' | 'mylines' | 'line' | 'game' | 'engine';

const COPY: Record<BuilderInfoId, { title: string; body: string }> = {
  explore: {
    title: 'Explore',
    body:
      'Three moves worth having here, picked from the games you’ve imported, the '
      + 'opening library and the engine. Tap one to play it onto your line.\n\n'
      + 'Under them, each move’s record: how you’ve scored with it against how the '
      + 'database has. Turn on Auto-reply and the opponent’s answer is played for '
      + 'you, so you only ever choose your own moves.',
  },
  mylines: {
    title: 'My lines',
    body:
      'What happens from the position on the board, from three sources: your own '
      + 'saved lines, your imported games, and any opponent you’ve scouted.\n\n'
      + 'Tap a move to follow it. “Show tree” opens the whole thing as a map, and '
      + 'the bin on one of your own moves takes that continuation out of your book.',
  },
  line: {
    title: 'Line info',
    body:
      'Everything about the line you’re standing in: whether it’s in training, its '
      + 'tags, a note on the move on the board, and how often it should come round.\n\n'
      + 'Below that, how the line has actually been going — how often it turns up in '
      + 'your games, how much of it you remember, and which move keeps breaking.',
  },
  game: {
    title: 'Game',
    body:
      'The game you’re looking at, move by move. “Analyse game” has the engine mark '
      + 'every move, and the marks then show in the move list and on the board.\n\n'
      + 'Playing a different move here keeps the game intact and adds your move as a '
      + 'variation. “Save line” files the moves up to the board as a repertoire line; '
      + '“Builder” takes them into the builder to carry on with.',
  },
  engine: {
    title: 'Engine',
    body:
      'Stockfish on the position on the board: the evaluation bar, and the strongest '
      + 'continuations it can find. Opening this tab switches the engine on.\n\n'
      + 'Tap one of its lines to play the move onto your own. An evaluation is an '
      + 'opinion about the position, not about whether the move belongs in your '
      + 'repertoire — that is what the other tabs are for.',
  },
};

export function showBuilderInfo(id: BuilderInfoId): void {
  const copy = COPY[id];
  showDialog({
    title: copy.title,
    body: copy.body,
    buttons: [{ label: 'Got it', variant: 'primary' }],
  });
}

/** The button's accessible name for a tab, so it never just says "info". */
export function builderInfoLabel(id: BuilderInfoId | 'library'): string {
  return id === 'library' ? 'About the opening database' : `About ${COPY[id].title}`;
}
