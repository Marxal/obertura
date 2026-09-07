// The "grow a line" notification — a dismissable card styled like a phone
// notification (it is not one), pinned above Train, My Lines and Explore.
//
// IT REPLACES THE OLD DAILY-CHALLENGE ROW. Growing a line isn't a task with a
// daily quota — it's a standing offer: "this one's ready, want to extend it?".
// A quota row forced it to compete with puzzles and lines for one of the day's
// ticks; a quiet banner can just wait until the user has a moment, and go
// away entirely once there's nothing to offer.
//
// ONE CARD, ONE LINE, EVER. The candidate is grow-line.ts's own ranking (same
// "mastered, ends on their move, something known to prepare for" test the old
// daily task used) — this file only draws the offer and handles dismissal.
//
// NEVER RESHOWN AFTER A SWIPE. Dismissing rests the line for
// GROW_NOTICE_DISMISS_DAYS (grow-log.ts) — the same rest map the "grow" tab's
// own "skip for today" and a completed grow both write to, so a swipe on Train
// also clears the card on My Lines and Explore: one gesture, quiet everywhere.

import { Icons } from './icons';
import type { GrowTarget } from './grow-line';
import { restGrowLine, GROW_NOTICE_DISMISS_DAYS } from './grow-log';

export { GROW_NOTICE_DISMISS_DAYS };

// How far a drag must travel before release counts as "throw it away", and
// the smaller distance past which a drag no longer reads as a tap.
const DISMISS_PX = 72;
const DRAG_THRESHOLD_PX = 6;

export interface GrowNoticeOptions {
  target: GrowTarget;
  /** Tapped — open the builder on this line's Grow tab. */
  onOpen: () => void;
  /** Swiped away or closed — the caller repaints (the card removes itself). */
  onDismiss: () => void;
}

export function createGrowNotice(opts: GrowNoticeOptions): HTMLElement {
  const { target } = opts;

  const el = document.createElement('div');
  el.className = 'grow-notice';
  el.setAttribute('role', 'status');

  let done = false;
  let dragging = false;
  let wasDrag = false;
  let startX = 0;
  let dx = 0;

  const icon = document.createElement('span');
  icon.className = 'grow-notice-icon';
  icon.appendChild(Icons.sprout(18));
  el.appendChild(icon);

  const text = document.createElement('div');
  text.className = 'grow-notice-text';
  const title = document.createElement('div');
  title.className = 'grow-notice-title';
  title.textContent = 'Grow a line';
  text.appendChild(title);
  const sub = document.createElement('div');
  sub.className = 'grow-notice-sub';
  sub.textContent = target.spot.line.name;
  text.appendChild(sub);
  el.appendChild(text);

  const chev = Icons.chevronRight(16);
  chev.classList.add('grow-notice-chev');
  el.appendChild(chev);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'grow-notice-close';
  closeBtn.setAttribute('aria-label', 'Dismiss — a different line in a few days');
  closeBtn.appendChild(Icons.close(14));
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });
  el.appendChild(closeBtn);

  el.addEventListener('click', (e) => {
    if (done || wasDrag || (e.target as HTMLElement).closest('button')) return;
    opts.onOpen();
  });

  // Flick to dismiss, horizontal only — mirrors struggle-nudge.ts.
  el.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragging = true;
    wasDrag = false;
    startX = e.clientX;
    dx = 0;
    el.classList.add('grow-notice--dragging');
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dx = e.clientX - startX;
    if (Math.abs(dx) > DRAG_THRESHOLD_PX) wasDrag = true;
    el.style.transform = `translateX(${dx}px)`;
    el.style.opacity = String(Math.max(0.25, 1 - Math.abs(dx) / (DISMISS_PX * 3)));
  });

  function endDrag(): void {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('grow-notice--dragging');
    if (Math.abs(dx) >= DISMISS_PX) {
      dismiss(dx < 0 ? 'left' : 'right');
    } else {
      el.style.transform = '';
      el.style.opacity = '';
    }
  }
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  function dismiss(dir: 'left' | 'right' = 'left'): void {
    if (done) return;
    done = true;
    restGrowLine(target.spot.line.id, GROW_NOTICE_DISMISS_DAYS);
    el.classList.add(`grow-notice--exit-${dir}`);
    el.style.transform = '';
    el.style.opacity = '';
    setTimeout(() => el.remove(), 220);
    opts.onDismiss();
  }

  return el;
}
