// The small layout pieces the statistics blocks are built from — a section
// card, a segmented pill row, the sideways slide that plays when a segment
// changes, and the list sheet a "See all" opens.
//
// Pulled out of progress-screen.ts once the forgotten-moves block moved to the
// Train screen: both screens draw the same furniture, and neither should have
// to import the other to get it.

import { pushBack } from './back-nav';

export function statsSection(title: string, meta = ''): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'section';
  const head = document.createElement('div');
  head.className = 'section-head';
  const h = document.createElement('h3');
  h.className = 'section-title';
  h.textContent = title;
  head.appendChild(h);
  if (meta) {
    const m = document.createElement('span');
    m.className = 'section-meta';
    m.textContent = meta;
    head.appendChild(m);
  }
  wrap.appendChild(head);
  return wrap;
}

// Carousel-style slide-in for a block whose selection just changed: the new
// content enters from the side you moved towards. Removing + re-adding the
// class (with a reflow between) restarts the animation on rapid taps.
export function slideSwap(el: HTMLElement, dir: 'fwd' | 'back'): void {
  el.classList.remove('stats-slide-fwd', 'stats-slide-back');
  void el.offsetWidth; // reflow so the animation restarts
  el.classList.add(dir === 'fwd' ? 'stats-slide-fwd' : 'stats-slide-back');
}

// A reusable segmented pill row (range selector, colour toggle, scoring tabs).
// Pass `slideEl` to slide that element's content sideways on every switch —
// forward (enter from the right) when moving to a later chip, back otherwise.
export function buildSegmented<T extends string>(
  opts: [T, string][],
  current: T,
  onChange: (v: T) => void,
  className = 'stats-range',
  slideEl?: HTMLElement,
): HTMLElement {
  const row = document.createElement('div');
  row.className = className;
  row.setAttribute('role', 'tablist');
  for (const [key, label] of opts) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'stats-range-chip' + (key === current ? ' stats-range-chip--on' : '');
    chip.textContent = label;
    chip.setAttribute('aria-pressed', String(key === current));
    chip.addEventListener('click', () => {
      if (chip.classList.contains('stats-range-chip--on')) return;
      const chips = [...row.querySelectorAll('.stats-range-chip')];
      if (slideEl) {
        const oldI = chips.findIndex(c => c.classList.contains('stats-range-chip--on'));
        slideSwap(slideEl, chips.indexOf(chip) > oldI ? 'fwd' : 'back');
      }
      chips.forEach(c => {
        c.classList.remove('stats-range-chip--on');
        c.setAttribute('aria-pressed', 'false');
      });
      chip.classList.add('stats-range-chip--on');
      chip.setAttribute('aria-pressed', 'true');
      onChange(key);
    });
    row.appendChild(chip);
  }
  return row;
}

// The bottom sheet a "See all" opens: a title and a scrolling list the caller
// fills. Registers with the back-nav stack so the Android back gesture closes
// the sheet rather than the screen behind it.
export function openSheet(title: string, fill: (body: HTMLElement, close: () => void) => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet';

  const h = document.createElement('h3');
  h.className = 'edit-sheet-title';
  h.textContent = title;
  sheet.appendChild(h);

  const body = document.createElement('div');
  body.className = 'stats-sheet-list';
  sheet.appendChild(body);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  };
  const removeBack = pushBack(close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  fill(body, close);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}
