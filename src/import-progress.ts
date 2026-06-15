// A tiny pixel-pawn progress bar for the import scan (see import-panel.ts).
//
// One little 8-bit pawn marches along a track. Two modes, both driven from the
// import fetcher's onProgress (monthsDone / monthsTotal):
//
//   • DETERMINATE — when we know the total (e.g. the 1m/3m/12m ranges): the fill
//     grows to monthsDone/monthsTotal and the pawn rides its leading edge.
//   • INDETERMINATE — when the end is unknown (the "All" range, or a single
//     archive where per-month progress isn't meaningful): the pawn walks the
//     whole rail on a loop, laying a trail that resets, until we snap to 100%.
//
// The pawn is inline pixel-art SVG (blocky, crisp edges), themed in --accent.
// prefers-reduced-motion is honoured in CSS: no walking, no marching legs — just
// a calm static bar.

// Blocky pixel pawn: a stack of rects on a 16×18 grid. The two feet carry a
// class so CSS can bob them alternately for the "marching" look; everything is
// currentColor so the bar themes itself from --accent.
const PAWN_SVG = `
<svg class="pawn-progress-pawn-svg" viewBox="0 0 16 18" width="16" height="18" aria-hidden="true" focusable="false">
  <rect x="5" y="0" width="6" height="3"/>
  <rect x="4" y="3" width="8" height="3"/>
  <rect x="6" y="6" width="4" height="2"/>
  <rect x="4" y="8" width="8" height="2"/>
  <rect x="3" y="10" width="10" height="2"/>
  <rect x="5" y="12" width="6" height="2"/>
  <rect x="2" y="14" width="12" height="2"/>
  <rect class="pawn-foot pawn-foot--l" x="2" y="16" width="5" height="2"/>
  <rect class="pawn-foot pawn-foot--r" x="9" y="16" width="5" height="2"/>
</svg>`;

export interface PawnProgress {
  // The element to drop into the DOM. Hidden until start().
  readonly el: HTMLElement;
  // Show the bar and begin walking (indeterminate). Call set() to switch it to a
  // proportional fill once a real total is known.
  start(): void;
  // Determinate update: fraction in 0..1. Flips the bar out of indeterminate.
  set(fraction: number): void;
  // Finished: stop walking and snap the fill (and pawn) to 100%.
  done(): void;
  // Reset and hide.
  hide(): void;
}

export function createPawnProgress(): PawnProgress {
  const el = document.createElement('div');
  el.className = 'pawn-progress';
  el.setAttribute('role', 'progressbar');
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', '100');
  el.hidden = true;

  // The pawn rides on a rail above the track so the track's overflow:hidden
  // never clips it.
  const rail = document.createElement('div');
  rail.className = 'pawn-progress-rail';
  const pawn = document.createElement('div');
  pawn.className = 'pawn-progress-pawn';
  pawn.innerHTML = PAWN_SVG;
  rail.appendChild(pawn);

  const track = document.createElement('div');
  track.className = 'pawn-progress-track';
  const fill = document.createElement('div');
  fill.className = 'pawn-progress-fill';
  track.appendChild(fill);

  el.appendChild(rail);
  el.appendChild(track);

  function setPct(pct: number): void {
    const p = Math.max(0, Math.min(100, pct));
    fill.style.width = `${p}%`;
    pawn.style.left = `${p}%`;
    el.setAttribute('aria-valuenow', String(Math.round(p)));
  }

  // Clear the inline left/width so the indeterminate CSS keyframes can drive them.
  function clearInline(): void {
    fill.style.width = '';
    pawn.style.left = '';
    el.removeAttribute('aria-valuenow');
  }

  return {
    el,
    start(): void {
      el.hidden = false;
      el.classList.add('pawn-progress--indeterminate');
      clearInline();
    },
    set(fraction: number): void {
      el.classList.remove('pawn-progress--indeterminate');
      setPct(fraction * 100);
    },
    done(): void {
      el.classList.remove('pawn-progress--indeterminate');
      setPct(100);
    },
    hide(): void {
      el.hidden = true;
      el.classList.remove('pawn-progress--indeterminate');
      clearInline();
    },
  };
}
