// A live board in the middle of a scrolling page: only a real tap may touch it.
//
// THE ACCIDENT. Chessground takes over any touch on or near a piece the moment the
// finger lands, and plays a move as soon as one lands on a legal square. A thumb on
// its way down Home could pick up a piece, or play one.
//
// THE RULE. Touches are stopped before the board sees them, so every swipe belongs
// to the page. A tap is left to the browser, which only reports one once it knows the
// finger didn't travel, as a mouse press Chessground already understands. So a tap
// selects and a tap moves, and a swipe can do neither.
//
// The one touch let through is on the piece you have already selected, so it can be
// dragged. And if the page scrolls away while a piece is selected, it lets go, so a
// stray tap can't wait around to be completed by another one.

import type { Api } from 'chessground/api';

/** How far the board may travel, in pixels, before a selected piece lets go. */
const LET_GO_PX = 24;

export function guardBoardTouches(boardEl: HTMLElement, cg: Api): () => void {
  const onTouch = (e: TouchEvent): void => {
    const touch = e.touches[0];
    const selected = cg.state.selected;
    if (selected && touch && e.touches.length === 1
      && cg.getKeyAtDomPos([touch.clientX, touch.clientY]) === selected) return;
    e.stopPropagation();
  };

  let settled = boardEl.getBoundingClientRect().top;
  const onScroll = (): void => {
    const top = boardEl.getBoundingClientRect().top;
    if (cg.state.selected && Math.abs(top - settled) <= LET_GO_PX) return;
    if (cg.state.selected) cg.selectSquare(null);
    settled = top;
  };

  boardEl.addEventListener('touchstart', onTouch, { capture: true, passive: true });
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  return () => {
    boardEl.removeEventListener('touchstart', onTouch, { capture: true });
    document.removeEventListener('scroll', onScroll, { capture: true });
  };
}
