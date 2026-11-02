// Swipe a whole box sideways for another position, like dealing a card.
//
// Nothing announces it: the box simply follows your finger, with the next position showing
// underneath. Far enough, or fast enough, and it flies off; otherwise it springs back.
//
// IT DOESN'T FIGHT THE BOARD OR THE PAGE. A board on Home only takes tapped moves
// (reply-board-touch.ts), so a sideways swipe across one is free. A swipe that starts
// mostly downwards is left to the page. Listening in the capture phase is what lets this
// see touches that the board's own guard stops, and it never blocks them.

/** How far the finger travels before the gesture counts as going somewhere. */
const DECIDE_PX = 10;
/** Sideways has to clearly beat downwards. */
const SIDEWAYS_RATIO = 1.2;
const COMMIT_SHARE = 0.28;
const FLICK_PX_PER_MS = 0.5;
const FLICK_MIN_PX = 40;
const FLY_MS = 170;
/** How much a box with nowhere to go gives before it pulls back. */
const NOWHERE_DAMPING = 0.25;

export interface CardSwipeOptions {
  /** Touches starting inside these belong to them, like a row that scrolls sideways. */
  ignore?: string;
  /** False while there's something to lose, like moves already played. */
  canSwipe: () => boolean;
  /** False when there's no other position to show: it stretches, and returns. */
  canCommit: () => boolean;
  onSwipe: () => void;
  /** What's coming next, shown underneath while the box is dragged. */
  under?: () => UnderCard | null;
}

export interface UnderCard {
  /** How far the box has been dragged towards committing, 0 to 1. */
  progress: (share: number) => void;
  remove: () => void;
}

export function attachCardSwipe(el: HTMLElement, opts: CardSwipeOptions): () => void {
  let active = false;
  let swiping = false;
  let startX = 0;
  let startY = 0;
  let startAt = 0;
  let lastX = 0;
  let under: UnderCard | null = null;

  el.classList.add('swipe-card');

  const place = (dx: number): void => {
    const shown = opts.canCommit() ? dx : dx * NOWHERE_DAMPING;
    el.style.transform = `translateX(${shown}px) rotate(${shown * 0.03}deg)`;
    under?.progress(Math.min(1, Math.abs(dx) / (el.offsetWidth * COMMIT_SHARE)));
  };

  const settle = (): void => {
    el.classList.remove('swipe-card--dragging');
    el.style.transform = '';
    under?.remove();
    under = null;
  };

  const onStart = (e: TouchEvent): void => {
    active = false;
    swiping = false;
    if (e.touches.length !== 1) return;
    const target = e.target as Element | null;
    if (opts.ignore && target?.closest(opts.ignore)) return;
    if (!opts.canSwipe()) return;
    active = true;
    startX = lastX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startAt = e.timeStamp;
  };

  const onMove = (e: TouchEvent): void => {
    if (!active) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    lastX = touch.clientX;
    if (!swiping) {
      if (Math.hypot(dx, dy) < DECIDE_PX) return;
      if (Math.abs(dx) < Math.abs(dy) * SIDEWAYS_RATIO) {
        active = false;   // the page is scrolling
        return;
      }
      swiping = true;
      el.classList.add('swipe-card--dragging');
      if (opts.canCommit()) under = opts.under?.() ?? null;
    }
    place(dx);
  };

  const fly = (direction: number): void => {
    el.classList.remove('swipe-card--dragging');
    el.classList.add('swipe-card--flying');
    const distance = el.offsetWidth * 1.25 * direction;
    el.style.transform = `translateX(${distance}px) rotate(${direction * 12}deg)`;
    under?.progress(1);
    window.setTimeout(() => {
      el.classList.remove('swipe-card--flying');
      el.style.transform = '';
      under?.remove();
      under = null;
      opts.onSwipe();
    }, FLY_MS);
  };

  const onEnd = (e: TouchEvent): void => {
    if (!active || !swiping) {
      active = false;
      return;
    }
    active = false;
    swiping = false;
    const dx = lastX - startX;
    const speed = Math.abs(dx) / Math.max(1, e.timeStamp - startAt);
    const far = Math.abs(dx) > el.offsetWidth * COMMIT_SHARE;
    const flicked = speed > FLICK_PX_PER_MS && Math.abs(dx) > FLICK_MIN_PX;
    if ((far || flicked) && opts.canCommit()) fly(dx > 0 ? 1 : -1);
    else settle();
  };

  const onCancel = (): void => {
    active = false;
    swiping = false;
    settle();
  };

  el.addEventListener('touchstart', onStart, { capture: true, passive: true });
  el.addEventListener('touchmove', onMove, { capture: true, passive: true });
  el.addEventListener('touchend', onEnd, { capture: true, passive: true });
  el.addEventListener('touchcancel', onCancel, { capture: true, passive: true });
  return () => {
    el.removeEventListener('touchstart', onStart, { capture: true });
    el.removeEventListener('touchmove', onMove, { capture: true });
    el.removeEventListener('touchend', onEnd, { capture: true });
    el.removeEventListener('touchcancel', onCancel, { capture: true });
    under?.remove();
    under = null;
  };
}
