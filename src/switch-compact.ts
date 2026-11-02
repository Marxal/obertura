// The pinned switch at the top of Train and Openings slims down once you scroll
// into the list, and fills back out at the top.
//
// The height it gives back is handed to its bottom margin, so the page below keeps
// its exact length and position and nothing shifts under the finger mid-scroll. The
// first cut moved the page by ~30px each time it folded, which read as the scroll
// stuttering.
//
// One window listener for both screens. A repaint builds a new switch, and
// registering it under the same class replaces the old one.

const COMPACT_FROM = 48;
const FULL_BELOW = 8;

const watched = new Map<string, HTMLElement>();
let wired = false;

export function setSwitchCompact(sw: HTMLElement, compactClass: string, on: boolean): void {
  if (sw.classList.contains(compactClass) === on) return;
  sw.style.marginBottom = '';
  const full = sw.offsetHeight;
  sw.classList.toggle(compactClass, on);
  if (on) sw.style.marginBottom = `${full - sw.offsetHeight}px`;
}

/** Follow the window's scroll for this switch, starting from where the page is now. */
export function watchSwitchScroll(sw: HTMLElement, compactClass: string): void {
  watched.set(compactClass, sw);
  if (window.scrollY > COMPACT_FROM) setSwitchCompact(sw, compactClass, true);
  if (wired) return;
  wired = true;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    for (const [cls, el] of watched) {
      // Not drawn: another screen owns the scroll, or a layout that hides the switch.
      if (!el.isConnected || el.offsetParent === null) continue;
      if (y > COMPACT_FROM) setSwitchCompact(el, cls, true);
      else if (y < FULL_BELOW) setSwitchCompact(el, cls, false);
    }
  }, { passive: true });
}
