// The blocky 8-bit pawn, as inline SVG. Shared by the import progress bar (where
// it marches along a rail) and the training finish screens (where it hops to
// celebrate). Built from a stack of rects on a 16×18 grid; the two feet carry a
// class so CSS can bob them alternately for the "marching" look. Everything is
// currentColor so it themes itself from whatever colour the caller sets.
//
// Pass the class you want on the <svg> so each caller can style/animate its own
// copy independently.
export function pixelPawnSvg(svgClass: string): string {
  return `
<svg class="${svgClass}" viewBox="0 0 16 18" width="16" height="18" aria-hidden="true" focusable="false">
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
}

// The same blocky pawn, promoted: a three-pronged crown on the same 16×18 grid,
// with the same two feet (so the marching/hopping animations that target
// .pawn-foot work on it unchanged). Used by the perfect-day celebration, where
// the pawn queens.
export function pixelQueenSvg(svgClass: string): string {
  return `
<svg class="${svgClass}" viewBox="0 0 16 18" width="16" height="18" aria-hidden="true" focusable="false">
  <rect x="7" y="0" width="2" height="5"/>
  <rect x="4" y="2" width="2" height="3"/>
  <rect x="10" y="2" width="2" height="3"/>
  <rect x="1" y="3" width="2" height="2"/>
  <rect x="13" y="3" width="2" height="2"/>
  <rect x="1" y="5" width="14" height="2"/>
  <rect x="4" y="7" width="8" height="2"/>
  <rect x="6" y="9" width="4" height="2"/>
  <rect x="3" y="11" width="10" height="2"/>
  <rect x="5" y="13" width="6" height="1"/>
  <rect x="2" y="14" width="12" height="2"/>
  <rect class="pawn-foot pawn-foot--l" x="2" y="16" width="5" height="2"/>
  <rect class="pawn-foot pawn-foot--r" x="9" y="16" width="5" height="2"/>
</svg>`;
}
